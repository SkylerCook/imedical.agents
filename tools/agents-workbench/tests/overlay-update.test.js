'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');
const deployment = require('../../../scripts/lib/plugin-deployment');
const { planOverlayUpdate } = require('../src/overlay-members');
const { applyOverlayUpdate, runCanonicalMember } = require('../src/overlay-update');

function fixture(t) {
  const directory = createTempDirectory('workbench-overlay-update-');
  t.after(() => {
    assert.ok(ownsTempDirectory(directory));
    fs.rmSync(directory,{recursive:true,force:true,maxRetries:3});
  });
  const root = path.join(directory,'标准 根');
  const capabilityRoot = path.join(root,'.agents');
  const gitRoot = path.join(capabilityRoot,'.git');
  fs.mkdirSync(path.join(capabilityRoot,'scripts'),{recursive:true});
  const env = {...process.env,GIT_ALLOW_PROTOCOL:'',GIT_NO_LAZY_FETCH:'1'};
  const git = (args,input) => {
    const result = spawnSync('git',['-C',capabilityRoot,...args],{input,env,encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr || result.error?.message);
    return result.stdout.trim();
  };
  git(['init','-q']);
  git(['config','--local','remote.origin.url','https://gitee.com/skyler-cook/imedical.agents.git']);
  fs.writeFileSync(path.join(capabilityRoot,'scripts/update-agents.ps1'),[
    'param([string]$ProjectRoot,[string]$Mode,[switch]$NoPull,[switch]$Detailed)',
    'if (-not $NoPull -or -not $Detailed -or $env:GIT_ALLOW_PROTOCOL -or -not $env:IMEDICAL_DEPLOYMENT_LOCK) { exit 9 }',
    'Add-Content -LiteralPath (Join-Path $ProjectRoot "fixture-owner-trace.txt") -Value $Mode',
    'if ($Mode -eq "Write" -and (Test-Path -LiteralPath (Join-Path $ProjectRoot "fixture-fail-write"))) { exit 7 }',
    'Write-Output "status : capability-pull-skipped-overlay"',
  ].join('\r\n'));
  const tree = git(['mktree'],'');
  const commit = (description, parent) => git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,
    ...(parent ? ['-p',parent] : [])],description+'\n');
  const before = commit('Fixture installed capability');
  const after = commit('Fixture approved update',before);
  git(['update-ref','HEAD',before]);

  function member(name, local, explicit = false, shared = capabilityRoot) {
    const workspaceRoot = path.join(directory,name);
    const contextRoot = path.join(workspaceRoot,local);
    const declaration = path.join(workspaceRoot,'.agents');
    for (const dir of [contextRoot,declaration]) fs.mkdirSync(dir,{recursive:true});
    fs.mkdirSync(path.join(contextRoot,'config'));
    fs.writeFileSync(path.join(contextRoot,'config/project.jsonc'),'{"plugins":{"example":{"status":"enabled"}}}');
    fs.symlinkSync(root,path.join(workspaceRoot,'backend'),process.platform === 'win32' ? 'junction' : 'dir');
    const manifest = path.join(declaration,'capability.json');
    const data = {schemaVersion:1,mode:'workspace-overlay',workspace:name,contextRoot:local,capabilityRoot:shared,
      sharedDirectories:[],localDirectories:[],sourceRoots:[{name:'backend',path:'backend',target:root,gitRoot:root}]};
    fs.writeFileSync(manifest,JSON.stringify(data));
    return {workspaceRoot,manifest,data,record:{contextRoot,...(explicit?{workspaceRoot}:{}),lastRequired:['example']}};
  }
  const first = member('第一个模块','.agents');
  const second = member('第二个模块','data/context',true);
  const missing = {contextRoot:path.join(directory,'缺席模块','.agents'),lastRequired:['offline-preserved']};
  const registry = path.join(gitRoot,'plugin-deployment.json');
  const record = extra => fs.writeFileSync(registry,JSON.stringify({schema:'plugin-installation/v1',mode:'on-demand',
    installed:[],members:[{contextRoot:capabilityRoot,lastRequired:[]},first.record,second.record,missing,...extra]}));
  record([]);
  return {root,capabilityRoot,registry,git,before,after,first,second,missing,member,record};
}

