'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { planWorkspace, materializeWorkspace, checkWorkspace } = require('../night-workspace');
const { executionPlanFixture } = require('./fixtures/night-plan');
const orchestrator = require('../agent-orchestrator');
const { currentSources } = require('../lib/night-dispatch');
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function git(repo, args) { const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
function cli(script, args, expected = 0) { const r = spawnSync(process.execPath, [path.resolve(__dirname, '..', script), ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(r.status, expected, r.stdout + r.stderr); return expected ? r.stderr : JSON.parse(r.stdout); }
test('approved PLAN creates materialized workers, dispatches two real actions and binds concurrent execution/replay', async t => {
    const parent = process.platform === 'win32' ? 'D:/tmp/Codex' : os.tmpdir(); fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, 'night-governance-')), source = path.join(root, 'source'), cap = path.join(root, 'capability'), business = path.join(root, 'business'), run = path.join(root, 'run');
    const plans = [];
    t.after(() => {
        for (const p of plans) for (const r of p.repositories) if (fs.existsSync(r.target)) git(r.sourceRepo, ['worktree', 'remove', '--force', r.target]);
        assert.equal(path.dirname(root), path.resolve(parent)); assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
        fs.rmSync(root, { recursive: true, force: true }); assert.equal(fs.existsSync(root), false);
    });
    for (const p of [source, cap, business]) fs.mkdirSync(p);
    for (const p of [source, cap]) git(p, ['init', '-q']);
    write(path.join(source, 'code.txt'), 'base\n'); git(source, ['add', 'code.txt']); git(source, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
    const revision = git(source, ['rev-parse', 'HEAD']);
    write(path.join(business, 'AGENTS.md'), '# Original project\n'); write(path.join(business, '.agents/config/plugin_profile.md'), 'enabled fixture\n');
    write(path.join(cap, 'scripts/check.js'), '"use strict";\n');
    write(path.join(cap, 'scripts/lib/workspace-context.js'), fs.readFileSync(path.join(__dirname, '../lib/workspace-context.js')));
    for (const dir of ['plugins', 'vendor', 'agents', 'workflows']) fs.mkdirSync(path.join(cap, dir));
    function file(name, value) { const output = path.join(root, name); write(output, JSON.stringify(value)); return output; }
    for (const [ownerId, role] of [['dev-a', 'developer'], ['dev-b', 'developer'], ['functional', 'functional-tester'], ['browser', 'browser-tester']]) {
        const p = planWorkspace({ businessWorkspace: business, capabilityRoot: cap, worktreeRoot: path.join(root, 'workers'), batchId: 'batch-1', roleOwnerId: ownerId, role, executionPlanVersion: 1, runReference: run, repositories: [{ name: 'backend', sourceRepo: source, ref: revision }], requiredSkills: ['fixture'], requiredRules: ['role.md'], requiredScripts: ['scripts/check.js'], contextReferences: [{ path: 'config/plugin_profile.md', source: path.join(business, '.agents/config/plugin_profile.md') }] });
        plans.push(p);
        for (const repo of p.repositories) { fs.mkdirSync(path.dirname(repo.target), { recursive: true }); git(source, ['worktree', 'add', '--detach', repo.target, revision]); }
        for (const dir of p.manifest.localDirectories) fs.mkdirSync(path.join(p.workspaceRoot, '.agents', dir), { recursive: true });
        write(path.join(p.workspaceRoot, '.agents/capability.json'), JSON.stringify(p.manifest));
        for (const dir of p.manifest.sharedDirectories) fs.symlinkSync(path.join(cap, dir), path.join(p.workspaceRoot, '.agents', dir), 'junction');
        fs.mkdirSync(path.join(p.workspaceRoot, 'src')); fs.symlinkSync(p.repositories[0].target, path.join(p.workspaceRoot, 'src/backend'), 'junction');
        fs.symlinkSync(path.join(business, 'AGENTS.md'), path.join(p.workspaceRoot, 'AGENTS.md'), 'file');
        fs.symlinkSync(path.join(business, '.agents/config/plugin_profile.md'), path.join(p.workspaceRoot, '.agents/config/plugin_profile.md'), 'file');
        write(path.join(p.workspaceRoot, '.agents/skills/fixture/SKILL.md'), '# Fixture skill\n'); write(path.join(p.workspaceRoot, '.agents/rules/role.md'), `# ${role}\n`);
    }
    const executionPlan = executionPlanFixture({ root, source, revision, gitCommonDir: path.join(source, '.git'), workspacePlans: plans });
    executionPlan.demands.push({ ...executionPlan.demands[0], id: 'D2', sourceText: 'Second independent demand' });
    executionPlan.minimumTests.push({ ...executionPlan.minimumTests[0], id: 'second-case', demandId: 'D2' });
    const now = Date.now(), quotaPolicy = { enabled: true, provider: 'codex', weeklyBudgetPercentPoints: 7 };
    const snapshot = { observedAt: new Date(now).toISOString(), rateLimitsByLimitId: { codex: { primary: { usedPercent: 1, windowDurationMins: 300 }, secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: Math.floor(now / 1000) + 86400 } } } };
    const baseline = require('../night-quota-baseline').createBaseline({ snapshot, policy: quotaPolicy, budgetId: executionPlan.budget.weekly.budgetId, authorizationReference: 'user:budget-approved', now });
    file('baseline.json', baseline);
    const initialConfig = path.join(root, 'initial-capability.json'); write(initialConfig, '{}');
    const initialConfigHash = crypto.createHash('sha256').update('{}').digest('hex');
    const probeFile = file('initial-probe.json', { schema: 'night-capability-probe/v1', checkedAt: new Date().toISOString(), profileFingerprint: initialConfigHash, configurationFiles: [{ path: initialConfig, sha256: initialConfigHash }], cleanupVerified: true, operationExited: true, eligibleDemandIds: ['D1', 'D2'], requirements: ['D1', 'D2'].map(demandId => ({ demandId, role: '*', capabilities: ['entry'], executable: true })) });
    executionPlan.capabilityProbe = { reference: probeFile, sha256: crypto.createHash('sha256').update(fs.readFileSync(probeFile)).digest('hex'), maxAgeMinutes: 30 };
    const policyFile = file('policy.json', { maxInFlight: 2 });
    const authRefs = { collaborationPlan: 'grant:approved-batch', deploy: 'grant:deployment' };
    const phases = ['implementation', 'review', 'deployment', 'verification', 'cleanup'];
    const workItems = ['D1', 'D2'].flatMap((id, demandIndex) => phases.map((phase, i) => {
        const ownerId = phase === 'implementation' ? demandIndex ? 'dev-b' : 'dev-a' : 'functional';
        return { id: `${id}-${phase}`, ownerId, repositoryRoot: plans.find(p => p.roleOwnerId === ownerId).repositories[0].target, dependsOn: i ? [`${id}-${phases[i - 1]}`] : [], writeScopes: phase === 'implementation' ? ['code.txt'] : [], readScopes: ['code.txt'], kind: phase === 'cleanup' ? 'cleanup' : 'task', night: { demandId: id, phase, role: 'tester', effects: 'read-only', environmentAlias: 'synthetic-test', ...(phase === 'deployment' ? { deploymentTargets: [id] } : {}) } };
    }));
    const batchFile = file('batch.json', { batchId: 'batch-1', decisionPolicyReference: policyFile, runReference: run, authorizationReferences: authRefs, workspacePreflightReferences: plans.map(p => ({ ownerId: p.roleOwnerId, planReference: file(`${p.roleOwnerId}.json`, p) })), policy: { interactionMode: 'preflight-only', stopClaimingAt: new Date(now + 3600000).toISOString(), stopPublishingAt: new Date(now + 7200000).toISOString(), stopAt: new Date(now + 10800000).toISOString() }, quotaPolicy });
    executionPlan.clientSupervision = { required: true };
    const planFile = file('orchestration-plan.json', { taskKind: 'business-demand', coordinatorId: 'leader', repositoryRoot: plans[0].repositories[0].target, nightBatchReference: batchFile, orchestrationMode: 'subagent', adapter: 'subagent', adapterCapabilities: { subagent: true }, participants: executionPlan.workers.map(w => ({ id: w.ownerId, role: w.role === 'coordinator' ? 'coordinator' : 'worker', endpoint: { type: 'subagent' } })), executionPlan, workItems });
    const init = cli('agent-orchestrator.js', ['init', '--run-directory', run, '--plan', planFile]); assert.equal(init.executionPlan.version, 1);
    const evidence = { rationale: 'Synthetic real-script contract test', evidenceRefs: ['synthetic:actual-operation'] };
    for (const [index, id] of ['D1', 'D2'].entries()) {
        const sourceScopes = [{ repoRoot: plans[index].repositories[0].target, scopes: ['code.txt'] }], frozen = currentSources({ sourceScopes });
        const assessment = { businessCertainty: 'confirmed', risk: 'low', changeKinds: ['query'], reviewerId: 'functional', minimumChecks: [id === 'D1' ? 'actual-case' : 'second-case'], route: 'external-api', ...frozen, ...evidence };
        orchestrator.recordNight(run, { kind: 'demand', record: { id, implementationOwnerId: index ? 'dev-b' : 'dev-a', sourceScopes, ...frozen, assessment: { pre: assessment }, results: { knownDefect: false, unknownWrite: false }, resources: { pending: false, polluted: false }, timingSegments: [], failures: [], reassessments: [], testReceipts: [], deploymentReceipts: [] }, ...evidence }, 'leader');
    }
    const config = path.join(root, 'configuration.json'); write(config, '{}');
    const receipt = { profileFingerprint: 'profile', configFingerprint: 'config', deploymentConfigFingerprint: 'deployment', configurationFiles: [{ path: config, sha256: crypto.createHash('sha256').update('{}').digest('hex') }], environmentAlias: 'synthetic-test', cleanupVerified: true, checkedAt: new Date().toISOString(), authorizations: Object.entries(authRefs).map(([category, reference]) => ({ category, reference, environmentAlias: 'synthetic-test', roles: ['tester'], scopes: plans.map(p => ({ repoRoot: p.repositories[0].target, paths: ['code.txt'] })) })), checks: ['authentication', 'role', 'entry', 'exit', 'client-lifecycle', 'client-stop', 'client-usage', 'automation-inventory'].map(id => ({ id, status: 'passed', nonInteractive: true, role: '*', evidenceRef: 'synthetic:probe' })) };
    orchestrator.recordNight(run, { kind: 'preflight', receipt, ...evidence }, 'leader');
    orchestrator.recordNight(run, { kind: 'quota', snapshot: { ...snapshot, observedAt: new Date().toISOString() }, ...evidence }, 'leader');
    for (const p of plans) { assert.equal(materializeWorkspace(p).ok, true); assert.equal(checkWorkspace(p).ok, true); }
    const actions = cli('agent-orchestrator.js', ['next', '--run-directory', run]);
    assert.equal(actions.length, 2, JSON.stringify(orchestrator.loadManifest(run).night.lastDispatchDecisions));
    assert.deepEqual(new Set(actions.map(a => a.targetId)), new Set(['dev-a', 'dev-b']));
    for (const action of actions) assert.equal(action.context.planHash, init.orchestration.planHash);
    const brokenRule = path.join(plans[0].workspaceRoot, '.agents/rules/night_run_plan.md'), originalRule = fs.readFileSync(brokenRule, 'utf8');
    fs.appendFileSync(brokenRule, '\nchanged');
    assert.match(cli('agent-orchestrator.js', ['transition', '--run-directory', run, '--entity', 'work-item', '--id', 'D1-implementation', '--status', 'running'], 1), /workspace|PLAN/i);
    fs.writeFileSync(brokenRule, originalRule);
    for (const action of actions) cli('agent-orchestrator.js', ['transition', '--run-directory', run, '--entity', 'work-item', '--id', action.workItemId, '--status', 'running']);
    const children = actions.map(action => new Promise((resolve, reject) => {
        const worker = plans.find(p => p.roleOwnerId === action.targetId), output = path.join(root, `${action.targetId}-interval.json`);
        const script = 'const fs=require("node:fs");const startedAt=new Date().toISOString();setTimeout(()=>{fs.appendFileSync(process.argv[1],"synthetic worker change\\n");fs.writeFileSync(process.argv[2],JSON.stringify({startedAt,endedAt:new Date().toISOString()}));},350);';
        const child = spawn(process.execPath, ['-e', script, path.join(worker.repositories[0].target, 'code.txt'), output], { windowsHide: true });
        child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(fs.readFileSync(output, 'utf8'))) : reject(new Error(`Worker exited ${code}`)));
    }));
    const intervals = await Promise.all(children);
    assert.ok(Math.min(...intervals.map(i => Date.parse(i.endedAt))) > Math.max(...intervals.map(i => Date.parse(i.startedAt))), 'synthetic physical workers really overlapped');
    for (const action of actions) {
        const bad = file('bad-result.json', { actionId: action.id, status: 'succeeded', endpointId: action.targetId, contextHash: 'wrong' });
        assert.match(cli('agent-orchestrator.js', ['ack', '--run-directory', run, '--result', bad], 1), /context/i);
        const deadlineAt = new Date(now + 100000).toISOString();
        const actual = { actionId: action.id, status: 'succeeded', endpointId: action.targetId, contextHash: action.context.sha256, host: { threadId: action.targetId, turnId: 'synthetic-turn', deadlineAt, budget: { configured: false } } };
        const result = file(`${action.targetId}-result.json`, actual);
        assert.match(cli('agent-orchestrator.js', ['ack', '--run-directory', run, '--result', result], 1), /persisted budget reservation/);
        const launchReceiptFile = path.join(run, 'evidence/night-operations', `${action.id}-launch.json`); write(launchReceiptFile, JSON.stringify(actual));
        orchestrator.recordNight(run, { kind: 'client-reserve', reservation: { actionId: action.id, tokens: 100, deadlineAt, launchReceiptFile }, ...evidence }, 'leader');
        const lease = path.join(run, 'night-client-worker.lock');
        if (!fs.existsSync(lease)) assert.match(cli('agent-orchestrator.js', ['ack', '--run-directory', run, '--result', result], 1), /night-client-worker.lock/);
        // PID witness is synthetic here; autonomous observation is tested with the worker.
        write(lease, JSON.stringify({ schema: 'night-client-worker/v1', pid: process.pid, identity: 'fixture-supervisor', heartbeatAt: new Date().toISOString(), runDirectory: path.resolve(run) }));
        const changedHost = file(`${action.targetId}-forged-host.json`, { ...actual, host: { ...actual.host, turnId: 'unbound-turn' } });
        assert.match(cli('agent-orchestrator.js', ['ack', '--run-directory', run, '--result', changedHost], 1), /actual launch receipt/);
        cli('agent-orchestrator.js', ['ack', '--run-directory', run, '--result', result]);
        const completion = file(`${action.targetId}-completion.json`, { actionId: action.id, status: 'succeeded', endpointId: action.targetId, contextHash: action.context.sha256, artifactRefs: [path.join(root, `${action.targetId}-interval.json`)] });
        cli('agent-orchestrator.js', ['result', '--run-directory', run, '--result', completion]);
    }
    const replayed = orchestrator.loadManifest(run), events = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.at(-1).sequence, replayed.eventLog.lastSequence); assert.equal(replayed.actions.filter(a => a.result?.status === 'succeeded').length, 2);
    assert.equal(replayed.actions.filter(a => a.completionResult?.status === 'succeeded').length, 2);
    const report = require('../lib/night-report').buildNightReport(replayed, events);
    assert.equal(report.developerConcurrency.verified, true, 'closed run timing proves the same overlap after event replay');
    const baselineBytes = fs.readFileSync(path.join(root, 'baseline.json'), 'utf8'); write(path.join(root, 'baseline.json'), baselineBytes + ' ');
    // Semantically identical whitespace is allowed; a changed baseline value is not.
    const changed = JSON.parse(baselineBytes); changed.baselineUsedPercent++; file('baseline.json', changed);
    const decision = require('../lib/night-dispatch').gateNight(replayed, replayed.workItems[0]); assert.ok(decision.reasons.includes('quota-baseline-changed'));
});
