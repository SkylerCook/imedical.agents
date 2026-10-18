'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizePolicy, assessDemand, summarizeHumanBudget, selectAuditSample } = require('./night-policy');
const { worktreeFingerprint } = require('../validation-evidence');
const { normalizeQuotaPolicy, assessQuota, sanitizeQuotaSnapshot } = require('./night-quota');
const { checkWorkspace } = require('../night-workspace');
const contract = require('./night-contract');
const convergence = require('./night-convergence');
const PHASES = ['implementation', 'review', 'deployment', 'verification', 'cleanup'];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function initializeNight(plan, planFile) {
    if (!plan.nightBatchReference) return null;
    const file = path.resolve(path.dirname(planFile), plan.nightBatchReference);
    const batch = read(file);
    if (!batch.decisionPolicyReference) return null;
    const policy = normalizePolicy(read(path.resolve(path.dirname(file), batch.decisionPolicyReference)));
    if (policy.convergence && batch.policy?.interactionMode !== 'preflight-only') throw new Error('Night convergence requires schema 2.1 preflight-only');
    if (!nonempty(batch.batchId)) throw new Error('Night batchId required');
    const limits = batch.policy || {};
    const dates = ['stopClaimingAt', 'stopPublishingAt', 'stopAt'].map(key => {
        if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(limits[key] || '') || !Number.isFinite(Date.parse(limits[key]))) throw new Error(`Night ${key} requires zoned time`);
        return Date.parse(limits[key]);
    });
    if (dates[0] > dates[1] || dates[1] > dates[2]) throw new Error('Invalid night deadlines');
    if (limits.maxInFlight !== undefined && limits.maxInFlight !== policy.maxInFlight) throw new Error('Batch and decision policy maxInFlight differ');
    let workspaces;
    if (batch.workspacePreflightReferences !== undefined && batch.workspacePreflightReferences !== null) {
        if (!Array.isArray(batch.workspacePreflightReferences) || !batch.workspacePreflightReferences.length) throw new Error('Workspace preflight references required');
        const seen = new Set();
        workspaces = batch.workspacePreflightReferences.map(entry => {
            if (!nonempty(entry.ownerId) || seen.has(entry.ownerId) || !nonempty(entry.planReference)) throw new Error('Unique workspace owner and plan reference required');
            seen.add(entry.ownerId);
            const planFile = path.resolve(path.dirname(file), entry.planReference);
            const workspacePlan = read(planFile);
            if ((workspacePlan.roleOwnerId || workspacePlan.request?.roleOwnerId) !== entry.ownerId) throw new Error('Workspace plan owner mismatch');
            return { ownerId: entry.ownerId, planReference: planFile, plan: workspacePlan };
        });
    }
    return { schema: 'imedical-night-decisions/v1', batchId: batch.batchId, policy,
        ...(batch.quotaPolicy ? { quotaPolicy: normalizeQuotaPolicy(batch.quotaPolicy), quotaSnapshot: null } : {}),
        ...(workspaces ? { workspaces } : {}),
        ...(batch.policy?.interactionMode === 'preflight-only' ? { interactionMode: 'preflight-only', authorizationReferences: batch.authorizationReferences || {}, requiredCapabilities: batch.requiredCapabilities || [], runReference: batch.runReference ? path.resolve(path.dirname(file), batch.runReference) : null } : {}),
        limits: { stopClaimingAt: limits.stopClaimingAt, stopPublishingAt: limits.stopPublishingAt, stopAt: limits.stopAt }, demands: [], shared: { timingSegments: [], reassessments: [] }, humanReassessments: [], audit: null };
}

