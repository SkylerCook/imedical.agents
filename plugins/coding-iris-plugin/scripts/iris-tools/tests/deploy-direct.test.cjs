'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {prepare,run}=require('../deploy-direct'),{parse,backendAdapter}=require('../deploy-protected');
const {Attention}=require('../deploy-guard');

function fixture(t,contents=['Class Demo.A\n{\n}\n']) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iris-direct-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const files=contents.map((content,i)=>{const localPath=path.join(dir,`Demo.${i}.cls`);fs.writeFileSync(localPath,content);return {localPath,remotePath:`Demo.${i}.cls`};});
 const remote=new Map(),events=[];
 const adapter={
  read:async f=>{events.push('read:'+f.remotePath);return remote.get(f.remotePath)??null;},
  put:async f=>{events.push('put:'+f.remotePath);remote.set(f.remotePath,Buffer.from(f.bytes));},
  compile:async files=>{events.push('compile');return {status:'compiled',documents:files.map(f=>f.remotePath),errors:[]};}
 };
 return {dir,files,remote,events,adapter};
}

test('direct is default; legacy demand keeps guarded semantics; modes are explicit',()=>{
 assert.equal(parse(['--files','A.cls','--execute']).mode,'direct');
 assert.equal(parse(['--files','A.cls','--demand','123']).mode,'guarded');
 assert.equal(parse(['--files','A.cls','--mode','direct','--demand','123']).mode,'direct');
 assert.throws(()=>parse(['--files','A.cls','--mode','guarded']),/demand-required/);
 assert.throws(()=>parse(['--files','A.cls','--mode','direct','--decision','x']),/decision-requires-guarded/);
 assert.throws(()=>parse(['--files','A.cls','--mode','unknown']),/unsupported-deploy-mode/);
});

test('uploads a batch without Git, verifies all files, then compiles',async t=>{
 const f=fixture(t,['Class Demo.A\n{\n}\n','Class Demo.B\n{\n}\n']);
 const result=await run({...f,kind:'backend'});
 assert.equal(result.status,'verified');assert.equal(result.files.length,2);
 assert.equal(f.events.at(-1),'compile');
 assert.ok(f.events.indexOf('read:Demo.1.cls')<f.events.indexOf('put:Demo.0.cls'));
 assert.equal(fs.existsSync(path.join(f.dir,'.git')),false);
 assert.deepEqual(fs.readdirSync(f.dir).sort(),['Demo.0.cls','Demo.1.cls']);
});

test('unchanged source is not uploaded but still compiles',async t=>{
 const f=fixture(t);f.remote.set(f.files[0].remotePath,fs.readFileSync(f.files[0].localPath));
 const result=await run({...f,kind:'backend'});
 assert.equal(result.status,'verified');assert.equal(result.files[0].status,'unchanged');
 assert.equal(f.events.some(x=>x.startsWith('put:')),false);assert.equal(f.events.at(-1),'compile');
});

test('preserves generated Storage in deployment content without changing source',async t=>{
 const f=fixture(t),file=f.files[0],source=fs.readFileSync(file.localPath);
 const storage='Storage Default\n{\n<DataLocation>^DemoD</DataLocation>\n}';
 f.remote.set(file.remotePath,Buffer.from('Class Demo.A\n{\n'+storage+'\n}\n'));
 assert.equal((await run({...f,kind:'backend'})).status,'verified');
 assert.ok(f.remote.get(file.remotePath).toString().includes(storage));
 assert.deepEqual(fs.readFileSync(file.localPath),source);
 assert.throws(()=>prepare('A.cls','Class A\n{\n'+storage+'\n}', 'Class A\n{\n'+storage.replace('DemoD','OtherD')+'\n}'),/storage-review/);
});

test('all preflights run before writes: Storage conflicts and invalid UTF8 stop batch',async t=>{
 const f=fixture(t,['Class Demo.A\n{\n}\n',Buffer.from([255])]);
 const result=await run({...f,kind:'backend'});
 assert.equal(result.status,'blocked');assert.equal(result.reason,'encoding-unknown');
 assert.equal(f.events.some(x=>x.startsWith('put:')),false);
 const storage=fixture(t,['Class Demo.A\n{\n}\n','Class Demo.B\n{\nStorage Default\n{\n<DataLocation>^Local</DataLocation>\n}\n}\n']);
 storage.remote.set(storage.files[1].remotePath,Buffer.from('Class Demo.B\n{\nStorage Default\n{\n<DataLocation>^Remote</DataLocation>\n}\n}\n'));
 assert.equal((await run({...storage,kind:'backend'})).reason,'storage-review-required');
 assert.equal(storage.events.some(x=>x.startsWith('put:')),false);
});

test('a concurrent server change blocks upload instead of overwriting',async t=>{
 const f=fixture(t);let reads=0;
 f.adapter.read=async()=>Buffer.from(++reads===1?'old':'someone else');
 const result=await run({...f,kind:'backend'});
 assert.equal(result.reason,'remote-changed-during-deploy');assert.equal(result.status,'blocked');
 assert.equal(f.events.length,0);
});

test('a concurrent local edit and duplicate destinations block writes',async t=>{
 const f=fixture(t);f.adapter.read=async()=>{fs.writeFileSync(f.files[0].localPath,'changed');return null;};
 assert.equal((await run({...f,kind:'backend'})).reason,'local-changed-during-deploy');
 f.adapter.read=async()=>null;
 assert.equal((await run({...f,files:[...f.files,...f.files],kind:'backend'})).reason,'duplicate-remote-path');
 assert.equal(f.events.length,0);
});

