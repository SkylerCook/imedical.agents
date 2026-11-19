'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { fork, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');
const { runOwnerPowerShell } = require('../src/owner-powershell');

const repo = path.resolve(__dirname,'../../..');
const installer = path.join(repo,'scripts/install-agents.ps1');
const browserApp = process.env.WORKBENCH_OVERLAY_PILOT_APP;
const serverEntry = path.join(browserApp || repo,'tools/agents-workbench/prototype/serve.js');
const a = 'b65675b656519b2a2bda02fd2b26e1a19fdbdd62';
const b = '5520bdf7854561bd80e04fcc9330b6bb921bfe80';
const released = 'e943fc299efe658e1a2da90602a50d85cf2a3c7b';
const digest = '30b13b1d4a6e499cbc56e7da2355ff345ac269f74d8222a07b8d523e03ce9427';
const origin = 'https://gitee.com/skyler-cook/imedical.agents.git';

test('Workbench updates a stock root once, refreshes two stock Overlay projects, and resumes selected members', {
  skip:process.platform !== 'win32',
}, async t => {
  const directory = createTempDirectory('workbench-overlay-stock-');
  const children = [];
  const nested = [];
  t.after(async () => {
    for (const {child,exit} of children.reverse()) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exit;
    }
    for (const base of nested) {
      let closed = false;
      for (let attempt = 0; attempt < 30 && !closed; attempt++) {
        if (attempt) await new Promise(resolve=>setTimeout(resolve,100));
        try { await fetch(base,{signal:AbortSignal.timeout(500)}); }
        catch (error) { closed = error.cause?.code === 'ECONNREFUSED'; }
      }
      assert.ok(closed,'Launched workbench did not close when the owning service exited');
    }
    assert.ok(ownsTempDirectory(directory));
    fs.rmSync(directory,{recursive:true,force:true,maxRetries:3});
  });
  const mirror = path.join(directory,'mirror.git');
  const root = path.join(directory,'标准 根');
  const cap = path.join(root,'.agents');
  const registry = path.join(cap,'.git/plugin-deployment.json');
  const psDir = path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0');
  const env = {...process.env, PORT:'0', GIT_ALLOW_PROTOCOL:'file', GIT_TERMINAL_PROMPT:'0',
    GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'url.' + pathToFileURL(mirror).href + '.insteadOf',GIT_CONFIG_VALUE_0:origin,
    PSModulePath:path.join(psDir,'Modules')};
  delete env.IMEDICAL_DEPLOYMENT_LOCK;
  function run(cwd,executable,args) {
    const result = spawnSync(executable,args,{cwd,env,encoding:'utf8',windowsHide:true,timeout:150000,maxBuffer:16*1024*1024});
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stderr || result.stdout || args.join(' '));
    return result.stdout.trim();
  }
  const git = (cwd,...args) => run(cwd,'git',args);
  function ps(cwd,entry,parameters) {
    const result = runOwnerPowerShell(path.join(psDir,'powershell.exe'),entry,parameters,{cwd,env,timeout:150000});
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stderr || result.stdout || entry);
  }
  const readRegistry = () => JSON.parse(fs.readFileSync(registry));

  git(directory,'clone','--bare','--shared',repo,mirror);
  git(mirror,'symbolic-ref','HEAD','refs/heads/master');
  git(mirror,'update-ref','refs/heads/master',a);
  git(mirror,'config','uploadpack.allowFilter','true');
  fs.mkdirSync(root);
  git(root,'init','-q');
  fs.writeFileSync(path.join(root,'AGENTS.md'),'# Existing standard project instructions\n');
  ps(root,installer,{RuntimeAdapter:'Codex',TrustedRuntimeTree:a + ':' + digest});
  assert.equal(git(cap,'rev-parse','HEAD'),a);

  function createMember(label) {
    const workspace = path.join(directory,label);
    const context = path.join(workspace,'.agents');
    const backend = path.join(workspace,'backend');
    fs.mkdirSync(context,{recursive:true});
    fs.mkdirSync(backend);
    git(workspace,'init','-q');
    git(backend,'init','-q');
    fs.writeFileSync(path.join(workspace,'AGENTS.md'),'# Existing Overlay project instructions\n');
    const profile = ['# Plugin Profile','','| plugin | status | initSkill | dependsOn | notes |',
      '|---|---|---|---|---|','| agent-context-kit | enabled | project-context-maintenance | - | Fixture |',''].join('\n');
    fs.writeFileSync(path.join(context,'capability.json'),JSON.stringify({schemaVersion:1,mode:'workspace-overlay',workspace:label,
      contextRoot:'.agents',capabilityRoot:cap,sharedDirectories:['plugins','vendor','agents','workflows','hooks'],
      localDirectories:['config','rules','memory','skills','scripts','work'],
      sourceRoots:[{name:'backend',path:'backend',target:backend,gitRoot:backend}]}));
    ps(workspace,path.join(cap,'scripts/initialize-workspace-overlay.ps1'),{WorkspaceRoot:workspace,Mode:'Write'});
    fs.writeFileSync(path.join(context,'config/plugin_profile.md'),profile);
    const localFiles = new Map([
      [path.join(context,'rules/project.md'),'# 保留模块规则\n'],
      [path.join(context,'memory/project-memory.md'),'# 保留模块记忆\n'],
      [path.join(workspace,'.mcp.json'),'{"mcpServers":{"fixture":{"command":"fixture-never-run","env":{"REFERENCE_NAME":"FIXTURE_VAR"}}}}\n'],
      [path.join(backend,'business.txt'),'local business source\n'],
    ]);
    for (const [file,content] of localFiles) fs.writeFileSync(file,content);
    run(workspace,process.execPath,[path.join(cap,'scripts/plugin-deploy.js'),'register','--project-root',workspace]);
    return {workspace,context,localFiles};
  }
  const left = createMember('模块 一');
  const right = createMember('模块 二');
  const absent = {contextRoot:path.join(directory,'缺席模块','.agents'),lastRequired:['agent-context-kit']};
  const initialRegistry = readRegistry();
  assert.ok(initialRegistry.members.some(member=>member.contextRoot === left.context));
  assert.ok(initialRegistry.members.some(member=>member.contextRoot === right.context));
  initialRegistry.members.push(absent);
  fs.writeFileSync(registry,JSON.stringify(initialRegistry),'utf8');

  async function start(workspace) {
    const child = fork(serverEntry,['--project',workspace],{env,silent:true});
    const exit = once(child,'exit');
    children.push({child,exit});
    const [hello] = await once(child,'message');
    return hello;
  }
  async function connection(address,bootstrap) {
    const base = new URL(address).origin;
    const headers = {'x-workbench-request':'1',origin:base,'content-type':'application/json',connection:'close'};
    const authorized = {};
    function request(endpoint,options) {
      return fetch(base + endpoint,options).catch(cause=>{ throw Error('Fixture request failed ' + endpoint,{cause}); });
    }
    async function post(endpoint,body,session=true) {
      const res = await request('/framework/' + endpoint,{method:'POST',
        headers:session ? {...headers,...authorized} : headers,body:JSON.stringify(body)});
      return {res,body:await res.json()};
    }
    const session = await post('session',{token:bootstrap},false);
    assert.equal(session.res.status,200);
    authorized.cookie = session.res.headers.get('set-cookie').split(';')[0];
    authorized['x-workbench-csrf'] = session.body.csrf;
    async function read() {
      for (let attempts=0; attempts<100; attempts++) {
        const res = await request('/framework.json',{headers});
        const body = await res.json();
        if (body.status !== 'observing') return body;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.fail('Workbench did not finish observing');
    }
    function act(action,state,fields={}) {
      return post('action',{action,projectId:state.projectId,revision:state.revision,...fields});
    }
    return {read,act,post,base,headers,authorized};
  }
  async function connect(workspace) {
    const {address,bootstrap} = await start(workspace);
    return connection(address,bootstrap);
  }
  async function open(parent,state,memberId) {
    return parent.post('overlay/open',{projectId:state.projectId,revision:state.revision,
      overlayPlanId:state.overlay.planId,...(memberId ? {memberId} : {})});
  }
  async function connectOpened(result) {
    assert.equal(result.res.status,200,JSON.stringify(result.body));
    const address = new URL(result.body.address);
    nested.push(address.origin);
    return connection(address.href,address.hash.slice('#bootstrap='.length));
  }
  const primary = await connect(root);
  const local = await connect(left.workspace);
  const memberState = await local.read();
  assert.equal(memberState.status,'overlay-declared');
  assert.equal(memberState.overlay.standardRoot,root);
  assert.match(memberState.overlay.planId,/^[a-f0-9]{64}$/u);
  assert.equal((await local.act('apply',memberState)).res.status,409);

  let before = await primary.read();
  assert.equal(before.status,'standard');
  assert.equal(before.revision,a);
  assert.deepEqual(before.overlay.members.map(member=>member.status),['ready','ready','offline']);
  assert.ok(before.overlay.members.every(member=>Object.keys(member).sort().join(',') === 'id,label,status'));
  assert.ok(!Object.hasOwn(before,'overlayPlan'));

  const [available,,missing] = before.overlay.members.map(member=>member.id);
  assert.equal((await open(primary,before,missing)).res.status,409);
  assert.equal((await primary.post('overlay/open',{projectId:before.projectId,revision:before.revision,
    overlayPlanId:before.overlay.planId,memberId:available,path:left.workspace})).res.status,400);
  const openedModule = await connectOpened(await open(primary,before,available));
  const openedModuleState = await openedModule.read();
  assert.equal(openedModuleState.binding,memberState.binding);
  assert.notEqual(openedModuleState.projectId,memberState.projectId);
  const openedRoot = await connectOpened(await open(openedModule,openedModuleState));
  const openedRootState = await openedRoot.read();
  assert.equal(openedRootState.binding,before.binding);
  assert.notEqual(openedRootState.projectId,before.projectId);
  assert.equal(new Set([primary.base,openedModule.base,openedRoot.base]).size,3);
  const crossed = await fetch(openedModule.base + '/framework/action',{method:'POST',
    headers:{...openedModule.headers,...primary.authorized},body:JSON.stringify({
      action:'refresh',projectId:openedModuleState.projectId,revision:openedModuleState.revision
    })});
  assert.equal(crossed.status,403);
  assert.equal((await primary.act('refresh',before)).res.status,200);
  t.diagnostic('Verified bidirectional HTTP navigation and isolated sessions');

  const backendGit = path.join(right.workspace,'backend/.git');
  const disabledGit = path.join(right.workspace,'backend/.fixture-git');
  fs.renameSync(backendGit,disabledGit);
  try {
    const current = (await primary.act('refresh',before)).body;
    const sourceUnready = current.overlay.members.find(member=>member.status === 'owner-blocked');
    assert.equal(sourceUnready.issue,'member-sources-unready');
    assert.equal((await primary.act('refresh-overlay',current,{overlayPlanId:current.overlay.planId,
      memberIds:[sourceUnready.id]})).body.error,'overlay-selection-unverified');
    const opened = await connectOpened(await open(primary,current,sourceUnready.id));
    const blocked = await opened.read();
    assert.equal(blocked.overlay.standardRoot,root);
    assert.equal(blocked.overlay.issue,'member-sources-unready');
    assert.equal(blocked.overlay.canRefresh,false);
    assert.equal((await opened.post('overlay/refresh',{projectId:blocked.projectId,revision:blocked.revision,
      overlayPlanId:blocked.overlay.planId})).body.error,'overlay-member-unready');
    const standard = await connectOpened(await open(opened,blocked));
    assert.equal((await standard.read()).binding,before.binding);
  } finally { fs.renameSync(disabledGit,backendGit); }
  before = (await primary.act('refresh',before)).body;
  t.diagnostic('Verified navigation stays available for a module with an unready GitRoot');

  if (browserApp) {
    const hello = await start(root);
    const result = spawnSync('python',['-B',path.join(__dirname,'overlay-browser-pilot.py'),browserApp],{
      cwd:repo,input:JSON.stringify(hello),encoding:'utf8',windowsHide:true,timeout:90000});
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stderr || result.stdout);
    t.diagnostic('Verified real Edge navigation, failed child launch and module refresh');
  }

  git(mirror,'update-ref','refs/heads/master',b,a);
  const preview = await primary.act('fetch-preview',before);
  assert.equal(preview.res.status,200,JSON.stringify(preview.body));
  assert.equal(preview.body.after.revision,b);
  assert.equal(preview.body.canApply,true);
  assert.ok(!Object.hasOwn(preview.body,'overlayPlan'));
  const planned = await primary.read();
  const [first,second,offline] = planned.overlay.members.map(member=>member.id);
  const selection = ids=>({overlayPlanId:planned.overlay.planId,memberIds:ids});
  const unauthorized = await primary.post('action',{action:'apply',projectId:planned.projectId,revision:b,...selection([first])},false);
  assert.equal(unauthorized.res.status,403);
  assert.equal((await primary.act('apply',planned,selection([offline]))).body.error,'overlay-selection-unverified');
  assert.equal((await primary.act('apply',planned,{...selection([first]),overlayPlanId:'0'.repeat(64)})).body.error,'overlay-plan-changed');

  const updated = await primary.act('apply',planned,selection([first,second]));
  assert.equal(updated.res.status,200,JSON.stringify(updated.body));
  assert.equal(updated.body.exitCode,0,JSON.stringify(updated.body));
  assert.deepEqual(updated.body.steps.map(step=>step.step),['apply','check']);
  assert.equal(updated.body.overlayUpdate.rootStatus,'updated');
  assert.equal(updated.body.overlayUpdate.status,'complete',JSON.stringify(updated.body));
  for (const member of updated.body.overlayUpdate.members) {
    assert.deepEqual(member.steps.map(step=>[step.mode,step.exitCode,step.noPull]),
      [['DryRun',0,true],['Write',0,true],['Check',0,true]]);
  }
  assert.equal(updated.body.canApply,false);

  const state = await primary.read();
  git(left.workspace,'config','--local','core.attributesFile','fixture-custom-attributes');
  const partial = await primary.act('refresh-overlay',state,{overlayPlanId:state.overlay.planId,memberIds:[first,second]});
  assert.equal(partial.res.status,200,JSON.stringify(partial.body));
  assert.deepEqual(partial.body.steps,[]);
  assert.equal(partial.body.overlayUpdate.rootStatus,'current');
  assert.equal(partial.body.overlayUpdate.status,'partial');
  assert.deepEqual(partial.body.overlayUpdate.members.map(member=>member.status),['failed','complete']);
  git(left.workspace,'config','--local','--unset','core.attributesFile');
  const resume = await primary.read();
  const retried = await primary.act('refresh-overlay',resume,{overlayPlanId:resume.overlay.planId,memberIds:[first]});
  assert.equal(retried.res.status,200,JSON.stringify(retried.body));
  assert.deepEqual(retried.body.steps,[]);
  assert.equal(retried.body.overlayUpdate.status,'complete',JSON.stringify(retried.body));
  assert.deepEqual(retried.body.overlayUpdate.members.map(member=>member.id),[first]);
  assert.equal(git(cap,'rev-parse','HEAD'),b);
  assert.deepEqual(readRegistry().members.find(member=>member.contextRoot === absent.contextRoot),absent);
  assert.equal(fs.existsSync(absent.contextRoot),false);
  for (const {localFiles} of [left,right]) {
    for (const [file,content] of localFiles) assert.equal(fs.readFileSync(file,'utf8'),content,file);
  }

  // The published legacy owner did not register Overlay members in full deployments.
  git(mirror,'update-ref','refs/heads/master',released,b);
  const online = await primary.act('fetch-preview',await primary.read());
  assert.equal(online.body.after?.revision,released,JSON.stringify(online.body));
  const currentRoot = await primary.act('apply',await primary.read());
  assert.equal(currentRoot.body.exitCode,0,JSON.stringify(currentRoot.body));
  fs.unlinkSync(registry);
  const patterns = ['/agents/**','/docs/**','/workflows/**','/rules/**','/skills/**','/plugins/**','/vendor/**','/feedback/**',
    '/hooks/**','/scripts/*.ps1','/scripts/*.js','/scripts/lib/**','/scripts/iris-mcp.js'];
  // The real full owner requires all its declared non-optional runtime paths.
  run(cap,process.execPath,[path.join(cap,'scripts/refresh-agents-sparse.js'),cap,...patterns]);
  const empty = (await primary.act('refresh',await primary.read())).body;
  assert.equal(empty.overlay.members.length,0);
  const known = (await local.act('refresh',memberState)).body;
  assert.equal(known.overlay.canRefresh,true);
  assert.equal(fs.existsSync(registry),false);
  const sparse = path.join(cap,'.git/info/sparse-checkout');
  const originalSparse = fs.readFileSync(sparse);
  const coldRequest = {projectId:known.projectId,revision:known.revision,overlayPlanId:known.overlay.planId};
  assert.equal((await local.post('overlay/refresh',{...coldRequest,path:right.workspace})).res.status,400);
  const standalone = await local.post('overlay/refresh',coldRequest);
  assert.equal(standalone.res.status,200,JSON.stringify(standalone.body));
  assert.equal(standalone.body.registered,true);
  assert.deepEqual(standalone.body.memberUpdate.steps.map(step=>[step.mode,step.exitCode,step.noPull]),
    [['DryRun',0,true],['Write',0,true],['Check',0,true]]);
  const enrolled = readRegistry();
  assert.equal(enrolled.mode,'full');
  assert.equal(enrolled.members.length,1);
  assert.equal(enrolled.members[0].contextRoot,left.context);
  assert.equal(enrolled.members[0].workspaceRoot,left.workspace);
  assert.deepEqual(fs.readFileSync(sparse),originalSparse);
  assert.equal(git(cap,'rev-parse','HEAD'),released);
  assert.deepEqual((await primary.act('refresh',empty)).body.overlay.members.map(member=>member.label),['模块 一']);
  t.diagnostic('Verified standalone refresh and registry readback for historical full deployment');
});
