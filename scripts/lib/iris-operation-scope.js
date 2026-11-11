'use strict';
// Shared by the in-process scheduler and the cross-process admission lock.
// Only opaque resource identities are persisted; caller-provided scope is never trusted by backends.
const crypto = require('node:crypto');
const COOLDOWN_MS = 5000;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function makeScope(connection = {}, targets = null) {
  const host = connection.hostname || connection.host;
  const port = Number(connection.port);
  const scheme = String(connection.protocol || connection.scheme || 'https').replace(/:$/, '').toLowerCase();
  let namespace = connection.namespace;
  if (!namespace && connection.path) {
    const match = connection.path.match(/\/api\/atelier\/v\d+\/([^/]+)\//);
    if (match) namespace = decodeURIComponent(match[1]);
  }
  return {instance: host && Number.isInteger(port) ? hash([scheme, host.toLowerCase(), port]) : null,
    namespace: namespace ? hash(String(namespace).toUpperCase()) : null,
    targets: Array.isArray(targets) && targets.length && targets.every(x => typeof x === 'string' && x && !/[*?]/.test(x))
      ? [...new Set(targets.map(x => hash(x.replace(/^\//, '').toLowerCase())))].sort() : null};
}
function conflicts(a, b) {
  const valid = x => x && [x.instance,x.namespace].every(v => v === null || /^[a-f0-9]{64}$/.test(v)) && (x.targets === null || Array.isArray(x.targets) && x.targets.length && x.targets.every(v => /^[a-f0-9]{64}$/.test(v)));
  if (!valid(a) || !valid(b)) return true;
  if (a.instance && b.instance && a.instance !== b.instance) return false;
  if (a.namespace && b.namespace && a.namespace !== b.namespace) return false;
  if (!Array.isArray(a.targets) || !Array.isArray(b.targets) || !a.targets.length || !b.targets.length) return true;
  return a.targets.some(target => b.targets.includes(target));
}
function addUnresolved(state, scope, reason, now = Date.now(), id = crypto.randomUUID()) {
  const existing = (state.unresolvedWrites || []).find(x => x.id === id);
  if (existing) return existing;
  const item = {id, scope: scope || null, reason, at: new Date(now).toISOString()};
  (state.unresolvedWrites ||= []).push(item);
  return item;
}
function warn(state, reason, now = Date.now()) {
  state.warning = {reason, at: new Date(now).toISOString(), cleanupVerified: false,
    ...(Number.isInteger(state.generation) ? {generation:state.generation} : {})};
}
function admit(state, operation, now = Date.now()) {
  if (state.retryAfter > now) return 'session-service-cooling-down';
  if (operation.effects === 'write' && (state.unresolvedWrites || []).some(x => conflicts(x.scope, operation.scope))) return 'session-write-conflict-unresolved';
  return null;
}
function fromAtelier(connection, method, suffix, body) {
  // PUT writes exactly one document. Compile/generator requests can execute arbitrary code.
  const target = method === 'PUT' && suffix.startsWith('doc/') ? decodeURIComponent(suffix.slice(4).split('?')[0]) : null;
  return makeScope(connection, target ? [target] : null);
}
function pendingWrites(state) {
  const result = {unresolvedWrites:[...(state.unresolvedWrites || [])]};
  if (state.inFlight?.effects === 'write' && state.inFlight.writeRiskOwner !== 'session-manager') {
    const old = state.inFlight;
    addUnresolved(result,old.scope,'remote-interrupted-write',Date.parse(old.at || '') || 0,old.id || old.token || hash(old));
  }
  return result.unresolvedWrites;
}
function resolveWrites(state, ids) {
  const items = state.unresolvedWrites || [];
  if (!ids && items.length > 1) throw Object.assign(new Error('reconciliation-write-id-required'), {code:'reconciliation-write-id-required'});
  const selected = ids || items.map(x => x.id);
  if (!Array.isArray(selected) || !selected.length || selected.some(id => !items.some(x => x.id === id))) throw Object.assign(new Error('reconciliation-write-id-invalid'), {code:'reconciliation-write-id-invalid'});
  state.unresolvedWrites = items.filter(x => !selected.includes(x.id));
}
module.exports = {COOLDOWN_MS, makeScope, conflicts, addUnresolved, warn, admit, fromAtelier, resolveWrites, pendingWrites};
