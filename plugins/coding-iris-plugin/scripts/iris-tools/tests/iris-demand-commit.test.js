'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const cli = path.resolve(__dirname, '..', 'commit-demand.js');
const temporaryRoots = [];

test.after(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

function run(command, args, cwd, allowFailure = false) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024, timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' } });
  if (result.error) throw new Error(`${result.error.message}\n${result.stderr || result.stdout || ''}`);
  if (!allowFailure && result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result;
}

function git(root, args, allowFailure = false) {
  return run('git', ['-C', root, ...args], root, allowFailure);
}

function createRepo(name = 'repo') {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-demand-commit-test-'));
  temporaryRoots.push(parent);
  const root = path.join(parent, name);
  fs.mkdirSync(root);
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'codex@example.invalid']);
  git(root, ['config', 'user.name', 'Codex Test']);
  git(root, ['config', 'commit.gpgSign', 'false']);
  // Isolate fixture commits from personal hooks; product hook behavior has its own suite.
  const hooks = path.join(parent, 'empty-hooks'); fs.mkdirSync(hooks);
  git(root, ['config', 'core.hooksPath', hooks]);
  fs.writeFileSync(path.join(root, 'target.txt'), 'initial\n');
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'initial\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);
  return { parent, root };
}

function runCli(args, cwd, allowFailure = false) {
  return run(process.execPath, [cli, ...args], cwd, allowFailure);
}

function plan(repo, kind, modification = '调整模板必填校验，使用字段必填标识替代边界气泡并确保保存后重新聚焦输入框') {
  const result = runCli([
    'plan', '--project-root', repo, '--kind', kind, '--demand', '7060418', '--type', 'fix',
    '--subject', '口腔技工单-模板维护', '--title', '口腔技工单-模板内容的必填提示显示不全',
    '--file', 'target.txt', '--modification', modification,
  ], repo);
  return JSON.parse(result.stdout);
}

test('standard and project messages use three and two lines', () => {
  const module = require('../commit-demand');
  const args = { type: 'fix', demand: '7060418', subject: '口腔技工单-模板维护', title: '模板内容的必填提示显示不全', kind: 'standard' };
  const modification = '优化模板内容必填提示，使用必填标识替代校验气泡并在提示关闭后聚焦输入框';
  assert.equal(module.buildMessage(args, modification).split('\n').filter(Boolean).length, 3);
  assert.match(module.buildMessage(args, modification), /^fix\(7060418\):口腔技工单-模板维护\n修改说明:/);
  assert.match(module.buildMessage(args, modification), /\n需求描述:7060418 模板内容的必填提示显示不全\n$/);
  assert.equal(module.buildMessage({ ...args, kind: 'project' }, modification).split('\n').filter(Boolean).length, 2);
});

test('generic modification descriptions are rejected', () => {
  const module = require('../commit-demand');
  assert.throws(() => module.validateModification('优化功能'), /过于简略|过于泛化/);
  assert.throws(() => module.validateModification('调整模板页面相关代码并完成修改'), /过于简略|具体方案和行为结果/);
  assert.doesNotThrow(() => module.validateModification('优化模板内容必填提示，使用必填标识替代校验气泡并在提示关闭后聚焦输入框'));
});

test('plan-only generation leaves repository and index unchanged', () => {
  const fixture = createRepo();
  fs.writeFileSync(path.join(fixture.root, 'target.txt'), 'planned only\n');
  fs.writeFileSync(path.join(fixture.root, 'unrelated.txt'), 'staged but unrelated\n');
  git(fixture.root, ['add', 'unrelated.txt']);
  const headBefore = git(fixture.root, ['rev-parse', 'HEAD']).stdout.trim();
  const statusBefore = git(fixture.root, ['status', '--short']).stdout;
  const cachedBefore = git(fixture.root, ['diff', '--cached', '--binary']).stdout;

  const planned = plan(fixture.root, 'project');

  assert.equal(planned.status, 'planned');
  assert.equal(planned.repositories[0].execution.pull, 'pending');
  assert.equal(planned.repositories[0].execution.commit, '');
  assert.equal(git(fixture.root, ['rev-parse', 'HEAD']).stdout.trim(), headBefore);
  assert.equal(git(fixture.root, ['status', '--short']).stdout, statusBefore);
  assert.equal(git(fixture.root, ['diff', '--cached', '--binary']).stdout, cachedBefore);
});

