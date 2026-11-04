'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const remote = require('../lib/iris-remote-operations');
const {makeScope, COOLDOWN_MS} = require('../lib/iris-operation-scope');
const {createAtelierClient} = require('../lib/atelier-client');
const {operation} = require('../lib/iris-session-backends');
const {createTempDirectory, ownsTempDirectory} = require('./fixtures/temp-directory');

function fixture(t) {
    const root = createTempDirectory('iris-operation-admission-');
    const context = {workspaceRoot: root, contextRoot: path.join(root, '.agents')};
    fs.mkdirSync(path.join(context.contextRoot, 'config'), {recursive: true});
    fs.writeFileSync(path.join(root, 'qualification.json'), '{"synthetic":true}\n');
    const policy = {schema: 'iris-remote-policy/v1', enabled: true, coordinationRoot: path.join(root, 'coordination'),
        poolKey: 'synthetic', qualification: {status: 'verified', reference: 'qualification.json'}};
    const connection = {protocol: 'https:', hostname: 'synthetic.invalid', port: 443, path: '/api/atelier/v1/TEST/', rejectUnauthorized: true};
    const selected = (value = policy, target = connection) => remote.loadRemotePolicy(context, {policy: value, connection: target});
    const stateFile = value => path.join(value.coordinationRoot, crypto.createHash('sha256').update(value.poolKey).digest('hex'), 'state.json');
    t.after(() => {if (ownsTempDirectory(root)) fs.rmSync(root, {recursive: true});});
    return {root, context, policy, connection, selected, stateFile};
}

async function server(t, handler) {
    const instance = http.createServer(handler);
    await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
    t.after(() => {instance.closeAllConnections(); instance.close();});
    return {protocol: 'http:', hostname: '127.0.0.1', port: instance.address().port, path: '/api/atelier/v1/TEST/', rejectUnauthorized: true};
}

const unknown = () => Object.assign(new Error('synthetic lost result'), {beforeSend: false});
const deniedBeforeSend = error => error.code === 'session-write-conflict-unresolved' && error.beforeSend === true;

function success(res) {
    res.setHeader('Set-Cookie', 'CSPSESSIONID=synthetic; Path=/api/atelier/; HttpOnly');
    res.end(JSON.stringify({status: {errors: []}, result: {content: ['synthetic'], ts: '2026-11-04 01:02:03.000'}}));
}

test('actual unknown PUT A permits GET A and PUT B but refuses another PUT A before HTTP', async t => {
    const f = fixture(t), requests = [];
    const connection = await server(t, (req, res) => {
        requests.push(req.method + ' ' + req.url);
        if (req.method === 'HEAD') {res.writeHead(401); res.end(); return;}
        if (req.method === 'PUT' && req.url.endsWith('Demo.A.cls')) {res.destroy(); return;}
        success(res);
    });
    const policy = f.selected(f.policy, connection);
    const lost = createAtelierClient({context: f.context, connection, policy});
    try {await assert.rejects(lost.writeDocument('Demo.A.cls', 'new A'));}
    finally {await lost.close();}
    assert.equal(remote.poolStatus({policy}).unresolvedWrites.length, 1);
    const next = createAtelierClient({context: f.context, connection, policy});
    try {
        await next.readDocument('Demo.A.cls');
        await next.writeDocument('Demo.B.cls', 'new B');
        await assert.rejects(next.writeDocument('Demo.A.cls', 'replay A'), deniedBeforeSend);
    } finally {await next.close();}
    assert.equal(requests.filter(value => value === 'PUT /api/atelier/v1/TEST/doc/Demo.A.cls').length, 1);
    assert.equal(requests.filter(value => value === 'GET /api/atelier/v1/TEST/doc/Demo.A.cls').length, 1);
    assert.equal(requests.filter(value => value === 'PUT /api/atelier/v1/TEST/doc/Demo.B.cls').length, 1);
    assert.equal(remote.poolStatus({policy}).unresolvedWrites.length, 1);
});

test('markUnknown and thrown write error identify one failed request rather than duplicate risks', async t => {
    const f = fixture(t), policy = f.selected(), scope = makeScope(f.connection, ['Demo.A.cls']);
    const owner = remote.createRemoteOperation({policy, connection: f.connection});
    try {
        await assert.rejects(owner.run({effects: 'write', scope}, async () => {
            owner.markUnknown('atelier-session-identity-unverified');
            throw unknown();
        }));
        assert.equal(remote.poolStatus({policy}).unresolvedWrites.length, 1);
        assert.equal(typeof remote.poolStatus({policy}).unresolvedWrites[0].id, 'string');
    } finally {owner.close({cleanupVerified: true});}
});

