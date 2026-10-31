'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {createTempDirectory,ownsTempDirectory}=require('./fixtures/temp-directory');
const {migrate}=require('../lib/iris-session-migration');
function fixture(t){
  const root=createTempDirectory('iris-session-migration-');
  spawnSync('git',['init','-q',root]);fs.writeFileSync(path.join(root,'.gitignore'),'.mcp.json\n.agents/\n');
  fs.mkdirSync(path.join(root,'.agents/scripts'),{recursive:true});fs.writeFileSync(path.join(root,'.agents/scripts/iris-session-mcp.js'),'');
  const executable=path.join(root,'.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe');
  fs.mkdirSync(path.dirname(executable),{recursive:true});fs.writeFileSync(executable,'fixture');
  const config={mcpServers:{'iris-agentic-dev':{command:executable,args:['mcp','--no-skills'],env:{IRIS_HOST:'example.invalid',IRIS_PASSWORD:'private-sample',IRIS_NAMESPACE:'TEST',IRIS_WEB_PORT:'443'}},other:{command:'keep'}}};
  const file=path.join(root,'.mcp.json');fs.writeFileSync(file,JSON.stringify(config));
  t.after(()=>{if(ownsTempDirectory(root))fs.rmSync(root,{recursive:true});});
  return {root,file,config};
}
test('dry run, write, repeated update, Check and rollback preserve credentials and other servers',t=>{
  const f=fixture(t),original=fs.readFileSync(f.file,'utf8');
  assert.equal(migrate({projectRoot:f.root}).status,'planned');assert.equal(fs.readFileSync(f.file,'utf8'),original);
  assert.throws(()=>migrate({projectRoot:f.root,mode:'Check'}),/direct-entry/);
  assert.equal(migrate({projectRoot:f.root,mode:'Write'}).status,'applied');
  const updated=JSON.parse(fs.readFileSync(f.file,'utf8'));assert.deepEqual(updated.mcpServers.other,f.config.mcpServers.other);
  assert.deepEqual(updated.mcpServers['iris-agentic-dev'].env,f.config.mcpServers['iris-agentic-dev'].env);
  assert.equal(migrate({projectRoot:f.root,mode:'Check'}).managed,true);
  assert.equal(migrate({projectRoot:f.root,mode:'Write'}).status,'unchanged');
  assert.equal(fs.readFileSync(path.join(f.root,'.agents/config/iris-session-backend.json'),'utf8').includes('private-sample'),false);
  migrate({projectRoot:f.root,mode:'Rollback'});assert.deepEqual(JSON.parse(fs.readFileSync(f.file,'utf8')),f.config);
});
test('updates and rollback preserve private cookie format bindings byte for byte',t=>{
  const f=fixture(t),directory=path.join(f.root,'.agents/config');
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'iris-remote-policy.json');
  const original=JSON.stringify({schema:'iris-remote-policy/v1',enabled:true,
    poolKey:'fixture-cookie-policy',coordinationRoot:path.join(f.root,'coordination'),maxConcurrent:1,
    qualification:{status:'pending'},sessionCookieFormat:'csp50-v1',
    sessionCookieFormatInstance:require('../lib/iris-remote-operations').instanceIdentity(f.config.mcpServers['iris-agentic-dev'].env)},null,2)+'\n';
  fs.writeFileSync(file,original);
  for(const mode of ['DryRun','Write','Check','Write','Rollback']) {
    migrate({projectRoot:f.root,mode});
    assert.equal(fs.readFileSync(file,'utf8'),original,mode+' must not rewrite private policy');
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)),f.config);
});

test('custom entries and rollback drift stop without replacing user changes',t=>{
  const f=fixture(t);f.config.mcpServers['iris-agentic-dev'].command='custom';fs.writeFileSync(f.file,JSON.stringify(f.config));
  assert.throws(()=>migrate({projectRoot:f.root,mode:'Write'}),/custom-command/);
  f.config.mcpServers['iris-agentic-dev'].command=path.join(f.root,'.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe');fs.writeFileSync(f.file,JSON.stringify(f.config));
  migrate({projectRoot:f.root,mode:'Write'});const changed=JSON.parse(fs.readFileSync(f.file,'utf8'));changed.mcpServers['iris-agentic-dev'].args.push('--changed');fs.writeFileSync(f.file,JSON.stringify(changed));
  assert.throws(()=>migrate({projectRoot:f.root,mode:'Rollback'}),/rollback-drift/);
});

test('Overlay migrates a mapped vendor into shared capability while keeping local recovery',t=>{
  const f=fixture(t),capability=path.join(f.root,'capability'),context=path.join(f.root,'.agents');
  fs.mkdirSync(capability);fs.mkdirSync(path.join(capability,'.git'));
  for(const name of ['vendor','scripts'])fs.renameSync(path.join(context,name),path.join(capability,name));
  fs.symlinkSync(path.join(capability,'vendor'),path.join(context,'vendor'),process.platform==='win32'?'junction':'dir');
  fs.writeFileSync(path.join(context,'capability.json'),JSON.stringify({schemaVersion:1,mode:'workspace-overlay',workspace:'fixture',contextRoot:'.agents',capabilityRoot:'capability',sharedDirectories:['vendor'],localDirectories:['config'],sourceRoots:[]}));
  const before=fs.readFileSync(f.file,'utf8');
  assert.equal(migrate({projectRoot:f.root}).status,'planned');assert.equal(fs.readFileSync(f.file,'utf8'),before);
  assert.equal(migrate({projectRoot:f.root,mode:'Write'}).status,'applied');
  const server=JSON.parse(fs.readFileSync(f.file)).mcpServers['iris-agentic-dev'];
  assert.equal(server.args[0],path.join(capability,'scripts/iris-session-mcp.js'));
  assert.equal(fs.existsSync(path.join(capability,'config/iris-session-backend.json')),false);
  assert.equal(migrate({projectRoot:f.root,mode:'Check'}).managed,true);
  migrate({projectRoot:f.root,mode:'Rollback'});assert.deepEqual(JSON.parse(fs.readFileSync(f.file)),f.config);
});

