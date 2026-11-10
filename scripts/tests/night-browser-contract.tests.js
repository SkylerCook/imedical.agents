'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const contract = require('../lib/night-contract');
const { currentSources, updateNight, nightCompletionIssues } = require('../lib/night-dispatch');
const { normalizePolicy } = require('../lib/night-policy');
const { createAcceptanceWorker } = require('../lib/acceptance-worker');
const { createTestSession } = require('../lib/test-session');
const { createTestExecutor } = require('../lib/playwright-runner');
const { runAcceptance } = require('../run-acceptance');
const evidence = { rationale: 'Synthetic managed resource evidence', evidenceRefs: ['synthetic:resource'] };
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(t, { tamperCase, tamperBatch } = {}) {
    const root = require('./fixtures/temp-directory').createTempDirectory('night-browser-contract-'); let worker;
    t.after(async () => { await worker?.stop(); fs.rmSync(root, { recursive: true, force: true }); });
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', windowsHide: true });
    git('init', '-q'); git('config', 'core.autocrlf', 'false'); fs.writeFileSync(path.join(root, 'source.js'), 'module.exports=1;\n'); git('add', 'source.js'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    const profileFile = path.join(root, 'profile.cjs'); fs.writeFileSync(profileFile, 'module.exports={};\n');
    const deadlineAt = Date.now() + 30000, sourceScopes = [{ repoRoot: root, scopes: ['source.js'] }], frozen = currentSources({ sourceScopes });
    const item = { id: 'verify', ownerId: 'tester', repositoryRoot: root, writeScopes: [], readScopes: ['source.js'], status: 'running', attempts: [], night: { demandId: 'one', phase: 'verification', role: 'reader', route: 'external-api', environmentAlias: 'isolated-test', effects: 'read-only', authentication: { mode: 'adapter-session', identity: 'synthetic-reader' } } };
    const record = { id: 'one', implementationOwnerId: 'tester', ...frozen, sourceScopes, assessment: { post: { route: 'external-api' } }, results: { knownDefect: false, unknownWrite: false }, resources: { pending: false, polluted: false }, timingSegments: [], failures: [], testReceipts: [], candidateReady: false };
    const manifest = { schemaVersion: '2.1', repositoryRoot: root, coordinatorId: 'leader', participants: [{ id: 'leader' }, { id: 'tester' }], actions: [], orchestration: { mode: 'serial', planHash: 'synthetic-plan' }, authorizations: {}, workItems: [item], night: { interactionMode: 'preflight-only', policy: normalizePolicy(), authorizationReferences: {}, requiredCapabilities: [], limits: { stopAt: new Date(deadlineAt + 1000).toISOString() }, workspaces: [{ ownerId: 'tester', plan: { workspaceRoot: root, repositories: [{ target: root }] } }], demands: [record], shared: { timingSegments: [], reassessments: [] }, humanReassessments: [] } };
    let checks = 0, executed = 0;
    const options = { projectRoot: root, deadlineAt, timeoutMs: 1000, closeTimeoutMs: 100, environmentAlias: 'isolated-test', authentication: { mode: 'adapter-session', identity: 'synthetic-reader' }, createSession: () => createTestSession({ adapter: { check: async () => { checks++; return { status: 'valid' }; } }, policy: { deadlineAt } }) };
    const caseSpec = { demandId: 'one', caseId: 'actual-api', role: 'reader', level: 'external-api', entry: 'synthetic-method', effects: 'read-only', scope: ['source.js'], createAdapter: () => ({ prepare: async () => true, verifyVersion: async value => value === frozen.frozenVersion, execute: async () => { executed++; }, assert: async () => [{ id: 'actual', passed: true, evidenceRefs: ['synthetic:actual'] }], sideEffects: async () => true, close: async () => true }) };
    const profile = { options, cases: [caseSpec], preflight: async ({ executor }) => { await executor.prepareOwner(caseSpec); return { environmentAlias: 'isolated-test', authorizations: [], checks: ['authentication', 'role', 'entry', 'exit'].map(id => ({ id, role: 'reader', status: 'passed', nonInteractive: true, evidenceRef: 'synthetic:actual-probe' })) }; } };
    const lifecycle = {
        begin(execution) { const operation = { id: crypto.randomUUID(), phase: 'verification', workItemId: item.id, environmentAlias: execution.environmentAlias, profileFingerprint: execution.profileFingerprint, artifacts: [] }; contract.operationRecord(manifest, { kind: 'operation-start', operation }, currentSources, () => ({ allowed: !contract.readinessReasons(manifest, item).length })); return { manifest, item, operation: manifest.night.operations.at(-1), context: { workspaceRoot: root } }; },
        checkpoint() {},
        consumeTest(binding, result) { result.binding = { operationId: binding.operation.id, workItemId: item.id }; tamperCase?.(result, manifest); const resultFile = path.join(root, `${binding.operation.id}-case.json`); fs.writeFileSync(resultFile, JSON.stringify(result)); updateNight(manifest, { ...evidence, kind: 'test-result', id: 'one', resultFile }, 'leader'); },
        finish(binding, result) { tamperBatch?.(result, manifest); contract.operationRecord(manifest, { ...evidence, kind: 'operation-result', operationId: binding.operation.id, result }, currentSources); },
        preflightStart() {}, preflight(_, receipt) { contract.recordPreflight(manifest, receipt); return manifest.night; }
    };
    worker = createAcceptanceWorker({ profile, profileFile, runDirectory: root, managed: lifecycle, loadManifest: () => manifest, recordOwnerExit: receipt => updateNight(manifest, { ...evidence, kind: 'browser-owner-exit', receipt, evidenceRefs: [receipt.evidenceRef] }, 'leader') });
    const request = (operation, extra = {}) => worker.request({ id: crypto.randomUUID(), operation, deadlineAt: Date.now() + 5000, ...extra });
    return { root, manifest, item, record, profile, worker, request, lifecycle, counters: () => ({ checks, executed }) };
}
test('actual managed preflight v2 and API/session verification consume evidence, retain owner, then gate on real exit receipt', async t => {
    const f = fixture(t), preflight = await f.request('preflight'); assert.equal(preflight.result.state, 'ready', JSON.stringify(preflight)); assert.equal(preflight.result.cleanupVerified, false);
    const result = await f.request('verify', { workItemId: 'verify', environmentAlias: 'isolated-test' }); assert.equal(result.result.status, 'scope-passed', JSON.stringify(result)); assert.equal(f.manifest.night.operations[0].status, 'verified'); assert.equal(f.record.testReceipts.length, 1); assert.deepEqual(f.counters(), { checks: 2, executed: 1 });
    assert.equal(f.record.resources.pending, false); assert(nightCompletionIssues(f.manifest).includes('browser-owner-exit-pending'));
    const stop = await f.request('stop'); assert.equal(stop.result.cleanupVerified, true); assert.deepEqual(contract.retainedOwnerIssues(f.manifest), []); assert.equal(f.manifest.night.browserOwners.length, 1); assert.equal(f.manifest.night.browserOwnerExits.length, 1);
});
test('spoofed owner, wrong worker, and cleanupVerified shortcut cannot pass a managed owner operation', async t => {
    for (const variant of ['unknown-owner', 'wrong-role', 'wrong-worker', 'wrong-pid', 'shortcut']) {
        const f = fixture(t, { tamperCase: variant === 'unknown-owner' ? result => { result.acceptance.ownerRef = 'f'.repeat(64); } : undefined,
            tamperBatch: (batch, manifest) => { if (variant === 'wrong-worker') batch.cleanup.workerRef = 'other-worker'; if (variant === 'wrong-pid') batch.cleanup.workerPid++; if (variant === 'shortcut') batch.cleanup = { cleanupVerified: true, pendingOperations: 0 }; if (variant === 'wrong-role') manifest.night.preflight.retainedOwners[0].role = 'other-role'; } });
        await f.request('preflight'); const result = await f.request('verify', { workItemId: 'verify', environmentAlias: 'isolated-test' }); assert.equal(result.status, 'completed'); assert.equal(f.manifest.night.operations[0].status, 'review-pending', variant); assert.equal(f.record.resources.pending, true);
    }
});
test('preflight replacement cannot drop live old owners and exit ledger survives later preflights', async t => {
    const f = fixture(t); await f.request('preflight'); const old = structuredClone(f.manifest.night.preflight);
    assert.throws(() => contract.recordPreflight(f.manifest, { ...old, workerPid: old.workerPid + 1 }), /must exit/);
    const replacement = { ...old, workerRef: 'new-worker', retainedOwners: [], cleanupVerified: true, resourceDisposition: { temporaryResourcesExited: true, retainedOwnersControllable: true, pendingOperations: 0, retainedOwnerCount: 0 } };
    assert.throws(() => contract.recordPreflight(f.manifest, replacement), /must exit/); assert.equal(f.manifest.night.preflight.workerRef, old.workerRef);
    await f.request('stop'); contract.recordPreflight(f.manifest, replacement); assert.equal(f.manifest.night.preflight.workerRef, 'new-worker'); assert.equal(f.manifest.night.browserOwners.length, 1); assert.deepEqual(contract.retainedOwnerIssues(f.manifest), []);
    const receipt = f.manifest.night.browserOwnerExits[0]; contract.browserOwnerExit(f.manifest, { receipt, evidenceRefs: [receipt.evidenceRef] }); assert.equal(f.manifest.night.browserOwnerExits.length, 1);
});
test('exit receipts require actual file equality; pending failure may later reconcile with a new immutable success receipt', async t => {
    const f = fixture(t); await f.request('preflight');
    const p = f.manifest.night.preflight, owner = p.retainedOwners[0], evidenceRef = path.join(f.root, 'manual-exit.json');
    const receipt = { schema: 'imedical-browser-owner-exit/v1', ownerRef: owner.ownerRef, workerRef: p.workerRef, workerPid: p.workerPid, cleanupVerified: false, pendingOperations: 1, checkedAt: new Date().toISOString(), evidenceRef };
    fs.writeFileSync(evidenceRef, JSON.stringify(receipt)); contract.browserOwnerExit(f.manifest, { receipt, evidenceRefs: [evidenceRef] });
    assert.equal(contract.retainedOwnerIssues(f.manifest).length, 1); const forged = { ...receipt, cleanupVerified: true, pendingOperations: 0 }; assert.throws(() => contract.browserOwnerExit(f.manifest, { receipt: forged, evidenceRefs: [evidenceRef] }), /differs/);
    const stopped = await f.request('stop'); assert.equal(stopped.result.cleanupVerified, true); assert.equal(f.manifest.night.browserOwnerExits.length, 2); assert.deepEqual(contract.retainedOwnerIssues(f.manifest), []);
});
test('API work item route takes precedence over another tester UI review; required UI without owner remains blocked', async t => {
    const f = fixture(t); await f.request('preflight'); f.record.assessment.post.route = 'ui';
    assert.deepEqual(contract.readinessReasons(f.manifest, f.item), []);
    delete f.item.night.route; f.item.night.authentication = { mode: 'browser-session' };
    assert(contract.readinessReasons(f.manifest, f.item).includes('browser-owner-unavailable'));
});
test('execution PLAN routes the same demand to distinct tester levels and enforces each minimum case scope', async t => {
    const f = fixture(t); f.manifest.createdAt = new Date().toISOString(); f.manifest.executionPlan = { version: 1, budget: { timeMinutes: 1 }, minimumTests: [{ id: 'actual-api', demandId: 'one', ownerId: 'tester', level: 'external-api', scope: ['source.js'] }, { id: 'ui-case', demandId: 'one', ownerId: 'ui-tester', level: 'ui', scope: ['visible'] }] };
    f.profile.cases.push({ ...f.profile.cases[0], caseId: 'ui-case', level: 'ui', role: 'browser', scope: ['visible'], createAdapter: () => { throw Error('other tester case must not execute'); } });
    // This test isolates profile routing; PLAN client capability checks are covered separately.
    f.profile.preflight = async ({ executor }) => { await executor.prepareOwner(f.profile.cases[0]); return { environmentAlias: 'isolated-test', authorizations: [], checks: ['authentication', 'role', 'entry', 'exit', 'client-lifecycle', 'client-stop', 'client-usage', 'automation-inventory'].map(id => ({ id, role: 'reader', status: 'passed', nonInteractive: true, evidenceRef: 'synthetic:actual-probe' })) }; };
    await f.request('preflight');
    const result = await f.request('verify', { workItemId: 'verify', environmentAlias: 'isolated-test' }); assert.equal(result.result.results.length, 1); assert.equal(result.result.results[0].acceptance.level, 'external-api');
    f.profile.cases[0].scope = ['source.js', 'outside'];
    const noManaged = { begin: () => ({ manifest: f.manifest, item: f.item }), finish() {} };
    await assert.rejects(runAcceptance(f.profile, { managed: noManaged }), /minimumTests/);
});
test('stateless backend preflight has no retained browser/session resources', async t => {
    const f = fixture(t), executor = createTestExecutor({ projectRoot: f.root, deadlineAt: Date.now() + 1000 });
    t.after(() => executor.stop()); await executor.prepareOwner({ role: 'reader', level: 'internal-method' }); const state = await executor.checkpoint(); assert.equal(state.cleanupVerified, true); assert.equal(state.retainedOwnerCount, 0);
});
