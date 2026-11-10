'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const remote = require('../lib/iris-remote-operations');
const repo = path.resolve(__dirname, '../..');
const tools = 'plugins/coding-iris-plugin/scripts/iris-tools/';

function fixture(t) {
  const base = process.env.CODEX_TEST_TMP_ROOT || path.join(os.tmpdir(), 'Codex');
  fs.mkdirSync(base, {recursive: true});
  const root = fs.mkdtempSync(path.join(fs.realpathSync(base), 'iris-development-'));
  t.after(() => { assert.equal(path.dirname(root), fs.realpathSync(base)); fs.rmSync(root, {recursive: true, force: true}); });
  const context = {workspaceRoot:root, contextRoot:path.join(root, '.agents')};
  const config = path.join(context.contextRoot, 'config');
  fs.mkdirSync(config, {recursive:true});
  fs.mkdirSync(path.join(context.contextRoot, '.git'));
  const mode = value => fs.writeFileSync(path.join(config,'iris-development.json'), JSON.stringify(value));
  return {root, context, config, mode};
}
test('development mode is independent of contextMode and preserves missing declarations', t => {
  const f = fixture(t), input = {config:{a:1},mcp:{}};
  assert.equal(remote.developmentMode(f.context), 'connected');
  assert.strictEqual(remote.bindDevelopmentMode(f.context, input), input);
  f.mode({environmentAlias:'fixture',environmentType:'test'});
  assert.strictEqual(remote.bindDevelopmentMode(f.context, input), input);
  for (const contextMode of ['codebase-complete','intent-first-on-demand-export']) {
    fs.writeFileSync(path.join(f.config, 'project_context_profile.md'), '- contextMode: '+contextMode);
    f.mode({developmentMode:'offline'});
    assert.equal(remote.developmentMode(f.context), 'offline');
    assert.throws(()=>remote.assertRemoteAllowed(f.context), {code:'offline-development-remote-disabled'});
    assert.throws(()=>remote.loadRemotePolicy(f.context,{policy:{enabled:false}}), {code:'offline-development-remote-disabled'});
    f.mode({developmentMode:'connected'});
    assert.doesNotThrow(()=>remote.assertRemoteAllowed(f.context));
    assert.deepEqual(remote.bindDevelopmentMode(f.context, input), {...input, developmentMode:'connected'});
  }
});
test('invalid declarations fail closed without guessing another mode', t => {
  const f = fixture(t);
  for (const value of [null, [], {developmentMode:'auto'}, {developmentMode:false}, {developmentMode:'offline '}]) {
    f.mode(value);
    assert.throws(()=>remote.developmentMode(f.context), {code:'development-mode-invalid'});
  }
  fs.writeFileSync(path.join(f.config,'iris-development.json'), '{invalid');
  assert.throws(()=>remote.assertRemoteAllowed(f.context), {code:'development-mode-invalid'});
});
test('offline remote CLIs stop before connection config reads and client startup', t => {
  const f=fixture(t); f.mode({developmentMode:'offline'});
  const probe=path.join(f.root,'probe.cjs');
  fs.writeFileSync(probe, `const fs=require('node:fs'),cp=require('node:child_process');const read=fs.readFileSync;
fs.readFileSync=function(file,...args){if(/(?:project-env|\\.mcp)\\.json$/i.test(String(file)))process.exit(77);return read.call(this,file,...args);};
for(const key of ['spawn','spawnSync','execFile','execFileSync'])cp[key]=()=>{process.exit(78);};
for(const name of ['node:http','node:https','node:net']){const m=require(name);for(const key of ['request','get','connect','createConnection'])if(m[key])m[key]=()=>{process.exit(79);};}`);
  const entries=[
    ['scripts/iris-mcp.js',['check','--json']],
    ['scripts/iris-remote.js',['inspect','--project-root',f.root]],
    [tools+'compile.js',['--project-root',f.root,'--files','src/Sample.cls','--execute']],
    [tools+'compile-csp.js',['--project-root',f.root,'--documents','web/sample.csp','--execute']],
    [tools+'deploy-frontend.js',['--project-root',f.root,'--files','web/sample.js','--execute']],
    [tools+'deploy-frontend.js',['--project-root',f.root,'--files','web/sample.js']],
    [tools+'export.js',['Sample.cls']],
    [tools+'debugger.js',['--class','Sample','--method','Test']],
    [tools+'debugger.js',['--json','--stdin']],
    ['scripts/run-acceptance.js',['--profile','nonexistent.cjs']],
  ];
  for(const [file,args] of entries){
    const output=spawnSync(process.execPath,['--require',probe,path.join(repo,file),...args],{cwd:f.root,input:'{}',encoding:'utf8',windowsHide:true,timeout:10000});
    assert.equal(output.status,1,`${file}: ${output.stdout} ${output.stderr}`);
    assert.match(output.stderr+output.stdout,/offline-development-remote-disabled/,file);
  }
});
test('offline help, connection generation and local status do not need a hospital connection', t => {
  const f=fixture(t); f.mode({developmentMode:'offline'});
  for(const file of ['scripts/iris-mcp.js',tools+'compile.js',tools+'compile-csp.js',tools+'deploy-frontend.js']){
    const r=spawnSync(process.execPath,[path.join(repo,file),'--help'],{cwd:f.root,encoding:'utf8',windowsHide:true});
    assert.equal(r.status,0,`${file}: ${r.stderr}`);
  }
  const status=spawnSync(process.execPath,[path.join(repo,'scripts/iris-remote.js'),'status','--project-root',f.root],{encoding:'utf8',windowsHide:true});
  assert.equal(status.status,0,status.stderr); assert.equal(JSON.parse(status.stdout).status,'unconfigured');
  fs.writeFileSync(path.join(f.config,'iris-remote-policy.json'),JSON.stringify({schema:'iris-remote-policy/v1',enabled:false,coordinationRoot:path.join(f.root,'coordination'),poolKey:'fixture'}));
  const reconcile=spawnSync(process.execPath,[path.join(repo,'scripts/iris-remote.js'),'reconcile','--project-root',f.root],{encoding:'utf8',windowsHide:true});
  assert.equal(reconcile.status,1);
  assert.doesNotMatch(reconcile.stderr,/offline-development-remote-disabled/);
  assert.match(reconcile.stderr,/remote-reconcile-confirmation-required/);
  const generated=spawnSync(process.execPath,[path.join(repo,tools+'sync-env-config.js')],{cwd:f.root,encoding:'utf8',windowsHide:true});
  assert.equal(generated.status,0,generated.stderr); assert.equal(JSON.parse(generated.stdout).status,'skipped-offline');
  assert.equal(fs.existsSync(path.join(f.root,'.mcp.json')),false);
  assert.equal(require('../../plugins/coding-iris-plugin/scripts/iris-tools/sftp-config').migrate(f.root,f.context.contextRoot,repo,'Write')[0].status,'config-migration-skipped');
});
test('offline injected transports and direct publication checks cannot bypass the mode guard', async t => {
  const f=fixture(t);f.mode({developmentMode:'offline'});
  let reads=0;const connection=new Proxy({}, {get(){reads++;throw new Error('connection-read');}});
  for(const action of [
    ()=>require('../lib/atelier-client').createAtelierClient({context:f.context,connection}),
    ()=>require('../lib/atelier-client').createAtelierRecoveryReader({context:f.context,connection}),
    ()=>require('../lib/atelier-read-pool').createAtelierReadPool({context:f.context,connection}),
    ()=>require('../../plugins/coding-iris-plugin/scripts/iris-tools/xml-export-core').createTransport({},f.context,{config:connection,client:connection,skipQualification:true}),
    ()=>require('../../plugins/coding-iris-plugin/scripts/iris-tools/source-publication').required(f.context,{}),
  ])assert.throws(action,{code:'offline-development-remote-disabled'});
  await assert.rejects(require('../iris-mcp').createManagedMcpSession({context:f.context}),{code:'offline-development-remote-disabled'});
  assert.equal(reads,0);
});
test('switching offline preserves unknown coordination state and existing locks', t => {
  const f=fixture(t), policy={schema:'iris-remote-policy/v1',enabled:true,coordinationRoot:path.join(f.root,'coordination'),poolKey:'fixture',qualification:{status:'verified',reference:'evidence.json'}};
  fs.writeFileSync(path.join(f.root,'evidence.json'),'{}');
  fs.writeFileSync(path.join(f.config,'iris-remote-policy.json'),JSON.stringify(policy));
  const selected=remote.loadRemotePolicy(f.context,{policy}),owner=remote.createRemoteOperation({policy:selected,connection:{host:'fixture.invalid',port:443}});
  owner.markUnknown('fixture-unknown'); owner.close();
  const before=remote.poolStatus({policy:selected}); f.mode({developmentMode:'offline'});
  const after=remote.localPoolStatus(f.context);
  assert.equal(after.status,before.status); assert.equal(after.reconciliationToken,before.reconciliationToken);
  assert.throws(()=>remote.loadRemotePolicy(f.context,{policy}),{code:'offline-development-remote-disabled'});
  assert.deepEqual(remote.poolStatus({policy:selected}),before);
});
