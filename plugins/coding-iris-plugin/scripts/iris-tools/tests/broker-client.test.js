'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { callBroker } = require('../broker-client');

async function server(t, handler) {
    const service = http.createServer(handler);
    await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { service.closeAllConnections(); service.close(resolve); }));
    return `http://127.0.0.1:${service.address().port}/broker`;
}
function input(url, extra = {}) {
    const base = { url, className: 'Fixture.Service', methodName: 'Read', role: 'fixture', effects: 'read-only', timeoutMs: 1000,
        effectEvidence: { className: 'Fixture.Service', methodName: 'Read', role: 'fixture', effects: 'read-only', reference: 'synthetic-source' } };
    return { ...base, ...extra };
}
function cli(args, stdin = '') {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, '../debugger.js'), ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
        child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr })); child.stdin.end(stdin);
    });
}
test('200 transport is distinct from business pass and fail', async t => {
    const url = await server(t, (_, res) => res.end(JSON.stringify({ ok: false, value: 7 })));
    assert.equal((await callBroker(input(url))).status, 'transport-ok');
    assert.equal((await callBroker(input(url, { assertions: [{ path: ['ok'], equals: true }] }))).status, 'failed');
    assert.equal((await callBroker(input(url, { assertBusiness: body => body.value === 7 }))).status, 'passed');
    assert.equal((await callBroker(input(url, { assertions: [] }))).errorCode, 'invalid-assertions');
});
test('auth, non-json, size, timeout and truncated responses are not success', async t => {
    for (const mode of ['auth', 'text', 'large', 'timeout', 'truncated']) {
        const url = await server(t, (_, res) => {
            if (mode === 'auth') { res.writeHead(401); res.end('denied'); }
            if (mode === 'text') res.end('<html>login</html>');
            if (mode === 'large') res.end('x'.repeat(100));
            if (mode === 'truncated') { res.writeHead(200, { 'Content-Length': '100' }); res.write('{'); setImmediate(() => res.destroy()); }
        });
        const result = await callBroker(input(url, { timeoutMs: 80, maxResponseBytes: 32 }));
        assert.notEqual(result.status, 'passed'); assert.notEqual(result.status, 'transport-ok');
        if (mode === 'auth') assert.equal(result.authentication, 'rejected');
        else assert.equal(result.outcome, 'unknown');
    }
});
test('effects and exact authorization gate writes; unknown results never replay', async t => {
    let writes = 0;
    const url = await server(t, (req, res) => {
        req.resume(); req.on('end', () => { writes++; res.destroy(); });
    });
    const write = input(url, { effects: 'write', effectEvidence: { className: 'Fixture.Service', methodName: 'Read', role: 'fixture', effects: 'write', reference: 'source' } });
    assert.equal((await callBroker(write)).errorCode, 'write-not-authorized'); assert.equal(writes, 0);
    write.authorization = { className: write.className, methodName: write.methodName, role: write.role, write: true, reference: 'batch-authorization' };
    const result = await callBroker(write);
    assert.equal(result.outcome, 'unknown'); assert.equal(writes, 1);
    assert.equal((await callBroker({ ...write, params: { MethodName: 'Bypass' } })).errorCode, 'invalid-params');
});
test('write, independent readback and duplicate protection are asserted through real HTTP', async t => {
    const stored = new Map();
    const url = await server(t, (req, res) => {
        let data = ''; req.on('data', chunk => { data += chunk; }); req.on('end', () => {
            const form = new URLSearchParams(data);
            if (form.get('MethodName') === 'Delete') { res.end(JSON.stringify({ ok: false, reason: 'linked-record' })); return; }
            if (form.get('MethodName') === 'Save') stored.set(form.get('requestId'), 'value');
            res.end(JSON.stringify({ count: stored.size, present: stored.has('case') }));
        });
    });
    const write = input(url, { methodName: 'Save', effects: 'write', params: { requestId: 'case' },
        effectEvidence: { className: 'Fixture.Service', methodName: 'Save', role: 'fixture', effects: 'write', reference: 'source' },
        authorization: { className: 'Fixture.Service', methodName: 'Save', role: 'fixture', write: true, reference: 'batch' },
        assertions: [{ path: ['count'], equals: 1 }] });
    assert.equal((await callBroker(write)).status, 'passed');
    assert.equal((await callBroker(write)).status, 'passed');
    const blockedDelete = { ...write, methodName: 'Delete', effectEvidence: { ...write.effectEvidence, methodName: 'Delete' }, authorization: { ...write.authorization, methodName: 'Delete' }, assertions: [{ path: ['ok'], equals: true }] };
    assert.equal((await callBroker(blockedDelete)).status, 'failed');
    assert.equal((await callBroker(input(url, { assertions: [{ path: ['present'], equals: true }, { path: ['count'], equals: 1 }] }))).status, 'passed');
});
test('module import is inert and machine CLI is bounded, noninteractive and redacted', async t => {
    const loaded = require('../debugger'); assert.equal(typeof loaded.callBroker, 'function');
    assert.equal(loaded.toRequestPath('csp/custom.cls', 'app'), '/app/csp/custom.cls');
    const original = process.argv; process.argv = ['node', 'debugger', '--path', 'custom', '--class', 'A', '--method', 'B'];
    try { assert.equal(loaded.parseArgs().serverUrl, 'custom'); } finally { process.argv = original; }
    const url = await server(t, (_, res) => res.end(JSON.stringify({ ok: true, privateData: 'synthetic-private' })));
    const result = await cli(['--json', '--stdin'], JSON.stringify(input(url, { token: 'synthetic-token', cookie: 'synthetic-cookie', assertions: [{ path: ['ok'], equals: true }] })));
    assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).status, 'passed');
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-token|synthetic-cookie|synthetic-private|127\.0\.0\.1/);
    assert.equal((await cli(['--json'])).code, 1);
    assert.equal((await cli(['--stdin'])).code, 1);
    assert.equal((await cli(['--json', '--stdin'], 'invalid')).code, 1);
    assert.equal((await cli(['--json', '--stdin'], JSON.stringify(input(url)))).code, 2);
});
test('aborted invocation is not sent; assertions cannot exceed request budget', async t => {
    let calls = 0;
    const url = await server(t, (_, res) => { calls++; res.end('{}'); });
    const controller = new AbortController(); controller.abort();
    assert.equal((await callBroker(input(url, { signal: controller.signal }))).outcome, 'not-executed'); assert.equal(calls, 0);
    assert.equal((await callBroker(input(url, { timeoutMs: 30, assertBusiness: () => new Promise(() => {}) }))).errorCode, 'timeout');
    assert.equal((await callBroker(input(url, { classifyAuthentication: () => 'rejected', assertBusiness: () => true }))).authentication, 'rejected');
});
