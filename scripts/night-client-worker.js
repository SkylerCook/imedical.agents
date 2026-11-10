#!/usr/bin/env node
'use strict';
const path = require('node:path'), readline = require('node:readline');
const { createClientAdapter } = require('./lib/night-client');
const { createClientWorker } = require('./lib/night-client-worker');
const { diagnosticFields } = require('./lib/night-client-diagnostics');
async function main(argv = process.argv.slice(2), { adapter, input = process.stdin, output = process.stdout, workerOptions = {} } = {}) {
    const args = {};
    for (let i = 0; i < argv.length; i++) { const key = argv[i]; if (!['--run-directory', '--host', '--interval-ms'].includes(key) || !argv[i + 1] || args[key]) throw Error('Invalid client worker argument'); args[key] = argv[++i]; }
    if (!args['--run-directory']) throw Error('--run-directory required');
    let lines;
    const worker = createClientWorker({ ...workerOptions, runDirectory: path.resolve(args['--run-directory']), adapter: adapter || createClientAdapter({ host: args['--host'] || 'codex' }), intervalMs: args['--interval-ms'] ? Number(args['--interval-ms']) : 5000, onClosed: () => lines?.close() });
    let stopping;
    const stop = () => { stopping ||= worker.close('worker-input-ended-or-signal'); return stopping; };
    lines = readline.createInterface({ input, crlfDelay: Infinity });
    const iterator = lines[Symbol.asyncIterator]();
    const signal = () => { lines.close(); void stop(); };
    process.on('SIGINT', signal); process.on('SIGTERM', signal);
    try {
        const initial = await worker.start(); output.write(JSON.stringify({ operation: 'ready', observation: initial }) + '\n');
        for await (const line of iterator) {
            if (!line.trim()) continue;
            let value;
            try { if (Buffer.byteLength(line) > 1024 * 1024) throw Error('request-too-large'); value = JSON.parse(line); const result = await worker.command(value); output.write(JSON.stringify({ id: value.id || null, status: 'succeeded', result }) + '\n'); }
            catch (error) { output.write(JSON.stringify({ id: value?.id || null, status: 'blocked', category: 'client-worker-operation-unverified', ...diagnosticFields(error, 'command') }) + '\n'); }
        }
    } finally { lines.close(); await stop(); process.removeListener('SIGINT', signal); process.removeListener('SIGTERM', signal); }
    const result = worker.snapshot().observation;
    return result && !result.unresolvedEndpoints.length && result.endpoints.every(e => e.stoppedVerified) ? 0 : 1;
}
if (require.main === module) main().then(code => { process.exitCode = code; }, () => { process.stderr.write('Client supervision unavailable; reconcile the persisted run and owned endpoints.\n'); process.exitCode = 1; });
module.exports = { main };
