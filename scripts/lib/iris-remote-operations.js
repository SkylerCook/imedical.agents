'use strict';

// Admission coordinates only participating local processes. It does not reserve
// a server license or intercept an IDE/native MCP outside these entry points.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
class RemoteOperationError extends Error {
  constructor(code, details = {}) { super(code); this.name = 'RemoteOperationError'; this.code = code; Object.assign(this, details); }
}
function stop(code, details) { throw new RemoteOperationError(code, details); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function contextMode(context = {}) {
  const root = context.contextRoot || path.join(context.workspaceRoot || process.cwd(), '.agents');
  try {
    const text = fs.readFileSync(path.join(root, 'config', 'project_context_profile.md'), 'utf8');
    return text.match(/^\s*[-*]?\s*`?contextMode`?\s*[:：=]\s*`?([a-z-]+)/m)?.[1] || null;
  } catch (error) { if (error.code === 'ENOENT') return null; stop('remote-context-unreadable'); }
}
function developmentSettings(context = {}) {
  const root = context.contextRoot || path.join(context.workspaceRoot || process.cwd(), '.agents');
  let declaration;
  try { declaration = readJson(path.join(root, 'config', 'iris-development.json')); }
  catch (error) {
    if (error.code === 'ENOENT') return {mode: 'connected', explicit: false};
    stop('development-mode-invalid');
  }
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) stop('development-mode-invalid');
  if (!Object.hasOwn(declaration, 'developmentMode')) return {mode: 'connected', explicit: false};
  if (!['connected', 'offline'].includes(declaration.developmentMode)) stop('development-mode-invalid');
  return {mode: declaration.developmentMode, explicit: true};
}
function developmentMode(context = {}) { return developmentSettings(context).mode; }
function assertRemoteAllowed(context = {}) {
  if (developmentMode(context) === 'offline') stop('offline-development-remote-disabled');
}
// Missing declarations retain the exact legacy configuration fingerprint.
function bindDevelopmentMode(context, configuration) {
  const selected = developmentSettings(context);
  return selected.explicit ? {...configuration, developmentMode: selected.mode} : configuration;
}
function instanceIdentity(connection = {}) {
  const host = connection.hostname || connection.host || connection.IRIS_HOST;
  const port = connection.port || connection.IRIS_WEB_PORT;
  const scheme = String(connection.protocol || connection.scheme || connection.IRIS_SCHEME || 'https').replace(/:$/, '');
  if (typeof host !== 'string' || !host || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) stop('remote-target-required');
  return digest(JSON.stringify([scheme.toLowerCase(), host.toLowerCase(), Number(port)]));
}
function targetIdentity(connection = {}) {
  let base = connection.path || (connection.namespace ? '/api/atelier/v1/' + encodeURIComponent(connection.namespace) + '/' : '');
  base = base.replace(/(?:action\/compile.*|doc\/.*|docs(?:\?.*)?)$/, '');
  if (!base.endsWith('/')) base += '/';
  return digest(JSON.stringify([instanceIdentity(connection), base]));
}
function validQualificationGrant(grant, connection) {
  if (!grant || grant.confirm !== true || grant.targetHash !== targetIdentity(connection) ||
      !Array.isArray(grant.documents) || grant.documents.length < 1 || grant.documents.length > 100000 ||
      new Set(grant.documents).size !== grant.documents.length || grant.documents.some(name => typeof name !== 'string' || !name || /[\x00-\x1f]/.test(name)) ||
      !Number.isInteger(grant.sessions) || grant.sessions < 1 || grant.sessions > 20 ||
      !Number.isInteger(grant.intervalMs) || grant.intervalMs < 0 || grant.intervalMs > 60000 ||
      !Number.isInteger(grant.budgetMs) || grant.budgetMs < 1 || grant.budgetMs > 3600000) stop('remote-qualification-grant-invalid');
  return true;
}
function loadRemotePolicy(context = {}, { connection, policy, qualification } = {}) {
  assertRemoteAllowed(context);
  const required = contextMode(context) === 'intent-first-on-demand-export';
  const contextRoot = context.contextRoot || path.join(context.workspaceRoot || process.cwd(), '.agents');
  let value = policy;
  if (value === undefined) {
    try { value = readJson(path.join(contextRoot, 'config', 'iris-remote-policy.json')); }
    catch (error) {
      if (error.code === 'ENOENT' && !required) return { enabled: false, required: false };
      stop(error.code === 'ENOENT' ? 'remote-policy-required' : 'remote-policy-invalid');
    }
  }
  if (qualification !== undefined) validQualificationGrant(qualification, connection);
  if (value?.enabled !== true) {
    if (qualification !== undefined) stop('remote-qualification-policy-required');
    if (required) stop('remote-policy-required');
    return { enabled: false, required: false };
  }
  if (value.schema !== 'iris-remote-policy/v1' || !path.isAbsolute(value.coordinationRoot || '') ||
      typeof value.poolKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value.poolKey) ||
      value.maxConcurrent !== undefined && value.maxConcurrent !== 1 ||
      qualification === undefined && (value.qualification?.status !== 'verified' || typeof value.qualification.reference !== 'string' || !value.qualification.reference.trim())) stop('remote-policy-invalid');
  const reference = qualification === undefined ? path.resolve(context.workspaceRoot || process.cwd(), value.qualification.reference) : null;
  if (reference) {
    try { if (!fs.statSync(reference).isFile()) stop('remote-qualification-required'); }
    catch { stop('remote-qualification-required'); }
  }
  const result = { ...value, required, coordinationRoot: path.resolve(value.coordinationRoot), maxConcurrent: 1,
    instanceHash: connection ? instanceIdentity(connection) : null, evidenceReference: reference,
    ...(qualification ? {qualificationRun: true} : {}) };
  if (required && connection && (connection.rejectUnauthorized === false || String(connection.protocol || connection.scheme || connection.IRIS_SCHEME || 'https').replace(/:$/, '') !== 'https')) stop('remote-strict-tls-required');
  return result;
}
function assertNoLinks(target) {
  let current = path.parse(path.resolve(target)).root;
  for (const part of path.resolve(target).slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) stop('remote-coordination-link');
  }
}
function atomicJson(file, value) {
  assertNoLinks(file);
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function createRemoteOperation({ policy = { enabled: false }, connection, channel = 'atelier', operation = 'remote-operation' } = {}) {
  let closed = false, active = false, acquired = false, state, directory, lock, token;
  const evidence = { schema: 'iris-remote-operation/v1', channel, status: 'idle', cleanupVerified: false, licenseReleaseVerified: false };
  function acquire() {
    if (closed) stop('remote-owner-closed');
    if (acquired || !policy.enabled) { acquired = true; return; }
    const instanceHash = policy.instanceHash || instanceIdentity(connection);
    assertNoLinks(policy.coordinationRoot);
    fs.mkdirSync(policy.coordinationRoot, { recursive: true, mode: 0o700 });
    directory = path.join(policy.coordinationRoot, digest(policy.poolKey));
    assertNoLinks(directory); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    lock = path.join(directory, 'owner.lock'); token = crypto.randomUUID();
    try { fs.writeFileSync(lock, JSON.stringify({ token, pid: process.pid, machine: digest(os.hostname()), instanceHash, channel, startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') stop('remote-pool-busy-or-unresolved'); throw error; }
    try {
      const stateFile = path.join(directory, 'state.json');
      state = fs.existsSync(stateFile) ? readJson(stateFile) : { schema: 'iris-remote-pool/v1', instances: [], status: 'ready' };
      if (state.schema !== 'iris-remote-pool/v1' || !Array.isArray(state.instances)) stop('remote-pool-state-invalid');
      if (state.status !== 'ready' || state.inFlight) stop('remote-pool-reconciliation-required');
      if (state.instances.length && !state.instances.includes(instanceHash) && policy.allowSharedPool !== true) stop('remote-pool-identity-mismatch');
      if (!state.instances.includes(instanceHash)) state.instances.push(instanceHash);
      atomicJson(stateFile, state); acquired = true; evidence.status = 'ready';
    } catch (error) { fs.unlinkSync(lock); throw error; }
  }
  function persist() { if (directory) atomicJson(path.join(directory, 'state.json'), state); }
  function markUnknown(reason = 'remote-outcome-unknown') {
    acquire();
    if (state?.status === 'circuit-open' || evidence.status === 'circuit-open') {
      if (state) { (state.cleanupProblems ||= []).push(reason); state.updatedAt = new Date().toISOString(); persist(); }
      return;
    }
    evidence.status = 'reconciliation-required';
    if (state) { state.status = 'reconciliation-required'; state.reason = reason; state.updatedAt = new Date().toISOString(); persist(); }
  }
  function checkpointBatch(batch) {
    if (!active) stop('remote-owner-not-active');
    if (state) { state.inFlight.batch = batch; state.updatedAt = new Date().toISOString(); persist(); }
  }
  function tripCircuit(reason = 'service-unavailable') {
    acquire(); evidence.status = 'circuit-open';
    if (state) { state.status = 'circuit-open'; state.reason = reason; state.updatedAt = new Date().toISOString(); persist(); }
  }
  async function run({ effects = 'read-only', operation: action = operation } = {}, callback) {
    acquire();
    if (active) stop('remote-owner-busy');
    if (state?.status !== undefined && state.status !== 'ready') stop('remote-pool-reconciliation-required');
    if (!['read-only', 'write'].includes(effects)) stop('remote-effects-required');
    active = true;
    if (state) { state.inFlight = { token, effects, operation: action, at: new Date().toISOString() }; persist(); }
    try {
      const result = await callback();
      if (state) { delete state.inFlight; persist(); }
      return result;
    } catch (error) {
      if (error.status === 503 || error.httpStatus === 503) {
        if (state) { state.status = 'circuit-open'; state.reason = 'service-unavailable'; }
        evidence.status = 'circuit-open';
      } else if (effects === 'write' && error.beforeSend !== true && error.writeOutcome !== 'rejected') {
        if (state) { state.status = 'reconciliation-required'; state.reason = 'remote-write-outcome-unknown'; }
        evidence.status = 'reconciliation-required';
      }
      if (state) { if (state.status === 'ready') delete state.inFlight; persist(); }
      throw error;
    } finally { active = false; }
  }
  function close(exit = {}) {
    if (closed) return { ...evidence };
    if (active) { markUnknown('remote-owner-exit-in-flight'); return { ...evidence, pendingOperation: true }; }
    closed = true;
    if (acquired && lock) {
      const held = readJson(lock);
      if (held.token !== token) stop('remote-owner-identity-changed');
      fs.unlinkSync(lock);
    }
    Object.assign(evidence, exit, { status: evidence.status === 'ready' || evidence.status === 'idle' ? 'closed' : evidence.status,
      cleanupVerified: exit.cleanupVerified !== false, licenseReleaseVerified: false, pendingOperation: false });
    return { ...evidence };
  }
  return { acquire, run, markUnknown, checkpointBatch, tripCircuit, close, snapshot: () => ({ ...evidence, pendingOperation: active }) };
}
async function withRemoteOperation(options, callback) {
  assertRemoteAllowed(options.context || {});
  const policy = options.policy || loadRemotePolicy(options.context || {}, { connection: options.connection });
  const owner = createRemoteOperation({ ...options, policy });
  try { return await owner.run(options, () => callback(owner)); }
  finally { owner.close(); }
}
function poolFiles(policy) {
  if (!policy.enabled) stop('remote-policy-not-enabled');
  const directory = path.join(policy.coordinationRoot, digest(policy.poolKey));
  assertNoLinks(directory);
  assertNoLinks(path.join(directory, 'state.json'));
  assertNoLinks(path.join(directory, 'owner.lock'));
  assertNoLinks(path.join(directory, 'history'));
  return {directory, state: path.join(directory, 'state.json'), owner: path.join(directory, 'owner.lock')};
}
function poolStatus({policy}) {
  const files = poolFiles(policy), state = fs.existsSync(files.state) ? readJson(files.state) : null,
    owner = fs.existsSync(files.owner) ? readJson(files.owner) : null;
  let ownerAlive = false;
  if (owner) {
    if (owner.machine !== digest(os.hostname())) ownerAlive = 'unverified-other-machine';
    else try { process.kill(owner.pid, 0); ownerAlive = true; } catch (error) { ownerAlive = error.code === 'ESRCH' ? false : 'unverified'; }
  }
  return {schema: 'iris-remote-status/v1', status: state?.status || 'ready', reason: state?.reason || null,
    ownerPresent: !!owner, ownerAlive, pendingEffects: state?.inFlight?.effects || null,
    reconciliationToken: digest(JSON.stringify({state, owner}))};
}
function localPoolStatus(context = {}) {
  const mode = developmentMode(context);
  const root = context.contextRoot || path.join(context.workspaceRoot || process.cwd(), '.agents');
  let policy;
  try { policy = readJson(path.join(root, 'config', 'iris-remote-policy.json')); }
  catch (error) {
    if (error.code === 'ENOENT') return {schema: 'iris-remote-status/v1', status: 'unconfigured', developmentMode: mode, ownerPresent: false};
    stop('remote-policy-invalid');
  }
  if (!policy || policy.schema !== 'iris-remote-policy/v1' || !path.isAbsolute(policy.coordinationRoot || '') ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(policy.poolKey || '')) stop('remote-policy-invalid');
  // Status only reads existing coordination files; it cannot grant admission or release a lock.
  return {...poolStatus({policy: {...policy, enabled: true}}), developmentMode: mode};
}
function createRecoveryReadOperation({policy, connection, token, confirmRecovery = false, documents} = {}) {
  const files = poolFiles(policy);
  if (confirmRecovery !== true || !/^[a-f0-9]{64}$/.test(token || '')) stop('remote-inspection-confirmation-required');
  if (!Array.isArray(documents) || documents.length < 1 || documents.length > 5 || new Set(documents).size !== documents.length ||
      documents.some(name => typeof name !== 'string' || !name || name.length > 1024 || /[\\%?#\x00-\x1f\x7f]/.test(name) || name.split('/').includes('..'))) stop('remote-inspection-documents-invalid');
  const allowed = new Map(documents.map(name => ['doc/' + encodeURIComponent(name), name]));
  const instanceHash = policy.instanceHash || instanceIdentity(connection), id = crypto.randomUUID(), ownerToken = crypto.randomUUID();
  const evidence = {schema:'iris-remote-inspection/v1', id, status:'not-started', instanceHash,
    targetHash:digest(JSON.stringify([connection?.protocol || connection?.scheme,connection?.hostname || connection?.host,Number(connection?.port),connection?.path || connection?.namespace])), requestedDocuments:[...documents],
    originalToken:token, reads:[], cleanupVerified:false, licenseReleaseVerified:false, writeEnabled:false};
  let acquired = false, closed = false, active = false, stopped = false, state;
  function acquire() {
    if (closed) stop('remote-owner-closed');
    if (acquired) return;
    fs.mkdirSync(files.directory, {recursive:true, mode:0o700});
    const admissionLock = path.join(files.directory, 'reconcile.lock'); let descriptor, previousOwner;
    try { descriptor = fs.openSync(admissionLock, 'wx', 0o600); }
    catch { stop('remote-reconcile-busy'); }
    try {
      const status = poolStatus({policy});
      if (status.reconciliationToken !== token) stop('remote-inspection-state-changed');
      if (status.ownerAlive !== false) stop('remote-owner-still-live-or-unverified');
      state = readJson(files.state);
      if (state.schema !== 'iris-remote-pool/v1' || !Array.isArray(state.instances) ||
          !['circuit-open','reconciliation-required'].includes(state.status) && !(state.status === 'ready' && state.inFlight)) stop('remote-inspection-blocked-state-required');
      if (!state.instances.includes(instanceHash) && policy.allowSharedPool !== true) stop('remote-pool-identity-mismatch');
      previousOwner = fs.existsSync(files.owner) ? fs.readFileSync(files.owner) : null;
      // This explicit recovery action may replace only the confirmed dead owner.
      // Its complete record remains in the durable inspection evidence.
      if (previousOwner) fs.unlinkSync(files.owner);
      try {
        fs.writeFileSync(files.owner, JSON.stringify({token:ownerToken,pid:process.pid,machine:digest(os.hostname()),instanceHash,channel:'atelier-recovery-read',startedAt:new Date().toISOString()}), {flag:'wx',mode:0o600});
        evidence.originalStatus = state.status;
        evidence.originalPendingEffects = state.inFlight?.effects || null;
        if (state.status === 'ready') { state.status = 'reconciliation-required'; state.reason = 'remote-owner-interrupted'; }
        evidence.blockedStatus = state.status;
        state.inspectionInFlight = {id, originalToken:token, documents:[...documents], startedAt:new Date().toISOString(),
          interruptedInspection:state.inspectionInFlight || null, previousOwner:previousOwner ? JSON.parse(previousOwner.toString('utf8')) : null};
        atomicJson(files.state, state); acquired = true; evidence.status = 'inspecting';
      } catch (error) {
        if (fs.existsSync(files.owner) && readJson(files.owner).token === ownerToken) fs.unlinkSync(files.owner);
        if (previousOwner && !fs.existsSync(files.owner)) fs.writeFileSync(files.owner, previousOwner, {flag:'wx',mode:0o600});
        throw error;
      }
    } finally { fs.closeSync(descriptor); fs.unlinkSync(admissionLock); }
  }
  async function run({effects, method, suffix} = {}, callback) {
    if (effects !== 'read-only' || method !== 'GET' || !allowed.has(suffix)) stop('remote-recovery-read-only', {beforeSend:true});
    if (active || stopped || evidence.reads.some(read => read.document === allowed.get(suffix))) stop('remote-inspection-read-stopped', {beforeSend:true});
    acquire(); active = true;
    const read = {document:allowed.get(suffix), status:'started'}; evidence.reads.push(read);
    try { const result = await callback(); read.status = result === null ? 'not-found' : 'read'; return result; }
    catch (error) { stopped = true; read.status = 'failed'; read.reason = error.code || 'remote-inspection-read-failed'; if (error.status) read.httpStatus = error.status; throw error; }
    finally { active = false; }
  }
  function markUnknown(reason) { stopped = true; evidence.reason = reason; evidence.cleanupVerified = false; }
  function close(exit = {}) {
    if (closed) return {...evidence};
    if (active) { markUnknown('remote-inspection-exit-in-flight'); return {...evidence,pendingOperation:true}; }
    closed = true;
    Object.assign(evidence, exit, {schema:'iris-remote-inspection/v1', status:stopped || exit.cleanupVerified === false ? 'inspection-incomplete' : acquired ? 'inspected' : 'not-started',
      cleanupVerified:acquired && exit.cleanupVerified !== false, licenseReleaseVerified:false, writeEnabled:false, pendingOperation:false});
    if (acquired) {
      if (readJson(files.owner).token !== ownerToken) stop('remote-owner-identity-changed');
      const current = readJson(files.state);
      if (current.inspectionInFlight?.id !== id || current.status !== evidence.blockedStatus) stop('remote-inspection-state-changed');
      current.lastInspection = {...evidence, completedAt:new Date().toISOString(), previousOwner:current.inspectionInFlight.previousOwner, interruptedInspection:current.inspectionInFlight.interruptedInspection};
      delete current.inspectionInFlight;
      atomicJson(files.state, current);
      fs.unlinkSync(files.owner);
      evidence.poolStatus = current.status;
      evidence.reconciliationToken = poolStatus({policy}).reconciliationToken;
    }
    return {...evidence};
  }
  return {acquire, run, markUnknown, close, snapshot:()=>({...evidence,pendingOperation:active})};
}
function reconcileRemotePool({policy, token, evidenceFile, confirm = false, writeOutcome}) {
  const files = poolFiles(policy);
  if (confirm !== true || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) stop('remote-reconcile-confirmation-required');
  if (!path.isAbsolute(evidenceFile || '')) stop('remote-reconcile-evidence-required');
  let evidence;
  try { if (!fs.statSync(evidenceFile).isFile()) stop('remote-reconcile-evidence-required'); evidence = digest(fs.readFileSync(evidenceFile)); }
  catch { stop('remote-reconcile-evidence-required'); }
  fs.mkdirSync(files.directory, {recursive: true, mode: 0o700});
  const recoveryLock = path.join(files.directory, 'reconcile.lock');
  let descriptor;
  try { descriptor = fs.openSync(recoveryLock, 'wx', 0o600); }
  catch { stop('remote-reconcile-busy'); }
  try {
    const status = poolStatus({policy});
    if (status.reconciliationToken !== token) stop('remote-reconcile-state-changed');
    if (status.ownerAlive !== false) stop('remote-owner-still-live-or-unverified');
    const state = fs.existsSync(files.state) ? readJson(files.state) : {schema:'iris-remote-pool/v1',instances:[],status:'ready'};
    const owner = fs.existsSync(files.owner) ? readJson(files.owner) : null;
    if ((state.inFlight?.effects === 'write' || state.reason === 'remote-write-outcome-unknown') && !['verified-applied','verified-not-applied'].includes(writeOutcome)) stop('remote-write-reconciliation-required');
    const history = path.join(files.directory, 'history'); fs.mkdirSync(history, {recursive:true, mode:0o700});
    const resolution = {schema:'iris-remote-reconciliation/v1', at:new Date().toISOString(), previous:state, owner, token,
      evidenceSha256:evidence, evidenceFile, writeOutcome:writeOutcome || 'not-applicable'};
    atomicJson(path.join(history, crypto.randomUUID() + '.json'), resolution);
    // Keep a new lock visible until the state is ready; a competing admission
    // cannot pass between an interrupted owner's removal and the state update.
    if (!owner) fs.writeFileSync(files.owner, JSON.stringify({token:'reconciliation',pid:process.pid,machine:digest(os.hostname())}), {flag:'wx',mode:0o600});
    atomicJson(files.state, {schema:'iris-remote-pool/v1',instances:state.instances,status:'ready',lastReconciledAt:resolution.at,evidenceSha256:evidence});
    fs.unlinkSync(files.owner);
    return {schema:'iris-remote-reconciliation/v1',status:'reconciled',licenseReleaseVerified:false};
  } finally { fs.closeSync(descriptor); fs.unlinkSync(recoveryLock); }
}
module.exports = { RemoteOperationError, contextMode, developmentMode, assertRemoteAllowed, bindDevelopmentMode, localPoolStatus, instanceIdentity, targetIdentity, validQualificationGrant, loadRemotePolicy, createRemoteOperation, createRecoveryReadOperation, withRemoteOperation, poolStatus, reconcileRemotePool };
