'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');
const { createFrameworkService } = require('../src/framework-service');
const { createReleaseUpdateService } = require('../src/release-update');

const actionTimeout = 15000;
const fixtureDigest = 'b'.repeat(64);

function fixture(t) {
  const root = createTempDirectory('workbench-file-picker-');
  const project = path.join(root, '合成 工程');
  const applicationRoot = path.join(root, '基本安装');
  const recordFile = path.join(root, '工作台发行记录.json');
  const archive = path.join(root, 'agents-workbench-react.zip');
  const offlineRecord = path.join(root, '可信发行记录.json');
  const bundle = path.join(root, '离线能力包', 'capability.bundle');
  const business = path.join(project, 'business.txt');
  const cleanup = [];
  t.after(async () => {
    try {
      for (const close of cleanup) await close();
    } finally {
      assert.ok(ownsTempDirectory(root));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  });
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(applicationRoot, 'runtime'), { recursive: true });
  fs.mkdirSync(path.dirname(bundle));
  fs.writeFileSync(business, 'original fixture bytes\r\n');
  fs.writeFileSync(bundle, 'fixture rejected if passed to the preview');
  fs.writeFileSync(offlineRecord, JSON.stringify({
    schema: 'imedical-agents-offline-bundle/v1', bundle: 'capability.bundle',
    objectFormat: 'sha1', ref: 'refs/heads/master', revision: 'a'.repeat(40), sha256: fixtureDigest,
  }));
  // The chooser's fixture represents a portable application. It never launches this sentinel.
  fs.writeFileSync(path.join(applicationRoot, 'runtime/node.exe'), 'fixture runtime');
  const baseRecord = { formal: true, localBuildChanges: false, platform: 'windows-x64', version: '1.0.0' };
  fs.writeFileSync(path.join(applicationRoot, 'workbench-release.json'), JSON.stringify(baseRecord));
  fs.writeFileSync(archive, 'fixture archive');
  fs.writeFileSync(recordFile, JSON.stringify({
    ...baseRecord, version: '1.1.0', file: 'agents-workbench-react.zip', node: '24.22.3',
    sourceBaseRevision: 'a'.repeat(40), installerSha256: fixtureDigest, documentationSha256: {},
    bytes: fs.statSync(archive).size, sha256: fixtureDigest,
  }));
  return {
    root, project, applicationRoot, cleanup,
    offlineFiles: { releaseRecord: offlineRecord, bundle },
    releaseFiles: { releaseRecord: recordFile, archive },
    assertProjectUnchanged() {
      assert.deepEqual(fs.readdirSync(project), ['business.txt']);
      assert.equal(fs.readFileSync(business, 'utf8'), 'original fixture bytes\r\n');
    },
  };
}

