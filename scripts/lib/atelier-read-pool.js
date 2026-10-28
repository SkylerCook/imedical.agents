'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const remote = require('./iris-remote-operations');
const {normalizeConnection, createAtelierClient} = require('./atelier-client');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (code, details) => { throw new remote.RemoteOperationError(code, details); };
const readTargetHash = connection => remote.targetIdentity(normalizeConnection(connection));
const readConfigurationHash = connection => digest(JSON.stringify(normalizeConnection(connection)));
const readRuntimeHash = () => digest(JSON.stringify([process.version, process.platform,
  ...['atelier-read-pool.js', 'atelier-client.js', 'iris-remote-operations.js'].map(file => digest(fs.readFileSync(path.join(__dirname, file))))]));

function selectBudget(options, context, connection, policy) {
  const requestedSessions = options.sessions ?? policy.readBatch?.sessions ?? 1;
  let intervalMs = options.intervalMs ?? policy.readBatch?.intervalMs ?? 100;
  const requestedIntervalMs = intervalMs;
  if (!Number.isInteger(requestedSessions) || requestedSessions < 1 || requestedSessions > 20 ||
      !Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 60000) fail('read-pool-budget-invalid');
  if (options.qualification) {
    const grant = options.qualification;
    if (grant.sessions !== requestedSessions || grant.intervalMs !== intervalMs) fail('remote-qualification-grant-invalid');
    return {requestedSessions, sessions: requestedSessions, intervalMs, maxDocuments: grant.documents.length, qualification: true};
  }
  let qualified = null;
  if (policy.enabled && policy.readBatch?.qualification?.status === 'verified') {
    const entry = policy.readBatch.qualification;
    try {
      if (!/^[a-f0-9]{64}$/.test(entry.sha256 || '') || typeof entry.reference !== 'string' || !entry.reference) fail('read-pool-qualification-invalid');
      const file = path.resolve(context.workspaceRoot || process.cwd(), entry.reference), bytes = fs.readFileSync(file);
      if (digest(bytes) !== entry.sha256) fail('read-pool-qualification-drift');
      const evidence = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      if (evidence.schema !== 'iris-read-qualification/v1' || evidence.status !== 'verified' ||
          evidence.targetHash !== readTargetHash(connection) || evidence.shutdownVerified !== true || evidence.resourceReturnVerified !== true ||
          evidence.channel !== 'atelier' || evidence.configurationFingerprint !== readConfigurationHash(connection) || evidence.runtimeFingerprint !== readRuntimeHash() ||
          typeof evidence.serverVersion !== 'string' || !evidence.serverVersion || evidence.instanceId !== null && typeof evidence.instanceId !== 'string' ||
          !Number.isInteger(evidence.sessions) || evidence.sessions < 1 || evidence.sessions > 20 ||
          !Number.isInteger(evidence.intervalMs) || evidence.intervalMs < 0 ||
          !Number.isInteger(evidence.maxDocuments) || evidence.maxDocuments < 1) fail('read-pool-qualification-invalid');
      qualified = evidence;
    } catch (error) { if (error.code?.startsWith('read-pool-')) throw error; fail('read-pool-qualification-invalid'); }
  }
  if (qualified && intervalMs < qualified.intervalMs) {
    if (options.explicitInterval === true) fail('read-pool-interval-qualification-required');
    intervalMs = qualified.intervalMs;
  }
  const authorized = qualified && requestedSessions <= qualified.sessions && intervalMs >= qualified.intervalMs;
  if (requestedSessions > 1 && !authorized && options.explicitSessions === true) fail('read-pool-qualification-required');
  return {requestedSessions, requestedIntervalMs, sessions: requestedSessions > 1 && authorized ? requestedSessions : 1, intervalMs,
    maxDocuments: qualified?.maxDocuments || null, qualification: false, qualificationReference: policy.readBatch?.qualification?.reference || null,
    qualifiedServerVersion: qualified?.serverVersion || null, qualifiedInstanceId: qualified?.instanceId || null};
}

