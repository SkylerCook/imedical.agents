"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { createRequestCollector, runTestCase } = require('../lib/test-evidence');
test('request ancestry survives detach and late target assignment; cancellation stays visible', async () => {
  const source = new EventEmitter(); const parent = { parentFrame: () => null };
  const child = { parentFrame: () => parent }, grandchild = { parentFrame: () => child };
  const collector = createRequestCollector(source, { early: true, resourceKey: () => 'app' });
  const req = { frame: () => grandchild };
  source.emit('request', req); grandchild.parentFrame = () => { throw new Error('detached'); };
  collector.setTarget(parent); collector.setPhase('closing'); source.emit('requestfailed', req);
  assert.equal(collector.snapshot()[0].ownership, 'case-descendant-frame');
  assert.equal(collector.snapshot()[0].failed, true);
  assert.equal(collector.snapshot()[0].failedPhase, 'closing');
  await collector.stop(); assert.equal(source.listenerCount('request'), 0);
});
test('actual response hash is required; late collection and later old resource fail', async () => {
  const source = new EventEmitter(), frame = { parentFrame: () => null };
  const collector = createRequestCollector(source, { early: true, resourceKey: () => 'app' }); collector.setTarget(frame);
  const req = { frame: () => frame, resourceType: () => 'script' };
  source.emit('request', req); source.emit('response', { request: () => req, status: () => 200, body: async () => Buffer.from('new') });
  const hash = createHash('sha256').update('new').digest('hex');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(collector.loaded('app', hash), true);
  const old = { frame: () => frame, resourceType: () => 'script' }; source.emit('request', old); source.emit('response', { request: () => old, status: () => 200, body: async () => Buffer.from('old') });
  await collector.stop(); assert.equal(collector.loaded('app', hash), false);
  const late = createRequestCollector(source, { early: false }); late.setTarget(frame);
  assert.equal(late.loaded('app', hash), false); await late.stop();
});
test('incomplete ancestry remains unverified', async () => {
  const source = new EventEmitter(), collector = createRequestCollector(source);
  source.emit('request', { frame: () => ({ parentFrame() { throw new Error('missing'); } }) });
  collector.setTarget({}); assert.equal(collector.snapshot()[0].ownership, 'frame-lineage-unverified'); await collector.stop();
});
function adapter(overrides = {}) { return { prepare: async () => true, verifyVersion: async () => true, execute: async () => {}, assert: async () => [{ id: 'visible-and-state', passed: true, evidenceRefs: ['case/proof'] }], sideEffects: async () => true, close: async () => true, ...overrides }; }
function run(a) { return runTestCase({ demandId: 'synthetic', caseId: 'case', scope: ['view'], version: 'frozen', adapter: a }); }
test('normal pass, partial evidence, changed version and cleanup failure stay distinct', async () => {
  assert.equal((await run(adapter())).status, 'passed');
  assert.equal((await run(adapter({ sideEffects: async () => null }))).status, 'review-pending');
  assert.equal((await run(adapter({ verifyVersion: async () => false }))).failureCategory, 'version');
  assert.equal((await run(adapter({ close: async () => false }))).status, 'review-pending');
  assert.equal((await run(adapter({ assert: async () => [{ id: 'visible', passed: false }] }))).status, 'failed');
});
test('unknown write executes once and always cleans up without exposing raw error', async () => {
  let writes = 0, closed = 0;
  const result = await run(adapter({ execute: async () => { writes++; throw new Error('private-token'); }, close: async () => { closed++; return true; } }));
  assert.equal(writes, 1); assert.equal(closed, 1); assert.equal(result.failureCategory, 'execution-unknown');
  assert.equal(JSON.stringify(result).includes('private-token'), false);
});
test('unresolved response collection has a bounded close and does not fake cleanup', async () => {
  const source = new EventEmitter(), frame = { parentFrame: () => null };
  const collector = createRequestCollector(source, { early: true, resourceKey: () => 'app' });
  const req = { frame: () => frame, resourceType: () => 'script' }; collector.setTarget(frame);
  let finish;
  source.emit('request', req); source.emit('response', { request: () => req, status: () => 200, body: () => new Promise(resolve => { finish = resolve; }) });
  const result = await collector.stop({ timeoutMs: 5 });
  assert.equal(result.cleanupVerified, false); assert.equal(source.listenerCount('response'), 0);
  finish(Buffer.from('done')); assert.equal((await collector.stop()).cleanupVerified, true);
});
test('fetching a new version separately cannot prove the frame loaded it', async () => {
  const source = new EventEmitter(), frame = { parentFrame: () => null };
  const collector = createRequestCollector(source, { early: true, resourceKey: () => 'app' });
  const req = { frame: () => frame, resourceType: () => 'fetch' }; collector.setTarget(frame);
  source.emit('request', req); source.emit('response', { request: () => req, status: () => 200, body: async () => Buffer.from('new') });
  await collector.stop(); assert.equal(collector.loaded('app', createHash('sha256').update('new').digest('hex')), false);
});
test('caller and adapter mutation cannot replace the frozen version identity', async () => {
  const version = { hash: 'frozen' }, observed = [];
  const result = await runTestCase({ caseId: 'frozen', scope: ['view'], version, adapter: adapter({
    verifyVersion: async value => { observed.push(value.hash); value.hash = 'changed'; return true; },
    execute: async () => { version.hash = 'caller-change'; }
  }) });
  assert.deepEqual(observed, ['frozen', 'frozen']); assert.equal(result.version.hash, 'frozen');
});
