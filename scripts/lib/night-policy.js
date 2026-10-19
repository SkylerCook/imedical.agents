'use strict';

const { createHash } = require('node:crypto');
const convergence = require('./night-convergence');
const DEFAULTS = Object.freeze({ demandBudgetMinutes: 13, sharedPreparationBudgetMinutes: 30, humanEstimateMinutes: 6, auditSampleRate: 0.2, maxInFlight: 1 });
const ROUTES = ['static-review', 'internal-method', 'external-api', 'ui', 'manual'];
const KINDS = ['text', 'style', 'internal-logic', 'query', 'write', 'state', 'contract', 'ui', 'device', 'module-refactor'];
const text = value => typeof value === 'string' && value.trim().length > 0;
const list = value => Array.isArray(value) && value.length > 0 && value.every(text);
function normalizePolicy(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Policy must be an object');
    for (const key of Object.keys(input)) if (!Object.hasOwn(DEFAULTS, key) && key !== 'convergence') throw new TypeError(`Unknown policy field: ${key}`);
    const policy = { ...DEFAULTS, ...input };
    for (const [key, value] of Object.entries(policy)) {
        if (key === 'convergence') { policy.convergence = convergence.normalize(value); continue; }
        if (!Number.isFinite(value) || value <= 0 || (key === 'auditSampleRate' && value > 1) || (key === 'maxInFlight' && !Number.isInteger(value))) throw new TypeError(`Invalid policy field: ${key}`);
    }
    return policy;
}
function elapsedMinutes(segments, now) {
    if (!Array.isArray(segments)) throw new TypeError('timingSegments required');
    let milliseconds = 0;
    const intervals = [];
    for (const segment of segments) {
        if (!segment || !['preparation', 'diagnosis', 'execute', 'wait', 'evidence', 'cleanup'].includes(segment.phase) || !text(segment.startedAt) || (segment.endedAt !== undefined && !text(segment.endedAt))) throw new TypeError('Invalid timing segment');
        const start = Date.parse(segment.startedAt);
        const end = segment.endedAt === undefined ? now : Date.parse(segment.endedAt);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end > now) throw new TypeError('Invalid segment time');
        if (['preparation', 'diagnosis'].includes(segment.phase)) { milliseconds += end - start; intervals.push([start, end]); }
    }
    // 2.1 stage observations may contain detailed subsegments. Count their
    // actual interval once; legacy unlayered timing retains its original sum.
    if (segments.some(s => s.granularity === 'stage')) {
        let end = -Infinity; milliseconds = 0;
        for (const [start, stop] of intervals.sort((a,b) => a[0]-b[0])) { milliseconds += Math.max(0, stop-Math.max(start,end)); end = Math.max(end,stop); }
    }
    return milliseconds / 60000;
}
function assessDemand(record, stage, inputPolicy = {}, now = Date.now(), options = {}) {
    const policy = normalizePolicy(inputPolicy);
    if (!['pre', 'post', 'cleanup'].includes(stage) || !Number.isFinite(now)) throw new TypeError('Invalid stage or now');
    if (!record || !text(record.id)) throw new TypeError('Demand id required');
    // Safety reconciliation is never prevented by an exhausted development budget.
    if (stage === 'cleanup') return { allowed: true, reasons: [], route: 'cleanup', staticEligible: false };
    const reasons = [];
    const a = record.assessment?.[stage];
    if (!a || !['confirmed', 'uncertain', 'disputed'].includes(a.businessCertainty) || !['low', 'medium', 'high'].includes(a.risk) || !list(a.changeKinds) || a.changeKinds.some(k => !KINDS.includes(k)) || !list(a.evidenceRefs) || !text(a.rationale) || !text(a.reviewerId) || !list(a.minimumChecks) || !ROUTES.includes(a.route)) {
        return { allowed: false, reasons: ['assessment-incomplete'], route: null, staticEligible: false };
    }
    if (a.businessCertainty !== 'confirmed') reasons.push('business-question');
    if (record.blocked === true) reasons.push('demand-blocked');
    if ((a.changeKinds.includes('module-refactor') || a.risk === 'high') && !options.collaborationReady) reasons.push('collaboration-required');
    if (!text(record.implementationOwnerId)) reasons.push('implementation-owner-required');
    if (stage === 'post') {
        if (a.reviewerId === record.implementationOwnerId) reasons.push('independent-review-required');
        if (!text(record.scopeFingerprint) || !text(record.frozenVersion) || a.scopeFingerprint !== record.scopeFingerprint || a.frozenVersion !== record.frozenVersion) reasons.push('assessment-version-stale');
    }
    if (!record.results || typeof record.results.knownDefect !== 'boolean' || typeof record.results.unknownWrite !== 'boolean' || !record.resources || typeof record.resources.polluted !== 'boolean' || typeof record.resources.pending !== 'boolean') reasons.push('safety-state-unknown');
    if (record.results?.knownDefect) reasons.push('known-defect');
    if (record.results?.unknownWrite) reasons.push('unknown-write');
    if (record.resources?.polluted || record.resources?.pending) reasons.push('resource-reconciliation-required');
    let usedMinutes = null;
    try { usedMinutes = elapsedMinutes(record.timingSegments, now); } catch { reasons.push('timing-invalid'); }
    const reassessed = trigger => Array.isArray(record.timingSegments) && record.timingSegments.filter(s => ['preparation', 'diagnosis'].includes(s.phase)).every(s => s.endedAt !== undefined) && Array.isArray(record.reassessments) && record.reassessments.some(r => r && r.trigger === trigger && r.usedMinutes === usedMinutes && r.failureCount === record.failures?.length && text(r.rationale) && list(r.evidenceRefs) && text(record.scopeFingerprint) && text(record.frozenVersion) && r.scopeFingerprint === record.scopeFingerprint && r.frozenVersion === record.frozenVersion);
    if (usedMinutes !== null && usedMinutes >= policy.demandBudgetMinutes && !reassessed('demand-budget-exhausted')) reasons.push('demand-budget-exhausted');
    if (!Array.isArray(record.failures) || record.failures.some(f => !f || !text(f.category) || !text(f.evidenceFingerprint))) reasons.push('failure-history-invalid');
    else if (record.failures.length >= 2 && record.failures.at(-1).category === record.failures.at(-2).category && record.failures.at(-1).evidenceFingerprint === record.failures.at(-2).evidenceFingerprint && !reassessed('repeated-failure-no-new-evidence')) reasons.push('repeated-failure-no-new-evidence');
    const staticEligible = stage === 'post' && a.risk === 'low' && a.changeKinds.every(k => ['text', 'style'].includes(k)) && reasons.length === 0;
    if (a.route === 'static-review' && (a.risk !== 'low' || a.changeKinds.some(k => !['text', 'style'].includes(k)))) reasons.push('static-insufficient');
    if (a.route === 'internal-method' && a.changeKinds.some(k => ['write', 'state', 'contract', 'ui', 'style', 'text', 'device'].includes(k))) reasons.push('real-entry-required');
    if (a.route === 'external-api' && a.changeKinds.some(k => ['ui', 'style', 'text', 'device'].includes(k))) reasons.push('visible-behavior-required');
    if (a.route === 'manual' && (a.risk !== 'low' || a.changeKinds.some(k => !['text', 'style', 'ui', 'device'].includes(k)))) reasons.push('manual-route-insufficient');
    return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], route: a.route, staticEligible: staticEligible && reasons.length === 0, usedMinutes, remainingMinutes: usedMinutes === null ? null : Math.max(0, policy.demandBudgetMinutes - usedMinutes), minimumChecks: [...a.minimumChecks] };
}
function summarizeHumanBudget(records, inputPolicy = {}) {
    const policy = normalizePolicy(inputPolicy);
    if (!Array.isArray(records)) throw new TypeError('Records required');
    const seen = new Set();
    let minutes = 0, count = 0, eligibleCount = 0;
    for (const record of records) {
        if (!record || !text(record.id) || seen.has(record.id)) throw new TypeError('Unique demand ids required');
        seen.add(record.id);
        if (record.candidateReady !== true || record.blocked === true || record.results?.knownDefect !== false || record.results?.unknownWrite !== false || record.resources?.polluted !== false || record.resources?.pending !== false) continue;
        eligibleCount++;
        const estimate = record.humanEstimateMinutes ?? policy.humanEstimateMinutes;
        if (!Number.isFinite(estimate) || estimate < 0) throw new TypeError('Invalid human estimate');
        minutes += estimate;
        if ((record.assessment?.post || record.assessment?.pre)?.route === 'manual') count++;
    }
    const referenceMinutes = eligibleCount * policy.humanEstimateMinutes;
    return { count, eligibleCount, estimatedMinutes: minutes, referenceMinutes, requiresReassessment: minutes > referenceMinutes, manualShare: eligibleCount ? count / eligibleCount : 0 };
}
function selectAuditSample(batchId, frozenCandidates, rate = DEFAULTS.auditSampleRate) {
    if (!text(batchId) || !Array.isArray(frozenCandidates) || !Number.isFinite(rate) || rate <= 0 || rate > 1) throw new TypeError('Invalid sample input');
    const seen = new Set();
    const ranked = frozenCandidates.map(candidate => {
        if (!candidate || !text(candidate.id) || seen.has(candidate.id) || !text(candidate.scopeFingerprint) || !text(candidate.frozenVersion)) throw new TypeError('Unique frozen candidates required');
        seen.add(candidate.id);
        return { id: candidate.id, hash: createHash('sha256').update(`${batchId}\n${candidate.id}`).digest('hex') };
    });
    ranked.sort((a, b) => a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : a.id.localeCompare(b.id));
    return ranked.slice(0, Math.ceil(ranked.length * rate)).map(item => item.id);
}
module.exports = { normalizePolicy, assessDemand, summarizeHumanBudget, selectAuditSample };