test('reconciling write A by id preserves independent unknown write B', async t => {
    const f = fixture(t), policy = f.selected();
    const a = makeScope(f.connection, ['Demo.A.cls']), b = makeScope(f.connection, ['Demo.B.cls']);
    const owner = remote.createRemoteOperation({policy, connection: f.connection});
    try {
        await assert.rejects(owner.run({effects: 'write', scope: a}, async () => {throw unknown();}));
        await assert.rejects(owner.run({effects: 'write', scope: b}, async () => {throw unknown();}));
    } finally {owner.close({cleanupVerified: true});}
    const before = remote.poolStatus({policy});
    assert.equal(before.unresolvedWrites.length, 2);
    const evidenceFile = path.join(f.root, 'human-evidence.json');
    fs.writeFileSync(evidenceFile, '{"synthetic":true,"cleanupVerified":true}');
    assert.throws(() => remote.reconcileRemotePool({policy, token: before.reconciliationToken, evidenceFile, confirm: true, writeOutcome: 'verified-not-applied'}), /write-id-required/);
    assert.equal(remote.poolStatus({policy}).unresolvedWrites.length, 2);
    remote.reconcileRemotePool({policy, token: before.reconciliationToken, evidenceFile, confirm: true,
        writeOutcome: 'verified-not-applied', writeIds: [before.unresolvedWrites[0].id]});
    const after = remote.poolStatus({policy});
    assert.deepEqual(after.unresolvedWrites.map(item => item.id), [before.unresolvedWrites[1].id]);
    const next = remote.createRemoteOperation({policy, connection: f.connection});
    try {
        assert.equal(await next.run({effects: 'write', scope: a}, async () => 'A accepted'), 'A accepted');
        await assert.rejects(next.run({effects: 'write', scope: b}, async () => {throw Error('must not dispatch B');}), deniedBeforeSend);
    } finally {next.close({cleanupVerified: true});}
});

test('legacy coordination-root unknown writes remain protected while ordinary reads continue', async t => {
    const f = fixture(t), selected = f.selected(), legacyRoot = path.join(f.root, 'old-coordination');
    const legacyPolicy = {...selected, coordinationRoot: legacyRoot};
    const legacyFile = f.stateFile(legacyPolicy);
    fs.mkdirSync(path.dirname(legacyFile), {recursive: true});
    const prior = {schema: 'iris-remote-pool/v1', instances: [remote.instanceIdentity(f.connection)],
        status: 'reconciliation-required', reason: 'remote-write-outcome-unknown', inFlight: {effects: 'write', operation: 'historical-tool'}};
    fs.writeFileSync(legacyFile, JSON.stringify(prior));
    const policy = {...selected, legacyCoordinationRoot: legacyRoot};
    const owner = remote.createRemoteOperation({policy, connection: f.connection});
    try {
        assert.equal(await owner.run({effects: 'read-only', scope: makeScope(f.connection, ['Demo.A.cls'])}, async () => 'diagnosis'), 'diagnosis');
        await assert.rejects(owner.run({effects: 'write', scope: makeScope(f.connection, ['Demo.B.cls'])}, async () => {throw Error('must not dispatch legacy-conflicting write');}), deniedBeforeSend);
        assert.deepEqual(JSON.parse(fs.readFileSync(legacyFile, 'utf8')), prior);
    } finally {owner.close({cleanupVerified: true});}
});

