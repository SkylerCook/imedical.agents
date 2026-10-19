#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createTestExecutor } = require('./lib/playwright-runner');
const managed = require('./lib/night-execution');
const { currentSources } = require('./lib/night-dispatch');
const { loadManifest } = require('./agent-orchestrator');
const convergence = require('./lib/night-convergence');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function workCases(profile, manifest, item) {
    const candidates = profile.cases?.filter(c => c.demandId === item.night.demandId) || [];
    if (manifest.executionPlan?.version !== 1) return candidates;
    const post = manifest.night.demands.find(d => d.id === item.night.demandId)?.assessment?.post;
    const route = item.night.route || (post?.route === 'static-review' ? post.auditRoute : post?.route);
    const cases = candidates.filter(c => c.role === item.night.role && c.level === route);
    const minimum = manifest.executionPlan.minimumTests.filter(test => test.demandId === item.night.demandId && test.ownerId === item.ownerId && test.level === route);
    if (!minimum.length || minimum.some(test => !cases.some(c => c.caseId === test.id)) || new Set(cases.map(c => c.caseId)).size !== cases.length || cases.some(c => {
        const planned = minimum.find(test => test.id === c.caseId);
        return !planned || !Array.isArray(c.scope) || c.scope.length !== planned.scope.length || [...c.scope].sort().some((scope, index) => scope !== [...planned.scope].sort()[index]);
    })) throw new Error('Acceptance cases differ from owner minimumTests identity/scope');
    return cases;
}
async function runAcceptance(profile, execution = {}) {
    if (!Array.isArray(profile.cases) || !profile.cases.length) throw new Error('Nonempty cases required');
    const lifecycle = execution.managed || managed;
    const binding = lifecycle.begin({ projectRoot: execution.workspaceRoot || profile.options.projectRoot || process.cwd(), ...execution, phase: 'verification', artifacts: [] });
    let cases;
    try { cases = binding ? workCases(profile, binding.manifest, binding.item) : profile.cases; }
    catch (error) { lifecycle.finish(binding, { status: 'review-pending', failureCategory: 'gate' }); throw error; }
    if (!cases.length) { lifecycle.finish(binding, { status: 'review-pending' }); throw new Error('No cases for work item demand'); }
    let executor = execution.executor, cleanup, executionError, failureStage;
    const results = [];
    try {
        if (binding && path.relative(fs.realpathSync.native(profile.options.projectRoot), fs.realpathSync.native(binding.context.workspaceRoot)) !== '') throw new Error('Acceptance profile root differs from work owner');
        executor ||= createTestExecutor(profile.options);
        const deadlineAt = Math.min(profile.options.deadlineAt, execution.deadlineAt ?? Infinity, binding ? Date.parse(binding.manifest.night.limits.stopAt) : Infinity, binding?.operation.deadlineAt ?? Infinity);
        for (const original of cases) {
            lifecycle.checkpoint(binding);
            let input = original;
            if (binding) {
                const record = binding.manifest.night.demands.find(d => d.id === binding.item.night.demandId);
                const route = binding.manifest.executionPlan?.version === 1 && binding.item.night.route || (record.assessment.post.route === 'static-review' ? record.assessment.post.auditRoute : record.assessment.post.route);
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
            const result = await executor.run(input, { deadlineAt, signal: execution.signal, environmentAlias: execution.environmentAlias, allowedOwnerRefs: execution.allowedOwnerRefs });
            if (binding) result.sourceBindings = currentSources(binding.manifest.night.demands.find(d => d.id === input.demandId)).sources;
            results.push(result);
            lifecycle.consumeTest(binding, result);
            if (result.status !== 'passed') break;
        }
    } catch (error) { executionError = error.code === 'night-checkpoint-blocked' ? 'checkpoint-blocked' : 'executor-failed'; failureStage = safeStage(error.stage); }
    finally { cleanup = executor ? await (execution.executor ? executor.checkpoint() : executor.stop()) : { cleanupVerified: true, pendingOperations: 0 }; }
    if (execution.workerRef) { cleanup.workerRef = execution.workerRef; cleanup.workerPid = process.pid; }
    const cleaned = cleanup.cleanupVerified === true || execution.executor && cleanup.temporaryResourcesExited === true && cleanup.retainedOwnersControllable === true && cleanup.pendingOperations === 0;
    const result = { schema: 'imedical-acceptance-batch/v1', results, cleanup, ...(executionError ? { executionError, failureStage } : {}), status: !executionError && results.length === cases.length && results.every(r => r.status === 'passed') && cleaned ? 'scope-passed' : 'review-pending' };
    lifecycle.finish(binding, { ...result, ...(executionError ? { failureCategory: executionError === 'checkpoint-blocked' ? 'gate' : failureStage === 'authentication' ? 'authentication' : 'execution-unknown' } : {}) });
    return result;
}
function safeStage(stage) { return ['entry', 'authentication', 'browser-start', 'context-start', 'adapter-create', 'target', 'prepare', 'verifyVersion', 'execute', 'assert', 'sideEffects', 'observation-review', 'case-cleanup', 'context-close', 'browser-close', 'preflight', 'configuration'].includes(stage) ? stage : 'operation'; }
async function runPreflight(profile, profileFile, runDirectory, execution = {}) {
    if (!runDirectory || typeof profile.preflight !== 'function') throw new Error('Night preflight requires --run-directory and project preflight adapter');
    const lifecycle = execution.managed || managed;
    lifecycle.preflightStart(path.resolve(runDirectory), path.resolve(profileFile));
    const manifest = (execution.loadManifest || loadManifest)(path.resolve(runDirectory));
    for (const item of manifest.workItems.filter(w => w.night.phase === 'verification' && w.status !== 'skipped')) {
        const cases = workCases(profile, manifest, item);
        if (!cases?.length || cases.some(c => !['read-only', 'write'].includes(c.effects) || c.role !== item.night.role || c.effects === 'write' && (item.night.effects !== 'write' || c.dataPolicy !== item.night.dataPolicy))) throw new Error('Preflight profile cases differ from planned roles/effects/data policy');
        const post = manifest.night.demands.find(d => d.id === item.night.demandId)?.assessment?.post;
        if (cases.some(c => c.level === 'ui') && item.night.route !== 'ui' && post?.route !== 'ui' && post?.auditRoute !== 'ui') throw new Error('UI cases must declare the planned UI route before preflight');
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, ...[profile.options?.signal, execution.signal].filter(Boolean)]);
    const limit = Math.min(profile.options?.timeoutMs || 30000, (profile.options?.deadlineAt || 0) - Date.now(), (execution.deadlineAt ?? Infinity) - Date.now());
    if (!Number.isFinite(limit) || limit <= 0 || limit > 2147483647) throw new Error('Future bounded preflight deadline required');
    const startedAt = new Date().toISOString();
    const files = [...new Set([path.resolve(profileFile), ...(profile.options.configurationFiles || []).map(f => path.resolve(f))])];
    const configurationFiles = files.map(file => ({ path: fs.realpathSync.native(file), sha256: digest(file) }));
    let timer;
    const operation = Promise.resolve().then(() => profile.preflight({ signal, createTestExecutor, ...(execution.executor ? { executor: execution.executor } : {}) }));
    execution.observeOperation?.(operation);
    const data = await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('preflight-timeout; reconcile project probe resources'), { stage: 'preflight' })); }, limit); })]).finally(() => clearTimeout(timer));
    const disposition = execution.executor ? await execution.executor.checkpoint() : null;
    if (disposition ? disposition.temporaryResourcesExited !== true || disposition.retainedOwnersControllable !== true || disposition.pendingOperations !== 0 : data.cleanupVerified !== true) throw new Error('Preflight resource disposition unverified');
    if (configurationFiles.some(f => digest(f.path) !== f.sha256)) throw new Error('Configuration changed during preflight; repeat before execution');
    const receipt = { ...data, schema: execution.executor ? 'imedical-night-preflight/v2' : 'imedical-night-preflight/v1', startedAt, checkedAt: new Date().toISOString(), profileFingerprint: digest(profileFile), configurationFiles, configFingerprint: crypto.createHash('sha256').update(JSON.stringify(configurationFiles)).digest('hex'),
        ...(disposition ? { cleanupVerified: disposition.cleanupVerified, resourceDisposition: disposition, retainedOwners: execution.executor.snapshot().retainedOwners, workerRef: execution.workerRef, workerPid: process.pid } : {}) };
    const directory = path.resolve(runDirectory, 'evidence', 'night-operations');
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `preflight-${crypto.randomUUID()}.json`);
    fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
    const night = lifecycle.preflight(path.resolve(runDirectory), receipt, file);
    return { ...receipt, state: night.preflight.state, issues: night.preflight.issues, evidenceFile: file };
}
async function main(argv = process.argv.slice(2)) {
    const args = {}, keys = { '--profile': 'profile', '--run-directory': 'runDirectory', '--work-item': 'workItemId', '--environment-alias': 'environmentAlias' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--preflight') args.preflight = true;
        else if (argv[i] === '--worker') args.worker = true;
        else if (keys[argv[i]] && argv[i + 1] && !argv[i + 1].startsWith('--')) { const key = keys[argv[i]]; args[key] = argv[++i]; }
        else throw new Error('Unsupported acceptance argument');
    }
    if (!args.profile) throw new Error('Usage: run-acceptance.js --profile <project module> [--preflight --run-directory <run>] [--work-item <id> --environment-alias <alias>]');
    const file = path.resolve(args.profile), profileModule = require(file);
    const context = args.preflight || args.worker ? { manifest: loadManifest(path.resolve(args.runDirectory)) } : managed.resolveBinding({ projectRoot: process.cwd(), ...args });
    const profile = typeof profileModule === 'function' ? await profileModule({ night: context?.manifest.night, workItem: context?.item }) : profileModule;
    const controller = new AbortController(), cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try {
        const signal = profile.options.signal ? AbortSignal.any([profile.options.signal, controller.signal]) : controller.signal;
        const prepared = { ...profile, options: { ...profile.options, signal } };
        if (args.worker) {
            const { createAcceptanceWorker, serveAcceptanceWorker } = require('./lib/acceptance-worker');
            return await serveAcceptanceWorker(createAcceptanceWorker({ profile: prepared, profileFile: file, runDirectory: args.runDirectory }), process.stdin, process.stdout);
        }
        const result = args.preflight ? await runPreflight(prepared, file, args.runDirectory) : await runAcceptance(prepared, { ...args, profileFingerprint: digest(file) });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result.status === 'scope-passed' || result.state === 'ready' ? 0 : 1;
    } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (require.main === module) main().then(code => { process.exitCode = code; }, () => { process.stderr.write('Acceptance runner failed; inspect protected project diagnostics and reconcile unfinished operations.\n'); process.exitCode = 1; });
module.exports = { runAcceptance, runPreflight, main, safeStage, createAcceptanceWorker: options => require('./lib/acceptance-worker').createAcceptanceWorker(options) };
