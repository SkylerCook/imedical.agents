'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { fork, spawnSync } = require('node:child_process');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');

const repo = path.resolve(__dirname, '../../..');
const pin = '5520bdf7854561bd80e04fcc9330b6bb921bfe80';
const origin = 'https://gitee.com/skyler-cook/imedical.agents.git';
const bundle = 'vendor/knowledge-index/company.sqlite';

test('workbench selects and removes the real company bundle with the original offline owner', {skip:process.platform !== 'win32'}, async t => {
  const temporary = createTempDirectory('workbench-vector-index-');
  const processes = [];
  t.after(async () => {
    for (const {server,stopped} of processes) { server.kill(); await stopped; }
    assert.ok(ownsTempDirectory(temporary));
    fs.rmSync(temporary,{recursive:true,force:true,maxRetries:3});
  });
  const root = path.join(temporary,'工程');
  const mirror = path.join(temporary,'mirror.git');
  const cap = path.join(root,'.agents');
  const index = path.join(cap,bundle);
  fs.mkdirSync(root);

  const env = {...process.env, GIT_ALLOW_PROTOCOL:'file', GIT_TERMINAL_PROMPT:'0',
    GIT_CONFIG_COUNT:'1', GIT_CONFIG_KEY_0:'url.' + pathToFileURL(mirror).href + '.insteadOf', GIT_CONFIG_VALUE_0:origin,
    PSModulePath:path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')};
  for (const key of ['KNOWLEDGE_RAG_CONFIG','BOS_MCP_CONFIG','IMEDICAL_DEPLOYMENT_LOCK','GIT_NO_LAZY_FETCH']) delete env[key];
  const run = (program,args,cwd=root) => {
    const result = spawnSync(program,args,{cwd,env,encoding:'utf8',windowsHide:true,timeout:120000});
    assert.equal(result.status,0,result.error?.message || result.stderr);
    return result.stdout.trim();
  };
  const git = (...args) => run('git',args);
  const capGit = (...args) => git('-C',cap,...args);
  git('clone','--bare','--shared',repo,mirror);
  git('--git-dir',mirror,'symbolic-ref','HEAD','refs/heads/master');
  git('--git-dir',mirror,'update-ref','refs/heads/master',pin);
  git('--git-dir',mirror,'config','uploadpack.allowFilter','true');
  git('--git-dir',mirror,'config','uploadpack.allowAnySHA1InWant','true');
  git('init','-q');
  fs.writeFileSync(path.join(root,'AGENTS.md'),'# Project fixture');
  run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
    path.join(repo,'scripts/install-agents.ps1'),'-RuntimeAdapter','Codex']);
  const oid = capGit('rev-parse','HEAD:'+bundle);
  assert.match(oid,/^[a-f0-9]{40}$/);
  assert.equal(fs.existsSync(index),false);

  const cache = path.join(cap,'.knowledge-cache');
  fs.mkdirSync(cache);
  fs.writeFileSync(path.join(cache,'.gitignore'),'*\n');
  const cacheFile = path.join(cache,'company.sqlite');
  fs.writeFileSync(cacheFile,'fixture cache retained');
  const selected = () => capGit('config','--local','--default','','--get','imedical.knowledgeVectors');
  const sparse = () => capGit('sparse-checkout','list');
  const before = sparse();

  async function serverFor(project,protocols = '') {
    const server = fork(path.join(repo,'tools/agents-workbench/prototype/serve.js'),['--project',project],{
      env:{...env,GIT_ALLOW_PROTOCOL:protocols,GIT_NO_LAZY_FETCH:'1',PORT:'0'},silent:true,
    });
    const stopped = once(server,'exit');
    processes.push({server,stopped});
    const [hello] = await Promise.race([once(server,'message'),stopped.then(() => { throw Error('workbench exited'); })]);
    const base = new URL(hello.address).origin;
    const headers = {'x-workbench-request':'1',origin:base,'content-type':'application/json'};
    const post = (endpoint,body,extra) => fetch(base+'/framework/'+endpoint,{
      method:'POST',headers:{...headers,...extra},body:JSON.stringify(body),
    });
    const response = await post('session',{token:hello.bootstrap});
    assert.equal(response.status,200);
    const auth = {cookie:response.headers.get('set-cookie').split(';')[0],'x-workbench-csrf':(await response.json()).csrf};
    const initial = await (await fetch(base+'/framework.json',{headers})).json();
    const request = {projectId:initial.projectId,revision:pin};
    return {post,auth,request,action:(action,revision=pin) => post('action',{...request,revision,action},auth)};
  }

  const workbench = await serverFor(root);
  const refresh = async () => (await workbench.action('refresh')).json();
  const initial = (await refresh()).companyIndex;
  assert.deepEqual(initial,{available:true,localObject:false,selected:false,shared:false,writable:true,bytes:null,format:'missing'});
  assert.equal((await workbench.post('action',{...workbench.request,action:'install-index'})).status,403);
  assert.equal((await workbench.post('action',{...workbench.request,action:'install-index',provider:'other'},workbench.auth)).status,400);
  assert.equal((await workbench.action('install-index','stale')).status,409);
  const offline = await workbench.action('install-index');
  assert.equal(offline.status,409);
  assert.equal((await offline.json()).error,'index-fetch-failed');
  assert.equal(selected(),'');
  assert.equal(sparse(),before);
  assert.equal(fs.existsSync(index),false);

  const acquisition = await serverFor(root,'file');
  const acquired = await acquisition.action('install-index');
  const acquisitionResult = await acquired.json();
  assert.equal(acquired.status,200,JSON.stringify(acquisitionResult));
  assert.equal(acquisitionResult.after.companyIndex.localObject,true);
  assert.equal((await workbench.action('remove-index')).status,200);
  assert.equal(fs.existsSync(index),false);

  // The exact object is now available locally with Git network disabled in this workbench.
  const installed = await workbench.action('install-index');
  const installedResult = await installed.json();
  assert.equal(installed.status,200,JSON.stringify(installedResult));
  assert.equal(installedResult.exitCode,0);
  assert.deepEqual(installedResult.after.companyIndex,{...initial,localObject:true,selected:true,bytes:40591360,format:'readable'});
  assert.equal(selected(),'company');
  assert.equal(fs.statSync(index).size,40591360);

  const overlay = path.join(temporary,'模块');
  const overlayContext = path.join(overlay,'.agents');
  fs.mkdirSync(path.join(overlayContext,'config'),{recursive:true});
  fs.symlinkSync(root,path.join(overlay,'backend'),'junction');
  fs.writeFileSync(path.join(overlayContext,'capability.json'),JSON.stringify({
    schemaVersion:1,mode:'workspace-overlay',workspace:'fixture',contextRoot:'.agents',capabilityRoot:cap,
    sharedDirectories:[],localDirectories:['config'],sourceRoots:[{name:'backend',path:'backend',target:root,gitRoot:root}],
  }));
  const member = await serverFor(overlay);
  const shared = await (await member.action('refresh',null)).json();
  assert.deepEqual(shared.companyIndex,{...installedResult.after.companyIndex,shared:true,writable:false});
  assert.equal((await member.action('remove-index',null)).status,409);
  assert.equal(selected(),'company');

  const owner = path.join(cap,'scripts/knowledge-query.js');
  const ownerSource = fs.readFileSync(owner);
  try {
    fs.appendFileSync(owner,'\n// changed by test\n');
    const modified = await workbench.action('remove-index');
    assert.equal(modified.status,409);
    assert.equal((await modified.json()).error,'runtime-modified');
    assert.equal(selected(),'company');
  } finally { fs.writeFileSync(owner,ownerSource); }
  await refresh();
  const removed = await workbench.action('remove-index');
  const removedResult = await removed.json();
  assert.equal(removed.status,200,JSON.stringify(removedResult));
  assert.deepEqual(removedResult.after.companyIndex,{...initial,localObject:true});
  assert.equal(selected(),'');
  assert.equal(sparse(),before);
  assert.equal(fs.existsSync(index),false);
  assert.equal(fs.readFileSync(cacheFile,'utf8'),'fixture cache retained');

  const unknown = capGit('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',pin+'^{tree}',
    '-p',pin,'-m','Unregistered revision with identical tree');
  capGit('update-ref','HEAD',unknown,pin);
  const unregistered = await refresh();
  assert.equal(unregistered.revision,unknown);
  assert.equal(unregistered.companyIndex.available,true);
  assert.equal(unregistered.companyIndex.writable,false);
  const refused = await workbench.action('install-index',unknown);
  assert.equal(refused.status,409);
  assert.equal((await refused.json()).error,'unknown-tree');
  assert.equal(selected(),'');
});
