'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { validateClientAdapter } = require('./night-client');
const { assessQuota, sanitizeQuotaSnapshot } = require('./night-quota');
const orchestration = require('../agent-orchestrator');
const { gateNight } = require('./night-dispatch');
const physical = value => fs.realpathSync.native(path.resolve(value));
const same = (a, b) => process.platform === 'win32' ? physical(a).toLowerCase() === physical(b).toLowerCase() : physical(a) === physical(b);
const positive = value => Number.isSafeInteger(value) && value > 0;
const terminal = state => ['completed', 'interrupted', 'failed'].includes(state?.turnStatus);
function fail(code) { throw Object.assign(new Error(code), { code }); }

// This observes endpoints already owned by the run. It never chooses or launches work.
function createNightSupervisor({ runDirectory, adapter, recordNight = orchestration.recordNight, loadManifest = orchestration.loadManifest, probeWatcher, now = Date.now, operationTimeoutMs = 10000, gate = gateNight, assertActionContext = orchestration.assertActionContext }) {
    validateClientAdapter(adapter);
    if (!path.isAbsolute(runDirectory || '') || !positive(operationTimeoutMs) || operationTimeoutMs > 60000) fail('supervisor-configuration');
    const directory = path.resolve(runDirectory), restored = new Set(); let busy = false;
    async function bounded(fn) {
        let timer;
        try { return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('supervisor-observation-timeout'), { code: 'supervisor-observation-timeout' })), operationTimeoutMs); })]); }
        finally { clearTimeout(timer); }
    }
    const read = () => {
        const manifest = loadManifest(directory);
        if (manifest.schemaVersion !== '2.1' || manifest.executionPlan?.version !== 1 || !manifest.night) fail('supervisor-managed-plan-required');
        return manifest;
    };
    const bindings = manifest => {
        const latest = new Map();
        for (const action of manifest.actions) if (action.result?.endpointId && ['succeeded', 'blocked'].includes(action.result.status)) latest.set(action.result.endpointId, action);
        return [...latest.values()];
    };
    function governanceReserve(manifest) { return manifest.night.usage?.basis === 'managed-endpoints' && manifest.night.usage.unobservedGovernance === true ? manifest.executionPlan.budget.governanceTokens : 0; }
    function save(value) {
        const parent = path.join(directory, 'evidence', 'night-operations'); fs.mkdirSync(parent, { recursive: true });
        const file = path.join(parent, `client-observation-${crypto.randomUUID()}.json`); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); return file;
    }
    function record(manifest, value, file) { return recordNight(directory, { ...value, rationale: 'Observed bounded client supervision', evidenceRefs: [file] }, manifest.coordinatorId); }
    async function restore(manifest = read()) {
        const errors = manifest.actions.filter(action => action.result?.host?.executionUnknown === true && !action.result.endpointId).map(action => ({ actionId: action.id, endpointId: null, category: 'launch-endpoint-identity-unknown' }));
        for (const action of bindings(manifest)) if (!restored.has(action.id)) {
          try {
            if (typeof adapter.restoreEndpoint !== 'function') fail('client-restore-capability-missing');
            const receipt = action.result;
            if (receipt.actionId !== action.id || receipt.host?.threadId !== receipt.endpointId || !receipt.host?.turnId || !Number.isFinite(Date.parse(receipt.host.deadlineAt))) fail('persisted-launch-receipt-incomplete');
            if (receipt.host.budget?.configured === true && (receipt.host.budget.readback !== true || receipt.host.budget.threadId !== receipt.endpointId || !positive(receipt.host.budget.tokenBudget) || !Number.isSafeInteger(receipt.host.budget.tokensUsed) || receipt.host.budget.tokensUsed < 0)) fail('persisted-goal-readback-unverified');
            // The exact persisted budget is restored, never inferred from the PLAN total.
            let existing;
            try { existing = await bounded(() => adapter.status({ actionId: action.id })); } catch { /* A fresh adapter needs the durable binding restored first. */ }
            if (!validStatus(action, existing)) await bounded(() => adapter.restoreEndpoint(structuredClone(receipt)));
            restored.add(action.id);
          } catch (error) {
            errors.push({ actionId: action.id, endpointId: action.result.endpointId, category: ['client-restore-capability-missing', 'persisted-launch-receipt-incomplete', 'persisted-goal-readback-unverified'].includes(error.code) ? error.code : 'endpoint-restore-unverified' });
          }
        }
        return { restoredActionIds: [...restored], errors };
    }
    function validStatus(action, state) { return state?.actionId === action.id && state.endpointId === action.result.endpointId && (action.result.host.budget?.configured === true && action.result.host.budget.readback === true ? typeof state.turnId === 'string' && state.turnId.length > 0 : state.turnId === action.result.host.turnId); }
    function tokens(usage) {
        const total = usage?.threadTokens?.total?.totalTokens ?? usage?.threadTokens?.totalTokens ?? usage?.goal?.tokensUsed;
        return Number.isSafeInteger(total) && total >= 0 ? total : null;
    }
    function goalValid(action, usage) {
        const budget = action.result.host.budget;
        return budget?.configured !== true || usage?.goal?.threadId === action.result.endpointId && usage.goal.tokenBudget === budget.tokenBudget && Number.isSafeInteger(usage.goal.tokensUsed) && usage.goal.tokensUsed >= budget.tokensUsed && usage.goal.tokensUsed <= budget.tokenBudget;
    }
    async function tick() {
        if (busy) fail('supervisor-operation-in-flight'); busy = true;
        try {
            let manifest = read(); const restoration = await restore(manifest);
            const observations = [], active = bindings(manifest).filter(action => restored.has(action.id)), quotaSamples = []; let observationUnknown = restoration.errors.length > 0;
            for (const action of active) {
                let state, usage;
                try { state = await bounded(() => adapter.status({ actionId: action.id })); } catch { observationUnknown = true; }
                try { usage = await bounded(() => adapter.usage({ actionId: action.id })); } catch { observationUnknown = true; }
                if (!validStatus(action, state)) { state = null; observationUnknown = true; }
                const totalTokens = tokens(usage), goalReadbackVerified = goalValid(action, usage);
                if (totalTokens === null || !goalReadbackVerified) observationUnknown = true;
                if (usage?.snapshot) quotaSamples.push(sanitizeQuotaSnapshot(usage.snapshot));
                observations.push({ action, state, usage, totalTokens, goalReadbackVerified });
            }
            if (!active.length) {
                try { const usage = await bounded(() => adapter.usage()); if (usage?.snapshot) quotaSamples.push(sanitizeQuotaSnapshot(usage.snapshot)); else observationUnknown = true; } catch { observationUnknown = true; }
            }
            if (!quotaSamples.length) observationUnknown = true;
            for (const snapshot of quotaSamples) {
                const file = save({ schema: 'night-client-quota-observation/v1', observedAt: new Date(now()).toISOString(), snapshot });
                try { if (manifest.night.quotaPolicy?.enabled) await record(manifest, { kind: 'quota', snapshot }, file); else observationUnknown = true; } catch { observationUnknown = true; }
            }
            for (const observation of observations) if (observation.totalTokens !== null) {
                const data = { actionId: observation.action.id, endpointId: observation.action.result.endpointId, totalTokens: observation.totalTokens, observedAt: new Date(now()).toISOString(),
                    ...(observation.state ? { turnStatus: observation.state.turnStatus } : {}),
                    ...(observation.usage?.goal && observation.goalReadbackVerified ? { goalTokensUsed: observation.usage.goal.tokensUsed, goalTokenBudget: observation.usage.goal.tokenBudget, goalStatus: observation.usage.goal.status } : {}) };
                const file = save({ schema: 'night-client-usage-observation/v1', ...data, goalReadbackVerified: observation.goalReadbackVerified });
                try { await record(manifest, { kind: 'usage', observation: data }, file); } catch { observationUnknown = true; }
            }
            manifest = read();
            const quota = assessQuota(manifest.night.quotaSnapshot, manifest.night.quotaPolicy, now(), manifest.night.weeklyQuota);
            const used = manifest.night.usage?.totalTokens, governance = governanceReserve(manifest), remainingTokens = Number.isSafeInteger(used) && used >= 0 && Number.isSafeInteger(governance) && governance >= 0 ? Math.max(0, manifest.executionPlan.budget.tokens - used - governance) : null;
            const deadline = Date.parse(manifest.night.limits.stopAt), stopBatch = observationUnknown || ['unknown', 'closeout'].includes(quota.mode) || !Number.isFinite(deadline) || now() >= deadline || remainingTokens === null || remainingTokens === 0;
            const outputs = [];
            for (const observation of observations) {
                const { action, state } = observation, item = manifest.workItems.find(work => work.id === action.workItemId);
                let decision;
                try { decision = gate(manifest, item, now()); } catch { decision = { allowed: false, reasons: ['gate-observation-unknown'] }; }
                const reasons = [...(decision.reasons || [])], ownDeadline = Date.parse(action.result.host.deadlineAt);
                const drainOnly = !stopBatch && quota.mode === 'drain' && reasons.every(reason => /quota.*(?:stop-claiming|weekly-stop-claiming)/.test(reason));
                const goalExhausted = action.result.host.budget?.configured === true && observation.usage?.goal?.tokensUsed >= action.result.host.budget.tokenBudget;
                const goalActiveOrUnknown = action.result.host.budget?.configured === true && !['paused', 'complete', 'budgetLimited', 'usageLimited', 'blocked'].includes(observation.usage?.goal?.status);
                const mustStop = (!terminal(state) || goalActiveOrUnknown) && (stopBatch || action.status === 'cancelled' || action.completionResult?.status === 'succeeded' || goalExhausted || !Number.isFinite(ownDeadline) || now() >= ownDeadline || !decision.allowed && !drainOnly);
                let stop, after = state;
                if (mustStop) {
                    try { stop = await bounded(() => adapter.stop({ actionId: action.id, reason: stopBatch ? 'batch-closeout-or-unknown' : 'work-gate-or-deadline' })); } catch { stop = null; }
                    try { const actual = await bounded(() => adapter.status({ actionId: action.id })); after = validStatus(action, actual) ? actual : null; } catch { after = null; }
                }
                const stoppedVerified = terminal(after) && (action.result.host.budget?.configured !== true || stop?.goalPaused === true);
                const output = { actionId: action.id, endpointId: action.result.endpointId, observedAt: new Date(now()).toISOString(), turnStatus: after?.turnStatus || 'unknown', stopRequested: mustStop, interruptAcknowledged: stop?.interruptRequested === true, stoppedVerified,
                    processCleanupVerified: stoppedVerified && stop?.processCleanupVerified === true, resourceCleanupVerified: stoppedVerified && stop?.resourceCleanupVerified === true };
                const evidenceRef = save({ schema: 'night-client-status-observation/v1', ...output }); outputs.push({ ...output, evidenceRef });
            }
            return { schema: 'night-client-supervision/v1', mode: stopBatch ? 'closeout' : quota.mode, quota, observationUnknown, remainingTokens, observedManagedTokens: used ?? null, governanceReserve: governance, totalCostKnown: manifest.night.usage?.unobservedGovernance !== true, stopClaiming: stopBatch || quota.mode === 'drain', endpoints: outputs, unresolvedEndpoints: restoration.errors };
        } finally { busy = false; }
    }
    async function beforeLaunch(request) {
        const manifest = read(), action = manifest.actions.find(value => value.id === request?.actionId), item = manifest.workItems.find(work => work.id === action?.workItemId);
        if (!action || !item || item.status !== 'running' || action.status !== 'pending' || action.result?.endpointId || !['spawn-subagent', 'create-session'].includes(action.type)) fail('current-running-action-required');
        if ((await restore(manifest)).errors.length) fail('unresolved-persisted-launch-blocks-new-work');
        const approval = manifest.night.authorizationReferences?.collaborationPlan;
        if (!approval || request.authorization?.actor !== 'user' || request.authorization.reference !== approval || request.goalAuthorization && (request.goalAuthorization.actor !== 'user' || request.goalAuthorization.reference !== approval)) fail('launch-authorization-unbound');
        const quota = assessQuota(manifest.night.quotaSnapshot, manifest.night.quotaPolicy, now(), manifest.night.weeklyQuota);
        if (manifest.night.quotaPolicy?.enabled !== true || quota.mode !== 'normal') fail('launch-quota-not-normal');
        const deadline = Date.parse(request.deadlineAt), stopAt = Date.parse(manifest.night.limits.stopAt);
        if (typeof request.deadlineAt !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(request.deadlineAt) || !Number.isFinite(deadline) || deadline <= now() || deadline > stopAt || request.maxTurns !== 1) fail('launch-deadline-or-turn-bound');
        const used = manifest.night.usage?.totalTokens;
        if (!Number.isSafeInteger(used) || used < 0) fail('batch-token-usage-unknown');
        let reserved = 0;
        for (const active of bindings(manifest)) {
            const budget = active.result.host?.budget;
            if (budget?.configured === true) {
                const observation = manifest.night.usage.endpoints?.find(endpoint => endpoint.endpointId === active.result.endpointId), actual = observation?.goalTokensUsed;
                if (!Number.isSafeInteger(actual) || actual < budget.tokensUsed || !positive(budget.tokenBudget) || !Number.isFinite(Date.parse(observation.observedAt)) || now() - Date.parse(observation.observedAt) < 0 || now() - Date.parse(observation.observedAt) > 30000) fail('active-goal-allocation-unknown');
                const released = terminal(observation) && ['paused', 'complete', 'budgetLimited', 'usageLimited', 'blocked'].includes(observation.goalStatus) && observation.goalTokenBudget === budget.tokenBudget;
                if (!released) reserved += Math.max(0, budget.tokenBudget - actual);
            }
        }
        const governance = governanceReserve(manifest);
        if (!Number.isSafeInteger(governance) || governance < 0) fail('governance-token-reserve-unknown');
        const availableTokens = Math.max(0, manifest.executionPlan.budget.tokens - used - reserved - governance);
        if (availableTokens <= 0) fail('batch-token-allocation-exhausted');
        if (request.nativeGoal && (!positive(request.nativeGoal.tokenBudget) || request.nativeGoal.tokenBudget > availableTokens)) fail('native-goal-exceeds-batch-allocation');
        assertActionContext(manifest, action);
        if (!request.context || request.context.sha256 !== action.context.sha256 || request.context.text !== action.context.text || !same(request.cwd, action.context.workspaceRoot)) fail('launch-context-or-workspace-mismatch');
        const decision = gate(manifest, item, now()); if (!decision.allowed) fail('launch-work-gate-blocked');
        const capability = await bounded(() => adapter.probe()); if (!capability?.available || capability.status !== true || capability.stop !== true || capability.usage !== true) fail('client-supervision-capability-missing');
        if (request.nativeGoal) { if (capability.nativeGoal !== true) fail('native-goal-capability-missing'); }
        else {
            if (typeof probeWatcher !== 'function') fail('persistent-watcher-control-capability-missing');
            if (!path.isAbsolute(request.watcherReference || '')) fail('persistent-watcher-reference-required');
            let receipt; try { receipt = JSON.parse(fs.readFileSync(request.watcherReference, 'utf8')); } catch { fail('persistent-watcher-receipt-unavailable'); }
            if (receipt.schema !== 'night-client-watcher/v1' || receipt.actionId !== action.id || !same(receipt.runDirectory, directory) || receipt.deadlineAt !== request.deadlineAt || !positive(receipt.pid) || !Number.isFinite(Date.parse(receipt.heartbeatAt)) || now() - Date.parse(receipt.heartbeatAt) < 0 || now() - Date.parse(receipt.heartbeatAt) > 30000) fail('persistent-watcher-receipt-stale');
            try { process.kill(receipt.pid, 0); } catch { fail('persistent-watcher-process-unavailable'); }
            const challenge = crypto.randomUUID(), live = await bounded(() => probeWatcher({ receipt: structuredClone(receipt), challenge, actionId: action.id, runDirectory: directory }));
            if (live?.challenge !== challenge || live.alive !== true || live.pid !== receipt.pid || live.actionId !== action.id || live.deadlineAt !== request.deadlineAt || !same(live.runDirectory, directory)) fail('persistent-watcher-challenge-failed');
        }
        return { allowed: true, actionId: action.id, availableTokens, governanceReserve: governance, deadlineAt: request.deadlineAt, contextHash: action.context.sha256, nativeGoal: !!request.nativeGoal };
    }
    return { tick, beforeLaunch, restore };
}
function clientReceipt(value, actionId, contextHash) {
    const receipt = { actionId, status: ['succeeded', 'failed', 'blocked', 'cancelled'].includes(value?.status) ? value.status : 'blocked', endpointId: typeof value?.endpointId === 'string' ? value.endpointId : null,
        artifactRefs: Array.isArray(value?.artifactRefs) ? value.artifactRefs.filter(ref => typeof ref === 'string') : [], contextHash: typeof value?.contextHash === 'string' ? value.contextHash : contextHash };
    const host = value?.host;
    if (host && typeof host === 'object') {
        receipt.host = {};
        for (const name of ['threadId', 'turnId', 'deadlineAt', 'mode']) if (typeof host[name] === 'string') receipt.host[name] = host[name];
        for (const name of ['executionUnknown', 'budgetConfigured', 'goalPaused', 'contextInjected', 'supervisionRequired', 'derivedSessionBudgetInherited']) if (typeof host[name] === 'boolean') receipt.host[name] = host[name];
        if (Number.isSafeInteger(host.maxTurns)) receipt.host.maxTurns = host.maxTurns;
        if (host.budget && typeof host.budget === 'object') {
            receipt.host.budget = {};
            for (const name of ['configured', 'readback']) if (typeof host.budget[name] === 'boolean') receipt.host.budget[name] = host.budget[name];
            for (const name of ['tokenBudget', 'tokensUsed']) if (Number.isSafeInteger(host.budget[name])) receipt.host.budget[name] = host.budget[name];
            if (typeof host.budget.threadId === 'string') receipt.host.budget.threadId = host.budget.threadId;
        }
    }
    if (value?.error) receipt.error = 'host-launch-unverified';
    return receipt;
}

