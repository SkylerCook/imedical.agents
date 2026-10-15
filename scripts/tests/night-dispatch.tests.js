'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { normalizePolicy } = require('../lib/night-policy');
const { createTestExecutor } = require('../lib/playwright-runner');
const { initializeNight, validateNightItems, updateNight, gateNight, currentSources, occupiedDemands, nightCompletionIssues } = require('../lib/night-dispatch');
const evidence = { rationale: 'Verified test evidence', evidenceRefs: ['case:1'] };
function fixture(t) {
    const parent = process.platform === 'win32' ? 'D:/tmp/Codex' : os.tmpdir();
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, 'night-dispatch-'));
    t.after(() => {
        assert.equal(path.dirname(root), path.resolve(parent));
        assert.ok(path.basename(root).startsWith('night-dispatch-'));
        assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
        fs.rmSync(root, { recursive: true, force: true });
        assert.equal(fs.existsSync(root), false);
    });
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
    git('init', '--quiet'); git('config', 'core.autocrlf', 'false'); fs.writeFileSync(path.join(root, 'source.js'), 'module.exports = 1;\n');
    git('add', 'source.js'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
    const now = Date.now();
    const manifest = { coordinatorId: 'leader', participants: [{ id: 'leader' }, { id: 'dev' }, { id: 'reviewer' }], actions: [], workItems: [], night: { batchId: 'batch', policy: normalizePolicy(), limits: { stopClaimingAt: new Date(now + 3600000).toISOString(), stopPublishingAt: new Date(now + 7200000).toISOString(), stopAt: new Date(now + 10800000).toISOString() }, demands: [], shared: { timingSegments: [], reassessments: [] }, humanReassessments: [], audit: null } };
    function add(id = '1', route = 'external-api') {
        const sourceScopes = [{ repoRoot: root, scopes: ['source.js'] }];
        const frozen = currentSources({ sourceScopes });
        const assessment = { businessCertainty: 'confirmed', risk: 'low', changeKinds: route === 'static-review' ? ['text'] : ['query'], ...evidence, reviewerId: 'reviewer', minimumChecks: ['readback'], route, scopeFingerprint: frozen.scopeFingerprint, frozenVersion: frozen.frozenVersion };
        const record = { id, implementationOwnerId: 'dev', ...frozen, sourceScopes, assessment: { pre: structuredClone(assessment), post: structuredClone(assessment) }, results: { knownDefect: false, unknownWrite: false }, resources: { polluted: false, pending: false }, timingSegments: [], failures: [], reassessments: [], candidateReady: false, handoffRef: 'handoff:1' };
        manifest.repositoryRoot = root;
        record.checks = [{ id: 'readback', status: 'passed', scopeFingerprint: frozen.scopeFingerprint, frozenVersion: frozen.frozenVersion, evidenceRefs: ['actual:1'] }];
        record.automatedResult = { status: 'passed', level: route, scopeFingerprint: frozen.scopeFingerprint, frozenVersion: frozen.frozenVersion, evidenceRef: 'actual:1' };
        for (const phase of ['implementation', 'deployment', 'verification', 'cleanup']) manifest.workItems.push({ id: `${id}-${phase}`, ownerId: 'dev', kind: phase === 'cleanup' ? 'cleanup' : 'task', writeScopes: phase === 'implementation' ? ['source.js'] : [], status: 'pending', night: { demandId: id, phase } });
        updateNight(manifest, { kind: 'demand', record, ...evidence }, 'leader');
        return record;
    }
    return { root, manifest, now, add, git, item: (id, phase) => manifest.workItems.find(w => w.id === `${id}-${phase}`) };
}
test('old plans remain opt-in; explicit policy requires zoned ordered deadlines', t => {
    const f = fixture(t);
    assert.equal(initializeNight({}, path.join(f.root, 'plan.json')), null);
    assert.deepEqual(gateNight({}, {}, f.now), { allowed: true, reasons: [] });
    fs.writeFileSync(path.join(f.root, 'batch.json'), JSON.stringify({ batchId: 'batch' }));
    const plan = { nightBatchReference: 'batch.json' };
    assert.equal(initializeNight(plan, path.join(f.root, 'plan.json')), null);
    fs.writeFileSync(path.join(f.root, 'policy.json'), JSON.stringify(normalizePolicy()));
    const batch = { batchId: 'batch', decisionPolicyReference: 'policy.json', policy: f.manifest.night.limits };
    fs.writeFileSync(path.join(f.root, 'batch.json'), JSON.stringify(batch));
    assert.equal(initializeNight(plan, path.join(f.root, 'plan.json')).policy.demandBudgetMinutes, 13);
    batch.policy.stopAt = '2026-10-15T06:00:00';
    fs.writeFileSync(path.join(f.root, 'batch.json'), JSON.stringify(batch));
    assert.throws(() => initializeNight(plan, path.join(f.root, 'plan.json')), /zoned/);
});
test('actual source changes invalidate post gates and forged records', t => {
    const f = fixture(t), r = f.add();
    assert.equal(gateNight(f.manifest, f.item('1', 'verification'), f.now).allowed, true);
    fs.appendFileSync(path.join(f.root, 'source.js'), '// changed\n');
    assert.ok(gateNight(f.manifest, f.item('1', 'verification'), f.now).reasons.includes('source-fingerprint-changed'));
    assert.throws(() => updateNight(f.manifest, { kind: 'demand', record: r, ...evidence }, 'leader'), /fingerprint/);
});
test('history is append-only and an open timing segment may close exactly once', t => {
    const f = fixture(t), r = f.add();
    r.timingSegments.push({ phase: 'preparation', startedAt: new Date(f.now - 60000).toISOString() });
    updateNight(f.manifest, { kind: 'demand', record: r, ...evidence }, 'leader');
    r.timingSegments[0].endedAt = new Date().toISOString();
    updateNight(f.manifest, { kind: 'demand', record: r, ...evidence }, 'leader');
    const reset = structuredClone(r); reset.timingSegments = [];
    assert.throws(() => updateNight(f.manifest, { kind: 'demand', record: reset, ...evidence }, 'leader'), /cannot reset/);
    r.timingSegments[0].endedAt = new Date(f.now - 1).toISOString();
    assert.throws(() => updateNight(f.manifest, { kind: 'demand', record: r, ...evidence }, 'leader'), /history changed/);
});
test('shared preparation and human estimates are reassessable soft gates', t => {
    const f = fixture(t), r = f.add();
    const timingSegments = [{ startedAt: new Date(f.now - 1800000).toISOString(), endedAt: new Date(f.now).toISOString() }];
    updateNight(f.manifest, { kind: 'shared', timingSegments, reassessments: [], ...evidence }, 'leader');
    assert.ok(gateNight(f.manifest, f.item('1', 'verification'), f.now).reasons.includes('shared-preparation-budget-exhausted'));
    updateNight(f.manifest, { kind: 'shared', timingSegments, reassessments: [{ usedMinutes: 30, ...evidence }], ...evidence }, 'leader');
    assert.equal(gateNight(f.manifest, f.item('1', 'verification'), f.now).allowed, true);
    r.candidateReady = true; r.humanEstimateMinutes = 7;
    updateNight(f.manifest, { kind: 'demand', record: r, ...evidence }, 'leader');
    assert.ok(gateNight(f.manifest, f.item('1', 'deployment'), f.now).reasons.includes('human-budget-reassessment-required'));
    updateNight(f.manifest, { kind: 'human-reassessment', ...evidence }, 'leader');
    assert.equal(gateNight(f.manifest, f.item('1', 'deployment'), f.now).allowed, true);
});
test('startup ACK remains occupied, same demand counts once, other demand waits', t => {
    const f = fixture(t); f.add('1'); f.add('2');
    f.manifest.actions.push({ workItemId: '1-implementation', type: 'create-session', status: 'acknowledged' }, { workItemId: '1-deployment', type: 'start', status: 'pending' });
    assert.deepEqual([...occupiedDemands(f.manifest)], ['1']);
    assert.ok(gateNight(f.manifest, f.item('2', 'implementation'), f.now).reasons.includes('night-capacity'));
    assert.equal(gateNight(f.manifest, f.item('1', 'implementation'), f.now).allowed, true);
});
test('deadline stops business actions while cleanup survives capacity and missing assessment', t => {
    const f = fixture(t); f.add();
    const after = f.now + 14400000;
    assert.ok(gateNight(f.manifest, f.item('1', 'implementation'), after).reasons.includes('night-stopped'));
    assert.ok(gateNight(f.manifest, f.item('1', 'deployment'), after).reasons.includes('publishing-stopped'));
    f.manifest.night.demands = [];
    assert.equal(gateNight(f.manifest, f.item('1', 'cleanup'), after).allowed, true);
});
test('frozen sample binds actual sources and misclassification suspends static route', t => {
    const f = fixture(t);
    for (let i = 1; i <= 6; i++) { const r = f.add(String(i), 'static-review'); r.candidateReady = true; updateNight(f.manifest, { kind: 'demand', record: r, ...evidence }, 'leader'); }
    updateNight(f.manifest, { kind: 'audit-freeze', ...evidence }, 'leader');
    assert.equal(f.manifest.night.audit.selected.length, 2);
    assert.throws(() => updateNight(f.manifest, { kind: 'audit-freeze', ...evidence }, 'leader'), /already frozen/);
    const id = f.manifest.night.audit.selected[0], frozen = f.manifest.night.audit.cohort.find(r => r.id === id);
    updateNight(f.manifest, { kind: 'audit-result', ...frozen, status: 'misclassified', ...evidence }, 'leader');
    assert.ok(gateNight(f.manifest, f.item('1', 'deployment'), f.now).reasons.includes('static-policy-suspended'));
});
test('mapping and coordinator identity are enforced', t => {
    const f = fixture(t), r = f.add();
    assert.throws(() => updateNight(f.manifest, { kind: 'demand', record: r, ...evidence }, 'dev'), /coordinator/);
    f.item('1', 'implementation').authorizationCategory = 'deploy';
    assert.throws(() => validateNightItems(f.manifest), /deployment phase/);
});
test('final completion rejects unsafe noncandidate demands', t => {
    const f = fixture(t); f.add();
    const stored = f.manifest.night.demands[0];
    assert.deepEqual(nightCompletionIssues(f.manifest), []);
    for (const [section, key] of [['results', 'knownDefect'], ['results', 'unknownWrite'], ['resources', 'polluted'], ['resources', 'pending']]) {
        stored[section][key] = true;
        assert.ok(nightCompletionIssues(f.manifest).length > 0, `${section}.${key}`);
        stored[section][key] = false;
    }
});
test('static audit must obey real route minimums', t => {
    const f = fixture(t), r = f.add('1', 'static-review');
    r.candidateReady = true; r.assessment.post.auditRoute = 'internal-method';
    updateNight(f.manifest, { kind: 'demand', record: r, ...evidence }, 'leader');
    updateNight(f.manifest, { kind: 'audit-freeze', ...evidence }, 'leader');
    assert.equal(gateNight(f.manifest, f.item('1', 'verification'), f.now).allowed, false);
    r.assessment.post.auditRoute = 'ui';
    updateNight(f.manifest, { kind: 'demand', record: r, ...evidence }, 'leader');
    assert.equal(gateNight(f.manifest, f.item('1', 'verification'), f.now).allowed, true);
});
test('old audit cannot pass after record moves to manual or noncandidate on changed source', t => {
    const f = fixture(t), r = f.add('1', 'static-review');
    r.candidateReady = true;
    updateNight(f.manifest, { kind: 'demand', record: r, ...evidence }, 'leader');
    updateNight(f.manifest, { kind: 'audit-freeze', ...evidence }, 'leader');
    const frozen = structuredClone(f.manifest.night.audit.cohort[0]);
    fs.appendFileSync(path.join(f.root, 'source.js'), '// actual new source\n');
    const latest = currentSources(r);
    Object.assign(r, latest); Object.assign(r.assessment.post, { scopeFingerprint: latest.scopeFingerprint, frozenVersion: latest.frozenVersion, route: 'manual' });
    r.checks = r.checks.map(c => ({ ...c, scopeFingerprint: latest.scopeFingerprint, frozenVersion: latest.frozenVersion }));
    for (const ready of [false, true]) {
        r.candidateReady = ready;
        updateNight(f.manifest, { kind: 'demand', record: r, ...evidence }, 'leader');
        assert.throws(() => updateNight(f.manifest, { kind: 'audit-result', ...frozen, status: 'passed', ...evidence }, 'leader'), /Audit/i);
    }
});
test('out-of-scope commit changes provenance but preserves scoped source evidence', t => {
    const f = fixture(t), r = f.add();
    const before = currentSources(r);
    fs.writeFileSync(path.join(f.root, 'unrelated.txt'), 'unrelated\n');
    f.git('add', 'unrelated.txt');
    f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'outside scope');
    const after = currentSources(r);
    assert.notEqual(before.sources[0].head, after.sources[0].head);
    assert.equal(before.scopeFingerprint, after.scopeFingerprint);
    assert.equal(before.frozenVersion, after.frozenVersion);
    assert.equal(gateNight(f.manifest, f.item('1', 'verification'), f.now).allowed, true);
});
test('real executor receipts append timing once, reject wrong identity and preserve unsafe outcomes', async t => {
    const f = fixture(t), r = f.add();
    const executor = createTestExecutor({ projectRoot: f.root, deadlineAt: Date.now() + 60000, session: { ensureReady: async () => true, stop: () => ({ cleanupVerified: true }) } });
    t.after(async () => { assert.equal((await executor.stop()).cleanupVerified, true); });
    async function execute(caseId, throws = false) {
        return executor.run({ demandId: r.id, caseId, scope: r.sourceScopes, version: r.frozenVersion, level: 'external-api', entry: 'synthetic-contract', role: 'test', createAdapter: () => ({ prepare: async () => true, verifyVersion: async () => true, execute: async () => { if (throws) throw new Error('Unknown outcome'); }, assert: async () => [{ id: 'actual', passed: true, evidenceRefs: ['actual:1'] }], sideEffects: async () => true, close: async () => true }) });
    }
    const result = await execute('passed');
    assert.equal(result.status, 'passed');
    assert.ok(result.timingSegments.some(s => s.step === 'authentication' && s.phase === 'preparation'));
    const file = path.join(f.root, 'result.json');
    const consume = value => { fs.writeFileSync(file, JSON.stringify(value)); return updateNight(f.manifest, { kind: 'test-result', id: r.id, resultFile: file, ...evidence }, 'leader'); };
    assert.throws(() => consume({ ...result, demandId: 'wrong' }), /mismatch/);
    assert.throws(() => consume({ ...result, version: 'wrong' }), /mismatch/);
    consume(result);
    let stored = f.manifest.night.demands[0];
    // One successful case never establishes whole-demand coverage.
    assert.deepEqual(stored.automatedResult, r.automatedResult);
    assert.equal(stored.candidateReady, false);
    assert.equal(stored.testReceipts.length, 1);
    assert.equal(stored.timingSegments.length, result.timingSegments.length);
    consume(result);
    assert.equal(stored.testReceipts.length, 1);
    assert.equal(stored.timingSegments.length, result.timingSegments.length);
    const unknown = await execute('unknown', true);
    assert.equal(unknown.failureCategory, 'execution-unknown');
    consume(unknown);
    assert.equal(stored.results.unknownWrite, true);
    assert.equal(stored.automatedResult, undefined);
    assert.equal(stored.candidateReady, false);
    assert.equal(stored.failures.length, 1);
    consume(await execute('passed-again'));
    assert.equal(stored.results.unknownWrite, true);
    assert.equal(stored.testReceipts.length, 3);
    assert.equal(stored.automatedResult, undefined);
    consume({ ...result, caseId: 'business-and-cleanup', status: 'review-pending', failureCategory: 'business', cleanup: { verified: false } });
    assert.equal(stored.results.knownDefect, true);
    assert.equal(stored.resources.pending, true);
    consume({ ...result, caseId: 'other-clean-case' });
    assert.equal(stored.resources.pending, true);
    assert.equal(stored.results.knownDefect, true);
    assert.equal(stored.testReceipts.at(-1).caseId, 'other-clean-case');
    assert.deepEqual(stored.testReceipts.at(-1).scope, result.scope);
    for (const key of ['testReceipts', 'timingSegments', 'failures']) {
        const reset = structuredClone(stored); delete reset[key];
        assert.throws(() => updateNight(f.manifest, { kind: 'demand', record: reset, ...evidence }, 'leader'), /reset|history/i, key);
    }
});
