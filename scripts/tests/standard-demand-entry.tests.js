'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const entry = require('../../plugins/bos-plugin/scripts/demand-entry');
const { buildWorkbook, HEADERS } = require('../../plugins/bos-plugin/scripts/demand-entry-xlsx');
const script = path.resolve(__dirname, '../../plugins/bos-plugin/scripts/demand-entry.js');
const modification = '增加模板内容必填校验，在空内容保存时显示提示并聚焦输入框，避免提交无效模板';
const bugDescription = { format: 'bug', steps: ['进入模板维护界面。', '保持内容为空，点击【暂存】。'], expected: '提示必填，不保存空模板。', actual: '空内容仍提示暂存成功。' };
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
  const spec = { kind: 'standard', common: {}, requirements: [{ key: 'r1', name: '{IRIS} 模板校验', description: { ...bugDescription }, subject: '模板维护', type: 'fix', changes: [{ evidence: 'facts.json', modification }] }] };
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
  assert.match(entry.renderText(draft.requirements[0]), /^需求名称：\n\n\{IRIS\} 模板校验/);
  assert.throws(() => entry.messages(draft, 'r1'), /回填/);
  entry.bind(draft, 'r1', '1234567', 'BOSS 最终标题');
  const result = entry.messages(draft, 'r1');
  assert.equal(result[0].message, `fix(1234567):模板维护\n修改说明:${modification}\n需求描述:1234567 BOSS 最终标题\n`);
  assert.equal(draft.requirements[0].title, '模板校验');
  assert.throws(() => entry.bind(draft, 'r1', '7654321', 'another'), /已绑定不同需求/);
});

test('standard development labels survive code text and Excel without changing import fields', t => {
  const { repo, temp } = fixture(t); const { spec } = draftFor(repo, temp);
  const name = '{IRIS}[标版] 模板校验';
  spec.requirements[0].name = name;
  const draft = entry.prepare(spec, temp), item = draft.requirements[0];
  assert.equal(draft.schema, 'iris-standard-demand/v2');
  assert.equal(item.name, name);
  assert.equal(item.title, '[标版] 模板校验');
  assert.ok(entry.renderText(item).startsWith(`需求名称：\n\n${name}\n\n`));
  const cell = (sheet, reference) => sheet.match(new RegExp(`<c r="${reference}"[^>]*><is><t[^>]*>([\\s\\S]*?)<\\/t><\\/is><\\/c>`))[1];
  for (const common of [{ 模块编码: 'TEST' }, { 模块编码: 'TEST', 加入标准版: '否' }]) {
    const sheet = unzipStored(buildWorkbook([item], common, entry.renderText))['xl/worksheets/sheet1.xml'];
    assert.equal(cell(sheet, 'B2'), name);
    assert.equal(cell(sheet, 'Q2'), entry.renderText(item, false));
    assert.equal(cell(sheet, 'O2'), common.加入标准版 || '');
  }
  assert.deepEqual(item.fields, {});
});

test('explicit titles and final BOSS titles retain their exact labels during message generation', t => {
  const { repo, temp } = fixture(t); const { spec } = draftFor(repo, temp);
  spec.requirements[0].name = '{IRIS}[标版] 模板校验';
  spec.requirements[0].title = '明确指定的内部标题';
  for (const finalTitle of ['{IRIS}[标版] 最终模板校验', '{IRIS} BOSS 最终标题']) {
    const draft = entry.prepare(spec, temp), item = draft.requirements[0];
    assert.equal(item.title, '明确指定的内部标题');
    entry.bind(draft, 'r1', '1234567', finalTitle);
    assert.equal(item.boss.title, finalTitle);
    assert.equal(entry.messages(draft, 'r1')[0].message,
      `fix(1234567):模板维护\n修改说明:${modification}\n需求描述:1234567 ${finalTitle}\n`);
    assert.equal(item.name, spec.requirements[0].name);
  }
});

