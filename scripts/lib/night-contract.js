'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const convergence = require('./night-convergence');
const integration = require('./night-integration');
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
    if (integration.enabled(manifest)) for (const id of ['client-lifecycle', 'client-stop', 'client-usage', 'automation-inventory']) required.add(id);
    if (item.night.phase === 'verification' && browserRequired(manifest, item)) {
        const owner = p.retainedOwners?.find(o => ownerMatches(manifest, item, o));
        if (p.schema === 'imedical-night-preflight/v2' && (!owner || at >= owner.deadlineAt || manifest.night.browserOwnerExits?.some(e => e.ownerRef === owner.ownerRef && e.workerRef === p.workerRef))) reasons.push('browser-owner-unavailable');
    }
    if (item.night.phase === 'verification') {
        for (const name of ['authentication', 'role', 'entry', 'exit']) required.add(name);
        if (item.night.effects === 'write') for (const name of ['fixture-authority', 'data-disposition']) required.add(name);
        const record = manifest.night.demands.find(d => d.id === item.night.demandId);
        if (item.night.route ? item.night.route === 'ui' : record?.assessment?.post?.route === 'ui' || record?.assessment?.post?.auditRoute === 'ui') for (const name of ['browser', 'viewport']) required.add(name);
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
    if (!text(receipt.environmentAlias) || !preflightResourcesVerified(receipt, manifest) || receipt.configurationFiles.some(f => !path.isAbsolute(f.path || '') || !/^[a-f0-9]{64}$/.test(f.sha256 || ''))) throw new Error('Invalid preflight environment/configuration/exit');
    if (manifest.workItems.some(w => w.night.phase === 'deployment' && w.status !== 'skipped') && !text(receipt.deploymentConfigFingerprint)) throw new Error('Deployment configuration fingerprint required');
    const previous = manifest.night.preflight;
    const incoming = receipt.retainedOwners || [];
    if ((previous?.retainedOwners || []).some(owner => !ownerExited(manifest, owner.ownerRef, previous.workerRef) && (receipt.workerRef !== previous.workerRef || receipt.workerPid !== previous.workerPid || !incoming.some(next => hash(next) === hash(owner))))) throw new Error('Previous browser owners must exit before replacing preflight');
    if (manifest.night.startedAt && (!previous || hash(receipt.authorizations) !== hash(previous.authorizations))) throw new Error('Running night cannot acquire or widen authorizations');
    manifest.night.preflight = structuredClone(receipt);
    if (receipt.schema === 'imedical-night-preflight/v2') {
        manifest.night.browserOwners ||= [];
        for (const owner of receipt.retainedOwners) if (!manifest.night.browserOwners.some(old => old.ownerRef === owner.ownerRef && old.workerRef === receipt.workerRef)) manifest.night.browserOwners.push({ ...structuredClone(owner), workerRef: receipt.workerRef, workerPid: receipt.workerPid });
    }
    manifest.night.preflight.sourceScopes = manifest.night.startedAt && previous?.sourceScopes || manifest.workItems.filter(w => w.writeScopes.length).map(w => ({ repoRoot: w.repositoryRoot, paths: w.writeScopes }));
    manifest.night.preflight.planHash = manifest.orchestration.planHash;
    const active = manifest.workItems.filter(w => w.status !== 'skipped' && w.night.phase !== 'cleanup');
    const issues = [...new Set(active.flatMap(w => readinessReasons(manifest, w)))];
    manifest.night.preflight.state = issues.length ? 'blocked' : 'ready';
    manifest.night.preflight.issues = issues;
    if (!issues.length) rebindAuthorizations(manifest);
}

function preflightResourcesVerified(receipt, manifest) {
    if (receipt.schema !== 'imedical-night-preflight/v2') return receipt.cleanupVerified === true;
    const d = receipt.resourceDisposition, owners = receipt.retainedOwners;
    if (!d || d.temporaryResourcesExited !== true || d.retainedOwnersControllable !== true || d.pendingOperations !== 0 || !Array.isArray(owners) || d.retainedOwnerCount !== owners.length) return false;
    if (!owners.length) return receipt.cleanupVerified === true;
    if (receipt.cleanupVerified !== false || !text(receipt.workerRef) || !Number.isSafeInteger(receipt.workerPid) || receipt.workerPid <= 0) return false;
    return new Set(owners.map(o => o.ownerRef)).size === owners.length && owners.every(o => /^[a-f0-9]{64}$/.test(o.ownerRef || '') && /^[a-f0-9]{64}$/.test(o.identityReference || '') && /^[a-f0-9]{64}$/.test(o.configurationFingerprint || '') && path.isAbsolute(o.projectRoot || '') && o.environmentAlias === receipt.environmentAlias && text(o.role) && Number.isFinite(o.deadlineAt) && o.deadlineAt > Date.now() && o.deadlineAt <= Date.parse(manifest.night.limits.stopAt) && manifest.night.workspaces?.some(w => path.resolve(w.plan.workspaceRoot) === path.resolve(o.projectRoot)));
}

