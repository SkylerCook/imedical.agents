'use strict';

// This is a host-snapshot policy, not a token, money or per-task cost estimator.
const DEFAULTS = Object.freeze({ provider: 'codex', stopClaimingRemainingPercent: 20, closeoutRemainingPercent: 10, maxAgeSeconds: 300 });
function normalizeQuotaPolicy(config) {
    if (config === undefined || config === null) return { enabled: false };
    if (typeof config !== 'object' || Array.isArray(config)) throw new TypeError('Quota policy must be an object');
    for (const key of Object.keys(config)) if (!['enabled', ...Object.keys(DEFAULTS)].includes(key)) throw new TypeError(`Unknown quota policy field: ${key}`);
    if (config.enabled !== undefined && typeof config.enabled !== 'boolean') throw new TypeError('Quota enabled must be boolean');
    if (config.enabled === false) return { enabled: false, ...(config.provider === undefined ? {} : { provider: config.provider }) };
    const policy = { ...DEFAULTS, ...config, enabled: true };
    if (policy.provider !== 'codex') throw new TypeError('Non-Codex providers must explicitly disable Codex quota policy');
    for (const key of ['stopClaimingRemainingPercent', 'closeoutRemainingPercent']) {
        if (!Number.isFinite(policy[key]) || policy[key] < 0 || policy[key] > 100) throw new TypeError(`Invalid quota threshold: ${key}`);
    }
    if (policy.closeoutRemainingPercent > policy.stopClaimingRemainingPercent) throw new TypeError('Closeout threshold cannot exceed stop-claiming threshold');
    if (!Number.isFinite(policy.maxAgeSeconds) || policy.maxAgeSeconds <= 0) throw new TypeError('Quota maxAgeSeconds must be positive');
    return policy;
}

function assessQuota(snapshot, config, now = Date.now()) {
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

module.exports = { normalizeQuotaPolicy, assessQuota, sanitizeQuotaSnapshot };
