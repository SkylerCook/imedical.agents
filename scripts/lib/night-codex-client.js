'use strict';

// Official protocol: https://learn.chatgpt.com/docs/app-server
// No model is selected here. The caller supplies its authorized model mapping.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const { createHash } = require('node:crypto');
const { sanitizeQuotaSnapshot } = require('./night-quota');
const { rpcError, appendDiagnostics } = require('./night-client-diagnostics');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const positiveInt = value => Number.isSafeInteger(value) && value > 0;

// Schema discovery and initialize are read-only host probes. Neither starts a
// thread, performs inference, creates a Goal, nor reads/returns auth material.
function probeCodexCli({ command = 'codex', timeoutMs = 15000, tempRoot = os.tmpdir() } = {}) {
    const version = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
    if (version.error || version.status !== 0) return { available: false, reason: 'codex-cli-unavailable', methods: [] };
    let directory;
    try {
        // Use the permitted system temporary root when the shared D: temp root
        // is unavailable. Never put generated protocol files into the project.
        directory = fs.mkdtempSync(path.join(tempRoot, 'Codex-night-client-schema-'));
        const result = spawnSync(command, ['app-server', 'generate-json-schema', '--experimental', '--out', directory], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
        if (result.error || result.status !== 0) return { available: false, reason: 'codex-schema-probe-failed', methods: [] };
        const files = { 'thread/start': 'ThreadStartParams', 'thread/resume': 'ThreadResumeParams', 'thread/read': 'ThreadReadParams',
            'turn/start': 'TurnStartParams', 'turn/interrupt': 'TurnInterruptParams', 'thread/turns/list': 'ThreadTurnsListParams', 'thread/goal/get': 'ThreadGoalGetParams', 'thread/goal/set': 'ThreadGoalSetParams',
            'account/rateLimits/read': 'GetAccountRateLimitsResponse', 'collaborationMode/list': 'CollaborationModeListParams' };
        const methods = Object.entries(files).filter(([, file]) => fs.existsSync(path.join(directory, 'v2', `${file}.json`))).map(([method]) => method);
        const goalFile = path.join(directory, 'v2', 'ThreadGoalSetParams.json');
        const goalSchema = fs.existsSync(goalFile) ? JSON.parse(fs.readFileSync(goalFile, 'utf8')) : {};
        return { available: true, version: version.stdout.trim(), methods,
            nativeGoalBudgetDeclared: methods.includes('thread/goal/get') && goalSchema.properties?.tokenBudget !== undefined,
            evidence: 'local-cli-generated-schema', inferenceValidated: false };
    } catch {
        return { available: false, reason: 'codex-schema-probe-failed', methods: [] };
    } finally {
        if (directory) fs.rmSync(directory, { recursive: true, force: true });
    }
}

function createCodexStdioTransport(options = {}) {
    const timeoutMs = options.timeoutMs || 15000;
    let child, connected, connecting, sequence = 0, closed = false;
    const pending = new Map(), listeners = new Set();
    let shutdownPromise, processExited = false;
    function failPending(category) {
        for (const { reject, timer, method } of pending.values()) { clearTimeout(timer); reject(rpcError(category, method)); }
        pending.clear();
    }
    function send(value) {
        if (!child || closed || !child.stdin.writable) throw rpcError('transport-closed', value.method);
        child.stdin.write(`${JSON.stringify(value)}\n`);
    }
    function request(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++sequence;
            const timer = setTimeout(() => { pending.delete(id); reject(rpcError('rpc-timeout', method)); }, timeoutMs);
            pending.set(id, { resolve, reject, timer, method });
            try { send({ id, method, params }); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
        });
    }
    async function connect() {
        if (closed) throw new Error('Codex transport is closed');
        if (connected) return connected;
        if (connecting) return connecting;
        connecting = (async () => {
            const probe = (options.probe || probeCodexCli)(options);
            if (!probe.available) throw new Error(probe.reason);
            child = (options.spawn || spawn)(options.command || 'codex', ['app-server', '--listen', 'stdio://'], { cwd: options.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
            child.on('error', () => failPending('transport-failed'));
            child.on('exit', () => { processExited = true; closed = true; failPending('transport-closed'); });
            child.stdin.on('error', () => failPending('transport-failed'));
            const lines = createInterface({ input: child.stdout });
            lines.on('line', line => {
                let message;
                try { message = JSON.parse(line); } catch { return; }
                if (!message || typeof message !== 'object' || Array.isArray(message)) return;
                if (message.method && message.id !== undefined) {
                    // No implicit approval, credential exchange or tool execution.
                    if (!closed) send({ id: message.id, error: { code: -32601, message: 'Interactive host request requires supervised execution' } });
                } else if (message.method) {
                    for (const listener of listeners) listener(message);
                } else if (pending.has(message.id)) {
                    const { resolve, reject, timer, method } = pending.get(message.id); clearTimeout(timer); pending.delete(message.id);
                    if (Object.hasOwn(message, 'error')) {
                        if (!message.error || typeof message.error !== 'object' || !Number.isSafeInteger(message.error.code) || Object.hasOwn(message, 'result')) reject(rpcError('protocol-invalid', method));
                        else reject(rpcError('rpc-rejected', method, message.error.code));
                    } else if (!Object.hasOwn(message, 'result')) reject(rpcError('protocol-invalid', method));
                    else resolve(message.result);
                }
            });
            try {
                const initialized = await request('initialize', { clientInfo: { name: 'imedical-night-client', title: 'Night Client Adapter', version: '1.0.0' }, capabilities: { experimentalApi: true } });
                send({ method: 'initialized', params: {} });
                connected = { ...probe, handshake: true, platformOs: initialized.platformOs };
                return connected;
            } catch (error) { close(); throw error; }
        })();
        return connecting;
    }
    function close() {
        closed = true;
        failPending('transport-closed');
        if (child && !processExited) { child.stdin.end(); child.kill(); }
        return { localTransportClosed: true, endpointStopped: false };
    }
    async function shutdown({ timeoutMs = options.closeTimeoutMs || 2000 } = {}) {
        if (!positiveInt(timeoutMs) || timeoutMs > 10000) throw new TypeError('Bounded transport shutdown timeout required');
        if (shutdownPromise) return shutdownPromise;
        closed = true; failPending('transport-closed');
        shutdownPromise = (async () => {
            let forced = false;
            const wait = () => new Promise(resolve => {
                if (!child || processExited) return resolve(true);
                const done = () => { clearTimeout(timer); child.removeListener('exit', done); resolve(true); };
                const timer = setTimeout(() => { child.removeListener('exit', done); resolve(processExited); }, timeoutMs);
                child.once('exit', done);
            });
            if (child && !processExited) {
                const graceful = wait();
                try { child.stdin.end(); } catch { /* Exit still needs independent proof. */ }
                if (!await graceful) {
                    forced = true; const killed = wait();
                    try { child.kill(); } catch { /* Keep process exit unverified. */ }
                    await killed;
                }
            }
            return { localTransportClosed: true, endpointStopped: false, processCleanupVerified: !child || processExited, forced };
        })();
        return shutdownPromise;
    }
    return { connect, request, shutdown, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, close };
}

function createCodexClientAdapter(options = {}) {
    const transport = options.transport || createCodexStdioTransport(options);
    if (typeof transport.request !== 'function' || typeof transport.connect !== 'function') throw new TypeError('Codex transport requires connect and request');
    const contexts = new Map(), endpoints = new Map(), tokenUsage = new Map(), goalStates = new Map(), eventWaiters = new Set();
    let capabilities;
    const clock = options.now || Date.now;
    const schedule = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    const observer = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    const unsubscribe = typeof transport.subscribe === 'function' ? transport.subscribe(message => {
        const data = message.params || {};
        const turnId = data.turnId || data.turn?.id;
        if (nonempty(turnId)) for (const endpoint of endpoints.values()) {
            if (endpoint.threadId !== data.threadId || endpoint.turnId && endpoint.turnId !== turnId && !endpoint.nativeGoal) continue;
            endpoint.lifecycleEvents ||= new Map();
            if (!endpoint.lifecycleEvents.has(turnId) && endpoint.lifecycleEvents.size >= 8) continue;
            const event = endpoint.lifecycleEvents.get(turnId) || {};
            if (message.method === 'item/completed' && data.item?.type === 'userMessage') event.ready = true;
            if (message.method === 'turn/completed' && ['completed', 'interrupted', 'failed'].includes(data.turn?.status)) event.terminalStatus = data.turn.status;
            endpoint.lifecycleEvents.set(turnId, event);
        }
        if (message.method === 'thread/tokenUsage/updated' && nonempty(data.threadId)) tokenUsage.set(data.threadId, data.tokenUsage);
        if (message.method === 'thread/goal/updated' && nonempty(data.threadId)) goalStates.set(data.threadId, data.goal);
        if (message.method === 'turn/started') for (const endpoint of endpoints.values()) {
            if (endpoint.nativeGoal && endpoint.threadId === data.threadId && nonempty(data.turn?.id)) { endpoint.turnId = data.turn.id; endpoint.turnStatus = data.turn.status; }
        }
        if (message.method === 'turn/completed') for (const endpoint of endpoints.values()) {
            if (endpoint.threadId === data.threadId && endpoint.turnId === data.turn?.id) {
                endpoint.turnStatus = data.turn.status;
                if (!endpoint.nativeGoal || ['paused', 'complete', 'budgetLimited', 'usageLimited', 'blocked'].includes(goalStates.get(endpoint.threadId)?.status)) cancel(endpoint.timer);
            }
        }
        for (const wake of [...eventWaiters]) wake();
    }) : () => {};
    async function probe() {
        const declared = await transport.connect();
        if (!declared?.available || declared.handshake !== true) throw new Error('Codex host capability probe failed; supervised execution required');
        let modes = [];
        if (declared.methods?.includes('collaborationMode/list')) {
            const result = await transport.request('collaborationMode/list', {});
            modes = (result.data || []).map(value => value.mode).filter(mode => ['plan', 'default'].includes(mode));
        }
        const required = ['thread/start', 'thread/resume', 'thread/read', 'turn/start', 'turn/interrupt'];
        const missing = required.filter(method => !declared.methods?.includes(method));
        capabilities = { host: 'codex', available: !missing.length, reason: missing.length ? 'codex-lifecycle-capability-missing' : null,
            version: declared.version, transport: 'app-server-stdio', contextInjection: true, startOrResume: !missing.length,
            status: declared.methods?.includes('thread/read') === true, usage: declared.methods?.includes('account/rateLimits/read') === true,
            stop: declared.methods?.includes('turn/interrupt') === true, nativePlan: modes.includes('plan'), nativeGoal: declared.nativeGoalBudgetDeclared === true,
            tokenBudgetConfigured: false, derivedSessionBudgetInherited: false, inferenceValidated: false, evidence: declared.evidence };
        return structuredClone(capabilities);
    }
    function injectContext({ actionId, text, reference, sha256 }) {
        if (!nonempty(actionId) || !nonempty(text) || !nonempty(reference)) throw new TypeError('Context requires actionId, text and reference');
        const contextHash = createHash('sha256').update(text).digest('hex');
        if (sha256 !== undefined && sha256 !== contextHash) throw new Error('Action context SHA-256 mismatch');
        contexts.set(actionId, { text, reference, contextHash });
        return { actionId, reference, contextHash, staged: true, hostInjected: false };
    }
    async function configureGoal(threadId, requested, authorization, beforeMutation) {
        if (!capabilities.nativeGoal) throw new Error('Native Goal budget capability is unavailable; use bounded supervised tasks');
        if (!positiveInt(requested.tokenBudget) || !nonempty(requested.objective) || requested.objective.length > 4000) throw new TypeError('Native Goal requires a positive integer tokenBudget and objective');
        if (authorization?.actor !== 'user' || !nonempty(authorization.reference)) throw new Error('Native Goal requires explicit user authorization');
        const before = await transport.request('thread/goal/get', { threadId });
        if (before.goal && (before.goal.threadId !== threadId || before.goal.objective !== requested.objective || !['active', 'paused'].includes(before.goal.status))) throw new Error('Existing Goal cannot be replaced or accounting reset');
        if (before.goal && (!Number.isSafeInteger(before.goal.tokensUsed) || before.goal.tokensUsed < 0 || before.goal.tokensUsed >= requested.tokenBudget)) throw new Error('Existing Goal budget is exhausted or unknown');
        beforeMutation();
        await transport.request('thread/goal/set', { threadId, objective: requested.objective, status: 'active', tokenBudget: requested.tokenBudget, origin: 'user' });
        const readback = await transport.request('thread/goal/get', { threadId });
        const goal = readback.goal;
        if (!goal || goal.threadId !== threadId || goal.objective !== requested.objective || goal.status !== 'active' || goal.tokenBudget !== requested.tokenBudget || !Number.isSafeInteger(goal.tokensUsed) || goal.tokensUsed < 0 || goal.tokensUsed >= requested.tokenBudget) throw new Error('Native Goal budget readback failed; no business turn may start');
        goalStates.set(threadId, goal);
        return { configured: true, tokenBudget: goal.tokenBudget, tokensUsed: goal.tokensUsed, threadId, readback: true };
    }
    async function startOrResume(request) {
        if (!capabilities) await probe();
        if (!capabilities.available) throw new Error('Codex lifecycle unavailable; use supervised execution');
        if (request?.signal?.aborted) throw new Error('Host preparation cancelled; no business turn started');
        if (!nonempty(request?.actionId) || !nonempty(request.prompt) || !nonempty(request.cwd) || !path.isAbsolute(request.cwd)) throw new TypeError('Launch requires actionId, prompt and absolute cwd');
        if (request.authorization?.actor !== 'user' || !nonempty(request.authorization.reference)) throw new Error('Host launch requires referenced user authorization');
        if (endpoints.has(request.actionId)) throw new Error('Action already launched; resume its recorded endpoint instead of duplicate start');
        if (request.mode !== undefined && !['plan', 'default'].includes(request.mode)) throw new TypeError('Unknown host collaboration mode');
        if (request.mode === 'plan' && !capabilities.nativePlan) throw new Error('Native Plan capability unavailable; use supervised planning');
        if (request.nativeGoal && request.mode === 'plan') throw new Error('Plan and Goal execution must be separate launches');
        const deadline = Date.parse(request.deadlineAt);
        if (!nonempty(request.deadlineAt) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(request.deadlineAt) || !Number.isFinite(deadline) || deadline <= clock() || deadline - clock() > 2147483647) throw new TypeError('Host task requires a future bounded deadlineAt');
        if (request.maxTurns !== 1) throw new TypeError('Host adapter starts exactly one bounded turn; coordinator must authorize each next action');
        if (request.nativeGoal && !capabilities.nativeGoal) throw new Error('Native Goal budget capability is unavailable');
        if (request.mode !== undefined && !nonempty(request.model)) throw new Error('Native collaboration mode requires an explicit authorized model mapping');
        if (request.threadId !== undefined && !capabilities.nativeGoal) throw new Error('Resuming without Goal inspection requires supervised execution');
        if (request.context) {
            if (!nonempty(request.context.sha256)) throw new Error('Managed action context requires SHA-256');
            injectContext({ ...request.context, actionId: request.actionId, reference: request.context.reference || `context:${request.context.sha256}` });
        }
        const context = contexts.get(request.actionId);
        if (request.sandbox !== undefined && !['read-only', 'workspace-write'].includes(request.sandbox)) throw new TypeError('Unsupported bounded sandbox');
        const params = { cwd: request.cwd, approvalPolicy: 'never', sandbox: request.sandbox || 'workspace-write',
            ...(context ? { developerInstructions: context.text } : {}), ...(request.model ? { model: request.model } : {}) };
        let thread;
        if (request.threadId !== undefined) {
            if (!nonempty(request.threadId)) throw new TypeError('Resume threadId must be non-empty');
            thread = (await transport.request('thread/resume', { ...params, threadId: request.threadId, excludeTurns: true })).thread;
            if (thread?.id !== request.threadId) throw new Error('Resume returned a different thread identity');
        } else thread = (await transport.request('thread/start', params)).thread;
        if (!nonempty(thread?.id)) throw new Error('Host launch did not return a thread identity');
        const endpoint = { actionId: request.actionId, threadId: thread.id, turnId: null, deadlineAt: request.deadlineAt,
            nativeGoal: false, turnStatus: 'notStarted', budget: { configured: false }, ...(context ? { contextReference: context.reference, contextHash: context.contextHash } : {}) };
        // Retain the identity before the first mutating goal/turn call. Failure is
        // execution-unknown and cannot silently create another endpoint on retry.
        endpoints.set(request.actionId, endpoint);
        try {
            if (request.signal?.aborted) throw new Error('Host preparation cancelled; no business turn started');
            if (request.nativeGoal) {
                endpoint.budget = await configureGoal(thread.id, request.nativeGoal, request.goalAuthorization || request.authorization, () => { endpoint.nativeGoal = true; });
            } else if (capabilities.nativeGoal) {
                const existing = await transport.request('thread/goal/get', { threadId: thread.id });
                if (existing.goal?.status === 'active') throw new Error('Bounded task cannot run under an unaccounted active Goal');
            }
            const turnParams = { threadId: thread.id, input: [{ type: 'text', text: request.prompt }],
                ...(request.mode !== undefined ? { collaborationMode: { mode: request.mode, settings: { model: request.model, developer_instructions: null } } } : {}) };
            if (clock() >= deadline) throw new Error('Host preparation consumed the task deadline; no business turn started');
            if (request.signal?.aborted) throw new Error('Host preparation cancelled; no business turn started');
            const result = await transport.request('turn/start', turnParams);
            if (!nonempty(result.turn?.id)) throw new Error('Host turn identity is missing');
            endpoint.turnId = result.turn.id; endpoint.turnStatus = endpoint.lifecycleEvents?.get(result.turn.id)?.terminalStatus || result.turn.status;
            endpoint.timer = schedule(() => { stop({ actionId: request.actionId, reason: 'bounded-deadline' }).then(receipt => observer({ kind: receipt.stopped ? 'host-stop' : 'host-stop-unconfirmed', actionId: request.actionId, receipt }), () => observer({ kind: 'host-stop-unconfirmed', actionId: request.actionId })); }, Math.max(1, deadline - clock()));
            endpoint.timer?.unref?.();
            return { actionId: request.actionId, status: 'succeeded', endpointId: thread.id, artifactRefs: [], ...(context ? { contextHash: context.contextHash } : {}),
                host: { threadId: thread.id, turnId: endpoint.turnId, deadlineAt: endpoint.deadlineAt, budget: endpoint.budget,
                    contextInjected: !!context, mode: request.mode || 'default', maxTurns: 1, supervisionRequired: true, derivedSessionBudgetInherited: false } };
        } catch (error) {
            // A failed readback may still have set an active Goal. Pause it before
            // returning; the failure receipt makes any unresolved host state clear.
            const diagnostics = []; appendDiagnostics(diagnostics, error, 'launch');
            let goalPaused = false;
            if (endpoint.nativeGoal) try { await transport.request('thread/goal/set', { threadId: thread.id, status: 'paused', origin: 'automatic' }); goalPaused = (await transport.request('thread/goal/get', { threadId: thread.id })).goal?.status === 'paused'; } catch (failure) { appendDiagnostics(diagnostics, failure, 'goal-pause'); }
            return { actionId: request.actionId, status: 'blocked', endpointId: thread.id, artifactRefs: [], error: error.message === 'Native Goal budget readback failed; no business turn may start' ? error.message : 'host-launch-unverified', ...(diagnostics.length ? { diagnostics } : {}),
                host: { executionUnknown: true, goalPaused, budgetConfigured: false } };
        }
    }
    function endpointFor(input) {
        const endpoint = endpoints.get(input?.actionId);
        if (!endpoint) throw new Error('Unknown host endpoint; restore its persisted action binding before operating');
        return endpoint;
    }
    function restoreEndpoint(receipt) {
        if (!nonempty(receipt?.actionId) || !nonempty(receipt.endpointId) || receipt.host?.threadId !== receipt.endpointId || !nonempty(receipt.host.turnId) || !Number.isFinite(Date.parse(receipt.host.deadlineAt))) throw new TypeError('Restore requires a persisted launch receipt with matching endpoint identity');
        if (endpoints.has(receipt.actionId)) throw new Error('Action endpoint is already bound');
        endpoints.set(receipt.actionId, { actionId: receipt.actionId, threadId: receipt.endpointId, turnId: receipt.host.turnId,
            deadlineAt: receipt.host.deadlineAt, budget: receipt.host.budget || { configured: false }, nativeGoal: receipt.host.budget?.configured === true, turnStatus: 'unknown', ...(receipt.contextHash ? { contextHash: receipt.contextHash } : {}) });
        const endpoint = endpoints.get(receipt.actionId);
        endpoint.timer = schedule(() => { status({ actionId: receipt.actionId }).then(() => stop({ actionId: receipt.actionId, reason: 'restored-deadline' })).then(value => observer({ kind: value.stopped ? 'host-stop' : 'host-stop-unconfirmed', actionId: receipt.actionId, receipt: value }), () => observer({ kind: 'host-stop-unconfirmed', actionId: receipt.actionId })); }, Math.max(1, Date.parse(endpoint.deadlineAt) - clock()));
        endpoint.timer?.unref?.();
        return { actionId: receipt.actionId, endpointId: receipt.endpointId, restored: true, hostStatusVerified: false };
    }
    function waitForLifecycle(input, terminal) {
        const endpoint = endpointFor(input), timeoutMs = Math.min(input.timeoutMs || 10000, terminal ? Infinity : Date.parse(endpoint.deadlineAt) - clock());
        if (!positiveInt(timeoutMs) || timeoutMs > 300000) return Promise.reject(new Error('client-lifecycle-deadline'));
        return new Promise((resolve, reject) => {
            let timer;
            const finish = (error, event) => { clearTimeout(timer); eventWaiters.delete(wake); input.signal?.removeEventListener('abort', aborted); error ? reject(error) : resolve({ actionId: endpoint.actionId, endpointId: endpoint.threadId, turnId: endpoint.turnId, ...(terminal ? { terminalObserved: true, turnStatus: event.terminalStatus } : { ready: true, source: event.ready ? 'user-item-completed' : 'terminal-event' }) }); };
            const aborted = () => finish(new Error('client-lifecycle-cancelled'));
            const wake = error => { if (error) return finish(error); const event = endpoint.lifecycleEvents?.get(endpoint.turnId); if (terminal ? event?.terminalStatus : event?.ready || event?.terminalStatus) finish(null, event); };
            eventWaiters.add(wake); input.signal?.addEventListener('abort', aborted, { once: true });
            timer = setTimeout(() => finish(new Error(terminal ? 'client-terminal-unverified' : 'client-startup-unverified')), timeoutMs);
            if (input.signal?.aborted) aborted(); else wake();
        });
    }
    async function status(input) {
        const endpoint = endpointFor(input);
        if (!capabilities) await probe();
        let goal = null;
        if (endpoint.nativeGoal) {
            goal = (await transport.request('thread/goal/get', { threadId: endpoint.threadId })).goal;
            if (!goal || goal.threadId !== endpoint.threadId || !positiveInt(goal.tokenBudget) || goal.tokenBudget !== endpoint.budget.tokenBudget || !Number.isSafeInteger(goal.tokensUsed) || goal.tokensUsed < 0 || !['active', 'paused', 'complete', 'budgetLimited', 'usageLimited', 'blocked'].includes(goal.status)) throw new Error('Native Goal status identity or budget readback failed');
            goalStates.set(endpoint.threadId, goal);
        }
        if (capabilities.status && (await transport.connect()).methods?.includes('thread/turns/list')) {
            const page = await transport.request('thread/turns/list', { threadId: endpoint.threadId, limit: 50, sortDirection: 'desc', itemsView: 'notLoaded' });
            const turns = page.data || [];
            const turn = endpoint.nativeGoal ? turns.find(value => value.status === 'inProgress') || turns[0] : turns.find(value => value.id === endpoint.turnId);
            if (endpoint.nativeGoal && nonempty(turn?.id)) endpoint.turnId = turn.id;
            endpoint.turnStatus = turn && ['completed', 'interrupted', 'failed', 'inProgress'].includes(turn.status) ? turn.status : 'unknown';
        }
        if (clock() >= Date.parse(endpoint.deadlineAt) && endpoint.turnStatus === 'inProgress') await stop({ actionId: input.actionId, reason: 'bounded-deadline' });
        const data = await transport.request('thread/read', { threadId: endpoint.threadId, includeTurns: false });
        if (data.thread?.id !== endpoint.threadId) throw new Error('Host status identity mismatch');
        return { actionId: endpoint.actionId, endpointId: endpoint.threadId, threadStatus: data.thread.status, turnId: endpoint.turnId, turnStatus: endpoint.turnStatus,
            completed: endpoint.nativeGoal ? goal?.threadId === endpoint.threadId && goal.status === 'complete' && endpoint.turnStatus !== 'inProgress' : endpoint.turnStatus === 'completed',
            supervisionRequired: true, ...(endpoint.contextHash ? { contextHash: endpoint.contextHash } : {}) };
    }
    async function usage(input) {
        if (!capabilities) await probe();
        if (!capabilities.usage) throw new Error('Codex usage capability is unavailable; quota state is unknown');
        const endpoint = input ? endpointFor(input) : null;
        const rates = await transport.request('account/rateLimits/read', {});
        let goal = null;
        if (endpoint?.nativeGoal) { goal = (await transport.request('thread/goal/get', { threadId: endpoint.threadId })).goal; goalStates.set(endpoint.threadId, goal); }
        return { snapshot: sanitizeQuotaSnapshot({ ...rates, observedAt: new Date(clock()).toISOString() }),
            threadTokens: endpoint ? tokenUsage.get(endpoint.threadId) || null : null,
            goal: goal ? { threadId: goal.threadId, tokenBudget: goal.tokenBudget ?? null, tokensUsed: goal.tokensUsed ?? null, status: goal.status } : null,
            weeklyTokensEquivalent: null };
    }
    async function stop(input) {
        const endpoint = endpointFor(input);
        cancel(endpoint.timer);
        const errors = [], diagnostics = [];
        let goalPaused = !endpoint.nativeGoal, interruptRequested = false, interruptAcknowledged = false;
        if (endpoint.nativeGoal) {
            try {
                const before = (await transport.request('thread/goal/get', { threadId: endpoint.threadId })).goal;
                if (before?.threadId !== endpoint.threadId) throw new Error('Goal identity is unknown');
                if (['paused', 'complete', 'budgetLimited', 'usageLimited', 'blocked'].includes(before.status)) goalPaused = true;
                else {
                    await transport.request('thread/goal/set', { threadId: endpoint.threadId, status: 'paused', origin: 'automatic' });
                    goalPaused = (await transport.request('thread/goal/get', { threadId: endpoint.threadId })).goal?.status === 'paused';
                }
                if (!goalPaused) errors.push('goal-pause-unconfirmed');
            } catch (error) { errors.push('goal-pause-unconfirmed'); appendDiagnostics(diagnostics, error, 'goal-pause'); }
            try {
                const page = await transport.request('thread/turns/list', { threadId: endpoint.threadId, limit: 50, sortDirection: 'desc', itemsView: 'notLoaded' });
                const active = (page.data || []).find(turn => turn.status === 'inProgress');
                if (active) { endpoint.turnId = active.id; endpoint.turnStatus = active.status; }
            } catch (error) { errors.push('active-turn-unconfirmed'); appendDiagnostics(diagnostics, error, 'active-turn'); }
        }
        if (endpoint.turnId && endpoint.turnStatus === 'inProgress') {
            interruptRequested = true;
            try { await transport.request('turn/interrupt', { threadId: endpoint.threadId, turnId: endpoint.turnId }); interruptAcknowledged = true; }
            catch (error) { errors.push('turn-interrupt-unconfirmed'); appendDiagnostics(diagnostics, error, 'interrupt'); }
        }
        // An interrupt ACK is not completion, fixture cleanup or process cleanup.
        return { actionId: endpoint.actionId, endpointId: endpoint.threadId, interruptRequested, interruptAcknowledged,
            stopped: !errors.length && goalPaused && ['interrupted', 'completed', 'failed', 'notStarted'].includes(endpoint.turnStatus), goalPaused, errors, ...(diagnostics.length ? { diagnostics } : {}),
            supervisionRequired: true, processCleanupVerified: false, resourceCleanupVerified: false };
    }
    async function shutdown(options) {
        for (const endpoint of endpoints.values()) cancel(endpoint.timer);
        for (const wake of [...eventWaiters]) wake(new Error('client-lifecycle-closed'));
        unsubscribe();
        return typeof transport.shutdown === 'function' ? transport.shutdown(options) : { ...(transport.close?.() || {}), processCleanupVerified: false, endpointStopped: false };
    }
    function dispose() {
        for (const endpoint of endpoints.values()) cancel(endpoint.timer);
        for (const wake of [...eventWaiters]) wake(new Error('client-lifecycle-closed'));
        unsubscribe();
        return transport.close?.() || { localTransportClosed: false, endpointStopped: false };
    }
    return { probe, injectContext, startOrResume, status, usage, stop, restoreEndpoint, dispose, shutdown, waitForReady: input => waitForLifecycle(input, false), waitForTerminal: input => waitForLifecycle(input, true) };
}

module.exports = { probeCodexCli, createCodexStdioTransport, createCodexClientAdapter };