test('overlay roster uses explicit declarations and retains absent members without searching neighbors', t => {
  const f = fixture(t);
  const unregistered = f.member('未登记模块','.agents');
  const oldCustom = f.member('旧自定义上下文','data/context');
  const missingProfile = f.member('已丢失状态的模块','.agents');
  fs.unlinkSync(path.join(missingProfile.record.contextRoot,'config/project.jsonc'));
  const foreign = f.member('指向别处的模块','.agents',false,path.join(f.root,'not-capability'));
  const wrongRoot = {...foreign.record,workspaceRoot:f.first.workspaceRoot};
  f.record([oldCustom.record,wrongRoot,missingProfile.record]);
  const registry = fs.readFileSync(f.registry);
  const plan = planOverlayUpdate(f.root);
  assert.deepEqual(plan.members.map(row => row.status),['ready','ready','offline','needs-verification','needs-verification','offline']);
  assert.equal(plan.members[0].workspaceRoot,f.first.workspaceRoot);
  assert.equal(plan.members[1].workspaceRoot,f.second.workspaceRoot);
  assert.ok(!plan.members.some(row => row.workspaceRoot === unregistered.workspaceRoot));
  assert.deepEqual(plan.members[2].lastRequired,['offline-preserved']);
  const attempts = {updateRoot:() => assert.fail('unverified member must not update root'),
    withMemberLease:() => assert.fail('unverified member must not run')};
  for (const id of [plan.members[2].id,plan.members[3].id,'arbitrary path or id']) {
    assert.throws(()=>applyOverlayUpdate(plan,[id],attempts), /overlay-selection-unverified/);
  }
  assert.deepEqual(fs.readFileSync(f.registry),registry);
  assert.equal(f.git(['rev-parse','HEAD']),f.before);
});

test('a changed declaration cannot inherit a previous selection and a changed root stops later phases', t => {
  const f = fixture(t);
  const initial = planOverlayUpdate(f.root);
  fs.writeFileSync(f.second.manifest,JSON.stringify({...f.second.data,capabilityRoot:f.root}));
  const rejected = applyOverlayUpdate(initial,[initial.members[1].id],{
    updateRoot:() => assert.fail('stale member must not update root'),withMemberLease:() => assert.fail('stale member must not run'),
  });
  assert.equal(rejected.status,'blocked');
  assert.equal(rejected.members[0].error,'overlay-member-changed');
  const refreshed = planOverlayUpdate(f.root);
  const modes = [];
  const stopped = applyOverlayUpdate(refreshed,[refreshed.members[0].id],{
    withMemberLease:(_root, callback) => callback('fixture-lease'),
    runMember:(_root,_member,mode) => {
      modes.push(mode);
      f.git(['update-ref','HEAD',f.after,f.before]);
      return {exitCode:0,noPull:true};
    },
  });
  assert.deepEqual(modes,['DryRun']);
  assert.equal(stopped.status,'partial');
  assert.equal(stopped.members[0].error,'overlay-root-changed');
});

test('one root update sequences actual member PowerShell NoPull phases and isolates failures', {skip:process.platform !== 'win32'}, t => {
  const f = fixture(t);
  const plan = planOverlayUpdate(f.root);
  const registry = fs.readFileSync(f.registry);
  fs.writeFileSync(path.join(f.second.workspaceRoot,'fixture-fail-write'),'');
  let updated = 0;
  const tools = {ps:path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),env:process.env};
  const withMemberLease = (root,callback) => deployment.withLock(root.capabilityRoot,() => callback(process.env.IMEDICAL_DEPLOYMENT_LOCK));
  const runMember = (root,member,mode,token) => runCanonicalMember(root,member,mode,token,tools);
  const result = applyOverlayUpdate(plan,[plan.members[1].id,plan.members[0].id],{
    updateRoot:() => {
      updated++;
      f.git(['update-ref','HEAD',f.after,f.before]);
      return {exitCode:0,after:{revision:f.after}};
    },withMemberLease,runMember,
  });
  assert.equal(updated,1);
  assert.equal(result.rootStatus,'updated');
  assert.equal(result.revision,f.after);
  assert.equal(result.status,'partial');
  assert.equal(result.members[0].status,'failed');
  assert.deepEqual(result.members[0].steps.map(step => step.mode),['DryRun','Write']);
  assert.equal(result.members[1].status,'complete');
  assert.ok(result.members[1].steps.every(step => step.exitCode === 0 && step.noPull));
  const trace = member => fs.readFileSync(path.join(member.workspaceRoot,'fixture-owner-trace.txt'),'utf8').trim().split(/\r?\n/);
  assert.deepEqual(trace(f.first),['DryRun','Write','Check']);
  assert.deepEqual(trace(f.second),['DryRun','Write']);
  assert.deepEqual(fs.readFileSync(f.registry),registry);

  fs.unlinkSync(path.join(f.second.workspaceRoot,'fixture-fail-write'));
  const retry = planOverlayUpdate(f.root);
  const recovered = applyOverlayUpdate(retry,[retry.members[1].id],{withMemberLease,runMember});
  assert.equal(recovered.status,'complete');
  assert.equal(recovered.rootStatus,'current');
  assert.equal(updated,1);
  assert.deepEqual(trace(f.first),['DryRun','Write','Check']);
  assert.deepEqual(trace(f.second),['DryRun','Write','DryRun','Write','Check']);
  assert.deepEqual(fs.readFileSync(f.registry),registry);
});
