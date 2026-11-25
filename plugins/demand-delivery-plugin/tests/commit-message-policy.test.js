'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { standardMessageError } = require('../scripts/commit-message-policy');

const cli = path.resolve(__dirname, '../scripts/commit-demand.js');
const message = 'fix(12345):选项设置\n修改说明:保存设置后同步刷新状态\n需求描述:12345 保存选项设置';
const hook = 'hook.imedical-standard-message';

function run(file, args, env = process.env) {
  const result = spawnSync(file, args, { env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
  assert.ifError(result.error);
  return result;
}

function success(result) {
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const base = fs.realpathSync.native(process.env.AGENT_TEST_TMPDIR || os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(base, 'commit-message-policy-'));
  t.after(() => {
    assert.equal(path.dirname(temporary), base);
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const repo = path.join(temporary, 'synthetic repo');
  const hooks = path.join(temporary, 'legacy hooks');
  fs.mkdirSync(repo);
  fs.mkdirSync(hooks);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(temporary, 'global.gitconfig') };
  const git = (...args) => run('git', ['-C', repo, ...args], env);
  const command = (action, root = repo) => run(process.execPath, [cli, 'hook', action, '--repo', root], env);
  const check = (commit, demand = '12345') => run(process.execPath, [cli, 'verify-message', '--repo', repo, '--commit', commit, '--demand', demand], env);
  success(git('init', '-b', 'dev'));
  for (const [name, value] of [['user.name', 'Synthetic'], ['user.email', 'synthetic@example.invalid'], ['core.hooksPath', hooks]]) {
    success(git('config', '--local', name, value));
  }
  fs.writeFileSync(path.join(hooks, 'commit-msg'), '#!/bin/sh\nprintf "legacy hook ran\\n" >&2\n', { mode: 0o755 });
  return { temporary, repo, hooks, git, env, command, check };
}

test('standard message policy checks all three fields and both requirement numbers', () => {
  assert.equal(standardMessageError(`\uFEFF${message.replace(/\n/g, '\r\n')}\r\n`, '12345'), '');
  assert.match(standardMessageError(`12345 legacy\n${message}`, '12345'), /首行/);
  assert.match(standardMessageError(message.replace('fix(', 'test('), '12345'), /首行/);
  assert.match(standardMessageError(message.replace('保存设置后同步刷新状态', '  '), '12345'), /修改说明/);
  assert.match(standardMessageError(message.replace(/\n需求描述:.+/, ''), '12345'), /第三行/);
  assert.match(standardMessageError(message.replace('需求描述:12345 ', '需求描述:999 ')), /需求号须一致/);
  assert.match(standardMessageError(message, '999'), /须为 999/);
  assert.match(standardMessageError(`${message}\n额外正文`, '12345'), /须有三行/);
});

test('verify-message reads the exact Git commit and never substitutes HEAD', t => {
  const f = fixture(t);
  success(f.git('commit', '--allow-empty', '-m', '12345 legacy subject'));
  const historical = success(f.git('rev-parse', 'HEAD'));
  success(f.git('commit', '--allow-empty', '-m', message));
  const current = success(f.git('rev-parse', 'HEAD'));
  assert.equal(JSON.parse(success(f.check(current))).status, 'verified');
  assert.match(f.check(historical).stderr, new RegExp(`standard-commit-message-invalid.*${historical.slice(0, 12)}`));
  assert.match(f.check(current, '999').stderr, /须为 999/);
  assert.match(f.check(current.slice(0, 12)).stderr, /完整的 40 位/);
});

test('named commit-msg hook coexists with core.hooksPath and can be disabled independently', t => {
  const f = fixture(t);
  const initialStatus = JSON.parse(success(f.command('status'))).status;
  if (initialStatus === 'unsupported') {
    assert.match(f.command('enable').stderr, /Git 2\.54/);
    assert.equal(f.git('config', '--local', '--get', `${hook}.event`).status, 1);
    assert.equal(JSON.parse(success(f.command('disable'))).status, 'unsupported');
    t.diagnostic('Named Git hooks unavailable on this Git; standalone verifier is covered separately.');
    return;
  }
  assert.equal(initialStatus, 'disabled');
  assert.equal(JSON.parse(success(f.command('enable'))).status, 'enabled');
  assert.equal(JSON.parse(success(f.command('enable'))).status, 'enabled');
  assert.equal(success(f.git('config', '--local', '--get', `${hook}.event`)), 'commit-msg');
  assert.equal(success(f.git('config', '--local', '--get', 'core.hooksPath')), f.hooks);

  const malformed = f.git('commit', '--allow-empty', '-m', '12345 malformed message');
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /standard-commit-message-invalid/);
  const messageFile = path.join(f.temporary, 'commit body.txt');
  fs.writeFileSync(messageFile, `${message}\n# additional body line\n`, 'utf8');
  const extraBody = f.git('commit', '--allow-empty', '-F', messageFile);
  assert.notEqual(extraBody.status, 0);
  assert.match(extraBody.stderr, /须有三行/);
  const cleanup = f.git('-c', 'commit.cleanup=strip', 'commit', '--allow-empty', '-F', messageFile);
  success(cleanup);
  assert.equal(success(f.git('show', '-s', '--format=%B')), message);
  fs.writeFileSync(path.join(f.repo, 'value.txt'), 'synthetic\n');
  success(f.git('add', 'value.txt'));
  const valid = f.git('commit', '-m', message);
  success(valid);
  assert.match(valid.stderr, /legacy hook ran/);
  const amend = f.git('commit', '--amend', '-m', 'bad replacement');
  assert.notEqual(amend.status, 0);
  assert.match(amend.stderr, /standard-commit-message-invalid/);
  success(f.git('commit', '--allow-empty', '--no-verify', '-m', '12345 bypassed the local hook'));
  const skippedHook = success(f.git('rev-parse', 'HEAD'));
  const checkSkippedHook = f.check(skippedHook);
  assert.notEqual(checkSkippedHook.status, 0);
  assert.match(checkSkippedHook.stderr, /standard-commit-message-invalid/);

  const linked = path.join(f.temporary, 'linked');
  success(f.git('worktree', 'add', '-b', 'prepared', linked));
  assert.match(f.command('disable', linked).stderr, /主工作树/);
  assert.equal(JSON.parse(success(f.command('status'))).status, 'enabled');

  assert.equal(JSON.parse(success(f.command('disable'))).status, 'disabled');
  assert.equal(JSON.parse(success(f.command('disable'))).status, 'disabled');
  const ordinary = f.git('commit', '--allow-empty', '-m', 'plain message after disabling');
  success(ordinary);
  assert.match(ordinary.stderr, /legacy hook ran/);
  assert.equal(success(f.git('config', '--local', '--get', 'core.hooksPath')), f.hooks);
});

test('hook allows editor template comments and actual Git merge maintenance', t => {
  const f = fixture(t);
  if (JSON.parse(success(f.command('status'))).status === 'unsupported') return t.skip('Named Git hooks require Git 2.54');
  success(f.command('enable'));
  const editor = path.join(f.temporary, 'editor.sh');
  fs.writeFileSync(editor, '#!/bin/sh\nprintf "\n# editor template comment\n" >> "$1"\n', { mode: 0o755 });
  const edited = run('git', ['-C', f.repo, '-c', `core.editor=sh '${editor.replaceAll('\\', '/')}'`, 'commit', '--allow-empty', '-e', '-m', message], f.env);
  success(edited);
  assert.equal(success(f.git('show', '-s', '--format=%B')), message);

  success(f.git('switch', '-c', 'alternate'));
  fs.writeFileSync(path.join(f.repo, 'branch.txt'), 'alternate\n');
  success(f.git('add', 'branch.txt'));
  success(f.git('commit', '-m', message));
  success(f.git('switch', 'dev'));
  fs.writeFileSync(path.join(f.repo, 'local.txt'), 'local\n');
  success(f.git('add', 'local.txt'));
  success(f.git('commit', '-m', message));
  const result = f.git('merge', '--no-ff', '--no-edit', 'alternate');
  success(result);
  assert.match(success(f.git('show', '-s', '--format=%s')), /^Merge branch/);
  const amend = f.git('commit', '--amend', '-m', 'Merge branch forged title');
  assert.notEqual(amend.status, 0);
  assert.match(amend.stderr, /standard-commit-message-invalid/);
});

test('hook permits Git to finish a conflicted cherry-pick and revert', t => {
  const f = fixture(t);
  if (JSON.parse(success(f.command('status'))).status === 'unsupported') return t.skip('Named Git hooks require Git 2.54');
  const valueFile = path.join(f.repo, 'value.txt');
  function writeValue(value) {
    fs.writeFileSync(valueFile, `${value}\n`);
    success(f.git('add', 'value.txt'));
  }
  writeValue('base');
  success(f.git('commit', '-m', message));
  success(f.git('switch', '-c', 'alternate'));
  writeValue('alternate');
  success(f.git('commit', '-m', 'Legacy message'));
  const alternate = success(f.git('rev-parse', 'HEAD'));
  success(f.git('switch', 'dev'));
  writeValue('local');
  success(f.git('commit', '-m', message));
  success(f.command('enable'));

  assert.notEqual(f.git('cherry-pick', alternate).status, 0);
  assert.equal(success(f.git('rev-parse', 'CHERRY_PICK_HEAD')), alternate);
  writeValue('resolved');
  success(f.git('-c', 'core.editor=true', 'cherry-pick', '--continue'));
  assert.equal(success(f.git('show', '-s', '--format=%s')), 'Legacy message');
  const cherry = success(f.git('rev-parse', 'HEAD'));

  writeValue('further change');
  success(f.git('commit', '-m', message));
  assert.notEqual(f.git('revert', '--no-edit', cherry).status, 0);
  assert.equal(success(f.git('rev-parse', 'REVERT_HEAD')), cherry);
  writeValue('resolved revert');
  success(f.git('-c', 'core.editor=true', 'revert', '--continue'));
  assert.match(success(f.git('show', '-s', '--format=%s')), /^Revert "Legacy message"/);
});

test('hook configuration in a real submodule leaves the parent repository alone', t => {
  const f = fixture(t);
  if (JSON.parse(success(f.command('status'))).status === 'unsupported') return t.skip('Named Git hooks require Git 2.54');
  success(f.git('commit', '--allow-empty', '-m', message));
  const parent = path.join(f.temporary, 'parent repo');
  fs.mkdirSync(parent);
  const git = (...args) => run('git', ['-C', parent, ...args], f.env);
  success(git('init', '-b', 'dev'));
  success(git('-c', 'protocol.file.allow=always', 'submodule', 'add', f.repo, 'sub'));
  const sub = path.join(parent, 'sub');
  assert.equal(fs.statSync(path.join(sub, '.git')).isFile(), true);
  assert.equal(JSON.parse(success(f.command('enable', sub))).status, 'enabled');
  assert.equal(JSON.parse(success(f.command('status', parent))).status, 'disabled');
  assert.equal(JSON.parse(success(f.command('disable', sub))).status, 'disabled');
});
