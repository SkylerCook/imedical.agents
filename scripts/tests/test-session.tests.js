"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestSession } = require('../lib/test-session');
function clock() {
  let time = 0, id = 0; const jobs = new Map();
  return { now: () => time, setTimeout(fn, delay) { jobs.set(++id, { at: time + delay, fn }); return id; }, clearTimeout(key) { jobs.delete(key); },
    size: () => jobs.size,
    async advance(ms) { time += ms; for (const [key, job] of [...jobs]) if (job.at <= time && jobs.delete(key)) job.fn(); await new Promise(resolve => setImmediate(resolve)); } };
}
function fixture(overrides = {}, policy = {}) {
  const c = clock(), calls = [];
  const adapter = Object.fromEntries(['check', 'heartbeat', 'reauthenticate', 'restore'].map(name => [name, async () => { calls.push(name); return { status: name === 'restore' ? 'ready' : 'valid' }; }]));
  Object.assign(adapter, overrides);
  const session = createTestSession({ adapter, clock: c, policy: { verifiedHeartbeat: true, backgroundTimers: true, idleTimeoutMs: 100, heartbeatAfterMs: 60, requestTimeoutMs: 10, deadlineAt: 1000, ...policy } });
  return { c, calls, session };
}
test('verified activity postpones heartbeat; stop clears all timers', async () => {
  const { c, calls, session } = fixture();
  assert.equal(await session.start(), true);
  await c.advance(40); session.noteActivity({ verifiedExtendsSession: true });
  await c.advance(20); assert.deepEqual(calls, ['check']);
  await c.advance(40); assert.deepEqual(calls, ['check', 'heartbeat']);
  assert.equal(session.stop().cleanupVerified, true); assert.equal(c.size(), 0);
  await c.advance(1000); assert.equal(calls.length, 2);
});
test('missing verified endpoint falls back to checks without heartbeat', async () => {
  const { c, calls, session } = fixture({}, { verifiedHeartbeat: false });
  await session.start(); await c.advance(200); await session.ensureReady();
  assert.deepEqual(calls, ['check', 'check']); session.stop();
});
test('expired checks share one reauthentication and restore sequence', async () => {
  const { calls, session } = fixture({ check: async () => ({ status: 'expired' }) });
  assert.deepEqual(await Promise.all([session.start(), session.ensureReady()]), [true, true]);
  assert.deepEqual(calls, ['reauthenticate', 'restore']); session.stop();
});
test('unknown heartbeat checks auth and blocks without blind login', async () => {
  const { c, calls, session } = fixture({ heartbeat: async () => ({ status: 'unknown' }) });
  await session.start(); await c.advance(60);
  assert.equal(session.snapshot().state, 'blocked');
  assert.deepEqual(calls, ['check', 'check']); session.stop();
});
test('timeout retains outstanding ownership and never starts overlapping operations', async () => {
  let finish;
  const { c, session } = fixture({ heartbeat: () => new Promise(resolve => { finish = resolve; }) });
  await session.start(); await c.advance(60); await c.advance(10);
  assert.equal(await session.ensureReady(), false);
  assert.equal(session.stop().cleanupVerified, false);
  finish({ status: 'valid' }); await c.advance(0);
  assert.equal(session.snapshot().cleanupVerified, true);
  assert.equal(c.size(), 0);
});
test('deadline stops a live heartbeat owner', async () => {
  const { c, session } = fixture({}, { deadlineAt: 50 });
  await session.start(); await c.advance(50);
  assert.equal(session.snapshot().state, 'stopped'); assert.equal(c.size(), 0);
});
test('human authentication and failed restoration preserve a blocked exit', async () => {
  for (const status of ['human-required', 'unknown']) {
    const { session } = fixture({ check: async () => ({ status: 'expired' }), reauthenticate: async () => ({ status }) });
    assert.equal(await session.start(), false); assert.equal(session.snapshot().state, 'blocked'); session.stop();
  }
});
test('expired heartbeat restores once and resumes; stop during reauthentication cannot revive', async () => {
  const { c, session, calls } = fixture({ heartbeat: async () => ({ status: 'expired' }) });
  await session.start(); await c.advance(60);
  assert.equal(session.snapshot().state, 'ready');
  assert.deepEqual(calls, ['check', 'reauthenticate', 'restore']); session.stop();
  let finish;
  const f = fixture({ heartbeat: async () => ({ status: 'expired' }), reauthenticate: () => new Promise(resolve => { finish = resolve; }) });
  await f.session.start(); await f.c.advance(60); f.session.stop(); finish({ status: 'valid' }); await f.c.advance(0);
  assert.equal(f.session.snapshot().state, 'stopped'); assert.equal(f.c.size(), 0);
});
test('one adapter has one owner; release only after stop', async () => {
  const adapter = { check: async () => ({ status: 'valid' }) };
  const c = clock(), args = { adapter, clock: c, policy: { deadlineAt: 100 } };
  const first = createTestSession(args);
  assert.throws(() => createTestSession(args), /already has an owner/);
  first.stop(); const second = createTestSession(args); second.stop();
});
