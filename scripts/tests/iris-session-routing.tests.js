'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createTempDirectory,ownsTempDirectory}=require('./fixtures/temp-directory');
const {describe}=require('../lib/iris-session-backends');
const {serve}=require('../iris-session-host');
const {createClient}=require('../lib/iris-session-client');
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
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
  const config={mcpServers:{'iris-agentic-dev':{command:process.execPath,args:[path.resolve('scripts/iris-session-mcp.js')],env:{IRIS_HOST:'example.invalid',IRIS_WEB_PORT:'443',IRIS_SCHEME:'https',IRIS_NAMESPACE:'TEST'}}}};
  fs.writeFileSync(path.join(project,'.mcp.json'),JSON.stringify(config));
  fs.writeFileSync(path.join(project,'.agents/config/iris-session-backend.json'),JSON.stringify({schema:'iris-session-backend/v1',serverName:'iris-agentic-dev',command:process.execPath,args:[backend]}));
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
