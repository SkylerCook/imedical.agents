'use strict';

const assert = require('node:assert/strict');
const { fork, spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');

test('Windows default launcher keeps startup diagnostics and handles picker cancellation', {
  skip: process.platform !== 'win32', timeout: 30000,
}, async t => {
  const root = createTempDirectory('workbench-default-launch-');
  t.after(() => {
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  fs.copyFileSync(path.resolve(__dirname, '../react/start-workbench.cmd'), path.join(root, 'start-workbench.cmd'));
  const selector = path.join(root, 'powershell.exe');
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const compile = `
$ErrorActionPreference = 'Stop'
$source = @'
using System;
public static class WorkbenchPickerFixture {
    public static int Main(string[] args) {
        if (args.Length != 4 || args[2] != "-Command") return 99;
        switch (Environment.GetEnvironmentVariable("WORKBENCH_TEST_PICKER_RESULT")) {
            case "cancelled": return 0;
            case "failed": Console.Error.WriteLine("fixture startup failed"); return 37;
            default: return 99;
        }
    }
}
'@
Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $env:WORKBENCH_TEST_PICKER_EXE -OutputType ConsoleApplication
`;
  const compiled = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(compile, 'utf16le').toString('base64')], {
    cwd: root, env: { ...process.env, WORKBENCH_TEST_PICKER_EXE: selector }, encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  assert.ifError(compiled.error);
  assert.equal(compiled.status, 0, compiled.stderr);
  assert.ok(fs.statSync(selector).isFile());

  // Exercise the actual batch file and PAUSE; the fixture returns the selector outcome without a native dialog.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PATH|ERRORLEVEL|WORKBENCH_TEST_PICKER_RESULT)$/i.test(key)));
  env.Path = [root, process.env.Path].join(path.delimiter);
  function invoke(command, outcome) {
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', command], {
      cwd: root, env: { ...env, WORKBENCH_TEST_PICKER_RESULT: outcome }, input: '\n', encoding: 'utf8', windowsHide: true, timeout: 5000,
    });
    assert.ifError(result.error);
    return result;
  }
  const pause = invoke('pause', 'cancelled');
  assert.equal(pause.status, 0, pause.stderr);
  const prompt = pause.stdout.trim();
  assert.ok(prompt, 'CMD returned no localized pause prompt');

  await t.test('startup failure retains stderr, pauses, and preserves the exit code', () => {
    const result = invoke('start-workbench.cmd', 'failed');
    assert.equal(result.status, 37);
    assert.match(result.stderr, /fixture startup failed/);
    assert.match(result.stdout, /Workbench could not start\. Check the message above\./);
    assert.ok(result.stdout.includes(prompt));
  });
  await t.test('picker cancellation exits successfully without a failure prompt', () => {
    const result = invoke('start-workbench.cmd', 'cancelled');
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, /Workbench could not start/);
    assert.ok(!result.stdout.includes(prompt));
  });
});

