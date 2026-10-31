'use strict';
const {setTimeout: pause} = require('node:timers/promises');

// One budget per deployment, shared by all reads and confirmed-unsent uploads.
// The underlying publication/night/transport gates still run on every attempt.
const TRANSIENT = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN']);
function transient(error) {
  if (error.sessionUncertain || error.status || error.httpStatus || error.reason) return false;
  if (TRANSIENT.has(error.code)) return true;
  if (error.code === 'atelier-transport-unknown') return TRANSIENT.has(error.transportCode);
  return ['atelier-response-error', 'atelier-deadline-outcome-unknown'].includes(error.code);
}
function wrap(adapter, {wait = pause} = {}) {
  if (adapter.deploymentRecovery) return adapter;
  const guard = require('./deploy-guard');
  const evidence = {schema: 'iris-deploy-recovery/v1', limit: 2, attempts: []};
  const bound = Object.create(adapter);
  bound.deploymentRecovery = evidence;
  const fail = (error, operation) => { error.deploymentOperation = operation; throw error; };
  const identity = file => file.document || file.targetId || file.remotePath;
  async function recover(operation, file, error, callback) {
    if (!transient(error) || evidence.attempts.length >= evidence.limit) throw error;
    const event = {operation, file: identity(file), reason: error.code, status: 'checking'};
    evidence.attempts.push(event);
    await wait(evidence.attempts.length === 1 ? 250 : 1000);
    try { const result = await callback(); event.status = 'recovered'; return result; }
    catch (next) { event.status = 'failed'; throw next; }
  }
  for (const operation of ['read', 'readPublished']) {
    if (typeof adapter[operation] !== 'function') continue;
    bound[operation] = async file => {
      let error;
      try { return await adapter[operation](file); } catch (failure) { error = failure; }
      while (true) {
        try { return await recover(operation, file, error, () => adapter[operation](file)); }
        catch (failure) { error = failure; }
        if (!transient(error) || evidence.attempts.length >= evidence.limit) fail(error, operation);
      }
    };
  }
  if (typeof adapter.put === 'function') bound.put = async file => {
    let error;
    try { return await adapter.put(file); } catch (failure) { error = failure; }
    while (true) {
      // A matching hash after a lost reply does not prove that the old request
      // has finished. Never infer "not applied" or replay an unknown write.
      if (error.beforeSend !== true) fail(error, 'put');
      try {
        return await recover('put', file, error, async () => {
          if (!file.source || !guard.readSource(file).equals(file.source)) guard.stop('local-changed-during-deploy', {file: identity(file)});
          if (file.expected === undefined || guard.hash(await bound.read(file)) !== file.expected) guard.stop('remote-changed-before-upload', {file: identity(file)});
          if (!guard.readSource(file).equals(file.source)) guard.stop('local-changed-during-deploy', {file: identity(file)});
          return adapter.put(file);
        });
      } catch (failure) { error = failure; }
      if (!transient(error) || evidence.attempts.length >= evidence.limit) fail(error, 'put');
    }
  };
  return bound;
}
module.exports = {wrap, transient};