test('project local-only apply preserves unrelated staged changes', () => {
  const fixture = createRepo();
  fs.writeFileSync(path.join(fixture.root, 'target.txt'), 'changed\n');
  fs.writeFileSync(path.join(fixture.root, 'unrelated.txt'), 'staged but unrelated\n');
  git(fixture.root, ['add', 'unrelated.txt']);
  const planned = plan(fixture.root, 'project');

  const unauthorized = runCli(['apply', '--plan', planned.planPath], fixture.root, true);
  assert.equal(unauthorized.status, 1);
  assert.match(unauthorized.stderr, /confirm-commit/);

  runCli(['apply', '--plan', planned.planPath, '--confirm-commit', '--verify'], fixture.root);
  const finalPlan = JSON.parse(fs.readFileSync(planned.planPath, 'utf8'));
  assert.equal(finalPlan.repositories[0].execution.pull, 'local-only');
  assert.equal(finalPlan.status, 'verified');
  runCli(['verify', '--plan', planned.planPath], fixture.root);
  runCli(['verify', '--plan', planned.planPath], fixture.root);
  assert.equal(git(fixture.root, ['diff', '--cached', '--name-only']).stdout.trim(), 'unrelated.txt');
  const message = git(fixture.root, ['show', '-s', '--format=%B']).stdout.trim().split(/\r?\n/);
  assert.equal(message.length, 2);
  assert.match(message[1], /^修改说明:/);
});

test('verify rejects unexpected and missing paths even after a prior verification', () => {
  const f = createRepo();
  fs.writeFileSync(path.join(f.root, 'target.txt'), 'changed\n');
  const planned = plan(f.root, 'project');
  runCli(['apply', '--plan', planned.planPath, '--confirm-commit', '--verify'], f.root);
  const saved = JSON.parse(fs.readFileSync(planned.planPath, 'utf8'));
  const extra = structuredClone(saved);
  extra.repositories[0].files = [];
  delete extra.integrity;
  extra.integrity = require('node:crypto').createHash('sha256').update(JSON.stringify(extra)).digest('hex');
  fs.writeFileSync(planned.planPath, JSON.stringify(extra));
  assert.match(runCli(['verify', '--plan', planned.planPath], f.root, true).stderr, /计划外文件/);
  saved.repositories[0].files.push('missing.txt');
  delete saved.integrity;
  saved.integrity = require('node:crypto').createHash('sha256').update(JSON.stringify(saved)).digest('hex');
  fs.writeFileSync(planned.planPath, JSON.stringify(saved));
  assert.match(runCli(['verify', '--plan', planned.planPath], f.root, true).stderr, /缺少计划文件/);
});

test('verify preserves Unicode paths and both sides of a rename', () => {
  const f = overlayFixture();
  fs.renameSync(path.join(f.root, 'target.txt'), path.join(f.root, '中文 文件.txt'));
  const planned = overlayPlan(f, ['backend/target.txt', 'backend/中文 文件.txt']);
  runCli(['apply', '--plan', planned.planPath, '--confirm-commit', '--verify'], f.workspace);
  runCli(['verify', '--plan', planned.planPath], f.workspace);
});

test('standard repository without upstream is blocked before commit', () => {
  const fixture = createRepo();
  fs.writeFileSync(path.join(fixture.root, 'target.txt'), 'changed\n');
  const planned = plan(fixture.root, 'standard');
  const applied = runCli(['apply', '--plan', planned.planPath, '--confirm-commit'], fixture.root, true);
  assert.equal(applied.status, 1);
  assert.match(applied.stderr, /缺少 upstream/);
  assert.equal(git(fixture.root, ['log', '--format=%s', '-1']).stdout.trim(), 'initial');
});

