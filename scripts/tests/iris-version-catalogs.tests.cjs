'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {generate, compileCatalog, packageSources, helperSource} = require('../../tools/iris-code-export/build-catalogs');
const xml = nodes => '<Export><Project name="Fixture"><Items>' + nodes + '</Items></Project></Export>';
test('packaged version scopes and normalized lists remain bound to the original catalogs', () => {
  const {index, files} = generate();
  assert.deepEqual(index.entries.map(e => [e.version, e.scope, e.codeCount, e.duplicateCount]), [
    ['v8.4','doctor',1296,75], ['v8.5','doctor',1520,74], ['v9.0','doctor',1745,82], ['v9.1','doctor',3295,0], ['v9.2','all-products',5352,0]
  ]);
  for (const e of index.entries) {
    assert.equal(crypto.createHash('sha256').update(files.get(e.listFile)).digest('hex'), e.listSha256);
    assert.equal(e.rawItemCount, e.codeCount + e.duplicateCount + e.excludedImages.length);
    assert.equal(new Set(files.get(e.listFile).toString('utf8').trim().split('\n')).size, e.codeCount);
  }
  assert.deepEqual(index.entries[3].webRoots, ['/imedical/web/', '/scripts/', '/web/']);
  assert.equal(index.entries[3].webPathsNeedConfirmation, true);
  assert.equal(index.entries[4].scopeLabel, '全仓 10 个产品');
  assert.deepEqual([...generate().files], [...files], 'build data must be reproducible');
});
test('normalization removes only identical identities and reports binary exclusions', () => {
  const compiled = compileCatalog(xml('<ProjectItem name="Demo.A.cls" type="CLS"/><ProjectItem name="Demo.A" type="CLS"/><ProjectItem name="/demo/a.png" type="CSP"/><ProjectItem name="demo/a.js" type="CSP"/>'));
  assert.deepEqual(compiled.items, ['Demo.A.cls','/demo/a.js']);
  assert.equal(compiled.duplicateCount, 1); assert.deepEqual(compiled.excludedImages, ['/demo/a.png']);
  assert.throws(() => compileCatalog(xml('<ProjectItem name="demo/A.js" type="CSP"/><ProjectItem name="demo/a.js" type="CSP"/>')), /case-conflict/);
  for (const input of ['<!DOCTYPE Export><Export/>', xml('<ProjectItem name="../a.js" type="CSP"/>'), '<Export><Class name="Demo.A"/></Export>', xml('<ProjectItem name="Demo.A" type="CLS"><Data/></ProjectItem>')]) assert.throws(() => compileCatalog(input));
});
test('package staging contains no Node runtime or framework and copies the unique source helper', t => {
  const parent = process.env.CODEX_TEST_TMP_ROOT || path.join(os.tmpdir(), 'Codex'); fs.mkdirSync(parent, {recursive: true});
  const root = fs.mkdtempSync(path.join(parent, 'iris-version-build-'));
  t.after(() => { assert.equal(fs.lstatSync(root).isSymbolicLink(), false); fs.rmSync(root, {recursive: true, force: true}); });
  const target = path.join(root, 'package'); packageSources(target);
  assert.deepEqual(fs.readdirSync(target).sort(), ['README.md','catalogs','export-iris-code.ps1','export-version-baseline.ps1','files.example.txt','images','source-delivery.ps1'].sort());
  assert.deepEqual(fs.readFileSync(path.join(target,'source-delivery.ps1')), fs.readFileSync(helperSource()));
  assert.throws(() => packageSources(target), /must-be-new/);
});
