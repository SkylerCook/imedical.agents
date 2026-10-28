'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {createManagedMcpSession} = require('../iris-mcp');
const remote = require('../lib/iris-remote-operations');
const helperPath = path.resolve(__dirname, '../iris-mcp.js');

const mockSource = `
'use strict';
const fs = require('node:fs');
const readline = require('node:readline');
fs.writeFileSync('spawned.json', JSON.stringify({pid: process.pid}));
const lines = readline.createInterface({input: process.stdin});
lines.on('line', line => {
    const request = JSON.parse(line);
    fs.appendFileSync('requests.jsonl', JSON.stringify({pid: process.pid, ...request}) + '\\n');
    if (!request.id) return;
    let result = {};
    if (request.method === 'tools/list') result = {tools: ['check_config', 'iris_doc', 'iris_info', 'iris_execute', 'future_tool'].map(name => ({
        name, inputSchema: {type: 'object', properties: name === 'check_config' || name === 'iris_info' ? {} : {namespace: {type: 'string'}}}
    }))};
    if (request.method === 'tools/call') {
        const value = request.params.name === 'check_config' ? {
            connected: process.env.FIXTURE_DISCONNECTED !== 'true',
            host: process.env.FIXTURE_CHECK_HOST || process.env.IRIS_HOST,
            port: Number(process.env.FIXTURE_CHECK_PORT || process.env.IRIS_WEB_PORT),
            namespace: process.env.FIXTURE_CHECK_NAMESPACE || process.env.IRIS_NAMESPACE
        } : {pid: process.pid, tool: request.params.name, arguments: request.params.arguments};
        result = {content: [{type: 'text', text: JSON.stringify(value)}]};
    }
    process.stdout.write(JSON.stringify({jsonrpc: '2.0', id: request.id, result}) + '\\n');
});
lines.on('close', () => {
    fs.writeFileSync('closing.json', JSON.stringify({pid: process.pid, at: Date.now()}));
    if (process.env.FIXTURE_HANG_ON_CLOSE === 'true') { setInterval(() => {}, 1000); return; }
    setTimeout(() => {
        fs.writeFileSync('cleaned.json', JSON.stringify({pid: process.pid, at: Date.now()}));
        process.exit(0);
    }, Number(process.env.FIXTURE_CLOSE_DELAY_MS || 0));
});
`;

function fixture(t, {serverName = 'custom-iris', closeDelayMs = 0, hang = false, environment = {}} = {}) {
    const parent = path.resolve(process.env.CODEX_TEST_TMP_ROOT || path.join(os.tmpdir(), 'Codex'));
    fs.mkdirSync(parent, {recursive: true});
    const root = path.join(parent, 'iris-mcp-session-' + crypto.randomUUID()); fs.mkdirSync(root);
    const contextRoot = path.join(root, '.agents'); fs.mkdirSync(path.join(contextRoot, 'config'), {recursive: true});
    const reference = 'qualification.fixture.json';
    fs.writeFileSync(path.join(root, reference), JSON.stringify({syntheticFixture: true, status: 'verified'}));
    const settings = {IRIS_SCHEME: 'https', IRIS_HOST: 'synthetic.invalid', IRIS_WEB_PORT: '443', IRIS_NAMESPACE: 'FIXTURE',
        FIXTURE_CLOSE_DELAY_MS: String(closeDelayMs), FIXTURE_HANG_ON_CLOSE: String(hang), ...environment};
    const configuration = {mcpServers: {[serverName]: {command: process.execPath, env: settings}}};
    const policy = {schema: 'iris-remote-policy/v1', enabled: true, coordinationRoot: path.join(root, 'coordination'),
        poolKey: 'synthetic-session-pool', maxConcurrent: 1,
        qualification: {status: 'verified', reference, channels: {mcp: {processExitVerified: true}}}};
    const writePolicy = () => fs.writeFileSync(path.join(contextRoot, 'config/iris-remote-policy.json'), JSON.stringify(policy));
    fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify(configuration));
    fs.writeFileSync(path.join(root, 'mcp'), mockSource); writePolicy();
    const sessions = new Set();
    const open = async options => {
        const session = await createManagedMcpSession({projectRoot: root, serverName, expectedNamespace: 'FIXTURE', ...options});
        sessions.add(session); return session;
    };
    const requests = () => fs.existsSync(path.join(root, 'requests.jsonl')) ? fs.readFileSync(path.join(root, 'requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    const connection = {protocol: 'https:', hostname: settings.IRIS_HOST, port: Number(settings.IRIS_WEB_PORT)};
    const context = {workspaceRoot: root, contextRoot};
    const poolStatus = () => remote.poolStatus({policy: remote.loadRemotePolicy(context, {connection})});
    t.after(async () => {
        for (const session of sessions) await session.close();
        assert.equal(path.dirname(root), parent); assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
        fs.rmSync(root, {recursive: true, force: true}); assert.equal(fs.existsSync(root), false);
    });
    return {root, contextRoot, serverName, configuration, policy, writePolicy, open, requests, poolStatus};
}
async function waitForFile(file, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(file)) {
        if (Date.now() >= deadline) throw Error('Synthetic child did not reach its shutdown checkpoint');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}
async function contender(f) {
    const source = `require(process.argv[1]).createManagedMcpSession({projectRoot:process.argv[2],serverName:process.argv[3],expectedNamespace:'FIXTURE'}).then(async s=>{await s.close();process.stdout.write('unexpected-admission');process.exitCode=1;}).catch(e=>{process.stdout.write(e.code||e.message);process.exitCode=2;});`;
    const child = spawn(process.execPath, ['-e', source, helperPath, f.root, f.serverName], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); }); child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(Error('Synthetic contender did not exit: ' + stderr)); }, 10000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); resolve({code, stdout, stderr}); });
    });
}

