'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawnSync} = require('node:child_process');
const {frontendAdapter, frontendTransport, atelierFrontendPlan, frontendPlan} = require('../deploy-protected');
const direct = require('../deploy-direct');
const guard = require('../deploy-guard');

async function fixture(t, options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-atelier-frontend-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const local = options.files || {'csp/page.csp': '<p>UTF8 中文</p>\n', 'scripts/page.js': '\uFEFFvar message = "中文";\r\n', 'css/page.css': 'body {}\n'};
    for (const [file, content] of Object.entries(local)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
        fs.writeFileSync(path.join(root, file), content);
    }
    const content = new Map(Object.keys(local).map(file => ['web/' + file, '// old\n']));
    const events = [], bodies = [], conditionals = [];
    let reads = 0;
    const server = http.createServer((request, response) => {
        let body = '';
        request.on('data', data => body += data);
        request.on('end', () => {
            const document = decodeURIComponent(request.url.split('/doc/')[1] || '');
            const compile = request.url.includes('/action/compile');
            events.push({method: request.method, document, compile});
            if (request.method === 'PUT') {
                conditionals.push(request.headers['if-none-match']);
                if (options.rejectPut) { response.writeHead(412); response.end('{}'); return; }
                const payload = JSON.parse(body); bodies.push(payload);
                const value = payload.content.join('\n');
                content.set(document, options.normalizeReadback ? value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n') : value);
            }
            if (request.method === 'GET' && ++reads === options.changeOnRead) content.set(document, '// external change\n');
            const result = compile ? {content: options.compileFailure ? [{name: 'web/csp/page.csp', status: 'compile error'}] : []} :
                {content: (content.get(document) || '').split('\n'), enc: false, ...(options.missingTimestamp ? {} : {ts: '2026-10-19 01:00:00.000'})};
            if (compile) bodies.push(JSON.parse(body));
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({status: {errors: []}, result, console: []}));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    const config = {iris: {namespace: 'TEST'}, mcp: {serverName: 'iris'}, web: {basePath: 'web', cspBasePath: 'web/csp', frontendTransport: 'atelier'}};
    const mcp = {mcpServers: {iris: {env: {IRIS_HOST: '127.0.0.1', IRIS_SCHEME: 'http', IRIS_WEB_PORT: String(server.address().port), IRIS_USERNAME: 'test', IRIS_PASSWORD: 'fake', IRIS_NAMESPACE: 'TEST'}}}};
    const context = {workspaceRoot: root, sourceRoots: [{target: root}]};
    const args = {mode: 'direct', sourceRoot: root, files: Object.keys(local)};
    const adapter = frontendAdapter(args, config, mcp, context);
    return {root, content, events, bodies, conditionals, config, mcp, context, args, adapter};
}

test('explicit Atelier selection reuses protected doc writes without an SFTP dependency', async t => {
    const f = await fixture(t);
    const original = f.args.files.map(file => fs.readFileSync(path.join(f.root, file)));
    const result = await direct.run({files: f.adapter.files, adapter: f.adapter, kind: 'frontend'});
    assert.equal(result.status, 'verified');
    assert.equal(f.events.filter(event => event.method === 'PUT').length, 3);
    assert.ok(f.conditionals.every(value => value === '2026-10-19 01:00:00.000'));
    assert.equal(f.events.filter(event => event.compile).length, 1);
    assert.deepEqual(f.bodies.at(-1), ['web/csp/page.csp']);
    for (const [index, file] of f.args.files.entries()) {
        assert.deepEqual(Buffer.from(f.content.get('web/' + file)), original[index]);
        assert.deepEqual(fs.readFileSync(path.join(f.root, file)), original[index]);
    }
    assert.equal((await direct.run({files: f.adapter.files, adapter: f.adapter, kind: 'frontend'})).status, 'verified');
    assert.equal(f.events.filter(event => event.method === 'PUT').length, 3);
    assert.equal(f.events.filter(event => event.compile).length, 2);
});
test('project selection and source mapping are explicit and no failure silently changes channel', async t => {
    assert.equal(frontendTransport({}), 'sftp');
    for (const frontendTransport of ['auto', '', null, false]) assert.throws(() => require('../deploy-protected').frontendTransport({web: {frontendTransport}}), /unsupported-frontend-transport/);
    const f = await fixture(t, {files: {'css/page.css': 'body {}\n'}});
    assert.throws(() => frontendAdapter({...f.args, python: 'python'}, f.config, f.mcp, f.context), /sftp-options-require-sftp-transport/);
    assert.throws(() => atelierFrontendPlan(f.args, {...f.config, web: {...f.config.web, basePath: '../wrong'}}, f.context), /prefix-invalid/);
    assert.throws(() => atelierFrontendPlan({...f.args, sourceRoot: undefined}, f.config, f.context), /source-root/);
    const sftp = frontendPlan(f.args, {...f.config, web: {...f.config.web, frontendTransport: 'sftp'}}, {mcpServers: {'sftp-server': {env: {REMOTE_PATH: '/synthetic-physical'}}}}, f.context);
    assert.equal(sftp.files[0].targetId, 'deployment-target:' + guard.digest('/synthetic-physical/css/page.css'));
    assert.equal(sftp.files[0].targetId.includes('synthetic-physical'), false);
    const result = await direct.run({files: f.adapter.files, adapter: f.adapter, kind: 'frontend'});
    assert.equal(result.status, 'verified'); assert.equal(f.events.some(event => event.compile), false);
});
test('remote timestamp and readback checks block mutations or prevent false verification', async t => {
    const noTimestamp = await fixture(t, {files: {'css/page.css': 'body {}\n'}, missingTimestamp: true});
    assert.equal((await direct.run({files: noTimestamp.adapter.files, adapter: noTimestamp.adapter, kind: 'frontend'})).status, 'blocked');
    assert.equal(noTimestamp.events.some(event => event.method === 'PUT'), false);
    const changed = await fixture(t, {files: {'css/page.css': 'body {}\n'}, changeOnRead: 2});
    assert.equal((await direct.run({files: changed.adapter.files, adapter: changed.adapter, kind: 'frontend'})).reason, 'remote-changed-during-deploy');
    assert.equal(changed.events.some(event => event.method === 'PUT'), false);
    const normalized = await fixture(t, {files: {'scripts/page.js': '\uFEFFvar text = "中文";\r\n'}, normalizeReadback: true});
    const mismatch = await direct.run({files: normalized.adapter.files, adapter: normalized.adapter, kind: 'frontend'});
    assert.equal(mismatch.reason, 'readback-mismatch'); assert.equal(mismatch.status, 'failed-or-unknown');
    assert.equal(normalized.events.some(event => event.compile), false);
});
test('conditional write rejection and CSP compile errors preserve failure with no replay', async t => {
    const blocked = await fixture(t, {files: {'csp/page.csp': '<p>page</p>\n'}, rejectPut: true});
    const result = await direct.run({files: blocked.adapter.files, adapter: blocked.adapter, kind: 'frontend'});
    assert.equal(result.status, 'failed-or-unknown');
    assert.equal(blocked.events.filter(event => event.method === 'PUT').length, 1);
    assert.equal(blocked.events.some(event => event.compile), false);
    const failed = await fixture(t, {files: {'csp/page.csp': '<p>page</p>\n'}, compileFailure: true});
    const compilation = await direct.run({files: failed.adapter.files, adapter: failed.adapter, kind: 'frontend'});
    assert.equal(compilation.status, 'compile-failed');
    assert.equal(failed.events.filter(event => event.compile).length, 1);
});
test('Atelier frontend keeps guarded merge, original sources and post-compile verification', async t => {
    const f = await fixture(t, {files: {'scripts/page.js': '// a\n// b\n// c\n'}});
    const git = (...args) => { const result = spawnSync('git', ['-C', f.root, ...args], {encoding: 'utf8'}); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
    git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-m', 'base');
    t.mock.method(os, 'homedir', () => f.root);
    guard.initialize(f.root, '123', 'HEAD', true);
    const approved = Buffer.from('// A\n// b\n// c\n'), immutablePath = path.join(f.root, 'frozen-guarded.js');
    fs.writeFileSync(immutablePath, approved);
    f.context.deploymentArtifacts = new Map([[path.join(f.root, 'scripts/page.js'), {immutablePath, immutableSha256: guard.hash(approved)}]]);
    fs.unlinkSync(path.join(f.root, 'scripts/page.js'));
    f.content.set('web/scripts/page.js', '// a\n// b\n// C\n');
    const adapter = frontendAdapter({...f.args, mode: 'guarded'}, f.config, f.mcp, f.context);
    const head = git('rev-parse', 'HEAD');
    const result = await guard.run({repo: f.root, demand: '123', target: 'frontend:' + adapter.target, files: adapter.files, adapter, checkUpdates() {}});
    assert.equal(result.status, 'verified'); assert.equal(result.files[0].merged, true);
    assert.equal(f.content.get('web/scripts/page.js'), '// A\n// b\n// C\n');
    assert.equal(fs.existsSync(path.join(f.root, 'scripts/page.js')), false);
    assert.deepEqual(fs.readFileSync(immutablePath), approved);
    assert.equal(git('rev-parse', 'HEAD'), head);
});
test('frozen frontend reads verified artifacts while preserving original Git identity and later source edits', async t => {
    const f = await fixture(t, {files: {'scripts/page.js': '// base\n'}});
    const localPath = path.join(f.root, 'scripts/page.js'), immutablePath = path.join(f.root, 'frozen-page.js');
    const frozen = Buffer.from('// approved frozen\n'); fs.writeFileSync(immutablePath, frozen);
    const immutable = {immutablePath, immutableSha256: guard.hash(frozen)};
    f.context.deploymentArtifacts = new Map([[localPath, immutable]]);
    const adapter = frontendAdapter(f.args, f.config, f.mcp, f.context);
    fs.writeFileSync(localPath, '// continued development\n');
    assert.equal(adapter.files[0].localPath, localPath);
    assert.equal((await direct.run({files: adapter.files, adapter, kind: 'frontend'})).status, 'verified');
    assert.equal(f.content.get('web/scripts/page.js'), frozen.toString());
    assert.equal(fs.readFileSync(localPath, 'utf8'), '// continued development\n');
    assert.deepEqual(fs.readFileSync(immutablePath), frozen);
    fs.writeFileSync(immutablePath, '// tampered snapshot\n');
    const writes = f.events.filter(event => event.method === 'PUT').length;
    assert.equal((await direct.run({files: adapter.files, adapter, kind: 'frontend'})).reason, 'frozen-source-changed');
    assert.equal(f.events.filter(event => event.method === 'PUT').length, writes);
});
test('frozen backend Storage backfill stops for source review without writing worktree or snapshot', async t => {
    const f = await fixture(t, {files: {'scripts/page.js': '// unused\n'}});
    const localPath = path.join(f.root, 'Demo.cls'), immutablePath = path.join(f.root, 'frozen.cls');
    const frozen = Buffer.from('Class Demo\n{\n}\n'), later = Buffer.from('Class Demo\n{\n// continued development\n}\n');
    fs.writeFileSync(localPath, later); fs.writeFileSync(immutablePath, frozen);
    let remote = frozen;
    const adapter = {read: async () => remote, put: async file => { remote = file.bytes; }, compile: async () => {
        remote = Buffer.from('Class Demo\n{\nStorage Default\n{\n<Type>%Storage.Persistent</Type>\n}\n}\n'); return {status: 'compiled'};
    }};
    const result = await direct.run({files: [{localPath, remotePath: 'Demo.cls', immutablePath, immutableSha256: guard.hash(frozen)}], adapter, kind: 'backend'});
    assert.equal(result.status, 'storage-sync-incomplete'); assert.equal(result.reason, 'frozen-storage-sync-requires-source-review');
    assert.equal(result.remoteCompilation, 'compiled'); assert.equal(result.details.sourcePath, localPath);
    assert.deepEqual(fs.readFileSync(localPath), later); assert.deepEqual(fs.readFileSync(immutablePath), frozen);
});
test('frontend CLI plan needs no SFTP and execute passes through existing night binding', async t => {
    const f = await fixture(t, {files: {'csp/page.csp': '<p>page</p>\n'}});
    fs.mkdirSync(path.join(f.root, '.agents/config'), {recursive: true});
    fs.mkdirSync(path.join(f.root, '.agents/.git'));
    fs.writeFileSync(path.join(f.root, '.agents/config/project-env.json'), JSON.stringify(f.config));
    fs.writeFileSync(path.join(f.root, '.mcp.json'), JSON.stringify(f.mcp));
    const cli = path.resolve(__dirname, '../deploy-frontend.js');
    const planned = spawnSync(process.execPath, [cli, '--project-root', f.root, '--source-root', f.root, '--files', 'csp/page.csp'], {encoding: 'utf8'});
    assert.equal(planned.status, 0, planned.stdout + planned.stderr); assert.equal(JSON.parse(planned.stdout).transport, 'atelier'); assert.equal(f.events.length, 0);
    const night = require('../../../../../scripts/lib/night-execution'), receipts = [], output = [];
    const original = path.join(f.root, 'csp/page.csp'), frozen = path.join(f.root, 'frozen-page.csp'), frozenBytes = Buffer.from('<p>approved frozen page</p>\n');
    fs.writeFileSync(frozen, frozenBytes); fs.writeFileSync(original, '<p>continued development</p>\n');
    t.mock.method(night, 'resolveBinding', () => ({synthetic: true}));
    t.mock.method(night, 'frozenArtifact', (_binding, sourcePath) => ({path: frozen, sourcePath, sha256: guard.hash(frozenBytes)}));
    let bound = false;
    t.mock.method(night, 'begin', args => { assert.equal(args.phase, 'deployment'); assert.equal(args.workItemId, 'frontend'); assert.deepEqual(args.artifacts, [{localPath: frozen, targetId: 'web/csp/page.csp'}]); return {operation: {id: 'synthetic'}}; });
    t.mock.method(night, 'boundAdapter', (_binding, adapter) => { bound = true; return adapter; });
    t.mock.method(night, 'reusableDeployment', () => null);
    t.mock.method(night, 'finish', (_binding, result) => receipts.push(result));
    t.mock.method(console, 'log', value => output.push(JSON.parse(value)));
    await require('../deploy-protected').main('frontend', ['--project-root', f.root, '--source-root', f.root, '--files', 'csp/page.csp', '--work-item', 'frontend', '--environment-alias', 'synthetic', '--execute']);
    assert.equal(bound, true); assert.equal(receipts[0].status, 'verified'); assert.equal(output[0].transport.kind, 'atelier');
    assert.equal(f.content.get('web/csp/page.csp'), frozenBytes.toString()); assert.equal(fs.readFileSync(original, 'utf8'), '<p>continued development</p>\n');
});
