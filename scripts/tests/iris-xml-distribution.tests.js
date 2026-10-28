'use strict';
const {createTempDirectory,ownsTempDirectory}=require('./fixtures/temp-directory');
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
  const root = createTempDirectory('iris-xml-distribution-');
  t.after(() => { assert.ok(ownsTempDirectory(root)); fs.rmSync(root, {recursive: true, force: true}); });
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  const sourceOnlyTools = ['tools/README.md', 'tools/iris-code-export/export-iris-code.ps1', 'tools/future-tool/new.txt', 'tools/dist/fixture.zip'];
  git(source, ['init']); git(source, ['config', 'user.name', 'Fixture']); git(source, ['config', 'user.email', 'fixture@example.invalid']);
  git(source, ['config', 'core.autocrlf', 'false']);
  for (const file of ['docs/entry.md', 'maintenance/should-not-deploy.md', 'scripts/tests/should-not-deploy.js', '.agents/local-only.md', ...sourceOnlyTools]) {
    fs.mkdirSync(path.dirname(path.join(source, file)), {recursive: true}); fs.writeFileSync(path.join(source, file), 'fixture\n');
  }
  git(source, ['add', '.']); git(source, ['commit', '-m', 'fixture old capability']);
  const trackedTools = new Set(git(source, ['ls-files', '--', 'tools']).trim().split(/\r?\n/));
  for (const file of sourceOnlyTools) assert.ok(trackedTools.has(file), 'fixture must actually track ' + file);
  const patterns = [...fs.readFileSync(path.join(repository, 'scripts/update-agents.ps1'), 'utf8').replace(/\r\n/g, '\n')
    .match(/\$runtimeSparsePaths\s*=\s*@\(([\s\S]*?)\n\)/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const installPatterns = [...fs.readFileSync(path.join(repository, 'scripts/install-agents.ps1'), 'utf8').replace(/\r\n/g, '\n')
    .match(/\$sparsePaths\s*=\s*@\(([\s\S]*?)\n\)/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  function clone(name, selectedPatterns = patterns) {
    const target = path.join(root, name);
    execFileSync('git', ['clone', '--no-checkout', '--no-local', source, target], {windowsHide: true, stdio: 'pipe'});
    git(target, ['config', 'core.autocrlf', 'false']);
    git(target, ['sparse-checkout', 'set', '--no-cone', '--stdin'], selectedPatterns.join('\n') + '\n');
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
    'plugins/coding-iris-plugin/skills/iris-code-baseline', 'plugins/coding-iris-plugin/.agents-plugin/plugin.json',
    'plugins/coding-iris-plugin/references/iris-offline-development.md']) copy(relative);
  git(source, ['add', '.']); git(source, ['commit', '-m', 'fixture XML capability']);
  git(upgraded, ['pull', '--ff-only']);
  const fresh = clone('fresh', installPatterns);
  for (const target of [fresh, upgraded]) {
    assert.equal(fs.existsSync(path.join(target, 'tools')), false, 'the entire source-only tools tree must stay out of projects');
    for (const name of ['edit-export-xml.ps1', 'source-delivery.ps1']) {
      const bytes = fs.readFileSync(path.join(target, 'plugins/coding-iris-plugin/scripts/iris-tools', name));
      assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], name + ' must support Windows PowerShell 5.1 UTF-8');
    }
    for (const [relative, expected] of copied) assert.equal(sha(fs.readFileSync(path.join(target, relative))), expected, relative);
    for (const relative of ['maintenance/should-not-deploy.md', 'scripts/tests/should-not-deploy.js', '.agents/local-only.md', ...sourceOnlyTools, 'plugins/coding-iris-plugin/scripts/iris-tools/export-iris-code.ps1']) assert.equal(fs.existsSync(path.join(target, relative)), false, relative);
    const core = require(path.join(target, 'plugins/coding-iris-plugin/scripts/iris-tools/xml-package-core'));
    assert.equal(core.parseExportXml('<Export><CSPBase64 application="/web/" name="a.png">AAECAw==</CSPBase64></Export>').items[0].payloadBytes.length, 4);
    for (const cli of ['xml-export.js', 'xml-scope.js', 'code-baseline.js', 'baseline-catalog.js', 'source-delivery.js']) {
      const result = spawnSync(process.execPath, [path.join(target, 'plugins/coding-iris-plugin/scripts/iris-tools', cli), '--help'], {encoding: 'utf8', windowsHide: true});
      assert.equal(result.status, 0, cli + ': ' + result.stderr); assert.ok(result.stdout.length > 40);
    }
  }
});
