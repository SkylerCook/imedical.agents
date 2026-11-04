'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { spawnSync } = require('node:child_process');
const remote = require('../lib/iris-remote-operations');
const { createAtelierClient, createAtelierRecoveryReader } = require('../lib/atelier-client');
const {createTempDirectory} = require('./fixtures/temp-directory');

function fixture(t, onDemand = false) {
  const root = createTempDirectory('iris-remote-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const context = { workspaceRoot: root, contextRoot: path.join(root, '.agents') };
  fs.mkdirSync(path.join(context.contextRoot, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'qualification.json'), '{"synthetic":true}\n');
  if (onDemand) fs.writeFileSync(path.join(context.contextRoot, 'config/project_context_profile.md'), '- contextMode：intent-first-on-demand-export\n');
  const policy = { schema: 'iris-remote-policy/v1', enabled: true, coordinationRoot: path.join(root, 'coordination'), poolKey: 'synthetic', qualification: { status: 'verified', reference: 'qualification.json' } };
  const connection = { protocol: 'https:', hostname: 'synthetic.invalid', port: 443, path: '/api/atelier/v1/TEST/', rejectUnauthorized: true };
  return { root, context, policy, connection, selected: () => remote.loadRemotePolicy(context, { policy, connection }) };
}

test('managed write risk has one durable owner and recovery does not require logout success', async t => {
  const f = fixture(t), {SessionManager} = require('../lib/iris-session-manager');
  const scope = require('../lib/iris-operation-scope').makeScope(f.connection,['Demo.A.cls']);
  let fail = true, sends = 0;
  const manager = new SessionManager({directory:path.join(f.root,'sessions'), open:async operation => {
    const owner = remote.createRemoteOperation({policy:f.policy,connection:f.connection,writeRiskOwner:'session-manager',writeRiskFile:operation.writeRiskFile});
    owner.acquire();
    return {call:op => owner.run(op, async () => {
      sends++;
      const file = path.join(f.policy.coordinationRoot,fs.readdirSync(f.policy.coordinationRoot)[0],'state.json');
      // Crash recovery must not manufacture a second record from delegated intent.
      assert.equal(require('../lib/iris-operation-scope').pendingWrites(JSON.parse(fs.readFileSync(file))).length,0);
      if (fail) {fail=false; throw new Error('synthetic connection lost');}
      return 'ok';
    }),close:async () => {owner.markUnknown('mcp-process-exit-unverified');return owner.close({processExited:true,cleanupVerified:false});}};
  }});
  t.after(()=>manager.stop());
  const call = effects => manager.submit({pool:'pool',identity:'identity',client:'test',operation:{effects,scope}});
  await assert.rejects(call('write'),/synthetic connection lost/);
  assert.equal(remote.poolStatus({policy:f.policy}).unresolvedWrites.length,0);
  assert.equal(manager.status()[0].unresolvedWrites.length,1);
  const independent=remote.createRemoteOperation({policy:f.policy,connection:f.connection});
  await assert.rejects(independent.run({effects:'write',scope},async()=>assert.fail('conflicting write sent')),/session-write-conflict-unresolved/);
  assert.equal(await independent.run({effects:'read-only',scope},async()=>'read'),'read');
  independent.close();
  await assert.rejects(call('write'),/session-write-conflict-unresolved/);
  assert.equal(sends,1);
  assert.equal(await call('read-only'),'ok');
  await manager.close('pool');
  const state=manager.status()[0];
  manager.reconcile('pool',{confirm:true,token:state.reconciliationToken,evidence:{reference:'synthetic',processExited:true,cleanupVerified:false},writeOutcome:'verified-not-applied'});
  assert.equal(manager.status()[0].warning.reason,'session-logout-unverified');
  assert.equal(await call('write'),'ok');
  assert.equal(sends,3);
  await manager.stop();
  const resumed=remote.createRemoteOperation({policy:f.policy,connection:f.connection});
  assert.equal(await resumed.run({effects:'write',scope},async()=>'resumed'),'resumed');
  resumed.close();
});

test('cookie renewal does not turn a rejected PUT into an unknown write', async t => {
  const f=fixture(t), http=require('node:http'); let puts=0;
  const server=http.createServer((req,res)=>{
    req.resume();
    if(req.method==='HEAD'){res.writeHead(200);res.end('{}');return;}
    res.setHeader('Set-Cookie','CSPSESSIONID='+(req.method==='PUT'?'replacement':'original')+'; Path=/');
    if(req.method==='PUT'){puts++;res.writeHead(405);res.end('{}');return;}
    res.end(JSON.stringify({result:{content:[]}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const connection={...f.connection,protocol:'http:',hostname:'127.0.0.1',port:server.address().port};
  const client=createAtelierClient({connection,context:f.context,policy:f.policy});
  t.after(async()=>{await client.close();await new Promise(resolve=>server.close(resolve));});
  await client.request('GET','probe');
  await assert.rejects(client.writeDocument('Demo.A.cls','Class Demo.A {}'),e=>e.status===405 && !e.sessionUncertain && e.writeOutcome==='rejected');
  await client.close();
  assert.equal(puts,1);
  const state=remote.poolStatus({policy:f.policy});
  assert.equal(state.unresolvedWrites.length,0);
  assert.equal(state.ownerPresent,false);
  assert.equal(state.warning,null);
});
test('ordinary Atelier reads uploads and compilation accept pending registration and rotating cookies', async t => {
  const f=fixture(t), http=require('node:http'), requests=[];
  f.policy.qualification={status:'pending',reference:'missing.json'};
  const server=http.createServer((req,res)=>{
    req.resume();
    requests.push({method:req.method,authenticated:!!req.headers.authorization,cookie:req.headers.cookie});
    if(req.method!=='HEAD')res.setHeader('Set-Cookie','CSPSESSIONID=token-'+requests.length+'; Path=/');
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({result:{name:'Demo.A.cls',content:[],ts:'2026-01-01 00:00:00'}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const connection={...f.connection,protocol:'http:',hostname:'127.0.0.1',port:server.address().port,username:'synthetic',password:'synthetic'};
  const client=createAtelierClient({connection,context:f.context,policy:f.policy});
  t.after(async()=>{try {await client.close();} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});
  await client.readDocument('Demo.A.cls');
  await client.writeDocument('Demo.A.cls','Class Demo.A {}');
  await client.compile(['Demo.A.cls']);
  await client.readDocument('Demo.A.cls');
  assert.deepEqual(requests.map(r=>r.method),['GET','PUT','POST','GET']);
  assert.equal(requests.filter(r=>r.authenticated).length,1);
  assert.equal(requests[3].cookie,'CSPSESSIONID=token-3');
  await client.close();
  assert.equal(remote.poolStatus({policy:f.policy}).unresolvedWrites.length,0);
});

test('on-demand policy fails closed before a remote request and legacy remains compatible', t => {
  const f = fixture(t, true);
  const {normalizeConnection} = require('../lib/atelier-client');
  const connection = {...f.connection}; delete connection.rejectUnauthorized;
  assert.equal(normalizeConnection(connection).rejectUnauthorized, false);
  assert.equal(normalizeConnection({...connection,tlsVerify:false}).rejectUnauthorized, false);
  assert.equal(normalizeConnection({...connection,rejectUnauthorized:true,tlsVerify:false}).rejectUnauthorized, true);
  assert.throws(() => remote.loadRemotePolicy(f.context, { connection: f.connection }), /remote-policy-required/);
  assert.equal(remote.loadRemotePolicy(f.context, { connection: { ...f.connection, rejectUnauthorized: false }, policy: f.policy }).enabled, true);
  assert.equal(remote.loadRemotePolicy(f.context, { connection: f.connection, policy: f.policy }).enabled, true);
  assert.throws(() => remote.loadRemotePolicy(f.context, { connection: { ...f.connection, protocol: 'http:' }, policy: f.policy }), /remote-strict-tls-required/);
  assert.throws(() => remote.loadRemotePolicy(f.context, { connection: f.connection, policy: { ...f.policy, maxConcurrent: 2 } }), /remote-policy-invalid/);
  assert.equal(remote.loadRemotePolicy({ contextRoot: path.join(f.root, 'legacy') }).enabled, false);
});

test('local status and reconciliation honor the configured MCP server name without connecting', t => {
  for (const name of ['iris-agentic-dev', 'custom-iris']) {
    const f = fixture(t), policy = f.selected();
    fs.mkdirSync(path.join(f.context.contextRoot,'.git'));
    fs.writeFileSync(path.join(f.context.contextRoot,'config/project-env.json'),JSON.stringify({mcp:{serverName:name},iris:{host:'synthetic.invalid',port:443,scheme:'https'}}));
    fs.writeFileSync(path.join(f.context.contextRoot,'config/iris-remote-policy.json'),JSON.stringify(f.policy));
    fs.writeFileSync(path.join(f.root,'.mcp.json'),JSON.stringify({mcpServers:{[name]:{env:{IRIS_HOST:'synthetic.invalid',IRIS_WEB_PORT:'443',IRIS_SCHEME:'https'}}}}));
    const owner = remote.createRemoteOperation({policy,connection:f.connection}); owner.markUnknown('synthetic-local-check'); owner.close();
    const run = args => spawnSync(process.execPath,[path.resolve(__dirname,'../iris-remote.js'),...args,'--project-root',f.root],{encoding:'utf8',windowsHide:true,timeout:10000});
    const status = run(['status']); assert.equal(status.status,0,status.stderr);
    const value = JSON.parse(status.stdout); assert.equal(value.status,'reconciliation-required');
    const reconciled = run(['reconcile','--confirm','--token',value.reconciliationToken,'--evidence',path.join(f.root,'qualification.json'),'--write-outcome','verified-not-applied']);
    assert.equal(reconciled.status,0,reconciled.stderr); assert.equal(JSON.parse(reconciled.stdout).status,'reconciled');
  }
});

test('on-demand project standalone CSP compilation stops before connection while reviewed internal client remains usable', async t => {
  const f = fixture(t, true), csp = require('../../plugins/coding-iris-plugin/scripts/iris-tools/compile-csp');
  fs.mkdirSync(path.join(f.context.contextRoot, '.git'));
  fs.writeFileSync(path.join(f.context.contextRoot, 'config/iris_project_profile.md'), '- 默认需求交付类型：project\n');
  let calls = 0;
  const deployment = csp.plan(['web/csp/a.csp'], 'web/csp');
  const client = {async compile() { calls++; return {status: {errors: []}, result: {content: []}, console: []}; }};
  await assert.rejects(csp.compile(f.connection, deployment, 100, {context: f.context}), {code: 'on-demand-managed-compile-required'});
  await assert.rejects(csp.compile(f.connection, deployment, 100, {context: f.context, client}), {code: 'on-demand-managed-compile-required'});
  assert.equal(calls, 0);
  assert.equal((await csp.compile(f.connection, deployment, 100, {context: f.context, client, reviewedDeployment: true})).status, 'compiled');
  assert.equal(calls, 1);
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../plugins/coding-iris-plugin/scripts/iris-tools/compile-csp.js'), '--project-root', f.root, '--documents', 'web/csp/a.csp', '--execute'], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).reason, 'on-demand-managed-compile-required');
});
test('pool admission excludes another process and does not steal interrupted ownership', async t => {
  const f = fixture(t), moduleFile = path.resolve(__dirname, '../lib/iris-remote-operations');
  const code = `const r=require(${JSON.stringify(moduleFile)});const o=r.createRemoteOperation(${JSON.stringify({ policy: f.selected(), connection: f.connection })});o.acquire();process.stdout.write('ready\\n');process.stdin.resume();`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', () => reject(Error('Child exited before acquiring'))); });
  const other = () => remote.createRemoteOperation({ policy: f.selected(), connection: f.connection }).acquire();
  assert.throws(other, /remote-pool-busy-or-unresolved/);
  child.kill(); await new Promise(resolve => child.once('exit', resolve));
  assert.throws(other, /remote-pool-busy-or-unresolved/);
});
test('503 opens a persistent circuit and unknown writes keep reconciliation evidence', async t => {
  const f = fixture(t), owner = remote.createRemoteOperation({ policy: f.selected(), connection: f.connection });
  await assert.rejects(owner.run({}, async () => { throw Object.assign(Error('unavailable'), { status: 503 }); }));
  assert.equal(owner.close().status, 'circuit-open');
  assert.throws(() => remote.createRemoteOperation({ policy: f.selected(), connection: f.connection }).acquire(), /cooling-down/);
  const second = fixture(t), writer = remote.createRemoteOperation({ policy: second.selected(), connection: second.connection });
  await assert.rejects(writer.run({ effects: 'write' }, async () => { throw Error('timeout'); }));
  assert.equal(writer.close().status, 'reconciliation-required');
});
test('same pool can share only explicitly mapped instances', t => {
  const f = fixture(t), first = remote.createRemoteOperation({ policy: f.selected(), connection: f.connection }); first.acquire(); first.close();
  const connection = { ...f.connection, hostname: 'other.invalid' };
  const policy = remote.loadRemotePolicy(f.context, { policy: f.policy, connection });
  assert.throws(() => remote.createRemoteOperation({ policy, connection }).acquire(), /identity-mismatch/);
  const shared = remote.createRemoteOperation({ policy: { ...policy, allowSharedPool: true }, connection }); shared.acquire(); shared.close();
});
test('local reconciliation requires current token, evidence, no live owner and a known write outcome', async t => {
  const f = fixture(t), policy = f.selected(), owner = remote.createRemoteOperation({policy, connection:f.connection});
  owner.acquire();
  const evidenceFile = path.join(f.root,'recovery.json'); fs.writeFileSync(evidenceFile,'{"syntheticRecovery":true}');
  let status = remote.poolStatus({policy});
  assert.throws(() => remote.reconcileRemotePool({policy,token:status.reconciliationToken,evidenceFile,confirm:true}), /owner-still-live/);
  await assert.rejects(owner.run({effects:'write'},async()=>{throw Error('unknown');})); owner.close();
  status = remote.poolStatus({policy});
  assert.throws(() => remote.reconcileRemotePool({policy,token:status.reconciliationToken,evidenceFile,confirm:true}), /write-reconciliation-required/);
  assert.throws(() => remote.reconcileRemotePool({policy,token:'0'.repeat(64),evidenceFile,confirm:true,writeOutcome:'verified-not-applied'}), /state-changed/);
  assert.equal(remote.reconcileRemotePool({policy,token:status.reconciliationToken,evidenceFile,confirm:true,writeOutcome:'verified-not-applied'}).status,'reconciled');
  const next=remote.createRemoteOperation({policy,connection:f.connection});next.acquire();next.close();
});
test('Atelier reuses cookies, preserves bytes, conditionals and owns only its logout', async t => {
  const events = [], value = '\uFEFFvar text = "中文";\r\n';
  const server = require('node:http').createServer((req, res) => {
    events.push({ method: req.method, cookie: req.headers.cookie, auth: req.headers.authorization, path: req.url });
    if (req.url.includes('CacheLogout')) { res.writeHead(401); res.end(); return; }
    res.setHeader('Set-Cookie', 'CSPSESSIONID=synthetic; Path=/gateway/api/atelier/; HttpOnly');
    res.end(JSON.stringify({ status: { errors: [] }, result: { content: value.split('\n'), ts: '2026-10-24 01:02:03.000', db: '@FS', enc: false } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = createAtelierClient({ connection: { protocol: 'http:', hostname: '127.0.0.1', port: server.address().port, path: '/gateway/api/atelier/v1/TEST/', auth: 'test:fake' } });
  const doc = await client.readDocument('web/scripts/test.js');
  assert.deepEqual(doc.content, Buffer.from(value));
  await client.writeDocument('web/scripts/test.js', doc.bytes, { ts: doc.ts });
  const receipt = await client.close();
  assert.equal(events[0].cookie, undefined); assert.equal(events[0].auth, 'Basic ' + Buffer.from('test:fake').toString('base64'));
  assert.equal(events[0].path, '/gateway/api/atelier/v1/TEST/doc/web%2Fscripts%2Ftest.js');
  assert.equal(events[1].cookie, 'CSPSESSIONID=synthetic'); assert.equal(events[1].auth, undefined);
  assert.equal(events[2].cookie, 'CSPSESSIONID=synthetic'); assert.equal(events[2].auth, undefined);
  assert.equal(events[2].method, 'HEAD'); assert.equal(events[2].path, '/gateway/api/atelier/?CacheLogout=end');
  assert.equal(receipt.logoutResponseReceived, true); assert.equal(receipt.licenseReleaseVerified, false);
});
test('Atelier 503 is not retried and prevents another batch call', async t => {
  const f = fixture(t); let calls = 0;
  const server = require('node:http').createServer((_req, res) => { calls++; res.writeHead(503); res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = createAtelierClient({ context: f.context, policy: f.policy, connection: { protocol: 'http:', hostname: '127.0.0.1', port: server.address().port, namespace: 'TEST' } });
  await assert.rejects(client.readDocument('Demo.cls'), error => error.status === 503);
  await assert.rejects(client.readDocument('Other.cls'), /cooling-down/);
  await client.close(); assert.equal(calls, 1);
});
test('explicit recovery reads hold the blocked pool and cannot replay unknown writes or use stale tokens', async t => {
  const f = fixture(t), events = [];
  const server = require('node:http').createServer((req,res) => {
    events.push({method:req.method,path:req.url});
    if (req.method === 'HEAD') { res.writeHead(401); res.end(); return; }
    res.setHeader('Set-Cookie','CSPSESSIONID=recovery; Path=/api/atelier/');
    res.end(JSON.stringify({status:{errors:[]},result:{content:['Class Demo {}'],ts:'2026-10-24 01:02:03.000'}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const connection={protocol:'http:',hostname:'127.0.0.1',port:server.address().port,namespace:'TEST'};
  const policy=remote.loadRemotePolicy(f.context,{policy:f.policy,connection});
  const owner=remote.createRemoteOperation({policy,connection});
  await assert.rejects(owner.run({effects:'write'},async()=>{throw Error('unknown write');}));
  const options={context:f.context,policy,connection,documents:['Demo.cls'],confirmRecovery:true};
  let token=remote.poolStatus({policy}).reconciliationToken;
  const live=createAtelierRecoveryReader({...options,token});
  await assert.rejects(live.readDocument('Demo.cls'),/owner-still-live/); await live.close();
  assert.equal(events.length,0); owner.close(); token=remote.poolStatus({policy}).reconciliationToken;
  assert.throws(()=>createAtelierRecoveryReader({...options,token,confirmRecovery:false}),/confirmation-required/);
  assert.throws(()=>createAtelierRecoveryReader({...options,token,documents:Array.from({length:6},(_,i)=>i+'.cls')}),/documents-invalid/);
  const ordinary=createAtelierClient({context:f.context,policy,connection});
  assert.equal((await ordinary.readDocument('Demo.cls')).text,'Class Demo {}');await ordinary.close();
  token=remote.poolStatus({policy}).reconciliationToken;
  const ordinaryEventCount=events.length;
  const reader=createAtelierRecoveryReader({...options,token});
  const restrictedOwner=remote.createRecoveryReadOperation({policy,connection,documents:['Demo.cls'],token,confirmRecovery:true});
  const generic=createAtelierClient({context:f.context,policy,connection,owner:restrictedOwner});
  await assert.rejects(generic.request('PUT','doc/Demo.cls',{}, {}, {effects:'read-only'}),/read-only/);
  await assert.rejects(generic.request('POST','docs',['Demo.cls'], {}, {effects:'read-only'}),/read-only/);
  await generic.close();restrictedOwner.close();
  await assert.rejects(reader.writeDocument('Demo.cls',Buffer.from('changed')),/read-only/);
  await assert.rejects(reader.compile(['Demo.cls']),/read-only/);
  await assert.rejects(reader.request('POST','docs',['Demo.cls']),/read-only/);
  await assert.rejects(reader.readDocument('Undeclared.cls'),/read-only/);
  assert.equal(events.length,ordinaryEventCount);
  assert.equal((await reader.readDocument('Demo.cls')).text,'Class Demo {}');
  assert.equal(remote.poolStatus({policy}).ownerAlive,true);
  assert.equal(remote.poolStatus({policy}).status,'reconciliation-required');
  await assert.rejects(reader.readDocument('Demo.cls'),/read-stopped/);
  assert.throws(()=>remote.createRemoteOperation({policy,connection}).acquire(),/busy-or-unresolved/);
  const receipt=await reader.close(), after=remote.poolStatus({policy});
  assert.equal(receipt.schema,'iris-remote-inspection/v1');assert.equal(receipt.writeEnabled,false);
  assert.equal(receipt.cleanupVerified,true);assert.equal(after.status,'reconciliation-required');
  assert.equal(after.unresolvedWrites.length,1);assert.notEqual(after.reconciliationToken,token);
  assert.deepEqual(events.slice(ordinaryEventCount).map(event=>event.method),['GET','HEAD']);
  assert.equal(events[ordinaryEventCount+1].path,'/api/atelier/?CacheLogout=end');
  const expired=createAtelierRecoveryReader({...options,token});
  await assert.rejects(expired.readDocument('Demo.cls'),/state-changed/);await expired.close();
  assert.equal(events.length,ordinaryEventCount+2);
  assert.throws(()=>remote.reconcileRemotePool({policy,token:after.reconciliationToken,evidenceFile:path.join(f.root,'qualification.json'),confirm:true}),/write-reconciliation-required/);
});
test('recovery read stops on another 503 without clearing the circuit or retrying', async t => {
  const f=fixture(t);let calls=0;
  const server=require('node:http').createServer((_req,res)=>{calls++;res.writeHead(503);res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const connection={protocol:'http:',hostname:'127.0.0.1',port:server.address().port,namespace:'TEST'};
  const policy=remote.loadRemotePolicy(f.context,{policy:f.policy,connection}),owner=remote.createRemoteOperation({policy,connection});
  await assert.rejects(owner.run({},async()=>{throw Object.assign(Error('unavailable'),{status:503});}));owner.close();
  const reader=createAtelierRecoveryReader({context:f.context,connection,policy,token:remote.poolStatus({policy}).reconciliationToken,confirmRecovery:true,documents:['First.cls','Second.cls']});
  await assert.rejects(reader.readDocument('First.cls'),error=>error.status===503);
  await assert.rejects(reader.readDocument('Second.cls'),/read-stopped/);
  assert.equal((await reader.close()).status,'inspection-incomplete');assert.equal(calls,1);
  assert.equal(remote.poolStatus({policy}).status,'circuit-open');
});
test('explicit inspection can claim a dead interrupted owner and preserves the unresolved write', async t => {
  const f=fixture(t),server=require('node:http').createServer((req,res)=>{
    if(req.method==='HEAD'){res.writeHead(401);res.end();return;}
    res.setHeader('Set-Cookie','CSPSESSIONID=recovery; Path=/api/atelier/');
    res.end(JSON.stringify({status:{errors:[]},result:{content:['observed'],ts:'2026-10-24 01:02:03.000'}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const connection={protocol:'http:',hostname:'127.0.0.1',port:server.address().port,namespace:'TEST'},policy=remote.loadRemotePolicy(f.context,{policy:f.policy,connection});
  const source=`const r=require(${JSON.stringify(path.resolve(__dirname,'../lib/iris-remote-operations'))});const o=r.createRemoteOperation(${JSON.stringify({policy,connection})});o.run({effects:'write'},async()=>{process.stdout.write('ready\\n');process.stdin.resume();await new Promise(()=>{});});`;
  const child=spawn(process.execPath,['-e',source],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('Owner exited before operation')));});
  child.kill();await new Promise(resolve=>child.once('exit',resolve));
  const before=remote.poolStatus({policy});assert.equal(before.ownerAlive,false);assert.equal(before.pendingEffects,'write');
  const reader=createAtelierRecoveryReader({context:f.context,connection,policy,token:before.reconciliationToken,confirmRecovery:true,documents:['Demo.cls']});
  assert.equal((await reader.readDocument('Demo.cls')).text,'observed');const receipt=await reader.close();
  assert.equal(receipt.poolStatus,'reconciliation-required');assert.equal(remote.poolStatus({policy}).pendingEffects,'write');assert.equal(remote.poolStatus({policy}).ownerPresent,false);
  assert.throws(()=>remote.reconcileRemotePool({policy,token:receipt.reconciliationToken,evidenceFile:path.join(f.root,'qualification.json'),confirm:true}),/write-reconciliation-required/);
});
test('recovery CLI reads at most declared docs, persists private evidence and leaves the 503 circuit blocked', async t => {
  const f=fixture(t), events=[];
  const server=require('node:http').createServer((req,res)=>{
    events.push({method:req.method,path:req.url});
    if(req.method==='HEAD'){res.writeHead(401);res.end();return;}
    assert.equal(remote.poolStatus({policy}).ownerAlive,true);
    if(req.url.includes('Missing.cls')){res.writeHead(404);res.end();return;}
    res.setHeader('Set-Cookie','CSPSESSIONID=recovery-cli; Path=/api/atelier/');
    res.end(JSON.stringify({status:{errors:[]},result:{content:['server evidence'],ts:'2026-10-24 01:02:03.000'}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const connection={protocol:'http:',hostname:'127.0.0.1',port:server.address().port,namespace:'TEST'};
  const policy=remote.loadRemotePolicy(f.context,{policy:f.policy,connection}), owner=remote.createRemoteOperation({policy,connection});
  await assert.rejects(owner.run({},async()=>{throw Object.assign(Error('busy'),{status:503});}));owner.close();
  const token=remote.poolStatus({policy}).reconciliationToken;
  fs.mkdirSync(path.join(f.context.contextRoot,'.git'));
  fs.writeFileSync(path.join(f.context.contextRoot,'config/iris-remote-policy.json'),JSON.stringify(f.policy));
  fs.writeFileSync(path.join(f.context.contextRoot,'config/project-env.json'),JSON.stringify({iris:{namespace:'TEST'},mcp:{serverName:'iris-agentic-dev'}}));
  fs.writeFileSync(path.join(f.root,'.mcp.json'),JSON.stringify({mcpServers:{'iris-agentic-dev':{env:{IRIS_HOST:'127.0.0.1',IRIS_WEB_PORT:String(connection.port),IRIS_SCHEME:'http',IRIS_NAMESPACE:'TEST',IRIS_USERNAME:'synthetic',IRIS_PASSWORD:'synthetic-secret'}}}}));
  const evidenceFile=path.join(f.context.contextRoot,'work/source-sync/inspections/evidence.json');
  const run=argv=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.resolve(__dirname,'../iris-remote.js'),...argv],{stdio:['ignore','pipe','pipe'],windowsHide:true});let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);child.once('exit',code=>resolve({code,stdout,stderr}));
  });
  const args=['read','--project-root',f.root,'--token',token,'--documents','Demo.cls','Missing.cls','--evidence',evidenceFile];
  const rejected=await run(args);assert.equal(rejected.code,1);assert.match(rejected.stderr,/confirmation-required/);assert.equal(events.length,0);assert.equal(fs.existsSync(evidenceFile),false);
  const result=await run([...args,'--confirm-recovery']);assert.equal(result.code,0,result.stderr);
  const output=JSON.parse(result.stdout), evidence=JSON.parse(fs.readFileSync(evidenceFile,'utf8'));
  assert.equal(output.schema,'iris-remote-inspection/v1');assert.equal(output.status,'inspected');assert.equal(output.documents[0].content,undefined);
  assert.equal(evidence.schema,'iris-remote-inspection-evidence/v1');assert.equal(Buffer.from(evidence.documents[0].content,'base64').toString(),'server evidence');
  assert.equal(evidence.documents[1].found,false);assert.equal(output.remote.writeEnabled,false);assert.equal(output.remote.cleanupVerified,true);
  assert.equal(remote.poolStatus({policy}).status,'circuit-open');assert.notEqual(remote.poolStatus({policy}).reconciliationToken,token);
  assert.deepEqual(events.map(event=>event.method),['GET','GET','HEAD']);assert.equal(result.stdout.includes('synthetic-secret'),false);
  assert.throws(()=>remote.createRemoteOperation({policy,connection}).acquire(),/cooling-down/);
});
test('Broker joins the same pool circuit and required policy blocks before network', async t => {
  const f = fixture(t); let calls = 0;
  fs.writeFileSync(path.join(f.context.contextRoot,'config/iris-remote-policy.json'),JSON.stringify(f.policy));
  const server=require('node:http').createServer((_req,res)=>{calls++;res.writeHead(503);res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const broker=require('../../plugins/coding-iris-plugin/scripts/iris-tools/broker-client');
  const options={context:f.context,cookie:'CSPSESSIONID=synthetic',sessionOwnerReference:'synthetic-owner',url:'http://127.0.0.1:'+server.address().port+'/broker',className:'Demo',methodName:'Read',role:'test',effects:'read-only',effectEvidence:{className:'Demo',methodName:'Read',role:'test',effects:'read-only',reference:'synthetic'}};
  assert.equal((await broker.callBroker({...options,cookie:undefined})).errorCode,'remote-broker-session-owner-required');assert.equal(calls,0);
  assert.equal((await broker.callBroker(options)).httpStatus,503);
  assert.equal((await broker.callBroker(options)).transport,'not-sent');assert.equal(calls,1);
  const required=fixture(t,true);
  assert.equal((await broker.callBroker({...options,context:required.context})).errorCode,'remote-policy-required');assert.equal(calls,1);
});
test('managed MCP verifies actual process exit without historical qualification and keeps the pool circuit on 503', t => {
  const f=fixture(t,true), helper=path.resolve(__dirname,'../iris-mcp.js');
  fs.writeFileSync(path.join(f.root,'.mcp.json'),JSON.stringify({mcpServers:{'iris-agentic-dev':{command:process.execPath,env:{IRIS_HOST:'synthetic.invalid',IRIS_WEB_PORT:'443',IRIS_SCHEME:'https',IRIS_NAMESPACE:'TEST'}}}}));
  fs.writeFileSync(path.join(f.root,'mcp'),`const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);fs.appendFileSync('requests.jsonl',line+'\\n');if(!q.id)return;let result={};if(q.method==='tools/list')result={tools:['check_config','iris_doc'].map(name=>({name,inputSchema:{type:'object',properties:{}}}))};if(q.method==='tools/call')result=q.params.name==='check_config'?{content:[{type:'text',text:'{"connected":true,"host":"synthetic.invalid","port":443,"namespace":"TEST"}'}]}:{isError:true,content:[{type:'text',text:'HTTP 503 Service Unavailable'}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');});`);
  fs.writeFileSync(path.join(f.context.contextRoot,'config/iris-remote-policy.json'),JSON.stringify(f.policy));
  const run=(...args)=>spawnSync(process.execPath,[helper,...args,'--json'],{cwd:f.root,encoding:'utf8',timeout:10000});
  f.policy.qualification={status:'pending'};
  fs.writeFileSync(path.join(f.context.contextRoot,'config/iris-remote-policy.json'),JSON.stringify(f.policy));
  const checked=run('check');assert.equal(checked.status,0,checked.stderr);assert.equal(JSON.parse(checked.stdout).REMOTE.processExited,true);
  assert.equal(run('call','iris_doc','{}').status,1);
  const before=fs.readFileSync(path.join(f.root,'requests.jsonl'),'utf8');assert.equal(run('check').status,1);assert.equal(fs.readFileSync(path.join(f.root,'requests.jsonl'),'utf8'),before);
});

test('pending managed recovery admits only declared GETs and preserves unknown writes', async t => {
 const f=fixture(t), priorHome=os.homedir;os.homedir=()=>f.root;t.after(()=>{os.homedir=priorHome;});
 fs.writeFileSync(path.join(f.context.contextRoot,'config/iris-session-backend.json'),'{}');
 const pending={...f.policy,admissionMode:'managed-single-session',qualification:{status:'pending'}};
 const events=[];
 const server=require('node:http').createServer((req,res)=>{
  events.push(req.method);
  if(req.method==='HEAD'){res.writeHead(401);res.end();return;}
  res.setHeader('Set-Cookie','CSPSESSIONID=recovery; Path=/api/atelier/');
  res.end(JSON.stringify({status:{errors:[]},result:{content:['read evidence'],ts:'2026-10-24 01:02:03.000'}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const connection={protocol:'http:',hostname:'127.0.0.1',port:server.address().port,namespace:'TEST'};
 assert.equal(remote.loadRemotePolicy(f.context,{policy:pending,connection}).enabled,true);
 const selected=remote.loadRemotePolicy(f.context,{policy:pending,connection,recoveryRead:true});
 assert.equal(selected.recoveryReadOnly,true);
 assert.throws(()=>remote.createRemoteOperation({policy:selected,connection}).acquire(),/remote-recovery-read-only/);
 const old=remote.createRemoteOperation({policy:{...selected,recoveryReadOnly:false},connection});
 await assert.rejects(old.run({effects:'write'},async()=>{throw Error('lost old result');}));old.close();
 const before=remote.poolStatus({policy:selected});
 const reader=createAtelierRecoveryReader({context:f.context,policy:pending,connection,documents:['Demo.cls'],token:before.reconciliationToken,confirmRecovery:true});
 assert.equal((await reader.readDocument('Demo.cls')).text,'read evidence');
 await assert.rejects(reader.readDocument('Other.cls'),/read-only/);await assert.rejects(reader.compile(['Demo.cls']),/read-only/);
 const exit=await reader.close();assert.equal(exit.cleanupVerified,true);
 assert.equal(remote.poolStatus({policy:selected}).unresolvedWrites.length,1);assert.equal(remote.poolStatus({policy:selected}).status,'reconciliation-required');
 assert.deepEqual(events,['GET','HEAD']);
 const disabled={...pending,enabled:false};assert.throws(()=>remote.loadRemotePolicy(f.context,{policy:disabled,connection,recoveryRead:true}),/remote-policy-required|remote-policy-invalid/);
});
