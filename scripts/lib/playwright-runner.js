'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { createRequestCollector, runTestCase } = require('./test-evidence');

function loadPlaywright({ runtimeModule, projectRoot }) {
    const projectRequire = createRequire(path.join(path.resolve(projectRoot), 'package.json'));
    try {
        const resolved = runtimeModule ? require.resolve(path.resolve(runtimeModule)) : projectRequire.resolve('playwright');
        const runtime = require(resolved);
        if (!runtime.chromium?.launch) throw new Error('missing-chromium');
        let directory = path.dirname(resolved), version = 'unknown';
        while (path.dirname(directory) !== directory) {
            const manifest = path.join(directory, 'package.json');
            if (fs.existsSync(manifest)) { version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version || 'unknown'; break; }
            directory = path.dirname(directory);
        }
        return { runtime, version };
    } catch { throw new Error('playwright-unavailable: explicitly prepare a project or host runtime; no automatic installation'); }
}

function createTestExecutor(options) {
    const { projectRoot, deadlineAt, session, signal, timeoutMs = 30000, closeTimeoutMs = 10000 } = options;
    if (!projectRoot || !Number.isFinite(deadlineAt) || deadlineAt <= Date.now() || deadlineAt - Date.now() > 2147483647 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647 || !Number.isFinite(closeTimeoutMs) || closeTimeoutMs <= 0 || closeTimeoutMs > 2147483647) throw new Error('Invalid executor limits');
    let browser, context, collector, currentRole, busy = false, stopped = false, closing;
    const abortController = new AbortController(), pending = new Set(), consoleEvents = [], apiEvents = [];
    const executor = { kind: 'node', nodeVersion: process.version, playwrightVersion: null, browserVersion: null, headless: options.headed !== true };
    function onAbort() { abortController.abort(); void stop(); }
    const deadlineTimer = setTimeout(onAbort, deadlineAt - Date.now());
    signal?.addEventListener('abort', onAbort, { once: true });

    async function bounded(fn, limit = timeoutMs, cleanup = false) {
        if (!cleanup && (stopped || abortController.signal.aborted || Date.now() >= deadlineAt)) throw new Error('execution-stopped');
        const work = Promise.resolve().then(fn);
        pending.add(work);
        work.then(() => pending.delete(work), () => pending.delete(work));
        let timer, abort;
        try {
            return await Promise.race([work, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('operation-timeout')), limit);
                if (!cleanup) { abort = () => reject(new Error('execution-cancelled')); abortController.signal.addEventListener('abort', abort, { once: true }); }
            })]);
        } finally { clearTimeout(timer); if (abort) abortController.signal.removeEventListener('abort', abort); }
    }
    function attachPage(page) {
        page.on('pageerror', () => consoleEvents.push({ kind: 'pageerror', at: new Date().toISOString() }));
        page.on('console', message => { if (message.type() === 'error') consoleEvents.push({ kind: 'console-error', at: new Date().toISOString() }); });
    }
    async function ensureBrowser(role) {
        if (context && currentRole === role) return;
        if (context) {
            const closed = await collector.stop({ timeoutMs: closeTimeoutMs });
            await bounded(() => context.close());
            if (!closed.cleanupVerified) throw new Error('collector-cleanup-unverified');
            context = undefined;
        }
        if (!browser) {
            const loaded = loadPlaywright(options);
            executor.kind = 'playwright'; executor.playwrightVersion = loaded.version;
            const launched = loaded.runtime.chromium.launch({ headless: options.headed !== true, timeout: timeoutMs,
                ...(options.executablePath ? { executablePath: options.executablePath } : {}) });
            // A late launch after cancellation remains owned and must be closed.
            browser = await bounded(() => launched.then(async value => {
                if (stopped || abortController.signal.aborted) await value.close();
                return value;
            }));
            executor.browserVersion = browser.version();
        }
        context = await bounded(() => browser.newContext({ ...(options.viewport ? { viewport: options.viewport } : {}) }).then(async value => {
            if (stopped || abortController.signal.aborted) await value.close();
            return value;
        }));
        if (stopped) { await context.close(); throw new Error('execution-stopped'); }
        context.setDefaultTimeout(timeoutMs); context.setDefaultNavigationTimeout(timeoutMs);
        collector = createRequestCollector(context, { early: true, resourceKey: options.resourceKey || (() => null) });
        context.on('page', attachPage);
        currentRole = role;
    }
    async function apiRequest(url, requestOptions = {}) {
        if (!context) throw new Error('UI context not initialized');
        const record = { channel: 'context-request', at: new Date().toISOString(), status: null, outcome: 'unknown' };
        apiEvents.push(record);
        const response = await bounded(() => context.request.fetch(url, { ...requestOptions, maxRedirects: 0, timeout: timeoutMs }));
        record.status = response.status(); record.outcome = 'received';
        return response;
    }
    async function run(input) {
        if (busy || pending.size) throw new Error('Executor is busy or has unresolved operations');
        if (!['internal-method', 'external-api', 'ui'].includes(input.level) || !input.entry || !input.role || typeof input.createAdapter !== 'function') throw new Error('Explicit acceptance level, entry, role and adapter required');
        if (signal?.aborted || stopped || abortController.signal.aborted) throw new Error('execution-stopped');
        busy = true;
        const consoleStart = consoleEvents.length, apiStart = apiEvents.length;
        try {
            if (input.strictData && input.level === 'ui' && (options.headed === true || !options.viewport)) throw new Error('Night UI requires headless executor and explicit viewport');
            if (input.level === 'ui') await ensureBrowser(input.role);
            if (input.strictData && input.level === 'ui' && options.viewport) {
                const probe = await bounded(() => context.newPage());
                try { const actual = await bounded(() => probe.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))); if (actual.width !== options.viewport.width || actual.height !== options.viewport.height) throw new Error('viewport-not-effective'); } finally { await bounded(() => probe.close(), closeTimeoutMs, true); }
            }
            const networkStart = collector?.snapshot().length || 0;
            const adapter = await bounded(() => input.createAdapter({ context: input.level === 'ui' ? context : undefined,
                collector: input.level === 'ui' ? collector : undefined, apiRequest: input.level === 'ui' ? apiRequest : undefined, signal: abortController.signal, session }));
            const wrapped = {};
            for (const name of ['prepare', 'verifyVersion', 'execute', 'assert', 'sideEffects', 'close', ...(input.strictData && input.effects === 'write' ? ['inspectFixtures', 'finalizeData'] : [])]) {
                if (typeof adapter[name] !== 'function') throw new Error(`Missing adapter: ${name}`);
                wrapped[name] = (...args) => {
                    if (input.level === 'ui') collector.setPhase(name === 'close' ? 'closing' : name);
                    return bounded(() => adapter[name](...args), ['close', 'finalizeData'].includes(name) ? closeTimeoutMs : timeoutMs, ['close', 'finalizeData'].includes(name));
                };
            }
            const result = await runTestCase({ ...input, adapter: wrapped, session: session ? { ensureReady: () => bounded(() => session.ensureReady()) } : undefined });
            result.acceptance = { level: input.level, entry: input.entry, coverage: input.coverage || [], executorVersion: 'imedical-acceptance-executor/v1', executor: input.level === 'ui' ? { ...executor } : { kind: 'node', nodeVersion: process.version } };
            if (Array.isArray(input.untested)) result.untested.push(...input.untested);
            result.observations = { console: consoleEvents.slice(consoleStart), api: apiEvents.slice(apiStart),
                network: input.level === 'ui' ? collector.snapshot().slice(networkStart) : [] };
            const requiresReview = result.observations.console.length || result.observations.api.some(event => event.outcome === 'unknown' || event.status >= 400)
                || result.observations.network.some(event => event.ownership === 'frame-lineage-unverified' || (event.ownership !== 'context-frame' && (event.failed || event.status >= 400)));
            if (requiresReview && (typeof adapter.reviewObservations !== 'function' || await bounded(() => adapter.reviewObservations(result.observations)) !== true)) {
                result.status = 'review-pending'; result.failureCategory ||= 'network-or-console';
            }
            if (pending.size || stopped) { result.status = 'review-pending'; result.cleanup.verified = false; }
            return result;
        } finally { busy = false; }
    }
    function stop() {
        if (closing) return closing;
        stopped = true; clearTimeout(deadlineTimer); signal?.removeEventListener('abort', onAbort); abortController.abort();
        closing = (async () => {
            const sessionState = session?.stop();
            let cleaned = sessionState ? sessionState.cleanupVerified : true;
            try {
                if (collector) {
                    const state = await collector.stop({ timeoutMs: closeTimeoutMs }); cleaned = cleaned && state.cleanupVerified;
                }
                if (context) await bounded(() => context.close(), closeTimeoutMs, true);
            } catch { cleaned = false; }
            try { if (browser) await bounded(() => browser.close(), closeTimeoutMs, true); } catch { cleaned = false; }
            return { cleanupVerified: cleaned && pending.size === 0 && (!browser || !browser.isConnected()), pendingOperations: pending.size };
        })();
        return closing;
    }
    return { run, stop, apiRequest, info: () => ({ ...executor }) };
}

module.exports = { createTestExecutor, loadPlaywright };
