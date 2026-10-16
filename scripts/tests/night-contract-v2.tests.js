'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const contract = require('../lib/night-contract');
const { currentSources, updateNight } = require('../lib/night-dispatch');
const { normalizePolicy, assessDemand } = require('../lib/night-policy');
const { runTestCase } = require('../lib/test-evidence');
const { documentName } = require('../../plugins/coding-iris-plugin/scripts/iris-tools/backend-document');
const evidence = { rationale: 'Synthetic contract experiment', evidenceRefs: ['synthetic:observed'] };
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'night-contract-'));
    t.after(() => { assert.equal(fs.lstatSync(root).isSymbolicLink(), false); fs.rmSync(root, { recursive: true, force: true }); assert.equal(fs.existsSync(root), false); });
    const repositories = ['backend', 'frontend'].map(name => {
        const repo = path.join(root, name); fs.mkdirSync(repo);
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'pipe' });
        execFileSync('git', ['-C', repo, 'config', 'core.autocrlf', 'false']);
        fs.writeFileSync(path.join(repo, 'same.js'), 'module.exports=1;\n');
        execFileSync('git', ['-C', repo, 'add', '.']);
        execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
        return repo;
    });
    const profile = path.join(root, 'profile.js'); fs.writeFileSync(profile, '// trusted synthetic profile\n');
    const phases = ['implementation', 'review', 'deployment', 'verification', 'cleanup'];
    const manifest = { schemaVersion: '2.1', repositoryRoot: repositories[0], coordinatorId: 'leader', orchestration: { mode: 'serial', planHash: 'plan-1' }, participants: [{ id: 'leader' }, { id: 'dev' }, { id: 'reviewer' }], authorizations: { deploy: { state: 'not-granted' } }, workItems: [], night: { interactionMode: 'preflight-only', runReference: path.join(root, 'run'), authorizationReferences: { deploy: 'grant:batch', testDataWrite: 'grant:data', testDataDisposition: 'grant:dispose' }, policy: normalizePolicy(), limits: { stopClaimingAt: new Date(Date.now()+3600000).toISOString(), stopPublishingAt: new Date(Date.now()+7200000).toISOString(), stopAt: new Date(Date.now()+10800000).toISOString() }, workspaces: ['dev', 'reviewer'].map(ownerId => ({ ownerId, plan: { repositories: repositories.map(target => ({ target })) } })), demands: [], shared: { timingSegments: [], reassessments: [] }, humanReassessments: [] } };
    manifest.workItems = phases.map((phase, i) => ({ id: phase, ownerId: phase === 'review' ? 'reviewer' : 'dev', repositoryRoot: repositories[0], writeScopes: i === 0 ? ['same.js'] : [], dependsOn: i ? [phases[i-1]] : [], status: 'pending', attempts: [], kind: phase === 'cleanup' ? 'cleanup' : 'task', night: { demandId: '1', phase, role: 'tester', effects: 'read-only', environmentAlias: 'isolated-test' } }));
    const sourceScopes = repositories.map(repoRoot => ({ repoRoot, scopes: ['same.js'] })), frozen = currentSources({ sourceScopes });
    const assessment = { businessCertainty: 'confirmed', risk: 'low', changeKinds: ['query'], ...evidence, reviewerId: 'reviewer', minimumChecks: ['readback'], route: 'external-api', ...frozen };
    const record = { id: '1', implementationOwnerId: 'dev', ...frozen, sourceScopes, assessment: { pre: structuredClone(assessment), post: structuredClone(assessment) }, results: { knownDefect: false, unknownWrite: false }, resources: { polluted: false, pending: false }, timingSegments: [], failures: [], reassessments: [], testReceipts: [], candidateReady: false };
    manifest.night.demands.push(record);
    const receipt = { environmentAlias: 'isolated-test', cleanupVerified: true, profileFingerprint: 'profile-hash', configFingerprint: 'config-hash', deploymentConfigFingerprint: 'deploy-hash', checkedAt: new Date().toISOString(), configurationFiles: [{ path: profile, sha256: crypto.createHash('sha256').update(fs.readFileSync(profile)).digest('hex') }], authorizations: [{ category: 'deploy', reference: 'grant:batch', environmentAlias: 'isolated-test', roles: ['tester'], scopes: repositories.map(repoRoot => ({ repoRoot, paths: ['same.js'] })) }], checks: ['authentication', 'role', 'entry', 'exit'].map(id => ({ id, status: 'passed', role: 'tester', nonInteractive: true, evidenceRef: 'synthetic:actual-probe' })) };
    return { root, repositories, profile, manifest, receipt, record, item: phase => manifest.workItems.find(w => w.id === phase) };
}
test('strict preflight blocks missing permissions and interactive browser; valid preauthorization is reused', t => {
    const f=fixture(t); contract.validateItems(f.manifest);
    const missing=structuredClone(f.receipt); missing.authorizations=[]; contract.recordPreflight(f.manifest,missing);
    assert.equal(f.manifest.night.preflight.state,'blocked');
    contract.recordPreflight(f.manifest,f.receipt); assert.equal(f.manifest.night.preflight.state,'ready');
    assert.equal(f.manifest.authorizations.deploy.sourceReference,'grant:batch');
    f.item('verification').night.route='ui';
    assert.ok(contract.readinessReasons(f.manifest,f.item('verification')).includes('night-capability-missing:browser'));
    f.receipt.checks.push(...['browser','viewport'].map(id=>({id,status:'passed',role:'tester',nonInteractive:true,executor:'host-browser',evidenceRef:'synthetic:probe'})));
    contract.recordPreflight(f.manifest,f.receipt); assert.equal(f.manifest.night.preflight.state,'blocked');
    f.receipt.checks.find(c=>c.id==='browser').executor='playwright-headless'; contract.recordPreflight(f.manifest,f.receipt); assert.equal(f.manifest.night.preflight.state,'ready');
});
test('runtime cannot acquire grants; revocation and configuration changes hold affected execution', t=>{
    const f=fixture(t); contract.recordPreflight(f.manifest,f.receipt); contract.trackWork(f.manifest,f.item('implementation'),'running');
    const wider=structuredClone(f.receipt); wider.authorizations[0].scopes[0].paths=['.'];
    assert.throws(()=>contract.recordPreflight(f.manifest,wider),/cannot acquire/);
    f.manifest.authorizations.deploy.state='revoked'; contract.rebindAuthorizations(f.manifest);
    assert.equal(f.manifest.authorizations.deploy.state,'revoked');
    assert.ok(contract.readinessReasons(f.manifest,f.item('deployment')).some(r=>r.includes('authorization')));
    assert.deepEqual(contract.readinessReasons(f.manifest,f.item('implementation')),[], 'revoked deploy must not stop unaffected source work');
    fs.appendFileSync(f.profile,'// changed'); assert.ok(contract.readinessReasons(f.manifest,f.item('verification')).includes('night-configuration-changed'));
    assert.deepEqual(contract.readinessReasons(f.manifest,f.item('cleanup')),[]);
});
test('source range enlargement cannot silently rebind plan grants', t=>{
    const f=fixture(t); contract.recordPreflight(f.manifest,f.receipt);
    f.manifest.orchestration.planHash='plan-2'; contract.rebindAuthorizations(f.manifest); assert.equal(f.manifest.authorizations.deploy.scopeHash,'plan-2');
    f.item('implementation').writeScopes=['.']; f.manifest.orchestration.planHash='plan-3'; contract.rebindAuthorizations(f.manifest);
    assert.equal(f.manifest.authorizations.deploy.scopeHash,'plan-2'); assert.ok(contract.readinessReasons(f.manifest,f.item('implementation')).includes('night-plan-outside-preauthorization'));
});
test('unexpected limits create one local handoff and preserve unresolved operation ownership', t=>{
    const f=fixture(t), item=f.item('verification');
    item.status='running';contract.trackWork(f.manifest,item,'running');contract.holdWork(f.manifest,item,['night-capability-missing:role'],['synthetic:auth']);contract.holdWork(f.manifest,item,['night-capability-missing:role'],['synthetic:auth']);
    assert.equal(item.status,'blocked');assert.equal(f.manifest.night.handoffs.length,1);assert.equal(f.record.blocked,true);assert.ok(f.record.timingSegments[0].endedAt);assert.equal(f.record.resources.pending,false);
    f.manifest.night.operations=[{id:'unresolved',workItemId:item.id,status:'running'}];contract.holdWork(f.manifest,item,['execution-unknown']);assert.equal(f.record.resources.pending,true);
});
test('same paths in different repositories do not conflict; physical aliases cannot bypass ownership', t=>{
    const f=fixture(t), other=structuredClone(f.item('implementation')); other.id='other'; other.ownerId='leader'; other.repositoryRoot=f.repositories[1]; f.manifest.night.workspaces.push({ownerId:'leader',plan:{repositories:f.repositories.map(target=>({target}))}}); f.manifest.workItems.push(other); f.item('review').dependsOn.push('other');
    contract.validateItems(f.manifest);
    const alias=path.join(f.root,'alias'); fs.symlinkSync(f.repositories[0],alias,'junction'); other.repositoryRoot=alias;
    assert.throws(()=>contract.validateItems(f.manifest),/Conflicting owners/);
    other.repositoryRoot=path.dirname(f.repositories[0]); assert.throws(()=>contract.validateItems(f.manifest));
});
test('all stages and dependency ordering are required; timing is observed rather than invented', t=>{
    const f=fixture(t), removed=f.manifest.workItems.splice(2,1)[0]; assert.throws(()=>contract.validateItems(f.manifest),/phase missing/); f.manifest.workItems.splice(2,0,removed);
    f.item('verification').dependsOn=[]; assert.throws(()=>contract.validateItems(f.manifest),/dependency/);
    f.item('verification').dependsOn=['deployment'];f.item('review').status='skipped';f.item('review').night.skipReason='external review handoff';f.item('review').night.handoffRef='synthetic:review';f.item('deployment').dependsOn=[];assert.throws(()=>contract.validateItems(f.manifest),/dependency/);
    f.item('implementation').status='running'; assert.equal(contract.timingStatus(f.manifest,f.record),'incomplete');
    contract.trackWork(f.manifest,f.item('implementation'),'running'); contract.trackWork(f.manifest,f.item('implementation'),'completed');
    assert.equal(contract.timingStatus(f.manifest,f.record),'recorded'); assert.ok(f.record.timingSegments[0].endedAt);
});
test('cross-repository fingerprint includes newly created in-scope files', t=>{
    const f=fixture(t);f.record.sourceScopes=f.repositories.map(repoRoot=>({repoRoot,scopes:['.']}));const before=currentSources(f.record);fs.writeFileSync(path.join(f.repositories[1],'NewFile.js'),'new source');const after=currentSources(f.record);assert.notEqual(after.frozenVersion,before.frozenVersion);assert.equal(after.sources[0].repoRoot,before.sources[0].repoRoot);
});
test('stage and detailed timing do not double-charge overlapping preparation',t=>{
    const f=fixture(t),end=Date.now(),start=end-60000;
    f.record.timingSegments=[{phase:'diagnosis',granularity:'stage',startedAt:new Date(start).toISOString(),endedAt:new Date(end).toISOString()},{phase:'preparation',granularity:'detail',startedAt:new Date(start+15000).toISOString(),endedAt:new Date(start+45000).toISOString()}];
    assert.equal(assessDemand(f.record,'pre',{},end).usedMinutes,1);for(const segment of f.record.timingSegments)delete segment.granularity;assert.equal(assessDemand(f.record,'pre',{},end).usedMinutes,1.5);
});
test('one managed operation binds work/version, consumes a receipt once, and requires a complete operation', t=>{
    const f=fixture(t); contract.recordPreflight(f.manifest,f.receipt); const item=f.item('verification'); item.status='running';
    const operation={id:'op-1',workItemId:item.id,phase:'verification',profileFingerprint:'profile-hash',environmentAlias:'isolated-test',artifacts:[]};
    contract.operationRecord(f.manifest,{kind:'operation-start',operation},currentSources,()=>({allowed:true}));
    assert.throws(()=>contract.assertStageComplete(f.manifest,item),/requires current/);
    const result={schema:'imedical-test-result/v1',demandId:'1',caseId:'case-1',scope:f.record.sourceScopes,version:f.record.frozenVersion,status:'passed',binding:{operationId:'op-1',workItemId:item.id},acceptance:{level:'external-api'},dataDisposition:{verified:true,status:'not-applicable'},cleanup:{verified:true},timingSegments:[],assertions:[{passed:true,evidenceRefs:['synthetic:readback']}]};
    const file=path.join(f.root,'result.json'); fs.writeFileSync(file,JSON.stringify(result));
    const input={kind:'test-result',id:'1',resultFile:file,...evidence}; updateNight(f.manifest,input,'leader'); updateNight(f.manifest,input,'leader'); assert.equal(f.record.testReceipts.length,1);
    assert.throws(()=>contract.assertStageComplete(f.manifest,item));
    const completion={kind:'operation-result',operationId:'op-1',result:{status:'scope-passed',results:[result],cleanup:{cleanupVerified:true}},evidenceRefs:['synthetic:full-operation']};
    contract.operationRecord(f.manifest,completion,currentSources); contract.operationRecord(f.manifest,completion,currentSources); contract.assertStageComplete(f.manifest,item);
    fs.writeFileSync(path.join(f.repositories[1],'same.js'),'changed frontend'); assert.notEqual(currentSources(f.record).frozenVersion,f.record.frozenVersion);
    f.record.frozenVersion=currentSources(f.record).frozenVersion; assert.throws(()=>contract.assertStageComplete(f.manifest,item));
});
test('deployment artifact scope and receipt identity reject unrelated work and stale versions', t=>{
    const f=fixture(t); contract.recordPreflight(f.manifest,f.receipt); f.item('deployment').status='running';
    const localPath=path.join(f.repositories[0],'other.js'); fs.writeFileSync(localPath,'outside');
    const operation={id:'deploy',workItemId:'deployment',phase:'deployment',environmentAlias:'isolated-test',artifacts:[{localPath,sha256:crypto.createHash('sha256').update('outside').digest('hex')}]};
    assert.throws(()=>contract.operationRecord(f.manifest,{kind:'operation-start',operation},currentSources,()=>({allowed:true})),/outside frozen/);
    operation.artifacts[0]={localPath:path.join(f.repositories[0],'same.js'),sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(f.repositories[0],'same.js'))).digest('hex')};
    contract.operationRecord(f.manifest,{kind:'operation-start',operation},currentSources,()=>({allowed:true}));
    fs.appendFileSync(operation.artifacts[0].localPath,'// drift'); contract.operationRecord(f.manifest,{kind:'operation-result',operationId:'deploy',result:{status:'verified'},evidenceRefs:['synthetic:readback']},currentSources);
    assert.equal(f.manifest.night.operations[0].status,'review-pending'); assert.throws(()=>contract.assertStageComplete(f.manifest,f.item('deployment')));
});
const adapter=overrides=>({prepare:async()=>true,verifyVersion:async()=>true,execute:async()=>{},assert:async()=>[{id:'actual',passed:true,evidenceRefs:['synthetic:proof']}],sideEffects:async()=>true,close:async()=>true,...overrides});
test('data retention/reset/deletion and resource exit have independent outcomes',async()=>{
    for(const [policy,status] of Object.entries({retain:'retained',reset:'reset',delete:'deleted'})){
        const result=await runTestCase({caseId:policy,scope:['synthetic'],version:'frozen',strictData:true,effects:'write',dataPolicy:policy,adapter:adapter({inspectFixtures:async()=>({identityVerified:true,relationsVerified:true,ownershipVerified:true,entryVerified:true,reuseVerified:true,evidenceRefs:['synthetic:fixture']}),finalizeData:async()=>({status,verified:true,evidenceRefs:['synthetic:disposition']})})});
        assert.equal(result.status,'passed'); assert.equal(result.dataDisposition.status,status); assert.equal(result.cleanup.verified,true);
    }
    await assert.rejects(runTestCase({caseId:'write',scope:['synthetic'],version:'frozen',strictData:true,effects:'write',dataPolicy:'retain',adapter:adapter()}),/disposition adapter/);
    let executed=0,closed=0;
    const result=await runTestCase({caseId:'wrong-identity',scope:['synthetic'],version:'frozen',strictData:true,effects:'write',dataPolicy:'delete',adapter:adapter({inspectFixtures:async()=>({identityVerified:false}),execute:async()=>executed++,finalizeData:async()=>({status:'pending',verified:false}),close:async()=>{closed++;return true;}})});
    assert.equal(executed,0); assert.equal(closed,1); assert.equal(result.cleanup.verified,true); assert.equal(result.dataDisposition.verified,false); assert.equal(result.status,'review-pending');
});
test('CLS name comes from Class declaration independently of module paths',()=>{
    assert.equal(documentName('src/backend/dental/src/wrong/name.cls','\uFEFFClass Actual.Package.Model Extends %Persistent {}'),'Actual.Package.Model.cls');
    assert.throws(()=>documentName('src/wrong.cls','// no declaration'),/name-unknown/);
});
test('PowerShell 5.1 check example stops when an earlier native command fails', { skip: process.platform !== 'win32' }, t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'night-ps51-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const docs=fs.readFileSync(path.resolve(__dirname,'../../docs/night-acceptance.md'),'utf8'), example=docs.match(/```powershell\r?\n([\s\S]*?)```/)[1];
    const profile=path.join(root,'profile.js'),check=path.join(root,'check.js'),script=path.join(root,'checks.ps1'),marker=path.join(root,'must-not-execute');
    fs.writeFileSync(profile,'invalid javascript syntax !!!');fs.writeFileSync(check,`require('fs').writeFileSync(${JSON.stringify(marker)},'wrong');`);
    fs.writeFileSync(script,`$profilePath='${profile}'\n$projectCheckScript='${check}'\n${example}`);
    assert.throws(()=>execFileSync('powershell.exe',['-NoProfile','-File',script],{stdio:'pipe'}));assert.equal(fs.existsSync(marker),false);
    fs.writeFileSync(profile,'module.exports=true;');execFileSync('powershell.exe',['-NoProfile','-File',script],{stdio:'pipe'});assert.equal(fs.existsSync(marker),true);
});
