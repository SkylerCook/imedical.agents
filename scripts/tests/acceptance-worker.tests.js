'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { PassThrough } = require('node:stream');
const { createAcceptanceWorker, serveAcceptanceWorker } = require('../lib/acceptance-worker');
const { createTestExecutor } = require('../lib/playwright-runner');
const { createTestSession } = require('../lib/test-session');
const repo = path.resolve(__dirname, '../..');
const adapter = extra => ({ prepare: async () => true, verifyVersion: async () => true, execute: async () => {}, assert: async () => [{ id: 'actual', passed: true, evidenceRefs: ['fixture/assert'] }], sideEffects: async () => true, close: async () => true, ...extra });
const specification = extra => ({ demandId: 'one', caseId: 'one-case', role: 'reader', level: 'external-api', entry: 'actual-api', effects: 'read-only', scope: ['fixture'], version: 'v1', createAdapter: () => adapter(), ...extra });
function fixture(t) {
    const root = require('./fixtures/temp-directory').createTempDirectory('acceptance-worker-');
    let worker;
    t.after(async () => { await worker?.stop(); fs.rmSync(root, { recursive: true, force: true }); });
    const runtime = path.join(root, 'runtime.cjs'), profileFile = path.join(root, 'profile.cjs'); fs.writeFileSync(profileFile, 'module.exports={};');
    fs.writeFileSync(runtime, `const {EventEmitter}=require('node:events'); const state=exports.state={contexts:[],connected:false,closed:0}; exports.chromium={launch:async()=>{state.connected=true;return {version:()=> 'synthetic',isConnected:()=>state.connected,close:async()=>{state.connected=false;state.closed++},newContext:async()=>{const pages=[];const context=Object.assign(new EventEmitter(),{valid:false,setDefaultTimeout(){},setDefaultNavigationTimeout(){},pages:()=>pages.filter(p=>!p.isClosed()),close:async()=>{for(const p of pages)await p.close()},newPage:async()=>{let closed=false;const frame={parentFrame:()=>null};const page=Object.assign(new EventEmitter(),{mainFrame:()=>frame,isClosed:()=>closed,close:async()=>{closed=true}});pages.push(page);context.emit('page',page);return page},request:{fetch:async()=>({status:()=>200,json:async()=>({ok:true})})}});state.contexts.push(context);return context}}}};`);
    const calls = [], exitReceipts = [], deadlineAt = Date.now() + 60000;
    const manifest = { night: { limits: { stopAt: new Date(deadlineAt).toISOString() }, demands: ['one', 'two'].map(id => ({ id, frozenVersion: 'v1', assessment: { post: { route: 'external-api' } }, sourceScopes: [{ repoRoot: repo, scopes: ['scripts/lib/test-session.js'] }] })) }, workItems: ['one', 'two'].map(id => ({ id, status: 'pending', night: { phase: 'verification', demandId: id, role: 'reader', effects: 'read-only', route: 'external-api' } })) };
    const managed = {
        begin(execution) { calls.push(['begin', execution.workItemId]); return { item: manifest.workItems.find(w => w.id === execution.workItemId), manifest, context: { workspaceRoot: root }, operation: { deadlineAt } }; },
        checkpoint(binding) { calls.push(['checkpoint', binding.item.id]); }, consumeTest(binding, result) { calls.push(['consume', binding.item.id, result.status]); }, finish(binding, result) { calls.push(['finish', binding.item.id, result.status]); },
        preflightStart() { calls.push(['preflight-start']); }, preflight(_, receipt) { calls.push(['preflight', receipt]); return { preflight: { state: 'ready', issues: [] } }; }
    };
    let logins = 0, checks = 0, restores = 0;
    const options = { projectRoot: root, runtimeModule: runtime, deadlineAt, timeoutMs: 1000, closeTimeoutMs: 100,
        authentication: { mode: 'browser-session', identity: 'fixture-reader', configuration: { variant: 'one' } },
        createSession: async ({ context }) => createTestSession({ adapter: {
            check: async () => { checks++; return { status: context.valid ? 'valid' : 'expired' }; },
            reauthenticate: async () => { logins++; context.valid = true; return { status: 'valid' }; },
            restore: async () => { restores++; await context.newPage(); return { status: 'ready' }; }
        }, policy: { deadlineAt, requestTimeoutMs: 1000 } }) };
    const cases = ['one', 'two'].map(id => specification({ demandId: id, caseId: `${id}-case`, createAdapter: async ({ context, apiRequest }) => { let page, ok; return adapter({ prepare: async () => { page = await context.newPage(); return true; }, execute: async () => { ok = (await (await apiRequest('http://fixture.invalid/api')).json()).ok; }, assert: async () => [{ id: 'api', passed: ok, evidenceRefs: ['fixture/api'] }], close: async () => { await page.close(); return true; } }); } }));
    const profile = { options, cases, preflight: async ({ executor }) => { await executor.prepareOwner(cases[0]); return { environmentAlias: 'local', authorizations: [], checks: [] }; } };
    worker = createAcceptanceWorker({ profile, profileFile, runDirectory: root, managed, loadManifest: () => manifest, recordOwnerExit: receipt => exitReceipts.push(receipt) });
    const request = (operation, extra = {}) => worker.request({ id: `${operation}-${Math.random()}`, operation, deadlineAt: Date.now() + 10000, ...extra });
    return { root, profile, profileFile, worker, request, options, calls, manifest, exitReceipts, runtime: require(runtime).state, counters: () => ({ logins, checks, restores }) };
}
test('preflight and two managed demands share one authentication owner and retained home', async t => {
    const f = fixture(t), preflight = await f.request('preflight');
    assert.equal(preflight.result.schema, 'imedical-night-preflight/v2'); assert.equal(preflight.result.state, 'ready');
    assert.equal(preflight.result.cleanupVerified, false); assert.equal(preflight.result.resourceDisposition.retainedOwnersControllable, true);
    for (const id of ['one', 'two']) { const response = await f.request('verify', { workItemId: id, environmentAlias: 'local' }); assert.equal(response.result.status, 'scope-passed', JSON.stringify(response)); assert.equal(response.result.results.length, 1); assert.equal(response.result.results[0].acceptance.level, 'external-api'); }
    assert.deepEqual(f.counters(), { logins: 1, checks: 3, restores: 1 }); assert.equal(f.runtime.contexts.length, 1); assert.equal(f.runtime.contexts[0].pages().length, 1);
    assert.deepEqual(f.calls.filter(c => ['begin', 'consume', 'finish'].includes(c[0])).map(c => c.slice(0, 2)), [['begin', 'one'], ['consume', 'one'], ['finish', 'one'], ['begin', 'two'], ['consume', 'two'], ['finish', 'two']]);
    const stopped = await f.request('stop'); assert.equal(stopped.result.cleanupVerified, true); assert.equal(f.runtime.connected, false); assert.equal(f.runtime.contexts[0].pages().length, 0);
    assert.equal(f.exitReceipts.length, 1); assert.equal(f.exitReceipts[0].ownerRef, preflight.result.retainedOwners[0].ownerRef); assert(fs.existsSync(f.exitReceipts[0].evidenceRef));
});
test('confirmed expiry recovers once; distinct identity, role, environment and config isolate owners', async t => {
    const f = fixture(t); await f.request('preflight'); f.runtime.contexts[0].valid = false;
    assert.equal((await f.request('verify', { workItemId: 'one', environmentAlias: 'local' })).result.status, 'scope-passed'); assert.equal(f.counters().logins, 2);
    for (const extra of [{ authentication: { mode: 'browser-session', identity: 'second' } }, { role: 'writer' }, { environmentAlias: 'other' }, { authentication: { mode: 'browser-session', identity: 'fixture-reader', configuration: { variant: 'two' } } }]) await f.worker.executor.prepareOwner(specification(extra));
    assert.equal(f.runtime.contexts.length, 5); assert.equal(new Set(f.worker.snapshot().retainedOwners.map(o => o.ownerRef)).size, 5);
    assert.equal(f.worker.snapshot().retainedOwners.some(o => o.identityReference === 'second'), false);
});
test('case deadline aborts one case without stopping worker; unresolved work blocks later demands', async t => {
    const f = fixture(t); await f.request('preflight');
    let observedAbort = false;
    const timed = await f.worker.executor.run(specification({ createAdapter: ({ signal }) => adapter({ execute: () => new Promise((_, reject) => signal.addEventListener('abort', () => { observedAbort = true; reject(new Error('private')); }, { once: true })) }) }), { deadlineAt: Date.now() + 30 });
    assert.equal(timed.status, 'review-pending'); assert.equal(timed.failureStage, 'execute'); assert.equal(observedAbort, true); assert.equal(f.worker.snapshot().stopped, false);
    assert.equal((await f.request('verify', { workItemId: 'two', environmentAlias: 'local' })).result.status, 'scope-passed');
    let release;
    await f.worker.executor.run(specification({ createAdapter: () => adapter({ execute: () => new Promise(resolve => { release = resolve; }) }) }), { deadlineAt: Date.now() + 30 });
    const blocked = await f.request('verify', { workItemId: 'one', environmentAlias: 'local' }); assert.equal(blocked.error.category, 'pending-operations'); assert.equal(f.calls.filter(c => c[0] === 'begin').length, 1);
    const stopped = await f.request('stop'); assert.equal(stopped.result.cleanupVerified, false); assert.equal(f.runtime.connected, false); release(); await new Promise(resolve => setImmediate(resolve));
    const reconciled = await f.request('stop'); assert.equal(reconciled.result.cleanupVerified, true); assert.equal(f.exitReceipts.length, 2); assert.notEqual(f.exitReceipts[0].evidenceRef, f.exitReceipts[1].evidenceRef);
});
test('unknown authentication never logs in repeatedly and strict UI requires an actual target assertion', async t => {
    const f = fixture(t); const owner = await f.worker.executor.prepareOwner(specification()); f.runtime.contexts[0].valid = true;
    const other = createTestExecutor({ ...f.options, createSession: () => createTestSession({ adapter: { check: async () => ({ status: 'unknown' }), reauthenticate: async () => { throw new Error('must not login'); } }, policy: { deadlineAt: f.options.deadlineAt } }) }); t.after(() => other.stop());
    await assert.rejects(other.prepareOwner(specification()), /authentication-unresolved/); await assert.rejects(other.prepareOwner(specification()), /authentication-unresolved/);
    await assert.rejects(f.worker.executor.run(specification({ strictData: true, level: 'ui' })), /ui-target-assertion-required/); assert.equal(f.worker.snapshot().retainedOwners[0].ownerRef, owner.ownerRef);
});
test('verification cannot introduce a different authentication owner after preflight', async t => {
    const f = fixture(t); await f.request('preflight');
    f.profile.options.authentication = { mode: 'browser-session', identity: 'changed' };
    const result = await f.request('verify', { workItemId: 'one', environmentAlias: 'local' });
    assert.equal(result.result.status, 'review-pending'); assert.equal(result.result.failureStage, 'authentication'); assert.equal(f.runtime.contexts.length, 1); assert.equal(f.counters().logins, 1);
});
test('restricted JSONL rejects arbitrary operations and EOF stops its owner', async t => {
    const f = fixture(t), input = new PassThrough(), output = new PassThrough(); let text = ''; output.on('data', chunk => { text += chunk; });
    const serving = serveAcceptanceWorker(f.worker, input, output);
    input.end('{"id":"bad","operation":"evaluate","code":"private"}\n'); assert.equal(await serving, 0);
    assert.equal(JSON.parse(text).error.category, 'request-contract'); assert.equal(text.includes('private'), false); assert.equal(f.worker.snapshot().stopped, true);
});
test('batch deadline stops an idle JSONL worker without waiting for stdin EOF', async t => {
    const f = fixture(t), profile = { ...f.profile, options: { projectRoot: f.root, deadlineAt: Date.now() + 40, timeoutMs: 100, closeTimeoutMs: 100 } };
    const worker = createAcceptanceWorker({ profile, profileFile: f.profileFile, runDirectory: f.root, recordOwnerExit() {} }); t.after(() => worker.stop());
    const input = new PassThrough(), output = new PassThrough();
    assert.equal(await serveAcceptanceWorker(worker, input, output), 0); assert.equal((await worker.closed).cleanupVerified, true); assert.equal(worker.snapshot().stopped, true);
    assert.equal((await worker.request({ id: 'late', operation: 'preflight', deadlineAt: Date.now() + 20 })).error.category, 'worker-stopped');
});
test('host cancellation exits an idle worker and clears its batch deadline', async t => {
    const f = fixture(t), controller = new AbortController(), worker = createAcceptanceWorker({ profile: { ...f.profile, options: { projectRoot: f.root, deadlineAt: Date.now() + 60000, signal: controller.signal } }, profileFile: f.profileFile, runDirectory: f.root, recordOwnerExit() {} });
    t.after(() => worker.stop()); const input = new PassThrough(), output = new PassThrough(); const serving = serveAcceptanceWorker(worker, input, output); controller.abort();
    assert.equal(await serving, 0); assert.equal(worker.snapshot().stopped, true); assert.equal((await worker.closed).cleanupVerified, true);
});
