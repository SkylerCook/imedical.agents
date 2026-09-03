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
  assert.equal(git(fixture.root, ['diff', '--cached', '--name-only']).stdout.trim(), 'unrelated.txt');
  const message = git(fixture.root, ['show', '-s', '--format=%B']).stdout.trim().split(/\r?\n/);
  assert.equal(message.length, 2);
  assert.match(message[1], /^修改说明:/);
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
