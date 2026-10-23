'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { planWorkspace, checkWorkspace, materializeWorkspace } = require('../night-workspace');
const { executionPlanFixture } = require('./fixtures/night-plan');
function runGit(repo, args) {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function fixture(t) {
    const parent = process.platform === 'win32' ? 'D:/tmp/Codex' : os.tmpdir();
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, 'night-workspace-'));
    const business = path.join(root, 'business'), source = path.join(root, 'source'), cap = path.join(root, 'capability');
    for (const dir of [business, source, cap]) fs.mkdirSync(dir);
    for (const repo of [source, cap]) runGit(repo, ['init', '-q']);
    write(path.join(source, 'code.txt'), 'original\n');runGit(source, ['add', 'code.txt']);runGit(source, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
    write(path.join(business, '.agents/config/plugin_profile.md'), 'enabled fixture\n');
    write(path.join(business, 'AGENTS.md'), '# Project entrypoint\n');
    fs.mkdirSync(path.join(cap, 'scripts/lib'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../lib/workspace-context.js'), path.join(cap, 'scripts/lib/workspace-context.js'));
    write(path.join(cap, 'scripts/check.js'), "'use strict';\n");
    write(path.join(cap, 'plugins/fixture/skills/check/SKILL.md'), '# Actual skill\n');
    for (const dir of ['vendor', 'agents', 'workflows']) fs.mkdirSync(path.join(cap, dir));
    const request = { businessWorkspace: business, capabilityRoot: cap, batchId: 'batch-1', role: 'developer', roleOwnerId: 'dev', repositories: [{ name: 'backend', sourceRepo: source, ref: runGit(source, ['rev-parse', 'HEAD']) }], requiredSkills: ['check'], requiredScripts: ['scripts/check.js'], contextReferences: [{ path: 'config/plugin_profile.md', source: path.join(business, '.agents/config/plugin_profile.md') }] };
    const targets = [];
    t.after(() => {
        for (const {target,sourceRepo} of targets) if (fs.existsSync(target)) runGit(sourceRepo, ['worktree', 'remove', '--force', target]);
        assert.equal(path.dirname(root), path.resolve(parent));
        assert.ok(path.basename(root).startsWith('night-workspace-'));
        assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
        fs.rmSync(root, { recursive: true, force: true });
        assert.equal(fs.existsSync(root), false);
    });
    function setup(input = request) {
        const plan = planWorkspace(input);
        for (const repo of plan.repositories) {
            fs.mkdirSync(path.dirname(repo.target), { recursive: true });
            runGit(repo.sourceRepo, ['worktree', 'add', '--detach', repo.target, repo.revision]); targets.push(repo);
        }
        const context = path.join(plan.workspaceRoot, '.agents');
        fs.symlinkSync(path.join(business, 'AGENTS.md'), path.join(plan.workspaceRoot, 'AGENTS.md'), 'file');
        for (const dir of plan.manifest.localDirectories) fs.mkdirSync(path.join(context, dir), { recursive: true });
        write(path.join(context, 'capability.json'), JSON.stringify(plan.manifest));
        for (const dir of plan.manifest.sharedDirectories) fs.symlinkSync(path.join(cap, dir), path.join(context, dir), 'junction');
        fs.mkdirSync(path.join(plan.workspaceRoot, 'src'));
        for (const repo of plan.repositories) fs.symlinkSync(repo.target, path.join(plan.workspaceRoot, 'src', repo.name), 'junction');
        fs.symlinkSync(request.contextReferences[0].source, path.join(context, 'config/plugin_profile.md'), 'file');
        write(path.join(context, 'skills/check/SKILL.md'), '---\nthin-index: true\nsource: .agents/plugins/fixture/skills/check/SKILL.md\n---\n');
        return plan;
    }
    return { root, business, source, cap, request, setup };
}
test('one schema 2.1 run gates real multi-repo overlays and automatically consumes executor receipts on repeated runs', async t => {
    const f=fixture(t), run=path.join(f.root,'run'), other=path.join(f.root,'frontend');
    write(path.join(f.source,'Smoke.cls'),'Class Fixture.Smoke Extends %RegisteredObject\n{\n}\n');runGit(f.source,['add','Smoke.cls']);runGit(f.source,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','class fixture']);f.request.repositories[0].ref=runGit(f.source,['rev-parse','HEAD']);
    fs.mkdirSync(other); runGit(other,['init','-q']); write(path.join(other,'code.txt'),'frontend\n'); runGit(other,['add','.']); runGit(other,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
    f.request.runReference=run; f.request.repositories.push({name:'frontend',sourceRepo:other,ref:runGit(other,['rev-parse','HEAD'])});
    const developer=f.setup(), reviewer=f.setup({...f.request,role:'reviewer',roleOwnerId:'reviewer'});
    assert.equal(checkWorkspace(developer).ok,true); assert.equal(checkWorkspace(reviewer).ok,true);
    const phases=['implementation','review','deployment','verification','cleanup'];
    const input=(name,value)=>{const file=path.join(f.root,name);write(file,JSON.stringify(value));return file;};
    const policy=input('policy.json',{}), now=Date.now();
    input('batch.json',{batchId:'batch-1',decisionPolicyReference:policy,runReference:run,authorizationReferences:{deploy:'grant:batch'},workspacePreflightReferences:[{ownerId:'dev',planReference:input('developer.json',developer)},{ownerId:'reviewer',planReference:input('reviewer.json',reviewer)}],policy:{interactionMode:'preflight-only',stopClaimingAt:new Date(now+3600000).toISOString(),stopPublishingAt:new Date(now+7200000).toISOString(),stopAt:new Date(now+10800000).toISOString()}});
    const workItems=['1','2'].flatMap(id=>phases.map((phase,i)=>({id:id==='1'?phase:`2-${phase}`,ownerId:phase==='review'?'reviewer':'dev',repositoryRoot:(phase==='review'?reviewer:developer).repositories[0].target,dependsOn:i?[id==='1'?phases[i-1]:`2-${phases[i-1]}`]:[],writeScopes:phase==='implementation'?['code.txt','Smoke.cls']:[],kind:phase==='cleanup'?'cleanup':'task',night:{demandId:id,phase,role:'tester',environmentAlias:'synthetic-test',effects:'read-only'}})));
    for(const id of ['1','2']){const primary=workItems.find(w=>w.id===(id==='1'?'implementation':'2-implementation'));const frontend={...structuredClone(primary),id:id==='1'?'implementation-ui':'2-implementation-ui',repositoryRoot:developer.repositories[1].target,writeScopes:['code.txt']};workItems.push(frontend);workItems.find(w=>w.id===(id==='1'?'review':'2-review')).dependsOn.push(frontend.id);}
    write(path.join(developer.repositories[1].target,'code.txt'),'frontend change under test\n');
    const plan={taskKind:'business-demand',coordinatorId:'leader',repositoryRoot:developer.repositories[0].target,nightBatchReference:'batch.json',orchestrationMode:'serial',adapter:'serial',adapterCapabilities:{serial:true},participants:[{id:'leader',role:'coordinator',endpoint:{type:'serial'}},{id:'dev',role:'coding',endpoint:{type:'serial'}},{id:'reviewer',role:'review',endpoint:{type:'serial'}}],workItems};
    const cli=(command,args=[])=>{const r=spawnSync(process.execPath,[path.resolve(__dirname,'../agent-orchestrator.js'),command,'--run-directory',run,...args],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(r.stdout);};
    cli('init',['--plan',input('plan.json',plan)]);
    const {recordNight,loadManifest}=require('../agent-orchestrator'), {currentSources}=require('../lib/night-dispatch'), managed=require('../lib/night-execution'), {runAcceptance,runPreflight}=require('../run-acceptance');
    const sourceScopes=developer.repositories.map(r=>({repoRoot:r.target,scopes:r.name==='backend'?['code.txt','Smoke.cls']:['code.txt']})), frozen=currentSources({sourceScopes}), evidence={rationale:'Synthetic actual contract exercise',evidenceRefs:['synthetic:source']};
    const assessment={businessCertainty:'confirmed',risk:'low',changeKinds:['query'],...evidence,reviewerId:'reviewer',minimumChecks:['actual-case'],route:'external-api',...frozen};
    for(const id of ['1','2'])recordNight(run,{kind:'demand',record:{id,implementationOwnerId:'dev',sourceScopes,...frozen,assessment:{pre:assessment,post:assessment},results:{knownDefect:false,unknownWrite:false},resources:{pending:false,polluted:false},timingSegments:[],failures:[],reassessments:[]},...evidence},'leader');
    assert.deepEqual(cli('next'),[]);
    const profileFile=path.join(f.root,'profile.cjs');write(profileFile,'// synthetic fixture\n');
    const http=require('node:http');let content=['Class Fixture.Old','{','}'],puts=0,compiles=0;
    const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{if(req.method==='PUT'){puts++;content=JSON.parse(body).content;}if(req.url.includes('/action/compile'))compiles++;res.end(JSON.stringify({status:{errors:[]},result:{content:req.url.includes('/action/compile')?[]:content,ts:'2026-01-01 00:00:00.000',enc:false},console:[]}));});});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
    const config={iris:{namespace:'TEST'},mcp:{serverName:'iris'}},mcp={mcpServers:{iris:{env:{IRIS_HOST:'127.0.0.1',IRIS_WEB_PORT:String(server.address().port),IRIS_USERNAME:'fixture',IRIS_PASSWORD:'synthetic-only',IRIS_NAMESPACE:'TEST',IRIS_SCHEME:'http'}}}};
    const configFile=path.join(developer.workspaceRoot,'.agents/config/project-env.json'),mcpFile=path.join(developer.workspaceRoot,'.mcp.json');write(configFile,JSON.stringify(config));write(mcpFile,JSON.stringify(mcp));
    const profile={options:{projectRoot:developer.workspaceRoot,deadlineAt:Date.now()+60000},preflight:async()=>({environmentAlias:'synthetic-test',cleanupVerified:true,deploymentConfigFingerprint:'configuration',authorizations:[{category:'deploy',reference:'grant:batch',environmentAlias:'synthetic-test',roles:['tester'],scopes:sourceScopes.map(s=>({repoRoot:s.repoRoot,paths:s.scopes}))}],checks:['authentication','role','entry','exit'].map(id=>({id,status:'passed',role:'tester',nonInteractive:true,evidenceRef:'synthetic:actual-probe'}))}),cases:[{demandId:'1',caseId:'actual-case',scope:sourceScopes,level:'external-api',role:'tester',entry:'synthetic-entry',effects:'read-only',createAdapter:()=>({prepare:async()=>true,verifyVersion:async()=>true,execute:async()=>{},assert:async()=>[{id:'actual',passed:true,evidenceRefs:['synthetic:actual-result']}],sideEffects:async()=>true,close:async()=>true})}]};
    profile.options.configurationFiles=[configFile,mcpFile];const originalPreflight=profile.preflight;profile.preflight=async()=>({...await originalPreflight(),deploymentConfigFingerprint:managed.fingerprint({config,mcp})});profile.cases.push({...profile.cases[0],demandId:'2'});
    await assert.rejects(runPreflight({...profile,cases:profile.cases.map(c=>({...c,level:'ui'}))},profileFile,run),/UI cases must declare/);
    const preflight=await runPreflight(profile,profileFile,run);assert.equal(preflight.state,'ready');
    const transition=(phase,status)=>cli('transition',['--entity','work-item','--id',phase,'--status',status]);
    for(const phase of ['implementation','implementation-ui','review']){transition(phase,'running');transition(phase,'completed');}
    transition('deployment','running');
    const execution={workspaceRoot:developer.workspaceRoot,projectRoot:developer.workspaceRoot,runDirectory:run,workItemId:'deployment',environmentAlias:'synthetic-test',configurationFingerprint:'configuration'};
    const deploy=workItem=>new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(process.execPath,[path.resolve(__dirname,'../../plugins/coding-iris-plugin/scripts/iris-tools/compile.js'),'--project-root',developer.workspaceRoot,'--files','src/backend/Smoke.cls','--execute','--work-item',workItem,'--environment-alias','synthetic-test'],{windowsHide:true});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);const timer=setTimeout(()=>{child.kill();reject(Error('Synthetic deployment timeout'));},30000);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);try{assert.equal(code,0,out+err);resolve(JSON.parse(out));}catch(e){reject(e);}});});
    await deploy('deployment');transition('deployment','completed');
    transition('verification','running');
    for(let round=0;round<2;round++){const result=await runAcceptance(profile,{...execution,workItemId:'verification',profileFingerprint:preflight.profileFingerprint});assert.equal(result.status,'scope-passed');}
    transition('verification','completed');transition('cleanup','running');transition('cleanup','completed');
    for(const phase of ['implementation','implementation-ui','review']){transition(`2-${phase}`,'running');transition(`2-${phase}`,'completed');}
    transition('2-deployment','running');const reused=await deploy('2-deployment');assert.ok(reused.reusedOperationId);assert.equal(puts,1);assert.equal(compiles,1);transition('2-deployment','completed');
    transition('2-verification','running');assert.equal((await runAcceptance(profile,{...execution,workItemId:'2-verification',profileFingerprint:preflight.profileFingerprint})).status,'scope-passed');transition('2-verification','completed');transition('2-cleanup','running');transition('2-cleanup','completed');
    const validation=require('../validation-evidence'),bindings=sourceScopes.map((source,i)=>{const evidenceFile=path.join(f.root,`validation-${i}.json`);validation.record(source.repoRoot,{suite:'synthetic-managed-acceptance',command:'managed compile CLI and acceptance executor',scopes:source.scopes,evidenceFile});return{repoRoot:source.repoRoot,suite:'synthetic-managed-acceptance',evidenceFile};});
    cli('transition',['--entity','verification','--status','passed','--verification-file',input('validation-bindings.json',bindings)]);cli('transition',['--entity','acceptance','--status','locally-verified']);cli('transition',['--entity','acceptance','--status','acceptance-pending']);
    const stored=loadManifest(run);assert.equal(stored.schemaVersion,'2.1');assert.equal(stored.night.demands[0].testReceipts.length,2);assert.equal(stored.night.demands[0].sources.length,2);assert.ok(stored.night.demands[0].timingSegments.filter(s=>s.granularity==='stage').every(s=>s.endedAt));assert.equal(stored.acceptance.status,'acceptance-pending');assert.equal(stored.verification.evidenceSnapshots.length,2);
    assert.throws(()=>managed.resolveBinding({projectRoot:developer.workspaceRoot}),/identity required/);
    const another=spawnSync(process.execPath,[path.resolve(__dirname,'../agent-orchestrator.js'),'init','--run-directory',path.join(f.root,'second-run'),'--plan',path.join(f.root,'plan.json')],{encoding:'utf8',windowsHide:true});assert.equal(another.status,1);
});
test('plan is read-only, defaults under business and carries explicit owner/source/overlay', t => {
    const f=fixture(t), before=runGit(f.source,['status','--porcelain=v1']), plan=planWorkspace(f.request);
    assert.equal(plan.workspaceRoot,path.join(f.business,'.worktrees/batch-1/developer'));
    assert.equal(plan.roleOwnerId,'dev');assert.equal(plan.repositories[0].status,'create');
    assert.equal(fs.existsSync(path.join(f.business,'.worktrees')),false);assert.equal(runGit(f.source,['status','--porcelain=v1']),before);
    assert.equal(checkWorkspace(plan).ok,false);
    const alternate=planWorkspace({...f.request,worktreeRoot:path.join(f.root,'custom')});assert.ok(alternate.workspaceRoot.startsWith(path.join(f.root,'custom')));
});
test('in-repository destinations require a directory ignore before creation and on resumed checks', t => {
    const f = fixture(t);
    runGit(f.business, ['init', '-q']);
    assert.throws(() => planWorkspace(f.request), /not ignored by Git/);
    assert.equal(fs.existsSync(path.join(f.business, '.worktrees')), false);
    write(path.join(f.business, '.gitignore'), '/.worktrees/\n');
    const plan = f.setup();
    assert.equal(checkWorkspace(plan).ok, true);
    write(path.join(f.business, '.gitignore'), '');
    assert.match(checkWorkspace(plan).issues.join(' '), /not ignored by Git/);
    write(path.join(f.business, '.git/info/exclude'), '/.worktrees/\n');
    assert.equal(checkWorkspace(plan).ok, true);
});

