'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizePolicy, assessDemand, summarizeHumanBudget, selectAuditSample } = require('./night-policy');
const { worktreeFingerprint } = require('../validation-evidence');
const { normalizeQuotaPolicy, assessQuota, sanitizeQuotaSnapshot } = require('./night-quota');
const { checkWorkspace } = require('../night-workspace');
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
        limits: { stopClaimingAt: limits.stopClaimingAt, stopPublishingAt: limits.stopPublishingAt, stopAt: limits.stopAt }, demands: [], shared: { timingSegments: [], reassessments: [] }, humanReassessments: [], audit: null };
}

function validateNightItems(manifest) {
    if (!manifest.night) return;
    if (manifest.night.workspaces) {
        const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
        for (const workspace of manifest.night.workspaces) {
            const owner = manifest.participants.find(item => item.id === workspace.ownerId);
            if (!owner) throw new Error('Workspace preflight owner is not a participant');
            if (owner.worktree?.mode === 'isolated' && (!path.isAbsolute(owner.worktree.ref || '') || !(workspace.plan.repositories || []).some(repo => samePath(repo.target, owner.worktree.ref)))) throw new Error('Participant worktree differs from workspace preflight plan');
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
        const root = owner?.worktree?.mode === 'isolated' ? owner.worktree.ref : manifest.repositoryRoot;
        if (!root || !path.isAbsolute(root)) throw new Error('Source owner repository required');
        for (const scope of item.writeScopes) {
            if (!(record.sourceScopes || []).some(source => path.resolve(source.repoRoot) === path.resolve(root) && source.scopes.some(parent => parent === '.' || scope === parent || scope.startsWith(`${parent}/`)))) throw new Error('Post assessment does not cover planned source writes');
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
    if (input.kind === 'quota') {
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
        if (!['internal-method', 'external-api', 'ui'].includes(result.acceptance?.level)) throw new Error('Real test acceptance level required');
        record.timingSegments.push(...result.timingSegments);
        record.testReceipts ||= [];
        record.testReceipts.push({ hash: receiptHash, evidenceRef: input.resultFile, status: result.status, caseId: result.caseId, scope: structuredClone(result.scope), level: result.acceptance.level });
        record.resources.pending = result.cleanup?.verified !== true || record.resources.pending;
        record.results.knownDefect = result.failureCategory === 'business' || record.results.knownDefect;
        record.results.unknownWrite = result.failureCategory === 'execution-unknown' || record.results.unknownWrite;
        // A case receipt is not whole-demand coverage. The independent reviewer
        // binds the aggregate result only after checking every minimum check.
        if (!(result.status === 'passed' && result.cleanup?.verified === true && result.assertions?.length && result.assertions.every(a => a.passed === true && a.evidenceRefs?.length))) {
            delete record.automatedResult;
            record.candidateReady = false;
            record.failures.push({ category: result.failureCategory || 'evidence', evidenceFingerprint: input.failureEvidenceFingerprint || digest({ category: result.failureCategory, assertions: result.assertions, untested: result.untested }) });
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
        validateSourceCoverage(manifest, record);
        for (const key of ['timingSegments', 'failures', 'reassessments', 'testReceipts']) appendOnly(previous?.[key], record[key], `demand.${key}`, night.observedAt);
        if (record.assessment?.post) {
            if (!manifest.participants.some(p => p.id === record.assessment.post.reviewerId)) throw new Error('Unknown reviewer');
            if (!sourcesMatch(record)) throw new Error('Post assessment source fingerprint is stale');
        }
        if (record.candidateReady && (!assessDemand(record, 'post', night.policy).allowed || !nonempty(record.handoffRef) || !checksComplete(record))) throw new Error('Candidate requires current approved post review, completed minimum checks and handoff');
        if (record.candidateReady && !['static-review', 'manual'].includes(record.assessment.post.route)) {
            const result = record.automatedResult;
            if (result?.status !== 'passed' || result.level !== record.assessment.post.route || result.scopeFingerprint !== record.scopeFingerprint || result.frozenVersion !== record.frozenVersion || !nonempty(result.evidenceRef)) throw new Error('Runtime candidate requires matching automated result');
        }
        if (night.audit && record.candidateReady && record.assessment.post.route === 'static-review' && !night.audit.cohort.some(item => item.id === record.id && item.scopeFingerprint === record.scopeFingerprint && item.frozenVersion === record.frozenVersion)) throw new Error('Frozen audit cohort cannot gain or change static candidates');
        if (previous) night.demands[night.demands.indexOf(previous)] = structuredClone(record);
        else night.demands.push(structuredClone(record));
    } else throw new Error('Unknown night record kind');
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
        if (unsafe || active || (started && !allTerminal && !handedOff && !record?.blocked)) occupied.add(item.night.demandId);
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
    if (record.blocked === true) reasons.push('demand-blocked');
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
    return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], route: decision.route, ...(quota.enabled ? { quota } : {}) };
}

module.exports = { initializeNight, validateNightItems, updateNight, gateNight, currentSources, occupiedDemands, sharedMinutes, nightCompletionIssues };
