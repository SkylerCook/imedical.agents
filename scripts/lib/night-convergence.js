'use strict';

// Optional, versioned extension to the existing night event projection. No runner
// or separate ledger: callers persist these records under the existing run lock.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { worktreeFingerprint } = require('../validation-evidence');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => typeof value === 'string' && value.trim().length > 0;
const refs = value => Array.isArray(value) && value.length > 0 && value.every(text);
const FEATURE = 'night-convergence/v1';
const enabled = manifest => manifest?.night?.policy?.convergence?.version === 1;

function normalize(input) {
    if (!input || input.version !== 1 || Object.keys(input).some(k => !['version', 'maxProblemAttempts', 'totalBudgetMinutes', 'demandBudgets'].includes(k))) throw new Error('Unsupported convergence policy');
    const result = { version: 1, maxProblemAttempts: 4, demandBudgets: {}, ...input };
    if (!Number.isInteger(result.maxProblemAttempts) || result.maxProblemAttempts < 1) throw new Error('Positive maxProblemAttempts required');
    if (!Number.isFinite(result.totalBudgetMinutes) || result.totalBudgetMinutes <= 0) throw new Error('Explicit positive totalBudgetMinutes required');
    if (!result.demandBudgets || Array.isArray(result.demandBudgets) || typeof result.demandBudgets !== 'object' || Object.entries(result.demandBudgets).some(([id, n]) => !text(id) || !Number.isFinite(n) || n <= 0)) throw new Error('Invalid demandBudgets');
    return result;
}

function totalMinutes(segments, now = Date.now()) {
    const intervals = [];
    for (const s of segments || []) {
        if (!['preparation', 'diagnosis', 'execute', 'wait', 'evidence', 'cleanup'].includes(s.phase)) throw new Error('Invalid total timing phase');
        const start = Date.parse(s.startedAt), end = s.endedAt === undefined ? now : Date.parse(s.endedAt);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end > now) throw new Error('Invalid total timing interval');
        if (s.phase !== 'cleanup') intervals.push([start, end]);
    }
    let used = 0, end = -Infinity;
    for (const [start, stop] of intervals.sort((a, b) => a[0] - b[0])) { used += Math.max(0, stop - Math.max(start, end)); end = Math.max(end, stop); }
    return used / 60000;
}

function state(manifest) { return manifest.night.convergence ||= { problems: [], bindings: [], events: [] }; }
function problems(manifest, id) { return manifest.night.convergence?.problems.filter(p => p.demandId === id) || []; }
function budget(manifest, record, now = Date.now()) {
    if (!enabled(manifest)) return null;
    const policy = manifest.night.policy.convergence;
    const limit = policy.demandBudgets[record.id] ?? policy.totalBudgetMinutes;
    const used = totalMinutes(record.timingSegments, now);
    return { totalBudgetMinutes: limit, usedMinutes: used, remainingMinutes: Math.max(0, limit - used) };
}

// Failure identity intentionally uses stable assertion names, not logs, paths,
// timestamps or evidence references. Evidence semantics remain a review duty.
function failureIdentity(result) {
    return { caseId: result.caseId, category: result.failureCategory || 'evidence', checks: (result.assertions || []).filter(a => a.passed !== true).map(a => a.name || a.id || 'assertion').sort() };
}
function observeFailure(manifest, record, result) {
    if (!enabled(manifest)) return;
    const signature = hash([result.caseId, result.failureCategory || 'evidence']), data = state(manifest);
    let p = data.problems.find(p => p.demandId === record.id && p.caseId === result.caseId && p.category === (result.failureCategory || 'evidence'));
    if (!p) {
        p = { problemId: `problem-${hash([record.id, signature]).slice(0, 24)}`, demandId: record.id, signature, caseId: result.caseId, category: result.failureCategory || 'evidence', attempts: [], failures: [], resolved: false };
        data.problems.push(p);
    }
    p.resolved = false;
    const receipt = hash(result);
    if (!p.failures.some(f => f.receipt === receipt)) p.failures.push({ receipt, signature: hash(failureIdentity(result)), version: result.version });
}

function hardReasons(manifest, record, phase, now = Date.now()) {
    if (!enabled(manifest) || phase === 'cleanup') return [];
    const reasons = [];
    try { if (budget(manifest, record, now).remainingMinutes <= 0) reasons.push('total-budget-exhausted'); } catch { reasons.push('total-timing-invalid'); }
    for (const p of problems(manifest, record.id).filter(p => !p.resolved)) {
        const active = p.attempts.find(a => !a.result);
        if (!active) reasons.push(p.attempts.length >= manifest.night.policy.convergence.maxProblemAttempts ? 'problem-attempts-exhausted' : 'problem-attempt-required');
    }
    return [...new Set(reasons)];
}

