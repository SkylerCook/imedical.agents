'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildNightReport, renderNightReport } = require('../lib/night-report');
const { main } = require('../night-report');
function fixture() {
    const root = path.resolve('report-fixture'), at = minute => `2026-10-19T00:${String(minute).padStart(2, '0')}:00Z`;
    const plan = require('./fixtures/night-plan').executionPlanFixture({ root });
    plan.demands = Array.from({ length: 5 }, (_, i) => ({ ...plan.demands[0], id: `D${i + 1}`, sourceText: `Original demand ${i + 1}`, remarks: `Original remark ${i + 1}` }));
    plan.demands[3].feasibility = 'blocked';
    plan.minimumTests = plan.demands.map((d, i) => ({ ...plan.minimumTests[0], id: `case-${i + 1}`, demandId: d.id, level: i === 2 || i === 3 ? 'manual' : 'external-api' }));
    const m = { schemaVersion: '2.1', runId: 'report-run', status: 'running', createdAt: at(0), updatedAt: at(20), coordinatorId: 'leader', orchestration: { planHash: 'bound-plan' }, executionPlan: plan, participants: plan.workers.map(w => ({ id: w.ownerId, role: w.role })), workItems: [], actions: [], acceptance: { status: 'acceptance-pending' }, night: { demands: [], shared: { timingSegments: [{ ownerId: 'leader', phase: 'preparation', startedAt: at(0), endedAt: at(2) }] }, convergence: { problems: [{ problemId: 'repair', attempts: [{ attemptId: 'try-1', result: { status: 'failed' } }] }] } }, eventLog: { lastSequence: 1 } };
    for (let i = 0; i < 5; i++) {
        const id = `D${i + 1}`, owner = i === 1 ? 'dev-b' : 'dev-a', worker = plan.workers.find(w => w.ownerId === owner);
        m.workItems.push({ id: `${id}-implementation`, ownerId: owner, repositoryRoot: worker.repositories[0].target, writeScopes: [`d${i + 1}.js`], status: i === 4 ? 'skipped' : 'completed', night: { demandId: id, phase: 'implementation', ...(i === 4 ? { skipReason: 'source-missing', handoffRef: 'handoff:missing-source' } : {}) } });
        if (i === 3) continue;
        m.night.demands.push({ id, implementationOwnerId: owner, candidateReady: i === 0, frozenVersion: `${id}-v1`, scopeFingerprint: `${id}-scope`, assessment: { post: { route: i === 2 ? 'manual' : 'external-api', minimumChecks: [`case-${i + 1}`] } }, results: { knownDefect: false, unknownWrite: false }, resources: { pending: false, polluted: false }, failures: [], checks: [], timingSegments: [], testReceipts: [], deploymentReceipts: [] });
    }
    const d1 = m.night.demands[0], d2 = m.night.demands[1];
    d1.timingSegments = [{ phase: 'diagnosis', granularity: 'stage', workItemId: 'D1-implementation', startedAt: at(0), endedAt: at(10) }, { phase: 'diagnosis', granularity: 'detail', workItemId: 'D1-implementation', startedAt: at(1), endedAt: at(5) }];
    d2.timingSegments = [{ phase: 'diagnosis', granularity: 'stage', workItemId: 'D2-implementation', startedAt: at(5), endedAt: at(15) }];
    for (const d of [d1, d2]) d.testReceipts = [{ status: 'passed', caseId: d.id === 'D1' ? 'case-1' : 'case-2', frozenVersion: d.frozenVersion, level: 'external-api', evidenceRef: `${d.id}:actual-receipt` }];
    d1.sourceSnapshot = { frozenVersion: d1.frozenVersion, root: path.join(root, 'frozen/D1'), files: [{ relative: 'd1.js' }] };
    d1.integrationBinding = { ownerId: 'leader', repositoryRoot: root };
    d1.deploymentReceipts = [{ status: 'verified', frozenVersion: d1.frozenVersion, evidenceRefs: ['actual:publication'] }];
    m.workItems.push({ id: 'D1-deployment', ownerId: 'dev-a', status: 'completed', night: { demandId: 'D1', phase: 'deployment' } });
    d1.evidenceReuse = [{ reviewerId: 'reviewer', fromVersion: 'D1-v0', toVersion: 'D1-v1', currentScopeFingerprint: d1.scopeFingerprint, checkIds: ['extra-check'], affectedChecks: [], evidenceRefs: ['impact:review'] }];
    return { m, events: [{ sequence: 1, at: at(20), type: 'night.recorded', payload: { kind: 'demand' } }], at };
}
test('approved static checks are handoff-ready without inventing runtime or publication evidence', () => {
    const { m, events } = fixture(), d = m.night.demands[0];
    m.workItems = m.workItems.filter(w => w.id !== 'D1-deployment');
    m.executionPlan.minimumTests.find(t => t.demandId === d.id).level = 'static-review';
    d.assessment.post.route = 'static-review'; d.testReceipts = []; d.deploymentReceipts = [];
    d.checks = [{ id: 'case-1', status: 'passed', frozenVersion: d.frozenVersion, scopeFingerprint: d.scopeFingerprint, evidenceRefs: ['review:actual'] }];
    const row = buildNightReport(m, events).demands[0];
    assert.equal(row.level, 'handoff-ready'); assert.equal(row.handoff.ready, true); assert.deepEqual(row.validation.missingChecks, []);
    assert.equal(row.evidenceLevel.runtimeExecuted, false); assert.deepEqual(row.evidenceLevel.actual, ['static-review']); assert.deepEqual(row.gaps, []);
    d.results.unknownWrite = true; assert.equal(buildNightReport(m, events).demands[0].handoff.ready, false);
});
test('a past delivery does not hide later stalls and observation-only events do not reset the clock', () => {
    const { m, at } = fixture(); m.executionPlan.monitoring = { noDeliveryMinutes: 25 };
    const value = structuredClone(m.night.demands[0]); value.handoffRef = 'actual:handoff';
    const events = [{ sequence: 1, at: at(5), payload: { projectionPatches: [{ op: 'set', path: '/night/demands/0', value: structuredClone(value) }] } }];
    const before = buildNightReport(m, events);
    m.updatedAt = at(45); events.push({ sequence: 2, at: at(40), payload: { projectionPatches: [{ op: 'set', path: '/night/demands/0', value: structuredClone(value) }] } }); m.eventLog.lastSequence = 2;
    const stalled = buildNightReport(m, events, { previousReport: before });
    assert.equal(stalled.monitoring.lastDeliveryAt, at(5)); assert.equal(stalled.monitoring.elapsedMinutes, 40); assert.equal(stalled.monitoring.noDelivery, true);
    assert.ok(stalled.signals.some(s => s.kind === 'no-delivery'));
    assert.deepEqual(buildNightReport(m, events, { previousReport: stalled, observedAt: at(46) }).signals, []);
    value.testReceipts.push({ status: 'passed', caseId: 'another-case', frozenVersion: value.frozenVersion, evidenceRef: 'actual:another-test' });
    events.push({ sequence: 3, at: at(44), payload: { projectionPatches: [{ op: 'set', path: '/night/demands/0', value }] } });
    assert.equal(buildNightReport(m, events).monitoring.noDelivery, false);
});
test('delivery report preserves every demand and separates group, spot, manual, blocked and skipped evidence', () => {
    const { m, events } = fixture(), report = buildNightReport(m, events);
    assert.deepEqual(report.demands.map(d => d.level), ['test-group', 'spot-check', 'manual', 'not-ready', 'skipped']);
    assert.equal(report.demands[0].sourceText, 'Original demand 1'); assert.equal(report.demands[0].remarks, 'Original remark 1');
    assert.equal(report.demands[0].codeReview[0].baseRevision, 'a'.repeat(40));
    assert.deepEqual(report.demands[0].codeReview[0].command.args.slice(-3), ['a'.repeat(40), '--', 'd1.js']);
    assert.equal(report.demands[0].integration.recorded.ownerId, 'leader'); assert.equal(report.demands[0].evidenceReuse.length, 1);
    assert.equal(report.demands[0].publication.current.length, 1); assert.equal(report.demands[0].validation.currentReceipts.length, 1);
    assert.equal(report.demands[3].assessment.feasibility, 'blocked'); assert.match(report.demands[3].gaps.join(' '), /前置/);
    assert.equal(report.demands[4].skipped[0].reason, 'source-missing');
    const markdown = renderNightReport(report);
    for (const text of ['测试组可演示', '点测', '专项人工', '未就绪', '已跳过', 'Original remark 5', '固定基点', '数据实际回执']) assert.ok(markdown.includes(text), text);
});
test('stale receipts, wrong runtime layer, safety gaps and missing minimum checks never become group-ready', () => {
    for (const change of [d => d.testReceipts[0].frozenVersion = 'old', d => d.testReceipts[0].level = 'internal-method', d => d.results.unknownWrite = true, d => d.resources.pending = true, d => d.deploymentReceipts[0].frozenVersion = 'old', d => delete d.sourceSnapshot]) {
        const { m, events } = fixture(); change(m.night.demands[0]); const report = buildNightReport(m, events);
        assert.notEqual(report.demands[0].level, 'test-group');
    }
});
test('cost unions stage/detail intervals, includes every role, and proves actual Developer overlap', () => {
    const { m, events } = fixture(), report = buildNightReport(m, events);
    assert.equal(report.costs.elapsedMinutes, 20); assert.equal(report.costs.observedWallMinutes, 15);
    assert.equal(report.costs.byRole.find(r => r.ownerId === 'dev-a').observedMinutes, 10);
    assert.equal(report.costs.byRole.find(r => r.ownerId === 'dev-b').observedMinutes, 10);
    assert.equal(report.costs.byRole.find(r => r.ownerId === 'functional').observedMinutes, null);
    assert.equal(report.costs.byRole.length, 5); assert.equal(report.costs.planningGovernance.observedMinutes, 2);
    assert.equal(report.costs.rework.attemptCount, 1); assert.equal(report.costs.rework.failedAttemptCount, 1);
    assert.equal(report.costs.tokens, null); assert.equal(report.costs.human.recordedInterventions, null);
    assert.equal(report.developerConcurrency.overlapMinutes, 5); assert.equal(report.developerConcurrency.verified, true);
});
test('planned two developers without closed time evidence is unverified; missing costs stay unknown', () => {
    const { m, events, at } = fixture();
    for (const r of m.night.demands) r.timingSegments = [];
    m.night.shared.timingSegments = []; delete m.createdAt; delete m.updatedAt; delete m.actions; delete m.night.convergence;
    const report = buildNightReport(m, events);
    assert.equal(report.developerConcurrency.plannedDevelopers, 2); assert.equal(report.developerConcurrency.verified, false);
    assert.equal(report.developerConcurrency.overlapMinutes, null); assert.equal(report.costs.elapsedMinutes, null); assert.equal(report.costs.observedWallMinutes, null);
    assert.equal(report.costs.rework.attemptCount, null); assert.equal(report.costs.failures.failedActions, null);
    m.updatedAt = at(20);
    m.night.demands[0].timingSegments = [{ workItemId: 'D1-implementation', phase: 'diagnosis', startedAt: at(1), endedAt: at(1) }];
    assert.equal(buildNightReport(m, events).developerConcurrency.verified, false, 'zero-duration edges cannot create phantom overlap');
});
test('explicit failures, withdrawals and human evidence remain distinct from missing observations', () => {
    const { m, events } = fixture();
    m.actions = [{ id: 'cancelled-action', status: 'cancelled' }, { id: 'failed-action', status: 'failed' }, { id: 'auth-action', type: 'request-authorization', status: 'acknowledged' }];
    m.night.shared.timingSegments[0].actorKind = 'human';
    m.night.usage = { totalTokens: 900 };
    events.push({ sequence: 2, type: 'human.intervention', payload: { actorKind: 'human' } }); m.eventLog.lastSequence = 2;
    const report = buildNightReport(m, events);
    assert.equal(report.costs.tokens, 900); assert.equal(report.costs.withdrawals, 1); assert.equal(report.costs.failures.failedActions, 1);
    assert.equal(report.costs.human.recordedInterventions, 1); assert.equal(report.costs.human.authorizationRequests, 1); assert.equal(report.costs.human.minutes, 2);
    delete m.updatedAt; m.night.quotaPolicy = { enabled: true, weeklyBudgetPercentPoints: 7 };
    assert.equal(buildNightReport(m, events).costs.weeklyQuotaAssessment.mode, 'unknown');
});
test('signals ignore observation-only updates and notify material status/evidence changes', () => {
    const { m, events, at } = fixture(), first = buildNightReport(m, events);
    assert.deepEqual(first.signals, []);
    m.updatedAt = at(21); const second = buildNightReport(m, events, { previousReport: first });
    assert.deepEqual(second.signals, []); assert.equal(second.signalFingerprint, first.signalFingerprint);
    m.night.demands[0].results.unknownWrite = true;
    const third = buildNightReport(m, events, { previousReport: second }); assert.ok(third.signals.some(s => s.kind === 'demand-change' && s.demandId === 'D1'));
});
test('unobserved governance stays unknown and only meaningful failure or no-delivery transitions alert', () => {
    const {m,events,at}=fixture();m.executionPlan.monitoring={noDeliveryMinutes:25};
    for(const record of m.night.demands) record.blocked=true;
    m.night.usage={basis:'managed-endpoints',totalTokens:0,endpoints:[],unobservedGovernance:true};
    const first=buildNightReport(m,events);assert.equal(first.costs.tokens,null);assert.equal(first.costs.managedEndpointTokens,0);
    m.updatedAt=at(26);m.actions.push({id:'failed',status:'failed'});
    const second=buildNightReport(m,events,{previousReport:first});
    assert.ok(second.signals.some(s=>s.kind==='no-delivery'));assert.ok(second.signals.some(s=>s.kind==='repeated-failure'));
    m.updatedAt=at(27);assert.deepEqual(buildNightReport(m,events,{previousReport:second}).signals,[]);
});
test('pre-candidate cost stays separate from later output and missing milestone is not invented', () => {
    const {m,events,at}=fixture();assert.equal(buildNightReport(m,events).costs.deliveryWindows.before,null);
    const actual=[{sequence:1,at:at(10),type:'night.recorded',payload:{kind:'demand',projectionPatches:[{op:'set',path:'/night/demands/0/candidateReady',value:true}]}}];
    const report=buildNightReport(m,actual);assert.equal(report.costs.deliveryWindows.firstTechnicalCandidateAt,at(10));
    assert.equal(report.costs.deliveryWindows.before.observedWallMinutes,10);assert.equal(report.costs.deliveryWindows.after.observedWallMinutes,5);
    assert.equal(report.costs.deliveryWindows.before.tokens,null);assert.match(renderNightReport(report),/后续产出不抵销前期低效/);
});
test('CLI derives JSON/Markdown from the existing run and refuses overwriting the requested output', t => {
    // Prefer the task D-drive root; fall back only when access is unavailable.
    const root = require('./fixtures/temp-directory').createTempDirectory('night-report-');
    t.after(() => { assert.equal(require('./fixtures/temp-directory').ownsTempDirectory(root), true); assert.equal(fs.lstatSync(root).isSymbolicLink(), false); fs.rmSync(root, { recursive: true, force: true }); assert.equal(fs.existsSync(root), false); });
    const { m, events } = fixture();
    fs.writeFileSync(path.join(root, '00-run-manifest.json'), JSON.stringify(m)); fs.writeFileSync(path.join(root, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
    const json = JSON.parse(main(['--run-directory', root])); assert.equal(json.schema, 'night-delivery-report/v1');
    const output = path.join(root, 'delivery.md'); main(['--run-directory', root, '--output', output]); assert.ok(fs.readFileSync(output, 'utf8').includes('原始备注'));
    assert.throws(() => main(['--run-directory', root, '--output', output]), /EEXIST/);
    assert.throws(() => main(['--run-directory', root, '--format', 'html']), /format/);
});
