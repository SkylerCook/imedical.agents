'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const log = require('../scripts/bos-code-update-log');
const commitCli = path.resolve(__dirname, '../../demand-delivery-plugin/scripts/commit-demand.js');

function run(command, args, cwd, allowFailure = false) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 120000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' }
  });
  if (result.error) throw result.error;
  if (!allowFailure) assert.equal(result.status, 0, result.stderr);
  return result;
}
function git(root, args) { return run('git', ['-C', root, ...args], root).stdout.trim(); }
function fixture(t, count) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bos-demand-log-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hooks = path.join(root, 'empty-hooks'); fs.mkdirSync(hooks);
  function createRepo(parent, name) {
    const repo = path.join(parent, name); fs.mkdirSync(repo);
    git(repo, ['init', '-b', 'main']);
    git(repo, ['config', 'user.name', 'synthetic-user']);
    git(repo, ['config', 'user.email', 'synthetic@example.invalid']);
    git(repo, ['config', 'commit.gpgSign', 'false']);
    git(repo, ['config', 'core.hooksPath', hooks]);
    git(repo, ['remote', 'add', 'origin', `https://example.invalid/group/${name}.git`]);
    fs.writeFileSync(path.join(repo, 'target.txt'), 'initial\n');
    git(repo, ['add', 'target.txt']); git(repo, ['commit', '-m', 'synthetic initial']);
    return repo;
  }
  const workspace = createRepo(root, 'workspace');
  const repositories = count === 1 ? [workspace] : Array.from({ length: count }, (_, i) => createRepo(workspace, 'repo-' + i));
  const configFile = path.join(root, 'private.json');
  const settings = { url: 'https://example.invalid/code-log', token: randomBytes(24).toString('hex'), linkProject: 'synthetic-project' };
  fs.writeFileSync(configFile, JSON.stringify({ 'bos-code-update-log': settings }));
  for (const repo of repositories) fs.writeFileSync(path.join(repo, 'target.txt'), 'validated demand change\n');
  const result = run(process.execPath, [commitCli, 'plan', '--project-root', workspace, '--kind', 'project',
    '--demand', '12345', '--type', 'fix', '--subject', '合成菜单', '--title', '合成需求',
    ...repositories.flatMap((repo, index) => ['--modification', `${repo}::使用有效状态过滤申请选项${index}，确保失效内容不再显示并保留原有保存行为`]),
    ...repositories.flatMap(repo => ['--file', path.join(repo, 'target.txt')]),
    '--output', path.join(root, 'commit-plan.json')], workspace);
  const plan = JSON.parse(result.stdout);
  return { root, workspace, repositories, plan, configFile, env: { BOS_MCP_CONFIG: configFile } };
}
function apply(f, allowFailure = false) {
  return run(process.execPath, [commitCli, 'apply', '--plan', f.plan.planPath, '--confirm-commit', '--verify'], f.workspace, allowFailure);
}

for (const count of [1, 2]) test(`verified ${count}-repository commit result maps exactly to log plan and confirmed request`, async t => {
  const f = fixture(t, count);
  const committed = JSON.parse(apply(f).stdout);
  assert.equal(committed.status, 'verified');
  for (const repository of committed.repositories) {
    assert.equal(repository.execution.status, 'verified');
    assert.match(repository.execution.commit, /^[0-9a-f]{40}$/);
  }
  const input = JSON.stringify({ select: committed.repositories.map(repository => ({ repo: repository.root, ref: 'refs/heads/main', hash: repository.execution.commit })) });
  // A later commit must never replace the verified selection during authorization.
  const advancedRepo = committed.repositories[0].root;
  fs.writeFileSync(path.join(advancedRepo, 'later.txt'), 'outside this demand\n');
  git(advancedRepo, ['add', 'later.txt']);
  git(advancedRepo, ['commit', '-m', 'fix(99999):later\n修改说明:later unrelated change']);
  const head = git(advancedRepo, ['rev-parse', 'HEAD']);
  assert.notEqual(head, committed.repositories[0].execution.commit);
  let requests = 0, sent;
  const options = { env: f.env, fetchImpl: async (_url, request) => {
    requests++; sent = JSON.parse(request.body);
    return { ok: true, status: 200, json: async () => ({ ResultCode: '000' }) };
  } };
  const planned = await log.main(['plan', input], options);
  assert.equal(planned.payload.length, 1);
  assert.equal(planned.payload[0].RequirementCode, '12345');
  assert.equal(planned.payload[0].LinkProject, 'synthetic-project');
  assert.equal(planned.payload[0].UserCode, 'synthetic-user');
  assert.equal(planned.payload[0].ModifyDesc, committed.repositories.map(repo => repo.modification).join('\n'));
  assert.deepEqual(planned.payload[0].Repository.map(repo => repo.Project), committed.repositories.map(repo => path.basename(repo.root)));
  assert.deepEqual(planned.payload[0].Repository.map(repo => repo.CodeRepositoryVersion), committed.repositories.map(repo => repo.execution.commit));
  for (const repo of planned.payload[0].Repository) assert.equal(repo.ModifyFiles, 'target.txt');
  assert.ok(!JSON.stringify(planned).includes(head));
  assert.ok(!JSON.stringify(planned).includes('99999'));
  assert.equal((await log.main(['submit', input], options)).submitted, false);
  assert.equal(requests, 0);
  const submitted = await log.main(['submit', input, '--confirm', '--user', planned.summary[0].userCode], options);
  assert.equal(submitted.submitted, true);
  assert.equal(requests, 1);
  assert.deepEqual(sent, planned.payload);
  assert.equal(git(advancedRepo, ['rev-parse', 'HEAD']), head);
});

test('missing log configuration after verification performs no request and preserves local commit', async t => {
  const f = fixture(t, 1);
  const committed = JSON.parse(apply(f).stdout);
  const selected = committed.repositories[0];
  const input = JSON.stringify({ select: [{ repo: selected.root, ref: 'refs/heads/main', hash: selected.execution.commit }] });
  fs.writeFileSync(f.configFile, JSON.stringify({ 'bos-code-update-log': { token: 'TODO', linkProject: 'TODO', connection: 'company' } }));
  let requests = 0;
  await assert.rejects(log.main(['plan', input], { env: f.env, fetchImpl: async () => { requests++; } }), /token|TODO/);
  assert.equal(requests, 0);
  assert.equal(git(selected.root, ['rev-parse', 'HEAD']), selected.execution.commit);
  assert.equal(JSON.parse(fs.readFileSync(f.plan.planPath, 'utf8')).status, 'verified');
});

test('a later repository commit failure leaves a partial result without verified eligibility', t => {
  const f = fixture(t, 2);
  const failing = f.plan.repositories[1].root;
  const before = git(failing, ['rev-parse', 'HEAD']);
  const hooks = path.join(f.root, 'failing-hooks'); fs.mkdirSync(hooks);
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  git(failing, ['config', 'core.hooksPath', hooks]);
  assert.notEqual(apply(f, true).status, 0);
  const partial = JSON.parse(fs.readFileSync(f.plan.planPath, 'utf8'));
  assert.equal(partial.status, 'committing');
  assert.equal(partial.repositories[0].execution.status, 'committed');
  assert.equal(partial.repositories[1].execution.status, 'planned');
  assert.equal(partial.repositories[1].execution.commit, '');
  assert.equal(git(partial.repositories[0].root, ['rev-parse', 'HEAD']), partial.repositories[0].execution.commit);
  assert.equal(git(failing, ['rev-parse', 'HEAD']), before);
});