function validateNightItems(manifest) {
    if (!manifest.night) return;
    contract.validateItems(manifest);
    if (manifest.night.workspaces) {
        const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
        for (const workspace of manifest.night.workspaces) {
            const owner = manifest.participants.find(item => item.id === workspace.ownerId);
            if (!owner) throw new Error('Workspace preflight owner is not a participant');
            if (!contract.strict(manifest) && owner.worktree?.mode === 'isolated' && (!path.isAbsolute(owner.worktree.ref || '') || !(workspace.plan.repositories || []).some(repo => samePath(repo.target, owner.worktree.ref)))) throw new Error('Participant worktree differs from workspace preflight plan');
        }
    }
    for (const item of manifest.workItems) {
        if (!nonempty(item.night?.demandId) || !PHASES.includes(item.night?.phase)) throw new Error(`Night mapping required: ${item.id}`);
        if (item.night.modelTier !== undefined && !['fast', 'balanced', 'strong', 'deep-reasoning'].includes(item.night.modelTier)) throw new Error('Invalid abstract model tier');
        if (item.night.modelMappingReference !== undefined && (!item.night.modelTier || !nonempty(item.night.modelMappingReference))) throw new Error('Model mapping requires tier and reference');
        if (item.authorizationCategory === 'deploy' && item.night.phase !== 'deployment') throw new Error('Deploy authorization requires deployment phase');
        if (item.night.phase === 'cleanup' && (item.kind !== 'cleanup' || item.writeScopes.length)) throw new Error('Cleanup requires cleanup kind and no business source write scopes');
    }
}

function validateSourceCoverage(manifest, record) {
    const work = manifest.workItems.filter(item => item.night.demandId === record.id);
    const implementers = work.filter(item => item.night.phase === 'implementation');
    if (!implementers.length || implementers.some(item => item.ownerId !== record.implementationOwnerId)) throw new Error('Implementation owner does not match planned work');
    if (!record.assessment?.post) return;
    for (const item of work.filter(item => item.writeScopes.length)) {
        const owner = manifest.participants.find(p => p.id === item.ownerId);
        const root = contract.repositoryRoot(manifest, item);
        if (!root || !path.isAbsolute(root)) throw new Error('Source owner repository required');
        for (const scope of item.writeScopes) {
            if (!(record.sourceScopes || []).some(source => (contract.strict(manifest) ? contract.physical(source.repoRoot) === contract.physical(root) : path.resolve(source.repoRoot) === path.resolve(root)) && source.scopes.some(parent => contract.strict(manifest) ? contract.contains(parent, scope) : parent === '.' || scope === parent || scope.startsWith(`${parent}/`)))) throw new Error('Post assessment does not cover planned source writes');
        }
    }
}

function checksComplete(record) {
    const post = record.assessment?.post;
    if (!post || !Array.isArray(record.checks)) return false;
    return post.minimumChecks.every(id => record.checks.some(check => check.id === id && check.status === 'passed' && check.scopeFingerprint === record.scopeFingerprint && check.frozenVersion === record.frozenVersion && check.evidenceRefs?.length));
}

function currentSources(record) {
    if (!Array.isArray(record.sourceScopes) || !record.sourceScopes.length) throw new Error('Post review requires sourceScopes');
    const sources = record.sourceScopes.map(source => {
        if (!path.isAbsolute(source.repoRoot || '') || !Array.isArray(source.scopes) || !source.scopes.length) throw new Error('Absolute source repo and scopes required');
        const value = worktreeFingerprint(source.repoRoot, source.scopes);
        return { repoRoot: path.resolve(source.repoRoot), scopes: value.scopes, fingerprint: value.fingerprint, head: value.head };
    }).sort((a, b) => a.repoRoot.localeCompare(b.repoRoot));
    const scopeFingerprint = digest(sources.map(({ repoRoot, scopes, fingerprint }) => ({ repoRoot, scopes, fingerprint })));
    return { scopeFingerprint, frozenVersion: `content:${scopeFingerprint}`, sources };
}

function appendOnly(previous = [], incoming = [], label, observedAt) {
    if (!Array.isArray(incoming) || incoming.length < previous.length) throw new Error(`${label} cannot reset`);
    previous.forEach((entry, index) => {
        const next = incoming[index];
        // An open segment may be closed once; its start and all other attributes stay fixed.
        const closes = label.endsWith('timingSegments') && entry.endedAt === undefined && next?.endedAt !== undefined;
        if (closes && observedAt && Date.parse(next.endedAt) < Date.parse(observedAt)) throw new Error('Cannot backdate an observed open segment');
        if (JSON.stringify(entry) !== JSON.stringify(closes ? Object.fromEntries(Object.entries(next).filter(([key]) => key !== 'endedAt')) : next)) throw new Error(`${label} history changed`);
    });
}

