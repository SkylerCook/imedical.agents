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
 assert.ok(f.events.slice(f.events.indexOf('compile')+1).every(x=>x.startsWith('read:')));
 assert.ok(f.events.indexOf('read:Demo.1.cls')<f.events.indexOf('put:Demo.0.cls'));
 assert.equal(fs.existsSync(path.join(f.dir,'.git')),false);
 assert.deepEqual(fs.readdirSync(f.dir).sort(),['Demo.0.cls','Demo.1.cls']);
});

test('unchanged source is not uploaded but still compiles',async t=>{
 const f=fixture(t);f.remote.set(f.files[0].remotePath,fs.readFileSync(f.files[0].localPath));
 const result=await run({...f,kind:'backend'});
 assert.equal(result.status,'verified');assert.equal(result.files[0].status,'unchanged');
 assert.equal(f.events.some(x=>x.startsWith('put:')),false);assert.ok(f.events.indexOf('compile')<f.events.length-1);
});

test('a non-storage class with non-XML XData keeps the existing exact round-trip path',async t=>{
 const content='Class Demo.Json\n{\nXData Settings [ MimeType = "application/json" ]\n{\n{"text":"braces { }"}\n}\n}\n';
 const f=fixture(t,[content]);
 const result=await run({...f,kind:'backend'});assert.equal(result.status,'verified',JSON.stringify(result));
 assert.equal(result.files[0].storageSynced,false);assert.equal(fs.readFileSync(f.files[0].localPath,'utf8'),content);
});

test('preserves server Storage in upload and backfills it to source after compilation',async t=>{
 const f=fixture(t),file=f.files[0];
 const storage='Storage Default\n{\n<DataLocation>^DemoD</DataLocation>\n}';
 f.remote.set(file.remotePath,Buffer.from('Class Demo.A\n{\n'+storage+'\n}\n'));
 const result=await run({...f,kind:'backend'});
 assert.equal(result.status,'verified');assert.equal(result.files[0].storageSynced,true);
 assert.ok(f.remote.get(file.remotePath).toString().includes(storage));
 assert.ok(fs.readFileSync(file.localPath,'utf8').includes(storage));
 assert.throws(()=>prepare('A.cls','Class A\n{\n'+storage+'\n}', 'Class A\n{\n'+storage.replace('DemoD','OtherD')+'\n}'),/storage-review/);
});

test('new persistent class round trip and property evolution preserve BOM, CRLF and local code',async t=>{
 const original='\uFEFFClass Demo.A Extends %Persistent\r\n{\r\n/// local comment\r\nProperty Name As %String;\r\n}\r\n';
 const f=fixture(t,[original]),file=f.files[0];
 const block=n=>'Storage Default\n{\n<Data name="DefaultData">\n<Value name="1"><Value>Name</Value></Value>'+(n>1?'<Value name="2"><Value>Added</Value></Value>':'')+'\n</Data>\n<Type>%Storage.Persistent</Type>\n}';
 let version=1,compiles=0;
 f.adapter.compile=async()=>{compiles++;const remote=f.remote.get(file.remotePath).toString();
  f.remote.set(file.remotePath,Buffer.from(compiles===1?remote.replace(/}\n$/,block(version)+'\n}\n'):remote.replace(block(version-1),block(version))));return {status:'compiled'};};
 let result=await run({...f,kind:'backend'});
 assert.equal(result.status,'verified');assert.equal(result.localStorageSync.files[0],file.remotePath);
 let local=fs.readFileSync(file.localPath,'utf8');assert.ok(local.startsWith('\uFEFF'));assert.ok(!local.replace(/\r\n/g,'').includes('\n'));
 assert.ok(local.includes('/// local comment\r\nProperty Name As %String;\r\n'));
 const updated=local.replace('Property Name As %String;','Property Name As %String;\r\nProperty Added As %String;');fs.writeFileSync(file.localPath,updated);version++;
 result=await run({...f,kind:'backend'});assert.equal(result.status,'verified');assert.equal(result.files[0].storageSynced,true);
 local=fs.readFileSync(file.localPath,'utf8');assert.ok(local.includes('<Value name="2">'));assert.ok(local.includes('Property Added As %String;\r\n'));
 const before=fs.readFileSync(file.localPath);f.adapter.compile=async()=>({status:'compiled'});
 result=await run({...f,kind:'backend'});assert.equal(result.status,'verified');assert.equal(result.files[0].storageSynced,false);assert.deepEqual(fs.readFileSync(file.localPath),before);
});

