'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const catalog = require('../baseline-catalog');

function fixture(t) {
    const parent = path.resolve(process.env.CODEX_TEST_TMP_ROOT || path.join(os.tmpdir(), 'Codex'));
    fs.mkdirSync(parent, {recursive: true});
    const root = path.join(parent, 'baseline-catalog-' + crypto.randomUUID()); fs.mkdirSync(root);
    t.after(() => { assert.equal(path.dirname(root), parent); assert.equal(fs.lstatSync(root).isSymbolicLink(), false); fs.rmSync(root, {recursive: true, force: true}); });
    function put(relative, text) { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); return file; }
    return {root, put};
}

test('offline catalog reads declared classes, counts all excluded images and needs no local Git', t => {
    const f = fixture(t);
    f.put('src/backend/product/not-the-class.cls', 'Class Demo.Actual\n{\n}\n');
    f.put('src/backend/product/UTILITY.mac', 'ROUTINE UTILITY\n');
    f.put('src/backend/product/build.js', 'backend tooling is not a Web document');
    f.put('src/frontend/product/csp/main.csp', '<html>测试</html>');
    f.put('src/frontend/product/images/a.png', Buffer.from([0, 1, 2]));
    f.put('src/frontend/product/images/b.svg', '<svg/>');
    f.put('scripts/unrelated.js', 'must not enter the catalog');
    const out = path.join(f.root, 'catalog.xml');
    const result = catalog.build({projectRoot: f.root, out, webBase: 'fixture/web', projectName: 'Catalog'});
    assert.equal(result.state, 'built'); assert.equal(result.total, 3); assert.equal(result.excludedImageCount, 2);
    assert.deepEqual(catalog.readItems(out).map(item => item.name).sort(), ['Demo.Actual', 'UTILITY', 'fixture/web/csp/main.csp'].sort());
    assert.equal(fs.existsSync(path.join(f.root, '.git')), false);
});

test('catalog dry run neither creates output nor hides unknown declarations and duplicate identities', t => {
    const f = fixture(t), out = path.join(f.root, 'catalog.xml');
    f.put('src/backend/one.cls', 'Class Demo.Actual\n{}');
    let result = catalog.build({projectRoot: f.root, out, dryRun: true});
    assert.equal(result.state, 'planned'); assert.equal(fs.existsSync(out), false);
    f.put('src/backend/two.cls', 'Class Demo.Actual\n{}');
    f.put('src/backend/broken.cls', 'not a declared class');
    result = catalog.build({projectRoot: f.root, out});
    assert.equal(result.state, 'blocked'); assert.equal(result.duplicateCount, 1); assert.equal(result.unresolvedCount, 1);
    assert.equal(fs.existsSync(out), false);
});

test('catalog membership compares name and type, not just name', t => {
    const f = fixture(t);
    const left = f.put('left.xml', catalog.buildXml([{name: 'Demo', type: 'MAC'}, {name: 'Demo', type: 'INC'}]));
    const right = f.put('right.xml', catalog.buildXml([{name: 'Demo', type: 'MAC'}, {name: 'Other', type: 'CLS'}]));
    const result = catalog.compare({left, right});
    assert.equal(result.common, 1); assert.deepEqual(result.removed, [{name: 'Demo', type: 'INC'}]);
    assert.deepEqual(result.added, [{name: 'Other', type: 'CLS'}]); assert.equal(result.comparison, 'document-membership-only');
});

test('images-only scope is reported without emitting an empty replacement catalog', t => {
    const f = fixture(t), out = f.put('existing.xml', 'keep existing catalog');
    f.put('src/frontend/images/a.png', 'binary-placeholder');
    const result = catalog.build({projectRoot: f.root, out});
    assert.equal(result.state, 'empty'); assert.equal(result.excludedImageCount, 1);
    assert.equal(fs.readFileSync(out, 'utf8'), 'keep existing catalog');
});

test('XML output escapes attribute data and atomic output refuses symlink paths', t => {
    const f = fixture(t);
    const xml = catalog.buildXml([{name: 'fixture/web/a&b.js', type: 'CSP'}], {projectName: 'A&B'});
    assert.deepEqual(require('../xml-package-core').parseProjectItems(xml), [{name: 'fixture/web/a&b.js', type: 'CSP'}]);
    const target = f.put('target.xml', 'keep'), link = path.join(f.root, 'linked.xml');
    try { fs.symlinkSync(target, link); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return; throw error; }
    assert.throws(() => catalog.writeAtomic(link, 'overwrite'), /baseline-linked-path/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
});

test('raw catalog bytes reach the shared fatal UTF-8 decoder before comparison or capture planning', t => {
    const f = fixture(t), xml = catalog.buildXml([{name: 'Demo.A', type: 'CLS'}]);
    const invalid = f.put('invalid.xml', Buffer.concat([Buffer.from('<!-- '), Buffer.from([0xff]), Buffer.from(' -->\n' + xml)]));
    const valid = f.put('valid.xml', xml);
    assert.throws(() => catalog.readItems(invalid), /xml-utf8-required/);
    assert.throws(() => catalog.compare({left: invalid, right: valid}), /xml-utf8-required/);
    assert.throws(() => require('../code-baseline-core').createPlan({projectRoot: f.root, baseline: invalid, out: path.join(f.root, 'snapshot')}), /xml-utf8-required/);
});
