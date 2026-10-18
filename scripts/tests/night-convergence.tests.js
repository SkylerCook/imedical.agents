'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const c = require('../lib/night-convergence');
const { normalizePolicy } = require('../lib/night-policy');
const { currentSources, updateNight, gateNight, nightCompletionIssues, occupiedDemands } = require('../lib/night-dispatch');
const contract = require('../lib/night-contract');
const evidence = { rationale: 'Synthetic observed evidence', evidenceRefs: ['synthetic:1'] };
function fixture(t) {
    const parent = process.platform === 'win32' ? 'D:/tmp/Codex' : os.tmpdir();
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, 'night-convergence-'));
    t.after(() => { assert.equal(path.dirname(root), path.resolve(parent)); assert.ok(path.basename(root).startsWith('night-convergence-')); assert.equal(fs.lstatSync(root).isSymbolicLink(), false); fs.rmSync(root, { recursive: true }); assert.equal(fs.existsSync(root), false); });
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
    git('init', '--quiet'); git('config', 'core.autocrlf', 'false');
    for (const f of ['a.js', 'b.js', 'c.js', 'other.js']) fs.writeFileSync(path.join(root, f), f);
    git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    const manifest = { coordinatorId: 'leader', repositoryRoot: root, participants: [{ id: 'dev' }, { id: 'reviewer' }], actions: [], workItems: [], night: { policy: normalizePolicy({ convergence: { version: 1, totalBudgetMinutes: 60 } }), limits: { stopAt: new Date(Date.now() + 3600000).toISOString(), stopClaimingAt: new Date(Date.now() + 3600000).toISOString(), stopPublishingAt: new Date(Date.now() + 3600000).toISOString() }, demands: [], shared: { timingSegments: [], reassessments: [] }, humanReassessments: [] } };
    function add(id) {
        const sourceScopes = [{ repoRoot: root, scopes: [id.toLowerCase() + '.js', 'other.js'] }], frozen = currentSources({ sourceScopes });
        const assessment = { businessCertainty: 'confirmed', risk: 'low', changeKinds: ['query'], ...evidence, reviewerId: 'reviewer', minimumChecks: ['check'], route: 'external-api', ...frozen };
        const r = { id, implementationOwnerId: 'dev', sourceScopes, ...frozen, assessment: { pre: assessment, post: assessment }, timingSegments: [], failures: [], reassessments: [], testReceipts: [], deploymentReceipts: [], results: { knownDefect: false, unknownWrite: false }, resources: { pending: false, polluted: false }, checks: [{ id: 'check', status: 'passed', ...frozen, evidenceRefs: ['passed:1'] }] };
        manifest.night.demands.push(r);
        for (const phase of ['implementation', 'review', 'deployment', 'verification', 'cleanup']) manifest.workItems.push({ id: `${id}-${phase}`, ownerId: 'dev', kind: phase === 'cleanup' ? 'cleanup' : 'task', writeScopes: phase === 'implementation' ? [id.toLowerCase() + '.js'] : [], status: 'pending', night: { demandId: id, phase } });
        return r;
    }
    let sequence = 0;
    const event = input => updateNight(manifest, { eventId: `e${++sequence}`, ...evidence, ...input }, 'leader');
    const bind = (consumer, upstream, extra = {}) => event({ kind: 'dependency-bind', demandId: consumer.id, binding: { upstreamId: upstream.id, upstreamVersion: upstream.frozenVersion, type: 'contract', sourceScopes: [{ repoRoot: root, scopes: [upstream.id.toLowerCase() + '.js'] }], requiredChecks: ['check'], evidenceRefs: ['contract:1'], ...extra } });
    return { root, git, manifest, add, event, bind };
}

test('explicit versioned budgets preserve legacy policies and reject guessed or unknown limits', () => {
    assert.equal(normalizePolicy().convergence, undefined);
    assert.throws(() => normalizePolicy({ convergence: { version: 1 } }), /totalBudgetMinutes/);
    assert.throws(() => normalizePolicy({ convergence: { version: 2, totalBudgetMinutes: 60 } }), /Unsupported/);
    assert.throws(() => normalizePolicy({ convergence: { version: 1, totalBudgetMinutes: 60, retry: 5 } }), /Unsupported/);
    assert.equal(normalizePolicy({ convergence: { version: 1, totalBudgetMinutes: 60 } }).convergence.maxProblemAttempts, 4);
});

