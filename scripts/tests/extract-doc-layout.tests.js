'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const parser = path.join(repo, 'plugins/extract-doc/scripts/extract-doc-ingest.py');
const python = spawnSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
const loader = [
  'import importlib.util, json, sys',
  'from pathlib import Path',
  'spec = importlib.util.spec_from_file_location("extract_output_test", sys.argv[1])',
  'mod = importlib.util.module_from_spec(spec)',
  'sys.modules[spec.name] = mod',
  'spec.loader.exec_module(mod)',
  'print(str(mod.resolve_output_root(Path(sys.argv[2]), json.loads(sys.argv[3]))))',
].join('\n');
function write(file, body) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); }
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'extract-layout-'));
  t.after(() => {
    function removeLinks(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) fs.unlinkSync(file);
        else if (entry.isDirectory()) removeLinks(file);
      }
    }
    removeLinks(root);
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function configure(root, enabled = true, status = 'enabled') {
  write(path.join(root, '.agents/config/documentation-layout.json'), JSON.stringify({
    schema: 'imedical-documentation-layout/v1', enabled, workspaceRoot: root, extensions: []
  }));
  write(path.join(root, '.agents/config/plugin_profile.md'), '| extract-doc | ' + status + ' | fixture |\n');
  write(path.join(root, '.agents/plugins/extract-doc/.agents-plugin/plugin.json'), fs.readFileSync(path.join(repo, 'plugins/extract-doc/.agents-plugin/plugin.json')));
}
function run(root, explicit = null, noNode = false) {
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' };
  if (noNode) {
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
    env.PATH = '';
  }
  return spawnSync(python, ['-B', '-c', loader, parser, root, JSON.stringify(explicit)], { encoding: 'utf8', env, windowsHide: true, timeout: 30000 });
}
test('ungoverned and disabled document defaults preserve legacy paths without Node', t => {
  const root = fixture(t);
  let result = run(root, null, true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(root, 'docs/interface'));
  assert.deepEqual(fs.readdirSync(root), []);
  configure(root, false);
  result = run(root, null, true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(root, 'docs/interface'));
  assert.equal(fs.existsSync(path.join(root, 'docs')), false);
});
test('explicit output roots bypass governance resolution and preserve caller choice', t => {
  const root = fixture(t);
  write(path.join(root, '.agents/config/documentation-layout.json'), '{invalid');
  const result = run(root, 'docs/custom', true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(root, 'docs/custom'));
  assert.equal(fs.existsSync(path.join(root, 'docs')), false);
});
test('enrolled document defaults resolve the owner declaration without creating directories', t => {
  const root = fixture(t);
  configure(root);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(root, 'docs/modules/interfaces'));
  assert.equal(fs.existsSync(path.join(root, 'docs')), false);
});
test('enrolled documents fail closed on missing Node, invalid config or a disabled owner', t => {
  const root = fixture(t);
  configure(root);
  let result = run(root, null, true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Node\.js/);
  configure(root, true, 'disabled');
  result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not enabled|missing/i);
  write(path.join(root, '.agents/config/documentation-layout.json'), JSON.stringify({
    schema: 'imedical-documentation-layout/v1', enabled: true, workspaceRoot: path.dirname(root), extensions: []
  }));
  result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid documentation/);
  assert.equal(fs.existsSync(path.join(root, 'docs')), false);
});
test('linked metadata and governed output roots cannot redirect resolution to another workspace', t => {
  const base = fixture(t), root = path.join(base, 'project'), outside = path.join(base, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside); configure(root);
  fs.mkdirSync(path.join(root, 'docs/modules'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'docs/modules/interfaces'), process.platform === 'win32' ? 'junction' : 'dir');
  let result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Linked|special|reparse/i);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(path.join(root, 'docs/modules/interfaces'));
  const file = path.join(root, '.agents/config/documentation-layout.json');
  const foreign = path.join(outside, 'layout.json');
  fs.renameSync(file, foreign);
  fs.linkSync(foreign, file);
  result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Linked layout metadata/);
});
test('custom Overlay context location can stay ungoverned without Node', t => {
  const root = fixture(t);
  write(path.join(root, '.agents/capability.json'), JSON.stringify({ contextRoot: '.context' }));
  write(path.join(root, '.context/config/documentation-layout.json'), JSON.stringify({
    schema: 'imedical-documentation-layout/v1', enabled: false, workspaceRoot: root, extensions: []
  }));
  const result = run(root, null, true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(root, 'docs/interface'));
});
test('real ingest uses the enrolled root and explicit override without changing artifact schema', t => {
  const root = fixture(t); configure(root);
  const source = path.join(root, 'fixture.docx');
  const generated = spawnSync(python, ['-B', '-c', "import sys, zipfile\nwith zipfile.ZipFile(sys.argv[1], 'w') as doc:\n doc.writestr('[Content_Types].xml', '<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>')\n doc.writestr('_rels/.rels', '<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>')\n doc.writestr('word/document.xml', '<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Fixture documentation</w:t></w:r></w:p></w:body></w:document>')", source], { encoding: 'utf8', windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr);
  for (const explicit of [null, 'docs/custom']) {
    const args = ['-B', parser, '--file', source, '--project-root', root];
    if (explicit) args.push('--output-root', explicit);
    const result = spawnSync(python, args, { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }, windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    const directory = path.join(root, explicit || 'docs/modules/interfaces', 'fixture');
    for (const file of ['source.md', 'parsed.json', 'fields.md', 'diagnostics.md']) assert.equal(fs.existsSync(path.join(directory, file)), true, file);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'parsed.json'))).schemaVersion, 'extract-doc/v1');
  }
});
test('interface instructions reuse extracted paths and keep one directory declaration owner', () => {
  const read = file => fs.readFileSync(path.join(repo, file), 'utf8');
  const manifest = JSON.parse(read('plugins/iris-interface-dev/.agents-plugin/plugin.json'));
  assert.equal(manifest.projectDirectories, undefined);
  assert.match(read('plugins/iris-interface-dev/skills/iris-interface-dev-plan/SKILL.md'), /实际.*parsed\.json.*所在目录/);
  assert.match(read('plugins/iris-interface-dev/templates/iris_interface_profile.template.md'), /outputRoot: auto/);
  assert.match(read('plugins/iris-interface-dev/skills/iris-interface-doc-ingest/SKILL.md'), /省略.*--output-root/);
});
