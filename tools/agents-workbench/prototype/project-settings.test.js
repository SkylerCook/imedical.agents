const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
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
 }finally{fs.rmSync(root,{recursive:true,force:true})}
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