// A batch is one remote owner. Each worker has its own cookie and serial HTTP
// client, and receives only a GET facade rather than the owner's write API.
function createAtelierReadPool(options = {}) {
  remote.assertRemoteAllowed(options.context || {});
  const context = options.context || {}, connection = normalizeConnection(options.connection);
  const policy = remote.loadRemotePolicy(context, {connection, policy: options.policy, qualification: options.qualification});
  if (!policy.enabled) fail('read-pool-policy-required');
  const budget = selectBudget(options, context, connection, policy);
  const owner = remote.createRemoteOperation({policy, connection, channel: 'atelier-read-batch'});
  const receipt = {schema: 'iris-read-batch/v1', ...budget, targetHash: readTargetHash(connection), channel: 'atelier',
    configurationFingerprint: readConfigurationHash(connection), runtimeFingerprint: readRuntimeHash(), requestCount: 0, items: [], workers: [], cleanupVerified: false, licenseReleaseVerified: false};
  let running = false, used = false, closed = false, exit;
  async function readAll(documents, {onResult} = {}) {
    if (closed || used || running) fail('read-pool-already-used');
    if (!Array.isArray(documents) || !documents.length || new Set(documents).size !== documents.length ||
        documents.some(name => typeof name !== 'string' || !name || /[\\%?#\x00-\x1f]/.test(name.replace(/^%/, '')) || name.split('/').some(part => !part || part === '.' || part === '..'))) fail('read-pool-documents-invalid');
    if (options.qualification && JSON.stringify(documents) !== JSON.stringify(options.qualification.documents)) fail('remote-qualification-scope-mismatch');
    if (!options.qualification && budget.maxDocuments !== null && documents.length > budget.maxDocuments) fail('read-pool-document-budget-exceeded');
    if (policy.enabled && !options.qualification && documents.length > 5 && budget.maxDocuments === null) fail('bulk-license-qualification-required');
    used = true; running = true;
    const batchId = crypto.randomUUID(), records = new Array(documents.length), active = new Map(), clients = [];
    let cursor = 0, firstError, probing = true;
    const started = Date.now(), deadline = started + (options.qualification?.budgetMs || options.budgetMs || 3600000);
    const checkpoint = () => owner.checkpointBatch({id: batchId, documents, sessions: budget.sessions,
      inFlight: [...active.entries()].map(([worker, index]) => ({worker, index, document: documents[index]})),
      completed: records.filter(Boolean).map(({index, document, status}) => ({index, document, status}))});
    function stopOn(error) {
      firstError ||= error;
      if (error.status === 503 || error.httpStatus === 503) owner.tripCircuit();
      checkpoint();
    }
    async function record(value) {
      records[value.index] = value; checkpoint();
      if (onResult) await onResult(value);
    }
    try {
      return await owner.run({effects: 'read-only', operation: options.qualification ? 'atelier-read-qualification' : 'atelier-read-batch'}, async () => {
        checkpoint();
        try {
          const count = Math.min(budget.sessions, documents.length);
          for (let worker = 0; worker < count; worker++) {
            const facade = {
              async run({effects, method, suffix} = {}, callback) {
                const permitted = probing ? worker === 0 && suffix === '@server-info' : active.has(worker) && suffix === 'doc/' + encodeURIComponent(documents[active.get(worker)]);
                if (effects !== 'read-only' || method !== 'GET' || !permitted) fail('read-pool-read-only', {beforeSend: true});
                if (firstError) throw firstError;
                receipt.requestCount++;
                try { return await callback(); } catch (error) { stopOn(error); throw error; }
              },
              markUnknown: owner.markUnknown, snapshot: owner.snapshot
            };
            clients.push(createAtelierClient({connection, context, policy, qualification: options.qualification, owner: facade,
              timeoutMs: options.timeoutMs, maxResponseBytes: options.maxResponseBytes}));
          }
          const information = await clients[0].serverInfo();
          receipt.serverVersion = information.version; receipt.instanceId = information.instanceId;
          if (budget.qualifiedServerVersion && (budget.qualifiedServerVersion !== information.version || budget.qualifiedInstanceId !== information.instanceId)) fail('read-pool-server-qualification-changed');
          probing = false;
          const workerResults = await Promise.allSettled(clients.map(async (client, worker) => {
            let lastStarted = 0;
            while (!firstError && cursor < documents.length) {
              const wait = Math.max(0, lastStarted + budget.intervalMs - Date.now());
              if (wait) await new Promise(resolve => setTimeout(resolve, wait));
              if (firstError || cursor >= documents.length) break;
              if (Date.now() >= deadline) { stopOn(new remote.RemoteOperationError('read-pool-deadline')); break; }
              const index = cursor++, document = documents[index]; active.set(worker, index); checkpoint(); lastStarted = Date.now();
              try {
                const value = await client.readDocument(document, {timeoutMs: Math.max(1, Math.min(options.timeoutMs || 60000, deadline - Date.now()))});
                await record({index, document, status: value === null ? 'missing' : value.bytes.length === 0 ? 'empty' : 'fetched', ...(value === null ? {} : {value})});
              } catch (error) {
                stopOn(error);
                try { await record({index, document, status: 'failed', error: {code: error.code || 'read-failed', ...(error.status ? {status: error.status} : {})}}); }
                catch (storageError) { firstError = storageError; }
              } finally { active.delete(worker); checkpoint(); }
            }
          }).map(task => task.catch(error => { firstError ||= error; throw error; })));
          for (const result of workerResults) if (result.status === 'rejected') firstError ||= result.reason;
          for (let index = 0; index < documents.length; index++) if (!records[index]) await record({index, document: documents[index], status: 'cancelled'});
        } catch (error) {
          firstError ||= error;
          for (let index = 0; index < documents.length; index++) if (!records[index]) {
            try { await record({index, document: documents[index], status: 'cancelled'}); }
            catch (storageError) { firstError = storageError; break; }
          }
        } finally {
          receipt.workers = await Promise.all(clients.map(async (client, worker) => {
            try { return {worker, ...await client.close()}; }
            catch (error) { owner.markUnknown('remote-session-exit-unverified'); return {worker, cleanupVerified: false, reason: error.code || 'close-failed'}; }
          }));
          receipt.cleanupVerified = receipt.workers.every(worker => worker.cleanupVerified === true);
          if (!receipt.cleanupVerified) { owner.markUnknown('remote-session-exit-unverified'); firstError ||= new remote.RemoteOperationError('remote-session-exit-unverified'); }
          receipt.items = records; receipt.elapsedMs = Date.now() - started;
        }
        if (firstError) throw Object.assign(firstError, {batchResult: receipt});
        return receipt;
      });
    } finally { running = false; exit = owner.close({cleanupVerified: receipt.cleanupVerified}); closed = true; receipt.remote = exit; }
  }
  return {readAll, async readDocument(document) { const batch = await readAll([document]); return batch.items[0].status === 'missing' ? null : batch.items[0].value; },
    async close() { if (running) fail('read-pool-in-flight'); if (!closed) { exit = owner.close({cleanupVerified: true}); closed = true; } return {...receipt, remote: exit}; },
    snapshot: () => ({...receipt, running, closed, remote: owner.snapshot()})};
}
module.exports = {createAtelierReadPool, readTargetHash, readConfigurationHash, readRuntimeHash, selectBudget};
