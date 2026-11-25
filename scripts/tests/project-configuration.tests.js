'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {test} = require('node:test');
const io = require('../lib/configuration-file-io');
const store = require('../lib/project-configuration');
const config = require('../lib/project-configuration-service');
const environment = require('../lib/project-environment');

function fixture(t) {
  const temporary = path.join(fs.realpathSync.native(os.tmpdir()),'Codex');
  fs.mkdirSync(temporary,{recursive:true});
  const root = fs.mkdtempSync(path.join(temporary,'project-configuration-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const context = require('../lib/workspace-context').resolveWorkspaceContext(root);
  const put = (file,value) => {
    const target = path.join(root,file);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,typeof value==='string' ? value : JSON.stringify(value));
  };
  const text = (file) => fs.readFileSync(path.join(root,file),'utf8');
  return {root,context,put,text};
}

test('normal migration previews without writing and retires equivalent legacy settings',t=>{
  const {root,context,put,text} = fixture(t);
  const main = '.agents/config/project.jsonc';
  put(main,'\uFEFF{\r\n  // User prose\r\n  "custom": true,\r\n  "plugins": {"coding-iris-plugin": {"status":"enabled"}}\r\n}\r\n');
  put('.agents/config/project_context_profile.md','# Notes\r\n- contextMode: codebase-complete\r\nKeep this note.\r\n');
  put('.agents/config/iris_project_profile.md','- 默认需求交付类型：standard\nOther project prose.\n');
  put('.agents/config/documentation-layout.json',{schema:'imedical-documentation-layout/v1',workspaceRoot:root,enabled:true,extensions:[]});
  const policy={schema:'iris-remote-policy/v1',enabled:false};
  put('.agents/config/iris-remote-policy.json',policy);
  put('.agents/config/menu-sync/test.json',{schema:'iris-menu-refresh/v1',sourceId:'test',allowMenuRead:true,groupFilter:'active',
    targetFingerprint:'target',methodSourceHash:'reviewed-method',maxRemovalRatio:0.1});
  const before = text(main);
  const previews = config.migrate(context,'DryRun');
  assert.equal(previews.length,4,JSON.stringify(previews));
  assert.ok(previews.every(value=>value.status==='planned'));
  assert.equal(text(main),before);
  assert.ok(!fs.existsSync(path.join(root,'.agents/config/.migrations')));
  const applied = config.migrate(context,'Write');
  assert.ok(applied.every(value=>value.status==='applied'),JSON.stringify(applied));
  const source = text(main);
  assert.match(source,/^\uFEFF/);
  assert.match(source,/\/\/ User prose\r\n/);
  assert.match(source,/\/\/.*当前工程/);
  assert.equal(store.contextMode(context.contextRoot),'codebase-complete');
  assert.equal(require('../../plugins/coding-iris-plugin/scripts/iris-tools/source-sync-core').demandKind(context).kind,'standard');
  assert.deepEqual(store.inspect(context,'irisRemotePolicy').value,policy);
  assert.equal(require('../lib/project-directories').configFor(context).enabled,true);
  assert.equal(require('../lib/project-menu-settings').inspect(context,'test').value.maxRemovalRatio,0.1);
  assert.match(text('.agents/config/project_context_profile.md'),/Keep this note/);
  assert.match(text('.agents/config/iris_project_profile.md'),/Other project prose/);
  for (const file of ['iris-remote-policy.json','documentation-layout.json','menu-sync/test.json']) {
    assert.equal(fs.existsSync(path.join(root,'.agents/config',file)),false);
    assert.ok(fs.existsSync(path.join(root,'.agents/config/.migrations',file)));
  }
  assert.deepEqual(config.migrate(context,'Write'),[]);
  assert.equal(text(main),source);
  const migration = require('../lib/project-configuration-migration');
  assert.equal(migration.restoreSection(context,'irisRemotePolicy','DryRun').status,'planned');
  assert.equal(text(main),source);
  assert.equal(migration.restoreSection(context,'irisRemotePolicy','Write').status,'restored');
  assert.equal(store.inspect(context,'irisRemotePolicy').canonical,false);
  assert.deepEqual(store.inspect(context,'irisRemotePolicy').value,policy);
  assert.ok(config.migrate(context,'Write').some(row=>row.id==='irisRemotePolicy' && row.status==='applied'));
});

test('framework CLI and workbench use the same validated field writes and detect stale plans',async t=>{
  const {root,context,put,text} = fixture(t);
  const main = '.agents/config/project.jsonc';
  put(main,'{ "projectContext": {"contextMode":"codebase-complete","custom":7} }\n');
  put('.agents/scripts/configure-agents.js','// Layout marker for the installed test fixture.');
  const workbench = require('../../tools/agents-workbench/prototype/project-settings').createProjectSettings(root);
  const cli = (...argv)=>JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../configure-agents.js'),...argv,root],{encoding:'utf8'}));
  const model = cli('read');
  assert.equal(model.revision,workbench.inspectManaged().revision);
  const stale = workbench.planManaged({revision:model.revision,edits:[{path:['projectContext','guidanceMode'],value:'assisted'}]});
  config.apply(context,{revision:model.revision,edits:[{path:['projectContext','guidanceMode'],value:'concise'}]});
  await assert.rejects(workbench.apply(stale.planId),/工程配置已变化/);
  const updated = workbench.inspectManaged();
  const payload = {revision:updated.revision,edits:[{path:['projectContext','contextMode'],value:'intent-first-on-demand-export'}]};
  const plan = workbench.planManaged(payload);
  assert.equal(store.contextMode(context.contextRoot),'codebase-complete');
  await workbench.apply(plan.planId);
  assert.equal(cli('read').sections.find(section=>section.id==='projectContext').value.contextMode,'intent-first-on-demand-export');
  assert.equal(io.parse(text(main)).projectContext.custom,7);
  assert.throws(()=>config.plan(context,{revision:config.read(context).revision,
    edits:[{path:['projectContext','contextMode'],value:'invalid'}]}),/invalid-project-config-value/);
});

for (const transport of [undefined,'atelier','sftp']) test('legacy environment preserves credentials and frontend transport: '+transport, t=>{
  const {root,context,put,text} = fixture(t);
  const host = 'first.invalid';
  const iris = {host,port:52773,namespace:'TEST',scheme:'https',username:'test-user',password:'fixture-only',tlsVerify:false};
  const legacy = {iris,mcp:{serverName:'iris-agentic-dev'},web:{basePath:'/fixture',cookie:'cookie-fixture'},
    sftp:{enabled:false,host:'sftp.invalid',password:'sftp-fixture'}};
  if (transport !== undefined) legacy.web.frontendTransport = transport;
  put('.agents/config/project-env.json',legacy);
  put('.mcp.json',{mcpServers:{'iris-agentic-dev':{command:'iris-agentic-dev',args:['mcp'],env:{
    IRIS_HOST:host,IRIS_WEB_PORT:'52773',IRIS_NAMESPACE:'TEST',IRIS_SCHEME:'https',
    IRIS_USERNAME:iris.username,IRIS_PASSWORD:iris.password,IRIS_TLS_VERIFY:'false'}},
    other:{command:'custom'}}});
  const projection = text('.mcp.json');
  const check = config.migrate(context,'DryRun');
  assert.deepEqual(check,[{id:'connections',source:'project-env.json',status:'planned'}]);
  assert.ok(!fs.existsSync(path.join(root,'.agents/config/project.jsonc')));
  const migration = config.migrate(context,'Write');
  assert.deepEqual(migration,[{id:'connections',source:'project-env.json',status:'applied'}]);
  const jsonc = text('.agents/config/project.jsonc');
  assert.doesNotMatch(jsonc,/fixture-only|test-user|cookie-fixture|sftp-fixture/);
  assert.match(jsonc,/credentialRef/);
  assert.equal(text('.mcp.json'),projection);
  const readback = environment.read(context);
  assert.equal(readback.config.iris.password,'fixture-only');
  assert.equal(readback.config.web.frontendTransport,transport);
  const deploy = require('../../plugins/coding-iris-plugin/scripts/iris-tools/deploy-protected');
  assert.equal(deploy.frontendTransport(readback.config),transport ?? 'sftp');
  assert.equal(readback.config.web.cookie,'cookie-fixture');
  assert.equal(readback.config.sftp.password,'sftp-fixture');
  assert.equal(require('../lib/iris-selected-target').selected(context,{requireBindings:true}).profile.host,host);
  assert.doesNotMatch(JSON.stringify(config.read(context)),/fixture-only|cookie-fixture|sftp-fixture/);
  assert.deepEqual(config.migrate(context,'Write'),[]);
});

test('plugin profile save accepts base64 stdin with or without a UTF-8 BOM', t=>{
  const {root,text} = fixture(t);
  const script = require.resolve('../lib/project-plugin-profile');
  for (const prefix of ['', '\uFEFF']) {
    const notes = prefix ? '带签名' : '无签名';
    const payload = {rows:{example:{status:'enabled',notes}}};
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    execFileSync(process.execPath,[script,'save',path.join(root,'.agents')],{input:prefix+encoded+'\r\n'});
    assert.equal(io.parse(text('.agents/config/project.jsonc')).plugins.example.notes,notes);
  }
});

test('conflicting legacy files only block the affected configuration',t=>{
  const {root,context,put,text} = fixture(t);
  const name = '.agents/config/iris-remote-policy.json';
  put(name,{schema:'iris-remote-policy/v1',enabled:false,maxFrameworkSessions:12});
  put('.agents/config/project.jsonc',{irisRemotePolicy:{schema:'iris-remote-policy/v1',enabled:false,maxFrameworkSessions:2}});
  put('.agents/config/project_context_profile.md','- contextMode: codebase-complete\n');
  const before = text(name);
  const rows = config.migrate(context,'Write');
  assert.equal(rows.find(row=>row.id==='irisRemotePolicy').status,'review-required');
  assert.equal(rows.find(row=>row.id==='projectContext').status,'applied');
  assert.equal(text(name),before);
  assert.ok(!fs.existsSync(path.join(root,'.agents/config/.migrations/iris-remote-policy.json')));
});

test('a fresh connection and two development profiles stay in JSONC and synchronize native formats',async t=>{
  const {root,context,put,text} = fixture(t);
  put('.agents/scripts/configure-agents.js','// Fixture framework marker.');
  put('.agents/config/project.jsonc','// Project fixture\n{}\n');
  execFileSync('git',['init','-q',context.contextRoot]);
  fs.appendFileSync(path.join(context.contextRoot,'.git/info/exclude'),'\n/config/\n');
  const owner = require('../../tools/ai-dev-offline/configure-project');
  const save = request => owner.apply({...request,fingerprint:owner.plan(request).fingerprint});
  const base = {host:'first.invalid',port:52773,namespace:'TEST',alias:'first',scheme:'http',tlsVerify:false};
  await save({projectRoot:root,connection:{...base,username:'fixture-user',password:'fixture-one',writeCredentials:true},configureMcp:true});
  assert.equal(environment.read(context).config.iris.host,base.host);
  assert.equal(fs.existsSync(path.join(context.contextRoot,'config/project-env.json')),false);
  const second = {...base,host:'second.invalid',alias:'second'};
  await save({projectRoot:root,profile:{id:'second',connection:second,credentials:{username:'fixture-user',password:'fixture-two'}}});
  assert.equal(owner.inspectProfiles({projectRoot:root}).active,'second');
  assert.equal(environment.read(context).config.iris.password,'fixture-two');
  await save({projectRoot:root,profile:{id:'second',edit:true,connection:{...second,port:52774}}});
  assert.equal(environment.read(context).config.iris.port,52774);
  const hosts = JSON.parse(text('.mcp.json')).mcpServers['iris-agentic-dev'].env;
  assert.equal(hosts.IRIS_HOST,second.host);
  assert.equal(hosts.IRIS_WEB_PORT,'52774');
  assert.match(text('.iris-agentic-dev.toml'),/web_port = 52774/);
  await save({projectRoot:root,profile:{id:'current'}});
  assert.equal(environment.read(context).config.iris.password,'fixture-one');
  assert.doesNotMatch(text('.agents/config/project.jsonc'),/fixture-one|fixture-two/);
});

test('Overlay connection setup writes its resolved ContextRoot and never alters CapabilityRoot configuration',async t=>{
  const {root,put,text} = fixture(t);
  const shared = path.join(root,'shared');
  put('shared/scripts/configure-agents.js','// Framework marker.');
  put('shared/config/project.jsonc','{"sharedOnly":true}\n');
  put('context/config/project.jsonc','{"workspaceOnly":true}\n');
  fs.mkdirSync(path.join(root,'code'));
  execFileSync('git',['init','-q',shared]);
  execFileSync('git',['init','-q',path.join(root,'code')]);
  put('.agents/capability.json',{schemaVersion:1,mode:'workspace-overlay',workspace:'member',contextRoot:'context',
    capabilityRoot:'shared',sharedDirectories:[],localDirectories:['config'],
    sourceRoots:[{name:'code',path:'code',target:'code',gitRoot:'code'}]});
  const owner = require('../../tools/ai-dev-offline/configure-project');
  const req = {projectRoot:root,configureMcp:true,connection:{host:'member.invalid',port:52773,namespace:'TEST',
    scheme:'http',alias:'member',tlsVerify:false,username:'fixture-user',password:'fixture-pass',writeCredentials:true}};
  await owner.apply({...req,fingerprint:owner.plan(req).fingerprint});
  assert.equal(io.parse(text('context/config/project.jsonc')).irisConnections.profiles.current.host,'member.invalid');
  assert.equal(text('shared/config/project.jsonc'),'{"sharedOnly":true}\n');
  assert.equal(fs.existsSync(path.join(root,'.agents/config/project.jsonc')),false);
  assert.equal(owner.inspectProfiles({projectRoot:root}).active,'current');
});

test('an independently edited Overlay IRIS profile can keep the declared root service configuration', t => {
  const {root,put} = fixture(t);
  const capabilityRoot = path.join(root,'standard','.agents');
  const context = {mode:'workspace-overlay',workspaceRoot:root,contextRoot:path.join(root,'.agents'),capabilityRoot,
    manifest:{projectEnvFallback:'standard/.agents/config/project-env.json'}};
  const profile = {host:'member.invalid',port:52773,scheme:'http',namespace:'TEST',credentialRef:'private:module'};
  const main = {irisConnections:{source:'project.jsonc',active:'module',profiles:{module:profile}}};
  put('standard/.agents/config/project-env.json',{
    iris:{host:'standard.invalid',port:52773,scheme:'http',namespace:'ROOT'},
    web:{basePath:'/shared',frontendTransport:'atelier'},sftp:{enabled:false},
  });
  put('.agents/config/project.jsonc',main);
  assert.equal(environment.read(context).config.web,undefined);
  main.irisConnections.inheritServices = true;
  put('.agents/config/project.jsonc',main);
  const result = environment.read(context);
  assert.equal(result.config.iris.host,'member.invalid');
  assert.equal(result.config.web.basePath,'/shared');
  assert.equal(result.config.web.frontendTransport,'atelier');
  assert.equal(result.config.sftp.enabled,false);
  assert.equal(result.inherited,false);
  assert.equal(environment.read(context,{inherit:false}).config.web,undefined);
  main.serviceConnections = {web:{basePath:'/module'}};
  put('.agents/config/project.jsonc',main);
  assert.equal(environment.read(context).config.web.basePath,'/module');
  context.manifest.projectEnvFallback = 'foreign/project-env.json';
  assert.throws(() => environment.read(context),/project-env-fallback-invalid/);
});
