'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');
const here = fs.mkdtempSync(path.join(os.tmpdir(), 'night-policy-update-'));
test.after(() => {
    assert.equal(fs.lstatSync(here).isSymbolicLink(), false);
    assert.equal(path.dirname(fs.realpathSync(here)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(here, { recursive: true, force: true });
    assert.equal(fs.existsSync(here), false);
});
const originalPolicy = require('../lib/night-policy');
const dispatch = require('../lib/night-dispatch');
const orchestrator = require('../agent-orchestrator');
const contract = require('../lib/night-contract');
const policy = originalPolicy;
function fixture() {
    const policy = originalPolicy.normalizePolicy({ maxInFlight: 1 });
    const at = new Date(Date.now() - 3000).toISOString();
    const authorizations = Object.fromEntries(['collaborationPlan', 'remoteWrite', 'commit', 'merge', 'push', 'deploy', 'feedbackWrite'].map(category => [category, { state: 'not-granted', scopeHash: null, grantedAt: null, grantedBy: null }]));
    authorizations.commit = { state: 'granted', scopeHash: 'old-plan', grantedAt: at, grantedBy: 'preflight-reference', sourceReference: 'synthetic-existing-commit-reference' };
    return { schemaVersion: '2.1', runId: 'synthetic-policy-proposal', status: 'active', taskKind: 'other', coordinatorId: 'coordinator', createdAt: at, updatedAt: at,
        workflow: { id: 'standard-change', source: 'workflows/standard-change.workflow.md' }, executionPath: 'guarded', feedbackReviewPolicy: 'on-signal',
        orchestration: { mode: 'serial', adapter: 'serial', fallbacks: ['serial'], adapterCapabilities: { serial: true }, resultLifecycle: 'launch-result/v1', planHash: 'old-plan' },
        participants: [{ id: 'coordinator', role: 'coordinator', endpoint: { type: 'serial' }, worktree: { mode: 'none', ref: null }, readScopes: [], writeScopes: [] }],
        authorizations, workItems: [], actions: [], messages: [], acceptance: { status: 'not-applicable' }, maintenance: { status: 'not-applicable' }, feedbackDecision: { applicable: false, applicabilityReason: 'other', reviewState: 'not-eligible', decisions: [] },
        verification: { status: 'passed', lastMutationSequence: 1, verifiedThroughSequence: 1 }, eventLog: { path: 'events.jsonl', lastSequence: 1, projectionHash: '' },
        night: { batchId: 'synthetic-only', interactionMode: 'preflight-only', runReference: here, policy,
            limits: { stopAt: '2099-01-01T00:00:00Z', stopClaimingAt: '2099-01-01T00:00:00Z', stopPublishingAt: '2099-01-01T00:00:00Z' },
            authorizationReferences: { commit: 'synthetic-existing-commit-reference', bosLog: null, bosStatus: null }, requiredCapabilities: [],
            preflight: { state: 'ready', checkedAt: at, planHash: 'old-plan', authorizations: [{ category: 'commit', reference: 'synthetic-existing-commit-reference', environmentAlias: 'synthetic' }], environmentAlias: 'synthetic', sourceScopes: [], configurationFiles: [], checks: [] },
            demands: [{ id: 'historical-completed-fixture', candidateReady: true, handoffRef: 'synthetic-history', failures: [], timingSegments: [], results: { unknownWrite: false, knownDefect: false }, resources: { pending: false, polluted: false }, testReceipts: [{ hash: 'synthetic-existing-test' }], deploymentReceipts: [{ operationId: 'synthetic-existing-deploy' }] }],
            operations: [{ id: 'synthetic-history-op', status: 'verified', phase: 'deployment' }], shared: { timingSegments: [], reassessments: [] }, humanReassessments: [] } };
}
function input() { return { kind: 'policy-update', changes: { maxInFlight: 2 }, expectedMaxInFlight: 1, userAuthorization: { actor: 'user', reference: 'synthetic-human-authorization-for-test-only' },
    boundary: { runtimeOperationsSettled: true, sourceWritesSettled: true, fixtureWritesSettled: true }, rationale: 'Synthetic policy test, no live run or user authorization consumed', evidenceRefs: ['synthetic-human-authorization-for-test-only', 'synthetic-idle-boundary'] }; }
function denied(changeManifest, changeInput, expression) {
    const manifest = fixture(), record = input(); changeManifest?.(manifest); changeInput?.(record); const before = JSON.stringify(manifest);
    assert.throws(() => dispatch.updateNight(manifest, record, 'coordinator'), expression); assert.equal(JSON.stringify(manifest), before, 'Rejected update must not mutate fixture');
}
test('A updates only explicit capacity and preserves candidate/receipt/deadline/authorization scope', () => {
    const m = fixture(), before = structuredClone(m); dispatch.updateNight(m, input(), 'coordinator');
    assert.equal(m.night.policy.maxInFlight, 2); assert.equal(m.night.policyChanges.length, 1);
    assert.deepEqual({ ...m.night.policy, maxInFlight: 1 }, before.night.policy);
    for (const field of ['demands', 'operations', 'limits', 'authorizationReferences', 'preflight']) assert.deepEqual(m.night[field], before.night[field]);
    assert.deepEqual(m.authorizations, before.authorizations); assert.equal(originalPolicy.normalizePolicy().maxInFlight, 1);
});
test('A rejects unknown fields, other policy changes, absent/stale expected value', () => {
    denied(null, r => r.changes.stopAt = '2099-01-01', /Only maxInFlight/);
    denied(null, r => r.authorizationReferences = { bosLog: 'fake' }, /Only maxInFlight/);
    denied(null, r => delete r.expectedMaxInFlight, /stale/);
    denied(null, r => r.expectedMaxInFlight = 2, /stale/);
});
test('A rejects lower/equal/invalid capacity', () => {
    for (const value of [0, -1, 1, 1.5, '2', NaN, Infinity, null]) denied(null, r => r.changes.maxInFlight = value, /must increase/);
});
test('A requires coordinator and a human authorization reference in evidence', () => {
    const m = fixture(); assert.throws(() => dispatch.updateNight(m, input(), 'developer'), /coordinator/);
    denied(null, r => r.userAuthorization.actor = 'agent', /human authorization/);
    denied(null, r => r.evidenceRefs = ['other'], /human authorization/);
    denied(null, r => r.evidenceRefs = [], /evidenceRefs/);
    denied(m => m.schemaVersion = '2.0', null, /schema 2.1/);
});
test('A refuses running work/operation/preflight and pending or blocked actions', () => {
    denied(m => m.workItems.push({ status: 'running' }), null, /no active/);
    denied(m => m.night.operations.push({ status: 'running' }), null, /no active/);
    denied(m => m.night.preflightAttempt = { status: 'running' }, null, /no active/);
    for (const status of ['pending', 'blocked']) denied(m => m.actions.push({ status }), null, /no active/);
});
test('A refuses unknown writes/unreconciled resources and absent idle declaration', () => {
    denied(m => m.night.demands[0].results.unknownWrite = true, null, /reconciled/);
    for (const field of ['pending', 'polluted']) denied(m => m.night.demands[0].resources[field] = true, null, /reconciled/);
    for (const field of ['runtimeOperationsSettled', 'sourceWritesSettled', 'fixtureWritesSettled']) denied(null, r => r.boundary[field] = false, /idle write boundary/);
});
test('A refuses revoked/missing preflight and cannot restore or grant authorization', () => {
    denied(m => m.night.preflight.revoked = true, null, /unchanged preflight/);
    denied(m => delete m.night.preflight, null, /unchanged preflight/);
    for (const state of ['revoked', 'not-granted']) denied(m => m.authorizations.commit.state = state, null, /cannot grant, restore or replace/);
});
function unusedGrant(manifest) {
    const reference = 'synthetic-unused-deploy-reference';
    manifest.night.authorizationReferences.deploy = reference;
    manifest.authorizations.deploy = { state: 'granted', scopeHash: 'old-plan', sourceReference: reference, grantedAt: '2020-01-01T00:00:00Z', grantedBy: 'original-evidence', customMetadata: 'preserve' };
    const grant = { category: 'deploy', reference, environmentAlias: 'synthetic', roles: ['doctor'], scopes: [], expiresAt: '2099-01-01T00:00:00Z' };
    manifest.night.preflight.authorizations.push(grant);
    assert.equal(manifest.workItems.some(work => work.authorizationCategory === 'deploy' || work.night.requiredAuthorizations?.includes('deploy')), false);
    return { held: manifest.authorizations.deploy, grant };
}
test('A rejects every stale or invalid unused grant without replacing its original authority', () => {
    for (const mutate of [({ held }) => held.state = 'revoked', ({ held }) => held.state = 'not-granted', ({ held }) => held.revoked = true,
        ({ grant }) => grant.revoked = true, ({ grant }) => grant.expiresAt = '2000-01-01T00:00:00Z', ({ held }) => held.expiresAt = '2000-01-01T00:00:00Z',
        ({ grant }) => grant.expiresAt = 'invalid', ({ grant }) => grant.environmentAlias = 'other', ({ held }) => held.environmentAlias = 'other',
        ({ held }) => held.scopeHash = 'stale', ({ held }) => held.sourceReference = 'original-other-reference', ({ grant }) => grant.reference = 'replacement-reference']) {
        denied(manifest => mutate(unusedGrant(manifest)), null, /cannot (grant|rebind)/);
    }
    denied(manifest => { unusedGrant(manifest); manifest.night.authorizationReferences.deploy = 'other-reference'; }, null, /cannot grant/);
});
test('A rejects requested limit below already occupied demands', () => {
    denied(m => {
        for (let i = 0; i < 3; i++) {
            const id = 'capacity-' + i; m.night.demands.push({ id, results: { unknownWrite: false }, resources: { pending: false, polluted: false } });
            m.workItems.push({ id: id + '-done', status: 'completed', writeScopes: [], night: { demandId: id, phase: 'cleanup' } }, { id: id + '-future', status: 'pending', writeScopes: [], night: { demandId: id, phase: 'cleanup' } });
        }
    }, null, /below current occupied/);
});
test('A reuses existing readiness checks for source widening, expiry, role and configuration drift', () => {
    function withPendingWrite(m) {
        m.workItems.push({ id: 'future-implementation', status: 'pending', repositoryRoot: here, writeScopes: ['allowed.js'], night: { demandId: 'future', phase: 'implementation', role: 'doctor', environmentAlias: 'synthetic', requiredAuthorizations: ['commit'] } });
        const grant = m.night.preflight.authorizations[0]; Object.assign(grant, { roles: ['doctor'], environmentAlias: 'synthetic', expiresAt: '2099-01-01T00:00:00Z', scopes: [{ repoRoot: here, paths: ['allowed.js'] }] });
        m.night.preflight.environmentAlias = 'synthetic'; m.night.preflight.sourceScopes = [{ repoRoot: here, paths: ['allowed.js'] }];
    }
    const valid = fixture(); withPendingWrite(valid); assert.deepEqual(contract.readinessReasons(valid, valid.workItems[0]), []);
    dispatch.updateNight(valid, input(), 'coordinator'); assert.equal(valid.night.policy.maxInFlight, 2);
    for (const mutate of [m => m.workItems[0].writeScopes.push('outside.js'), m => m.night.preflight.authorizations[0].expiresAt = '2000-01-01T00:00:00Z', m => m.night.preflight.authorizations[0].roles = ['nurse'], m => m.night.preflight.authorizations[0].environmentAlias = 'other', m => m.night.preflight.configurationFiles.push({ path: __filename, sha256: '0'.repeat(64) })]) {
        denied(m => { withPendingWrite(m); mutate(m); }, null, /unchanged preflight/);
    }
});
test('A existing recordNight appends real event, rebinds hash, replays and clears own lock on synthetic fixture only', () => {
    const directory = fs.mkdtempSync(path.join(here, 'synthetic-record-night-'));
    const m = fixture(); unusedGrant(m); m.night.runReference = directory; m.eventLog.projectionHash = orchestrator.projectionHash(m);
    fs.writeFileSync(path.join(directory, '00-run-manifest.json'), JSON.stringify(m));
    fs.writeFileSync(path.join(directory, 'events.jsonl'), JSON.stringify({ sequence: 1, type: 'synthetic-fixture-seed', payload: { projectionPatches: [{ op: 'set', path: '', value: m }] } }) + '\n');
    const beforeEvents = fs.readFileSync(path.join(directory, 'events.jsonl'));
    const before = structuredClone(m); orchestrator.recordNight(directory, input(), 'coordinator');
    const after = orchestrator.loadManifest(directory), events = fs.readFileSync(path.join(directory, 'events.jsonl'));
    assert.equal(events.subarray(0, beforeEvents.length).equals(beforeEvents), true); assert.equal(after.eventLog.lastSequence, 2);
    assert.equal(after.night.policy.maxInFlight, 2); assert.notEqual(after.orchestration.planHash, 'old-plan');
    assert.equal(after.night.preflight.planHash, after.orchestration.planHash); assert.equal(after.authorizations.commit.scopeHash, after.orchestration.planHash);
    for (const category of ['commit', 'deploy']) assert.deepEqual({ ...after.authorizations[category], scopeHash: before.authorizations[category].scopeHash }, before.authorizations[category], 'Only the valid scope hash may change, including for unused grants');
    assert.equal(after.authorizations.push.state, 'not-granted'); assert.equal(after.night.authorizationReferences.bosLog, null);
    for (const key of ['demands', 'operations', 'limits', 'authorizationReferences']) assert.deepEqual(after.night[key], before.night[key]);
    assert.equal(after.verification.status, 'stale'); assert.equal(fs.existsSync(path.join(directory, 'run.lock')), false);
    assert.deepEqual(orchestrator.validateV2(after, directory, false), []);
    const saved = fs.readFileSync(path.join(directory, '00-run-manifest.json')); fs.unlinkSync(path.join(directory, '00-run-manifest.json')); fs.writeFileSync(path.join(directory, '00-run-manifest.json'), JSON.stringify(m));
    assert.equal(orchestrator.loadManifest(directory).night.policy.maxInFlight, 2, 'Actual event replay must recover updated policy');
    fs.writeFileSync(path.join(directory, '00-run-manifest.json'), saved);
    const previousEventBytes = fs.readFileSync(path.join(directory, 'events.jsonl'));
    assert.throws(() => orchestrator.recordNight(directory, input(), 'coordinator'), /stale/);
    assert.equal(fs.readFileSync(path.join(directory, 'events.jsonl')).equals(previousEventBytes), true);
});
test('A refuses lock contention and preserves the other owner lock', () => {
    const directory = fs.mkdtempSync(path.join(here, 'synthetic-existing-lock-'));
    const lock = path.join(directory, 'run.lock'); fs.writeFileSync(lock, 'synthetic-other-owner');
    let error; try { orchestrator.recordNight(directory, input(), 'coordinator'); } catch (caught) { error = caught; }
    assert.match(error?.message || '', /Coordinator state is locked/); const retained = fs.existsSync(lock);
    assert.equal(retained, true); assert.equal(fs.readFileSync(lock, 'utf8'), 'synthetic-other-owner');
    fs.unlinkSync(lock); // Remove only the lock created by this synthetic test.
});
function assessmentRecord() {
    const now = Date.now(), stamp = offset => new Date(now + offset).toISOString();
    const assessment = { businessCertainty: 'confirmed', risk: 'low', changeKinds: ['ui'], evidenceRefs: ['synthetic-review'], rationale: 'Synthetic only', reviewerId: 'independent-reviewer', minimumChecks: ['visible-state'], route: 'ui', scopeFingerprint: 'synthetic-scope', frozenVersion: 'content:synthetic-scope' };
    return { id: 'reassessment-synthetic', implementationOwnerId: 'developer', assessment: { pre: assessment, post: assessment }, scopeFingerprint: 'synthetic-scope', frozenVersion: 'content:synthetic-scope',
        results: { knownDefect: false, unknownWrite: false }, resources: { polluted: false, pending: false }, failures: [],
        timingSegments: [{ phase: 'diagnosis', startedAt: stamp(-1200000), endedAt: stamp(-360000), granularity: 'stage', workItemId: 'implement' }],
        reassessments: [{ trigger: 'demand-budget-exhausted', usedMinutes: 14, failureCount: 0, rationale: 'Verified scope and cost', evidenceRefs: ['synthetic-reassessment'], scopeFingerprint: 'synthetic-scope', frozenVersion: 'content:synthetic-scope' }] };
}
test('B reassessed closed diagnosis remains valid when real trackWork adds running execute', () => {
    const r = assessmentRecord(); contract.trackWork({ schemaVersion: '2.1', night: { demands: [r] } }, { id: 'verify', night: { demandId: r.id, phase: 'verification' } }, 'running');
    assert.equal(r.timingSegments.at(-1).phase, 'execute');
    const result = policy.assessDemand(r, 'post'); assert.equal(result.allowed, true); assert.equal(result.usedMinutes, 14);
});
test('B allows open nonbudget phases, still rejects open preparation/diagnosis', () => {
    for (const phase of ['execute', 'wait', 'evidence', 'cleanup']) { const r = assessmentRecord(); r.timingSegments.push({ phase, startedAt: new Date(Date.now() - 1000).toISOString() }); assert.equal(policy.assessDemand(r, 'post').allowed, true, phase); }
    for (const phase of ['diagnosis', 'preparation']) { const r = assessmentRecord(); r.timingSegments.push({ phase, startedAt: new Date(Date.now() - 1000).toISOString() }); assert.equal(policy.assessDemand(r, 'post').reasons.includes('demand-budget-exhausted'), true, phase); }
});
test('B retains strict usedMinutes/failureCount/source/version/evidence checks', () => {
    for (const mutate of [r => r.reassessments[0].usedMinutes = 13, r => r.reassessments[0].failureCount = 1, r => r.reassessments[0].scopeFingerprint = 'stale', r => r.reassessments[0].frozenVersion = 'stale', r => r.reassessments[0].evidenceRefs = [], r => r.reassessments[0].rationale = '']) {
        const r = assessmentRecord(); mutate(r); assert.equal(policy.assessDemand(r, 'post').reasons.includes('demand-budget-exhausted'), true);
    }
});
test('B repeated identical failure still requires exact independent reassessment with open execute', () => {
    const r = assessmentRecord(); r.failures = [{ category: 'evidence', evidenceFingerprint: 'same' }, { category: 'evidence', evidenceFingerprint: 'same' }];
    r.reassessments[0].failureCount = 2; r.timingSegments.push({ phase: 'execute', startedAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal(policy.assessDemand(r, 'post').reasons.includes('repeated-failure-no-new-evidence'), true);
    r.reassessments.push({ ...r.reassessments[0], trigger: 'repeated-failure-no-new-evidence' }); assert.equal(policy.assessDemand(r, 'post').allowed, true);
    r.reassessments.at(-1).failureCount = 1; assert.equal(policy.assessDemand(r, 'post').reasons.includes('repeated-failure-no-new-evidence'), true);
});
