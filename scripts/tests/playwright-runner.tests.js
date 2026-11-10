'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createTestExecutor, loadPlaywright } = require('../lib/playwright-runner');
const { runAcceptance } = require('../run-acceptance');
const { callBroker } = require('../../plugins/coding-iris-plugin/scripts/iris-tools/broker-client');

function adapter(overrides = {}) {
    return { prepare: async () => true, verifyVersion: async () => true, execute: async () => {},
        assert: async () => [{ id: 'output', passed: true, evidenceRefs: ['synthetic/assertion'] }], sideEffects: async () => true, close: async () => true, ...overrides };
}
function specification(extra = {}) {
    return { caseId: 'synthetic', scope: ['fixture'], version: 'v1', level: 'internal-method', entry: 'fixture-method', role: 'fixture', createAdapter: () => adapter(), ...extra };
}
function options(extra = {}) { return { projectRoot: __dirname, runtimeModule: '/deliberately-missing-runtime', deadlineAt: Date.now() + 30000, timeoutMs: 3000, closeTimeoutMs: 3000, ...extra }; }

test('backend acceptance does not resolve a browser; failure stops the batch and repair reruns', async () => {
    let output = 0;
    const cases = [specification({ createAdapter: () => adapter({ execute: async () => { output = 2 + 3; }, assert: async () => [{ id: 'sum', passed: output === 5, evidenceRefs: ['synthetic/sum'] }] }) }),
        specification({ caseId: 'fails', createAdapter: () => adapter({ assert: async () => [{ id: 'wrong', passed: false, evidenceRefs: ['synthetic/failure'] }] }) }),
        specification({ caseId: 'unreached', createAdapter: () => { throw new Error('must not run'); } })];
    const result = await runAcceptance({ options: options(), cases });
    assert.equal(result.results.length, 2); assert.equal(result.status, 'review-pending'); assert.equal(result.cleanup.cleanupVerified, true);
    assert.equal(result.results[0].acceptance.executor.kind, 'node');
    const repaired = await runAcceptance({ options: options(), cases: [specification({ version: 'v2' })] });
    assert.equal(repaired.status, 'scope-passed'); assert.equal(repaired.results[0].version, 'v2');
});