function browserOwnerExit(manifest, input) {
    const receipt = input.receipt, owners = registeredOwners(manifest);
    if (receipt?.schema !== 'imedical-browser-owner-exit/v1' || !owners.some(o => o.ownerRef === receipt.ownerRef && o.workerRef === receipt.workerRef && o.workerPid === receipt.workerPid) || typeof receipt.cleanupVerified !== 'boolean' || !Number.isSafeInteger(receipt.pendingOperations) || receipt.pendingOperations < 0 || receipt.cleanupVerified && receipt.pendingOperations !== 0 || !path.isAbsolute(receipt.evidenceRef || '') || !input.evidenceRefs?.includes(receipt.evidenceRef) || !Number.isFinite(Date.parse(receipt.checkedAt)) || Date.parse(receipt.checkedAt) > Date.now()) throw new Error('Invalid browser owner exit receipt');
    const actual = JSON.parse(fs.readFileSync(receipt.evidenceRef, 'utf8'));
    if (hash(actual) !== hash(receipt)) throw new Error('Browser owner exit evidence differs');
    manifest.night.browserOwnerExits ||= [];
    const old = manifest.night.browserOwnerExits.filter(r => r.ownerRef === receipt.ownerRef && r.workerRef === receipt.workerRef);
    if (old.some(r => hash(r) === hash(receipt))) return;
    if (old.some(r => r.cleanupVerified || Date.parse(r.checkedAt) > Date.parse(receipt.checkedAt))) throw new Error('Conflicting browser owner exit');
    manifest.night.browserOwnerExits.push(structuredClone(receipt));
}

