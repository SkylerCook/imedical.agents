'use strict';

// Read-only projections of the existing run. Missing observations remain null;
// planned staffing, estimated effort and elapsed work are different facts.
const path = require('node:path');
const { createHash } = require('node:crypto');
const { assessWeeklyQuota } = require('./night-quota');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const present = value => typeof value === 'string' && value.trim().length > 0;
const unique = values => [...new Set(values.filter(present))];
const list = value => Array.isArray(value) ? value : [];
const same = (a, b) => present(a) && present(b) && (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
const labels = { 'test-group': '测试组可演示', 'spot-check': '点测', manual: '专项人工', 'not-ready': '未就绪', skipped: '已跳过' };
function interval(segment, asOf) {
    const start = Date.parse(segment.startedAt), end = Date.parse(segment.endedAt || asOf);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [start, end] : null;
}
function minutes(intervals) {
    if (!intervals.length) return null;
    let total = 0, end = -Infinity;
    for (const [start, stop] of intervals.slice().sort((a, b) => a[0] - b[0])) { total += Math.max(0, stop - Math.max(start, end)); end = Math.max(end, stop); }
    return total / 60000;
}
function timings(manifest) {
    const items = new Map(list(manifest.workItems).map(w => [w.id, w]));
    const rows = [];
    const add = (s, demandId, shared) => {
        const item = items.get(s.workItemId);
        rows.push({ ...s, demandId, ownerId: s.ownerId || item?.ownerId || null, category: shared ? s.category || s.phase : item?.night?.phase || s.phase, shared, interval: interval(s, manifest.updatedAt) });
    };
    for (const record of list(manifest.night?.demands)) for (const s of list(record.timingSegments)) add(s, record.id, false);
    for (const s of list(manifest.night?.shared?.timingSegments)) add(s, null, true);
    return rows;
}
function currentReceipt(record, receipt) { return present(record.frozenVersion) && receipt.frozenVersion === record.frozenVersion; }
function demandReport(manifest, definition) {
    const id = definition.id, record = list(manifest.night?.demands).find(d => d.id === id) || {};
    const work = list(manifest.workItems).filter(w => w.night?.demandId === id);
    const tests = list(manifest.executionPlan?.minimumTests).filter(t => t.demandId === id);
    const receipts = list(record.testReceipts), current = receipts.filter(r => currentReceipt(record, r));
    const passed = current.filter(r => r.status === 'passed');
    const checks = list(record.checks).filter(c => c.frozenVersion === record.frozenVersion && c.scopeFingerprint === record.scopeFingerprint && c.status === 'passed');
    const reuse = list(record.evidenceReuse).filter(r => r.toVersion === record.frozenVersion && r.currentScopeFingerprint === record.scopeFingerprint);
    const reuseCheck = id => reuse.some(r => list(r.checkIds).includes(id) && !list(r.affectedChecks).includes(id));
    const plannedChecks = unique([...tests.filter(t => !['manual', 'not-applicable'].includes(t.level)).map(t => t.id), ...list(record.assessment?.post?.minimumChecks)]);
    const covered = id => {
        const test = tests.find(t => t.id === id);
        if (test && ['internal-method', 'external-api', 'ui'].includes(test.level)) return passed.some(r => r.caseId === id && r.level === test.level) || reuseCheck(id);
        return passed.some(r => r.caseId === id) || checks.some(c => c.id === id) || reuseCheck(id);
    };
    const missingChecks = plannedChecks.filter(id => !covered(id));
    const deployment = list(record.deploymentReceipts), published = deployment.filter(r => currentReceipt(record, r) && r.status === 'verified');
    const frozen = record.sourceSnapshot?.frozenVersion === record.frozenVersion && present(record.sourceSnapshot?.root);
    const skipped = record.skipped === true || present(record.skipped?.reason) || work.length > 0 && work.every(w => w.status === 'skipped');
    const manual = tests.some(t => t.level === 'manual') || record.assessment?.post?.route === 'manual';
    const safetyClosed = record.results?.knownDefect === false && record.results?.unknownWrite === false && record.resources?.pending === false && record.resources?.polluted === false;
    const blocked = record.blocked === true || ['blocked', 'unsupported'].includes(definition.feasibility) || record.results?.knownDefect === true || record.results?.unknownWrite === true || record.resources?.pending === true || record.resources?.polluted === true;
    let level = 'not-ready';
    if (skipped) level = 'skipped';
    else if (!blocked && safetyClosed && frozen && published.length && passed.length && plannedChecks.length && !missingChecks.length && !manual && record.candidateReady === true) level = 'test-group';
    else if (!blocked && passed.length) level = 'spot-check';
    else if (!blocked && manual) level = 'manual';
    const gaps = [];
    if (!Object.keys(record).length) gaps.push('尚无需求执行记录');
    if (definition.feasibility === 'blocked') gaps.push('缺少前置条件');
    if (definition.feasibility === 'unsupported') gaps.push('当前能力无法处理');
    if (record.results?.knownDefect) gaps.push('已知缺陷未闭合');
    if (record.results?.unknownWrite) gaps.push('写入结果未知，须独立回读');
    if (record.resources?.pending || record.resources?.polluted) gaps.push('资源或数据尚未核销');
    if (!safetyClosed && !skipped) gaps.push('安全状态未完整取证');
    if (!frozen && !skipped) gaps.push('没有当前版本的不可变冻结证据');
    if (!published.length && !skipped) gaps.push('没有当前版本的已验证发布回执');
    if (missingChecks.length) gaps.push(`最低检查未覆盖：${missingChecks.join(', ')}`);
    if (!passed.length && !skipped) gaps.push('没有当前版本的运行测试通过回执');
    if (receipts.some(r => !currentReceipt(record, r))) gaps.push('存在旧版本测试证据，单列保留');
    const review = [];
    for (const item of work.filter(w => w.night.phase === 'implementation')) {
        const worker = list(manifest.executionPlan?.workers).find(w => w.ownerId === item.ownerId);
        const source = worker?.repositories.find(r => same(r.target, item.repositoryRoot));
        if (!source) { review.push({ ownerId: item.ownerId, worktree: item.repositoryRoot || null, baseRevision: null, evidence: 'unknown' }); continue; }
        review.push({ ownerId: item.ownerId, worktree: source.target, sourceRepo: source.sourceRepo, baseRevision: source.revision, scopes: item.writeScopes || [], command: { executable: 'git', args: ['-C', source.target, 'diff', source.revision, '--', ...list(item.writeScopes)] }, evidence: 'planned-fixed-base' });
    }
    let nextStep = '核实前置条件并补齐最低测试证据';
    if (skipped) nextStep = '按跳过原因和交接条件决定是否恢复';
    else if (record.results?.unknownWrite || record.resources?.pending || record.resources?.polluted) nextStep = '先核对未知写入、数据处置与资源退出';
    else if (record.results?.knownDefect) nextStep = '由原 owner 返修并按当前冻结版本重新验证受影响范围';
    else if (level === 'test-group') nextStep = '按已验证版本、入口与用例组演示，等待用户验收';
    else if (level === 'manual') nextStep = '按专项人工步骤、预期结果与交接入口复验';
    else if (level === 'spot-check') nextStep = '保留已通过点测，补齐缺失最低检查和整体验证';
    return {
        id, sourceText: definition.sourceText || null, remarks: typeof definition.remarks === 'string' ? definition.remarks : null,
        assessment: { userAssessment: definition.userAssessment || null, feasibility: definition.feasibility || null, complexity: definition.complexity || null, risk: definition.risk || null },
        level, levelLabel: labels[level], frozenVersion: record.frozenVersion || null, scopeFingerprint: record.scopeFingerprint || null, codeReview: review,
        integration: { planned: manifest.executionPlan?.integration || null, recorded: record.integrationBinding || null },
        freeze: { verifiedRecord: !!frozen, artifactRoot: frozen ? record.sourceSnapshot.root : null, frozenVersion: record.sourceSnapshot?.frozenVersion || null, fileCount: list(record.sourceSnapshot?.files).length || null },
        publication: { current: published, other: deployment.filter(r => !published.includes(r)) },
        validation: { minimumTests: tests, currentReceipts: current, otherReceipts: receipts.filter(r => !current.includes(r)), currentChecks: checks, missingChecks },
        evidenceReuse: reuse,
        demo: { handoffReference: record.handoffRef || null, cases: passed.map(r => ({ caseId: r.caseId, level: r.level, scope: r.scope || null, evidenceRef: r.evidenceRef || null })), manual: tests.filter(t => ['manual', 'not-applicable'].includes(t.level)) },
        dataRetention: { planned: manifest.executionPlan?.dataRetention || null, recorded: record.dataRetention || record.retainedData || null, resources: record.resources || null, evidenceRefs: unique([...current.map(r => r.evidenceRef), record.handoffRef]), limitation: record.dataRetention || record.retainedData ? null : '资源状态不替代逐样本数据保留或处置回执，沿原测试证据复核' },
        skipped: work.filter(w => w.status === 'skipped').map(w => ({ workItemId: w.id, reason: w.night.skipReason || null, handoffRef: w.night.handoffRef || null })),
        gaps: unique(gaps), nextStep
    };
}
function developerConcurrency(manifest, rows) {
    const developers = list(manifest.executionPlan?.workers).filter(w => w.role === 'developer');
    const ids = new Set(developers.map(w => w.ownerId));
    const closed = rows.filter(r => ids.has(r.ownerId) && r.category === 'implementation' && r.endedAt && r.interval && r.interval[1] > r.interval[0]);
    const points = [];
    for (const row of closed) { points.push({ at: row.interval[0], owner: row.ownerId, delta: 1 }); points.push({ at: row.interval[1], owner: row.ownerId, delta: -1 }); }
    points.sort((a, b) => a.at - b.at || a.delta - b.delta);
    const active = new Map(); let previous = null, overlap = 0, peak = 0;
    for (const p of points) {
        if (previous !== null && active.size >= 2) overlap += p.at - previous;
        active.set(p.owner, (active.get(p.owner) || 0) + p.delta); if (active.get(p.owner) <= 0) active.delete(p.owner);
        peak = Math.max(peak, active.size); previous = p.at;
    }
    const observed = unique(closed.map(r => r.ownerId));
    return { plannedDevelopers: developers.length, observedDeveloperIds: observed, overlapMinutes: observed.length >= 2 ? overlap / 60000 : null, observedPeakDevelopers: points.length ? peak : null, verified: overlap > 0, conclusion: overlap > 0 ? '已记录至少两名 Developer 的实际重叠区间' : observed.length >= 2 ? '已记录两名 Developer 区间，但没有实际重叠' : '缺少两名 Developer 的完整区间，并行效果未验证' };
}
function deliveryWindows(events, rows) {
    const first = events.find(event => list(event.payload?.projectionPatches).some(patch => patch.op === 'set' && (/^\/night\/demands\/\d+\/candidateReady$/.test(patch.path) && patch.value === true || /^\/night\/demands\/\d+$/.test(patch.path) && patch.value?.candidateReady === true)));
    const boundary = Date.parse(first?.at);
    if (!Number.isFinite(boundary)) return { firstTechnicalCandidateAt: null, before: null, after: null, limitation: '缺少首个候选就绪的事件时间，不能用最后更新时间推算前期损失或后续收益' };
    const window = before => {
        const intervals = rows.filter(r => r.interval).map(r => before ? [r.interval[0], Math.min(r.interval[1],boundary)] : [Math.max(r.interval[0],boundary),r.interval[1]]).filter(([start,end]) => end > start);
        return { observedWallMinutes: minutes(intervals), tokens: null, weeklyPercentPoints: null };
    };
    return { firstTechnicalCandidateAt: first.at, before: window(true), after: window(false), limitation: '分别列首个技术候选前后投入，前段并非全部损失；失败、返工与人工另列。token/额度缺少该时点读数时未知，后续产出不抵销前期低效。' };
}
function costReport(manifest, events, rows) {
    const workers = list(manifest.executionPlan?.workers), participants = list(manifest.participants);
    const owners = unique([...workers.map(w => w.ownerId), ...participants.map(p => p.id)]);
    const byRole = owners.map(ownerId => {
        const selected = rows.filter(r => r.ownerId === ownerId);
        return { ownerId, role: workers.find(w => w.ownerId === ownerId)?.role || participants.find(p => p.id === ownerId)?.role || 'unknown', observedMinutes: minutes(selected.filter(r => r.interval).map(r => r.interval)), closedMinutes: minutes(selected.filter(r => r.endedAt && r.interval).map(r => r.interval)), openIntervals: selected.filter(r => !r.endedAt).length, invalidIntervals: selected.filter(r => !r.interval).length, observed: selected.length > 0 };
    });
    const phases = unique(rows.map(r => r.category)).map(category => ({ category, observedMinutes: minutes(rows.filter(r => r.category === category && r.interval).map(r => r.interval)) }));
    const shared = rows.filter(r => r.shared), times = interval({ startedAt: manifest.night?.startedAt || manifest.createdAt, endedAt: manifest.completedAt || manifest.updatedAt });
    const records = list(manifest.night?.demands), problems = manifest.night?.convergence?.problems;
    const failuresRecorded = records.length > 0 && records.every(r => Array.isArray(r.failures));
    const humanEvents = events.filter(e => e.payload?.actorKind === 'human' || e.payload?.humanIntervention === true || e.type === 'human.intervention');
    const cancelled = unique([...list(manifest.actions).filter(a => ['cancelled', 'canceled', 'withdrawn'].includes(a.status)).map(a => a.id), ...events.filter(e => /(?:cancelled|canceled|withdrawn)$/.test(e.type || '')).map(e => e.entityId || e.eventId)]);
    const usage = manifest.night?.usage;
    let weeklyQuotaAssessment = { enabled: false, mode: 'unknown', reasons: ['quota-observation-unavailable'] };
    if (manifest.night?.quotaPolicy) {
        try { weeklyQuotaAssessment = assessWeeklyQuota(manifest.night.weeklyQuota, manifest.night.quotaPolicy, Date.parse(manifest.updatedAt)); }
        catch (error) { weeklyQuotaAssessment = { enabled: true, mode: 'unknown', reasons: [error.message] }; }
    }
    return {
        budget: manifest.executionPlan?.budget || null,
        elapsedMinutes: times ? (times[1] - times[0]) / 60000 : null, elapsedBasis: times ? manifest.completedAt ? 'recorded-run-window' : 'recorded-window-through-last-update' : 'unknown',
        observedWallMinutes: minutes(rows.filter(r => r.interval).map(r => r.interval)), byRole, phases,
        planningGovernance: { observedMinutes: minutes(shared.filter(r => r.interval).map(r => r.interval)), unattributedMinutes: minutes(rows.filter(r => !r.ownerId && r.interval).map(r => r.interval)), limitation: shared.length ? '共享区间按现有记录统计，未声明 owner 的区间单列' : '尚无独立规划/治理计时观测' },
        deliveryWindows: deliveryWindows(events, rows),
        tokens: !usage?.unobservedGovernance && Number.isSafeInteger(usage?.totalTokens) && usage.totalTokens >= 0 ? usage.totalTokens : null,
        managedEndpointTokens: usage?.basis === 'managed-endpoints' ? usage.totalTokens : null,
        unobservedGovernanceReserve: usage?.unobservedGovernance ? manifest.executionPlan?.budget.governanceTokens ?? null : null,
        weeklyQuota: manifest.night?.weeklyQuota || null,
        weeklyQuotaAssessment,
        rework: { problemCount: Array.isArray(problems) ? problems.length : null, attemptCount: Array.isArray(problems) ? problems.reduce((n, p) => n + list(p.attempts).length, 0) : null, failedAttemptCount: Array.isArray(problems) ? problems.reduce((n, p) => n + list(p.attempts).filter(a => a.result?.status === 'failed').length, 0) : null },
        failures: { demandFailures: failuresRecorded ? records.reduce((n, r) => n + r.failures.length, 0) : null, failedActions: Array.isArray(manifest.actions) ? manifest.actions.filter(a => a.status === 'failed' || a.result?.status === 'failed' || a.completionResult?.status === 'failed').length : null },
        withdrawals: cancelled.length ? cancelled.length : Array.isArray(manifest.actions) && events.length ? 0 : null,
        human: { recordedInterventions: humanEvents.length || null, authorizationRequests: Array.isArray(manifest.actions) ? manifest.actions.filter(a => a.type === 'request-authorization').length : null, minutes: minutes(rows.filter(r => r.actorKind === 'human' && r.interval).map(r => r.interval)) },
        coverage: { demandRecords: records.length, plannedDemands: list(manifest.executionPlan?.demands).length || null, ownersWithTiming: byRole.filter(r => r.observed).length, owners: byRole.length },
        limitations: ['时长为已记录区间，角色时间之和包含并行重叠；stage/detail 通过区间并集去重。', 'token、人工或治理缺少真实观测时保留未知，不以预算或计划人数代替实际成本。']
    };
}
function meaningfulState(report) {
    return { status: report.status, acceptance: report.acceptance, demands: report.demands.map(d => ({ id: d.id, level: d.level, frozenVersion: d.frozenVersion, gaps: d.gaps })), developerConcurrencyVerified: report.developerConcurrency.verified, quota: report.costs.weeklyQuotaAssessment.mode, failures: report.costs.failures, withdrawals: report.costs.withdrawals, noDelivery: report.monitoring?.noDelivery };
}
function reportSignals(previous, current) {
    if (!previous) return [];
    const out = [];
    if (previous.status !== current.status) out.push({ kind: 'run-status', previous: previous.status, current: current.status });
    if (JSON.stringify(previous.acceptance) !== JSON.stringify(current.acceptance)) out.push({ kind: 'acceptance-state', current: current.acceptance });
    for (const demand of current.demands) {
        const old = previous.demands.find(d => d.id === demand.id);
        if (!old || hash([old.level, old.frozenVersion, old.gaps]) !== hash([demand.level, demand.frozenVersion, demand.gaps])) out.push({ kind: 'demand-change', demandId: demand.id, level: demand.level, gaps: demand.gaps });
    }
    if (previous.developerConcurrency.verified !== current.developerConcurrency.verified) out.push({ kind: 'developer-concurrency', verified: current.developerConcurrency.verified });
    const quotaBefore = previous.costs.weeklyQuotaAssessment.mode, quotaNow = current.costs.weeklyQuotaAssessment.mode;
    if (quotaBefore !== quotaNow) out.push({ kind: 'quota-state', error: quotaNow });
    for (const key of ['demandFailures','failedActions']) if (Number.isFinite(previous.costs.failures[key]) && Number.isFinite(current.costs.failures[key]) && current.costs.failures[key] > previous.costs.failures[key]) out.push({ kind: 'repeated-failure', counter: key, count: current.costs.failures[key] });
    if (Number.isFinite(previous.costs.withdrawals) && current.costs.withdrawals > previous.costs.withdrawals) out.push({ kind: 'candidate-withdrawal', count: current.costs.withdrawals });
    if (current.monitoring?.noDelivery === true && previous.monitoring?.noDelivery !== true) out.push({ kind: 'no-delivery', minutes: current.monitoring.elapsedMinutes });
    return out;
}
function buildNightReport(manifest, events = [], { previousReport } = {}) {
    if (!manifest || !present(manifest.runId)) throw new Error('Existing run manifest required');
    if (!Array.isArray(events)) throw new Error('Event array required');
    const declared = list(manifest.executionPlan?.demands), ids = unique([...declared.map(d => d.id), ...list(manifest.night?.demands).map(d => d.id), ...list(manifest.workItems).map(w => w.night?.demandId)]);
    const definitions = ids.map(id => declared.find(d => d.id === id) || { id });
    const rows = timings(manifest), issues = [];
    let expected = 1;
    for (const e of events) { if (e.sequence !== expected) issues.push(`event sequence expected ${expected}, got ${e.sequence}`); expected = e.sequence + 1; }
    if (!events.length) issues.push('没有可用事件历史，事件与人工统计可能不完整');
    if (events.length && events.at(-1).sequence !== manifest.eventLog?.lastSequence) issues.push('事件历史与 manifest sequence 不一致');
    const report = { schema: 'night-delivery-report/v1', runId: manifest.runId, planHash: manifest.orchestration?.planHash || null, asOf: manifest.updatedAt || null, status: manifest.status || 'unknown', acceptance: manifest.acceptance || null, provenance: { source: 'run-manifest-and-events', manifestSequence: manifest.eventLog?.lastSequence || null, eventCount: events.length, eventHistoryIssues: issues }, demands: definitions.map(d => demandReport(manifest, d)), costs: costReport(manifest, events, rows), developerConcurrency: developerConcurrency(manifest, rows) };
    report.summary = Object.fromEntries(Object.keys(labels).map(level => [level, report.demands.filter(d => d.level === level).length]));
    const threshold = manifest.executionPlan?.monitoring?.noDeliveryMinutes, elapsed = report.costs.elapsedMinutes;
    report.monitoring = { noDeliveryMinutes: Number.isFinite(threshold) && threshold > 0 ? threshold : null, elapsedMinutes: elapsed, noDelivery: Number.isFinite(threshold) && threshold > 0 && elapsed !== null ? elapsed >= threshold && report.summary['test-group'] + report.summary['spot-check'] === 0 : null };
    report.signalFingerprint = hash(meaningfulState(report)); report.signals = reportSignals(previousReport, report);
    return report;
}
const display = value => value === null || value === undefined ? '未知' : String(value);
const quote = value => display(value).split(/\r?\n/).map(line => `> ${line}`).join('\n');
function renderNightReport(report) {
    const lines = [`# 夜跑交付报告：${report.runId}`, '', `截至：${display(report.asOf)}；run：${report.status}；用户验收：${display(report.acceptance?.status)}。`, '', `测试组可演示 ${report.summary['test-group']}；点测 ${report.summary['spot-check']}；专项人工 ${report.summary.manual}；未就绪 ${report.summary['not-ready']}；已跳过 ${report.summary.skipped}。`, '', '## 逐需求交付', ''];
    for (const d of report.demands) {
        lines.push(`### ${d.id} · ${d.levelLabel}`, '', quote(d.sourceText), '', `原始备注：${display(d.remarks)}。`, `可执行性：${display(d.assessment.feasibility)}；复杂度：${display(d.assessment.complexity)}；风险：${display(d.assessment.risk)}。`, '', `冻结版本：${display(d.frozenVersion)}；冻结证据：${d.freeze.verifiedRecord ? '有当前记录' : '未取证'}；当前发布回执 ${d.publication.current.length}；当前测试回执 ${d.validation.currentReceipts.length}；复用审查 ${d.evidenceReuse.length}。`, '');
        for (const review of d.codeReview) lines.push(`- 代码审阅：${review.worktree ? `[${review.ownerId}](<${review.worktree}>)` : review.ownerId}；固定基点 ${display(review.baseRevision)}；基点来源 ${review.evidence}。`);
        lines.push(`- 集成计划：${display(d.integration.planned?.strategy)}；owner ${display(d.integration.planned?.ownerId)}；实际集成记录：${d.integration.recorded ? `${d.integration.recorded.ownerId || '未知 owner'} / ${display(d.integration.recorded.repositoryRoot)}` : '未记录'}。`);
        if (d.freeze.artifactRoot) lines.push(`- 冻结源码：[查看](<${d.freeze.artifactRoot}>)；版本 ${display(d.freeze.frozenVersion)}。`);
        for (const receipt of d.publication.current) lines.push(`- 当前发布：${receipt.status}；${unique(list(receipt.evidenceRefs)).map(ref => `[证据](<${ref}>)`).join('、') || '缺少证据引用'}。`);
        for (const receipt of d.validation.otherReceipts) lines.push(`- 旧版/其他测试：${display(receipt.caseId)}；${display(receipt.frozenVersion)}；${display(receipt.status)}；${receipt.evidenceRef ? `[证据](<${receipt.evidenceRef}>)` : '缺少证据引用'}。`);
        for (const reuse of d.evidenceReuse) lines.push(`- 复用审查：${display(reuse.fromVersion)} → ${display(reuse.toVersion)}；reviewer ${display(reuse.reviewerId)}；检查 ${list(reuse.checkIds).join(', ')}；${unique(list(reuse.evidenceRefs)).map(ref => `[证据](<${ref}>)`).join('、') || '缺少证据引用'}。`);
        for (const c of d.demo.cases) lines.push(`- 点测/演示：${c.caseId}（${display(c.level)}）；证据 ${c.evidenceRef ? `[查看](<${c.evidenceRef}>)` : '未知'}。`);
        for (const c of d.demo.manual) lines.push(`- 人工/不适用：${c.id}；预期 ${c.expectedResult}；理由 ${c.rationale}。`);
        for (const skip of d.skipped) lines.push(`- 跳过：${skip.workItemId}；${display(skip.reason)}；交接 ${display(skip.handoffRef)}。`);
        if (d.demo.handoffReference) lines.push(`- 复验入口/交接：${d.demo.handoffReference}。`);
        lines.push(`- 数据安排：${display(d.dataRetention.planned?.mode)}；${display(d.dataRetention.planned?.handoff)}。`, `- 数据实际回执：${d.dataRetention.recorded ? '已记录，沿原证据核对' : '未知'}；${d.dataRetention.limitation || '资源退出仍须独立核验'}。`, `- 缺口：${d.gaps.length ? d.gaps.join('；') : '当前报告范围内未发现缺口'}。`, `- 下一步：${d.nextStep}。`, '');
    }
    lines.push('## 成本与并行证据', '', `已记录 elapsed：${display(report.costs.elapsedMinutes)} 分钟（${report.costs.elapsedBasis}）；区间并集：${display(report.costs.observedWallMinutes)} 分钟；token：${display(report.costs.tokens)}。`, '', '| Owner | 角色 | 观测分钟 | 已闭合分钟 | 未闭合区间 |', '| --- | --- | ---: | ---: | ---: |');
    for (const role of report.costs.byRole) lines.push(`| ${role.ownerId} | ${role.role} | ${display(role.observedMinutes)} | ${display(role.closedMinutes)} | ${role.openIntervals} |`);
    lines.push('', `首个技术候选：${display(report.costs.deliveryWindows.firstTechnicalCandidateAt)}；此前观测投入 ${display(report.costs.deliveryWindows.before?.observedWallMinutes)} 分钟；此后观测投入 ${display(report.costs.deliveryWindows.after?.observedWallMinutes)} 分钟。${report.costs.deliveryWindows.limitation}`);
    lines.push('', `规划/治理共享观测：${display(report.costs.planningGovernance.observedMinutes)} 分钟；未归属 owner：${display(report.costs.planningGovernance.unattributedMinutes)} 分钟。`, `返工尝试：${display(report.costs.rework.attemptCount)}；需求失败：${display(report.costs.failures.demandFailures)}；失败 action：${display(report.costs.failures.failedActions)}；撤回：${display(report.costs.withdrawals)}；人工介入：${display(report.costs.human.recordedInterventions)}（${display(report.costs.human.minutes)} 分钟）。`, '', `Developer：计划 ${report.developerConcurrency.plannedDevelopers}；已记录完整区间的 owner ${report.developerConcurrency.observedDeveloperIds.join(', ') || '未知'}；重叠 ${display(report.developerConcurrency.overlapMinutes)} 分钟。${report.developerConcurrency.conclusion}。`, '');
    for (const limitation of [...report.costs.limitations, ...report.provenance.eventHistoryIssues]) lines.push(`- ${limitation}`);
    return lines.join('\n') + '\n';
}
module.exports = { buildNightReport, renderNightReport, reportSignals };