test('httpStatus 503 after sending a write retains its risk beyond availability cooldown', async t => {
    const f = fixture(t), policy = f.selected();
    let now = 1793750400000;
    t.mock.method(Date, 'now', () => now);
    const a = makeScope(f.connection, ['Demo.A.cls']), b = makeScope(f.connection, ['Demo.B.cls']);
    const owner = remote.createRemoteOperation({policy, connection: f.connection});
    try {await assert.rejects(owner.run({effects: 'write', scope: a}, async () => {throw Object.assign(unknown(), {httpStatus: 503});}));}
    finally {owner.close({cleanupVerified: true});}
    assert.equal(remote.poolStatus({policy}).unresolvedWrites.length, 1);
    const early = remote.createRemoteOperation({policy, connection: f.connection});
    try {await assert.rejects(early.run({effects: 'read-only', scope: b}, async () => {throw Error('must not dispatch during cooldown');}), error => error.code === 'session-service-cooling-down' && error.beforeSend === true);}
    finally {early.close({cleanupVerified: true});}
    now += COOLDOWN_MS + 1;
    const next = remote.createRemoteOperation({policy, connection: f.connection});
    try {
        assert.equal(await next.run({effects: 'read-only', scope: a}, async () => 'fresh diagnostic'), 'fresh diagnostic');
        await assert.rejects(next.run({effects: 'write', scope: a}, async () => {throw Error('must not replay original write');}), deniedBeforeSend);
        assert.equal(await next.run({effects: 'write', scope: b}, async () => 'independent B'), 'independent B');
        assert.equal(remote.poolStatus({policy}).unresolvedWrites.length, 1);
    } finally {next.close({cleanupVerified: true});}
});

test('MCP scope is derived from actual batch semantics and cannot be supplied by the caller', t => {
    const f = fixture(t);
    fs.mkdirSync(path.join(f.context.contextRoot, '.git'));
    fs.writeFileSync(path.join(f.root, '.mcp.json'), JSON.stringify({mcpServers: {'iris-agentic-dev': {
        command: process.execPath, args: [], env: {IRIS_HOST: 'synthetic.invalid', IRIS_WEB_PORT: '443', IRIS_SCHEME: 'https', IRIS_NAMESPACE: 'TEST'}
    }}}));
    fs.writeFileSync(path.join(f.context.contextRoot, 'config/iris-session-backend.json'), JSON.stringify({
        schema: 'iris-session-backend/v1', serverName: 'iris-agentic-dev', command: process.execPath, args: []
    }));
    const call = args => operation({projectRoot: f.root, method: 'tools/call', allowWrite: true, effects: 'read-only', scope: {instance: 'caller-spoof', namespace: 'different', targets: ['safe']},
        params: {name: 'iris_doc', arguments: args}});
    const ordinary = call({mode: 'put', name: 'Demo.A.cls', content: 'source'});
    assert.equal(ordinary.effects, 'write');
    assert.deepEqual(ordinary.scope, makeScope(f.connection, ['Demo.A.cls']));
    for (const args of [{mode: 'delete', name: 'Demo.A.cls', names: ['Demo.B.cls']},
        {mode: 'put', name: 'Demo.A'}, {mode: 'put', name: 'Demo.A.cls', compile: true}]) {
        const result = call(args);
        assert.equal(result.effects, 'write');
        assert.equal(result.scope.targets, null);
        assert.equal(result.scope.namespace, makeScope(f.connection).namespace);
    }
});

test('Atelier options.effects cannot downgrade PUT when only the admission ledger holds the risk', async t => {
    const f = fixture(t), requests = [];
    const connection = await server(t, (req, res) => {
        requests.push(req.method + ' ' + req.url);
        if (req.method === 'HEAD') {res.writeHead(401); res.end(); return;}
        success(res);
    });
    const policy = f.selected(f.policy, connection), scope = makeScope(connection, ['Demo.A.cls']);
    const owner = remote.createRemoteOperation({policy, connection});
    try {await assert.rejects(owner.run({effects: 'write', scope}, async () => {throw unknown();}));}
    finally {owner.close({cleanupVerified: true});}
    const client = createAtelierClient({context: f.context, connection, policy});
    try {
        await assert.rejects(client.request('PUT', 'doc/Demo.A.cls', {enc: false, content: ['bypass']}, {}, {effects: 'read-only', scope: makeScope(connection, ['Different.cls'])}), deniedBeforeSend);
        assert.deepEqual(requests, []);
        await client.request('GET', 'doc/Demo.A.cls');
    } finally {await client.close();}
    assert.equal(requests.filter(value => value.startsWith('PUT ')).length, 0);
    assert.equal(remote.poolStatus({policy}).unresolvedWrites.length, 1);
});