test('managed session reuses one child and catalog, injects namespaces by schema and gates write-capable tools', async t => {
    const f = fixture(t), session = await f.open();
    const args = {mode: 'head', name: 'Demo.Sample.cls'};
    const first = await session.call('iris_doc', args);
    const second = await session.call('iris_doc', {mode: 'get', name: 'Demo.Other.cls'});
    const info = await session.call('iris_info', {what: 'version'});
    assert.equal(first.pid, second.pid); assert.equal(info.pid, first.pid);
    assert.equal(first.arguments.namespace, 'FIXTURE'); assert.equal(second.arguments.namespace, 'FIXTURE');
    assert.equal(info.arguments.namespace, undefined); assert.deepEqual(args, {mode: 'head', name: 'Demo.Sample.cls'});
    const before = f.requests().length;
    await assert.rejects(session.call('iris_execute', {code: 'Write 1'}), /Blocked write-capable/);
    await assert.rejects(session.call('future_tool', {}), /Blocked write-capable/);
    await assert.rejects(session.call('iris_doc', {mode: 'put', name: 'Demo.Sample.cls'}), /Blocked write-capable/);
    await assert.rejects(session.call('iris_doc', {mode: 'get', name: 'Demo.Sample.cls', namespace: 'OTHER'}), /remote-mcp-namespace-mismatch/);
    assert.equal(f.requests().length, before);
    const execution = await session.call('iris_execute', {code: 'Write 1'}, {allowWrite: true});
    assert.equal(execution.pid, first.pid); assert.equal(execution.arguments.namespace, 'FIXTURE');
    const requests = f.requests();
    assert.equal(new Set(requests.map(item => item.pid)).size, 1);
    assert.equal(requests.filter(item => item.method === 'initialize').length, 1);
    assert.equal(requests.filter(item => item.method === 'tools/list').length, 1);
    assert.equal(requests.filter(item => item.params?.name === 'check_config').length, 1);
    const receipt = await session.close();
    assert.equal(receipt.cleanupVerified, true); assert.equal(receipt.gracefulExit, true); assert.equal(receipt.processExited, true);
    assert.equal(f.poolStatus().ownerPresent, false);
    await assert.rejects(session.call('iris_doc', {}), /remote-mcp-session-closed/);
    assert.deepEqual(await session.close(), receipt);
});

test('an unverified tool session exit cannot be hidden by a graceful MCP process shutdown', async t => {
    const f = fixture(t), session = await f.open();
    session.markUnknown('terminal-close-unverified');
    const exit = await session.close();
    assert.equal(exit.gracefulExit, true); assert.equal(exit.processExited, true);
    assert.equal(exit.cleanupVerified, false); assert.equal(exit.status, 'reconciliation-required');
    assert.equal(f.poolStatus().status, 'reconciliation-required');
});