// This is a mandatory gate around one adapter launch, not a dispatcher or a loop.
function createManagedNightClient(options) {
    const { runDirectory, adapter, recordNight = orchestration.recordNight, loadManifest = orchestration.loadManifest,
        consumeActionResult = orchestration.consumeActionResult, persistReceipt } = options;
    const supervisor = createNightSupervisor(options), attempted = new Set(), recoveries = new Map();
    let sequence = Promise.resolve();
    async function write(file, value) {
        if (persistReceipt) await persistReceipt(file, value);
        else fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
        if (JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))) !== JSON.stringify(value)) fail('managed-receipt-readback-failed');
    }
    async function launch(request) {
        if (attempted.has(request?.actionId)) fail('managed-launch-already-attempted');
        const gate = await supervisor.beforeLaunch(request), manifest = loadManifest(runDirectory), tokens = request.nativeGoal?.tokenBudget ?? request.tokenReservation;
        if (!positive(tokens) || tokens > gate.availableTokens) fail('explicit-token-reservation-required');
        const parent = path.resolve(runDirectory, 'evidence', 'night-operations'); fs.mkdirSync(parent, { recursive: true });
        const key = crypto.randomUUID(), launchReceiptFile = path.join(parent, `client-launch-${key}.json`), reservationFile = path.join(parent, `client-reservation-${key}.json`);
        const reservation = { actionId: request.actionId, tokens, deadlineAt: request.deadlineAt, launchReceiptFile };
        await write(reservationFile, { schema: 'night-client-reservation/v1', ...reservation, planHash: manifest.orchestration.planHash, contextHash: request.context.sha256 });
        attempted.add(request.actionId);
        // A lost reservation ACK remains unknown; never start or replay through it.
        await recordNight(runDirectory, { kind: 'client-reserve', reservation, rationale: 'Reserve approved action tokens before host mutation', evidenceRefs: [reservationFile] }, manifest.coordinatorId);
        let receipt, launchPersisted = false, failure;
        try {
            const actual = await adapter.startOrResume(request);
            receipt = clientReceipt(actual, request.actionId, request.context.sha256);
            if (actual?.actionId !== request.actionId) { receipt = { ...receipt, endpointId: null, host: { executionUnknown: true } }; fail('managed-launch-identity-mismatch'); }
            if (receipt.contextHash !== request.context.sha256) fail('managed-launch-identity-mismatch');
            if (receipt.status === 'succeeded') {
                if (!receipt.endpointId || receipt.host?.threadId !== receipt.endpointId || !receipt.host.turnId || receipt.host.deadlineAt !== request.deadlineAt) fail('managed-launch-host-binding-missing');
                if (request.nativeGoal && (receipt.host.budget?.configured !== true || receipt.host.budget.readback !== true || receipt.host.budget.threadId !== receipt.endpointId || receipt.host.budget.tokenBudget !== tokens || !Number.isSafeInteger(receipt.host.budget.tokensUsed) || receipt.host.budget.tokensUsed < 0 || receipt.host.budget.tokensUsed >= tokens)) fail('managed-native-goal-readback-mismatch');
                if (!request.nativeGoal && receipt.host.budget?.configured === true) fail('managed-unrequested-goal');
            }
            await write(launchReceiptFile, receipt); launchPersisted = true;
            if (receipt.status !== 'succeeded') fail('managed-host-launch-unverified');
            await consumeActionResult(runDirectory, receipt, false);
            return { ...receipt, managed: { reservationFile, launchReceiptFile, launchPersisted: true, actionResultConsumed: true } };
        } catch (error) { failure = error.code || 'managed-launch-persistence-or-host-unknown'; }
        receipt ||= clientReceipt(null, request.actionId, request.context.sha256);
        receipt = { ...receipt, status: 'blocked', error: 'managed-launch-unverified', host: { ...receipt.host, executionUnknown: true } };
        let stop, state;
        // Stop first; persistence recovery must not keep an uncertain host running.
        try { stop = await adapter.stop({ actionId: request.actionId, reason: 'managed-launch-unverified' }); } catch { /* Preserve unknown host ownership. */ }
        try { state = await adapter.status({ actionId: request.actionId }); } catch { /* An ACK is not terminal proof. */ }
        const identity = state?.actionId === request.actionId && state.endpointId === receipt.endpointId;
        const recovery = { schema: 'night-client-launch-recovery/v1', receipt, reservationFile, launchReceiptFile, launchPersisted, failureCategory: ['managed-launch-identity-mismatch', 'managed-launch-host-binding-missing', 'managed-native-goal-readback-mismatch', 'managed-unrequested-goal', 'managed-receipt-readback-failed'].includes(failure) ? failure : 'managed-launch-persistence-or-host-unknown',
            stopRequested: true, interruptAcknowledged: stop?.interruptRequested === true, stoppedVerified: identity && terminal(state) && (!request.nativeGoal || stop?.goalPaused === true), processCleanupVerified: false, resourceCleanupVerified: false };
        let recoveryFile;
        try { recoveryFile = path.join(parent, `client-recovery-${key}.json`); await write(recoveryFile, recovery); } catch { recoveryFile = null; }
        recoveries.set(request.actionId, structuredClone(recovery));
        let recoveryResultConsumed = false;
        try { await consumeActionResult(runDirectory, receipt, false); recoveryResultConsumed = true; } catch { /* Reservation and any written launch receipt remain for explicit reconciliation. */ }
        return { ...receipt, managed: { reservationFile, launchReceiptFile, launchPersisted, actionResultConsumed: false, recoveryResultConsumed, recoveryFile, stopRequested: true, stoppedVerified: recovery.stoppedVerified } };
    }
    function startOrResume(request) {
        const task = sequence.then(() => launch(request)); sequence = task.catch(() => {}); return task;
    }
    return { startOrResume, beforeLaunch: supervisor.beforeLaunch, tick: supervisor.tick, restore: supervisor.restore,
        status: input => adapter.status(input), usage: input => adapter.usage(input), stop: input => adapter.stop(input),
        recovery: actionId => recoveries.has(actionId) ? structuredClone(recoveries.get(actionId)) : null };
}
module.exports = { createNightSupervisor, createManagedNightClient };
