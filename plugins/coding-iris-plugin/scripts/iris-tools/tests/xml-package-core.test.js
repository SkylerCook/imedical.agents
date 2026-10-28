'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('../xml-package-core');
const project = items => '<Export><Project name="Test"><Items>' + items + '</Items></Project></Export>';

test('ProjectItem parsing preserves entity content, independent attribute order and explicit types', () => {
  assert.deepEqual(core.parseProjectItems(project("<ProjectItem type='CLS' name='Demo.Sample'/><ProjectItem name='web/a&amp;b.js' type='CSP'></ProjectItem>")),
    [{name: 'Demo.Sample', type: 'CLS'}, {name: 'web/a&b.js', type: 'CSP'}]);
  assert.equal(core.parseProjectItems(fs.readFileSync(path.resolve(__dirname, '../../../../..', 'docs/reference/project-export-map/doctor/prj_v9.2.xml'))).length, 5352);
});
test('malformed XML, DTD, unbound entities and resource abuse fail before producing a scope', () => {
  for (const xml of [project('<ProjectItem name="A" name="B" type="CLS"/>'), project('<ProjectItem name="&unknown;" type="CLS"/>'),
    '<!DOCTYPE Export SYSTEM "file:///not-read">' + project('<ProjectItem name="A" type="CLS"/>'), project('<ProjectItem name="A" type="CLS"></Items>')]) {
    assert.throws(() => core.parseProjectItems(xml));
  }
  assert.throws(() => core.parseXml('<a><b><c/></b></a>', {maxDepth: 2}), /structure-limit/);
  assert.throws(() => core.parseXml('<a/>', {maxBytes: 3}), /size-limit/);
  assert.throws(() => core.parseXml(Buffer.from([0xc0, 0x80])), /utf8-required/);
});
test('document normalization rejects range expansion and traversal, including new output targets', () => {
  for (const name of ['../outside.js', 'web/../../outside.js', 'C:/outside.js', 'web//a.js', 'web/a,b.js', 'web/*.js', 'web/a.js\n']) {
    assert.throws(() => core.normalizeDocument({name, type: 'CSP'}));
  }
  assert.equal(core.normalizeDocument({name: '%Library.Sample', type: 'CLS'}).document, '%Library.Sample.cls');
  assert.throws(() => core.parseProjectItems(project('<ProjectItem name="A" type="CLS"/><ProjectItem name="A.cls" type="CLS"/>')), /duplicate-project-item/);
});
test('compact Class, Routine and Web entries are parsed without line-based tag assumptions', () => {
  const xml = '<Export generator="IRIS" version="26"><Class name="A"/><Class name="B"/><Routine type="MAC" name="TEST"><![CDATA[TEST ; ]]>x</Routine><CSP application="/web/" name="a.js"><![CDATA[const text="</CSP>";]]></CSP></Export>';
  const parsed = core.validatePackage(xml, [{name: 'A', type: 'CLS'}, {name: 'B', type: 'CLS'}, {name: 'TEST', type: 'MAC'}, {name: 'web/a.js', type: 'CSP'}]);
  assert.equal(parsed.items.length, 4);
  assert.equal(parsed.items[3].payloadBytes.toString(), 'const text="</CSP>";');
});
test('binary Web payload bytes and hashes survive parsing and invalid Base64 is rejected', () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0x10]);
  const xml = '<Export><CSPBase64 name="image.png" application="/web/">\n' + bytes.toString('base64') + '\n</CSPBase64></Export>';
  const item = core.validatePackage(xml, [{name: 'web/image.png', type: 'CSP'}]).items[0];
  assert.deepEqual(item.payloadBytes, bytes);
  assert.equal(item.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.throws(() => core.parseExportXml(xml.replace(bytes.toString('base64'), '%%%=')), /invalid-csp-base64/);
});
test('Web item identity always joins application and relative name without swallowing directories', () => {
  const nested = '<Export><CSP application="/web/" name="web/a.js">text</CSP></Export>';
  assert.equal(core.parseExportXml(nested).items[0].identity, 'CSP:web/web/a.js');
  assert.throws(() => core.validatePackage(nested, [{name: 'web/a.js', type: 'CSP'}]), /scope-mismatch/);
  assert.throws(() => core.parseExportXml(nested.replace('name="web/a.js"', 'name="/web/a.js"')), /invalid-csp-entry/);
});
test('missing, extra and duplicate objects cannot be called a complete package', () => {
  const one = '<Export><Class name="A"/></Export>';
  assert.throws(() => core.validatePackage(one, [{name: 'A', type: 'CLS'}, {name: 'B', type: 'CLS'}]), /scope-mismatch/);
  assert.throws(() => core.validatePackage(one, [{name: 'B', type: 'CLS'}]), /scope-mismatch/);
  assert.throws(() => core.parseExportXml('<Export><Class name="A"/><Class name="A"/></Export>'), /duplicate-export-item/);
  assert.throws(() => core.parseExportXml('<Export/>'), /empty-export/);
});
test('vendored runtime files match the fixed provenance hashes', () => {
  const root = path.resolve(__dirname, '../../../../../vendor/xml-parser');
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'upstream.json'), 'utf8'));
  for (const [file, expected] of Object.entries(provenance.files)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), expected, file);
  }
});
