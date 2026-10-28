'use strict';
const {createTempDirectory,ownsTempDirectory}=require('../../../../../scripts/tests/fixtures/temp-directory');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const {spawnSync, spawn} = require('node:child_process');
const core = require('../code-baseline-core');
const catalog = require('../baseline-catalog');

function fixture(t, items = [{name: 'Demo.A', type: 'CLS'}]) {
    const root = createTempDirectory('code-baseline-');
    t.after(() => { assert.equal(ownsTempDirectory(root), true); assert.equal(fs.lstatSync(root).isSymbolicLink(), false); fs.rmSync(root, {recursive: true, force: true}); });
    function put(relative, text) { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); return file; }
    const config = {iris: {scheme: 'https', host: 'synthetic.invalid', port: 443, namespace: 'FIXTURE'}, web: {basePath: 'fixture/web'}};
    const mcp = {mcpServers: {'iris-agentic-dev': {env: {IRIS_SCHEME: 'https', IRIS_HOST: 'synthetic.invalid', IRIS_WEB_PORT: '443', IRIS_NAMESPACE: 'FIXTURE', IRIS_USERNAME: 'fixture', IRIS_PASSWORD: 'fixture-secret'}}}};
    put('.agents/config/project-env.json', JSON.stringify(config)); put('.mcp.json', JSON.stringify(mcp));
    const baseline = put('input.xml', catalog.buildXml(items));
    const out = path.join(root, 'snapshot');
    const plan = options => core.createPlan({projectRoot: root, baseline, out, ...options});
    return {root, put, config, mcp, baseline, out, plan};
}
function value(document, content) { const bytes = Buffer.from(content); return {document, bytes, ts: '2026-10-28 00:00:00', sha256: core.hash(bytes), representation: 'atelier-text-utf8'}; }
function reader(records, {cleanupVerified = true, interrupt = false, calls = []} = {}) {
    return () => ({
        async readAll(documents, {onResult}) {
            calls.push(...documents);
            for (let index = 0; index < documents.length; index++) {
                if (interrupt && index > 0) throw Object.assign(new Error('synthetic interruption'), {code: 'synthetic-interruption'});
                const record = typeof records === 'function' ? records(documents[index], index) : records[index];
                await onResult({index, document: documents[index], ...record});
            }
            return {sessions: 1, cleanup: {cleanupVerified}};
        },
        async close() { return {cleanupVerified, licenseReleaseVerified: false}; }
    });
}
const cls = suffix => `Class Demo.${suffix}\n{\nParameter Value = "BASE";\n}\n`;

