'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../../..'),script=path.join(repo,'plugins/bos-plugin/scripts/demand-entry.js');
const entry=require(script),manifest=JSON.parse(fs.readFileSync(path.join(repo,'plugins/bos-plugin/.agents-plugin/plugin.json'),'utf8'));
function put(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));}
function fixture(t,overlay=false){
 const parent=path.resolve(process.env.IMEDICAL_TEST_TMP||os.tmpdir());fs.mkdirSync(parent,{recursive:true});const base=fs.mkdtempSync(path.join(parent,'bos-directory-'));
 t.after(()=>{assert.equal(path.dirname(base),parent);assert.ok(!fs.lstatSync(base).isSymbolicLink());fs.rmSync(base,{recursive:true,force:true});});
 const project=path.join(base,'project'),context=path.join(project,'.agents'),capability=overlay?path.join(base,'capability'):context;
 put(path.join(context,'config/plugin_profile.md'),'| bos-plugin | enabled |\n');put(path.join(capability,'plugins/bos-plugin/.agents-plugin/plugin.json'),manifest);
 if(overlay){const source=path.join(base,'source');fs.mkdirSync(source);fs.mkdirSync(path.join(capability,'.git'));fs.symlinkSync(source,path.join(project,'backend'),process.platform==='win32'?'junction':'dir');put(path.join(context,'capability.json'),{schemaVersion:1,mode:'workspace-overlay',workspace:'fixture',contextRoot:'.agents',capabilityRoot:capability,sharedDirectories:[],localDirectories:['config'],sourceRoots:[{name:'backend',path:'backend',target:source,gitRoot:source}]});}
 const config=enabled=>put(path.join(context,'config/documentation-layout.json'),{schema:'imedical-documentation-layout/v1',enabled,workspaceRoot:project,extensions:[]});
 return{base,project,context,capability,config,delivery:path.join(project,'docs/delivery/demands'),privateRoot:path.join(context,'work/standard-demand')};
}
function workSpec(){return{kind:'standard',source:'work',common:{模块编码:'SYNTHETIC'},requirements:[{key:'r1',name:'{DEMO} 合成目录交付',description:{format:'work',goal:'检验目录出口',activities:['生成合成样本']},sources:[{kind:'user',locator:'synthetic-test',summary:'合成测试'}],progress:{status:'planned',summary:'仅测试'}}]};}
function codeDraft(){return{schema:'iris-standard-demand/v2',kind:'standard',common:{模块编码:'SYNTHETIC'},requirements:[{key:'r1',name:'{DEMO} 合成目录交付',description:{format:'bug',steps:['执行合成输入'],expected:'分离草稿',actual:'合成旧行为'},type:'fix',subject:'目录',changes:[{evidence:{unstaged:'SYNTHETIC_PRIVATE_PATCH'},modification:'合成目录修改'}]}]};}
function run(f,...args){const r=spawnSync(process.execPath,[script,...args],{cwd:f.project,encoding:'utf8',windowsHide:true});return r;}
test('legacy and disabled projects keep their single-directory output',t=>{
 const f=fixture(t);for(const enabled of [undefined,false]){if(enabled!==undefined)f.config(enabled);const output=path.join(f.project,'docs/work/standard-demand/task-'+String(enabled));const result=entry.deliver(codeDraft(),output,false,{projectRoot:f.project});assert.equal(result.draft,undefined);assert.ok(fs.existsSync(path.join(output,'draft.json')));assert.equal(fs.existsSync(f.privateRoot),false);}
});
test('governed delivery separates synthetic patch draft and retains readable text and Excel',t=>{
 const f=fixture(t);f.config(true);const output=path.join(f.delivery,'task');const result=entry.deliver(codeDraft(),output,true,{projectRoot:f.project});
 assert.equal(result.draft,path.join(f.privateRoot,'task/draft.json'));assert.match(fs.readFileSync(result.draft,'utf8'),/SYNTHETIC_PRIVATE_PATCH/);assert.equal(fs.existsSync(path.join(output,'draft.json')),false);assert.equal(fs.readFileSync(path.join(f.privateRoot,'.gitignore'),'utf8'),'*\n');
 for(const file of ['r1.txt','requirements.xlsx']){const content=fs.readFileSync(path.join(output,file));assert.equal(content.includes(Buffer.from('SYNTHETIC_PRIVATE_PATCH')),false);}
});
test('CLI prepare, render and bind preserve separate private draft paths',t=>{
 const f=fixture(t);f.config(true);const spec=path.join(f.base,'spec.json');put(spec,workSpec());const draft=path.join(f.privateRoot,'explicit/draft.json');
 let r=run(f,'prepare','--spec',spec,'--output',path.join(f.delivery,'prepared'),'--draft-output',draft,'--excel','--project-root',f.project);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).draft,draft);
 const next=path.join(f.privateRoot,'rendered/draft.json');r=run(f,'render','--draft',draft,'--output',path.join(f.delivery,'rendered'),'--draft-output',next,'--project-root',f.project);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).draft,next);
 const bound=path.join(f.privateRoot,'bound.json');r=run(f,'bind','--draft',next,'--item','r1','--demand','100001','--title','合成标题','--output',bound,'--project-root',f.project);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(fs.readFileSync(bound,'utf8')).requirements[0].boss.demand,'100001');
});
test('explicit legacy or project output retains prior layout under enabled governance',t=>{
 const f=fixture(t);f.config(true);const output=path.join(f.project,'docs/custom-output/task');const result=entry.deliver(codeDraft(),output,false,{projectRoot:f.project});assert.equal(result.draft,undefined);assert.ok(fs.existsSync(path.join(output,'draft.json')));
});
test('existing private draft and mixed public/private output stop before new delivery artifacts',t=>{
 const f=fixture(t);f.config(true);put(path.join(f.privateRoot,'task/draft.json'),'preserved');const output=path.join(f.delivery,'task');assert.throws(()=>entry.deliver(codeDraft(),output,false,{projectRoot:f.project}),/私有草稿已存在/);assert.equal(fs.existsSync(output),false);assert.equal(fs.readFileSync(path.join(f.privateRoot,'task/draft.json'),'utf8'),'preserved');
 const other=path.join(f.delivery,'other');assert.throws(()=>entry.deliver(codeDraft(),other,false,{projectRoot:f.project,draftOutput:path.join(other,'draft.json')}),/交付目录之外/);assert.equal(fs.existsSync(other),false);
});
test('private writes reject other context paths and undeclared aliases',t=>{
 const f=fixture(t);f.config(true);const output=path.join(f.delivery,'task');assert.throws(()=>entry.deliver(codeDraft(),output,false,{projectRoot:f.project,draftOutput:path.join(f.context,'config/wrong.json')}),/不能写入/);assert.equal(fs.existsSync(output),false);
 const escaped=path.join(f.base,'escaped');fs.mkdirSync(escaped);fs.mkdirSync(path.dirname(f.privateRoot),{recursive:true});fs.symlinkSync(escaped,f.privateRoot,process.platform==='win32'?'junction':'dir');assert.throws(()=>entry.deliver(codeDraft(),output,false,{projectRoot:f.project}),/Linked|link|physical/);assert.equal(fs.readdirSync(escaped).length,0);
});
test('existing unprotected private-root ignore is preserved and blocks publication',t=>{
 const f=fixture(t);f.config(true);put(path.join(f.privateRoot,'.gitignore'),'user-owned\n');const output=path.join(f.delivery,'task');assert.throws(()=>entry.deliver(codeDraft(),output,false,{projectRoot:f.project}),/gitignore/);assert.equal(fs.existsSync(output),false);assert.equal(fs.readFileSync(path.join(f.privateRoot,'.gitignore'),'utf8'),'user-owned\n');
});
test('Overlay private drafts stay in the module ContextRoot',t=>{
 const f=fixture(t,true);f.config(true);const result=entry.deliver(codeDraft(),path.join(f.delivery,'task'),false,{projectRoot:f.project});assert.equal(result.draft,path.join(f.privateRoot,'task/draft.json'));assert.equal(fs.existsSync(path.join(f.capability,'work')),false);
});
