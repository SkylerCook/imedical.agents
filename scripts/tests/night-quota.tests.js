'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuotaPolicy, assessQuota, sanitizeQuotaSnapshot } = require('../lib/night-quota');
const now = Date.parse('2026-10-15T10:00:00Z');
const policy = { provider: 'codex' };
const window = (usedPercent, windowDurationMins = 300) => ({ usedPercent, windowDurationMins });
const snapshot = primary => ({ observedAt: new Date(now).toISOString(), rateLimitsByLimitId: { codex: { primary } } });

test('Codex policy is opt-in and other providers can explicitly disable it', () => {
    assert.equal(assessQuota(undefined).enabled, false);
    assert.equal(assessQuota(undefined, { provider: 'local-model', enabled: false }).mode, 'normal');
    assert.throws(() => normalizeQuotaPolicy({ provider: 'local-model' }), /disable/);
    assert.deepEqual(normalizeQuotaPolicy(policy), { provider: 'codex', stopClaimingRemainingPercent: 20, closeoutRemainingPercent: 10, maxAgeSeconds: 300, enabled: true });
    for (const config of [[], true, { maxAgeSeconds: 0 }, { stopClaimingRemainingPercent: NaN }, { closeoutRemainingPercent: -1 }, { closeoutRemainingPercent: 101 }, { closeoutRemainingPercent: 30 }, { enabled: 'false' }, { unknown: true }]) assert.throws(() => normalizeQuotaPolicy(config));
});
test('20 and 10 percent are inclusive policy boundaries', () => {
    for (const [used, expected] of [[0, 'normal'], [79.9, 'normal'], [80, 'drain'], [89.9, 'drain'], [90, 'closeout'], [100, 'closeout']]) assert.equal(assessQuota(snapshot(window(used)), policy, now).mode, expected);
});
test('all available windows constrain headroom regardless of primary duration', () => {
    const input = snapshot(window(10, 10080));
    input.rateLimitsByLimitId.codex.secondary = window(95, 300);
    const result = assessQuota(input, policy, now);
    assert.equal(result.mode, 'closeout'); assert.equal(result.remainingPercent, 5);
    assert.deepEqual(result.windows.map(w => w.durationMins), [10080, 300]);
    input.rateLimitsByLimitId.codex.primary = null;
    assert.equal(assessQuota(input, policy, now).remainingPercent, 5);
});
test('absent secondary and null usage are unavailable, not exhausted', () => {
    const input = snapshot(window(15));
    assert.equal(assessQuota(input, policy, now).remainingPercent, 85);
    input.rateLimitsByLimitId.codex.secondary = null;
    assert.equal(assessQuota(input, policy, now).mode, 'normal');
    input.rateLimitsByLimitId.codex.primary = window(null);
    assert.equal(assessQuota(input, policy, now).mode, 'unknown');
    assert.equal(assessQuota(input, policy, now).remainingPercent, null);
});
test('per-limit map isolates Codex and takes precedence over legacy', () => {
    const input = snapshot(window(10));
    input.rateLimitsByLimitId.other = { primary: window(100) };
    input.rateLimits = { primary: window(100) };
    assert.equal(assessQuota(input, policy, now).remainingPercent, 90);
    delete input.rateLimitsByLimitId.codex;
    assert.equal(assessQuota(input, policy, now).mode, 'unknown');
    delete input.rateLimitsByLimitId;
    assert.equal(assessQuota(input, policy, now).mode, 'closeout');
    input.rateLimits.limitId = 'other';
    assert.equal(assessQuota(input, policy, now).mode, 'unknown');
});
test('freshness rejects future, stale and timezone-less observations', () => {
    const input = snapshot(window(1));
    input.observedAt = new Date(now - 300000).toISOString();
    assert.equal(assessQuota(input, policy, now).mode, 'normal');
    input.observedAt = new Date(now - 300001).toISOString();
    assert.deepEqual(assessQuota(input, policy, now).reasons, ['quota-snapshot-stale']);
    input.observedAt = new Date(now + 1).toISOString();
    assert.deepEqual(assessQuota(input, policy, now).reasons, ['quota-snapshot-future']);
    input.observedAt = '2026-10-15T10:00:00';
    assert.equal(assessQuota(input, policy, now).mode, 'unknown');
});
test('malformed available window fails closed even beside a valid window', () => {
    for (const value of ['1', false, -1, 101, NaN, Infinity]) {
        const input = snapshot(window(1)); input.rateLimitsByLimitId.codex.secondary = window(value);
        assert.equal(assessQuota(input, policy, now).mode, 'unknown');
    }
    for (const duration of [null, undefined, 0, -1, '300', Infinity]) assert.equal(assessQuota(snapshot({ usedPercent: 1, windowDurationMins: duration }), policy, now).mode, 'unknown');
    assert.equal(assessQuota({}, policy, now).mode, 'unknown');
    assert.equal(assessQuota(null, policy, now).mode, 'unknown');
});
test('sanitizer keeps only host usage evidence and gate recomputes headroom', () => {
    const input = snapshot({ ...window(85), resetsAt: 12345, token: 'private', accountId: 'private' });
    input.accountId = 'private'; input.credits = { balance: 100 }; input.token = 'private'; input.remainingPercent = 100;
    input.rateLimitsByLimitId.other = { primary: window(0) };
    const clean = sanitizeQuotaSnapshot(input);
    assert.deepEqual(clean, { observedAt: new Date(now).toISOString(), rateLimitsByLimitId: { codex: { primary: { usedPercent: 85, windowDurationMins: 300, resetsAt: 12345 } } } });
    assert.equal(assessQuota(clean, policy, now).mode, 'drain');
    assert.equal(assessQuota(sanitizeQuotaSnapshot({ observedAt: input.observedAt, remainingPercent: 100 }), policy, now).mode, 'unknown');
    assert.equal(JSON.stringify(clean).includes('private'), false);
    input.rateLimitsByLimitId.codex.secondary = { usedPercent: 'private', windowDurationMins: 'private', resetsAt: 'private' };
    const invalid = sanitizeQuotaSnapshot(input);
    assert.equal(JSON.stringify(invalid).includes('private'), false);
    assert.equal(assessQuota(invalid, policy, now).mode, 'unknown');
});
