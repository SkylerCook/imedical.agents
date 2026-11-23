#!/usr/bin/env node
'use strict';
// Workspace/Git preflight only. Snapshot, packing and verification have one PowerShell implementation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const workspace = require('../../../../scripts/lib/workspace-context');
const development = require('../../../../scripts/lib/iris-remote-operations');
const HELP = 'source-delivery.js prepare|review|pack|verify|xml-unpack|xml-pack|xml-verify --project-root <workspace> (--source-directory <editable-root> | --export-directory <export-root>) --baseline-directory <ContextRoot/work/task/baseline> [--original-directory <incoming-root> --batch-id <batch> --scope-file <files.json>] [--input-xml <incoming.xml>] [--out <delivery-directory> --notes-file <notes.md>] [--kind standard|project] [--review-token <token> --reason <source review evidence> | --i18n-result passed|no-visible-impact --i18n-evidence <review finding>] [--allow-partial] [--powershell powershell.exe|pwsh.exe]\nLocal only. Scope JSON: {"files":["relative/source.cls"]}; XML scope uses objects/000001.xml. Prepare/Unpack binds a declared SourceRoot/GitRoot; Pack/Verify reuse the frozen scope. No Git commits, hospital connections or object creation/deletion/renaming. PowerShell implementation requires Windows.';
function fail(code) { throw new Error(code); }
function physical(file) {
  let probe=path.resolve(file);const suffix=[];
  while(!fs.existsSync(probe)){const parent=path.dirname(probe);if(parent===probe)fail('path-root-unavailable');suffix.unshift(path.basename(probe));probe=parent;}
  return path.join(fs.realpathSync.native(probe),...suffix);
}
function within(root, file) { const relative = path.relative(physical(root), physical(file)); return !relative || relative !== '..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative); }
function same(left,right) { return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right; }
function git(root, args, optional=false, raw=false) {
  const r=spawnSync('git',['--no-optional-locks','-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:64*1024*1024});
  if(r.status!==0){if(optional)return null;fail('source-git-check-failed');} return raw?r.stdout:r.stdout.trim();
}
function read(file) { return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')); }
function parse(argv) {
  const options={command:argv[0]};
  const names=new Set(['project-root','source-directory','export-directory','original-directory','batch-id','scope-file','baseline-directory','out','notes-file','current-source-directory','current-export-directory','powershell','input-xml','review-token','reason','kind','i18n-result','i18n-evidence']);
  for(let i=1;i<argv.length;i++){
    const key=argv[i].replace(/^--/,'');
    if(key==='allow-partial'){options.allowPartial=true;continue;}
    if(!argv[i].startsWith('--')||!names.has(key)||options[key]!==undefined||!argv[i+1]||argv[i+1].startsWith('--'))fail('source-delivery-arguments-invalid');
    options[key]=argv[++i];
  }
  if(!['prepare','review','pack','verify','xml-unpack','xml-pack','xml-verify'].includes(options.command)||!options['project-root']||!options['baseline-directory']||Boolean(options['source-directory'])===Boolean(options['export-directory']))fail('source-delivery-input-required');
  if(options.command.startsWith('xml-')&&(!options['source-directory']||options.allowPartial))fail('xml-delivery-arguments-invalid');
  if(['prepare','xml-unpack'].includes(options.command)&&!options['batch-id'])fail('source-input-batch-required');
  return options;
}
function preflight(options) {
  const context=workspace.resolveWorkspaceContext(path.resolve(options['project-root']));
  if(workspace.workspaceContextBlockers(context).length)fail('invalid-workspace-context');
  const mode=development.developmentMode(context);
  const supplied=options['source-directory']||options['export-directory'];
  const source=workspace.resolveSourceFilePath(context,path.resolve(context.workspaceRoot,supplied));
  const xml=options.command.startsWith('xml-'),initial=['prepare','xml-unpack'].includes(options.command);
  if(options.command!=='xml-unpack'&&!fs.statSync(source).isDirectory())fail('source-directory-required');
  const descriptor=workspace.resolveGitRootForPath(context,source),gitRoot=fs.realpathSync.native(descriptor.gitRoot);
  if(!same(fs.realpathSync.native(git(gitRoot,['rev-parse','--show-toplevel'])),gitRoot))fail('source-git-root-mismatch');
  const baseline=path.resolve(context.workspaceRoot,options['baseline-directory']);
  if(!within(path.join(context.contextRoot,'work'),baseline)||within(source,baseline))fail('baseline-must-be-private-task-directory');
  let scope;
  if(options['scope-file'])scope=read(path.resolve(context.workspaceRoot,options['scope-file'])).files;
  else if(options.command==='xml-unpack')scope=[];
  else if(xml){const inventory=read(path.join(baseline,'inventory.json'));scope=inventory.scopeFiles||inventory.objects.map(item=>item.file);}
  else scope=read(path.join(baseline,'manifest.json')).items.map(item=>item.path);
  if(!Array.isArray(scope)||(!scope.length&&options.command!=='xml-unpack')||new Set(scope).size!==scope.length)fail('source-scope-invalid');
  for(const relative of scope){
    if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>!part||part==='..'||part==='.'||['.git','.agents','.baseline'].includes(part.toLowerCase())))fail('source-scope-invalid');
    const file=workspace.resolveSourceFilePath(context,path.join(source,relative));
    if(!within(source,file)||!same(fs.realpathSync.native(workspace.resolveGitRootForPath(context,file).gitRoot),gitRoot))fail('source-scope-outside-repository');
    if(options.command==='prepare'&&!fs.existsSync(file))fail('source-add-delete-rename-unsupported');
  }
  const binding={workspaceRoot:fs.realpathSync.native(context.workspaceRoot),sourceRoot:fs.realpathSync.native(descriptor.target),gitRoot};
  const output=options.out ? path.resolve(context.workspaceRoot,options.out) : null;
  if(!initial&&options.command!=='review'&&(!output||!within(context.workspaceRoot,output)||within(context.contextRoot,output)||context.sourceRoots.some(root=>within(fs.realpathSync.native(root.target),output))))fail('source-delivery-output-required-outside-source');
  if(options['original-directory']&&within(source,path.resolve(context.workspaceRoot,options['original-directory'])))fail('manual-original-must-be-outside-editable-source');
  return {context,mode,source,gitRoot,baseline,scope,binding,output,xml};
}
// Capture original Git blobs only after the native helper verified/froze the input.
function captureGitBaseline(state) {
  const files=state.scope.map(file=>{
    const relative=path.relative(state.gitRoot,path.join(state.source,file)).split(path.sep).join('/');
    const original = path.join(state.xml ? state.source : state.baseline,file);
    return {path:file,relative,blob:git(state.gitRoot,['hash-object','--path='+relative,original])};
  });
  const initialHead = !state.xml && git(state.gitRoot,['rev-parse','--verify','HEAD'],true);
  const startCommit = initialHead && files.every(item => git(state.gitRoot,['rev-parse','--verify',initialHead+':'+item.relative],true) === item.blob) ? initialHead : null;
  fs.writeFileSync(path.join(state.baseline,'git-baseline.json'),JSON.stringify({schema:'iris-git-baseline/v1',gitRoot:state.gitRoot,demandKind:state.kind,startCommit,files},null,2)+'\n');
}
function requireGitBaseline(state) {
  const head=git(state.gitRoot,['rev-parse','--verify','HEAD'],true);
  if(!head)fail('source-git-baseline-missing: commit incoming originals before editing; do not commit modified files as baseline');
  const file=path.join(state.baseline,'git-baseline.json');
  if(!fs.existsSync(file))fail('source-git-baseline-record-missing: preserve existing work; re-establish originals in a separate task before migration');
  const record=read(file);
  if(record.schema!=='iris-git-baseline/v1'||!same(record.gitRoot,state.gitRoot)||JSON.stringify(record.files.map(x=>x.path))!==JSON.stringify(state.scope))fail('source-git-baseline-scope-mismatch');
  for(const item of record.files){
    const relative=path.relative(state.gitRoot,path.join(state.source,item.path)).split(path.sep).join('/');
    if(relative!==item.relative||!/^[0-9a-f]{40,64}$/.test(item.blob))fail('source-git-baseline-record-invalid');
    if(!git(state.gitRoot,['rev-parse','--verify',head+':'+relative],true))fail('source-git-baseline-untracked: '+relative);
  }
  if (record.startCommit) {
    if (!/^[a-f0-9]{40,64}$/.test(record.startCommit) ||
        git(state.gitRoot,['merge-base','--is-ancestor',record.startCommit,head],true) === null ||
        !record.files.every(item => git(state.gitRoot,['rev-parse','--verify',record.startCommit+':'+item.relative],true) === item.blob)) fail('source-git-original-baseline-drift');
    return record.startCommit;
  }
  const paths=record.files.map(x=>x.relative);
  const commits=[head,...git(state.gitRoot,['log','-1000','--format=%H',head,'--',...paths]).split(/\r?\n/).filter(Boolean)];
  for(const commit of new Set(commits)){
    if(record.files.every(item=>git(state.gitRoot,['rev-parse','--verify',commit+':'+item.relative],true)===item.blob))return commit;
  }
  fail('source-git-original-baseline-not-found: no common ancestor contains the frozen originals; preserve work and commit original versions only');
}
function main(argv=process.argv.slice(2)) {
  if(!argv.length||argv.includes('--help')){console.log(HELP);return 0;}
  const options=parse(argv),state=preflight(options);
  if(process.platform!=='win32')fail('source-delivery-windows-required');
  if (!state.xml && options.command !== 'verify') {
    const record = path.join(state.baseline,'git-baseline.json');
    if (options.command !== 'prepare' && !fs.existsSync(record)) fail('source-git-baseline-record-missing');
    const recorded = options.command !== 'prepare' && read(record).demandKind;
    if (recorded && options.kind && options.kind !== recorded) fail('demand-kind-drift');
    state.kind = require('./source-sync-core').demandKind(state.context,{kind:recorded || options.kind}).kind;
  }
  if (options.command === 'review') {
    const base = requireGitBaseline(state);
    const manifest = read(path.join(state.baseline,'manifest.json'));
    for (const item of manifest.items) {
      if (!state.scope.includes(item.path) || crypto.createHash('sha256').update(fs.readFileSync(path.join(state.baseline,item.path))).digest('hex') !== item.sha256) fail('original-baseline-drift');
    }
    const gate = require('./cls-delivery-gate');
    const review = gate.reviewFiles(state.source,state.baseline,state.scope);
    const receipt = gate.readReview(state.baseline,review.token);
    if (options.reason || options['i18n-result'] || options['i18n-evidence'] || options['review-token']) {
      if (options['review-token'] !== review.token) fail('source-review-binding-invalid');
      if (options.reason) {
        if (!review.manual.length || !options.reason.trim()) fail('source-review-conclusion-invalid');
        receipt.sourceReview = options.reason.trim();
      }
      if (options['i18n-result'] || options['i18n-evidence']) {
        if (state.kind !== 'standard' || !['passed','no-visible-impact'].includes(options['i18n-result']) || !options['i18n-evidence']?.trim()) fail('i18n-review-conclusion-invalid');
        receipt.i18n = {result:options['i18n-result'],evidence:options['i18n-evidence'].trim()};
      }
      const file = path.join(state.baseline,'source-review.json');
      const temporary = file+'.'+crypto.randomUUID()+'.tmp';
      try {
        fs.writeFileSync(temporary,JSON.stringify(receipt),{flag:'wx'});
        fs.renameSync(temporary,file);
      } finally { fs.rmSync(temporary,{force:true}); }
    }
    const pending = gate.reviewRequirements(review,state.kind,receipt);
    console.log(JSON.stringify({base,status:pending.length?'review-required':'passed',pending,...review}));
    return pending.length ? 1 : 0;
  }
  const shell=options.powershell||'powershell.exe';
  if(!['powershell.exe','pwsh.exe'].includes(shell))fail('source-delivery-powershell-invalid');
  const quote=value=>"'"+String(value).replace(/'/g,"''")+"'";
  const operation=options.command.replace(/^xml-/, '');
  const gitBaselineCommit=['pack','verify'].includes(operation)?requireGitBaseline(state):null;
  if(operation==='verify'){
    const receipt=read(path.join(state.output,'manifest.json'));
    const files=receipt.localEvidence?.files;
    if(!Array.isArray(files)||JSON.stringify(files.map(x=>x.path))!==JSON.stringify(state.scope))fail('delivery-source-evidence-invalid');
    for(const item of files){
      const file=path.join(state.source,item.path);
      if(!fs.existsSync(file)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==item.sha256)fail('delivery-source-drift: '+item.path);
    }
  }
  const parameters=['-Mode',quote(operation[0].toUpperCase()+operation.slice(1)),state.xml?'-WorkDirectory':options['source-directory']?'-SourceDirectory':'-ExportDirectory',quote(state.source),'-BaselineDirectory',quote(state.baseline),'-WorkspaceBinding',quote(Buffer.from(JSON.stringify(state.binding)).toString('base64'))];
  for(const [key,name] of [['original-directory','OriginalDirectory'],['scope-file','ScopeFile'],['notes-file','NotesFile'],['current-source-directory','CurrentSourceDirectory'],['current-export-directory','CurrentExportDirectory']])if(options[key])parameters.push('-'+name,quote(path.resolve(state.context.workspaceRoot,options[key])));
  if(options['batch-id'])parameters.push('-BatchId',quote(options['batch-id']));
  if(state.output)parameters.push('-OutputDirectory',quote(state.output));
  if(options.allowPartial)parameters.push('-AllowPartial');
  if(options['input-xml'])parameters.push('-InputXml',quote(path.resolve(state.context.workspaceRoot,options['input-xml'])));
  if(operation==='pack'){
    const relative=state.scope.map(file=>path.relative(state.gitRoot,path.join(state.source,file)));
    const gitHead=git(state.gitRoot,['rev-parse','--verify','HEAD'],true);
    const evidence={demandKind:state.kind,gitBaselineCommit,schema:'iris-local-delivery-evidence/v1',gitHead,
      gitStatus:git(state.gitRoot,['status','--porcelain=v1','--untracked-files=all','--',...relative],false,true),
      gitDiffSha256:crypto.createHash('sha256').update(git(state.gitRoot,['diff','--no-ext-diff','--binary',...(gitHead?['HEAD']:[]),'--',...relative],false,true)).digest('hex'),
      files:state.scope.map(file=>({path:file,sha256:fs.existsSync(path.join(state.source,file))?crypto.createHash('sha256').update(fs.readFileSync(path.join(state.source,file))).digest('hex'):null})),
      reviewAndLocalChecks:'see-change-notes',hospitalAcceptance:'pending'};
    parameters.push('-WorkspaceEvidence',quote(Buffer.from(JSON.stringify(evidence)).toString('base64')));
  }
  const script=path.join(__dirname,state.xml?'edit-export-xml.ps1':'source-delivery.ps1');
  const command="[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); & "+quote(script)+' '+parameters.join(' ')+'; if (-not $?) { exit 1 }';
  const env={...process.env};if(shell==='powershell.exe')env.PSModulePath=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules');
  const result=spawnSync(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
  if(result.error||result.status!==0)fail(result.stderr.trim()||'source-delivery-helper-failed');
  const value=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
  if(options.command==='xml-unpack')state.scope=read(path.join(state.baseline,'inventory.json')).scopeFiles;
  if(['prepare','unpack'].includes(operation))captureGitBaseline(state);
  let gitBaselineReady=true,gitBaselineReason=null;
  try { requireGitBaseline(state); } catch(error) { gitBaselineReady=false;gitBaselineReason=error.message; }
  console.log(JSON.stringify({...value,gitBaselineReady,gitBaselineReason,developmentMode:state.mode,gitRoot:state.gitRoot,gitHead:git(state.gitRoot,['rev-parse','--verify','HEAD'],true),gitStatus:git(state.gitRoot,['status','--porcelain=v1','--untracked-files=all','--',...state.scope.map(file=>path.relative(state.gitRoot,path.join(state.source,file)))])}));
  return 0;
}
if(require.main===module){try{process.exitCode=main();}catch(error){console.error(JSON.stringify({status:'blocked',reason:error.message}));process.exitCode=1;}}
module.exports={main,preflight,parse,captureGitBaseline,requireGitBaseline};
