'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {JsonLineMcpClient}=require('../iris-mcp');
const {createTempDirectory,ownsTempDirectory}=require('./fixtures/temp-directory');
const binary=process.env.IRIS_TEST_VENDOR_BINARY || path.resolve('vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe');

for (const mode of ['deleted', 'replaced', 'scope-changed', 'missing', 'refresh', 'auth-switched']) {
test('actual vendor enforces cookie lifecycle: '+mode, {skip:process.platform!=='win32'&&!process.env.IRIS_TEST_VENDOR_BINARY}, async t => {
  const root=createTempDirectory('iris-session-cookie-vendor-'), seen=[];
  let removeCookie=false;
  const server=http.createServer((req,res)=>{
    req.resume(); req.on('end',()=>{
      seen.push({url:req.url,cookie:req.headers.cookie,authorization:!!req.headers.authorization});
      res.setHeader('Content-Type','application/json');
      if(req.url.includes('IRISLogout=end')){res.writeHead(401);res.end('{}');return;}
      let value='fixture', scope='/api/atelier/', expiry='';
      if(mode==='refresh')value=(removeCookie?'B':'A').repeat(8)+'C'.repeat(14)+(removeCookie?'E':'D').repeat(28);
      if(removeCookie && mode==='deleted'){value='';expiry='; Max-Age=0';}
      if(removeCookie && mode==='replaced')value='replacement';
      if(removeCookie && mode==='scope-changed')scope='/api/atelier/v1/TEST/';
      if(mode!=='missing')res.setHeader('Set-Cookie',`CSPSESSIONID-fixture=${value}; Path=${scope}${expiry}`);
      res.end(JSON.stringify(req.method==='GET' ? {result:{content:{version:'IRIS for test',api:1}}} : {result:{content:[{probe:1,Value:'Development'}]}}));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const inherited=Object.fromEntries(Object.keys(process.env).filter(k=>k.startsWith('IRIS_')).map(k=>[k,undefined]));
  const client=new JsonLineMcpClient(binary,['mcp','--no-skills'],{...inherited,IRIS_HOST:'127.0.0.1',IRIS_WEB_PORT:String(server.address().port),IRIS_SCHEME:'http',IRIS_NAMESPACE:'TEST',IRIS_USERNAME:'fixture',IRIS_PASSWORD:'fixture',IRIS_MANAGED_NO_RETRIES:'1',IRIS_SESSION_COOKIE_FORMAT:mode==='refresh'?'csp50-v1':'opaque',...(mode==='auth-switched'?{IRIS_SERVICE_USERNAME:'other-fixture',IRIS_SERVICE_PASSWORD:'other-fixture'}:{})},{cwd:root});
  t.after(async()=>{await client.close();await new Promise(resolve=>server.close(resolve));if(ownsTempDirectory(root))fs.rmSync(root,{recursive:true});});
  await client.request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'cookie-test',version:'1'}});client.notify('notifications/initialized',{});
  const query=()=>client.request('tools/call',{name:'iris_query',arguments:{query:'SELECT 1 AS probe',mode:'read',namespace:'TEST'}});
  const first=await query();
  if(mode!=='missing')assert.notEqual(first.result?.isError,true,'initial query must succeed');
  removeCookie=true;
  const beforeChange=seen.length;
  if(mode==='auth-switched') {
    await client.request('tools/call',{name:'iris_execute',arguments:{code:'write 1',confirmed:true,namespace:'TEST'}}).catch(()=>{});
    assert.equal(seen.length,beforeChange,'A different authentication identity must not reuse the current session');
  } else await query().catch(()=>{});
  const before=seen.filter(r=>!r.url.includes('IRISLogout=end')).length;
  const last=await query().catch(()=>null);
  const after=seen.filter(r=>!r.url.includes('IRISLogout=end')).length;
  if(mode==='refresh') {assert.ok(after>before);assert.notEqual(last?.result?.isError,true);}
  else assert.equal(after,before,'An unknown session must not authenticate or dispatch another business request');
  assert.equal(seen.filter(r=>r.authorization).length,1,'Only initial authentication is allowed');
  const exit=await client.close();
  assert.equal(exit.logout.completed,mode==='refresh');
  if(mode==='deleted')assert.ok(seen.some(r=>r.url.includes('IRISLogout=end')&&r.cookie?.includes('fixture')),'deleted cookie must remain available for logout');
  if(mode==='missing')assert.equal(seen.length,1);
});
}
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

for(const startupMode of ['503-cookie','503-no-cookie','redirect']) {
test('actual startup stops probe and queued operations: '+startupMode,{skip:process.platform!=='win32'&&!process.env.IRIS_TEST_VENDOR_BINARY},async t=>{
  const root=createTempDirectory('iris-session-startup-'),seen=[];
  fs.mkdirSync(path.join(root,'.agents/config'),{recursive:true});
  const candidate=path.join(root,'vendor','bin',process.platform==='win32'?'iris-agentic-dev.exe':'iris-agentic-dev');
  fs.mkdirSync(path.dirname(candidate),{recursive:true});fs.copyFileSync(binary,candidate);fs.chmodSync(candidate,0o700);
  const sha256=require('node:crypto').createHash('sha256').update(fs.readFileSync(candidate)).digest('hex');
  fs.writeFileSync(path.join(root,'vendor','managed-build.json'),JSON.stringify({schema:'iris-managed-vendor/v1',patch:'managed-sessions-v2',sha256}));
  const server=http.createServer((req,res)=>{
    seen.push(req.method+' '+req.url);
    if(startupMode==='503-cookie')res.setHeader('Set-Cookie','CSPSESSIONID-fixture=fixture; Path=/api/atelier/');
    if(startupMode==='redirect')res.setHeader('Location','/redirected');
    res.writeHead(req.url.includes('IRISLogout=end')?401:startupMode==='redirect'?302:503);res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  fs.writeFileSync(path.join(root,'.mcp.json'),JSON.stringify({mcpServers:{'iris-agentic-dev':{command:candidate,args:['mcp','--no-skills'],env:{IRIS_HOST:'127.0.0.1',IRIS_WEB_PORT:String(server.address().port),IRIS_SCHEME:'http',IRIS_NAMESPACE:'TEST',IRIS_USERNAME:'fixture',IRIS_PASSWORD:'fixture'}}}}));
  const host=await require('../iris-session-host').serve({root:path.join(root,'ipc')});
  const client=require('../lib/iris-session-client').createClient({projectRoot:root,root:path.join(root,'ipc')});
  t.after(async()=>{await client.close();await host.stop();await new Promise(resolve=>server.close(resolve));if(ownsTempDirectory(root))fs.rmSync(root,{recursive:true});});
  const results=await Promise.allSettled([1,2].map(()=>client.request('tools/call',{name:'iris_query',arguments:{query:'SELECT 1',mode:'read'}})));
  assert.deepEqual(results.map(x=>x.status),['rejected','rejected']);
  assert.equal(results[1].reason.beforeSend,true);
  assert.deepEqual(seen,startupMode==='503-cookie'?['GET /api/atelier/','GET /api/atelier/?IRISLogout=end']:['GET /api/atelier/']);
  assert.equal(host.manager.status()[0].blocked,startupMode==='redirect'?'session-identity-unverified':'session-service-unavailable');
});
}
