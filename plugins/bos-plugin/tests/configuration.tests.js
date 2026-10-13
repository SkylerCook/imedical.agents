'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../scripts/bos-demand-query');
const config = { url: 'https://example.invalid/sse', headers: { 'X-Gateway-Upstream-BOS-MCP-TOKEN': 'synthetic-token' }, cuser: 'fixture-user', cgroup: 'fixture-group' };
const plugin = path.resolve(__dirname, '..');

test('explicit config wins; invalid, empty or disabled config never falls back', t => {
  const reads = [];
  t.mock.method(fs, 'readFileSync', p => { reads.push(p); return JSON.stringify(config); });
  assert.equal(loadConfig({ BOS_MCP_CONFIG: 'selected-private-file', BOS_MCP_URL: 'ignored' }).cuser, 'fixture-user');
  assert.deepEqual(reads, ['selected-private-file']);
  assert.throws(() => loadConfig({}), /缺少 BOS 配置/);
  assert.throws(() => loadConfig({ BOS_MCP_CONFIG: '', BOS_MCP_URL: config.url, BOS_MCP_TOKEN: 'synthetic-token' }), /BOS_MCP_CONFIG/);
  assert.deepEqual(reads, ['selected-private-file']);
  fs.readFileSync.mock.mockImplementation(() => JSON.stringify({ ...config, enabled: false }));
  assert.throws(() => loadConfig({ BOS_MCP_CONFIG: 'disabled' }), /禁用/);
  fs.readFileSync.mock.mockImplementation(() => '{broken');
  assert.throws(() => loadConfig({ BOS_MCP_CONFIG: 'broken', BOS_MCP_URL: config.url, BOS_MCP_TOKEN: 'synthetic-token' }), /无法读取/);
});

