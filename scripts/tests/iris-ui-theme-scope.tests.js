'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../../plugins/iris-ui/scripts/check-theme-scope.js');
const { argumentsFrom, scanSource, scanFiles } = require(script);

function temporary(t) {
  let parent = process.env.IRIS_UI_TEST_TMP || (process.platform === 'win32' ? 'D:/tmp/Codex' : path.join(os.tmpdir(), 'Codex'));
  let root;
  try {
    fs.mkdirSync(parent, { recursive: true });
    root = fs.mkdtempSync(path.join(parent, 'theme-scope-test-'));
  } catch (error) {
    if (process.env.IRIS_UI_TEST_TMP) throw error;
    parent = path.join(os.tmpdir(), 'Codex');
    fs.mkdirSync(parent, { recursive: true });
    root = fs.mkdtempSync(path.join(parent, 'theme-scope-test-'));
  }
  t.after(() => {
    assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
    assert.equal(fs.realpathSync(path.dirname(root)), fs.realpathSync(parent));
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false);
  });
  return root;
}

function run(root, ...files) {
  const result = spawnSync(process.execPath, [script, '--project-root', root, ...files.flatMap(file => ['--file', file])],
    { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.error, undefined);
  return { ...result, json: JSON.parse(result.stdout) };
}

test('CSS theme attribute selectors are candidates even for a legitimate skin difference', () => {
  const source = '\uFEFF/* [data-theme="pure"] .fake {} */\r\n' +
    'body[data-hisui-style="pure"] .group { border-bottom: 1px dashed gray; }\r\n' +
    '@media (min-width: 600px) { [data-theme="ihos"] .button { color: blue; } }\r\n' +
    '.label::after { content: "[theme=pure] {"; }\r\n' +
    '[role="pure"] .label { color: black; }\r\n' +
    '[style] .box, [data-style="compact"] { display: flex; }';
  const candidates = scanSource(source, '.css', 'view.css');
  assert.deepEqual(candidates.map(item => [item.line, item.conditionType, item.symbol]), [
    [2, 'css-theme-attribute-selector', 'data-hisui-style'],
    [3, 'css-theme-attribute-selector', 'data-theme']
  ]);
});

test('direct HISUI reads and same-file named function helper calls retain exact locations', () => {
  const source = [
    'function useCleanTheme() {',
    '  return $.hisui.getHisuiStyle() === "pure";',
    '}',
    'if (useCleanTheme()) initializeWidget();',
    'const label = "pure";',
    '// if ($.hisui.getHisuiStyle() === "pure") ignored();',
    'if (HISUIStyleCode === "vben") paint();',
    'document.body.getAttribute("data-theme");'
  ].join('\n');
  const candidates = scanSource(source, '.js', 'page.js');
  assert.deepEqual(candidates.map(item => [item.line, item.conditionType]), [
    [1, 'same-file-theme-helper-definition'], [2, 'hisui-theme-read'],
    [4, 'same-file-theme-helper-call'], [7, 'hisui-theme-read'], [8, 'theme-attribute-read']
  ]);
  assert.equal(candidates[1].column, 12);
});

test('simple assigned and arrow helpers are recognized without evaluating source', () => {
  const source = [
    'const readTheme = function () { return $.hisui.getHisuiStyle(); };',
    'const modern = () => { return $.hisui.getHisuiStyle() === "pure"; };',
    'const compact = () => $.hisui.getHisuiStyle() === "pure";',
    'if (readTheme() === "pure" || modern() || compact()) fit();'
  ].join('\n');
  const candidates = scanSource(source, '.js', 'page.js');
  assert.deepEqual(candidates.filter(item => item.conditionType.endsWith('definition')).map(item => item.symbol), ['readTheme', 'modern', 'compact']);
  assert.deepEqual(candidates.filter(item => item.conditionType.endsWith('call')).map(item => item.symbol), ['readTheme', 'modern', 'compact']);
});

test('plain pure text, comments, strings, regular expressions and templates are not theme decisions', () => {
  const source = [
    'const label = "pure";',
    'const example = "$.hisui.getHisuiStyle() === pure";',
    '// HISUIStyleCode === "pure"',
    '/* $.hisui.getHisuiStyle() */',
    'const pattern = /HISUIStyleCode\\s+pure/;',
    'const template = `$.hisui.getHisuiStyle()`;',
    'other.getTheme();',
    'box.attr("style");',
    'const pure = true;'
  ].join('\n');
  assert.deepEqual(scanSource(source, '.js', 'plain.js'), []);
});

test('recognizable direct helper chains are candidates with identifier-only binding limits', () => {
  const source = 'function theme() { return $.hisui.getHisuiStyle(); }\n' +
    'function clean() { return theme() === "pure"; }\n' +
    'if (clean()) initialize();';
  const candidates = scanSource(source, '.js', 'page.js');
  assert.deepEqual(candidates.filter(item => item.conditionType.endsWith('definition')).map(item => item.symbol), ['theme', 'clean']);
  assert.equal(candidates.at(-1).conditionType, 'same-file-theme-helper-call');
  assert.equal(candidates.at(-1).line, 3);
});

test('concise helpers include their first token and stop before adjacent declarations', () => {
  const source = [
    'const noop = () => 0, clean = () => HISUIStyleCode === "pure";',
    'const current = () => hisui.getTheme();',
    'const indirect = () => current();',
    'if (noop()) unrelated();',
    'if (clean() || indirect()) fit();'
  ].join('\n');
  const candidates = scanSource(source, '.js', 'page.js');
  assert.deepEqual(candidates.filter(item => item.conditionType.endsWith('definition')).map(item => item.symbol),
    ['clean', 'current', 'indirect']);
  assert.equal(candidates.some(item => item.symbol === 'noop'), false);
  assert.ok(candidates.some(item => item.symbol === 'clean' && item.conditionType.endsWith('call') && item.line === 5));
});

test('quoted punctuation and nested argument commas do not truncate helper bodies', () => {
  const source = [
    'function clean() { const brace = "}"; return HISUIStyleCode === "pure"; }',
    'const selected = () => compare(";", HISUIStyleCode);',
    'if (clean() || selected()) fit();'
  ].join('\n');
  const candidates = scanSource(source, '.js', 'page.js');
  assert.deepEqual(candidates.filter(item => item.conditionType.endsWith('definition')).map(item => item.symbol),
    ['clean', 'selected']);
  assert.deepEqual(candidates.filter(item => item.conditionType.endsWith('call')).map(item => item.symbol),
    ['clean', 'selected']);
});

test('CSP, CSR and HTML read only embedded client script and style with original line numbers', () => {
  const source = [
    '<div>pure $.hisui.getHisuiStyle()</div>',
    '<!-- <script>HISUIStyleCode;</script> -->',
    '<style>',
    '  [data-hisui-family="pure"] .group { border: 0; }',
    '</style>',
    '<script language="javascript">',
    '  if ($.hisui.getHisuiStyle() === "pure") initialize();',
    '</script>',
    '<script language="cache" runat="server">HISUIStyleCode;</script>'
  ].join('\n');
  for (const extension of ['.csp', '.csr', '.html']) {
    assert.deepEqual(scanSource(source, extension, 'page' + extension).map(item => [item.line, item.conditionType]), [
      [4, 'css-theme-attribute-selector'], [7, 'hisui-theme-read']
    ]);
  }
});

test('same-file helpers span embedded script blocks while JSON scripts are ignored', () => {
  const source = '<script>function clean() { return HISUIStyleCode === "pure"; }</script>\n' +
    '<script type="application/json">{"example":"HISUIStyleCode"}</script>\n' +
    '<script>if(clean()) fit();</script>';
  const candidates = scanSource(source, '.csp', 'page.csp');
  assert.equal(candidates.length, 3);
  assert.equal(candidates.at(-1).conditionType, 'same-file-theme-helper-call');
  assert.equal(candidates.at(-1).line, 3);
});

test('HTML comments and quoted tag delimiters do not erase embedded theme reads', () => {
  const source = [
    '<!-- <script>HISUIStyleCode;</script> -->',
    '<script data-title="a > b">const marker = "<!--"; HISUIStyleCode;</script>',
    '<!-- ordinary comment -->',
    '<style data-title=\'a > b\'>[data-theme="pure"] .group { color: blue; }</style>'
  ].join('\n');
  const candidates = scanSource(source, '.csp', 'page.csp');
  assert.deepEqual(candidates.map(item => [item.line, item.conditionType]), [
    [2, 'hisui-theme-read'], [4, 'css-theme-attribute-selector']
  ]);
  assert.equal(candidates[0].column, source.split('\n')[1].indexOf('HISUIStyleCode') + 1);
});

test('CLI is read-only, explicit-only, deduplicates files and exits zero when candidates exist', t => {
  const root = temporary(t);
  const file = path.join(root, 'page.js');
  const source = 'if ($.hisui.getHisuiStyle() === "pure") initialize();\n';
  fs.writeFileSync(file, source);
  fs.writeFileSync(path.join(root, 'not-requested.js'), 'HISUIStyleCode;');
  const before = fs.statSync(file);
  const result = run(root, 'page.js', file);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.status, 'scanned');
  assert.equal(result.json.readOnly, true);
  assert.equal(result.json.files.length, 1);
  assert.equal(result.json.candidates.length, 1);
  assert.ok(result.json.coverage.limitations.some(item => /zero candidates/.test(item)));
  assert.ok(result.json.coverage.limitations.some(item => /cross-file/.test(item)));
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  assert.equal(fs.statSync(file).mtimeMs, before.mtimeMs);
  assert.deepEqual(fs.readdirSync(root).sort(), ['not-requested.js', 'page.js']);
});

