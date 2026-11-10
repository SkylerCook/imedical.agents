'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createTempDirectory, ownsTempDirectory} = require('./fixtures/temp-directory');
const editor = require('../../tools/ai-dev-offline/configure-vscode');
const jsonc = require('../../tools/ai-dev-offline/vendor/jsonc-parser/main');
const PROFILE = 'terminal.integrated.profiles.windows';
const DEFAULT = 'terminal.integrated.defaultProfile.windows';
const AUTO = 'terminal.integrated.automationProfile.windows';
function fixture(t, original) {
  const root = createTempDirectory('vscode-user-settings-');
  t.after(() => { assert.ok(ownsTempDirectory(root)); fs.rmSync(root, {recursive: true, force: true}); });
  const file = path.join(root, 'User', 'settings.json'), pwsh = path.join(root, 'Portable Tools', 'pwsh.exe');
  if (original !== undefined) { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, original); }
  return {root, file, pwsh, options: {file, pwsh}, apply: extra => editor.apply({file, pwsh, ...extra}, () => {})};
}
function parsed(file) { return jsonc.getNodeValue(editor.load(file).tree); }
test('JSONC edits preserve comments, URL strings, trailing commas and unrelated profile/settings', t => {
  const original = '{\r\n  // keep the hospital comment\r\n  "unrelated": "https://example.invalid/a//b",\r\n  "files.autoGuessEncoding": false,\r\n  "terminal.integrated.profiles.windows": {"Command Prompt": {"path": "cmd.exe"},},\r\n}\r\n';
  const f = fixture(t, original), result = f.apply();
  assert.equal(result.state, 'applied');
  assert.equal(result.sha256, editor.load(f.file).sha);
  const text = fs.readFileSync(f.file, 'utf8'), value = parsed(f.file);
  assert.ok(text.includes('// keep the hospital comment'));
  assert.ok(text.includes('https://example.invalid/a//b'));
  assert.ok(text.includes('\r\n'));
  assert.equal(value.unrelated, 'https://example.invalid/a//b');
  assert.equal(value['files.autoGuessEncoding'], false);
  assert.equal(value[PROFILE]['Command Prompt'].path, 'cmd.exe');
  assert.equal(value[PROFILE]['PowerShell 7'].path, f.pwsh);
  assert.equal(value[DEFAULT], 'PowerShell 7');
  assert.deepEqual(value[AUTO].args, ['-NoLogo', '-NoProfile']);
});
test('plan does not create target directories or backup files', t => {
  const f = fixture(t);
  const result = editor.main(['--action', 'plan', '--settings', f.file, '--pwsh', f.pwsh]);
  assert.equal(result.state, 'planned'); assert.equal(result.conflicts.length, 0);
  assert.equal(fs.existsSync(path.dirname(f.file)), false);
});
test('different selected keys require explicit replacement before backup/write', t => {
  const original = JSON.stringify({[DEFAULT]: 'Command Prompt', secretSetting: 'leave-this-private'});
  const f = fixture(t, original);
  assert.throws(() => f.apply(), /conflict-use-explicit-replace/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(path.dirname(f.file), '.ai-dev-settings-backups')), false);
});
test('replacement removes an ambiguous source selector but preserves extra profile fields', t => {
  const f = fixture(t, JSON.stringify({[PROFILE]: {'PowerShell 7': {source: 'PowerShell', args: ['-NoExit'], env: {KEEP: 'yes'}}}, [DEFAULT]: 'old'}));
  f.apply({replace: true}); const value = parsed(f.file)[PROFILE]['PowerShell 7'];
  assert.equal(value.source, undefined); assert.equal(value.path, f.pwsh);
  assert.deepEqual(value.args, ['-NoExit']); assert.equal(value.env.KEEP, 'yes');
});
test('idempotent reapply does not create more backups', t => {
  const f = fixture(t, '{}'); f.apply();
  const dir = path.join(path.dirname(f.file), '.ai-dev-settings-backups'), before = fs.readdirSync(dir);
  assert.equal(f.apply().state, 'unchanged'); assert.deepEqual(fs.readdirSync(dir), before);
});
test('backup and exact rollback preserve UTF8 BOM and original bytes', t => {
  const bytes = Buffer.concat([Buffer.from([239,187,191]), Buffer.from('{\r\n\t// 中文注释\r\n\t"untouched": true,\r\n}\r\n')]);
  const f = fixture(t, bytes), result = f.apply();
  assert.deepEqual(fs.readFileSync(f.file).subarray(0, 3), Buffer.from([239,187,191]));
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(result.receiptFile), 'settings.original')), bytes);
  editor.rollback(result.receiptFile); assert.deepEqual(fs.readFileSync(f.file), bytes);
});
test('rollback keeps later unrelated settings, profiles and comments', t => {
  const f = fixture(t, '{// original\n"before":1,}'), result = f.apply();
  let text = fs.readFileSync(f.file, 'utf8');
  text = editor.edit(text, [{path: ['later'], value: 42}, {path: [PROFILE, 'Other'], value: {path:'other.exe'}}]);
  text = text.replace('// original', '// original and later comment'); fs.writeFileSync(f.file, text);
  editor.rollback(result.receiptFile); const value = parsed(f.file);
  assert.equal(value.before, 1); assert.equal(value.later, 42);
  assert.equal(value[PROFILE].Other.path, 'other.exe'); assert.equal(value[PROFILE]['PowerShell 7'], undefined);
  assert.equal(value[AUTO], undefined); assert.equal(value[DEFAULT], undefined);
  assert.ok(fs.readFileSync(f.file, 'utf8').includes('// original and later comment'));
});
test('rollback refuses later changes to a managed terminal key', t => {
  const f = fixture(t, '{}'), result = f.apply();
  fs.writeFileSync(f.file, editor.edit(fs.readFileSync(f.file, 'utf8'), [{path:[DEFAULT], value:'Later'}]));
  const before = fs.readFileSync(f.file);
  assert.throws(() => editor.rollback(result.receiptFile), /managed-terminal-key-changed/);
  assert.deepEqual(fs.readFileSync(f.file), before);
});
test('expected preview hash protects concurrent changes before any backup/write', t => {
  const f = fixture(t, '{}'), sha = editor.load(f.file).sha;
  fs.writeFileSync(f.file, '{"later":true}');
  assert.throws(() => f.apply({expected:sha}), /changed-after-preview/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{"later":true}');
});
test('empty comment-only settings are initialized while keeping comments', t => {
  const f = fixture(t, '// user notes\n'); f.apply();
  assert.ok(fs.readFileSync(f.file, 'utf8').includes('// user notes'));
  assert.equal(parsed(f.file)[DEFAULT], 'PowerShell 7');
});
test('new settings file can be removed by exact rollback', t => {
  const f = fixture(t), result = f.apply(); assert.ok(fs.existsSync(f.file));
  editor.rollback(result.receiptFile); assert.equal(fs.existsSync(f.file), false);
});
test('invalid JSONC, duplicate keys, invalid root and incompatible parents fail closed', () => {
  for (const text of ['{"x":}', '{"x":1,"x":2}', '[]', '{"terminal.integrated.profiles.windows":null}']) {
    assert.throws(() => editor.plan(editor.document(Buffer.from(text)), path.resolve('pwsh.exe')), /invalid-settings-jsonc|duplicate-settings-key|root-must-be-object|parent-must-be-object/);
  }
});
test('invalid UTF8 is not silently rewritten', () => {
  assert.throws(() => editor.document(Buffer.from([255,254,0,65])), /settings-must-be-utf8/);
});
test('settings and private backups are not written inside a Git worktree', t => {
  const f = fixture(t, '{}'); fs.mkdirSync(path.join(f.root, '.git'));
  assert.throws(() => f.apply(), /outside-git/); assert.equal(fs.readFileSync(f.file, 'utf8'), '{}');
});
test('failed PowerShell validation precedes backup and write', t => {
  const f = fixture(t, '{}');
  assert.throws(() => editor.apply(f.options, () => {throw new Error('selected-executable-must-be-powershell-7');}), /must-be-powershell-7/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{}');
  assert.equal(fs.existsSync(path.join(path.dirname(f.file), '.ai-dev-settings-backups')), false);
});
test('tampered original backup cannot be used for rollback', t => {
  const f = fixture(t, '{}'), result = f.apply();
  fs.writeFileSync(path.join(path.dirname(result.receiptFile), 'settings.original'), '{"tampered":true}');
  assert.throws(() => editor.rollback(result.receiptFile), /backup-hash-mismatch/);
});
test('tampered receipt cannot erase the managed change list', t => {
  const f = fixture(t, '{}'), result = f.apply();
  const receipt = JSON.parse(fs.readFileSync(result.receiptFile, 'utf8')); receipt.changes=[];
  fs.writeFileSync(result.receiptFile, JSON.stringify(receipt));
  assert.throws(() => editor.rollback(result.receiptFile), /invalid-settings-receipt/);
});
test('directory junctions and broken links are rejected before writing', t => {
  const f = fixture(t, '{}'), alias=path.join(f.root, 'alias');
  fs.symlinkSync(path.dirname(f.file), alias, process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.throws(() => editor.apply({file:path.join(alias,'settings.json'),pwsh:f.pwsh}, () => {}), /linked-settings-path/); }
  finally { fs.unlinkSync(alias); }
});
test('vendor runtime is the fixed minimal MIT package with no external runtime dependencies', () => {
  const dir = path.resolve(__dirname, '../../tools/ai-dev-offline/vendor/jsonc-parser');
  const upstream = JSON.parse(fs.readFileSync(path.join(dir, 'UPSTREAM.json'), 'utf8').replace(/^\uFEFF/,''));
  assert.equal(upstream.version, '3.3.1'); assert.equal(upstream.license, 'MIT');
  assert.ok(fs.readFileSync(path.join(dir, 'LICENSE.md'), 'utf8').includes('Copyright (c) Microsoft'));
  for (const [name, sha] of Object.entries(upstream.files)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex'), sha, name);
  }
});
