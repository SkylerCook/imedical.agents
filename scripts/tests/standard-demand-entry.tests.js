'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const entry = require('../../plugins/coding-iris-plugin/scripts/iris-tools/demand-entry');
const { buildWorkbook, HEADERS } = require('../../plugins/coding-iris-plugin/scripts/iris-tools/demand-entry-xlsx');
const script = path.resolve(__dirname, '../../plugins/coding-iris-plugin/scripts/iris-tools/demand-entry.js');
const modification = '增加模板内容必填校验，在空内容保存时显示提示并聚焦输入框，避免提交无效模板';
function git(repo, ...args) {
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-C', repo, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(path.dirname(repo), 'empty-gitconfig') } });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return result.stdout.trim();
}
function fixture(t) {
  const base = path.join(os.tmpdir(), 'codex'); fs.mkdirSync(base, { recursive: true });
  const temp = fs.mkdtempSync(path.join(base, 'standard-demand-test-'));
  t.after(() => {
    assert.equal(path.dirname(temp), base);
    assert.ok(path.basename(temp).startsWith('standard-demand-test-'));
    fs.rmSync(temp, { recursive: true, force: true });
    assert.equal(fs.existsSync(temp), false);
  });
  const repo = path.join(temp, '中文 repo'); fs.mkdirSync(repo);
  fs.writeFileSync(path.join(temp, 'empty-gitconfig'), '');
  git(repo, 'init');
  fs.writeFileSync(path.join(repo, '页面.js'), 'old\n'); fs.writeFileSync(path.join(repo, 'other.txt'), 'unrelated\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'base');
  fs.writeFileSync(path.join(repo, '页面.js'), 'check empty\n');
  return { repo, temp };
}
function draftFor(repo, temp, options = {}) {
  const evidence = entry.collect({ repo, files: ['页面.js'], ...options });
  fs.writeFileSync(path.join(temp, 'facts.json'), JSON.stringify(evidence));
  const spec = { kind: 'standard', common: {}, requirements: [{ key: 'r1', name: '{PC} 模板校验', background: '空内容未提示', content: ['保存时校验内容', '提示后聚焦输入框'], subject: '模板维护', type: 'fix', changes: [{ evidence: 'facts.json', modification }] }] };
  return { evidence, spec, draft: entry.prepare(spec, temp) };
}
test('worktree evidence captures staged, unstaged, untracked and preserves unrelated index', (t) => {
  const { repo } = fixture(t);
  git(repo, 'add', '页面.js'); fs.appendFileSync(path.join(repo, '页面.js'), 'focus input\n');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'new content'); fs.appendFileSync(path.join(repo, 'other.txt'), 'user edit'); git(repo, 'add', 'other.txt');
  const before = git(repo, 'diff', '--cached', '--binary');
  const evidence = entry.collect({ repo, files: ['页面.js', 'new.txt'] });
  assert.match(evidence.staged, /check empty/); assert.match(evidence.unstaged, /focus input/);
  assert.equal(evidence.workingFiles.find((file) => file.file === 'new.txt').content, 'new content');
  assert.equal(git(repo, 'diff', '--cached', '--binary'), before);
  assert.doesNotThrow(() => entry.verifyEvidence(evidence));
});
test('text requires no module code; bind reuses final BOSS title and canonical message', (t) => {
  const { repo, temp } = fixture(t); const { draft } = draftFor(repo, temp);
  assert.match(entry.renderText(draft.requirements[0]), /^名称：\n\n\{PC\} 模板校验/);
  assert.throws(() => entry.messages(draft, 'r1'), /回填/);
  entry.bind(draft, 'r1', '1234567', 'BOSS 最终标题');
  const result = entry.messages(draft, 'r1');
  assert.equal(result[0].message, `fix(1234567):模板维护\n修改说明:${modification}\n需求描述:1234567 BOSS 最终标题\n`);
  assert.equal(draft.requirements[0].title, '模板校验');
  assert.throws(() => entry.bind(draft, 'r1', '7654321', 'another'), /已绑定不同需求/);
});
test('code or index drift blocks messages; unrelated files do not', (t) => {
  const { repo, temp } = fixture(t); const { draft } = draftFor(repo, temp); entry.bind(draft, 'r1', '123', '标题');
  fs.appendFileSync(path.join(repo, 'other.txt'), 'unrelated'); assert.doesNotThrow(() => entry.messages(draft, 'r1'));
  git(repo, 'add', '页面.js'); assert.throws(() => entry.messages(draft, 'r1'), /漂移/);
});
test('history uses fixed commits and never permits a new commit plan', (t) => {
  const { repo, temp } = fixture(t); git(repo, 'add', '页面.js'); git(repo, 'commit', '-m', 'feature');
  const commit = git(repo, 'rev-parse', 'HEAD'); const { draft } = draftFor(repo, temp, { commits: [commit] });
  entry.bind(draft, 'r1', '456', '历史需求');
  fs.appendFileSync(path.join(repo, 'other.txt'), 'next'); git(repo, 'add', 'other.txt'); git(repo, 'commit', '-m', 'next');
  assert.doesNotThrow(() => entry.messages(draft, 'r1'));
  assert.throws(() => entry.planArguments(draft, 'r1', repo), /历史提交/);
});
test('history range, root commits and invalid refs have explicit results', (t) => {
  const { repo } = fixture(t);
  assert.ok(entry.collect({ repo, commits: ['HEAD'] }).history[0].patch.includes('old'));
  assert.throws(() => entry.collect({ repo, range: 'HEAD..HEAD' }), /为空/);
  assert.throws(() => entry.collect({ repo, commits: ['missing-ref'] }), /Git 取证失败/);
  assert.throws(() => entry.collect({ repo, commits: ['HEAD'], range: 'HEAD~1..HEAD' }), /互斥/);
});
test('boundary, clean scope, tampered evidence and project kind are rejected', (t) => {
  const { repo, temp } = fixture(t); const { evidence, spec } = draftFor(repo, temp);
  assert.throws(() => entry.collect({ repo, files: ['../outside'] }), /越过/);
  assert.throws(() => entry.collect({ repo, files: ['other.txt'] }), /没有待提交改动/);
  assert.throws(() => entry.collect({ repo, files: ['.'] }), /越过/);
  evidence.unstaged += 'tampered'; assert.throws(() => entry.verifyEvidence(evidence), /被修改/);
  spec.kind = 'project'; assert.throws(() => entry.prepare(spec, temp), /仅支持/);
});
test('independent requirements cannot silently share files or demand IDs', (t) => {
  const { repo, temp } = fixture(t); const { spec, draft } = draftFor(repo, temp);
  spec.requirements.push({ ...spec.requirements[0], key: 'r2' }); assert.throws(() => entry.prepare(spec, temp), /共用文件/);
  draft.requirements.push({ ...draft.requirements[0], key: 'r2' }); entry.bind(draft, 'r1', '123', 'first');
  assert.throws(() => entry.bind(draft, 'r2', '123', 'second'), /同一需求号/);
});
function unzipStored(buffer) {
  const entries = {}; let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset + 8), 0);
    const size = buffer.readUInt32LE(offset + 18), length = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + length).toString();
    const start = offset + 30 + length + extra;
    entries[name] = buffer.subarray(start, start + size).toString(); offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50);
  return entries;
}
test('Excel has 29 columns, shared prose, safe literal strings, no centered assignee or example', (t) => {
  const { repo, temp } = fixture(t); const { draft } = draftFor(repo, temp); const item = draft.requirements[0]; item.name = '=SUM(A1)&<名称>';
  const archive = unzipStored(buildWorkbook([item], { 模块编码: 'TEST', 指派人: '=1+1', 创建日期: '2026-09-18' }, entry.renderText));
  const sheet = archive['xl/worksheets/sheet1.xml'];
  assert.equal(HEADERS.length, 29); assert.match(sheet, /A1:AC4/); assert.match(sheet, /需求截图1/);
  assert.match(sheet, /=SUM\(A1\)&amp;&lt;名称&gt;/); assert.match(sheet, /r="H2"[^>]*t="inlineStr"/);
  assert.match(sheet, /标题：/); assert.match(sheet, /注：/); assert.doesNotMatch(sheet, /模板示例|<f>/);
  assert.doesNotMatch(archive['xl/styles.xml'], /horizontal="center"/);
  assert.equal(entry.renderText(item, false).includes('名称：'), false);
});
test('Excel rejects missing required fields, invalid enums/dates and fake images', (t) => {
  const { repo, temp } = fixture(t); const { draft } = draftFor(repo, temp); const items = draft.requirements;
  assert.throws(() => buildWorkbook(items, {}, entry.renderText), /模块编码必填/);
  for (const extra of [{ 难度系数: 7 }, { 严重等级: 0 }, { 创建日期: '2026-02-30' }, { 需求截图2: 'a.png' }, { typo: 'unknown' }]) {
    assert.throws(() => buildWorkbook(items, { 模块编码: 'TEST', ...extra }, entry.renderText));
  }
});
test('Excel alias is equivalent; unsupported mutation and mixed modes fail', () => {
  assert.deepEqual(entry.parseArgs(['prepare', '--spec', 's.json', '--excel']), entry.parseArgs(['prepare', '--spec', 's.json', '--Excel']));
  assert.throws(() => entry.parseArgs(['apply']), /用法/);
  assert.throws(() => entry.parseArgs(['message', '--excel']), /不接受/);
});
test('deliver excludes imported requirements and refuses overwriting files', (t) => {
  const { repo, temp } = fixture(t); const { draft } = draftFor(repo, temp);
  draft.requirements.push({ ...draft.requirements[0], key: 'r2', imported: true });
  const output = path.join(temp, 'delivery'); entry.deliver(draft, output, false);
  assert.equal(fs.existsSync(path.join(output, 'r1.txt')), true); assert.equal(fs.existsSync(path.join(output, 'r2.txt')), false);
  assert.equal(fs.existsSync(path.join(output, 'requirements.xlsx')), false);
  assert.throws(() => entry.deliver(draft, output, false), /已存在/);
});
test('CLI bridge creates canonical standard plan without changing HEAD or index', (t) => {
  const { repo, temp } = fixture(t); const { draft } = draftFor(repo, temp); entry.bind(draft, 'r1', '98765', 'BOSS 最终标题');
  const draftPath = path.join(temp, 'bound.json'); fs.writeFileSync(draftPath, JSON.stringify(draft));
  const before = git(repo, 'status', '--porcelain'); const head = git(repo, 'rev-parse', 'HEAD');
  const result = spawnSync(process.execPath, [script, 'plan', '--draft', draftPath, '--item', 'r1', '--project-root', repo], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  const plan = JSON.parse(result.stdout);
  t.after(() => {
    const target = path.resolve(plan.planPath), expected = path.join(os.tmpdir(), 'codex-iris-demand-commit');
    assert.ok(target.startsWith(expected + path.sep)); fs.unlinkSync(target); fs.rmdirSync(path.dirname(target));
  });
  assert.equal(plan.kind, 'standard'); assert.equal(plan.demand, '98765'); assert.equal(plan.repositories[0].message, entry.messages(draft, 'r1')[0].message);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), head); assert.equal(git(repo, 'status', '--porcelain'), before);
});

