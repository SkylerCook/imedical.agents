'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { test } = require('node:test');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');

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
