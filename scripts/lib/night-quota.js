'use strict';

// Percent points are measured from host quota windows, never estimated from tokens.
const DEFAULTS = Object.freeze({ provider: 'codex', stopClaimingRemainingPercent: 20, closeoutRemainingPercent: 10, maxAgeSeconds: 300 });
const WEEKLY_MINUTES = 10080;
const WEEKLY_SCHEMA = 'night-weekly-quota/v1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
function normalizeQuotaPolicy(config) {
    if (config === undefined || config === null) return { enabled: false };
    if (typeof config !== 'object' || Array.isArray(config)) throw new TypeError('Quota policy must be an object');
    for (const key of Object.keys(config)) if (!['enabled', 'weeklyBudgetPercentPoints', ...Object.keys(DEFAULTS)].includes(key)) throw new TypeError(`Unknown quota policy field: ${key}`);
    if (config.enabled !== undefined && typeof config.enabled !== 'boolean') throw new TypeError('Quota enabled must be boolean');
    if (config.enabled === false) return { enabled: false, ...(config.provider === undefined ? {} : { provider: config.provider }) };
    const policy = { ...DEFAULTS, ...config, enabled: true };
    if (policy.provider !== 'codex') throw new TypeError('Non-Codex providers must explicitly disable Codex quota policy');
    for (const key of ['stopClaimingRemainingPercent', 'closeoutRemainingPercent']) {
        if (!Number.isFinite(policy[key]) || policy[key] < 0 || policy[key] > 100) throw new TypeError(`Invalid quota threshold: ${key}`);
    }
    if (policy.closeoutRemainingPercent > policy.stopClaimingRemainingPercent) throw new TypeError('Closeout threshold cannot exceed stop-claiming threshold');
    if (!Number.isFinite(policy.maxAgeSeconds) || policy.maxAgeSeconds <= 0) throw new TypeError('Quota maxAgeSeconds must be positive');
    if (policy.weeklyBudgetPercentPoints !== undefined && (!Number.isFinite(policy.weeklyBudgetPercentPoints) || policy.weeklyBudgetPercentPoints <= 0 || policy.weeklyBudgetPercentPoints > 100)) throw new TypeError('weeklyBudgetPercentPoints must be greater than zero and at most 100');
    return policy;
}

function assessQuota(snapshot, config, now = Date.now(), weeklyState) {
    const headroom = assessHeadroom(snapshot, config, now);
    const policy = normalizeQuotaPolicy(config);
    if (!policy.enabled || policy.weeklyBudgetPercentPoints === undefined) return headroom;
    const weekly = assessWeeklyQuota(weeklyState, policy, now);
    const order = { normal: 0, drain: 1, unknown: 2, closeout: 3 };
    return { ...headroom, mode: order[weekly.mode] > order[headroom.mode] ? weekly.mode : headroom.mode,
        reasons: [...new Set([...headroom.reasons, ...weekly.reasons])], weekly };
}

