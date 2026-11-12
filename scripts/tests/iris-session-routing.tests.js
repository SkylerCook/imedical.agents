'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createTempDirectory,ownsTempDirectory}=require('./fixtures/temp-directory');
const {describe}=require('../lib/iris-session-backends');
const {serve}=require('../iris-session-host');
const {createClient}=require('../lib/iris-session-client');

test('read transport failure retains its cause through IPC without inventing HTTP status or write risk',async t=>{
  const root=createTempDirectory('iris-session-transport-'),project=path.join(root,'project');
  fs.mkdirSync(path.join(project,'.agents/config'),{recursive:true});
  const backend=path.join(root,'backend.js');
  fs.writeFileSync(backend,`const r=require('readline').createInterface({input:process.stdin});
    r.on('close',()=>process.stderr.write('IMEDICAL_LOGOUT={"attempted":0,"acknowledged":0,"completed":true}\\n'));
    r.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
      let result={};
      if(m.method==='tools/call'){
        const check=m.params.name==='check_config';
        const payload=check?{connected:true,host:'example.invalid',port:443,namespace:'TEST'}:
          {error_code:'SERVER_ERROR',error:'failed to fetch CLS docnames: HTTP error: error sending request for url (private-secret)'};
        if(!check)process.stderr.write('IMEDICAL_SESSION_STOP=identity-unverified\\n');
        result={isError:!check,content:[{type:'text',text:JSON.stringify(payload)}]};
      }
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
    });`);
  fs.writeFileSync(path.join(project,'.mcp.json'),JSON.stringify({mcpServers:{'iris-agentic-dev':{command:process.execPath,env:{IRIS_HOST:'example.invalid',IRIS_WEB_PORT:'443',IRIS_NAMESPACE:'TEST'}}}}));
  fs.writeFileSync(path.join(project,'.agents/config/iris-session-backend.json'),JSON.stringify({schema:'iris-session-backend/v1',serverName:'iris-agentic-dev',command:process.execPath,args:[backend]}));
  const host=await serve({root:path.join(root,'ipc')}),client=createClient({projectRoot:project,root:path.join(root,'ipc')});
  t.after(async()=>{await client.close();await host.stop();if(ownsTempDirectory(root))fs.rmSync(root,{recursive:true});});
  await assert.rejects(client.request('tools/call',{name:'iris_doc',arguments:{mode:'list',doc_type:'CLS'}}),error=>{
    assert.equal(error.code,'session-identity-unverified');
    assert.equal(error.transportError,'request-failed');
    assert.equal(error.toolErrorCode,'SERVER_ERROR');
    assert.equal(error.httpStatus,undefined);
    assert.equal(error.beforeSend,false);
    return true;
  });
  const pool=host.manager.status()[0];
  assert.equal(pool.unresolvedWrites.length,0);
  assert.equal(pool.lastFailedOperation.transportError,'request-failed');
  assert.equal(JSON.stringify(pool).includes('private-secret'),false);
  assert.equal(fs.readFileSync(path.join(root,'ipc/pools',pool.pool+'.json'),'utf8').includes('private-secret'),false);
});

