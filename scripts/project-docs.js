#!/usr/bin/env node
'use strict';
// Setup, adoption and migration use exact reviewed plans; updates maintain owned sections only.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const d = require('./lib/project-directories');
const nav = require('./lib/project-docs-navigation');
const PLAN = 'imedical-project-docs-plan/v1', JOURNAL = 'imedical-project-docs-backup/v1';
const text = bytes => new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes);
function fileHash(file) { return fs.existsSync(file) ? d.digest(fs.readFileSync(file)) : null; }
function physicalDirectory(file) {
  let current = path.resolve(file);
  for (;;) {
    if (fs.existsSync(current)) {
      const st = fs.lstatSync(current);
      if (!st.isDirectory() || st.isSymbolicLink()) throw Error('Backup root must be a physical directory: ' + current);
    }
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
function target(context, rel) {
  const file = d.safePath(context.workspaceRoot,rel);
  const docs = path.join(context.workspaceRoot,'docs'), work = path.join(context.contextRoot,'work');
  const config = path.join(context.contextRoot,'config/documentation-layout.json');
  if (!(d.within(file,docs) || d.within(file,work) || d.same(file,config) || ['AGENTS.md','README.md'].includes(rel))) throw Error('Unmanaged write target: ' + rel);
  let cursor = path.dirname(file);
  while (d.within(cursor,docs)) {
    if (fs.existsSync(path.join(cursor,'.git'))) throw Error('Nested Git workspace preserved: ' + cursor);
    if (d.same(cursor,docs)) break; cursor=path.dirname(cursor);
  }
  return file;
}
function rel(context,file) { return d.slash(path.relative(context.workspaceRoot,file)); }
function protectedPath(file) { return /(?:^|\/)(?:\.git|private|agent-reports|handoff|acceptance)(?:\/|$)/i.test(file) || /^docs\/(?:work|archive)(?:\/|$)/i.test(file); }
function entriesFor(context, extensions=d.configFor(context)?.extensions || []) { return nav.catalog(context,extensions); }
function documentation(context, entries, adopt=false) {
  return [...nav.descriptions(context,entries)].map(([file,body])=>{
    const absolute=target(context,file);
    if(fs.existsSync(absolute)&&!fs.statSync(absolute).isFile())throw Error('File conflict: '+file);
    const before=fs.existsSync(absolute)?fs.readFileSync(absolute):null;
    return {path:file,beforeHash:before===null?null:d.digest(before),...nav.section(before,body,file,adopt)};
  });
}
function addDocumentation(plan,context,entries) {
  if(entries.some(e=>!e.purpose))throw Error('Directory purpose missing in owner projectDirectories; fill the source declaration first');
  for(const doc of documentation(context,entries,true))if(doc.state!=='current'){
    const op=action(context,'write',doc.path,doc.content);
    if(op.beforeHash!==doc.beforeHash)throw Error('File changed during planning: '+doc.path);
    plan.actions.push(op);
  }
}
function action(context, kind, file, content) {
  const absolute = target(context,file);
  if (kind==='mkdir') {
    if (fs.existsSync(absolute) && !fs.statSync(absolute).isDirectory()) throw Error('Directory conflict: ' + file);
    return {kind,path:file};
  }
  if (fs.existsSync(absolute) && !fs.statSync(absolute).isFile()) throw Error('File conflict: ' + file);
  return {kind,path:file,beforeHash:fileHash(absolute),...(kind==='write'?{content:Buffer.from(content).toString('base64')}: {})};
}
function seal(plan) {
  const state=new Map();
  for(const op of plan.actions){
    let dir=op.kind==='mkdir'?op.path:path.posix.dirname(op.path);
    while(dir!=='.'){
      const absolute=path.resolve(plan.workspaceRoot,dir);
      if(fs.existsSync(absolute)&&!fs.lstatSync(absolute).isDirectory())throw Error('Directory conflict: '+dir);
      state.set(dir,fs.existsSync(absolute));dir=path.posix.dirname(dir);
    }
  }
  plan.directories=[...state].sort(([a],[b])=>a.localeCompare(b)).map(([path,existed])=>({path,existed}));
  return {...plan,id:d.digest(JSON.stringify(plan))};
}
function base(context,kind) { return {schema:PLAN,kind,workspaceRoot:context.workspaceRoot,contextRoot:context.contextRoot,policyHash:d.fingerprint(context),actions:[],skipped:[]}; }
function setupPlan(root) {
  const context=d.contextFor(root), existing=d.configFor(context);
  if (existing?.enabled) throw Error('Layout already enrolled; use extension-plan or migration plan');
  const entries=entriesFor(context), plan=base(context,'setup');
  for(const e of entries.filter(e=>e.create==='setup')) plan.actions.push(action(context,'mkdir',rel(context,e.target)));
  const config={schema:d.SCHEMA,enabled:true,workspaceRoot:context.workspaceRoot,extensions:[]};
  plan.actions.push(action(context,'write',rel(context,path.join(context.contextRoot,'config/documentation-layout.json')),JSON.stringify(config,null,2)+'\n'));
  addDocumentation(plan,context,entries);
  const agents=path.join(context.workspaceRoot,'AGENTS.md');
  if (fs.existsSync(agents)) {
    d.safePath(context.workspaceRoot,'AGENTS.md'); const before=fs.readFileSync(agents); const contents=text(before);
    const {activeText}=require('./sync-documentation-entry');
    if (!/(?:\.?\/?docs[\\/]README\.md)/.test(activeText(contents))) {
      const newline=contents.includes('\r\n')?'\r\n':'\n';
      const route='- 查找、新建或整理项目资料时，先读 [项目知识库](docs/README.md)，按用途和专题进入；目录治理与迁移按能力包 `docs/guides/project-knowledge-layout.md` 执行。';
      if (!activeText(contents+newline+route).includes(route)) throw Error('Unclosed Markdown in AGENTS.md; preserve and repair first');
      plan.actions.push(action(context,'write','AGENTS.md',Buffer.concat([before,Buffer.from((contents.endsWith('\n')?newline:newline+newline)+route+newline)])));
    }
  }
  return seal(plan);
}
function extensionPlan(root, entry) {
  const context=d.contextFor(root), config=d.configFor(context);
  if (!config?.enabled) throw Error('Explicit initial setup required');
  if (!entry || typeof entry.purpose!=='string' || !entry.purpose.trim() || /[\r\n]/.test(entry.purpose) || !entry.path.startsWith('docs/')) throw Error('Extension needs docs path and purpose');
  d.description(entry);
  d.safePath(context.workspaceRoot,entry.path);
  if (config.extensions.some(e=>e.path===entry.path)) throw Error('Extension already registered');
  const plan=base(context,'extension');
  plan.actions.push(action(context,'mkdir',entry.path));
  plan.actions.push(action(context,'write',rel(context,path.join(context.contextRoot,'config/documentation-layout.json')),JSON.stringify({...config,extensions:[...config.extensions,entry]},null,2)+'\n'));
  addDocumentation(plan,context,entriesFor(context,[...config.extensions,entry]));
  return seal(plan);
}
function navigationPlan(root) {
  const context=d.contextFor(root);
  if(!d.configFor(context)?.enabled)throw Error('Explicit initial setup required');
  const entries=entriesFor(context),plan=base(context,'navigation');
  for(const e of entries.filter(e=>e.create==='setup'))plan.actions.push(action(context,'mkdir',rel(context,e.target)));
  addDocumentation(plan,context,entries);
  return seal(plan);
}
function walk(context, directory, skipped=[], files=[]) {
  const relative=rel(context,directory); d.safePath(context.workspaceRoot,relative);
  if (fs.existsSync(path.join(directory,'.git'))) throw Error('Nested Git workspace preserved: ' + relative);
  for (const name of fs.readdirSync(directory).sort()) {
    const file=path.join(directory,name), logical=rel(context,file); const st=fs.lstatSync(file);
    if (st.isSymbolicLink() || (st.isFile() && st.nlink!==1) || (!st.isDirectory() && !st.isFile())) throw Error('Linked or special file preserved: '+logical);
    if (st.isDirectory()) walk(context,file,skipped,files); else files.push(logical);
  }
  return files;
}
function rewriteLinks(bytes, oldFile, newFile, moves) {
  const contents=text(bytes), protectedText=[];
  const hold=value=>{const token='\u0000DOCS'+protectedText.length+'\u0000';protectedText.push(value);return token;};
  const restore=value=>value.replace(/\u0000DOCS(\d+)\u0000/g,(_,n)=>protectedText[Number(n)]);
  const moveUrl=destination=>{
    const angle=destination.startsWith('<'),url=angle?destination.slice(1,-1):destination;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(url)) return destination;
    const m=url.match(/^([^?#]*)([?#].*)?$/); if (!m[1]) return destination;
    let decoded; try { decoded=decodeURIComponent(m[1]); } catch { throw Error('Malformed local link in '+oldFile); }
    const absolute=path.posix.normalize(path.posix.join(path.posix.dirname(oldFile),decoded));
    if (absolute==='..' || absolute.startsWith('../')) return destination;
    let moved=moves.get(absolute);
    if(!moved){const prefix=[...moves.keys()].filter(key=>absolute.startsWith(key+'/')).sort((a,b)=>b.length-a.length)[0];moved=prefix?moves.get(prefix)+absolute.slice(prefix.length):absolute;}
    if(moved===absolute && oldFile===newFile)return destination;
    let replacement=path.posix.relative(path.posix.dirname(newFile),moved)||'.';
    if(m[1].endsWith('/'))replacement+='/';
    replacement=encodeURI(replacement).replaceAll('#','%23').replaceAll('?','%3F')+(m[2]||'');
    return angle?'<'+replacement+'>':replacement;
  };
  let fence=null;
  const output=contents.replace(/<!--[\s\S]*?(?:-->|$)/g,hold).split(/(\r?\n)/).map(line=>{
    if(/^\r?\n$/.test(line))return line;
    const match=line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if(match){if(!fence)fence=match[1];else if(match[1][0]===fence[0]&&match[1].length>=fence.length&&!match[2].trim())fence=null;return line;}
    if(fence||/^(?: {4}|\t)/.test(line))return line;
    let safe=line.replace(/(`+)(.*?)\1/g,hold);
    safe=safe.replace(/(!?\[[^\]\r\n]*\]\()(<[^>\r\n]+>|[^\s)]+)([^)\r\n]*\))/g,(_,open,url,tail)=>open+moveUrl(url)+tail);
    safe=safe.replace(/^(\s{0,3}\[[^\]\r\n]+\]:\s*)(<[^>\r\n]+>|[^\s]+)(.*)$/,(all,open,url,tail)=>open+moveUrl(url)+tail);
    return safe;
  }).join('');
  return Buffer.from(restore(output));
}
function migrationPlan(root, mapping) {
  const context=d.contextFor(root); if (!d.configFor(context)?.enabled) throw Error('Explicit initial setup required');
  if (!mapping || !Array.isArray(mapping.moves) || !mapping.moves.length) throw Error('Mapping must contain moves');
  const plan=base(context,'migration'), moves=new Map(), directoryMoves=[];
  for (const m of mapping.moves) {
    if (!m || !m.from?.startsWith('docs/') || !m.to?.startsWith('docs/') || protectedPath(m.from) || protectedPath(m.to)) throw Error('Protected/runtime/history paths require their owner migration; generic migration handles live docs only');
    const source=target(context,m.from), destination=target(context,m.to);
    if (d.same(source,destination) || d.within(destination,source)) throw Error('Overlapping source and destination');
    if (fs.existsSync(destination)) throw Error('Destination exists; preserve and review: '+m.to);
    const st=fs.lstatSync(source);
    const files=st.isDirectory()?walk(context,source):[m.from];
    if (st.isDirectory()) {
      const collect=dir=>{const logical=rel(context,dir),to=m.to+logical.slice(m.from.length);directoryMoves.push([logical,to]);plan.actions.push(action(context,'mkdir',to));
        for(const e of fs.readdirSync(dir,{withFileTypes:true}))if(e.isDirectory())collect(path.join(dir,e.name));};
      collect(source);
    }
    for (const old of files) {
      if (protectedPath(old) || moves.has(old)) throw Error('Protected or duplicate source: '+old);
      moves.set(old,m.to+(st.isDirectory()?old.slice(m.from.length):''));
    }
  }
  const destinations=new Set();
  for (const [old,to] of moves) {
    target(context,old); target(context,to);
    if (destinations.has(to.toLowerCase()) || moves.has(to) || fs.existsSync(target(context,to))) throw Error('Migration collision: '+to);
    destinations.add(to.toLowerCase());
  }
  const links=new Map([...directoryMoves,...moves]);
  for (const [old,to] of moves) {
    const bytes=fs.readFileSync(target(context,old));
    plan.actions.push(action(context,'write',to,old.endsWith('.md')?rewriteLinks(bytes,old,to,links):bytes));
    plan.actions.push(action(context,'delete',old));
  }
  for (const file of mapping.references || []) {
    if (moves.has(file)) continue;
    if (protectedPath(file) || !file.endsWith('.md')) throw Error('Only explicitly reviewed live Markdown references may be edited: '+file);
    const source=target(context,file), before=fs.readFileSync(source), after=rewriteLinks(before,file,file,links);
    if (!after.equals(before)) plan.actions.push(action(context,'write',file,after));
  }
  plan.moves=[...moves].map(([from,to])=>({from,to}));
  plan.directoryContents=directoryMoves.map(([from])=>({path:from,entries:fs.readdirSync(target(context,from)).sort()}));
  plan.sourceDirectories=directoryMoves.map(([from])=>from); // Old empty directories remain; no unplanned recursive deletion.
  return seal(plan);
}
function checkPlan(root,plan,approval) {
  const context=d.contextFor(root); const {id,...body}=plan;
  if (plan.schema!==PLAN || !['setup','extension','navigation','migration'].includes(plan.kind) || !d.same(plan.workspaceRoot,context.workspaceRoot) || !d.same(plan.contextRoot,context.contextRoot) || id!==d.digest(JSON.stringify(body)) || approval!==id) throw Error('Exact reviewed plan approval required');
  if (plan.policyHash!==d.fingerprint(context)) throw Error('Layout policy changed; regenerate plan');
  for(const entry of plan.directories || []){const dir=d.safePath(context.workspaceRoot,entry.path);if(fs.existsSync(dir)!==entry.existed)throw Error('Directory changed since review: '+entry.path);}
  for(const entry of plan.directoryContents || []){const file=target(context,entry.path);if(JSON.stringify(fs.readdirSync(file).sort())!==JSON.stringify(entry.entries))throw Error('Directory contents changed since review: '+entry.path);}
  const seen=new Set();
  for (const op of plan.actions) {
    const file=target(context,op.path);
    if (seen.has(op.path.toLowerCase())) throw Error('Duplicate plan target'); seen.add(op.path.toLowerCase());
    if (op.kind==='mkdir') { if (fs.existsSync(file) && !fs.statSync(file).isDirectory()) throw Error('Directory conflict'); continue; }
    if (!['write','delete'].includes(op.kind) || (op.kind==='write' && typeof op.content!=='string')) throw Error('Invalid action');
    if (fileHash(file)!==op.beforeHash) throw Error('File changed since review: '+op.path);
  }
  return context;
}
function saveJournal(file,journal) {
  const temp=file+'.'+randomUUID()+'.tmp';
  try { fs.writeFileSync(temp,JSON.stringify(journal,null,2)+'\n',{flag:'wx',mode:0o600}); fs.renameSync(temp,file); }
  finally {if(fs.existsSync(temp)) fs.unlinkSync(temp);}
}
function mkdirRecorded(context, directory, journal, journalFile) {
  if (fs.existsSync(directory)) { if(!fs.statSync(directory).isDirectory()) throw Error('Directory conflict'); return; }
  const parent=path.dirname(directory);
  if (!d.same(parent,context.workspaceRoot)) mkdirRecorded(context,parent,journal,journalFile);
  const logical=rel(context,directory); d.safePath(context.workspaceRoot,logical);
  if(!journal.plannedDirectories.includes(logical))throw Error('Unplanned directory creation: '+logical);
  journal.createdDirectories.push(logical); saveJournal(journalFile,journal); fs.mkdirSync(directory);
}
function writeChecked(context,op,journal,journalFile) {
  const file=target(context,op.path);
  if (fileHash(file)!==op.beforeHash) throw Error('Concurrent change: '+op.path);
  if (op.kind==='delete') {fs.unlinkSync(file);return;}
  mkdirRecorded(context,path.dirname(file),journal,journalFile);
  const bytes=Buffer.from(op.content,'base64');
  if (op.beforeHash===null) fs.writeFileSync(file,bytes,{flag:'wx'});
  else {
    const temp=file+'.docs-layout-'+randomUUID()+'.tmp';
    try {fs.writeFileSync(temp,bytes,{flag:'wx',mode:fs.statSync(file).mode}); if(fileHash(file)!==op.beforeHash)throw Error('Concurrent change: '+op.path); fs.renameSync(temp,file);}
    finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  if (fileHash(file)!==d.digest(bytes)) throw Error('Write read-back mismatch');
}
function restoreJournal(context,journal,journalFile) {
  // Preflight the whole rollback before restoring any file. Unchanged operations may not have run before interruption.
  for (const op of journal.files) {
    const current=fileHash(target(context,op.path));
    if(current!==op.beforeHash && current!==op.afterHash)throw Error('Concurrent content preserved; manual recovery required: '+op.path);
  }
  for (const op of [...journal.files].reverse()) {
    const file=target(context,op.path), current=fileHash(file);
    if (current===op.beforeHash) continue;
    if (current!==op.afterHash) throw Error('Concurrent content preserved; manual recovery required: '+op.path);
    if(op.beforeHash===null) fs.unlinkSync(file);
    else {const backup=path.join(path.dirname(journalFile),op.backup); const bytes=fs.readFileSync(backup); if(d.digest(bytes)!==op.beforeHash)throw Error('Backup checksum mismatch'); fs.writeFileSync(file,bytes,{flag:current===null?'wx':'w'});}
  }
  for(const dir of [...journal.createdDirectories].reverse()) {const file=target(context,dir); if(fs.existsSync(file) && fs.readdirSync(file).length===0)fs.rmdirSync(file);}
  journal.state='rolled-back'; saveJournal(journalFile,journal);
}
function applyPlan(root,plan,approval,backupRoot) {
  const context=checkPlan(root,plan,approval);
  if(!backupRoot) throw Error('Explicit backup root outside WorkspaceRoot and CapabilityRoot required');
  backupRoot=path.resolve(backupRoot); physicalDirectory(backupRoot);
  if(d.within(backupRoot,context.workspaceRoot) || d.within(backupRoot,context.capabilityRoot) || d.within(context.workspaceRoot,backupRoot) || d.within(context.capabilityRoot,backupRoot)) throw Error('Backup root must be separate from workspace/capability roots');
  const batch=path.join(backupRoot,plan.id.slice(0,16)+'-'+randomUUID()); fs.mkdirSync(batch,{recursive:true});
  const journalFile=path.join(batch,'journal.json');
  const journal={schema:JOURNAL,workspaceRoot:context.workspaceRoot,planId:plan.id,state:'prepared',createdDirectories:[],plannedDirectories:(plan.directories||[]).filter(e=>!e.existed).map(e=>e.path),files:[]};
  try {
  for(const [index,op] of plan.actions.entries()) if(op.kind!=='mkdir') {
    const backup=op.beforeHash===null?null:'file-'+index+'.bin';
    if(backup){const bytes=fs.readFileSync(target(context,op.path)); if(d.digest(bytes)!==op.beforeHash)throw Error('Concurrent change before backup'); fs.writeFileSync(path.join(batch,backup),bytes,{flag:'wx',mode:0o600}); if(fileHash(path.join(batch,backup))!==op.beforeHash)throw Error('Backup read-back mismatch');}
    journal.files.push({path:op.path,beforeHash:op.beforeHash,afterHash:op.kind==='write'?d.digest(Buffer.from(op.content,'base64')):null,backup});
  }
  saveJournal(journalFile,journal); fs.writeFileSync(path.join(batch,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  } catch(error) {
    const owned=new Set(['journal.json','plan.json',...plan.actions.map((op,index)=>op.kind!=='mkdir'&&op.beforeHash!==null?'file-'+index+'.bin':null).filter(Boolean)]);
    for(const name of fs.readdirSync(batch)){const file=path.join(batch,name),st=fs.lstatSync(file);if(!owned.has(name)||!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error(error.message+'; incomplete backup preserved: '+batch);}
    for(const name of fs.readdirSync(batch))fs.unlinkSync(path.join(batch,name));
    fs.rmdirSync(batch);throw error;
  }
  try {
    checkPlan(root,plan,approval);
    journal.state='applying'; saveJournal(journalFile,journal);
    for(const op of plan.actions) {if(op.kind==='mkdir')mkdirRecorded(context,target(context,op.path),journal,journalFile);else writeChecked(context,op,journal,journalFile);}
    journal.state='applied';saveJournal(journalFile,journal);
  } catch(error) {
    try {restoreJournal(context,journal,journalFile);} catch(recovery) {error.message+='; '+recovery.message;}
    error.message+='; recovery journal: '+journalFile;throw error;
  }
  return {status:'docs-layout-applied',planId:plan.id,journal:journalFile};
}
function validateJournal(context,journalFile,approval,states) {
  if(path.basename(journalFile)!=='journal.json')throw Error('Expected journal.json');
  physicalDirectory(path.dirname(journalFile));
  const readRegular=file=>{const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error('Linked or special backup preserved');return d.json(file);};
  const journal=readRegular(journalFile),plan=readRegular(path.join(path.dirname(journalFile),'plan.json'));
  const {id,...body}=plan;
  if(plan.schema!==PLAN || id!==d.digest(JSON.stringify(body)) || id!==approval || journal.schema!==JOURNAL || journal.planId!==id || !d.same(journal.workspaceRoot,context.workspaceRoot) || !d.same(plan.workspaceRoot,context.workspaceRoot) || !d.same(plan.contextRoot,context.contextRoot) || !states.includes(journal.state))throw Error('Exact batch approval and original plan required');
  const expected=plan.actions.flatMap((op,index)=>op.kind==='mkdir'?[]:[{path:op.path,beforeHash:op.beforeHash,afterHash:op.kind==='write'?d.digest(Buffer.from(op.content,'base64')):null,backup:op.beforeHash===null?null:'file-'+index+'.bin'}]);
  if(JSON.stringify(journal.files)!==JSON.stringify(expected))throw Error('Recovery journal differs from approved actions');
  const planned=(plan.directories||[]).filter(e=>!e.existed).map(e=>e.path);
  if(JSON.stringify(journal.plannedDirectories)!==JSON.stringify(planned)||!Array.isArray(journal.createdDirectories)||new Set(journal.createdDirectories).size!==journal.createdDirectories.length||journal.createdDirectories.some(dir=>!planned.includes(dir)))throw Error('Unapproved recovery directory');
  for(const op of journal.files){
    target(context,op.path);
    if(op.backup){const file=path.join(path.dirname(journalFile),op.backup),st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||fileHash(file)!==op.beforeHash)throw Error('Backup checksum/type mismatch');}
  }
  return journal;
}
function rollback(root,journalFile,approval) {
  const context=d.contextFor(root),journal=validateJournal(context,journalFile,approval,['prepared','applying','failed','applied']);
  restoreJournal(context,journal,journalFile);return {status:'docs-layout-rolled-back',journal:journalFile};
}
function cleanup(root,journalFile,acceptance) {
  const context=d.contextFor(root);
  let journal;try{journal=validateJournal(context,journalFile,acceptance,['applied','rolled-back']);}catch(error){throw Error('User acceptance of intact batch required: '+error.message);}
  const expected=new Set(['journal.json','plan.json',...journal.files.map(f=>f.backup).filter(Boolean)]),batch=path.dirname(journalFile);
  if(d.within(batch,context.workspaceRoot) || d.within(batch,context.capabilityRoot))throw Error('Backup cleanup cannot target workspace');
  for(const name of fs.readdirSync(batch)){const f=path.join(batch,name),st=fs.lstatSync(f); if(!expected.has(name)||!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error('Unexpected backup content preserved: '+name);}
  for(const name of fs.readdirSync(batch))fs.unlinkSync(path.join(batch,name));fs.rmdirSync(batch);
  return {status:'docs-layout-backup-cleaned',planId:journal.planId};
}
function update(root,mode='DryRun') {
  const result={target:'docs',status:'docs-layout-review-required',reason:'',missingDirectories:[],unclassified:[],documentationChanges:[],applied:[],checkedScope:'Declared directory existence, managed descriptions and generated navigation only; no per-file classification or business acceptance'};
  try {
    if(!['DryRun','Check','Write'].includes(mode))throw Error('Invalid mode');
    const context=d.contextFor(root),config=d.configFor(context);
    if(!config?.enabled)return {...result,status:'docs-layout-setup-required',reason:'Explicit first-deployment authorization required; run setup-plan'};
    const entries=entriesFor(context),policy=d.fingerprint(context);
    for(const e of entries.filter(e=>e.create==='setup')){const file=target(context,rel(context,e.target));if(fs.existsSync(file)&&!fs.statSync(file).isDirectory())throw Error('Directory conflict: '+e.path);if(!fs.existsSync(file))result.missingDirectories.push(rel(context,file));}
    const changes=documentation(context,entries).filter(e=>e.state!=='current');
    result.documentationChanges=changes.map(({path,state,beforeHash,before,after})=>({path,state,beforeHash,before,after}));
    result.descriptionSourcesMissing=entries.filter(e=>!e.purpose).map(e=>({owner:e.owner,path:e.path}));
    if(result.descriptionSourcesMissing.length)return {...result,reason:'Directory purpose missing in owner projectDirectories; fill the source declaration before updating descriptions'};
    const docs=path.join(context.workspaceRoot,'docs');
    if(fs.existsSync(docs)) {
      d.safePath(context.workspaceRoot,'docs');
      const known=new Set(entries.filter(e=>e.base==='workspace').map(e=>e.path.split('/')[1]));
      for(const entry of d.inventory(context))for(const legacy of entry.legacyPaths||[])if(legacy.startsWith('docs/'))known.add(legacy.split('/')[1]);
      result.unclassified=fs.readdirSync(docs,{withFileTypes:true}).filter(e=>e.name!=='README.md'&&!known.has(e.name)).map(e=>'docs/'+e.name);
    }
    if(changes.some(e=>!e.writable))return {...result,reason:'Unmanaged README preserved; review navigation-plan and apply its exact digest before ordinary Write can maintain sections'};
    const status=result.missingDirectories.length?'docs-layout-directories-missing':changes.some(e=>e.state==='missing')?'docs-layout-descriptions-missing':changes.length?'docs-layout-descriptions-stale':'docs-layout-ok';
    if(mode==='Write'){
      if(policy!==d.fingerprint(context))throw Error('Layout policy changed; retry after review');
      // All targets were preflighted. Recheck each write, including newly introduced files.
      for(const directory of result.missingDirectories){const file=target(context,directory);fs.mkdirSync(file,{recursive:true});}
      for(const op of changes){
        const file=target(context,op.path);
        if(fileHash(file)!==op.beforeHash)throw Error('Concurrent content preserved: '+op.path);
        fs.mkdirSync(path.dirname(file),{recursive:true});
        if(op.beforeHash===null)fs.writeFileSync(file,op.content,{flag:'wx'});
        else{
          const temp=file+'.docs-layout-'+randomUUID()+'.tmp';
          try{
            fs.writeFileSync(temp,op.content,{flag:'wx',mode:fs.statSync(file).mode});
            target(context,op.path);
            if(fileHash(file)!==op.beforeHash)throw Error('Concurrent content preserved: '+op.path);
            fs.renameSync(temp,file);
          }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
        }
        if(fileHash(file)!==d.digest(op.content))throw Error('Write read-back mismatch: '+op.path);
        result.applied.push(op.path);
      }
    }
    return {...result,status:mode==='Write'&&status!=='docs-layout-ok'?'docs-layout-updated':status,reason:'Checked directory structure and managed descriptions; project prose preserved. '+(result.unclassified.length?'Top-level unclassified entries need review; ':'')+'No per-file classification, migration or cleanup performed'};
  }catch(error){return {...result,reason:error.message};}
}
function cli(argv) {
  const command=argv.shift(),args={};
  while(argv.length){const key=argv.shift();if(!key.startsWith('--')||!argv.length||argv[0].startsWith('--'))throw Error('Expected --key value');if(Object.hasOwn(args,key))throw Error('Duplicate option');args[key]=argv.shift();}
  const allowed={inventory:['--project-root'],resolve:['--project-root','--owner','--id','--fallback'],update:['--project-root','--mode'],'setup-plan':['--project-root'],'navigation-plan':['--project-root'],'extension-plan':['--project-root','--path','--purpose'],plan:['--project-root','--mapping'],apply:['--project-root','--plan','--approve-plan','--backup-root'],rollback:['--project-root','--journal','--approve-plan'],cleanup:['--project-root','--journal','--accept-batch']};
  if(!allowed[command]||Object.keys(args).some(k=>!allowed[command].includes(k)))throw Error('Usage: project-docs.js inventory|resolve|update|setup-plan|navigation-plan|extension-plan|plan|apply|rollback|cleanup --project-root PATH ...');
  if(!args['--project-root'])throw Error('--project-root required');const root=args['--project-root'];
  if(command==='inventory')return {directories:d.inventory(d.contextFor(root),true)};
  if(command==='resolve')return {path:d.resolveDirectory(root,args['--owner'],args['--id'],args['--fallback'])};
  if(command==='update')return update(root,args['--mode']||'DryRun');
  if(command==='setup-plan')return setupPlan(root);
  if(command==='navigation-plan')return navigationPlan(root);
  if(command==='extension-plan')return extensionPlan(root,{path:args['--path'],purpose:args['--purpose']});
  if(command==='plan')return migrationPlan(root,d.json(args['--mapping']));
  if(command==='apply')return applyPlan(root,d.json(args['--plan']),args['--approve-plan'],args['--backup-root']);
  if(command==='rollback')return rollback(root,args['--journal'],args['--approve-plan']);
  return cleanup(root,args['--journal'],args['--accept-batch']);
}
if(require.main===module){try{process.stdout.write(JSON.stringify(cli(process.argv.slice(2)))+'\n');}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}}
module.exports={setupPlan,extensionPlan,navigationPlan,migrationPlan,checkPlan,applyPlan,rollback,cleanup,update,rewriteLinks,cli};
