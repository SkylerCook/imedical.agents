'use strict';
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {needsInput,decisionError}=require('./deploy-question');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const hash=x=>x===null?null:digest(x);
class Attention extends Error { constructor(reason,details={}) {super(reason); this.reason=reason; this.details=details;} }
const stop=(reason,details)=>{throw new Attention(reason,details);};
function git(repo,args) {
 const p=spawnSync('git',['-C',repo,...args],{encoding:'utf8',timeout:60000,windowsHide:true,maxBuffer:16*1024*1024});
 if(p.status!==0) stop('git-command-failed',{operation:args[0]});
 return p.stdout.trimEnd();
}
function text(bytes) {
 if(bytes===null)return null;
 let s; try{s=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{stop('encoding-unknown');}
 if(s.includes('\0')||s.includes('\uFFFD'))stop('binary-or-invalid-text');
 return s.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
}
function merge(base,local,remote) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iris-merge-'));
 try {
  for(const [n,s] of Object.entries({base,local,remote}))fs.writeFileSync(path.join(dir,n),s,{mode:0o600});
  const p=spawnSync('git',['merge-file','-p',path.join(dir,'local'),path.join(dir,'base'),path.join(dir,'remote')],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
  if(p.status!==0)stop('merge-conflict');
  return p.stdout;
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function choose(base,local,remote,previous,decision) {
 if(local===null)stop('local-delete-or-rename');
 if(previous?.merged && remote!==previous.deployed && remote!==local && !decision)stop('remote-overwritten-again');
 if(decision==='overwrite')return {content:local,merged:!!previous?.merged};
 if(remote===local)return {content:local,merged:!!previous?.merged};
 if(previous) {
  if(remote===previous.deployed)return {content:merge(previous.local,local,remote),merged:previous.merged};
  // First external change after a direct deployment: merge only the new local delta.
  base=previous.local;
 }
 if(base===null) {
  if(remote===null)return {content:local,merged:false};
  stop('new-file-collision');
 }
 if(remote===null)stop('remote-deleted');
 if(remote===base)return {content:local,merged:!!previous?.merged};
 return {content:merge(base,local,remote),merged:true};
}
function maintain(command,repo,demand,base,confirmation){
 const loc=location(repo,demand);let state;
 if(confirmation!=='--confirm')stop('session-change-confirmation-required');
 let fd;const lock=path.join(loc.dir,'lock');
 try{fd=fs.openSync(lock,'wx',0o600);}catch{stop('session-busy-or-interrupted');}
 try{
 state=read(loc.file);
 if(state.closed)stop('session-closed');
 if(command==='rebase'){
  checkGit(repo);
  state.base=git(repo,['rev-parse',base+'^{commit}']);
  // Keep all deployment snapshots and merge history.
 }else if(command==='close'){
  state.closed=true;
  for(const t of Object.values(state.targets)){delete t.pending;
  for(const f of Object.values(t.files)){
   f.localHash=hash(f.local);f.deployedHash=hash(f.deployed);delete f.local;delete f.deployed;
  }}
 }else stop('unsupported-session-command');
 write(loc.file,state);return {status:command==='close'?'closed':'baseline-updated',base:state.base};
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function stateRoot() {return path.join(os.homedir(),'.iris-deploy-state');}
function read(file) {try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{stop('state-missing-or-invalid',{file});}}
function write(file,data) {
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const tmp=file+'.'+crypto.randomUUID()+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600,flag:'wx'});
 fs.renameSync(tmp,file);
}
function location(repo,demand) {
 if(!/^[0-9]+$/.test(demand||''))stop('demand-required');
 repo=fs.realpathSync(repo);
 const id=digest(repo+'\0'+demand);
 return {repo,dir:path.join(stateRoot(),id),file:path.join(stateRoot(),id,'session.json')};
}
function initialize(repo,demand,baseRef,confirm) {
 const loc=location(repo,demand);
 fs.mkdirSync(loc.dir,{recursive:true,mode:0o700});
 const lock=path.join(loc.dir,'lock');let fd;
 try{fd=fs.openSync(lock,'wx',0o600);}catch{stop('session-busy-or-interrupted');}
 try{
 if(fs.existsSync(loc.file))stop('session-already-exists');
 if(fs.realpathSync(git(repo,['rev-parse','--show-toplevel']))!==loc.repo)stop('repository-root-required');
 if(baseRef) {if(!confirm)stop('baseline-confirmation-required');}
 else {
  if(git(repo,['status','--porcelain']))stop('dirty-worktree-baseline-unknown');
  git(repo,['rev-parse','--abbrev-ref','@{upstream}']);
  git(repo,['pull','--ff-only']);
  baseRef='HEAD';
 }
 const base=git(repo,['rev-parse',baseRef+'^{commit}']);
 write(loc.file,{schema:1,repo:loc.repo,demand,base,targets:{},createdAt:new Date().toISOString()});
 return {status:'initialized',base};
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function snapshot(repo,files) {
 return {head:git(repo,['rev-parse','HEAD']),index:git(repo,['ls-files','--stage']),files:files.map(f=>[f.localPath,hash(fs.readFileSync(f.localPath))])};
}
function checkGit(repo) {
 git(repo,['fetch','--no-tags']);
 const upstream=git(repo,['rev-parse','--abbrev-ref','@{upstream}']);
 const counts=git(repo,['rev-list','--left-right','--count',upstream+'...HEAD']).split(/\s+/).map(Number);
 if(counts[0])stop('git-upstream-update',{behind:counts[0],ahead:counts[1]});
}
function baseline(repo,base,relative) {
 const entry=git(repo,['ls-tree',base,'--',relative]);
 if(!entry)return null;
 if(!entry.startsWith('100'))stop('unsupported-git-file');
 const p=spawnSync('git',['-C',repo,'show',base+':'+relative],{windowsHide:true,maxBuffer:16*1024*1024});
 if(p.status!==0)stop('baseline-read-failed');
 return text(p.stdout);
}
function storage(s) {
 const source=s||"",blocks=[];
 for(const match of source.matchAll(/^[ \t]*Storage[ \t]+\S+/gm)){
  const open=source.indexOf("{",match.index);
  if(open<0)stop("storage-format-unknown");
  let depth=1,end=open+1;
  for(;end<source.length&&depth;end++){if(source[end]==="{")depth++;else if(source[end]==="}")depth--;}
  if(depth)stop("storage-format-unknown");
  blocks.push(source.slice(match.index,end));
 }
 return blocks.join("\n");
}
function validate(file,content,base,remote) {
 if(/\.cls$/i.test(file) && (storage(base)!==storage(content)||storage(base)!==storage(remote)))stop('storage-review-required',{file});
 if(/^(<<<<<<< |=======\s*$|>>>>>>> )/m.test(content))stop('conflict-markers',{file});
 if(/\.(js|cjs|mjs)$/i.test(file)) {
  const r=spawnSync(process.execPath,['--check'],{input:content,encoding:'utf8',windowsHide:true,timeout:30000});
  if(r.status!==0)stop('javascript-syntax-failed',{file});
 }
}
async function run({repo,demand,files,target,adapter,decision,checkUpdates=checkGit}) {
 const invalid=decisionError(decision);
 if(invalid)return needsInput(invalid);
 const loc=location(repo,demand);
 fs.mkdirSync(loc.dir,{recursive:true,mode:0o700});
 const lock=path.join(loc.dir,'lock'); let fd;
 try{fd=fs.openSync(lock,'wx',0o600);}catch{stop('session-busy-or-interrupted');}
 let state,targetState,before,attempt=false,recoveryObservations;
 try {
  state=read(loc.file);
  if(state.closed)stop('session-closed');
  if(state.schema!==1||state.repo!==loc.repo||state.demand!==demand)stop('state-identity-mismatch');
  const key=digest(target);
  targetState=state.targets[key] ||= {files:{},status:'ready'};
  const recovering=['writing','failed-or-unknown'].includes(targetState.status);
  if(decision?.action==='resume'&&!recovering)stop('decision-expired');
  if(recovering){
   const observations=[];
   for(const f of files)observations.push([f.remotePath,hash(await adapter.read(f)),hash(fs.readFileSync(f.localPath))]);
   const token=digest(JSON.stringify({repo:loc.repo,demand,key,base:state.base,observations,files:targetState.files}));
   if(decision?.action!=='resume'||decision.token!==token)stop('previous-result-unknown',{token});
   recoveryObservations=observations;
  }
  checkUpdates(repo);
  const names=new Set();
  for(const f of files) {
   f.localPath=fs.realpathSync(f.localPath);
   const rel=path.relative(loc.repo,f.localPath);
   if(rel.startsWith('..')||path.isAbsolute(rel))stop('file-outside-repository');
   if(names.has(f.remotePath))stop('duplicate-remote-target'); names.add(f.remotePath);
   f.relative=rel.split(path.sep).join('/');
  }
  // Detect known Git renames before treating an absent base as a new file.
  for(const ref of new Set([state.base,'HEAD'])){
   const changes=git(repo,['diff','--name-status','-z','--find-renames',ref,'--']).split('\0');
   for(let i=0;i<changes.length&&changes[i];){
    const kind=changes[i++],oldPath=changes[i++];
    if(kind.startsWith('R')||kind.startsWith('C')){const newPath=changes[i++];if(files.some(f=>f.relative===oldPath||f.relative===newPath))stop('local-delete-or-rename',{files:[oldPath,newPath]});}
   }
  }
  before=snapshot(repo,files);
  const prepared=[];let decisionApplied=false;
  for(const f of files) {
   const raw=await adapter.read(f), remote=text(raw), local=text(fs.readFileSync(f.localPath));
   if(recoveryObservations){const observed=recoveryObservations.find(x=>x[0]===f.remotePath);if(observed[1]!==hash(raw)||observed[2]!==hash(fs.readFileSync(f.localPath)))stop('recovery-confirmation-expired',{file:f.relative});}
   const base=baseline(repo,state.base,f.relative), previous=targetState.files[f.remotePath];
   const token=digest(JSON.stringify({repo:loc.repo,demand,base:state.base,local,remote,previous:previous||null,target:key,file:f.remotePath}));
   const allowed=decision?.token===token && ['merge','overwrite'].includes(decision.action)?decision.action:null;
   if(allowed)decisionApplied=true;
   targetState.pending={file:f.relative,token,base,local,remote};
   try {
    const selected=choose(base,local,remote,previous,allowed);
    validate(f.relative,selected.content,base,remote);
    prepared.push({...f,...selected,local,expected:hash(raw),skip:remote===selected.content,bytes:remote===selected.content?raw:selected.content===local?fs.readFileSync(f.localPath):Buffer.from(selected.content),token});
   }catch(e){if(e instanceof Attention)e.details={...e.details,file:f.relative,token,localHash:hash(local),remoteHash:hash(raw),base:state.base};throw e;}
  }
  if(['merge','overwrite'].includes(decision?.action)&&!decisionApplied)stop('decision-expired');
  // Preflight the complete batch before the first write.
  for(const f of prepared)if(hash(await adapter.read(f))!==f.expected)stop('remote-changed-before-upload',{file:f.relative});
  if(JSON.stringify(snapshot(repo,files))!==JSON.stringify(before))stop('local-source-changed');
  targetState.status='writing'; write(loc.file,state); attempt=true;
  for(const f of prepared) {
   if(hash(await adapter.read(f))!==f.expected)stop('remote-changed-before-upload',{file:f.relative});
   if(!f.skip)await adapter.put(f);
   if(text(await adapter.read(f))!==f.content)stop('readback-mismatch',{file:f.relative});
   // Persist each successful write; failure cannot silently reset merge history.
   targetState.files[f.remotePath]={local:f.local,deployed:f.content,merged:f.merged};
   write(loc.file,state);
  }
  await adapter.compile(prepared);
  for(const f of prepared)if(text(await adapter.read(f))!==f.content)stop('post-compile-source-changed',{file:f.relative});
  if(JSON.stringify(snapshot(repo,files))!==JSON.stringify(before))stop('local-source-changed');
  targetState.status='verified'; delete targetState.attention; delete targetState.pending; write(loc.file,state);
  return {status:'verified',files:prepared.map(f=>({file:f.relative,sha256:hash(f.bytes),merged:f.merged,status:f.skip?'unchanged':'uploaded'})),sourceUnchanged:true};
 }catch(e){
  let sourceUnchanged;
  if(before){try{sourceUnchanged=JSON.stringify(snapshot(repo,files))===JSON.stringify(before);}catch{sourceUnchanged=false;}}
  const result=needsInput(e instanceof Attention?e.reason:'transport-or-compile-failed',e instanceof Attention?e.details:{},{sourceUnchanged,partialOrUnknown:attempt,stateFile:loc.file});
  if(state&&targetState){targetState.status=attempt||['writing','failed-or-unknown'].includes(targetState.status)?'failed-or-unknown':'needs-user-input';targetState.attention=result;write(loc.file,state);}
  return result;
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
module.exports={Attention,stop,digest,hash,text,merge,choose,initialize,run,checkGit,validate,read,write,location};
if(require.main===module){
 const [command,repo,demand,base,confirmation]=process.argv.slice(2);
 try {
  if(['rebase','close'].includes(command)){console.log(JSON.stringify(maintain(command,repo,demand,base,confirmation)));process.exit(0);}
  if(command!=='init')stop('usage',{usage:'deploy-guard.js init <repo> <demand> [base-ref --confirm-baseline]'});
  console.log(JSON.stringify(initialize(repo,demand,base,confirmation==='--confirm-baseline')));
 }catch(e){console.log(JSON.stringify(needsInput(e.reason||'initialization-failed',e.details||{})));process.exitCode=1;}
}
