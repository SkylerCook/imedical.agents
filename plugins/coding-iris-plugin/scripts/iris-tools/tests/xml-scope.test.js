'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync, spawnSync} = require('node:child_process');
const scope = require('../xml-scope');

function fixture(t) {
    const parent = path.resolve(process.env.CODEX_TEST_TMP_ROOT || path.join(os.tmpdir(), 'Codex'));
    fs.mkdirSync(parent, {recursive: true});
    const root = path.join(parent, 'xml-scope-' + crypto.randomUUID()); fs.mkdirSync(root);
    t.after(() => { assert.equal(path.dirname(root), parent); assert.equal(fs.lstatSync(root).isSymbolicLink(), false); fs.rmSync(root, {recursive: true, force: true}); });
    function put(relative, bytes) { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes); return file; }
    put('.agents/config/project-env.json', JSON.stringify({web: {basePath: 'fixture/web'}}));
    const query = options => scope.query({projectRoot: root, ...options});
    return {root, put, query};
}
function git(root, args) { return execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', windowsHide: true}); }
function init(root) { git(root, ['init']); git(root, ['config', 'user.name', 'Fixture']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'core.autocrlf', 'false']); }

test('files produces typed offline candidates including images and reports missing or ineligible sources', t => {
    const f = fixture(t);
    f.put('src/backend/product/wrong-folder.cls', 'Class Demo.Actual\n{}');
    f.put('src/backend/product/build.js', 'backend tooling');
    f.put('src/frontend/product/images/a.png', Buffer.from([0, 1, 2]));
    const result = f.query({command: 'files', paths: ['src/backend/product/wrong-folder.cls', 'src/backend/product/build.js', 'src/frontend/product/images/a.png', 'src/frontend/product/missing.js'], outList: 'docs/work/scope.json'});
    assert.deepEqual(result.items.map(item => ({name: item.name, type: item.type})), [{name: 'Demo.Actual', type: 'CLS'}, {name: 'fixture/web/images/a.png', type: 'CSP'}]);
    assert.equal(result.imageCount, 1); assert.equal(result.missing.length, 1); assert.equal(result.excluded.length, 1); assert.equal(result.candidateOnly, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(result.outList, 'utf8')).items, result.items);
    assert.equal(fs.existsSync(path.join(f.root, '.git')), false);
});

