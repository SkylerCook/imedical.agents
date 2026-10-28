'use strict';
const {createTempDirectory,ownsTempDirectory}=require('../../../../../scripts/tests/fixtures/temp-directory');
const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const recovery = require('../deploy-recovery'), guard = require('../deploy-guard');
const {run} = require('../deploy-direct');
const fault = (extra = {}) => Object.assign(new Error('synthetic connection failure'), {code: 'ECONNRESET', ...extra});
function fixture(t) {
  const root = createTempDirectory('iris-recovery-');
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const files = ['A', 'B'].map(name => {
    const localPath = path.join(root, name + '.js');
    fs.writeFileSync(localPath, '// ' + name + '\n');
    return {localPath, remotePath: name + '.js'};
  });
  const remote = new Map(), puts = [], compiles = [];
  const adapter = {
    read: async file => remote.get(file.remotePath) ?? null,
    put: async file => { puts.push(file.remotePath); remote.set(file.remotePath, file.bytes); },
    compile: async files => { compiles.push(files.map(file => file.remotePath)); return {status: 'compiled'}; }
  };
  return {root, files, remote, puts, compiles, adapter};
}
const fast = adapter => recovery.wrap(adapter, {wait: async () => {}});

test('a transient read after a partial upload continues without replaying completed steps', async t => {
  const f = fixture(t), read = f.adapter.read;
  let failed = false;
  f.adapter.read = async file => {
    if (!failed && f.puts.length === 1 && file.remotePath === 'B.js') { failed = true; throw fault(); }
    return read(file);
  };
  const result = await run({...f, adapter: fast(f.adapter), kind: 'frontend'});
  assert.equal(result.status, 'verified');
  assert.deepEqual(f.puts, ['A.js', 'B.js']); assert.equal(f.compiles.length, 1);
  assert.equal(result.recovery.attempts.length, 1);
  assert.equal(result.recovery.attempts[0].status, 'recovered');
});

test('post-compile read recovery never compiles again and the budget is shared', async t => {
  const f = fixture(t), read = f.adapter.read;
  const failed = new Set();
  f.adapter.read = async file => {
    const phase = f.compiles.length ? 'after-compile' : 'preflight';
    if (!failed.has(phase)) { failed.add(phase); throw fault(); }
    return read(file);
  };
  const result = await run({...f, adapter: fast(f.adapter), kind: 'frontend'});
  assert.equal(result.status, 'verified'); assert.equal(f.compiles.length, 1);
  assert.deepEqual(result.recovery.attempts.map(entry => entry.operation), ['read', 'read']);
  assert.equal(result.recovery.limit, 2);
});

test('persistent failures consume exactly two extra reads and stop before writes', async t => {
  const f = fixture(t); let reads = 0;
  f.adapter.read = async () => { reads++; throw fault(); };
  const result = await run({...f, adapter: fast(f.adapter), kind: 'frontend'});
  assert.equal(result.status, 'blocked'); assert.equal(reads, 3);
  assert.equal(result.recovery.attempts.length, 2);
  assert.deepEqual(f.puts, []); assert.deepEqual(f.compiles, []);
});

test('exhausted post-compile reads retain compiled evidence without replay or misclassifying an unsent upload', async t => {
  const f = fixture(t), read = f.adapter.read;
  f.adapter.read = async file => { if (f.compiles.length) throw fault({beforeSend: true}); return read(file); };
  const result = await run({...f, adapter: fast(f.adapter), kind: 'frontend'});
  assert.equal(result.status, 'failed-or-unknown'); assert.equal(result.remoteCompilation, 'compiled');
  assert.equal(f.compiles.length, 1); assert.deepEqual(f.puts, ['A.js', 'B.js']);
  assert.equal(result.recovery.attempts.length, 2);
});

test('unsent upload retries share a finite budget and use bounded backoff', async t => {
  const f = fixture(t); let writes = 0; const delays = [];
  f.adapter.put = async () => { writes++; throw fault({beforeSend: true}); };
  const result = await run({...f, adapter: recovery.wrap(f.adapter, {wait: async delay => { delays.push(delay); }}), kind: 'frontend'});
  assert.equal(writes, 3); assert.deepEqual(delays, [250, 1000]);
  assert.equal(result.status, 'blocked'); assert.equal(result.partialOrUnknown, false);
  assert.equal(result.recovery.attempts.length, 2); assert.equal(f.compiles.length, 0);
});

