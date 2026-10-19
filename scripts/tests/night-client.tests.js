'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createClientAdapter, validateClientAdapter } = require('../lib/night-client');
const { createCodexClientAdapter, probeCodexCli } = require('../lib/night-codex-client');
const now = Date.parse('2026-10-19T01:00:00Z');
const methods = ['thread/start', 'thread/resume', 'thread/read', 'thread/turns/list', 'turn/start', 'turn/interrupt', 'thread/goal/get', 'thread/goal/set', 'account/rateLimits/read', 'collaborationMode/list'];

function fixture(overrides = {}) {
    const calls = [], listeners = new Set(), timers = [], cancelled = [], events = [];
    let goal = overrides.goal || null, threadCount = 0, turnStatus = 'inProgress', readbackCount = 0;
    const transport = {
        async connect() { return { available: true, handshake: true, methods, nativeGoalBudgetDeclared: true, version: 'fixture-version', evidence: 'synthetic-protocol', ...overrides.probe }; },
        async request(method, params) {
            calls.push({ method, params: structuredClone(params) });
            if (overrides.request) { const result = await overrides.request(method, params); if (result !== undefined) return result; }
            if (method === 'collaborationMode/list') return { data: [{ mode: 'plan' }, { mode: 'default' }] };
            if (method === 'thread/start') return { thread: { id: `thread-${++threadCount}` } };
            if (method === 'thread/resume') return { thread: { id: params.threadId } };
            if (method === 'thread/goal/get') {
                readbackCount++;
                return { goal: goal && { ...goal, ...(overrides.badReadback && readbackCount === 2 ? { tokenBudget: null } : {}) } };
            }
            if (method === 'thread/goal/set') {
                goal = { threadId: params.threadId, objective: params.objective || goal?.objective, status: params.status,
                    tokenBudget: params.tokenBudget || goal?.tokenBudget, tokensUsed: goal?.tokensUsed || 0 };
                return { goal };
            }
            if (method === 'turn/start') return { turn: { id: 'turn-1', status: turnStatus } };
            if (method === 'thread/read') return { thread: { id: params.threadId, status: { type: turnStatus === 'inProgress' ? 'active' : 'idle' } } };
            if (method === 'thread/turns/list') return { data: [{ id: 'turn-1', status: turnStatus }] };
            if (method === 'turn/interrupt') return {};
            if (method === 'account/rateLimits/read') return { token: 'private', rateLimitsByLimitId: { codex: { secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: now / 1000 + 86400, token: 'private' } } } };
            throw new Error(`Unexpected fixture RPC: ${method}`);
        },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        close() { return { localTransportClosed: true, endpointStopped: false }; }
    };
    const client = createClientAdapter({ host: 'codex', transport, now: overrides.now || (() => now), setTimeout(fn) { timers.push(fn); return { unref() {} }; }, clearTimeout(timer) { cancelled.push(timer); }, onEvent: value => events.push(value) });
    return { client, transport, calls, timers, cancelled, events, emit(method, params) { for (const listener of listeners) listener({ method, params }); }, setTurn(status) { turnStatus = status; } };
}
function request(extra = {}) {
    return { actionId: 'action-1', prompt: 'Perform the authorized bounded task', cwd: path.resolve(__dirname, '../..'),
        authorization: { actor: 'user', reference: 'authorization:scope' }, deadlineAt: new Date(now + 60000).toISOString(), maxTurns: 1, ...extra };
}

