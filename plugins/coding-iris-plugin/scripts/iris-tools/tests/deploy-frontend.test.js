const {createTempDirectory,ownsTempDirectory}=require('../../../../../scripts/tests/fixtures/temp-directory');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {parse,buildPlan,execute}=require('../deploy-frontend');
const plan={schema:'iris-frontend-deploy/v1',files:[{file:'csp/page.csp',sha256:'abc'}],documents:['web/csp/page.csp']};
const evidence={status:'verified',files:[{...plan.files[0],status:'uploaded'}]};
test('upload verification precedes exactly one compile',async()=>{
 const calls=[];
 const result=await execute(plan,async()=>{calls.push('upload');return evidence;},async docs=>{calls.push('compile');assert.deepEqual(docs,plan.documents);return {status:'compiled'};});
 assert.equal(result.status,'verified');assert.deepEqual(calls,['upload','compile']);
});
test('unchanged files still compile requested CSP',async()=>{
 let count=0;
 const result=await execute(plan,async()=>({...evidence,files:[{...evidence.files[0],status:'unchanged'}]}),async()=>{count++;return {status:'compiled'};});
 assert.equal(result.status,'verified');assert.equal(count,1);
});
test('failure or incomplete hash evidence prevents compilation',async()=>{
 for(const response of [{status:'upload-failed'}, {status:'verified',files:[]},{status:'verified',files:[{...evidence.files[0],sha256:'wrong'}]}]) {
  let called=false;const result=await execute(plan,async()=>response,async()=>{called=true;});
  assert.notEqual(result.status,'verified');assert.equal(called,false);
 }
});
test('compile failure is preserved without retry',async()=>{
 let calls=0;const result=await execute(plan,async()=>evidence,async()=>{calls++;return {status:'compile-failed'};});
 assert.equal(result.status,'compile-failed');assert.equal(calls,1);
});
test('static assets require no compiler',async()=>{
 const result=await execute({...plan,documents:[]},async()=>evidence,async()=>{throw Error('unexpected compile');});assert.equal(result.status,'verified');
});
test('local plan maps explicit files and rejects escapes, duplicate and invalid UTF8',()=>{
 const root=createTempDirectory('frontend-plan-');
 try {
  fs.mkdirSync(path.join(root,'csp'));fs.writeFileSync(path.join(root,'csp/page.csp'),'hello');
  const args={sourceRoot:root,files:['csp/page.csp']};const config={web:{cspBasePath:'web/csp'}};
  const context={workspaceRoot:root,sourceRoots:[{target:root}]};const env={REMOTE_PATH:'/web'};
  const p=buildPlan(args,config,env,context);assert.equal(p.files[0].remotePath,'/web/csp/page.csp');assert.deepEqual(p.documents,['web/csp/page.csp']);
  assert.throws(()=>buildPlan({...args,files:[...args.files,...args.files]},config,env,context));
  assert.throws(()=>buildPlan(args,config,{REMOTE_PATH:'/web/../other'},context));
  fs.writeFileSync(path.join(root,'csp/page.csp'),Buffer.from([0xff]));assert.throws(()=>buildPlan(args,config,env,context));
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('execution and trust must be explicit',()=>{
 assert.equal(parse(['--files','a.js']).execute,false);
 assert.throws(()=>parse(['--files','a.js','--host-key-sha256','invalid']));
 assert.throws(()=>parse(['--files','a.js','--known-hosts','hosts','--host-key-sha256','SHA256:'+'A'.repeat(43)]));
});

test('direct frontend adapter batches once through the existing worker',async()=>{
 const frontend=require('../deploy-frontend');
 const {frontendAdapter}=require('../deploy-protected');
 const root=createTempDirectory('frontend-routing-');
 const original=frontend.uploadBatch;
 try {
  fs.mkdirSync(path.join(root,'css'));fs.writeFileSync(path.join(root,'css/page.css'),'body{}');
  let calls=0;
  frontend.uploadBatch=async(command,worker,env,plan)=>{
   calls++;assert.match(worker,/upload-batch\.py$/);assert.equal(env.LOCAL_PATH,root);
   return {status:'verified',files:plan.files.map(f=>({file:f.file,sha256:f.sha256,status:'unchanged'}))};
  };
  const adapter=frontendAdapter({mode:'direct',sourceRoot:root,files:['css/page.css']}, {},
   {mcpServers:{'sftp-server':{command:'python',env:{REMOTE_PATH:'/web'}}}},
   {workspaceRoot:root,sourceRoots:[{target:root}]});
  assert.equal((await adapter.batch()).status,'verified');assert.equal(calls,1);assert.equal(adapter.read,undefined);
 }finally{frontend.uploadBatch=original;fs.rmSync(root,{recursive:true,force:true});}
});

test('batch routing preserves JavaScript syntax preflight before connecting',()=>{
 const {frontendAdapter}=require('../deploy-protected');
 const root=createTempDirectory('frontend-syntax-');
 try {
  fs.mkdirSync(path.join(root,'scripts'));fs.writeFileSync(path.join(root,'scripts/page.js'),'const = ;');
  assert.throws(()=>frontendAdapter({mode:'direct',sourceRoot:root,files:['scripts/page.js']},{},
   {mcpServers:{'sftp-server':{command:'python',env:{REMOTE_PATH:'/web'}}}},
   {workspaceRoot:root,sourceRoots:[{target:root}]}),e=>e.reason==='javascript-syntax-failed');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('direct CSP batch passes workspace context and kind to exactly one compile', async () => {
 const frontend=require('../deploy-frontend'), csp=require('../compile-csp');
 const root=createTempDirectory('frontend-csp-context-');
 const originalUpload=frontend.uploadBatch, originalCompile=csp.compile;
 try {
  fs.mkdirSync(path.join(root,'csp'));fs.writeFileSync(path.join(root,'csp/page.csp'),'hello');
  const context={workspaceRoot:root,contextRoot:path.join(root,'.agents'),sourceRoots:[{target:root}]};
  const config={iris:{namespace:'TEST'},web:{cspBasePath:'web/csp'}};
  const mcp={mcpServers:{'sftp-server':{command:'python',env:{REMOTE_PATH:'/web'}},'iris-agentic-dev':{env:{IRIS_HOST:'synthetic.invalid',IRIS_WEB_PORT:'443',IRIS_SCHEME:'https',IRIS_NAMESPACE:'TEST',IRIS_USERNAME:'fixture',IRIS_PASSWORD:'fixture'}}}};
  frontend.uploadBatch=async(_cmd,_worker,_env,plan)=>({status:'verified',files:plan.files.map(f=>({file:f.file,sha256:f.sha256,status:'uploaded'}))});
  let count=0;
  csp.compile=async(_conn,plan,timeout,options)=>{count++;assert.equal(options.context,context);assert.equal(options.kind,'standard');assert.equal(timeout,60000);assert.deepEqual(plan.documents,['web/csp/page.csp']);return {status:'compiled'};};
  const adapter=require('../deploy-protected').frontendAdapter({mode:'direct',kind:'standard',sourceRoot:root,files:['csp/page.csp']},config,mcp,context);
  assert.equal((await adapter.batch()).status,'verified');assert.equal(count,1);
 } finally {frontend.uploadBatch=originalUpload;csp.compile=originalCompile;fs.rmSync(root,{recursive:true,force:true});}
});

test('compile dispatch diagnostics retain safe code without echoing exception messages', async () => {
 let calls=0;
 const result=await execute(plan,async()=>evidence,async()=>{calls++;throw Object.assign(new Error('private-value'),{code:'session-legacy-pool-unresolved',beforeSend:true});});
 assert.equal(result.reason,'session-legacy-pool-unresolved');assert.equal(result.beforeSend,true);assert.equal(calls,1);assert.equal(JSON.stringify(result).includes('private-value'),false);
});

test('on-demand SFTP reads and uploads with pending license registration', async () => {
 const root=createTempDirectory('frontend-pending-policy-');
 const worker=require('../sftp-worker'), original=worker.createSession;
 const modulePath=require.resolve('../deploy-protected'), cached=require.cache[modulePath];
 let adapter, closed=false; const calls=[];
 try {
  fs.mkdirSync(path.join(root,'scripts'));fs.writeFileSync(path.join(root,'scripts/page.js'),'window.fixture = 1;');
  const context={workspaceRoot:root,contextRoot:path.join(root,'.agents'),sourceRoots:[{target:root}]};
  fs.mkdirSync(path.join(context.contextRoot,'config'),{recursive:true});
  fs.writeFileSync(path.join(context.contextRoot,'config/project_context_profile.md'),'- contextMode: intent-first-on-demand-export\n');
  fs.writeFileSync(path.join(context.contextRoot,'config/iris-remote-policy.json'),JSON.stringify({schema:'iris-remote-policy/v1',enabled:true,poolKey:'fixture',coordinationRoot:path.join(root,'coordination'),maxConcurrent:1,qualification:{status:'pending'}}));
  worker.createSession=()=>({stats:{},request:async payload=>{calls.push(payload.mode);return {status:'verified',content:null};},close:async()=>{closed=true;}});
  delete require.cache[modulePath];
  const mcp={mcpServers:{'sftp-server':{command:'fixture',env:{REMOTE_PATH:'/web'}},'iris-agentic-dev':{env:{IRIS_HOST:'synthetic.invalid',IRIS_WEB_PORT:'443',IRIS_SCHEME:'https',IRIS_NAMESPACE:'TEST',IRIS_USERNAME:'fixture',IRIS_PASSWORD:'fixture'}}}};
  adapter=require('../deploy-protected').frontendAdapter({mode:'direct',sourceRoot:root,files:['scripts/page.js']},{iris:{namespace:'TEST'}},mcp,context);
  assert.equal(await adapter.read(adapter.files[0]),null);
  await adapter.put({...adapter.files[0],bytes:fs.readFileSync(adapter.files[0].localPath)});
  await adapter.close();adapter=null;
  assert.deepEqual(calls,['read','put']);assert.equal(closed,true);
 } finally {
  if(adapter)await adapter.close();
  worker.createSession=original;delete require.cache[modulePath];if(cached)require.cache[modulePath]=cached;
  fs.rmSync(root,{recursive:true,force:true});
 }
});
