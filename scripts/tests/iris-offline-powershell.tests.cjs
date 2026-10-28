'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {parseExportXml} = require('../../plugins/coding-iris-plugin/scripts/iris-tools/xml-package-core');
const {generate: versionCatalogs, helperSource} = require('../../tools/iris-code-export/build-catalogs');
const windows = process.platform === 'win32';
const shell = process.env.IRIS_TEST_POWERSHELL || 'powershell.exe';
const repository = path.resolve(__dirname, '../..');
let portableRoot, portableParent;
const script = name => ['export-iris-code.ps1', 'export-version-baseline.ps1', 'source-delivery.ps1'].includes(name) ? path.join(portableRoot, name) : path.join(repository, 'plugins/coding-iris-plugin/scripts/iris-tools', name);
const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
function run(file, args = [], extra = '') {
  const command = '[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); & ' + quote(script(file)) + ' ' + args.map(value => /^-[A-Za-z]+$/.test(value) ? value : quote(value)).join(' ') + ' ' + extra + '; if (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE }; exit 1 }';
  return invoke(command);
}
function invoke(command) {
  return new Promise((resolve, reject) => {
    const env = {...process.env};
    // The parent may be PowerShell 7: do not feed its modules to Windows PowerShell 5.1.
    if (path.basename(shell).toLowerCase() === 'powershell.exe') env.PSModulePath = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules');
    const child = spawn(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {windowsHide: true, env, cwd: portableRoot || os.tmpdir()});
    child.stdin.end();
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('error', reject); child.on('close', code => resolve({code, stdout, stderr}));
  });
}

test.before(async () => {
  if (!windows) return;
  const parent = path.resolve(process.env.CODEX_TEST_TMP_ROOT || path.join(os.tmpdir(), 'Codex'));
  fs.mkdirSync(parent, {recursive: true});
  portableParent = fs.mkdtempSync(path.join(parent, 'iris-portable-'));
  const target = path.join(portableParent, '独立 工具');
  const zip = path.join(repository, 'tools/dist/iris-code-export.zip');
  const result = await invoke('Expand-Archive -LiteralPath ' + quote(zip) + ' -DestinationPath ' + quote(target) + ' -ErrorAction Stop');
  assert.equal(result.code, 0, result.stderr);
  portableRoot = target;
  const names = ['README.md', 'export-iris-code.ps1', 'export-version-baseline.ps1', 'source-delivery.ps1', 'files.example.txt'].sort();
  assert.deepEqual(fs.readdirSync(target).sort(), [...names, 'images', 'catalogs'].sort(), 'ZIP must contain only human runtime files and generated catalogs');
  const expectedCatalogs = versionCatalogs().files;
  assert.deepEqual(fs.readdirSync(path.join(target, 'catalogs')).sort(), [...expectedCatalogs.keys()].sort());
  for (const [name, bytes] of expectedCatalogs) assert.deepEqual(fs.readFileSync(path.join(target, 'catalogs', name)), bytes, 'ZIP catalog drift: ' + name);
  assert.deepEqual(fs.readdirSync(path.join(target, 'images')), ['project-layout-example.png']);
  assert.deepEqual(fs.readFileSync(path.join(target, 'images/project-layout-example.png')), fs.readFileSync(path.join(repository, 'tools/iris-code-export/images/project-layout-example.png')), 'ZIP documentation image mismatch');
  for (const name of names) {
    if (name !== 'README.md') assert.deepEqual(fs.readFileSync(path.join(target, name)), fs.readFileSync(name === 'source-delivery.ps1' ? helperSource() : path.join(repository, 'tools/iris-code-export', name)), 'ZIP/source mismatch: ' + name);
  }
  const [beforeExample, afterExample] = fs.readFileSync(path.join(repository, 'tools/iris-code-export/README.md'), 'utf8').split('<!-- local-atelier-example -->');
  const readme = fs.readFileSync(path.join(target, 'README.md'), 'utf8');
  assert.ok(readme.includes('](images/project-layout-example.png)'), 'README must reference its bundled image');
  assert.ok(readme.startsWith(beforeExample) && readme.endsWith(afterExample), 'localized README must preserve all public instructions');
  assert.deepEqual([...fs.readFileSync(path.join(target, 'export-iris-code.ps1')).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});
test.after(() => {
  if (portableParent && fs.existsSync(portableParent)) {
    assert.equal(path.basename(portableParent).startsWith('iris-portable-'), true);
    assert.equal(fs.lstatSync(portableParent).isSymbolicLink(), false);
    fs.rmSync(portableParent, {recursive: true, force: true});
  }
});
function fixture(t) {
  const parent = path.resolve(process.env.CODEX_TEST_TMP_ROOT || path.join(os.tmpdir(), 'Codex'));
  fs.mkdirSync(parent, {recursive: true});
  const root = fs.mkdtempSync(path.join(parent, 'iris-offline-'));
  t.after(() => { assert.equal(path.dirname(root), parent); assert.equal(fs.lstatSync(root).isSymbolicLink(), false); fs.rmSync(root, {recursive: true, force: true}); });
  return {root, put(name, content) { const file = path.join(root, name); fs.writeFileSync(file, content); return file; }};
}
const packageXml = '<?xml version="1.0" encoding="UTF-8"?>\n<Export generator="IRIS" version="26"><!--keep-->' +
  '<Class name="Demo.A" deployed="0"><Description><![CDATA[说明]]></Description><Super>%RegisteredObject</Super><Method name="Hello"><FormalSpec>x</FormalSpec><ReturnType>%String</ReturnType><Implementation><![CDATA[ quit "原始"\n]]></Implementation></Method><Storage name="Default"><Type>%Storage.Persistent</Type></Storage></Class>' +
  '<Routine name="Demo.mac" type="MAC"><![CDATA[Demo\n quit\n]]></Routine>' +
  '<CSP application="/demo/" name="a.js"><![CDATA[const x = "原始";]]></CSP>' +
  '<CSPBase64 application="/demo/" name="a.png">AAECA/8=</CSPBase64></Export>';

test('Windows XML workflow preserves Class metadata, routine, Web text and binary after offline edits', {skip: !windows}, async t => {
  const f = fixture(t), input = f.put('input.xml', packageXml), work = path.join(f.root, 'edit'), output = path.join(f.root, 'delivery');
  const notes = f.put('notes.md', '修改 Demo.A 的 Hello 返回文本。');
  let result = await run('edit-export-xml.ps1', ['-InputXml', input, '-WorkDirectory', work]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(work, 'inventory.json'), 'utf8')).count, 4);
  const cls = path.join(work, 'objects/000001.xml');
  fs.writeFileSync(cls, fs.readFileSync(cls, 'utf8').replace('原始', '已修改'));
  result = await run('edit-export-xml.ps1', ['-Mode', 'Pack', '-WorkDirectory', work, '-OutputDirectory', output, '-NotesFile', notes]);
  assert.equal(result.code, 0, result.stderr);
  const xml = fs.readFileSync(path.join(output, 'changes.xml'), 'utf8'), parsed = parseExportXml(xml), before = parseExportXml(packageXml);
  const rollback = parseExportXml(fs.readFileSync(path.join(output, 'rollback.xml')));
  assert.equal(parsed.items.length, 1); assert.match(xml, /已修改/); assert.match(xml, /<Storage name="Default">/);
  assert.deepEqual(rollback.items[0].payloadBytes, before.items[0].payloadBytes);
  assert.equal(fs.readFileSync(path.join(work, 'package.xml'), 'utf8'), packageXml);
  for (let i = 1; i < 4; i++) {
    const untouched = parseExportXml(fs.readFileSync(path.join(work, `objects/${String(i + 1).padStart(6, '0')}.xml`)));
    assert.deepEqual(untouched.items[0].payloadBytes, before.items[i].payloadBytes);
  }
  assert.match(fs.readFileSync(path.join(output, '变更说明.md'), 'utf8'), /Hello/);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.changedCount, 1); assert.equal(manifest.unchangedCount, 3); assert.equal(manifest.irisImportVerified, false);
  result = await run('edit-export-xml.ps1', ['-Mode', 'Verify', '-WorkDirectory', work, '-OutputDirectory', output]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(work, 'objects/000001.cls')), false);
  result = await run('edit-export-xml.ps1', ['-Mode', 'Pack', '-WorkDirectory', work, '-OutputDirectory', output, '-NotesFile', notes]);
  assert.notEqual(result.code, 0); assert.match(result.stderr, /output-directory-must-be-new/);
});

