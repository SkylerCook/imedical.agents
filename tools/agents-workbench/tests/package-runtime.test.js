'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, fork } = require('node:child_process');
const { once } = require('node:events');

const repo = path.resolve(__dirname, '../../..');
const react = 'tools/agents-workbench/react';
const stageScript = 'package-runtime.mjs';

test('release staging rejects missing runtime and uncommitted source before building', t => {
  const parent = path.join(os.tmpdir(), 'Codex');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'workbench-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const fixtureReact = path.join(root, react);
  fs.mkdirSync(fixtureReact, { recursive: true });
  const script = path.join(fixtureReact, stageScript);
  fs.copyFileSync(path.join(repo, react, stageScript), script);
  const manual = path.join(root, '手册.md');
  fs.writeFileSync(manual, 'committed manual');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { windowsHide: true });
  git('init', '--quiet');
  git('add', '.');
  git('-c', 'core.hooksPath=invalid-hook-directory', '-c', 'commit.gpgSign=false',
    '-c', 'user.name=Workbench Test', '-c', 'user.email=workbench@example.invalid',
    'commit', '--quiet', '-m', 'Package source fixture');
  const stage = path.join(root, '中文 发布暂存');
  const args = [script, '--release', stage];
  const invoke = (...extra) => execFileSync(process.execPath, [...args, ...extra], {
    cwd: fixtureReact, encoding: 'utf8', windowsHide: true, stdio: 'pipe',
  });

  assert.throws(() => invoke(), /--node-runtime/);
  fs.writeFileSync(manual, 'uncommitted manual');
  assert.throws(() => invoke('--node-runtime', 'does-not-exist'), /Git 工作区干净/);
  fs.writeFileSync(manual, 'committed manual');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked source');
  assert.throws(() => invoke('--node-runtime', 'does-not-exist'), /Git 工作区干净/);
  assert.equal(fs.existsSync(stage), false);
});

test('stage preserves directory contents under a Unicode path and serves its bound project', async t => {
  const parent = path.join(os.tmpdir(), 'Codex');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'workbench-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const stage = path.join(root, '中文 发布暂存');
  const runtime = process.env.WORKBENCH_TEST_NODE_RUNTIME;
  const args = [path.join(repo, react, stageScript), stage];
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
  const metadata = JSON.parse(fs.readFileSync(path.join(stage, 'workbench-release.json'), 'utf8'));
  assert.equal(metadata.formal, false);
  const manuals = ['docs/update-agents.md', 'docs/workspace-overlay.md', 'docs/guides/usage-manual.md'];
  for (const manual of manuals) {
    compare(manual);
    assert.ok(Object.hasOwn(metadata.documentationSha256, manual));
  }
  for (const [file, digest] of Object.entries(metadata.documentationSha256)) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(stage, file))).digest('hex'), digest);
  }

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
