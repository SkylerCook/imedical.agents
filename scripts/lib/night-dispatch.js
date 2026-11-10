'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizePolicy, assessDemand, summarizeHumanBudget, selectAuditSample } = require('./night-policy');
const { worktreeFingerprint } = require('../validation-evidence');
const { normalizeQuotaPolicy, assessQuota, sanitizeQuotaSnapshot, advanceWeeklyQuota } = require('./night-quota');
const { validateExecutionPlan, buildActionContext, contextSnapshotMatches } = require('./night-plan');
const integration = require('./night-integration');
const { checkWorkspace } = require('../night-workspace');
const contract = require('./night-contract');
const convergence = require('./night-convergence');
const PHASES = ['implementation', 'review', 'deployment', 'verification', 'cleanup'];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function requeueSourceStages(manifest, record) {
    for (const action of manifest.actions.filter(a => a.status === 'pending' && !a.result && manifest.workItems.find(w => w.id === a.workItemId)?.night.demandId === record.id)) action.status = 'cancelled';
    for (const item of manifest.workItems.filter(w => w.night.demandId === record.id && ['review', 'deployment', 'verification'].includes(w.night.phase) && w.status !== 'skipped')) {
        const active = manifest.night.operations?.some(op => op.workItemId === item.id && ['running', 'review-pending'].includes(op.status));
        contract.trackWork(manifest, item, 'blocked');
        item.status = active ? 'blocked' : 'pending';
        if (active) record.resources.pending = true;
    }
}

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
    let weeklyQuota;
    if (plan.executionPlan) {
        validateExecutionPlan(plan);
        if (policy.maxInFlight < 2) throw new Error('Execution PLAN requires maxInFlight >= 2');
        const weekly = plan.executionPlan.budget.weekly;
        weeklyQuota = read(path.resolve(path.dirname(planFile), weekly.baselineReference));
        if (weeklyQuota.schema !== 'night-weekly-quota/v1' || weeklyQuota.budgetId !== weekly.budgetId || weeklyQuota.budgetPercentPoints !== weekly.budgetPercentPoints || !Number.isFinite(Date.parse(weeklyQuota.recordedAt)) || Date.parse(weeklyQuota.recordedAt) > Date.now() || !nonempty(weeklyQuota.authorizationReference)) throw new Error('A persisted authorized weekly baseline must precede PLAN initialization');
        if (plan.executionPlan.capabilityProbe && Date.parse(weeklyQuota.recordedAt) > Date.parse(read(plan.executionPlan.capabilityProbe.reference).checkedAt)) throw new Error('Weekly baseline must include the initial capability probe and planning cost');
        if (batch.quotaPolicy?.weeklyBudgetPercentPoints !== weekly.budgetPercentPoints) throw new Error('PLAN and quota weekly budgets differ');
        if (!normalizeQuotaPolicy(batch.quotaPolicy).enabled) throw new Error('Execution PLAN requires enabled weekly quota enforcement');
    }
    return { schema: 'imedical-night-decisions/v1', batchId: batch.batchId, policy,
        ...(weeklyQuota ? { weeklyQuota, quotaBaselineReference: path.resolve(path.dirname(planFile), plan.executionPlan.budget.weekly.baselineReference), quotaBaselineHash: digest(weeklyQuota), usage: { basis: 'managed-endpoints', totalTokens: 0, endpoints: [], unobservedGovernance: true } } : {}),
        ...(batch.quotaPolicy ? { quotaPolicy: normalizeQuotaPolicy(batch.quotaPolicy), quotaSnapshot: null } : {}),
        ...(workspaces ? { workspaces } : {}),
        ...(batch.policy?.interactionMode === 'preflight-only' ? { interactionMode: 'preflight-only', authorizationReferences: batch.authorizationReferences || {}, requiredCapabilities: batch.requiredCapabilities || [], runReference: batch.runReference ? path.resolve(path.dirname(file), batch.runReference) : null } : {}),
        limits: { stopClaimingAt: limits.stopClaimingAt, stopPublishingAt: limits.stopPublishingAt, stopAt: limits.stopAt }, demands: [], shared: { timingSegments: [], reassessments: [] }, humanReassessments: [], audit: null };
}

