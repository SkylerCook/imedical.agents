'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync, spawnSync} = require('node:child_process');
const repository = path.resolve(__dirname, '../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function git(root, args, input) { return execFileSync('git', ['-C', root, ...args], {input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']}); }

test('new and upgraded sparse projects receive XML runtime, canonical class and both skill sources', t => {
  const base = path.resolve(process.env.CODEX_TEST_TMP_ROOT || path.join(os.tmpdir(), 'Codex'));
  fs.mkdirSync(base, {recursive: true});
  const root = fs.mkdtempSync(path.join(base, 'iris-xml-distribution-'));
  t.after(() => { assert.ok(path.resolve(root).startsWith(base + path.sep)); fs.rmSync(root, {recursive: true, force: true}); });
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  git(source, ['init']); git(source, ['config', 'user.name', 'Fixture']); git(source, ['config', 'user.email', 'fixture@example.invalid']);
  git(source, ['config', 'core.autocrlf', 'false']);
  for (const file of ['docs/entry.md', 'maintenance/should-not-deploy.md', 'scripts/tests/should-not-deploy.js', '.agents/local-only.md']) {
    fs.mkdirSync(path.dirname(path.join(source, file)), {recursive: true}); fs.writeFileSync(path.join(source, file), 'fixture\n');
  }
  git(source, ['add', '.']); git(source, ['commit', '-m', 'fixture old capability']);
  const patterns = [...fs.readFileSync(path.join(repository, 'scripts/update-agents.ps1'), 'utf8').replace(/\r\n/g, '\n')
    .match(/\$runtimeSparsePaths\s*=\s*@\(([\s\S]*?)\n\)/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  function clone(name) {
    const target = path.join(root, name);
    execFileSync('git', ['clone', '--no-checkout', '--no-local', source, target], {windowsHide: true, stdio: 'pipe'});
    git(target, ['config', 'core.autocrlf', 'false']);
    git(target, ['sparse-checkout', 'set', '--no-cone', '--stdin'], patterns.join('\n') + '\n');
    git(target, ['checkout']); return target;
  }
  const upgraded = clone('upgraded');
  assert.equal(fs.existsSync(path.join(upgraded, 'vendor/xml-parser')), false);
  const copied = new Map();
  function copy(relative) {
    const original = path.join(repository, relative), target = path.join(source, relative), item = fs.lstatSync(original);
    assert.equal(item.isSymbolicLink(), false, relative);
    if (item.isDirectory()) { for (const entry of fs.readdirSync(original)) if (entry !== 'tests') copy(path.join(relative, entry)); return; }
    if (!item.isFile()) return;
    const bytes = fs.readFileSync(original); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, bytes); copied.set(relative, sha(bytes));
  }
  for (const relative of ['scripts/lib', 'scripts/iris-mcp.js', 'vendor/xml-parser', 'plugins/coding-iris-plugin/scripts/iris-tools',
    'plugins/coding-iris-plugin/templates/DHCDoc/Util/XmlPackage.cls', 'plugins/coding-iris-plugin/skills/iris-xml-export',
    'plugins/coding-iris-plugin/skills/iris-code-baseline', 'plugins/coding-iris-plugin/.agents-plugin/plugin.json']) copy(relative);
  git(source, ['add', '.']); git(source, ['commit', '-m', 'fixture XML capability']);
  git(upgraded, ['pull', '--ff-only']);
  const fresh = clone('fresh');
  for (const target of [fresh, upgraded]) {
    for (const [relative, expected] of copied) assert.equal(sha(fs.readFileSync(path.join(target, relative))), expected, relative);
    for (const relative of ['maintenance/should-not-deploy.md', 'scripts/tests/should-not-deploy.js', '.agents/local-only.md']) assert.equal(fs.existsSync(path.join(target, relative)), false, relative);
    const core = require(path.join(target, 'plugins/coding-iris-plugin/scripts/iris-tools/xml-package-core'));
    assert.equal(core.parseExportXml('<Export><CSPBase64 application="/web/" name="a.png">AAECAw==</CSPBase64></Export>').items[0].payloadBytes.length, 4);
    for (const cli of ['xml-export.js', 'xml-scope.js', 'code-baseline.js', 'baseline-catalog.js']) {
      const result = spawnSync(process.execPath, [path.join(target, 'plugins/coding-iris-plugin/scripts/iris-tools', cli), '--help'], {encoding: 'utf8', windowsHide: true});
      assert.equal(result.status, 0, cli + ': ' + result.stderr); assert.ok(result.stdout.length > 40);
    }
  }
});
