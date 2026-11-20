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
const { createKnowledgeBuildService, execute } = require('../src/knowledge-build');
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
  return {directory,root,cap,cache,authorized,excluded,policy,configured,env:{KNOWLEDGE_RAG_CONFIG:config}};
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

async function withWorkbench(f, options, exercise) {
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
    env:{...gitEnv,KNOWLEDGE_RAG_CONFIG:'',BOS_MCP_CONFIG:'',PORT:'0',...options.env},
    execArgv:options.execArgv,silent:true,
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
    const operation = (action,fields={},credentials=auth) => post('knowledge-build',{...request,...fields,action},credentials);
    async function result() {
      for (let i = 0; i < 40; i++) {
        const {run} = await (await operation('status')).json();
        if (run?.status !== 'running') return run;
        await delay(100);
      }
      assert.fail('knowledge worker did not publish a completion result');
    }
    await exercise({operation,result,auth});
  } finally { server.kill(); await stopped; }
}

test('shutdown rejects new knowledge work and waits for the current worker to release the index', async t => {
  const f = fixture(t);
  f.policy([]);
  const previous = process.env.KNOWLEDGE_RAG_CONFIG;
  process.env.KNOWLEDGE_RAG_CONFIG = f.env.KNOWLEDGE_RAG_CONFIG;
  t.after(() => {
    if (previous === undefined) delete process.env.KNOWLEDGE_RAG_CONFIG;
    else process.env.KNOWLEDGE_RAG_CONFIG = previous;
  });
  const observation = {status:'standard',revision:'fixture-revision',binding:'fixture-binding'};
  const closed = {error:'knowledge-shutting-down'};

  const previewing = createKnowledgeBuildService(f.root);
  const pendingPreview = previewing.handle({action:'preview'},observation);
  const previewShutdown = previewing.shutdown();
  assert.equal(previewing.shutdown(),previewShutdown);
  assert.deepEqual(await previewing.handle({action:'preview'},observation),closed);
  await previewShutdown;
  assert.deepEqual(await pendingPreview,closed);

  const service = createKnowledgeBuildService(f.root);
  const {planId} = await service.handle({action:'preview'},observation);
  const {run:{runId}} = await service.handle({action:'start',planId},observation);
  const shutdown = service.shutdown();
  assert.equal(service.shutdown(),shutdown);
  assert.deepEqual(await service.handle({action:'status'},observation),{run:{status:'running',runId,stopRequested:true}});
  assert.deepEqual(await service.handle({action:'start',planId},observation),closed);
  await shutdown;
  const {run} = await service.handle({action:'status'},observation);
  assert.equal(run.status,'complete');
  assert.equal(run.embeddingTokens,0);
  assert.ok(fs.existsSync(path.join(f.cache,'company.sqlite')));
  assert.equal(fs.existsSync(path.join(f.cache,'company.sqlite.lock')),false);
  assert.deepEqual(await service.handle({action:'preview'},observation),closed);
  await createKnowledgeBuildService(f.root).shutdown();
});

test('authenticated workbench preview and confirmation build a local index and expose status', async t => {
  const f = fixture(t);
  f.policy([]);
  await withWorkbench(f,{},async ({operation,result}) => {
    assert.equal((await operation('preview',{},{})).status,403);
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
  });
});