test('XML pack refuses missing/extra objects, renamed identity and template drift', {skip: !windows}, async t => {
  const f = fixture(t), input = f.put('input.xml', packageXml), work = path.join(f.root, 'edit'), output = path.join(f.root, 'delivery');
  assert.equal((await run('edit-export-xml.ps1', ['-InputXml', input, '-WorkDirectory', work])).code, 0);
  const first = path.join(work, 'objects/000001.xml'), original = fs.readFileSync(first);
  fs.writeFileSync(first, original.toString().replace('Demo.A', 'Demo.B'));
  let result = await run('edit-export-xml.ps1', ['-Mode', 'Pack', '-WorkDirectory', work, '-OutputDirectory', output]);
  assert.match(result.stderr, /object-identity-changed/); assert.equal(fs.existsSync(output), false);
  fs.writeFileSync(first, original); fs.writeFileSync(path.join(work, 'objects/extra.xml'), original);
  result = await run('edit-export-xml.ps1', ['-Mode', 'Pack', '-WorkDirectory', work, '-OutputDirectory', output]);
  assert.match(result.stderr, /object-set-changed/);
  fs.unlinkSync(path.join(work, 'objects/extra.xml')); fs.writeFileSync(path.join(work, 'package.xml'), packageXml + '\n');
  result = await run('edit-export-xml.ps1', ['-Mode', 'Pack', '-WorkDirectory', work, '-OutputDirectory', output]);
  assert.match(result.stderr, /template-drift/);
});

test('mixed Project/source aggregate produces matching incremental and rollback sets with offline verification', {skip: !windows}, async t => {
  const f = fixture(t), mixed = packageXml.replace('<!--keep-->', '<!--keep--><Project name="Demo"><Items><ProjectItem name="Demo.A" type="CLS"/><ProjectItem name="demo/a.js" type="CSP"/></Items></Project>');
  const input = f.put('input.xml', mixed), work = path.join(f.root, 'edit'), output = path.join(f.root, 'delivery'), notes = f.put('notes.md', '调整例程与页面文本，图片不变。');
  let result = await run('edit-export-xml.ps1', ['-InputXml', input, '-WorkDirectory', work]);
  assert.equal(result.code, 0, result.stderr);
  const inventory = JSON.parse(fs.readFileSync(path.join(work, 'inventory.json'), 'utf8'));
  assert.equal(inventory.count, 4); assert.equal(inventory.projectMetadataCount, 1); assert.equal(inventory.sourceKind, 'source-with-project');
  result = await run('edit-export-xml.ps1', ['-Mode', 'Pack', '-WorkDirectory', work, '-OutputDirectory', output]);
  assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).state, 'unchanged'); assert.equal(fs.existsSync(output), false);
  for (const [file, before, after] of [['000002.xml', ' quit', ' quit 42'], ['000003.xml', '原始', '修改']]) {
    const item = path.join(work, 'objects', file); fs.writeFileSync(item, fs.readFileSync(item, 'utf8').replace(before, after));
  }
  result = await run('edit-export-xml.ps1', ['-Mode', 'Pack', '-WorkDirectory', work, '-OutputDirectory', output]);
  assert.notEqual(result.code, 0); assert.match(result.stderr, /NotesFile-required/); assert.equal(fs.existsSync(output), false);
  result = await run('edit-export-xml.ps1', ['-Mode', 'Pack', '-WorkDirectory', work, '-OutputDirectory', output, '-NotesFile', notes]);
  assert.equal(result.code, 0, result.stderr);
  const changes = fs.readFileSync(path.join(output, 'changes.xml'), 'utf8'), rollbackPath = path.join(output, 'rollback.xml'), rollbackBytes = fs.readFileSync(rollbackPath);
  assert.doesNotMatch(changes, /<Project|<Class|<CSPBase64/);
  assert.deepEqual(parseExportXml(changes).items.map(i => i.identity), ['MAC:Demo.mac', 'CSP:demo/a.js']);
  const baseline = parseExportXml(packageXml).items;
  const previous = parseExportXml(rollbackBytes).items;
  assert.deepEqual(previous[0].payloadBytes, baseline[1].payloadBytes); assert.deepEqual(previous[1].payloadBytes, baseline[2].payloadBytes);
  result = await run('edit-export-xml.ps1', ['-Mode', 'Verify', '-WorkDirectory', work, '-OutputDirectory', output]);
  assert.equal(result.code, 0, result.stderr);
  fs.appendFileSync(rollbackPath, '\n');
  result = await run('edit-export-xml.ps1', ['-Mode', 'Verify', '-WorkDirectory', work, '-OutputDirectory', output]);
  assert.notEqual(result.code, 0); assert.match(result.stderr, /delivery-file-drift/);
  fs.writeFileSync(rollbackPath, rollbackBytes);
  fs.appendFileSync(path.join(output, '变更说明.md'), 'edited after delivery');
  result = await run('edit-export-xml.ps1', ['-Mode', 'Verify', '-WorkDirectory', work, '-OutputDirectory', output]);
  assert.notEqual(result.code, 0); assert.match(result.stderr, /delivery-file-drift/);
  assert.equal(fs.readFileSync(path.join(work, 'package.xml'), 'utf8'), mixed);
  assert.deepEqual(fs.readdirSync(f.root).filter(name => name.endsWith('.tmp')), []);
});

test('invalid Base64, duplicate Web identities and unsupported data are rejected before creating a work tree', {skip: !windows}, async t => {
  const f = fixture(t), work = path.join(f.root, 'edit');
  for (const content of [packageXml.replace('AAECA/8=', '%%%='), packageXml.replace('</Export>', '<CSP application="/demo/" name="a.png">text</CSP></Export>'), packageXml.replace('</Export>', '<Global name="Data"/></Export>')]) {
    const input = f.put('input.xml', content);
    const result = await run('edit-export-xml.ps1', ['-InputXml', input, '-WorkDirectory', work]);
    assert.notEqual(result.code, 0); assert.equal(fs.existsSync(work), false);
  }
});