function requireEvidence(input) {
    if (!nonempty(input.rationale) || !Array.isArray(input.evidenceRefs) || !input.evidenceRefs.length || !input.evidenceRefs.every(nonempty)) throw new Error('Decision rationale and evidenceRefs required');
}

function updateNight(manifest, input, actor) {
    if (!manifest.night) throw new Error('Night decision policy is not enabled');
    if (actor !== manifest.coordinatorId) throw new Error('Night records require coordinator actor');
    requireEvidence(input);
    const night = manifest.night;
    if (['problem', 'attempt-start', 'attempt-result', 'dependency-bind'].includes(input.kind)) {
        const changed = convergence.recordEvent(manifest, input);
        if (changed && ['dependency-bind', 'attempt-start'].includes(input.kind)) {
            const phases = input.kind === 'dependency-bind' ? ['review', 'verification'] : ['implementation'];
            for (const item of manifest.workItems.filter(w => w.night.demandId === input.demandId && phases.includes(w.night.phase) && ['completed', 'blocked', 'failed'].includes(w.status))) item.status = 'pending';
        }
    } else if (input.kind === 'preflight-start') {
        if (!contract.strict(manifest)) throw new Error('Managed preflight requires schema 2.1');
        if (night.preflight) night.preflight.revoked = true;
        night.preflightAttempt = { status: 'running', startedAt: new Date().toISOString(), evidenceRefs: input.evidenceRefs };
    } else if (input.kind === 'preflight') {
        contract.recordPreflight(manifest, input.receipt);
        night.preflightAttempt = { ...night.preflightAttempt, status: night.preflight.state, finishedAt: new Date().toISOString(), evidenceRefs: input.evidenceRefs };
    } else if (['operation-start', 'operation-result', 'operation-blocked'].includes(input.kind)) {
        contract.operationRecord(manifest, input, currentSources, gateNight);
    } else if (input.kind === 'quota') {
        if (!night.quotaPolicy?.enabled) throw new Error('Quota monitoring is not enabled for this batch');
        const snapshot = sanitizeQuotaSnapshot(input.snapshot);
        if (Date.parse(snapshot.observedAt) > Date.now()) throw new Error('Quota snapshot cannot be from the future');
        if (night.quotaSnapshot && Date.parse(snapshot.observedAt) < Date.parse(night.quotaSnapshot.observedAt)) throw new Error('Quota snapshot cannot move backwards');
        night.quotaSnapshot = snapshot;
    } else if (input.kind === 'test-result') {
        const record = night.demands.find(item => item.id === input.id);
        if (!record || !path.isAbsolute(input.resultFile || '')) throw new Error('Known demand and absolute resultFile required');
        const result = read(input.resultFile);
        if (result.schema !== 'imedical-test-result/v1' || result.demandId !== record.id || !nonempty(result.caseId) || !result.scope || result.version !== record.frozenVersion || !sourcesMatch(record) || !Array.isArray(result.timingSegments)) throw new Error('Test result identity/version/timing mismatch');
        const receiptHash = digest(result);
        if ((record.testReceipts || []).some(receipt => receipt.hash === receiptHash)) return structuredClone(night);
        if (contract.strict(manifest)) {
            const op = night.operations?.find(o => o.id === result.binding?.operationId);
            if (!op || op.phase !== 'verification' || op.status !== 'running' || op.demandId !== record.id || result.binding.workItemId !== op.workItemId || op.frozenVersion !== result.version) throw new Error('Test result requires a matching managed verification operation');
            if (convergence.enabled(manifest) && (op.dependencyToken !== convergence.dependencyToken(manifest, record.id) || convergence.dependencyReasons(manifest, record).length)) throw new Error('Test dependency combination changed');
        }
        if (!['internal-method', 'external-api', 'ui'].includes(result.acceptance?.level)) throw new Error('Real test acceptance level required');
        record.timingSegments.push(...result.timingSegments.map(s => contract.strict(manifest) ? { ...s, granularity: 'detail', workItemId: result.binding.workItemId } : s));
        record.testReceipts ||= [];
        record.testReceipts.push({ hash: receiptHash, evidenceRef: input.resultFile, status: result.status, caseId: result.caseId, scope: structuredClone(result.scope), level: result.acceptance.level, frozenVersion: result.version, ...(result.binding ? { operationId: result.binding.operationId, workItemId: result.binding.workItemId } : {}) });
        if (convergence.enabled(manifest)) Object.assign(record.testReceipts.at(-1), { dependencyToken: convergence.dependencyToken(manifest, record.id), convergenceAttemptIds: convergence.problems(manifest, record.id).flatMap(p => p.attempts.filter(a => !a.result).map(a => a.attemptId)) });
        if (contract.strict(manifest) && result.dataDisposition?.verified !== true) record.resources.polluted = true;
        record.resources.pending = result.cleanup?.verified !== true || record.resources.pending;
        record.results.knownDefect = result.failureCategory === 'business' || record.results.knownDefect;
        record.results.unknownWrite = result.failureCategory === 'execution-unknown' || record.results.unknownWrite;
        // A case receipt is not whole-demand coverage. The independent reviewer
        // binds the aggregate result only after checking every minimum check.
        if (!(result.status === 'passed' && result.cleanup?.verified === true && result.assertions?.length && result.assertions.every(a => a.passed === true && a.evidenceRefs?.length))) {
            delete record.automatedResult;
            record.candidateReady = false;
            record.failures.push({ category: result.failureCategory || 'evidence', evidenceFingerprint: input.failureEvidenceFingerprint || digest({ category: result.failureCategory, assertions: result.assertions, untested: result.untested }) });
            convergence.observeFailure(manifest, record, result);
        }
    } else if (input.kind === 'shared') {
        for (const key of ['timingSegments', 'reassessments']) appendOnly(night.shared[key], input[key], `shared.${key}`, night.observedAt);
        if (input.reassessments.length > night.shared.reassessments.length && input.timingSegments.some(s => !s.endedAt)) throw new Error('Close shared timing before reassessment');
        night.shared = { timingSegments: input.timingSegments, reassessments: input.reassessments };
    } else if (input.kind === 'human-reassessment') {
        const summary = summarizeHumanBudget(night.demands, night.policy);
        night.humanReassessments.push({ summaryFingerprint: digest(summary), rationale: input.rationale, evidenceRefs: input.evidenceRefs });
    } else if (input.kind === 'audit-freeze') {
        if (night.audit) throw new Error('Audit cohort already frozen');
        const candidates = night.demands.filter(record => record.candidateReady && record.assessment?.post?.route === 'static-review');
        if (!candidates.length) throw new Error('No frozen static candidates');
        for (const record of candidates) if (!assessDemand(record, 'post', night.policy).allowed || !sourcesMatch(record)) throw new Error('Audit cohort includes ineligible candidate');
        night.audit = { cohort: candidates.map(({ id, scopeFingerprint, frozenVersion }) => ({ id, scopeFingerprint, frozenVersion })), selected: selectAuditSample(night.batchId, candidates, night.policy.auditSampleRate), results: [] };
    } else if (input.kind === 'audit-result') {
        if (!night.audit?.selected.includes(input.id) || !['passed', 'misclassified', 'unverified'].includes(input.status)) throw new Error('Invalid audit result');
        const frozen = night.audit.cohort.find(item => item.id === input.id);
        if (input.scopeFingerprint !== frozen.scopeFingerprint || input.frozenVersion !== frozen.frozenVersion) throw new Error('Audit version mismatch');
        const record = night.demands.find(item => item.id === input.id);
        if (!sourcesMatch(record) || record.scopeFingerprint !== frozen.scopeFingerprint || record.frozenVersion !== frozen.frozenVersion) throw new Error('Audit source changed');
        const previous = night.audit.results.find(item => item.id === input.id);
        if (previous && (previous.status !== input.status || JSON.stringify(previous.evidenceRefs) !== JSON.stringify(input.evidenceRefs))) throw new Error('Conflicting audit result; preserve original and investigate');
        if (previous) return structuredClone(night);
        night.audit.results.push({ id: input.id, status: input.status, scopeFingerprint: input.scopeFingerprint, frozenVersion: input.frozenVersion, evidenceRefs: input.evidenceRefs, rationale: input.rationale });
    } else if (input.kind === 'demand') {
        const record = input.record;
        if (!record || !manifest.workItems.some(item => item.night.demandId === record.id)) throw new Error('Unknown night demand');
        if (!manifest.participants.some(p => p.id === record.implementationOwnerId)) throw new Error('Unknown implementation owner');
        const previous = night.demands.find(item => item.id === record.id);
        if (convergence.enabled(manifest) && record.candidateReady) {
            if (convergence.problems(manifest, record.id).some(p => !p.resolved) || convergence.dependencyReasons(manifest, record, true).length) throw new Error('Candidate has unresolved problems or dependencies');
            if (convergence.bindings(manifest, record.id).length && !record.testReceipts?.some(r => r.status === 'passed' && r.frozenVersion === record.frozenVersion && r.dependencyToken === convergence.dependencyToken(manifest, record.id))) throw new Error('Candidate requires current dependency combination receipt');
        }
        validateSourceCoverage(manifest, record);
        for (const key of ['timingSegments', 'failures', 'reassessments', 'testReceipts', 'deploymentReceipts']) appendOnly(previous?.[key], record[key], `demand.${key}`, night.observedAt);
        if (record.assessment?.post) {
            if (!manifest.participants.some(p => p.id === record.assessment.post.reviewerId)) throw new Error('Unknown reviewer');
            if (!sourcesMatch(record)) throw new Error('Post assessment source fingerprint is stale');
        }
        if (contract.strict(manifest) && record.candidateReady && !['static-review', 'manual'].includes(record.assessment?.post?.route) && !record.testReceipts?.some(r => r.status === 'passed' && r.frozenVersion === record.frozenVersion)) throw new Error('Runtime candidate requires consumed current test receipts');
        if (record.candidateReady && (!assessDemand(record, 'post', night.policy).allowed || !nonempty(record.handoffRef) || !checksComplete(record))) throw new Error('Candidate requires current approved post review, completed minimum checks and handoff');
        if (record.candidateReady && !['static-review', 'manual'].includes(record.assessment.post.route)) {
            const result = record.automatedResult;
            if (result?.status !== 'passed' || result.level !== record.assessment.post.route || result.scopeFingerprint !== record.scopeFingerprint || result.frozenVersion !== record.frozenVersion || !nonempty(result.evidenceRef)) throw new Error('Runtime candidate requires matching automated result');
        }
        if (night.audit && record.candidateReady && record.assessment.post.route === 'static-review' && !night.audit.cohort.some(item => item.id === record.id && item.scopeFingerprint === record.scopeFingerprint && item.frozenVersion === record.frozenVersion)) throw new Error('Frozen audit cohort cannot gain or change static candidates');
        if (contract.strict(manifest) && previous?.frozenVersion && previous.frozenVersion !== record.frozenVersion) {
            for (const item of manifest.workItems.filter(w => w.night.demandId === record.id && ['review', 'deployment', 'verification'].includes(w.night.phase) && w.status !== 'skipped')) {
                const active = night.operations?.some(op => op.workItemId === item.id && op.status === 'running');
                contract.trackWork(manifest, item, 'blocked');
                item.status = active ? 'blocked' : 'pending';
                if (active) record.resources.pending = true;
            }
        }
        if (previous) night.demands[night.demands.indexOf(previous)] = structuredClone(record);
        else night.demands.push(structuredClone(record));
    } else throw new Error('Unknown night record kind');
    if (convergence.enabled(manifest)) for (const record of night.demands) {
        const reasons = convergence.dependencyReasons(manifest, record, true);
        if (reasons.length) {
            record.candidateReady = false; delete record.automatedResult;
            if (reasons.some(r => r !== 'dependency-verification-pending') && !record.dependencyIssues?.some(r => r !== 'dependency-verification-pending')) {
                for (const item of manifest.workItems.filter(w => w.night.demandId === record.id && ['review', 'verification'].includes(w.night.phase) && w.status !== 'skipped')) {
                    const active = night.operations?.some(op => op.workItemId === item.id && op.status === 'running');
                    contract.trackWork(manifest, item, 'blocked');
                    item.status = active ? 'blocked' : 'pending';
                    if (active) record.resources.pending = true;
                }
            }
            record.dependencyIssues = reasons;
        } else delete record.dependencyIssues;
    }
    night.observedAt = new Date().toISOString();
    return structuredClone(night);
}

