'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const {spawn, spawnSync} = require('node:child_process');
const {hash, failure} = require('./iris-session-manager');
const VERSION = 1, MAX_BYTES = 20 * 1024 * 1024;
const RUNTIME = hash(['iris-session-ipc.js','iris-session-manager.js','iris-session-backends.js','iris-session-client.js',
  '../iris-session-host.js','../iris-mcp.js','atelier-client.js','iris-remote-operations.js','workspace-context.js']
  .map(name => fs.readFileSync(path.join(__dirname,name),'utf8')));

function location(root = path.join(os.homedir(), '.imedical', 'iris-sessions')) {
  root = path.resolve(root);
  const endpoint = process.platform === 'win32' ? '\\\\.\\pipe\\imedical-iris-' + hash([os.userInfo().username, root]).slice(0, 32) : path.join(root, 's');
  // macOS sockaddr_un allows 103 pathname bytes plus the terminating NUL.
  // Fail before creating a lock/key instead of truncating to another user's path.
  if (process.platform !== 'win32' && Buffer.byteLength(endpoint) > 103) throw failure('session-ipc-root-too-long');
  return {root, endpoint};
}
function privateDirectory(root) {
  let current = path.parse(root).root;
  for (const part of root.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw failure('session-directory-linked');
  }
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  if (process.platform === 'win32') {
    const who = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], {encoding: 'utf8', windowsHide: true});
    const sid = who.stdout?.match(/S-1-5-[0-9-]+/)?.[0];
    if (!sid) throw failure('session-user-identity-unavailable');
    const acl = spawnSync('icacls', [root, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'], {encoding: 'utf8', windowsHide: true});
    if (acl.status !== 0) throw failure('session-directory-acl-failed');
  } else {
    fs.chmodSync(root, 0o700);
    if (fs.statSync(root).uid !== process.getuid()) throw failure('session-directory-owner-mismatch');
  }
}
function key(root, create = false) {
  const file = path.join(root, 'ipc.key');
  if (create) {
    privateDirectory(root);
    try { fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), {flag: 'wx', mode: 0o600}); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).nlink !== 1) throw failure('session-ipc-key-linked');
  const value = fs.readFileSync(file, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(value)) throw failure('session-ipc-key-invalid');
  return value;
}
function frame(socket, callback) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', data => {
    buffer += data;
    if (Buffer.byteLength(buffer) > MAX_BYTES) {socket.destroy(); return;}
    let n;
    while ((n = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, n); buffer = buffer.slice(n + 1);
      try {callback(JSON.parse(line));} catch {socket.destroy(); return;}
    }
  });
}
class Client {
  constructor(socket, secret) {
    this.socket = socket; this.secret = secret; this.pending = new Map(); this.next = 1;
    frame(socket, value => {
      if(value.notification) {this.onNotification?.(value.notification);return;}
      const pending = this.pending.get(value.id); if (!pending) return;
      this.pending.delete(value.id); clearTimeout(pending.timer);
      value.error ? pending.reject(Object.assign(failure(value.error.code, value.error.beforeSend), value.error)) : pending.resolve(value.result);
    });
    const disconnected = () => {
      for (const p of this.pending.values()) {clearTimeout(p.timer); p.reject(failure('session-ipc-disconnected', false));}
      this.pending.clear();
    };
    socket.on('error', disconnected); socket.on('close', disconnected);
  }
  request(method, params = {}, timeoutMs = 125000, signal) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {this.pending.delete(id); this.cancel(id); reject(failure('session-ipc-timeout', false));}, timeoutMs);
      const abort = () => this.cancel(id);
      const finish = callback => value => {signal?.removeEventListener('abort', abort);callback(value);};
      if (signal?.aborted) {clearTimeout(timer);reject(failure('session-request-cancelled'));return;}
      signal?.addEventListener('abort', abort, {once:true});
      this.pending.set(id, {resolve:finish(resolve), reject:finish(reject), timer});
      this.socket.write(JSON.stringify({version: VERSION, runtime:RUNTIME, auth: this.secret, id, method, params}) + '\n');
    });
  }
  cancel(id) { this.socket.write(JSON.stringify({version: VERSION, runtime:RUNTIME, auth: this.secret, method: 'cancel', params: {id}}) + '\n'); }
  close() {this.socket.end();}
}
async function connect({root, start = true} = {}) {
  const loc = location(root);
  const attempt = () => new Promise((resolve, reject) => {
    const socket = net.connect(loc.endpoint);
    const timer = setTimeout(() => socket.destroy(failure('session-connect-timeout')), 2000);
    socket.once('error', error => {clearTimeout(timer); reject(error);});
    socket.once('connect', () => {clearTimeout(timer); try {resolve(new Client(socket, key(loc.root)));} catch(e) {socket.destroy(); reject(e);}});
  });
  try {return await attempt();} catch(e) {if (!start || !['ENOENT','ECONNREFUSED'].includes(e.code)) throw e;}
  key(loc.root, true);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'iris-session-host.js'), '--root', loc.root], {detached: true, windowsHide: true, stdio: 'ignore'});
  child.on('error', () => {}); child.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try {return await attempt();} catch(e) {if (!['ENOENT','ECONNREFUSED'].includes(e.code)) throw e;}
  }
  throw failure('session-host-start-failed');
}
module.exports = {location, privateDirectory, key, frame, connect, VERSION, RUNTIME};
