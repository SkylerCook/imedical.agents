'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { fork, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');
const { execute } = require('../src/knowledge-build');
const { build, previewTransfer } = require('../../../scripts/lib/knowledge-retrieval');

function fixture(t) {
  const directory = createTempDirectory('workbench-knowledge-build-');
  t.after(() => {
    assert.ok(ownsTempDirectory(directory));
    fs.rmSync(directory, {recursive:true,force:true,maxRetries:3});
  });
  const root = path.join(directory,'工程');
  const cap = path.join(root,'.agents');
  const authorized = 'plugins/imedical-ui/references';
  const excluded = 'plugins/iris-ui/references';
  const cache = path.join(cap,'.knowledge-cache');
  for (const relative of ['.git',authorized,excluded,'.knowledge-cache']) fs.mkdirSync(path.join(cap,relative),{recursive:true});
  for (let i = 0; i < 20; i++) {
    fs.writeFileSync(path.join(cap,authorized,`${i}.md`),`# Fixture ${i}\n\nAuthorized text ${i}.\n`);
  }
  fs.writeFileSync(path.join(cap,excluded,'excluded.md'),'# Excluded\n\nText outside scope.\n');
  const policy = paths => fs.writeFileSync(path.join(cache,'policy.json'),JSON.stringify({schema:'knowledge-policy/v1',allowedDirectories:paths,allowQuery:true}));
  policy([authorized]);
  const config = path.join(directory,'fixture-provider.json');
  const configured = key => fs.writeFileSync(config,JSON.stringify({schema:'knowledge-rag-config/v1',providers:{company:{
    model:'fixture-model',dimensions:3,type:'gateway',method:'fixture-method',baseUrl:'https://fixture.invalid',
    appId:'fixture-' + path.basename(directory),appKey:key,
  }}}));
  configured('fixture-credential');
  return {root,cap,cache,authorized,excluded,policy,configured,env:{KNOWLEDGE_RAG_CONFIG:config}};
}

test('build previews pending authorized data, rejects stale approval, and resumes persisted vectors', async t => {
  const f = fixture(t);
  const secret = crypto.randomBytes(32);
  const attempts = [];
  let networkCalls = 0;
  let interrupt = true;
  const options = {env:f.env, fetch:async (url,request) => {
    networkCalls++;
    if (url.includes('/token/')) return {ok:true,json:async () => ({access_token:'fixture',remain_time:0})};
    const input = JSON.parse(request.body).biz_content.body.input;
    attempts.push(input);
    assert.ok(input.every(text => text.includes('Authorized text')));
    if (interrupt && attempts.length === 2) return {ok:false,status:500};
    return {ok:true,json:async () => ({code:'10000',data:{data:input.map((_,index) => ({index,embedding:[1,0,0]})),usage:{total_tokens:input.length}}})};
  }};
  const preview = await execute(f.root,'preview',secret,undefined,options);
  assert.equal(networkCalls,0);
  assert.equal(fs.existsSync(path.join(f.cache,'company.sqlite')),false);
  assert.deepEqual(preview.preview.transferDirectories,[f.authorized]);
  assert.equal(preview.preview.pendingVectors,20);
  assert.equal(preview.preview.estimatedMaximumUsd,null);
  assert.equal(preview.preview.providerReady,true);
  assert.ok(!JSON.stringify(preview.preview).includes('fixture-credential'));
  await assert.rejects(execute(f.root,'start',secret,'different-plan',options),/knowledge-preview-stale/);
  f.policy([f.authorized,f.excluded]);
  await assert.rejects(execute(f.root,'start',secret,preview.signature,options),/knowledge-preview-stale/);
  f.policy([f.authorized]);
  f.configured('rotated-fixture');
  await assert.rejects(execute(f.root,'start',secret,preview.signature,options),/knowledge-preview-stale/);
  f.configured('fixture-credential');
  assert.equal(networkCalls,0);

  const lock = path.join(f.cache,'company.sqlite.lock');
  fs.writeFileSync(lock,JSON.stringify({pid:process.pid,created:new Date().toISOString()}));
  await assert.rejects(execute(f.root,'start',secret,preview.signature,options),/knowledge-build-busy/);
  fs.unlinkSync(lock);
  assert.equal(networkCalls,0);
  const partial = await execute(f.root,'start',secret,preview.signature,options);
  assert.equal(partial.complete,false);
  assert.equal(partial.remainingVectors,4);
  assert.equal(partial.embeddingTokens,16);
  assert.equal(fs.existsSync(lock),false);
  assert.ok(fs.existsSync(path.join(f.cache,'company.sqlite')));
  const cached = await execute(f.root,'preview',secret,undefined,options);
  assert.equal(cached.preview.pendingVectors,4);
  const context = {contextRoot:f.cap,capabilityRoot:f.cap};
  const approved = previewTransfer(context,{env:f.env}).transferSnapshot;
  const ignore = path.join(f.cache,'.gitignore');
  fs.writeFileSync(ignore,'*\n# Fixture comment\n');
  await assert.rejects(build(context,{...options,approveTransfer:approved,confirmProfile:() => {
    assert.ok(fs.existsSync(lock),'verification runs under the owner cache lock');
    return false;
  }}), /knowledge-preview-stale/);
  assert.equal(fs.readFileSync(ignore,'utf8'),'*\n# Fixture comment\n');
  await assert.rejects(execute(f.root,'start',secret,preview.signature,options),/knowledge-preview-stale/);
  assert.equal(attempts.length,2);

  interrupt = false;
  const complete = await execute(f.root,'start',secret,cached.signature,options);
  assert.equal(complete.complete,true);
  assert.equal(complete.remainingVectors,0);
  assert.equal(complete.embeddingTokens,4);
  assert.deepEqual(attempts.map(batch => batch.length),[16,4,4]);
  assert.ok(attempts.flat().every(text => text.includes('Authorized text')));
  const readback = await execute(f.root,'preview',secret,undefined,options);
  assert.equal(readback.preview.pendingVectors,0);
  assert.deepEqual(readback.preview.transferDirectories,[]);
});

