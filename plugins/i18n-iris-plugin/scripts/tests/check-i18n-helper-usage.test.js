'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const cli = path.resolve(__dirname, '..', 'check-i18n-helper-usage.js');
const checker = require('../check-i18n-helper-usage');
const temporaryRoots = [];

test.after(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

function createFixture(name, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-helper-check-'));
  temporaryRoots.push(root);
  const file = path.join(root, name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

test('accepts stable static and placeholder keys', () => {
  const source = [
    'const label = $g("静态文案");',
    'const message = $trans("{0} 键打开模板维护", PageLogicObj.shortcutKey);',
    "const quoted = $g('单引号文案');",
    'const stableTemplate = $g(`固定文案`);',
  ].join('\n');
  assert.deepEqual(checker.scanSource(source), []);
});

test('rejects dynamic keys for both helpers with exact locations', () => {
  const source = [
    'const first = $g(PageLogicObj.shortcutKey + " 键打开模板维护");',
    'const second = $g("快捷键：" + key);',
    'const third = $g(`${key} 键打开模板维护`);',
    'const fourth = $trans(dynamicKey, key);',
  ].join('\n');
  const violations = checker.scanSource(source);
  assert.equal(violations.length, 4);
  assert.deepEqual(violations.map((item) => item.line), [1, 2, 3, 4]);
  assert.deepEqual(violations.map((item) => item.column), [15, 16, 15, 16]);
  assert.ok(violations.every((item) => item.code === 'dynamic-translation-key'));
});

test('ignores helper-like text inside comments and strings', () => {
  const source = [
    '// $g(dynamicKey)',
    '/* $trans(dynamicKey, value) */',
    'const example = "$g(dynamicKey)";',
    "const other = '$trans(dynamicKey, value)';",
    'const template = `example $g(dynamicKey)`;',
  ].join('\n');
  assert.deepEqual(checker.scanSource(source), []);
});

test('supports project-specific helper names', () => {
  const source = [
    'translateStatic("固定文案");',
    'translateTemplate("{0} 提示", value);',
    'translateStatic(value + " 提示");',
  ].join('\n');
  const violations = checker.scanSource(source, {
    staticHelper: 'translateStatic',
    placeholderHelper: 'translateTemplate',
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].helper, 'translateStatic');
});

test('CLI checks multiple files and returns 0, 1, and 2 as specified', () => {
  const valid = createFixture('valid.js', '$trans("{0} 键打开模板维护", key);\n');
  const invalid = createFixture('invalid.csp', '$g(PageLogicObj.shortcutKey + " 键打开模板维护");\n');

  const passed = runCli(['--file', valid]);
  assert.equal(passed.status, 0);
  assert.match(passed.stdout, /passed: 1 file\(s\)/);

  const failed = runCli(['--file', valid, '--file', invalid]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /invalid\.csp:1:1 \[dynamic-translation-key\]/);
  assert.match(failed.stderr, /pass runtime values through \$trans placeholders/);

  const usageError = runCli([]);
  assert.equal(usageError.status, 2);
  assert.match(usageError.stderr, /At least one --file is required/);

  const readError = runCli(['--file', path.join(path.dirname(valid), 'missing.js')]);
  assert.equal(readError.status, 2);
  assert.match(readError.stderr, /\[file-read-error\]/);
});