function nightCompletionIssues(manifest) {
    if (!manifest.night) return [];
    const night = manifest.night, issues = [];
    const candidates = night.demands.filter(record => record.candidateReady && record.assessment.post.route === 'static-review');
    if (candidates.length && !night.audit) issues.push('night static cohort not sampled');
    for (const id of new Set(manifest.workItems.map(item => item.night?.demandId))) {
        const record = night.demands.find(r => r.id === id);
        if (!record || record.results?.unknownWrite !== false || record.results?.knownDefect !== false || record.resources?.pending !== false || record.resources?.polluted !== false) issues.push(`night demand unresolved: ${id}`);
    }
    for (const id of night.audit?.selected || []) {
        const record = night.demands.find(r => r.id === id), frozen = night.audit.cohort.find(r => r.id === id);
        if (!night.audit.results.some(result => result.id === id && result.status === 'passed') || !sourcesMatch(record) || record.scopeFingerprint !== frozen.scopeFingerprint || record.frozenVersion !== frozen.frozenVersion) issues.push(`night audit not passed or stale: ${id}`);
    }
    for (const record of night.demands) if (record.candidateReady && (!checksComplete(record) || !sourcesMatch(record))) issues.push(`night candidate evidence stale: ${record.id}`);
    if (contract.strict(manifest)) for (const record of night.demands) if (contract.timingStatus(manifest, record) === 'incomplete') issues.push(`night timing incomplete: ${record.id}`);
    if (convergence.enabled(manifest)) for (const record of night.demands) {
        if (convergence.problems(manifest, record.id).some(p => !p.resolved)) issues.push(`night problem unresolved: ${record.id}`);
        if (convergence.dependencyReasons(manifest, record, true).length || convergence.bindings(manifest, record.id).length && !record.testReceipts?.some(r => r.status === 'passed' && r.frozenVersion === record.frozenVersion && r.dependencyToken === convergence.dependencyToken(manifest, record.id))) issues.push(`night dependency evidence stale: ${record.id}`);
    }
    return issues;
}