test('a confirmed-unsent upload is retried only after both snapshots are rechecked', async t => {
  const f = fixture(t), put = f.adapter.put; let requests = 0;
  f.adapter.put = async file => { if (++requests === 1) throw fault({beforeSend: true}); return put(file); };
  const result = await run({...f, adapter: fast(f.adapter), kind: 'frontend'});
  assert.equal(result.status, 'verified'); assert.equal(requests, 3);
  assert.deepEqual(f.puts, ['A.js', 'B.js']); assert.equal(f.compiles.length, 1);
  assert.equal(result.recovery.attempts[0].operation, 'put');
});

test('source or server changes during recovery block the second upload', async t => {
  for (const mode of ['local', 'remote']) await t.test(mode, async t => {
    const f = fixture(t); let requests = 0;
    f.adapter.put = async () => { requests++; throw fault({beforeSend: true}); };
    const adapter = recovery.wrap(f.adapter, {wait: async () => {
      if (mode === 'local') fs.appendFileSync(f.files[0].localPath, '// user edit\n');
      else f.remote.set('A.js', Buffer.from('// other writer\n'));
    }});
    const result = await run({...f, adapter, kind: 'frontend'});
    assert.equal(requests, 1); assert.notEqual(result.status, 'verified');
    assert.match(result.reason, /^(local-changed|remote-changed)/); assert.equal(f.compiles.length, 0);
    if (mode === 'local') assert.match(fs.readFileSync(f.files[0].localPath, 'utf8'), /user edit/);
    else assert.equal(f.remote.get('A.js').toString(), '// other writer\n');
  });
});

test('local edits during the final pre-upload read recovery stop before the first write', async t => {
  const f = fixture(t), read = f.adapter.read; let aReads = 0;
  f.adapter.read = async file => { if (file.remotePath === 'A.js' && ++aReads === 2) throw fault(); return read(file); };
  const adapter = recovery.wrap(f.adapter, {wait: async () => { fs.appendFileSync(f.files[0].localPath, '// user edit\n'); }});
  const result = await run({...f, adapter, kind: 'frontend'});
  assert.equal(result.reason, 'local-changed-during-deploy'); assert.deepEqual(f.puts, []);
});

test('lost write replies and unknown compilation are never replayed', async t => {
  for (const mode of ['upload', 'compile']) await t.test(mode, async t => {
    const f = fixture(t); let requests = 0;
    if (mode === 'upload') f.adapter.put = async file => { requests++; f.remote.set(file.remotePath, file.bytes); throw fault(); };
    else f.adapter.compile = async () => { requests++; throw fault(); };
    const result = await run({...f, adapter: fast(f.adapter), kind: 'frontend'});
    assert.equal(result.status, 'failed-or-unknown'); assert.equal(requests, 1);
    assert.equal(result.recovery.attempts.length, 0);
    if (mode === 'upload') assert.equal(f.compiles.length, 0);
  });
});

test('503, authentication, TLS, semantic errors and admission gates never retry', async t => {
  for (const error of [fault({status: 503}), fault({httpStatus: 503}), fault({status: 401}), fault({status: 412}),
    fault({code: 'CERT_HAS_EXPIRED'}), fault({reason: 'readback-mismatch'}), fault({code: 'remote-pool-reconciliation-required'}),
    fault({code: 'night-checkpoint-blocked'}), fault({reason: 'publication-artifact-changed'})]) {
    const f = fixture(t); let reads = 0;
    f.adapter.read = async () => { reads++; throw error; };
    const result = await run({...f, adapter: fast(f.adapter), kind: 'frontend'});
    assert.equal(reads, 1); assert.equal(result.recovery.attempts.length, 0); assert.equal(f.puts.length, 0);
  }
});

