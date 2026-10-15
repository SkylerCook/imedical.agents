'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const api = require('../scripts/acceptance-session');
const cli = path.resolve(__dirname, '../scripts/acceptance-session.js');
const fence = String.fromCharCode(96).repeat(3);
function fixture(t, keys = ['api'], ids = ['10', '2'], deliveryActions = ['commit', 'bos-log', 'push']) {
  const temp = process.env.AGENT_TEST_TMPDIR || os.tmpdir();
  fs.mkdirSync(temp, { recursive: true });
  const root = fs.mkdtempSync(path.join(temp, 'acceptance-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(temp) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const key of keys) fs.mkdirSync(path.join(root, key));
  const directory = path.join(root, 'docs', 'acceptance');
  const input = { projectRoot: root, deliveryActions, demands: ids.map(id => ({
    id, title: 'Synthetic change ' + id, automatic: { status: 'passed', gaps: ['native scenario pending'] },
    repositories: keys.map(key => ({ key, root: path.join(root, key), remote: 'origin', ref: 'refs/heads/dev', files: ['changed.txt'] }))
  })) };
  api.create(directory, input);
  const act = (command, data) => api.mutate(directory, state => api.apply(state, command, data));
  const state = () => api.load(directory);
  const decision = (id = '10', status = 'passed') => act('decide', { id, actor: 'user', status, quote: id + ' tested ' + status });
  const authorize = () => act('authorize', { actor: 'user', quote: 'After acceptance commit, log and push these mapped demands', actions: input.deliveryActions });
  const claim = (id = '10', owner = 'worker-a', worktrees) => act('claim', { id, owner, worktrees });
  const publish = (id = '10', owner = 'worker-a') => act('publish', { id, owner });
  const prepare = () => { decision(); authorize(); claim(); publish(); };
  const commit = (id = '10') => {
    const item = state().demands.find(item => item.id === id);
    return { status: 'verified', demand: id, repositories: item.repositories.map((repo, i) => ({
      root: item.claim.worktrees[repo.key], files: repo.files,
      message: 'fix(' + id + '): synthetic\n修改说明: preserve scope\n',
      execution: { status: 'verified', commit: String(i + 1).repeat(40) }
    })) };
  };
  const record = (phase, status, receipt, extra = {}) => act('record', { id: '10', owner: 'worker-a', phase, status, receipt, ...extra });
  const commits = () => record('commit', 'succeeded', commit());
  const bos = () => record('bos', 'succeeded', { select: api.selection(state().demands[0]), submitted: true, resultCodes: ['000'] });
  const push = key => {
    const item = state().demands[0], receipt = item.delivery.commit.records.find(record => record.key === key);
    return { repositories: [{ key, commit: receipt.hash, remote: 'origin', ref: 'refs/heads/dev', verified: true, remoteHash: receipt.hash }] };
  };
  return { root, directory, input, act, state, decision, authorize, claim, publish, prepare, commit, record, commits, bos, push };
}
test('automatic evidence never accepts a demand; new human decisions do not wait for delivery', t => {
  const f = fixture(t);
  assert.equal(api.summarize(f.state()).count, 0);
  assert.throws(() => f.claim(), /human-passed/);
  assert.throws(() => f.act('decide', { id: '10', actor: 'agent', status: 'passed', quote: 'automation passed' }), /direct user/);
  f.decision(); f.claim();
  assert.throws(() => f.publish(), /authorization/);
  f.decision('2');
  assert.equal(api.summarize(f.state()).csv, '2,10');
  assert.equal(api.summarize(f.state(), 'delivered').count, 0);
});
test('separate worktrees can prepare concurrently; publication to the same target is exclusive', t => {
  const f = fixture(t);
  f.prepare(); f.decision('2');
  assert.throws(() => f.claim('10', 'worker-b'), /another owner/);
  assert.throws(() => f.claim('2', 'worker-b'), /Worktree is already in use/);
  const isolated = path.join(f.root, 'isolated'); fs.mkdirSync(isolated);
  f.claim('2', 'worker-b', { api: isolated });
  assert.throws(() => f.publish('2', 'worker-b'), /Publication is busy/);
  f.act('release', { id: '10', owner: 'worker-a' });
  f.publish('2', 'worker-b');
  assert.equal(f.state().demands[1].publication.owner, 'worker-b');
});
test('recorded scope cannot drift independently of its authorization hash', t => {
  const f = fixture(t);
  const file = path.join(f.directory, 'session.json'), state = f.state();
  state.demands[0].repositories[0].files.push('unaccepted.txt');
  fs.writeFileSync(file, JSON.stringify(state));
  assert.throws(() => f.state(), /scope changed/);
});
test('claims cannot silently switch worktrees during resume', t => {
  const f = fixture(t); f.decision(); f.claim();
  const isolated = path.join(f.root, 'isolated'); fs.mkdirSync(isolated);
  assert.throws(() => f.claim('10', 'worker-a', { api: isolated }), /worktree|Worktree/);
});
test('all repositories must have exact verified commits before a BOS receipt is accepted', t => {
  const f = fixture(t, ['api', 'web']); f.prepare();
  const bad = f.commit(); bad.repositories.pop();
  assert.throws(() => f.record('commit', 'succeeded', bad), /All target/);
  const changed = f.commit(); changed.repositories[0].files.push('other.txt');
  assert.throws(() => f.record('commit', 'succeeded', changed), /files differ/);
  const wrong = f.commit(); wrong.demand = '999';
  assert.throws(() => f.record('commit', 'succeeded', wrong), /this demand/);
  f.commits();
  assert.throws(() => f.record('push', 'succeeded', f.push('api')), /BOS result/);
  assert.throws(() => f.record('bos', 'succeeded', { submitted: true, resultCodes: ['000'], select: [] }), /exact verified/);
  f.bos();
  assert.throws(() => f.bos(), /already succeeded/);
});
test('unknown BOS outcome blocks retry until a direct user reconciliation for the exact selection', t => {
  const f = fixture(t); f.prepare(); f.commits();
  f.record('bos', 'running'); f.record('bos', 'unknown', undefined, { evidenceRef: 'protected/transport.json' });
  assert.throws(() => f.record('bos', 'running'), /reconcile/);
  assert.throws(() => f.record('bos', 'succeeded', { select: [], submitted: true, resultCodes: ['000'] }), /Reconcile/);
  assert.throws(() => f.act('reconcile-bos', { id: '10', owner: 'worker-a', actor: 'agent', quote: 'probably saved', status: 'not-submitted' }), /direct user/);
  const selection = api.selection(f.state().demands[0]);
  f.act('reconcile-bos', { id: '10', owner: 'worker-a', actor: 'user', quote: 'The exact two repository versions exist in BOS', status: 'succeeded', receipt: { select: selection, resultCodes: ['000'] } });
  f.record('push', 'succeeded', f.push('api'));
  assert.equal(api.summarize(f.state(), 'delivered').count, 1);
});
test('partial push survives restart and does not require a second BOS write', t => {
  const f = fixture(t, ['api', 'web']); f.prepare(); f.commits(); f.bos();
  f.record('push', 'succeeded', f.push('api'));
  assert.equal(f.state().demands[0].delivery.push.status, 'partial');
  assert.equal(api.summarize(f.state(), 'delivered').count, 0);
  f.record('push', 'unknown', undefined, { evidenceRef: 'protected/push-web.json' });
  assert.equal(f.state().demands[0].delivery.push.records.length, 1);
  f.record('push', 'succeeded', f.push('web'));
  assert.equal(api.summarize(f.state(), 'delivered').csv, '10');
  assert.equal(f.state().demands[0].claim, null);
  assert.equal(f.state().demands[0].publication, null);
});
test('integration preserves the BOS-linked business hash and requires verified ancestry', t => {
  const f = fixture(t); f.prepare(); f.commits(); f.bos();
  const receipt = f.push('api'); receipt.repositories[0].remoteHash = 'a'.repeat(40);
  assert.throws(() => f.record('push', 'succeeded', receipt), /containment/);
  receipt.repositories[0].containsVerified = true;
  f.record('push', 'succeeded', receipt);
  assert.equal(f.state().demands[0].delivery.commit.records[0].hash, '1'.repeat(40));
});
test('single-row and many-row summaries are exact BOS query input, with numeric ordering and deduplication', t => {
  const f = fixture(t); f.decision('10'); f.decision('2');
  assert.equal(api.idsCsv(['10', '2', '10']), '2,10');
  assert.equal(api.render(f.state()), '验收通过共 **2 条**：\n\n' + fence + 'text\n2,10\n' + fence);
  assert.equal(api.render(f.state(), 'accepted', 'csv'), '2,10');
  assert.throws(() => api.idsCsv(['2,10']), /digits/);
  assert.throws(() => api.idsCsv([9007199254740992]), /safe|digits/);
  const result = spawnSync('node', [cli, 'report', '--directory', f.directory, '--kind', 'accepted', '--format', 'markdown'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), api.render(f.state()));
  assert.doesNotMatch(api.render(f.state(), 'pending'), /text/);
});
test('rejected and deferred decisions remain distinct; empty results never produce a query placeholder', t => {
  const f = fixture(t); f.decision('10', 'failed'); f.decision('2', 'deferred');
  assert.equal(api.summarize(f.state(), 'failed').csv, '10');
  assert.equal(api.summarize(f.state(), 'deferred').csv, '2');
  assert.equal(api.render(f.state()), '验收通过共 **0 条**：暂无。');
  assert.doesNotMatch(api.render(f.state()), new RegExp(fence));
});
test('metadata lock is short, preserves another writer lock, and reporting is read-only', t => {
  const f = fixture(t), lock = path.join(f.directory, 'session.lock'), before = fs.readFileSync(path.join(f.directory, 'session.json'));
  fs.writeFileSync(lock, 'another writer', { flag: 'wx' });
  assert.throws(() => f.decision(), /metadata is busy/);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'another writer');
  assert.equal(api.summarize(f.state()).count, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.directory, 'session.json')), before);
  fs.unlinkSync(lock);
});
test('session and exact-file boundaries reject capability directories and path escapes', t => {
  const f = fixture(t);
  assert.throws(() => api.create(path.join(f.root, '.agents', 'state'), f.input), /outside capability/);
  assert.throws(() => api.create(path.join(f.root, '..', 'state-outside'), f.input), /inside/);
  const invalid = structuredClone(f.input); invalid.demands[0].repositories[0].files = ['../unaccepted.txt'];
  assert.throws(() => api.create(path.join(f.root, 'bad'), invalid), /exact/);
  invalid.demands[0].repositories[0].files = [''];
  assert.throws(() => api.create(path.join(f.root, 'empty'), invalid), /exact/);
});
test('phase timing is recorded without treating unmeasured intervals as a specific cause', t => {
  const f = fixture(t); f.prepare();
  f.record('commit', 'succeeded', f.commit(), { durationMs: 1250 });
  assert.equal(f.state().demands[0].history.at(-1).durationMs, 1250);
});