test('missing backend fails Check and explicit disabled survives migration',t=>{
  const f=fixture(t);f.config.mcpServers['iris-agentic-dev'].disabled=true;fs.writeFileSync(f.file,JSON.stringify(f.config));
  const directory=path.join(f.root,'.agents/config');fs.mkdirSync(directory,{recursive:true});
  const policy={schema:'iris-remote-policy/v1',enabled:false,poolKey:'fixture',coordinationRoot:path.join(f.root,'old-coordination'),qualification:{status:'pending'}};
  fs.writeFileSync(path.join(directory,'iris-remote-policy.json'),JSON.stringify(policy));
  migrate({projectRoot:f.root,mode:'Write'});
  assert.equal(JSON.parse(fs.readFileSync(f.file)).mcpServers['iris-agentic-dev'].disabled,true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'iris-remote-policy.json'))),policy);
  fs.unlinkSync(f.config.mcpServers['iris-agentic-dev'].command);
  assert.throws(()=>migrate({projectRoot:f.root,mode:'Check'}),/backend-missing/);
});

test('identical verified vendor copies share identity across projects and env key order',t=>{
  const a=fixture(t),b=fixture(t),describe=require('../lib/iris-session-backends').describe;
  const sha256=require('node:crypto').createHash('sha256').update('fixture').digest('hex');
  for(const f of [a,b])fs.writeFileSync(path.join(f.root,'.agents/vendor/iris-agentic-dev/managed-build.json'),JSON.stringify({schema:'iris-managed-vendor/v1',patch:'managed-sessions-v1',sha256}));
  b.config.mcpServers['iris-agentic-dev'].env=Object.fromEntries(Object.entries(b.config.mcpServers['iris-agentic-dev'].env).reverse());
  fs.writeFileSync(b.file,JSON.stringify(b.config));
  assert.equal(describe(a.root).identity,describe(b.root).identity);
  b.config.mcpServers['iris-agentic-dev'].env.IRIS_PASSWORD='another-identity';fs.writeFileSync(b.file,JSON.stringify(b.config));
  assert.notEqual(describe(a.root).identity,describe(b.root).identity);
});

test('Windows PowerShell 5.1 wrapper and vendor preference retain the managed adapter',{skip:process.platform!=='win32'},t=>{
  const f=fixture(t);migrate({projectRoot:f.root,mode:'Write'});const before=fs.readFileSync(f.file,'utf8');
  for(const script of ['plugins/coding-iris-plugin/scripts/migrate-session-config.ps1','scripts/prefer-vendor-iris-mcp.ps1']) {
    const result=spawnSync('powershell.exe',['-NoProfile','-File',path.resolve(script),'-ProjectRoot',f.root,'-Mode','DryRun'],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
    if(script.includes('migrate-session'))assert.doesNotThrow(()=>JSON.parse(result.stdout));
    else assert.match(result.stdout,/managed-entry-preserved/);
  }
  assert.equal(fs.readFileSync(f.file,'utf8'),before);
});

test('configuration regeneration preserves adapter, unrelated services and disabled state',t=>{
  const f=fixture(t);f.config.mcpServers['iris-agentic-dev'].disabled=true;fs.writeFileSync(f.file,JSON.stringify(f.config));
  migrate({projectRoot:f.root,mode:'Write'});
  const managed=JSON.parse(fs.readFileSync(f.file)).mcpServers['iris-agentic-dev'];
  const context=require('../lib/workspace-context').resolveWorkspaceContext(f.root);
  const generated={mcpServers:{'iris-agentic-dev':{...f.config.mcpServers['iris-agentic-dev'],disabled:false,args:['mcp'],env:{IRIS_NAMESPACE:'NEXT'}}}};
  require('../lib/iris-session-migration').writeGenerated({context,config:generated});
  const after=JSON.parse(fs.readFileSync(f.file));
  assert.deepEqual(after.mcpServers.other,f.config.mcpServers.other);
  assert.equal(after.mcpServers['iris-agentic-dev'].disabled,true);
  assert.equal(after.mcpServers['iris-agentic-dev'].command,managed.command);
  assert.deepEqual(after.mcpServers['iris-agentic-dev'].args,managed.args);
  assert.equal(after.mcpServers['iris-agentic-dev'].env.IRIS_PASSWORD,'private-sample');
  assert.equal(after.mcpServers['iris-agentic-dev'].env.IRIS_NAMESPACE,'NEXT');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(context.contextRoot,'config/iris-session-backend.json'))).args,['mcp']);
});
