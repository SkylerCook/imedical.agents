'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { loadConfig, initConfig, queryArguments } = require('../scripts/bos-demand-query');
const personal = require('../scripts/personal-config');
const configIO = require('../runtime/scripts/lib/configuration-file-io.js');
const { loadConfig: loadLogConfig } = require('../scripts/bos-code-update-log');
const query = { url: 'https://example.invalid/sse', headers: { 'X-Gateway-Upstream-BOS-MCP-TOKEN': randomBytes(24).toString('hex') }, cuser: 'fixture-user', cgroup: 'fixture-group' };
const log = { url: 'https://example.invalid/log', token: randomBytes(24).toString('hex'), linkProject: 'fixture-project' };
const sections = () => ({ 'bos-demand-query': query, 'bos-code-update-log': log });
const plugin = path.resolve(__dirname, '..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bos-config-'));
  const links = [];
  t.after(() => { for (const link of links) if (fs.existsSync(link)) fs.unlinkSync(link); fs.rmSync(root, { recursive: true, force: true }); });
  let saved = {};
  const env = { LOCALAPPDATA: root };
  return { root, links, env, options: { env, platform: 'win32', binding: values => { if (values) saved = { ...saved, ...values }; return { ...saved }; } } };
}
test('only the selected skill section is read; invalid explicit config never falls back', t => {
  const f = fixture(t), file = path.join(f.root, 'private.json');
  const env = { BOS_MCP_CONFIG: file, BOS_MCP_URL: 'ignored', BOS_MCP_TOKEN: 'ignored' };
  fs.writeFileSync(file, JSON.stringify({ ...sections(), 'bos-code-update-log': null }));
  assert.equal(loadConfig(env).cuser, 'fixture-user');
  for (const value of [{ ...sections(), 'bos-demand-query': null }, { 'bos-demand-query': { ...query, enabled: false } }, []]) {
    fs.writeFileSync(file, JSON.stringify(value)); assert.throws(() => loadConfig(env));
  }
  fs.writeFileSync(file, '{private-value-not-for-errors');
  assert.throws(() => loadConfig(env), e => /JSON/.test(e.message) && !e.message.includes('private-value'));
  for (const file of ['', 'relative.json']) assert.throws(() => loadConfig({ BOS_MCP_CONFIG: file }), /绝对路径/);
  assert.throws(() => loadConfig({ BOS_MCP_URL: query.url, BOS_MCP_TOKEN: 'synthetic-token' }), /BOS_MCP_CONFIG/);
});
test('flat, wrapped and identity-only files are rejected at runtime', t => {
  const f = fixture(t), file = path.join(f.root, 'private.json');
  for (const value of [query, { mcpServers: { 'bos-demand-query': query } }, { cuser: 'user', cgroup: 'group' }]) {
    fs.writeFileSync(file, JSON.stringify(value));
    assert.throws(() => loadConfig({ BOS_MCP_CONFIG: file }), /migrate-config/);
  }
});
test('source, deployed copy and Junction resolve one shared config in fresh processes', t => {
  const f = fixture(t), copy = path.join(f.root, 'deployed'), link = path.join(f.root, 'linked-plugin');
  fs.cpSync(plugin, copy, { recursive: true });
  fs.symlinkSync(copy, link, process.platform === 'win32' ? 'junction' : 'dir'); f.links.push(link);
  const file = path.join(f.root, 'private.json'); fs.writeFileSync(file, JSON.stringify(sections()));
  const clean = { ...process.env }; for (const key of Object.keys(clean)) if (key.startsWith('BOS_')) delete clean[key];
  const annotated = '\uFEFF// Shared private configuration\r\n' + JSON.stringify(sections(), null, 2).replace(/\n/g, '\r\n') + '\r\n';
  for (const entry of [plugin, copy, link]) {
    const script = path.join(entry, 'scripts/bos-demand-query.js');
    const run = env => spawnSync(process.execPath, [script, 'defaults'], { cwd: f.root, env: { ...clean, ...env }, encoding: 'utf8' });
    for (const raw of [JSON.stringify(sections()), annotated]) {
      fs.writeFileSync(file, raw);
      const result = run({ BOS_MCP_CONFIG: file }); assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { cuser: 'fixture-user', cgroup: 'fixture-group' });
    }
    const override = run({ BOS_MCP_CONFIG: file, BOS_CUSER: 'env-user', BOS_CGROUP: 'env-group' });
    assert.deepEqual(JSON.parse(override.stdout), { cuser: 'env-user', cgroup: 'env-group' });
    const absent = run({}); assert.equal(absent.status, 1);
    assert.doesNotMatch(absent.stdout + absent.stderr, /synthetic-query-token|fixture-user|example.invalid/);
    assert.ok(!(absent.stdout + absent.stderr).includes(query.headers['X-Gateway-Upstream-BOS-MCP-TOKEN']));
  }
});
test('TODO identities stop lists but do not block detail; explicit empty group is deliberate', () => {
  for (const value of ['TODO', ' todo ']) {
    assert.throws(() => queryArguments({ mode: 'pending' }, value, 'group'), /尚未配置/);
    assert.throws(() => queryArguments({ mode: 'history' }, 'user', value), /尚未配置/);
    assert.equal(queryArguments({ id: '12345' }, value, value).id, '12345');
  }
  assert.throws(() => queryArguments({ mode: 'pending' }, 'user', ''), /所在组/);
  assert.equal(queryArguments({ mode: 'pending', cgroup: '' }, 'user', 'TODO').cgroup, '');
});
test('initialization creates both TODO sections and binds only the shared config path', t => {
  const f = fixture(t), result = initConfig(undefined, f.options);
  assert.equal(result.configPath, path.join(f.root, 'imedical-agents/bos/config.json'));
  assert.equal(f.env.BOS_MCP_CONFIG, result.configPath); assert.equal(f.env.BOS_MCP_URL, undefined);
  const value = JSON.parse(fs.readFileSync(result.configPath));
  assert.deepEqual(Object.keys(value), ['bos-demand-query', 'bos-code-update-log']);
  assert.equal(value['bos-demand-query'].access_key, 'TODO'); assert.equal(value['bos-code-update-log'].token, 'TODO');
  assert.throws(() => loadConfig(f.env), /TODO/);
  fs.writeFileSync(result.configPath, JSON.stringify(sections())); const before = fs.readFileSync(result.configPath);
  assert.equal(initConfig(undefined, f.options).created, false); assert.deepEqual(fs.readFileSync(result.configPath), before);
  assert.equal(initConfig(undefined, f.options).fill.length, 0);
});
test('missing sections are added while credentials and unrelated sections remain unchanged', t => {
  const f = fixture(t), file = path.join(f.root, 'chosen.json');
  fs.writeFileSync(file, JSON.stringify({ 'bos-demand-query': query, other: { enabled: false } }));
  const result = initConfig(file, f.options), value = JSON.parse(fs.readFileSync(file));
  assert.equal(result.updated, true); assert.deepEqual(value['bos-demand-query'], query);
  assert.deepEqual(value.other, { enabled: false }); assert.equal(value['bos-code-update-log'].token, 'TODO');
});
test('initialization inserts only the missing section in an existing BOM and CRLF JSONC file', t => {
  const f = fixture(t), file = path.join(f.root, 'existing.json');
  const existing = `  // Query settings\r\n  "bos-demand-query": ${JSON.stringify(query)}, // Keep this note\r\n  "other": {"enabled":false}`;
  fs.writeFileSync(file, '\uFEFF// Personal file\r\n{\r\n' + existing + '\r\n}\r\n');
  const result = initConfig(file, f.options);
  assert.equal(result.configPath, file);
  assert.equal(result.updated, true);
  const saved = fs.readFileSync(file, 'utf8');
  assert.ok(saved.startsWith('\uFEFF// Personal file\r\n'));
  assert.ok(saved.includes(existing));
  assert.doesNotMatch(saved, /(?<!\r)\n/);
  assert.deepEqual(personal.readSkillConfig(f.env, 'bos-demand-query'), query);
  assert.equal(personal.readSkillConfig(f.env, 'bos-code-update-log').token, 'TODO');
  assert.equal(initConfig(file, f.options).updated, false);
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
});
test('setup guidance explains each pending field without returning private values', t => {
  const f = fixture(t), result = initConfig(undefined, f.options);
  assert.equal(result.guidance.fields.length, 6);
  assert.deepEqual(result.guidance.fields.map(item => item.field), result.fill);
  const sources = Object.fromEntries(result.guidance.fields.map(item => [item.field, item.source]));
  assert.match(sources['bos-demand-query.access_key'], /统一 access_key.*无需个人申请.*框架维护者/);
  assert.match(sources['bos-demand-query.cuser'], /完整账号／工号/);
  assert.match(sources['bos-demand-query.headers.X-Gateway-Upstream-BOS-MCP-TOKEN'], /接口访问凭证申请/);
  assert.match(sources['bos-code-update-log.token'], /代码更新日志接口.*我的 Key.*待核实/);
  assert.match(result.guidance.notes.join('\n'), /30000ms/);
  fs.writeFileSync(result.configPath, JSON.stringify({ 'bos-demand-query': query }));
  const again = initConfig(undefined, f.options);
  assert.deepEqual(again.fill, ['bos-code-update-log.token', 'bos-code-update-log.linkProject']);
  assert.equal(loadConfig(f.env).headers['X-Gateway-Upstream-BOS-MCP-TOKEN'], query.headers['X-Gateway-Upstream-BOS-MCP-TOKEN']);
  assert.ok(!JSON.stringify(again).includes(query.headers['X-Gateway-Upstream-BOS-MCP-TOKEN']));
  assert.ok(!JSON.stringify(again).includes(query.cuser));
  fs.writeFileSync(result.configPath, JSON.stringify(sections()));
  const before = fs.readFileSync(result.configPath);
  assert.deepEqual(initConfig(undefined, f.options).guidance.fields, []);
  assert.deepEqual(fs.readFileSync(result.configPath), before);
});
test('missing credentials explain acquisition and each skill works independently', t => {
  const f = fixture(t), result = initConfig(undefined, f.options);
  assert.throws(() => loadConfig(f.env), /access_key.*统一 access_key.*框架维护者/);
  const value = JSON.parse(fs.readFileSync(result.configPath));
  value['bos-demand-query'].access_key = 'synthetic-access';
  fs.writeFileSync(result.configPath, JSON.stringify(value));
  assert.throws(() => loadConfig(f.env), error => /接口访问凭证申请/.test(error.message) && !error.message.includes('synthetic-access'));
  assert.throws(() => loadLogConfig(f.env), /代码更新日志接口.*待核实/);
  value['bos-code-update-log'].token = log.token;
  fs.writeFileSync(result.configPath, JSON.stringify(value));
  assert.throws(() => loadLogConfig(f.env), error => /实际关联的研发项目/.test(error.message) && !error.message.includes(log.token));
  value['bos-code-update-log'] = log;
  fs.writeFileSync(result.configPath, JSON.stringify(value));
  assert.equal(loadLogConfig(f.env).token, log.token);
  assert.throws(() => loadConfig(f.env), /接口访问凭证申请/);
});
test('custom URLs and explicit config paths survive; old connection variables have no effect', t => {
  const f = fixture(t), file = path.join(f.root, 'chosen.json'); fs.writeFileSync(file, JSON.stringify(sections()));
  f.env.BOS_MCP_URL = 'https://ignored.invalid/sse'; f.env.BOS_MCP_TOKEN = 'ignored';
  initConfig(file, f.options); assert.equal(loadConfig(f.env).url, query.url);
  assert.equal(initConfig(undefined, f.options).configPath, file); assert.equal(f.env.BOS_MANAGED_MCP_URL, undefined);
});
test('explicit in-place migration preserves all query values and adds only log placeholders', t => {
  const f = fixture(t), file = path.join(f.root, 'old.json');
  const old = { connection: 'company', access_key: 'synthetic-access', headers: query.headers, cuser: 'user', cgroup: 'group' };
  fs.writeFileSync(file, JSON.stringify(old)); const before = fs.readFileSync(file);
  assert.throws(() => initConfig(file, f.options), /migrate-config/); assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(personal.migrate(file, f.options).migrated, true);
  const value = JSON.parse(fs.readFileSync(file)); assert.deepEqual(value['bos-demand-query'], old);
  assert.equal(value['bos-code-update-log'].token, 'TODO');
  assert.equal(new URL(loadConfig({ BOS_MCP_CONFIG: file }).url).searchParams.get('access_key'), 'synthetic-access');
  const after = fs.readFileSync(file); assert.equal(personal.migrate(file, f.options).migrated, false);
  assert.deepEqual(fs.readFileSync(file), after); assert.deepEqual(fs.readdirSync(f.root), ['old.json']);
});
test('explicit migration wraps the original flat JSONC object without dropping comments or changing its path', t => {
  const f = fixture(t), file = path.join(f.root, 'old.json');
  const flat = '{\r\n  // Query account\r\n' + JSON.stringify(query, null, 2).replace(/^\{\n/, '').replace(/\n/g, '\r\n');
  const source = '\uFEFF/* Personal configuration */\r\n' + flat + ' // Existing footer\r\n';
  fs.writeFileSync(file, source);
  assert.throws(() => initConfig(file, f.options), /migrate-config/);
  assert.throws(() => personal.migrate(file, {...f.options,strictJson:true}), /按 skill 分段/);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  assert.equal(personal.migrate(file, f.options).configPath, file);
  const saved = fs.readFileSync(file, 'utf8');
  assert.ok(saved.startsWith('\uFEFF/* Personal configuration */\r\n'));
  assert.ok(saved.includes(flat));
  assert.ok(saved.endsWith(' // Existing footer\r\n'));
  assert.doesNotMatch(saved, /(?<!\r)\n/);
  assert.deepEqual(personal.readSkillConfig({BOS_MCP_CONFIG:file}, 'bos-demand-query'), query);
  assert.equal(personal.readSkillConfig({BOS_MCP_CONFIG:file}, 'bos-code-update-log').token, 'TODO');
  assert.equal(personal.migrate(file, f.options).migrated, false);
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
});
test('the explicit strict JSON fallback preserves section scope and old strict bytes', t => {
  const f = fixture(t), file = path.join(f.root, 'existing.json');
  const accessRules = protect => {
    const script = [
      "$ErrorActionPreference='Stop'",
      '$target=$env:BOS_TEST_PRIVATE_FILE',
      '$acl=[IO.File]::GetAccessControl($target)',
      ...(protect ? ['$acl.SetAccessRuleProtection($true,$true)', '[IO.File]::SetAccessControl($target,$acl)'] : []),
      '[IO.File]::GetAccessControl($target).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)',
    ].join('\n');
    const result = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], {
      env:{...process.env,BOS_TEST_PRIVATE_FILE:file}, encoding:'utf8', windowsHide:true,
    });
    assert.equal(result.status, 0, result.stderr);
    const descriptor = result.stdout.trim();
    const firstRule = descriptor.indexOf('(');
    assert.ok(firstRule > 0);
    return descriptor.slice(0, firstRule) + descriptor.slice(firstRule).split(')').sort().join(')');
  };
  const value = {'bos-code-update-log':log, other:{ marker:'keep // text' }};
  const json = JSON.stringify(value, null, 2).replace(/\n/g, '\r\n') + '\r\n';
  const strictRead = raw => JSON.parse(raw.replace(/^\uFEFF/, ''));
  const options = {...f.options,strictJson:true};
  fs.writeFileSync(file, '\uFEFF' + json);
  const original = fs.readFileSync(file);
  assert.equal(personal.migrate(file, options).migrated, false);
  assert.deepEqual(fs.readFileSync(file), original);
  const annotated = '\uFEFF// Comment for new readers\r\n' + json;
  fs.writeFileSync(file, annotated);
  const expectedAcl = process.platform === 'win32' ? accessRules(true) : null;
  assert.throws(() => strictRead(annotated), SyntaxError);
  assert.equal(loadLogConfig({BOS_MCP_CONFIG:file}).token, log.token);
  const copyAccess = configIO.copyFileAccess;
  t.mock.method(configIO, 'copyFileAccess', (source, temporary) => {
    assert.equal(fs.statSync(temporary).size, 0, 'protect the temporary file before writing private values');
    return copyAccess(source, temporary);
  });
  assert.equal(personal.migrate(file, options).migrated, true);
  if (expectedAcl) assert.ok(accessRules(false) === expectedAcl, 'expected the original Windows access rules');
  const saved = fs.readFileSync(file, 'utf8');
  assert.deepEqual(strictRead(saved), value);
  assert.ok(saved.startsWith('\uFEFF'));
  assert.doesNotMatch(saved, /Comment for new readers|(?<!\r)\n/);
  assert.equal(personal.migrate(file, options).migrated, false);
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
  assert.deepEqual(fs.readdirSync(f.root), ['existing.json']);
});
test('the migration CLI accepts only the explicit strict fallback form and an absolute private path', {skip:process.platform!=='win32'}, t => {
  const f = fixture(t), file = path.join(f.root, 'private.json');
  const script = path.join(plugin, 'scripts/bos-demand-query.js');
  const run = args => spawnSync(process.execPath, [script, ...args], {cwd:f.root, encoding:'utf8', windowsHide:true});
  const content = '// Fixture\n' + JSON.stringify(sections());
  fs.writeFileSync(file, content);
  for (const args of [['--strict-json'], ['--strict-json', file, '--unexpected'], [file, '--strict-json'], ['--strict-json', 'private.json']]) {
    const result = run(['migrate-config', ...args]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /原私有文件绝对路径/);
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
  const result = run(['migrate-config', '--strict-json', file]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).configPath, file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), sections());
});
test('migration refuses unrecognized wrappers without overwriting private data', t => {
  const f = fixture(t), file = path.join(f.root, 'private.json');
  for (const value of [{ mcpServers: { sample: query } }, { cuser: 'user' }, { ...query, unexpected: true }]) {
    fs.writeFileSync(file, '// preserve\r\n' + JSON.stringify(value)); const before = fs.readFileSync(file);
    assert.throws(() => personal.migrate(file, f.options), /人工核对/); assert.deepEqual(fs.readFileSync(file), before);
  }
});
test('failed atomic replacement preserves original and removes its private temporary file', t => {
  const f = fixture(t), file = path.join(f.root, 'old.json'); fs.writeFileSync(file, JSON.stringify(query));
  const before = fs.readFileSync(file); t.mock.method(fs, 'renameSync', () => { throw Error('rename blocked'); });
  assert.throws(() => personal.migrate(file, f.options), /rename blocked/);
  assert.deepEqual(fs.readFileSync(file), before); assert.deepEqual(fs.readdirSync(f.root), ['old.json']);
});
test('migration stops on concurrent modification and preserves the concurrent writer', t => {
  const f = fixture(t), file = path.join(f.root, 'old.json'); fs.writeFileSync(file, JSON.stringify(query));
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (target, ...args) => { write(target, ...args); if (target !== file) write(file, 'concurrent change'); });
  assert.throws(() => personal.migrate(file, f.options), /并发修改/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'concurrent change'); assert.deepEqual(fs.readdirSync(f.root), ['old.json']);
});
test('initialization and migration reject repository paths and unsupported platforms', t => {
  const f = fixture(t), repo = path.join(f.root, 'repo'); fs.mkdirSync(repo); fs.mkdirSync(path.join(repo, '.git'));
  assert.throws(() => initConfig(path.join(repo, 'nested/config.json'), f.options), /Git/);
  const file = path.join(repo, 'existing.json'); fs.writeFileSync(file, JSON.stringify(sections()));
  assert.throws(() => initConfig(file, f.options), /Git/);
  const alias = path.join(f.root, 'linked-repo'); fs.symlinkSync(repo, alias, process.platform === 'win32' ? 'junction' : 'dir'); f.links.push(alias);
  assert.throws(() => initConfig(path.join(alias, 'config.json'), f.options), /Git/);
  assert.throws(() => initConfig(undefined, { ...f.options, platform: 'linux' }), /仅支持 Windows/);
  assert.throws(() => personal.migrate(file, { platform: 'darwin' }), /仅支持 Windows/);
});
test('existing private file links are rejected before replacement', t => {
  const f = fixture(t), file = path.join(f.root, 'private.json'); fs.writeFileSync(file, JSON.stringify(query));
  const stat = fs.lstatSync; t.mock.method(fs, 'lstatSync', target => target === file ? { isSymbolicLink: () => true } : stat(target));
  assert.throws(() => personal.migrate(file, f.options), /链接/);
  assert.throws(() => initConfig(file, f.options), /链接/);
});
test('binding failures retain generated config and invalid JSON never leaks raw contents', t => {
  const f = fixture(t), file = path.join(f.root, 'private.json');
  assert.throws(() => initConfig(file, { ...f.options, binding: values => { if (values) throw Error('binding blocked'); return {}; } }), /blocked/);
  assert.ok(fs.existsSync(file)); fs.writeFileSync(file, '{private-value-not-for-errors');
  assert.throws(() => initConfig(file, f.options), e => /JSON/.test(e.message) && !e.message.includes('private-value'));
});
test('package isolation guard stops new and redirected paths before writing or binding', t => {
  const f = fixture(t); let bindings = 0;
  const options = { ...f.options, binding: values => { if (values) bindings++; return {}; } };
  const isolated = path.join(f.root, 'AppData/Local/Packages/sandbox.fixture/AC');
  assert.throws(() => initConfig(undefined, { ...options, env: { LOCALAPPDATA: isolated } }), /隔离目录/);
  assert.equal(fs.existsSync(isolated), false);
  const file = path.join(f.root, 'existing.json'); fs.writeFileSync(file, JSON.stringify(query)); const before = fs.readFileSync(file);
  t.mock.method(fs.realpathSync, 'native', () => path.join(f.root, 'AppData/Local/Packages/fixture/LocalCache/Local'));
  assert.throws(() => initConfig(file, options), /重定向/); assert.throws(() => personal.migrate(file, options), /重定向/);
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(bindings, 0);
});
test('normal directory Junctions remain supported for private initialization', t => {
  const f = fixture(t), real = path.join(f.root, 'physical'), link = path.join(f.root, 'alias'); fs.mkdirSync(real);
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir'); f.links.push(link);
  const result = initConfig(path.join(link, 'config.json'), f.options);
  assert.equal(result.created, true); assert.ok(fs.existsSync(path.join(real, 'config.json')));
  const before = fs.readFileSync(result.configPath); initConfig(undefined, f.options); assert.deepEqual(fs.readFileSync(result.configPath), before);
});
test('a newly created temporary file redirected by MSIX stops before replacing the host config', t => {
  const f = fixture(t), file = path.join(f.root, 'old.json'); fs.writeFileSync(file, JSON.stringify(query));
  const before = fs.readFileSync(file), realpath = fs.realpathSync.native;
  t.mock.method(fs.realpathSync, 'native', target => path.basename(target).endsWith('.tmp')
    ? path.join(f.root, 'AppData/Local/Packages/fixture/LocalCache/Local/redirected.tmp') : realpath(target));
  assert.throws(() => personal.migrate(file, f.options), /重定向/);
  assert.deepEqual(fs.readFileSync(file), before); assert.deepEqual(fs.readdirSync(f.root), ['old.json']);
});