test('Windows background launcher exits after startup and the last page safely shuts down the service', {
  skip: process.platform !== 'win32', timeout: 25000,
}, async t => {
  const root = createTempDirectory('workbench-background-launch-');
  const streams = [];
  let workerPid;
  t.after(() => {
    for (const stream of streams) stream.abort();
    if (workerPid) {
      try { process.kill(workerPid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const launcher = fork(path.resolve(__dirname, '../src/start-release.js'), ['--background', '--project', root], {
    env: { ...process.env, PORT: '0', GIT_ALLOW_PROTOCOL: '' }, execArgv: [], silent: true, windowsHide: true,
  });
  const exited = once(launcher, 'exit');
  const [session] = await once(launcher, 'message', { signal: AbortSignal.timeout(8000) });
  workerPid = session.pid;
  assert.equal(typeof workerPid, 'number', session.startupError);
  assert.notEqual(workerPid, launcher.pid);
  assert.deepEqual(await exited, [0, null]);
  const origin = new URL(session.address).origin;
  const headers = { 'X-Workbench-Request': '1', 'Content-Type': 'application/json', Origin: origin };
  const post = (route, body, auth, signal) => fetch(origin + '/framework/' + route, {
    method: 'POST', headers: { ...headers, ...auth }, body: JSON.stringify(body), signal,
  });
  assert.equal((await post('page-presence', {})).status, 403);
  const exchange = await post('session', { token: session.bootstrap });
  const auth = { Cookie: exchange.headers.get('set-cookie').split(';')[0], 'X-Workbench-CSRF': (await exchange.json()).csrf };
  async function openPage() {
    const stream = new AbortController();
    streams.push(stream);
    const response = await post('page-presence', {}, auth, stream.signal);
    assert.equal(response.status, 200);
    return stream;
  }
  const first = await openPage();
  const second = await openPage();
  first.abort();
  second.abort();
  await delay(200);
  const refreshed = await openPage();
  await delay(5200);
  assert.equal((await fetch(origin + '/framework.json', { headers })).status, 200);
  refreshed.abort();
  const deadline = Date.now() + 7500;
  while (Date.now() < deadline) {
    try { process.kill(workerPid, 0); }
    catch (error) {
      assert.equal(error.code, 'ESRCH');
      workerPid = undefined;
      break;
    }
    await delay(100);
  }
  assert.equal(workerPid, undefined, 'The background service is still running without pages');
});

test('Windows package launcher keeps two project sessions independent', { skip: process.platform !== 'win32' }, async t => {
  const root = createTempDirectory('workbench-parallel-launch-');
  const launches = [];
  t.after(async () => {
    for (const { stop, child } of launches) {
      if (child.exitCode === null && child.signalCode === null) fs.writeFileSync(stop, '');
    }
    try { await Promise.all(launches.map(({ stopped }) => stopped)); }
    finally {
      assert.ok(ownsTempDirectory(root));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  const workbench = path.resolve(__dirname, '..');
  const shim = path.join(root, 'tools/agents-workbench/prototype/serve.js');
  const launcher = path.join(root, 'tools/agents-workbench/src');
  fs.mkdirSync(path.dirname(shim), { recursive: true });
  fs.mkdirSync(launcher, { recursive: true });
  fs.mkdirSync(path.join(root, 'runtime'));
  fs.copyFileSync(process.execPath, path.join(root, 'runtime/node.exe'));
  fs.copyFileSync(path.join(workbench, 'react/start-workbench.cmd'), path.join(root, 'start-workbench.cmd'));
  for (const name of ['start-release.js', 'release-selection.js']) fs.copyFileSync(path.join(workbench, 'src', name), path.join(launcher, name));
  fs.writeFileSync(path.join(launcher, 'release-launcher.js'), 'throw Error("the non-release fixture must not select a candidate");');
  // Exercise the real batch launcher without opening a desktop browser in the test.
  fs.writeFileSync(shim, `
    const fs = require('node:fs');
    const path = require('node:path');
    if (!process.argv.includes('--open')) process.exit(2);
    process.argv.splice(process.argv.indexOf('--open'), 1);
    const projectIndex = process.argv.indexOf('--project');
    const stop = projectIndex === -1 ? path.join(process.cwd(), 'stop-workbench-demo') :
      path.join(process.argv[projectIndex + 1], 'stop-workbench');
    process.send = message => console.log('test-ready ' + JSON.stringify(message));
    setInterval(() => { if (fs.existsSync(stop)) process.exit(0); }, 50).unref();
    setTimeout(() => process.exit(3), 30000).unref();
    require(${JSON.stringify(path.join(workbench, 'prototype/serve.js'))});
  `);

  async function launch(name, port, demo = false) {
    const project = path.join(root, name);
    fs.mkdirSync(project);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PORT'));
    if (port !== undefined) env.PORT = port;
    const args = demo ? ['--demo'] : ['--project', `"${name}"`];
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start-workbench.cmd', ...args], {
      cwd: root, env, windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stopped = once(child, 'close');
    const stop = demo ? path.join(root, 'stop-workbench-demo') : path.join(project, 'stop-workbench');
    launches.push({ child, stop, stopped });
    const lines = createInterface({ input: child.stdout });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    const ready = async () => {
      for await (const line of lines) {
        if (line.startsWith('test-ready ')) return JSON.parse(line.slice('test-ready '.length));
      }
      throw new Error(`Workbench did not start: ${stderr}`);
    };
    const deadline = setTimeout(() => lines.close(), 10000);
    try {
      const { address, bootstrap } = await Promise.race([ready(), stopped.then(([code]) => {
        throw new Error(`Workbench exited with ${code}: ${stderr}`);
      })]);
      const { origin, hash } = new URL(address);
      return { origin, hash, bootstrap, stop, stopped };
    } finally {
      clearTimeout(deadline);
      lines.close();
    }
  }

  const first = await launch('工程 甲');
  const second = await launch('工程 乙');
  assert.notEqual(first.origin, second.origin);
  assert.equal(new URL(first.origin).hostname, '127.0.0.1');
  const demo = await launch('演示', undefined, true);
  assert.equal(demo.hash, '#/clinic/home');
  assert.equal((await (await fetch(demo.origin + '/project.json')).json()).error, '启动时尚未绑定工程');
  assert.equal(new URL(second.origin).hostname, '127.0.0.1');
  await assert.rejects(launch('工程 端口冲突', new URL(first.origin).port), /is in use.*PORT=0/);

  // A browser cookie jar is scoped to the loopback host and path, across both ports.
  const cookies = new Map();
  async function post(instance, route, body, csrf) {
    const headers = {
      'X-Workbench-Request': '1',
      'Content-Type': 'application/json',
      Origin: instance.origin,
      Cookie: [...cookies.values()].join('; '),
    };
    if (csrf) headers['X-Workbench-CSRF'] = csrf;
    const response = await fetch(instance.origin + '/framework/' + route, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(4000),
    });
    const issued = response.headers.get('set-cookie');
    if (issued) cookies.set(issued.split('=')[0], issued.split(';')[0]);
    assert.equal(response.status, 200);
    return response.json();
  }
  const firstSession = await post(first, 'session', { token: first.bootstrap });
  const secondSession = await post(second, 'session', { token: second.bootstrap });
  assert.deepEqual(await post(first, 'session', {}), firstSession);
  assert.deepEqual(await post(second, 'session', {}), secondSession);

  async function refresh(instance, session) {
    const response = await fetch(instance.origin + '/framework.json', {
      headers: { 'X-Workbench-Request': '1' }, signal: AbortSignal.timeout(4000),
    });
    assert.equal(response.status, 200);
    const { projectId, revision } = await response.json();
    return post(instance, 'action', { projectId, revision: revision ?? null, action: 'refresh' }, session.csrf);
  }
  const [firstState, secondState] = await Promise.all([refresh(first, firstSession), refresh(second, secondSession)]);
  assert.equal(firstState.name, '工程 甲');
  assert.equal(secondState.name, '工程 乙');
  assert.notEqual(firstState.projectId, secondState.projectId);

  fs.writeFileSync(first.stop, '');
  assert.equal((await first.stopped)[0], 0);
  assert.equal((await refresh(second, secondSession)).projectId, secondState.projectId);
});

test('disconnecting from the launcher drains an admitted settings write after its HTTP client leaves', {
  timeout: 20000,
}, async t => {
  const root = createTempDirectory('workbench-settings-drain-');
  const project = path.join(root, '工程');
  const capability = path.join(project, '.agents');
  const config = path.join(capability, 'config/project.jsonc');
  const preload = path.join(root, 'owner-gate.cjs');
  const marker = name => path.join(root, name);
  const initial = { deployment: { schema: 'plugin-deployment/v1', mode: 'on-demand', autoInstall: false } };
  const env = { ...process.env, PORT: '0', WORKBENCH_STARTUP_PARENT: '1', WORKBENCH_TEST_GATE: root,
    BOS_MCP_CONFIG: '', KNOWLEDGE_RAG_CONFIG: '', GIT_ALLOW_PROTOCOL: '', GIT_NO_LAZY_FETCH: '1' };
  let server, stopped;
  t.after(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      fs.writeFileSync(marker('release'), '');
      if (server.connected) server.disconnect();
      const timedOut = await Promise.race([stopped.then(() => false), delay(4000, true, { ref: false })]);
      if (timedOut) { server.kill('SIGKILL'); await stopped; }
    }
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  fs.mkdirSync(path.dirname(config), { recursive: true });
  const initialized = spawnSync('git', ['init', '-q', capability], { env, encoding: 'utf8', windowsHide: true });
  assert.equal(initialized.status, 0, initialized.stderr);
  fs.writeFileSync(config, JSON.stringify(initial));
  fs.writeFileSync(preload, `
    const fs = require('node:fs');
    const http = require('node:http');
    const path = require('node:path');
    const { setTimeout: delay } = require('node:timers/promises');
    const mark = name => path.join(process.env.WORKBENCH_TEST_GATE, name);
    const createServer = http.createServer;
    http.createServer = (...args) => {
      const server = createServer(...args);
      server.on('request', (request, response) => {
        if (request.url !== '/framework/settings/apply') return;
        response.once('close', () => {
          if (!response.writableFinished) fs.writeFileSync(mark('client-closed'), '');
        });
      });
      return server;
    };
    const settings = require(${JSON.stringify(path.join(__dirname, '../prototype/project-settings.js'))});
    const createSettings = settings.createProjectSettings;
    settings.createProjectSettings = (...args) => {
      const owner = createSettings(...args);
      return { ...owner, async apply(...applyArgs) {
        fs.writeFileSync(mark('owner-entered'), '');
        for (let attempt = 0; !fs.existsSync(mark('release')); attempt++) {
          if (attempt === 300) throw Error('test did not release settings owner');
          await delay(25);
        }
        const result = await owner.apply(...applyArgs);
        fs.writeFileSync(mark('owner-completed'), result.status);
        return result;
      } };
    };
  `);
  server = fork(path.join(__dirname, '../prototype/serve.js'), ['--project', project], {
    env, execArgv: ['--require', preload], silent: true,
  });
  stopped = once(server, 'exit');
  const [hello] = await Promise.race([once(server, 'message', { signal: AbortSignal.timeout(6000) }),
    stopped.then(([code]) => { throw Error(`Workbench exited before it started (${code})`); })]);
  const origin = new URL(hello.address).origin;
  const headers = { 'x-workbench-request': '1', connection: 'close' };
  const postHeaders = { ...headers, origin, 'content-type': 'application/json' };
  const post = (route, body, auth = {}) => fetch(origin + route, {
    method: 'POST', headers: { ...postHeaders, ...auth }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000),
  });
  const session = await post('/framework/session', { token: hello.bootstrap });
  assert.equal(session.status, 200);
  const auth = { cookie: session.headers.get('set-cookie').split(';')[0], 'x-workbench-csrf': (await session.json()).csrf };
  const settings = await fetch(origin + '/settings/project', { headers, signal: AbortSignal.timeout(4000) });
  assert.equal(settings.status, 200);
  const { revision } = await settings.json();
  const preview = await post('/framework/settings/plan/project', {
    revision, changes: { 'deployment.autoInstall': { value: true } },
  }, auth);
  assert.equal(preview.status, 200);
  const { planId } = await preview.json();
  const requestBody = JSON.stringify({ planId });
  const request = http.request(origin + '/framework/settings/apply', {
    method: 'POST', headers: { ...postHeaders, ...auth, 'content-length': Buffer.byteLength(requestBody) },
  });
  request.on('error', () => {}); // The test intentionally destroys this socket.
  const clientClosed = new Promise(resolve => request.once('close', resolve));
  request.end(requestBody);
  async function waitForMarker(name) {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (fs.existsSync(marker(name))) return;
      await delay(25);
    }
    assert.fail(`the workbench did not reach ${name}`);
  }
  await waitForMarker('owner-entered');
  request.destroy();
  await clientClosed;
  await waitForMarker('client-closed');
  server.disconnect();

  let closed = false;
  for (let attempt = 0; attempt < 30 && !closed; attempt++) {
    try {
      const probe = await fetch(origin + '/framework.json', { headers, signal: AbortSignal.timeout(400) });
      if (probe.status === 503) {
        assert.deepEqual(await probe.json(), { error: 'workbench-shutting-down' });
        closed = true;
      } else {
        assert.equal(probe.status, 200);
        await probe.text();
      }
    } catch (error) {
      if (!['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes(error.cause?.code)) throw error;
      closed = true;
    }
    if (!closed) await delay(25);
  }
  assert.ok(closed, 'the workbench still accepted new HTTP requests during shutdown');
  assert.equal(server.exitCode, null);
  assert.equal(server.signalCode, null);
  assert.equal(fs.existsSync(marker('owner-completed')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(config, 'utf8')), initial);
  fs.writeFileSync(marker('release'), '');

  assert.deepEqual(await stopped, [0, null]);
  assert.equal(fs.readFileSync(marker('owner-completed'), 'utf8'), 'saved');
  assert.equal(JSON.parse(fs.readFileSync(config, 'utf8')).deployment.autoInstall, true);
});
