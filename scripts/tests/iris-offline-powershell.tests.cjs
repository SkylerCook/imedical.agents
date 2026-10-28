'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {parseExportXml} = require('../../plugins/coding-iris-plugin/scripts/iris-tools/xml-package-core');
const windows = process.platform === 'win32';
const shell = process.env.IRIS_TEST_POWERSHELL || 'powershell.exe';
const repository = path.resolve(__dirname, '../..');
let portableRoot, portableParent;
const script = name => name === 'export-iris-code.ps1' ? path.join(portableRoot, name) : path.join(repository, 'plugins/coding-iris-plugin/scripts/iris-tools', name);
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
  const names = ['README.md', 'export-iris-code.ps1', 'files.example.txt'].sort();
  assert.deepEqual(fs.readdirSync(target).sort(), [...names, 'images'].sort(), 'ZIP must contain only the human export tool and its documentation image');
  assert.deepEqual(fs.readdirSync(path.join(target, 'images')), ['project-layout-example.png']);
  assert.deepEqual(fs.readFileSync(path.join(target, 'images/project-layout-example.png')), fs.readFileSync(path.join(repository, 'tools/iris-code-export/images/project-layout-example.png')), 'ZIP documentation image mismatch');
  for (const name of names) {
    if (name !== 'README.md') assert.deepEqual(fs.readFileSync(path.join(target, name)), fs.readFileSync(path.join(repository, 'tools/iris-code-export', name)), 'ZIP/source mismatch: ' + name);
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
async function server(t, responder) {
  const calls = [], service = http.createServer((req, res) => {
    calls.push({method: req.method, url: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization});
    if (req.method === 'HEAD') { res.setHeader('Set-Cookie', 'CSPSESSIONID=; Path=/api/atelier/; Max-Age=0'); res.writeHead(401); return res.end(); }
    if (/%2f/i.test(req.url)) { res.writeHead(404); return res.end(); }
    res.setHeader('Set-Cookie', 'CSPSESSIONID=fixture; Path=/api/atelier/; HttpOnly');
    responder(req, res);
  });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => service.close(resolve)));
  return {url: `http://127.0.0.1:${service.address().port}/api/atelier/`, calls};
}
const credential = "-Credential (New-Object PSCredential('fixture', (ConvertTo-SecureString 'fixture-secret' -AsPlainText -Force)))";
function send(res, name, lines) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({status: {errors: [], summary: ''}, result: {name, content: lines, enc: false, ts: '2026-10-28 00:00:00'}})); }

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
  assert.doesNotMatch(fs.readFileSync(stateFile, 'utf8'), /fixture-secret|127\.0\.0\.1|CSPSESSIONID/);
  fs.writeFileSync(path.join(out, 'src/Demo/A.cls'), 'local change');
  const count = s.calls.length;
  result = await run('export-iris-code.ps1', [...args, '-Resume'], credential);
  assert.equal(result.code, 1); assert.match(result.stderr, /local-source-drift/); assert.equal(s.calls.length, count);
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