test('authenticated workbench preview and confirmation build a local index and expose status', async t => {
  const f = fixture(t);
  f.policy([]);
  const gitEnv = {...process.env,GIT_ALLOW_PROTOCOL:'',GIT_NO_LAZY_FETCH:'1'};
  const git = (args,input) => {
    const r = spawnSync('git',['-C',f.cap,...args],{input,env:gitEnv,encoding:'utf8',windowsHide:true});
    assert.equal(r.status,0,r.stderr);
    return r.stdout.trim();
  };
  git(['init','-q']);
  git(['config','--local','remote.origin.url','https://gitee.com/skyler-cook/imedical.agents.git']);
  git(['update-ref','HEAD',git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',git(['mktree'],'')], 'fixture\n')]);
  fs.mkdirSync(path.join(f.cap,'scripts'));
  fs.writeFileSync(path.join(f.cap,'scripts/update-agents.ps1'),'throw "Fixture script must not execute"');
  const server = fork(path.join(__dirname,'../prototype/serve.js'),['--project',f.root],{
    env:{...gitEnv,KNOWLEDGE_RAG_CONFIG:'',BOS_MCP_CONFIG:'',PORT:'0'},silent:true,
  });
  const stopped = once(server,'exit');
  try {
    const [ready] = await Promise.race([once(server,'message'),stopped.then(() => {throw Error('WorkBench exited');})]);
    const base = new URL(ready.address).origin;
    const headers = {'x-workbench-request':'1',origin:base,'content-type':'application/json'};
    const post = (route,body,auth) => fetch(base+'/framework/'+route,{method:'POST',headers:{...headers,...auth},body:JSON.stringify(body)});
    const session = await post('session',{token:ready.bootstrap});
    assert.equal(session.status,200);
    const auth = {cookie:session.headers.get('set-cookie').split(';')[0],'x-workbench-csrf':(await session.json()).csrf};
    const initial = await (await fetch(base+'/framework.json',{headers})).json();
    const request = {projectId:initial.projectId,revision:git(['rev-parse','HEAD'])};
    const operation = (action,fields={}) => post('knowledge-build',{...request,...fields,action},auth);
    async function result() {
      for (let i = 0; i < 40; i++) {
        const {run} = await (await operation('status')).json();
        if (run?.status !== 'running') return run;
        await delay(100);
      }
      assert.fail('knowledge worker did not publish a completion result');
    }
    assert.equal((await post('knowledge-build',{...request,action:'preview'})).status,403);
    assert.equal((await operation('preview',{configurationFile:'forbidden'})).status,400);
    const response = await operation('preview');
    const prepared = await response.json();
    assert.equal(response.status,200,JSON.stringify(prepared));
    assert.deepEqual(prepared.preview.transferDirectories,[]);
    assert.equal(prepared.preview.pendingVectors,0);
    assert.equal(fs.existsSync(path.join(f.cache,'company.sqlite')),false);
    assert.equal((await operation('start',{planId:'not-approved'})).status,409);
    fs.appendFileSync(path.join(f.cap,f.authorized,'0.md'),'Changed after preview.\n');
    assert.equal((await operation('start',{planId:prepared.planId})).status,202);
    assert.deepEqual(await result(),{status:'failed',error:'knowledge-preview-stale'});
    assert.equal(fs.existsSync(path.join(f.cache,'company.sqlite')),false);
    const latest = await (await operation('preview')).json();
    assert.equal((await operation('start',{planId:latest.planId})).status,202);
    const run = await result();
    assert.equal(run.status,'complete',JSON.stringify(run));
    assert.equal(run.remainingVectors,0);
    assert.equal(run.embeddingTokens,0);
    assert.ok(fs.existsSync(path.join(f.cache,'company.sqlite')));
    assert.equal((await operation('start',{planId:latest.planId})).status,409);
  } finally { server.kill(); await stopped; }
});
