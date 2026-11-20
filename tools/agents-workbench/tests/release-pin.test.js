'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Worker } = require('node:worker_threads');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');

const repo = path.resolve(__dirname, '../../..');
const react = 'tools/agents-workbench/react';
const stageScript = `${react}/package-runtime.mjs`;
const worker = 'tools/agents-workbench/src/framework-worker.js';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { windowsHide: true });
}

function commit(root, description, ...options) {
  git(root, '-c', 'core.hooksPath=unused-hooks', '-c', 'commit.gpgSign=false', '-c', 'user.name=Workbench Test',
    '-c', 'user.email=workbench@example.invalid', 'commit', '--quiet', '-m', description, ...options);
  return git(root, 'rev-parse', 'HEAD').toString('utf8').trim();
}

function write(root, relative, text) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}

function copyFixtureInput(root, relative) {
  const input = path.join(repo, relative);
  if (fs.lstatSync(input).isDirectory()) {
    for (const name of fs.readdirSync(input)) copyFixtureInput(root, `${relative}/${name}`);
  } else {
    write(root, relative, fs.readFileSync(input));
  }
}

function makeFixture(root) {
  const source = path.join(root, '源码');
  fs.mkdirSync(source);
  const script = fs.readFileSync(path.join(repo, stageScript), 'utf8');
  const stagedList = script.split('for (const file of [')[1].split(']) copy(file);')[0];
  const files = [...stagedList.matchAll(/"([^"\r\n]+)"/gu)].map(([, name]) => name);
  for (const file of ['serve.js', 'inspect-project.js', 'personal-settings.js', 'project-settings.js']) {
    files.push(`tools/agents-workbench/prototype/${file}`);
  }
  files.push(stageScript, `${react}/start-workbench.cmd`, `${react}/start-workbench.ps1`, `${react}/import-workbench-release.ps1`);
  for (const file of files) copyFixtureInput(source, file);
  write(source, '.gitignore', `${react}/dist/\n${react}/node_modules/\n`);
  write(source, `${react}/package.json`, JSON.stringify({ version: '0.2.2' }));
  write(source, 'tools/ai-dev-offline/manifest.json', JSON.stringify({ components: [{ id: 'node', version: process.versions.node }] }));
  write(source, 'plugins/fixture/.agents-plugin/plugin.json', '{}');
  for (const guide of ['docs/update-agents.md', 'docs/workspace-overlay.md', 'docs/guides/usage-manual.md']) {
    write(source, guide, '# Release fixture\n');
  }
  for (const asset of ['index.html', 'workbench-mark.svg', 'workbench-overview.webp', 'assets/index.js', '.vite/license.md']) {
    write(source, `${react}/dist/${asset}`, `Fixture ${asset}\n`);
  }
  for (const license of ['LICENSE-shadcn.md', 'node_modules/tailwindcss/LICENSE', 'node_modules/tw-animate-css/LICENSE', 'src/fonts/OFL.txt', 'src/fonts/UPSTREAM.md']) {
    write(source, `${react}/${license}`, 'Fixture license\n');
  }

  git(source, 'init', '--quiet');
  git(source, 'config', 'core.autocrlf', 'false');
  git(source, 'add', '.');
  const revision = commit(source, 'Formal workbench fixture');
  const runtime = path.join(root, 'Node runtime');
  write(runtime, 'LICENSE', 'Fixture runtime license');
  fs.copyFileSync(process.execPath, path.join(runtime, 'node.exe'));
  const build = path.join(root, 'build-fixture.cjs');
  fs.writeFileSync(build, 'if (process.argv.slice(2).join(" ") !== "run build") process.exit(1);\n');
  const staged = path.join(root, '发布暂存');
  execFileSync(process.execPath, [path.join(source, stageScript), '--release', staged, '--node-runtime', runtime], {
    cwd: path.join(source, react), env: { ...process.env, npm_execpath: build }, windowsHide: true,
  });
  return { source, staged, revision };
}

function askWorker(packageRoot, workerData) {
  return new Promise((resolve, reject) => {
    const job = new Worker(path.join(packageRoot, worker), { workerData });
    job.once('message', resolve);
    job.once('error', reject);
    job.once('exit', code => { if (code) reject(Error(`Verification worker exited with code ${code}`)); });
  });
}

async function verify(packageRoot, project) {
  const observed = await askWorker(packageRoot, { root: project, action: 'observe' });
  assert.equal(observed.status, 'standard');
  return askWorker(packageRoot, {
    root: project, action: 'verify', expectedRevision: observed.revision, expectedBinding: observed.binding,
  });
}

test('formal package trusts its own exact source commit and verified deployed files', {
  skip: process.platform !== 'win32', timeout: 120000,
}, async t => {
  const root = createTempDirectory('workbench-runtime-pin-');
  t.after(() => {
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const { source, staged, revision } = makeFixture(root);
  const envelope = path.join(staged, 'workbench-release.json');
  const release = JSON.parse(fs.readFileSync(envelope, 'utf8'));
  assert.deepEqual(fs.readFileSync(path.join(staged, 'start-workbench.ps1')),
    git(source, 'cat-file', 'blob', `${revision}:${react}/start-workbench.ps1`));
  const tree = git(source, 'ls-tree', '-r', '-z', revision, '--', 'scripts', 'plugins', 'vendor', 'hooks');
  const withoutInstaller = tree.toString('latin1').split('\0').filter(row => !row.endsWith('\tscripts/install-agents.ps1')).join('\0');
  const treeDigest = createHash('sha256').update(withoutInstaller, 'latin1').digest('hex');
  assert.equal(release.sourceBaseRevision, revision);
  assert.deepEqual(release.runtimePin, { revision, treeDigest });

  const project = path.join(root, '已安装工程');
  const capability = path.join(project, '.agents');
  fs.mkdirSync(project);
  git(root, 'clone', '--quiet', '--local', '--no-hardlinks', '--', source, capability);
  git(capability, 'remote', 'set-url', 'origin', 'https://gitee.com/skyler-cook/imedical.agents.git');
  assert.equal((await verify(staged, project)).before?.revision, revision);

  const other = commit(capability, 'Unregistered commit with the same runtime', '--allow-empty');
  assert.notEqual(other, revision);
  assert.ok(git(capability, 'ls-tree', '-r', '-z', other, '--', 'scripts', 'plugins', 'vendor', 'hooks').equals(tree));
  assert.equal((await verify(staged, project)).error, 'unknown-tree');
  git(capability, 'checkout', '--quiet', '--detach', revision);

  const updater = path.join(capability, 'scripts/update-agents.ps1');
  const originalUpdater = fs.readFileSync(updater);
  fs.appendFileSync(updater, '\n# changed deployed runtime\n');
  assert.equal((await verify(staged, project)).error, 'runtime-modified');
  fs.writeFileSync(updater, originalUpdater);

  for (const changed of [
    { ...release, runtimePin: { revision, treeDigest: 'f'.repeat(64) } },
    { ...release, runtimePin: { revision: other, treeDigest } },
    { ...release, formal: false },
    { ...release, localBuildChanges: true },
  ]) {
    fs.writeFileSync(envelope, JSON.stringify(changed));
    assert.equal((await verify(staged, project)).error, 'unknown-tree');
  }
  fs.writeFileSync(envelope, JSON.stringify(release));
  write(source, 'workbench-release.json', JSON.stringify(release));
  write(source, 'runtime/node.exe', 'preview fixture');
  assert.equal((await verify(source, project)).error, 'unknown-tree');
  assert.equal((await verify(staged, project)).before?.revision, revision);
});
