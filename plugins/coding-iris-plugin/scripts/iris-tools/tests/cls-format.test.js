'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { check } = require('../cls-format');
const sample = 'Class Demo.Test\n{\n\nClassMethod A()\n{\n    q "a  b"\n}\n\n}\n';
test('shipped class template passes with LF and CRLF', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '../../../templates/class.template.cls'), 'utf8').replace(/\r\n/g, '\n');
  assert.deepEqual(check(template), []);
  assert.deepEqual(check(template.replace(/\n/g, '\r\n')), []);
});
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

const withParameter = (declaration, body = '    q ..#DefineCode') =>
  sample.replace('ClassMethod A()', () => `${declaration}\n\nClassMethod A()`).replace('    q "a  b"', () => body);
const namingIssues = (source, ranges) => check(source, ranges).filter(issue => issue.rule.startsWith('CLS-PARAMETER'));

test('Parameter declarations and direct references accept legal names without enforcing case style', () => {
  for (const name of ['DefineCode', 'MAXRETRYCOUNT', '%Flag', 'value2']) {
    const source = withParameter(`Parameter ${name} As STRING = "ExampleConfig";`, `    q ..#${name}_"suffix"`);
    // Concatenation is intentionally a manual hint, never an invalid-name failure.
    assert.deepEqual(namingIssues(source).map(i => i.status), ['manual-review']);
    assert.deepEqual(namingIssues(source.replace('_"suffix"', '')), []);
    assert.deepEqual(namingIssues(source.replace('_"suffix"', '').replace(/\n/g, '\r\n')), []);
  }
  assert.deepEqual(namingIssues(withParameter('Parameter DefineCode;', '    q ##class(Demo.Config).#DefineCode')), []);
  assert.deepEqual(namingIssues(withParameter('Parameter DefineCode;', '    q object.#DefineCode')), []);
});

test('invalid unquoted declarations are diagnosed at the declaration line', () => {
  for (const name of ['DEFINE_CODE', '1Code', 'Define-Code', 'Define.Code', 'Bad@Name']) {
    assert.deepEqual(namingIssues(withParameter(`Parameter ${name} = 1;`)).map(i => [i.rule, i.status, i.line]),
      [['CLS-PARAMETER-NAME', 'fail', 4]]);
  }
});

test('ambiguous references and delimited or non-ASCII names require manual review', () => {
  for (const body of ['    q ..#DEFINE_CODE', '    q ##class(Demo.Config).#DEFINE_CODE', '    q obj.#DEFINE_CODE', '    q ..#"Define_Code"', '    q ..#参数', '    q $PARAMETER("Demo.Config", name)']) {
    const issues = namingIssues(withParameter('Parameter DefineCode = 1;', body));
    assert.equal(issues.length, 1, body);
    assert.equal(issues[0].status, 'manual-review');
    assert.equal(issues[0].rule, 'CLS-PARAMETER-REFERENCE');
  }
  for (const name of ['"Define_Code"', '参数']) {
    assert.equal(namingIssues(withParameter(`Parameter ${name} = 1;`))[0].status, 'manual-review');
  }
});

test('comments and strings including escaped quotes do not produce Parameter diagnostics', () => {
  const source = withParameter('Parameter DefineCode = "Parameter BAD_NAME ..#BAD_NAME";', [
    '    // Parameter BAD_NAME ..#BAD_NAME',
    '    ; ..#BAD_NAME',
    '    /*',
    'Parameter BAD_NAME = 1;',
    '    q ..#BAD_NAME',
    '    */',
    '    s text = "escaped "" ..#BAD_NAME $PARAMETER("""" , name)"',
    '    q $p(text, "^")'
  ].join('\n'));
  assert.deepEqual(namingIssues(source), []);
});

test('Parameter diagnostics respect changed ranges while new files inspect all lines', () => {
  const source = withParameter('Parameter BAD_NAME = 1;', '    q ..#BAD_NAME');
  assert.equal(namingIssues(source).length, 2);
  assert.deepEqual(namingIssues(source, [{ start: 8, end: 8 }]).map(i => i.rule), ['CLS-PARAMETER-REFERENCE']);
  assert.deepEqual(namingIssues(source, [{ start: 4, end: 4 }]).map(i => i.rule), ['CLS-PARAMETER-NAME']);
  assert.deepEqual(namingIssues(source, [{ start: 9, end: 9 }]), []);
});

test('embedded languages and macros fall back to manual structural review', () => {
  for (const body of ['    &sql(SELECT x FROM t)', '    q $$$SomeMacro', '    q ##expression(1)']) {
    assert.deepEqual(check(withParameter('Parameter BAD_NAME = 1;', body)),
      [{ rule: 'CLS-STRUCTURE', status: 'manual-review', line: 1 }]);
  }
});

test('CLI reports advisory without blocking or changing a new file', t => {
  const parent = process.env.CLS_FORMAT_TEST_TMP || path.join(os.tmpdir(), 'Codex');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'cls-advisory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const init = spawnSync('git', ['init', root], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(init.status, 0, init.stderr);
  const file = path.join(root, 'Test.cls');
  const source = withParameter('Parameter BAD_NAME = 1;', '    q ..#BAD_NAME');
  fs.writeFileSync(file, source);
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../check-cls-format.js'), file], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout)[0].issues.map(i => [i.rule, i.status]),
    [['CLS-PARAMETER-NAME', 'advisory'], ['CLS-PARAMETER-REFERENCE', 'manual-review']]);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
});
