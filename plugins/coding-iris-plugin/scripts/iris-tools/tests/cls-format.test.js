'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { check } = require('../cls-format');
const sample = 'Class Demo.Test\n{\n\nClassMethod A()\n{\n    q "a  b"\n}\n\n}\n';
test('new class follows member separators and EOF convention', () => {
  assert.deepEqual(check(sample), []);
  assert.deepEqual(check(sample.replace(/\n/g, '\r\n')), []);
  assert.equal(check(sample.slice(0, -1))[0].rule, 'CLS-EOF');
});
test('existing history outside changed lines is not reported', () => {
  const legacy = sample.replace('}\n\n}', '}\n\n\n}');
  assert.deepEqual(check(legacy, [{ start: 6, end: 6 }]), []);
  assert.equal(check(legacy).length, 1);
});
test('changed separator is reported without rewriting source', () => {
  const source = sample.replace('}\n\n}', '}\n\n\n}');
  assert.equal(check(source, [{ start: 9, end: 9 }])[0].rule, 'CLS-SEPARATOR');
  assert.ok(source.endsWith('}\n\n\n}\n'));
});
test('method strings and body blank lines are preserved', () => {
  assert.deepEqual(check(sample.replace('    q', '\n    q')), []);
});
test('opaque constructs only request manual inspection', () => {
  for (const member of ['Storage Default', 'XData Test', '#define TEST 1']) {
    assert.equal(check(sample.replace('ClassMethod A()', member))[0].status, 'manual-review');
  }
});

test('CLI reports advisory without blocking or changing a new file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cls-advisory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const init = spawnSync('git', ['init', root], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(init.status, 0, init.stderr);
  const file = path.join(root, 'Test.cls');
  const source = sample.replace('}\n\n}', '}\n\n\n}');
  fs.writeFileSync(file, source);
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../check-cls-format.js'), file], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout)[0].issues[0].status, 'advisory');
  assert.equal(fs.readFileSync(file, 'utf8'), source);
});
