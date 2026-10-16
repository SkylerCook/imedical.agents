'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveWorkspaceContext } = require('./workspace-context');
const { loadManifest, recordNight } = require('../agent-orchestrator');
const contract = require('./night-contract');

function resolveBinding({ projectRoot = process.cwd(), runDirectory, workItemId }) {
    const context = resolveWorkspaceContext(projectRoot);
    const declared = context.manifest?.nightRunReference;
    const bound = declared ? path.resolve(context.workspaceRoot, declared) : null;
    if (!bound && !runDirectory) { if (workItemId) throw new Error('Work item requires a night run binding'); return null; }
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
        artifacts: (options.artifacts || []).map(file => ({ localPath: fs.realpathSync.native(file), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') })) };
      recordNight(binding.directory, { kind: 'operation-start', operation, rationale: 'Managed execution entry gate', evidenceRefs: [binding.context.manifestPath] }, binding.manifest.coordinatorId);
      return { ...binding, operation };
    }
    catch (error) {
        try { recordNight(binding.directory, { kind: 'operation-blocked', workItemId: binding.item.id, reasons: ['execution-entry-gate-failed'], rationale: 'Hold affected execution; no runtime authorization request', evidenceRefs: [binding.context.manifestPath] }, binding.manifest.coordinatorId); } catch { /* Preserve original gate failure; unresolved ownership remains in the run. */ }
        throw error;
    }
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

module.exports = { resolveBinding, begin, consumeTest, finish, preflight, preflightStart, reusableDeployment, fingerprint: contract.hash };