test('source, deployed copy and directory link share explicit config in fresh CLI processes', t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bos-config-'));
  const link = path.join(root, 'linked-plugin');
  t.after(() => { if (fs.existsSync(link)) fs.unlinkSync(link); fs.rmSync(root, { recursive: true, force: true }); });
  const copy = path.join(root, 'deployed');
  fs.cpSync(plugin, copy, { recursive: true });
  fs.symlinkSync(copy, link, process.platform === 'win32' ? 'junction' : 'dir');
  const privateFile = path.join(root, 'private.json');
  fs.writeFileSync(privateFile, JSON.stringify(config));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('BOS_')) delete env[key];
  for (const entry of [plugin, copy, link]) {
    const script = path.join(entry, 'scripts/bos-demand-query.js');
    const result = spawnSync(process.execPath, [script, 'defaults'], { cwd: root, env: { ...env, BOS_MCP_CONFIG: privateFile }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { cuser: 'fixture-user', cgroup: 'fixture-group' });
    const override = spawnSync(process.execPath, [script, 'defaults'], { env: { ...env, BOS_MCP_CONFIG: privateFile, BOS_CUSER: 'env-user', BOS_CGROUP: 'env-group' }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(override.stdout), { cuser: 'env-user', cgroup: 'env-group' });
    const noConfig = spawnSync(process.execPath, [script, 'defaults'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(noConfig.status, 1);
    assert.doesNotMatch(noConfig.stdout + noConfig.stderr, /synthetic-token|fixture-user|example.invalid/);
  }
});


test('identity template uses environment connection; partial legacy files cannot mix sources', t => {
  let file = { cuser: 'TODO', cgroup: 'TODO' };
  t.mock.method(fs, 'readFileSync', () => JSON.stringify(file));
  const env = { BOS_MCP_CONFIG: 'identity', BOS_MCP_URL: config.url, BOS_MCP_TOKEN: 'synthetic-token' };
  assert.equal(loadConfig(env).cuser, 'TODO');
  assert.throws(() => loadConfig({ BOS_MCP_CONFIG: 'identity' }), /BOS_MCP_URL/);
  for (const invalid of [{ ...file, url: '' }, { ...file, headers: {} }, { ...file, typo: true }, { ...file, enabled: false }, []]) {
    file = invalid;
    assert.throws(() => loadConfig(env));
  }
});

test('TODO identities stop lists but do not block detail; explicit empty group remains deliberate', () => {
  const { queryArguments } = require('../scripts/bos-demand-query');
  for (const value of ['TODO', ' todo ']) {
    assert.throws(() => queryArguments({ mode: 'pending' }, value, 'group'), /尚未配置/);
    assert.throws(() => queryArguments({ mode: 'history' }, 'user', value), /尚未配置/);
    assert.equal(queryArguments({ id: '12345' }, value, value).id, '12345');
  }
  assert.throws(() => queryArguments({ mode: 'pending' }, 'user', ''), /所在组/);
  assert.equal(queryArguments({ mode: 'pending', cgroup: '' }, 'user', 'TODO').cgroup, '');
});


function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bos-init-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let saved = {};
  const env = { LOCALAPPDATA: root };
  return { root, env, options: { env, platform: 'win32', binding: values => { if (values) saved = { ...saved, ...values }; return { ...saved }; } } };
}
test('Windows default initialization binds path and only creates TODO fields; repeat preserves credentials', t => {
  const f = fixture(t), { initConfig } = require('../scripts/bos-demand-query');
  const result = initConfig(undefined, f.options);
  assert.equal(result.configPath, path.join(f.root, 'imedical-agents/bos/config.json'));
  assert.equal(f.env.BOS_MCP_CONFIG, result.configPath);
  const data = JSON.parse(fs.readFileSync(result.configPath));
  assert.equal(data.access_key, 'TODO'); assert.equal(data.headers['X-Gateway-Upstream-BOS-MCP-TOKEN'], 'TODO');
  assert.throws(() => loadConfig(f.env), /TODO/);
  data.access_key = 'fixture-access'; data.headers['X-Gateway-Upstream-BOS-MCP-TOKEN'] = 'fixture-token'; data.cuser = 'user'; data.cgroup = 'group';
  fs.writeFileSync(result.configPath, JSON.stringify(data));
  const before = fs.readFileSync(result.configPath);
  assert.equal(initConfig(undefined, f.options).created, false);
  assert.deepEqual(fs.readFileSync(result.configPath), before);
  assert.equal(new URL(loadConfig(f.env).url).searchParams.get('access_key'), 'fixture-access');
});
test('managed company URL refreshes while custom override and explicit config path survive', t => {
  const f = fixture(t), { initConfig } = require('../scripts/bos-demand-query');
  f.env.BOS_MCP_URL = f.env.BOS_MANAGED_MCP_URL = 'https://old.invalid/sse';
  const target = path.join(f.root, 'chosen/config.json');
  initConfig(target, f.options);
  assert.notEqual(f.env.BOS_MCP_URL, 'https://old.invalid/sse');
  f.env.BOS_MCP_URL = 'https://custom.invalid/sse';
  initConfig(undefined, f.options);
  assert.equal(f.env.BOS_MCP_URL, 'https://custom.invalid/sse');
  assert.equal(f.env.BOS_MCP_CONFIG, target);
});
test('migration preserves original and runtime connection, refusing existing targets', t => {
  const f = fixture(t), { initConfig } = require('../scripts/bos-demand-query');
  const { companyUrl } = require('../scripts/personal-config');
  const old = path.join(f.root, 'old.json');
  const value = { ...config, url: companyUrl() + '?access_key=fixture-access' };
  fs.writeFileSync(old, JSON.stringify(value));
  const bytes = fs.readFileSync(old);
  const result = initConfig(undefined, { ...f.options, migrateFrom: old });
  assert.deepEqual(fs.readFileSync(old), bytes);
  assert.equal(loadConfig(f.env).url, value.url);
  assert.equal(loadConfig(f.env).headers['X-Gateway-Upstream-BOS-MCP-TOKEN'], 'synthetic-token');
  assert.throws(() => initConfig(undefined, { ...f.options, migrateFrom: old }), /已存在/);
  assert.equal(result.migrated, true);
});
test('initialization refuses repository paths, file links and unsupported platforms', t => {
  const f = fixture(t), { initConfig } = require('../scripts/bos-demand-query');
  const repo = path.join(f.root, 'repo'); fs.mkdirSync(repo); fs.mkdirSync(path.join(repo, '.git'));
  assert.throws(() => initConfig(path.join(repo, 'nested/config.json'), f.options), /Git/);
  const link = path.join(f.root, 'linked');fs.symlinkSync(repo, link, process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.throws(() => initConfig(path.join(link, 'config.json'), f.options), /Git/); } finally { fs.unlinkSync(link); }
  assert.throws(() => initConfig(undefined, { ...f.options, platform: 'linux' }), /仅支持 Windows/);
});

test('binding failures retain generated file and corrupt private JSON never leaks raw content', t => {
  const f = fixture(t), { initConfig } = require('../scripts/bos-demand-query');
  const target = path.join(f.root, 'config.json');
  assert.throws(() => initConfig(target, { ...f.options, binding: values => { if(values) throw new Error('binding blocked');return {}; } }), /blocked/);
  assert.ok(fs.existsSync(target));
  fs.writeFileSync(target, '{private-value-not-for-errors');
  assert.throws(() => initConfig(target, f.options), error => !error.message.includes('private-value') && /JSON/.test(error.message));
});


test('package isolation guard refuses sandbox defaults and redirected new or existing configs before writes', t => {
  const f = fixture(t), { initConfig } = require('../scripts/bos-demand-query');
  let writes = 0;
  const options = { ...f.options, binding: values => { if (values) writes++; return {}; } };
  const isolated = path.join(f.root, 'AppData/Local/Packages/sandbox.fixture/AC');
  assert.throws(() => initConfig(undefined, { ...options, env: { LOCALAPPDATA: isolated } }), /隔离目录/);
  assert.equal(fs.existsSync(isolated), false);
  const existing = path.join(f.root, 'existing.json');
  fs.writeFileSync(existing, JSON.stringify({ connection: 'company' }));
  const before = fs.readFileSync(existing);
  t.mock.method(fs.realpathSync, 'native', () => path.join(f.root, 'AppData/Local/Packages/fixture/LocalCache/Local'));
  const target = path.join(f.root, 'new/config.json');
  assert.throws(() => initConfig(target, options), /重定向/);
  assert.equal(fs.existsSync(path.dirname(target)), false);
  assert.throws(() => initConfig(existing, options), /重定向/);
  assert.deepEqual(fs.readFileSync(existing), before);
  assert.equal(writes, 0);
});

test('package isolation guard preserves normal custom directory Junction initialization', t => {
  const f = fixture(t), { initConfig } = require('../scripts/bos-demand-query');
  const real = path.join(f.root, 'physical'), link = path.join(f.root, 'alias');
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const result = initConfig(path.join(link, 'config.json'), f.options);
    assert.equal(result.created, true);
    assert.equal(fs.existsSync(path.join(real, 'config.json')), true);
    const before = fs.readFileSync(path.join(real, 'config.json'));
    assert.equal(initConfig(undefined, f.options).created, false);
    assert.deepEqual(fs.readFileSync(path.join(real, 'config.json')), before);
  } finally { fs.unlinkSync(link); }
});
