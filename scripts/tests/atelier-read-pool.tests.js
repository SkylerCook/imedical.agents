'use strict';
const {createTempDirectory,ownsTempDirectory}=require('./fixtures/temp-directory');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const remote = require('../lib/iris-remote-operations');
const {createAtelierClient} = require('../lib/atelier-client');
const {createAtelierReadPool, readTargetHash, readConfigurationHash, readRuntimeHash, selectBudget} = require('../lib/atelier-read-pool');

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t, respond = async () => ({})) {
    const root = createTempDirectory('atelier-read-pool-');
    const context = {workspaceRoot: root, contextRoot: path.join(root, '.agents')};
    fs.mkdirSync(path.join(context.contextRoot, 'config'), {recursive: true});
    fs.writeFileSync(path.join(root, 'base-qualification.json'), '{"synthetic":true}\n');
    let serial = 0;
    const requests = [], logouts = [], infoRequests = [];
    const server = http.createServer(async (req, res) => {
        const cookie = req.headers.cookie || `CSPSESSIONID=worker-${++serial}`;
        if (req.method === 'HEAD') { logouts.push(cookie); res.writeHead(200); res.end(); return; }
        if (req.method === 'GET' && req.url.endsWith('/api/atelier/')) {
            infoRequests.push({url: req.url, cookie});
            res.writeHead(200, {'content-type': 'application/json', 'set-cookie': cookie + '; Path=/'});
            res.end(JSON.stringify({result: {content: {version: 'synthetic-1', id: 'synthetic-instance', api: 1}}}));
            return;
        }
        const document = decodeURIComponent((req.url.split('/doc/')[1] || '').split('?')[0]);
        const item = {method: req.method, document, cookie, binary: new URL(req.url, 'http://localhost').searchParams.get('binary') === '1'}; requests.push(item);
        try {
            const response = await respond(item, requests);
            res.writeHead(response.status || 200, {'content-type': 'application/json', 'set-cookie': cookie + '; Path=/'});
            res.end(JSON.stringify(response.body || {result: {name: document, ts: '2026-10-28 01:00:00', content: [`Class ${document.replace(/\.cls$/, '')} {}`]}}));
        } catch { res.writeHead(500); res.end('{}'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        const absolute = fs.realpathSync(root);
        assert.equal(ownsTempDirectory(absolute), true);
        fs.rmSync(absolute, {recursive: true, force: true});
        assert.equal(fs.existsSync(root), false);
    });
    const connection = {protocol: 'http:', hostname: '127.0.0.1', port: server.address().port, path: '/api/atelier/v1/TEST/'};
    const policy = {schema: 'iris-remote-policy/v1', enabled: true, maxConcurrent: 1, coordinationRoot: path.join(root, 'coordination'), poolKey: 'synthetic',
        qualification: {status: 'verified', reference: 'base-qualification.json'}};
    function qualify({sessions = 2, intervalMs = 0, maxDocuments = 20, ...override} = {}) {
        const evidence = {schema: 'iris-read-qualification/v1', status: 'verified', channel: 'atelier', targetHash: readTargetHash(connection),
            configurationFingerprint: readConfigurationHash(connection), runtimeFingerprint: readRuntimeHash(),
            serverVersion: 'synthetic-1', instanceId: 'synthetic-instance', sessions, intervalMs,
            maxDocuments, shutdownVerified: true, resourceReturnVerified: true, ...override};
        const bytes = Buffer.from(JSON.stringify(evidence));
        fs.writeFileSync(path.join(root, 'read-qualification.json'), bytes);
        policy.readBatch = {sessions, intervalMs, qualification: {status: 'verified', reference: 'read-qualification.json', sha256: sha(bytes)}};
        return evidence;
    }
    return {root, context, connection, policy, requests, logouts, infoRequests, qualify, selected: () => remote.loadRemotePolicy(context, {connection, policy})};
}

test('qualified workers run concurrently, reuse separate cookies, retain one owner, and close their own sessions', async t => {
    let active = 0, peak = 0, sawOwnerConflict = false;
    const f = await fixture(t, async () => {
        active++; peak = Math.max(peak, active);
        if (!sawOwnerConflict) {
            assert.throws(() => remote.createRemoteOperation({policy: f.selected(), connection: f.connection}).acquire(), /busy-or-unresolved/);
            sawOwnerConflict = true;
        }
        await pause(30); active--; return {};
    });
    f.qualify({sessions: 2});
    const pool = createAtelierReadPool({...f, sessions: 2, intervalMs: 0, explicitSessions: true});
    const result = await pool.readAll(['Demo.A.cls', 'Demo.B.cls', 'Demo.C.cls', 'Demo.D.cls']);
    assert.equal(peak, 2);
    assert.equal(sawOwnerConflict, true);
    assert.deepEqual(result.items.map(value => value.status), ['fetched', 'fetched', 'fetched', 'fetched']);
    assert.equal(new Set(f.requests.map(value => value.cookie)).size, 2);
    assert.equal(f.infoRequests.length, 1);
    assert.equal(f.infoRequests[0].url, '/api/atelier/');
    assert.ok(f.requests.some(value => value.cookie === f.infoRequests[0].cookie));
    assert.equal(f.logouts.length, 2);
    assert.equal(new Set(f.logouts).size, 2);
    assert.equal(result.cleanupVerified, true);
    assert.equal(result.licenseReleaseVerified, false);
    assert.equal(result.serverVersion, 'synthetic-1');
    assert.equal(result.instanceId, 'synthetic-instance');
    assert.equal(remote.poolStatus({policy: f.selected()}).ownerPresent, false);
});

test('one worker 503 stops dispatch and persists circuit plus batch records after closing every started session', async t => {
    const f = await fixture(t, async item => {
        await pause(item.document === 'Demo.A.cls' ? 10 : 35);
        return item.document === 'Demo.A.cls' ? {status: 503} : {};
    });
    f.qualify({sessions: 2});
    const pool = createAtelierReadPool({...f, sessions: 2, intervalMs: 0, explicitSessions: true});
    let error;
    try { await pool.readAll(['Demo.A.cls', 'Demo.B.cls', 'Demo.C.cls', 'Demo.D.cls']); }
    catch (value) { error = value; }
    assert.ok(error);
    assert.equal(f.requests.length, 2);
    assert.equal(f.logouts.length, 2);
    assert.equal(error.batchResult.items.length, 4);
    assert.equal(error.batchResult.items.filter(item => item.status === 'cancelled').length, 2);
    const status = remote.poolStatus({policy: f.selected()});
    assert.equal(status.status, 'circuit-open');
    assert.equal(status.ownerPresent, false);
    const state = JSON.parse(fs.readFileSync(path.join(f.policy.coordinationRoot, sha(f.policy.poolKey), 'state.json'), 'utf8'));
    assert.equal(state.lastFailedOperation.batch.completed.length, 4);
    const failed=state.lastFailedOperation.batch.completed.find(item=>item.status==='failed');
    assert.equal(failed.error.beforeSend,false);
    assert.equal(failed.error.httpStatus,503);
    assert.equal(state.lastFailedOperation.httpStatus,503);
    assert.throws(() => remote.createRemoteOperation({policy: f.selected(), connection: f.connection}).acquire(), /cooling-down/);
});

test('default unqualified concurrency falls back to one for a small qualified-base batch', async t => {
    const f = await fixture(t);
    const pool = createAtelierReadPool({...f, sessions: 4, intervalMs: 0});
    const result = await pool.readAll(['web/scripts/test.js', 'web/csp/test.csp']);
    assert.equal(result.sessions, 1);
    assert.equal(f.logouts.length, 1);
    assert.equal(new Set(f.requests.map(value => value.cookie)).size, 1);
});

test('qualification evidence is content-bound and cannot be reused against a different namespace', async t => {
    const f = await fixture(t); f.qualify();
    assert.throws(() => createAtelierReadPool({...f, connection: {...f.connection, path: '/api/atelier/v1/OTHER/'}, sessions: 2, intervalMs: 0, explicitSessions: true}), /qualification-invalid/);
    fs.appendFileSync(path.join(f.root, 'read-qualification.json'), '\n');
    assert.throws(() => createAtelierReadPool({...f, sessions: 2, intervalMs: 0, explicitSessions: true}), /qualification-drift/);
    assert.equal(f.requests.length, 0);
});

test('an explicit qualification trial permits only its exact document scope', async t => {
    const f = await fixture(t);
    f.policy.qualification.status = 'pending';
    const qualification = {confirm: true, targetHash: readTargetHash(f.connection), documents: ['Demo.A.cls'], sessions: 1, intervalMs: 0, budgetMs: 1000};
    const pool = createAtelierReadPool({...f, qualification, sessions: 1, intervalMs: 0});
    await assert.rejects(pool.readAll(['Demo.B.cls']), /scope-mismatch/);
    await pool.close();
    assert.equal(f.requests.length, 0);
});

test('fresh legacy context cannot start bulk capture without any base qualification policy', async t => {
    const f = await fixture(t);
    let pool;
    await assert.rejects(async () => {
        pool = createAtelierReadPool({context: f.context, connection: f.connection, sessions: 1, intervalMs: 0});
        await pool.readAll(Array.from({length: 6}, (_, index) => `Demo.Item${index}.cls`));
    }, /qualification|policy-required/);
    if (pool) await pool.close();
    assert.equal(f.requests.length, 0);
});

test('single-session override cannot borrow bulk qualification with a faster interval than verified', async t => {
    const f = await fixture(t); f.qualify({sessions: 4, intervalMs: 100});
    assert.throws(() => selectBudget({sessions: 1, intervalMs: 0, explicitSessions: true, explicitInterval: true}, f.context, f.connection, f.selected()), /qualification|interval/);
    const implicit = selectBudget({sessions: 1, intervalMs: 0}, f.context, f.connection, f.selected());
    assert.equal(implicit.intervalMs, 100);
});

test('qualification-only client cannot perform writes with a pending base policy', async t => {
    const f = await fixture(t); f.policy.qualification.status = 'pending';
    const qualification = {confirm: true, targetHash: readTargetHash(f.connection), documents: ['Demo.A.cls'], sessions: 1, intervalMs: 0, budgetMs: 1000};
    const client = createAtelierClient({...f, qualification});
    try { await assert.rejects(client.writeDocument('Other.cls', 'Class Other {}'), /qualification|read-only/); }
    finally { await client.close(); }
    assert.equal(f.requests.length, 0);
});

test('qualification-only client reads each named document once and rejects extra reads and POST docs', async t => {
    const f = await fixture(t); f.policy.qualification.status = 'pending';
    const qualification = {confirm: true, targetHash: readTargetHash(f.connection), documents: ['web/scripts/test.js'], sessions: 1, intervalMs: 0, budgetMs: 1000};
    const client = createAtelierClient({...f, qualification});
    try {
        await assert.rejects(client.readDocument('Other.cls'), /qualification|read-only/);
        await assert.rejects(client.readDocuments(['web/scripts/test.js']), /qualification|read-only/);
        assert.equal((await client.readDocument('web/scripts/test.js')).document, 'web/scripts/test.js');
        await assert.rejects(client.readDocument('web/scripts/test.js'), /qualification|read-only/);
    } finally { await client.close(); }
    assert.equal(f.requests.length, 1);
    assert.equal(f.logouts.length, 1);
});

test('an expired qualification-only client stops before sending a document request', async t => {
    const f = await fixture(t); f.policy.qualification.status = 'pending';
    const qualification = {confirm: true, targetHash: readTargetHash(f.connection), documents: ['Demo.A.cls'], sessions: 1, intervalMs: 0, budgetMs: 1};
    const client = createAtelierClient({...f, qualification});
    await pause(5);
    try { await assert.rejects(client.readDocument('Demo.A.cls'), /qualification|deadline/); }
    finally { await client.close(); }
    assert.equal(f.requests.length, 0);
});

test('server version drift is rejected after one same-session probe and before any document read', async t => {
    const f = await fixture(t); f.qualify({serverVersion: 'synthetic-old'});
    const pool = createAtelierReadPool({...f, sessions: 2, intervalMs: 0, explicitSessions: true});
    await assert.rejects(pool.readAll(['Demo.A.cls']), /qualification|version|runtime/);
    assert.equal(f.infoRequests.length, 1);
    assert.equal(f.requests.length, 0);
    assert.equal(f.logouts.length, 1);
});

test('server instance drift is rejected before any document read and the probe session is closed', async t => {
    const f = await fixture(t); f.qualify({instanceId: 'previous-instance'});
    const pool = createAtelierReadPool({...f, sessions: 2, intervalMs: 0, explicitSessions: true});
    await assert.rejects(pool.readAll(['Demo.A.cls']), /qualification|instance|runtime/);
    assert.equal(f.infoRequests.length, 1);
    assert.equal(f.requests.length, 0);
    assert.equal(f.logouts.length, 1);
});

test('read qualification cannot cross credential configuration or runtime fingerprints', async t => {
    const f = await fixture(t); f.qualify();
    assert.throws(() => createAtelierReadPool({...f, connection: {...f.connection, username: 'different-user'}, sessions: 2, intervalMs: 0, explicitSessions: true}), /qualification|configuration/);
    f.qualify({runtimeFingerprint: '0'.repeat(64)});
    assert.throws(() => createAtelierReadPool({...f, sessions: 2, intervalMs: 0, explicitSessions: true}), /qualification|runtime/);
    assert.equal(f.infoRequests.length, 0);
    assert.equal(f.requests.length, 0);
});

test('read qualification channel must be atelier', async t => {
    const f = await fixture(t); f.qualify({channel: 'mcp'});
    assert.throws(() => createAtelierReadPool({...f, sessions: 2, intervalMs: 0, explicitSessions: true}), /qualification|channel/);
    assert.equal(f.infoRequests.length, 0);
    assert.equal(f.requests.length, 0);
});

test('legacy qualification missing a required runtime binding is invalid before probing', async t => {
    const f = await fixture(t);
    for (const key of ['channel', 'configurationFingerprint', 'runtimeFingerprint', 'serverVersion', 'instanceId']) {
        f.qualify({[key]: undefined});
        assert.throws(() => createAtelierReadPool({...f, sessions: 2, intervalMs: 0, explicitSessions: true}), /qualification/);
    }
    assert.equal(f.infoRequests.length, 0);
    assert.equal(f.requests.length, 0);
});

test('framework-owned session limit defaults to twelve and caps qualified workers', async t => {
    assert.equal(remote.frameworkSessionLimit({}), 12);
    assert.throws(() => remote.frameworkSessionLimit({maxFrameworkSessions: 0}));
    const f = await fixture(t);
    f.qualify({sessions: 20});
    assert.equal(selectBudget({}, f.context, f.connection, f.policy).sessions, 12);
    f.policy.maxFrameworkSessions = 1;
    const pool = createAtelierReadPool({...f, sessions: 20, intervalMs: 0});
    const result = await pool.readAll(['Demo.A.cls', 'Demo.B.cls', 'Demo.C.cls']);
    assert.equal(result.items.length, 3);
    assert.equal(new Set(f.requests.map(value => value.cookie)).size, 1);
    assert.equal(f.logouts.length, 1);
    assert.equal(result.cleanupVerified, true);
});

test('mixed source-sync batch reads declared frontend binary bytes through the real pool', async t => {
    const bytes=Buffer.from('d6d0cec4','hex');
    const f=await fixture(t,async item=>item.binary?{body:{result:{name:item.document,ts:'2026-10-28 01:00:00',enc:true,content:[bytes.toString('base64')]}}}:{});
    const pool=createAtelierReadPool({...f,sessions:1});
    const documents=['Demo.A.cls','web/scripts/a.js','web/csp/page.csp','web/css/style.css','web/page.html'];
    const result=await pool.readAll(documents,{binaryDocuments:documents.slice(1)});
    assert.deepEqual(result.items.map(item=>item.status),documents.map(()=>'fetched'));
    assert.deepEqual(f.requests.map(item=>item.binary),[false,true,true,true,true]);
    for(const item of result.items.slice(1))assert.deepEqual(item.value.bytes,bytes);
    assert.equal(new Set(f.requests.map(item=>item.cookie)).size,1);
    await pool.close();
});

test('readDocument binary option uses the same admitted read-pool path',async t=>{
    const bytes=Buffer.from([0x94,0x39,0xfc,0x36]);
    const f=await fixture(t,async item=>({body:{result:{name:item.document,ts:'2026-10-28 01:00:00',enc:true,content:[bytes.toString('base64')]}}}));
    const pool=createAtelierReadPool({...f,sessions:1});
    const result=await pool.readDocument('web/scripts/one.js',{binary:true});
    assert.deepEqual(result.bytes,bytes);assert.equal(f.requests[0].binary,true);
    await pool.close();
});

test('binary options cannot add documents outside the declared read batch',async t=>{
 const f=await fixture(t);const pool=createAtelierReadPool({...f,sessions:1});
 await assert.rejects(pool.readAll(['Demo.A.cls'],{binaryDocuments:['web/other.js']}),{code:'read-pool-binary-documents-invalid',beforeSend:true});
 assert.equal(f.requests.length,0);assert.equal(f.infoRequests.length,0);await pool.close();
});