test('container drift and invalid edited payload never publish a partial delivery', {skip: !windows}, async t => {
  const f = fixture(t), input = f.put('input.xml', packageXml), work = path.join(f.root, 'edit'), output = path.join(f.root, 'delivery'), notes = f.put('notes.md', '调整源码。');
  assert.equal((await run('edit-export-xml.ps1', ['-InputXml', input, '-WorkDirectory', work])).code, 0);
  const cls = path.join(work, 'objects/000001.xml'), original = fs.readFileSync(cls, 'utf8');
  fs.writeFileSync(cls, original.replace('version="26"', 'version="25"'));
  let result = await run('edit-export-xml.ps1', ['-Mode', 'Pack', '-WorkDirectory', work, '-OutputDirectory', output, '-NotesFile', notes]);
  assert.notEqual(result.code, 0); assert.match(result.stderr, /object-container-changed/); assert.equal(fs.existsSync(output), false);
  fs.writeFileSync(cls, original);
  const binary = path.join(work, 'objects/000004.xml'); fs.writeFileSync(binary, fs.readFileSync(binary, 'utf8').replace('AAECA/8=', 'A==='));
  result = await run('edit-export-xml.ps1', ['-Mode', 'Pack', '-WorkDirectory', work, '-OutputDirectory', output, '-NotesFile', notes]);
  assert.notEqual(result.code, 0); assert.match(result.stderr, /invalid-csp-base64/); assert.equal(fs.existsSync(output), false);
  assert.deepEqual(fs.readdirSync(f.root).filter(name => name.endsWith('.tmp')), []);
});

test('offline entry points reject DTD and catalog/full-source confusion before creating output', {skip: !windows}, async t => {
  const f = fixture(t);
  for (const content of ['<!DOCTYPE Export [<!ENTITY xx SYSTEM "file:///unreadable">]><Export>&xx;</Export>', '<Export><Project><Items><ProjectItem name="Demo.A" type="CLS"/></Items></Project></Export>']) {
    const input = f.put('input.xml', content), out = path.join(f.root, 'work');
    const result = await run('edit-export-xml.ps1', ['-InputXml', input, '-WorkDirectory', out]);
    assert.notEqual(result.code, 0); assert.equal(fs.existsSync(out), false);
  }
  const input = f.put('input.xml', packageXml), out = path.join(f.root, 'snapshot');
  const result = await run('export-iris-code.ps1', ['-Baseline', input, '-OutputDirectory', out, '-PlanOnly']);
  assert.notEqual(result.code, 0); assert.match(result.stderr.replace(/\r?\n/g, ''), /ProjectItem-catalog-required/); assert.equal(fs.existsSync(out), false);
});

function catalog(names) { return '<Export><Project name="Fixture"><Items>' + names.map(([name, type = 'CLS']) => `<ProjectItem name="${name}" type="${type}"/>`).join('') + '</Items></Project></Export>'; }
async function server(t, responder, options = {}) {
  const calls = [], service = http.createServer((req, res) => {
    calls.push({method: req.method, url: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization});
    if (req.method === 'HEAD') { res.setHeader('Set-Cookie', 'CSPSESSIONID=; Path=/api/atelier/; Max-Age=0'); res.writeHead(options.logoutStatus ?? 401); return res.end(); }
    if (/%2f/i.test(req.url)) { res.writeHead(404); return res.end(); }
    const cookie = options.cookies ? options.cookies(calls.filter(c => c.method === 'GET').length) : 'CSPSESSIONID=fixture; Path=/api/atelier/; HttpOnly';
    if (cookie) res.setHeader('Set-Cookie', cookie);
    responder(req, res);
  });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => service.close(resolve)));
  return {url: `http://127.0.0.1:${service.address().port}/api/atelier/`, calls};
}
const credential = "-Credential (New-Object PSCredential('fixture', (ConvertTo-SecureString 'fixture-secret' -AsPlainText -Force)))";
function send(res, name, lines) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({status: {errors: [], summary: ''}, result: {name, content: lines, enc: false, ts: '2026-10-28 00:00:00'}})); }

function sourceFixture(f, {legacy = false, partial = false} = {}) {
  const root = path.join(f.root, 'snapshot'), url = 'https://synthetic.invalid/api/atelier/', namespace = 'FIXTURE';
  const items = [['Demo.A.cls', 'src/Demo/A.cls', 'Class Demo.A\n{\nParameter Text = "BASE";\n}\n'], ['demo/a.js', 'src/demo/a.js', 'const text = "BASE";\n']].map(([document, relative, content]) => {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content);
    return {document, path: relative, sha256: crypto.createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content), status: 'fetched'};
  });
  if (partial) items.push({document: 'Demo.Missing.cls', path: 'src/Demo/Missing.cls', status: 'missing', sha256: null, bytes: 0});
  const state = {schema: 'iris-standalone-baseline/v1', target: crypto.createHash('sha256').update(url + '|' + namespace).digest('hex'), source: {atelierUrl: url, namespace},
    startedAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:01:00Z', state: partial ? 'partial' : 'complete', scriptHash: '0'.repeat(64), items};
  if (legacy) delete state.source;
  const stateFile = path.join(root, 'baseline-state.json'); fs.writeFileSync(stateFile, JSON.stringify(state));
  return {root, url, namespace, state, stateFile};
}

test('source handoff prepares portable originals and publishes only changed files with independent rollback verification', {skip: !windows}, async t => {
  const f = fixture(t), s = sourceFixture(f), moved = path.join(f.root, 'moved-snapshot');
  fs.renameSync(s.root, moved);
  const originalState = fs.readFileSync(path.join(moved, 'baseline-state.json')), original = fs.readFileSync(path.join(moved, 'src/Demo/A.cls'));
  let result = await run('source-delivery.ps1', ['-Mode', 'Prepare', '-ExportDirectory', moved]);
  assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).originalCount, 2);
  assert.deepEqual(fs.readFileSync(path.join(moved, '.baseline/src/Demo/A.cls')), original);
  const notes = f.put('notes.md', '修改 Demo.A 的 Text；JS 不变。'), output = path.join(f.root, 'delivery');
  result = await run('source-delivery.ps1', ['-Mode', 'Pack', '-ExportDirectory', moved, '-OutputDirectory', output]);
  assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).state, 'unchanged'); assert.equal(fs.existsSync(output), false);
  fs.writeFileSync(path.join(moved, 'src/Demo/A.cls'), original.toString().replace('BASE', 'EDIT'));
  result = await run('source-delivery.ps1', ['-Mode', 'Pack', '-ExportDirectory', moved, '-OutputDirectory', output, '-NotesFile', notes]);
  assert.equal(result.code, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.changedCount, 1); assert.equal(manifest.items[0].document, 'Demo.A.cls'); assert.deepEqual(manifest.source, {atelierUrl: s.url, namespace: s.namespace});
  assert.equal(manifest.observedFrom, s.state.startedAt); assert.equal(manifest.observedTo, s.state.updatedAt);
  assert.deepEqual(fs.readFileSync(path.join(output, 'rollback/src/Demo/A.cls')), original);
  assert.match(fs.readFileSync(path.join(output, 'changes/src/Demo/A.cls'), 'utf8'), /EDIT/);
  assert.equal(fs.existsSync(path.join(output, 'changes/src/demo/a.js')), false);
  assert.equal(fs.readFileSync(path.join(output, 'files.txt'), 'utf8'), 'Demo.A.cls\n');
  assert.deepEqual(fs.readFileSync(path.join(moved, 'baseline-state.json')), originalState);
  for (const args of [[], ['-ExportDirectory', moved]]) {
    result = await run('source-delivery.ps1', ['-Mode', 'Verify', '-OutputDirectory', output, ...args]);
    assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).targetDriftVerified, false);
  }
  const current = path.join(f.root, 'current'); fs.mkdirSync(current);
  fs.copyFileSync(path.join(moved, 'baseline-state.json'), path.join(current, 'baseline-state.json'));
  fs.cpSync(path.join(moved, '.baseline/src'), path.join(current, 'src'), {recursive: true});
  result = await run('source-delivery.ps1', ['-Mode', 'Verify', '-OutputDirectory', output, '-CurrentExportDirectory', current]);
  assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).currentSnapshot.matches, true);
  const currentCls = path.join(current, 'src/Demo/A.cls'); fs.appendFileSync(currentCls, '// server changed\n');
  const changedState = JSON.parse(fs.readFileSync(path.join(current, 'baseline-state.json'), 'utf8')); changedState.items[0].sha256 = crypto.createHash('sha256').update(fs.readFileSync(currentCls)).digest('hex'); changedState.items[0].bytes = fs.statSync(currentCls).size;
  fs.writeFileSync(path.join(current, 'baseline-state.json'), JSON.stringify(changedState));
  result = await run('source-delivery.ps1', ['-Mode', 'Verify', '-OutputDirectory', output, '-CurrentExportDirectory', current]);
  assert.equal(result.code, 1); assert.match(result.stderr, /current-source-differs-from-baseline/);
  fs.appendFileSync(path.join(output, 'rollback/src/Demo/A.cls'), '\n');
  result = await run('source-delivery.ps1', ['-Mode', 'Verify', '-OutputDirectory', output]);
  assert.equal(result.code, 1); assert.match(result.stderr, /delivery-file-drift/);
  assert.deepEqual(fs.readdirSync(f.root).filter(name => name.endsWith('.tmp')), []);
});