test('policy, exit qualification and expected namespace are checked before any child is spawned', async t => {
    for (const variant of ['disabled', 'missing-reference', 'unqualified-exit', 'wrong-namespace', 'missing-server']) {
        const f = fixture(t);
        if (variant === 'disabled') f.policy.enabled = false;
        if (variant === 'missing-reference') f.policy.qualification.reference = 'absent.fixture.json';
        if (variant === 'unqualified-exit') f.policy.qualification.channels.mcp.processExitVerified = false;
        f.writePolicy();
        await assert.rejects(f.open(variant === 'wrong-namespace' ? {expectedNamespace: 'OTHER'} : variant === 'missing-server' ? {serverName: 'absent'} : {}));
        assert.equal(fs.existsSync(path.join(f.root, 'spawned.json')), false, variant);
        assert.equal(f.requests().length, 0, variant);
    }
});

test('runtime check_config target and connected state must match before business calls are exposed', async t => {
    for (const environment of [{FIXTURE_CHECK_HOST: 'different.invalid'}, {FIXTURE_CHECK_PORT: '444'}, {FIXTURE_CHECK_NAMESPACE: 'OTHER'}, {FIXTURE_DISCONNECTED: 'true'}]) {
        const f = fixture(t, {environment});
        await assert.rejects(f.open(), /remote-mcp-target-unverified/);
        assert.equal(f.requests().filter(item => item.method === 'tools/call' && item.params.name !== 'check_config').length, 0);
        assert.equal(f.poolStatus().ownerPresent, false);
        assert.equal(fs.existsSync(path.join(f.root, 'cleaned.json')), true);
    }
});

test('the owner excludes another process between calls and throughout a graceful shutdown longer than one second', async t => {
    const f = fixture(t, {closeDelayMs: 1300}), session = await f.open();
    await session.call('iris_doc', {mode: 'head', name: 'Demo.Sample.cls'});
    let other = await contender(f);
    assert.equal(other.code, 2, other.stderr); assert.match(other.stdout, /remote-pool-busy-or-unresolved/);
    assert.equal(f.poolStatus().ownerPresent, true);
    await session.call('iris_info', {what: 'version'});
    const start = Date.now(), close = session.close();
    await waitForFile(path.join(f.root, 'closing.json'));
    assert.equal(f.poolStatus().ownerPresent, true);
    other = await contender(f);
    assert.equal(other.code, 2, other.stderr); assert.match(other.stdout, /remote-pool-busy-or-unresolved/);
    const receipt = await close;
    assert.ok(Date.now() - start >= 1200);
    assert.equal(receipt.gracefulExit, true); assert.equal(receipt.cleanupVerified, true);
    assert.equal(fs.existsSync(path.join(f.root, 'cleaned.json')), true);
    assert.equal(f.poolStatus().ownerPresent, false);
    const next = await f.open(); assert.equal((await next.close()).cleanupVerified, true);
});

test('a child exceeding the default ten-second shutdown budget is terminated with unresolved cleanup', {timeout: 20000}, async t => {
    const f = fixture(t, {hang: true}), session = await f.open();
    await session.call('iris_doc', {mode: 'head', name: 'Demo.Sample.cls'});
    const start = Date.now(), close = session.close();
    await waitForFile(path.join(f.root, 'closing.json'));
    assert.equal(f.poolStatus().ownerPresent, true);
    const receipt = await close;
    assert.ok(Date.now() - start >= 9500);
    assert.equal(receipt.processExited, true); assert.equal(receipt.gracefulExit, false); assert.equal(receipt.cleanupVerified, false);
    assert.equal(receipt.licenseReleaseVerified, false); assert.equal(receipt.status, 'reconciliation-required');
    assert.equal(fs.existsSync(path.join(f.root, 'cleaned.json')), false);
    const status = f.poolStatus(); assert.equal(status.ownerPresent, false); assert.equal(status.status, 'reconciliation-required');
    await assert.rejects(f.open(), /remote-pool-reconciliation-required/);
});
