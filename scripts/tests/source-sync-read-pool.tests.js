'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createTempDirectory}=require('./fixtures/temp-directory');
const sync=require('../../plugins/coding-iris-plugin/scripts/iris-tools/source-sync-core');
function git(root,args){return execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});}
function fixture(t){
 const root=createTempDirectory('source-sync-read-pool-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 git(root,['init']);git(root,['config','user.name','Fixture']);git(root,['config','user.email','fixture@example.invalid']);git(root,['config','core.autocrlf','false']);
 const configRoot=path.join(root,'.agents/config');fs.mkdirSync(configRoot,{recursive:true});git(path.join(root,'.agents'),['init']);
 fs.appendFileSync(path.join(root,'.agents/.git/info/exclude'),'\n/work/\n/config/\n');
 fs.writeFileSync(path.join(root,'.gitignore'),'.agents/\n.mcp.json\n');
 fs.writeFileSync(path.join(configRoot,'iris_project_profile.md'),'- 默认需求交付类型：project\n- 前端源码编码：utf8\n- 前端服务器编码：utf8\n- 前端服务器编码确认：confirmed\n- 前端服务器编码确认环境：pending\n');
 fs.writeFileSync(path.join(configRoot,'project-env.json'),JSON.stringify({iris:{host:'127.0.0.1',scheme:'http',namespace:'FIXTURE'},web:{basePath:'web',cspBasePath:'web/csp'}}));
 const files=['src/Demo/Sample.cls'],original='Class Demo.Sample\n{\n}\n';fs.mkdirSync(path.join(root,'src/Demo'),{recursive:true});fs.writeFileSync(path.join(root,files[0]),original);
 git(root,['add','.gitignore','src']);git(root,['commit','-m','fixture baseline']);
 return {root,files,original,plan:options=>sync.createPlan({projectRoot:root,environmentAlias:'fixture',environmentType:'test',demand:'123',...options})};
}

test('prepare uses the real read pool for a mixed backend and GB18030 frontend batch',async t=>{
 const f=fixture(t),http=require('node:http'),encoding=require('../../plugins/coding-iris-plugin/scripts/iris-tools/frontend-encoding');
 const body='var text="中文😀";\n',bytes=encoding.encode(body,'gb18030'),requests=[];
 const server=http.createServer((req,res)=>{
  if(req.method==='HEAD'){res.writeHead(200);res.end();return;}
  res.setHeader('Content-Type','application/json');res.setHeader('Set-Cookie','CSPSESSIONID=preparefixture; Path=/');
  if(req.url.endsWith('/api/atelier/')){res.end(JSON.stringify({result:{content:{version:'fixture-1',id:'fixture',api:1}}}));return;}
  const url=new URL(req.url,'http://localhost'),document=decodeURIComponent(url.pathname.split('/doc/')[1]);
  const binary=url.searchParams.get('binary')==='1';requests.push({document,binary});
  res.end(JSON.stringify({result:{name:document,ts:'2026-11-12 01:00:00',enc:binary,content:binary?[bytes.toString('base64')]:f.original.split('\n')}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 // Local HTTP fixture uses the complete-codebase context; prepare still creates its real read pool.
 fs.writeFileSync(path.join(f.root,'.agents/config/project_context_profile.md'),'- contextMode: codebase-complete\n');
 const configRoot=path.join(f.root,'.agents/config'),configFile=path.join(configRoot,'project-env.json');
 const config=JSON.parse(fs.readFileSync(configFile,'utf8'));Object.assign(config.iris,{port:server.address().port,username:'fixture',password:'fixture'});fs.writeFileSync(configFile,JSON.stringify(config));
 fs.writeFileSync(path.join(f.root,'.mcp.json'),JSON.stringify({mcpServers:{'iris-agentic-dev':{env:{IRIS_HOST:'127.0.0.1',IRIS_WEB_PORT:String(server.address().port),IRIS_SCHEME:'http',IRIS_NAMESPACE:'FIXTURE',IRIS_USERNAME:'fixture',IRIS_PASSWORD:'fixture'}}}}));
 fs.writeFileSync(path.join(configRoot,'iris-remote-policy.json'),JSON.stringify({schema:'iris-remote-policy/v1',enabled:true,poolKey:'preparefixture',coordinationRoot:path.join(f.root,'coordination'),maxConcurrent:1}));
 const profile=path.join(configRoot,'iris_project_profile.md');let text=fs.readFileSync(profile,'utf8').replace('前端服务器编码：utf8','前端服务器编码：gb18030');
 text=text.replace(/前端服务器编码确认环境：[^\r\n]+/,'前端服务器编码确认环境：'+encoding.targetIdentity({workspaceRoot:f.root,contextRoot:path.join(f.root,'.agents')}));fs.writeFileSync(profile,text);
 const relative='scripts/a.js';fs.mkdirSync(path.join(f.root,'scripts'),{recursive:true});fs.writeFileSync(path.join(f.root,relative),body);
 git(f.root,['add',relative]);git(f.root,['commit','-m','fixture frontend']);
 const plan=f.plan({files:[...f.files,relative]});
 const prepared=await sync.prepare(plan.planPath);
 assert.equal(prepared.state,'prepared');assert.deepEqual(requests.map(item=>item.binary),[false,true]);
 const frontend=prepared.files.find(file=>file.kind==='frontend');assert.equal(frontend.remoteServerSha256,sync.hash(bytes));
 assert.equal(fs.readFileSync(path.join(f.root,relative),'utf8'),body);
});