test('legacy complete exports require a matching human source and keep old receipt bytes and runtime hash intact', {skip: !windows}, async t => {
  const f = fixture(t), s = sourceFixture(f, {legacy: true}), before = fs.readFileSync(s.stateFile);
  let result = await run('source-delivery.ps1', ['-Mode', 'Prepare', '-ExportDirectory', s.root, '-AtelierUrl', s.url, '-Namespace', 'WRONG']);
  assert.equal(result.code, 1); assert.match(result.stderr, /source-target-mismatch/); assert.equal(fs.existsSync(path.join(s.root, '.baseline')), false);
  result = await run('source-delivery.ps1', ['-Mode', 'Prepare', '-ExportDirectory', s.root, '-AtelierUrl', s.url, '-Namespace', s.namespace]);
  assert.equal(result.code, 0, result.stderr); assert.deepEqual(fs.readFileSync(s.stateFile), before);
  const baseline = JSON.parse(fs.readFileSync(path.join(s.root, '.baseline/manifest.json'), 'utf8'));
  assert.deepEqual(baseline.source, {atelierUrl: s.url, namespace: s.namespace});
});

test('partial source export needs explicit acceptance and remains partial in its delivery', {skip: !windows}, async t => {
  const f = fixture(t), s = sourceFixture(f, {partial: true});
  let result = await run('source-delivery.ps1', ['-Mode', 'Prepare', '-ExportDirectory', s.root]);
  assert.equal(result.code, 1); assert.match(result.stderr, /incomplete-export/);
  result = await run('source-delivery.ps1', ['-Mode', 'Prepare', '-ExportDirectory', s.root, '-AllowPartial']);
  assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).complete, false);
  fs.appendFileSync(path.join(s.root, 'src/demo/a.js'), '// change\n');
  const notes = f.put('notes.md', '只修改已取得的 JS，明确缺少 Demo.Missing。'), output = path.join(f.root, 'delivery');
  result = await run('source-delivery.ps1', ['-Mode', 'Pack', '-ExportDirectory', s.root, '-OutputDirectory', output, '-NotesFile', notes]);
  assert.equal(result.code, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.completeSource, false); assert.equal(manifest.excluded[0].status, 'missing'); assert.equal(manifest.changedCount, 1);
});

test('source baseline refuses pre-edit drift, new/deleted files, class renames and damaged originals', {skip: !windows}, async t => {
  const f = fixture(t), s = sourceFixture(f), cls = path.join(s.root, 'src/Demo/A.cls'), original = fs.readFileSync(cls), output = path.join(f.root, 'delivery'), notes = f.put('notes.md', '调整源码。');
  fs.appendFileSync(cls, '// before preparation');
  let result = await run('source-delivery.ps1', ['-Mode', 'Prepare', '-ExportDirectory', s.root]);
  assert.equal(result.code, 1); assert.match(result.stderr, /source-changed-before-prepare/); assert.equal(fs.existsSync(path.join(s.root, '.baseline')), false);
  fs.writeFileSync(cls, original);
  assert.equal((await run('source-delivery.ps1', ['-Mode', 'Prepare', '-ExportDirectory', s.root])).code, 0);
  const extra = path.join(s.root, 'src/extra.js'); fs.writeFileSync(extra, 'new');
  const args = ['-Mode', 'Pack', '-ExportDirectory', s.root, '-OutputDirectory', output, '-NotesFile', notes];
  result = await run('source-delivery.ps1', args); assert.match(result.stderr, /source-file-set-changed/); fs.unlinkSync(extra);
  fs.unlinkSync(cls); result = await run('source-delivery.ps1', args); assert.match(result.stderr, /source-file-set-changed/);
  fs.writeFileSync(cls, original.toString().replace('Demo.A', 'Demo.B')); result = await run('source-delivery.ps1', args); assert.match(result.stderr, /class-identity-mismatch/);
  fs.writeFileSync(cls, original); fs.appendFileSync(path.join(s.root, '.baseline/src/Demo/A.cls'), 'broken');
  result = await run('source-delivery.ps1', args); assert.match(result.stderr, /original-baseline-drift/); assert.equal(fs.existsSync(output), false);
});

test('prepared originals block export Resume and source delivery validates notes, encoding and reread list scope', {skip: !windows}, async t => {
  const f = fixture(t), s = sourceFixture(f), cls = path.join(s.root, 'src/Demo/A.cls'), original = fs.readFileSync(cls), output = path.join(f.root, 'delivery');
  assert.equal((await run('source-delivery.ps1', ['-Mode', 'Prepare', '-ExportDirectory', s.root])).code, 0);
  let result = await run('source-delivery.ps1', ['-Mode', 'Prepare', '-ExportDirectory', s.root]);
  assert.equal(result.code, 1); assert.match(result.stderr, /development-baseline-already-exists/);
  const list = f.put('files.txt', 'Demo.A.cls');
  result = await run('export-iris-code.ps1', ['-ListFile', list, '-OutputDirectory', s.root, '-Resume']);
  assert.equal(result.code, 1); assert.match(result.stderr, /development-baseline-exists-do-not-resume/);
  const args = ['-Mode', 'Pack', '-ExportDirectory', s.root, '-OutputDirectory', output];
  fs.writeFileSync(cls, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]));
  result = await run('source-delivery.ps1', args); assert.match(result.stderr, /source-utf8-bom-forbidden/);
  fs.writeFileSync(cls, original.toString().replace('BASE', 'EDIT'));
  result = await run('source-delivery.ps1', args); assert.match(result.stderr, /NotesFile-required/); assert.equal(fs.existsSync(output), false);
  const notes = f.put('notes.md', '修改 Text。');
  result = await run('source-delivery.ps1', [...args, '-NotesFile', notes]); assert.equal(result.code, 0, result.stderr);
  result = await run('source-delivery.ps1', [...args, '-NotesFile', notes]); assert.match(result.stderr, /output-directory-must-be-new/);
  const manifestPath = path.join(output, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.writeFileSync(path.join(output, 'files.txt'), 'Demo.Other.cls\n');
  manifest.files['files.txt'] = crypto.createHash('sha256').update('Demo.Other.cls\n').digest('hex'); fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  result = await run('source-delivery.ps1', ['-Mode', 'Verify', '-OutputDirectory', output]);
  assert.equal(result.code, 1); assert.match(result.stderr, /delivery-list-scope-mismatch/);
});

