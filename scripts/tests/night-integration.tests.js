'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const integration = require('../lib/night-integration');
const { currentSources, updateNight, gateNight } = require('../lib/night-dispatch');
const { normalizePolicy } = require('../lib/night-policy');
const { createBaseline } = require('../night-quota-baseline');
const { executionPlanFixture } = require('./fixtures/night-plan');
const evidence = { rationale: 'Synthetic independent contract evidence', evidenceRefs: ['synthetic:actual'] };
function fixture(t) {
    const parent = process.platform === 'win32' ? 'D:/tmp/Codex' : os.tmpdir();
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, 'night-integration-'));
    t.after(() => { assert.equal(fs.lstatSync(root).isSymbolicLink(), false); assert.equal(path.dirname(root), path.resolve(parent)); fs.rmSync(root, { recursive: true, force: true }); });
    const source = path.join(root, 'source'); fs.mkdirSync(source);
    const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
    git(source, 'init', '-q'); git(source, 'config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(source, 'Shared.cls'), 'Class Shared\n{\nMethod A() { quit 1 }\nMethod B() { quit 1 }\n}\n');
    git(source, 'add', '.'); git(source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    const revision = git(source, 'rev-parse', 'HEAD'), plan = executionPlanFixture({ root, source, revision });
    for (const worker of plan.workers.filter(w => w.repositories.length)) {
        const target = worker.repositories[0].target; fs.mkdirSync(path.dirname(target), { recursive: true }); git(source, 'worktree', 'add', '--detach', target, revision);
    }
    const repoA = plan.workers.find(w => w.ownerId === 'dev-a').repositories[0].target;
    const repoB = plan.workers.find(w => w.ownerId === 'dev-b').repositories[0].target;
    plan.integration = { ownerId: 'dev-a', strategy: 'merge', targetRepo: repoA, baseRevision: revision, verification: 'Compare both demand diffs against the fixed base', authorizationReference: 'user:integration' };
    const stamp = new Date().toISOString(), policy = { enabled: true, weeklyBudgetPercentPoints: 7 };
    const snapshot = { observedAt: stamp, rateLimits: { secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: Math.floor(Date.now()/1000) + 86400 } } };
    const baseline = createBaseline({ snapshot, policy, budgetId: 'batch-budget', authorizationReference: 'user:weekly' });
    const baselineFile = path.join(root, 'baseline.json'); fs.writeFileSync(baselineFile, JSON.stringify(baseline));
    const manifest = { schemaVersion: '2.0', coordinatorId: 'leader', createdAt: stamp, updatedAt: stamp, executionPlan: plan, orchestration: { mode: 'subagent', planHash: 'approved-plan' }, participants: plan.workers.map(w => ({ id: w.ownerId })), actions: [], workItems: [], night: { batchId: 'synthetic', policy: normalizePolicy({ maxInFlight: 4 }), quotaPolicy: policy, quotaSnapshot: snapshot, weeklyQuota: baseline, quotaBaselineReference: baselineFile, quotaBaselineHash: integration.hash(baseline), limits: { stopClaimingAt: new Date(Date.now()+3000000).toISOString(), stopPublishingAt: new Date(Date.now()+3200000).toISOString(), stopAt: new Date(Date.now()+3500000).toISOString() }, demands: [], shared: { timingSegments: [], reassessments: [] }, humanReassessments: [] } };
    const add = (id, ownerId, repoRoot) => {
        if (!plan.demands.some(d => d.id === id)) plan.demands.push({ ...plan.demands[0], id });
        if (!plan.minimumTests.some(d => d.demandId === id)) plan.minimumTests.push({ ...plan.minimumTests[0], id: `test-${id}`, demandId: id });
        const sourceScopes = [{ repoRoot, scopes: ['Shared.cls'] }], frozen = currentSources({ sourceScopes });
        const assessment = { businessCertainty: 'confirmed', risk: 'low', changeKinds: ['query'], ...evidence, reviewerId: 'functional', minimumChecks: ['check-A'], route: 'external-api', ...frozen };
        const record = { id, implementationOwnerId: ownerId, ...frozen, sourceScopes, assessment: { pre: structuredClone(assessment), post: structuredClone(assessment) }, results: { knownDefect: false, unknownWrite: false }, resources: { polluted: false, pending: false }, timingSegments: [], failures: [], reassessments: [], checks: [{ id: 'check-A', status: 'passed', ...frozen, evidenceRefs: ['actual:old-test'] }] };
        manifest.night.demands.push(record);
        for (const phase of ['implementation','review','deployment','verification','cleanup']) manifest.workItems.push({ id: `${id}-${phase}`, ownerId, repositoryRoot: repoRoot, readScopes: ['Shared.cls'], writeScopes: phase === 'implementation' ? ['Shared.cls'] : [], status: 'pending', attempts: [], kind: phase === 'cleanup' ? 'cleanup' : 'task', dependsOn: [], night: { demandId: id, phase, environmentAlias: 'synthetic-local', deploymentTargets: ['Shared.cls'] } });
        return record;
    };
    return { root, source, repoA, repoB, manifest, add, git };
}
test('frozen material survives later development and tampering cannot become old evidence', t => {
    const f = fixture(t), record = f.add('D1','dev-a',f.repoA);
    updateNight(f.manifest, { kind: 'source-freeze', demandId: 'D1', ...evidence }, 'leader', { runDirectory: f.root });
    const frozen = currentSources(record), entry = record.sourceSnapshot.files[0];
    fs.appendFileSync(path.join(f.repoA,'Shared.cls'), '// next demand\n');
    assert.deepEqual(currentSources(record), frozen);
    assert.notEqual(currentSources({ ...record, sourceSnapshot: undefined }).frozenVersion, frozen.frozenVersion);
    fs.appendFileSync(path.join(record.sourceSnapshot.root,entry.artifact), 'tampered');
    assert.throws(() => currentSources(record), /changed/);
});
test('same class identity spans worktrees; integration requires fresh independent review', t => {
    const f = fixture(t), record = f.add('D1','dev-b',f.repoB);
    assert.equal(integration.logicalSourceMatches(f.repoA,f.repoB),true);
    const base=f.manifest.executionPlan.integration.baseRevision;f.manifest.executionPlan.integration.baseRevision='f'.repeat(40);
    assert.throws(()=>updateNight(f.manifest,{kind:'source-integrate',demandId:'D1',integrationBinding:{ownerId:'dev-a',repositoryRoot:f.repoA},...evidence},'leader',{runDirectory:f.root}),/fixed base/);
    f.manifest.executionPlan.integration.baseRevision=base;
    assert.throws(()=>updateNight(f.manifest,{kind:'source-freeze',demandId:'D1',integrationBinding:{ownerId:'dev-a',repositoryRoot:f.repoA},...evidence},'leader',{runDirectory:f.root}),/Use source-integrate/);
    fs.writeFileSync(path.join(f.repoA,'Shared.cls'),fs.readFileSync(path.join(f.repoB,'Shared.cls'),'utf8').replace('quit 1','quit 2'));
    updateNight(f.manifest,{ kind:'source-integrate',demandId:'D1',integrationBinding:{ownerId:'dev-a',repositoryRoot:f.repoA},...evidence },'leader',{runDirectory:f.root});
    assert.equal(record.assessment.post,null);
    assert.throws(() => updateNight(f.manifest,{kind:'source-freeze',demandId:'D1',...evidence},'leader',{runDirectory:f.root}),/independent/);
    record.assessment.post = { ...record.assessment.pre, ...currentSources(record), reviewerId:'functional' };
    updateNight(f.manifest,{kind:'source-freeze',demandId:'D1',...evidence},'leader',{runDirectory:f.root});
    assert.equal(integration.integrationCovers(f.manifest,record,f.repoB,'Shared.cls'),true);
    assert.equal(integration.integrationCovers(f.manifest,record,f.source,'Other.cls'),false);
});
test('impact review binds actual versions/diff and never relabels the old test', t => {
    const f=fixture(t),record=f.add('D1','dev-a',f.repoA);
    updateNight(f.manifest,{kind:'source-freeze',demandId:'D1',...evidence},'leader',{runDirectory:f.root});
    const before=record.sourceSnapshot,oldCheck=structuredClone(record.checks[0]);
    fs.appendFileSync(path.join(f.repoA,'Shared.cls'),'// unrelated comment\n');
    delete record.sourceSnapshot; Object.assign(record,currentSources(record)); record.assessment.post={...record.assessment.post,...currentSources(record)};
    updateNight(f.manifest,{kind:'source-freeze',demandId:'D1',...evidence},'leader',{runDirectory:f.root});
    const diffReference = path.join(f.root,'impact-diff.json'); fs.writeFileSync(diffReference,JSON.stringify(integration.impactDiff(before,record.sourceSnapshot)));
    const review={reviewerId:'functional',fromVersion:before.frozenVersion,toVersion:record.frozenVersion,checkIds:['check-A'],affectedChecks:[],changesHash:integration.hash(integration.snapshotChanges(before,record.sourceSnapshot)),diffReference,evidenceRefs:[diffReference,'actual:diff-review']};
    assert.throws(()=>updateNight(f.manifest,{kind:'evidence-reuse',demandId:'D1',review:{...review,changesHash:'forged'},...evidence},'leader',{runDirectory:f.root}),/actual source changes/);
    updateNight(f.manifest,{kind:'evidence-reuse',demandId:'D1',review,...evidence},'leader',{runDirectory:f.root});
    assert.equal(integration.reusedCheck(record,'check-A'),true); assert.deepEqual(record.checks[0],oldCheck);
});
test('shared target serializes publication while different targets continue', t => {
    const f=fixture(t),a=f.add('D1','dev-a',f.repoA); f.add('D2','dev-b',f.repoB);
    const item=f.manifest.workItems.find(w=>w.id==='D1-deployment'),other=f.manifest.workItems.find(w=>w.id==='D2-deployment');
    f.manifest.night.operations=[{phase:'deployment',status:'running',demandId:a.id,frozenVersion:a.frozenVersion,targetKeys:integration.targetsFor(f.manifest,item)}];
    assert.deepEqual(integration.publicationReasons(f.manifest,other),['publication-target-unresolved']);
    other.night.deploymentTargets=['Other.cls']; assert.deepEqual(integration.publicationReasons(f.manifest,other),[]);
    other.night.deploymentTargets=['Shared.cls']; a.candidateReady=true;
    f.manifest.night.operations[0].status='verified'; f.manifest.workItems.find(w=>w.id==='D1-verification').status='running';
    assert.ok(integration.publicationReasons(f.manifest,other).includes('publication-verification-window'));
});
test('integrated frozen source maps across owner worktrees even when live source is removed', t => {
    const f=fixture(t),record=f.add('D1','dev-b',f.repoB);
    updateNight(f.manifest,{kind:'source-integrate',demandId:'D1',integrationBinding:{ownerId:'dev-a',repositoryRoot:f.repoA},...evidence},'leader',{runDirectory:f.root});
    record.assessment.post={...record.assessment.pre,...currentSources(record),reviewerId:'functional'};
    updateNight(f.manifest,{kind:'source-freeze',demandId:'D1',...evidence},'leader',{runDirectory:f.root});
    const sourcePath=path.join(f.repoB,'Shared.cls');fs.unlinkSync(sourcePath);
    const item=f.manifest.workItems.find(w=>w.id==='D1-deployment');
    const frozen=require('../lib/night-execution').frozenArtifact({manifest:f.manifest,item},sourcePath);
    assert.equal(fs.existsSync(frozen.path),true);assert.equal(frozen.sourcePath,sourcePath);assert.equal(frozen.sha256,record.sourceSnapshot.files[0].sha256);
});
test('two developer owners dispatch concurrently while per-owner and token limits block', t => {
    const f=fixture(t); f.add('D1','dev-a',f.repoA); f.add('D2','dev-b',f.repoB);
    const one=f.manifest.workItems.find(w=>w.id==='D1-implementation'),two=f.manifest.workItems.find(w=>w.id==='D2-implementation');
    one.status='running'; assert.equal(gateNight(f.manifest,two).allowed,true);
    two.status='running'; assert.equal(gateNight(f.manifest,one).allowed,true);
    const duplicate={...two,id:'another'};f.manifest.workItems.push(duplicate);
    assert.ok(gateNight(f.manifest,two).reasons.includes('owner-busy'));
    f.manifest.night.usage={totalTokens:f.manifest.executionPlan.budget.tokens};
    assert.ok(gateNight(f.manifest,one).reasons.includes('batch-token-budget-exhausted'));
    assert.equal(gateNight(f.manifest,f.manifest.workItems.find(w=>w.night.phase==='cleanup')).allowed,true);
    const functional=f.manifest.executionPlan.workers.find(w=>w.ownerId==='functional'),browser=f.manifest.executionPlan.workers.find(w=>w.ownerId==='browser');
    const testItem={id:'functional-verify',ownerId:'functional',repositoryRoot:functional.repositories[0].target,writeScopes:[],readScopes:['Shared.cls'],status:'pending',night:{demandId:'D1',phase:'verification'}};
    f.manifest.workItems.push(testItem,{...testItem,id:'browser-verify',ownerId:'browser',repositoryRoot:browser.repositories[0].target,status:'running'});
    assert.ok(gateNight(f.manifest,testItem).reasons.includes('tester-schedule-conflict'));
});
test('a demand update cannot invent managed test or deployment receipts', t => {
    const f=fixture(t),record=f.add('D1','dev-a',f.repoA);
    for(const key of ['testReceipts','deploymentReceipts']) assert.throws(()=>updateNight(f.manifest,{kind:'demand',record:{...structuredClone(record),[key]:[{status:'passed',frozenVersion:record.frozenVersion,evidenceRef:'invented:receipt'}]},...evidence},'leader'),/managed execution event/);
});
test('source-missing requires bounded declared lookup and does not clear safety history', t => {
    const f=fixture(t),record=f.add('D1','dev-a',f.repoA); record.failures.push({category:'lookup',evidenceFingerprint:'same'});
    const input={kind:'source-missing',demandId:'D1',handoffRef:'handoff:checkout-correct-repository',searchedScopes:[{repositoryRoot:f.repoA,scopes:['Shared.cls']}],elapsedMinutes:1,...evidence};
    assert.throws(()=>updateNight(f.manifest,{...input,searchedScopes:[{repositoryRoot:f.repoA,scopes:['../private']}]},'leader'),/escaped/);
    updateNight(f.manifest,input,'leader'); assert.equal(record.failures.length,1); assert.equal(record.skipped.reason,'source-missing'); assert.ok(f.manifest.workItems.every(w=>w.status==='skipped'));
});
test('client reservations share the run budget and cannot double-spend or replay an unknown launch', t => {
    const f=fixture(t); f.add('D1','dev-a',f.repoA); f.add('D2','dev-b',f.repoB);
    f.manifest.night.usage={basis:'managed-endpoints',unobservedGovernance:true,totalTokens:0,endpoints:[]};
    const work=f.manifest.workItems.filter(w=>w.night.phase==='implementation');
    for(const [i,item] of work.entries()) { item.status='running';f.manifest.actions.push({id:`action-${i}`,workItemId:item.id,status:'pending',scopeHash:f.manifest.orchestration.planHash,context:require('../lib/night-plan').buildActionContext(f.manifest,item)}); }
    const reserve=(i,tokens)=>({kind:'client-reserve',reservation:{actionId:`action-${i}`,tokens,deadlineAt:new Date(Date.now()+60000).toISOString(),launchReceiptFile:path.join(f.root,'evidence/night-operations',`launch-${i}.json`)},...evidence});
    updateNight(f.manifest,reserve(0,7000),'leader',{runDirectory:f.root});
    assert.throws(()=>updateNight(f.manifest,reserve(1,5000),'leader',{runDirectory:f.root}),/exceeds/);
    updateNight(f.manifest,reserve(1,4000),'leader',{runDirectory:f.root});
    assert.throws(()=>updateNight(f.manifest,reserve(0,7000),'leader',{runDirectory:f.root}),/already reserved/);
    assert.equal(f.manifest.night.clientReservations.reduce((sum,r)=>sum+r.tokens,0),11000);
});
