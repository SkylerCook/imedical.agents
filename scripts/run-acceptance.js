#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createTestExecutor } = require('./lib/playwright-runner');
const managed = require('./lib/night-execution');
const { currentSources } = require('./lib/night-dispatch');
const { loadManifest } = require('./agent-orchestrator');
const convergence = require('./lib/night-convergence');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function runAcceptance(profile, execution = {}) {
    if (!Array.isArray(profile.cases) || !profile.cases.length) throw new Error('Nonempty cases required');
    const binding = managed.begin({ projectRoot: execution.workspaceRoot || process.cwd(), ...execution, phase: 'verification', artifacts: [] });
    const cases = binding ? profile.cases.filter(c => c.demandId === binding.item.night.demandId) : profile.cases;
    if (!cases.length) { managed.finish(binding, { status: 'review-pending' }); throw new Error('No cases for work item demand'); }
    let executor, cleanup, executionError;
    const results = [];
    try {
        if (binding && path.relative(fs.realpathSync.native(profile.options.projectRoot), fs.realpathSync.native(binding.context.workspaceRoot)) !== '') throw new Error('Acceptance profile root differs from work owner');
        executor = createTestExecutor(binding ? { ...profile.options, deadlineAt: Math.min(profile.options.deadlineAt, Date.parse(binding.manifest.night.limits.stopAt), binding.operation.deadlineAt ?? Infinity) } : profile.options);
        for (const original of cases) {
            managed.checkpoint(binding);
            let input = original;
            if (binding) {
                const record = binding.manifest.night.demands.find(d => d.id === binding.item.night.demandId);
                const route = record.assessment.post.route === 'static-review' ? record.assessment.post.auditRoute : record.assessment.post.route;
                if (input.role !== binding.item.night.role || input.level !== route) throw new Error('Case role/entry level differs from preflight work item');
                if (!['read-only', 'write'].includes(input.effects) || input.effects === 'write' && (binding.item.night.effects !== 'write' || input.dataPolicy !== binding.item.night.dataPolicy)) throw new Error('Case effects/data policy differ from authorized work item');
                if (input.version && input.version !== record.frozenVersion) throw new Error('Case frozen version differs from work item');
                input = { ...input, strictData: true, version: record.frozenVersion };
                const dependencies = convergence.environmentBindings(binding.manifest, record.id);
                if (dependencies.length) {
                    const factory = input.createAdapter;
                    input.createAdapter = async context => {
                        const adapter = await factory(context), verifyVersion = adapter.verifyVersion;
                        if (typeof adapter.verifyDependencies !== 'function') throw new Error('Environment dependencies require actual version verification');
                        adapter.verifyVersion = async version => await verifyVersion.call(adapter, version) === true && await adapter.verifyDependencies(structuredClone(dependencies)) === true;
                        return adapter;
                    };
                }
            }
            const result = await executor.run(input);
            if (binding) result.sourceBindings = currentSources(binding.manifest.night.demands.find(d => d.id === input.demandId)).sources;
            results.push(result);
            managed.consumeTest(binding, result);
            if (result.status !== 'passed') break;
        }
    } catch (error) { executionError = error.code === 'night-checkpoint-blocked' ? 'checkpoint-blocked' : 'executor-failed'; }
    finally { cleanup = executor ? await executor.stop() : { cleanupVerified: true, pendingOperations: 0 }; }
    const result = { schema: 'imedical-acceptance-batch/v1', results, cleanup, ...(executionError ? { executionError } : {}), status: !executionError && results.length === cases.length && results.every(r => r.status === 'passed') && cleanup.cleanupVerified ? 'scope-passed' : 'review-pending' };
    managed.finish(binding, { ...result, ...(executionError ? { failureCategory: executionError === 'checkpoint-blocked' ? 'gate' : 'execution-unknown' } : {}) });
    return result;
}
async function runPreflight(profile, profileFile, runDirectory) {
    if (!runDirectory || typeof profile.preflight !== 'function') throw new Error('Night preflight requires --run-directory and project preflight adapter');
    managed.preflightStart(path.resolve(runDirectory), path.resolve(profileFile));
    const manifest = loadManifest(path.resolve(runDirectory));
    for (const item of manifest.workItems.filter(w => w.night.phase === 'verification' && w.status !== 'skipped')) {
        const cases = profile.cases?.filter(c => c.demandId === item.night.demandId);
        if (!cases?.length || cases.some(c => !['read-only', 'write'].includes(c.effects) || c.role !== item.night.role || c.effects === 'write' && (item.night.effects !== 'write' || c.dataPolicy !== item.night.dataPolicy))) throw new Error('Preflight profile cases differ from planned roles/effects/data policy');
        const post = manifest.night.demands.find(d => d.id === item.night.demandId)?.assessment?.post;
        if (cases.some(c => c.level === 'ui') && item.night.route !== 'ui' && post?.route !== 'ui' && post?.auditRoute !== 'ui') throw new Error('UI cases must declare the planned UI route before preflight');
    }
    const controller = new AbortController();
    const signal = profile.options?.signal ? AbortSignal.any([profile.options.signal, controller.signal]) : controller.signal;
    const limit = Math.min(profile.options?.timeoutMs || 30000, (profile.options?.deadlineAt || 0) - Date.now());
    if (!Number.isFinite(limit) || limit <= 0 || limit > 2147483647) throw new Error('Future bounded preflight deadline required');
    const startedAt = new Date().toISOString();
    const files = [...new Set([path.resolve(profileFile), ...(profile.options.configurationFiles || []).map(f => path.resolve(f))])];
    const configurationFiles = files.map(file => ({ path: fs.realpathSync.native(file), sha256: digest(file) }));
    let timer;
    const data = await Promise.race([Promise.resolve().then(() => profile.preflight({ signal, createTestExecutor })), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('preflight-timeout; reconcile project probe resources')); }, limit); })]).finally(() => clearTimeout(timer));
    if (data.cleanupVerified !== true) throw new Error('Preflight resource exit unverified');
    if (configurationFiles.some(f => digest(f.path) !== f.sha256)) throw new Error('Configuration changed during preflight; repeat before execution');
    const receipt = { ...data, schema: 'imedical-night-preflight/v1', startedAt, checkedAt: new Date().toISOString(), profileFingerprint: digest(profileFile), configurationFiles, configFingerprint: crypto.createHash('sha256').update(JSON.stringify(configurationFiles)).digest('hex') };
    const directory = path.resolve(runDirectory, 'evidence', 'night-operations');
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `preflight-${crypto.randomUUID()}.json`);
    fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
    const night = managed.preflight(path.resolve(runDirectory), receipt, file);
    return { ...receipt, state: night.preflight.state, issues: night.preflight.issues, evidenceFile: file };
}
async function main(argv = process.argv.slice(2)) {
    const args = {}, keys = { '--profile': 'profile', '--run-directory': 'runDirectory', '--work-item': 'workItemId', '--environment-alias': 'environmentAlias' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--preflight') args.preflight = true;
        else if (keys[argv[i]] && argv[i + 1] && !argv[i + 1].startsWith('--')) { const key = keys[argv[i]]; args[key] = argv[++i]; }
        else throw new Error('Unsupported acceptance argument');
    }
    if (!args.profile) throw new Error('Usage: run-acceptance.js --profile <project module> [--preflight --run-directory <run>] [--work-item <id> --environment-alias <alias>]');
    const file = path.resolve(args.profile), profileModule = require(file);
    const context = args.preflight ? { manifest: loadManifest(path.resolve(args.runDirectory)) } : managed.resolveBinding({ projectRoot: process.cwd(), ...args });
    const profile = typeof profileModule === 'function' ? await profileModule({ night: context?.manifest.night, workItem: context?.item }) : profileModule;
    const controller = new AbortController(), cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try {
        const signal = profile.options.signal ? AbortSignal.any([profile.options.signal, controller.signal]) : controller.signal;
        const prepared = { ...profile, options: { ...profile.options, signal } };
        const result = args.preflight ? await runPreflight(prepared, file, args.runDirectory) : await runAcceptance(prepared, { ...args, profileFingerprint: digest(file) });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result.status === 'scope-passed' || result.state === 'ready' ? 0 : 1;
    } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (require.main === module) main().then(code => { process.exitCode = code; }, () => { process.stderr.write('Acceptance runner failed; inspect protected project diagnostics and reconcile unfinished operations.\n'); process.exitCode = 1; });
module.exports = { runAcceptance, runPreflight, main };