test('vendor-neutral contract uses host adapters and missing adapters fail explicitly', () => {
    assert.throws(() => createClientAdapter({ host: 'unimplemented' }), /supervised/);
    assert.throws(() => validateClientAdapter({ probe() {} }), /requires/);
    assert.throws(() => createCodexClientAdapter({ transport: {} }), /connect and request/);
    assert.equal(probeCodexCli({ command: path.join(__dirname, 'missing-codex-executable'), timeoutMs: 1000 }).available, false);
});
test('probe and staged context do not create threads, set Goals or claim configured budgets', async () => {
    const f = fixture();
    const capability = await f.client.probe();
    assert.equal(capability.nativePlan, true); assert.equal(capability.nativeGoal, true);
    assert.equal(capability.tokenBudgetConfigured, false); assert.equal(capability.inferenceValidated, false);
    assert.equal(capability.derivedSessionBudgetInherited, false);
    assert.deepEqual(f.calls.map(call => call.method), ['collaborationMode/list']);
    assert.equal(f.client.injectContext({ actionId: 'action-1', text: 'Bounded shared context', reference: 'context:hash' }).hostInjected, false);
    assert.equal(f.calls.length, 1);
    f.client.dispose();
});
test('bounded launch maps to one turn and existing launch-result lifecycle', async () => {
    const f = fixture();
    f.client.injectContext({ actionId: 'action-1', text: 'Bounded shared context', reference: 'context:hash' });
    const receipt = await f.client.startOrResume(request());
    assert.equal(receipt.actionId, 'action-1'); assert.equal(receipt.status, 'succeeded'); assert.equal(receipt.endpointId, 'thread-1');
    assert.equal(receipt.host.budget.configured, false); assert.equal(receipt.host.contextInjected, true); assert.equal(receipt.host.supervisionRequired, true);
    assert.equal(receipt.contextHash, createHash('sha256').update('Bounded shared context').digest('hex'));
    assert.equal(f.calls.find(call => call.method === 'thread/start').params.developerInstructions, 'Bounded shared context');
    assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 1);
    await assert.rejects(f.client.startOrResume(request()), /already launched/);
    const stopped = await f.client.stop({ actionId: 'action-1' });
    assert.equal(stopped.interruptRequested, true); assert.equal(stopped.stopped, false);
    assert.equal(stopped.processCleanupVerified, false); assert.equal(stopped.resourceCleanupVerified, false);
    f.setTurn('interrupted'); f.emit('turn/completed', { threadId: receipt.endpointId, turn: { id: 'turn-1', status: 'interrupted' } });
    assert.equal((await f.client.stop({ actionId: 'action-1' })).stopped, true);
    assert.equal(f.client.dispose().endpointStopped, false);
});
test('managed action context verifies its hash before host writes and acknowledges the same hash', async () => {
    const context = { text: 'Managed bounded context', sha256: createHash('sha256').update('Managed bounded context').digest('hex') };
    const invalid = fixture();
    await assert.rejects(invalid.client.startOrResume(request({ context: { ...context, sha256: 'wrong' } })), /SHA-256 mismatch/);
    assert.equal(invalid.calls.some(call => call.method === 'thread/start'), false); invalid.client.dispose();
    const f = fixture(), receipt = await f.client.startOrResume(request({ context }));
    assert.equal(receipt.contextHash, context.sha256);
    assert.equal((await f.client.status({ actionId: 'action-1' })).contextHash, context.sha256);
    f.client.dispose();
});
test('launch authorization, deadline, turn bounds and native mode capability gate host mutations', async () => {
    for (const extra of [{ authorization: null }, { deadlineAt: new Date(now).toISOString() }, { maxTurns: 2 }, { mode: 'invalid' }, { mode: 'plan' }]) {
        const f = fixture(); await assert.rejects(f.client.startOrResume(request(extra)));
        assert.equal(f.calls.some(call => call.method === 'thread/start'), false); f.client.dispose();
    }
    const absent = fixture({ probe: { methods: methods.filter(method => method !== 'turn/interrupt') } });
    assert.equal((await absent.client.probe()).available, false);
    await assert.rejects(absent.client.startOrResume(request()), /lifecycle unavailable/);
    const plan = fixture();
    const receipt = await plan.client.startOrResume(request({ mode: 'plan', model: 'authorized-model-mapping' }));
    assert.equal(receipt.status, 'succeeded');
    assert.deepEqual(plan.calls.find(call => call.method === 'turn/start').params.collaborationMode, { mode: 'plan', settings: { model: 'authorized-model-mapping', developer_instructions: null } });
    absent.client.dispose(); plan.client.dispose();
});
test('native Goal budget is set and read back on this exact thread before turn start', async () => {
    const f = fixture();
    const receipt = await f.client.startOrResume(request({ nativeGoal: { objective: 'Complete authorized task', tokenBudget: 25000 } }));
    assert.equal(receipt.host.budget.configured, true);
    assert.equal(receipt.host.budget.readback, true);
    assert.equal(receipt.host.budget.tokenBudget, 25000);
    assert.equal(receipt.host.budget.threadId, receipt.endpointId);
    const beforeTurn = f.calls.slice(0, f.calls.findIndex(call => call.method === 'turn/start')).map(call => call.method);
    assert.deepEqual(beforeTurn.slice(-3), ['thread/goal/get', 'thread/goal/set', 'thread/goal/get']);
    assert.equal(f.calls.find(call => call.method === 'thread/goal/set').params.origin, 'user');
    const usage = await f.client.usage({ actionId: 'action-1' });
    assert.equal(usage.goal.tokenBudget, 25000); assert.equal(usage.weeklyTokensEquivalent, null);
    assert.equal(JSON.stringify(usage).includes('private'), false);
    await f.client.stop({ actionId: 'action-1' });
    assert.equal(f.calls.some(call => call.method === 'thread/goal/set' && call.params.status === 'paused'), true);
    f.client.dispose();
});
test('failed budget readback blocks business turn and records unresolved host state', async () => {
    const f = fixture({ badReadback: true });
    const receipt = await f.client.startOrResume(request({ nativeGoal: { objective: 'Complete task', tokenBudget: 25000 } }));
    assert.equal(receipt.status, 'blocked'); assert.match(receipt.error, /readback failed/);
    assert.equal(receipt.host.budgetConfigured, false); assert.equal(receipt.host.executionUnknown, true); assert.equal(receipt.host.goalPaused, true);
    assert.equal(f.calls.some(call => call.method === 'turn/start'), false);
    await assert.rejects(f.client.startOrResume(request()), /already launched/);
    f.client.dispose();
});
test('Goal accounting cannot be reset, inherited from a parent or assumed on a resumed child', async () => {
    for (const goal of [
        { threadId: 'child', objective: 'A different objective', status: 'active', tokenBudget: 25000, tokensUsed: 20 },
        { threadId: 'parent', objective: 'Complete task', status: 'active', tokenBudget: 25000, tokensUsed: 20 },
        { threadId: 'child', objective: 'Complete task', status: 'budgetLimited', tokenBudget: 25000, tokensUsed: 25000 }
    ]) {
        const f = fixture({ goal });
        const receipt = await f.client.startOrResume(request({ threadId: 'child', nativeGoal: { objective: 'Complete task', tokenBudget: 25000 } }));
        assert.equal(receipt.status, 'blocked'); assert.equal(f.calls.some(call => call.method === 'turn/start'), false);
        assert.equal(f.calls.some(call => call.method === 'thread/goal/set' && call.params.objective !== undefined), false); f.client.dispose();
    }
    const active = fixture({ goal: { threadId: 'child', objective: 'Complete task', status: 'active', tokenBudget: 25000, tokensUsed: 2 } });
    assert.equal((await active.client.startOrResume(request({ threadId: 'child' }))).status, 'blocked'); active.client.dispose();
});
test('missing native Goal capability uses bounded tasks and refuses uninspected resume', async () => {
    const f = fixture({ probe: { nativeGoalBudgetDeclared: false, methods: methods.filter(method => !method.startsWith('thread/goal/')) } });
    assert.equal((await f.client.startOrResume(request())).status, 'succeeded');
    assert.equal(f.calls.some(call => call.method.startsWith('thread/goal/')), false);
    await assert.rejects(f.client.startOrResume(request({ actionId: 'action-2', nativeGoal: { objective: 'Task', tokenBudget: 5 } })), /capability/);
    await assert.rejects(f.client.startOrResume(request({ actionId: 'action-2', threadId: 'child' })), /supervised/);
    f.client.dispose();
});
test('deadline requests interrupt and persisted launch receipts can restore observed status', async () => {
    const f = fixture(); const receipt = await f.client.startOrResume(request());
    f.timers[0](); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.some(call => call.method === 'turn/interrupt'), true);
    assert.equal(f.events[0].receipt.stopped, false);
    const resumed = fixture(); resumed.setTurn('completed');
    assert.equal(resumed.client.restoreEndpoint(receipt).hostStatusVerified, false);
    assert.equal((await resumed.client.status({ actionId: 'action-1' })).completed, true);
    assert.equal(resumed.calls.some(call => call.method === 'thread/start' || call.method === 'turn/start'), false);
    f.client.dispose(); resumed.client.dispose();
});
test('native Goal keeps deadline supervision across continuation turns', async () => {
    const f = fixture({ request(method) { if (method === 'thread/turns/list') return { data: [{ id: 'turn-2', status: 'inProgress' }] }; } });
    const receipt = await f.client.startOrResume(request({ nativeGoal: { objective: 'Complete task', tokenBudget: 25000 } }));
    f.emit('turn/completed', { threadId: receipt.endpointId, turn: { id: 'turn-1', status: 'completed' } });
    assert.equal(f.cancelled.length, 0);
    assert.equal((await f.client.status({ actionId: 'action-1' })).completed, false);
    f.emit('turn/started', { threadId: receipt.endpointId, turn: { id: 'turn-2', status: 'inProgress' } });
    f.timers[0](); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.findLast(call => call.method === 'turn/interrupt').params.turnId, 'turn-2');
    assert.equal(f.events[0].kind, 'host-stop-unconfirmed');
    f.client.dispose();
});
test('Goal pause failure still attempts turn interruption and requires a running supervisor', async () => {
    const f = fixture({ request(method, params) { if (method === 'thread/goal/set' && params.status === 'paused') throw new Error('synthetic pause rejection'); } });
    await f.client.startOrResume(request({ nativeGoal: { objective: 'Complete task', tokenBudget: 25000 } }));
    const stopped = await f.client.stop({ actionId: 'action-1' });
    assert.equal(stopped.goalPaused, false); assert.equal(stopped.stopped, false); assert.equal(stopped.interruptAcknowledged, true);
    assert.ok(stopped.errors.includes('goal-pause-unconfirmed')); assert.equal(stopped.supervisionRequired, true);
    assert.equal(f.calls.some(call => call.method === 'turn/interrupt'), true);
    f.client.dispose();
});
test('restored native Goal verifies its thread and interrupts the current continuation turn after deadline', async () => {
    const initial = fixture();
    const receipt = await initial.client.startOrResume(request({ nativeGoal: { objective: 'Complete task', tokenBudget: 25000 } }));
    initial.client.dispose();
    const resumed = fixture({ now: () => now + 60001,
        goal: { threadId: receipt.endpointId, objective: 'Complete task', tokenBudget: 25000, tokensUsed: 1000, status: 'active' },
        request(method, params) {
            if (method === 'thread/turns/list') { assert.equal(params.threadId, receipt.endpointId); return { data: [{ id: receipt.host.turnId, status: 'completed' }, { id: 'turn-continuation', status: 'inProgress' }] }; }
        } });
    resumed.client.restoreEndpoint(receipt);
    const observed = await resumed.client.status({ actionId: receipt.actionId });
    assert.equal(observed.turnId, 'turn-continuation'); assert.equal(observed.turnStatus, 'inProgress'); assert.equal(observed.completed, false);
    assert.ok(resumed.calls.findIndex(call => call.method === 'thread/goal/get') < resumed.calls.findIndex(call => call.method === 'thread/turns/list'));
    assert.equal(resumed.calls.findLast(call => call.method === 'turn/interrupt').params.turnId, 'turn-continuation');
    assert.equal(resumed.calls.some(call => ['thread/start', 'thread/resume', 'turn/start'].includes(call.method)), false);
    resumed.client.dispose();
    const mismatched = fixture({ goal: { threadId: 'other-thread', objective: 'Complete task', tokenBudget: 25000, tokensUsed: 1000, status: 'active' } });
    mismatched.client.restoreEndpoint(receipt);
    await assert.rejects(mismatched.client.status({ actionId: receipt.actionId }), /identity or budget readback failed/);
    assert.equal(mismatched.calls.some(call => call.method === 'thread/turns/list'), false); mismatched.client.dispose();
});
test('restored bounded task stays pinned to its original turn when another turn is active', async () => {
    const initial = fixture(), receipt = await initial.client.startOrResume(request()); initial.client.dispose();
    const resumed = fixture({ request(method) {
        if (method === 'thread/turns/list') return { data: [{ id: 'other-turn', status: 'inProgress' }, { id: receipt.host.turnId, status: 'completed' }] };
    } });
    resumed.client.restoreEndpoint(receipt);
    const observed = await resumed.client.status({ actionId: receipt.actionId });
    assert.equal(observed.turnId, receipt.host.turnId); assert.equal(observed.completed, true);
    assert.equal(resumed.calls.some(call => ['thread/goal/get', 'turn/interrupt'].includes(call.method)), false);
    resumed.client.dispose();
});
