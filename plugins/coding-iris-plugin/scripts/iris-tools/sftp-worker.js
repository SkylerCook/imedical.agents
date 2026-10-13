'use strict';
const {spawn} = require('node:child_process');
const {performance} = require('node:perf_hooks');

function createSession(command, workerPath, env, {timeoutMs = 60000, spawnProcess = spawn,
    progress = event => process.stderr.write(JSON.stringify({type: 'deploy-progress', ...event}) + '\n')} = {}) {
    let child, pending, timer, closed, resolveClosed, failed = false, closing = false, exited = false, sequence = 0, buffer = '', started;
    const stats = {processes: 0, startupMs: 0, timings: {}, counts: {}, cleanupPending: []};
    const files = new Map(), temporary = new Set();
    let activeIndex = -1;
    const stages = new Set(['local-check', 'connect', 'compare', 'before-upload', 'before-replace', 'upload', 'temporary-verify', 'final-verify']);
    function fail() {
        failed = true;
        clearTimeout(timer);
        if (pending) {
            const error = new Error('SFTP worker unavailable; inspect remote state before retrying');
            error.fileResults = new Map(files);
            error.activeIndex = activeIndex;
            error.transport = {...stats, cleanupPending: [...temporary]};
            pending.reject(error);
            pending = null;
        }
        if (!exited) child?.kill();
    }
    function receive(message) {
        if (message.type === 'ready' && pending?.starting) {
            stats.startupMs = Math.round(performance.now() - started);
            pending.starting = false;
            progress({stage: 'worker-start', state: 'end', elapsedMs: stats.startupMs});
            child.stdin.write(JSON.stringify(pending.payload) + '\n');
            return;
        }
        if (!pending) return fail();
        if (message.type === 'progress' && stages.has(message.stage) && ['start', 'end'].includes(message.state)) {
            if (message.transport) Object.assign(stats, message.transport);
            activeIndex = message.fileIndex - 1;
            progress({fileIndex: message.fileIndex, total: message.total, stage: message.stage, state: message.state,
                ...(Number.isFinite(message.elapsedMs) ? {elapsedMs: message.elapsedMs} : {})});
            return;
        }
        if (message.type === 'temporary' && typeof message.path === 'string' && typeof message.owned === 'boolean') {
            if (message.owned) temporary.add(message.path); else temporary.delete(message.path);
            stats.cleanupPending = [...temporary];
            return;
        }
        if (message.type === 'file-result' && Number.isInteger(message.index)) {
            files.set(message.index, message.result);
            return;
        }
        if (message.type !== 'result' || message.id !== pending.payload.id || typeof message.status !== 'string') return fail();
        if (message.transport) Object.assign(stats, message.transport);
        clearTimeout(timer);
        const request = pending;
        pending = null;
        if (message.status !== 'verified') failed = true;
        request.resolve(message);
    }
    function start() {
        started = performance.now();
        stats.processes++;
        closed = new Promise(resolve => { resolveClosed = resolve; });
        child = spawnProcess(command, ['-B', workerPath, '--session'], {
            env: {...process.env, ...env}, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
        });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            if (failed) return;
            buffer += chunk;
            if (Buffer.byteLength(buffer) > 24 * 1024 * 1024) return fail();
            let end;
            while ((end = buffer.indexOf('\n')) >= 0 && !failed) {
                const line = buffer.slice(0, end);
                buffer = buffer.slice(end + 1);
                try { receive(JSON.parse(line)); } catch { fail(); }
            }
        });
        child.stderr.resume(); // Never relay third-party connection diagnostics.
        child.stdin.on('error', fail);
        child.on('error', fail);
        child.on('close', () => {
            exited = true;
            if (!closing || pending) fail();
            clearTimeout(timer);
            resolveClosed();
        });
    }
    return {
        stats,
        request(payload) {
            if (failed || closing || pending) return Promise.reject(new Error('SFTP session unavailable or busy'));
            return new Promise((resolve, reject) => {
                pending = {payload: {...payload, id: ++sequence}, resolve, reject, starting: !child};
                timer = setTimeout(fail, timeoutMs);
                if (!child) {
                    try { start(); } catch { fail(); resolveClosed?.(); }
                } else child.stdin.write(JSON.stringify(pending.payload) + '\n');
            });
        },
        async close() {
            closing = true;
            if (!child || exited) return;
            if (pending) fail();
            child.stdin.end();
            const deadline = setTimeout(() => child.kill(), 3000);
            try { await closed; } finally { clearTimeout(deadline); }
        }
    };
}

function verifiedPut(evidence, file, hash) {
    if (evidence === undefined) return false;
    if (evidence.status !== 'verified' || evidence.verification !== 'final-target-sha256' ||
        evidence.remotePath !== file.remotePath || evidence.sha256 !== hash(file.bytes)) {
        throw new Error('Invalid final target verification');
    }
    return true;
}

module.exports = {createSession, verifiedPut};
