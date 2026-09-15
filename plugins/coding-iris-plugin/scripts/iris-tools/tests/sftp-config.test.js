'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {buildSftp, migrate} = require('../sftp-config');
const capability = path.resolve(__dirname, '../../../../..');

function fixture(t, runtime) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-config-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const context = path.join(root, '.agents');
  fs.mkdirSync(path.join(context, 'config'), {recursive: true});
  const config = {sftp: {enabled: true, runtime, serverName: 'sftp-server'}};
  fs.writeFileSync(path.join(context, 'config/project-env.json'), JSON.stringify(config));
  const mcp = {mcpServers: {'sftp-server': {command: 'custom-python', args: ['/legacy/sftp-server/src/main.py'],
    disabled: true, env: {TARGET_PASSWORD: 'test-only', OTHER: 'retained'}}, other: {command: 'unchanged'}}};
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify(mcp));
  return {root, context, mcp};
}

test('opt-in migration preserves connection fields and is idempotent', t => {
  const f = fixture(t, 'vendor');
  const target = path.join(f.root, '.mcp.json');
  const before = fs.readFileSync(target);
  assert.equal(migrate(f.root, f.context, capability)[0].status, 'config-migration-planned');
  assert.deepEqual(fs.readFileSync(target), before);
  assert.equal(migrate(f.root, f.context, capability, 'Write')[0].status, 'config-migration-applied');
  const actual = JSON.parse(fs.readFileSync(target));
  f.mcp.mcpServers['sftp-server'].args = [path.join(capability, 'vendor/sftp-server/src/main.py')];
  assert.deepEqual(actual, f.mcp);
  const once = fs.readFileSync(target);
  assert.equal(migrate(f.root, f.context, capability, 'Write')[0].status, 'config-migration-unchanged');
  assert.deepEqual(fs.readFileSync(target), once);
});

test('legacy runtime and absent config stay unchanged', t => {
  const f = fixture(t);
  const target = path.join(f.root, '.mcp.json');
  const before = fs.readFileSync(target);
  assert.equal(migrate(f.root, f.context, capability, 'Write')[0].status, 'config-migration-unchanged');
  assert.deepEqual(fs.readFileSync(target), before);
  fs.unlinkSync(path.join(f.context, 'config/project-env.json'));
  assert.equal(migrate(f.root, f.context, capability, 'Write')[0].status, 'config-migration-unchanged');
});

test('custom arguments are not overwritten', t => {
  const f = fixture(t, 'vendor');
  f.mcp.mcpServers['sftp-server'].args.push('--custom');
  fs.writeFileSync(path.join(f.root, '.mcp.json'), JSON.stringify(f.mcp));
  assert.equal(migrate(f.root, f.context, capability, 'Write')[0].status, 'config-migration-review-required');
});

test('new config uses capability vendor and supports key auth without enabling commands', () => {
  const result = buildSftp({runtime: 'vendor', keyFile: 'key', knownHosts: 'hosts'}, capability);
  assert.deepEqual(result.args, [path.join(capability, 'vendor/sftp-server/src/main.py')]);
  assert.equal(result.env.TARGET_KEY_FILE, 'key');
  assert.equal(result.env.ALLOW_REMOTE_COMMANDS, 'false');
  assert.deepEqual(buildSftp({args: ['custom.py']}, capability).args, ['custom.py']);
});

test('installer and updater distribute vendor, manifest wires the migration', () => {
  for (const script of ['install-agents.ps1', 'update-agents.ps1']) {
    assert.ok(fs.readFileSync(path.join(capability, 'scripts', script), 'utf8').includes('"/vendor/**"'));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(capability, 'plugins/coding-iris-plugin/.agents-plugin/plugin.json')));
  assert.ok(manifest.configMigrations.some(m => m.id === 'sftp-vendor-v1' && m.script === 'scripts/migrate-sftp-vendor.ps1'));
});

test('PowerShell 5.1 and 7 migration wrappers perform DryRun then Write', {skip: process.platform !== 'win32'}, t => {
  const {spawnSync} = require('node:child_process');
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    const f = fixture(t, 'vendor');
    const script = path.join(f.context, 'vendor/sftp-server/src/main.py');
    fs.mkdirSync(path.dirname(script), {recursive: true});
    fs.writeFileSync(script, '# fixture');
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(capability, 'plugins/coding-iris-plugin/scripts/migrate-sftp-vendor.ps1'),
      '-ProjectRoot', f.root, '-AgentsRoot', f.context];
    for (const [mode, expected] of [['DryRun', 'planned'], ['Write', 'applied'], ['Write', 'unchanged']]) {
      const output = spawnSync(shell, [...args, '-Mode', mode], {encoding: 'utf8', windowsHide: true});
      assert.equal(output.status, 0, output.stderr);
      assert.equal(JSON.parse(output.stdout)[0].status, `config-migration-${expected}`);
    }
  }
});

test('malformed and missing vendor configuration never changes MCP', t => {
  const f = fixture(t, 'vendor');
  const target = path.join(f.root, '.mcp.json');
  const before = fs.readFileSync(target);
  assert.throws(() => migrate(f.root, f.context, path.join(f.root, 'missing'), 'Write'));
  assert.deepEqual(fs.readFileSync(target), before);
  fs.writeFileSync(path.join(f.context, 'config/project-env.json'), '{invalid');
  assert.throws(() => migrate(f.root, f.context, capability, 'Write'));
  assert.deepEqual(fs.readFileSync(target), before);
});
