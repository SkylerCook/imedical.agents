const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createSettings}=require('./personal-settings');
const inspectProject=require('./inspect-project');
const configIO=require('../../../scripts/lib/configuration-file-io');
test('private settings preview, conflict, apply and secret redaction',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'agents-workbench-test-')),file=path.join(root,'personal.json');try{
 const seed={'bos-demand-query':{connection:'company',access_key:'synthetic-secret',cuser:'fixture',cgroup:'fixture'},other:{preserve:false}};
 fs.writeFileSync(file,'\uFEFF'+JSON.stringify(seed,null,2).replace(/\n/g,'\r\n')+'\r\n');const service=createSettings({BOS_MCP_CONFIG:file});let model=service.inspect('bos');assert.ok(!JSON.stringify(model).includes('synthetic-secret'));
 const before=fs.readFileSync(file);const p=service.plan('bos',{revision:model.revision,changes:{'bos-demand-query.access_key':{action:'replace',value:'new-synthetic-secret'}}});assert.deepEqual(fs.readFileSync(file),before);assert.ok(!JSON.stringify(p).includes('new-synthetic-secret'));service.apply(p.planId);const raw=fs.readFileSync(file,'utf8'),out=JSON.parse(raw.slice(1));assert.equal(out['bos-demand-query'].access_key,'new-synthetic-secret');assert.equal(out.other.preserve,false);assert.ok(raw.includes('\r\n'));assert.ok(raw.startsWith('\uFEFF'));assert.throws(()=>service.apply(p.planId),/过期/);
 model=service.inspect('bos');const conflict=service.plan('bos',{revision:model.revision,changes:{'bos-demand-query.cuser':{value:'changed'}}});fs.appendFileSync(file,' ');assert.throws(()=>service.apply(conflict.planId),/变更/);assert.equal(JSON.parse(fs.readFileSync(file,'utf8').slice(1))['bos-demand-query'].cuser,'fixture');assert.throws(()=>service.plan('bos',{revision:service.inspect('bos').revision,changes:{'other.preserve':{value:true}}}),/支持范围/);
 assert.deepEqual(fs.readdirSync(root),['personal.json']);
}finally{for(const name of fs.readdirSync(root))fs.unlinkSync(path.join(root,name));fs.rmdirSync(root)}});

test('BOS project summary and editor share JSONC validation and preserve unedited bytes', t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agents-workbench-bos-'));
 const file=path.join(root,'共享 配置.jsonc');
 const project=path.join(root,'project');
 fs.mkdirSync(project);
 const previousBos=process.env.BOS_MCP_CONFIG;
 const previousKnowledge=process.env.KNOWLEDGE_RAG_CONFIG;
 process.env.BOS_MCP_CONFIG=file;
 delete process.env.KNOWLEDGE_RAG_CONFIG;
 t.after(()=>{
  if(previousBos===undefined) delete process.env.BOS_MCP_CONFIG;
  else process.env.BOS_MCP_CONFIG=previousBos;
  if(previousKnowledge!==undefined) process.env.KNOWLEDGE_RAG_CONFIG=previousKnowledge;
  fs.unlinkSync(file);
  fs.rmdirSync(project);
  fs.rmdirSync(root);
 });

 const source='\uFEFF'+[
  '{',
  '  // Keep the query settings',
  '  "bos-demand-query": { "cuser": "fixture-user", "cgroup": "fixture-group" },',
  '  /* Keep the log settings */',
  '  "bos-code-update-log": { "timeout": 30000 },',
  '  "unknown": { "note": "https://example.invalid/a/*b*/" }',
  '}',
  '',
 ].join('\r\n');
 fs.writeFileSync(file,source);
 const service=createSettings();
 const summary=()=>inspectProject(project).domains.find(domain=>domain.source==='BOS_MCP_CONFIG');
 assert.equal(summary().status,'已真实读取');
 assert.ok(!JSON.stringify(summary()).includes('fixture-user'));
 const draft=service.inspect('bos');
 assert.equal(draft.fields.find(field=>field.id==='bos-demand-query.cuser').value,'fixture-user');
 const planned=service.plan('bos',{revision:draft.revision,changes:{'bos-code-update-log.timeout':{value:45000}}});
 assert.equal(fs.readFileSync(file,'utf8'),source);
 assert.equal(service.apply(planned.planId).status,'saved');
 const expected=source.replace('"timeout": 30000','"timeout": 45000');
 assert.equal(fs.readFileSync(file,'utf8'),expected);
 const reloaded=service.inspect('bos');
 assert.equal(reloaded.fields.find(field=>field.id==='bos-code-update-log.timeout').value,45000);
 const noChange=service.plan('bos',{revision:reloaded.revision,changes:{'bos-code-update-log.timeout':{value:45000}}});
 assert.equal(service.apply(noChange.planId).revision,reloaded.revision);
 assert.equal(fs.readFileSync(file,'utf8'),expected);

 const invalid=expected.replace('"timeout": 45000','"timeout": 45000, "timeout": 1');
 fs.writeFileSync(file,invalid);
 assert.match(summary().status,/格式解析失败/);
 assert.throws(()=>service.inspect('bos'),/Duplicate JSONC configuration key/);
 assert.equal(fs.readFileSync(file,'utf8'),invalid);
});