test('readback mismatch and unknown upload never compile or retry',async t=>{
 const f=fixture(t);let writes=0;
 f.adapter.put=async()=>{writes++;};
 let result=await run({...f,kind:'backend'});
 assert.equal(result.reason,'readback-mismatch');assert.equal(result.partialOrUnknown,true);assert.equal(writes,1);
 assert.equal(f.events.includes('compile'),false);
 f.adapter.put=async()=>{writes++;throw Error('connection lost');};
 result=await run({...f,kind:'backend'});
 assert.equal(result.status,'failed-or-unknown');assert.equal(writes,2);assert.equal(f.events.includes('compile'),false);
 assert.equal(result.failedFile,'Demo.0.cls');
});

test('compiler errors return diagnostics and never report verified',async t=>{
 const f=fixture(t);
 f.adapter.compile=async()=>{throw new Attention('compile-failed',{compilation:{status:'compile-failed',errors:[{document:'Demo.0.cls'}],console:['syntax error']}});};
 const result=await run({...f,kind:'backend'});
 assert.equal(result.status,'compile-failed');assert.deepEqual(result.details.compilation.console,['syntax error']);
 assert.equal(result.files[0].status,'uploaded');
});

test('frontend preserves UTF8 BOM and CRLF; syntax failures stop before upload',async t=>{
 const f=fixture(t,[Buffer.from('\uFEFFconst x = "中文";\r\n')]);f.files[0].remotePath='/web/scripts/a.js';
 const bytes=fs.readFileSync(f.files[0].localPath);
 assert.equal((await run({...f,kind:'frontend'})).status,'verified');
 assert.deepEqual(f.remote.get(f.files[0].remotePath),bytes);
 fs.writeFileSync(f.files[0].localPath,'const =;');f.events.length=0;
 assert.equal((await run({...f,kind:'frontend'})).reason,'javascript-syntax-failed');
 assert.equal(f.events.some(x=>x.startsWith('put:')),false);
});

test('real Atelier adapter uses read timestamp and surfaces per-document errors',async t=>{
 const http=require('node:http');const f=fixture(t);let content=['Class Demo.Old','{','}'],conditional=false;
 const server=http.createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{
  if(req.method==='PUT'){conditional=req.headers['if-none-match']==='2026-01-01 00:00:00.000';content=JSON.parse(body).content;}
  const payload=req.url.includes('/action/compile')?{status:{errors:[]},result:{content:[{name:'Demo.0.cls',status:'compile error'}]},console:['syntax error']}:{status:{errors:[]},result:{content,ts:'2026-01-01 00:00:00.000',enc:false}};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(payload));
 });});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const adapter=backendAdapter({protocol:'http:',hostname:'127.0.0.1',port:server.address().port,path:'/api/atelier/v1/TEST/action/compile',auth:'test:test'});
 const result=await run({...f,adapter,kind:'backend'});
 assert.equal(result.status,'compile-failed');assert.equal(conditional,true);
 assert.ok(result.details.compilation.errors.some(e=>e.document==='Demo.0.cls'));
});

test('compile CLI deploys without Git or demand, keeps source, and plan never connects',async t=>{
 const {spawn}=require('node:child_process'),http=require('node:http');
 const f=fixture(t);let content=['Class Demo.Old','{','}'],requests=0,puts=0,compiles=0;
 const server=http.createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{
  requests++;
  if(req.method==='PUT'){puts++;content=JSON.parse(body).content;}
  if(req.url.includes('/action/compile'))compiles++;
  res.end(JSON.stringify({status:{errors:[]},result:{content:req.url.includes('/action/compile')?[]:content,ts:'2026-01-01 00:00:00.000',enc:false},console:[]}));
 });});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 fs.mkdirSync(path.join(f.dir,'.agents/config'),{recursive:true});
 fs.writeFileSync(path.join(f.dir,'.agents/config/project-env.json'),JSON.stringify({iris:{namespace:'TEST'},mcp:{serverName:'iris'}}));
 fs.writeFileSync(path.join(f.dir,'.mcp.json'),JSON.stringify({mcpServers:{iris:{env:{IRIS_HOST:'127.0.0.1',IRIS_WEB_PORT:String(server.address().port),IRIS_USERNAME:'test',IRIS_PASSWORD:'fake',IRIS_NAMESPACE:'TEST',IRIS_SCHEME:'http'}}}}));
 const invoke=extra=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.resolve(__dirname,'../compile.js'),'--project-root',f.dir,'--files',path.basename(f.files[0].localPath),...extra],{cwd:f.dir,windowsHide:true});
  let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  const timer=setTimeout(()=>{child.kill();reject(Error('CLI deadline'));},15000);
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});
 });
 const planned=await invoke([]);assert.equal(planned.code,0,planned.out+planned.err);assert.equal(requests,0);
 const original=fs.readFileSync(f.files[0].localPath),deployed=await invoke(['--execute']);
 assert.equal(deployed.code,0,deployed.out+deployed.err);assert.equal(JSON.parse(deployed.out).status,'verified');
 assert.equal(puts,1);assert.equal(compiles,1);assert.equal(fs.existsSync(path.join(f.dir,'.git')),false);
 assert.deepEqual(fs.readFileSync(f.files[0].localPath),original);
});
