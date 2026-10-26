'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { verifyRealCommits } = require('../lib/real-repository-commit');
const log = require('../../plugins/bos-plugin/scripts/bos-code-update-log');
const acceptance = require('../../plugins/demand-delivery-plugin/scripts/acceptance-session');
const ref = 'refs/heads/dev';

function fixture(t) {
  const base = fs.realpathSync(process.env.AGENT_TEST_TMPDIR || os.tmpdir());
  const root = fs.mkdtempSync(path.join(base, 'real-commit-'));
  t.after(() => { assert.equal(path.dirname(root), base); fs.rmSync(root, { recursive: true, force: true }); });
  const hooks = path.join(root, 'hooks'); fs.mkdirSync(hooks);
  const git = (repo, ...args) => execFileSync('git', ['-c', 'core.hooksPath=' + hooks, '-c', 'commit.gpgSign=false',
    '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', '-C', repo, ...args],
  { encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: 'pipe' }).trim();
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo); git(repo, 'init', '-b', 'dev');
  const commit = (target, file, id = '100') => {
    fs.writeFileSync(path.join(target, file), id + '\n'); git(target, 'add', file);
    git(target, 'commit', '-m', `fix(${id}):synthetic\n修改说明: preserve the selected behavior`);
    return git(target, 'rev-parse', 'HEAD');
  };
  const baseHash = commit(repo, 'base.txt', '1');
  const input = (hash, target = repo, targetRef = ref) => ({ select: [{ repo: target, ref: targetRef, hash }] });
  const configFile = path.join(root, 'private.json');
  fs.writeFileSync(configFile, JSON.stringify({ 'bos-code-update-log': {
    url: 'https://example.invalid/mock', token: randomBytes(24).toString('hex'), linkProject: 'synthetic', timeout: 1000
  } }));
  return { root, repo, git, commit, baseHash, input, env: { BOS_MCP_CONFIG: configFile } };
}

test('worktree objects and a pushed repair branch cannot pass plan, submit or the write boundary', async t => {
  const f = fixture(t), worktree = path.join(f.root, 'worktree');
  f.git(f.repo, 'worktree', 'add', '-b', 'repair', worktree);
  const hash = f.commit(worktree, 'feature.txt');
  const remote = path.join(f.root, 'remote.git'); f.git(f.root, 'init', '--bare', remote);
  f.git(worktree, 'push', remote, 'HEAD:refs/heads/repair');
  assert.equal(f.git(f.repo, 'cat-file', '-t', hash), 'commit');
  let credentials = 0, requests = 0;
  const env = Object.defineProperty({}, 'BOS_MCP_CONFIG', { get() { credentials++; throw Error('credentials read'); } });
  const config = new Proxy({}, { get() { credentials++; throw Error('credentials read'); } });
  const fetchImpl = async () => { requests++; throw Error('unexpected request'); };
  for (const input of [f.input(hash), f.input(hash, worktree, 'refs/heads/repair'), f.input(hash, f.repo, 'refs/heads/repair')]) {
    for (const command of ['plan', 'submit']) await assert.rejects(log.main([command, JSON.stringify(input), '--confirm'], { env, fetchImpl }));
    await assert.rejects(log.submit(input, config, fetchImpl));
  }
  await assert.rejects(log.submit([{ CodeRepositoryVersion: hash }], config, fetchImpl), /日志输入必须为对象/);
  assert.equal(credentials, 0); assert.equal(requests, 0);
  f.git(f.repo, 'merge', '--ff-only', 'repair');
  assert.equal(log.selectInput(f.input(hash))[0].hash, hash);
  assert.throws(() => log.selectInput(f.input(hash, worktree, 'refs/heads/repair')), /worktree/);
});

for (const strategy of ['merge', 'cherry-pick', 'squash']) test(strategy + ' logs only commits present in the real target', t => {
  const f = fixture(t), worktree = path.join(f.root, 'source');
  f.git(f.repo, 'worktree', 'add', '-b', 'repair', worktree);
  const original = f.commit(worktree, 'feature.txt');
  f.commit(f.repo, 'independent.txt', '2');
  if (strategy === 'merge') f.git(f.repo, 'merge', '--no-ff', 'repair', '-m', 'integrate');
  else if (strategy === 'cherry-pick') f.git(f.repo, 'cherry-pick', original);
  else { f.git(f.repo, 'merge', '--squash', 'repair'); f.git(f.repo, 'commit', '-m', 'fix(100):synthetic\n修改说明: integrate selected behavior'); }
  const finalHash = strategy === 'merge' ? original : f.git(f.repo, 'rev-parse', 'HEAD');
  if (strategy !== 'merge') {
    assert.notEqual(finalHash, original);
    assert.throws(() => log.selectInput(f.input(original)), /not contained/);
  }
  const record = log.selectInput(f.input(finalHash))[0];
  assert.equal(record.hash, finalHash); assert.equal(record.repo, fs.realpathSync(f.repo));
  assert.equal(record.ref, ref); assert.equal(record.files[0].path, 'feature.txt');
});