test('invalid CLI, unsupported extensions, directories, missing files and escapes stop with exit 2', t => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, 'folder.js'));
  fs.writeFileSync(path.join(root, 'notes.md'), 'pure');
  for (const files of [['missing.js'], ['folder.js'], ['notes.md'], ['../outside.js']]) {
    const result = run(root, ...files);
    assert.equal(result.status, 2, result.stdout);
    assert.equal(result.json.status, 'error');
    assert.equal(result.json.candidates, undefined);
  }
  for (const argv of [[], ['--project-root', root], ['--project-root', root, '--file'],
    ['--project-root', '   ', '--file', 'page.js'],
    ['--project-root', root, '--file', 'page.js', '--unknown'],
    ['--project-root', root, '--project-root', root, '--file', 'page.js']]) assert.throws(() => argumentsFrom(argv));
});

test('read errors and invalid UTF-8 stop instead of reporting a successful empty scan', t => {
  const root = temporary(t);
  fs.writeFileSync(path.join(root, 'page.js'), 'HISUIStyleCode;');
  const io = { statSync: fs.statSync, readFileSync() { throw Object.assign(new Error('Permission denied'), { code: 'EACCES' }); } };
  assert.throws(() => scanFiles({ projectRoot: root, files: ['page.js'] }, io), { code: 'EACCES' });
  fs.writeFileSync(path.join(root, 'invalid.js'), Buffer.from([0xff, 0xfe, 0x61]));
  assert.equal(run(root, 'invalid.js').status, 2);
});