function scopedFingerprint(scopes) {
    if (!Array.isArray(scopes) || !scopes.length) throw new Error('Dependency sourceScopes required');
    for (const s of scopes) if (!path.isAbsolute(s.repoRoot || '') || !refs(s.scopes) || s.scopes.some(p => !fs.existsSync(path.resolve(s.repoRoot, p)))) throw new Error('Existing dependency scope required');
    return hash(scopes.map(s => ({ repoRoot: s.repoRoot, scopes: s.scopes, fingerprint: worktreeFingerprint(s.repoRoot, s.scopes).fingerprint })));
}
function bindings(manifest, id) { return manifest.night.convergence?.bindings.filter(b => b.demandId === id) || []; }
function dependencyReasons(manifest, record, final = false, visiting = new Set()) {
    if (!enabled(manifest)) return [];
    if (visiting.has(record.id)) return ['dependency-cycle'];
    const next = new Set(visiting).add(record.id), reasons = [];
    for (const b of bindings(manifest, record.id)) {
        const upstream = manifest.night.demands.find(d => d.id === b.upstreamId);
        if (!upstream) { reasons.push('dependency-missing'); continue; }
        try { if (scopedFingerprint(b.sourceScopes) !== b.scopeFingerprint) reasons.push('dependency-version-stale'); } catch { reasons.push('dependency-scope-unavailable'); }
        if (b.type === 'code') {
            try {
                if (!b.consumerScopes?.length || hash(b.sourceScopes.map(s => worktreeFingerprint(s.repoRoot, s.scopes).fingerprint)) !== hash(b.consumerScopes.map(s => worktreeFingerprint(s.repoRoot, s.scopes).fingerprint))) reasons.push('dependency-code-not-visible');
            } catch { reasons.push('dependency-code-not-visible'); }
        }
        reasons.push(...dependencyReasons(manifest, upstream, final, next));
        if (final && (!b.requiredChecks.every(id => upstream.checks?.some(c => c.id === id && c.status === 'passed' && c.evidenceRefs?.length && [b.upstreamVersion, upstream.frozenVersion].includes(c.frozenVersion))) || upstream.results?.knownDefect || upstream.results?.unknownWrite || upstream.resources?.pending || upstream.resources?.polluted || problems(manifest, upstream.id).some(p => !p.resolved))) reasons.push('dependency-verification-pending');
    }
    return [...new Set(reasons)];
}
function dependencyToken(manifest, id, visiting = new Set()) {
    if (visiting.has(id)) throw new Error('Dependency cycle');
    const next = new Set(visiting).add(id);
    return hash(bindings(manifest, id).map(b => ({ binding: b, actual: scopedFingerprint(b.sourceScopes), upstream: dependencyToken(manifest, b.upstreamId, next) })));
}

function environmentBindings(manifest, id, seen = new Set()) {
    if (seen.has(id)) return [];
    seen.add(id);
    return bindings(manifest, id).flatMap(b => [...(b.type === 'environment' ? [b] : []), ...environmentBindings(manifest, b.upstreamId, seen)]);
}