test('all recovery reads retain the original admission wrapper', async () => {
  let reads = 0, gates = 0;
  const adapter = fast({read: async () => {
    gates++; if (++reads === 1) throw fault();
    throw Object.assign(new Error('frozen version changed'), {code: 'night-checkpoint-blocked'});
  }});
  await assert.rejects(adapter.read({remotePath: 'A.js'}), {code: 'night-checkpoint-blocked'});
  assert.equal(gates, 2); assert.equal(adapter.deploymentRecovery.attempts.length, 1);
});

test('guarded known compile failure needs diagnosis, and corrected source keeps its original deployment authority', async t => {
  const {spawnSync} = require('node:child_process'), f = fixture(t);
  const git = (...args) => {
    const result = spawnSync('git', ['-C', f.root, ...args], {encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  git('add', '.'); git('commit', '-m', 'base');
  const originalHome = os.homedir; os.homedir = () => f.root;
  t.after(() => { os.homedir = originalHome; });
  guard.initialize(f.root, '123', 'HEAD', true);
  const head = git('rev-parse', 'HEAD'), index = git('ls-files', '--stage');
  for (const file of f.files) f.remote.set(file.remotePath, fs.readFileSync(file.localPath));
  fs.appendFileSync(f.files[0].localPath, '// change\n');
  const compile = f.adapter.compile;
  f.adapter.compile = async () => { throw new guard.Attention('compile-failed', {compilation: {status: 'compile-failed', errors: ['syntax']}}); };
  const options = {...f, repo: f.root, target: 'synthetic', demand: '123', checkUpdates: () => {}};
  const read = f.adapter.read;
  const blocked = await guard.run({...options, adapter: fast({...f.adapter, read: async () => { throw fault(); }})});
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.question, undefined);
  assert.equal(Object.values(guard.read(guard.location(f.root, '123').file).targets)[0].status, 'blocked');
  f.adapter.read = read;
  const failed = await guard.run(options);
  assert.equal(failed.status, 'compile-failed'); assert.equal(failed.question, undefined);
  assert.equal(Object.values(guard.read(guard.location(f.root, '123').file).targets)[0].status, 'compile-failed');
  fs.appendFileSync(f.files[0].localPath, '// correction\n'); f.adapter.compile = compile;
  const result = await guard.run(options);
  assert.equal(result.status, 'verified'); assert.equal(f.compiles.length, 1);
  assert.equal(git('rev-parse', 'HEAD'), head); assert.equal(git('ls-files', '--stage'), index);
  // A transient inspection failure must never unlock a previously unknown write.
  fs.appendFileSync(f.files[0].localPath, '// later change\n');
  f.adapter.put = async () => { throw fault(); };
  assert.equal((await guard.run(options)).partialOrUnknown, true);
  const unresolved = await guard.run({...options, adapter: fast({...f.adapter, read: async () => { throw fault({beforeSend: true}); }})});
  assert.equal(unresolved.status, 'needs-user-input');
  assert.equal(Object.values(guard.read(guard.location(f.root, '123').file).targets)[0].status, 'failed-or-unknown');
  assert.equal((await guard.run(options)).reason, 'previous-result-unknown');
});

test('real Atelier transient GET failure recovers on the same client before a single write and compile', async t => {
  const http = require('node:http'), {backendAdapter} = require('../deploy-protected'), f = fixture(t);
  let content = ['// old'], gets = 0, puts = 0, compiles = 0;
  const server = http.createServer((request, response) => {
    let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => {
      if (request.method === 'GET' && ++gets === 1) return request.socket.destroy();
      if (request.method === 'PUT') { puts++; content = JSON.parse(body).content; }
      if (request.method === 'POST') compiles++;
      response.end(JSON.stringify({status: {errors: []}, result: {content: request.method === 'POST' ? [] : content, ts: '2026-01-01 00:00:00.000'}, console: []}));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const adapter = backendAdapter({protocol: 'http:', hostname: '127.0.0.1', port: server.address().port, namespace: 'TEST'});
  t.after(() => adapter.close());
  const result = await run({...f, files: [f.files[0]], adapter: fast(adapter), kind: 'frontend'});
  assert.equal(result.status, 'verified', JSON.stringify(result)); assert.equal(puts, 1); assert.equal(compiles, 1);
  assert.equal(result.recovery.attempts.length, 1);
});