test('explicit refs, exact roots, full hashes and detached checkouts fail closed', t => {
  const f = fixture(t);
  for (const input of [f.input(f.baseHash, f.repo, ''), f.input(f.baseHash.slice(0, 7)), f.input('f'.repeat(40))]) assert.throws(() => log.selectInput(input));
  const nested = path.join(f.repo, 'nested'); fs.mkdirSync(nested);
  assert.throws(() => verifyRealCommits(nested, ref, [f.baseHash]), /real Git root/);
  f.git(f.repo, 'checkout', '--detach');
  assert.throws(() => verifyRealCommits(f.repo, ref, [f.baseHash]));
});

test('physical aliases and real submodule gitdir files remain eligible', t => {
  const f = fixture(t), alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(verifyRealCommits(alias, ref, [f.baseHash]).repo, fs.realpathSync(f.repo));
  f.git(f.repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', f.repo, 'sub');
  const sub = path.join(f.repo, 'sub');
  f.git(sub, 'checkout', '-B', 'dev');
  assert.ok(fs.statSync(path.join(sub, '.git')).isFile());
  assert.equal(verifyRealCommits(sub, ref, [f.baseHash]).hashes[0], f.baseHash);
});

test('all repositories pass before credentials or HTTP, including explicit bindings', async t => {
  const f = fixture(t), source = path.join(f.root, 'source'); f.git(f.repo, 'worktree', 'add', '-b', 'repair', source);
  const hash = f.commit(source, 'feature.txt');
  let reads = 0, requests = 0;
  const env = Object.defineProperty({}, 'BOS_MCP_CONFIG', { get() { reads++; throw Error('configuration read'); } });
  const input = { bindings: [{ requirementCode: '101', codeOwnerRequirementCode: '100', select: [f.input(f.baseHash).select[0], f.input(hash).select[0]] }] };
  await assert.rejects(log.main(['submit', JSON.stringify(input), '--confirm'], { env, fetchImpl: async () => { requests++; } }), /not contained/);
  assert.equal(reads, 0); assert.equal(requests, 0);
});

function batch(f, noCodeParent = false) {
  const specs = file => [{ key: 'ui', root: f.repo, ref, remote: 'origin', files: [file] }];
  const directory = path.join(f.repo, 'docs', 'acceptance');
  acceptance.create(directory, { projectRoot: f.repo, deliveryActions: ['commit', 'bos-log', 'push'], demands: [
    noCodeParent ? { id: '100', title: 'summary', codeBinding: { kind: 'none', reason: 'summary only; code belongs to independent children' } } : { id: '100', title: 'shared', codeBinding: { kind: 'own' }, repositories: specs('shared.txt') },
    ...(!noCodeParent ? [{ id: '101', title: 'reference', parentId: '100', codeBinding: { kind: 'parent' } }] : []),
    { id: '102', title: 'independent', parentId: '100', codeBinding: { kind: 'own' }, repositories: specs('independent.txt') },
    { id: '103', title: 'baseline', parentId: '100', codeBinding: { kind: 'none', reason: 'baseline meets the requirement; no related commit' } }
  ] });
  const state = () => acceptance.load(directory);
  const act = (command, input) => acceptance.mutate(directory, value => acceptance.apply(value, command, input));
  const item = id => state().demands.find(entry => entry.id === id);
  act('authorize', { actor: 'user', quote: 'deliver this confirmed group', actions: ['commit', 'bos-log', 'push'] });
  const pass = id => act('decide', { id, actor: 'user', quote: id + ' passed', status: 'passed' });
  const claim = id => { act('claim', { id, owner: 'worker' }); act('publish', { id, owner: 'worker' }); };
  const record = (id, phase, receipt, status = 'succeeded') => act('record', { id, owner: 'worker', phase, status, receipt });
  const commit = (id, file, hash) => record(id, 'commit', { status: 'verified', demand: id, repositories: [{ root: f.repo, files: [file], message: `fix(${id}):synthetic\n修改说明: selected behavior`, execution: { status: 'verified', commit: hash } }] });
  const bos = id => record(id, 'bos', { requirementCode: id, codeOwnerRequirementCode: id === '101' ? '100' : id, linkProject: 'synthetic', select: acceptance.selection(item(id)), submitted: true, resultCodes: ['000'] });
  const push = (id, hash) => record(id, 'push', { repositories: [{ key: 'ui', remote: 'origin', ref, commit: hash, remoteHash: f.git(f.repo, 'rev-parse', 'HEAD'), verified: true, containsVerified: true }] });
  return { state, act, item, pass, claim, record, commit, bos, push };
}

for (const noCodeParent of [false, true]) test('mixed own/parent/none group completes by code owner; no-code parent=' + noCodeParent, t => {
  const f = fixture(t), b = batch(f, noCodeParent);
  for (const id of noCodeParent ? ['100', '103'] : ['100', '101', '103']) b.pass(id);
  assert.throws(() => b.claim(noCodeParent ? '102' : '100'), /human-passed|All related/);
  b.pass('102');
  if (!noCodeParent) {
    const shared = f.commit(f.repo, 'shared.txt');
    b.claim('100'); b.commit('100', 'shared.txt', shared); b.bos('100');
    assert.throws(() => b.push('100', shared), /All child BOS/);
    b.claim('101'); b.act('inherit', { id: '101', owner: 'worker' }); b.bos('101'); b.push('100', shared);
    assert.equal(b.item('101').delivery.push.status, 'inherited');
  }
  assert.equal(acceptance.summarize(b.state(), 'delivered').groupCompletion[0].completed, false);
  const own = f.commit(f.repo, 'independent.txt', '102');
  b.claim('102'); b.commit('102', 'independent.txt', own); b.bos('102'); b.push('102', own);
  assert.equal(b.item('102').delivery.push.status, 'succeeded');
  assert.equal(b.item('103').delivery.bos.status, 'not-applicable');
  if (noCodeParent) assert.equal(b.item('100').delivery.commit.status, 'not-applicable');
  assert.equal(acceptance.summarize(b.state(), 'delivered').groupCompletion[0].completed, true);
});

test('historical successful receipts cannot complete or resume BOS using worktree commits', t => {
  const f = fixture(t), b = batch(f), source = path.join(f.root, 'source');
  f.git(f.repo, 'worktree', 'add', '-b', 'repair', source);
  const hash = f.commit(source, 'shared.txt');
  const state = b.state(), item = state.demands[0];
  item.decision.status = 'passed'; item.claim = { owner: 'worker', worktrees: { ui: source } }; item.publication = { owner: 'worker' };
  item.delivery.commit = { status: 'succeeded', records: [{ key: 'ui', repo: source, hash }] };
  item.delivery.bos = { status: 'succeeded', selection: [{ repo: source, hash }] }; item.delivery.push.status = 'succeeded';
  assert.equal(acceptance.completed(state, item), false);
  for (const entry of state.demands) entry.decision.status = 'passed';
  item.delivery.bos.status = 'pending';
  assert.throws(() => acceptance.apply(state, 'record', { id: '100', owner: 'worker', phase: 'bos', status: 'running', receipt: { select: f.input(hash, source, 'refs/heads/repair').select } }), /scoped real repository/);
});

test('a source claim registers only the final real commit and completion requires actual receipts', t => {
  const f = fixture(t), b = batch(f), source = path.join(f.root, 'source');
  f.git(f.repo, 'worktree', 'add', '-b', 'repair', source);
  const hash = f.commit(source, 'shared.txt');
  for (const id of ['100', '101', '102', '103']) b.pass(id);
  b.act('claim', { id: '100', owner: 'worker', worktrees: { ui: source } }); b.act('publish', { id: '100', owner: 'worker' });
  assert.throws(() => b.record('100', 'commit', { status: 'verified', demand: '100', repositories: [{ root: source, files: ['shared.txt'], message: 'fix(100):synthetic', execution: { status: 'verified', commit: hash } }] }), /not verified/);
  f.git(f.repo, 'merge', '--ff-only', 'repair'); b.commit('100', 'shared.txt', hash); b.bos('100');
  b.claim('101'); b.act('inherit', { id: '101', owner: 'worker' }); b.bos('101');
  const corrupt = b.state(); corrupt.demands[1].delivery.bos.selection[0].ref = 'refs/heads/repair';
  assert.throws(() => acceptance.apply(corrupt, 'record', { id: '100', owner: 'worker', phase: 'push', status: 'running' }), /All child BOS receipts/);
  b.push('100', hash);
  const state = b.state(), item = state.demands[0];
  assert.equal(acceptance.completed(state, item), true);
  item.delivery.bos.resultCodes = []; assert.equal(acceptance.completed(state, item), false);
  item.delivery.bos.resultCodes = ['000']; item.delivery.push.records = []; assert.equal(acceptance.completed(state, item), false);
});

test('the final write boundary rechecks the target after configuration is loaded', async t => {
  const f = fixture(t), hash = f.commit(f.repo, 'selected.txt');
  let changed = false, requests = 0;
  const env = Object.defineProperty({}, 'BOS_MCP_CONFIG', { get() {
    if (!changed) { f.git(f.repo, 'update-ref', ref, f.baseHash); changed = true; }
    return f.env.BOS_MCP_CONFIG;
  } });
  await assert.rejects(log.main(['submit', JSON.stringify(f.input(hash)), '--confirm'], { env, fetchImpl: async () => { requests++; } }), /not contained/);
  assert.equal(requests, 0);
});
