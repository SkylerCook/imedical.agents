'use strict';

// Process-independent scheduler. Transports and the user-local IPC host are adapters.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (code, beforeSend = true) => Object.assign(new Error(code), {code, beforeSend});

class SessionManager {
  constructor({directory, open, idleMs = 120000, queueMs = 60000, now = Date.now}) {
    this.directory = directory; this.open = open; this.idleMs = idleMs; this.queueMs = queueMs; this.now = now;
    this.pools = new Map(); this.stopping = false;
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    for (const name of fs.readdirSync(directory)) if (/^[a-f0-9]{64}\.json$/.test(name)) this.poolById(name.slice(0,-5));
  }
  pool(key) {
    return this.poolById(hash(key));
  }
  poolById(id) {
    if (!this.pools.has(id)) {
      const file = path.join(this.directory, id + '.json');
      const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
      this.pools.set(id, {id, file, queue: [], running: false, session: null, lease: null,
        blocked: prior && (prior.active || prior.blocked) ? prior.blocked || 'session-exit-unverified' : null,
        pendingEffects: prior?.pendingEffects || null, lastUsed: this.now(), completed: 0, generation: prior?.generation || 0});
    }
    return this.pools.get(id);
  }
  persist(p, active = !!p.session) {
    // No connection settings, cookies, credentials, SQL or response bodies are persisted.
    const tmp = p.file + '.' + crypto.randomUUID();
    try {
      fs.writeFileSync(tmp, JSON.stringify({schema: 'iris-session-state/v1', active, blocked: p.blocked,
        generation: p.generation, inFlight: p.running, pendingEffects: p.pendingEffects, updatedAt: new Date().toISOString()}), {flag: 'wx', mode: 0o600});
      fs.renameSync(tmp, p.file);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  }
  submit({pool, identity, client, operation, signal, timeoutMs = this.queueMs, lease, releaseLease = false}) {
    if (this.stopping) return Promise.reject(failure('session-manager-stopping'));
    const p = this.pool(pool);
    if (p.blocked) return Promise.reject(failure(p.blocked));
    return new Promise((resolve, reject) => {
      const item = {identity: hash(identity), client, operation, resolve, reject, lease, releaseLease, started: false};
      const remove = code => {
        if (item.started) { item.cancelled = true; return; }
        const i = p.queue.indexOf(item); if (i >= 0) p.queue.splice(i, 1);
        item.dispose(); reject(failure(code));
      };
      const abort = () => remove('session-request-cancelled');
      const timer = setTimeout(() => remove('session-queue-timeout'), timeoutMs);
      item.start = () => clearTimeout(timer);
      item.dispose = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      if (signal?.aborted) { item.dispose(); reject(failure('session-request-cancelled')); return; }
      signal?.addEventListener('abort', abort, {once: true});
      p.queue.push(item); void this.drain(p).catch(() => this.storageFailure(p));
    });
  }
  async closeSession(p) {
    if (!p.session) return;
    const session = p.session; p.session = null;
    try {
      const receipt = await session.close();
      p.exit = receipt;
      if (!receipt || receipt.cleanupVerified !== true) p.blocked ||= 'session-exit-unverified';
    } catch { p.blocked ||= 'session-exit-unverified'; }
    p.lease = null; p.identity = null; this.persist(p, false);
  }
  storageFailure(p) {
    p.blocked = 'session-state-write-failed';
    for (const item of p.queue.splice(0)) {item.dispose(); item.reject(failure(p.blocked));}
  }
  async drain(p) {
    if (p.running || this.stopping) return;
    const index = p.lease ? p.queue.findIndex(item => item.client === p.lease) : 0;
    const item = p.queue[index]; if (!item) return;
    p.queue.splice(index, 1); item.started = true; item.start(); p.running = true;
    try {
      if (p.blocked) throw failure(p.blocked);
      if (p.session && p.identity !== item.identity) await this.closeSession(p);
      if (p.blocked) throw failure(p.blocked);
      if (!p.session) {
        // Persist intent before opening: an abrupt crash cannot masquerade as a clean exit.
        p.generation++; this.persist(p, true);
        p.session = await this.open(item.operation); p.identity = item.identity;
      }
      if (item.lease) p.lease = item.client;
      p.pendingEffects = item.operation.effects;
      this.persist(p, true);
      const result = await p.session.call(item.operation);
      if (p.blocked) throw failure(p.blocked, false);
      if(item.operation.channel==='mcp' && result?.result && typeof result.result==='object') {
        result.result._meta={...result.result._meta,'imedical/session':{schema:'iris-managed-route/v1',managed:true,pool:p.id,generation:p.generation,request:p.completed+1,runtime:item.operation.runtime}};
      }
      if (item.releaseLease) p.lease = null;
      p.completed++;
      if (item.cancelled) throw failure('session-cancelled-after-send', false);
      p.pendingEffects = null;
      item.resolve(result);
    } catch (error) {
      if (error.status === 503) p.blocked = 'session-service-unavailable';
      else if (error.status === 401 || error.status === 403) p.blocked = 'session-authentication-failed';
      else if (error.sessionUncertain === true) p.blocked = 'session-identity-unverified';
      else if (error.beforeSend !== true && (!p.session || item.operation.effects === 'write' || item.cancelled)) p.blocked ||= 'session-outcome-unverified';
      if (p.blocked) await this.closeSession(p);
      item.reject(error);
    } finally {
      item.dispose(); p.running = false; p.lastUsed = this.now(); this.persist(p);
      if (p.blocked) for (const queued of p.queue.splice(0)) { queued.dispose(); queued.reject(failure(p.blocked)); }
      void this.drain(p).catch(() => this.storageFailure(p));
    }
  }
  async close(pool, client) {
    const p = this.pool(pool);
    if (p.running || p.queue.length || p.lease && p.lease !== client) throw failure('session-pool-busy');
    p.running = true;
    try {await this.closeSession(p);}
    finally {p.running = false; this.persist(p); void this.drain(p).catch(() => this.storageFailure(p));}
    return this.summary(p);
  }
  disconnect(client) {
    for (const p of this.pools.values()) {
      for (const item of [...p.queue]) if (item.client === client) {
        p.queue.splice(p.queue.indexOf(item), 1); item.dispose(); item.reject(failure('session-client-disconnected'));
      }
      if (p.lease === client) {
        p.blocked ||= 'session-lease-owner-disconnected';
        if (!p.running) {
          p.running = true;
          void this.closeSession(p).finally(() => {p.running = false; this.persist(p);}).catch(() => this.storageFailure(p));
        }
      }
    }
  }
  async sweep() {
    for (const p of this.pools.values()) if (!p.running && !p.queue.length && p.session && this.now() - p.lastUsed >= this.idleMs) {
      p.running = true;
      try {await this.closeSession(p);}
      finally {p.running = false; this.persist(p); void this.drain(p).catch(() => this.storageFailure(p));}
    }
  }
  summary(p) { return {pool: p.id, active: !!p.session, running: p.running, queued: p.queue.length,
    leased: !!p.lease, blocked: p.blocked, pendingEffects:p.pendingEffects, generation: p.generation, completed: p.completed, exit: p.exit || null,
    reconciliationToken: fs.existsSync(p.file) ? hash(fs.readFileSync(p.file, 'utf8')) : null}; }
  status() { return [...this.pools.values()].map(p => this.summary(p)); }
  markUnknown(pool) {const p=this.pool(pool);p.blocked||='session-outcome-unverified';this.persist(p);return this.summary(p);}
  reconcile(pool, {token, confirm, evidence, writeOutcome} = {}) {
    const p = this.pool(pool);
    if (!confirm || !p.blocked || p.running || p.queue.length || p.session || token !== this.summary(p).reconciliationToken ||
        !evidence || evidence.cleanupVerified !== true || !evidence.reference ||
        p.pendingEffects === 'write' && !['verified-applied','verified-not-applied'].includes(writeOutcome)) throw failure('session-reconciliation-evidence-required');
    const history = p.file + '.' + crypto.randomUUID() + '.resolved';
    fs.writeFileSync(history, JSON.stringify({previous:JSON.parse(fs.readFileSync(p.file,'utf8')), evidenceHash:hash(evidence), writeOutcome, at:new Date().toISOString()}), {flag:'wx',mode:0o600});
    p.blocked = null; p.pendingEffects = null; p.lease = null; this.persist(p, false);
    return {...this.summary(p), licenseReleaseVerified:false};
  }
  async stop() {
    if ([...this.pools.values()].some(p => p.running)) throw failure('session-pool-busy');
    this.stopping = true;
    for (const p of this.pools.values()) {
      for (const item of p.queue.splice(0)) {item.dispose(); item.reject(failure('session-manager-stopping'));}
      await this.closeSession(p);
    }
  }
}
module.exports = {SessionManager, hash, failure};