function sourcesMatch(record) {
    try { const actual = currentSources(record); return actual.scopeFingerprint === record.scopeFingerprint && actual.frozenVersion === record.frozenVersion; } catch { return false; }
}

function occupiedDemands(manifest) {
    const occupied = new Set();
    for (const item of manifest.workItems) {
        const actions = manifest.actions.filter(a => a.workItemId === item.id && !['failed', 'cancelled'].includes(a.status));
        const record = manifest.night.demands.find(r => r.id === item.night.demandId);
        const unsafe = record?.results?.unknownWrite || record?.resources?.pending || record?.resources?.polluted;
        const active = item.status === 'running' || actions.some(a => a.status === 'pending' && a.type !== 'request-authorization');
        const started = actions.some(a => a.type !== 'request-authorization') || item.status === 'completed';
        const allTerminal = manifest.workItems.filter(w => w.night.demandId === item.night.demandId).every(w => ['completed', 'skipped'].includes(w.status));
        const handedOff = record?.candidateReady && record.handoffRef && !unsafe;
        const stopped = record && convergence.enabled(manifest) && convergence.hardReasons(manifest, record, 'implementation').some(r => ['total-budget-exhausted', 'problem-attempts-exhausted'].includes(r));
        if (unsafe || active || (started && !allTerminal && !handedOff && !record?.blocked && !stopped)) occupied.add(item.night.demandId);
    }
    return occupied;
}

