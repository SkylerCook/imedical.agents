'use strict';
const path = require('node:path'), fs = require('node:fs'), crypto = require('node:crypto');
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
    } catch { throw fault('playwright-unavailable: explicitly prepare a project or host runtime; no automatic installation', 'browser-start'); }
}
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fault(code, stage) { return Object.assign(new Error(code), { code, stage }); }
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return typeof value === 'function' ? String(value) : value;
}

// The executor owns the batch lifetime; individual deadlines only abort a case.
function createTestExecutor(options) {
    if (options.projectRoot) require('./iris-remote-operations').assertRemoteAllowed(require('./workspace-context').resolveWorkspaceContext(options.projectRoot));
    const { projectRoot, deadlineAt, signal, timeoutMs = 30000, closeTimeoutMs = 10000 } = options;
    if (!projectRoot || !Number.isFinite(deadlineAt) || deadlineAt <= Date.now() || deadlineAt - Date.now() > 2147483647 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647 || !Number.isFinite(closeTimeoutMs) || closeTimeoutMs <= 0 || closeTimeoutMs > 2147483647) throw new Error('Invalid executor limits');
    let browser, busy = false, stopped = false, closing, activeCase, legacySessionOwner;
    const owners = new Map(), controller = new AbortController(), pending = new Set(), consoleEvents = [], apiEvents = [];
    const executor = { kind: 'node', nodeVersion: process.version, playwrightVersion: null, browserVersion: null, headless: options.headed !== true };
    function onAbort() { controller.abort(); void stop(); }
    const deadlineTimer = setTimeout(onAbort, deadlineAt - Date.now());
    signal?.addEventListener('abort', onAbort, { once: true });
    async function bounded(fn, limit = timeoutMs, cleanup = false, stage = 'operation') {
        if (!cleanup && (stopped || controller.signal.aborted || Date.now() >= deadlineAt)) throw fault('execution-stopped', stage);
        const scope = activeCase, localSignal = scope?.controller.signal;
        if (!cleanup && (localSignal?.aborted || Date.now() >= (scope?.deadlineAt ?? Infinity))) throw fault('case-deadline', stage);
        const work = Promise.resolve().then(fn);
        pending.add(work); work.then(() => pending.delete(work), () => pending.delete(work));
        let timer, abort;
        try {
            return await Promise.race([work, new Promise((_, reject) => {
                timer = setTimeout(() => { if (!cleanup) scope?.controller.abort(); reject(fault('operation-timeout', stage)); }, Math.max(1, Math.min(limit, cleanup ? Infinity : deadlineAt - Date.now(), cleanup ? Infinity : (scope?.deadlineAt ?? Infinity) - Date.now())));
                if (!cleanup) {
                    abort = () => reject(fault(localSignal?.aborted ? 'case-deadline' : 'execution-cancelled', stage));
                    controller.signal.addEventListener('abort', abort, { once: true }); localSignal?.addEventListener('abort', abort, { once: true });
                }
            })]);
        } finally { clearTimeout(timer); if (abort) { controller.signal.removeEventListener('abort', abort); localSignal?.removeEventListener('abort', abort); } }
    }
    function binding(input, execution = {}) {
        const authentication = input.authentication || options.authentication || { mode: input.level === 'ui' ? 'browser-session' : options.session ? 'adapter-session' : 'none' };
        if (!['none', 'browser-session', 'adapter-session'].includes(authentication.mode)) throw fault('authentication-mode-invalid', 'authentication');
        const configurationFiles = (options.configurationFiles || []).map(file => [fs.realpathSync.native(file), crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
        const configurationFingerprint = hash(canonical({ authentication, configurationFiles, factory: options.createSession, viewport: options.viewport }));
        const value = { projectRoot: fs.realpathSync.native(projectRoot), environmentAlias: execution.environmentAlias || input.environmentAlias || options.environmentAlias || 'local', identityReference: hash(authentication.identity ?? options.identity ?? 'default'), role: input.role, configurationFingerprint, authenticationMode: authentication.mode };
        return { ...value, ownerRef: hash(canonical(value)) };
    }
    function summary(owner) { return { ownerRef: owner.ownerRef, projectRoot: owner.projectRoot, environmentAlias: owner.environmentAlias, identityReference: owner.identityReference, role: owner.role, configurationFingerprint: owner.configurationFingerprint, authenticationMode: owner.authenticationMode, deadlineAt }; }
    async function ensureOwner(input, execution = {}) {
        const identity = binding(input, execution);
        if ((input.level === 'ui' || identity.authenticationMode !== 'none') && Array.isArray(execution.allowedOwnerRefs) && !execution.allowedOwnerRefs.includes(identity.ownerRef)) throw fault('owner-binding-unprepared', 'authentication');
        if (owners.has(identity.ownerRef)) {
            const owner = owners.get(identity.ownerRef);
            if (owner.context && !browser?.isConnected()) throw fault('browser-owner-unavailable', 'browser-start');
            return owner;
        }
        const owner = { ...identity, retainedPages: new Set(), initialized: false }; owners.set(owner.ownerRef, owner);
        if (input.level === 'ui' || identity.authenticationMode === 'browser-session') {
            if (!browser) {
                const loaded = loadPlaywright(options); executor.kind = 'playwright'; executor.playwrightVersion = loaded.version;
                browser = await bounded(async () => {
                    const value = await loaded.runtime.chromium.launch({ headless: options.headed !== true, timeout: timeoutMs, ...(options.executablePath ? { executablePath: options.executablePath } : {}) });
                    if (stopped || controller.signal.aborted) await value.close(); return value;
                }, timeoutMs, false, 'browser-start'); executor.browserVersion = browser.version();
            }
            owner.context = await bounded(async () => { const value = await browser.newContext({ ...(options.viewport ? { viewport: options.viewport } : {}) }); if (stopped || controller.signal.aborted) await value.close(); return value; }, timeoutMs, false, 'context-start');
            owner.context.setDefaultTimeout(timeoutMs); owner.context.setDefaultNavigationTimeout(timeoutMs);
            owner.collector = createRequestCollector(owner.context, { early: true, resourceKey: options.resourceKey || (() => null) });
            owner.context.on('page', page => {
                page.on('pageerror', () => consoleEvents.push({ ownerRef: owner.ownerRef, kind: 'pageerror', at: new Date().toISOString() }));
                page.on('console', message => { if (message.type() === 'error') consoleEvents.push({ ownerRef: owner.ownerRef, kind: 'console-error', at: new Date().toISOString() }); });
            });
        }
        if (typeof options.createSession === 'function' && identity.authenticationMode !== 'none') {
            const creationSignal = activeCase?.controller.signal;
            owner.session = await bounded(async () => {
                const value = await options.createSession({ context: owner.context, collector: owner.collector, owner: summary(owner), signal: controller.signal });
                if (stopped || controller.signal.aborted || creationSignal?.aborted) await value?.stop?.();
                return value;
            }, timeoutMs, false, 'authentication');
            if (!owner.session || typeof owner.session.ensureReady !== 'function' || typeof owner.session.stop !== 'function') throw fault('session-factory-invalid', 'authentication');
        } else if (options.session && identity.authenticationMode !== 'none') {
            if (legacySessionOwner && legacySessionOwner !== owner.ownerRef) throw fault('session-owner-binding-mismatch', 'authentication');
            legacySessionOwner = owner.ownerRef; owner.session = options.session;
        }
        owner.initialized = true; return owner;
    }
    async function ready(owner) {
        if (!owner.initialized) throw fault('owner-initialization-unresolved', 'authentication');
        if (owner.session && !await bounded(() => owner.session.ensureReady(), timeoutMs, false, 'authentication')) throw fault('authentication-unresolved', 'authentication');
        // Readiness and confirmed expiry recovery may create an authentication home.
        for (const page of owner.context?.pages?.() || []) owner.retainedPages.add(page);
    }
    async function cleanupCase(owner) {
        let exited = true;
        for (const page of owner?.context?.pages?.() || []) if (!owner.retainedPages.has(page)) {
            try { await bounded(() => page.close(), closeTimeoutMs, true, 'case-cleanup'); if (!page.isClosed()) exited = false; } catch { exited = false; }
        }
        return exited;
    }
    async function apiRequestFor(owner, url, requestOptions = {}) {
        if (!owner?.context) throw fault('browser-context-unavailable', 'external-api');
        const record = { channel: 'context-request', ownerRef: owner.ownerRef, at: new Date().toISOString(), status: null, outcome: 'unknown' }; apiEvents.push(record);
        const response = await bounded(() => owner.context.request.fetch(url, { ...requestOptions, maxRedirects: 0, timeout: timeoutMs }), timeoutMs, false, 'external-api');
        record.status = response.status(); record.outcome = 'received'; return response;
    }
    function startScope(input, execution) {
        if (busy || pending.size || [...owners.values()].some(owner => owner.session?.snapshot?.().pendingOperation)) throw fault('pending-operations', 'entry');
        if (stopped || signal?.aborted || controller.signal.aborted) throw fault('execution-stopped', 'entry');
        const limit = Math.min(deadlineAt, execution.deadlineAt ?? Infinity, input.deadlineAt ?? Infinity);
        if (!Number.isFinite(limit) || limit <= Date.now()) throw fault('case-deadline', 'entry');
        const local = new AbortController(), external = execution.signal, cancel = () => local.abort(); external?.addEventListener('abort', cancel, { once: true }); if (external?.aborted) cancel();
        busy = true; activeCase = { deadlineAt: limit, controller: local, dispose() { external?.removeEventListener('abort', cancel); } };
    }
    function endScope() { activeCase?.dispose(); activeCase = undefined; busy = false; }
    async function prepareOwner(input, execution = {}) {
        startScope(input, execution);
        try { const owner = await ensureOwner(input, execution); await ready(owner); return summary(owner); } finally { endScope(); }
    }
    async function run(input, execution = {}) {
        if (!['internal-method', 'external-api', 'ui'].includes(input.level) || !input.entry || !input.role || typeof input.createAdapter !== 'function') throw fault('case-contract-invalid', 'entry');
        startScope(input, execution);
        const consoleStart = consoleEvents.length, apiStart = apiEvents.length; let owner, result;
        try {
            if (input.strictData && input.level === 'ui' && (options.headed === true || !options.viewport || typeof input.assertTarget !== 'function')) throw fault('ui-target-assertion-required', 'target');
            const authenticationStartedAt = Date.now();
            owner = await ensureOwner(input, execution); await ready(owner);
            const authenticationEndedAt = Date.now();
            const networkStart = owner.collector?.snapshot().length || 0;
            const adapter = await bounded(() => input.createAdapter({ context: owner.context, collector: owner.collector, apiRequest: owner.context ? (url, requestOptions) => apiRequestFor(owner, url, requestOptions) : undefined, signal: activeCase.controller.signal, session: owner.session, owner: summary(owner) }), timeoutMs, false, 'adapter-create');
            const wrapped = {};
            for (const name of ['prepare', 'verifyVersion', 'execute', 'assert', 'sideEffects', 'close', ...(input.strictData && input.effects === 'write' ? ['inspectFixtures', 'finalizeData'] : [])]) {
                if (typeof adapter[name] !== 'function') throw fault('adapter-contract-invalid', name);
                wrapped[name] = (...args) => {
                    owner.collector?.setPhase(name === 'close' ? 'closing' : name);
                    return bounded(async () => {
                        const value = await adapter[name](...args);
                        if (name === 'prepare' && value === true && input.level === 'ui' && typeof input.assertTarget === 'function' && await input.assertTarget({ context: owner.context, adapter, collector: owner.collector, viewport: options.viewport, owner: summary(owner) }) !== true) throw fault('target-assertion-failed', 'target');
                        return value;
                    }, ['close', 'finalizeData'].includes(name) ? closeTimeoutMs : timeoutMs, ['close', 'finalizeData'].includes(name), name);
                };
            }
            result = await runTestCase({ ...input, adapter: wrapped });
            result.durations.authentication = authenticationEndedAt - authenticationStartedAt;
            result.timingSegments.unshift({ phase: 'preparation', step: 'authentication', startedAt: new Date(authenticationStartedAt).toISOString(), endedAt: new Date(authenticationEndedAt).toISOString() });
            result.acceptance = { level: input.level, entry: input.entry, authenticationMode: owner.authenticationMode, ownerRef: owner.ownerRef, coverage: input.coverage || [], executorVersion: 'imedical-acceptance-executor/v2', executor: owner.context ? { ...executor } : { kind: 'node', nodeVersion: process.version } };
            if (Array.isArray(input.untested)) result.untested.push(...input.untested);
            result.observations = { console: consoleEvents.slice(consoleStart).filter(e => e.ownerRef === owner.ownerRef), api: apiEvents.slice(apiStart).filter(e => e.ownerRef === owner.ownerRef), network: owner.collector ? owner.collector.snapshot().slice(networkStart) : [] };
            const requiresReview = result.observations.console.length || result.observations.api.some(e => e.outcome === 'unknown' || e.status >= 400) || result.observations.network.some(e => e.ownership === 'frame-lineage-unverified' || (e.ownership !== 'context-frame' && (e.failed || e.status >= 400)));
            if (requiresReview && (typeof adapter.reviewObservations !== 'function' || await bounded(() => adapter.reviewObservations(result.observations), timeoutMs, false, 'observation-review') !== true)) { result.status = 'review-pending'; result.failureCategory ||= 'network-or-console'; }
            return result;
        } finally {
            const exited = await cleanupCase(owner);
            if (result && (!exited || pending.size || stopped)) { result.status = 'review-pending'; result.cleanup.verified = false; result.failureCategory ||= 'cleanup'; }
            endScope();
        }
    }
    function snapshot() {
        const sessions = [...owners.values()].map(o => o.session?.snapshot?.()).filter(Boolean);
        return { stopped, busy, pendingOperations: pending.size + sessions.filter(s => s.pendingOperation).length, retainedOwners: [...owners.values()].filter(o => o.context || o.session).map(summary), retainedOwnersControllable: !stopped && !busy && !pending.size && [...owners.values()].every(o => o.initialized && (!o.context || browser?.isConnected()) && !['stopped', 'blocked'].includes(o.session?.snapshot?.().state)) };
    }
    async function checkpoint() {
        let temporaryResourcesExited = !busy;
        if (!busy) for (const owner of owners.values()) temporaryResourcesExited = await cleanupCase(owner) && temporaryResourcesExited;
        const state = snapshot();
        return { cleanupVerified: (!state.retainedOwners.length || stopped) && !busy && state.pendingOperations === 0 && (!browser || !browser.isConnected()), temporaryResourcesExited, retainedOwnersControllable: state.retainedOwnersControllable, retainedOwnerCount: state.retainedOwners.length, ownerRefs: state.retainedOwners.map(owner => owner.ownerRef), pendingOperations: state.pendingOperations };
    }
    function stop() {
        if (closing) return closing;
        stopped = true; clearTimeout(deadlineTimer); signal?.removeEventListener('abort', onAbort); controller.abort(); activeCase?.controller.abort();
        closing = (async () => {
            let cleaned = true; const stages = [];
            for (const owner of owners.values()) {
                try { if (owner.session) { const state = await owner.session.stop(); if ((owner.session.snapshot?.() || state)?.cleanupVerified === false) cleaned = false; } } catch { cleaned = false; }
                try { if (owner.collector) { const state = await owner.collector.stop({ timeoutMs: closeTimeoutMs }); cleaned = cleaned && state.cleanupVerified; if (!state.cleanupVerified) stages.push('collector-close'); } } catch { cleaned = false; stages.push('collector-close'); }
                try { if (owner.context) await bounded(() => owner.context.close(), closeTimeoutMs, true, 'context-close'); } catch { cleaned = false; stages.push('context-close'); }
            }
            try { if (browser) await bounded(() => browser.close(), closeTimeoutMs, true, 'browser-close'); } catch { cleaned = false; stages.push('browser-close'); }
            const state = snapshot(), exited = cleaned && state.pendingOperations === 0 && (!browser || !browser.isConnected());
            return { cleanupVerified: exited, temporaryResourcesExited: exited, retainedOwnersControllable: false, retainedOwnerCount: exited ? 0 : state.retainedOwners.length, pendingOperations: state.pendingOperations, ...(stages.length ? { failureStages: stages } : {}) };
        })();
        const attempt = closing;
        attempt.then(result => { if (!result.cleanupVerified && closing === attempt) closing = undefined; }, () => { if (closing === attempt) closing = undefined; });
        return attempt;
    }
    return { run, stop, prepareOwner, checkpoint, snapshot, apiRequest: (url, requestOptions) => apiRequestFor(owners.size === 1 ? [...owners.values()][0] : undefined, url, requestOptions), info: () => ({ ...executor }) };
}
module.exports = { createTestExecutor, loadPlaywright };
