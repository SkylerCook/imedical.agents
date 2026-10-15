'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePolicy, assessDemand, summarizeHumanBudget, selectAuditSample } = require('../lib/night-policy');
const now = Date.parse('2026-10-15T06:00:00Z');
function record(route = 'static-review', kinds = ['text']) {
    const assessment = { businessCertainty: 'confirmed', risk: 'low', changeKinds: kinds, evidenceRefs: ['source:1'], rationale: 'Checked expected behavior', reviewerId: 'reviewer', minimumChecks: ['diff'], route, scopeFingerprint: 'scope-1', frozenVersion: 'version-1' };
    return { id: '1', candidateReady: true, implementationOwnerId: 'developer', scopeFingerprint: 'scope-1', frozenVersion: 'version-1', assessment: { pre: structuredClone(assessment), post: structuredClone(assessment) }, results: { knownDefect: false, unknownWrite: false }, resources: { polluted: false, pending: false }, timingSegments: [], failures: [], reassessments: [] };
}
test('default policy and invalid overrides fail closed', () => {
    assert.deepEqual(normalizePolicy(), { demandBudgetMinutes: 13, sharedPreparationBudgetMinutes: 30, humanEstimateMinutes: 6, auditSampleRate: 0.2, maxInFlight: 1 });
    for (const p of [null, [], { demandBudgetMinutes: 0 }, { auditSampleRate: 2 }, { maxInFlight: 1.5 }, { unknown: 1 }, { humanEstimateMinutes: NaN }]) assert.throws(() => normalizePolicy(p));
});
test('pre and post distinguish eligibility, review and version', () => {
    const r = record();
    assert.equal(assessDemand(r, 'pre', {}, now).allowed, true);
    assert.equal(assessDemand(r, 'pre', {}, now).staticEligible, false);
    assert.equal(assessDemand(r, 'post', {}, now).staticEligible, true);
    r.assessment.post.reviewerId = 'developer';
    assert.ok(assessDemand(r, 'post', {}, now).reasons.includes('independent-review-required'));
    r.assessment.post.reviewerId = 'reviewer'; r.scopeFingerprint = 'changed';
    assert.ok(assessDemand(r, 'post', {}, now).reasons.includes('assessment-version-stale'));
});
test('incomplete and disputed assessments block implementation', () => {
    for (const field of ['evidenceRefs', 'minimumChecks']) { const r = record(); r.assessment.pre[field] = []; assert.equal(assessDemand(r, 'pre', {}, now).allowed, false); }
    for (const certainty of ['uncertain', 'disputed']) { const r = record(); r.assessment.pre.businessCertainty = certainty; assert.ok(assessDemand(r, 'pre', {}, now).reasons.includes('business-question')); }
    const r = record('ui', ['module-refactor']); assert.equal(assessDemand(r, 'pre', {}, now).allowed, false);
});
test('route minimums cannot be bypassed with static or manual', () => {
    for (const kind of ['internal-logic', 'query', 'write', 'state', 'contract', 'ui', 'device']) assert.equal(assessDemand(record('static-review', [kind]), 'post', {}, now).allowed, false);
    for (const kind of ['internal-logic', 'query', 'write', 'state', 'contract']) assert.equal(assessDemand(record('manual', [kind]), 'post', {}, now).allowed, false);
    for (const kind of ['write', 'state', 'contract']) {
        assert.equal(assessDemand(record('internal-method', [kind]), 'post', {}, now).allowed, false);
        assert.equal(assessDemand(record('external-api', [kind]), 'post', {}, now).allowed, true);
    }
    assert.equal(assessDemand(record('internal-method', ['query']), 'post', {}, now).allowed, true);
    assert.equal(assessDemand(record('external-api', ['ui']), 'post', {}, now).allowed, false);
    assert.equal(assessDemand(record('manual', ['ui']), 'post', {}, now).allowed, true);
});
test('safety states cannot be relabeled manual, cleanup always allowed', () => {
    for (const [section, key] of [['results', 'knownDefect'], ['results', 'unknownWrite'], ['resources', 'polluted'], ['resources', 'pending']]) {
        const r = record('manual', ['ui']); r[section][key] = true;
        assert.equal(assessDemand(r, 'post', {}, now).allowed, false);
        assert.equal(assessDemand(r, 'cleanup', {}, now).allowed, true);
    }
    const r = record(); delete r.resources;
    assert.ok(assessDemand(r, 'post', {}, now).reasons.includes('safety-state-unknown'));
});
test('cumulative preparation and diagnosis budget excludes other work', () => {
    const r = record();
    r.timingSegments = [{ phase: 'preparation', startedAt: '2026-10-15T05:00:00Z', endedAt: '2026-10-15T05:07:00Z' }, { phase: 'diagnosis', startedAt: '2026-10-15T05:07:00Z', endedAt: '2026-10-15T05:13:00Z' }, { phase: 'execute', startedAt: '2026-10-15T05:13:00Z', endedAt: '2026-10-15T05:59:00Z' }];
    let result = assessDemand(r, 'post', {}, now);
    assert.equal(result.usedMinutes, 13); assert.ok(result.reasons.includes('demand-budget-exhausted'));
    r.reassessments = [{ trigger: 'demand-budget-exhausted', usedMinutes: 13, failureCount: 0, scopeFingerprint: 'scope-1', frozenVersion: 'version-1', rationale: 'New recovery path', evidenceRefs: ['new:1'] }];
    assert.equal(assessDemand(r, 'post', {}, now).allowed, true);
    r.timingSegments.push({ phase: 'diagnosis', startedAt: '2026-10-15T05:59:00Z' });
    assert.ok(assessDemand(r, 'post', {}, now).reasons.includes('demand-budget-exhausted'));
    r.reassessments[0].usedMinutes = 14; r.reassessments[0].evidenceRefs = [];
    assert.equal(assessDemand(r, 'post', {}, now).allowed, false);
});
test('identical category and evidence fails twice, changed evidence permits retry', () => {
    const r = record(); r.failures = [{ category: 'auth', evidenceFingerprint: 'a' }, { category: 'auth', evidenceFingerprint: 'a' }];
    assert.ok(assessDemand(r, 'post', {}, now).reasons.includes('repeated-failure-no-new-evidence'));
    r.failures[1].category = 'script'; assert.equal(assessDemand(r, 'post', {}, now).allowed, true);
    r.failures[1].category = 'auth'; r.failures[1].evidenceFingerprint = 'b'; assert.equal(assessDemand(r, 'post', {}, now).allowed, true);
});
test('failure reassessment binds trigger, current counters, source and concrete evidence', () => {
    const r = record(); r.failures = [{ category: 'auth', evidenceFingerprint: 'a' }, { category: 'auth', evidenceFingerprint: 'a' }];
    const reassessment = { trigger: 'repeated-failure-no-new-evidence', usedMinutes: 0, failureCount: 2, scopeFingerprint: 'scope-1', frozenVersion: 'version-1', rationale: 'Verified recovery available', evidenceRefs: ['recovery:1'] };
    r.reassessments = [reassessment];
    assert.equal(assessDemand(r, 'post', {}, now).allowed, true);
    for (const [field, value] of [['trigger', 'other'], ['usedMinutes', 1], ['failureCount', 0], ['scopeFingerprint', 'stale'], ['frozenVersion', 'stale'], ['rationale', ''], ['evidenceRefs', []]]) {
        r.reassessments = [{ ...reassessment, [field]: value }];
        assert.equal(assessDemand(r, 'post', {}, now).allowed, false, field);
    }
    r.reassessments = [reassessment]; r.failures.push({ category: 'auth', evidenceFingerprint: 'a' });
    assert.equal(assessDemand(r, 'post', {}, now).allowed, false);
});
test('invalid timing and missing failure history are not free budgets', () => {
    const r = record(); r.timingSegments = [{ phase: 'preparation', startedAt: 'invalid' }];
    assert.ok(assessDemand(r, 'post', {}, now).reasons.includes('timing-invalid'));
    r.timingSegments = []; delete r.failures;
    assert.ok(assessDemand(r, 'post', {}, now).reasons.includes('failure-history-invalid'));
});
test('human estimates include only eligible candidates with conservative default', () => {
    const a = record('manual', ['ui']), b = record(); b.id = '2';
    const c = record('manual'); c.id = '3'; c.blocked = true;
    const d = record('manual'); d.id = '4'; d.results.knownDefect = true;
    assert.deepEqual(summarizeHumanBudget([a, b, c, d]), { count: 1, eligibleCount: 2, estimatedMinutes: 12, referenceMinutes: 12, requiresReassessment: false, manualShare: 0.5 });
    a.humanEstimateMinutes = 0; assert.equal(summarizeHumanBudget([a]).estimatedMinutes, 0);
    a.humanEstimateMinutes = 7; assert.equal(summarizeHumanBudget([a]).requiresReassessment, true);
    a.humanEstimateMinutes = -1; assert.throws(() => summarizeHumanBudget([a]));
    assert.throws(() => summarizeHumanBudget([b, b]));
});
test('frozen sampling is stable, order independent, ceil and rejects invalid inputs', () => {
    const records = Array.from({ length: 6 }, (_, i) => ({ id: String(i), scopeFingerprint: 'scope', frozenVersion: 'v1' }));
    const selected = selectAuditSample('batch', records);
    assert.equal(selected.length, 2); assert.deepEqual(selected, selectAuditSample('batch', records.toReversed()));
    assert.deepEqual(selected, selectAuditSample('batch', records.map(r => ({ ...r, frozenVersion: 'v2', scopeFingerprint: 'changed' }))));
    assert.deepEqual(selectAuditSample('batch', []), []);
    assert.throws(() => selectAuditSample('batch', [records[0], records[0]]));
    assert.throws(() => selectAuditSample('batch', [{ id: '1' }]));
    assert.throws(() => selectAuditSample('batch', records, 0));
});
