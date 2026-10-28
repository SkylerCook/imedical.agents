'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {createSession}=require('./sftp-worker');
const guard=require('./deploy-guard'),csp=require('./compile-csp');
const nightExecution=require('../../../../scripts/lib/night-execution');
const {needsInput}=require('./deploy-question');
const {resolveWorkspaceContext,workspaceContextBlockers}=require('../../../../scripts/lib/workspace-context');
const publication=require('./source-publication');
function parse(argv){
 const a={projectRoot:process.cwd(),files:[]};
 const keys={'--kind':'demandKind','--source-plan':'sourcePlan','--publication-decision':'publicationDecision','--run-directory':'runDirectory','--work-item':'workItemId','--environment-alias':'environmentAlias','--project-root':'projectRoot','--source-root':'sourceRoot','--mode':'mode','--demand':'demand','--decision':'decision','--python':'python','--known-hosts':'knownHosts','--host-key-sha256':'fingerprint'};
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
 if(a.demandKind!==undefined&&!['standard','project'].includes(a.demandKind))guard.stop('explicit-demand-kind-required');
 return a;
}
function request(client,method,suffix,body,headers={}){
 // Callers supply their operation-scoped client. No per-request session creation.
 if(!client||typeof client.request!=='function')guard.stop('shared-atelier-client-required');
 return client.request(method,suffix,body,headers);
}
function backendAdapter(conn,{context,client}={}){
 client ||= require('../../../../scripts/lib/atelier-client').createAtelierClient({connection:conn,context});
 const versions=new Map();
 return {
  async read(f){const r=await client.readDocument(f.remotePath);
   if(r===null){versions.set(f.remotePath,null);return null;}
   if(r.enc)guard.stop('backend-export-format-unknown');
   versions.set(f.remotePath,r.ts);
   return r.bytes;
  },
  async readPublished(file){const value=await client.readDocument(file.document);return value?.bytes??null;},
  async put(f){
   if(!versions.has(f.remotePath))guard.stop('backend-read-required');
   const ts=versions.get(f.remotePath);
   await client.writeDocument(f.remotePath,Buffer.from(f.content),{ts});
   versions.delete(f.remotePath);
  },
  async compile(files){const r=csp.validateResponse(await client.compile(files.map(f=>f.remotePath)));if(r.status!=='compiled')guard.stop('compile-failed',{compilation:r});return r;},
  markUnknown:reason=>client.markUnknown(reason),close:()=>client.close()
 };
}
function frontendTransport(config){
 const selected=config.web?.frontendTransport===undefined?'sftp':config.web.frontendTransport;
 if(!['atelier','sftp'].includes(selected))guard.stop('unsupported-frontend-transport');
 return selected;
}
function atelierFrontendPlan(a,config,context){
 const prefix=value=>{
  if(typeof value!=='string'||!value.trim()||value.startsWith('TODO'))guard.stop('frontend-atelier-prefix-required');
  const normalized=value.replace(/^\//,'').replace(/\/$/,'');
  if(/[\\%?#\x00-\x20]/.test(normalized)||normalized.split('/').some(part=>!part||part==='.'||part==='..'))guard.stop('frontend-atelier-prefix-invalid');
  return normalized;
 };
 const base=prefix(config.web?.basePath);
 // Reuse the established SourceRoot, file-type, UTF-8 and virtual CSP checks.
 // Atelier targets are explicit Web document names, never SFTP physical paths.
 const plan=require('./deploy-frontend').buildPlan(a,config,{REMOTE_PATH:'/'+base},context);
 const files=plan.files.map(file=>{const remotePath=file.file.startsWith('csp/')?prefix(config.web?.cspBasePath)+'/'+file.file.slice(4):base+'/'+file.file;return {...file,remotePath,targetId:remotePath};});
 if(new Set(files.map(file=>file.remotePath)).size!==files.length)guard.stop('duplicate-remote-target');
 return {...plan,transport:'atelier',files};
}
function atelierFrontendAdapter(a,config,mcp,context){
 const started=performance.now(),plan=atelierFrontendPlan(a,config,context);
 if(a.python||a.knownHosts||a.fingerprint)guard.stop('sftp-options-require-sftp-transport');
 for(const file of plan.files)require('./deploy-direct').prepare(file.remotePath,guard.text(guard.readSource(file)),null);
 const conn=csp.connection(config,mcp),docs=backendAdapter(conn,{context});
 const timings={localPreflightMs:Math.round(performance.now()-started)};
 return {files:plan.files,metrics:{kind:'atelier'},timings,
  target:JSON.stringify([conn.protocol,conn.hostname,conn.port,conn.path.replace(/action\/compile.*$/,'')]),
  read:docs.read,readPublished:docs.readPublished,close:docs.close,markUnknown:docs.markUnknown,
  async put(file){
   // Keep the frontend artifact's BOM/newlines. A server that normalizes these
   // bytes fails readback rather than silently changing the upload contract.
   await docs.put({...file,content:file.bytes.toString('utf8')});
   const back=await docs.read(file),sha256=guard.hash(file.bytes);
   if(guard.hash(back)!==sha256)guard.stop('readback-mismatch',{file:file.remotePath});
   return {status:'verified',verification:'final-target-sha256',remotePath:file.remotePath,sha256};
  },
  async compile(files){
   const startedCompile=performance.now();
   try{const targets=files.filter(file=>/\.csp$/i.test(file.remotePath));if(targets.length)return await docs.compile(targets);}
   finally{timings.compileMs=Math.round(performance.now()-startedCompile);}
  }
 };
}
function frontendPlan(a,config,mcp,context){
 if(frontendTransport(config)==='atelier')return atelierFrontendPlan(a,config,context);
 const server=mcp.mcpServers?.[config.sftp?.serverName||'sftp-server'];
 if(!server||server.disabled)guard.stop('sftp-unavailable');
 const plan=require('./deploy-frontend').buildPlan(a,config,server.env||{},context);
 const canonical=a.sourcePlan?atelierFrontendPlan(a,config,context).files:null;
 return {...plan,files:plan.files.map(file=>({...file,...(canonical?{publicationDocument:canonical.find(item=>item.localPath===file.localPath).remotePath}:{}),targetId:file.document||'deployment-target:'+guard.digest(file.remotePath)}))};
}
function frontendAdapter(a,config,mcp,context){
 if(frontendTransport(config)==='atelier')return atelierFrontendAdapter(a,config,mcp,context);
 const remote=require('../../../../scripts/lib/iris-remote-operations');
 const onDemand=remote.contextMode(context)==='intent-first-on-demand-export';
 const preflightStarted=performance.now();
 const server=mcp.mcpServers?.[config.sftp?.serverName||'sftp-server'];
 if(!server||server.disabled)guard.stop('sftp-unavailable');
 const env={...server.env,CODEX_WORKSPACE:context.workspaceRoot,PYTHONDONTWRITEBYTECODE:'1',ALLOW_REMOTE_COMMANDS:'false'};
 if(a.fingerprint){if(!/^SHA256:[A-Za-z0-9+/]{43}$/.test(a.fingerprint))guard.stop('invalid-fingerprint');env.TARGET_HOST_KEY_SHA256=a.fingerprint;delete env.TARGET_KNOWN_HOSTS;}
 if(a.knownHosts){if(a.fingerprint)guard.stop('conflicting-ssh-trust');env.TARGET_KNOWN_HOSTS=path.resolve(context.workspaceRoot,a.knownHosts);delete env.TARGET_HOST_KEY_SHA256;}
 const build=require('./deploy-frontend').buildPlan;
 const plan=build(a,config,env,context);
 if(a.sourcePlan){const canonical=atelierFrontendPlan(a,config,context).files;for(const file of plan.files)file.publicationDocument=canonical.find(item=>item.localPath===file.localPath).remotePath;}
 // Source-plan publication must use per-target reads below. The legacy batch
 // shortcut has no baseline/approval hooks and is unavailable to this path.
 if(a.mode==='direct'&&!a.sourcePlan&&!onDemand&&!context.deploymentArtifacts?.size){
  for(const file of plan.files){
   const content=guard.text(guard.readSource(file));
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
 const conn=plan.documents.length||a.sourcePlan||onDemand?csp.connection(config,mcp):null;
 const policy=a.sourcePlan||onDemand?remote.loadRemotePolicy(context,{connection:conn}):null;
 const owner=policy?remote.createRemoteOperation({policy,connection:conn,channel:'sftp-deployment'}):null;
 // Both SFTP I/O and the optional Atelier compilation share one admission lease.
 const compileClient=conn?require('../../../../scripts/lib/atelier-client').createAtelierClient({connection:conn,context,...(owner?{owner}:{})}):null;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iris-deploy-artifacts-'));
 env.LOCAL_PATH=dir;
 const workerPath=path.resolve(__dirname,'../../../../vendor/sftp-server/src/protected-file.py');
 const session=createSession(a.python||server.command,workerPath,env);
 const timings={localPreflightMs:Math.round(performance.now()-preflightStarted)};
 const results=plan.files.map(f=>({file:f.remotePath,status:'not-executed'}));
 const call=async payload=>{
     const index=plan.files.findIndex(f=>f.remotePath===payload.remotePath);
     try {
         const operation=()=>session.request({...payload,fileIndex:index+1,total:plan.files.length});
         const result=owner?await owner.run({effects:payload.mode==='read'?'read-only':'write',operation:'sftp-'+payload.mode},operation):await operation();
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
  async readPublished(file){const value=await compileClient.readDocument(file.document);return value?.bytes??null;},
  async put(f){const localPath=path.join(dir,guard.digest(f.remotePath));fs.writeFileSync(localPath,f.bytes,{mode:0o600});
   return await call({mode:'put',remotePath:f.remotePath,localPath,expected:f.expected,sha256:guard.hash(f.bytes)});},
  async compile(){
      const started=performance.now();
      try{if(plan.documents.length){const r=csp.validateResponse(await compileClient.compile(plan.documents));if(r.status!=='compiled')guard.stop('compile-failed',{compilation:r});return r;}}
      finally{timings.compileMs=Math.round(performance.now()-started);}
  },
  markUnknown:reason=>{if(owner)owner.markUnknown(reason);else compileClient?.markUnknown(reason);},
  async close(){let exit;try{await session.close();exit=await compileClient?.close();}finally{owner?.close(exit||{cleanupVerified:true});fs.rmSync(dir,{recursive:true,force:true});}return exit;}
 };
}
function sourceReview(result,binding){
 // Generated Storage is a real source change. Preserve the existing frozen
 // version review gate in managed night runs rather than weakening its hash.
 if(binding && result.status==='verified' && result.localStorageSync?.files.length){
  result.deploymentStatus='verified';result.status='review-pending';result.reason='storage-sync-requires-source-review';
 }
 return result;
}
async function main(kind,argv){
 let adapter,nightBinding,nightMode=false,sourceBinding,sourcePlanPath,publicationStarted=false,releaseRepository;
 const started=performance.now();
 try{
  const a=parse(argv),context=resolveWorkspaceContext(a.projectRoot);
  nightMode=Boolean(context.manifest?.nightRunReference||a.runDirectory);
  const blockers=workspaceContextBlockers(context);
  if(blockers.length)guard.stop('invalid-workspace-context',{statuses:blockers.map(r=>r.status)});
  require('../../../../scripts/lib/iris-remote-operations').assertRemoteAllowed(context);
  const {config,configPath,inherited}=require('./project-env').readProjectEnv(context),mcp=guard.read(path.join(context.workspaceRoot,'.mcp.json'));
  require('./project-env').validateTarget(config,mcp.mcpServers?.[config.mcp?.serverName||'iris-agentic-dev']?.env||{});
  const sourcePlanRequired=publication.required(context,config,{kind:a.demandKind});
  if(!a.execute){console.log(JSON.stringify({status:'planned',mode:a.mode,kind,files:a.files,demand:a.demand,configPath,inherited,sourcePlanRequired}));return;}
  if(sourcePlanRequired&&!a.sourcePlan)guard.stop('source-plan-required');
  if(a.publicationDecision&&!a.sourcePlan)guard.stop('publication-decision-requires-source-plan');
  if(a.sourcePlan&&a.decision)guard.stop('publication-overwrite-decision-not-allowed');
  const execution={projectRoot:context.workspaceRoot,runDirectory:a.runDirectory,workItemId:a.workItemId,environmentAlias:a.environmentAlias,configurationFingerprint:nightExecution.fingerprint(require('../../../../scripts/lib/iris-remote-operations').bindDevelopmentMode(context,{config,mcp})),phase:'deployment'};
  const binding=nightExecution.resolveBinding(execution),artifacts=a.files.map(file=>path.resolve(context.workspaceRoot,file));
  if(binding&&typeof nightExecution.frozenArtifact==='function'){
   const mapped=artifacts.map(sourcePath=>({sourcePath,frozen:nightExecution.frozenArtifact(binding,sourcePath)})).filter(item=>item.frozen?.sha256);
   if(mapped.length){
    if(mapped.length!==artifacts.length)guard.stop('partial-frozen-deployment');
    context.deploymentArtifacts=new Map(mapped.map(({sourcePath,frozen})=>[sourcePath,{sourcePath:frozen.sourcePath||sourcePath,immutablePath:frozen.path,immutableSha256:frozen.sha256}]));
   }
  }
  let files,target;
  if(kind==='frontend')files=frontendPlan(a,config,mcp,context).files;
  else {
   files=a.files.map(file=>{
    const requested=path.resolve(context.workspaceRoot,file),immutable=context.deploymentArtifacts?.get(requested);
    const localPath=immutable?.sourcePath||fs.realpathSync(requested);
    const source=context.sourceRoots.find(s=>{const r=path.relative(fs.realpathSync(s.target),localPath);return r&&!r.startsWith('..')&&!path.isAbsolute(r);});
    if(!source||!fs.statSync(immutable?.immutablePath||localPath).isFile())guard.stop('file-outside-workspace');
    const ext=path.extname(file).toLowerCase(),content=guard.text(guard.readSource({localPath,...immutable}));
    if(!['.cls','.mac','.inc'].includes(ext))guard.stop('unsupported-backend-type');
    return {localPath,...immutable,sourceGitRoot:source.gitRoot,remotePath:require('./backend-document').documentName(file,content)};
   });
  }
  if(a.sourcePlan){
   sourcePlanPath=path.resolve(a.sourcePlan);
   releaseRepository=require('./source-sync-core').acquireRepositoryLock(publication.load(sourcePlanPath).gitRoot);
   sourceBinding=publication.assertReady({plan:publication.load(sourcePlanPath),context,files,kind,
    configurationFingerprint:publication.fingerprint(require('../../../../scripts/lib/iris-remote-operations').bindDevelopmentMode(context,{config,mcp})),environmentAlias:a.environmentAlias,
    decision:a.publicationDecision?guard.read(path.resolve(a.publicationDecision)):null});
   files=sourceBinding.files;
  }
  nightBinding=nightExecution.begin({...execution,artifacts:files.map(file=>({localPath:file.immutablePath||file.localPath,targetId:file.targetId||file.document||file.remotePath}))});
  if(kind==='frontend'){adapter=frontendAdapter(a,config,mcp,context);files=adapter.files;target=adapter.target;}
  else {
   const conn=csp.connection(config,mcp);adapter=backendAdapter(conn,{context});
   target=JSON.stringify([conn.protocol,conn.hostname,conn.port,conn.path.replace(/action\/compile.*$/,'')]);
  }
  if(sourceBinding){
   // Frontend adapters reconstruct their local plan. Keep the reviewed artifact
   // hash from the exact file set checked before constructing any transport.
   files=files.map(file=>({...file,publicationArtifactSha256:sourceBinding.publication.files.find(item=>item.document===(file.publicationDocument||file.remotePath))?.artifactSha256}));
   adapter=publication.bindAdapter(adapter,sourceBinding.publication,{context});
   const state=publication.load(sourcePlanPath);state.state='deploying';publication.save(state);publicationStarted=true;
  }
  adapter=nightExecution.boundAdapter(nightBinding,adapter);
  adapter=require('./deploy-recovery').wrap(adapter);
  const prior=nightExecution.reusableDeployment(nightBinding);
  let reuse=false;
  if(prior&&!sourceBinding){
   if(adapter.verifyReuse)reuse=await adapter.verifyReuse();
   else if(adapter.read){const matches=[];for(const f of files){const remote=await adapter.read(f),source=guard.readSource(f);matches.push(kind==='backend'?guard.text(remote)===guard.text(source):guard.hash(remote)===guard.hash(source));}reuse=matches.every(Boolean);}
  }
  if(reuse){await adapter.close?.();const result={status:'verified',reusedOperationId:prior.id,files:files.map(f=>({file:f.remotePath,status:'unchanged'}))};nightExecution.finish(nightBinding,result);nightBinding=null;console.log(JSON.stringify(result));return;}
  if(a.mode==='direct'||sourceBinding){
   const result=sourceReview(adapter.batch?{...await adapter.batch(),recovery:adapter.deploymentRecovery}:await require('./deploy-direct').run({files,adapter,kind}),nightBinding);
   if(sourceBinding&&['verified','review-pending'].includes(result.status)&&result.localStorageSync?.files.length){result.deploymentStatus='compiled';result.status='post-compile-review';result.reason='storage-sync-requires-source-review';}
   if(sourceBinding){
    result.files=result.files.map(file=>({...file,document:file.document||files.find(item=>item.remotePath===file.file)?.publicationDocument||file.file}));
    result.publicationKind=kind;
    try{await publication.finalReadback(publication.load(sourcePlanPath),kind,result,adapter);}
    catch(error){
     result.status='failed-or-unknown';result.reason=error.reason||error.code||'publication-final-readback-incomplete';
     result.details=error.details||{};result.partialOrUnknown=true;
     try{adapter.markUnknown?.(result.reason);}catch{}
    }
   }
   const exit=await adapter.close?.();
   if(exit){result.remoteExit=exit;if(exit.cleanupVerified===false){result.status='failed-or-unknown';result.reason='remote-session-exit-unverified';}}
   if(sourceBinding){result.publicationSha256=sourceBinding.publication.sha256;publication.record(sourcePlanPath,result,{kind});}
   if(adapter.metrics)result.transport=adapter.metrics;
   result.timings={...result.timings,...adapter.timings,totalMs:Math.round(performance.now()-started)};
   nightExecution.finish(nightBinding,{...result,...(result.status==='group-verified'?{status:'verified'}:{}),...(result.partialOrUnknown?{failureCategory:'execution-unknown'}:{})});nightBinding=null;
    let output=JSON.stringify(result);
   for(const secret of [config.iris?.password,...Object.values(mcp.mcpServers||{}).map(s=>s.env?.IRIS_PASSWORD)])if(secret)output=output.split(JSON.stringify(secret).slice(1,-1)).join('[redacted]');
   console.log(output);if(!['verified','group-verified'].includes(result.status))process.exitCode=1;
   return;
  }
  const roots=files.map(f=>{const r=spawnSync('git',['-C',f.immutablePath&&f.sourceGitRoot?f.sourceGitRoot:path.dirname(f.localPath),'rev-parse','--show-toplevel'],{encoding:'utf8',windowsHide:true});if(r.status!==0)guard.stop('repository-unknown');return fs.realpathSync(r.stdout.trim());});
  if(new Set(roots).size!==1)guard.stop('split-batch-by-repository');
  const decision=a.decision?guard.read(path.resolve(a.decision)):null;
  const result=sourceReview(await guard.run({repo:roots[0],demand:a.demand,files,target:kind+':'+target,adapter,decision}),nightBinding);
  await adapter.close?.();
  if(adapter.metrics)result.transport=adapter.metrics;
  if(adapter.results && !result.files)result.files=adapter.results;
  result.timings={...result.timings,...adapter.timings,totalMs:Math.round(performance.now()-started)};
  nightExecution.finish(nightBinding,{...result,...(result.partialOrUnknown?{failureCategory:'execution-unknown'}:{})});nightBinding=null;
   console.log(JSON.stringify(result));if(result.status!=='verified')process.exitCode=1;
 }catch(e){if(publicationStarted){try{publication.record(sourcePlanPath,{status:'failed-or-unknown',reason:e.reason||e.code||'publication-incomplete'},{kind});}catch{}}if(nightBinding){try{nightExecution.finish(nightBinding,{status:'review-pending',failureCategory:'execution-unknown'});}catch{}}console.log(JSON.stringify(nightMode?{status:'blocked',reason:e.reason||e.code||'night-execution-unverified',handoff:true}:needsInput(e.reason||e.code||'configuration-or-transport-failed',e.details||{})));process.exitCode=1;}
 finally{try{await adapter?.close?.();}finally{releaseRepository?.();}}
}
module.exports={main,parse,request,backendAdapter,frontendAdapter,frontendTransport,atelierFrontendPlan,frontendPlan};
if(require.main===module)main('backend',process.argv.slice(2));