test('total time includes execute/wait/evidence, unions layers and excludes cleanup', () => {
    const now = Date.parse('2026-10-18T02:00:00Z');
    const segments = [{ phase: 'execute', startedAt: '2026-10-18T01:00:00Z', endedAt: '2026-10-18T01:40:00Z', granularity: 'stage' }, { phase: 'preparation', startedAt: '2026-10-18T01:00:00Z', endedAt: '2026-10-18T01:10:00Z', granularity: 'detail' }, { phase: 'wait', startedAt: '2026-10-18T01:40:00Z', endedAt: '2026-10-18T01:45:00Z' }, { phase: 'cleanup', startedAt: '2026-10-18T01:45:00Z', endedAt: '2026-10-18T02:00:00Z' }];
    assert.equal(c.totalMinutes(segments, now), 45);
    assert.throws(() => c.totalMinutes([{ phase: 'execute', startedAt: 'invalid' }], now), /interval/);
});

test('fourth attempt may succeed; versions, redelivery and new agents do not reset attempts', t => {
    const f = fixture(t), r = f.add('A');
    f.event({ kind: 'problem', demandId: 'A', problemId: 'p', caseId: 'case', category: 'business' });
    for (let i = 1; i <= 4; i++) {
        r.frozenVersion = `repair-${i}`;
        const input = { eventId: `start-${i}`, kind: 'attempt-start', demandId: 'A', problemId: 'p', attemptId: `a${i}`, hypothesis: `hypothesis ${i}`, change: `change ${i}`, expectedCheck: 'case', newEvidenceRefs: ['observed:1'], evidenceSummary: `observation ${i}` };
        f.event(input); f.event(input);
        assert.equal(c.problems(f.manifest, 'A')[0].attempts.length, i);
        assert.deepEqual(c.hardReasons(f.manifest, r, 'verification'), []);
        if (i === 4) r.testReceipts.push({ caseId: 'case', status: 'passed', frozenVersion: r.frozenVersion, convergenceAttemptIds: ['a4'] });
        f.event({ kind: 'attempt-result', demandId: 'A', problemId: 'p', attemptId: `a${i}`, status: i === 4 ? 'resolved' : 'failed' });
    }
    assert.equal(c.problems(f.manifest, 'A')[0].resolved, true);
    c.observeFailure(f.manifest, r, { caseId: 'case', failureCategory: 'business', version: 'later' });
    assert.ok(c.hardReasons(f.manifest, r, 'implementation').includes('problem-attempts-exhausted'));
    assert.throws(() => f.event({ kind: 'attempt-start', demandId: 'A', problemId: 'p', attemptId: 'a5' }), /exhausted/);
    assert.throws(() => f.event({ kind: 'problem', demandId: 'A', problemId: 'renamed', caseId: 'case', category: 'business' }), /history/);
});

test('changed references alone cannot authorize another attempt; stale receipt cannot resolve it', t => {
    const f = fixture(t), r = f.add('A');
    const result = { caseId: 'case', failureCategory: 'business', assertions: [{ id: 'check', passed: false, evidenceRefs: ['log:a'] }], version: r.frozenVersion };
    c.observeFailure(f.manifest, r, result); c.observeFailure(f.manifest, r, { ...result, assertions: [{ id: 'check', passed: false, evidenceRefs: ['log:b'] }] });
    const p = c.problems(f.manifest, 'A')[0];
    assert.equal(c.problems(f.manifest, 'A').length, 1);
    assert.equal(p.failures[0].signature, p.failures[1].signature);
    const start = { kind: 'attempt-start', demandId: 'A', problemId: p.problemId, attemptId: 'a1', hypothesis: 'cause', change: 'fix', expectedCheck: 'case', newEvidenceRefs: ['log:a'], evidenceSummary: 'same observation' };
    f.event(start);
    r.testReceipts.push({ caseId: 'case', status: 'passed', frozenVersion: r.frozenVersion });
    assert.throws(() => f.event({ kind: 'attempt-result', demandId: 'A', problemId: p.problemId, attemptId: 'a1', status: 'resolved' }), /this attempt/);
    f.event({ kind: 'attempt-result', demandId: 'A', problemId: p.problemId, attemptId: 'a1', status: 'failed' });
    assert.throws(() => f.event({ ...start, attemptId: 'a2', newEvidenceRefs: ['log:b'] }), /no-new-evidence/);
});

test('hard budget blocks new work despite reassessment but cleanup and independent demand survive', t => {
    const f = fixture(t), a = f.add('A'), b = f.add('B'), now = Date.now();
    a.timingSegments = [{ phase: 'execute', startedAt: new Date(now - 3600000).toISOString(), endedAt: new Date(now).toISOString() }];
    assert.ok(gateNight(f.manifest, f.manifest.workItems.find(w => w.id === 'A-implementation'), now).reasons.includes('total-budget-exhausted'));
    assert.equal(gateNight(f.manifest, f.manifest.workItems.find(w => w.id === 'A-cleanup'), now).allowed, true);
    assert.deepEqual(c.hardReasons(f.manifest, b, 'implementation', now), []);
    assert.equal(c.budget(f.manifest, a, now).remainingMinutes, 0);
});

