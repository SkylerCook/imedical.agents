"use strict";

const owners = new WeakMap();
// The adapter owns credentials and its browser. This module only retains status.
function createTestSession({ adapter, policy = {}, clock = { now: Date.now, setTimeout, clearTimeout } }) {
  if (!adapter || typeof adapter.check !== 'function') throw new Error('Session check adapter required');
  if (owners.has(adapter)) throw new Error('Session adapter already has an owner');
  const enabled = policy.verifiedHeartbeat === true && policy.backgroundTimers === true;
  const { idleTimeoutMs, heartbeatAfterMs, requestTimeoutMs = 10000, deadlineAt } = policy;
  if (!(requestTimeoutMs > 0 && requestTimeoutMs <= 2147483647)) throw new Error('Invalid request timeout');
  if (enabled && (!(heartbeatAfterMs > 0 && heartbeatAfterMs < idleTimeoutMs) || !Number.isFinite(idleTimeoutMs) || typeof adapter.heartbeat !== 'function')) throw new Error('Verified heartbeat requires a finite idle timeout and shorter interval');
  if (!Number.isFinite(deadlineAt) || deadlineAt <= clock.now() || deadlineAt - clock.now() > 2147483647) throw new Error('Future batch deadline within timer range required');
  owners.set(adapter, true);
  let state = 'idle', timer, deadlineTimer, active, readyPromise, lastActivity = clock.now();
  const events = [];
  function record(kind) { events.push({ kind, at: clock.now(), category: 'session-maintenance' }); }
  function clearTimer() { if (timer !== undefined) clock.clearTimeout(timer); timer = undefined; }
  function stop(reason = 'stopped') {
    clearTimer();
    if (deadlineTimer !== undefined) clock.clearTimeout(deadlineTimer);
    deadlineTimer = undefined;
    state = 'stopped';
    if (active) active.controller.abort();
    else owners.delete(adapter);
    record(reason === 'deadline' ? 'deadline' : 'stopped');
    return snapshot();
  }
  function snapshot() { return { state, heartbeatEnabled: enabled, pendingOperation: Boolean(active), cleanupVerified: state === 'stopped' && !active, lastActivity, events: events.map(e => ({ ...e })) }; }
  function block(kind) { if (state !== 'stopped') { state = 'blocked'; clearTimer(); record(kind); } }
  async function invoke(method) {
    if (state === 'stopped' || clock.now() >= deadlineAt) { stop('deadline'); return 'stopped'; }
    if (active) throw new Error('Session operation already in flight');
    const operation = { controller: new AbortController() };
    active = operation;
    let timeout;
    // Keep the active lease until the underlying adapter settles, even after timeout.
    const work = Promise.resolve().then(() => operation.controller.signal.aborted ? { status: 'stopped' } : adapter[method]({ signal: operation.controller.signal }))
      .then(value => value?.status || 'unknown', () => 'unknown')
      .finally(() => { if (active === operation) active = undefined; if (state === 'stopped') owners.delete(adapter); });
    const expiry = new Promise(resolve => {
      timeout = clock.setTimeout(() => { operation.controller.abort(); resolve('timeout'); }, requestTimeoutMs);
    });
    const result = await Promise.race([work, expiry]);
    clock.clearTimeout(timeout);
    if (state === 'stopped') return 'stopped';
    if (result === 'timeout') block('operation-timeout');
    return ['valid', 'expired', 'restored', 'ready', 'human-required', 'timeout', 'stopped'].includes(result) ? result : 'unknown';
  }
  function schedule() {
    clearTimer();
    if (state !== 'ready' || !enabled) return;
    timer = clock.setTimeout(() => { timer = undefined; void pulse().catch(() => block('adapter-error')); }, Math.max(0, lastActivity + heartbeatAfterMs - clock.now()));
  }
  async function recover() {
    if (typeof adapter.reauthenticate !== 'function' || typeof adapter.restore !== 'function') { block('human-required'); return false; }
    record('reauthentication');
    if (await invoke('reauthenticate') !== 'valid') { block('authentication-unresolved'); return false; }
    if (await invoke('restore') !== 'ready') { block('preconditions-unresolved'); return false; }
    return true;
  }
  async function checkReady() {
    const status = await invoke('check');
    if (status !== 'valid' && !(status === 'expired' && await recover())) { block('session-unresolved'); return false; }
    if (state === 'stopped') return false;
    state = 'ready';
    // A check need not extend idle time. Only the adapter's explicit activity signal does.
    schedule();
    return true;
  }
  function ensureReady() {
    if (readyPromise) return readyPromise;
    if (state === 'stopped' || state === 'blocked') return Promise.resolve(false);
    if (state === 'idle') deadlineTimer = clock.setTimeout(() => stop('deadline'), Math.max(0, deadlineAt - clock.now()));
    clearTimer();
    readyPromise = (async () => {
      if (active) return false;
      state = 'checking';
      return checkReady();
    })().finally(() => { readyPromise = undefined; });
    return readyPromise;
  }
  async function pulse() {
    if (state !== 'ready' || active || readyPromise) { schedule(); return; }
    state = 'checking';
    const status = await invoke('heartbeat');
    if (status === 'valid') {
      lastActivity = clock.now(); record('heartbeat-valid'); state = 'ready'; schedule();
    } else if (status === 'expired') {
      if (await recover()) { lastActivity = clock.now(); state = 'ready'; schedule(); }
    } else if (status !== 'stopped' && status !== 'timeout') {
      // An unknown transport outcome does not establish expired authentication.
      if (await invoke('check') === 'expired') {
        if (await recover()) { lastActivity = clock.now(); state = 'ready'; schedule(); }
      } else block('heartbeat-unresolved');
    }
  }
  function noteActivity({ verifiedExtendsSession = false } = {}) {
    if (!verifiedExtendsSession || state === 'stopped') return false;
    lastActivity = clock.now(); schedule(); return true;
  }
  async function start() {
    return ensureReady();
  }
  return { start, ensureReady, noteActivity, stop, snapshot };
}
module.exports = { createTestSession };