test('fast-forwarded upstream requires a new plan and creates no demand commit', () => {
  const fixture = createRepo('source');
  const bare = path.join(fixture.parent, 'remote.git');
  run('git', ['init', '--bare', bare], fixture.parent);
  git(fixture.root, ['remote', 'add', 'origin', bare]);
  git(fixture.root, ['push', '-u', 'origin', 'main']);
  fs.writeFileSync(path.join(fixture.root, 'target.txt'), 'local demand\n');
  const planned = plan(fixture.root, 'standard');

  const actor = path.join(fixture.parent, 'actor');
  run('git', ['clone', '-b', 'main', bare, actor], fixture.parent);
  git(actor, ['config', 'user.email', 'actor@example.invalid']);
  git(actor, ['config', 'user.name', 'Actor']);
  git(actor, ['config', 'core.hooksPath', path.join(fixture.parent, 'empty-hooks')]);
  fs.writeFileSync(path.join(actor, 'remote.txt'), 'remote\n');
  git(actor, ['add', 'remote.txt']);
  git(actor, ['commit', '-m', 'remote advance']);
  git(actor, ['push']);

  const applied = runCli(['apply', '--plan', planned.planPath, '--confirm-commit'], fixture.root, true);
  assert.equal(applied.status, 3);
  const refreshed = JSON.parse(fs.readFileSync(planned.planPath, 'utf8'));
  assert.equal(refreshed.status, 'refresh-required');
  assert.equal(refreshed.repositories[0].execution.pull, 'fast-forwarded');
  assert.equal(git(fixture.root, ['log', '--format=%s', '-1']).stdout.trim(), 'remote advance');
  assert.equal(fs.readFileSync(path.join(fixture.root, 'target.txt'), 'utf8'), 'local demand\n');
});

test('standard apply pulls, commits three-line message, verifies, and does not push', () => {
  const fixture = createRepo('source');
  const bare = path.join(fixture.parent, 'remote.git');
  run('git', ['init', '--bare', bare], fixture.parent);
  git(fixture.root, ['remote', 'add', 'origin', bare]);
  git(fixture.root, ['push', '-u', 'origin', 'main']);
  const remoteBefore = git(bare, ['rev-parse', 'refs/heads/main']).stdout.trim();
  fs.writeFileSync(path.join(fixture.root, 'target.txt'), 'standard demand\n');
  const planned = plan(fixture.root, 'standard');

  runCli(['apply', '--plan', planned.planPath, '--confirm-commit', '--verify'], fixture.root);
  const finalPlan = JSON.parse(fs.readFileSync(planned.planPath, 'utf8'));
  assert.equal(finalPlan.status, 'verified');
  const message = git(fixture.root, ['show', '-s', '--format=%B']).stdout.trim().split(/\r?\n/);
  assert.equal(message.length, 3);
  assert.equal(git(bare, ['rev-parse', 'refs/heads/main']).stdout.trim(), remoteBefore);
  assert.notEqual(git(fixture.root, ['rev-parse', 'HEAD']).stdout.trim(), remoteBefore);
});