test('custom destination checks its containing repository and permits external paths', t => {
    const f = fixture(t);
    const custom = { ...f.request, worktreeRoot: path.join(f.source, 'nested', 'workers') };
    assert.throws(() => planWorkspace(custom), /not ignored by Git/);
    write(path.join(f.source, '.gitignore'), '/nested/workers/\n');
    assert.equal(planWorkspace(custom).request.worktreeRoot, custom.worktreeRoot);
    write(path.join(f.source, '.gitignore'), '/nested/*\n!/nested/workers/\n');
    assert.throws(() => planWorkspace(custom), /not ignored by Git/);
    assert.ok(planWorkspace({ ...f.request, worktreeRoot: path.join(f.root, 'external') }));
});

test('destination inside a linked worktree uses its gitfile and local excludes', t => {
    const f = fixture(t), existing = f.setup().repositories[0].target;
    const request = { ...f.request, worktreeRoot: path.join(existing, 'workers') };
    assert.equal(fs.statSync(path.join(existing, '.git')).isFile(), true);
    assert.throws(() => planWorkspace(request), /not ignored by Git/);
    write(path.join(f.source, '.git/info/exclude'), '/workers/\n');
    assert.ok(planWorkspace(request));
});

test('real registered worktree and actual worker cwd resolve shared capability, context and thin skill', t => {
    const f=fixture(t), plan=f.setup();const started=performance.now(),checked=checkWorkspace(plan);t.diagnostic(`Complete fresh-cwd check: ${Math.round(performance.now()-started)} ms`);assert.equal(checked.ok,true,JSON.stringify(checked));
    assert.equal(checked.repositories[0].status,'reuse');
    assert.equal(checked.repositories[0].target,plan.repositories[0].target);
    const mismatch=structuredClone(plan);mismatch.workspaceRoot=f.root;assert.match(checkWorkspace(mismatch).issues.join(' '),/differs from its request/);
    const wrongTarget=structuredClone(plan);wrongTarget.repositories[0].target=f.source;assert.match(checkWorkspace(wrongTarget).issues.join(' '),/differs from its request/);
    fs.unlinkSync(path.join(f.cap,'plugins/fixture/skills/check/SKILL.md'));
    assert.equal(checkWorkspace(plan).ok,false,'a thin index alone is not a reachable skill');
});
test('planning refuses dirty reuse but dispatch check permits task changes and descendant commits', t => {
    const f=fixture(t),plan=f.setup(),target=plan.repositories[0].target;
    write(path.join(target,'code.txt'),'local change\n');assert.throws(()=>planWorkspace(f.request),/dirty/);assert.equal(checkWorkspace(plan).ok,true);assert.equal(fs.readFileSync(path.join(target,'code.txt'),'utf8'),'local change\n');
    runGit(target,['add','code.txt']);runGit(target,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','different']);assert.throws(()=>planWorkspace(f.request),/revision differs/);assert.equal(checkWorkspace(plan).ok,true);
    runGit(target,['checkout','--orphan','unrelated']);runGit(target,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','orphan']);assert.equal(checkWorkspace(plan).ok,false,'an unrelated history cannot count as task progress');
});
test('mismatched original context and invalid scripts fail actual preflight', t => {
    const f=fixture(t),plan=f.setup(),profile=path.join(plan.workspaceRoot,'.agents/config/plugin_profile.md');
    fs.unlinkSync(profile);write(profile,'same-looking local copy\n');assert.match(checkWorkspace(plan).issues.join(' '),/original fact source/);
    fs.unlinkSync(profile);fs.symlinkSync(f.request.contextReferences[0].source,profile,'file');write(path.join(f.cap,'scripts/check.js'),'const broken = ;');assert.match(checkWorkspace(plan).issues.join(' '),/not loadable/);
});
test('path traversal, reserved roles and linked roots cannot redirect creation plan', t => {
    const f=fixture(t);assert.equal(checkWorkspace(null).ok,false);assert.throws(()=>planWorkspace({...f.request,role:'../elsewhere'}),/Safe/);assert.throws(()=>planWorkspace({...f.request,role:'CON'}),/Safe/);
    fs.symlinkSync(f.source,path.join(f.business,'.worktrees'),'junction');assert.throws(()=>planWorkspace(f.request),/traverses a link/);
});
test('an ordinary directory or unrelated git repository is never reused', t => {
    const f=fixture(t),plan=planWorkspace(f.request),target=plan.repositories[0].target;fs.mkdirSync(target,{recursive:true});write(path.join(target,'keep'),'unrelated');assert.equal(checkWorkspace(plan).ok,false);runGit(target,['init','-q']);assert.match(checkWorkspace(plan).issues.join(' '),/another repository/);assert.equal(fs.readFileSync(path.join(target,'keep'),'utf8'),'unrelated');
});
test('configured rules must load and source logical paths cannot silently change', t => {
    const f=fixture(t);f.request.requiredRules=['index.md'];const plan=f.setup();
    assert.equal(checkWorkspace(plan).ok,false);
    write(path.join(plan.workspaceRoot,'.agents/rules/index.md'),'# Project rules\n');assert.equal(checkWorkspace(plan).ok,true);
    plan.manifest.sourceRoots[0].path='src/redirected';
    fs.symlinkSync(plan.repositories[0].target,path.join(plan.workspaceRoot,'src/redirected'),'junction');
    write(path.join(plan.workspaceRoot,'.agents/capability.json'),JSON.stringify(plan.manifest));
    assert.match(checkWorkspace(plan).issues.join(' '),/SourceRoot\/GitRoot differs/);
});

function executionWorkspace(t) {
    const f = fixture(t);
    Object.assign(f.request, { role: 'developer', roleOwnerId: 'dev-a', executionPlanVersion: 1, runReference: path.join(f.root, 'run'), requiredRules: ['role.md'] });
    const plan = f.setup();
    write(path.join(plan.workspaceRoot, '.agents/rules/role.md'), '# Developer role\n');
    const manifest = {
        schemaVersion: '2.1', runId: 'approved-run', coordinatorId: 'leader', orchestration: { planHash: 'approved-plan-hash' },
        executionPlan: executionPlanFixture({ root: f.root, source: f.source, revision: plan.repositories[0].revision, gitCommonDir: path.resolve(f.source, runGit(f.source, ['rev-parse', '--git-common-dir'])), workspacePlans: [plan] }),
        authorizations: { collaborationPlan: { state: 'granted', scopeHash: 'approved-plan-hash', sourceReference: 'grant:approved-batch' } },
        night: { runReference: f.request.runReference, authorizationReferences: { collaborationPlan: 'grant:approved-batch' }, workspaces: [{ ownerId: 'dev-a', plan }] },
        eventLog: { lastSequence: 1, projectionHash: '' }
    };
    function save() {
        manifest.eventLog.projectionHash = require('../agent-orchestrator').projectionHash(manifest);
        write(path.join(f.request.runReference, '00-run-manifest.json'), JSON.stringify(manifest));
        write(path.join(f.request.runReference, 'events.jsonl'), JSON.stringify({ sequence: 1, payload: { projectionPatches: [{ op: 'set', path: '', value: manifest }] } }) + '\n');
    }
    save(); return { ...f, plan, manifest, save };
}
test('explicit PLAN materialization projects to overlay and physical Git entrypoints without changing originals', t => {
    const f = executionWorkspace(t), entry = path.join(f.plan.workspaceRoot, 'AGENTS.md'), physicalEntry = path.join(f.plan.repositories[0].target, 'AGENTS.md');
    const original = fs.readFileSync(path.join(f.business, 'AGENTS.md'), 'utf8');
    write(physicalEntry, '# Repository custom instruction\nKeep this paragraph.\n');
    assert.equal(checkWorkspace(f.plan).ok, false, 'read-only check cannot materialize missing artifacts');
    const before = fs.readFileSync(physicalEntry, 'utf8');
    assert.equal(fs.lstatSync(entry).isSymbolicLink(), true);
    const result = materializeWorkspace(f.plan);
    assert.equal(result.ok, true); assert.equal(result.artifacts.length, 2);
    assert.equal(fs.lstatSync(entry).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(f.business, 'AGENTS.md'), 'utf8'), original);
    assert.ok(fs.readFileSync(physicalEntry, 'utf8').startsWith(before));
    assert.equal(checkWorkspace(f.plan).ok, true, JSON.stringify(checkWorkspace(f.plan)));
    const once = fs.readFileSync(physicalEntry, 'utf8'); materializeWorkspace(f.plan); assert.equal(fs.readFileSync(physicalEntry, 'utf8'), once);
    fs.unlinkSync(path.join(f.plan.repositories[0].target, '.agents/rules/night_run_plan.md'));
    assert.match(checkWorkspace(f.plan).issues.join(' '), /ENOENT/, 'direct physical Git root must load its PLAN too');
});
test('current plan hash, artifact content and actual role rule are independently enforced', t => {
    const f = executionWorkspace(t); materializeWorkspace(f.plan);
    const rule = path.join(f.plan.workspaceRoot, '.agents/rules/night_run_plan.md');
    fs.appendFileSync(rule, '\nunauthorized projection change'); assert.match(checkWorkspace(f.plan).issues.join(' '), /hash differs/);
    materializeWorkspace(f.plan);
    f.manifest.orchestration.planHash = 'updated-plan'; f.manifest.authorizations.collaborationPlan.scopeHash = 'updated-plan'; f.save();
    assert.match(checkWorkspace(f.plan).issues.join(' '), /hash differs/);
    materializeWorkspace(f.plan); assert.equal(checkWorkspace(f.plan).ok, true);
    fs.unlinkSync(path.join(f.plan.workspaceRoot, '.agents/rules/role.md')); assert.equal(checkWorkspace(f.plan).ok, false);
});
test('materialize refuses unapproved/stale runs and shared context before writing either worker entrance', t => {
    const f = executionWorkspace(t), rootRule = path.join(f.plan.workspaceRoot, '.agents/rules/night_run_plan.md'), physical = f.plan.repositories[0].target;
    f.manifest.authorizations.collaborationPlan.scopeHash = 'stale'; f.save();
    assert.throws(() => materializeWorkspace(f.plan), /approved collaborationPlan/); assert.equal(fs.existsSync(rootRule), false);
    f.manifest.authorizations.collaborationPlan.scopeHash = f.manifest.orchestration.planHash; f.save();
    fs.symlinkSync(path.join(f.business, '.agents'), path.join(physical, '.agents'), 'junction');
    assert.throws(() => materializeWorkspace(f.plan), /traverses a link/); assert.equal(fs.existsSync(rootRule), false);
    assert.equal(fs.existsSync(path.join(f.business, '.agents/rules/night_run_plan.md')), false);
    assert.equal(fs.lstatSync(path.join(f.plan.workspaceRoot, 'AGENTS.md')).isSymbolicLink(), true);
    fs.unlinkSync(path.join(physical, '.agents'));
    f.manifest.executionPlan.workers[1].repositories[0].sourceIdentity.gitCommonDir = f.cap; f.save();
    assert.throws(() => materializeWorkspace(f.plan), /source identity/); assert.equal(fs.existsSync(rootRule), false);
    assert.throws(() => materializeWorkspace({ ...f.plan, request: { ...f.plan.request, executionPlanVersion: undefined } }), /explicit/);
});
test('each developer gets its own workspace and unrelated AGENTS links are preserved', t => {
    const f = executionWorkspace(t), second = planWorkspace({ ...f.request, roleOwnerId: 'dev-b' });
    assert.notEqual(second.workspaceRoot, f.plan.workspaceRoot);
    assert.equal(path.basename(second.workspaceRoot), 'dev-b');
    const physicalEntry = path.join(f.plan.repositories[0].target, 'AGENTS.md');
    fs.symlinkSync(path.join(f.plan.workspaceRoot, '.agents/rules/role.md'), physicalEntry, 'file');
    assert.throws(() => materializeWorkspace(f.plan), /approved original entrypoint/);
    assert.equal(fs.lstatSync(physicalEntry).isSymbolicLink(), true);
    assert.equal(fs.existsSync(path.join(f.plan.workspaceRoot, '.agents/rules/night_run_plan.md')), false);
});

// This is a Git/Overlay + handoff tool drill, not proof of model compliance or unattended execution.
test('approved exit uses two isolated source worktrees and resumes their exact handoff without resetting history', t => {
    const f = fixture(t), frontend = path.join(f.root, 'frontend');
    runGit(f.root, ['clone', '-q', '--no-hardlinks', f.source, frontend]);
    f.request.repositories.push({ name: 'frontend', sourceRepo: frontend, ref: runGit(frontend, ['rev-parse', 'HEAD']) });
    const bases = f.request.repositories.map(r => r.ref);
    write(path.join(f.source, 'code.txt'), 'unrelated original checkout edit\n');
    write(path.join(frontend, 'parallel.txt'), 'other owner\n');
    const before = f.request.repositories.map(r => runGit(r.sourceRepo, ['status', '--porcelain=v1']));
    const originalHistory = { approved: false, quotaBaseline: 20, consumedPercentPoints: 2, stopClaimingAt: '2030-01-01T01:00:00+08:00', stopPublishingAt: '2030-01-01T02:00:00+08:00', stopAt: '2030-01-01T03:00:00+08:00', unresolvedProbe: { stopped: false, businessAuthorized: false } };
    // Preparation is read-only before the separately recorded human decision.
    const proposal = planWorkspace(f.request);
    assert.equal(fs.existsSync(proposal.workspaceRoot), false);
    assert.deepEqual(f.request.repositories.map(r => runGit(r.sourceRepo, ['status', '--porcelain=v1'])), before);
    const history = { ...originalHistory, approved: true, quote: 'Exit night and continue supervised serial in isolated worktrees' };
    const plan = f.setup(); assert.equal(checkWorkspace(plan).ok, true);
    assert.equal(plan.manifest.nightRunReference, undefined); assert.equal(plan.request.executionPlanVersion, undefined);
    for (const r of plan.repositories) {
        assert.equal(runGit(r.target, ['rev-parse', 'HEAD']), r.revision);
        runGit(r.target, ['checkout', '-qb', 'codex/supervised-fixture']);
        write(path.join(r.target, 'code.txt'), 'authorized serial change\n');
    }
    const context = path.join(f.root, 'context.json');
    write(context, JSON.stringify({ repositories: plan.repositories.map(r => ({ root: r.target, scopes: ['code.txt'] })), entrypoints: [], evidence: [] }));
    const tool = path.resolve(__dirname, '../../plugins/agent-context-kit/scripts/task-handoff.js');
    function handoff(args) { const result = spawnSync(process.execPath, [tool, ...args, '--project-root', plan.workspaceRoot], { encoding: 'utf8', windowsHide: true, timeout: 15000 }); assert.equal(result.status, 0, result.stdout + result.stderr); return JSON.parse(result.stdout); }
    const created = handoff(['init', '--title', 'Synthetic supervised exit', '--task-kind', 'other', '--context-file', context]);
    const doc = path.join(created.directory, 'handoff.md');
    write(doc, fs.readFileSync(doc, 'utf8').replace(/\bTODO\b/g, 'Synthetic tool drill') + '\n## Preserved night preparation\n\n' + JSON.stringify(history) + '\n');
    handoff(['checkpoint', '--task-directory', created.directory]);
    assert.equal(handoff(['validate', '--task-directory', created.directory]).valid, true);
    // A separate invocation reads the persisted checkpoint, rather than this test's plan object.
    const recovered = JSON.parse(fs.readFileSync(path.join(created.directory, 'state.json')));
    assert.deepEqual(recovered.inputs.repositories.map(r => r.root).sort(), plan.repositories.map(r => r.target).sort());
    assert.equal(handoff(['inspect', '--task-directory', created.directory]).valid, true);
    assert.equal(fs.readFileSync(path.join(f.source, 'code.txt'), 'utf8'), 'unrelated original checkout edit\n');
    assert.equal(fs.readFileSync(path.join(frontend, 'parallel.txt'), 'utf8'), 'other owner\n');
    assert.deepEqual(JSON.parse(fs.readFileSync(doc, 'utf8').split('## Preserved night preparation\n\n')[1]), history);
    assert.deepEqual(f.request.repositories.map(r => runGit(r.sourceRepo, ['rev-parse', 'HEAD'])), bases);
    assert.deepEqual(f.request.repositories.map(r => runGit(r.sourceRepo, ['status', '--porcelain=v1'])), before);
    const invalid = structuredClone(f.request); invalid.batchId = 'invalid-exit'; invalid.repositories[0].ref = 'missing-reference';
    assert.throws(() => planWorkspace(invalid), /Git check failed/);
    assert.equal(fs.existsSync(path.join(f.business, '.worktrees', 'invalid-exit')), false);
});