function validateNightItems(manifest) {
    if (!manifest.night) return;
    if (manifest.executionPlan) validateExecutionPlan(manifest);
    if (manifest.executionPlan && !['subagent', 'multi-session'].includes(manifest.orchestration.mode)) throw new Error('Execution PLAN requires a verified concurrent adapter; serial fallback must be explicitly replanned');
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
            if (!integration.integrationCovers(manifest, record, root, scope) && !(record.sourceScopes || []).some(source => (contract.strict(manifest) ? contract.physical(source.repoRoot) === contract.physical(root) : path.resolve(source.repoRoot) === path.resolve(root)) && source.scopes.some(parent => contract.strict(manifest) ? contract.contains(parent, scope) : parent === '.' || scope === parent || scope.startsWith(`${parent}/`)))) throw new Error('Post assessment does not cover planned source writes');
        }
    }
}

function checksComplete(record) {
    const post = record.assessment?.post;
    if (!post || !Array.isArray(record.checks)) return false;
    return post.minimumChecks.every(id => integration.reusedCheck(record, id) || record.checks.some(check => check.id === id && check.status === 'passed' && check.scopeFingerprint === record.scopeFingerprint && check.frozenVersion === record.frozenVersion && check.evidenceRefs?.length));
}

function plannedChecksComplete(manifest, record) {
    if (!integration.enabled(manifest)) return true;
    return manifest.executionPlan.minimumTests.filter(t => t.demandId === record.id).every(t => {
        if (integration.reusedCheck(record, t.id)) return true;
        if (['static-review','manual','not-applicable'].includes(t.level)) return record.checks?.some(c => c.id === t.id && c.status === 'passed' && c.frozenVersion === record.frozenVersion && c.scopeFingerprint === record.scopeFingerprint && c.evidenceRefs?.length);
        return record.testReceipts?.some(r => r.status === 'passed' && r.frozenVersion === record.frozenVersion && r.level === t.level && r.caseId === t.id && manifest.workItems.find(w => w.id === r.workItemId)?.ownerId === t.ownerId);
    });
}