test('standalone exporter saves UTF-8 source, excludes images, resumes in new process and protects local edits', {skip: !windows}, async t => {
  const f = fixture(t), baseline = f.put('scope.xml', catalog([['Demo.A'], ['Demo.B'], ['demo/a.js', 'CSP'], ['demo/a.png', 'CSP']])), out = path.join(f.root, 'snapshot');
  const s = await server(t, (req, res) => {
    const name = decodeURIComponent(req.url.split('/doc/')[1]);
    send(res, name, name.endsWith('.cls') ? [`Class ${name.slice(0, -4)}`, '{', 'Parameter Text = "中文";', '}'] : ['const x = "中文";']);
  });
  const args = ['-Baseline', baseline, '-OutputDirectory', out, '-AtelierUrl', s.url, '-Namespace', 'FIXTURE'];
  let result = await run('export-iris-code.ps1', [...args, '-PlanOnly']);
  assert.equal(result.code, 0, result.stderr); assert.equal(s.calls.length, 0); assert.equal(fs.existsSync(out), false);
  result = await run('export-iris-code.ps1', [...args, '-MaxFilesPerRun', '1'], credential);
  assert.equal(result.code, 2, result.stderr);
  result = await run('export-iris-code.ps1', [...args, '-Resume'], credential);
  assert.equal(result.code, 0, result.stderr);
  const stateFile = path.join(out, 'baseline-state.json'), state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.state, 'complete'); assert.equal(state.excludedImageCount, 1); assert.equal(state.licenseReleaseVerified, false);
  assert.equal(state.logoutHttpStatus, 401);
  assert.equal(s.calls.filter(c => c.method === 'GET').length, 3); assert.equal(s.calls.filter(c => c.method === 'HEAD').length, 2);
  assert.ok(s.calls.filter(c => c.method === 'HEAD').every(c => c.cookie && !c.authorization));
  assert.ok(s.calls.filter(c => c.method === 'GET' && c.cookie).every(c => !c.authorization));
  assert.match(fs.readFileSync(path.join(out, 'src/Demo/A.cls'), 'utf8'), /中文/);
  assert.deepEqual(state.source, {atelierUrl: s.url, namespace: 'FIXTURE'});
  assert.doesNotMatch(fs.readFileSync(stateFile, 'utf8'), /fixture-secret|CSPSESSIONID|Basic /);
  fs.writeFileSync(path.join(out, 'src/Demo/A.cls'), 'local change');
  const count = s.calls.length;
  result = await run('export-iris-code.ps1', [...args, '-Resume'], credential);
  assert.equal(result.code, 1); assert.match(result.stderr, /local-source-drift/); assert.equal(s.calls.length, count);
});

test('batch export keeps one authenticated session and reports logout separately from actual license release', {skip: !windows}, async t => {
  const f = fixture(t), names = Array.from({length: 48}, (_, i) => `Demo.B${i}.cls`), list = f.put('files.txt', names.join('\n')), out = path.join(f.root, 'snapshot');
  const s = await server(t, (req, res) => {
    const name = decodeURIComponent(req.url.split('/doc/')[1]); send(res, name, [`Class ${name.slice(0, -4)}`, '{', '}']);
  });
  const result = await run('export-iris-code.ps1', ['-ListFile', list, '-OutputDirectory', out, '-AtelierUrl', s.url, '-Namespace', 'FIXTURE', '-IntervalMs', '100'], credential);
  assert.equal(result.code, 0, result.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(out, 'baseline-state.json'), 'utf8'));
  assert.deepEqual(state.session, {cookieVerified: true, requestCount: 48, authenticationCount: 1});
  assert.equal(s.calls.filter(c => c.authorization).length, 1); assert.equal(s.calls.filter(c => c.method === 'HEAD').length, 1);
  assert.ok(s.calls.slice(1).every(c => c.cookie === 'CSPSESSIONID=fixture' && !c.authorization));
  assert.equal(state.logoutRequested, true); assert.equal(state.logoutResponseReceived, true); assert.equal(state.licenseReleaseVerified, false);
});

test('missing CSP cookies, unrelated affinity cookies and incompatible cookie paths stop after one authentication', {skip: !windows}, async t => {
  const f = fixture(t), list = f.put('files.txt', 'Demo.A.cls\nDemo.B.cls\nDemo.C.cls');
  for (const [i, cookie] of [null, 'AFFINITY=fixture; Path=/api/atelier/', 'CSPSESSIONID=fixture; Path=/api/atelier/v1/FIXTURE/doc/'].entries()) {
    const out = path.join(f.root, 'snapshot-' + i), s = await server(t, (req, res) => send(res, 'Demo.A.cls', ['Class Demo.A {}']), {cookies: () => cookie});
    const result = await run('export-iris-code.ps1', ['-ListFile', list, '-OutputDirectory', out, '-AtelierUrl', s.url, '-Namespace', 'FIXTURE'], credential);
    assert.equal(result.code, 2, result.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(out, 'baseline-state.json'), 'utf8'));
    assert.equal(state.reason, 'atelier-session-cookie-missing'); assert.equal(state.session.authenticationCount, 1);
    assert.equal(s.calls.length, 1); assert.equal(state.logoutRequested, false); assert.equal(state.logoutVerified, false);
    assert.equal(state.logoutReason, 'atelier-session-cookie-unavailable'); assert.equal(fs.existsSync(path.join(out, 'src/Demo/B.cls')), false);
  }
});

test('lost or changed session identity stops the next file and logs out only the observed owned sessions', {skip: !windows}, async t => {
  const f = fixture(t), list = f.put('files.txt', 'Demo.A.cls\nDemo.B.cls\nDemo.C.cls');
  for (const mode of ['lost', 'changed']) {
    const out = path.join(f.root, mode), s = await server(t, (req, res) => {
      const name = decodeURIComponent(req.url.split('/doc/')[1]); send(res, name, [`Class ${name.slice(0, -4)} {}`]);
    }, {cookies: count => count === 1 ? 'CSPSESSIONID=first; Path=/api/atelier/' : mode === 'lost' ? 'CSPSESSIONID=; Path=/api/atelier/; Max-Age=0' : 'CSPSESSIONID=second; Path=/api/atelier/'});
    const result = await run('export-iris-code.ps1', ['-ListFile', list, '-OutputDirectory', out, '-AtelierUrl', s.url, '-Namespace', 'FIXTURE'], credential);
    assert.equal(result.code, 2, result.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(out, 'baseline-state.json'), 'utf8')), exits = s.calls.filter(c => c.method === 'HEAD');
    assert.equal(state.reason, 'atelier-session-' + mode); assert.equal(state.session.cookieVerified, false);
    assert.equal(s.calls.filter(c => c.method === 'GET').length, 2); assert.equal(s.calls.filter(c => c.authorization).length, 1);
    assert.deepEqual(exits.map(c => c.cookie).sort(), mode === 'lost' ? ['CSPSESSIONID=first'] : ['CSPSESSIONID=first', 'CSPSESSIONID=second']);
    assert.ok(exits.every(c => !c.authorization)); assert.equal(state.logoutVerified, true); assert.equal(state.licenseReleaseVerified, false);
    assert.equal(state.items[0].status, 'fetched'); assert.equal(state.items[1].status, 'failed'); assert.equal(state.items[2].status, 'pending');
    assert.doesNotMatch(fs.readFileSync(path.join(out, 'baseline-state.json'), 'utf8'), /CSPSESSIONID|fixture-secret/);
  }
});

