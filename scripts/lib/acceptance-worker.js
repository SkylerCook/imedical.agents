'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createTestExecutor } = require('./playwright-runner');

// A restricted, process-local owner. No listener, arbitrary method dispatch or credentials file.
function createAcceptanceWorker({ profile, profileFile, runDirectory, executor: supplied, managed, loadManifest, recordOwnerExit, workerRef = crypto.randomUUID() }) {
    const { runAcceptance, runPreflight, safeStage } = require('../run-acceptance');
    if (!profile?.options || !profileFile || !runDirectory || !/^[A-Za-z0-9-]{1,100}$/.test(workerRef) || !Number.isFinite(profile.options.deadlineAt) || profile.options.deadlineAt <= Date.now() || profile.options.deadlineAt - Date.now() > 2147483647) throw new Error('Bounded worker profile and run directory required');
    const executor = supplied || createTestExecutor(profile.options), outstanding = new Set();
    let active, stopping, stopped = false, ready = false, preflightOwnerRefs = [];
    let resolveClosed;
    const closed = new Promise(resolve => { resolveClosed = resolve; });
    const deadlineTimer = setTimeout(() => { void stop().catch(() => {}); }, profile.options.deadlineAt - Date.now());
    const onAbort = () => { void stop().catch(() => {}); };
    profile.options.signal?.addEventListener('abort', onAbort, { once: true });
    if (profile.options.signal?.aborted) Promise.resolve().then(onAbort);
    const response = (request, value) => ({ schema: 'imedical-acceptance-worker-response/v1', id: request?.id ?? null, operation: request?.operation ?? null, workerRef, workerPid: process.pid, ...value });
    function observeOperation(work) { outstanding.add(work); work.then(() => outstanding.delete(work), () => outstanding.delete(work)); }
    function snapshot() { const state = executor.snapshot(); return { ...state, workerRef, workerPid: process.pid, stopped, ready, retainedOwnersControllable: state.retainedOwnersControllable && !active && !outstanding.size, pendingOperations: state.pendingOperations + outstanding.size }; }
    function rejected(request, category, stage = 'entry') { return response(request, { status: 'rejected', error: { category, stage: safeStage(stage) }, state: snapshot() }); }
    async function stop() {
        if (stopping) return stopping;
        stopped = true; ready = false; clearTimeout(deadlineTimer); profile.options.signal?.removeEventListener('abort', onAbort);
        stopping = (async () => {
            const owners = executor.snapshot().retainedOwners;
            let result = await executor.stop(), timer;
            // Let an aborted managed case write its own final receipt before owner exit.
            if (active) await Promise.race([active.catch(() => {}), new Promise(resolve => { timer = setTimeout(resolve, profile.options.closeTimeoutMs || 10000); })]);
            clearTimeout(timer);
            result = { ...result, pendingOperations: snapshot().pendingOperations };
            result.cleanupVerified = result.cleanupVerified === true && result.pendingOperations === 0;
            result.temporaryResourcesExited = result.temporaryResourcesExited === true && result.pendingOperations === 0;
            result.retainedOwnerCount = result.cleanupVerified ? 0 : owners.length;
            const receipts = [];
            for (const owner of owners) {
                const directory = path.resolve(runDirectory, 'evidence', 'night-operations'); fs.mkdirSync(directory, { recursive: true });
                const evidenceRef = path.join(directory, `${workerRef}-exit-${owner.ownerRef}-${crypto.randomUUID()}.json`);
                const receipt = { schema: 'imedical-browser-owner-exit/v1', ownerRef: owner.ownerRef, workerRef, workerPid: process.pid, cleanupVerified: result.cleanupVerified, pendingOperations: result.pendingOperations, checkedAt: new Date().toISOString(), evidenceRef };
                fs.writeFileSync(evidenceRef, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
                if (recordOwnerExit) await recordOwnerExit(receipt);
                else {
                    const orchestrator = require('../agent-orchestrator'), manifest = orchestrator.loadManifest(path.resolve(runDirectory));
                    orchestrator.recordNight(path.resolve(runDirectory), { kind: 'browser-owner-exit', receipt, rationale: 'Caller-owned bounded worker stopped', evidenceRefs: [evidenceRef] }, manifest.coordinatorId);
                }
                receipts.push(receipt);
            }
            return { ...result, workerRef, workerPid: process.pid, exitReceipts: receipts };
        })();
        const attempt = stopping;
        attempt.then(result => { resolveClosed(result); if (!result.cleanupVerified && stopping === attempt) stopping = undefined; }, () => { resolveClosed({ cleanupVerified: false, pendingOperations: snapshot().pendingOperations }); if (stopping === attempt) stopping = undefined; });
        return attempt;
    }
    async function request(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || !/^[A-Za-z0-9_.:-]{1,100}$/.test(input.id || '') || !['preflight', 'verify', 'stop'].includes(input.operation) || Object.keys(input).some(k => !['id', 'operation', 'deadlineAt', 'workItemId', 'environmentAlias'].includes(k))) return rejected({ id: null }, 'request-contract');
        if (input.operation === 'stop') {
            try { return response(input, { status: 'completed', result: await stop() }); }
            catch { return rejected(input, 'owner-exit-unverified', 'browser-close'); }
        }
        if (stopped) return rejected(input, 'worker-stopped');
        if (active || snapshot().pendingOperations) return rejected(input, 'pending-operations');
        if (!Number.isFinite(input.deadlineAt) || input.deadlineAt <= Date.now() || input.deadlineAt > profile.options.deadlineAt) return rejected(input, 'request-deadline');
        if (input.operation === 'verify' && (!ready || typeof input.workItemId !== 'string' || !input.workItemId || typeof input.environmentAlias !== 'string' || !input.environmentAlias)) return rejected(input, 'verification-binding');
        const local = new AbortController(), remaining = input.deadlineAt - Date.now(); let timer;
        const execution = { executor, managed, loadManifest, workerRef, deadlineAt: input.deadlineAt, signal: local.signal, observeOperation, ...(input.operation === 'verify' ? { allowedOwnerRefs: preflightOwnerRefs } : {}), runDirectory: path.resolve(runDirectory), profileFingerprint: crypto.createHash('sha256').update(fs.readFileSync(profileFile)).digest('hex'), workItemId: input.workItemId, environmentAlias: input.environmentAlias };
        const work = Promise.resolve().then(() => input.operation === 'preflight' ? runPreflight(profile, profileFile, runDirectory, execution) : runAcceptance(profile, execution));
        active = work; work.then(() => { if (active === work) active = undefined; }, () => { if (active === work) active = undefined; });
        try {
            const result = await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => { local.abort(); reject(Object.assign(new Error('request-deadline'), { code: 'request-deadline', stage: input.operation === 'preflight' ? 'preflight' : 'operation' })); }, remaining); })]);
            if (input.operation === 'preflight') { ready = result.state === 'ready'; preflightOwnerRefs = result.retainedOwners.map(owner => owner.ownerRef); }
            return response(input, { status: 'completed', result });
        } catch (error) { if (input.operation === 'preflight') ready = false; return rejected(input, error.code === 'request-deadline' ? 'request-deadline' : 'execution-unverified', error.stage); }
        finally { clearTimeout(timer); }
    }
    return { request, stop, snapshot, executor, closed };
}

