#!/usr/bin/env node
'use strict';
const net = require('node:net'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {SessionManager, failure} = require('./lib/iris-session-manager');
const ipc = require('./lib/iris-session-ipc');
const backends = require('./lib/iris-session-backends');

async function serve({root, open = backends.open, describe = backends.operation, idleMs = 120000, hostIdleMs = 30000} = {}) {
  const loc = ipc.location(root), secret = ipc.key(loc.root, true);
  const lock = path.join(loc.root, 'host.json');
  if (fs.existsSync(lock)) {
    const prior = JSON.parse(fs.readFileSync(lock, 'utf8'));
    try {process.kill(prior.pid, 0); throw failure('session-host-already-running');}
    catch(e) {if (e.code !== 'ESRCH') throw e;}
    fs.unlinkSync(lock);
    if (process.platform !== 'win32' && fs.existsSync(loc.endpoint)) fs.unlinkSync(loc.endpoint);
  }
  fs.writeFileSync(lock, JSON.stringify({pid: process.pid}), {flag: 'wx', mode: 0o600});
  const manager = new SessionManager({directory: path.join(loc.root, 'pools'), open, idleMs});
  let lastActive = Date.now(), emptySince = null, closing = false, ticking = false;
  const clients = new Set();
  const server = net.createServer(socket => {
    clients.add(socket); const client = crypto.randomUUID(), requests = new Map();
    socket.on('error', () => {});
    socket.on('close', () => {clients.delete(socket); for (const ctrl of requests.values()) ctrl.abort(); manager.disconnect(client);});
    ipc.frame(socket, value => {
      if (value.version !== ipc.VERSION || typeof value.auth !== 'string' || value.auth.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(value.auth), Buffer.from(secret))) {socket.destroy(); return;}
      if(value.runtime!==ipc.RUNTIME && !['status','close'].includes(value.method)) {
        socket.write(JSON.stringify({id:value.id,error:{code:'session-host-version-mismatch',beforeSend:true}})+'\n');return;
      }
      if (value.method === 'cancel') {requests.get(value.params?.id)?.abort(); return;}
      const ctrl = new AbortController(); requests.set(value.id, ctrl); lastActive = Date.now();
      (async () => {
        if (value.method === 'status') return {protocolVersion: ipc.VERSION, pools: manager.status()};
        if (value.method === 'close') {const d = backends.describe(value.params.projectRoot, value.params.serverName,{localOnly:true}); return manager.close(d.pool, client);}
        if (value.method === 'markUnknown') {const d=backends.describe(value.params.projectRoot,value.params.serverName,{localOnly:true});return manager.markUnknown(d.pool);}
        if (value.method === 'reconcile') {
          const d = backends.describe(value.params.projectRoot, value.params.serverName,{localOnly:true});
          return manager.reconcile(d.pool, value.params);
        }
        if (value.method !== 'call') throw failure('session-ipc-method-invalid');
        const op = describe(value.params);
        op.notify=notification=>{if(!socket.destroyed)socket.write(JSON.stringify({notification})+'\n');};
        op.runtime=ipc.RUNTIME;
        return manager.submit({pool: op.pool, identity: op.identity, client, operation: op, signal: ctrl.signal,
          lease: op.params?.name === 'iris_ws_open', releaseLease: op.params?.name === 'iris_ws_close'});
      })().then(result => {if (!socket.destroyed) socket.write(JSON.stringify({id: value.id, result}) + '\n');}, error => {
        if (!socket.destroyed) socket.write(JSON.stringify({id: value.id, error: {code: /^[a-z0-9-]+$/.test(error.code || '') ? error.code : 'session-operation-failed', beforeSend: error.beforeSend === true}}) + '\n');
      }).finally(() => {requests.delete(value.id); lastActive = Date.now();});
    });
  });
  const stop = async () => {
    if (closing) return;
    await manager.stop(); closing = true; clearInterval(timer);
    for (const socket of clients) socket.end();
    await new Promise(resolve => server.close(resolve));
    if (fs.existsSync(lock) && JSON.parse(fs.readFileSync(lock, 'utf8')).pid === process.pid) fs.unlinkSync(lock);
  };
  try {
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(loc.endpoint, resolve);});
  } catch (error) {
    if (fs.existsSync(lock) && JSON.parse(fs.readFileSync(lock, 'utf8')).pid === process.pid) fs.unlinkSync(lock);
    throw error;
  }
  if (process.platform !== 'win32') fs.chmodSync(loc.endpoint, 0o600);
  const timer = setInterval(async () => {
    if (ticking || closing) return; ticking = true;
    try {
      await manager.sweep();
      if(manager.status().some(p => p.active || p.running || p.queued))emptySince=null;
      else {
        emptySince ??= Date.now();
        if(Date.now()-Math.max(emptySince,lastActive)>=hostIdleMs)await stop();
      }
    } catch { /* Keep durable unresolved state; never restart or replay here. */ }
    finally {ticking = false;}
  }, 1000);
  return {manager, stop};
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--root') process.exitCode = 1;
  else serve({root: args[1]}).then(host => {
    for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => host.stop().catch(() => {}));
  }).catch(() => {process.exitCode = 1;});
}
module.exports = {serve};
