const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {fork,spawnSync}=require('node:child_process');
const {once}=require('node:events');
const {createTempDirectory,ownsTempDirectory}=require('../../../scripts/tests/fixtures/temp-directory');
const {createProjectSettings}=require('./project-settings');
const configurationIO=require('../../../scripts/lib/configuration-file-io');
const environment=require('../../../scripts/lib/project-environment');
const {resolveWorkspaceContext}=require('../../../scripts/lib/workspace-context');

test('the root covers registered module connections, while an individual module can edit again',async t=>{
 const directory=createTempDirectory('workbench-batch-connections-');
 t.after(()=>{assert.ok(ownsTempDirectory(directory));fs.rmSync(directory,{recursive:true,force:true,maxRetries:3});});
 const root=path.join(directory,'Standard root');
 const cap=path.join(root,'.agents');
 const binding={central:true,vscode:true,mcp:true,toml:true};
 const serverName='iris-agentic-dev';
 const target=(host,alias)=>({host,alias,port:52773,scheme:'http',namespace:'FIXTURE',tlsVerify:false});
 const pair=host=>({username:'fixture',password:'fixture-'+host});
 const rootTarget=target('standard-first.invalid','initial');
 const firstTarget=target('module-drift.invalid','module-old');
 const secondTarget=target('personal.invalid','personal');
 const next=target('standard-next.invalid','next');
 const write=(at,file,data)=>{
   const targetFile=path.join(at,file);
   fs.mkdirSync(path.dirname(targetFile),{recursive:true});
   fs.writeFileSync(targetFile,typeof data==='string'?data:JSON.stringify(data,null,2));
 };
 const parse=(at,file)=>configurationIO.parse(fs.readFileSync(path.join(at,file),'utf8'));
 const git=(at,args,input)=>{
   const completed=spawnSync('git',['-C',at,...args],{input,encoding:'utf8',windowsHide:true});
   assert.equal(completed.status,0,completed.stderr||completed.error?.message);
   return completed.stdout.trim();
 };
 const writeBindings=(at,to)=>{
   const {username,password}=pair(to.host);
   write(at,'.mcp.json',{mcpServers:{[serverName]:{command:'iris-agentic-dev.exe',args:['mcp'],env:{
     IRIS_HOST:to.host,IRIS_WEB_PORT:String(to.port),IRIS_SCHEME:to.scheme,IRIS_NAMESPACE:to.namespace,
     IRIS_TLS_VERIFY:String(to.tlsVerify),IRIS_USERNAME:username,IRIS_PASSWORD:password}},unrelated:{command:'keep'}}});
   write(at,'.vscode/settings.json',{'objectscript.conn':{active:true,server:to.alias,ns:to.namespace},
     'intersystems.servers':{[to.alias]:{webServer:{host:to.host,port:to.port,scheme:to.scheme}}}});
   write(at,'.iris-agentic-dev.toml',`host = "${to.host}"\nweb_port = ${to.port}\nscheme = "${to.scheme}"\nnamespace = "${to.namespace}"\nusername = "${username}"\npassword = "${password}"\ntls_verify = false\n`);
 };
 const writeCentral=(at,to,services)=>{
   write(at,'.agents/config/project.jsonc',{irisConnections:{source:'project.jsonc',active:'current',serverName,bindings:binding,
     profiles:{current:{...to,credentialRef:'private:current'}}},...(services?{serviceConnections:services}:{})});
   write(at,'.agents/config/iris-profile-credentials.json',{current:pair(to.host)});
 };
 write(root,'.agents/scripts/update-agents.ps1','# Fixture capability\n');
 write(root,'.agents/scripts/lib/project-environment.js',fs.readFileSync(require.resolve('../../../scripts/lib/project-environment'),'utf8'));
 git(root,['init','-q']);
 git(cap,['init','-q']);
 git(cap,['config','--local','remote.origin.url','https://gitee.com/skyler-cook/imedical.agents.git']);
 const tree=git(cap,['mktree'],'');
 const revision=git(cap,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree],'Fixture capability\n');
 git(cap,['update-ref','HEAD',revision]);
 write(root,'.agents/.git/info/exclude','/config/\n');
 writeBindings(root,rootTarget);
 writeCentral(root,rootTarget,{web:{basePath:'/shared'},sftp:{enabled:false}});
 function member(name,to,rootFallback,local){
   const workspace=path.join(directory,name);
   const contextRoot=path.join(workspace,'.agents');
   fs.mkdirSync(path.join(contextRoot,'config'),{recursive:true});
   fs.symlinkSync(root,path.join(workspace,'backend'),process.platform==='win32'?'junction':'dir');
   write(workspace,'.agents/capability.json',{schemaVersion:1,mode:'workspace-overlay',workspace:name,contextRoot:'.agents',capabilityRoot:cap,
     sharedDirectories:[],localDirectories:['config'],sourceRoots:[{name:'backend',path:'backend',target:root,gitRoot:root}],
     ...(rootFallback?{projectEnvFallback:path.join(cap,'config/project-env.json')}:{})});
   git(workspace,['init','-q']);
   writeBindings(workspace,to);
   if(local) writeCentral(workspace,to,{web:{basePath:'/personal'}});
   return {workspace,contextRoot,lastRequired:[]};
 }
 const inherited=member('Inherited module',firstTarget,true,false);
 const personal=member('Personal module',secondTarget,true,true);
 const hospital=member('Outside connection scope',secondTarget,false,true);
 const userLevelVscode={'objectscript.conn':{server:'user-level',ns:'OLD',active:true},'editor.tabSize':2};
 write(inherited.workspace,'.vscode/settings.json',userLevelVscode);
 git(inherited.workspace,['add','--','.vscode/settings.json']);
 const vscodeFile=path.join(inherited.workspace,'.vscode/settings.json');
 const originalVscode=fs.readFileSync(vscodeFile);
 write(root,'.agents/.git/plugin-deployment.json',{schema:'plugin-installation/v1',mode:'full',installed:[],
   members:[inherited,personal,hospital].map(({contextRoot,lastRequired})=>({contextRoot,lastRequired}))});
 const api=createProjectSettings(root);
 const moduleApi=createProjectSettings(inherited.workspace);
 const create=(selected,id)=>({
   'irisConnections.new':{value:id},host:{value:selected.host},alias:{value:selected.alias},
   username:{action:'replace',value:pair(selected.host).username},password:{action:'replace',value:pair(selected.host).password},
 });
 const plan=(settings,changes)=>settings.plan({revision:settings.inspect().revision,changes});
 const choose=id=>({'irisConnections.active':{value:id}});
 const mcp=at=>parse(at,'.mcp.json').mcpServers;
 const host=at=>mcp(at)[serverName].env.IRIS_HOST;
 const central=at=>environment.read(resolveWorkspaceContext(at));
 assert.equal(api.inspect().overlayConnections.memberCount,2);
 assert.equal(moduleApi.inspect().overlayConnections.inherited,true);
 assert.equal(central(inherited.workspace).config.iris.host,rootTarget.host);
 assert.equal(host(inherited.workspace),firstTarget.host);
 const first=plan(api,create(next,'next'));
 assert.doesNotMatch(JSON.stringify(first),/fixture-standard-next/);
 assert.equal(host(root),rootTarget.host);
 await api.apply(first.planId);
 for(const at of [root,inherited.workspace,personal.workspace]){
   assert.equal(host(at),next.host);
   assert.equal(central(at).config.iris.host,next.host);
   assert.equal(mcp(at).unrelated.command,'keep');
 }
 assert.equal(central(inherited.workspace).inherited,true);
 assert.deepEqual(fs.readFileSync(vscodeFile),originalVscode);
 assert.equal(host(hospital.workspace),secondTarget.host);
 assert.equal(central(personal.workspace).config.web.basePath,'/personal');
 const individual=target('module-new.invalid','module-new');
 await moduleApi.apply(plan(moduleApi,create(individual,'module-new')).planId);
 assert.equal(central(inherited.workspace).config.iris.host,individual.host);
 assert.equal(central(inherited.workspace).config.web.basePath,'/shared');
 assert.equal(central(inherited.workspace).config.sftp.enabled,false);
 assert.equal(host(inherited.workspace),individual.host);
 assert.deepEqual(fs.readFileSync(vscodeFile),originalVscode);
 assert.equal(host(root),next.host);
 // Reapply the already active root profile so one diverged module can be converged.
 await api.apply(plan(api,choose('next')).planId);
 assert.equal(host(inherited.workspace),next.host);
 const stale=plan(api,choose('current'));
 fs.appendFileSync(path.join(personal.workspace,'.iris-agentic-dev.toml'),'\n# external edit\n');
 await assert.rejects(()=>api.apply(stale.planId));
 for(const at of [root,inherited.workspace,personal.workspace]) assert.equal(host(at),next.host);
 const broken=plan(api,choose('current'));
 await assert.rejects(()=>api.apply(broken.planId,{beforeWrite:file=>{
   if(file.startsWith(personal.workspace+path.sep)) throw Error('fixture failure');
 }}));
 for(const at of [root,inherited.workspace,personal.workspace]){
   assert.equal(host(at),next.host);
   assert.equal(central(at).config.iris.host,next.host);
 }

 // Exercise the same authenticated HTTP endpoints and staged entry the React editor uses.
 const app=process.env.WORKBENCH_CONNECTION_TEST_APP;
 const entry=app?path.join(app,'tools/agents-workbench/prototype/serve.js'):path.join(__dirname,'serve.js');
 const service=fork(entry,['--project',root],{silent:true,env:{...process.env,PORT:'0',GIT_ALLOW_PROTOCOL:''}});
 const exited=once(service,'exit');
 try {
   const [hello]=await once(service,'message',{signal:AbortSignal.timeout(15000)});
   const address=new URL(hello.address).origin;
   const headers={'X-Workbench-Request':'1','Content-Type':'application/json',Origin:address};
   const send=(endpoint,body)=>fetch(address+endpoint,{
     method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000),
   });
   const session=await send('/framework/session',{token:hello.bootstrap});
   assert.equal(session.status,200);
   headers.Cookie=session.headers.get('set-cookie').split(';')[0];
   headers['X-Workbench-CSRF']=(await session.json()).csrf;
   const model=await fetch(address+'/settings/project',{headers,signal:AbortSignal.timeout(10000)}).then(res=>res.json());
   assert.equal(model.overlayConnections.memberCount,2);
   const planned=await send('/framework/settings/plan/project',{revision:model.revision,changes:choose('current')});
   const preview=await planned.json();
   assert.equal(planned.status,200,preview.error);
   assert.deepEqual(preview.overlayConnections.names,['Inherited module','Personal module']);
   assert.ok(preview.warnings.some(warning=>warning.includes('VS Code')));
   assert.doesNotMatch(JSON.stringify(preview),/fixture-standard-first/);
   const applied=await send('/framework/settings/apply',{planId:preview.planId});
   assert.equal(applied.status,200,(await applied.json()).error);
   for(const at of [root,inherited.workspace,personal.workspace]) assert.equal(host(at),rootTarget.host);
   assert.equal(host(hospital.workspace),secondTarget.host);
 } finally {
   service.kill();
   await exited;
 }
});

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
