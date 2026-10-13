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