async function loopback(f, options) {
  const app = createFrameworkService(f.project, options);
  let origin;
  const server = http.createServer((req, res) => {
    app.handle(req, res, req.url.slice(1), origin).catch(() => res.destroy());
  });
  // Close the sockets before removing the fixture, including after a failed assertion.
  f.cleanup.push(async () => {
    const closed = server.listening && new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await app.shutdown?.();
    await closed;
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-Workbench-Request': '1', 'Content-Type': 'application/json', Origin: origin, Connection: 'close' };
  const auth = {};
  async function post(route, body) {
    const res = await fetch(origin + '/framework/' + route, {
      method: 'POST', headers: { ...headers, ...auth },
      body: JSON.stringify(body), signal: AbortSignal.timeout(actionTimeout),
    });
    return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie') };
  }
  async function read() {
    const res = await fetch(origin + '/framework.json', { headers, signal: AbortSignal.timeout(actionTimeout) });
    assert.equal(res.status, 200);
    return res.json();
  }
  const session = await post('session', { token: app.bootstrap });
  assert.equal(session.status, 200);
  auth.cookie = session.cookie.split(';', 1)[0];
  auth['X-Workbench-CSRF'] = session.body.csrf;
  const initial = await read();
  const bound = await post('action', { action: 'refresh', projectId: initial.projectId, revision: null });
  assert.equal(bound.status, 200);
  assert.equal(bound.body.status, 'no-framework');
  return {
    app, read, bound: bound.body,
    action: (route, action) => post(route, { action, projectId: bound.body.projectId, revision: bound.body.revision }),
  };
}

function delayedPicker(finish) {
  const started = Promise.withResolvers();
  const aborted = Promise.withResolvers();
  async function choose({ signal } = {}) {
    started.resolve(signal);
    signal.throwIfAborted();
    await new Promise(resolve => {
      signal.addEventListener('abort', () => {
        aborted.resolve();
        setImmediate(resolve);
      }, { once: true });
    });
    return finish();
  }
  return { choose, started: started.promise, aborted: aborted.promise };
}

async function waitForPicker(picker, request) {
  const signal = await Promise.race([
    picker.started,
    request.then(result => assert.fail(`Picker did not start: ${JSON.stringify(result)}`)),
  ]);
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
  return signal;
}

test('shutdown cancels an offline selection that returns files after its signal aborts', { timeout: 25000 }, async t => {
  const f = fixture(t);
  const picker = delayedPicker(() => f.offlineFiles);
  const workbench = await loopback(f, { pickOffline: picker.choose });
  const pending = workbench.action('offline', 'select');
  const signal = await waitForPicker(picker, pending);
  assert.equal((await workbench.read()).busy, true);
  const closing = workbench.app.shutdown();
  await picker.aborted;
  assert.equal(signal.aborted, true);
  const response = await pending;
  await closing;
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { cancelled: true, offline: null });
  assert.equal((await workbench.read()).busy, false);
  f.assertProjectUnchanged();
});

test('shutdown cancels a release picker that rejects after abort without importing a candidate', { timeout: 25000 }, async t => {
  const f = fixture(t);
  const picker = delayedPicker(() => { throw new DOMException('Fixture picker cancelled', 'AbortError'); });
  const launch = t.mock.fn();
  const releaseUpdate = createReleaseUpdateService(f.project, {
    applicationRoot: f.applicationRoot, platform: 'win32', choose: picker.choose, launch,
  });
  const workbench = await loopback(f, { releaseUpdate });
  assert.equal(workbench.bound.workbenchUpdate, true);
  const pending = workbench.action('release-update', 'open');
  const signal = await waitForPicker(picker, pending);
  assert.equal((await workbench.read()).busy, true);
  const closing = workbench.app.shutdown();
  await picker.aborted;
  assert.equal(signal.aborted, true);
  const response = await pending;
  await closing;
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { cancelled: true });
  assert.equal(launch.mock.callCount(), 0);
  assert.equal(fs.existsSync(path.join(f.applicationRoot, '.workbench-launch')), false);
  assert.equal((await workbench.read()).busy, false);
  f.assertProjectUnchanged();
});

test('shutdown preserves an already admitted release import and returns its receipt', { timeout: 25000 }, async t => {
  const f = fixture(t);
  const admitted = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const installed = path.join(f.root, 'candidate-receipt.txt');
  const address = 'http://127.0.0.1:12345/#home';
  const releaseUpdate = createReleaseUpdateService(f.project, {
    applicationRoot: f.applicationRoot, platform: 'win32', choose: async () => f.releaseFiles,
    launch: async options => {
      admitted.resolve(options);
      await finish.promise;
      fs.writeFileSync(installed, 'admitted fixture import');
      return { release: { version: '1.1.0', sha256: fixtureDigest, treeDigest: fixtureDigest }, address };
    },
  });
  const workbench = await loopback(f, { releaseUpdate });
  const pending = workbench.action('release-update', 'open');
  const options = await Promise.race([
    admitted.promise,
    pending.then(result => assert.fail(`Import did not start: ${JSON.stringify(result)}`)),
  ]);
  const closing = workbench.app.shutdown();
  let response;
  try {
    assert.equal(options.signal?.aborted ?? false, false);
    assert.equal((await workbench.read()).busy, true);
  } finally {
    finish.resolve();
    response = await pending;
    await closing;
  }
  assert.equal(response.status, 200);
  assert.equal(response.body.version, '1.1.0');
  assert.equal(response.body.address, address);
  assert.equal(fs.readFileSync(installed, 'utf8'), 'admitted fixture import');
  assert.equal((await workbench.read()).busy, false);
  f.assertProjectUnchanged();
});
