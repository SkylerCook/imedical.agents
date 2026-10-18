'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const convergence = require('./night-convergence');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => typeof value === 'string' && value.trim().length > 0;
const strict = manifest => manifest.schemaVersion === '2.1';
const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
const physical = value => key(fs.realpathSync.native(path.resolve(value)));
const contains = (parent, child) => { parent = key(parent); child = key(child); return parent === '.' || parent === child || child.startsWith(parent + '/'); };
const phases = ['implementation', 'review', 'deployment', 'verification', 'cleanup'];

function repositoryRoot(manifest, item) {
    const owner = manifest.participants.find(p => p.id === item.ownerId);
    return item.repositoryRoot || (owner?.worktree?.mode === 'isolated' ? owner.worktree.ref : manifest.repositoryRoot);
}

function gitRoot(value) {
    if (!path.isAbsolute(value || '')) throw new Error('Absolute work item repositoryRoot required');
    const actual = execFileSync('git', ['-C', value, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
    if (physical(actual) !== physical(value)) throw new Error('repositoryRoot must be an actual Git root');
    return physical(actual);
}

function validateItems(manifest) {
    if (!strict(manifest)) return;
    if (!manifest.night || manifest.night.interactionMode !== 'preflight-only') throw new Error('Schema 2.1 requires preflight-only night policy');
    if (!text(manifest.night.runReference)) throw new Error('Schema 2.1 requires one batch runReference');
    const writes = [];
    for (const item of manifest.workItems) {
        const root = gitRoot(item.repositoryRoot);
        const workspace = manifest.night.workspaces?.find(w => w.ownerId === item.ownerId);
        if (!workspace?.plan.repositories.some(r => physical(r.target) === root)) throw new Error('Work repository is outside owner workspace preflight');
        if (!text(item.night.role) || !text(item.night.environmentAlias)) throw new Error('Night work role and environmentAlias required');
        if (item.night.phase === 'verification' && (!['read-only', 'write'].includes(item.night.effects) || item.night.effects === 'write' && !['retain', 'reset', 'delete'].includes(item.night.dataPolicy))) throw new Error('Verification effects and explicit write dataPolicy required');
        if (item.writeScopes.length) writes.push({ item, root });
        if (item.status === 'skipped' && (!text(item.night.skipReason) || !text(item.night.handoffRef))) throw new Error('Skipped night stage requires reason and handoff');
    }
    for (const id of new Set(manifest.workItems.map(w => w.night.demandId))) {
        const work = manifest.workItems.filter(w => w.night.demandId === id);
        if (work.some(w => w.night.phase === 'review' && work.some(other => other.night.phase === 'implementation' && other.ownerId === w.ownerId))) throw new Error('Night review requires an independent owner');
        for (const phase of phases) if (!work.some(w => w.night.phase === phase)) throw new Error(`Night phase missing: ${id}:${phase}`);
        const ancestors = item => { const found = new Set(); const visit = w => { for (const dep of w.dependsOn) if (!found.has(dep)) { found.add(dep); const next = manifest.workItems.find(x => x.id === dep); if (next) visit(next); } }; visit(item); return found; };
        for (let i = 1; i < phases.length; i++) for (const item of work.filter(w => w.night.phase === phases[i] && w.status !== 'skipped')) {
            let prior = i - 1;
            while (prior >= 0 && !work.some(w => w.night.phase === phases[prior] && w.status !== 'skipped')) prior--;
            const previous = work.filter(w => w.night.phase === phases[prior] && w.status !== 'skipped');
            if (previous.some(w => !ancestors(item).has(w.id))) throw new Error(`Night phase dependency missing: ${item.id}`);
        }
    }
    for (let i = 0; i < writes.length; i++) for (let j = i + 1; j < writes.length; j++) {
        const a = writes[i], b = writes[j];
        if (a.root === b.root && a.item.ownerId !== b.item.ownerId && a.item.writeScopes.some(x => b.item.writeScopes.some(y => contains(x, y) || contains(y, x)))) throw new Error('Conflicting owners in physical repository');
    }
}

function requiredAuthorizations(manifest, item) {
    const result = new Set(item.night.requiredAuthorizations || []);
    if (manifest.orchestration.mode === 'multi-session') result.add('collaborationPlan');
    if (item.authorizationCategory) result.add(item.authorizationCategory);
    if (item.night.phase === 'deployment') result.add('deploy');
    if (item.night.effects === 'write') result.add('testDataWrite');
    if (item.night.dataPolicy && item.night.dataPolicy !== 'retain') result.add('testDataDisposition');
    return [...result];
}

function grantCovers(manifest, grant, item, at = Date.now()) {
    if (!text(grant?.reference) || manifest.night.authorizationReferences?.[grant.category] !== grant.reference) return false;
    if (grant.revoked) return false;
    if (manifest.night.preflight?.environmentAlias && grant.environmentAlias !== manifest.night.preflight.environmentAlias) return false;
    if (grant.expiresAt && (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(grant.expiresAt) || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= at)) return false;
    if (item.night.environmentAlias && grant.environmentAlias !== item.night.environmentAlias) return false;
    if (item.night.role && !grant.roles?.includes(item.night.role)) return false;
    const writes = grant.category === 'deploy' ? manifest.workItems.filter(w => w.night.demandId === item.night.demandId && w.writeScopes.length) : item.writeScopes.length ? [item] : [];
    for (const work of writes) {
        const root = physical(repositoryRoot(manifest, work));
        if (!grant.scopes?.some(s => physical(s.repoRoot) === root && work.writeScopes.every(p => s.paths.some(parent => contains(parent, p))))) return false;
    }
    if (['testDataWrite', 'testDataDisposition'].includes(grant.category) && (!text(grant.dataScopeReference) || (item.night.dataPolicy && !grant.dataPolicies?.includes(item.night.dataPolicy)))) return false;
    return true;
}

function readinessReasons(manifest, item, at = Date.now()) {
    if (!strict(manifest) || item.night.phase === 'cleanup') return [];
    const p = manifest.night.preflight;
    if (!p) return ['night-preflight-missing'];
    const reasons = [];
    if (p.revoked) reasons.push('night-preflight-revoked');
    if (!grantPlanCovered(manifest, item)) reasons.push('night-plan-outside-preauthorization');
    for (const file of p.configurationFiles || []) {
        try { if (crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex') !== file.sha256) reasons.push('night-configuration-changed'); }
        catch { reasons.push('night-configuration-unavailable'); }
    }
    for (const category of requiredAuthorizations(manifest, item)) if (manifest.authorizations[category]?.state === 'revoked' || !p.authorizations.some(g => g.category === category && grantCovers(manifest, g, item, at))) reasons.push(`night-authorization-missing:${category}`);
    const required = new Set([...(manifest.night.requiredCapabilities || []), ...(item.night.requiredCapabilities || [])]);
    if (item.night.phase === 'verification') {
        for (const name of ['authentication', 'role', 'entry', 'exit']) required.add(name);
        if (item.night.effects === 'write') for (const name of ['fixture-authority', 'data-disposition']) required.add(name);
        const record = manifest.night.demands.find(d => d.id === item.night.demandId);
        if (record?.assessment?.post?.route === 'ui' || record?.assessment?.post?.auditRoute === 'ui' || item.night.route === 'ui') for (const name of ['browser', 'viewport']) required.add(name);
    }
    for (const id of required) if (!p.checks.some(c => c.id === id && c.status === 'passed' && c.nonInteractive === true && text(c.evidenceRef) && (id !== 'browser' || c.executor === 'playwright-headless') && (!item.night.role || c.role === item.night.role || c.role === '*'))) reasons.push(`night-capability-missing:${id}`);
    return reasons;
}

function grantPlanCovered(manifest, item) {
    const p = manifest.night.preflight;
    return (item ? [item] : manifest.workItems).filter(w => w.status !== 'skipped' && w.night.phase !== 'cleanup').every(work => work.writeScopes.every(scope => p.sourceScopes?.some(s => physical(s.repoRoot) === physical(work.repositoryRoot) && s.paths.some(parent => contains(parent, scope)))) && requiredAuthorizations(manifest, work).every(category => p.authorizations.some(g => g.category === category && grantCovers(manifest, g, work))));
}

function recordPreflight(manifest, receipt) {
    if (!strict(manifest)) throw new Error('Preflight receipt requires schema 2.1');
    if (!text(receipt?.profileFingerprint) || !text(receipt.configFingerprint) || !Array.isArray(receipt.configurationFiles) || !receipt.configurationFiles.length || !Array.isArray(receipt.authorizations) || !Array.isArray(receipt.checks) || !text(receipt.checkedAt) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(receipt.checkedAt) || !Number.isFinite(Date.parse(receipt.checkedAt)) || Date.parse(receipt.checkedAt) > Date.now()) throw new Error('Invalid preflight receipt');
    if (receipt.checks.some(c => !text(c.id) || !text(c.evidenceRef) || !['passed', 'blocked', 'failed'].includes(c.status) || typeof c.nonInteractive !== 'boolean')) throw new Error('Invalid capability check');
    if (!text(receipt.environmentAlias) || receipt.cleanupVerified !== true || receipt.configurationFiles.some(f => !path.isAbsolute(f.path || '') || !/^[a-f0-9]{64}$/.test(f.sha256 || ''))) throw new Error('Invalid preflight environment/configuration/exit');
    if (manifest.workItems.some(w => w.night.phase === 'deployment' && w.status !== 'skipped') && !text(receipt.deploymentConfigFingerprint)) throw new Error('Deployment configuration fingerprint required');
    const previous = manifest.night.preflight;
    if (manifest.night.startedAt && (!previous || hash(receipt.authorizations) !== hash(previous.authorizations))) throw new Error('Running night cannot acquire or widen authorizations');
    manifest.night.preflight = structuredClone(receipt);
    manifest.night.preflight.sourceScopes = manifest.night.startedAt && previous?.sourceScopes || manifest.workItems.filter(w => w.writeScopes.length).map(w => ({ repoRoot: w.repositoryRoot, paths: w.writeScopes }));
    manifest.night.preflight.planHash = manifest.orchestration.planHash;
    const active = manifest.workItems.filter(w => w.status !== 'skipped' && w.night.phase !== 'cleanup');
    const issues = [...new Set(active.flatMap(w => readinessReasons(manifest, w)))];
    manifest.night.preflight.state = issues.length ? 'blocked' : 'ready';
    manifest.night.preflight.issues = issues;
    if (!issues.length) rebindAuthorizations(manifest);
}

function rebindAuthorizations(manifest) {
    if (!strict(manifest) || !manifest.night.preflight) return;
    if (manifest.workItems.filter(w => w.status !== 'skipped' && w.night.phase !== 'cleanup').some(w => readinessReasons(manifest, w).length)) return;
    for (const grant of manifest.night.preflight.authorizations) if (manifest.authorizations[grant.category]) manifest.authorizations[grant.category] = { state: 'granted', scopeHash: manifest.orchestration.planHash, grantedAt: manifest.night.preflight.checkedAt, grantedBy: 'preflight-reference', sourceReference: grant.reference };
    manifest.night.preflight.planHash = manifest.orchestration.planHash;
}

function trackWork(manifest, item, status, at = new Date().toISOString()) {
    if (!strict(manifest)) return;
    const record = manifest.night.demands.find(d => d.id === item.night.demandId);
    if (!record) return;
    const open = record.timingSegments.find(s => s.workItemId === item.id && !s.endedAt);
    if (status === 'running' && !open) {
        const phase = { implementation: 'diagnosis', review: 'evidence', deployment: 'execute', verification: 'execute', cleanup: 'cleanup' }[item.night.phase];
        record.timingSegments.push({ phase, workItemId: item.id, startedAt: at, granularity: 'stage' });
        if (item.night.phase !== 'cleanup') manifest.night.startedAt ||= at;
    } else if (['completed', 'failed', 'blocked', 'skipped'].includes(status) && open) open.endedAt = at;
}

function holdWork(manifest, item, reasons, evidenceRefs = []) {
    if (!strict(manifest)) return;
    trackWork(manifest, item, 'blocked'); item.status = 'blocked';
    const record = manifest.night.demands.find(d => d.id === item.night.demandId);
    if (record) {
        if (manifest.night.operations?.some(op => op.workItemId === item.id && op.status === 'running')) record.resources.pending = true;
        if (!record.results.knownDefect) record.blocked = true;
    }
    manifest.night.handoffs ||= [];
    if (!manifest.night.handoffs.some(h => h.workItemId === item.id && hash(h.reasons) === hash(reasons))) manifest.night.handoffs.push({ workItemId: item.id, reasons, evidenceRefs, at: new Date().toISOString() });
}

function timingStatus(manifest, record) {
    const work = manifest.workItems.filter(w => w.night.demandId === record.id && (w.status === 'running' || w.attempts?.length || w.status === 'completed'));
    return work.some(w => !record.timingSegments?.some(s => s.workItemId === w.id && s.granularity === 'stage')) ? 'incomplete' : record.timingSegments?.length ? 'recorded' : 'not-started';
}

function assertStageComplete(manifest, item, currentSources) {
    if (!strict(manifest)) return;
    const record = manifest.night.demands.find(d => d.id === item.night.demandId);
    if (convergence.enabled(manifest) && item.night.phase === 'verification' && convergence.dependencyReasons(manifest, record, true).length) throw new Error('Verification dependencies are not current and verified');
    if (currentSources && ['deployment', 'verification'].includes(item.night.phase) && currentSources(record).frozenVersion !== record.frozenVersion) throw new Error('Stage source version changed');
    const operation = manifest.night.operations?.find(o => o.workItemId === item.id && o.status === 'verified' && o.frozenVersion === record?.frozenVersion && (!convergence.enabled(manifest) || o.dependencyToken === convergence.dependencyToken(manifest, record.id)) && (o.phase === 'verification' ? o.profileFingerprint === manifest.night.preflight.profileFingerprint : o.configurationFingerprint === manifest.night.preflight.deploymentConfigFingerprint));
    if (item.night.phase === 'deployment' && (!operation || !record?.deploymentReceipts?.some(r => r.operationId === operation.id && r.status === 'verified' && r.frozenVersion === record.frozenVersion))) throw new Error('Deployment stage requires a current managed receipt');
    if (item.night.phase === 'verification' && (!operation || !record?.testReceipts?.some(r => r.operationId === operation.id && r.status === 'passed' && r.frozenVersion === record.frozenVersion))) throw new Error('Verification stage requires current test receipts');
}

function operationRecord(manifest, input, currentSources, gate) {
    const night = manifest.night;
    if (!strict(manifest)) throw new Error('Managed operation requires schema 2.1');
    night.operations ||= [];
    if (input.kind === 'operation-blocked') {
        const item = manifest.workItems.find(w => w.id === input.workItemId);
        if (!item) throw new Error('Unknown blocked work item');
        holdWork(manifest, item, input.reasons, input.evidenceRefs);
    } else if (input.kind === 'operation-start') {
        const op = input.operation, item = manifest.workItems.find(w => w.id === op?.workItemId);
        if (!item || item.status !== 'running' || !['deployment', 'verification'].includes(item.night.phase) || op.phase !== item.night.phase || !text(op.id)) throw new Error('Managed operation requires a running matching work item');
        if (night.operations.some(o => o.id === op.id)) throw new Error('Operation ID already exists; reconcile before retry');
        const decision = gate(manifest, item);
        if (!decision.allowed) throw new Error('Night execution blocked: ' + decision.reasons.join(', '));
        if (op.environmentAlias !== night.preflight.environmentAlias || op.profileFingerprint && op.profileFingerprint !== night.preflight.profileFingerprint) throw new Error('Operation differs from preflight environment/profile');
        if (!Array.isArray(op.artifacts)) throw new Error('Operation artifacts required');
        const record = night.demands.find(d => d.id === item.night.demandId);
        const allowed = record.sourceScopes || [];
        if (op.phase === 'deployment' && !op.artifacts.length) throw new Error('Deployment artifacts required');
        for (const a of op.artifacts) {
            if (!path.isAbsolute(a.localPath || '') || !allowed.some(s => s.scopes.some(p => { const rel = path.relative(physical(s.repoRoot), physical(a.localPath)).replace(/\\/g, '/'); return rel && !rel.startsWith('../') && contains(p, rel); }))) throw new Error('Operation artifact outside frozen source scopes');
            const actual = crypto.createHash('sha256').update(fs.readFileSync(a.localPath)).digest('hex');
            if (actual !== a.sha256) throw new Error('Operation artifact changed');
        }
        if (night.operations.some(o => o.workItemId === item.id && o.status === 'running')) throw new Error('Unresolved operation; reconcile before retry');
        night.operations.push({ ...structuredClone(op), demandId: record.id, frozenVersion: currentSources(record).frozenVersion, ...(convergence.enabled(manifest) ? { dependencyToken: convergence.dependencyToken(manifest, record.id), deadlineAt: Math.min(Date.parse(night.limits.stopAt), Date.now() + convergence.budget(manifest, record).remainingMinutes * 60000) } : {}), status: 'running', startedAt: new Date().toISOString() });
    } else {
        const op = night.operations.find(o => o.id === input.operationId);
        if (!op) throw new Error('Unknown managed operation');
        const resultHash = hash(input.result);
        if (op.resultHash) { if (op.resultHash !== resultHash) throw new Error('Conflicting operation result'); return; }
        const record = night.demands.find(d => d.id === op.demandId);
        op.resultHash = resultHash; op.finishedAt = new Date().toISOString();
        op.status = ['verified', 'scope-passed'].includes(input.result?.status) && currentSources(record).frozenVersion === op.frozenVersion ? 'verified' : 'review-pending';
        if (convergence.enabled(manifest) && (op.dependencyToken !== convergence.dependencyToken(manifest, record.id) || convergence.dependencyReasons(manifest, record).length)) op.status = 'review-pending';
        if (op.phase === 'verification' && (!input.result?.results?.length || input.result.cleanup?.cleanupVerified !== true || input.result.results.some(r => r.status !== 'passed' || !record.testReceipts?.some(receipt => receipt.operationId === op.id && receipt.hash === hash(r))))) op.status = 'review-pending';
        op.evidenceRefs = input.evidenceRefs;
        if (op.phase === 'deployment') {
            record.deploymentReceipts ||= [];
            record.deploymentReceipts.push({ operationId: op.id, status: op.status, frozenVersion: op.frozenVersion, artifacts: op.artifacts, environmentAlias: op.environmentAlias, evidenceRefs: input.evidenceRefs });
        }
        if (input.result?.failureCategory === 'execution-unknown') record.results.unknownWrite = true;
        if (input.result?.cleanup?.cleanupVerified === false || input.result?.cleanup?.verified === false) record.resources.pending = true;
        if (op.status !== 'verified') {
            record.candidateReady = false; delete record.automatedResult;
            holdWork(manifest, manifest.workItems.find(w => w.id === op.workItemId), ['managed-operation-unverified'], input.evidenceRefs);
        }
    }
}

module.exports = { strict, hash, physical, contains, repositoryRoot, validateItems, requiredAuthorizations, grantCovers, readinessReasons, recordPreflight, rebindAuthorizations, trackWork, holdWork, timingStatus, assertStageComplete, operationRecord };