function assessHeadroom(snapshot, config, now = Date.now()) {
    const policy = normalizeQuotaPolicy(config);
    if (!policy.enabled) return { enabled: false, mode: 'normal', reasons: ['quota-policy-disabled'], remainingPercent: null, windows: [] };
    const result = { enabled: true, mode: 'unknown', reasons: [], remainingPercent: null, windows: [] };
    if (!Number.isFinite(now)) throw new TypeError('Quota evaluation time must be finite');
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { ...result, reasons: ['quota-snapshot-missing'] };
    const observed = typeof snapshot.observedAt === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(snapshot.observedAt) ? Date.parse(snapshot.observedAt) : NaN;
    if (!Number.isFinite(observed)) return { ...result, reasons: ['quota-observed-at-invalid'] };
    if (observed > now) return { ...result, reasons: ['quota-snapshot-future'] };
    if (now - observed > policy.maxAgeSeconds * 1000) return { ...result, reasons: ['quota-snapshot-stale'] };
    let bucket;
    // A present per-limit mapping is authoritative. Never borrow another product's allowance.
    if (snapshot.rateLimitsByLimitId !== undefined && snapshot.rateLimitsByLimitId !== null) {
        const mapping = snapshot.rateLimitsByLimitId;
        if (typeof mapping !== 'object' || Array.isArray(mapping)) return { ...result, reasons: ['quota-limit-map-invalid'] };
        bucket = Object.hasOwn(mapping, 'codex') ? mapping.codex : undefined;
    } else {
        bucket = snapshot.rateLimits;
    }
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return { ...result, reasons: ['quota-applicable-bucket-unavailable'] };
    if (bucket.limitId !== undefined && bucket.limitId !== null && bucket.limitId !== 'codex') return { ...result, reasons: ['quota-bucket-mismatch'] };
    for (const window of ['primary', 'secondary']) {
        const value = bucket[window];
        if (value === undefined || value === null) continue;
        if (typeof value !== 'object' || Array.isArray(value)) {
            result.reasons.push(`quota-window-invalid:${window}`); continue;
        }
        // Null/missing is unavailable, never zero consumed or zero remaining.
        if (value.usedPercent === undefined || value.usedPercent === null) continue;
        if (!Number.isFinite(value.usedPercent) || value.usedPercent < 0 || value.usedPercent > 100) {
            result.reasons.push(`quota-used-percent-invalid:${window}`); continue;
        }
        if (!Number.isFinite(value.windowDurationMins) || value.windowDurationMins <= 0) {
            result.reasons.push(`quota-window-duration-invalid:${window}`); continue;
        }
        result.windows.push({ bucket: 'codex', window, durationMins: value.windowDurationMins, remainingPercent: 100 - value.usedPercent });
    }
    if (result.reasons.length) return result;
    if (!result.windows.length) return { ...result, reasons: ['quota-windows-unavailable'] };
    result.remainingPercent = Math.min(...result.windows.map(window => window.remainingPercent));
    if (result.remainingPercent <= policy.closeoutRemainingPercent) {
        result.mode = 'closeout'; result.reasons.push('quota-closeout-threshold');
    } else if (result.remainingPercent <= policy.stopClaimingRemainingPercent) {
        result.mode = 'drain'; result.reasons.push('quota-stop-claiming-threshold');
    } else {
        result.mode = 'normal';
    }
    return result;
}

function sanitizeQuotaSnapshot(snapshot) {
    const output = { observedAt: null, rateLimitsByLimitId: {} };
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return output;
    if (typeof snapshot.observedAt === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(snapshot.observedAt) && Number.isFinite(Date.parse(snapshot.observedAt))) output.observedAt = snapshot.observedAt;
    let bucket;
    if (snapshot.rateLimitsByLimitId !== undefined && snapshot.rateLimitsByLimitId !== null) {
        const mapping = snapshot.rateLimitsByLimitId;
        if (typeof mapping !== 'object' || Array.isArray(mapping)) return output;
        bucket = Object.hasOwn(mapping, 'codex') ? mapping.codex : undefined;
    } else bucket = snapshot.rateLimits;
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket) || (bucket.limitId != null && bucket.limitId !== 'codex')) return output;
    const clean = {};
    for (const name of ['primary', 'secondary']) {
        const value = bucket[name];
        if (value === undefined || value === null) continue;
        if (typeof value !== 'object' || Array.isArray(value)) {
            clean[name] = { usedPercent: 'invalid', windowDurationMins: null }; continue;
        }
        clean[name] = {
            usedPercent: value.usedPercent == null ? null : typeof value.usedPercent === 'number' && Number.isFinite(value.usedPercent) ? value.usedPercent : 'invalid',
            windowDurationMins: typeof value.windowDurationMins === 'number' && Number.isFinite(value.windowDurationMins) ? value.windowDurationMins : null
        };
        if (typeof value.resetsAt === 'number' && Number.isFinite(value.resetsAt)) clean[name].resetsAt = value.resetsAt;
    }
    output.rateLimitsByLimitId.codex = clean;
    return output;
}

