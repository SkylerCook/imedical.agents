'use strict';

// The run manifest owns the PLAN. Worker rules and action text are deterministic
// projections; neither projection can change an authorization or a budget.
const path = require('node:path');
const { createHash } = require('node:crypto');
const FEATURE = 'night-execution-plan/v1';
const CONTEXT_PREFIX = '执行前读取当前 cwd 的 AGENTS.md、本角色 requiredRules 和 fullPlanRule。以下是本次派发快照；预算剩余未知时先核对已有 run 观测。完成当前工作项并向既有 run 回传证据。\n\n';
const FEASIBILITY = ['executable', 'decomposable', 'blocked', 'unsupported', 'conditional'];
const text = value => typeof value === 'string' && value.trim().length > 0;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}
const json = value => JSON.stringify(canonical(value), null, 2);
const digest = value => sha256(json(value));
function instructionsHash(material) {
    const { remaining, dependencies, ...instructions } = material;
    return digest({ ...instructions, dependencies: (dependencies || []).map(({ status, ...binding }) => binding) });
}
function contextSnapshotMatches(context, expected) {
    try {
        if (!context?.text?.startsWith(CONTEXT_PREFIX) || sha256(context.text) !== context.sha256) return false;
        return instructionsHash(JSON.parse(context.text.slice(CONTEXT_PREFIX.length))) === expected.instructionsHash;
    } catch { return false; }
}
function need(condition, message) { if (!condition) throw new Error(`Execution PLAN: ${message}`); }
function strings(value, label, allowEmpty = false) { need(Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(text) && new Set(value).size === value.length, `${label} must be a unique string array`); }
function absolute(value, label) { need(text(value) && path.isAbsolute(value), `${label} must be absolute`); }
function safeRule(value) { return text(value) && !path.isAbsolute(value) && value.split(/[\\/]/).every(part => part && part !== '.' && part !== '..'); }
function validateExecutionPlan(input) {
    const plan = input?.executionPlan;
    if (plan === undefined) return null;
    need(plan && typeof plan === 'object' && !Array.isArray(plan) && plan.version === 1, 'unsupported version');
    require('./night-capability').validateProbeBinding(plan, input.workItems, { started: !!input.night?.startedAt });
    need(text(plan.objective), 'objective required');
    const a = plan.assessment;
    need(a && text(a.summary) && FEASIBILITY.includes(a.feasibility) && ['low', 'medium', 'high'].includes(a.complexity) && ['low', 'medium', 'high'].includes(a.risk), 'user assessment, feasibility, complexity and risk required');
    strings(a.evidenceRefs, 'assessment evidenceRefs');
    if (plan.monitoring !== undefined) need(plan.monitoring && Number.isFinite(plan.monitoring.noDeliveryMinutes) && plan.monitoring.noDeliveryMinutes > 0, 'monitoring.noDeliveryMinutes must be explicit positive minutes');
    if (plan.clientSupervision !== undefined) need(plan.clientSupervision?.required === true, 'explicit client supervision cannot be disabled');
    const b = plan.budget;
    need(b && Number.isFinite(b.timeMinutes) && b.timeMinutes > 0 && Number.isSafeInteger(b.tokens) && b.tokens > 0, 'explicit timeMinutes and tokens required');
    need(Number.isFinite(b.governanceMinutes) && b.governanceMinutes >= 0 && b.governanceMinutes <= b.timeMinutes && Number.isSafeInteger(b.governanceTokens) && b.governanceTokens >= 0 && b.governanceTokens <= b.tokens, 'governance budget must fit the total budget');
    need(b.weekly && Number.isFinite(b.weekly.budgetPercentPoints) && b.weekly.budgetPercentPoints > 0 && b.weekly.budgetPercentPoints <= 100 && text(b.weekly.budgetId) && text(b.weekly.baselineReference), 'weekly budgetPercentPoints, budgetId and baselineReference required');
    need(Array.isArray(plan.demands) && plan.demands.length > 0, 'demands required');
    const demandIds = new Set();
    for (const d of plan.demands) {
        need(d && text(d.id) && !demandIds.has(d.id) && text(d.sourceText) && typeof d.remarks === 'string', 'unique demand id, original sourceText and remarks required'); demandIds.add(d.id);
        need(text(d.userAssessment) && FEASIBILITY.includes(d.feasibility) && ['low', 'medium', 'high'].includes(d.complexity) && ['low', 'medium', 'high'].includes(d.risk), `demand ${d.id} assessment required`);
    }
    need(Array.isArray(plan.workers) && plan.workers.length > 0, 'workers required');
    const owners = new Map(), roots = [], targets = [];
    for (const w of plan.workers) {
        need(w && text(w.ownerId) && !owners.has(w.ownerId) && ['coordinator', 'developer', 'functional-tester', 'browser-tester'].includes(w.role) && text(w.clientId), 'unique worker ownerId, role and clientId required'); owners.set(w.ownerId, w);
        absolute(w.workspaceRoot, 'worker workspaceRoot'); absolute(w.entrypointReference, 'worker entrypointReference');
        need(!roots.some(root => same(root, w.workspaceRoot)), 'worker workspaceRoot belongs to only one owner'); roots.push(w.workspaceRoot);
        strings(w.requiredRules, 'requiredRules'); need(w.requiredRules.every(safeRule) && !w.requiredRules.includes('night_run_plan.md'), 'requiredRules must name source role rules');
        need(Array.isArray(w.repositories) && (w.role === 'coordinator' || w.repositories.length > 0), 'worker repositories required');
        const names = new Set();
        for (const r of w.repositories) {
            need(r && text(r.name) && !names.has(r.name), 'unique repository name required'); names.add(r.name);
            absolute(r.sourceRepo, 'sourceRepo'); absolute(r.target, 'target'); absolute(r.sourceIdentity?.gitCommonDir, 'sourceIdentity.gitCommonDir');
            need(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(r.revision || ''), 'repository revision must be a fixed commit');
            need(!same(r.sourceRepo, r.target) && !targets.some(target => same(target, r.target)), 'SourceWorktree target belongs to only one owner'); targets.push(r.target);
            const relative = path.relative(w.workspaceRoot, r.target); need(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'repository target must be inside owner workspaceRoot');
        }
    }
    need(plan.workers.filter(w => w.role === 'developer').length >= 2, 'at least two developers required');
    for (const role of ['coordinator', 'functional-tester', 'browser-tester']) need(plan.workers.filter(w => w.role === role).length === 1, `exactly one ${role} required`);
    const coordinator = plan.workers.find(w => w.role === 'coordinator');
    need(!input.coordinatorId || coordinator.ownerId === input.coordinatorId, 'coordinator owner differs from manifest');
    const c = plan.capacity;
    need(c && Array.isArray(c.clients) && c.clients.length > 0, 'actual client capacity required');
    const clients = new Map();
    for (const client of c.clients) {
        need(client && text(client.id) && !clients.has(client.id) && Number.isSafeInteger(client.maxConcurrent) && client.maxConcurrent > 0 && text(client.evidenceRef), 'actual client capacity evidence required'); clients.set(client.id, client);
    }
    need(plan.workers.every(w => clients.has(w.clientId)), 'worker client is not in actual capacity');
    need(Array.isArray(c.testerSchedule), 'explicit testerSchedule required (empty when concurrent)');
    const scheduled = new Map();
    for (const slot of c.testerSchedule) {
        need(slot && ['functional-tester', 'browser-tester'].includes(owners.get(slot.ownerId)?.role) && !scheduled.has(slot.ownerId) && text(slot.reason), 'unique tester schedule and reason required');
        strings(slot.after, 'testerSchedule.after', true);
        need(slot.after.every(id => id !== slot.ownerId && ['functional-tester', 'browser-tester'].includes(owners.get(id)?.role)), 'tester schedule must reference another tester'); scheduled.set(slot.ownerId, slot);
    }
    const testers = plan.workers.filter(w => w.role.endsWith('-tester'));
    need(!testers.every(w => scheduled.get(w.ownerId)?.after.includes(testers.find(other => other !== w).ownerId)), 'tester schedule cycle');
    for (const client of clients.values()) {
        const assigned = plan.workers.filter(w => w.clientId === client.id);
        const staggered = testers.every(w => w.clientId === client.id) && testers.some(w => scheduled.get(w.ownerId)?.after.includes(testers.find(other => other !== w).ownerId));
        need(assigned.length - (staggered ? 1 : 0) <= client.maxConcurrent, 'client capacity exceeded; declare tester staggering or increase verified capacity');
    }
    need(Array.isArray(plan.minimumTests) && plan.minimumTests.length > 0, 'minimumTests required');
    const tests = new Set();
    for (const t of plan.minimumTests) {
        need(t && text(t.id) && !tests.has(t.id) && demandIds.has(t.demandId) && owners.has(t.ownerId) && ['static-review', 'internal-method', 'external-api', 'ui', 'manual', 'not-applicable'].includes(t.level) && text(t.expectedResult) && text(t.rationale), 'test id, demandId, owner, explicit level, expectedResult and rationale required'); tests.add(t.id);
        strings(t.scope, 'minimum test scope');
    }
    need([...demandIds].every(id => plan.minimumTests.some(t => t.demandId === id)), 'each demand needs a minimum test');
    for (const d of plan.demands.filter(d => ['blocked', 'unsupported'].includes(d.feasibility))) need(plan.minimumTests.some(t => t.demandId === d.id && ['manual', 'not-applicable'].includes(t.level)), `demand ${d.id} needs a manual handoff or not-applicable rationale`);
    need(plan.authorizationReferences && typeof plan.authorizationReferences === 'object' && !Array.isArray(plan.authorizationReferences) && text(plan.authorizationReferences.collaborationPlan) && Object.values(plan.authorizationReferences).every(text), 'authorizationReferences including collaborationPlan required');
    const retention = plan.dataRetention;
    need(retention && ['none', 'retain', 'reset', 'delete'].includes(retention.mode) && text(retention.scope) && text(retention.handoff), 'dataRetention mode, scope and handoff required');
    need(retention.mode === 'none' || text(retention.authorizationReference), 'data retention/disposition authorization reference required');
    const integration = plan.integration;
    need(integration && owners.has(integration.ownerId) && ['review-only', 'merge', 'cherry-pick'].includes(integration.strategy) && text(integration.verification), 'integration owner, strategy and verification required');
    absolute(integration.targetRepo, 'integration targetRepo'); need(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(integration.baseRevision || ''), 'integration fixed baseRevision required');
    need(integration.strategy === 'review-only' || text(integration.authorizationReference), 'integration write authorization reference required');
    for (const item of input.workItems || []) {
        const owner = owners.get(item.ownerId); need(owner, `work item ${item.id} owner is outside PLAN`);
        if (item.night?.demandId) need(demandIds.has(item.night.demandId), `work item ${item.id} demand is outside PLAN`);
        if (item.repositoryRoot) need(owner.repositories.some(r => same(r.target, item.repositoryRoot)), `work item ${item.id} repository is outside owner PLAN`);
    }
    if (Array.isArray(input.participants)) need(plan.workers.every(w => input.participants.some(p => p.id === w.ownerId)), 'PLAN worker is not a run participant');
    return plan;
}
function executionPlanIssues(input) { try { validateExecutionPlan(input); return []; } catch (e) { return [e.message]; } }
function worker(input, ownerId) {
    const plan = validateExecutionPlan(input); need(plan, 'opt-in required');
    const owner = plan.workers.find(w => w.ownerId === ownerId); need(owner, `unknown owner ${ownerId}`); return { plan, owner };
}
function renderWorkerRule(manifest, ownerId) {
    const { plan, owner } = worker(manifest, ownerId);
    need(text(manifest.orchestration?.planHash), 'current planHash required');
    const projection = { feature: FEATURE, runId: manifest.runId, planHash: manifest.orchestration.planHash, executionPlanHash: digest(plan), ownerId: owner.ownerId, executionPlan: plan };
    return `# 本批无人值守 PLAN\n\n本规则由已批准 run 的 executionPlan 派生。先读取原项目入口 ${owner.entrypointReference} 和本角色 requiredRules；按本批预算、最低测试、授权范围与集成安排执行。每次行动使用当前 planHash 的 action context；状态、计时和结果继续写入既有 run 事件。\n\n\`\`\`json\n${json(projection)}\n\`\`\`\n`;
}
function buildActionContext(manifest, item) {
    if (!validateExecutionPlan(manifest)) return null;
    need(item && text(item.id) && text(item.ownerId), 'action work item identity required');
    const { plan, owner } = worker(manifest, item.ownerId), workerRule = renderWorkerRule(manifest, item.ownerId);
    const record = manifest.night?.demands?.find(d => d.id === item.night?.demandId);
    const sourceVersion = record?.frozenVersion || digest(owner.repositories.map(({ sourceRepo, target, revision }) => ({ sourceRepo, target, revision })));
    const stable = { feature: FEATURE, runId: manifest.runId, planHash: manifest.orchestration.planHash, executionPlanHash: digest(plan), ownerId: item.ownerId, workItemId: item.id, sourceVersion, scopeFingerprint: record?.scopeFingerprint || null, workspaceRoot: owner.workspaceRoot, role: owner.role, requiredRules: owner.requiredRules, fullPlanRule: path.join(owner.workspaceRoot, '.agents/rules/night_run_plan.md'), work: { id: item.id, title: item.title || item.id, repositoryRoot: item.repositoryRoot || null, readScopes: item.readScopes || [], writeScopes: item.writeScopes || [], completionCriteria: item.completionCriteria || [], night: item.night || null } };
    const start = Date.parse(manifest.night?.weeklyQuota?.recordedAt || manifest.createdAt), snapshot = Date.parse(manifest.updatedAt);
    const usedTokens = manifest.night?.usage?.totalTokens;
    const governanceReserve = manifest.night?.usage?.basis === 'managed-endpoints' && manifest.night.usage.unobservedGovernance ? plan.budget.governanceTokens : 0;
    const remaining = {
        asOf: Number.isFinite(snapshot) ? manifest.updatedAt : 'unknown',
        timeMinutes: Number.isFinite(start) && Number.isFinite(snapshot) && snapshot >= start ? Math.max(0, plan.budget.timeMinutes - (snapshot - start) / 60000) : 'unknown',
        tokens: Number.isSafeInteger(usedTokens) && usedTokens >= 0 ? Math.max(0, plan.budget.tokens - usedTokens - governanceReserve) : 'unknown',
        tokenCoverage: governanceReserve ? 'Managed endpoints observed; unobserved governance reserved within budget' : 'Only recorded usage; unknown observations are not zero',
        weeklyPercentPoints: 'unknown'
    };
    const weekly = manifest.night?.weeklyQuota;
    if (weekly?.budgetId === plan.budget.weekly.budgetId && weekly.budgetPercentPoints === plan.budget.weekly.budgetPercentPoints && !weekly.observationError && Number.isFinite(weekly.baselineUsedPercent) && Number.isFinite(weekly.highWaterUsedPercent) && weekly.highWaterUsedPercent >= weekly.baselineUsedPercent && Number.isFinite(snapshot) && weekly.resetsAt * 1000 > snapshot) remaining.weeklyPercentPoints = Math.max(0, weekly.budgetPercentPoints - (weekly.highWaterUsedPercent - weekly.baselineUsedPercent));
    const roles = { coordinator: '按已核实容量调度、闭合证据并执行已授权集成；工作状态以既有 run 为准。', developer: '仅修改本工作项 owner 的仓库和 writeScopes；按当前需求最低测试交付证据。', 'functional-tester': '按当前需求执行功能与数据断言，核对实际副作用和数据处置；使用最低充分测试层级。', 'browser-tester': '只对明确需要可见行为的当前需求验证页面状态与交互；执行显式 UI 用例并归档浏览器证据。' };
    const required = require('./night-contract').requiredAuthorizations(manifest, { ...item, night: item.night || {} });
    const material = { ...stable, commonRules: ['先核对实际 cwd、当前 planHash 与原项目规则。', '按本工作项授权范围执行；额度或截止触发时停止领取并完成安全收尾。', '已知缺陷、未知写入结果或数据未核销时挂起受影响工作，并记录可恢复证据。'], taskRole: item.night?.phase === 'review' ? 'reviewer' : owner.role, roleRule: item.night?.phase === 'review' ? '独立复核原始需求、固定基点实际diff、遗漏和共享逻辑影响；不得审查自己的实现或降低断言换取通过。' : roles[owner.role], testerSchedule: plan.capacity.testerSchedule.filter(s => s.ownerId === owner.ownerId || s.after.includes(owner.ownerId)), demand: plan.demands.find(d => d.id === item.night?.demandId) || null, minimumTests: plan.minimumTests.filter(t => t.demandId === item.night?.demandId), dependencies: (item.dependsOn || []).map(id => { const prior = manifest.workItems?.find(w => w.id === id); return { workItemId: id, ownerId: prior?.ownerId || 'unknown', status: prior?.status || 'unknown' }; }), limits: manifest.night?.limits || {}, budget: plan.budget, remaining, authorizationReferences: plan.authorizationReferences, authorizations: { required, category: item.authorizationCategory || null, environmentAlias: item.night?.environmentAlias || null, repositoryRoot: item.repositoryRoot || null, writeScopes: item.writeScopes || [] }, dataRetention: plan.dataRetention, integration: plan.integration };
    const output = `${CONTEXT_PREFIX}${json(material)}\n`;
    return { schema: 'night-action-context/v1', text: output, sha256: sha256(output), instructionsHash: instructionsHash(material), bindingHash: digest(stable), planHash: stable.planHash, executionPlanHash: stable.executionPlanHash, workerRuleSha256: sha256(workerRule), sourceVersion, ownerId: item.ownerId, workItemId: item.id, workspaceRoot: owner.workspaceRoot, requiredRules: [...owner.requiredRules] };
}
module.exports = { FEATURE, validateExecutionPlan, executionPlanIssues, renderWorkerRule, buildActionContext, contextSnapshotMatches, executionPlanHash: digest };