test('standard workspace rejects linked files escaping its physical root', t => {
  const root = temporary(t);
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(workspace);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'page.js'), 'HISUIStyleCode;');
  fs.symlinkSync(outside, path.join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(run(workspace, 'linked/page.js').status, 2);
});

test('Overlay uses declared SourceRoot aliases and rejects undeclared paths and mismatched Junctions', t => {
  const root = temporary(t);
  const workspace = path.join(root, 'workspace');
  const gitRoot = path.join(root, 'repo');
  const sourceRoot = path.join(gitRoot, 'module');
  const other = path.join(gitRoot, 'other');
  fs.mkdirSync(path.join(workspace, '.agents'), { recursive: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(sourceRoot, 'page.js'), 'HISUIStyleCode;');
  fs.writeFileSync(path.join(workspace, 'outside.js'), 'HISUIStyleCode;');
  const alias = path.join(workspace, 'frontend');
  fs.symlinkSync(sourceRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(workspace, '.agents/capability.json'), JSON.stringify({
    schemaVersion: 1, mode: 'workspace-overlay', workspace: 'example', contextRoot: '.agents',
    capabilityRoot: path.join(root, 'capabilities'), sharedDirectories: [], localDirectories: [],
    sourceRoots: [{ name: 'frontend', path: 'frontend', target: sourceRoot, gitRoot }]
  }));
  const result = run(workspace, 'frontend/page.js', path.join(sourceRoot, 'page.js'));
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.files.length, 1);
  assert.equal(result.json.files[0].file, 'frontend/page.js');
  assert.equal(run(workspace, 'outside.js').status, 2);
  fs.unlinkSync(alias);
  fs.symlinkSync(other, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const invalid = run(workspace, 'frontend/page.js');
  assert.equal(invalid.status, 2);
  assert.match(invalid.json.error.message, /junction-target-mismatch/);
});

test('Overlay rejects an escaping link below its declared SourceRoot and invalid manifest', t => {
  const root = temporary(t);
  const workspace = path.join(root, 'workspace');
  const gitRoot = path.join(root, 'repo');
  const sourceRoot = path.join(gitRoot, 'module');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(workspace, '.agents'), { recursive: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'page.js'), 'HISUIStyleCode;');
  fs.symlinkSync(outside, path.join(sourceRoot, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(sourceRoot, path.join(workspace, 'frontend'), process.platform === 'win32' ? 'junction' : 'dir');
  const manifest = path.join(workspace, '.agents/capability.json');
  fs.writeFileSync(manifest, JSON.stringify({
    schemaVersion: 1, mode: 'workspace-overlay', workspace: 'example', contextRoot: '.agents',
    capabilityRoot: path.join(root, 'capabilities'), sharedDirectories: [], localDirectories: [],
    sourceRoots: [{ name: 'frontend', path: 'frontend', target: sourceRoot, gitRoot }]
  }));
  const result = run(workspace, 'frontend/escape/page.js');
  assert.equal(result.status, 2);
  assert.match(result.json.error.message, /escapes declared SourceRoot/);
  fs.writeFileSync(manifest, '{}');
  assert.equal(run(workspace, 'frontend/escape/page.js').status, 2);
});
