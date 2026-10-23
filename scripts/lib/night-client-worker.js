'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createManagedNightClient } = require('./night-client-supervisor');

// One host process supervises the run's endpoints. This does not select work.
function createClientWorker({ runDirectory, adapter, intervalMs = 5000, now = Date.now, onClosed = () => {}, ...seams }) {
    if (!path.isAbsolute(runDirectory || '') || !Number.isSafeInteger(intervalMs) || intervalMs < 100 || intervalMs > 10000) throw Error('Bounded client worker configuration required');
    const root = path.resolve(runDirectory), directory = path.join(root, 'evidence', 'night-operations');
    fs.mkdirSync(directory, { recursive: true });
    const lease = path.join(root, 'night-client-worker.lock'), identity = crypto.randomUUID(), watchers = new Map();
    let timer, queue = Promise.resolve(), closed = false, closing = false, acquired = false, lastObservation = null, closeoutSince = null;
    function persist(file, value) { const next = `${file}.${identity}.tmp`; fs.writeFileSync(next, JSON.stringify(value) + '\n'); fs.renameSync(next, file); }
    function heartbeat() { persist(lease, { schema: 'night-client-worker/v1', identity, pid: process.pid, heartbeatAt: new Date(now()).toISOString(), intervalMs, runDirectory: root }); }
    function acquire() {
        try { fs.writeFileSync(lease, JSON.stringify({ identity, pid: process.pid, runDirectory: root }), { flag: 'wx' }); }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const old = JSON.parse(fs.readFileSync(lease, 'utf8'));
            if (typeof old.identity !== 'string' || !Number.isSafeInteger(old.pid) || old.pid <= 0) throw Error('Unknown supervisor lease owner; reconcile before recovery');
            try { process.kill(old.pid, 0); throw Error('Run already has a live client supervisor'); }
            catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
            // A dead owner is recoverable. Check the exact lease again before removal.
            if (fs.readFileSync(lease, 'utf8') !== JSON.stringify(old) && JSON.parse(fs.readFileSync(lease, 'utf8')).identity !== old.identity) throw Error('Supervisor lease changed');
            fs.unlinkSync(lease); fs.writeFileSync(lease, JSON.stringify({ identity, pid: process.pid, runDirectory: root }), { flag: 'wx' });
        }
        acquired = true; heartbeat();
    }
    const managed = createManagedNightClient({ ...seams, runDirectory: root, adapter, now, probeWatcher: async ({ receipt, challenge, actionId }) => {
        const value = watchers.get(actionId);
        if (!closed && value && value.identity === identity && receipt.pid === process.pid && value.deadlineAt === receipt.deadlineAt) return { challenge, alive: true, pid: process.pid, actionId, deadlineAt: value.deadlineAt, runDirectory: root };
        return { challenge, alive: false };
    } });
    function serial(fn) { const task = queue.then(fn); queue = task.catch(() => {}); return task; }
    function schedule() {
        if (closing || closed) return;
        timer = setTimeout(() => { serial(observe).catch(() => close('supervision-observation-failed')).finally(schedule).catch(() => onClosed(lastObservation)); }, intervalMs);
    }
    async function observe() {
        heartbeat();
        lastObservation = await managed.tick();
        persist(path.join(directory, 'client-worker-checkpoint.json'), { schema: 'night-client-worker-checkpoint/v1', identity, pid: process.pid, observedAt: new Date(now()).toISOString(), observation: lastObservation });
        if (!closing && lastObservation.mode === 'closeout') {
            closeoutSince ??= now();
            if (!lastObservation.unresolvedEndpoints.length && lastObservation.endpoints.every(e => e.stoppedVerified) || now() - closeoutSince >= 30000) setTimeout(() => { close('closeout-or-unknown-endpoint-deadline').catch(() => onClosed(lastObservation)); }, 0);
        } else if (!closing) closeoutSince = null;
        return lastObservation;
    }
    async function start() {
        acquire();
        try { const result = await serial(observe); schedule(); return result; }
        catch (error) { await close('startup-observation-failed'); throw error; }
    }
    function command(input) {
        return serial(async () => {
            if (closed || closing) throw Error('Client worker stopped');
            if (input.operation === 'observe') return observe();
            if (input.operation === 'stop') return managed.stop({ actionId: input.actionId, reason: 'explicit-owned-endpoint-stop' });
            if (input.operation !== 'startOrResume') throw Error('Unknown client worker operation');
            const observation = await observe();
            if (observation.stopClaiming) throw Error('Client worker is closing or draining');
            const request = { ...input.request };
            if (!request.nativeGoal) {
                const value = { schema: 'night-client-watcher/v1', identity, pid: process.pid, actionId: request.actionId, deadlineAt: request.deadlineAt, heartbeatAt: new Date(now()).toISOString(), runDirectory: root };
                request.watcherReference = path.join(directory, `client-watcher-${crypto.randomUUID()}.json`); persist(request.watcherReference, value); watchers.set(request.actionId, value);
            }
            return managed.startOrResume(request);
        });
    }
    async function shutdownAdapter() {
        let timer;
        try { return await Promise.race([Promise.resolve().then(() => adapter.shutdown ? adapter.shutdown() : adapter.dispose?.()), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('client-transport-exit-unverified')), 10000); })]); }
        catch { return { localTransportClosed: false, endpointStopped: false, processCleanupVerified: false }; }
        finally { clearTimeout(timer); }
    }
    async function close(reason = 'worker-close') {
        if (closed) return lastObservation;
        if (closing) return queue;
        if (!acquired) { closed = true; await shutdownAdapter(); return null; }
        closing = true; clearTimeout(timer);
        return serial(async () => {
            const manifest = (seams.loadManifest || require('../agent-orchestrator').loadManifest)(root);
            const actions = manifest.actions.filter(a => a.result?.endpointId && a.result?.host);
            await managed.restore();
            for (const action of actions) try { await managed.stop({ actionId: action.id, reason }); } catch { /* Final observation retains unresolved endpoints. */ }
            try { await observe(); } finally {
                closed = true;
                const transport = await shutdownAdapter();
                if (lastObservation && transport) {
                    lastObservation.transport = { localTransportClosed: transport.localTransportClosed === true, processCleanupVerified: transport.processCleanupVerified === true, endpointStopped: false, forced: transport.forced === true };
                    persist(path.join(directory, 'client-worker-checkpoint.json'), { schema: 'night-client-worker-checkpoint/v1', identity, pid: process.pid, observedAt: new Date(now()).toISOString(), observation: lastObservation });
                }
                if (transport?.processCleanupVerified !== false && lastObservation && !lastObservation.unresolvedEndpoints.length && lastObservation.endpoints.every(e => e.stoppedVerified) && JSON.parse(fs.readFileSync(lease, 'utf8')).identity === identity) fs.unlinkSync(lease);
                onClosed(lastObservation);
            }
            return lastObservation;
        });
    }
    return { start, command, close, snapshot: () => ({ closed, closing, observation: lastObservation }) };
}
module.exports = { createClientWorker };
