'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const repo=path.resolve(__dirname,'../../../..');const {resolveDirectory}=require(path.join(repo,'scripts/lib/project-directories'));
const manifest=JSON.parse(fs.readFileSync(path.join(repo,'plugins/iris-imedical-doctor-ai/.agents-plugin/plugin.json'),'utf8'));
test('AI delivery uses declared governance directory and preserves legacy fallback without generating content',t=>{
 const parent=path.resolve(process.env.IMEDICAL_TEST_TMP||os.tmpdir());fs.mkdirSync(parent,{recursive:true});const project=fs.mkdtempSync(path.join(parent,'ai-directory-'));t.after(()=>{assert.equal(path.dirname(project),parent);assert.ok(!fs.lstatSync(project).isSymbolicLink());fs.rmSync(project,{recursive:true,force:true});});
 const context=path.join(project,'.agents');const put=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,typeof v==='string'?v:JSON.stringify(v));};
 put(path.join(context,'plugins/iris-imedical-doctor-ai/.agents-plugin/plugin.json'),manifest);put(path.join(context,'config/plugin_profile.md'),'| iris-imedical-doctor-ai | enabled |\n');
 const resolve=()=>resolveDirectory(project,'iris-imedical-doctor-ai','ai-delivery','docs/work/ai-integration');
 assert.equal(resolve(),path.join(project,'docs/work/ai-integration'));
 for(const enabled of [false,true]){put(path.join(context,'config/documentation-layout.json'),{schema:'imedical-documentation-layout/v1',enabled,workspaceRoot:project,extensions:[]});assert.equal(resolve(),path.join(project,enabled?'docs/delivery/ai-integration':'docs/work/ai-integration'));assert.equal(fs.existsSync(path.join(project,'docs')),false);}
});