test('different historical commits of one file can map to separate BOSS demands', (t) => {
  const { repo, temp } = fixture(t);
  const first = entry.collect({ repo, files: ['页面.js'], commits: ['HEAD'] });
  git(repo, 'add', '页面.js'); git(repo, 'commit', '-m', 'next feature');
  const second = entry.collect({ repo, files: ['页面.js'], commits: ['HEAD'] });
  fs.writeFileSync(path.join(temp, 'first.json'), JSON.stringify(first));
  fs.writeFileSync(path.join(temp, 'second.json'), JSON.stringify(second));
  const raw = { name: '功能', background: '原行为', content: '新行为', type: 'feat', subject: '功能' };
  const spec = { kind: 'standard', requirements: [
    { ...raw, key: 'r1', changes: [{ evidence: 'first.json', modification }] },
    { ...raw, key: 'r2', changes: [{ evidence: 'second.json', modification }] },
  ] };
  const draft = entry.prepare(spec, temp);
  entry.bind(draft, 'r1', '111', '历史功能一'); entry.bind(draft, 'r2', '222', '历史功能二');
  assert.equal(draft.requirements[0].boss.demand, '111'); assert.equal(draft.requirements[1].boss.demand, '222');
  spec.requirements[1].changes[0].evidence = 'first.json';
  assert.throws(() => entry.prepare(spec, temp), /共用文件范围/);
});
