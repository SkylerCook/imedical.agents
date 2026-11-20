'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');
const { observePluginDeployment } = require('../src/task-owner-observations');
const inspectProject = require('../prototype/inspect-project');

function fixture(t) {
  const folder = createTempDirectory('workbench-plugin-observation-');
  t.after(() => {
    assert.ok(ownsTempDirectory(folder));
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  });
  const root = path.join(folder, '标准 源');
  const capabilityRoot = path.join(root, '.agents');
  fs.mkdirSync(path.join(capabilityRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(capabilityRoot, 'scripts', 'update-agents.ps1'), 'throw "must not run"');
  const git = (args, input) => execFileSync('git', ['-C', capabilityRoot, ...args], {
    env: { ...process.env, GIT_ALLOW_PROTOCOL: '', GIT_NO_LAZY_FETCH: '1' },
    encoding: 'utf8', input, windowsHide: true,
  }).trim();
  git(['init', '-q']);
  git(['config', '--local', 'remote.origin.url', 'https://gitee.com/skyler-cook/imedical.agents.git']);
  const tree = git(['mktree'], '');
  const revision = git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit-tree', tree, '-m', 'Capability fixture']);
  git(['update-ref', 'HEAD', revision]);
  const file = path.join(capabilityRoot, '.git', 'plugin-deployment.json');
  const state = {
    schema: 'plugin-installation/v1', mode: 'on-demand', phase: 'interrupted', revision,
    members: [{ contextRoot: path.join(folder, 'private-member'), lastRequired: ['plugin-one'] }],
    installed: ['plugin-two'], failure: 'private diagnostic',
  };
  return { folder, root, capabilityRoot, file, revision, state, git };
}

test('the workbench projects only validated interrupted deployment metadata from the current root', t => {
  const f = fixture(t);
  const write = extra => fs.writeFileSync(f.file, JSON.stringify({ ...f.state, ...extra }));
  assert.equal(observePluginDeployment(f.root), undefined);
  for (const phase of ['ready', 'unknown']) {
    write({ phase });
    assert.equal(observePluginDeployment(f.root), undefined);
  }
  for (const phase of ['materializing', 'interrupted']) {
    write({ phase });
    const original = fs.readFileSync(f.file);
    assert.deepEqual(observePluginDeployment(f.root), { phase, revision: f.revision, shared: false });
    assert.deepEqual(fs.readFileSync(f.file), original);
    assert.equal(f.git(['rev-parse', 'HEAD']), f.revision);
  }
  write({ revision: 'a'.repeat(40) });
  assert.deepEqual(observePluginDeployment(f.root), { phase: 'interrupted', shared: false });
  write({ schema: 'unrecognized' });
  assert.equal(observePluginDeployment(f.root), undefined);
  f.git(['config', '--local', 'remote.origin.url', 'offline-fixture:not-approved']);
  write({});
  assert.equal(observePluginDeployment(f.root), undefined);
});

test('a verified Overlay reads shared deployment and cache observations, or reports them as unverified', t => {
  const f = fixture(t);
  fs.writeFileSync(f.file, JSON.stringify(f.state));
  const workspace = path.join(f.folder, '共享 模块');
  const declarationDir = path.join(workspace, '.agents');
  fs.mkdirSync(path.join(declarationDir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(declarationDir, '.git', 'plugin-deployment.json'),
    JSON.stringify({ ...f.state, phase: 'materializing' }));
  const declaration = path.join(declarationDir, 'capability.json');
  const info = {
    schemaVersion: 1, mode: 'workspace-overlay', workspace: 'fixture', contextRoot: '.agents',
    capabilityRoot: f.capabilityRoot, sharedDirectories: [], localDirectories: [],
    sourceRoots: [{ name: 'backend', path: 'backend', target: f.capabilityRoot, gitRoot: f.capabilityRoot }],
  };
  fs.symlinkSync(f.capabilityRoot, path.join(workspace, 'backend'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(declaration, JSON.stringify(info));
  assert.deepEqual(observePluginDeployment(workspace), { phase: 'interrupted', revision: f.revision, shared: true });

  const sharedCache = path.join(f.capabilityRoot, '.knowledge-cache');
  const memberCache = path.join(declarationDir, '.knowledge-cache');
  fs.mkdirSync(sharedCache);
  fs.mkdirSync(memberCache);
  const file = path.join(sharedCache, 'company.sqlite');
  const contents = 'shared-cache-contents';
  fs.writeFileSync(file, contents);
  fs.writeFileSync(path.join(memberCache, 'company.sqlite'), 'stale local location');
  fs.writeFileSync(path.join(memberCache, 'index.sqlite'), 'stale local location');
  const indexes = inspectProject(workspace).indexes;
  assert.deepEqual(indexes.find(row => row.name === 'company.sqlite'), {
    name: 'company.sqlite', shared: true, status: 'present', exists: true,
    bytes: Buffer.byteLength(contents), updated: fs.statSync(file).mtime.toISOString(),
  });
  assert.deepEqual(indexes.find(row => row.name === 'index.sqlite'), {
    name: 'index.sqlite', shared: true, status: 'missing', exists: false,
  });
  assert.equal(fs.readFileSync(file, 'utf8'), contents);

  fs.writeFileSync(declaration, JSON.stringify({ ...info, capabilityRoot: path.join(f.folder, 'missing') }));
  assert.equal(observePluginDeployment(workspace), undefined);
  assert.ok(inspectProject(workspace).indexes.every(row => row.shared && row.status === 'unverified' && !row.exists));
  fs.writeFileSync(declaration, JSON.stringify({ ...info, schemaVersion: 999 }));
  assert.ok(inspectProject(workspace).indexes.every(row => row.status === 'unverified' && !row.exists));
});

test('local cache observation rereads owner files in standard deployments and framework checkouts', t => {
  const f = fixture(t);
  const cache = path.join(f.capabilityRoot, '.knowledge-cache');
  const company = () => inspectProject(f.root).indexes.find(row => row.name === 'company.sqlite');
  assert.deepEqual(company(), { name: 'company.sqlite', shared: false, status: 'missing', exists: false });
  assert.equal(fs.existsSync(cache), false);
  fs.mkdirSync(cache);
  const file = path.join(cache, 'company.sqlite');
  fs.writeFileSync(file, 'initial cache');
  assert.equal(company().bytes, fs.statSync(file).size);
  fs.appendFileSync(file, ' resumes here');
  assert.equal(company().bytes, fs.statSync(file).size);

  const checkout = path.join(f.folder, 'framework source');
  fs.mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
  for (const script of ['install-agents.ps1', 'update-agents.ps1']) {
    fs.writeFileSync(path.join(checkout, 'scripts', script), 'throw "must not run"');
  }
  const sourceCache = path.join(checkout, '.knowledge-cache');
  fs.mkdirSync(sourceCache);
  const source = path.join(sourceCache, 'index.sqlite');
  fs.writeFileSync(source, 'local source index');
  assert.ok(inspectProject(checkout).indexes.every(row => row.status === 'unverified'));
  const owner = path.join(checkout, 'plugins', 'coding-iris-plugin', '.agents-plugin');
  fs.mkdirSync(owner, { recursive: true });
  fs.writeFileSync(path.join(owner, 'plugin.json'), '{}');
  const sourceIndex = inspectProject(checkout).indexes.find(row => row.name === 'index.sqlite');
  assert.equal(sourceIndex.status, 'present');
  assert.equal(sourceIndex.bytes, fs.statSync(source).size);
  assert.equal(sourceIndex.shared, false);

  fs.unlinkSync(file);
  fs.rmdirSync(cache);
  fs.symlinkSync(sourceCache, cache, process.platform === 'win32' ? 'junction' : 'dir');
  assert.ok(inspectProject(f.root).indexes.every(row => row.status === 'unverified' && !row.exists));
});

test('an uninstalled or linked capability and a hard-linked deployment record are ignored', t => {
  const f = fixture(t);
  assert.equal(observePluginDeployment(undefined), undefined);
  const workspace = path.join(f.folder, '未装 工程');
  fs.mkdirSync(workspace);
  assert.equal(observePluginDeployment(workspace), undefined);
  fs.writeFileSync(f.file, JSON.stringify(f.state));
  fs.symlinkSync(f.capabilityRoot, path.join(workspace, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(observePluginDeployment(workspace), undefined);
  fs.linkSync(f.file, path.join(f.folder, 'linked-record.json'));
  assert.equal(observePluginDeployment(f.root), undefined);
});