function recordEvent(manifest, input, now = Date.now()) {
    if (!enabled(manifest)) throw new Error('Night convergence is not enabled');
    if (!text(input.eventId)) throw new Error('Stable eventId required');
    const data = state(manifest), identity = hash(input), old = data.events.find(e => e.id === input.eventId);
    if (old) { if (old.hash !== identity) throw new Error('Conflicting convergence event'); return false; }
    const record = manifest.night.demands.find(d => d.id === input.demandId);
    if (!record) throw new Error('Unknown convergence demand');
    if (input.kind === 'problem') {
        if (!text(input.problemId) || !text(input.caseId) || !text(input.category)) throw new Error('Problem identity required');
        if (data.problems.some(p => p.problemId === input.problemId || p.demandId === record.id && p.caseId === input.caseId && p.category === input.category)) throw new Error('Problem already registered; preserve history');
        data.problems.push({ problemId: input.problemId, demandId: record.id, caseId: input.caseId, category: input.category, signature: hash([input.caseId, input.category]), attempts: [], failures: [], resolved: false, evidenceRefs: input.evidenceRefs });
    } else if (input.kind === 'attempt-start') {
        const p = data.problems.find(p => p.problemId === input.problemId && p.demandId === record.id);
        if (!p || p.resolved || p.attempts.some(a => !a.result)) throw new Error('Unresolved problem without active attempt required');
        if (p.attempts.length >= manifest.night.policy.convergence.maxProblemAttempts) throw new Error('problem-attempts-exhausted');
        if (budget(manifest, record, now).remainingMinutes <= 0 || now >= Date.parse(manifest.night.limits.stopAt)) throw new Error('total-budget-exhausted');
        if (!text(input.attemptId) || !text(input.hypothesis) || !text(input.change) || !text(input.expectedCheck) || !refs(input.newEvidenceRefs) || !text(input.evidenceSummary)) throw new Error('Attempt needs a testable hypothesis, change and new evidence');
        if (p.attempts.some(a => a.attemptId === input.attemptId || a.hypothesis === input.hypothesis && a.change === input.change && a.evidenceSummary === input.evidenceSummary)) throw new Error('repeated-failure-no-new-evidence');
        p.attempts.push({ attemptId: input.attemptId, hypothesis: input.hypothesis, change: input.change, expectedCheck: input.expectedCheck, newEvidenceRefs: input.newEvidenceRefs, evidenceSummary: input.evidenceSummary, startedAt: new Date(now).toISOString(), version: record.frozenVersion });
    } else if (input.kind === 'attempt-result') {
        const p = data.problems.find(p => p.problemId === input.problemId && p.demandId === record.id), attempt = p?.attempts.find(a => a.attemptId === input.attemptId);
        if (!attempt || attempt.result || !['resolved', 'failed', 'blocked'].includes(input.status)) throw new Error('Active attempt and valid result required');
        if (input.status === 'resolved' && !record.testReceipts?.some(r => r.caseId === p.caseId && r.status === 'passed' && r.frozenVersion === record.frozenVersion && r.convergenceAttemptIds?.includes(attempt.attemptId)) && !record.checks?.some(check => check.id === p.caseId && check.status === 'passed' && check.frozenVersion === record.frozenVersion && check.scopeFingerprint === record.scopeFingerprint && check.attemptId === attempt.attemptId && refs(check.evidenceRefs))) throw new Error('Resolution requires a current passing receipt from this attempt');
        attempt.result = { status: input.status, evidenceRefs: input.evidenceRefs, endedAt: new Date(now).toISOString() };
        p.resolved = input.status === 'resolved';
    } else if (input.kind === 'dependency-bind') {
        const b = input.binding, upstream = manifest.night.demands.find(d => d.id === b?.upstreamId);
        if (!upstream || upstream.id === record.id || !['information', 'contract', 'code', 'environment'].includes(b.type) || !refs(b.requiredChecks) || !refs(b.evidenceRefs) || b.upstreamVersion !== upstream.frozenVersion) throw new Error('Dependency requires current upstream version, checks and evidence');
        // Rebind only after pending operations have been reconciled.
        if (manifest.night.operations?.some(o => o.demandId === record.id && o.status === 'running')) throw new Error('Cannot rebind an active operation');
        const binding = { ...structuredClone(b), demandId: record.id, scopeFingerprint: scopedFingerprint(b.sourceScopes) };
        const covers = (sources, requested) => requested.every(s => sources?.some(owner => fs.realpathSync(owner.repoRoot) === fs.realpathSync(s.repoRoot) && s.scopes.every(p => owner.scopes.some(parent => parent === '.' || parent === p || p.startsWith(parent + '/')))));
        if (!covers(upstream.sourceScopes, b.sourceScopes)) throw new Error('Dependency scope outside upstream sourceScopes');
        if (b.type === 'code' && (!b.consumerScopes?.length || !covers(record.sourceScopes, b.consumerScopes))) throw new Error('Code consumption must be in consumer sourceScopes');
        const proposed = structuredClone(manifest);
        const list = state(proposed).bindings;
        const index = list.findIndex(x => x.demandId === record.id && x.upstreamId === b.upstreamId);
        if (index < 0) list.push(binding); else list[index] = binding;
        dependencyToken(proposed, record.id); // Reject cycles before mutation.
        if (dependencyReasons(proposed, record).length) throw new Error('Dependency code/scope is not available');
        data.bindings = list;
        record.candidateReady = false; delete record.automatedResult;
    } else throw new Error('Unknown convergence event');
    data.events.push({ id: input.eventId, hash: identity });
    return true;
}

module.exports = { FEATURE, enabled, normalize, totalMinutes, budget, problems, hardReasons, failureIdentity, observeFailure, scopedFingerprint, bindings, dependencyReasons, dependencyToken, environmentBindings, recordEvent };