test('standalone capture needs neither project demand nor Git and excludes images before remote reads', async t => {
    const f = fixture(t, [{name: 'Demo.A', type: 'CLS'}, {name: 'fixture/web/images/a.png', type: 'CSP'}]);
    const p = f.plan(), calls = [];
    assert.equal(p.total, 1); assert.equal(p.excludedImageCount, 1); assert.equal(p.excludedImages.length, 1);
    const result = await core.capture(p.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', cls('A'))}], {calls})});
    assert.equal(result.state, 'complete'); assert.equal(result.fetched, 1); assert.deepEqual(calls, ['Demo.A.cls']);
    assert.equal(fs.existsSync(path.join(f.root, '.git')), false);
    assert.equal(fs.readFileSync(path.join(f.out, 'src/Demo/A.cls'), 'utf8'), cls('A'));
    assert.doesNotMatch(fs.readFileSync(p.planPath, 'utf8'), /fixture-secret/);
});

test('partial keeps an existing missing file and accepted scope contains only verified successful objects', async t => {
    const f = fixture(t, [{name: 'Demo.A', type: 'CLS'}, {name: 'Demo.B', type: 'CLS'}]);
    const existing = f.put('snapshot/src/Demo/B.cls', cls('B')), p = f.plan();
    const result = await core.capture(p.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', cls('A'))}, {status: 'missing'}])});
    assert.equal(result.state, 'partial'); assert.equal(result.missing, 1); assert.equal(fs.readFileSync(existing, 'utf8'), cls('B'));
    assert.throws(() => core.successfulScope(p.planPath), /baseline-scope-not-accepted/);
    const token = core.acceptanceToken(core.load(p.planPath));
    assert.throws(() => core.acceptPartial(p.planPath, {confirm: true, token: '0'.repeat(64), evidence: 'review'}), /baseline-partial-acceptance-required/);
    const accepted = core.acceptPartial(p.planPath, {confirm: true, token, evidence: 'review:missing-confirmed'});
    assert.equal(accepted.state, 'accepted-partial'); assert.equal(accepted.complete, false);
    assert.deepEqual(core.successfulScope(p.planPath).map(item => item.document), ['Demo.A.cls']);
});

test('resume survives an independent process readback and retries only unfinished initial capture items', async t => {
    const f = fixture(t, [{name: 'Demo.A', type: 'CLS'}, {name: 'Demo.B', type: 'CLS'}]), p = f.plan();
    let result = await core.capture(p.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', cls('A'))}], {interrupt: true})});
    assert.equal(result.state, 'interrupted'); assert.equal(result.fetched, 1); assert.equal(result.cancelled, 1);
    const cli = path.resolve(__dirname, '../code-baseline.js');
    const status = spawnSync(process.execPath, [cli, 'status', '--plan', p.planPath], {encoding: 'utf8', windowsHide: true});
    assert.equal(status.status, 0, status.stderr); assert.equal(JSON.parse(status.stdout).fetched, 1);
    const calls = [];
    result = await core.capture(p.planPath, {resume: true, readerFactory: reader([{status: 'fetched', value: value('Demo.B.cls', cls('B'))}], {calls})});
    assert.equal(result.state, 'complete'); assert.deepEqual(calls, ['Demo.B.cls']);
});

test('same-length local edits invalidate resume before opening a reader', async t => {
    const f = fixture(t, [{name: 'Demo.A', type: 'CLS'}, {name: 'Demo.B', type: 'CLS'}]), p = f.plan();
    await core.capture(p.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', cls('A'))}, {status: 'missing'}])});
    const file = path.join(f.out, 'src/Demo/A.cls'), prior = fs.readFileSync(file, 'utf8'); fs.writeFileSync(file, prior.replace('BASE', 'EDIT'));
    let opened = false;
    await assert.rejects(core.capture(p.planPath, {resume: true, readerFactory: () => { opened = true; }}), /baseline-local-drift/);
    assert.equal(opened, false); assert.match(fs.readFileSync(file, 'utf8'), /EDIT/);
});

test('a killed capture can resume its durable reading state but cannot steal a live capture owner', async t => {
    const f = fixture(t, [{name: 'Demo.A', type: 'CLS'}, {name: 'Demo.B', type: 'CLS'}]), p = f.plan();
    const script = `const core=require(process.argv[1]);core.capture(process.argv[2],{readerFactory:()=>({async readAll(documents,{onResult}){await onResult({index:0,document:documents[0],status:'fetched',value:{document:documents[0],bytes:Buffer.from('Class Demo.A\\n{\\n}\\n')}});process.stdout.write('ready');await new Promise(()=>setInterval(()=>{},1000));},async close(){return {cleanupVerified:true};}})}).catch(e=>{process.stderr.write(e.stack);process.exit(1);});`;
    const child = spawn(process.execPath, ['-e', script, path.resolve(__dirname, '../code-baseline-core.js'), p.planPath], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    const exit = new Promise(resolve => child.once('exit', resolve));
    t.after(async () => { if (child.exitCode === null && !child.signalCode) child.kill(); await exit; });
    await new Promise((resolve, reject) => {
        let output = '', errors = '';
        const timer = setTimeout(() => reject(Error('child capture did not persist a checkpoint: ' + errors)), 15000);
        child.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes('ready')) { clearTimeout(timer); resolve(); } });
        child.stderr.on('data', chunk => { errors += chunk.toString(); });
        child.once('exit', code => { clearTimeout(timer); reject(Error('child exited before checkpoint: ' + code + ' ' + errors)); });
    });
    assert.equal(core.status(p.planPath).state, 'reading');
    await assert.rejects(core.capture(p.planPath, {resume: true, readerFactory: () => assert.fail('live owner must block')}), /baseline-capture-owner-live/);
    child.kill(); await exit;
    const calls = [];
    const result = await core.capture(p.planPath, {resume: true, readerFactory: reader([{status: 'fetched', value: value('Demo.B.cls', cls('B'))}], {calls})});
    assert.equal(result.state, 'complete'); assert.deepEqual(calls, ['Demo.B.cls']);
});

test('changed environment and catalog invalidate a persistent checkpoint', async t => {
    const f = fixture(t), p = f.plan();
    f.config.iris.namespace = 'DIFFERENT'; f.mcp.mcpServers['iris-agentic-dev'].env.IRIS_NAMESPACE = 'DIFFERENT';
    f.put('.agents/config/project-env.json', JSON.stringify(f.config)); f.put('.mcp.json', JSON.stringify(f.mcp));
    await assert.rejects(core.capture(p.planPath, {readerFactory: () => assert.fail('must not connect')}), /baseline-source-changed/);
    const g = fixture(t), q = g.plan(); fs.appendFileSync(g.baseline, '\n');
    await assert.rejects(core.capture(q.planPath, {readerFactory: () => assert.fail('must not connect')}), /baseline-catalog-changed/);
});

test('unowned existing content is preserved while equal content can be safely reused', async t => {
    const f = fixture(t), existing = f.put('snapshot/src/Demo/A.cls', cls('A').replace('BASE', 'EDIT')), p = f.plan();
    let result = await core.capture(p.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', cls('A'))}])});
    assert.equal(result.failed, 1); assert.match(fs.readFileSync(existing, 'utf8'), /EDIT/);
    assert.throws(() => core.acceptPartial(p.planPath, {confirm: true, token: core.acceptanceToken(core.load(p.planPath)), evidence: 'must-retry-failed'}), /baseline-partial-acceptance-required/);
    const g = fixture(t); g.put('snapshot/src/Demo/A.cls', cls('A')); const q = g.plan();
    result = await core.capture(q.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', cls('A'))}])});
    assert.equal(result.reused, 1); assert.equal(result.complete, true);
});

test('trusted previous capture permits an atomic update but refuses later local drift', async t => {
    const f = fixture(t), p = f.plan();
    await core.capture(p.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', cls('A'))}])});
    const next = f.plan({previousPlan: p.planPath});
    const changed = cls('A').replace('BASE', 'NEXT');
    const result = await core.capture(next.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', changed)}])});
    assert.equal(result.complete, true); assert.equal(fs.readFileSync(path.join(f.out, 'src/Demo/A.cls'), 'utf8'), changed);
    fs.writeFileSync(path.join(f.out, 'src/Demo/A.cls'), changed.replace('NEXT', 'EDIT'));
    assert.throws(() => f.plan({previousPlan: next.planPath}), /baseline-local-drift/);
});

test('replacement race preserves the new local content and cleans only its own temporary file', async t => {
    const f = fixture(t), p = f.plan();
    await core.capture(p.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', cls('A'))}])});
    const next = f.plan({previousPlan: p.planPath});
    const result = await core.capture(next.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', cls('A').replace('BASE', 'NEXT'))}]),
        beforeReplace(item) { fs.writeFileSync(item.destination, cls('A').replace('BASE', 'EDIT')); }});
    assert.equal(result.failed, 1); assert.match(fs.readFileSync(path.join(f.out, 'src/Demo/A.cls'), 'utf8'), /EDIT/);
    assert.deepEqual(fs.readdirSync(path.join(f.out, 'src/Demo')), ['A.cls']);
});

test('write-ahead intent recovers replacement completed before the result checkpoint without downloading again', async t => {
    const f = fixture(t), p = f.plan();
    const result = await core.capture(p.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', cls('A'))}]),
        afterReplace() { throw Object.assign(new Error('checkpoint interruption'), {code: 'synthetic-checkpoint-interruption'}); }});
    assert.equal(result.failed, 1); assert.ok(core.load(p.planPath).items[0].writeIntent);
    assert.equal(fs.readFileSync(path.join(f.out, 'src/Demo/A.cls'), 'utf8'), cls('A'));
    const resumed = await core.capture(p.planPath, {resume: true, readerFactory: () => assert.fail('already saved content must be recovered from its intent')});
    assert.equal(resumed.state, 'complete'); assert.equal(resumed.fetched, 1); assert.equal(core.load(p.planPath).items[0].writeIntent, undefined);
});

test('qualification binds the explicit read budget and only emits a pending resource receipt', async t => {
    const f = fixture(t), p = f.plan({sessions: 4, intervalMs: 100});
    let received;
    const result = await core.qualify(p.planPath, {confirm: true, budgetMs: 5000, readerFactory: options => {
        received = options;
        return reader([{status: 'fetched', value: value('Demo.A.cls', cls('A'))}])();
    }});
    assert.equal(received.qualification.confirm, true); assert.equal(received.qualification.sessions, 4);
    assert.deepEqual(received.qualification.documents, ['Demo.A.cls']); assert.equal(received.explicitSessions, true); assert.equal(received.explicitInterval, true);
    assert.equal(result.qualification.status, 'pending'); assert.equal(result.qualification.resourceReturnVerified, false);
    assert.equal(JSON.parse(fs.readFileSync(result.qualificationPath, 'utf8')).shutdownVerified, true);
});

test('the real managed pool integrates without persisting duplicate source bytes in cleanup metadata', async t => {
    const f = fixture(t, [{name: 'Demo.A', type: 'CLS'}, {name: 'Demo.B', type: 'CLS'}]);
    const requests = [];
    const server = http.createServer((request, response) => {
        requests.push({path: request.url, authorization: request.headers.authorization, cookie: request.headers.cookie});
        if (request.method === 'HEAD') { response.writeHead(200); response.end(); return; }
        response.setHeader('Set-Cookie', 'CSPSESSIONID=synthetic; Path=/api/atelier/');
        if (request.url === '/api/atelier/') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({result: {content: {version: 'synthetic-1', id: 'synthetic-instance', api: 1}}})); return;
        }
        const document = decodeURIComponent(request.url.split('/doc/')[1]);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({result: {name: document, content: cls(document === 'Demo.A.cls' ? 'A' : 'B').split('\n'), ts: '2026-10-28 00:00:00'}}));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    f.config.iris = {scheme: 'http', host: '127.0.0.1', port: server.address().port, namespace: 'FIXTURE'};
    Object.assign(f.mcp.mcpServers['iris-agentic-dev'].env, {IRIS_SCHEME: 'http', IRIS_HOST: '127.0.0.1', IRIS_WEB_PORT: String(server.address().port)});
    f.put('.agents/config/project-env.json', JSON.stringify(f.config)); f.put('.mcp.json', JSON.stringify(f.mcp));
    const connection = require('../compile-csp').connection(f.config, f.mcp);
    const pool = require('../../../../../scripts/lib/atelier-read-pool');
    const qualification = {schema: 'iris-read-qualification/v1', status: 'verified', syntheticFixture: true,
        targetHash: pool.readTargetHash(connection), channel: 'atelier', configurationFingerprint: pool.readConfigurationHash(connection),
        runtimeFingerprint: pool.readRuntimeHash(), serverVersion: 'synthetic-1', instanceId: 'synthetic-instance', sessions: 1,
        intervalMs: 200, maxDocuments: 5, shutdownVerified: true, resourceReturnVerified: true};
    const qualificationJson = JSON.stringify(qualification);
    const reference = '.agents/config/read-qualification.fixture.json'; f.put(reference, qualificationJson);
    f.put('.agents/config/iris-remote-policy.json', JSON.stringify({schema: 'iris-remote-policy/v1', enabled: true,
        coordinationRoot: path.join(f.root, '.agents/work/remote-fixture'), poolKey: 'synthetic-fixture-pool', maxConcurrent: 1,
        qualification: {status: 'verified', reference},
        readBatch: {qualification: {status: 'verified', reference, sha256: core.hash(Buffer.from(qualificationJson))}}}));
    const p = f.plan(), result = await core.capture(p.planPath);
    assert.equal(result.state, 'complete'); assert.equal(result.fetched, 2); assert.equal(result.effectiveSessions, 1);
    assert.equal(result.cleanup.requestedIntervalMs, 100); assert.equal(result.cleanup.intervalMs, 200);
    assert.equal(requests.length, 4); assert.ok(requests[0].authorization); assert.equal(requests[1].authorization, undefined);
    assert.equal(requests[3].path, '/api/atelier/?CacheLogout=end');
    const stored = core.load(p.planPath);
    assert.equal(stored.cleanup.items, undefined); assert.equal(stored.cleanup.cleanupVerified, true);
    assert.equal(JSON.stringify(stored).includes('Parameter Value'), false);
});

test('owned read-only sources are never made writable as an update shortcut', async t => {
    const f = fixture(t), p = f.plan();
    await core.capture(p.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', cls('A'))}])});
    const file = path.join(f.out, 'src/Demo/A.cls'); fs.chmodSync(file, 0o444);
    try {
        const next = f.plan({previousPlan: p.planPath});
        const result = await core.capture(next.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', cls('A').replace('BASE', 'NEXT'))}])});
        assert.equal(result.failed, 1); assert.equal(result.items[0].reason, 'baseline-readonly-file');
        assert.equal(fs.readFileSync(file, 'utf8'), cls('A')); assert.equal(fs.statSync(file).mode & 0o200, 0);
    } finally { fs.chmodSync(file, 0o600); }
});

test('invalid identities and empty source never overwrite code and missing cleanup blocks acceptance', async t => {
    const f = fixture(t), p = f.plan();
    let result = await core.capture(p.planPath, {readerFactory: reader([{status: 'fetched', value: value('Demo.A.cls', cls('Other'))}])});
    assert.equal(result.failed, 1); assert.equal(fs.existsSync(path.join(f.out, 'src/Demo/A.cls')), false);
    result = await core.capture(p.planPath, {resume: true, readerFactory: reader([{status: 'empty'}], {cleanupVerified: false})});
    assert.equal(result.state, 'blocked'); assert.equal(result.empty, 1);
    assert.throws(() => core.acceptPartial(p.planPath, {confirm: true, token: core.acceptanceToken(core.load(p.planPath)), evidence: 'no-cleanup'}), /baseline-partial-acceptance-required/);
});

test('images-only capture reports exclusions and never opens a connection', async t => {
    const f = fixture(t, [{name: 'fixture/web/images/a.svg', type: 'CSP'}]), p = f.plan();
    const result = await core.capture(p.planPath, {readerFactory: () => assert.fail('excluded image must not be requested')});
    assert.equal(result.total, 0); assert.equal(result.excludedImageCount, 1); assert.equal(result.state, 'complete');
});

test('help exits before configuration resolution even when paired with execution arguments', () => {
    const cli = path.resolve(__dirname, '../code-baseline.js');
    const result = spawnSync(process.execPath, [cli, 'capture', '--plan', 'missing.json', '--help'], {encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 0); assert.match(result.stdout, /never commits/); assert.equal(result.stderr, '');
});