function overlayFixture() {
  const fixture = createRepo('business');
  const workspace = path.join(fixture.parent, 'manager', 'module');
  fs.mkdirSync(path.join(workspace, '.agents'), { recursive: true });
  git(path.dirname(workspace), ['init', '-b', 'main']);
  fs.symlinkSync(fixture.root, path.join(workspace, 'backend'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(workspace, '.agents', 'capability.json'), JSON.stringify({
    schemaVersion: 1, mode: 'workspace-overlay', workspace: 'module', contextRoot: '.agents',
    capabilityRoot: '.agents', sharedDirectories: [], localDirectories: [],
    sourceRoots: [{ name: 'backend', path: 'backend', target: fixture.root, gitRoot: fixture.root }]
  }));
  return { ...fixture, workspace };
}

function overlayPlan(f, files, failure = false) {
  const result = runCli(['plan', '--project-root', f.workspace, '--kind', 'project',
    '--demand', '12345', '--type', 'fix', '--title', '合成需求', '--subject', '字典有效期',
    '--modification', '使用字典有效期过滤申请选项，确保失效品牌不再显示并保留维护页原有行为',
    ...files.flatMap(file => ['--file', file])], f.workspace, failure);
  return failure ? result : JSON.parse(result.stdout);
}

test('overlay aliases resolve to one real repository for modified, new and deleted files', () => {
  const f = overlayFixture();
  fs.writeFileSync(path.join(f.root, 'target.txt'), 'modified\n');
  fs.writeFileSync(path.join(f.root, 'new.txt'), 'new\n');
  fs.unlinkSync(path.join(f.root, 'unrelated.txt'));
  const names = ['target.txt', 'new.txt', 'unrelated.txt'];
  const alias = overlayPlan(f, names.map(n => path.join('backend', n)));
  const physical = overlayPlan(f, names.map(n => path.join(f.root, n)));
  assert.deepEqual(alias.repositories, physical.repositories);
  const duplicate = overlayPlan(f, ['backend/target.txt', path.join(f.root, 'target.txt')]);
  assert.deepEqual(duplicate.repositories[0].files, ['target.txt']);
  overlayPlan(f, names.map(n => path.join('backend', n)));
  runCli(['apply', '--plan', alias.planPath, '--confirm-commit', '--verify'], f.workspace);
  assert.equal(git(f.root, ['status', '--short']).stdout.trim(), '');
});

test('overlay rejects wrong Junction targets, physical directories and undeclared source files', () => {
  const f = overlayFixture();
  fs.writeFileSync(path.join(f.root, 'target.txt'), 'modified\n');
  const other = path.join(f.parent, 'outside');
  fs.mkdirSync(other);
  const alias = path.join(f.workspace, 'backend');
  fs.unlinkSync(alias);
  fs.symlinkSync(other, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.notEqual(overlayPlan(f, [path.join(f.root, 'target.txt')], true).status, 0);
  fs.unlinkSync(alias); fs.mkdirSync(alias);
  assert.notEqual(overlayPlan(f, ['backend/new.txt'], true).status, 0);
  const manifestPath = path.join(f.workspace, '.agents/capability.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  const source = path.join(f.root, 'module'); fs.mkdirSync(source);
  fs.rmdirSync(alias);
  fs.symlinkSync(source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  manifest.sourceRoots[0].target = source;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.notEqual(overlayPlan(f, [path.join(f.root, 'target.txt')], true).status, 0);
});

test('overlay rejects nested escaping links and rechecks links before apply', () => {
  const f = overlayFixture();
  fs.writeFileSync(path.join(f.root, 'target.txt'), 'modified\n');
  const other = path.join(f.parent, 'outside'); fs.mkdirSync(other);
  fs.symlinkSync(other, path.join(f.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.notEqual(overlayPlan(f, ['backend/escape/new.txt'], true).status, 0);
  fs.unlinkSync(path.join(f.root, 'escape'));
  const planned = overlayPlan(f, ['backend/target.txt']);
  const head = git(f.root, ['rev-parse', 'HEAD']).stdout;
  fs.unlinkSync(path.join(f.workspace, 'backend'));
  fs.symlinkSync(other, path.join(f.workspace, 'backend'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.notEqual(runCli(['apply', '--plan', planned.planPath, '--confirm-commit'], f.workspace, true).status, 0);
  assert.equal(git(f.root, ['rev-parse', 'HEAD']).stdout, head);
});

test('failed pull preserves planned changes and creates no commit', () => {
  const f = createRepo();
  fs.writeFileSync(path.join(f.root, 'target.txt'), 'local change\n');
  git(f.root, ['config', 'remote.origin.url', path.join(f.parent, 'missing.git')]);
  git(f.root, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
  git(f.root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(f.root, ['config', 'branch.main.remote', 'origin']);
  git(f.root, ['config', 'branch.main.merge', 'refs/heads/main']);
  const before = git(f.root, ['rev-parse', 'HEAD']).stdout;
  const planned = plan(f.root, 'standard');
  const applied = runCli(['apply','--plan',planned.planPath,'--confirm-commit','--verify'], f.root, true);
  assert.equal(applied.status, 1);
  assert.match(applied.stderr, /pull --ff-only/);
  assert.equal(git(f.root, ['rev-parse', 'HEAD']).stdout, before);
  assert.equal(git(f.root, ['diff','--cached','--name-only']).stdout.trim(), '');
});

for (const overlay of [false, true]) test('linked workspace ancestors retain physical repository ownership: ' + (overlay ? 'overlay' : 'standard'), () => {
  const f = overlay ? overlayFixture() : createRepo();
  const alias = path.join(f.parent, 'source-alias');
  fs.symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(f.root, 'target.txt'), 'linked workspace change\n');
  let planned;
  if (overlay) {
    const manifestPath = path.join(f.workspace, '.agents/capability.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.sourceRoots[0].target = alias;
    manifest.sourceRoots[0].gitRoot = alias;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    planned = overlayPlan(f, ['backend/target.txt']);
  } else planned = plan(alias, 'project');
  assert.equal(fs.realpathSync.native(planned.repositories[0].root), fs.realpathSync.native(f.root));
  runCli(['apply','--plan',planned.planPath,'--confirm-commit','--verify'], f.workspace || alias);
  assert.equal(git(f.root, ['status','--short']).stdout.trim(), '');
  fs.unlinkSync(alias);
});
