'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {JsonLineMcpClient,extractToolText}=require('../iris-mcp');
const {createTempDirectory,ownsTempDirectory}=require('./fixtures/temp-directory');
const binary=process.env.IRIS_TEST_VENDOR_BINARY || path.resolve('vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe');
const options={skip:process.platform!=='win32'&&!process.env.IRIS_TEST_VENDOR_BINARY};

async function fixture(t,{env={},toml}={}) {
  const temporary=createTempDirectory('iris-vendor-upgrade-'),root=path.join(temporary,'project'),home=path.join(temporary,'home'),seen=[],documents=new Map();
  fs.mkdirSync(root);fs.mkdirSync(home);
  // Rust dirs uses Windows Known Folders; USERPROFILE cannot redirect this editor hint.
  const hint=process.platform==='win32'?path.join(os.homedir(),'.iris-agentic-dev/open-hint.json'):null;
  const previousHint=hint&&fs.existsSync(hint)?fs.readFileSync(hint):null;
  if(toml)fs.writeFileSync(path.join(root,'.iris-agentic-dev.toml'),toml);
  const server=http.createServer((req,res)=>{
    let raw='';req.on('data',data=>raw+=data);req.on('end',()=>{
      let body;try{body=JSON.parse(raw);}catch{}
      seen.push({method:req.method,url:req.url,body,authorization:!!req.headers.authorization,cookie:req.headers.cookie});
      if(req.url.includes('IRISLogout=end')){res.writeHead(401);res.end('{}');return;}
      if(req.headers.authorization==='Basic '+Buffer.from('fixture:wrong-fixture').toString('base64')){res.writeHead(401);res.end('{}');return;}
      res.setHeader('Content-Type','application/json');
      res.setHeader('Set-Cookie','CSPSESSIONID-fixture=upgrade; Path=/api/atelier/');
      const doc=/\/doc\/([^?]+)/.exec(req.url)?.[1];
      let content={version:'IRIS for test',api:1};
      if(doc&&req.method==='PUT')documents.set(decodeURIComponent(doc),body.content);
      if(doc&&req.method==='GET')content=documents.get(decodeURIComponent(doc))||[];
      if(req.url.includes('/action/query'))content=[{Value:'Development',probe:1,result:'IADSCM|{"kind":"none"}'}];
      res.end(JSON.stringify({status:{errors:[]},result:{content}}));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const inherited=Object.fromEntries(Object.keys(process.env).filter(k=>/^(IRIS_|IAD_)/.test(k)).map(k=>[k,undefined]));
  const client=new JsonLineMcpClient(binary,['mcp','--no-skills'],{...inherited,...(process.platform==='win32'?{}:{HOME:home}),IRIS_HOST:'127.0.0.1',IRIS_WEB_PORT:String(server.address().port),IRIS_SCHEME:'http',IRIS_NAMESPACE:'TEST',IRIS_USERNAME:'fixture',IRIS_PASSWORD:'fixture',IRIS_MANAGED_NO_RETRIES:'1',...env},{cwd:root});
  t.after(async()=>{
    await client.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    if(hint&&fs.existsSync(hint)&&!fs.lstatSync(hint).isSymbolicLink()) {
      const current=fs.readFileSync(hint);let value;try{value=JSON.parse(current);}catch{}
      if(value?.uri==='isfs://TEST/Fixture171.mac') { if(previousHint)fs.writeFileSync(hint,previousHint);else fs.unlinkSync(hint); }
    }
    if(ownsTempDirectory(temporary))fs.rmSync(temporary,{recursive:true});
  });
  await client.request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'upgrade-test',version:'1'}});client.notify('notifications/initialized',{});
  const call=async(name,args)=>client.request('tools/call',{name,arguments:args});
  return {client,call,seen,documents,port:server.address().port};
}

test('upgraded vendor uploads and compiles a routine, then recompiles its stored source',options,async t=>{
  const {call,seen,documents}=await fixture(t);
  const content='ROUTINE Fixture171\nFixture171\n quit';
  const put=await call('iris_doc',{mode:'put',name:'Fixture171.mac',content,compile:true,namespace:'TEST'});
  assert.notEqual(put.result?.isError,true,JSON.stringify(put));
  assert.deepEqual(documents.get('Fixture171.mac'),content.split('\n'));
  assert.equal(seen.filter(r=>r.method==='PUT'&&r.url.includes('/doc/Fixture171.mac')).length,1);
  assert.ok(seen.some(r=>r.method==='POST'&&r.url.includes('/action/compile')&&r.body?.includes('Fixture171.mac')));
  const compile=await call('iris_compile',{target:'Fixture171.mac',flags:'cuk/checkuptodate=expandedonly',namespace:'TEST'});
  assert.notEqual(compile.result?.isError,true,JSON.stringify(compile));
  assert.equal(seen.filter(r=>r.authorization).length,1,'Upload and compile must reuse the initial login');
});

test('upgraded vendor refuses compile-time execution and invalid namespace before dispatch',options,async t=>{
  const {call,seen}=await fixture(t);
  const before=seen.length;
  const content='Class Fixture.Gate Extends %RegisteredObject\n{\nParameter P = {$Increment(^Fixture)};\n}';
  const blocked=await call('iris_doc',{mode:'put',name:'Fixture.Gate.cls',content,compile:true,namespace:'TEST'});
  assert.equal(blocked.result?.isError,true);assert.match(JSON.stringify(blocked),/COMPILE_TIME_EXEC_BLOCKED/);
  const invalid=await call('iris_query',{query:'SELECT 1',mode:'read',namespace:"TEST')"});
  assert.match(JSON.stringify(invalid),/INVALID_NAMESPACE/);
  assert.equal(seen.length,before,'Rejected source and parameters must issue no HTTP request');
});

test('upgraded vendor reports untrusted workspace write settings without opening the launch gate',options,async t=>{
  const {call,seen}=await fixture(t,{env:{IRIS_WRITE_TOOLS_ENABLED:'0'},toml:'write_tools_enabled = true\n'});
  const config=extractToolText(await call('check_config',{}));
  assert.equal(config.write_tools_enabled,false);
  assert.ok(config.set_aside.some(item=>JSON.stringify(item).includes('write_tools_enabled')),JSON.stringify(config.set_aside));
  const before=seen.length;
  const result=await call('iris_doc',{mode:'put',name:'Fixture171.mac',content:'ROUTINE Fixture171\n quit',namespace:'TEST'});
  assert.equal(result.result?.isError,true);assert.equal(seen.length,before);
});

test('upgraded strict read-only permits SQL and refuses compiled-document scratch execution',options,async t=>{
  const {call,seen}=await fixture(t,{env:{IAD_READ_ONLY:'strict'}});
  assert.notEqual((await call('iris_query',{query:'SELECT 1 AS probe',mode:'read',namespace:'TEST'})).result?.isError,true);
  const before=seen.length;
  const result=await call('iris_doc',{mode:'compiled',name:'Fixture.Gate.cls',namespace:'TEST'});
  assert.match(JSON.stringify(result),/READ_ONLY_STRICT/);assert.equal(seen.length,before);
});

test('a credential probe has a private session and its dispatch is counted without stopping the primary',options,async t=>{
  const {client,call,seen,port}=await fixture(t);
  const count=()=>[...client.stderr.matchAll(/IMEDICAL_HTTP_SEND=(\d+)/g)].map(match=>Number(match[1])).at(-1)||0;
  const before=count(),requests=seen.length;
  const result=extractToolText(await call('iris_test_server',{host:'127.0.0.1',web_port:port,username:'fixture',password:'wrong-fixture'}));
  assert.equal(result.auth,false,JSON.stringify(result));
  assert.equal(seen.length,requests+1);assert.equal(seen.at(-1).cookie,undefined,'A probe must not borrow the primary cookie');
  assert.equal(count(),before+1,'A dispatched credential probe must not be mistaken for a before-send rejection');
  assert.notEqual((await call('iris_query',{query:'SELECT 1',mode:'read',namespace:'TEST'})).result?.isError,true);
});