test('dependent development can start early, final completion requires upstream checks', t => {
    const f = fixture(t), a = f.add('A'), b = f.add('B'); a.checks = [];
    f.bind(b, a);
    assert.deepEqual(c.dependencyReasons(f.manifest, b), []);
    assert.ok(c.dependencyReasons(f.manifest, b, true).includes('dependency-verification-pending'));
    assert.equal(gateNight(f.manifest, f.manifest.workItems.find(w => w.id === 'B-implementation')).allowed, true);
    assert.ok(nightCompletionIssues(f.manifest).some(s => s.includes('dependency')));
});

test('unrelated change preserves dependency token; related change invalidates direct and transitive consumers', t => {
    const f = fixture(t), a = f.add('A'), b = f.add('B'), d = f.add('C'); f.bind(b, a); f.bind(d, b);
    const before = c.dependencyToken(f.manifest, 'B');
    fs.writeFileSync(path.join(f.root, 'other.js'), 'unrelated');
    assert.equal(c.dependencyToken(f.manifest, 'B'), before);
    assert.deepEqual(c.dependencyReasons(f.manifest, b, true), []);
    fs.writeFileSync(path.join(f.root, 'a.js'), 'changed contract');
    assert.ok(c.dependencyReasons(f.manifest, b).includes('dependency-version-stale'));
    assert.ok(c.dependencyReasons(f.manifest, d).includes('dependency-version-stale'));
    assert.notEqual(c.dependencyToken(f.manifest, 'B'), before);
});

test('code dependency must exist in the consumer scope; cycles and active rebinding fail', t => {
    const f = fixture(t), a = f.add('A'), b = f.add('B');
    assert.throws(() => f.bind(b, a, { type: 'code' }), /consumer/);
    f.bind(b, a);
    assert.throws(() => f.bind(a, b), /cycle/i);
    f.manifest.night.operations = [{ id: 'pending', demandId: 'B', status: 'running' }];
    assert.throws(() => f.bind(b, a), /active/);
});

test('managed operation captures remaining budget and refuses stale combination result', t => {
    const f = fixture(t), a = f.add('A'), b = f.add('B'); f.bind(b, a);
    f.manifest.schemaVersion = '2.1'; f.manifest.night.preflight = { environmentAlias: 'test', profileFingerprint: 'profile' };
    const item = f.manifest.workItems.find(w => w.id === 'B-verification'); item.status = 'running';
    contract.operationRecord(f.manifest, { kind: 'operation-start', operation: { id: 'op', phase: 'verification', workItemId: item.id, environmentAlias: 'test', artifacts: [] } }, currentSources, () => ({ allowed: true }));
    assert.ok(f.manifest.night.operations[0].deadlineAt <= Date.now() + 3600000);
    fs.writeFileSync(path.join(f.root, 'a.js'), 'changed during operation');
    contract.operationRecord(f.manifest, { kind: 'operation-result', operationId: 'op', result: { status: 'scope-passed', results: [], cleanup: { cleanupVerified: true } }, ...evidence }, currentSources);
    assert.equal(f.manifest.night.operations[0].status, 'review-pending');
    assert.equal(item.status, 'blocked');
});

test('safe exhausted demand releases capacity; unknown write and active operation retain it', t => {
    const f = fixture(t), a = f.add('A'); f.add('B');
    a.timingSegments = [{ phase: 'execute', startedAt: new Date(Date.now() - 7200000).toISOString(), endedAt: new Date().toISOString() }];
    f.manifest.workItems.find(w => w.id === 'A-implementation').status = 'completed';
    assert.equal(occupiedDemands(f.manifest).has('A'), false);
    a.results.unknownWrite = true;
    assert.equal(occupiedDemands(f.manifest).has('A'), true);
    a.results.unknownWrite = false;
    f.manifest.workItems.find(w => w.id === 'A-verification').status = 'running';
    assert.equal(occupiedDemands(f.manifest).has('A'), true);
});

test('expired deployment does not call transport and still permits close; legacy adapter is unchanged', async () => {
    const managed = require('../lib/night-execution'); let calls = 0, closes = 0;
    const adapter = { write: async () => ++calls, close: async () => ++closes };
    assert.equal(managed.boundAdapter(null, adapter), adapter);
    const wrapped = managed.boundAdapter({ manifest: { night: { policy: { convergence: { version: 1 } } } }, operation: { deadlineAt: Date.now() - 1 } }, adapter);
    await assert.rejects(wrapped.write(), /deadline/);
    await wrapped.close(); assert.equal(calls, 0); assert.equal(closes, 1);
});