test('Git evidence for temporary demo data scripts does not add a standard development label', t => {
  const { repo, temp } = fixture(t);
  fs.writeFileSync(path.join(repo, 'demo-data.js'), 'console.log("synthetic demo data");\n');
  const evidence = entry.collect({ repo, files: ['demo-data.js'] });
  fs.writeFileSync(path.join(temp, 'demo-facts.json'), JSON.stringify(evidence));
  const name = '{IRIS} 演示样例数据准备';
  const draft = entry.prepare({ kind: 'standard', requirements: [{
    key: 'demo', name, type: 'chore', subject: '演示数据准备',
    description: { format: 'change', summary: '准备本次演示所需的样例数据，不改变产品功能。', steps: ['运行本次演示的数据准备脚本。'], expected: '获得本次演示使用的样例数据。' },
    changes: [{ evidence: 'demo-facts.json', modification: '增加本次演示使用的样例数据准备脚本，输出合成数据供演示核对' }]
  }] }, temp);
  assert.equal(draft.requirements[0].name, name);
  assert.equal(draft.requirements[0].title, '演示样例数据准备');
  assert.doesNotMatch(entry.renderText(draft.requirements[0]), /\[标版\]/);
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
  const { repo, temp } = fixture(t); const { draft } = draftFor(repo, temp); const item = draft.requirements[0]; item.name = '{IRIS} =SUM(A1)&<名称>';
  const archive = unzipStored(buildWorkbook([item], { 模块编码: 'TEST', 指派人: '=1+1', 创建日期: '2026-09-18' }, entry.renderText));
  const sheet = archive['xl/worksheets/sheet1.xml'];
  assert.equal(HEADERS.length, 29); assert.match(sheet, /A1:AC4/); assert.match(sheet, /需求截图1/);
  assert.match(sheet, /=SUM\(A1\)&amp;&lt;名称&gt;/); assert.match(sheet, /r="H2"[^>]*t="inlineStr"/);
  assert.match(sheet, /【操作步骤】/); assert.match(sheet, /注：/); assert.doesNotMatch(sheet, /标题：|模板示例|<f>/);
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
test('all demand output commands reject .agents and capability source without creating artifacts', (t) => {
  const { repo, temp } = fixture(t); const { draft, spec } = draftFor(repo, temp);
  const specPath = path.join(temp, 'spec.json'); fs.writeFileSync(specPath, JSON.stringify(spec));
  const draftPath = path.join(temp, 'draft.json'); fs.writeFileSync(draftPath, JSON.stringify(draft));
  const forbidden = path.join(temp, '.agents', 'tmp');
  for (const [command, args, target] of [
    ['collect', ['--repo', repo, '--file', '页面.js'], path.join(forbidden, 'facts.json')],
    ['prepare', ['--spec', specPath], path.join(forbidden, 'delivery')],
    ['bind', ['--draft', draftPath, '--item', 'r1', '--demand', '123', '--title', '标题'], path.join(forbidden, 'bound.json')],
    ['render', ['--draft', draftPath], path.join(forbidden, 'rendered')],
  ]) {
    const result = spawnSync(process.execPath, [script, command, ...args, '--output', target], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1, `${command}: ${result.stdout}`);
    assert.match(result.stderr, /不能写入 \.agents 或能力包源码/);
    assert.equal(fs.existsSync(target), false);
  }
  assert.equal(fs.existsSync(forbidden), false);
  const sourceTarget = path.resolve(__dirname, '../../docs/forbidden-demand-test.json');
  assert.throws(() => entry.main(['collect', '--repo', repo, '--file', '页面.js', '--output', sourceTarget]), /能力包源码/);
  assert.equal(fs.existsSync(sourceTarget), false);
});
test('demand output guard resolves existing directory aliases and allows project paths', (t) => {
  const { repo, temp } = fixture(t); const { draft } = draftFor(repo, temp);
  const forbidden = path.join(temp, '.agents'); fs.mkdirSync(forbidden);
  const alias = path.join(temp, 'alias');
  fs.symlinkSync(forbidden, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => entry.deliver(draft, path.join(alias, 'delivery'), false), /不能写入 \.agents/);
  assert.equal(fs.existsSync(path.join(forbidden, 'delivery')), false);
  const output = path.join(repo, 'docs', 'work', 'standard-demand', 'task');
  assert.doesNotThrow(() => entry.deliver(draft, output, false));
  assert.equal(fs.existsSync(path.join(output, 'draft.json')), true);
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
  const raw = { name: '{IRIS} 功能', description: { format: 'change', summary: '支持功能查询。', steps: ['输入条件查询。'], expected: '展示匹配结果。' }, type: 'feat', subject: '功能' };
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

test('bug prose is directly copyable without optional user context or internal verification', () => {
  const item = { name: '{IRIS} 模板校验', title: '内部标题', description: bugDescription, verification: '内部验证记录' };
  const body = '【操作步骤】\n1. 进入模板维护界面。\n2. 保持内容为空，点击【暂存】。\n\n【预期结果】\n提示必填，不保存空模板。\n\n【实际结果】\n空内容仍提示暂存成功。';
  assert.equal(entry.renderText(item, false), body);
  assert.equal(entry.renderText(item), `需求名称：\n\n{IRIS} 模板校验\n\n需求描述：\n\n${body}`);
  assert.equal(entry.renderText({ ...item, remarks: '仅对新建模板生效。' }, false), `${body}\n\n【备注】\n仅对新建模板生效。`);
});

test('change description survives CLI prepare/render and matches the Excel description cell', (t) => {
  const { repo, temp } = fixture(t); const { spec } = draftFor(repo, temp);
  spec.common = { 模块编码: 'TEST' };
  spec.requirements[0].description = { format: 'change', summary: '支持按名称查询。', steps: ['输入名称查询。', '清空条件查询。'], expected: ['返回匹配模板。', '恢复完整列表。'] };
  const specPath = path.join(temp, 'new-spec.json'); fs.writeFileSync(specPath, JSON.stringify(spec));
  const output = path.join(temp, 'prepared');
  const result = spawnSync(process.execPath, [script, 'prepare', '--spec', specPath, '--output', output, '--excel'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const draftPath = path.join(output, 'draft.json');
  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  assert.equal(draft.schema, 'iris-standard-demand/v2');
  assert.equal(Object.hasOwn(draft.requirements[0], 'background'), false);
  assert.equal(Object.hasOwn(draft.requirements[0], 'content'), false);
  const body = '【需求说明】\n支持按名称查询。\n\n【操作步骤】\n1. 输入名称查询。\n2. 清空条件查询。\n\n【预期结果】\n返回匹配模板。\n\n恢复完整列表。';
  assert.equal(entry.renderText(draft.requirements[0], false), body);
  const sheet = unzipStored(fs.readFileSync(path.join(output, 'requirements.xlsx')))['xl/worksheets/sheet1.xml'];
  assert.equal(sheet.match(/<c r="Q2"[^>]*><is><t[^>]*>([\s\S]*?)<\/t><\/is><\/c>/)[1], body);
  const rendered = path.join(temp, 'rendered');
  const rerender = spawnSync(process.execPath, [script, 'render', '--draft', draftPath, '--output', rendered], { encoding: 'utf8', windowsHide: true });
  assert.equal(rerender.status, 0, rerender.stderr);
  assert.equal(fs.readFileSync(path.join(output, 'r1.txt'), 'utf8'), fs.readFileSync(path.join(rendered, 'r1.txt'), 'utf8'));
});

test('incomplete descriptions and missing technology prefix fail before output is created', (t) => {
  const { repo, temp } = fixture(t); const { spec, draft } = draftFor(repo, temp);
  for (const description of [undefined, null, {}, { ...bugDescription, steps: [] }, { ...bugDescription, steps: [' '] }, { ...bugDescription, expected: '' }, { ...bugDescription, actual: '' }, { ...bugDescription, summary: 'wrong branch' }, { format: 'change', steps: ['操作'], expected: '结果' }]) {
    spec.requirements[0].description = description;
    assert.throws(() => entry.prepare(spec, temp), /description|操作步骤/);
  }
  spec.requirements[0].description = bugDescription;
  spec.requirements[0].name = '模板校验';
  assert.throws(() => entry.prepare(spec, temp), /产品标识/);
  delete draft.requirements[0].description.expected;
  const output = path.join(temp, 'invalid-description');
  assert.throws(() => entry.deliver(draft, output, false), /description.expected/);
  assert.equal(fs.existsSync(output), false);
  draft.schema = 'iris-standard-demand/v1';
  assert.throws(() => entry.bind(draft, 'r1', '123', '标题'), /不支持的需求草稿/);
});

 test('non-IRIS product uses the same draft and Excel protocol', t => {
  const { repo, temp } = fixture(t); const { spec } = draftFor(repo, temp);
  spec.requirements[0].name = '{WEB} 模板校验';
  const draft = entry.prepare(spec, temp);
  assert.match(entry.renderText(draft.requirements[0]), /\{WEB\}/);
  entry.bind(draft, 'r1', '1234567', '跨技术栈需求');
  assert.match(entry.messages(draft, 'r1')[0].message, /需求描述:1234567 跨技术栈需求/);
  const sheet = unzipStored(buildWorkbook([draft.requirements[0]], { 模块编码: 'TEST' }, entry.renderText))['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /\{WEB\}/);
});

function workSpec() {
  return { kind: 'standard', source: 'work', common: { 模块编码: 'TEST' }, requirements: [{
    key: 'w1', name: '{DEMO} 演示场景与样例准备',
    description: { format: 'work', goal: '明确演示场景', activities: ['确认样例范围', '准备关联数据'], outcome: { kind: 'expected', text: '样例可供演示' } },
    sources: [{ kind: 'user', locator: '本轮用户说明', summary: '已确认场景，数据待准备' }],
    progress: { status: 'in-progress', summary: '场景已确认，数据尚未准备' }
  }] };
}
function workFixture(t) {
  const base = path.join(os.tmpdir(), 'codex'); fs.mkdirSync(base, { recursive: true });
  const temp = fs.mkdtempSync(path.join(base, 'work-demand-test-'));
  t.after(() => { assert.equal(path.dirname(temp), base); assert.ok(!fs.lstatSync(temp).isSymbolicLink()); fs.rmSync(temp, { recursive: true, force: true }); assert.ok(!fs.existsSync(temp)); });
  return temp;
}

test('work records keep meeting demo and data preparation names without standard labels', () => {
  const spec = workSpec(), original = spec.requirements[0];
  spec.requirements = ['演示方案会议', '功能演示', '演示样例数据准备'].map((goal, index) => ({
    ...original, key: 'w' + index, name: '{IRIS} ' + goal,
    description: { format: 'work', goal, activities: ['按已确认的工作范围开展' + goal] }
  }));
  const draft = entry.prepare(spec, '/missing-evidence', '/missing-project');
  assert.equal(draft.schema, 'iris-standard-demand/v3');
  assert.equal(draft.source, 'work');
  for (const [index, item] of draft.requirements.entries()) {
    assert.equal(item.name, spec.requirements[index].name);
    assert.doesNotMatch(entry.renderText(item), /\[标版\]/);
  }
});
test('work facts can describe standard development without relabeling another product', () => {
  const spec = workSpec(), original = spec.requirements[0];
  spec.requirements = [
    { key: 'iris', name: '{IRIS}[标版] 登录提示改进', goal: '完成标版登录失败提示改进', activity: '调整产品登录界面的失败提示', result: '登录失败时显示明确的错误提示' },
    { key: 'web', name: '{WEB} 演示方案会议', goal: '确认演示方案', activity: '讨论并确认演示范围', result: '形成已确认的演示方案' }
  ].map(({ key, name, goal, activity, result }) => ({
    ...original, key, name,
    description: { format: 'work', goal, activities: [activity], outcome: { kind: 'result', text: result } },
    sources: [{ kind: 'user', locator: '本轮合成工作说明', summary: result }],
    progress: { status: 'completed', summary: '合成工作记录已明确完成结果' }, remarks: '已完成'
  }));
  const draft = entry.prepare(spec, '/missing-evidence', '/missing-project');
  assert.equal(draft.schema, 'iris-standard-demand/v3');
  assert.equal(draft.source, 'work');
  for (const [index, item] of draft.requirements.entries()) {
    assert.equal(item.name, spec.requirements[index].name);
    assert.ok(entry.renderText(item).startsWith(`需求名称：\n\n${item.name}\n\n`));
  }
  assert.equal(draft.requirements[0].title, '[标版] 登录提示改进');
  assert.equal(draft.requirements[1].title, '演示方案会议');
  assert.doesNotMatch(entry.renderText(draft.requirements[1]), /\{IRIS\}|\[标版\]/);
});

test('work preparation needs no Git or submission project and preserves optional factual outcomes', () => {
  const spec = workSpec();
  const draft = entry.prepare(spec, '/missing-evidence', '/missing-project');
  assert.equal(draft.schema, 'iris-standard-demand/v3');
  assert.equal(draft.source, 'work');
  assert.ok(!Object.hasOwn(draft.requirements[0], 'changes'));
  let body = entry.renderText(draft.requirements[0], false);
  assert.match(body, /【预期成果】/); assert.match(body, /数据尚未准备/);
  assert.doesNotMatch(body, /验收标准|本轮用户说明/);
  delete spec.requirements[0].description.outcome;
  body = entry.renderText(entry.prepare(spec).requirements[0], false);
  assert.doesNotMatch(body, /预期成果|工作结果|验收标准/);
  spec.requirements[0].description.outcome = { kind: 'result', text: '形成场景清单；数据仍待准备' };
  assert.match(entry.renderText(entry.prepare(spec).requirements[0]), /【工作结果】/);
});
test('work rejects mixed sources and incomplete facts rather than fabricating code evidence', () => {
  for (const mutate of [s => { s.source = 'mixed'; }, s => { s.requirements[0].changes = []; },
    s => { s.requirements[0].type = 'chore'; }, s => { s.requirements[0].sources = []; },
    s => { s.requirements[0].progress.status = 'invented'; }, s => { s.requirements[0].description.format = 'change'; },
    s => { s.requirements[0].description.outcome = { kind: 'result', text: '' }; }]) {
    const spec = workSpec(); mutate(spec); assert.throws(() => entry.prepare(spec));
  }
  const draft = entry.prepare(workSpec()); draft.requirements.push({ ...draft.requirements[0] });
  assert.throws(() => entry.bind(draft, 'w1', '123', '标题'), /重复/);
});
test('work bind saves only the mapping and all submission paths stop before dependencies', () => {
  const draft = entry.prepare(workSpec());
  const before = JSON.stringify(draft.requirements[0].sources);
  entry.bind(draft, 'w1', '1234567', '最终工作标题');
  assert.equal(draft.requirements[0].boss.demand, '1234567');
  assert.equal(JSON.stringify(draft.requirements[0].sources), before);
  assert.throws(() => entry.messages(draft, 'w1', '/missing'), /无代码提交对象/);
  assert.throws(() => entry.planArguments(draft, 'w1'), /无代码提交对象/);
  assert.throws(() => entry.bind(draft, 'w1', '999', '另一标题'), /已绑定不同/);
  draft.schema = 'iris-standard-demand/v2';
  assert.throws(() => entry.bind(draft, 'w1', '1234567', '最终工作标题'), /不支持/);
});
test('work CLI prepare render Excel and bind operate outside Git without rewriting sources', t => {
  const temp = workFixture(t), spec = workSpec(), source = path.join(temp, 'notes.md');
  const original = '- [ ] 准备演示数据\n'; fs.writeFileSync(source, original);
  spec.requirements[0].sources = [{ kind: 'note', locator: source + ':1 准备演示数据', summary: '数据待准备' }];
  const input = path.join(temp, 'spec.json'); fs.writeFileSync(input, JSON.stringify(spec));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: temp, encoding: 'utf8', windowsHide: true });
  const out = path.join(temp, 'out');
  let result = run('prepare', '--spec', input, '--output', out, '--excel'); assert.equal(result.status, 0, result.stderr);
  const draftPath = path.join(out, 'draft.json'), draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  const prose = entry.renderText(draft.requirements[0], false);
  const sheet = unzipStored(fs.readFileSync(path.join(out, 'requirements.xlsx')))['xl/worksheets/sheet1.xml'];
  assert.ok(sheet.includes(prose)); assert.doesNotMatch(sheet, /notes\.md|产品BUG|新功能/);
  const rendered = path.join(temp, 'rendered'); result = run('render', '--draft', draftPath, '--output', rendered, '--Excel'); assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(out, 'w1.txt'), 'utf8'), fs.readFileSync(path.join(rendered, 'w1.txt'), 'utf8'));
  const bound = path.join(temp, 'bound.json'); result = run('bind', '--draft', draftPath, '--item', 'w1', '--demand', '123', '--title', '最终标题', '--output', bound); assert.equal(result.status, 0, result.stderr);
  for (const mode of ['message', 'plan']) { result = run(mode, '--draft', bound, '--item', 'w1'); assert.notEqual(result.status, 0); assert.match(result.stderr, /无代码提交对象/); }
  assert.equal(fs.readFileSync(source, 'utf8'), original);
  assert.ok(!fs.existsSync(path.join(temp, '.git')));
});
test('work missing Excel fields can deliver text and invalid work drafts create no output', t => {
  const temp = workFixture(t), spec = workSpec(); spec.common = {};
  const draft = entry.prepare(spec);
  assert.throws(() => entry.deliver(draft, path.join(temp, 'excel'), true), /模块编码/);
  assert.ok(!fs.existsSync(path.join(temp, 'excel')));
  entry.deliver(draft, path.join(temp, 'text'), false);
  draft.requirements[0].changes = [];
  assert.throws(() => entry.deliver(draft, path.join(temp, 'invalid'), false), /混合来源/);
  assert.ok(!fs.existsSync(path.join(temp, 'invalid')));
});

function requestSpec(format = 'bug') {
  return { kind: 'standard', source: 'request', common: { 模块编码: 'TEST' }, requirements: [{
    key: 'r1', name: '演示系统-登录-提示无法获取授权信息', recipientGroup: '演示支持组',
    description: format === 'bug'
      ? { format: 'bug', steps: ['进入用户指定的演示环境，尝试登录系统。'], expected: '能够正常登录。', actual: '据用户反馈，提示无法获取授权信息，不能登录。' }
      : { format: 'change', summary: '登录失败时提供明确的授权信息提示。', steps: ['在授权信息不可获取时尝试登录。'], expected: '显示可理解的失败原因。' },
    sources: [{ kind: 'user', locator: '本轮用户说明', summary: '提出演示系统登录故障' }, { kind: 'image', locator: '用户提供的截图', summary: '展示登录提示' }],
    progress: { status: 'planned', summary: '待接收组处理，未提供完成证据' }
  }] };
}

test('requests for standard development retain labels without requiring Git evidence', () => {
  const spec = requestSpec('change'), name = '{IRIS}[标版] 登录失败提示改进';
  spec.requirements[0].name = name;
  const draft = entry.prepare(spec, '/missing-evidence', '/missing-project'), item = draft.requirements[0];
  assert.equal(draft.schema, 'iris-standard-demand/v3');
  assert.equal(draft.source, 'request');
  assert.equal(item.name, name);
  assert.equal(item.title, '[标版] 登录失败提示改进');
  assert.ok(entry.renderText(item).startsWith(`需求名称：\n\n${name}\n\n`));
  const sheet = unzipStored(buildWorkbook([item], spec.common, entry.renderText))['xl/worksheets/sheet1.xml'];
  assert.ok(sheet.includes(name));
  entry.bind(draft, 'r1', '1234567', name);
  assert.equal(item.boss.title, name);
  assert.throws(() => entry.messages(draft, 'r1', '/missing-project'), /无代码提交对象/);
});

test('request reuses bug/change prose without Git, prefix or submission dependencies', () => {
  for (const format of ['bug', 'change']) {
    const draft = entry.prepare(requestSpec(format), '/missing-evidence', '/missing-project');
    assert.equal(draft.schema, 'iris-standard-demand/v3');
    assert.equal(draft.source, 'request');
    const item = draft.requirements[0], body = entry.renderText(item, false);
    assert.equal(item.recipientGroup, '演示支持组');
    assert.ok(!Object.hasOwn(item, 'changes'));
    assert.match(body, format === 'bug' ? /【实际结果】/ : /【需求说明】/);
    assert.doesNotMatch(body, /工作目标|当前进度|已完成|用户提供的截图|本轮用户说明/);
    assert.ok(!Object.hasOwn(item.fields, '产品组'));
    assert.ok(!Object.hasOwn(item.fields, '指派人'));
    delete item.recipientGroup;
    assert.doesNotThrow(() => entry.bind(draft, 'r1', '123', '最终标题'));
  }
});

test('request rejects mixed evidence, source mismatches and unsupported facts', () => {
  for (const mutate of [s => { s.requirements[0].changes = []; }, s => { s.requirements[0].type = 'fix'; },
    s => { s.requirements[0].sources = []; }, s => { s.requirements[0].sources[0].kind = 'invented'; },
    s => { s.requirements[0].recipientGroup = ''; }, s => { s.requirements[0].progress.status = 'invented'; },
    s => { s.requirements[0].description.format = 'work'; }, s => { delete s.requirements[0].description.actual; }]) {
    const spec = requestSpec(); mutate(spec); assert.throws(() => entry.prepare(spec));
  }
  const work = workSpec(); work.requirements[0].recipientGroup = '演示支持组';
  assert.throws(() => entry.prepare(work), /仅适用于主题提需/);
  const draft = entry.prepare(requestSpec()); draft.source = 'work';
  draft.requirements[0].name = '{DEMO} 登录问题';
  draft.requirements[0].sources = [draft.requirements[0].sources[0]];
  delete draft.requirements[0].recipientGroup;
  assert.throws(() => entry.bind(draft, 'r1', '123', '标题'), /来源匹配/);
});

test('request bind preserves recipient and facts while stopping all submission paths', () => {
  const draft = entry.prepare(requestSpec()), before = JSON.stringify(draft.requirements[0].sources);
  entry.bind(draft, 'r1', '123', '最终标题');
  assert.equal(draft.requirements[0].recipientGroup, '演示支持组');
  assert.equal(JSON.stringify(draft.requirements[0].sources), before);
  assert.throws(() => entry.messages(draft, 'r1', '/missing-project'), /无代码提交对象/);
  assert.throws(() => entry.planArguments(draft, 'r1', '/missing-project'), /无代码提交对象/);
});

test('request CLI text Excel render and bind share one draft outside Git', t => {
  const temp = workFixture(t), spec = requestSpec(), input = path.join(temp, 'spec.json');
  spec.requirements[0].remarks = '保留用户说明的影响范围。';
  fs.writeFileSync(input, JSON.stringify(spec));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: temp, encoding: 'utf8', windowsHide: true });
  const out = path.join(temp, 'out');
  let result = run('prepare', '--spec', input, '--output', out, '--excel'); assert.equal(result.status, 0, result.stderr);
  const draftPath = path.join(out, 'draft.json'), draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  const body = entry.renderText(draft.requirements[0], false);
  assert.ok(unzipStored(fs.readFileSync(path.join(out, 'requirements.xlsx')))['xl/worksheets/sheet1.xml'].includes(body));
  const rendered = path.join(temp, 'rendered');
  result = run('render', '--draft', draftPath, '--output', rendered); assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(out, 'r1.txt'), 'utf8'), fs.readFileSync(path.join(rendered, 'r1.txt'), 'utf8'));
  const bound = path.join(temp, 'bound.json');
  result = run('bind', '--draft', draftPath, '--item', 'r1', '--demand', '123', '--title', '最终标题', '--output', bound); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(bound, 'utf8')).requirements[0].recipientGroup, '演示支持组');
  for (const command of ['message', 'plan']) {
    result = run(command, '--draft', bound, '--item', 'r1'); assert.notEqual(result.status, 0); assert.match(result.stderr, /无代码提交对象/);
  }
  assert.ok(!fs.existsSync(path.join(temp, '.git')));
});

test('request retains completion remarks and enforces existing output protection', t => {
  const temp = workFixture(t), spec = requestSpec();
  spec.requirements[0].progress = { status: 'completed', summary: '用户已确认处理完成' };
  spec.requirements[0].remarks = '已完成\n保留已有备注。';
  const draft = entry.prepare(spec), body = entry.renderText(draft.requirements[0], false);
  assert.ok(body.endsWith('【备注】\n已完成\n保留已有备注。'));
  assert.equal((body.match(/【备注】/g) || []).length, 1);
  const forbidden = path.join(temp, '.agents', 'out');
  assert.throws(() => entry.deliver(draft, forbidden, false), /不能写入/);
  assert.ok(!fs.existsSync(forbidden));
  delete draft.common['模块编码'];
  const excel = path.join(temp, 'excel');
  assert.throws(() => entry.deliver(draft, excel, true), /模块编码/);
  assert.ok(!fs.existsSync(excel));
});
