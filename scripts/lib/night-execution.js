'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveWorkspaceContext } = require('./workspace-context');
const { loadManifest, recordNight } = require('../agent-orchestrator');
const contract = require('./night-contract');
const convergence = require('./night-convergence');

function resolveBinding({ projectRoot = process.cwd(), runDirectory, workItemId }) {
    const context = resolveWorkspaceContext(projectRoot);
    const declared = context.manifest?.nightRunReference;
    const bound = declared ? path.resolve(context.workspaceRoot, declared) : null;
    if (!bound && !runDirectory) {
        if (workItemId || fs.existsSync(path.join(projectRoot, '.agents', 'rules', 'night_run_plan.md'))) throw new Error('Managed PLAN requires its declared owner workspace and night run binding');
        return null;
    }
    const directory = path.resolve(runDirectory || bound);
    if (bound && contract.physical(bound) !== contract.physical(directory)) throw new Error('Night run binding mismatch');
    if (!workItemId) throw new Error('Night work item identity required');
    const manifest = loadManifest(directory);
    if (!contract.strict(manifest)) throw new Error('Managed night execution requires schema 2.1');
    const item = manifest.workItems.find(w => w.id === workItemId);
    const workspace = manifest.night.workspaces?.find(w => w.ownerId === item?.ownerId);
    if (!item || !workspace || contract.physical(workspace.plan.workspaceRoot) !== contract.physical(context.workspaceRoot)) throw new Error('Execution workspace differs from work owner');
    return { directory, manifest, item, context };
}

function begin(options) {
    const binding = resolveBinding(options);
    if (!binding) return null;
    try {
      if (options.phase === 'deployment' && (!binding.manifest.night.preflight?.deploymentConfigFingerprint || options.configurationFingerprint !== binding.manifest.night.preflight.deploymentConfigFingerprint)) throw new Error('Deployment configuration differs from preflight');
      const operation = { id: crypto.randomUUID(), phase: options.phase, workItemId: binding.item.id,
        environmentAlias: options.environmentAlias, ...(options.configurationFingerprint ? { configurationFingerprint: options.configurationFingerprint } : {}), ...(options.profileFingerprint ? { profileFingerprint: options.profileFingerprint } : {}),
        artifacts: (options.artifacts || []).map(input => { const file = typeof input === 'string' ? input : input.localPath; return { localPath: fs.realpathSync.native(file), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), ...(typeof input === 'object' && input.targetId ? { targetId: input.targetId } : {}) }; }) };
      recordNight(binding.directory, { kind: 'operation-start', operation, rationale: 'Managed execution entry gate', evidenceRefs: [binding.context.manifestPath] }, binding.manifest.coordinatorId);
      const latest = loadManifest(binding.directory);
      return { ...binding, manifest: latest, operation: latest.night.operations.find(o => o.id === operation.id) };
    }
    catch (error) {
        try { recordNight(binding.directory, { kind: 'operation-blocked', workItemId: binding.item.id, reasons: ['execution-entry-gate-failed'], rationale: 'Hold affected execution; no runtime authorization request', evidenceRefs: [binding.context.manifestPath] }, binding.manifest.coordinatorId); } catch { /* Preserve original gate failure; unresolved ownership remains in the run. */ }
        throw error;
    }
}

// Keep target naming and repository authorization on the original path while
// transports read immutable bytes from the managed run's frozen material.
function frozenArtifact(binding, originalPath) {
    const sourcePath = path.resolve(originalPath);
    if (!binding) return { path: fs.realpathSync.native(sourcePath), sourcePath };
    const record = binding.manifest.night.demands.find(d => d.id === binding.item.night.demandId);
    if (!record.sourceSnapshot) return { path: fs.realpathSync.native(sourcePath), sourcePath };
    const integration = require('./night-integration');
    integration.frozenSources(record);
    const root = contract.repositoryRoot(binding.manifest, binding.item), relative = path.relative(root, sourcePath).replace(/\\/g, '/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Transport source escaped its owner repository');
    const entry = record.sourceSnapshot.files.find(f => f.relative === relative && integration.logicalSourceMatches(root, f.repoRoot));
    if (!entry) throw new Error('Transport source is outside frozen material');
    return { path: path.join(record.sourceSnapshot.root, entry.artifact), sourcePath, sha256: entry.sha256 };
}

