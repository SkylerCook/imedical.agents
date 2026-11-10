'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuotaPolicy, sanitizeSnapshot, assessQuota, createWeeklyBaseline, advanceWeeklyQuota, assessWeeklyQuota } = require('../lib/night-quota');
const now = Date.parse('2026-10-19T01:00:00Z');
const reset = now / 1000 + 86400;
const policy = { provider: 'codex', weeklyBudgetPercentPoints: 10 };
function snapshot(used = 20, at = now, weeklyName = 'secondary') {
    return { observedAt: new Date(at).toISOString(), rateLimitsByLimitId: { codex: {
        [weeklyName === 'primary' ? 'secondary' : 'primary']: { usedPercent: 1, windowDurationMins: 300 },
        [weeklyName]: { usedPercent: used, windowDurationMins: 10080, resetsAt: reset }
    } } };
}
const baseline = (input = snapshot(), config = policy) => createWeeklyBaseline(input, config, { now, budgetId: 'maintenance-2026-10-19' });

test('weekly budget is percentage points with strict configuration and original defaults unchanged', () => {
    assert.equal(normalizeQuotaPolicy({ provider: 'codex' }).weeklyBudgetPercentPoints, undefined);
    for (const weeklyBudgetPercentPoints of [0, -1, 101, null, '10', NaN, Infinity]) assert.throws(() => normalizeQuotaPolicy({ ...policy, weeklyBudgetPercentPoints }));
    assert.equal(normalizeQuotaPolicy({ ...policy, weeklyBudgetPercentPoints: 0.1 }).weeklyBudgetPercentPoints, 0.1);
    assert.equal(assessQuota(snapshot(), policy, now).mode, 'unknown');
});
test('weekly identity follows duration, bucket and reset rather than primary/secondary label', () => {
    const state = baseline(snapshot(20, now, 'primary'));
    assert.equal(state.durationMins, 10080);
    assert.equal(state.bucket, 'codex');
    assert.equal(state.resetsAt, reset);
    assert.equal(state.baselineUsedPercent, 20);
    const moved = advanceWeeklyQuota(state, snapshot(22, now, 'secondary'), policy, now);
    assert.equal(moved.assessment.mode, 'normal');
    assert.equal(moved.assessment.consumedPercentPoints, 2);
    const other = snapshot(); other.rateLimitsByLimitId = { other: other.rateLimitsByLimitId.codex };
    assert.throws(() => baseline(other), /bucket-unavailable/);
    const ambiguous = snapshot(); ambiguous.rateLimitsByLimitId.codex.primary = { usedPercent: 20, windowDurationMins: 10080, resetsAt: reset };
    assert.throws(() => baseline(ambiguous), /ambiguous/);
});
test('inclusive 80% and 100% of B stop claim and closeout while keeping monotonic highwater', () => {
    let state = baseline();
    for (const [used, mode, consumed] of [[27.99, 'normal', 7.99], [28, 'drain', 8], [27, 'drain', 8], [30, 'closeout', 10], [25, 'closeout', 10]]) {
        const advanced = advanceWeeklyQuota(state, snapshot(used), policy, now);
        state = advanced.state;
        assert.equal(advanced.assessment.mode, mode);
        assert.equal(advanced.assessment.consumedPercentPoints, consumed);
        assert.equal(state.baselineUsedPercent, 20);
    }
    assert.equal(state.highWaterUsedPercent, 30);
    assert.equal(assessQuota(snapshot(25), policy, now, state).mode, 'closeout');
    const tiny = { ...policy, weeklyBudgetPercentPoints: 0.2 };
    assert.equal(advanceWeeklyQuota(baseline(snapshot(0.1), tiny), snapshot(0.3), tiny, now).assessment.mode, 'closeout');
});
test('headroom and weekly budget both constrain dispatch', () => {
    let state = baseline();
    const highHeadroomUsage = snapshot(20); highHeadroomUsage.rateLimitsByLimitId.codex.primary.usedPercent = 90;
    state = advanceWeeklyQuota(state, highHeadroomUsage, policy, now).state;
    assert.equal(assessQuota(highHeadroomUsage, policy, now, state).mode, 'closeout');
    state = advanceWeeklyQuota(state, snapshot(28), policy, now).state;
    assert.equal(assessQuota(snapshot(28), policy, now, state).mode, 'drain');
});
test('missing/reset/stale/future evidence cannot authorize new work or rebase the baseline', () => {
    const state = baseline();
    for (const [input, reason] of [
        [snapshot(0, now - 300001), 'quota-snapshot-stale'], [snapshot(0, now + 1), 'quota-snapshot-future'],
        [{ observedAt: new Date(now).toISOString() }, 'quota-applicable-bucket-unavailable']
    ]) {
        const advanced = advanceWeeklyQuota(state, input, policy, now);
        assert.equal(advanced.assessment.mode, 'unknown'); assert.ok(advanced.assessment.reasons.includes(reason));
        assert.equal(advanced.state.baselineUsedPercent, state.baselineUsedPercent);
        assert.equal(advanced.state.highWaterUsedPercent, state.highWaterUsedPercent);
    }
    const changed = snapshot(0); changed.rateLimitsByLimitId.codex.secondary.resetsAt += 1;
    assert.deepEqual(advanceWeeklyQuota(state, changed, policy, now).assessment.reasons, ['quota-weekly-window-changed']);
    assert.deepEqual(assessWeeklyQuota(state, policy, reset * 1000).reasons, ['quota-weekly-window-reset']);
    const missingReset = snapshot(); delete missingReset.rateLimitsByLimitId.codex.secondary.resetsAt;
    assert.throws(() => baseline(missingReset), /reset-invalid/);
    const expired = snapshot(); expired.rateLimitsByLimitId.codex.secondary.resetsAt = now / 1000;
    assert.throws(() => baseline(expired), /window-reset/);
    assert.throws(() => baseline(snapshot(20, now + 1)), /future/);
});
test('an old baseline remains valid within its window with fresh evidence and unchanged B', () => {
    const state = baseline();
    const future = now + 301000;
    assert.equal(assessWeeklyQuota(state, policy, future).mode, 'unknown');
    const advanced = advanceWeeklyQuota(state, snapshot(24, future), policy, future);
    assert.equal(advanced.assessment.mode, 'normal');
    assert.equal(advanced.state.baselineObservedAt, state.baselineObservedAt);
    assert.throws(() => advanceWeeklyQuota(state, snapshot(), { ...policy, weeklyBudgetPercentPoints: 11 }, now), /budget-mismatch/);
    assert.deepEqual(assessWeeklyQuota(undefined, policy, now).reasons, ['quota-weekly-baseline-missing']);
    assert.throws(() => advanceWeeklyQuota(undefined, snapshot(), policy, now), /already be persisted/);
});
test('sanitization removes unrelated metadata and malformed/bypassed state fails closed', () => {
    const input = snapshot(); input.secret = 'private'; input.rateLimitsByLimitId.codex.secondary.token = 'private';
    assert.equal(JSON.stringify(sanitizeSnapshot(input)).includes('private'), false);
    const state = baseline(input);
    const malformed = { ...state, highWaterUsedPercent: 19 };
    assert.equal(assessWeeklyQuota(malformed, policy, now).mode, 'unknown');
    assert.throws(() => advanceWeeklyQuota(malformed, snapshot(), policy, now), /baseline-invalid/);
    const bypassed = { ...state, latestSnapshot: snapshot(28) };
    assert.deepEqual(assessWeeklyQuota(bypassed, policy, now).reasons, ['quota-weekly-highwater-not-recorded']);
    const newer = advanceWeeklyQuota(state, snapshot(28, now + 1000), policy, now + 1000).state;
    const backward = advanceWeeklyQuota(newer, snapshot(20, now), policy, now + 1000);
    assert.deepEqual(backward.assessment.reasons, ['quota-weekly-snapshot-backwards']);
    assert.deepEqual({ ...backward.state, observationError: undefined }, { ...newer, observationError: undefined });
    assert.equal(assessWeeklyQuota(backward.state, policy, now + 1000).mode, 'unknown');
});