test('logout accepts only 2xx or the logout authentication challenge and Resume cannot clear an unknown prior exit', {skip: !windows}, async t => {
  const f = fixture(t), list = f.put('files.txt', 'Demo.A.cls');
  for (const status of [204, 302, 403, 404, 503]) {
    const out = path.join(f.root, 'snapshot-' + status), s = await server(t, (req, res) => send(res, 'Demo.A.cls', ['Class Demo.A {}']), {logoutStatus: status});
    const args = ['-ListFile', list, '-OutputDirectory', out, '-AtelierUrl', s.url, '-Namespace', 'FIXTURE'];
    let result = await run('export-iris-code.ps1', args, credential);
    assert.equal(result.code, status === 204 ? 0 : 2, result.stderr);
    const stateFile = path.join(out, 'baseline-state.json'), bytes = fs.readFileSync(stateFile), state = JSON.parse(bytes);
    assert.equal(state.items[0].status, 'fetched'); assert.equal(state.logoutHttpStatus, status);
    assert.equal(state.logoutResponseReceived, true); assert.equal(state.logoutVerified, status === 204);
    assert.equal(state.licenseReleaseVerified, false); assert.equal(s.calls.filter(c => c.method === 'HEAD').length, 1);
    if (status !== 204) {
      assert.equal(state.reason, 'atelier-logout-unverified'); assert.equal(state.logoutResults[0].reason, 'atelier-logout-http-' + status);
      const count = s.calls.length;
      result = await run('export-iris-code.ps1', [...args, '-Resume'], credential);
      assert.equal(result.code, 1); assert.match(result.stderr, /resume-previous-session-exit-unverified/);
      assert.equal(s.calls.length, count); assert.deepEqual(fs.readFileSync(stateFile), bytes);
    }
  }
});

test('transport diagnostics classify the exception chain without persisting raw messages or secrets', {skip: !windows}, async t => {
  const command = 'Add-Type -AssemblyName System.Net.Http; $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile(' + quote(script('export-iris-code.ps1')) + ',[ref]$tokens,[ref]$errors); ' +
    '$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Get-TransportDiagnostic"},$true); . ([scriptblock]::Create($definition.Extent.Text)); ' +
    '$secret="https://user:fixture-secret@example.invalid/path?token=hidden CSPSESSIONID=private Authorization: Basic private"; ' +
    '$cases=@((New-Object Security.Authentication.AuthenticationException($secret)),(New-Object Net.WebException($secret,[Net.WebExceptionStatus]::NameResolutionFailure)),(New-Object Net.Sockets.SocketException(10061)),(New-Object TimeoutException($secret,(New-Object Net.Sockets.SocketException(10053))))); ' +
    '$cases | ForEach-Object { Get-TransportDiagnostic (New-Object Net.Http.HttpRequestException($secret,$_)) } | ConvertTo-Json -Depth 8';
  const result = await invoke(command);
  assert.equal(result.code, 0, result.stderr);
  const diagnostics = JSON.parse(result.stdout);
  assert.deepEqual(diagnostics.map(d => d.category), ['tls', 'dns', 'connection', 'timeout-or-cancelled']);
  assert.ok(diagnostics.every(d => d.exceptionTypes.includes('System.Net.Http.HttpRequestException')));
  assert.ok(diagnostics[3].exceptionTypes.includes('System.TimeoutException'));
  assert.doesNotMatch(result.stdout, /fixture-secret|CSPSESSIONID|Authorization|example\.invalid|token=hidden/);
});

test('real connection refusal and request timeout retain the error code with safe transport diagnostics', {skip: !windows}, async t => {
  const f = fixture(t), list = f.put('files.txt', 'Demo.A.cls');
  const closed = http.createServer(); await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
  const closedUrl = `http://127.0.0.1:${closed.address().port}/api/atelier/`; await new Promise(resolve => closed.close(resolve));
  const slow = await server(t, (req, res) => { res.setHeader('Content-Type', 'application/json'); res.flushHeaders(); setTimeout(() => { if (!res.destroyed) res.end('{}'); }, 1500); });
  for (const [i, url, expected, timeout] of [[0, closedUrl, 'connection', 10], [1, slow.url, 'timeout-or-cancelled', 1]]) {
    const out = path.join(f.root, 'snapshot-' + i);
    const result = await run('export-iris-code.ps1', ['-ListFile', list, '-OutputDirectory', out, '-AtelierUrl', url, '-Namespace', 'FIXTURE', '-TimeoutSec', String(timeout)], credential);
    assert.equal(result.code, 2, result.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(out, 'baseline-state.json'), 'utf8'));
    assert.equal(state.reason, 'atelier-transport-or-timeout'); assert.equal(state.transportDiagnostic.category, expected);
    assert.equal(state.session.authenticationCount, 1); assert.equal(state.logoutVerified, i === 1);
    if (i === 1) assert.ok(slow.calls.some(c => c.method === 'HEAD' && c.cookie === 'CSPSESSIONID=fixture' && !c.authorization));
    assert.doesNotMatch(JSON.stringify(state.transportDiagnostic), /fixture-secret|CSPSESSIONID|127\.0\.0\.1|Authorization/);
  }
});

test('404/empty remain partial and 503 stops without retry while logging out its own session', {skip: !windows}, async t => {
  const f = fixture(t), baseline = f.put('scope.xml', catalog([['Demo.Missing'], ['Demo.Empty'], ['Demo.Stop'], ['Demo.Unsent']])), out = path.join(f.root, 'snapshot');
  const s = await server(t, (req, res) => {
    if (req.url.includes('Missing')) { res.writeHead(404); return res.end(); }
    if (req.url.includes('Empty')) return send(res, 'Demo.Empty.cls', []);
    res.writeHead(503); res.end();
  });
  const result = await run('export-iris-code.ps1', ['-Baseline', baseline, '-OutputDirectory', out, '-AtelierUrl', s.url, '-Namespace', 'FIXTURE'], credential);
  assert.equal(result.code, 2, result.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(out, 'baseline-state.json'), 'utf8'));
  assert.deepEqual(state.items.map(i => i.status), ['missing', 'empty', 'failed', 'pending']);
  assert.equal(state.reason, 'atelier-http-503'); assert.equal(s.calls.filter(c => c.method === 'GET').length, 3);
  assert.equal(s.calls.at(-1).method, 'HEAD');
});

