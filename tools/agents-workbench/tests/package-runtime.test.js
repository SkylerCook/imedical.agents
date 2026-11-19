'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, fork } = require('node:child_process');
const { once } = require('node:events');

const repo = path.resolve(__dirname, '../../..');
const react = 'tools/agents-workbench/react';

test('stage preserves directory contents under a Unicode path and serves its bound project', async t => {
  const parent = path.join(os.tmpdir(), 'Codex');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'workbench-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const stage = path.join(root, '中文 发布暂存');
  const runtime = process.env.WORKBENCH_TEST_NODE_RUNTIME;
  const args = [path.join(repo, react, 'package-runtime.mjs'), stage];
  if (runtime) args.push('--node-runtime', runtime);
  execFileSync(process.execPath, args, { cwd: root, windowsHide: true });
  assert.deepEqual(fs.readdirSync(root), [path.basename(stage)]);

  function compare(relative) {
    const source = path.join(repo, relative);
    const staged = path.join(stage, relative);
    if (fs.statSync(source).isDirectory()) {
      const children = fs.readdirSync(source).sort();
      assert.deepEqual(fs.readdirSync(staged).sort(), children, relative);
      for (const name of children) compare(path.join(relative, name));
    } else {
      assert.ok(fs.readFileSync(source).equals(fs.readFileSync(staged)), relative);
    }
  }
  for (const dir of ['tools/ai-dev-offline/vendor/jsonc-parser', 'tools/ai-dev-offline/vendor/iarna-toml', react + '/dist/assets']) compare(dir);

  const project = path.join(root, '独立 工程');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'AGENTS.md'), 'Project instructions');
  const executable = runtime ? path.join(stage, 'runtime/node.exe') : process.execPath;
  const version = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim();
  const server = fork(path.join(stage, 'tools/agents-workbench/prototype/serve.js'), ['--project',project], {
    cwd: stage, execPath: executable, env: {...process.env, PORT:'0', NODE_PATH:''}, silent:true,
  });
  const stopped = once(server, 'exit');
  try {
    const [hello] = await Promise.race([once(server, 'message'), stopped.then(([code]) => { throw Error('Staged server exited: ' + code); })]);
    const url = new URL('/framework.json', hello.address);
    let state;
    for (let attempt = 0; attempt < 60; attempt++) {
      const response = await fetch(url, {headers:{'X-Workbench-Request':'1'}, signal:AbortSignal.timeout(5000)});
      assert.equal(response.status, 200);
      state = await response.json();
      if (state.status !== 'observing') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(state.name, path.basename(project));
    assert.equal(state.status, 'no-framework');
    assert.ok(Date.parse(state.observedAt));
    t.diagnostic(version + ' GET /framework.json 200; ' + state.name + ' ' + state.status);
  } finally { server.kill(); await stopped; }
});
