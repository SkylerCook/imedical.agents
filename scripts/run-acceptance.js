#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { createTestExecutor } = require('./lib/playwright-runner');

async function runAcceptance(profile) {
    if (!Array.isArray(profile.cases) || !profile.cases.length) throw new Error('Nonempty cases required');
    const executor = createTestExecutor(profile.options);
    const results = [];
    let cleanup, executionError;
    try {
        for (const input of profile.cases) {
            const result = await executor.run(input);
            results.push(result);
            if (result.status !== 'passed') break; // Repair/reconcile before consuming more work.
        }
    } catch { executionError = 'executor-failed'; }
    finally { cleanup = await executor.stop(); }
    return { schema: 'imedical-acceptance-batch/v1', results, cleanup, ...(executionError ? { executionError } : {}),
        status: results.length === profile.cases.length && results.every(r => r.status === 'passed') && cleanup.cleanupVerified ? 'scope-passed' : 'review-pending' };
}

async function main(argv = process.argv.slice(2)) {
    if (argv.length !== 2 || argv[0] !== '--profile') throw new Error('Usage: run-acceptance.js --profile <project-owned module>');
    const profileModule = require(path.resolve(argv[1]));
    const profile = typeof profileModule === 'function' ? await profileModule() : profileModule;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try {
        const signal = profile.options.signal ? AbortSignal.any([profile.options.signal, controller.signal]) : controller.signal;
        const result = await runAcceptance({ ...profile, options: { ...profile.options, signal } });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result.status === 'scope-passed' ? 0 : 1;
    } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}

if (require.main === module) main().then(code => { process.exitCode = code; }, () => {
    process.stderr.write('Acceptance runner failed; inspect protected project diagnostics and reconcile unfinished operations.\n'); process.exitCode = 1;
});
module.exports = { runAcceptance, main };
