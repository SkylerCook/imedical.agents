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
const released = 'afb19d0e980a48ce2c49d945aff11c2120861d3a';
const digest = '30b13b1d4a6e499cbc56e7da2355ff345ac269f74d8222a07b8d523e03ce9427';
const origin = 'https://gitee.com/skyler-cook/imedical.agents.git';

test('Workbench hands off a stock root and two Overlay projects to the existing two-phase updater', {
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
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^(path|psmodulepath)$/iu.test(name)));
  const env = {...inherited, PATH:[path.dirname(process.execPath),process.env.PATH || ''].join(path.delimiter),
    PORT:'0', GIT_ALLOW_PROTOCOL:'file', GIT_TERMINAL_PROMPT:'0',
    https_proxy:'http://127.0.0.1:1', no_proxy:'',
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
  function ps(cwd,entry,parameters,blocker) {
    const result = runOwnerPowerShell(path.join(psDir,'powershell.exe'),entry,parameters,{cwd,env,timeout:150000});
    assert.ifError(result.error);
    if (blocker) {
      assert.equal(result.status,1,result.stderr || result.stdout || entry);
      assert.match(result.stdout,blocker);
    } else assert.equal(result.status,0,result.stderr || result.stdout || entry);
    return result.stdout;
  }
  const ownerCalls = [];
  function runUpdate(workspace,mode,noPull=false,blocker) {
    ownerCalls.push([workspace,mode,noPull]);
    return ps(workspace,path.join(cap,'scripts/update-agents.ps1'),{
      ProjectRoot:workspace, Mode:mode, Detailed:true, ...(noPull ? {NoPull:true} : {})
    },blocker);
  }
  function refreshMember(workspace) {
    for (const mode of ['DryRun','Write','Check']) {
      assert.match(runUpdate(workspace,mode,true),/capability-pull-skipped-overlay/);
    }
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
      memberIds:[sourceUnready.id]})).body.error,'framework-update-use-agent');
    const opened = await connectOpened(await open(primary,current,sourceUnready.id));
    const blocked = await opened.read();
    assert.equal(blocked.overlay.standardRoot,root);
    assert.equal(blocked.overlay.issue,'member-sources-unready');
    assert.equal(blocked.overlay.canRefresh,false);
    assert.equal((await opened.post('overlay/refresh',{projectId:blocked.projectId,revision:blocked.revision,
      overlayPlanId:blocked.overlay.planId})).body.error,'framework-update-use-agent');
    const standard = await connectOpened(await open(opened,blocked));
    assert.equal((await standard.read()).binding,before.binding);
  } finally { fs.renameSync(disabledGit,backendGit); }
  before = (await primary.act('refresh',before)).body;
  t.diagnostic('Verified navigation stays available for a module with an unready GitRoot');

  function updateNote(client,state) {
    return client.post('update-note',{projectId:state.projectId,revision:state.revision});
  }
  const refsBefore = git(cap,'for-each-ref','--format=%(refname) %(objectname)');
  const registryBefore = fs.readFileSync(registry);
  const rootNote = await updateNote(primary,before);
  assert.equal(rootNote.res.status,200,JSON.stringify(rootNote.body));
  assert.equal(rootNote.body.revision,a);
  assert.match(rootNote.body.prompt,/\.agents\/\.git\/plugin-deployment\.json 的 members/u);
  assert.ok(!rootNote.body.prompt.includes(path.basename(left.workspace)));
  assert.ok(!rootNote.body.prompt.includes(path.basename(right.workspace)));
  const memberNote = await updateNote(local,await local.read());
  assert.equal(memberNote.res.status,200,JSON.stringify(memberNote.body));
  assert.equal(memberNote.body.revision,a);
  assert.ok(memberNote.body.prompt.includes(JSON.stringify(root)));
  assert.ok(memberNote.body.prompt.includes(JSON.stringify(left.context)));
  assert.ok(!memberNote.body.prompt.includes(right.workspace));

  if (browserApp) {
    const hello = await start(root);
    const result = spawnSync('python',['-B',path.join(__dirname,'overlay-browser-pilot.py'),browserApp],{
      cwd:repo,env:{...process.env,PYTHONIOENCODING:'utf8'},input:JSON.stringify(hello),
      encoding:'utf8',windowsHide:true,timeout:90000});
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stderr || result.stdout);
    t.diagnostic('Verified real Edge navigation, failed child launch, scoped clipboard prompts and manual copy');
  }

  async function readMemberInEdge(expected) {
    if (!browserApp) return;
    const hello = await start(root);
    const check = `
import json, sys
from playwright.sync_api import sync_playwright
hello = json.load(sys.stdin)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page()
    page.goto(hello["address"].partition("#")[0] + "#bootstrap=" + hello["bootstrap"])
    page.get_by_role("button", name="重新读取", exact=True).click(timeout=20000)
    page.get_by_text(hello["expected"], exact=True).wait_for(timeout=20000)
    browser.close()
`;
    const result = spawnSync('python',['-B','-c',check],{cwd:repo,env:{...process.env,PYTHONIOENCODING:'utf8'},
      input:JSON.stringify({...hello,expected}),encoding:'utf8',windowsHide:true,timeout:45000});
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stderr || result.stdout);
  }

  git(mirror,'update-ref','refs/heads/master',b,a);
  for (const action of ['fetch-preview','apply','refresh-overlay']) {
    const result = await primary.act(action,before);
    assert.equal(result.res.status,409,JSON.stringify(result.body));
    assert.equal(result.body.error,'framework-update-use-agent');
  }
  assert.equal(git(cap,'rev-parse','HEAD'),a);
  assert.equal(git(cap,'for-each-ref','--format=%(refname) %(objectname)'),refsBefore);
  assert.deepEqual(fs.readFileSync(registry),registryBefore);

  // Exercise the exact owner commands named by the handoff, outside the Workbench HTTP service.
  runUpdate(root,'DryRun');
  runUpdate(root,'Write',true);
  runUpdate(root,'Check',true);
  assert.equal(git(cap,'rev-parse','HEAD'),b);
  refreshMember(left.workspace);

  const rightWindow = await connect(right.workspace);
  const rightState = await rightWindow.read();
  const sharedGitState = () => ({
    refs:git(cap,'for-each-ref','--format=%(refname) %(objectname)'),
    headReflog:git(cap,'reflog','show','--format=%H %gs','HEAD'),
    sparse:fs.readFileSync(path.join(cap,'.git/info/sparse-checkout')),
  });
  const sharedAfterUpdate = sharedGitState();
  const leftFiles = [...left.localFiles.keys(), ...['config','scripts','skills'].flatMap(name =>
    fs.readdirSync(path.join(left.context,name),{recursive:true,withFileTypes:true})
      .filter(file=>file.isFile()).map(file=>path.join(file.parentPath,file.name)))];
  const readLeft = () => leftFiles.map(file=>[fs.readFileSync(file),fs.statSync(file,{bigint:true}).mtimeNs]);
  const leftAfterRefresh = readLeft();
  fs.renameSync(backendGit,disabledGit);
  try {
    // Let the checked-out owner reject the unavailable SourceRoot, without mocking the process.
    const failed = runUpdate(right.workspace,'DryRun',true,/workspace-overlay-blocked/u);
    assert.match(failed,/git-root-missing|source-directory-invalid/u);
    const blockedRoot = (await primary.act('refresh',before)).body;
    assert.equal(blockedRoot.revision,b);
    assert.deepEqual(blockedRoot.overlay.members.map(member=>member.status),['ready','owner-blocked','offline']);
    const blocked = (await rightWindow.act('refresh',rightState)).body;
    assert.equal(blocked.binding,rightState.binding);
    assert.equal(blocked.overlay.issue,'member-sources-unready');
    const resumeNote = await updateNote(rightWindow,blocked);
    assert.equal(resumeNote.res.status,200,JSON.stringify(resumeNote.body));
    assert.equal(resumeNote.body.revision,b);
    assert.match(resumeNote.body.prompt,/模块 二/u);
    assert.doesNotMatch(resumeNote.body.prompt,/模块 一/u);
    await readMemberInEdge('模块 二 · 源码目录或 GitRoot 尚未就绪');
  } finally { fs.renameSync(disabledGit,backendGit); }

  refreshMember(right.workspace);
  const continued = (await rightWindow.act('refresh',rightState)).body;
  assert.equal(continued.binding,rightState.binding);
  assert.equal(continued.projectId,rightState.projectId);
  assert.equal(continued.overlay.issue,undefined);
  const refreshedRoot = (await primary.act('refresh',before)).body;
  assert.equal(refreshedRoot.revision,b);
  assert.deepEqual(refreshedRoot.overlay.members.map(member=>member.status),['ready','ready','offline']);
  assert.deepEqual(ownerCalls,[
    [root,'DryRun',false], [root,'Write',true], [root,'Check',true],
    [left.workspace,'DryRun',true], [left.workspace,'Write',true], [left.workspace,'Check',true],
    [right.workspace,'DryRun',true],
    [right.workspace,'DryRun',true], [right.workspace,'Write',true], [right.workspace,'Check',true],
  ]);
  assert.deepEqual(sharedGitState(),sharedAfterUpdate);
  assert.deepEqual(readLeft(),leftAfterRefresh);
  await readMemberInEdge('模块 二 · 已核验');
  t.diagnostic('Verified a real member owner stops, resuming only that member, and reading the shared root and member in Workbench');
  assert.equal(git(cap,'rev-parse','HEAD'),b);
  assert.deepEqual(readRegistry().members.find(member=>member.contextRoot === absent.contextRoot),absent);
  assert.equal(fs.existsSync(absent.contextRoot),false);
  for (const {localFiles} of [left,right]) {
    for (const [file,content] of localFiles) assert.equal(fs.readFileSync(file,'utf8'),content,file);
  }

  // Simulate a legacy full deployment whose member registry is still empty after updating the shared root.
  git(mirror,'update-ref','refs/heads/master',released,b);
  runUpdate(root,'DryRun');
  runUpdate(root,'Write',true);
  runUpdate(root,'Check',true);
  fs.unlinkSync(registry);
  const patterns = ['/agents/**','/docs/**','/workflows/**','/rules/**','/skills/**','/plugins/**','/vendor/**','/feedback/**',
    '/hooks/**','/scripts/*.ps1','/scripts/*.js','/scripts/lib/**','/scripts/iris-mcp.js'];
  // The real full owner requires all its declared non-optional runtime paths.
  run(cap,process.execPath,[path.join(cap,'scripts/refresh-agents-sparse.js'),cap,...patterns]);
  const empty = (await primary.act('refresh',await primary.read())).body;
  assert.equal(empty.overlay.members.length,0);
  const known = (await local.act('refresh',memberState)).body;
  assert.equal(known.overlay.standardRoot,root);
  assert.equal(fs.existsSync(registry),false);
  const sparse = path.join(cap,'.git/info/sparse-checkout');
  const originalSparse = fs.readFileSync(sparse);
  const coldNote = await updateNote(local,known);
  assert.equal(coldNote.res.status,200,JSON.stringify(coldNote.body));
  assert.match(coldNote.body.prompt,/workspace-overlay\.md.*未登记时按该手册补登记/u);
  refreshMember(left.workspace);
  if (!fs.existsSync(registry)) {
    const registered = JSON.parse(run(left.workspace,process.execPath,[
      path.join(cap,'scripts/plugin-deploy.js'),'register','--project-root',left.workspace
    ]));
    assert.equal(registered.registered,true);
  }
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