function currentSources(record) {
    if (record.sourceSnapshot) return integration.frozenSources(record);
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

function updateNight(manifest, input, actor, options = {}) {
    if (!manifest.night) throw new Error('Night decision policy is not enabled');
    if (actor !== manifest.coordinatorId) throw new Error('Night records require coordinator actor');
    requireEvidence(input);
    const night = manifest.night;
    if (input.kind === 'policy-update') {
        if (!contract.strict(manifest)) throw new Error('Policy update requires managed schema 2.1');
        const allowed = new Set(['kind', 'changes', 'expectedMaxInFlight', 'userAuthorization', 'boundary', 'rationale', 'evidenceRefs']);
        if (Object.keys(input).some(key => !allowed.has(key)) || !input.changes || Object.keys(input.changes).length !== 1 || !Object.hasOwn(input.changes, 'maxInFlight')) throw new Error('Only maxInFlight may be updated');
        const previous = night.policy.maxInFlight, next = input.changes.maxInFlight;
        if (input.expectedMaxInFlight !== previous) throw new Error('Policy update expected value is stale');
        if (!Number.isInteger(next) || next <= previous) throw new Error('maxInFlight must increase by an explicitly authorized positive integer');
        if (input.userAuthorization?.actor !== 'user' || !nonempty(input.userAuthorization.reference) || !input.evidenceRefs.includes(input.userAuthorization.reference)) throw new Error('Policy update requires a referenced human authorization');
        const boundary = input.boundary;
        if (!boundary || boundary.runtimeOperationsSettled !== true || boundary.sourceWritesSettled !== true || boundary.fixtureWritesSettled !== true) throw new Error('Policy update requires an evidenced idle write boundary');
        if (manifest.workItems.some(work => work.status === 'running') || night.operations?.some(operation => operation.status === 'running') || night.preflightAttempt?.status === 'running' || manifest.actions.some(action => ['pending', 'blocked'].includes(action.status))) throw new Error('Policy update requires no active or pending managed execution');
        if (night.demands.some(record => record.results?.unknownWrite || record.resources?.pending || record.resources?.polluted)) throw new Error('Policy update requires reconciled writes and resources');
        if (!night.preflight || night.preflight.state !== 'ready' || night.preflight.revoked || !Array.isArray(night.preflight.authorizations) || manifest.workItems.some(work => work.status !== 'skipped' && contract.readinessReasons(manifest, work).length)) throw new Error('Policy update requires current unchanged preflight authorization');
        for (const grant of night.preflight.authorizations) {
            const held = manifest.authorizations[grant.category];
            if (!held) continue;
            if (held.state !== 'granted' || held.revoked || held.scopeHash !== manifest.orchestration.planHash || !nonempty(grant.reference) || held.sourceReference !== grant.reference || night.authorizationReferences?.[grant.category] !== grant.reference || grant.revoked || grant.environmentAlias !== night.preflight.environmentAlias || !nonempty(grant.environmentAlias) || held.environmentAlias !== undefined && held.environmentAlias !== grant.environmentAlias) throw new Error('Policy update cannot grant, restore or replace authorization');
            for (const expiry of [grant.expiresAt, held.expiresAt].filter(value => value !== undefined)) if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(expiry) || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now()) throw new Error('Policy update cannot rebind expired authorization');
        }
        const occupied = occupiedDemands(manifest).size;
        if (next < occupied) throw new Error('maxInFlight is below current occupied capacity');
        night.policy = normalizePolicy({ ...night.policy, maxInFlight: next });
        night.policyChanges ||= [];
        night.policyChanges.push({ at: new Date().toISOString(), field: 'maxInFlight', previous, next, occupied,
            userAuthorization: { actor: 'user', reference: input.userAuthorization.reference }, boundary: structuredClone(boundary), rationale: input.rationale, evidenceRefs: [...input.evidenceRefs] });
    } else if (['problem', 'attempt-start', 'attempt-result', 'dependency-bind'].includes(input.kind)) {
        const changed = convergence.recordEvent(manifest, input);
        if (changed && ['dependency-bind', 'attempt-start'].includes(input.kind)) {
            const phases = input.kind === 'dependency-bind' ? ['review', 'verification'] : ['implementation'];
            for (const item of manifest.workItems.filter(w => w.night.demandId === input.demandId && phases.includes(w.night.phase) && ['completed', 'blocked', 'failed'].includes(w.status))) item.status = 'pending';
        }
    } else if (['source-integrate', 'source-freeze', 'evidence-reuse'].includes(input.kind)) {
        if (!path.isAbsolute(options.runDirectory || '')) throw new Error('Integration requires the managed run directory');
        integration.recordIntegration(manifest, input, options.runDirectory, record => currentSources({ ...record, sourceSnapshot: undefined }));
        if (input.kind === 'source-integrate') requeueSourceStages(manifest, night.demands.find(d => d.id === input.demandId));
    } else if (input.kind === 'browser-owner-exit') {
        contract.browserOwnerExit(manifest, input);
    } else if (input.kind === 'source-missing') {
        const record = night.demands.find(d => d.id === input.demandId);
        if (!record || !nonempty(input.handoffRef) || !Array.isArray(input.searchedScopes) || !input.searchedScopes.length || !Number.isFinite(input.elapsedMinutes) || input.elapsedMinutes <= 0) throw new Error('Source missing requires bounded lookup evidence and a recovery handoff');
        if (night.operations?.some(o => o.demandId === record.id && o.status === 'running') || record.results?.unknownWrite || record.resources?.pending || record.resources?.polluted) throw new Error('Reconcile active operations and resources before skipping');
        const planned = manifest.workItems.filter(w => w.night.demandId === record.id);
        if (input.searchedScopes.some(s => !path.isAbsolute(s.repositoryRoot || '') || !Array.isArray(s.scopes) || !s.scopes.length || !planned.some(w => contract.repositoryRoot(manifest, w) === s.repositoryRoot && s.scopes.every(scope => [...w.readScopes, ...w.writeScopes].some(parent => contract.contains(parent, scope)))))) throw new Error('Source lookup escaped declared scopes');
        record.skipped = { reason: 'source-missing', searchedScopes: input.searchedScopes, elapsedMinutes: input.elapsedMinutes, evidenceRefs: input.evidenceRefs, handoffRef: input.handoffRef };
        record.blocked = true; record.candidateReady = false;
        for (const work of planned) { work.status = 'skipped'; work.night.skipReason = 'source-missing'; work.night.handoffRef = input.handoffRef; }
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
        if (!night.weeklyQuota && Date.parse(snapshot.observedAt) > Date.now()) throw new Error('Quota snapshot cannot be from the future');
        if (!night.weeklyQuota && night.quotaSnapshot && Date.parse(snapshot.observedAt) < Date.parse(night.quotaSnapshot.observedAt)) throw new Error('Quota snapshot cannot move backwards');
        night.quotaSnapshot = snapshot;
        if (night.weeklyQuota) night.weeklyQuota = advanceWeeklyQuota(night.weeklyQuota, snapshot, night.quotaPolicy).state;
    } else if (input.kind === 'client-reserve') {
        if (!integration.enabled(manifest)) throw new Error('Execution PLAN required for client reservation');
        const reservation = input.reservation, action = manifest.actions.find(a => a.id === reservation?.actionId), work = manifest.workItems.find(w => w.id === action?.workItemId);
        if (!action || !work || work.status !== 'running' || action.status !== 'pending' || action.result || !Number.isSafeInteger(reservation.tokens) || reservation.tokens <= 0 || !Number.isFinite(Date.parse(reservation.deadlineAt)) || Date.parse(reservation.deadlineAt) <= Date.now() || Date.parse(reservation.deadlineAt) > Math.min(Date.parse(night.limits.stopAt), Date.parse(night.weeklyQuota.recordedAt) + manifest.executionPlan.budget.timeMinutes * 60000)) throw new Error('Client reservation must bind a current bounded running action');
        if (!path.isAbsolute(options.runDirectory || '') || !path.isAbsolute(reservation.launchReceiptFile || '') || !path.relative(options.runDirectory, reservation.launchReceiptFile).replace(/\\/g,'/').startsWith('evidence/night-operations/')) throw new Error('Client reservation requires a durable in-run launch receipt path');
        const expectedContext = buildActionContext(manifest, work);
        if (!action.context || !contextSnapshotMatches(action.context, expectedContext) || action.context.bindingHash !== expectedContext.bindingHash || action.scopeHash !== manifest.orchestration.planHash || !gateNight(manifest, work).allowed) throw new Error('Client reservation context or gate is stale');
        night.clientReservations ||= [];
        if (night.clientReservations.some(r => r.actionId === action.id)) throw new Error('Client launch already reserved; reconcile rather than replay');
        const governance = night.usage?.basis === 'managed-endpoints' && night.usage.unobservedGovernance ? manifest.executionPlan.budget.governanceTokens : 0;
        const allocated = night.clientReservations.filter(r => r.status !== 'settled').reduce((sum, r) => {
            const bound = manifest.actions.find(a => a.id === r.actionId), used = night.usage?.endpoints?.find(e => e.endpointId === bound?.result?.endpointId);
            return sum + Math.max(0, r.tokens - (used?.goalTokensUsed || 0));
        }, 0);
        if (!Number.isSafeInteger(night.usage?.totalTokens) || governance + allocated + night.usage.totalTokens + reservation.tokens > manifest.executionPlan.budget.tokens) throw new Error('Client token allocation exceeds the approved batch budget');
        night.clientReservations.push({ actionId: action.id, tokens: reservation.tokens, deadlineAt: reservation.deadlineAt, launchReceiptFile: reservation.launchReceiptFile, status: 'reserved', at: new Date().toISOString(), evidenceRefs: input.evidenceRefs });
    } else if (input.kind === 'usage') {
        if (!integration.enabled(manifest)) throw new Error('Execution PLAN required for aggregate token accounting');
        const observation = input.observation, action = manifest.actions.find(a => a.id === observation?.actionId);
        if (!action || action.result?.endpointId !== observation.endpointId || !Number.isSafeInteger(observation.totalTokens) || observation.totalTokens < 0 || !Number.isFinite(Date.parse(observation.observedAt)) || Date.parse(observation.observedAt) > Date.now()) throw new Error('Usage must bind an observed endpoint and cumulative token counter');
        if (observation.goalTokensUsed !== undefined && (!Number.isSafeInteger(observation.goalTokensUsed) || observation.goalTokensUsed < 0) || observation.goalTokenBudget !== undefined && (!Number.isSafeInteger(observation.goalTokenBudget) || observation.goalTokenBudget <= 0)) throw new Error('Observed Goal budget/usage counters invalid');
        if (observation.goalStatus !== undefined && !['active','paused','complete','budgetLimited','usageLimited','blocked'].includes(observation.goalStatus)) throw new Error('Observed Goal status invalid');
        if (observation.turnStatus !== undefined && !['notStarted','inProgress','completed','interrupted','failed','unknown'].includes(observation.turnStatus)) throw new Error('Observed turn status invalid');
        if (action.result?.host?.budget?.configured && observation.goalTokenBudget !== undefined && observation.goalTokenBudget !== action.result.host.budget.tokenBudget) throw new Error('Goal token budget drifted from launch readback');
        night.usage ||= { endpoints: [], totalTokens: 0 };
        const old = night.usage.endpoints.find(e => e.endpointId === observation.endpointId);
        if (old && (observation.totalTokens < old.totalTokens || Date.parse(observation.observedAt) < Date.parse(old.observedAt))) throw new Error('Usage cannot reset on resume');
        if (old?.goalTokensUsed !== undefined && observation.goalTokensUsed !== undefined && observation.goalTokensUsed < old.goalTokensUsed) throw new Error('Goal usage cannot reset on resume');
        if (old) Object.assign(old, structuredClone(observation)); else night.usage.endpoints.push(structuredClone(observation));
        night.usage.totalTokens = night.usage.endpoints.reduce((sum, e) => sum + e.totalTokens, 0);
        night.usage.evidenceRefs = input.evidenceRefs;
        if (['completed','interrupted','failed'].includes(observation.turnStatus) && (!action.result?.host?.budget?.configured || ['paused','complete','budgetLimited','usageLimited','blocked'].includes(observation.goalStatus))) {
            const reservation = night.clientReservations?.find(r => r.actionId === action.id);
            if (reservation) reservation.status = 'settled';
        }
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
        if (integration.enabled(manifest)) {
            const work = manifest.workItems.find(w => w.id === result.binding?.workItemId), expected = work?.night.route || record.assessment.post.route;
            if (result.acceptance.level !== expected || !manifest.executionPlan.minimumTests.some(t => t.demandId === record.id && t.ownerId === work.ownerId && t.level === expected && t.id === result.caseId && JSON.stringify([...t.scope].sort()) === JSON.stringify([...(Array.isArray(result.scope) ? result.scope : [result.scope])].sort())) ) throw new Error('Receipt is outside the assigned minimum test plan');
        }
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
        const record = structuredClone(input.record);
        if (!record || !manifest.workItems.some(item => item.night.demandId === record.id)) throw new Error('Unknown night demand');
        if (!manifest.participants.some(p => p.id === record.implementationOwnerId)) throw new Error('Unknown implementation owner');
        const previous = night.demands.find(item => item.id === record.id);
        if (integration.enabled(manifest)) for (const key of ['testReceipts','deploymentReceipts']) {
            if (record[key] !== undefined && JSON.stringify(record[key]) !== JSON.stringify(previous?.[key] || [])) throw new Error(`${key} requires its managed execution event`);
            record[key] = structuredClone(previous?.[key] || []);
        }
        for (const key of ['sourceSnapshot', 'integrationBinding', 'evidenceReuse', 'skipped']) {
            if (record[key] !== undefined && JSON.stringify(record[key]) !== JSON.stringify(previous?.[key])) throw new Error(`${key} requires its managed event`);
            if (previous?.[key] !== undefined && (key !== 'sourceSnapshot' || record.frozenVersion === previous.frozenVersion)) record[key] = structuredClone(previous[key]);
        }
        if (previous?.frozenVersion !== record.frozenVersion) delete record.sourceSnapshot;
        if (previous?.checks) record.checks = [...previous.checks.filter(old => !(record.checks || []).some(next => JSON.stringify(next) === JSON.stringify(old))), ...(record.checks || [])];
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
        if (record.candidateReady && (!assessDemand(record, 'post', night.policy, Date.now(), { collaborationReady: integration.enabled(manifest) }).allowed || !nonempty(record.handoffRef) || !checksComplete(record) || !plannedChecksComplete(manifest, record))) throw new Error('Candidate requires current approved post review, completed minimum checks and handoff');
        if (record.candidateReady && !['static-review', 'manual'].includes(record.assessment.post.route)) {
            const result = record.automatedResult;
            if (result?.status !== 'passed' || result.level !== record.assessment.post.route || result.scopeFingerprint !== record.scopeFingerprint || result.frozenVersion !== record.frozenVersion || !nonempty(result.evidenceRef)) throw new Error('Runtime candidate requires matching automated result');
        }
        if (night.audit && record.candidateReady && record.assessment.post.route === 'static-review' && !night.audit.cohort.some(item => item.id === record.id && item.scopeFingerprint === record.scopeFingerprint && item.frozenVersion === record.frozenVersion)) throw new Error('Frozen audit cohort cannot gain or change static candidates');
        if (contract.strict(manifest) && previous?.frozenVersion && previous.frozenVersion !== record.frozenVersion) {
            requeueSourceStages(manifest, record);
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
    for (const record of night.demands) if (record.candidateReady && (!checksComplete(record) || !plannedChecksComplete(manifest, record) || !sourcesMatch(record))) issues.push(`night candidate evidence stale: ${record.id}`);
    if (contract.strict(manifest)) for (const record of night.demands) if (contract.timingStatus(manifest, record) === 'incomplete') issues.push(`night timing incomplete: ${record.id}`);
    if (convergence.enabled(manifest)) for (const record of night.demands) {
        if (convergence.problems(manifest, record.id).some(p => !p.resolved)) issues.push(`night problem unresolved: ${record.id}`);
        if (convergence.dependencyReasons(manifest, record, true).length || convergence.bindings(manifest, record.id).length && !record.testReceipts?.some(r => r.status === 'passed' && r.frozenVersion === record.frozenVersion && r.dependencyToken === convergence.dependencyToken(manifest, record.id))) issues.push(`night dependency evidence stale: ${record.id}`);
    }
    issues.push(...contract.retainedOwnerIssues(manifest));
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
        if (!night.startedAt && manifest.workItems.some(w => require('./night-capability').executableWork(manifest, w) && contract.readinessReasons(manifest, w, now).length)) reasons.push('night-startup-preflight-incomplete');
        reasons.push(...contract.readinessReasons(manifest, item, now));
        if (contract.timingStatus(manifest, record) === 'incomplete') reasons.push('timing-incomplete');
    }
    if (night.workspaces) {
        const workspace = night.workspaces.find(entry => entry.ownerId === item.ownerId);
        if (!workspace || !checkWorkspace(workspace.plan, { manifest }).ok) reasons.push('night-workspace-preflight-failed');
    }
    const quota = assessQuota(night.quotaSnapshot, night.quotaPolicy, now, night.weeklyQuota);
    if (integration.enabled(manifest)) {
        const plan = manifest.executionPlan, plannedDemand = plan.demands.find(d => d.id === demandId);
        try { if (digest(read(night.quotaBaselineReference)) !== night.quotaBaselineHash) reasons.push('quota-baseline-changed'); } catch { reasons.push('quota-baseline-unavailable'); }
        if (['blocked', 'unsupported'].includes(plannedDemand?.feasibility)) reasons.push('demand-prerequisites-unavailable');
        if (now >= Date.parse(night.weeklyQuota?.recordedAt || manifest.createdAt) + plan.budget.timeMinutes * 60000) reasons.push('batch-time-budget-exhausted');
        const governanceReserve = night.usage?.basis === 'managed-endpoints' && night.usage.unobservedGovernance ? plan.budget.governanceTokens : 0;
        if (night.usage?.totalTokens + governanceReserve >= plan.budget.tokens) reasons.push('batch-token-budget-exhausted');
        if (['deployment', 'verification'].includes(phase) && !record.sourceSnapshot) reasons.push('frozen-source-required');
        if (manifest.workItems.some(w => w.id !== item.id && w.ownerId === item.ownerId && (w.status === 'running' || manifest.actions.some(a => a.workItemId === w.id && a.status === 'pending')))) reasons.push('owner-busy');
        const worker = plan.workers.find(w => w.ownerId === item.ownerId), client = plan.capacity.clients.find(c => c.id === worker.clientId);
        const activeOwners = new Set(manifest.workItems.filter(w => w.id !== item.id && (w.status === 'running' || manifest.actions.some(a => a.workItemId === w.id && a.status === 'pending'))).map(w => w.ownerId));
        const activeClientOwners = plan.workers.filter(w => w.clientId === worker.clientId && (w.role === 'coordinator' || activeOwners.has(w.ownerId)));
        if (!activeOwners.has(item.ownerId) && activeClientOwners.length >= client.maxConcurrent) reasons.push('client-capacity-exhausted');
        const scheduled = plan.capacity.testerSchedule.find(s => s.ownerId === item.ownerId);
        if (scheduled?.after.some(id => activeOwners.has(id)) || plan.capacity.testerSchedule.some(s => s.after.includes(item.ownerId) && activeOwners.has(s.ownerId))) reasons.push('tester-schedule-conflict');
        reasons.push(...integration.publicationReasons(manifest, item));
    }
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
    const decision = assessDemand(repair ? { ...record, results: { ...record.results, knownDefect: false } } : record, stage, night.policy, now, { collaborationReady: integration.enabled(manifest) });
    reasons.push(...decision.reasons);
    if (integration.enabled(manifest) && phase === 'verification' && item.night.route) {
        if (!manifest.executionPlan.minimumTests.some(t => t.demandId === demandId && t.ownerId === item.ownerId && t.level === item.night.route)) reasons.push('test-plan-route-mismatch');
        decision.route = item.night.route;
    }
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

module.exports = { initializeNight, validateNightItems, updateNight, gateNight, currentSources, occupiedDemands, sharedMinutes, nightCompletionIssues, plannedChecksComplete };
