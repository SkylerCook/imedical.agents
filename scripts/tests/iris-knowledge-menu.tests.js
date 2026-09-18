'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..');
const tool=require('../../plugins/coding-iris-plugin/scripts/iris-tools/sync-menu');
const {search}=require('../../plugins/coding-iris-plugin/scripts/iris-tools/query-knowledge');
const {sanitize}=require('../../.agents/skills/agent-kit-maintenance/scripts/import-imedical-knowledge');
function fixture(t){const parent=path.join(os.tmpdir(),'codex');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'knowledge-menu-'));t.after(()=>{assert.equal(path.dirname(dir),parent);fs.rmSync(dir,{recursive:true,force:true});});return dir;}
function input(){return {schema:'iris-menu-snapshot/v1',sourceId:'demo',complete:true,scope:'all',capturedAt:'2026-09-18T00:00:00Z',catalog:[{id:'1',text:'Diagnosis',url:'diag.csp'}],groups:[{id:'10',name:'Doctor',menus:[{id:'1',text:'Diagnosis',url:'diag.csp',children:[]}]},{id:'20',name:'Other',menus:[]}]};}
function apply(root,data){const plan=tool.sync({root,input:data});return tool.sync({root,input:data,write:true,expectHash:plan.revision,expectInput:plan.inputHash});}
test('plan is read-only; apply, readback and repeat are deterministic',t=>{
 const root=path.join(fixture(t),'state'),data=input();tool.sync({root,input:data});assert.equal(fs.existsSync(root),false);
 const first=apply(root,data);assert.equal(first.status,'applied');assert.match(fs.readFileSync(path.join(root,first.generation,'group-menu/10.md'),'utf8'),/Diagnosis/);
 assert.equal(apply(root,data).status,'unchanged');assert.equal(tool.current(root).revision,first.revision);
});
test('partial sync preserves other groups and catalog, full sync removes deleted groups',t=>{
 const root=fixture(t);apply(root,input());const partial=input();partial.scope='groups';delete partial.catalog;partial.groups=partial.groups.slice(0,1);partial.groups[0].menus[0].text='New diagnosis';
 const result=apply(root,partial);assert.ok(result.changes.changed.includes('group/10/1'));assert.equal(tool.current(root).snapshot.groups.length,2);assert.equal(tool.current(root).snapshot.catalog.length,1);
 const all=input();all.groups=all.groups.slice(0,1);assert.ok(apply(root,all).changes.removed.includes('group/20'));
});
test('failed, duplicate and truncated acquisition cannot replace old state',t=>{
 const root=fixture(t);const first=apply(root,input());
 for(const mutate of [d=>d.complete=false,d=>d.groups.push(d.groups[0]),d=>delete d.catalog,d=>d.groups[0].menus[0].id='../escape',d=>d.groups[0].id='CON']){
  const data=input();mutate(data);assert.throws(()=>apply(root,data));assert.equal(tool.current(root).revision,first.revision);
 }
 const data=input();data.groups=[];assert.throws(()=>apply(root,data),/allow-empty/);
});
test('reviewed input and baseline drift are rejected; exclusive lock preserved',t=>{
 const root=fixture(t),data=input(),plan=tool.sync({root,input:data});data.groups[0].name='Changed';
 assert.throws(()=>tool.sync({root,input:data,write:true,expectHash:plan.revision,expectInput:plan.inputHash}),/Plan changed/);
 apply(root,data);assert.throws(()=>tool.sync({root,input:input(),write:true,expectHash:plan.revision,expectInput:plan.inputHash}),/Plan changed/);
 fs.mkdirSync(path.join(root,'.lock'));assert.throws(()=>apply(root,input()),/EEXIST/);assert.ok(fs.existsSync(path.join(root,'.lock')));
});
test('failed atomic publication leaves old pointer and cleans only new generation',t=>{
 const root=fixture(t);const first=apply(root,input());const before=fs.readdirSync(root).sort(),data=input();data.groups[0].name='Changed';
 const rename=fs.renameSync;fs.renameSync=()=>{throw new Error('simulated rename failure');};
 try{assert.throws(()=>apply(root,data),/simulated/);}finally{fs.renameSync=rename;}
 assert.equal(tool.current(root).revision,first.revision);assert.deepEqual(fs.readdirSync(root).sort(),before);
});
test('moves, URL and order changes are reported; Markdown cannot inject HTML',t=>{
 const root=fixture(t);
 const data=input();data.groups[0].menus.push({id:'2',text:'<script>|x',url:'two.csp'});
 const a=tool.prepare(root,data).snapshot;data.groups[0].menus.reverse();data.groups[0].menus[1].url='new.csp';
 const b=tool.prepare(root,data).snapshot;assert.equal(tool.diff(a,b).changed.length,2);
 assert.match(tool.render(b)['group-menu/10.md'],/&lt;script&gt;&#124;/);
});
test('links and snapshot tampering are rejected',t=>{
 const base=fixture(t),target=path.join(base,'target'),link=path.join(base,'link');fs.mkdirSync(target);fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>apply(link,input()),/links/);const first=apply(target,input());fs.writeFileSync(path.join(target,first.generation,'snapshot.json'),'{}');assert.throws(()=>tool.current(target),/integrity/);
});
test('import redacts connections and credentials while retaining relative resources',()=>{
 const data=sanitize('https://10.2.3.4:123/path\npassword: unsafe\n--token unsafe\nD:\\private\\file\n/dthealth/app\nnamespace: app\nhttps://docs.intersystems.com/irislatest/\ndiag.csp');
 assert.doesNotMatch(data.text,/unsafe|10\.2|private|dthealth|namespace: app/);assert.match(data.text,/diag.csp/);assert.match(data.text,/docs.intersystems.com/);
 const menu=sanitize('| 1 | 修改密码 | settings.csp?token=unsafe |',{menuData:true});assert.match(menu.text,/修改密码/);assert.doesNotMatch(menu.text,/unsafe/);assert.equal(menu.text.split('|').length,5);
});
function install(root){const context=path.join(root,'.agents');fs.mkdirSync(path.join(context,'scripts/lib'),{recursive:true});fs.mkdirSync(path.join(context,'.git'),{recursive:true});
 for(const folder of ['plugins/coding-iris-plugin','vendor/imedical-knowledge'])fs.cpSync(path.join(repo,folder),path.join(context,folder),{recursive:true});
 fs.copyFileSync(path.join(repo,'scripts/lib/workspace-context.js'),path.join(context,'scripts/lib/workspace-context.js'));return context;}