test('unsafe paths, destination collisions and existing output are rejected without HTTP', {skip: !windows}, async t => {
  const f = fixture(t), out = path.join(f.root, 'snapshot');
  for (const names of [[['demo/../a.js', 'CSP']], [['Demo.A'], ['Demo/A.cls', 'CSP']], [['demo/CON.js', 'CSP']]]) {
    const baseline = f.put('scope.xml', catalog(names));
    const result = await run('export-iris-code.ps1', ['-Baseline', baseline, '-OutputDirectory', out, '-PlanOnly']);
    assert.equal(result.code, 1); assert.equal(fs.existsSync(out), false);
  }
});

test('UTF-8 text list exports exact backend and frontend names and rejects ambiguous formats', {skip: !windows}, async t => {
  const f = fixture(t), list = f.put('files.txt', '\uFEFF# UTF-8 list\r\nDemo.A.cls\r\nDemo.mac\r\nDemo.inc\r\nDemo.int\r\n/demo/a.js\r\n/demo/page.csp\r\n\r\n'), out = path.join(f.root, 'snapshot');
  const s = await server(t, (req, res) => {
    const name = decodeURIComponent(req.url.split('/doc/')[1]);
    send(res, name, [name.endsWith('.cls') ? 'Class Demo.A {}' : 'fixture source']);
  });
  const result = await run('export-iris-code.ps1', ['-ListFile', list, '-OutputDirectory', out, '-AtelierUrl', s.url, '-Namespace', 'FIXTURE'], credential);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(s.calls.filter(c => c.method === 'GET').map(c => decodeURIComponent(c.url.split('/doc/')[1])), ['Demo.A.cls', 'Demo.mac', 'Demo.inc', 'Demo.int', 'demo/a.js', 'demo/page.csp']);
  assert.ok(fs.existsSync(path.join(out, 'src/routines/Demo.mac')));
  assert.ok(fs.existsSync(path.join(out, 'src/demo/page.csp')));
  for (const name of ['demo/a.js', 'Demo.*.cls', 'C:\\src\\Demo.cls', 'Demo.A', '/demo/a.png', '/demo/../a.js']) {
    f.put('invalid.txt', name);
    const invalid = await run('export-iris-code.ps1', ['-ListFile', path.join(f.root, 'invalid.txt'), '-OutputDirectory', path.join(f.root, 'unused'), '-PlanOnly']);
    assert.equal(invalid.code, 1, name); assert.equal(fs.existsSync(path.join(f.root, 'unused')), false);
  }
});

test('exported sources complete the offline return flow and reject changed, missing or wrong-target onsite snapshots', {skip: !windows}, async t => {
  const f = fixture(t), list = f.put('files.txt', 'Demo.A.cls\nDemo.mac\n/demo/a.js\n/demo/page.csp\n'), out = path.join(f.root, 'snapshot');
  let onsite = 'original';
  const s = await server(t, (req, res) => {
    const name = decodeURIComponent(req.url.split('/doc/')[1]);
    if (name === 'demo/a.js' && onsite === 'missing') { res.writeHead(404); return res.end(); }
    const lines = {'Demo.A.cls': ['Class Demo.A', '{', 'Parameter Text = "BASE";', '}'], 'Demo.mac': ['Demo', ' quit'],
      'demo/a.js': ['const text = "' + (onsite === 'changed' ? 'SERVER' : 'BASE') + '";'], 'demo/page.csp': ['<p>BASE</p>']};
    send(res, name, lines[name]);
  });
  const connection = ['-AtelierUrl', s.url, '-Namespace', 'FIXTURE'];
  let result = await run('export-iris-code.ps1', ['-ListFile', list, '-OutputDirectory', out, ...connection], credential);
  assert.equal(result.code, 0, result.stderr);
  const callsAfterExport = s.calls.length;
  result = await run('source-delivery.ps1', ['-Mode', 'Prepare', '-ExportDirectory', out]);
  assert.equal(result.code, 0, result.stderr);
  for (const relative of ['src/Demo/A.cls', 'src/demo/a.js']) {
    const file = path.join(out, relative); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('BASE', 'EDIT'));
  }
  const notes = f.put('notes.md', '调整类参数及页面脚本；例程和 CSP 不变。'), output = path.join(f.root, 'delivery');
  result = await run('source-delivery.ps1', ['-Mode', 'Pack', '-ExportDirectory', out, '-OutputDirectory', output, '-NotesFile', notes]);
  assert.equal(result.code, 0, result.stderr); assert.equal(s.calls.length, callsAfterExport, 'offline operations must not send HTTP');
  const changedList = path.join(output, 'files.txt');
  assert.equal(fs.readFileSync(changedList, 'utf8'), 'Demo.A.cls\n/demo/a.js\n');
  for (const state of ['original', 'changed', 'missing']) {
    onsite = state;
    const current = path.join(f.root, 'current-' + state);
    result = await run('export-iris-code.ps1', ['-ListFile', changedList, '-OutputDirectory', current, ...connection], credential);
    assert.equal(result.code, state === 'missing' ? 2 : 0, result.stderr);
    const verify = ['-Mode', 'Verify', '-OutputDirectory', output, '-CurrentExportDirectory', current];
    result = await run('source-delivery.ps1', verify);
    if (state === 'original') {
      assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).currentSnapshot.matches, true);
      const js = path.join(current, 'src/demo/a.js'), original = fs.readFileSync(js);
      fs.appendFileSync(js, '// edited snapshot');
      result = await run('source-delivery.ps1', verify);
      assert.equal(result.code, 1); assert.match(result.stderr, /current-export-file-drift/); fs.writeFileSync(js, original);
      const receiptFile = path.join(current, 'baseline-state.json'), receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
      receipt.target = 'f'.repeat(64); fs.writeFileSync(receiptFile, JSON.stringify(receipt));
      result = await run('source-delivery.ps1', verify);
      assert.equal(result.code, 1); assert.match(result.stderr, /current-export-target-mismatch/);
    } else {
      assert.equal(result.code, 1); assert.match(result.stderr, state === 'changed' ? /current-source-differs-from-baseline/ : /current-source-not-fetched/);
    }
  }
});

test('relative inputs and outputs follow PowerShell Set-Location rather than the process directory', {skip: !windows}, async t => {
  const f = fixture(t);
  f.put('files.txt', 'Demo.A.cls'); f.put('export.xml', packageXml); f.put('notes.md', '修改 Hello。');
  const prefix = 'Set-Location -LiteralPath ' + quote(f.root) + '; & ';
  let result = await invoke(prefix + quote(script('export-iris-code.ps1')) + ' -ListFile .\\files.txt -OutputDirectory .\\snapshot -PlanOnly; if (-not $?) { exit 1 }');
  assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).total, 1);
  result = await invoke(prefix + quote(script('edit-export-xml.ps1')) + ' -InputXml .\\export.xml -WorkDirectory .\\edit; if (-not $?) { exit 1 }');
  assert.equal(result.code, 0, result.stderr); assert.ok(fs.existsSync(path.join(f.root, 'edit/package.xml')));
  const edited = path.join(f.root, 'edit/objects/000001.xml'); fs.writeFileSync(edited, fs.readFileSync(edited, 'utf8').replace('原始', '修改'));
  result = await invoke(prefix + quote(script('edit-export-xml.ps1')) + ' -Mode Pack -WorkDirectory .\\edit -NotesFile .\\notes.md -OutputDirectory .\\delivery; if (-not $?) { exit 1 }');
  assert.equal(result.code, 0, result.stderr); assert.equal(parseExportXml(fs.readFileSync(path.join(f.root, 'delivery/changes.xml'))).items.length, 1);
});