function weeklyWindow(snapshot, policy, now) {
    const headroom = assessHeadroom(snapshot, policy, now);
    if (headroom.mode === 'unknown') return { reasons: headroom.reasons };
    const clean = sanitizeQuotaSnapshot(snapshot);
    const windows = Object.entries(clean.rateLimitsByLimitId.codex || {}).filter(([, value]) => value.windowDurationMins === WEEKLY_MINUTES);
    if (windows.length !== 1) return { reasons: [windows.length ? 'quota-weekly-window-ambiguous' : 'quota-weekly-window-unavailable'] };
    const [window, value] = windows[0];
    if (!Number.isFinite(value.usedPercent) || value.usedPercent < 0 || value.usedPercent > 100) return { reasons: ['quota-weekly-used-percent-invalid'] };
    if (!Number.isSafeInteger(value.resetsAt) || value.resetsAt <= 0) return { reasons: ['quota-weekly-reset-invalid'] };
    const reset = value.resetsAt * 1000, observed = timestamp(clean.observedAt);
    if (reset <= now || observed < reset - WEEKLY_MINUTES * 60000) return { reasons: ['quota-weekly-window-reset'] };
    return { bucket: 'codex', window, ...value, observedAt: clean.observedAt, snapshot: clean, reasons: [] };
}

// The owner persists this BEFORE PLAN and reuses the same budgetId/reference across runs.
// No helper creates a replacement baseline, even when the quota window has reset.
function createWeeklyBaseline(snapshot, config, { now = Date.now(), budgetId } = {}) {
    const policy = normalizeQuotaPolicy(config);
    if (!policy.enabled || policy.weeklyBudgetPercentPoints === undefined) throw new Error('Weekly quota budget is not enabled');
    if (typeof budgetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(budgetId)) throw new TypeError('A stable weekly budgetId is required');
    const value = weeklyWindow(snapshot, policy, now);
    if (value.reasons.length) throw new Error(`Cannot create weekly quota baseline: ${value.reasons.join(', ')}`);
    return { schema: WEEKLY_SCHEMA, budgetId, provider: 'codex', bucket: value.bucket, durationMins: WEEKLY_MINUTES,
        resetsAt: value.resetsAt, baselineUsedPercent: value.usedPercent, baselineObservedAt: value.observedAt,
        budgetPercentPoints: policy.weeklyBudgetPercentPoints, latestSnapshot: value.snapshot, highWaterUsedPercent: value.usedPercent };
}