async function serveAcceptanceWorker(worker, input, output, { maxLineBytes = 65536 } = {}) {
    let buffer = '', chain = Promise.resolve(), stoppedByRequest = false;
    const write = result => output.write(JSON.stringify(result) + '\n');
    worker.closed.then(() => { stoppedByRequest = true; input.pause(); input.emit('acceptance-stop'); });
    function line(value) {
        let request;
        try { request = JSON.parse(value); } catch { write({ schema: 'imedical-acceptance-worker-response/v1', id: null, status: 'rejected', error: { category: 'request-json', stage: 'entry' } }); return; }
        // Requests are deliberately not queued behind long cases: overlap is rejected.
        const task = worker.request(request).then(result => { write(result); if (request.operation === 'stop') { stoppedByRequest = true; input.pause(); input.emit('acceptance-stop'); } });
        chain = Promise.allSettled([chain, task]);
    }
    await new Promise((resolve, reject) => {
        input.setEncoding('utf8');
        const end = () => { input.removeListener('data', data); input.removeListener('error', reject); input.removeListener('end', end); input.removeListener('acceptance-stop', end); resolve(); };
        function data(chunk) {
            buffer += chunk;
            if (Buffer.byteLength(buffer) > maxLineBytes && !buffer.includes('\n')) { write({ schema: 'imedical-acceptance-worker-response/v1', id: null, status: 'rejected', error: { category: 'request-size', stage: 'entry' } }); end(); return; }
            let index;
            while ((index = buffer.indexOf('\n')) >= 0) { const value = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (Buffer.byteLength(value) > maxLineBytes) { end(); break; } if (value.trim()) line(value); }
        }
        input.on('data', data); input.once('end', end); input.once('error', reject); input.once('acceptance-stop', end);
    });
    if (!stoppedByRequest && buffer.trim()) line(buffer);
    await chain;
    const cleanup = await worker.stop();
    return cleanup.cleanupVerified ? 0 : 1;
}
module.exports = { createAcceptanceWorker, serveAcceptanceWorker };