function versionFixture(f, {mixed = false} = {}) {
  const directory = path.join(f.root, 'catalogs'); fs.mkdirSync(directory);
  const text = 'Demo.A.cls\n' + (mixed ? '/scripts/a.js' : '/demo/a.js') + '\n';
  fs.writeFileSync(path.join(directory, 'v1.0.txt'), text);
  const index = {schema: 'iris-version-catalogs/v1', entries: [{version:'v1.0',scope:'doctor',scopeLabel:'医生站',project:'Fixture',sourcePath:'synthetic.xml',sourceSha256:'a'.repeat(64),
    rawItemCount:2,duplicateCount:0,excludedImages:[],codeCount:2,webRoots:mixed?['/scripts/','/demo/']:['/demo/'],webPathsNeedConfirmation:mixed,
    listFile:'v1.0.txt',listSha256:crypto.createHash('sha256').update(text).digest('hex')}]};
  fs.writeFileSync(path.join(directory,'index.json'), JSON.stringify(index)); return directory;
}
test('all packaged version catalogs pass offline planning with scope and mixed Web paths disclosed', {skip: !windows}, async t => {
  const f = fixture(t), output = path.join(f.root,'snapshot');
  let result = await run('export-version-baseline.ps1', ['-ListVersions']);
  assert.equal(result.code,0,result.stderr); assert.equal(JSON.parse(result.stdout).length,5);
  for (const [version, count, scope] of [['v8.4',1296,'doctor'],['v8.5',1520,'doctor'],['v9.0',1745,'doctor'],['v9.1',3295,'doctor'],['v9.2',5352,'all-products']]) {
    result = await run('export-version-baseline.ps1', ['-Version',version,'-Scope',scope,'-OutputDirectory',output,'-PlanOnly']);
    assert.equal(result.code,0,result.stderr); const preview=JSON.parse(result.stdout);
    assert.equal(preview.total,count); assert.equal(preview.webPathsNeedConfirmation,version==='v9.1'); assert.equal(fs.existsSync(output),false);
    assert.equal(preview.selection.meaning,'version-defines-scope-content-from-current-instance');
  }
  for (const version of ['v9.2','v9.9']) {
    result=await run('export-version-baseline.ps1',['-Version',version,'-OutputDirectory',output,'-PlanOnly']);
    assert.equal(result.code,1); assert.match(result.stderr, version==='v9.2'?/scope-mismatch/:/not-available-no-fallback/);
  }
});
test('version export merges hospital supplements, preserves selection provenance and resumes without a framework or Node', {skip: !windows}, async t => {
  const f=fixture(t), catalogs=versionFixture(f), output=path.join(f.root,'snapshot'), supplement=f.put('extra.txt','\uFEFF# local scope\nDemo.B.cls\n/demo/a.js\n');
  const s=await server(t,(req,res)=>{const name=decodeURIComponent(req.url.split('/doc/')[1]);send(res,name,name.endsWith('.cls')?[`Class ${name.slice(0,-4)} {}`]:['const value=1;']);});
  const args=['-CatalogDirectory',catalogs,'-Version','v1.0','-SupplementListFile',supplement,'-OutputDirectory',output,'-AtelierUrl',s.url,'-Namespace','FIXTURE'];
  let result=await run('export-version-baseline.ps1',[...args,'-MaxFilesPerRun','1'],credential);
  assert.equal(result.code,2,result.stderr);
  const stateFile=path.join(output,'baseline-state.json'), first=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  assert.equal(first.versionSelection.version,'v1.0'); assert.equal(first.versionSelection.selectedFileCount,3); assert.equal(first.versionSelection.mergedDuplicateCount,1);
  assert.equal(first.items.filter(i=>i.status==='fetched').length,1); assert.match(first.versionSelectionHash,/^[a-f0-9]{64}$/);
  // Resume in an independent process with no Node executable on PATH.
  const command='$env:PATH=$env:SystemRoot+"\\System32;"+$env:SystemRoot+"\\System32\\WindowsPowerShell\\v1.0"; if(Get-Command node -ErrorAction SilentlyContinue){throw "unexpected-node-on-path"}; & '+quote(script('export-version-baseline.ps1'))+' '+[...args,'-Resume'].map(v=>/^-[A-Za-z]+$/.test(v)?v:quote(v)).join(' ')+' '+credential+'; if(-not $?){exit $LASTEXITCODE}';
  result=await invoke(command); assert.equal(result.code,0,result.stderr);
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8')); assert.equal(state.state,'complete'); assert.equal(state.versionSelectionHash,first.versionSelectionHash);
  assert.deepEqual(s.calls.filter(c=>c.method==='GET').map(c=>decodeURIComponent(c.url.split('/doc/')[1])),['Demo.A.cls','demo/a.js','Demo.B.cls']);
  f.put('extra.txt','# changed provenance\nDemo.B.cls\n/demo/a.js\n'); const before=s.calls.length;
  result=await run('export-version-baseline.ps1',[...args,'-Resume'],credential);
  assert.equal(result.code,1); assert.match(result.stderr,/resume-version-selection-mismatch/); assert.equal(s.calls.length,before);
});
test('Web mappings are explicit and previewed, mixed paths require acknowledgement and collisions are reported', {skip: !windows}, async t => {
  const f=fixture(t), catalogs=versionFixture(f,{mixed:true}), output=path.join(f.root,'snapshot'), map=f.put('web-map.json',JSON.stringify([{from:'/scripts/',to:'/demo/'}]));
  const args=['-CatalogDirectory',catalogs,'-Version','v1.0','-OutputDirectory',output,'-WebPathMapFile',map];
  let result=await run('export-version-baseline.ps1',[...args,'-PlanOnly']);
  assert.equal(result.code,0,result.stderr); const preview=JSON.parse(result.stdout);
  assert.equal(preview.mappedItemCount,1); assert.ok(preview.sample.includes('/demo/a.js')); assert.equal(preview.webPathsNeedConfirmation,true);
  result=await run('export-version-baseline.ps1',args);
  assert.equal(result.code,1); assert.match(result.stderr,/web-paths-confirmation-required/); assert.equal(fs.existsSync(output),false);
  const s=await server(t,(req,res)=>{const name=decodeURIComponent(req.url.split('/doc/')[1]);send(res,name,name.endsWith('.cls')?['Class Demo.A {}']:['source']);});
  result=await run('export-version-baseline.ps1',[...args,'-ConfirmWebPaths','-AtelierUrl',s.url,'-Namespace','FIXTURE'],credential);
  assert.equal(result.code,0,result.stderr); assert.ok(s.calls.some(c=>c.url.endsWith('/doc/demo/a.js')));
  const extra=f.put('extra.txt','/demo/A.js');
  result=await run('export-version-baseline.ps1',[...args,'-SupplementListFile',extra,'-PlanOnly']);
  assert.equal(result.code,1); assert.match(result.stderr,/case-conflict/);
  fs.appendFileSync(path.join(catalogs,'v1.0.txt'),'Demo.Tampered.cls\n');
  result=await run('export-version-baseline.ps1',[...args,'-PlanOnly']);
  assert.equal(result.code,1); assert.match(result.stderr,/version-catalog-drift/);
});
