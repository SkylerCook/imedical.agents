'use strict';

// The coordinator owns durable actions/results. Adapters only operate the host
// endpoint and return launch-result/v1-compatible receipts; they do not dispatch.
const REQUIRED_METHODS = Object.freeze(['probe', 'injectContext', 'startOrResume', 'status', 'usage', 'stop']);

function validateClientAdapter(adapter) {
    if (!adapter || REQUIRED_METHODS.some(name => typeof adapter[name] !== 'function')) throw new TypeError(`Client adapter requires ${REQUIRED_METHODS.join(', ')}`);
    return adapter;
}

function createClientAdapter(options = {}) {
    const host = options.host || options.provider;
    if (options.adapter) return validateClientAdapter(options.adapter);
    if (host === 'codex') return require('./night-codex-client').createCodexClientAdapter(options);
    throw new Error(`Client adapter unavailable for ${host || 'unspecified host'}; use supervised execution`);
}


// Explicitly authorized no-business lifecycle probes own their adapter. The caller
// persists each snapshot in its existing capability receipt before more host work.
async function probeClientLifecycle(options, { createAdapter = createClientAdapter } = {}) {
    const path = require('node:path'), { randomUUID } = require('node:crypto');
    const { appendDiagnostics } = require('./night-client-diagnostics');
    const { cwd, authorization, model, signal, recordReceipt, host = 'codex', timeoutMs = 30000, closeTimeoutMs = 2000 } = options || {};
    const deadline = Math.min(typeof options?.deadlineAt === 'number' ? options.deadlineAt : Date.parse(options?.deadlineAt), Date.now() + timeoutMs);
    if (!path.isAbsolute(cwd || '') || authorization?.actor !== 'user' || !authorization.reference || typeof recordReceipt !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300000 || !Number.isSafeInteger(closeTimeoutMs) || closeTimeoutMs <= 0 || closeTimeoutMs > 10000 || !Number.isFinite(deadline) || deadline <= Date.now() || signal?.aborted) throw Error('Authorized bounded lifecycle probe and persistent receipt required');
    const id = randomUUID(), pending = new Set();
    const receipt = { schema: 'night-client-lifecycle/v1', checkedAt: new Date().toISOString(), phase: 'starting', checks: [], cleanupVerified: false, operationExited: false,
        endpoints: [1, 2].map(n => ({ actionId: 'lifecycle-' + id + '-' + n, endpointId: null, turnId: null, deadlineAt: new Date(deadline).toISOString(), launchAttempted: false, startupReady: false, historyReadbackVerified: false, stopAttempted: false, interruptRequested: false, interruptAcknowledged: false, terminalVerified: false, failures: [], diagnostics: [] })) };
    async function bounded(fn, ms = closeTimeoutMs) {
        let timer; const task = Promise.resolve().then(fn); pending.add(task); task.then(() => pending.delete(task), () => pending.delete(task));
        try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('client-probe-operation-unverified')), Math.max(1, ms)); })]); }
        finally { clearTimeout(timer); }
    }
    let writes = Promise.resolve(), recordingFailed = false, adapter;
    function publish() {
        const snapshot = structuredClone(receipt);
        const next = writes.catch(() => {}).then(() => bounded(() => recordReceipt(snapshot)));
        writes = next; return next.catch(() => { recordingFailed = true; throw Error('client-probe-receipt-unverified'); });
    }
    const failure = (row, category, error, stage) => { if (!row.failures.includes(category)) row.failures.push(category); appendDiagnostics(row.diagnostics, error, stage); };
    await publish(); // No client or endpoint is created before durable recording works.
    const controller = new AbortController(), combined = AbortSignal.any([controller.signal, ...[signal].filter(Boolean)]);
    const deadlineTimer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    async function stop(row) {
        if (!row.endpointId || row.stopAttempted) return;
        row.stopAttempted = true;
        try { await publish(); } catch { /* Still stop the exact owned endpoint. */ }
        try {
            const result = await bounded(() => adapter.stop({ actionId: row.actionId }));
            row.interruptRequested = result?.interruptRequested === true; row.interruptAcknowledged = result?.interruptAcknowledged === true;
            appendDiagnostics(row.diagnostics, result, 'interrupt');
            if (!row.interruptAcknowledged) failure(row, 'interrupt-unverified');
        } catch (error) { failure(row, 'interrupt-unverified', error, 'interrupt'); }
        try { await publish(); } catch { /* ACK and readback remain separate even when persistence fails. */ }
        try {
            const terminal = await bounded(() => adapter.waitForTerminal({ actionId: row.actionId, timeoutMs: closeTimeoutMs }));
            row.terminalVerified = terminal?.terminalObserved === true && terminal.endpointId === row.endpointId && terminal.turnId === row.turnId && ['completed', 'interrupted', 'failed'].includes(terminal.turnStatus);
        } catch { /* A one-shot readback can independently prove terminal state. */ }
        try {
            const status = await bounded(() => adapter.status({ actionId: row.actionId }));
            row.stopReadbackVerified = status?.endpointId === row.endpointId && status.turnId === row.turnId && ['completed', 'interrupted', 'failed'].includes(status.turnStatus);
            if (status?.turnStatus === 'inProgress') row.terminalVerified = false;
            else row.terminalVerified ||= row.stopReadbackVerified;
        } catch (error) { failure(row, 'stop-readback-unverified', error, 'stop-readback'); }
        if (!row.terminalVerified) failure(row, 'terminal-unverified');
        try { await publish(); } catch { /* Final receipt remains blocked. */ }
    }
    try {
        adapter = createAdapter({ host, cwd, timeoutMs: Math.min(5000, timeoutMs), closeTimeoutMs });
        if (['waitForReady', 'waitForTerminal', 'shutdown'].some(name => typeof adapter[name] !== 'function')) throw Error('Client lifecycle observations unavailable');
        await bounded(() => adapter.probe(), Math.max(1, deadline - Date.now()));
        receipt.phase = 'probing';
        await Promise.all(receipt.endpoints.map(async row => {
            try {
                if (combined.aborted) throw Error('client-probe-cancelled');
                row.launchAttempted = true; await publish();
                if (combined.aborted) { row.launchAttempted = false; throw Error('client-probe-cancelled'); }
                const launch = await bounded(() => adapter.startOrResume({ actionId: row.actionId, cwd, authorization, signal: combined, ...(model ? { model } : {}), sandbox: 'read-only', maxTurns: 1, deadlineAt: row.deadlineAt,
                    prompt: 'Lifecycle capability probe only. Do not use tools, change files, contact services or perform business work. Reply READY only.' }), Math.max(1, deadline - Date.now()));
                row.endpointId = typeof launch?.endpointId === 'string' && launch.endpointId.trim() ? launch.endpointId : null; row.turnId = typeof launch?.host?.turnId === 'string' && launch.host.turnId.trim() ? launch.host.turnId : null;
                await publish();
                if (launch?.status !== 'succeeded' || !row.endpointId || !row.turnId) throw Error('client-probe-launch-unverified');
                const ready = await bounded(() => adapter.waitForReady({ actionId: row.actionId, timeoutMs: Math.max(1, deadline - Date.now()), signal: combined }), Math.max(1, deadline - Date.now()));
                row.startupReady = ready?.ready === true && ready.endpointId === row.endpointId && ready.turnId === row.turnId;
                if (!row.startupReady) throw Error('client-probe-startup-unverified');
                try {
                    const status = await bounded(() => adapter.status({ actionId: row.actionId }), Math.max(1, deadline - Date.now()));
                    row.historyReadbackVerified = status?.endpointId === row.endpointId && status.turnId === row.turnId && ['inProgress', 'completed', 'interrupted', 'failed'].includes(status.turnStatus);
                    if (!row.historyReadbackVerified) failure(row, 'history-readback-unverified');
                } catch (error) { failure(row, 'history-readback-unverified', error, 'startup-readback'); }
            } catch (error) { failure(row, row.endpointId ? 'startup-unverified' : 'launch-unverified', error, 'launch'); }
            finally { await stop(row); }
        }));
    } catch { receipt.failure = 'client-lifecycle-unavailable'; }
    finally {
        clearTimeout(deadlineTimer); controller.abort();
        for (const row of receipt.endpoints) await stop(row);
        if (adapter) try {
            const transport = await bounded(() => adapter.shutdown({ timeoutMs: closeTimeoutMs }), closeTimeoutMs * 2 + 100);
            receipt.transport = { localTransportClosed: transport?.localTransportClosed === true, processCleanupVerified: transport?.processCleanupVerified === true, endpointStopped: false, forced: transport?.forced === true };
        }
        catch { receipt.transport = { localTransportClosed: false, processCleanupVerified: false, endpointStopped: false }; }
        receipt.phase = 'complete'; receipt.operationExited = pending.size === 0;
        if (recordingFailed) receipt.failure = 'client-probe-receipt-unverified';
        receipt.unresolvedEndpoints = receipt.endpoints.filter(row => row.launchAttempted && !row.terminalVerified).map(row => ({ actionId: row.actionId, endpointId: row.endpointId, turnId: row.turnId }));
        receipt.cleanupVerified = receipt.operationExited && !recordingFailed && !receipt.unresolvedEndpoints.length && (!adapter || receipt.transport?.processCleanupVerified === true);
        receipt.checks = [
            { id: 'client-lifecycle', passed: receipt.endpoints.every(row => row.startupReady && row.historyReadbackVerified) },
            { id: 'client-stop', passed: receipt.endpoints.every(row => row.interruptAcknowledged && row.terminalVerified) }
        ].map(check => ({ id: check.id, role: '*', status: check.passed && receipt.cleanupVerified ? 'passed' : 'blocked', nonInteractive: true, evidenceRef: 'capability:client-lifecycle' }));
        await publish();
    }
    return receipt;
}

module.exports = { probeClientLifecycle, REQUIRED_METHODS, validateClientAdapter, createClientAdapter,
    createCodexClientAdapter: options => require('./night-codex-client').createCodexClientAdapter(options) };
