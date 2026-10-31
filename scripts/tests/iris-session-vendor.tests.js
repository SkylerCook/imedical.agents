'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {JsonLineMcpClient}=require('../iris-mcp');
const {createTempDirectory,ownsTempDirectory}=require('./fixtures/temp-directory');
const binary=process.env.IRIS_TEST_VENDOR_BINARY || path.resolve('vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe');

test('actual vendor stops business calls after session cookie deletion', {skip:process.platform!=='win32'&&!process.env.IRIS_TEST_VENDOR_BINARY}, async t => {
  const root=createTempDirectory('iris-session-cookie-vendor-'), seen=[];
  let removeCookie=false;
  const server=http.createServer((req,res)=>{
    req.resume(); req.on('end',()=>{
      seen.push({url:req.url,cookie:req.headers.cookie,authorization:!!req.headers.authorization});
      res.setHeader('Content-Type','application/json');
      if(req.url.includes('IRISLogout=end')){res.writeHead(401);res.end('{}');return;}
      res.setHeader('Set-Cookie', removeCookie ? 'CSPSESSIONID-fixture=; Max-Age=0; Path=/api/atelier/' : 'CSPSESSIONID-fixture=fixture; Path=/api/atelier/');
      res.end(JSON.stringify(req.method==='GET' ? {result:{content:{version:'IRIS for test',api:1}}} : {result:{content:[{probe:1,Value:'Development'}]}}));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const inherited=Object.fromEntries(Object.keys(process.env).filter(k=>k.startsWith('IRIS_')).map(k=>[k,undefined]));
  const client=new JsonLineMcpClient(binary,['mcp','--no-skills'],{...inherited,IRIS_HOST:'127.0.0.1',IRIS_WEB_PORT:String(server.address().port),IRIS_SCHEME:'http',IRIS_NAMESPACE:'TEST',IRIS_USERNAME:'fixture',IRIS_PASSWORD:'fixture',IRIS_MANAGED_NO_RETRIES:'1'},{cwd:root});
  t.after(async()=>{await client.close();await new Promise(resolve=>server.close(resolve));if(ownsTempDirectory(root))fs.rmSync(root,{recursive:true});});
  await client.request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'cookie-test',version:'1'}});client.notify('notifications/initialized',{});
  const query=()=>client.request('tools/call',{name:'iris_query',arguments:{query:'SELECT 1 AS probe',mode:'read',namespace:'TEST'}});
  await query(); removeCookie=true;
  await query().catch(()=>{});
  const before=seen.filter(r=>!r.url.includes('IRISLogout=end')).length;
  await query().catch(()=>{});
  assert.equal(seen.filter(r=>!r.url.includes('IRISLogout=end')).length,before,'An unknown session must not authenticate or dispatch another business request');
});
test('actual patched vendor sends one generator PUT on 503 and acknowledges its own logout',{skip:process.platform!=='win32'&&!process.env.IRIS_TEST_VENDOR_BINARY},async t=>{
  const root=createTempDirectory('iris-session-vendor-'),seen=[];
  const server=http.createServer((req,res)=>{
    let body='';req.on('data',b=>body+=b);req.on('end',()=>{
      seen.push({method:req.method,url:req.url,cookie:!!req.headers.cookie});
      res.setHeader('Content-Type','application/json');
      if(req.url.includes('IRISLogout=end')){res.writeHead(401);res.end('{}');return;}
      res.setHeader('Set-Cookie','CSPSESSIONID-fixture=fixture; Path=/api/atelier/');
      if(req.method==='PUT'){res.writeHead(503);res.end('{}');return;}
      if(req.method==='GET'){res.end(JSON.stringify({result:{content:{version:'IRIS for test',api:1}}}));return;}
      res.end(JSON.stringify({result:{content:[{Value:'Development'}]}}));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const inherited=Object.fromEntries(Object.keys(process.env).filter(k=>k.startsWith('IRIS_')).map(k=>[k,undefined]));
  const client=new JsonLineMcpClient(binary,['mcp','--no-skills'],{...inherited,IRIS_HOST:'127.0.0.1',IRIS_WEB_PORT:String(server.address().port),IRIS_SCHEME:'http',IRIS_NAMESPACE:'TEST',IRIS_USERNAME:'fixture',IRIS_PASSWORD:'fixture',IRIS_MANAGED_NO_RETRIES:'1'},{cwd:root});
  t.after(async()=>{await client.close();await new Promise(resolve=>server.close(resolve));if(ownsTempDirectory(root))fs.rmSync(root,{recursive:true});});
  await client.request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'isolated-test',version:'1'}});client.notify('notifications/initialized',{});
  await client.request('tools/call',{name:'iris_query',arguments:{query:'SELECT 1 AS probe',mode:'read',namespace:'TEST'}});
  assert.equal(seen.filter(r=>r.method==='PUT').length,0,'Read-only tools must not deploy telemetry classes');
  const result=await client.request('tools/call',{name:'iris_execute',arguments:{code:'write 1',confirmed:true,namespace:'TEST'}});
  assert.match(JSON.stringify(result),/503/);assert.equal(seen.filter(r=>r.method==='PUT').length,1,JSON.stringify(seen));
  const exit=await client.close();assert.equal(exit.processExited,true);assert.deepEqual(exit.logout,{attempted:1,acknowledged:1,completed:true});
  assert.equal(seen.filter(r=>r.url.includes('IRISLogout=end')).length,1);
  assert.equal(seen.at(-1).cookie,true);
});

test('actual startup 503 stops system-mode probe and queued operations',{skip:process.platform!=='win32'||!!process.env.IRIS_TEST_VENDOR_BINARY},async t=>{
  const root=createTempDirectory('iris-session-startup-'),seen=[];
  fs.mkdirSync(path.join(root,'.agents/config'),{recursive:true});
  const server=http.createServer((req,res)=>{seen.push(req.method+' '+req.url);res.setHeader('Set-Cookie','CSPSESSIONID-fixture=fixture; Path=/api/atelier/');res.writeHead(req.url.includes('IRISLogout=end')?401:503);res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  fs.writeFileSync(path.join(root,'.mcp.json'),JSON.stringify({mcpServers:{'iris-agentic-dev':{command:binary,args:['mcp','--no-skills'],env:{IRIS_HOST:'127.0.0.1',IRIS_WEB_PORT:String(server.address().port),IRIS_SCHEME:'http',IRIS_NAMESPACE:'TEST',IRIS_USERNAME:'fixture',IRIS_PASSWORD:'fixture'}}}}));
  const host=await require('../iris-session-host').serve({root:path.join(root,'ipc')});
  const client=require('../lib/iris-session-client').createClient({projectRoot:root,root:path.join(root,'ipc')});
  t.after(async()=>{await client.close();await host.stop();await new Promise(resolve=>server.close(resolve));if(ownsTempDirectory(root))fs.rmSync(root,{recursive:true});});
  const results=await Promise.allSettled([1,2].map(()=>client.request('tools/call',{name:'iris_query',arguments:{query:'SELECT 1',mode:'read'}})));
  assert.deepEqual(results.map(x=>x.status),['rejected','rejected']);
  assert.equal(results[1].reason.beforeSend,true);
  assert.deepEqual(seen,['GET /api/atelier/','GET /api/atelier/?IRISLogout=end']);
  assert.equal(host.manager.status()[0].blocked,'session-service-unavailable');
});
