'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),https=require('node:https');
const {spawnSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {createSession}=require('./sftp-worker');
const guard=require('./deploy-guard'),csp=require('./compile-csp');
const nightExecution=require('../../../../scripts/lib/night-execution');
const {needsInput}=require('./deploy-question');
const {resolveWorkspaceContext,workspaceContextBlockers}=require('../../../../scripts/lib/workspace-context');
function parse(argv){
 const a={projectRoot:process.cwd(),files:[]};
 const keys={'--run-directory':'runDirectory','--work-item':'workItemId','--environment-alias':'environmentAlias','--project-root':'projectRoot','--source-root':'sourceRoot','--mode':'mode','--demand':'demand','--decision':'decision','--python':'python','--known-hosts':'knownHosts','--host-key-sha256':'fingerprint'};
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--execute')a.execute=true;
  else if(argv[i]==='--files'){while(argv[i+1]&&!argv[i+1].startsWith('--'))a.files.push(argv[++i]);}
  else if(keys[argv[i]]){const key=keys[argv[i]]; a[key]=argv[++i];if(!a[key]||a[key].startsWith('--'))guard.stop('missing-argument');}
  else guard.stop('unsupported-argument');
 }
 // Existing --demand invocations retain the original guarded semantics.
 a.mode ||= (a.demand || a.decision) ? 'guarded' : 'direct';
 if(!a.files.length)guard.stop('files-required');
 if(!['direct','guarded'].includes(a.mode))guard.stop('unsupported-deploy-mode');
 if((a.mode==='guarded'||a.demand!==undefined)&&!/^\d+$/.test(a.demand||''))guard.stop('demand-required');
 if(a.mode==='direct'&&a.decision)guard.stop('decision-requires-guarded-mode');
 return a;
}
function request(conn,method,suffix,body,headers={}){
 return new Promise((resolve,reject)=>{
  const data=body===undefined?null:Buffer.from(JSON.stringify(body));
  const req=(conn.protocol==='https:'?https:http).request({...conn,path:conn.path.replace(/action\/compile.*$/,'')+suffix,method,headers:{...headers,...(data?{'Content-Type':'application/json','Content-Length':data.length}:{})}},res=>{
   const chunks=[];let size=0;
   res.on('data',x=>{size+=x.length;if(size>16*1024*1024)req.destroy(new Error('response-too-large'));else chunks.push(x);});
   res.on('error',reject);
   res.on('end',()=>{
    if(method==='GET'&&res.statusCode===404)return resolve(null);
    if(res.statusCode<200||res.statusCode>=300)return reject(new guard.Attention('http-failed',{method,status:res.statusCode}));
    try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
     if(!Array.isArray(value.status?.errors)||value.status.errors.length||value.status.summary)throw new Error('invalid-response');
     resolve(value);
    }catch{reject(new Error('invalid-response'));}
   });
  });
  const timer=setTimeout(()=>req.destroy(new Error('request-deadline')),60000);
  req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end(data);
 });
}
function backendAdapter(conn){
 const versions=new Map();
 return {
  async read(f){const r=await request(conn,'GET','doc/'+encodeURIComponent(f.remotePath));
   if(r===null){versions.set(f.remotePath,null);return null;}
   if(!Array.isArray(r.result?.content)||!r.result.content.every(x=>typeof x==='string')||r.result.enc)guard.stop('backend-export-format-unknown');
   if(typeof r.result.ts!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(r.result.ts))guard.stop('backend-version-unknown');
   versions.set(f.remotePath,r.result.ts);
   return Buffer.from(r.result.content.join('\n'));
  },
  async put(f){
   if(!versions.has(f.remotePath))guard.stop('backend-read-required');
   const ts=versions.get(f.remotePath);
   await request(conn,'PUT','doc/'+encodeURIComponent(f.remotePath),{enc:false,content:f.content.split('\n')},ts?{'IF-NONE-MATCH':ts}:{});
   versions.delete(f.remotePath);
  },
  async compile(files){const r=await csp.compile(conn,{documents:files.map(f=>f.remotePath)});if(r.status!=='compiled')guard.stop('compile-failed',{compilation:r});return r;}
 };
}
function frontendAdapter(a,config,mcp,context){
 const preflightStarted=performance.now();
 const server=mcp.mcpServers?.[config.sftp?.serverName||'sftp-server'];
 if(!server||server.disabled)guard.stop('sftp-unavailable');
 const env={...server.env,CODEX_WORKSPACE:context.workspaceRoot,PYTHONDONTWRITEBYTECODE:'1',ALLOW_REMOTE_COMMANDS:'false'};
 if(a.fingerprint){if(!/^SHA256:[A-Za-z0-9+/]{43}$/.test(a.fingerprint))guard.stop('invalid-fingerprint');env.TARGET_HOST_KEY_SHA256=a.fingerprint;delete env.TARGET_KNOWN_HOSTS;}
 if(a.knownHosts){if(a.fingerprint)guard.stop('conflicting-ssh-trust');env.TARGET_KNOWN_HOSTS=path.resolve(context.workspaceRoot,a.knownHosts);delete env.TARGET_HOST_KEY_SHA256;}
 const build=require('./deploy-frontend').buildPlan;
 const plan=build(a,config,env,context);
 if(a.mode==='direct'){
  for(const file of plan.files){
   const content=guard.text(fs.readFileSync(file.localPath));
   require('./deploy-direct').prepare(file.remotePath,content,null);
  }
  const frontend=require('./deploy-frontend');
  env.LOCAL_PATH=plan.sourceRoot;
  const batchPath=path.resolve(__dirname,'../../../../vendor/sftp-server/src/upload-batch.py');
  const conn=plan.documents.length?csp.connection(config,mcp):null;
  const localPreflightMs=Math.round(performance.now()-preflightStarted);
  return {files:plan.files, async verifyReuse(){
   const probe=createSession(a.python||server.command,path.resolve(__dirname,'../../../../vendor/sftp-server/src/protected-file.py'),env);
   try{for(const f of plan.files){const r=await probe.request({mode:'read',remotePath:f.remotePath});if(r.status!=='verified'||r.content===null||guard.hash(Buffer.from(r.content,'base64'))!==guard.hash(fs.readFileSync(f.localPath)))return false;}return true;}finally{await probe.close();}
  }, async batch(){
   const result=await frontend.execute(plan,p=>frontend.uploadBatch(a.python||server.command,batchPath,env,p),
    documents=>csp.compile(conn,{documents}));
   result.timings.localPreflightMs=localPreflightMs;
   return result;
  }};
 }
 const conn=plan.documents.length?csp.connection(config,mcp):null;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iris-deploy-artifacts-'));
 env.LOCAL_PATH=dir;
 const workerPath=path.resolve(__dirname,'../../../../vendor/sftp-server/src/protected-file.py');
 const session=createSession(a.python||server.command,workerPath,env);
 const timings={localPreflightMs:Math.round(performance.now()-preflightStarted)};
 const results=plan.files.map(f=>({file:f.remotePath,status:'not-executed'}));
 const call=async payload=>{
     const index=plan.files.findIndex(f=>f.remotePath===payload.remotePath);
     try {
         const result=await session.request({...payload,fileIndex:index+1,total:plan.files.length});
         if(result.status!=='verified') {
             const error=new Error('SFTP operation failed');
             error.fileStatus=result.fileStatus;
             throw error;
         }
         return result;
     } catch(error) {
         error.fileStatus ||= 'failed-or-unknown';
         if(results[index].status==='not-executed') results[index]={file:payload.remotePath,status:error.fileStatus||'failed-or-unknown'};
         throw error;
     }
 };
 return {files:plan.files,metrics:session.stats,timings,results,record(f,status){
     const index=plan.files.findIndex(item=>item.remotePath===f.remotePath);
     results[index]={file:f.remotePath,status,sha256:guard.hash(f.bytes),verified:true};
 },recordFailure(f,error){
     if(!f)return;
     const index=plan.files.findIndex(item=>item.remotePath===f.remotePath);
     if(index<0)return;
     const previous=results[index];
     if(previous.verified || previous.status==='not-executed')results[index]={file:f.remotePath,status:error.fileStatus||'failed',
         reason:error.reason||'validation-failed',...(previous.verified?{previousVerification:previous}:{})};
 },target:JSON.stringify([env.TARGET_HOST,env.TARGET_PORT,env.REMOTE_PATH]),
  async read(f){const r=await call({mode:'read',remotePath:f.remotePath});return r.content===null?null:Buffer.from(r.content,'base64');},
  async put(f){const localPath=path.join(dir,guard.digest(f.remotePath));fs.writeFileSync(localPath,f.bytes,{mode:0o600});
   return await call({mode:'put',remotePath:f.remotePath,localPath,expected:f.expected,sha256:guard.hash(f.bytes)});},
  async compile(){
      const started=performance.now();
      try{if(conn){const r=await csp.compile(conn,{documents:plan.documents});if(r.status!=='compiled')guard.stop('compile-failed',{compilation:r});return r;}}
      finally{timings.compileMs=Math.round(performance.now()-started);}
  },
  async close(){try{await session.close();}finally{fs.rmSync(dir,{recursive:true,force:true});}}
 };
}
async function main(kind,argv){
 let adapter,nightBinding,nightMode=false;
 const started=performance.now();
 try{
  const a=parse(argv),context=resolveWorkspaceContext(a.projectRoot);
  nightMode=Boolean(context.manifest?.nightRunReference||a.runDirectory);
  const blockers=workspaceContextBlockers(context);
  if(blockers.length)guard.stop('invalid-workspace-context',{statuses:blockers.map(r=>r.status)});
  const {config,configPath,inherited}=require('./project-env').readProjectEnv(context),mcp=guard.read(path.join(context.workspaceRoot,'.mcp.json'));
  require('./project-env').validateTarget(config,mcp.mcpServers?.[config.mcp?.serverName||'iris-agentic-dev']?.env||{});
  if(!a.execute){console.log(JSON.stringify({status:'planned',mode:a.mode,kind,files:a.files,demand:a.demand,configPath,inherited}));return;}
  nightBinding=nightExecution.begin({projectRoot:context.workspaceRoot,runDirectory:a.runDirectory,workItemId:a.workItemId,environmentAlias:a.environmentAlias,configurationFingerprint:nightExecution.fingerprint({config,mcp}),phase:'deployment',artifacts:a.files.map(file=>path.resolve(context.workspaceRoot,file))});
  let files,target;
  if(kind==='frontend'){adapter=frontendAdapter(a,config,mcp,context);files=adapter.files;target=adapter.target;}
  else {
   const conn=csp.connection(config,mcp);adapter=backendAdapter(conn);
   files=a.files.map(file=>{
    const localPath=fs.realpathSync(path.resolve(context.workspaceRoot,file));
    if(!context.sourceRoots.some(s=>{const r=path.relative(fs.realpathSync(s.target),localPath);return r&&!r.startsWith('..')&&!path.isAbsolute(r);}))guard.stop('file-outside-workspace');
    const ext=path.extname(file).toLowerCase(),content=guard.text(fs.readFileSync(localPath));
    if(!['.cls','.mac','.inc'].includes(ext))guard.stop('unsupported-backend-type');
    return {localPath,remotePath:require('./backend-document').documentName(file,content)};
   });
   target=JSON.stringify([conn.protocol,conn.hostname,conn.port,conn.path.replace(/action\/compile.*$/,'')]);
  }
  const prior=nightExecution.reusableDeployment(nightBinding);
  let reuse=false;
  if(prior){
   if(adapter.verifyReuse)reuse=await adapter.verifyReuse();
   else if(adapter.read){const matches=await Promise.all(files.map(async f=>{const remote=await adapter.read(f),source=fs.readFileSync(f.localPath);return kind==='backend'?guard.text(remote)===require('./deploy-direct').prepare(f.remotePath,guard.text(source),guard.text(remote)):guard.hash(remote)===guard.hash(source);}));reuse=matches.every(Boolean);}
  }
  if(reuse){await adapter.close?.();const result={status:'verified',reusedOperationId:prior.id,files:files.map(f=>({file:f.remotePath,status:'unchanged'}))};nightExecution.finish(nightBinding,result);nightBinding=null;console.log(JSON.stringify(result));return;}
  if(a.mode==='direct'){
   const result=adapter.batch?await adapter.batch():await require('./deploy-direct').run({files,adapter,kind});
   await adapter.close?.();
   result.timings={...result.timings,totalMs:Math.round(performance.now()-started)};
   nightExecution.finish(nightBinding,{...result,...(result.partialOrUnknown?{failureCategory:'execution-unknown'}:{})});nightBinding=null;
    let output=JSON.stringify(result);
   for(const secret of [config.iris?.password,...Object.values(mcp.mcpServers||{}).map(s=>s.env?.IRIS_PASSWORD)])if(secret)output=output.split(JSON.stringify(secret).slice(1,-1)).join('[redacted]');
   console.log(output);if(result.status!=='verified')process.exitCode=1;
   return;
  }
  const roots=files.map(f=>{const r=spawnSync('git',['-C',path.dirname(f.localPath),'rev-parse','--show-toplevel'],{encoding:'utf8',windowsHide:true});if(r.status!==0)guard.stop('repository-unknown');return fs.realpathSync(r.stdout.trim());});
  if(new Set(roots).size!==1)guard.stop('split-batch-by-repository');
  const decision=a.decision?guard.read(path.resolve(a.decision)):null;
  const result=await guard.run({repo:roots[0],demand:a.demand,files,target:kind+':'+target,adapter,decision});
  await adapter.close?.();
  if(adapter.metrics)result.transport=adapter.metrics;
  if(adapter.results && !result.files)result.files=adapter.results;
  result.timings={...result.timings,...adapter.timings,totalMs:Math.round(performance.now()-started)};
  nightExecution.finish(nightBinding,{...result,...(result.partialOrUnknown?{failureCategory:'execution-unknown'}:{})});nightBinding=null;
   console.log(JSON.stringify(result));if(result.status!=='verified')process.exitCode=1;
 }catch(e){if(nightBinding){try{nightExecution.finish(nightBinding,{status:'review-pending',failureCategory:'execution-unknown'});}catch{}}console.log(JSON.stringify(nightMode?{status:'blocked',reason:e.reason||'night-execution-unverified',handoff:true}:needsInput(e.reason||'configuration-or-transport-failed',e.details||{})));process.exitCode=1;}
 finally{await adapter?.close?.();}
}
module.exports={main,parse,request,backendAdapter,frontendAdapter};
if(require.main===module)main('backend',process.argv.slice(2));