test('resolving A preserves a distinct crashed in-flight B and its stable recovery identity', async t => {
    const f = fixture(t), policy = f.selected();
    const a = makeScope(f.connection, ['Demo.A.cls']), b = makeScope(f.connection, ['Demo.B.cls']);
    const owner = remote.createRemoteOperation({policy, connection: f.connection});
    try {await assert.rejects(owner.run({effects: 'write', scope: a}, async () => {throw unknown();}));}
    finally {owner.close({cleanupVerified: true});}
    const file = f.stateFile(policy), state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const aId = state.unresolvedWrites[0].id;
    state.inFlight = {id: 'synthetic-crashed-B', token: crypto.randomUUID(), effects: 'write', scope: b,
        operation: 'PUT', at: '2026-11-04T00:00:00.000Z'};
    fs.writeFileSync(file, JSON.stringify(state));
    const first = remote.poolStatus({policy}), second = remote.poolStatus({policy});
    assert.equal(first.ownerAlive, false);
    assert.equal(first.unresolvedWrites.length, 2);
    assert.deepEqual(first.unresolvedWrites.map(item => item.id), second.unresolvedWrites.map(item => item.id));
    assert.equal(first.unresolvedWrites.some(item => item.id === 'synthetic-crashed-B'), true);
    const evidenceFile = path.join(f.root, 'partial-recovery.json');
    fs.writeFileSync(evidenceFile, '{"synthetic":true,"cleanupVerified":true,"confirmedOnly":"A"}');
    remote.reconcileRemotePool({policy, token: first.reconciliationToken, evidenceFile, confirm: true,
        writeOutcome: 'verified-not-applied', writeIds: [aId]});
    const after = remote.poolStatus({policy});
    assert.deepEqual(after.unresolvedWrites.map(item => item.id), ['synthetic-crashed-B']);
    const next = remote.createRemoteOperation({policy, connection: f.connection});
    try {
        assert.equal(await next.run({effects: 'write', scope: a}, async () => 'A accepted'), 'A accepted');
        await assert.rejects(next.run({effects: 'write', scope: b}, async () => {throw Error('B remains unresolved');}), deniedBeforeSend);
    } finally {next.close({cleanupVerified: true});}
});

test('known live local resources cannot be downgraded to a cross-process logout warning', async t => {
    for (const exit of [{cleanupVerified: false, processExited: false}, {cleanupVerified: false, localResourcesClosed: false}]) {
        const f = fixture(t), policy = f.selected();
        const first = remote.createRemoteOperation({policy, connection: f.connection});
        await first.run({effects: 'read-only'}, async () => 'completed operation');
        assert.equal(first.close(exit).cleanupVerified, false);
        let dispatched = false;
        const next = remote.createRemoteOperation({policy, connection: f.connection});
        try {
            await assert.rejects(next.run({effects: 'read-only'}, async () => {dispatched = true;}), error => error.beforeSend === true);
            assert.equal(dispatched, false);
        } finally {next.close({cleanupVerified: true});}
    }
});

test('failed admission cannot overwrite a newer state from its unowned close finally', t => {
    const f=fixture(t), policy=f.selected(), owner=remote.createRemoteOperation({policy,connection:f.connection});
    owner.acquire();owner.close({cleanupVerified:true});
    const file=f.stateFile(policy), blocked=JSON.parse(fs.readFileSync(file,'utf8'));
    blocked.localExitUnverified=true;fs.writeFileSync(file,JSON.stringify(blocked));
    const denied=remote.createRemoteOperation({policy,connection:f.connection});
    assert.throws(()=>denied.acquire(),/local-exit-unverified/);
    const newer={...blocked,reason:'a-new-recovery-record',unresolvedWrites:[{id:'new-risk',scope:null}]};
    fs.writeFileSync(file,JSON.stringify(newer));denied.close({cleanupVerified:true});
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),newer);
});

test('legacy root live resources cannot be bypassed through a fresh coordination root', async t => {
    const f=fixture(t), selected=f.selected(), legacyRoot=path.join(f.root,'legacy-live');
    const file=f.stateFile({...selected,coordinationRoot:legacyRoot});fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,JSON.stringify({schema:'iris-remote-pool/v1',instances:[],status:'reconciliation-required',localExitUnverified:true}));
    const owner=remote.createRemoteOperation({policy:{...selected,legacyCoordinationRoot:legacyRoot},connection:f.connection});
    try {await assert.rejects(owner.run({effects:'read-only'},async()=>{throw Error('must not send');}),/local-exit-unverified/);}
    finally {owner.close({cleanupVerified:true});}
});
