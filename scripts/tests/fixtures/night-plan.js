'use strict';
const path = require('node:path');
function executionPlanFixture({ root, source = path.join(root, 'source'), revision = 'a'.repeat(40), gitCommonDir = path.join(source, '.git'), workspacePlans = [] }) {
    const roles = [['leader', 'coordinator'], ['dev-a', 'developer'], ['dev-b', 'developer'], ['functional', 'functional-tester'], ['browser', 'browser-tester']];
    return {
        version: 1, objective: 'Complete the explicitly assessed demand and verify its actual behavior',
        assessment: { summary: 'User approved this bounded batch', feasibility: 'executable', complexity: 'low', risk: 'low', evidenceRefs: ['user:approved-plan'] },
        demands: [{ id: 'D1', sourceText: 'Original demand text', remarks: '', userAssessment: 'Bounded behavior is clear', feasibility: 'executable', complexity: 'low', risk: 'low' }],
        budget: { timeMinutes: 45, tokens: 12000, governanceMinutes: 3, governanceTokens: 600, weekly: { budgetPercentPoints: 7, budgetId: 'batch-budget', baselineReference: path.join(root, 'baseline.json') } },
        capacity: { clients: [{ id: 'local-client', maxConcurrent: 4, evidenceRef: 'actual-client:capacity-4' }], testerSchedule: [{ ownerId: 'browser', after: ['functional'], reason: 'Actual client supports four concurrent sessions' }] },
        workers: roles.map(([ownerId, role]) => {
            const saved = workspacePlans.find(plan => plan.roleOwnerId === ownerId);
            const workspaceRoot = saved?.workspaceRoot || path.join(root, 'workers', 'batch-1', ownerId);
            return { ownerId, role, clientId: 'local-client', workspaceRoot, entrypointReference: saved?.entrypointReference || path.join(root, 'business', 'AGENTS.md'), requiredRules: saved?.requiredRules || ['role.md'], repositories: saved ? saved.repositories.map(r => ({ name: r.name, sourceRepo: r.sourceRepo, target: r.target, revision: r.revision, sourceIdentity: { gitCommonDir } })) : role === 'coordinator' ? [] : [{ name: 'backend', sourceRepo: source, target: path.join(workspaceRoot, 'repos', 'backend'), revision, sourceIdentity: { gitCommonDir } }] };
        }),
        minimumTests: [{ id: 'actual-case', demandId: 'D1', ownerId: 'functional', level: 'external-api', scope: ['actual-case'], expectedResult: 'Observed result matches the demand', rationale: 'This is sufficient for the changed API behavior' }],
        authorizationReferences: { collaborationPlan: 'grant:approved-batch' },
        dataRetention: { mode: 'none', scope: 'Read-only verification', handoff: 'No test data created' },
        integration: { ownerId: 'leader', strategy: 'review-only', targetRepo: source, baseRevision: revision, verification: 'Review the fixed-base diff and the actual test evidence' }
    };
}
module.exports = { executionPlanFixture };