function assessWeeklyQuota(state, config, now = Date.now()) {
    const policy = normalizeQuotaPolicy(config);
    if (!Number.isFinite(now)) throw new TypeError('Quota evaluation time must be finite');
    if (!policy.enabled || policy.weeklyBudgetPercentPoints === undefined) return { enabled: false, mode: 'normal', reasons: ['quota-weekly-budget-disabled'] };
    const result = { enabled: true, mode: 'unknown', reasons: [], consumedPercentPoints: null, budgetRatio: null };
    if (!object(state)) return { ...result, reasons: ['quota-weekly-baseline-missing'] };
    if (state.schema !== WEEKLY_SCHEMA || typeof state.budgetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(state.budgetId) || state.provider !== 'codex' || state.bucket !== 'codex' || state.durationMins !== WEEKLY_MINUTES || !Number.isSafeInteger(state.resetsAt) || state.resetsAt <= 0 || !Number.isFinite(state.baselineUsedPercent) || state.baselineUsedPercent < 0 || state.baselineUsedPercent > 100 || !Number.isFinite(state.highWaterUsedPercent) || state.highWaterUsedPercent < state.baselineUsedPercent || state.highWaterUsedPercent > 100 || !Number.isFinite(timestamp(state.baselineObservedAt)) || timestamp(state.baselineObservedAt) > now) return { ...result, reasons: ['quota-weekly-baseline-invalid'] };
    if (state.budgetPercentPoints !== policy.weeklyBudgetPercentPoints) return { ...result, reasons: ['quota-weekly-budget-mismatch'] };
    if (state.observationError !== undefined) return { ...result, reasons: ['quota-weekly-snapshot-backwards'] };
    if (state.resetsAt * 1000 <= now || timestamp(state.baselineObservedAt) < state.resetsAt * 1000 - WEEKLY_MINUTES * 60000 || timestamp(state.baselineObservedAt) >= state.resetsAt * 1000) return { ...result, reasons: ['quota-weekly-window-reset'] };
    const latest = weeklyWindow(state.latestSnapshot, policy, now);
    if (latest.reasons.length) return { ...result, reasons: latest.reasons };
    if (latest.bucket !== state.bucket || latest.resetsAt !== state.resetsAt) return { ...result, reasons: ['quota-weekly-window-changed'] };
    if (timestamp(latest.observedAt) < timestamp(state.baselineObservedAt)) return { ...result, reasons: ['quota-weekly-snapshot-backwards'] };
    if (latest.usedPercent > state.highWaterUsedPercent) return { ...result, reasons: ['quota-weekly-highwater-not-recorded'] };
    // Compare points directly; division is only a reporting field. Decimal snapshots
    // are rounded to ten places so 0.3 - 0.1 cannot evade an inclusive boundary.
    const consumedPercentPoints = Number((state.highWaterUsedPercent - state.baselineUsedPercent).toFixed(10));
    const budgetRatio = consumedPercentPoints / state.budgetPercentPoints;
    const mode = consumedPercentPoints >= state.budgetPercentPoints ? 'closeout' : consumedPercentPoints >= Number((state.budgetPercentPoints * 0.8).toFixed(10)) ? 'drain' : 'normal';
    return { ...result, mode, reasons: mode === 'normal' ? [] : [mode === 'drain' ? 'quota-weekly-stop-claiming-threshold' : 'quota-weekly-closeout-threshold'], consumedPercentPoints, budgetRatio,
        budgetId: state.budgetId, budgetPercentPoints: state.budgetPercentPoints, highWaterUsedPercent: state.highWaterUsedPercent, resetsAt: state.resetsAt };
}

function advanceWeeklyQuota(state, snapshot, config, now = Date.now()) {
    const policy = normalizeQuotaPolicy(config);
    if (!object(state)) throw new Error('Weekly quota baseline must already be persisted');
    // Refuse corrupt state before accepting new evidence; stale/missing latest
    // evidence is recoverable, a changed/reset identity is never rebased.
    const previous = assessWeeklyQuota(state, policy, now);
    if (previous.reasons.some(reason => ['quota-weekly-baseline-invalid', 'quota-weekly-budget-mismatch'].includes(reason))) throw new Error(previous.reasons.join(', '));
    const clean = sanitizeQuotaSnapshot(snapshot);
    const value = weeklyWindow(clean, policy, now);
    const next = { ...structuredClone(state), latestSnapshot: clean };
    if (Number.isFinite(timestamp(state.latestSnapshot?.observedAt)) && Number.isFinite(timestamp(clean.observedAt)) && timestamp(clean.observedAt) < timestamp(state.latestSnapshot.observedAt)) {
        const held = { ...structuredClone(state), observationError: 'quota-weekly-snapshot-backwards' };
        return { state: held, assessment: { ...previous, mode: 'unknown', reasons: [...new Set([...value.reasons, 'quota-weekly-snapshot-backwards'])] } };
    }
    delete next.observationError;
    if (!value.reasons.length && value.bucket === state.bucket && value.resetsAt === state.resetsAt) next.highWaterUsedPercent = Math.max(state.highWaterUsedPercent, value.usedPercent);
    return { state: next, assessment: assessWeeklyQuota(next, policy, now) };
}

module.exports = { normalizeQuotaPolicy, assessQuota, sanitizeQuotaSnapshot, sanitizeSnapshot: sanitizeQuotaSnapshot,
    createWeeklyBaseline, advanceWeeklyQuota, assessWeeklyQuota };
