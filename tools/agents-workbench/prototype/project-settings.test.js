const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {createTempDirectory,ownsTempDirectory}=require('../../../scripts/tests/fixtures/temp-directory');
const {createProjectSettings}=require('./project-settings');
test('canonical source and consumers save together, reject drift and recover failure',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agents-workbench-project-'));
 const write=(name,data)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data)};
 const json=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
 try{
 write('.agents/config/project-env.json',JSON.stringify({iris:{host:'old.invalid',port:52773,username:'fixture',password:'fixture-only',namespace:'USER',scheme:'http'},web:{untouched:true,basePath:'/old'},sftp:{enabled:false,host:'sftp.old.invalid',port:22,username:'fixture',password:'fixture-sftp',serverName:'sftp-server'}}));
 write('.mcp.json',JSON.stringify({mcpServers:{'iris-agentic-dev':{command:'iris-agentic-dev.exe',args:['mcp'],env:{IRIS_USERNAME:'fixture',IRIS_PASSWORD:'fixture-only'}},custom:{command:'preserve'},'sftp-server':{command:'python',args:['preserve.py'],env:{TARGET_HOST:'sftp.old.invalid',TARGET_PASSWORD:'fixture-sftp'}}}}));
 write('.iris-agentic-dev.toml','username = "fixture"\npassword = "fixture-only"\n');
 const api=createProjectSettings(root);const first=api.inspect();assert.ok(!JSON.stringify(first).includes('fixture-only'));
 const request=()=>({revision:api.inspect().revision,changes:{host:{value:'new.invalid'},port:{value:52774},alias:{value:'project'},namespace:{value:'USER'},'web.basePath':{value:'/new'},'sftp.host':{value:'sftp.new.invalid'},'sftp.password':{action:'replace',value:'new-fixture-sftp'}}});
 const plan=api.plan(request());assert.equal(json('.agents/config/project-env.json').iris.host,'old.invalid');assert.ok(!JSON.stringify(plan).includes('fixture-only'));
 await api.apply(plan.planId);assert.equal(json('.agents/config/project-env.json').iris.host,'new.invalid');assert.equal(json('.mcp.json').mcpServers['iris-agentic-dev'].env.IRIS_HOST,'new.invalid');assert.equal(json('.vscode/settings.json')['intersystems.servers'].project.webServer.port,52774);assert.equal(json('.agents/config/project-env.json').web.untouched,true);assert.equal(json('.mcp.json').mcpServers.custom.command,'preserve');assert.equal(json('.mcp.json').mcpServers['sftp-server'].env.TARGET_HOST,'sftp.new.invalid');assert.equal(json('.mcp.json').mcpServers['sftp-server'].env.TARGET_PASSWORD,'new-fixture-sftp');assert.equal(json('.mcp.json').mcpServers['sftp-server'].args[0],'preserve.py');assert.equal(json('.agents/config/project-env.json').web.basePath,'/new');
 const stale=api.plan(request());write('.iris-agentic-dev.toml',fs.readFileSync(path.join(root,'.iris-agentic-dev.toml'),'utf8')+'# external\n');await assert.rejects(()=>api.apply(stale.planId),/已变化/);
 const r=request();r.changes.host.value='failure.invalid';const failing=api.plan(r);let count=0;await assert.rejects(()=>api.apply(failing.planId,{beforeWrite:()=>{if(++count===2)throw Error('synthetic failure')}}));assert.equal(json('.mcp.json').mcpServers['iris-agentic-dev'].env.IRIS_HOST,'new.invalid');assert.equal(json('.agents/config/project-env.json').iris.host,'new.invalid');assert.equal(json('.vscode/settings.json')['intersystems.servers'].project.webServer.host,'new.invalid');
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const mcp=path.join(root,'.mcp.json'), toml=path.join(root,'.iris-agentic-dev.toml');
 const currentMcp=fs.readFileSync(mcp), currentToml=fs.readFileSync(toml), priorMcp=Buffer.from('{}\n');
 const receiptName=path.join('.ai-dev-config-backups',randomUUID(),'receipt.json');
 const receipt=JSON.stringify({schema:1,tool:'ai-dev-project',projectRoot:root,state:'prepared',entries:[
  {file:mcp,beforeHash:hash(priorMcp),afterHash:hash(currentMcp),original:priorMcp.toString('base64')},
  {file:toml,beforeHash:hash(currentToml),afterHash:hash(Buffer.concat([currentToml,Buffer.from('# other\n')])),original:currentToml.toString('base64')},
 ]});
 write(receiptName,receipt);
 const pending=api.plan(r);
 await assert.rejects(()=>api.apply(pending.planId),{code:'project-recovery-required'});
 assert.deepEqual(fs.readFileSync(mcp),currentMcp);
 assert.deepEqual(fs.readFileSync(toml),currentToml);
 assert.equal(fs.readFileSync(path.join(root,receiptName),'utf8'),receipt);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('a portable workbench does not register its own Node for a new managed MCP', {skip:process.platform!=='win32'}, t=>{
 const root=createTempDirectory('workbench-mcp-runtime-');
 t.after(()=>{assert.ok(ownsTempDirectory(root));fs.rmSync(root,{recursive:true,force:true,maxRetries:3});});
 const app=path.join(root,'工作台');
 const runtime=path.join(app,'runtime');
 const priorRuntime=path.join(root,'旧工作台','runtime');
 const independent=path.join(root,'独立 Node 安装');
 const project=path.join(root,'项目');
 const appNode=path.join(runtime,'node.exe');
 const hostNode=path.join(independent,'node.exe');
 for (const directory of [runtime,priorRuntime,independent]) fs.mkdirSync(directory,{recursive:true});
 for (const directory of [app,path.dirname(priorRuntime)]) fs.writeFileSync(path.join(directory,'workbench-release.json'),'{}');
 for (const node of [appNode,path.join(priorRuntime,'node.exe'),hostNode]) fs.copyFileSync(process.execPath,node);
 const scripts=path.join(project,'.agents','scripts');
 const config=path.join(project,'.agents','config');
 fs.mkdirSync(scripts,{recursive:true});
 fs.mkdirSync(config,{recursive:true});
 fs.writeFileSync(path.join(scripts,'iris-session-mcp.js'),'// local fixture only');
 fs.writeFileSync(path.join(config,'project-env.json'),JSON.stringify({iris:{host:'local.invalid',port:52773,
   namespace:'FIXTURE',scheme:'http',alias:'fixture',description:'',tlsVerify:false}}));

 const code=String.raw`
  const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
  const [, settings, project, prior, stable]=process.argv;
  const api=require(settings).createProjectSettings(project);
  const mcp=path.join(project,'.mcp.json');
  const plan=changes=>api.plan({revision:api.inspect().revision,changes});
  const read=()=>JSON.parse(fs.readFileSync(mcp,'utf8')).mcpServers['iris-agentic-dev'];
  const initial={username:{action:'replace',value:'fixture'},password:{action:'replace',value:'fixture-only'}};
  (async()=>{
   const packagePath=[path.dirname(process.execPath),prior].join(path.delimiter);
   process.env.PATH=packagePath;
   assert.throws(()=>plan(initial),/离线安装助手/);
   assert.ok(!fs.existsSync(mcp));
   process.env.PATH=[packagePath,path.dirname(stable)].join(path.delimiter);
   await api.apply(plan(initial).planId);
   assert.equal(read().command,stable);
   process.env.PATH=packagePath;
   await api.apply(plan({host:{value:'updated.invalid'}}).planId);
   assert.equal(read().command,stable);
   assert.equal(read().env.IRIS_HOST,'updated.invalid');
  })().catch(error=>{console.error(error);process.exitCode=1;});`;
 const result=spawnSync(appNode,['-e',code,require.resolve('./project-settings'),project,priorRuntime,hostNode],
   {encoding:'utf8',timeout:20000,windowsHide:true});
 assert.ifError(result.error);
 assert.equal(result.status,0,result.stderr);
 fs.renameSync(app,path.join(root,'工作台已移动'));
 const server=JSON.parse(fs.readFileSync(path.join(project,'.mcp.json'),'utf8')).mcpServers['iris-agentic-dev'];
 assert.equal(server.command,hostNode);
 const running=spawnSync(server.command,['--version'],{encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(running.status,0,running.stderr);
 assert.equal(running.stdout.trim(),process.version);
});
test('managed backend remains bound to the same adapter and new connection',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agents-workbench-managed-'));
 const write=(name,data)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data)};
 try{
 const entry={command:process.execPath,args:[path.join(root,'.agents/scripts/iris-session-mcp.js'),'--project-root',root,'--server-name','iris-agentic-dev']};
 const backend={schema:'iris-session-backend/v1',serverName:'iris-agentic-dev',command:'iris-agentic-dev.exe',args:['mcp','--host','old.invalid','--web-port','52773'],managedHash:require('node:crypto').createHash('sha256').update(JSON.stringify(entry)).digest('hex')};
 write('.mcp.json',JSON.stringify({mcpServers:{'iris-agentic-dev':{...entry,env:{IRIS_USERNAME:'fixture',IRIS_PASSWORD:'fixture-only'}}}}));
 write('.agents/config/iris-session-backend.json',JSON.stringify(backend));
 write('.agents/config/project-env.json','\uFEFF'+JSON.stringify({iris:{host:'old.invalid',port:52773,namespace:'USER',username:'fixture',password:'fixture-only',scheme:'http'},sftp:{password:'fixture-only'}},null,2).replace(/\n/g,'\r\n')+'\r\n');
 const api=createProjectSettings(root),p=api.plan({revision:api.inspect().revision,changes:{host:{value:'new.invalid'}}});await api.apply(p.planId);
 const saved=JSON.parse(fs.readFileSync(path.join(root,'.agents/config/iris-session-backend.json')));assert.equal(saved.managedHash,backend.managedHash);assert.ok(saved.args.includes('new.invalid'));
 const raw=fs.readFileSync(path.join(root,'.agents/config/project-env.json'),'utf8');assert.ok(raw.startsWith('\uFEFF'));assert.ok(raw.includes('\r\n'));assert.equal(JSON.parse(raw.slice(1)).sftp.password,'fixture-only');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