test('post-compile body change, missing source, malformed or removed Storage never backfill',async t=>{
 for(const mode of ['body','missing','malformed','removed']){
  const storage='Storage Default\n{\n<Type>%Storage.Persistent</Type>\n}';
  const original='Class Demo.A\n{\n'+(mode==='removed'?storage+'\n':'')+'}\n';
  const f=fixture(t,[original]),file=f.files[0];
  f.adapter.compile=async()=>{const content=f.remote.get(file.remotePath).toString();
   if(mode==='missing')f.remote.delete(file.remotePath);
   else f.remote.set(file.remotePath,Buffer.from(mode==='body'?content.replace('Demo.A','Demo.Other'):mode==='malformed'?content.replace(/}\n$/, 'Storage Default\n{\n<Type>broken\n}\n}\n'):content.replace(storage,'')));
   return {status:'compiled'};
  };
  const result=await run({...f,kind:'backend'});assert.equal(result.status,'storage-sync-incomplete',mode);assert.equal(result.remoteCompilation,'compiled');
  assert.equal(fs.readFileSync(file.localPath,'utf8'),original);assert.equal(f.events.filter(e=>e.startsWith('put:')).length,1);
 }
});

test('whole batch is checked before backfill and compile-time local edits survive',async t=>{
 for(const mode of ['remote','local']){
  const f=fixture(t,['Class Demo.A\n{\n}\n','Class Demo.B\n{\n}\n']),original=f.files.map(file=>fs.readFileSync(file.localPath));
  f.adapter.compile=async()=>{
   for(const file of f.files)f.remote.set(file.remotePath,Buffer.from(f.remote.get(file.remotePath).toString().replace(/}\n$/,'Storage Default\n{\n<Type>%Storage.Persistent</Type>\n}\n}\n')));
   if(mode==='remote')f.remote.set(f.files[1].remotePath,Buffer.from('Class Other\n{\n}\n'));
   else fs.appendFileSync(f.files[1].localPath,'// user edit\n');
   return {status:'compiled'};
  };
  const result=await run({...f,kind:'backend'});assert.equal(result.status,'storage-sync-incomplete');assert.deepEqual(result.localStorageSync.files,[]);
  assert.deepEqual(fs.readFileSync(f.files[0].localPath),original[0]);
  if(mode==='local')assert.ok(fs.readFileSync(f.files[1].localPath,'utf8').endsWith('// user edit\n'));
 }
});

test('macro documents keep source and also require post-compile readback',async t=>{
 const f=fixture(t,['ROUTINE Demo\n quit\n']);f.files[0].remotePath='Demo.mac';
 f.adapter.compile=async()=>{f.remote.set('Demo.mac',Buffer.from('ROUTINE Demo\n write 1\n'));return {status:'compiled'};};
 assert.equal((await run({...f,kind:'backend'})).reason,'post-compile-source-changed');
 assert.equal(fs.readFileSync(f.files[0].localPath,'utf8'),'ROUTINE Demo\n quit\n');
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

test('compile CLI backfills generated Storage without Git, and plan never connects',async t=>{
 const {spawn}=require('node:child_process'),http=require('node:http');
 const f=fixture(t);let content=['Class Demo.Old','{','}'],requests=0,puts=0,compiles=0;
 const server=http.createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{
  requests++;
  if(req.method==='PUT'){puts++;content=JSON.parse(body).content;}
  if(req.url.includes('/action/compile')){compiles++;if(!content.includes('Storage Default'))content.splice(content.lastIndexOf('}'),0,'Storage Default','{','<Type>%Storage.Persistent</Type>','}');}
  res.end(JSON.stringify({status:{errors:[]},result:{content:req.url.includes('/action/compile')?[]:content,ts:'2026-01-01 00:00:00.000',enc:false},console:[]}));
 });});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 fs.mkdirSync(path.join(f.dir,'.agents/config'),{recursive:true});
 fs.mkdirSync(path.join(f.dir,'.agents/.git'));
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
 assert.ok(fs.readFileSync(f.files[0].localPath,'utf8').includes('Storage Default'));
 assert.ok(fs.readFileSync(f.files[0].localPath,'utf8').startsWith(original.toString().split('}')[0]));
 const again=await invoke(['--execute']);assert.equal(again.code,0,again.out+again.err);assert.equal(puts,1);assert.equal(compiles,2);
 assert.equal(JSON.parse(again.out).files[0].storageSynced,false);
 // Source backfill must not bypass managed night frozen-version review.
 fs.writeFileSync(f.files[0].localPath,original);
 const night=require('../../../../../scripts/lib/night-execution'),output=[],receipts=[];
 t.mock.method(night,'begin',()=>({operation:{id:'synthetic'}}));t.mock.method(night,'reusableDeployment',()=>null);
 t.mock.method(night,'finish',(_binding,result)=>receipts.push(result));t.mock.method(console,'log',line=>output.push(JSON.parse(line)));
 const exitCode=process.exitCode;
 try{
  await require('../deploy-protected').main('backend',['--project-root',f.dir,'--files',path.basename(f.files[0].localPath),'--execute']);
  assert.equal(output[0].status,'review-pending');assert.equal(output[0].deploymentStatus,'verified');assert.equal(output[0].reason,'storage-sync-requires-source-review');assert.equal(process.exitCode,1);
  assert.equal(receipts[0].status,'review-pending');assert.equal(receipts[0].localStorageSync.status,'verified');
 }finally{process.exitCode=exitCode;}
});