function save(binding, label, result) {
    const directory = path.join(binding.directory, 'evidence', 'night-operations');
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${binding.operation.id}-${label}.json`);
    const bytes = JSON.stringify(result, null, 2) + '\n';
    try { fs.writeFileSync(file, bytes, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST' || fs.readFileSync(file, 'utf8') !== bytes) throw new Error('Conflicting evidence file; preserve original and reconcile'); }
    return file;
}

function consumeTest(binding, result) {
    if (!binding) return;
    result.binding = { operationId: binding.operation.id, workItemId: binding.item.id };
    const file = save(binding, crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex'), result);
    recordNight(binding.directory, { kind: 'test-result', id: result.demandId, resultFile: file, rationale: 'Actual managed case receipt', evidenceRefs: [file] }, binding.manifest.coordinatorId);
}

function checkpoint(binding) {
    if (!binding || !convergence.enabled(binding.manifest) && !binding.manifest.executionPlan) return;
    const manifest = loadManifest(binding.directory);
    const item = manifest.workItems.find(w => w.id === binding.item.id);
    const decision = require('./night-dispatch').gateNight(manifest, item);
    const op = manifest.night.operations.find(o => o.id === binding.operation.id);
    if (!decision.allowed || !op || op.status !== 'running' || Date.now() >= op.deadlineAt || convergence.enabled(manifest) && op.dependencyToken !== convergence.dependencyToken(manifest, item.night.demandId)) throw Object.assign(new Error('Night execution checkpoint blocked'), { code: 'night-checkpoint-blocked' });
    binding.manifest = manifest;
}

// Bound one existing transport call. A deadline does not cancel a remote write;
// the caller must preserve its unknown result and close/reconcile the transport.
function boundAdapter(binding, adapter) {
    if (!binding || !convergence.enabled(binding.manifest) && !binding.manifest.executionPlan) return adapter;
    return new Proxy(adapter, { get(target, key) {
        const value = target[key];
        if (typeof value !== 'function') return value;
        if (key === 'close') return value.bind(target);
        return async (...args) => {
            const remaining = binding.operation.deadlineAt - Date.now();
            if (remaining <= 0) throw new Error('Night operation deadline exhausted');
            checkpoint(binding);
            let timer;
            try { return await Promise.race([Promise.resolve().then(() => value.apply(target, args)), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Night transport deadline; reconcile outcome')), Math.min(remaining, 2147483647)); })]); }
            finally { clearTimeout(timer); }
        };
    } });
}

function finish(binding, result) {
    if (!binding) return;
    const file = save(binding, 'result', result);
    recordNight(binding.directory, { kind: 'operation-result', operationId: binding.operation.id, result, rationale: 'Actual managed operation completion', evidenceRefs: [file] }, binding.manifest.coordinatorId);
}

function preflight(runDirectory, receipt, evidenceFile) {
    const manifest = loadManifest(runDirectory);
    return recordNight(runDirectory, { kind: 'preflight', receipt, rationale: 'Project-owned bounded readiness probe', evidenceRefs: [evidenceFile] }, manifest.coordinatorId);
}
function preflightStart(runDirectory, profileFile) {
    const manifest = loadManifest(runDirectory);
    recordNight(runDirectory, { kind: 'preflight-start', rationale: 'Invalidate old readiness before actual probe', evidenceRefs: [profileFile] }, manifest.coordinatorId);
}

function reusableDeployment(binding) {
    if (!binding) return null;
    return binding.manifest.night.operations?.find(op => op.phase === 'deployment' && op.status === 'verified' && op.configurationFingerprint === binding.operation.configurationFingerprint && op.environmentAlias === binding.operation.environmentAlias && contract.hash(op.artifacts) === contract.hash(binding.operation.artifacts)) || null;
}

module.exports = { resolveBinding, frozenArtifact, begin, checkpoint, boundAdapter, consumeTest, finish, preflight, preflightStart, reusableDeployment, fingerprint: contract.hash };