function sharedMinutes(night, now) {
    let total = 0;
    for (const segment of night.shared.timingSegments) {
        const start = Date.parse(segment.startedAt), end = segment.endedAt === undefined ? now : Date.parse(segment.endedAt);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end > now) throw new Error('Invalid shared time');
        total += (end - start) / 60000;
    }
    return total;
}

function gateNight(manifest, item, now = Date.now()) {
    if (!manifest.night) return { allowed: true, reasons: [] };
    validateNightItems(manifest);
    const night = manifest.night, { phase, demandId } = item.night;
    if (phase === 'cleanup') return { allowed: true, reasons: [] };
    const reasons = [];
    const record = night.demands.find(r => r.id === demandId);
    if (!record) return { allowed: false, reasons: ['night-assessment-missing'] };
    reasons.push(...convergence.hardReasons(manifest, record, phase, now));
    if (!['implementation', 'review'].includes(phase)) reasons.push(...convergence.dependencyReasons(manifest, record));
    if (record.blocked === true) reasons.push('demand-blocked');
    if (contract.strict(manifest)) {
        if (!night.startedAt && night.preflight?.state !== 'ready') reasons.push('night-preflight-not-ready');
        if (!night.startedAt && manifest.workItems.some(w => w.status !== 'skipped' && contract.readinessReasons(manifest, w, now).length)) reasons.push('night-startup-preflight-incomplete');
        reasons.push(...contract.readinessReasons(manifest, item, now));
        if (contract.timingStatus(manifest, record) === 'incomplete') reasons.push('timing-incomplete');
    }
    if (night.workspaces) {
        const workspace = night.workspaces.find(entry => entry.ownerId === item.ownerId);
        if (!workspace || !checkWorkspace(workspace.plan).ok) reasons.push('night-workspace-preflight-failed');
    }
    const quota = assessQuota(night.quotaSnapshot, night.quotaPolicy, now);
    const actuallyStarted = manifest.workItems.some(work => work.night.demandId === demandId &&
        (['running', 'completed'].includes(work.status) || work.attempts?.length > 0));
    if (quota.mode === 'unknown' || quota.mode === 'closeout' || (quota.mode === 'drain' && !actuallyStarted)) reasons.push(...quota.reasons);
    if (now >= Date.parse(night.limits.stopAt)) reasons.push('night-stopped');
    if (phase === 'deployment' && now >= Date.parse(night.limits.stopPublishingAt)) reasons.push('publishing-stopped');
    const occupied = occupiedDemands(manifest);
    if (!actuallyStarted && now >= Date.parse(night.limits.stopClaimingAt)) reasons.push('claiming-stopped');
    if (!occupied.has(demandId) && occupied.size >= night.policy.maxInFlight) reasons.push('night-capacity');
    const stage = ['implementation', 'review'].includes(phase) ? 'pre' : 'post';
    const repair = phase === 'implementation' && nonempty(record.repairEvidenceRef);
    const decision = assessDemand(repair ? { ...record, results: { ...record.results, knownDefect: false } } : record, stage, night.policy, now);
    reasons.push(...decision.reasons);
    try { validateSourceCoverage(manifest, record); } catch { reasons.push('source-or-owner-scope-mismatch'); }
    if (stage === 'post' && !sourcesMatch(record)) reasons.push('source-fingerprint-changed');
    if (phase === 'verification' && ['static-review', 'manual'].includes(decision.route)) {
        const selected = night.audit?.selected.includes(record.id);
        const frozen = night.audit?.cohort.find(r => r.id === record.id);
        if (selected && frozen.scopeFingerprint === record.scopeFingerprint && frozen.frozenVersion === record.frozenVersion && ['internal-method', 'external-api', 'ui'].includes(record.assessment.post.auditRoute)) {
            const sampled = assessDemand({ ...record, assessment: { ...record.assessment, post: { ...record.assessment.post, route: record.assessment.post.auditRoute } } }, 'post', night.policy, now);
            reasons.push(...sampled.reasons);
            decision.route = sampled.route;
        }
        else reasons.push('no-runtime-route');
    }
    if (phase === 'verification') {
        const used = sharedMinutes(night, now);
        if (used >= night.policy.sharedPreparationBudgetMinutes && !night.shared.reassessments.some(r => r.usedMinutes === used && nonempty(r.rationale) && r.evidenceRefs?.length)) reasons.push('shared-preparation-budget-exhausted');
    }
    const summary = summarizeHumanBudget(night.demands, night.policy);
    if (summary.estimatedMinutes > summary.eligibleCount * night.policy.humanEstimateMinutes && !night.humanReassessments.some(r => r.summaryFingerprint === digest(summary))) reasons.push('human-budget-reassessment-required');
    if (decision.route === 'static-review' && night.audit?.results.some(r => r.status === 'misclassified')) reasons.push('static-policy-suspended');
    return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], route: decision.route, ...(convergence.enabled(manifest) ? { budget: convergence.budget(manifest, record, now), problems: convergence.problems(manifest, record.id), dependencyIssues: convergence.dependencyReasons(manifest, record, true) } : {}), ...(quota.enabled ? { quota } : {}) };
}

module.exports = { initializeNight, validateNightItems, updateNight, gateNight, currentSources, occupiedDemands, sharedMinutes, nightCompletionIssues };