test('CLI stdin intake and scoped status resume without rewriting the batch', t => {
  const f = fixture(t);
  const invoke = (command, input, extra = []) => {
    const result = spawnSync(process.execPath, [cli, command, '--directory', f.directory, ...(input ? ['--stdin'] : []), ...extra], { encoding: 'utf8', input: input ? JSON.stringify(input) : undefined, windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  invoke('decide', { id: '2', actor: 'user', status: 'passed', quote: '2 accepted' });
  const next = invoke('next'); assert.equal(next.next.id, '2');
  const current = invoke('status', null, ['--id', '2']);
  assert.equal(current.demand.decision.status, 'passed');
  assert.equal(current.scopeHash, f.state().scopeHash);
  assert.equal(current.demands, undefined);
});

test('accepts the actual verified commit-demand result from an isolated local repository', t => {
  const f = fixture(t), repo = f.input.demands[0].repositories[0].root;
  const run = (command, args, cwd = repo) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' } });
    assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message); return result.stdout;
  };
  run('git', ['init', '-b', 'main']);
  run('git', ['config', 'user.name', 'Acceptance Fixture']);
  run('git', ['config', 'user.email', 'fixture@example.invalid']);
  run('git', ['config', 'commit.gpgSign', 'false']);
  const hooks = path.join(f.root, 'empty-hooks'); fs.mkdirSync(hooks);
  run('git', ['config', 'core.hooksPath', hooks]);
  fs.writeFileSync(path.join(repo, 'changed.txt'), 'before\n');
  run('git', ['add', 'changed.txt']); run('git', ['commit', '-m', 'fixture baseline']);
  fs.writeFileSync(path.join(repo, 'changed.txt'), 'after\n');
  // Official plans must live under os.tmpdir(); remove only this test-owned directory.
  const officialTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-official-plan-'));
  t.after(() => { assert.ok(path.basename(officialTemp).startsWith('acceptance-official-plan-')); fs.rmSync(officialTemp, { recursive: true, force: true }); });
  const commitCli = path.resolve(__dirname, '../scripts/commit-demand.js');
  const planned = JSON.parse(run(process.execPath, [commitCli, 'plan', '--project-root', repo, '--kind', 'project', '--demand', '10', '--type', 'fix', '--title', '编辑框默认值恢复', '--file', 'changed.txt', '--modification', '通过回填初始值恢复编辑框清空后的默认内容，避免保存空字符串并保留初始内容', '--output', path.join(officialTemp, 'plan.json')]));
  f.prepare();
  run(process.execPath, [commitCli, 'apply', '--plan', planned.planPath, '--confirm-commit', '--verify']);
  const verified = JSON.parse(fs.readFileSync(planned.planPath, 'utf8'));
  f.record('commit', 'succeeded', verified);
  const item = f.state().demands[0];
  assert.equal(item.delivery.commit.records[0].hash, run('git', ['rev-parse', 'HEAD']).trim());
  assert.deepEqual(api.selection(item), [{ repo, hash: verified.repositories[0].execution.commit }]);
  assert.equal(api.summarize(f.state(), 'delivered').count, 0);
});

test('confirmed BOS readback recovers without user interruption and releases commit-plus-BOS ownership', t => {
  for (const actor of ['agent', 'user']) {
    const f = fixture(t, ['api'], ['10', '2'], ['commit', 'bos-log']);
    f.prepare(); f.commits(); f.record('bos', 'running'); f.record('bos', 'unknown');
    const input = { id: '10', owner: 'worker-a', actor, status: 'succeeded', receipt: { select: api.selection(f.state().demands[0]), submitted: true, resultCodes: ['000'] } };
    if (actor === 'agent') {
      assert.throws(() => f.act('reconcile-bos', input), /readback/);
      input.verification = { source: 'bos-readback', evidenceRef: 'evidence/confirmed-bos-readback.json' };
      const bad = structuredClone(input); bad.receipt.select[0].hash = 'f'.repeat(40);
      assert.throws(() => f.act('reconcile-bos', bad), /exact commits/);
    } else input.quote = 'The exact commit is present in BOS';
    f.act('reconcile-bos', input);
    const done = f.state().demands[0];
    assert.equal(api.completed(f.state(), done), true);
    assert.equal(done.claim, null); assert.equal(done.publication, null);
    f.decision('2'); f.claim('2', 'worker-b'); f.publish('2', 'worker-b');
    assert.equal(f.state().demands[1].publication.owner, 'worker-b');
    assert.equal(api.summarize(f.state(), 'delivered').csv, '10');
  }
});