test('BOS summarizes connection modes and only replaces an existing custom URL within its section rules', t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agents-workbench-bos-url-'));
 const file=path.join(root,'personal.jsonc');
 t.after(()=>{fs.unlinkSync(file);fs.rmdirSync(root)});
 const query='bos-demand-query',log='bos-code-update-log';
 const existing='https://fixture-query.invalid/sse?sample=old-marker';
 const replacement='https://fixture-query-next.invalid/sse?sample=new-marker';
 const invalidLog='http://fixture-log.invalid/log';
 const validLog='https://fixture-log.invalid/log';
 const data={
  [query]:{url:existing,cuser:'fixture-user'},
  [log]:{url:invalidLog,timeout:30000},
  other:{preserve:true},
 };
 const save=()=>{
  const content='\uFEFF// Keep this note\r\n'+JSON.stringify(data,null,2).replace(/\n/g,'\r\n')+'\r\n';
  fs.writeFileSync(file,content);
  return content;
 };
 const before=save();
 const service=createSettings({BOS_MCP_CONFIG:file});
 const field=id=>service.inspect('bos').fields.find(row=>row.id===id);
 const plan=(id,change)=>service.plan('bos',{revision:service.inspect('bos').revision,changes:{[id]:change}});
 const replace=(id,value)=>plan(id,{action:'replace',value});

 assert.deepEqual(field(query+'.connectionMode'),{
  id:query+'.connectionMode',label:'connectionMode',type:'string',readOnly:true,value:'自定义连接'
 });
 assert.equal(field(log+'.connectionMode').value,'待核对');
 assert.equal(field(query+'.connection'),undefined);
 const {secret,configured,clearable,draftable,value}=field(query+'.url');
 assert.deepEqual({secret,configured,clearable,draftable,value},{
  secret:true,configured:true,clearable:false,draftable:false,value:undefined
 });
 assert.equal(field(log+'.url').configured,false);
 assert.ok(!JSON.stringify(service.inspect('bos')).includes('fixture-query.invalid'));
 assert.throws(()=>replace(query+'.connection','company'),/支持范围/);
 assert.throws(()=>replace(query+'.connectionMode','公司连接'),/支持范围/);
 assert.throws(()=>plan(query+'.url',{action:'clear'}),/必须替换/);
 assert.throws(()=>replace(query+'.url',''),/不能为空/);
 assert.throws(()=>replace(query+'.url','https://fixture-user@fixture-query.invalid/'),/HTTPS/);
 assert.throws(()=>replace(log+'.url',validLog+'?sample=marker'),/HTTPS/);
 assert.throws(()=>replace(log+'.url',validLog+'#test'),/HTTPS/);
 assert.equal(fs.readFileSync(file,'utf8'),before);
 const preview=replace(query+'.url',replacement);
 assert.deepEqual(preview.changes,[{field:query+'.url',action:'replace'}]);
 assert.ok(!JSON.stringify(preview).includes('new-marker'));
 const copyAccess=configIO.copyFileAccess;
 t.mock.method(configIO,'copyFileAccess',(source,target)=>{
  assert.equal(fs.statSync(target).size,0,'protect the temporary file before writing private values');
  return copyAccess(source,target);
 });
 assert.equal(service.apply(preview.planId).status,'saved');
 assert.equal(fs.readFileSync(file,'utf8'),before.replace(existing,replacement));
 assert.equal(service.apply(replace(log+'.url',validLog).planId).status,'saved');
 assert.equal(field(log+'.connectionMode').value,'自定义连接');

 data[query]={connection:'company'};
 save();
 assert.equal(field(query+'.connectionMode').value,'公司连接');
 assert.equal(field(query+'.url'),undefined);
 assert.throws(()=>replace(query+'.url',replacement),/支持范围/);

 data[query].url=existing;
 const ambiguous=save();
 assert.equal(field(query+'.connectionMode').value,'待核对');
 assert.equal(field(query+'.url'),undefined);
 assert.throws(()=>replace(query+'.url',replacement),/支持范围/);
 assert.equal(fs.readFileSync(file,'utf8'),ambiguous);
});

test('personal configuration through a directory link must still be physically outside Git', t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agents-workbench-bos-link-'));
 const repo=path.join(root,'repo'), link=path.join(root,'alias');
 const marker=path.join(repo,'.git'), file=path.join(repo,'private.json');
 fs.mkdirSync(marker,{recursive:true});
 fs.writeFileSync(file,'{}');
 t.after(()=>{
  if(fs.lstatSync(link,{throwIfNoEntry:false})?.isSymbolicLink())fs.unlinkSync(link);
  fs.unlinkSync(file);
  fs.rmdirSync(marker);
  fs.rmdirSync(repo);
  fs.rmdirSync(root);
 });
 fs.symlinkSync(repo,link,process.platform==='win32'?'junction':'dir');
 const service=createSettings({BOS_MCP_CONFIG:path.join(link,path.basename(file))});
 assert.throws(()=>service.inspect('bos'),/Git 工作区/);
 assert.deepEqual(fs.readdirSync(repo).sort(),['.git','private.json']);
});