function retainedOwnerIssues(manifest) {
    return registeredOwners(manifest).filter(o => !ownerExited(manifest, o.ownerRef, o.workerRef)).map(() => 'browser-owner-exit-pending');
}
function registeredOwners(manifest) {
    const p = manifest.night?.preflight, owners = [...(manifest.night?.browserOwners || [])];
    for (const owner of p?.retainedOwners || []) if (!owners.some(o => o.ownerRef === owner.ownerRef && o.workerRef === p.workerRef)) owners.push({ ...owner, workerRef: p.workerRef, workerPid: p.workerPid });
    return owners;
}
function ownerExited(manifest, ownerRef, workerRef) { return manifest.night.browserOwnerExits?.some(e => e.ownerRef === ownerRef && e.workerRef === workerRef && e.cleanupVerified && e.pendingOperations === 0); }
function browserRequired(manifest, item) {
    const route = manifest.night.demands.find(d => d.id === item.night.demandId)?.assessment?.post;
    return item.night.authentication?.mode === 'browser-session' || item.night.authentication === 'browser-session' || (item.night.route ? item.night.route === 'ui' : route?.route === 'ui' || route?.auditRoute === 'ui');
}
function ownerMatches(manifest, item, owner) {
    const authentication = item.night.authentication;
    const expectedIdentity = authentication?.identityReference || (authentication?.identity === undefined ? null : hash(authentication.identity));
    const expectedConfiguration = authentication?.configurationFingerprint;
    const expectedMode = typeof authentication === 'string' ? authentication : authentication?.mode;
    const workspaceRoot = manifest.night.workspaces?.find(w => w.ownerId === item.ownerId)?.plan.workspaceRoot || item.repositoryRoot;
    try { return physical(owner.projectRoot) === physical(workspaceRoot) && item.night.role === owner.role && item.night.environmentAlias === owner.environmentAlias && (!expectedMode || expectedMode === owner.authenticationMode) && (!expectedIdentity || expectedIdentity === owner.identityReference) && (!expectedConfiguration || expectedConfiguration === owner.configurationFingerprint); }
    catch { return false; }
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
            const frozen = record.sourceSnapshot?.files.find(f => physical(path.join(record.sourceSnapshot.root, f.artifact)) === physical(a.localPath) || physical(path.join(f.repoRoot, f.relative)) === physical(a.localPath));
            if (!path.isAbsolute(a.localPath || '') || (!frozen && !allowed.some(s => s.scopes.some(p => { const rel = path.relative(physical(s.repoRoot), physical(a.localPath)).replace(/\\/g, '/'); return rel && !rel.startsWith('../') && contains(p, rel); })))) throw new Error('Operation artifact outside frozen source scopes');
            const actual = crypto.createHash('sha256').update(fs.readFileSync(a.localPath)).digest('hex');
            if (actual !== a.sha256 || record.sourceSnapshot && (!frozen || actual !== frozen.sha256)) throw new Error('Operation artifact changed from frozen version');
        }
        if (night.operations.some(o => o.workItemId === item.id && o.status === 'running')) throw new Error('Unresolved operation; reconcile before retry');
        const publication = integration.publicationReasons(manifest, item, op.artifacts);
        if (publication.length) throw new Error(publication.join(', '));
        const deadlineAt = Math.min(Date.parse(night.limits.stopAt), ...(integration.enabled(manifest) ? [Date.parse(night.weeklyQuota?.recordedAt || manifest.createdAt) + manifest.executionPlan.budget.timeMinutes * 60000] : []), ...(convergence.enabled(manifest) ? [Date.now() + convergence.budget(manifest, record).remainingMinutes * 60000] : []));
        night.operations.push({ ...structuredClone(op), ...(integration.enabled(manifest) && op.phase === 'deployment' ? { targetKeys: integration.targetsFor(manifest, item, op.artifacts) } : {}), demandId: record.id, frozenVersion: currentSources(record).frozenVersion, ...(convergence.enabled(manifest) ? { dependencyToken: convergence.dependencyToken(manifest, record.id) } : {}), ...(integration.enabled(manifest) || convergence.enabled(manifest) ? { deadlineAt } : {}), status: 'running', startedAt: new Date().toISOString() });
    } else {
        const op = night.operations.find(o => o.id === input.operationId);
        if (!op) throw new Error('Unknown managed operation');
        const resultHash = hash(input.result);
        if (op.resultHash) { if (op.resultHash !== resultHash) throw new Error('Conflicting operation result'); return; }
        const record = night.demands.find(d => d.id === op.demandId);
        op.resultHash = resultHash; op.finishedAt = new Date().toISOString();
        op.status = ['verified', 'scope-passed'].includes(input.result?.status) && currentSources(record).frozenVersion === op.frozenVersion ? 'verified' : 'review-pending';
        if (convergence.enabled(manifest) && (op.dependencyToken !== convergence.dependencyToken(manifest, record.id) || convergence.dependencyReasons(manifest, record).length)) op.status = 'review-pending';
        const cleanup = input.result?.cleanup, p = manifest.night.preflight;
        const item = manifest.workItems.find(work => work.id === op.workItemId);
        const ownedCases = input.result?.results?.filter(result => result.acceptance?.authenticationMode && result.acceptance.authenticationMode !== 'none' || result.acceptance?.level === 'ui') || [];
        const needsOwner = p?.schema === 'imedical-night-preflight/v2' && (browserRequired(manifest, item) || ownedCases.length > 0);
        const ownerBound = p?.schema === 'imedical-night-preflight/v2' && cleanup?.workerRef === p.workerRef && cleanup.workerPid === p.workerPid && Array.isArray(cleanup?.ownerRefs) && cleanup.ownerRefs.length > 0 && new Set(cleanup.ownerRefs).size === cleanup.ownerRefs.length && cleanup.ownerRefs.every(ref => p.retainedOwners.some(owner => owner.ownerRef === ref && !manifest.night.browserOwnerExits?.some(e => e.ownerRef === ref && e.workerRef === p.workerRef))) && ownedCases.every(result => cleanup.ownerRefs.includes(result.acceptance.ownerRef) && p.retainedOwners.some(owner => owner.ownerRef === result.acceptance.ownerRef && ownerMatches(manifest, item, owner) && Date.now() < owner.deadlineAt));
        const retained = cleanup?.temporaryResourcesExited === true && cleanup.retainedOwnersControllable === true && cleanup.pendingOperations === 0 && ownerBound;
        const caseClean = needsOwner ? retained && ownedCases.length === input.result.results.length : cleanup?.cleanupVerified === true || retained;
        if (op.phase === 'verification' && (!input.result?.results?.length || !caseClean || input.result.results.some(r => r.status !== 'passed' || !record.testReceipts?.some(receipt => receipt.operationId === op.id && receipt.hash === hash(r))))) op.status = 'review-pending';
        op.evidenceRefs = input.evidenceRefs;
        if (op.phase === 'deployment') {
            record.deploymentReceipts ||= [];
            record.deploymentReceipts.push({ operationId: op.id, status: op.status, frozenVersion: op.frozenVersion, artifacts: op.artifacts, environmentAlias: op.environmentAlias, evidenceRefs: input.evidenceRefs });
        }
        if (input.result?.failureCategory === 'execution-unknown') record.results.unknownWrite = true;
        if (input.result?.cleanup && !caseClean || input.result?.cleanup?.verified === false) record.resources.pending = true;
        if (op.status !== 'verified') {
            record.candidateReady = false; delete record.automatedResult;
            holdWork(manifest, manifest.workItems.find(w => w.id === op.workItemId), ['managed-operation-unverified'], input.evidenceRefs);
        }
    }
}

module.exports = { strict, hash, physical, contains, repositoryRoot, validateItems, requiredAuthorizations, grantCovers, readinessReasons, recordPreflight, preflightResourcesVerified, browserOwnerExit, retainedOwnerIssues, rebindAuthorizations, trackWork, holdWork, timingStatus, assertStageComplete, operationRecord };
