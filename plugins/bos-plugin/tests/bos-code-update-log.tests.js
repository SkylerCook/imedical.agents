'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const log = require('../scripts/bos-code-update-log');
const personal = require('../scripts/personal-config');
const config = { url: 'https://example.invalid/code-log', token: randomBytes(24).toString('hex'), linkProject: 'synthetic-project', timeout: 1000 };
const message = (number = '1001', menu = '示例菜单', note = '增加字段校验，确保无效数据能够返回明确提示') => `fix(${number}):${menu}\n修改说明:${note}\n需求描述:${number} 示例需求`;
function fixture(t, value = { 'bos-code-update-log': config }) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bos-log-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'private.json'); fs.writeFileSync(file, JSON.stringify(value));
  return { root, file, env: { BOS_MCP_CONFIG: file } };
}
function git(repo, args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
function repo(root, name = 'repo') {
  const dir = path.join(root, name); fs.mkdirSync(dir); git(dir, ['init', '-b', 'dev']);
  git(dir, ['config', 'user.name', 'synthetic-user']); git(dir, ['config', 'user.email', 'synthetic@example.invalid']);
  git(dir, ['config', 'core.hooksPath', path.join(root, 'empty-hooks')]);
  git(dir, ['remote', 'add', 'origin', `https://example.invalid/group/${name}.git`]);
  return dir;
}
function commit(dir, name, text, msg) {
  fs.writeFileSync(path.join(dir, name), text); git(dir, ['add', name]); git(dir, ['commit', '-m', msg]); return git(dir, ['rev-parse', 'HEAD']);
}
test('standard and project messages map required fields without copying demand descriptions', () => {
  const parsed = log.parseCommitMessage(message()); assert.equal(parsed.requirementCode, '1001'); assert.equal(parsed.menuNames, '示例菜单');
  assert.equal(parsed.error, ''); assert.ok(!parsed.modifyDesc.includes('示例需求'));
  assert.equal(log.parseCommitMessage('feat(1002):示例菜单\n修改说明:增加检索条件').error, '');
  for (const msg of ['无需求号', 'fix(1001):\n修改说明:说明', 'fix(1001):菜单']) assert.ok(log.parseCommitMessage(msg).error);
});
test('remote names and binary numstat match the payload contract', () => {
  assert.equal(log.resolveProjectName('git@example.invalid:group/example.git'), 'example');
  assert.equal(log.resolveProjectName('https://example.invalid/group/example.git'), 'example');
  assert.deepEqual(log.parseNumstat('12\t3\tsrc/a.js\n-\t-\timage.png'), [
    { path: 'src/a.js', addLines: 12, delLines: 3 }, { path: 'image.png', addLines: 0, delLines: 0 }
  ]);
});
test('only the log section supplies credentials and the company endpoint follows defaults', t => {
  const f = fixture(t, { 'bos-code-update-log': { ...config, connection: 'company', url: undefined }, 'bos-demand-query': null });
  assert.equal(log.loadConfig(f.env).url, personal.companyUrl('codeUpdateLogUrl'));
  assert.equal(log.loadConfig(f.env).token, config.token);
  fs.writeFileSync(f.file, JSON.stringify({ 'bos-demand-query': { headers: { Authorization: 'query-only-token' } } }));
  assert.throws(() => log.loadConfig(f.env), /bos-code-update-log/);
  assert.throws(() => log.loadConfig({ BOS_CODE_UPDATE_TOKEN: config.token, BOS_LINK_PROJECT: config.linkProject, BOS_CODE_UPDATE_SETTINGS: f.file }), /BOS_MCP_CONFIG/);
});
test('invalid log fields stop locally rather than mixing credentials or falling back', t => {
  const f = fixture(t);
  for (const selected of [null, { ...config, enabled: false }, { ...config, token: 'TODO' }, { ...config, linkProject: '' },
    { ...config, url: 'http://example.invalid' }, { ...config, url: 'https://user:private@example.invalid' },
    { ...config, url: 'https://example.invalid?token=private' }, { ...config, connection: 'company' },
    { ...config, connection: 'unknown' }, { ...config, timeout: 0 }, { ...config, timeout: '1000' }]) {
    fs.writeFileSync(f.file, JSON.stringify({ 'bos-code-update-log': selected })); assert.throws(() => log.loadConfig(f.env));
  }
});
test('cross-repository aggregation preserves every distinct menu and note in stable order', () => {
  const records = ['first', 'second', 'first'].map((name, i) => ({ repo: name, project: name, hash: String(i + 1).repeat(40), shortHash: 'abcdef0', message: message('1001', name, name), files: [{ path: name + '.js', addLines: 2, delLines: 1 }] }));
  const payload = log.buildPayload(records, { linkProject: config.linkProject, userCode: 'synthetic-user' });
  assert.equal(payload.length, 1); assert.equal(payload[0].MenuNames, 'first\nsecond'); assert.equal(payload[0].ModifyDesc, 'first\nsecond');
  assert.equal(payload[0].Repository.length, 3); assert.equal(payload[0].Repository[1].AddLines, 2);
  assert.equal(log.summarize(payload)[0].repositories[0].fileCount, 1);
  assert.throws(() => log.buildPayload([{ ...records[0], message: 'invalid' }], { linkProject: 'p', userCode: 'u' }), /需求号/);
});
test('real Git collection supports batched commits and interleaved repositories without widening selection', t => {
  const f = fixture(t), a = repo(f.root, 'repo-a'), b = repo(f.root, 'repo-b');
  const a1 = commit(a, '示例.txt', 'one\n', message());
  const b1 = commit(b, 'b.txt', 'two\n', message('1001', '菜单二', '说明二'));
  const a2 = commit(a, '示例.txt', 'one\nthree\n', message('1002'));
  const select = [{ repo: a, hash: a1 }, { repo: b, hash: b1 }, { repo: a, hash: a2 }, { repo: a, hash: a1 }].map(item => ({ ...item, ref: 'refs/heads/dev' }));
  const records = log.selectRecords(select); assert.deepEqual(records.map(r => r.hash), [a1, b1, a2]);
  assert.equal(records[0].project, 'repo-a'); assert.equal(records[0].files[0].path, '示例.txt');
  assert.equal(records[2].files[0].addLines, 1); assert.equal(log.listCommits(a, 1, 'refs/heads/dev')[0].hash, a2);
  assert.deepEqual(log.listRepos(f.root, 1).map(r => r.name).sort(), ['repo-a', 'repo-b']);
  assert.throws(() => log.selectRecords([{ repo: a, hash: '--all' }]), /hash/);
});
test('plan and unconfirmed submit perform zero network requests; confirmed submit uses exactly the selected payload', async t => {
  const f = fixture(t), dir = repo(f.root), hash = commit(dir, 'a.txt', 'one\n', message());
  const input = JSON.stringify({ select: [{ repo: dir, ref: 'refs/heads/dev', hash }] }); let requests = 0;
  const fetchImpl = async (url, options) => {
    requests++; assert.equal(url, config.url); assert.equal(options.headers.Authorization, 'Bearer ' + config.token);
    assert.equal(options.redirect, 'error'); assert.equal(JSON.parse(options.body)[0].Repository[0].CodeRepositoryVersion, hash);
    return { ok: true, status: 200, json: async () => ({ ResultCode: '000', ResultMsg: 'accepted' }) };
  };
  const options = { env: f.env, fetchImpl };
  const plan = await log.main(['plan', input], options); assert.equal(plan.submitted, false); assert.equal(plan.tokenConfigured, true);
  assert.ok(!JSON.stringify(plan).includes(config.token));
  const preview = await log.main(['submit', input], options); assert.equal(preview.ok, false); assert.equal(requests, 0);
  const result = await log.main(['submit', input, '--confirm'], options); assert.equal(result.submitted, true); assert.equal(requests, 1);
});
test('a commit with no reportable files stops the entire selection before credentials or network', async t => {
  const f = fixture(t), a = repo(f.root, 'repo-a'), b = repo(f.root, 'repo-b');
  git(a, ['config', 'diff.renames', 'true']);
  const hash = commit(a, 'empty.txt', '', message());
  const binary = commit(a, 'binary.bin', Buffer.from([0, 255, 4]), message());
  const renamed = 'renamed.txt';
  git(a, ['mv', 'empty.txt', renamed]);
  git(a, ['commit', '-m', message()]);
  const renameHash = git(a, ['rev-parse', 'HEAD']);
  git(b, ['commit', '--allow-empty', '-m', message() + '\n\n12\t34\tnot-a-file.txt']);
  const emptyHash = git(b, ['rev-parse', 'HEAD']);
  const ref = 'refs/heads/dev';
  const select = [{ repo: a, ref, hash }, { repo: b, ref, hash: emptyHash }];
  const valid = { select: [hash, binary, renameHash].map(hash => ({ repo: a, ref, hash })) };
  const mixed = JSON.stringify({ select });
  const binding = JSON.stringify({ bindings: [{ requirementCode: '1001', codeOwnerRequirementCode: '1001', select }] });
  let requests = 0;
  const fetchImpl = async () => { requests++; throw Error('unexpected request'); };
  const noFiles = error => error.message.includes('repo-b') && error.message.includes(emptyHash) && error.message.includes('未提取到可登记的文件变更');
  for (const input of [mixed, binding]) {
    await assert.rejects(log.main(['plan', input], { env: {}, fetchImpl }), noFiles);
    await assert.rejects(log.main(['submit', input, '--confirm'], { env: {}, fetchImpl }), noFiles);
    await assert.rejects(log.submit(JSON.parse(input), config, fetchImpl), noFiles);
  }
  const plan = await log.main(['plan', JSON.stringify(valid)], { env: f.env, fetchImpl });
  assert.equal(plan.payload[0].Repository.length, 3);
  assert.deepEqual(plan.summary[0].repositories.map(item => [item.fileCount, item.addLines, item.delLines]), [[1, 0, 0], [1, 0, 0], [1, 0, 0]]);
  assert.equal(requests, 0);
});
test('historical recovery previews original Git evidence and requires a matching BOS readback to send', async t => {
  const f = fixture(t), a = repo(f.root, 'repo-a'), b = repo(f.root, 'repo-b');
  const old = commit(a, 'old.txt', 'one\n', '1001 旧版标题');
  const standard = commit(b, 'new.txt', 'two\n', message());
  git(a, ['commit', '--allow-empty', '-m', message()]);
  const noteHash = git(a, ['rev-parse', 'HEAD']);
  const ref = 'refs/heads/dev';
  const select = [
    { repo: a, ref, hash: old, menuNames: '核实的菜单', modifyDesc: `核实的说明 ${noteHash}` },
    { repo: b, ref, hash: standard }
  ];
  const input = { recovery: { requirementCode: '1001', select } };
  let requests = 0, requestPayload;
  const fetchImpl = async (_url, options) => {
    requests++;
    requestPayload = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ ResultCode: '000' }) };
  };
  const options = { env: f.env, fetchImpl };
  await assert.rejects(log.main(['plan', JSON.stringify({ select: [select[0]] })], options), /旧版首行格式/);
  const plan = await log.main(['plan', JSON.stringify(input)], options);
  const { scopeHash } = plan.recovery;
  assert.match(scopeHash, /^[0-9a-f]{64}$/);
  assert.equal(plan.payload[0].RequirementCode, '1001');
  assert.match(plan.payload[0].ModifyDesc, new RegExp(noteHash));
  assert.deepEqual(plan.payload[0].Repository.map(item => [item.CodeRepositoryVersion, item.ModifyFiles]), [[old, 'old.txt'], [standard, 'new.txt']]);
  assert.deepEqual(plan.summary[0].repositories.map(item => [item.ref, item.metadataSource]), [
    [ref, 'confirmed-recovery'], [ref, 'git-commit']
  ]);
  const readback = { scopeHash, status: 'not-found', evidenceRef: 'synthetic Bos readback record' };
  const execute = (value, confirm = true) => log.main(['submit', JSON.stringify(value), ...(confirm ? ['--confirm'] : [])], options);
  await assert.rejects(execute(input), /须提供.*BOS 回读/);
  await assert.rejects(execute({ ...input, readback: { ...readback, status: 'unknown' } }), /结果未知/);
  await assert.rejects(execute({ ...input, readback: { ...readback, scopeHash: 'wrong' } }), /scopeHash/);
  await assert.rejects(execute({ recovery: { ...input.recovery, select: [select[0]] }, readback }), /scopeHash/);
  await assert.rejects(log.submit({ ...input, readback }, { ...config, linkProject: 'changed' }, fetchImpl), /scopeHash/);
  assert.equal((await execute({ ...input, readback }, false)).submitted, false);
  const already = await execute({ ...input, readback: { ...readback, status: 'succeeded' } });
  assert.equal(already.submitted, false);
  assert.equal(already.alreadySubmitted, true);
  assert.equal(already.evidenceRef, readback.evidenceRef);
  assert.equal(requests, 0);
  const result = await execute({ ...input, readback });
  assert.equal(result.submitted, true);
  assert.deepEqual(requestPayload, plan.payload);
  assert.equal(requests, 1);
});
test('historical recovery rejects unrelated, ambiguous, empty, overridden and unbound inputs', async t => {
  const f = fixture(t), dir = repo(f.root);
  const old = commit(dir, 'old.txt', 'one\n', '1001 旧版说明');
  const unknown = commit(dir, 'old.txt', 'two\n', '版本标记包含 1001');
  const ambiguous = commit(dir, 'old.txt', 'three\n', '1001 1002 两条需求');
  const standard = commit(dir, 'old.txt', 'four\n', message());
  const conflicting = commit(dir, 'old.txt', 'five\n', message().replace('需求描述:1001', '需求描述:1002'));
  git(dir, ['commit', '--allow-empty', '-m', '1001 补写说明']);
  const empty = git(dir, ['rev-parse', 'HEAD']);
  const ref = 'refs/heads/dev';
  const item = { repo: dir, ref, hash: old, menuNames: '菜单', modifyDesc: '核实说明' };
  const recovery = { requirementCode: '1001', select: [item] };
  const plan = value => log.main(['plan', JSON.stringify(value)], { env: f.env });
  const rejectSelection = (values, expected) => assert.rejects(plan({ recovery: { ...recovery, select: values } }), expected);
  await assert.rejects(plan({ recovery, select: [item] }), /互斥/);
  await assert.rejects(plan({ recovery, bindings: [] }), /互斥/);
  await assert.rejects(plan({ select: [item], readback: {} }), /仅用于历史补录/);
  await assert.rejects(plan({ recovery: { ...recovery, requirementCode: '2001' } }), /无法确认属于需求/);
  await rejectSelection([{ ...item, hash: unknown }], /无法确认属于需求/);
  await rejectSelection([{ ...item, hash: ambiguous }], /无法确认属于需求/);
  await rejectSelection([{ ...item, hash: conflicting }], /需求描述与首行需求号冲突/);
  await rejectSelection([{ ...item, hash: empty }], /未提取到可登记/);
  await rejectSelection([{ ...item, hash: standard }], /已有完整的标准消息/);
  await rejectSelection([{ ...item, hash: old.slice(0, 8) }], /完整提交 hash/);
  await rejectSelection([{ ...item, ref: 'refs/heads/other' }], /confirmed target ref/);
  await rejectSelection([{ ...item, modifyDesc: ' ' }], /须补齐/);
  await rejectSelection([{ ...item, files: ['fake'] }], /只接受实仓路径/);
  await rejectSelection([item, { ...item, modifyDesc: '冲突说明' }], /提供唯一选择/);
  const unexpectedFetch = async () => { throw new Error('unexpected request'); };
  await assert.rejects(log.submit({ Repository: [{ ModifyFiles: 'fake' }] }, config, unexpectedFetch), /提供一条提交记录/);
});
test('success requires HTTP 2xx and every ResultCode; errors are redacted and requests never retry', async t => {
  const f = fixture(t), dir = repo(f.root), hash = commit(dir, 'a.txt', 'one\n', message());
  const input = { select: [{ repo: dir, ref: 'refs/heads/dev', hash }] };
  let requests = 0;
  const response = (data, ok = true, status = 200) => async () => { requests++; return { ok, status, json: async () => data }; };
  assert.deepEqual((await log.submit(input, config, response([{ ResultCode: '000' }, { ResultCode: '000' }]))).resultCodes, ['000', '000']);
  for (const data of [[], {}, null, { ResultCode: '500' }, [{ ResultCode: '000' }, { ResultCode: '500' }]]) await assert.rejects(log.submit(input, config, response(data)), /失败/);
  await assert.rejects(log.submit(input, config, response({ Message: 'denied ' + config.token }, false, 401)), e => e.message.includes('HTTP 401') && !e.message.includes(config.token));
  const before = requests;
  await assert.rejects(log.submit(input, config, async () => { requests++; const error = Error(config.token); error.name = 'TimeoutError'; throw error; }), /结果未知/);
  assert.equal(requests, before + 1);
  await assert.rejects(log.submit(input, config, async () => { throw Error(config.token); }), e => !e.message.includes(config.token));
  const success = await log.submit(input, config, response({ ResultCode: '000', ResultMsg: config.token })); assert.ok(!JSON.stringify(success).includes(config.token));
});