test('all scans declared source trees, excludes backend tools and never follows a nested source link', t => {
    const f = fixture(t);
    f.put('src/backend/A.cls', 'Class Demo.A\n{}');
    f.put('src/backend/build.js', 'not a Web resource');
    f.put('src/frontend/csp/page.csp', '<html/>');
    f.put('src/frontend/images/a.svg', '<svg/>');
    const outside = f.put('outside/csp/leak.csp', 'outside source');
    try { fs.symlinkSync(path.dirname(outside), path.join(f.root, 'src/frontend/linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error; }
    const result = f.query({command: 'all'});
    assert.equal(result.total, 3); assert.equal(result.imageCount, 1);
    assert.equal(result.items.some(item => item.sourcePath === outside), false);
    assert.equal(result.items.some(item => item.sourcePath.endsWith('build.js')), false);
    assert.deepEqual(f.query({command: 'baseline'}).items.map(item => item.name), result.items.map(item => item.name));
});

test('grep uses a literal and ignores binary image contents', t => {
    const f = fixture(t);
    f.put('src/frontend/scripts/a.js', 'a+b'); f.put('src/frontend/scripts/b.js', 'aaab');
    f.put('src/frontend/images/a.png', Buffer.from('a+b'));
    const result = f.query({command: 'grep', literal: 'a+b'});
    assert.deepEqual(result.items.map(item => item.name), ['fixture/web/scripts/a.js']);
});

test('page follows static includes, CSS import and url assets while preserving dynamic and missing references', t => {
    const f = fixture(t);
    f.put('src/backend/Server.cls', 'Class Demo.Server\n{\n// ##class(Demo.Deep)\n}');
    f.put('src/backend/Deep.cls', 'Class Demo.Deep\n{}');
    f.put('src/frontend/product/csp/main.csp', '<script src="../scripts/app.js"></script>\n<link href="../css/a.css">\n<csp:include page="child.csp">\n<script src="#(dynamic)#"></script>\n<script src="missing.js"></script>\n<link href="https://external.invalid/a.css">\n##class(Demo.Server).Run()\n##class($CLASSNAME()).Run()');
    f.put('src/frontend/product/csp/child.csp', '<img src=../images/a.png>');
    f.put('src/frontend/product/scripts/app.js', '/* candidate script */');
    f.put('src/frontend/product/css/a.css', '@import "b.css"; .hero {background:url(../images/a.png)}');
    f.put('src/frontend/product/css/b.css', '.icon {background:url("/fixture/web/images/b.svg")}');
    f.put('src/frontend/product/images/a.png', Buffer.from([0, 1, 2])); f.put('src/frontend/product/images/b.svg', '<svg/>');
    const result = f.query({command: 'page', paths: ['src/frontend/product/csp/main.csp'], withBackend: true});
    assert.equal(result.total, 8); assert.equal(result.imageCount, 2);
    assert.equal(result.items.some(item => item.name === 'Demo.Server'), true); assert.equal(result.items.some(item => item.name === 'Demo.Deep'), false);
    assert.ok(result.unresolved.some(item => item.reason === 'dynamic-reference' && item.reference === '#(dynamic)#'));
    assert.ok(result.unresolved.some(item => item.reason === 'missing-reference' && item.document === 'fixture/web/csp/missing.js'));
    assert.ok(result.unresolved.some(item => item.reason === 'dynamic-class-reference'));
    assert.equal(result.externalReferences.length, 1);
    assert.ok(scope.references('include("child.csp")').some(item => item.value === 'child.csp'));
    assert.equal(f.query({command: 'page', paths: ['src/frontend/product/csp/main.csp']}).items.some(item => item.type === 'CLS'), false);
});

test('porcelain parser preserves leading status spaces and parses NUL rename source records', () => {
    const parsed = scope.parsePorcelain(Buffer.from(' M src/中文 A.cls\0R  src/new name.csp\0src/old name.csp\0?? src/new.png\0 D src/deleted.js\0'));
    assert.equal(parsed[0].status, ' M'); assert.equal(parsed[0].path, 'src/中文 A.cls');
    assert.equal(parsed[1].path, 'src/new name.csp'); assert.equal(parsed[1].from, 'src/old name.csp');
    assert.equal(parsed[2].status, '??'); assert.equal(parsed[3].deleted, true);
    assert.deepEqual(scope.parseDiff(Buffer.from('R100\0old.csp\0new.csp\0D\0old.js\0')), [{path: 'new.csp', status: 'R100', from: 'old.csp', deleted: false}, {path: 'old.js', status: 'D', deleted: true}]);
});

test('changed combines per-root worktree status and revision changes without losing Chinese, rename, deletion or untracked images', t => {
    const f = fixture(t); init(f.root);
    f.put('src/backend/中文 A.cls', 'Class Demo.A\n{}');
    f.put('src/frontend/csp/old page.csp', '<html/>'); f.put('src/frontend/scripts/deleted.js', 'delete me');
    git(f.root, ['add', 'src']); git(f.root, ['commit', '-m', 'chore(fixture): baseline']);
    const since = git(f.root, ['rev-parse', 'HEAD']).trim();
    f.put('src/backend/Committed.cls', 'Class Demo.Committed\n{}'); git(f.root, ['add', 'src/backend/Committed.cls']); git(f.root, ['commit', '-m', 'chore(fixture): second revision']);
    f.put('src/backend/中文 A.cls', 'Class Demo.A\n{\n// unstaged\n}');
    git(f.root, ['mv', 'src/frontend/csp/old page.csp', 'src/frontend/csp/新 page.csp']);
    fs.unlinkSync(path.join(f.root, 'src/frontend/scripts/deleted.js')); f.put('src/frontend/images/untracked.png', 'fixture image');
    const result = f.query({command: 'changed', since});
    assert.deepEqual(result.items.map(item => item.name).sort(), ['Demo.A', 'Demo.Committed', 'fixture/web/csp/新 page.csp', 'fixture/web/images/untracked.png'].sort());
    assert.equal(result.items.find(item => item.name === 'Demo.A').gitStatus, ' M');
    assert.equal(result.deleted.length, 1); assert.equal(result.renames.length, 1);
    assert.match(result.renames[0].from, /old page\.csp$/); assert.match(result.renames[0].to, /新 page\.csp$/);
});

test('changed queries both explicitly declared Git roots instead of relying on the parent repository', t => {
    const f = fixture(t), backend = path.join(f.root, 'backend'), frontend = path.join(f.root, 'frontend');
    fs.mkdirSync(backend); fs.mkdirSync(frontend); init(backend); init(frontend);
    f.put('backend/src/A.cls', 'Class Demo.A\n{}'); f.put('frontend/src/images/a.png', 'image fixture');
    const context = {workspaceRoot: f.root, contextRoot: path.join(f.root, '.agents'), capabilityRoot: path.join(f.root, '.agents'),
        sourceRoots: [{name: 'backend', path: backend, target: backend, gitRoot: backend}, {name: 'frontend', path: frontend, target: frontend, gitRoot: frontend}]};
    const result = f.query({context, command: 'changed'});
    assert.equal(result.total, 2); assert.deepEqual(new Set(result.items.map(item => item.gitRoot)), new Set([backend, frontend]));
    assert.equal(result.items.find(item => item.type === 'CSP').name, 'fixture/web/images/a.png');
});

test('changed accepts a Windows spelling variant only when it is the same physical Git root', {skip: process.platform !== 'win32'}, t => {
    const f = fixture(t); init(f.root); f.put('src/backend/A.cls', 'Class Demo.A\n{}');
    const variant = path.join(path.dirname(f.root), path.basename(f.root).toUpperCase());
    if (!fs.existsSync(variant)) { t.skip('This directory uses case-sensitive Windows names'); return; }
    assert.notEqual(path.resolve(variant), path.resolve(f.root));
    assert.equal(fs.realpathSync.native(variant), fs.realpathSync.native(f.root));
    const result = scope.query({projectRoot: variant, command: 'changed'});
    assert.equal(result.total, 1); assert.equal(result.items[0].name, 'Demo.A');
});

test('changed still rejects a declared Git root that resolves to a different physical repository root', t => {
    const f = fixture(t); init(f.root); f.put('module/src/A.cls', 'Class Demo.A\n{}');
    const moduleRoot = path.join(f.root, 'module');
    const context = {workspaceRoot: f.root, contextRoot: path.join(f.root, '.agents'), capabilityRoot: path.join(f.root, '.agents'),
        sourceRoots: [{name: 'backend', path: moduleRoot, target: moduleRoot, gitRoot: moduleRoot}]};
    assert.notEqual(fs.realpathSync.native(moduleRoot), fs.realpathSync.native(f.root));
    assert.throws(() => f.query({context, command: 'changed'}), /xml-scope-git-root-mismatch/);
});

test('output and source boundaries reject private configuration, outside paths and linked output targets', t => {
    const f = fixture(t); f.put('src/backend/A.cls', 'Class Demo.A\n{}');
    for (const outList of ['../outside.json', '.mcp.json', '.agents/config/overwrite.json', 'src/backend/scope.json']) assert.throws(() => f.query({command: 'all', outList}), /xml-scope-output-invalid/);
    const result = f.query({command: 'files', paths: ['../outside.cls']}); assert.equal(result.total, 0); assert.equal(result.unresolved[0].reason, 'xml-scope-outside-source');
    const original = f.put('docs/target.json', 'keep'), linked = path.join(f.root, 'docs/linked.json');
    try { fs.symlinkSync(original, linked); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return; throw error; }
    assert.throws(() => f.query({command: 'all', outList: 'docs/linked.json'}), /baseline-linked-path/);
    assert.equal(fs.readFileSync(original, 'utf8'), 'keep');
});

test('help ends before loading a workspace or reading environment configuration', () => {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../xml-scope.js'), 'files', 'missing.cls', '--project-root', 'absent', '--help'], {encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 0); assert.match(result.stdout, /Offline candidates only/); assert.equal(result.stderr, '');
});
