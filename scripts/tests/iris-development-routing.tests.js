'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
test('coding entries, rules and change workflow select development mode before source-sync',()=>{
 const entries=[
  'plugins/coding-iris-plugin/AGENTS.md',
  ...['coding-iris-init','iris-coding','iris-backend-coding','iris-frontend-coding','iris-code-baseline','iris-deploy'].map(name=>`plugins/coding-iris-plugin/skills/${name}/SKILL.md`),
  ...['iris_coding_index','iris_coding_general','iris_coding_workflow','iris_deploy_checklist'].map(name=>`plugins/coding-iris-plugin/rules/${name}.md`),
  'agents/iris-change-agent/AGENT.md','workflows/iris-change.workflow.md',
 ];
 for(const file of entries){
  const text=read(file),mode=text.indexOf('developmentMode'),online=text.indexOf('project-demand-development.md');
  assert.ok(mode>=0,file+': missing development mode');assert.match(text,/offline/);
  if(online>=0)assert.ok(mode<online,file+': online routing precedes development mode');
  if(text.includes('iris-offline-development.md')){
   const link=text.match(/\]\(([^)]+iris-offline-development\.md(?:#[^)]+)?)\)/);
   if(link)assert.ok(fs.existsSync(path.resolve(root,path.dirname(file),link[1].split('#')[0])),file+': offline owner missing');
  }
 }
});
test('project profiles reference one mode configuration and keep the original contextMode choices',()=>{
 for(const file of ['plugins/agent-context-kit/templates/project_context_profile.template.md','plugins/coding-iris-plugin/templates/iris_project_profile.template.md']){
  const text=read(file);assert.match(text,/iris-development\.json/);assert.match(text,/developmentMode/);assert.doesNotMatch(text,/^\s*[-*]?\s*developmentMode\s*[:：]\s*(offline|connected)/m);
 }
 const profile=read('plugins/agent-context-kit/templates/project_context_profile.template.md');
 assert.match(profile,/codebase-complete/);assert.match(profile,/intent-first-on-demand-export/);assert.doesNotMatch(profile,/contextMode[^\n]*`offline`/);
 const init=read('plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md');assert.match(init,/(?:只|集中)询问一次/);assert.match(init,/offline/);
});
test('source packaging has exactly one canonical helper and the manual builder resolves it',()=>{
 const canonical='plugins/coding-iris-plugin/scripts/iris-tools/source-delivery.ps1';assert.ok(fs.existsSync(path.join(root,canonical)));
 assert.equal(fs.existsSync(path.join(root,'tools/iris-code-export/source-delivery.ps1')),false);
 const builder=require('../../tools/iris-code-export/build-catalogs');assert.equal(path.resolve(builder.helperSource()),path.join(root,canonical));
});
