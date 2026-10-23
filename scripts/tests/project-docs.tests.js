 'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const docs=require('../project-docs');
const dirs=require('../lib/project-directories');
const repo=path.resolve(__dirname,'../..');
function fixture(run){
  const parent=fs.realpathSync.native(os.tmpdir()); const batch=fs.mkdtempSync(path.join(parent,'project-docs-'));
  const root=path.join(batch,'project'),backup=path.join(batch,'backup');fs.mkdirSync(root);
  const put=(name,contents)=>{const f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,contents);};
  put('.agents/plugins/agent-context-kit/.agents-plugin/plugin.json',fs.readFileSync(path.join(repo,'plugins/agent-context-kit/.agents-plugin/plugin.json')));
  put('.agents/config/plugin_profile.md','| plugin | status |\n|---|---|\n| agent-context-kit | enabled |\n');
  put('AGENTS.md','# 项目\r\n\r\n已有约束。\r\n');
  const setup=()=>{const plan=docs.setupPlan(root);return docs.applyPlan(root,plan,plan.id,backup);};
  try{return run({root,backup,batch,put,setup});}finally{assert.equal(path.dirname(fs.realpathSync.native(batch)),parent);fs.rmSync(batch,{recursive:true,force:true});assert.ok(!fs.existsSync(batch));}
}
const read=(root,file)=>fs.readFileSync(path.join(root,file),'utf8');
test('unconfigured update and resolver are read-only even without .agents',()=>fixture(({root})=>{
  const empty=path.join(root,'empty');fs.mkdirSync(empty);assert.equal(docs.update(empty,'Write').status,'docs-layout-setup-required');
  assert.equal(dirs.resolveDirectory(empty,'missing','test','docs/legacy'),path.join(empty,'docs/legacy'));assert.deepEqual(fs.readdirSync(empty),[]);
}));
test('first setup requires exact plan approval and a separate backup root',()=>fixture(({root,backup})=>{
  const plan=docs.setupPlan(root);assert.ok(!fs.existsSync(path.join(root,'docs')));
  assert.throws(()=>docs.applyPlan(root,plan,'wrong',backup),/approval/);
  assert.throws(()=>docs.applyPlan(root,plan,plan.id,path.join(root,'backup')),/separate/);
  assert.throws(()=>docs.applyPlan(root,plan,plan.id),/backup root/);assert.ok(!fs.existsSync(path.join(root,'docs')));
}));
test('authorized setup prebuilds empty skeleton and preserves prose and line endings',()=>fixture(({root,setup})=>{
  setup();assert.equal(read(root,'AGENTS.md').split('已有约束。').length,2);assert.ok(!/(?:^|[^\r])\n/.test(read(root,'AGENTS.md')));
  for(const name of ['guides','modules','delivery','archive'])assert.ok(fs.statSync(path.join(root,'docs',name)).isDirectory());
  assert.ok(fs.existsSync(path.join(root,'.agents/work/handoff')));assert.ok(!fs.existsSync(path.join(root,'docs/handoff')));
  assert.equal(dirs.resolveDirectory(root,'agent-context-kit','handoff','docs/handoff'),path.join(root,'.agents/work/handoff'));
  assert.throws(()=>docs.setupPlan(root),/already enrolled/);
}));
test('setup keeps existing docs navigation byte-for-byte',()=>fixture(({root,put,setup})=>{
  put('docs/README.md','\uFEFF# 自定义导航\r\n');const before=fs.readFileSync(path.join(root,'docs/README.md'));setup();assert.deepEqual(fs.readFileSync(path.join(root,'docs/README.md')),before);
}));
test('update is idempotent, read modes do not recreate empty dirs, files survive',()=>fixture(({root,put,setup})=>{
  setup();put('docs/custom/note.md','owner data');fs.rmdirSync(path.join(root,'docs/guides'));
  assert.equal(docs.update(root,'Check').status,'docs-layout-directories-missing');assert.ok(!fs.existsSync(path.join(root,'docs/guides')));
  assert.equal(docs.update(root,'DryRun').status,'docs-layout-directories-missing');assert.equal(docs.update(root,'Write').status,'docs-layout-updated');
  const again=docs.update(root,'Write');assert.equal(again.status,'docs-layout-ok');assert.deepEqual(again.unclassified,['docs/custom']);assert.equal(read(root,'docs/custom/note.md'),'owner data');
}));
test('directory collision preflights all targets before update writes',()=>fixture(({root,put,setup})=>{
  setup();fs.rmdirSync(path.join(root,'docs/guides'));fs.rmdirSync(path.join(root,'docs/modules'));put('docs/modules','user file');
  assert.equal(docs.update(root,'Write').status,'docs-layout-review-required');assert.ok(!fs.existsSync(path.join(root,'docs/guides')));assert.equal(read(root,'docs/modules'),'user file');
}));
test('source drift and edited plan contents invalidate approval before backup',()=>fixture(({root,put,setup,backup})=>{
  setup();put('docs/old.md','before');let plan=docs.migrationPlan(root,{moves:[{from:'docs/old.md',to:'docs/guides/new.md'}]});
  const altered=JSON.parse(JSON.stringify(plan));altered.actions[0].content=Buffer.from('injected').toString('base64');assert.throws(()=>docs.applyPlan(root,altered,plan.id,backup),/approval/);
  put('docs/old.md','concurrent edit');assert.throws(()=>docs.applyPlan(root,plan,plan.id,backup),/changed since review/);assert.equal(read(root,'docs/old.md'),'concurrent edit');
}));
test('plugin or profile drift invalidates the plan',()=>fixture(({root,put,setup,backup})=>{
  setup();put('docs/old.md','data');const plan=docs.migrationPlan(root,{moves:[{from:'docs/old.md',to:'docs/guides/new.md'}]});
  fs.appendFileSync(path.join(root,'.agents/config/plugin_profile.md'),'\n');assert.throws(()=>docs.applyPlan(root,plan,plan.id,backup),/policy changed/);assert.ok(fs.existsSync(path.join(root,'docs/old.md')));
}));
test('binary assets move intact and live Markdown inbound/outbound links rebase',()=>fixture(({root,put,setup,backup})=>{
  setup();put('docs/旧目录/说明.md','# 标题\n[外部](../guides/help.md#示例)\n![图](图%20片.bin)\n');put('docs/旧目录/图 片.bin',Buffer.from([0,255,19]));put('docs/guides/help.md','help');put('docs/README.md','[入口](旧目录/说明.md#标题)\n');
  const plan=docs.migrationPlan(root,{moves:[{from:'docs/旧目录',to:'docs/modules/topic'}],references:['docs/README.md']});
  const applied=docs.applyPlan(root,plan,plan.id,backup);assert.equal(read(root,'docs/README.md'),'[入口](modules/topic/%E8%AF%B4%E6%98%8E.md#标题)\n');
  assert.ok(read(root,'docs/modules/topic/说明.md').includes('../../guides/help.md#示例'));assert.deepEqual(fs.readFileSync(path.join(root,'docs/modules/topic/图 片.bin')),Buffer.from([0,255,19]));
  assert.ok(!fs.existsSync(path.join(root,'docs/旧目录/说明.md')));docs.rollback(root,applied.journal,plan.id);assert.ok(fs.existsSync(path.join(root,'docs/旧目录/说明.md')));assert.ok(!fs.existsSync(path.join(root,'docs/modules/topic')));
}));
test('backup is durable, checksummed and cleanup needs user acceptance of batch',()=>fixture(({root,put,setup,backup})=>{
  setup();put('docs/old.md','original');const plan=docs.migrationPlan(root,{moves:[{from:'docs/old.md',to:'docs/guides/new.md'}]});const result=docs.applyPlan(root,plan,plan.id,backup);
  const journal=JSON.parse(fs.readFileSync(result.journal));assert.equal(journal.state,'applied');for(const f of journal.files.filter(f=>f.backup))assert.equal(dirs.digest(fs.readFileSync(path.join(path.dirname(result.journal),f.backup))),f.beforeHash);
  assert.throws(()=>docs.cleanup(root,result.journal,'not-accepted'),/acceptance/);docs.cleanup(root,result.journal,plan.id);assert.ok(!fs.existsSync(path.dirname(result.journal)));assert.equal(read(root,'docs/guides/new.md'),'original');
}));
test('cleanup preserves unexpected content in backup batch',()=>fixture(({root,setup})=>{
  const result=setup();fs.writeFileSync(path.join(path.dirname(result.journal),'user.txt'),'keep');const journal=JSON.parse(fs.readFileSync(result.journal));assert.throws(()=>docs.cleanup(root,result.journal,journal.planId),/Unexpected/);assert.equal(fs.readFileSync(path.join(path.dirname(result.journal),'user.txt'),'utf8'),'keep');
}));
test('rollback refuses to overwrite concurrent user edits',()=>fixture(({root,put,setup,backup})=>{
  setup();put('docs/old.md','before');const plan=docs.migrationPlan(root,{moves:[{from:'docs/old.md',to:'docs/guides/new.md'}]});const result=docs.applyPlan(root,plan,plan.id,backup);put('docs/guides/new.md','user edit');assert.throws(()=>docs.rollback(root,result.journal,plan.id),/Concurrent/);assert.equal(read(root,'docs/guides/new.md'),'user edit');
}));
test('failed migration rolls back its own changed files and leaves a durable journal',()=>fixture(({root,put,setup,backup})=>{
  setup();put('docs/old.md','before');const plan=docs.migrationPlan(root,{moves:[{from:'docs/old.md',to:'docs/guides/new.md'}]});const unlink=fs.unlinkSync;let once=true;
  fs.unlinkSync=function(file){if(once&&file===path.join(root,'docs/old.md')){once=false;throw Error('injected source deletion failure');}return unlink(file);};
  try{assert.throws(()=>docs.applyPlan(root,plan,plan.id,backup),/injected/);}finally{fs.unlinkSync=unlink;}
  assert.equal(read(root,'docs/old.md'),'before');assert.ok(!fs.existsSync(path.join(root,'docs/guides/new.md')));
}));
test('protected history, task state, nested Git, collisions and traversal are refused',()=>fixture(({root,put,setup})=>{
  setup();put('docs/work/state.md','state');put('docs/pkg/.git/config','nested');put('docs/pkg/note.md','note');put('docs/new.md','existing');put('docs/old.md','original');
  for(const moves of [[{from:'docs/work/state.md',to:'docs/guides/state.md'}],[{from:'docs/pkg',to:'docs/modules/pkg'}],[{from:'docs/old.md',to:'docs/new.md'}],[{from:'docs/old.md',to:'docs/../escape.md'}]])assert.throws(()=>docs.migrationPlan(root,{moves}));
  assert.equal(read(root,'docs/work/state.md'),'state');assert.equal(read(root,'docs/new.md'),'existing');
}));
test('directory junctions and hard-linked files are preserved',()=>fixture(({root,put,setup,batch})=>{
  setup();const outside=path.join(batch,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(root,'docs/link'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>docs.migrationPlan(root,{moves:[{from:'docs/link',to:'docs/modules/link'}]}),/Linked/);
  put('docs/old.md','original');fs.linkSync(path.join(root,'docs/old.md'),path.join(root,'docs/hard.md'));assert.throws(()=>docs.migrationPlan(root,{moves:[{from:'docs/hard.md',to:'docs/guides/new.md'}]}),/Linked/);assert.equal(fs.readdirSync(outside).length,0);
}));
test('registered custom directory is planned and requires approval',()=>fixture(({root,setup,backup})=>{
  setup();const plan=docs.extensionPlan(root,{path:'docs/backlog',purpose:'待治理事项'});assert.ok(!fs.existsSync(path.join(root,'docs/backlog')));docs.applyPlan(root,plan,plan.id,backup);assert.ok(!docs.update(root).unclassified.includes('docs/backlog'));
}));
test('invalid copied configuration fails closed, available plugins do not precreate dirs',()=>fixture(({root,put,setup})=>{
  put('.agents/plugins/unused/.agents-plugin/plugin.json',JSON.stringify({name:'unused',projectDirectories:[{id:'test',base:'workspace',path:'docs/unwanted',role:'delivery',create:'setup'}]}));setup();assert.ok(!fs.existsSync(path.join(root,'docs/unwanted')));
  const file=path.join(root,'.agents/config/documentation-layout.json'),config=JSON.parse(fs.readFileSync(file));config.workspaceRoot=path.join(root,'other');fs.writeFileSync(file,JSON.stringify(config));assert.equal(docs.update(root,'Write').status,'docs-layout-review-required');assert.throws(()=>dirs.resolveDirectory(root,'agent-context-kit','handoff','docs/handoff'),/Invalid documentation/);
}));
test('CLI rejects unknown options and absent plan approval',()=>fixture(({root,setup})=>{
  assert.throws(()=>docs.cli(['update','--project-root',root,'--write','true']),/Usage/);assert.throws(()=>docs.cli(['apply','--project-root',root]),/path|undefined|argument/i);setup();assert.equal(docs.cli(['update','--project-root',root,'--mode','Check']).status,'docs-layout-ok');
}));

test('Markdown examples/comments stay unchanged while live and reference links move',()=>{
  const before='[live](old/page.md)\n`[inline](old/page.md)`\n```md\n[example](old/page.md)\n```\n<!-- [hidden](old/page.md) -->\n[ref]: old/page.md "title"\n';
  const after=docs.rewriteLinks(Buffer.from(before),'docs/README.md','docs/README.md',new Map([['docs/old/page.md','docs/guides/page.md']])).toString();
  assert.ok(after.includes('[live](guides/page.md)'));assert.ok(after.includes('`[inline](old/page.md)`'));assert.ok(after.includes('```md\n[example](old/page.md)\n```'));assert.ok(after.includes('<!-- [hidden](old/page.md) -->'));assert.ok(after.includes('[ref]: guides/page.md "title"'));
});
test('directory migration preserves empty subdirectories and directory links',()=>fixture(({root,put,setup,backup})=>{
  setup();put('docs/old/README.md','[sub](sub/)\n');fs.mkdirSync(path.join(root,'docs/old/sub'));const plan=docs.migrationPlan(root,{moves:[{from:'docs/old',to:'docs/guides/old'}]});docs.applyPlan(root,plan,plan.id,backup);assert.ok(fs.statSync(path.join(root,'docs/guides/old/sub')).isDirectory());assert.equal(read(root,'docs/guides/old/README.md'),'[sub](sub/)\n');
}));
test('single-file mapping cannot bypass a nested Git boundary',()=>fixture(({root,put,setup})=>{
  setup();put('docs/pkg/.git/config','nested');put('docs/pkg/note.md','note');assert.throws(()=>docs.migrationPlan(root,{moves:[{from:'docs/pkg/note.md',to:'docs/modules/note.md'}]}),/Nested Git/);
}));
test('actual process interruption leaves a recoverable applying journal',()=>fixture(({root,put,setup,backup,batch})=>{
  setup();put('docs/old.md','original');const plan=docs.migrationPlan(root,{moves:[{from:'docs/old.md',to:'docs/guides/new.md'}]});const planFile=path.join(batch,'approved.json');fs.writeFileSync(planFile,JSON.stringify(plan));
  const {spawnSync}=require('node:child_process');
  const script="const fs=require('node:fs'),path=require('node:path'),api=require(process.argv[1]);const root=process.argv[2],plan=JSON.parse(fs.readFileSync(process.argv[3])),unlink=fs.unlinkSync;fs.unlinkSync=function(file){if(file===path.join(root,'docs/old.md'))process.exit(77);return unlink(file);};api.applyPlan(root,plan,plan.id,process.argv[4]);";
  const child=spawnSync(process.execPath,['-e',script,path.join(repo,'scripts/project-docs.js'),root,planFile,backup],{encoding:'utf8'});assert.equal(child.status,77,child.stderr);
  const journals=fs.readdirSync(backup).map(n=>path.join(backup,n,'journal.json')).filter(f=>JSON.parse(fs.readFileSync(f)).planId===plan.id);assert.equal(journals.length,1);assert.equal(JSON.parse(fs.readFileSync(journals[0])).state,'applying');
  docs.rollback(root,journals[0],plan.id);assert.equal(read(root,'docs/old.md'),'original');assert.ok(!fs.existsSync(path.join(root,'docs/guides/new.md')));
}));
test('tampered recovery journal cannot reuse the original approval for another path',()=>fixture(({root,put,setup})=>{
  const result=setup();put('docs/user.md','keep');const journal=JSON.parse(fs.readFileSync(result.journal));journal.files[0].path='docs/user.md';fs.writeFileSync(result.journal,JSON.stringify(journal));assert.throws(()=>docs.rollback(root,result.journal,journal.planId),/differs/);assert.equal(read(root,'docs/user.md'),'keep');
}));
test('workspace ancestor junction is refused before path resolution or backup',()=>fixture(({root,batch})=>{
  const alias=path.join(batch,'alias');fs.symlinkSync(root,alias,process.platform==='win32'?'junction':'dir');const sub=path.join(root,'sub');fs.mkdirSync(sub);assert.throws(()=>dirs.contextFor(path.join(alias,'sub')),/physical/);
}));
