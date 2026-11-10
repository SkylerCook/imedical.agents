'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { createNightSupervisor, createManagedNightClient } = require('../lib/night-client-supervisor');
const { normalizeQuotaPolicy, createWeeklyBaseline, advanceWeeklyQuota } = require('../lib/night-quota');
const { createClientWorker } = require('../lib/night-client-worker');
function fixture(t, { used = 20, endpoints = 1, nativeGoal = true } = {}) {
    const root = require('./fixtures/temp-directory').createTempDirectory('night-supervisor-'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const now = Date.now(), calls = [], files = [], bound = new Set(), state = { used, turnStatus: 'inProgress', goalStatus: 'active', unknown: false, total: 10, goalTokens: 10, budget: 100, stopTerminal: false, physical: true, context: true };
    const snapshot = () => ({ observedAt: new Date(now).toISOString(), rateLimitsByLimitId: { codex: { secondary: { usedPercent: state.used, windowDurationMins: 10080, resetsAt: Math.floor(now / 1000) + 86400 } } } });
    const quotaPolicy = normalizeQuotaPolicy({ enabled: true, weeklyBudgetPercentPoints: 10 }), initial = snapshot();
    const manifest = { schemaVersion: '2.1', coordinatorId: 'leader', orchestration: { planHash: 'fixture-plan' }, executionPlan: { version: 1, budget: { tokens: 1000 } }, workItems: [], actions: [], night: { limits: { stopAt: new Date(now + 60000).toISOString() }, authorizationReferences: { collaborationPlan: 'user:scope' }, quotaPolicy, quotaSnapshot: initial, weeklyQuota: createWeeklyBaseline(initial, quotaPolicy, { budgetId: 'fixture-budget', now }), usage: { totalTokens: 0, endpoints: [] } } };
    const receipt = id => ({ actionId: id, endpointId: `endpoint-${id}`, status: 'succeeded', contextHash: 'context-hash', host: { threadId: `endpoint-${id}`, turnId: `turn-${id}`, deadlineAt: new Date(now + 30000).toISOString(), budget: nativeGoal ? { configured: true, readback: true, threadId: `endpoint-${id}`, tokenBudget: 100, tokensUsed: 0 } : { configured: false } } });
    for (let i = 1; i <= endpoints; i++) { const id = `a${i}`; manifest.workItems.push({ id: `w${i}`, status: 'running', night: { phase: 'verification' } }); manifest.actions.push({ id, status: 'acknowledged', type: 'create-session', workItemId: `w${i}`, result: receipt(id) }); }
    const status = id => ({ actionId: id, endpointId: `endpoint-${id}`, turnId: `turn-${id}`, turnStatus: state.turnStatus, completed: state.turnStatus === 'completed' });
    const adapter = {
        probe: async () => ({ available: true, nativeGoal, status: true, usage: true, stop: true }), injectContext() {}, startOrResume() { throw Error('supervisor must never launch'); },
        restoreEndpoint: async value => { calls.push(['restore', structuredClone(value)]); bound.add(value.actionId); },
        status: async ({ actionId }) => { calls.push(['status', actionId]); if (!bound.has(actionId)) throw Error('not restored'); return status(actionId); },
        usage: async input => { calls.push(['usage', input?.actionId || 'account']); if (state.unknown) throw Error('private credential failure'); return { snapshot: snapshot(), threadTokens: { total: { totalTokens: state.total } }, goal: input && nativeGoal ? { threadId: `endpoint-${input.actionId}`, tokenBudget: state.budget, tokensUsed: state.goalTokens, status: state.goalStatus } : null }; },
        stop: async ({ actionId }) => { calls.push(['stop', actionId]); state.goalStatus = 'paused'; if (state.stopTerminal) state.turnStatus = 'interrupted'; return { actionId, interruptRequested: true, interruptAcknowledged: true, stopped: false, goalPaused: true, processCleanupVerified: false, resourceCleanupVerified: false }; }
    };
    const recordNight = (_, input) => {
        files.push(...input.evidenceRefs); calls.push(['record', input.kind]);
        if (input.kind === 'quota') { manifest.night.quotaSnapshot = input.snapshot; manifest.night.weeklyQuota = advanceWeeklyQuota(manifest.night.weeklyQuota, input.snapshot, quotaPolicy, now).state; }
        if (input.kind === 'usage') { const o = input.observation, previous = manifest.night.usage.endpoints.find(e => e.endpointId === o.endpointId); if (previous) Object.assign(previous, o); else manifest.night.usage.endpoints.push(o); manifest.night.usage.totalTokens = manifest.night.usage.endpoints.reduce((sum, e) => sum + e.totalTokens, 0); }
        if (input.kind === 'client-reserve') { manifest.night.clientReservations ||= []; if (manifest.night.clientReservations.some(r => r.actionId === input.reservation.actionId)) throw Error('Client launch already reserved'); manifest.night.clientReservations.push(structuredClone(input.reservation)); }
    };
    const options = { runDirectory: root, adapter, loadManifest: () => manifest, recordNight, now: () => now,
        // Unit seams retain the production defaults' gate/context responsibilities.
        gate: () => ({ allowed: true, reasons: [] }), assertActionContext: () => { if (!state.context || !state.physical) throw Error('physical action PLAN unavailable'); } };
    const supervisor = createNightSupervisor(options);
    function launch(extra = {}) {
        const id = 'next', context = { text: 'Current authorized work', sha256: crypto.createHash('sha256').update('Current authorized work').digest('hex'), workspaceRoot: root };
        manifest.workItems.push({ id: 'work-next', status: 'running', night: { phase: 'verification' } }); manifest.actions.push({ id, workItemId: 'work-next', status: 'pending', type: 'create-session', context });
        return { actionId: id, cwd: root, context, authorization: { actor: 'user', reference: 'user:scope' }, deadlineAt: new Date(now + 20000).toISOString(), maxTurns: 1, nativeGoal: { objective: 'Approved task', tokenBudget: 100 }, ...extra };
    }
    return { root, now, manifest, state, calls, files, options, supervisor, launch, receipt, snapshot };
}
test('quota observation failure immediately stops only persisted batch endpoints and never treats interrupt ACK as terminal cleanup', async t => {
    const f = fixture(t); f.state.unknown = true;
    const result = await f.supervisor.tick(); assert.equal(result.mode, 'closeout'); assert.equal(result.observationUnknown, true); assert.deepEqual(f.calls.filter(c => c[0] === 'stop'), [['stop', 'a1']]);
    assert.equal(result.endpoints[0].interruptAcknowledged, true); assert.equal(result.endpoints[0].stoppedVerified, false); assert.equal(result.endpoints[0].resourceCleanupVerified, false); assert(fs.existsSync(result.endpoints[0].evidenceRef));
    assert.equal(JSON.stringify(result).includes('private credential'), false);
});
test('a running worker observes quota without model commands and stops only the owned host', async t => {
    const f = fixture(t), worker = createClientWorker({ ...f.options, intervalMs: 100 }); f.state.stopTerminal = true;
    try {
        await worker.start(); f.state.used = 30;
        const deadline = Date.now() + 1500;
        while (!f.calls.some(c => c[0] === 'stop') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        assert.ok(f.calls.some(c => c[0] === 'stop' && c[1] === 'a1'));
        assert.equal(worker.snapshot().observation.stopClaiming, true);
        assert.ok(fs.existsSync(path.join(f.root, 'evidence/night-operations/client-worker-checkpoint.json')));
    } finally { await worker.close(); }
    assert.equal(fs.existsSync(path.join(f.root, 'night-client-worker.lock')), false);
});
test('a second worker cannot take a live lease or stop its endpoints when startup is rejected', async t => {
    const f = fixture(t), first = createClientWorker({ ...f.options, intervalMs: 100 }), second = createClientWorker({ ...f.options, intervalMs: 100 });
    f.state.stopTerminal = true;
    try { await first.start(); await assert.rejects(second.start(), /live client supervisor/); await second.close(); assert.equal(f.calls.some(c => c[0] === 'stop'), false); }
    finally { await first.close(); }
});
test('already terminal and paused native Goals remain verified on later observations', async t => {
    const f = fixture(t); f.state.turnStatus = 'interrupted'; f.state.goalStatus = 'paused';
    const result = await f.supervisor.tick(); assert.equal(result.endpoints[0].stopRequested, false); assert.equal(result.endpoints[0].stoppedVerified, true);
});
test('client JSONL entry accepts queued input and EOF stops only owned endpoints with a durable checkpoint', async t => {
    const f = fixture(t), { PassThrough } = require('node:stream'), input = new PassThrough(), output = [];
    f.state.stopTerminal = true;
    input.end(JSON.stringify({ id: 'observe-1', operation: 'observe' }) + '\n');
    const code = await require('../night-client-worker').main(['--run-directory', f.root, '--interval-ms', '100'], { adapter: f.options.adapter, workerOptions: f.options, input, output: { write: text => output.push(JSON.parse(text)) } });
    assert.equal(code, 0); assert.equal(output[0].operation, 'ready'); assert.ok(output.some(row => row.id === 'observe-1' && row.status === 'succeeded'));
    assert.ok(f.calls.some(c => c[0] === 'stop' && c[1] === 'a1')); assert.equal(fs.existsSync(path.join(f.root, 'night-client-worker.lock')), false);
});
test('a dead worker lease restores existing endpoints without resetting their allocated Goal', async t => {
    const f = fixture(t), { spawnSync } = require('node:child_process'); f.state.stopTerminal = true;
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', windowsHide: true }); assert.equal(child.status, 0);
    fs.writeFileSync(path.join(f.root, 'night-client-worker.lock'), JSON.stringify({ identity: 'dead-owner', pid: Number(child.stdout) }));
    const worker = createClientWorker({ ...f.options, intervalMs: 100 });
    try { await worker.start(); assert.ok(f.calls.some(c => c[0] === 'restore' && c[1].host.budget.tokenBudget === 100)); assert.equal(f.manifest.night.usage.totalTokens, 10); }
    finally { await worker.close(); }
});
test('weekly 80 percent drains new claims while active endpoints continue; 100 percent stops actual bound endpoints', async t => {
    const f = fixture(t); f.state.used = 28;
    const drain = await f.supervisor.tick(); assert.equal(drain.mode, 'drain'); assert.equal(drain.stopClaiming, true); assert.equal(f.calls.filter(c => c[0] === 'stop').length, 0);
    await assert.rejects(f.supervisor.beforeLaunch(f.launch()), /launch-quota-not-normal/);
    f.state.used = 30; f.state.stopTerminal = true;
    const closeout = await f.supervisor.tick(); assert.equal(closeout.mode, 'closeout'); assert.equal(closeout.endpoints[0].stoppedVerified, true); assert.equal(closeout.endpoints[0].processCleanupVerified, false);
});
test('cumulative endpoint tokens aggregate without inventing weekly percent from token counts', async t => {
    const f = fixture(t, { endpoints: 2 }); await f.supervisor.tick(); assert.equal(f.manifest.night.usage.totalTokens, 20); await f.supervisor.tick(); assert.equal(f.manifest.night.usage.totalTokens, 20);
    assert.equal(f.manifest.night.weeklyQuota.highWaterUsedPercent, 20); assert.equal(f.calls.filter(c => c[0] === 'restore').length, 2);
    for (const file of f.files) assert(fs.existsSync(file));
});
test('restore uses actual persisted Goal readback and detects changed runtime budgets', async t => {
    const f = fixture(t); await f.supervisor.restore(); const saved = f.calls.find(c => c[0] === 'restore')[1]; assert.equal(saved.host.budget.tokenBudget, 100); assert.notEqual(saved.host.budget.tokenBudget, f.manifest.executionPlan.budget.tokens);
    f.state.budget = 999; const result = await f.supervisor.tick(); assert.equal(result.observationUnknown, true); assert.equal(result.endpoints[0].stopRequested, true);
    const invalid = fixture(t); invalid.manifest.actions[0].result.host.budget.readback = false; assert.equal((await invalid.supervisor.restore()).errors[0].category, 'persisted-goal-readback-unverified');
});
test('batch deadline, per-endpoint deadline and consumed native Goal all request stop without claiming resource cleanup', async t => {
    for (const kind of ['batch', 'task', 'goal']) { const f = fixture(t); if (kind === 'batch') f.manifest.night.limits.stopAt = new Date(f.now).toISOString(); if (kind === 'task') f.manifest.actions[0].result.host.deadlineAt = new Date(f.now).toISOString(); if (kind === 'goal') f.state.goalTokens = 100; const result = await f.supervisor.tick(); assert.equal(result.endpoints[0].stopRequested, true); assert.equal(result.endpoints[0].resourceCleanupVerified, false); }
});
test('a cancelled or completed work record does not prove its host endpoint has stopped', async t => {
    for (const cancelled of [true, false]) { const f = fixture(t); if (cancelled) f.manifest.actions[0].status = 'cancelled'; else { f.manifest.actions[0].completionResult = { status: 'succeeded' }; f.state.unknown = true; } const result = await f.supervisor.tick(); assert.equal(result.endpoints[0].stopRequested, true); assert.equal(result.endpoints[0].stoppedVerified, false); }
});
test('a completed turn cannot leave an active continuation Goal running past quota closeout', async t => {
    const f = fixture(t); f.state.turnStatus = 'completed'; f.state.used = 30; const result = await f.supervisor.tick(); assert.equal(result.endpoints[0].stopRequested, true); assert.equal(result.endpoints[0].stoppedVerified, true); assert.deepEqual(f.calls.filter(c => c[0] === 'stop'), [['stop', 'a1']]);
});
test('beforeLaunch checks running action, current physical context, authorization and remaining Goal allocation', async t => {
    const f = fixture(t); await f.supervisor.tick(); const request = f.launch();
    assert.equal((await f.supervisor.beforeLaunch(request)).availableTokens, 900);
    await assert.rejects(f.supervisor.beforeLaunch({ ...request, nativeGoal: { objective: 'Task', tokenBudget: 901 } }), /exceeds-batch/);
    await assert.rejects(f.supervisor.beforeLaunch({ ...request, authorization: { actor: 'user', reference: 'unbound' } }), /authorization-unbound/);
    await assert.rejects(f.supervisor.beforeLaunch({ ...request, context: { ...request.context, text: 'stale' } }), /context-or-workspace/);
    f.state.physical = false; await assert.rejects(f.supervisor.beforeLaunch(request), /physical action PLAN/); f.state.physical = true;
    f.manifest.night.usage.totalTokens = 1000; await assert.rejects(f.supervisor.beforeLaunch({ ...request, nativeGoal: undefined }), /allocation-exhausted/); f.manifest.night.usage.totalTokens = 10;
    f.manifest.workItems.at(-1).status = 'pending'; await assert.rejects(f.supervisor.beforeLaunch(request), /current-running-action/);
});
test('managed endpoint zero retains a governance reserve and observed terminal Goal/turn releases unused allocation', async t => {
    const first = fixture(t, { endpoints: 0 }); Object.assign(first.manifest.night.usage, { basis: 'managed-endpoints', unobservedGovernance: true }); first.manifest.executionPlan.budget.governanceTokens = 200;
    assert.equal((await first.supervisor.beforeLaunch(first.launch())).availableTokens, 800);
    const f = fixture(t); Object.assign(f.manifest.night.usage, { basis: 'managed-endpoints', unobservedGovernance: true }); f.manifest.executionPlan.budget.governanceTokens = 200; await f.supervisor.tick(); const request = f.launch(); assert.equal((await f.supervisor.beforeLaunch(request)).availableTokens, 700);
    f.state.turnStatus = 'interrupted'; f.state.goalStatus = 'paused'; const result = await f.supervisor.tick(); assert.equal(result.totalCostKnown, false); assert.equal(result.governanceReserve, 200); assert.equal(result.remainingTokens, 790); assert.equal((await f.supervisor.beforeLaunch(request)).availableTokens, 790);
});
test('one unrecoverable launch cannot prevent stopping another endpoint or permit a new launch', async t => {
    const f = fixture(t, { endpoints: 2 }); delete f.manifest.actions[0].result.host; f.state.unknown = true;
    const result = await f.supervisor.tick(); assert.equal(result.unresolvedEndpoints.length, 1); assert.equal(result.unresolvedEndpoints[0].actionId, 'a1'); assert.deepEqual(f.calls.filter(c => c[0] === 'stop'), [['stop', 'a2']]); assert.equal(result.endpoints[0].stoppedVerified, false);
    await assert.rejects(f.supervisor.beforeLaunch(f.launch()), /unresolved-persisted-launch/);
    const missing = fixture(t); missing.manifest.actions.push({ id: 'unidentified', result: { status: 'blocked', host: { executionUnknown: true } } }); const held = await missing.supervisor.tick(); assert.equal(held.unresolvedEndpoints[0].category, 'launch-endpoint-identity-unknown'); assert.equal(held.endpoints[0].stopRequested, true);
});
test('without native Goal, a persisted watcher requires a live OS PID and an actual matching channel challenge', async t => {
    const f = fixture(t, { endpoints: 0, nativeGoal: false }), request = f.launch({ nativeGoal: undefined });
    await assert.rejects(f.supervisor.beforeLaunch(request), /watcher-control-capability-missing/);
    const watcherReference = path.join(f.root, 'watcher.json'), receipt = { schema: 'night-client-watcher/v1', pid: process.pid, heartbeatAt: new Date(f.now).toISOString(), actionId: request.actionId, runDirectory: f.root, deadlineAt: request.deadlineAt }; fs.writeFileSync(watcherReference, JSON.stringify(receipt));
    const options = { ...f.options, probeWatcher: async ({ challenge }) => ({ ...receipt, alive: true, challenge }) }, supervised = createNightSupervisor(options);
    assert.equal((await supervised.beforeLaunch({ ...request, watcherReference })).nativeGoal, false);
    const fake = createNightSupervisor({ ...options, probeWatcher: async () => ({ ...receipt, alive: true, challenge: 'fake' }) }); await assert.rejects(fake.beforeLaunch({ ...request, watcherReference }), /challenge-failed/);
    receipt.heartbeatAt = new Date(f.now - 31000).toISOString(); fs.writeFileSync(watcherReference, JSON.stringify(receipt)); await assert.rejects(supervised.beforeLaunch({ ...request, watcherReference }), /receipt-stale/);
});
test('managed client gates, reserves durably, launches, persists the actual receipt and consumes the structured ACK in order', async t => {
    const f = fixture(t, { endpoints: 0 }), request = f.launch(), order = [];
    f.options.adapter.startOrResume = async input => { order.push('launch'); assert.equal(f.manifest.night.clientReservations.length, 1); return { ...f.receipt(input.actionId), contextHash: input.context.sha256, host: { ...f.receipt(input.actionId).host, deadlineAt: input.deadlineAt } }; };
    const managed = createManagedNightClient({ ...f.options, recordNight: async (...args) => { order.push('reserve'); return f.options.recordNight(...args); }, consumeActionResult: async (_, result, completion) => { order.push('ack'); assert.equal(completion, false); const saved = JSON.parse(fs.readFileSync(f.manifest.night.clientReservations[0].launchReceiptFile, 'utf8')); assert.deepEqual(saved, result); f.manifest.actions.at(-1).result = result; } });
    const result = await managed.startOrResume(request); assert.deepEqual(order, ['reserve', 'launch', 'ack']); assert.equal(result.status, 'succeeded'); assert.equal(result.managed.launchPersisted, true); assert.equal(result.host.budget.tokenBudget, 100);
    await assert.rejects(managed.startOrResume(request), /already-attempted/); assert.equal(order.filter(x => x === 'launch').length, 1);
    const rejected = fixture(t, { endpoints: 0 }); rejected.state.used = 30; await rejected.supervisor.tick(); const denied = createManagedNightClient({ ...rejected.options, consumeActionResult() { throw Error('must not ACK'); } }); await assert.rejects(denied.startOrResume(rejected.launch()), /quota-not-normal/); assert.equal(rejected.calls.some(c => c[0] === 'record' && c[1] === 'client-reserve'), false);
});
test('managed client serialization prevents duplicate starts and a lost launch ACK stops immediately while retaining durable ownership', async t => {
    const f = fixture(t, { endpoints: 0 }), request = f.launch(), order = [];
    f.options.adapter.startOrResume = async input => { order.push('launch'); return { ...f.receipt(input.actionId), contextHash: input.context.sha256, host: { ...f.receipt(input.actionId).host, deadlineAt: input.deadlineAt } }; };
    f.options.adapter.stop = async () => { order.push('stop'); return { interruptRequested: true, stopped: false, goalPaused: true }; };
    const managed = createManagedNightClient({ ...f.options, consumeActionResult: async () => { order.push('ack-failed'); throw Error('private disk error'); } });
    const [first, duplicate] = await Promise.allSettled([managed.startOrResume(request), managed.startOrResume(request)]);
    assert.equal(first.value.status, 'blocked'); assert.equal(duplicate.status, 'rejected'); assert.deepEqual(order, ['launch', 'ack-failed', 'stop', 'ack-failed']); assert.equal(first.value.host.executionUnknown, true); assert.equal(first.value.managed.launchPersisted, true); assert.equal(first.value.managed.stoppedVerified, false);
    assert.equal(f.manifest.night.clientReservations.length, 1); assert(fs.existsSync(first.value.managed.launchReceiptFile)); assert.equal(managed.recovery(request.actionId).receipt.endpointId, `endpoint-${request.actionId}`);
});
test('failed launch receipt persistence stops the host and preserves reservation plus an explicit unknown recovery receipt', async t => {
    const f = fixture(t, { endpoints: 0 }), request = f.launch(); let stopped = false;
    f.options.adapter.startOrResume = async input => ({ ...f.receipt(input.actionId), contextHash: input.context.sha256, host: { ...f.receipt(input.actionId).host, deadlineAt: input.deadlineAt } });
    f.options.adapter.stop = async () => { stopped = true; return { interruptRequested: true, stopped: false }; };
    const managed = createManagedNightClient({ ...f.options, persistReceipt: (file, data) => { if (path.basename(file).startsWith('client-launch-')) throw Error('synthetic disk failure'); fs.writeFileSync(file, JSON.stringify(data)); }, consumeActionResult: async (_, value) => { assert.equal(stopped, true); assert.equal(value.status, 'blocked'); f.manifest.actions.at(-1).result = value; } });
    const result = await managed.startOrResume(request); assert.equal(result.managed.launchPersisted, false); assert.equal(result.managed.recoveryResultConsumed, true); assert.equal(result.managed.stoppedVerified, false); assert.equal(result.endpointId, `endpoint-${request.actionId}`); assert.equal(f.manifest.night.clientReservations.length, 1); assert(fs.existsSync(result.managed.recoveryFile)); await assert.rejects(managed.startOrResume(request), /already-attempted/);
    const foreign = fixture(t, { endpoints: 0 }), foreignRequest = foreign.launch(); foreign.options.adapter.startOrResume = async () => foreign.receipt('another-action');
    const guarded = createManagedNightClient({ ...foreign.options, consumeActionResult: async (_, value) => { assert.equal(value.endpointId, null); } }); const rejected = await guarded.startOrResume(foreignRequest); assert.equal(rejected.endpointId, null); assert.equal(rejected.host.executionUnknown, true);
});
test('supervisor accepts a verified native Goal continuation turn while fixed one-turn tasks retain their original turn binding', async t => {
    for (const nativeGoal of [true, false]) { const f = fixture(t, { nativeGoal }); await f.supervisor.restore(); const old = f.options.adapter.status; f.options.adapter.status = async input => ({ ...await old(input), turnId: 'continuation-turn' }); const result = await f.supervisor.tick(); assert.equal(result.observationUnknown, !nativeGoal); assert.equal(result.endpoints[0].stopRequested, !nativeGoal); }
});

test('RPC observation errors survive the persisted supervisor receipt without becoming terminal proof', async t => {
    const { rpcError } = require('../lib/night-client-diagnostics');
    const f = fixture(t); await f.supervisor.tick();
    f.options.adapter.status = async () => { throw rpcError('rpc-rejected', 'thread/read', -32603); };
    const result = await f.supervisor.tick(), endpoint = result.endpoints[0];
    assert.equal(result.observationUnknown, true); assert.equal(endpoint.stoppedVerified, false);
    assert.equal(endpoint.diagnostics[0].method, 'thread/read');
    assert.deepEqual(JSON.parse(fs.readFileSync(endpoint.evidenceRef)).diagnostics, endpoint.diagnostics);
});

test('failed managed launches retain RPC diagnostics in durable recovery and do not relaunch', async t => {
    const { rpcError } = require('../lib/night-client-diagnostics');
    const f = fixture(t, { endpoints: 0 }); let launches = 0;
    f.options.adapter.startOrResume = async () => { launches++; throw rpcError('rpc-rejected', 'turn/start', -32603); };
    const managed = createManagedNightClient({ ...f.options, consumeActionResult: async () => {} }), request = f.launch();
    const result = await managed.startOrResume(request), recovery = JSON.parse(fs.readFileSync(result.managed.recoveryFile));
    assert.equal(recovery.stoppedVerified, false); assert.equal(recovery.diagnostics[0].method, 'turn/start');
    await assert.rejects(managed.startOrResume(request), /already-attempted/); assert.equal(launches, 1);
});

test('requesting an interrupt without its ACK is never reported as acknowledged', async t => {
    const f = fixture(t); f.state.unknown = true;
    f.options.adapter.stop = async () => ({ interruptRequested: true, interruptAcknowledged: false, stopped: false, goalPaused: false });
    const result = await f.supervisor.tick();
    assert.equal(result.endpoints[0].stopRequested, true); assert.equal(result.endpoints[0].interruptAcknowledged, false); assert.equal(result.endpoints[0].stoppedVerified, false);
});

test('account-only RPC failures survive a worker checkpoint without fabricated endpoint cleanup', async t => {
    const f = fixture(t, { endpoints: 0 }), { rpcError } = require('../lib/night-client-diagnostics');
    f.options.adapter.usage = async () => { throw rpcError('rpc-timeout', 'account/rateLimits/read'); };
    const result = await f.supervisor.tick();
    assert.equal(result.mode, 'closeout'); assert.equal(result.observationUnknown, true); assert.deepEqual(result.endpoints, []);
    assert.equal(result.diagnostics[0].method, 'account/rateLimits/read');
});

test('client JSONL failures carry safe RPC diagnostics and still close the owned endpoint', async t => {
    const f = fixture(t), { rpcError } = require('../lib/night-client-diagnostics'), { PassThrough } = require('node:stream');
    f.state.stopTerminal = true; const stop = f.options.adapter.stop; let first = true;
    f.options.adapter.stop = async input => { if (first) { first = false; throw rpcError('rpc-rejected', 'turn/interrupt', -32603); } return stop(input); };
    const input = new PassThrough(), output = [];
    input.end(JSON.stringify({ id: 'stop-diagnostic', operation: 'stop', actionId: 'a1' }) + '\n');
    const code = await require('../night-client-worker').main(['--run-directory', f.root, '--interval-ms', '100'], { adapter: f.options.adapter, workerOptions: f.options, input, output: { write: text => output.push(JSON.parse(text)) } });
    const blocked = output.find(row => row.id === 'stop-diagnostic');
    assert.equal(blocked.status, 'blocked'); assert.equal(blocked.diagnostics[0].method, 'turn/interrupt'); assert.equal(blocked.diagnostics[0].rpcCode, -32603);
    assert.equal(code, 0); assert.equal(fs.existsSync(path.join(f.root, 'night-client-worker.lock')), false);
});


test('worker checkpoints local transport exit separately and keeps its lease when that exit is unverified', async t => {
    const f = fixture(t); f.state.stopTerminal = true;
    f.options.adapter.shutdown = async () => ({ localTransportClosed: true, processCleanupVerified: false, endpointStopped: false, forced: true });
    const worker = createClientWorker({ ...f.options, intervalMs: 100 }); await worker.start(); await worker.close();
    const saved = JSON.parse(fs.readFileSync(path.join(f.root, 'evidence/night-operations/client-worker-checkpoint.json')));
    assert.equal(saved.observation.endpoints[0].stoppedVerified, true); assert.equal(saved.observation.transport.processCleanupVerified, false); assert.equal(saved.observation.transport.endpointStopped, false);
    assert.equal(fs.existsSync(path.join(f.root, 'night-client-worker.lock')), true);
});