test('pausing a bound knowledge build waits for its active batch and resumes without resending it', async t => {
  const f = fixture(t);
  const stub = path.join(f.directory,'local-embedding-fixture.cjs');
  const attempts = path.join(f.directory,'attempts.jsonl');
  fs.writeFileSync(stub,`'use strict';
const {isMainThread,workerData}=require('node:worker_threads');
const fs=require('node:fs');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
if (!isMainThread && workerData?.action==='start') {
  globalThis.fetch=async (url,request)=>{
    const endpoint=new URL(url);
    if (endpoint.origin!=='https://fixture.invalid') throw Error('unexpected fixture endpoint');
    if (endpoint.pathname==='/dhccam/token/generate') {
      return {ok:true,json:async ()=>({access_token:'fixture',remain_time:0})};
    }
    if (endpoint.pathname!=='/dhccam/gateway/index') throw Error('unexpected fixture endpoint');
    const input=JSON.parse(request.body).biz_content.body.input;
    const attempts=path.join(__dirname,'attempts.jsonl');
    fs.appendFileSync(attempts,JSON.stringify(input)+'\\n');
    const sequence=fs.readFileSync(attempts,'utf8').trim().split('\\n').length;
    const release=path.join(__dirname,'release-'+sequence);
    for (let i=0;!fs.existsSync(release);i++) {
      if (i===200) throw Error('fixture batch was not released');
      await delay(50);
    }
    return {ok:true,json:async ()=>({code:'10000',data:{data:input.map((_,index)=>({index,embedding:[1,0,0]})),usage:{total_tokens:input.length}}})};
  };
}
`,'utf8');
  const readAttempts = () => fs.existsSync(attempts)
    ? fs.readFileSync(attempts,'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  async function waitForAttempt(count) {
    for (let i=0;i<100;i++) {
      if (readAttempts().length >= count) return;
      await delay(50);
    }
    assert.fail('knowledge worker did not start the expected fixture batch');
  }
  await withWorkbench(f,{env:f.env,execArgv:['--require',stub]},async ({operation,result,auth}) => {
    const preview = await operation('preview');
    assert.equal(preview.status,200);
    const prepared = await preview.json();
    assert.equal(prepared.preview.pendingVectors,20);
    const started = await operation('start',{planId:prepared.planId});
    assert.equal(started.status,202);
    const {run:{runId}} = await started.json();
    assert.match(runId,/^[0-9a-f-]{36}$/u);
    await waitForAttempt(1);

    assert.equal((await operation('stop',{runId},{})).status,403);
    assert.equal((await operation('stop',{runId},{cookie:auth.cookie})).status,403);
    assert.equal((await operation('stop',{runId:null})).status,400);
    assert.equal((await operation('stop',{runId,projectId:'another-project'})).status,409);
    const unrelated = await operation('stop',{runId:crypto.randomUUID()});
    assert.equal(unrelated.status,409);
    assert.equal((await unrelated.json()).error,'knowledge-run-changed');
    assert.equal((await (await operation('status')).json()).run.stopRequested,undefined);
    for (let attempt=0;attempt<2;attempt++) {
      const response = await operation('stop',{runId,revision:'superseded-revision'});
      assert.equal(response.status,200);
      assert.deepEqual((await response.json()).run,{status:'running',runId,stopRequested:true});
    }
    assert.equal((await operation('preview')).status,409);
    assert.equal(fs.existsSync(path.join(f.cache,'company.sqlite.lock')),true);
    fs.writeFileSync(path.join(f.directory,'release-1'),'');
    const paused = await result();
    assert.equal(paused.status,'paused',JSON.stringify(paused));
    assert.equal(paused.remainingVectors,4);
    assert.equal(paused.embeddingTokens,16);
    assert.equal(fs.existsSync(path.join(f.cache,'company.sqlite.lock')),false);
    assert.deepEqual(readAttempts().map(batch=>batch.length),[16]);

    const followup = await (await operation('preview')).json();
    assert.equal(followup.preview.pendingVectors,4);
    const resumed = await operation('start',{planId:followup.planId});
    assert.equal(resumed.status,202);
    assert.notEqual((await resumed.json()).run.runId,runId);
    await waitForAttempt(2);
    const stale = await operation('stop',{runId});
    assert.equal(stale.status,409);
    assert.equal((await stale.json()).error,'knowledge-run-changed');
    assert.equal((await (await operation('status')).json()).run.stopRequested,undefined);
    fs.writeFileSync(path.join(f.directory,'release-2'),'');
    const complete = await result();
    assert.equal(complete.status,'complete',JSON.stringify(complete));
    assert.equal(complete.remainingVectors,0);
    assert.equal(complete.embeddingTokens,4);
    const batches = readAttempts();
    assert.deepEqual(batches.map(batch=>batch.length),[16,4]);
    assert.equal(new Set(batches.flat()).size,20);
    assert.ok(batches.flat().every(text=>text.includes('Authorized text')));
  });
});
