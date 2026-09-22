'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),https=require('node:https');
const {spawn,spawnSync}=require('node:child_process');
const guard=require('./deploy-guard'),csp=require('./compile-csp');
const {needsInput}=require('./deploy-question');
const {resolveWorkspaceContext,validateWorkspaceContext}=require('../../../../scripts/lib/workspace-context');
function parse(argv){
 const a={projectRoot:process.cwd(),files:[]};
 const keys={'--project-root':'projectRoot','--source-root':'sourceRoot','--demand':'demand','--decision':'decision','--python':'python','--known-hosts':'knownHosts','--host-key-sha256':'fingerprint'};
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--execute')a.execute=true;
  else if(argv[i]==='--files'){while(argv[i+1]&&!argv[i+1].startsWith('--'))a.files.push(argv[++i]);}
  else if(keys[argv[i]]){const key=keys[argv[i]]; a[key]=argv[++i];if(!a[key]||a[key].startsWith('--'))guard.stop('missing-argument');}
  else guard.stop('unsupported-argument');
 }
 if(!a.files.length||!/^\d+$/.test(a.demand||''))guard.stop('demand-and-files-required');
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
  async compile(files){const r=await csp.compile(conn,{documents:files.map(f=>f.remotePath)});if(r.status!=='compiled')guard.stop('compile-failed');}
 };
}
function worker(command,workerPath,env,payload){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,['-B',workerPath],{env:{...process.env,...env},windowsHide:true,stdio:['pipe','pipe','pipe']});
  let data=''; const timer=setTimeout(()=>{child.kill();reject(new Error('worker-deadline'));},60000);
  child.stdout.on('data',x=>{data+=x;if(data.length>24*1024*1024)child.kill();});
  child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('error',reject);child.on('close',code=>{clearTimeout(timer);try{const r=JSON.parse(data);if(code||r.status!=='verified')throw new Error();resolve(r);}catch{reject(new Error('worker-failed'));}});
  child.stdin.end(JSON.stringify(payload));
 });
}
function frontendAdapter(a,config,mcp,context){
 const server=mcp.mcpServers?.[config.sftp?.serverName||'sftp-server'];
 if(!server||server.disabled)guard.stop('sftp-unavailable');
 const env={...server.env,CODEX_WORKSPACE:context.workspaceRoot,PYTHONDONTWRITEBYTECODE:'1',ALLOW_REMOTE_COMMANDS:'false'};
 if(a.fingerprint){if(!/^SHA256:[A-Za-z0-9+/]{43}$/.test(a.fingerprint))guard.stop('invalid-fingerprint');env.TARGET_HOST_KEY_SHA256=a.fingerprint;delete env.TARGET_KNOWN_HOSTS;}
 if(a.knownHosts){if(a.fingerprint)guard.stop('conflicting-ssh-trust');env.TARGET_KNOWN_HOSTS=path.resolve(context.workspaceRoot,a.knownHosts);delete env.TARGET_HOST_KEY_SHA256;}
 const build=require('./deploy-frontend').buildPlan;
 const plan=build(a,config,env,context);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iris-deploy-artifacts-'));
 env.LOCAL_PATH=dir;
 const workerPath=path.resolve(__dirname,'../../../../vendor/sftp-server/src/protected-file.py');
 const call=payload=>worker(a.python||server.command,workerPath,env,payload);
 const conn=plan.documents.length?csp.connection(config,mcp):null;
 return {files:plan.files,target:JSON.stringify([env.TARGET_HOST,env.TARGET_PORT,env.REMOTE_PATH]),
  async read(f){const r=await call({mode:'read',remotePath:f.remotePath});return r.content===null?null:Buffer.from(r.content,'base64');},
  async put(f){const localPath=path.join(dir,guard.digest(f.remotePath));fs.writeFileSync(localPath,f.bytes,{mode:0o600});
   await call({mode:'put',remotePath:f.remotePath,localPath,expected:f.expected,sha256:guard.hash(f.bytes)});},
  async compile(){if(conn){const r=await csp.compile(conn,{documents:plan.documents});if(r.status!=='compiled')guard.stop('compile-failed');}},
  close(){fs.rmSync(dir,{recursive:true,force:true});}
 };
}
async function main(kind,argv){
 let adapter;
 try{
  const a=parse(argv),context=resolveWorkspaceContext(a.projectRoot);
  if(validateWorkspaceContext(context).some(r=>['manifest-invalid','schema-version-unsupported'].includes(r.status)))guard.stop('invalid-workspace-context');
  const config=guard.read(path.join(context.contextRoot,'config/project-env.json')),mcp=guard.read(path.join(context.workspaceRoot,'.mcp.json'));
  if(!a.execute){console.log(JSON.stringify({status:'planned',kind,files:a.files,demand:a.demand}));return;}
  let files,target;
  if(kind==='frontend'){adapter=frontendAdapter(a,config,mcp,context);files=adapter.files;target=adapter.target;}
  else {
   const conn=csp.connection(config,mcp);adapter=backendAdapter(conn);
   files=a.files.map(file=>{
    const localPath=fs.realpathSync(path.resolve(context.workspaceRoot,file));
    if(!context.sourceRoots.some(s=>{const r=path.relative(fs.realpathSync(s.target),localPath);return r&&!r.startsWith('..')&&!path.isAbsolute(r);}))guard.stop('file-outside-workspace');
    const ext=path.extname(file).toLowerCase(),content=guard.text(fs.readFileSync(localPath));
    if(!['.cls','.mac','.inc'].includes(ext))guard.stop('unsupported-backend-type');
    const match=ext==='.cls'?content.match(/^Class\s+([%\w.]+)/m):content.match(/^ROUTINE\s+([%\w.]+)/m);
    if(!match)guard.stop('backend-document-name-unknown',{file});
    return {localPath,remotePath:match[1]+ext};
   });
   target=JSON.stringify([conn.protocol,conn.hostname,conn.port,conn.path.replace(/action\/compile.*$/,'')]);
  }
  const roots=files.map(f=>{const r=spawnSync('git',['-C',path.dirname(f.localPath),'rev-parse','--show-toplevel'],{encoding:'utf8',windowsHide:true});if(r.status!==0)guard.stop('repository-unknown');return fs.realpathSync(r.stdout.trim());});
  if(new Set(roots).size!==1)guard.stop('split-batch-by-repository');
  const decision=a.decision?guard.read(path.resolve(a.decision)):null;
  const result=await guard.run({repo:roots[0],demand:a.demand,files,target:kind+':'+target,adapter,decision});
  console.log(JSON.stringify(result));if(result.status!=='verified')process.exitCode=1;
 }catch(e){console.log(JSON.stringify(needsInput(e.reason||'configuration-or-transport-failed',e.details||{})));process.exitCode=1;}
 finally{adapter?.close?.();}
}
module.exports={main,parse,request,backendAdapter};
if(require.main===module)main('backend',process.argv.slice(2));