test('installed standard project runs CLI and refresh preserves project data',t=>{
 const project=fixture(t),context=install(project),file=path.join(project,'input.json');fs.writeFileSync(file,JSON.stringify(input()));
 const script=path.join(context,'plugins/coding-iris-plugin/scripts/iris-tools/sync-menu.js');
 const run=args=>{const r=spawnSync(process.execPath,[script,...args,'--project-root',project,'--input',file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 const p=run(['plan']);run(['apply','--expect-hash',p.revision,'--expect-input',p.inputHash]);
 const marker=path.join(context,'work/menu-sync/demo/current.json'),before=fs.readFileSync(marker,'utf8');
 install(project);assert.equal(fs.readFileSync(marker,'utf8'),before);
 const results=search({context:tool.resolveProject(project),sourceId:'demo',query:'Diagnosis',limit:2});assert.equal(results.matches[0].kind,'project-menu');
 const shared=search({context:tool.resolveProject(project),query:'诊断',limit:3});assert.equal(shared.matches.length,3);assert.equal(shared.matches[0].kind,'upstream-reference');
});
test('overlay reads shared knowledge and writes only local ContextRoot',t=>{
 const base=fixture(t),project=path.join(base,'project');fs.mkdirSync(project);const capability=install(path.join(base,'capability'));
 const context=path.join(project,'.agents');fs.mkdirSync(path.join(context,'work'),{recursive:true});
 const source=path.join(base,'source');fs.mkdirSync(source);fs.mkdirSync(path.join(source,'.git'));
 fs.symlinkSync(source,path.join(project,'backend'),process.platform==='win32'?'junction':'dir');
 fs.writeFileSync(path.join(context,'capability.json'),JSON.stringify({schemaVersion:1,mode:'workspace-overlay',workspace:'sample',contextRoot:'.agents',capabilityRoot:capability,sharedDirectories:[],localDirectories:['work'],sourceRoots:[{name:'backend',path:'backend',target:source,gitRoot:source}]}));
 const ctx=tool.resolveProject(project);assert.equal(ctx.capabilityRoot,capability);const root=path.join(ctx.contextRoot,'work/menu-sync/demo');apply(root,input());
 assert.equal(fs.existsSync(path.join(capability,'work/menu-sync')),false);assert.ok(search({context:ctx,query:'诊断',limit:1}).matches.length);
});
test('knowledge manifest covers all imported text and has no raw environment endpoints',()=>{
 const root=path.join(repo,'vendor/imedical-knowledge'),manifest=JSON.parse(fs.readFileSync(path.join(root,'sources.json')));assert.equal(manifest.files.length,218);
 for(const file of manifest.files){const bytes=fs.readFileSync(path.join(root,file.path));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);assert.doesNotMatch(bytes.toString('utf8'),/\b(?:\d{1,3}\.){3}\d{1,3}\b|\bDHC-APP\b/);if(file.sourceRows!==undefined)assert.equal(bytes.toString('utf8').split('\n').filter(l=>l.startsWith('|')).length,file.sourceRows);}
 for(const name of ['install-agents.ps1','update-agents.ps1'])assert.match(fs.readFileSync(path.join(repo,'scripts',name),'utf8'),/\/vendor\/\*\*/);
});
test('fresh sparse install and fast-forward refresh retain local snapshots',t=>{
 const base=fixture(t),origin=install(path.join(base,'origin')),project=path.join(base,'project'),target=path.join(project,'.agents');
 const git=(cwd,args)=>{const r=spawnSync('git',['-C',cwd,...args],{encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git(origin,['init','-q']);git(origin,['config','user.name','Fixture']);git(origin,['config','user.email','fixture@example.invalid']);
 git(origin,['add','.']);git(origin,['commit','-qm','fixture']);fs.mkdirSync(project);
 git(base,['clone','--no-checkout',origin,target]);
 const {refresh}=require('../refresh-agents-sparse');const patterns=['/plugins/**','/vendor/**','/scripts/*.js','/scripts/lib/**'];refresh(target,patterns,true);
 const manifest=JSON.parse(fs.readFileSync(path.join(target,'vendor/imedical-knowledge/sources.json')));
 for(const f of manifest.files)assert.ok(fs.existsSync(path.join(target,'vendor/imedical-knowledge',f.path)),f.path);
 fs.appendFileSync(path.join(target,'.git/info/exclude'),'\n/work/\n');const state=path.join(target,'work/menu-sync/demo');apply(state,input());const before=tool.current(state).revision;
 fs.appendFileSync(path.join(origin,'vendor/imedical-knowledge/README.md'),'\nFixture upgrade\n');git(origin,['add','vendor/imedical-knowledge/README.md']);git(origin,['commit','-qm','upgrade']);
 git(target,['fetch','origin']);git(target,['merge','--ff-only','FETCH_HEAD']);refresh(target,patterns);
 assert.equal(tool.current(state).revision,before);assert.match(fs.readFileSync(path.join(target,'vendor/imedical-knowledge/README.md'),'utf8'),/Fixture upgrade/);
 assert.ok(search({context:tool.resolveProject(project),query:'诊断',limit:1}).matches.length);
});
for(const shell of process.platform==='win32'?['pwsh.exe','powershell.exe']:[])test(`thin-index discovers both knowledge skills and repeat preserves project snapshot (${shell})`,t=>{
 const project=fixture(t),context=path.join(project,'.agents');
 const wrapper=path.join(repo,'plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1');
 const run=mode=>{const r=spawnSync(shell,['-NoProfile','-ExecutionPolicy','Bypass','-File',wrapper,'-ProjectRoot',project,'-ContextRoot',context,'-CapabilityRoot',repo,'-Mode',mode],{encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stderr);};
 run('DryRun');assert.equal(fs.existsSync(context),false);run('Write');
 const root=path.join(context,'work/menu-sync/demo');apply(root,input());const before=tool.current(root).revision;run('Write');assert.equal(tool.current(root).revision,before);
 for(const skill of ['iris-menu-sync','iris-imedical-knowledge'])assert.match(fs.readFileSync(path.join(context,'skills',skill,'SKILL.md'),'utf8'),/thin-index: true/);
});