test('normal recovery entry loads durable pools after host restart and distinguishes missing pools', async t => {
  const root = createTempDirectory('iris-session-recovery-');
  const project = path.join(root, 'project');
  const ipcRoot = path.join(root, 'ipc');
  fs.mkdirSync(path.join(project, '.agents/config'), {recursive:true});
  fs.writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({mcpServers:{'iris-agentic-dev':{
    command:process.execPath, env:{IRIS_HOST:'example.invalid', IRIS_WEB_PORT:'443', IRIS_NAMESPACE:'TEST'}
  }}}));
  fs.writeFileSync(path.join(project, '.agents/config/iris-session-backend.json'), JSON.stringify({
    schema:'iris-session-backend/v1', serverName:'iris-agentic-dev', command:process.execPath, args:[]
  }));
  fs.writeFileSync(path.join(project, '.agents/config/iris-remote-policy.json'), JSON.stringify({
    schema:'iris-remote-policy/v1', enabled:true, coordinationRoot:path.join(root,'admission'), poolKey:'fixture'
  }));
  t.mock.method(require('node:os'), 'homedir', () => root);
  const ipc = require('../lib/iris-session-ipc');
  const connect = ipc.connect;
  const starts=[];
  t.mock.method(ipc, 'connect', options => {starts.push(options.start);return connect({...options, root:ipcRoot});});
  const location=ipc.location;
  t.mock.method(ipc,'location',root=>location(root || ipcRoot));
  let host = await serve({root:ipcRoot});
  t.after(async () => {await host.stop(); if (ownsTempDirectory(root)) fs.rmSync(root,{recursive:true});});
  const pool = describe(project, undefined, {localOnly:true}).pool;
  host.manager.markUnknown(pool);
  const expectedId = host.manager.status()[0].pool;
  assert.notEqual(expectedId, pool);
  await host.stop();
  host = await serve({root:ipcRoot});
  assert.equal(host.manager.status().length, 1);
  const outputs = [];
  t.mock.method(console, 'log', text => outputs.push(JSON.parse(text)));
  const main = require('../iris-remote').main;
  await main(['status','--project-root',project]);
  assert.equal(outputs.at(-1).poolId, expectedId);
  assert.equal(outputs.at(-1).session.pool, expectedId);
  assert.equal(outputs.at(-1).status, 'reconciliation-required');
  await assert.rejects(main(['reconcile-session','--project-root',project,'--confirm']), {code:'session-reconciliation-evidence-required'});
  const evidence = path.join(root,'evidence.json');
  fs.writeFileSync(evidence, JSON.stringify({processExited:true}));
  await main(['reconcile-session','--project-root',project,'--confirm','--evidence',evidence,'--write-outcome','verified-not-applied']);
  assert.equal(outputs.at(-1).unresolvedWrites.length, 0);
  host.manager.open=async()=>({call:async()=> 'ok',close:async()=>({processExited:true,cleanupVerified:false})});
  await host.manager.submit({pool,identity:'fixture',client:'fixture',operation:{effects:'read-only'}});
  host.manager.markUnknown(pool);
  const before=host.manager.status()[0].reconciliationToken;
  await assert.rejects(main(['reconcile-session','--project-root',project,'--confirm','--token','stale','--write-outcome','verified-not-applied']),{code:'session-reconciliation-token-stale'});
  assert.equal(host.manager.status()[0].active,true);
  await main(['reconcile-session','--project-root',project,'--confirm','--token',before,'--write-outcome','verified-not-applied']);
  assert.equal(outputs.at(-1).unresolvedWrites.length,0);
  assert.equal(outputs.at(-1).active,false);
  await main(['reconcile-session','--project-root',project,'--confirm']);
  assert.equal(outputs.at(-1).status,'not-required');
  await host.stop();
  const durable=fs.readFileSync(path.join(ipcRoot,'pools',expectedId+'.json'));
  starts.length=0;
  await main(['status','--project-root',project]);
  await main(['sessions','--project-root',project]);
  assert.deepEqual(starts,[false,false]);
  assert.deepEqual(fs.readFileSync(path.join(ipcRoot,'pools',expectedId+'.json')),durable);
  assert.equal(fs.existsSync(path.join(ipcRoot,'host.json')),false);
  host=await serve({root:ipcRoot});
  const config = JSON.parse(fs.readFileSync(path.join(project,'.mcp.json')));
  config.mcpServers['iris-agentic-dev'].env.IRIS_HOST = 'different.invalid';
  fs.writeFileSync(path.join(project,'.mcp.json'),JSON.stringify(config));
  await assert.rejects(main(['reconcile-session','--project-root',project,'--confirm']), {code:'session-reconciliation-pool-not-found'});
});
test('managed MCP clients reach one real subprocess and local tools/list never starts it',async t=>{
  const root=createTempDirectory('iris-session-routing-'),project=path.join(root,'project');
  fs.mkdirSync(path.join(project,'.agents/config'),{recursive:true});
  const backend=path.join(root,'backend.js');
  fs.writeFileSync(backend,`const r=require('readline').createInterface({input:process.stdin});
    r.on('close',()=>process.stderr.write('IMEDICAL_LOGOUT={"attempted":0,"acknowledged":0,"completed":true}\\n'));
    r.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
      if(m.params?.name==='iris_query')process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/progress',params:{progressToken:m.params.arguments.sql,progress:1}})+'\\n');
      let result={};if(m.method==='tools/call')result={content:[{type:'text',text:JSON.stringify(m.params.name==='check_config'?{connected:true,host:'example.invalid',port:443,namespace:'TEST'}:{pid:process.pid,name:m.params.name})}]};
      if(m.params?.name==='iris_test')result=m.params.arguments.pattern==='assertion'?{content:[{type:'text',text:JSON.stringify({success:false,total:1,passed:0,failed:1})}]}:{isError:true,content:[{type:'text',text:JSON.stringify({success:false,error_code:m.params.arguments.pattern==='rejected'?'NAMESPACE_NOT_FOUND':'TEST_EXECUTION_ERROR',error:'synthetic diagnosis'})}]};
      if(m.params?.name==='iris_execute' || m.params?.name==='iris_execute_method')result={isError:true,content:[{type:'text',text:JSON.stringify({success:false,error_code:m.params.name==='iris_execute'?'HTTP_EXECUTION_FAILED':'IRIS_EXECUTE_ERROR',error:m.params.name==='iris_execute'?'iris_execute: HTTP/Atelier execution failed (PUT doc failed: HTTP 405 Method Not Allowed). No docker fallback available (IRIS_CONTAINER not set). Verify the Atelier REST endpoint.':'PUT doc failed: HTTP 405 Method Not Allowed'})}]};
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
  const config={mcpServers:{'iris-agentic-dev':{command:process.execPath,args:[path.resolve('scripts/iris-session-mcp.js')],env:{IRIS_HOST:'example.invalid',IRIS_WEB_PORT:'443',IRIS_SCHEME:'https',IRIS_NAMESPACE:'TEST'}}}};
  fs.writeFileSync(path.join(project,'.mcp.json'),JSON.stringify(config));
  fs.writeFileSync(path.join(project,'.agents/config/iris-session-backend.json'),JSON.stringify({schema:'iris-session-backend/v1',serverName:'iris-agentic-dev',command:process.execPath,args:[backend]}));
  const defaults=require('../lib/iris-session-backends').describe(project);
  assert.equal(defaults.connection.rejectUnauthorized,false);
  assert.equal(defaults.env.IRIS_TLS_VERIFY,'false');
  config.mcpServers['iris-agentic-dev'].env.IRIS_TLS_VERIFY='true';
  fs.writeFileSync(path.join(project,'.mcp.json'),JSON.stringify(config));
  const verified=require('../lib/iris-session-backends').describe(project);
  assert.equal(verified.connection.rejectUnauthorized,true);
  assert.equal(verified.env.IRIS_TLS_VERIFY,'true');
  delete config.mcpServers['iris-agentic-dev'].env.IRIS_TLS_VERIFY;
  fs.writeFileSync(path.join(project,'.mcp.json'),JSON.stringify(config));
  const host=await serve({root:path.join(root,'ipc')});
  const notesA=[],notesB=[];
  const a=createClient({projectRoot:project,root:path.join(root,'ipc'),allowWrite:true,onNotification:m=>notesA.push(m)}),b=createClient({projectRoot:project,root:path.join(root,'ipc'),onNotification:m=>notesB.push(m)});
  t.after(async()=>{await a.close();await b.close();await host.stop();if(ownsTempDirectory(root))fs.rmSync(root,{recursive:true});});
  assert.equal((await a.request('tools/list',{})).result.tools.length,81);assert.equal(host.manager.status().length,0);
  const first=await a.request('tools/call',{name:'iris_query',arguments:{sql:'SELECT 1'}});
  const second=await b.request('tools/call',{name:'iris_query',arguments:{sql:'SELECT 2'}});
  assert.equal(JSON.parse(first.result.content[0].text).pid,JSON.parse(second.result.content[0].text).pid);
  assert.equal(host.manager.status()[0].generation,1);
  assert.deepEqual(notesA.map(m=>m.params.progressToken),['SELECT 1']);
  assert.deepEqual(notesB.map(m=>m.params.progressToken),['SELECT 2']);
  assert.equal((await a.endSession()).exit.cleanupVerified,true);
  for (const name of ['iris_execute','iris_execute_method']) {
    const carrier = await a.request('tools/call',{name,arguments:{}});
    assert.equal(carrier.result.isError,true);
    assert.equal(JSON.parse(carrier.result.content[0].text).error_code,name==='iris_execute'?'HTTP_EXECUTION_FAILED':'IRIS_EXECUTE_ERROR');
    assert.equal(host.manager.status()[0].unresolvedWrites.length,0);
  }
  const failed=await a.request('tools/call',{name:'iris_test',arguments:{pattern:'assertion'}});
  assert.equal(JSON.parse(failed.result.content[0].text).failed,1);
  await b.request('tools/call',{name:'iris_query',arguments:{sql:'SELECT after_assertion'}});
  const rejected=await a.request('tools/call',{name:'iris_test',arguments:{pattern:'rejected'}});
  assert.equal(rejected.result.isError,true);
  await b.request('tools/call',{name:'iris_query',arguments:{sql:'SELECT after_rejection'}});
  await assert.rejects(a.request('tools/call',{name:'iris_test',arguments:{pattern:'unknown'}}),error=>{
    assert.equal(error.code,'session-write-outcome-unverified');
    assert.equal(error.toolErrorCode,'TEST_EXECUTION_ERROR');
    assert.equal(JSON.parse(error.toolResponse.result.content[0].text).error,'synthetic diagnosis');return true;
  });
  assert.equal(host.manager.status()[0].blocked,null);
  assert.equal(host.manager.status()[0].unresolvedWrites.length,1);
  const afterUnknown=await b.request('tools/call',{name:'iris_query',arguments:{sql:'SELECT after_unknown'}});
  assert.equal(JSON.parse(afterUnknown.result.content[0].text).name,'iris_query');
  for(const name of fs.readdirSync(path.join(root,'ipc/pools')))assert.equal(fs.readFileSync(path.join(root,'ipc/pools',name),'utf8').includes('synthetic diagnosis'),false);
  fs.writeFileSync(path.join(project,'.agents/config/iris-development.json'),JSON.stringify({developmentMode:'offline'}));
  assert.throws(()=>describe(project),/offline/);
});


test('two projects on one instance can read unknown A and write B while another write to A is rejected before send',async t=>{
  const root=createTempDirectory('iris-session-routing-');
  const backend=path.join(root,'document-backend.js'),history=path.join(root,'document-calls.jsonl');
  fs.writeFileSync(backend,`const fs=require('node:fs');
    const lines=require('node:readline').createInterface({input:process.stdin});
    lines.on('close',()=>process.stderr.write('IMEDICAL_LOGOUT={"attempted":0,"acknowledged":0,"completed":true}\\n'));
    lines.on('line',line=>{
      const message=JSON.parse(line);if(message.id===undefined)return;
      const tool=message.params?.name,args=message.params?.arguments||{};
      let result={};
      if(message.method==='tools/call'){
        fs.appendFileSync(${JSON.stringify(history)},JSON.stringify({tool,mode:args.mode,name:args.name})+'\\n');
        let payload=tool==='check_config'?{connected:true,host:'example.invalid',port:443,namespace:'TEST'}:{success:true,name:args.name};
        const failed=tool==='iris_doc' && args.mode==='put' && args.name==='Demo.A.cls';
        if(failed)payload={success:false,error_code:'DOC_WRITE_ERROR',error:'synthetic uncertain document write'};
        result={...(failed?{isError:true}:{}),content:[{type:'text',text:JSON.stringify(payload)}]};
      }
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\\n');
    });`);
  const projects=['one','two'].map(name=>path.join(root,name));
  const mcp={mcpServers:{'iris-agentic-dev':{command:process.execPath,args:[path.resolve('scripts/iris-session-mcp.js')],env:{IRIS_HOST:'example.invalid',IRIS_WEB_PORT:'443',IRIS_SCHEME:'https',IRIS_NAMESPACE:'TEST'}}}};
  const config={schema:'iris-session-backend/v1',serverName:'iris-agentic-dev',command:process.execPath,args:[backend]};
  for(const project of projects){
    fs.mkdirSync(path.join(project,'.agents/config'),{recursive:true});
    fs.writeFileSync(path.join(project,'.mcp.json'),JSON.stringify(mcp));
    fs.writeFileSync(path.join(project,'.agents/config/iris-session-backend.json'),JSON.stringify(config));
  }
  const host=await serve({root:path.join(root,'ipc')});
  const a=createClient({projectRoot:projects[0],root:path.join(root,'ipc'),allowWrite:true});
  const b=createClient({projectRoot:projects[1],root:path.join(root,'ipc'),allowWrite:true});
  t.after(async()=>{await a.close();await b.close();await host.stop();if(ownsTempDirectory(root))fs.rmSync(root,{recursive:true});});
  await assert.rejects(a.request('tools/call',{name:'iris_doc',arguments:{mode:'put',name:'Demo.A.cls',content:'Class Demo.A {}'}}),error=>error.code==='session-write-outcome-unverified');
  assert.equal(host.manager.status()[0].unresolvedWrites.length,1);
  const read=await b.request('tools/call',{name:'iris_doc',arguments:{mode:'get',name:'Demo.A.cls'}});
  assert.equal(JSON.parse(read.result.content[0].text).name,'Demo.A.cls');
  const unrelated=await b.request('tools/call',{name:'iris_doc',arguments:{mode:'put',name:'Demo.B.cls',content:'Class Demo.B {}'}});
  assert.equal(JSON.parse(unrelated.result.content[0].text).success,true);
  await assert.rejects(b.request('tools/call',{name:'iris_doc',arguments:{mode:'put',name:'Demo.A.cls',content:'Class Demo.A {}'}}),error=>error.beforeSend===true && error.code==='session-write-conflict-unresolved');
  const sent=fs.readFileSync(history,'utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line));
  assert.equal(sent.filter(call=>call.tool==='iris_doc' && call.mode==='put' && call.name==='Demo.A.cls').length,1);
  assert.equal(sent.filter(call=>call.tool==='iris_doc' && call.mode==='put' && call.name==='Demo.B.cls').length,1);
  assert.equal(host.manager.status()[0].blocked,null);
  assert.equal(host.manager.status()[0].unresolvedWrites.length,1);
});

test('stopped vendor rejects the next call before send and known success survives session retirement',async t=>{
  const root=createTempDirectory('iris-session-send-phase-'),project=path.join(root,'project');
  fs.mkdirSync(path.join(project,'.agents/config'),{recursive:true});
  const backend=path.join(root,'backend.js'),calls=path.join(root,'calls.jsonl');
  fs.writeFileSync(backend,`const fs=require('fs'),r=require('readline').createInterface({input:process.stdin});
    r.on('close',()=>process.stderr.write('IMEDICAL_LOGOUT={"attempted":0,"acknowledged":0,"completed":true}\\n'));
    r.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
      const name=m.params?.name;
      if(m.method==='tools/call'&&name!=='check_config')fs.appendFileSync(${JSON.stringify(calls)},name+'\\n');
      const payload=name==='check_config'?{connected:true,host:'example.invalid',port:443,namespace:'TEST'}:{success:true};
      const emit=()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify(payload)}]}})+'\\n');
      if(name==='iris_execute'){process.stderr.write('IMEDICAL_SESSION_STOP=identity-unverified\\n');setTimeout(emit,40);}
      else {emit();if(name==='iris_query')setTimeout(()=>process.stderr.write('IMEDICAL_SESSION_STOP=identity-unverified\\n'),40);}
    });`);
  fs.writeFileSync(path.join(project,'.mcp.json'),JSON.stringify({mcpServers:{'iris-agentic-dev':{command:process.execPath,args:[path.resolve('scripts/iris-session-mcp.js')],env:{IRIS_HOST:'example.invalid',IRIS_WEB_PORT:'443',IRIS_SCHEME:'https',IRIS_NAMESPACE:'TEST'}}}}));
  fs.writeFileSync(path.join(project,'.agents/config/iris-session-backend.json'),JSON.stringify({schema:'iris-session-backend/v1',serverName:'iris-agentic-dev',command:process.execPath,args:[backend]}));
  const host=await serve({root:path.join(root,'ipc')});
  const client=createClient({projectRoot:project,root:path.join(root,'ipc'),allowWrite:true});
  t.after(async()=>{await client.close();await host.stop();if(ownsTempDirectory(root))fs.rmSync(root,{recursive:true});});
  await client.request('tools/call',{name:'iris_query',arguments:{query:'SELECT 1'}});
  await new Promise(resolve=>setTimeout(resolve,100));
  await assert.rejects(client.request('tools/call',{name:'iris_execute',arguments:{code:'write 1'}}),e=>e.code==='session-identity-unverified'&&e.beforeSend===true);
  assert.deepEqual(fs.readFileSync(calls,'utf8').trim().split('\n'),['iris_query']);
  assert.equal(host.manager.status()[0].unresolvedWrites.length,0);
  const success=await client.request('tools/call',{name:'iris_execute',arguments:{code:'write 1'}});
  assert.equal(JSON.parse(success.result.content[0].text).success,true);
  assert.equal(success.result._meta['imedical/session'].sessionRetired,true);
  assert.equal(host.manager.status()[0].unresolvedWrites.length,0);
  assert.equal(host.manager.status()[0].active,false);
});