test('actual environment dependency check runs before and after execution and rejects changed runtime', async t => {
    const f = fixture(t), a = f.add('A'), b = f.add('B'); f.bind(b, a, { type: 'environment' });
    const managed = require('../lib/night-execution');
    const binding = { manifest: f.manifest, context: { workspaceRoot: f.root }, operation: { deadlineAt: Date.now() + 10000 }, item: { night: { demandId: 'B', role: 'tester', effects: 'read-only' } } };
    t.mock.method(managed, 'begin', () => binding); t.mock.method(managed, 'checkpoint', () => {});
    t.mock.method(managed, 'consumeTest', () => {}); t.mock.method(managed, 'finish', () => {});
    let checks = 0, executed = 0, closed = 0;
    const result = await require('../run-acceptance').runAcceptance({ options: { projectRoot: f.root, deadlineAt: Date.now() + 10000 }, cases: [{ demandId: 'B', caseId: 'runtime', scope: ['b.js'], role: 'tester', level: 'external-api', entry: 'synthetic', effects: 'read-only', createAdapter: async () => ({ prepare: async () => true, verifyVersion: async () => true, verifyDependencies: async bindings => { assert.equal(bindings[0].upstreamVersion, a.frozenVersion); return ++checks === 1; }, execute: async () => executed++, assert: async () => [{ id: 'check', passed: true, evidenceRefs: ['proof'] }], sideEffects: async () => true, close: async () => { closed++; return true; } }) }] });
    assert.equal(checks, 2); assert.equal(executed, 1); assert.equal(closed, 1);
    assert.equal(result.status, 'review-pending'); assert.equal(result.results[0].failureCategory, 'version');
});

test('event projection survives serialization without granting an extra attempt', t => {
    const f = fixture(t); f.add('A');
    const input = { eventId: 'persisted', kind: 'problem', demandId: 'A', problemId: 'p', caseId: 'case', category: 'business', ...evidence };
    updateNight(f.manifest, input, 'leader');
    const recovered = JSON.parse(JSON.stringify(f.manifest));
    updateNight(recovered, input, 'leader');
    assert.equal(c.problems(recovered, 'A').length, 1);
    assert.throws(() => updateNight(recovered, { ...input, caseId: 'renamed' }, 'leader'), /Conflicting/);
});

test('a stopped checkpoint does not create a false unknown write and still closes the runner', async t => {
    const f = fixture(t); f.add('A');
    const managed = require('../lib/night-execution'); let finished;
    const binding = { manifest: f.manifest, context: { workspaceRoot: f.root }, operation: { deadlineAt: Date.now() + 10000 }, item: { night: { demandId: 'A' } } };
    t.mock.method(managed, 'begin', () => binding);
    t.mock.method(managed, 'checkpoint', () => { throw Object.assign(new Error('stopped'), { code: 'night-checkpoint-blocked' }); });
    t.mock.method(managed, 'finish', (_binding, result) => { finished = result; });
    const result = await require('../run-acceptance').runAcceptance({ options: { projectRoot: f.root, deadlineAt: Date.now() + 10000 }, cases: [{ demandId: 'A' }] });
    assert.equal(result.results.length, 0); assert.equal(result.cleanup.cleanupVerified, true);
    assert.equal(finished.failureCategory, 'gate');
});

test('code is checked in a real consumer worktree; rebind schedules verification only once', t => {
    const f = fixture(t), a = f.add('A'), b = f.add('B');
    const consumer = path.join(f.root, 'consumer'); f.git('worktree', 'add', '--detach', consumer, 'HEAD');
    b.sourceScopes = [{ repoRoot: consumer, scopes: ['a.js', 'b.js'] }];
    Object.assign(b, currentSources(b));
    const review = f.manifest.workItems.find(w => w.id === 'B-review'); review.status = 'completed';
    const input = { eventId: 'bind-once', kind: 'dependency-bind', demandId: 'B', binding: { upstreamId: 'A', upstreamVersion: a.frozenVersion, type: 'code', sourceScopes: [{ repoRoot: f.root, scopes: ['a.js'] }], consumerScopes: [{ repoRoot: consumer, scopes: ['a.js'] }], requiredChecks: ['check'], evidenceRefs: ['visible:1'] }, ...evidence };
    updateNight(f.manifest, input, 'leader');
    assert.equal(review.status, 'pending'); assert.deepEqual(c.dependencyReasons(f.manifest, b), []);
    review.status = 'completed'; updateNight(f.manifest, input, 'leader');
    assert.equal(review.status, 'completed');
    fs.writeFileSync(path.join(consumer, 'a.js'), 'old or changed consumer');
    assert.ok(c.dependencyReasons(f.manifest, b).includes('dependency-code-not-visible'));
});