test('internal calculation success cannot substitute for actual interface failure', async t => {
    let requests = 0;
    const server = http.createServer((_, res) => { requests++; res.end('{"ok":false}'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const input = { url: `http://127.0.0.1:${server.address().port}/broker`, className: 'Fixture.Service', methodName: 'Run', role: 'fixture', effects: 'read-only',
        effectEvidence: { className: 'Fixture.Service', methodName: 'Run', role: 'fixture', effects: 'read-only', reference: 'source' }, assertions: [{ path: ['ok'], equals: true }] };
    let response;
    const result = await runAcceptance({ options: options(), cases: [specification({ level: 'external-api', entry: 'fixture-broker', createAdapter: () => adapter({
        execute: async () => { response = await callBroker(input); }, assert: async () => [{ id: 'actual-entry', passed: response.status === 'passed', evidenceRefs: ['synthetic/broker'] }]
    }) })] });
    assert.equal(result.results[0].status, 'failed'); assert.equal(result.results[0].acceptance.level, 'external-api');
    assert.equal(requests, 1); assert.equal(response.business, 'failed');
});

test('missing Playwright is actionable and never installs; deadline aborts an in-flight case', async () => {
    assert.throws(() => loadPlaywright(options()), /playwright-unavailable/);
    const runner = createTestExecutor(options({ deadlineAt: Date.now() + 100 }));
    let release;
    const result = await runner.run(specification({ createAdapter: () => adapter({ execute: () => new Promise(resolve => { release = resolve; }) }) }));
    assert.equal(result.status, 'review-pending'); assert.equal(result.cleanup.verified, false);
    const cleanup = await runner.stop(); assert.equal(cleanup.cleanupVerified, false);
    release();
});

test('headless UI: login, navigation, frames, popup, response version, API and cleanup', { skip: !process.env.PLAYWRIGHT_RUNTIME_MODULE && !process.env.REQUIRE_PLAYWRIGHT }, async t => {
    assert(process.env.PLAYWRIGHT_RUNTIME_MODULE, 'CI must provide the locked runtime');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'night-ui-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let script = 'window.loadedVersion="v1";', pageReads = 0;
    const server = http.createServer((req, res) => {
        if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        if (req.url === '/login' && req.method === 'GET') { res.setHeader('Content-Type', 'text/html'); res.end('<form action="/login" method="post"><input name="name" aria-label="name"><button>Login</button></form>'); return; }
        if (req.url === '/login') { req.resume(); res.writeHead(302, { 'Set-Cookie': 'fixture=valid; Path=/; HttpOnly', Location: '/home' }); res.end(); return; }
        if (!req.headers.cookie?.includes('fixture=valid')) { res.writeHead(401); res.end(); return; }
        if (req.url === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(script); return; }
        if (req.url === '/api') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return; }
        res.setHeader('Content-Type', 'text/html');
        if (req.url === '/home') { res.end('<a href="/view">Open view</a>'); return; }
        if (req.url === '/child') { res.end('<div>Child ready</div>'); return; }
        if (req.url === '/popup') { res.end('<div>Popup ready</div>'); return; }
        pageReads++; res.end('<script src="/app.js"></script><h1>Visible result</h1><iframe src="/child"></iframe><a target="_blank" href="/popup">Open popup</a>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}`, contexts = new Set();
    const runner = createTestExecutor(options({ runtimeModule: process.env.PLAYWRIGHT_RUNTIME_MODULE, executablePath: process.env.PLAYWRIGHT_EXECUTABLE,
        timeoutMs: 10000, deadlineAt: Date.now() + 60000, viewport: { width: 1200, height: 800 }, resourceKey: req => ({ '/app.js': 'app', '/popup': 'popup' })[new URL(req.url()).pathname] || null }));
    t.after(() => runner.stop());
    function uiCase(expected) {
        return specification({ level: 'ui', entry: 'normal-menu', strictData: true, effects: 'read-only', version: expected,
            assertTarget: async ({ context, viewport }) => {
                const page = context.pages().find(p => p.url() === base + '/view');
                if (!page || !await page.getByRole('heading', { name: 'Visible result' }).isVisible()) return false;
                const actual = await page.mainFrame().evaluate(() => ({ width: innerWidth, height: innerHeight }));
                return actual.width === viewport.width && actual.height === viewport.height;
            }, createAdapter: ({ context, collector, apiRequest }) => {
            contexts.add(context); let page, visible = false, business = false;
            return adapter({
                prepare: async () => {
                    page = await context.newPage(); collector.setTarget(page.mainFrame());
                    if (!(await context.cookies()).some(cookie => cookie.name === 'fixture')) {
                        await page.goto(base + '/login'); await page.getByLabel('name').fill('fixture');
                        await Promise.all([page.waitForURL(base + '/home'), page.getByRole('button', { name: 'Login' }).click()]);
                    } else await page.goto(base + '/home');
                    await Promise.all([page.waitForURL(base + '/view'), page.getByText('Open view').click()]);
                    await page.waitForFunction(() => window.loadedVersion); return true;
                },
                verifyVersion: async hash => collector.loaded('app', hash),
                execute: async () => {
                    visible = await page.getByRole('heading').isVisible() && await page.frameLocator('iframe').getByText('Child ready').isVisible();
                    const popupPromise = page.waitForEvent('popup'); await page.getByText('Open popup').click();
                    const popup = await popupPromise; await popup.waitForLoadState(); visible = visible && await popup.getByText('Popup ready').isVisible(); await popup.close();
                    const response = await apiRequest(base + '/api'); business = (await response.json()).ok; await response.dispose();
                    await page.screenshot({ path: path.join(root, 'visible.png') });
                },
                assert: async () => [{ id: 'visible-and-business', passed: visible && business && fs.statSync(path.join(root, 'visible.png')).size > 0, evidenceRefs: ['synthetic/screenshot-and-api'] }],
                reviewObservations: async observations => visible && business && !observations.console.length && observations.network.every(event => !event.failed && event.status < 400 && (event.ownership !== 'frame-lineage-unverified' || event.resource === 'popup')),
                close: async () => { await page?.close(); return !page || page.isClosed(); }
            });
        } });
    }
    const hash = createHash('sha256').update(script).digest('hex');
    const first = await runner.run(uiCase(hash)); assert.equal(first.status, 'passed', JSON.stringify(first));
    assert.equal(first.observations.api.length, 1); assert(first.observations.network.some(e => e.ownership === 'case-descendant-frame'));
    script = 'window.loadedVersion="v2";';
    assert.equal((await runner.run(uiCase(hash))).failureCategory, 'version');
    assert.equal((await runner.run(uiCase(createHash('sha256').update(script).digest('hex')))).status, 'passed');
    assert.equal(contexts.size, 1); assert.equal(pageReads >= 3, true);
    const stopped = await runner.stop(); assert.equal(stopped.cleanupVerified, true, JSON.stringify(stopped));
});

test('synthetic idle session: expiry, effective activity, heartbeat, recovery and stop', async t => {
    const { createTestSession } = require('../lib/test-session');
    let now = 0, last = 0, pulses = 0, logins = 0, id = 0;
    const jobs = new Map();
    const clock = { now: () => now, setTimeout(fn, ms) { jobs.set(++id, { fn, at: now + ms }); return id; }, clearTimeout(key) { jobs.delete(key); } };
    const server = http.createServer((req, res) => {
        const valid = now - last < 100;
        if (req.url === '/login') { last = now; logins++; }
        else if (valid && req.url !== '/check') { last = now; if (req.url === '/heartbeat') pulses++; }
        res.end(JSON.stringify({ status: req.url === '/login' || valid ? 'valid' : 'expired' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const call = async endpoint => (await fetch(`http://127.0.0.1:${server.address().port}/${endpoint}`)).json();
    now = 101; assert.equal((await call('check')).status, 'expired'); await call('login');
    for (let i = 0; i < 3; i++) { now += 60; assert.equal((await call('business')).status, 'valid'); }
    const session = createTestSession({ clock, adapter: { check: () => call('check'), heartbeat: () => call('heartbeat'), reauthenticate: () => call('login'), restore: async () => ({ status: 'ready' }) },
        policy: { verifiedHeartbeat: true, backgroundTimers: true, idleTimeoutMs: 100, heartbeatAfterMs: 60, requestTimeoutMs: 500, deadlineAt: 10000 } });
    t.after(() => session.stop()); assert.equal(await session.start(), true);
    async function advance(ms) {
        now += ms; for (const [key, job] of [...jobs]) if (job.at <= now && jobs.delete(key)) job.fn();
        const limit = Date.now() + 3000;
        while (session.snapshot().state === 'checking' && Date.now() < limit) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(session.snapshot().state, 'ready');
    }
    for (let i = 0; i < 4; i++) await advance(60);
    assert.equal(pulses, 4); assert.equal((await call('check')).status, 'valid');
    await advance(101); assert.equal(logins, 2); assert.equal((await call('check')).status, 'valid');
    const before = pulses; assert.equal(session.stop().cleanupVerified, true); assert.equal(jobs.size, 0);
    now += 101; assert.equal((await call('check')).status, 'expired'); assert.equal(pulses, before);
});

test('browser launch failure and close failure retain explicit batch cleanup state', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'night-runtime-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const failed = path.join(root, 'failed.cjs');
    fs.writeFileSync(failed, 'exports.chromium = {launch: async () => {throw Error("synthetic launch failure")}};');
    const launch = await runAcceptance({ options: options({ runtimeModule: failed }), cases: [specification({ level: 'ui' })] });
    assert.equal(launch.status, 'review-pending'); assert.equal(launch.executionError, 'executor-failed'); assert.equal(launch.cleanup.cleanupVerified, true);
    const closing = path.join(root, 'closing.cjs');
    fs.writeFileSync(closing, `const {EventEmitter}=require('node:events'); exports.chromium={launch:async()=>({version:()=> 'fixture',isConnected:()=>true,close:async()=>{throw Error('close failed')},newContext:async()=>Object.assign(new EventEmitter(),{setDefaultTimeout(){},setDefaultNavigationTimeout(){},close:async()=>{throw Error('close failed')}})})};`);
    const close = await runAcceptance({ options: options({ runtimeModule: closing }), cases: [specification({ level: 'ui' })] });
    assert.equal(close.status, 'review-pending'); assert.equal(close.cleanup.cleanupVerified, false);
});