test('Storage parser ignores method strings/comments and XML braces; rejects ambiguous blocks',()=>{
 const sync=require('../storage-sync');
 const storage='Storage Default\n{\n<Data name="D"><Value name="1"><Value>{Name}</Value></Value><Empty /></Data>\n<!-- } -->\n<Type><![CDATA[} {]]></Type>\n}';
 const source='Class Demo.A\n{\n/*\nStorage Fake\n{\n}\n*/\nClassMethod Test()\n{\n set x = "Storage Fake { }"\n // Storage Fake {\n}\nXData Sample\n{\n<Test>{a}</Test>\n}\n'+storage+'\n}\n';
 assert.equal(sync.storage(source),storage);
 assert.equal(sync.storage('Class Demo.A\n{\nstorage Default\n{\n<Type>%Storage.Persistent</Type>\n}\n}\n'),'storage Default\n{\n<Type>%Storage.Persistent</Type>\n}');
 assert.throws(()=>sync.storage(source.replace('</Data>','</Other>')),/storage-format-unknown/);
 assert.throws(()=>sync.storage(source.replace(storage,storage+'\n'+storage)),/storage-format-unknown/);
 const additional='Storage Other\n{\n<Type>%Storage.Persistent</Type>\n}';
 const result=sync.backfill(source,source.replace(storage,storage+'\n'+additional)).toString();
 assert.ok(result.includes(additional));assert.ok(result.includes('ClassMethod Test()'));
 assert.throws(()=>sync.backfill(source,source.replace(storage,additional+'\n'+storage)),/post-compile-storage-reordered/);
});

test('local replacement failure reports compiled/incomplete, keeps source and removes only its temporary file',async t=>{
 const f=fixture(t),file=f.files[0],before=fs.readFileSync(file.localPath);
 f.adapter.compile=async()=>{f.remote.set(file.remotePath,Buffer.from(before.toString().replace(/}\n$/,'Storage Default\n{\n<Type>%Storage.Persistent</Type>\n}\n}\n')));return {status:'compiled'};};
 const rename=fs.renameSync;t.mock.method(fs,'renameSync',(from,to)=>{if(to===file.localPath)throw Error('test: file busy');return rename(from,to);});
 const result=await run({...f,kind:'backend'});assert.equal(result.status,'storage-sync-incomplete');assert.equal(result.remoteCompilation,'compiled');
 assert.deepEqual(fs.readFileSync(file.localPath),before);assert.deepEqual(fs.readdirSync(f.dir),[path.basename(file.localPath)]);
});

test('late local/server changes block sync and partial local sync is explicitly reported',async t=>{
 for(const mode of ['late-local','late-server','partial'])await t.test(mode,async t=>{
  const f=fixture(t,['Class Demo.A\n{\n}\n','Class Demo.B\n{\n}\n']),before=f.files.map(file=>fs.readFileSync(file.localPath));
  f.adapter.compile=async()=>{for(const file of f.files)f.remote.set(file.remotePath,Buffer.from(fs.readFileSync(file.localPath,'utf8').replace(/}\n$/,'Storage Default\n{\n<Type>%Storage.Persistent</Type>\n}\n}\n')));return {status:'compiled'};};
  if(mode==='late-server'){
   const read=f.adapter.read;let reads=0;
   f.adapter.read=async file=>{if(++reads===10)f.remote.set(file.remotePath,Buffer.from('Class Changed\n{\n}\n'));return read(file);};
  }else if(mode==='partial'){
   const rename=fs.renameSync;t.mock.method(fs,'renameSync',(from,to)=>{if(to===f.files[1].localPath)throw Error('busy');return rename(from,to);});
  }else{
   const open=fs.openSync;t.mock.method(fs,'openSync',(name,...args)=>{const fd=open(name,...args);if(typeof name==='string'&&name.endsWith('.tmp'))fs.appendFileSync(f.files[0].localPath,'// latest edit\n');return fd;});
  }
  const result=await run({...f,kind:'backend'});assert.equal(result.status,'storage-sync-incomplete',JSON.stringify(result));
  assert.deepEqual(result.localStorageSync.files,mode==='partial'?[f.files[0].remotePath]:[]);
  if(mode==='partial')assert.ok(fs.readFileSync(f.files[0].localPath,'utf8').includes('Storage Default'));
  else if(mode==='late-local')assert.ok(fs.readFileSync(f.files[0].localPath,'utf8').endsWith('// latest edit\n'));
  else assert.deepEqual(fs.readFileSync(f.files[0].localPath),before[0]);
  assert.deepEqual(fs.readFileSync(f.files[1].localPath),before[1]);assert.equal(fs.readdirSync(f.dir).length,2);
 });
});
