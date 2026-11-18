'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../../tools/iris-code-export');
for(const invalid of [false,true])test('encoded Web chunks preserve bytes and reject invalid base64: '+invalid,{skip:process.platform!=='win32'},async t=>{
 const chunks=[Buffer.from('<html>\r\n'),Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from('\r\n</html>')];
 const f=await fixture(t,{documentResult:name=>({name,enc:true,content:invalid?['!not-base64!']:chunks.map(x=>x.toString('base64'))})});
 const job=f.job('encoded',1,1);fs.writeFileSync(path.join(job.batch,'files.txt'),'/app/demo.html');
 f.send({op:'run',job,user:'test',password:'not-a-secret'});const result=await f.wait('result');assert.equal(result.data.blocked,false,result.data.output+f.errors());
 let receipt=JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8'));
 if(invalid){assert.equal(receipt.reason,'atelier-base64-invalid');assert.equal(receipt.items[0].status,'failed');assert.equal(receipt.logoutVerified,true);}
 else{
  const item=receipt.items[0];assert.equal(item.status,'fetched');assert.equal(item.contentEncoding,'base64');
  assert.deepEqual(fs.readFileSync(path.join(job.batch,'export',item.path)),Buffer.concat(chunks));
  f.send({op:'close'});await f.wait('closed');
  f.send({op:'run',job,user:'test',password:'not-a-secret',resume:true});await f.wait('result');assert.equal(f.stats().reads,1);
 }
});
async function fixture(t,{idle=120,failLogout=false,failAt=0,dropAt=0,rotateAt=0,refreshAt=0,rejectAt=0,rejectionCookie=false,delay=40,documentResult=null,documentStatus=null,catalog=null}={}){
 const parent=path.join(os.tmpdir(),'Codex');fs.mkdirSync(parent,{recursive:true});
 const dir=fs.mkdtempSync(path.join(parent,'iris-gui-test-'));let auth=0,reads=0,active=0,peak=0,exits=0;const cookies=new Set(),starts=[],requests=[];
 const server=http.createServer(async (req,res)=>{
  if(req.method==='HEAD'){exits++; if(!failLogout)cookies.delete(req.headers.cookie);res.writeHead(failLogout?500:401);res.end();return;}
  requests.push(req.url);starts.push(Date.now());reads++;const requestNumber=reads;active++;peak=Math.max(active,peak);let cookie=req.headers.cookie;
  if(req.headers.authorization){auth++;if(requestNumber===rejectAt&&!rejectionCookie){res.writeHead(401);res.end();active--;return;}cookie='CSPSESSIONID='+(refreshAt?'00000000ABCD'+String(auth).padStart(10,'0')+'M'.repeat(28):auth);cookies.add(cookie);res.setHeader('Set-Cookie',cookie+'; Path=/api/atelier/');if(requestNumber===rejectAt){res.writeHead(401);res.end();active--;return;}}
  if(!cookies.has(cookie)){res.writeHead(401);res.end();active--;return;}
  if(dropAt&&requestNumber>=dropAt){res.destroy();active--;return;}
  if(requestNumber===refreshAt){cookies.delete(cookie);cookie=cookie.replace('=00000000','=00000001').replace(/M{28}$/,'N'.repeat(28));cookies.add(cookie);res.setHeader('Set-Cookie',cookie+'; Path=/api/atelier/');}
  if(requestNumber===rotateAt){cookies.delete(cookie);cookie=refreshAt?cookie.replace('ABCD','WXYZ'):'CSPSESSIONID=rotated';cookies.add(cookie);res.setHeader('Set-Cookie',cookie+'; Path=/api/atelier/');}
  const requestUrl=new URL(req.url,'http://127.0.0.1');
  const category=requestUrl.pathname.split('/docnames/')[1]?.split('/')[0];
  if(catalog&&(category||requestUrl.pathname.includes('/cspapps/')||req.method==='POST')){
   let rows;
   if(category) {
    const filter=requestUrl.searchParams.get('filter');
    rows=catalog(category).filter(name=>!filter||name.toLowerCase().startsWith(filter.slice(0,-1).toLowerCase())).map(name=>({name,cat:category}));
   } else if(req.method==='POST') {
    let input='';for await(const data of req)input+=data;
    const request=JSON.parse(input);
    if(request.query.includes('RoutineMgr_StudioOpenDialog')) {
     const directory=request.parameters[0].slice(0,-1);
     const children=new Map();
     for(const stored of catalog('CSP')){
      const name='/'+stored.replaceAll('\\','/').replace(/^\/+/, '');
      if(!name.startsWith(directory))continue;
      const rest=name.slice(directory.length).split('/');
      children.set(rest[0],{Name:rest[0],Type:rest.length>1?10:5});
     }
     rows=[...children.values()];
    } else {
     rows=catalog('CLS').map(name=>({Name:name.slice(0,-4)}));
    }
   } else {rows=['/imedical'];}
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify({status:{errors:[]},result:{content:rows}}));
   active--;return;
  }
  const name=decodeURIComponent(requestUrl.pathname.split('/doc/')[1]);
  setTimeout(()=>{if(documentStatus&&documentStatus(name)===404){res.writeHead(404);res.end();active--;return;}if(requestNumber===failAt){res.writeHead(503);res.end();active--;return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:{errors:[]},result:documentResult?documentResult(name):{name,content:['Class '+name.slice(0,-4)+' Extends %RegisteredObject','{','}']}}));active--;},delay);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let child,buffer='',errors='',events=[],waiting=[];
 function launch(){
  child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'gui-worker.ps1'),'-StateDirectory',path.join(dir,'state'),'-IdleSeconds',String(idle)],{windowsHide:true});
  child.stderr.on('data',b=>errors+=b);
  child.stdout.on('data',b=>{buffer+=b;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(!line)continue;try{const e=JSON.parse(line);events.push(e);for(const w of [...waiting])if(w.kind===e.kind){waiting.splice(waiting.indexOf(w),1);clearTimeout(w.timer);w.resolve(e);break;}}catch{errors+=line;}}});
 }
 async function restart(){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});buffer='';events=[];launch();return wait('ready');}
 launch();
 function wait(kind){const i=events.findIndex(e=>e.kind===kind);if(i>=0)return Promise.resolve(events.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={kind,resolve:e=>{events.splice(events.indexOf(e),1);resolve(e);},timer:setTimeout(()=>reject(Error('timeout '+kind+' '+errors+' '+JSON.stringify(events))),20000)};waiting.push(w);});}
 function send(data){child.stdin.write(JSON.stringify(data)+'\n');}
 function job(name,sessions=1,count=2){const batch=path.join(dir,name);fs.mkdirSync(batch);fs.writeFileSync(path.join(batch,'files.txt'),Array.from({length:count},(_,i)=>'Demo.C'+i+'.cls').join('\n'));return {batch,url:'http://127.0.0.1:'+server.address().port+'/api/atelier/',ns:'TEST',sessions,interval:50};}
 t.after(async()=>{for(const w of waiting)clearTimeout(w.timer);if(child.exitCode===null){send({op:'quit'});await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()});});}await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 await wait('ready');return {send,wait,job,dir,restart,starts,requests,recoverTransport:()=>{dropAt=0;},stats:()=>({auth,reads,active,peak,exits}),errors:()=>errors};
}
test('scope preview expands mixed rules, then exact-file GUI reads retain the session and preserve assets',{skip:process.platform!=='win32'},async t=>{
 const documents={
  CLS:['Demo.Care.A.cls','Demo.Care.Inner.B.cls','Demo.CareOther.C.cls','User.CareNew.cls'],
  RTN:['User.CareUtils.mac','User.Other.inc'],
  CSP:['imedical/web/scripts/care/main.js','\\imedical\\web\\scripts\\care\\nested\\logo.png','imedical/web/scripts/care/empty','imedical/web/scripts/care2/no.js','imedical/web/csp/care.main.csp','imedical/web/csp/care.nested/no.js']
 };
 const png=Buffer.from([137,80,78,71,13,10,26,10]);
 const f=await fixture(t,{catalog:category=>documents[category],documentResult:name=>{
  if(name.endsWith('.cls'))return {name,content:['Class '+name.slice(0,-4),'{}']};
  if(name.includes('/'))return {name,enc:true,content:name.endsWith('/empty')?[]:[(name.endsWith('.png')?png:Buffer.from('original\r\n')).toString('base64')]};
  return {name,content:['ROUTINE '+name.slice(0,-4)]};
 }});
 const job={...f.job('scope'),expandScope:true,includeWebAssets:true};
 const rules='imedical/web/scripts/care/*\nimedical/web/csp/care.*\nDemo.Care\nUser.Care*\n/imedical/web/scripts/care/main.js';
 const scopePath=path.join(job.batch,'scope.txt'),send=extra=>f.send({op:'run',job,user:'test',password:'not-a-secret',...extra});
 send({op:'browse',job:{...job,expandScope:false}});
 const browse=(await f.wait('browse')).data;
 assert.equal(browse.exitCode,0,browse.output+f.errors());
 const choices=JSON.parse(browse.output);
 assert.deepEqual(choices.folders,['/imedical/']);
 assert.ok(choices.packages.includes('Demo.Care.Inner'));
 assert.ok(choices.packages.includes('Demo.Care'));
 assert.equal(f.requests.length,2);
 send({op:'browse',job:{...job,expandScope:false,browsePath:'/imedical/web/scripts/care/'}});
 const childBrowse=(await f.wait('browse')).data;
 assert.equal(childBrowse.exitCode,0,childBrowse.output);
 assert.deepEqual(JSON.parse(childBrowse.output).folders,['/imedical/web/scripts/care/nested/']);
 fs.writeFileSync(scopePath,rules+'\nDemo.NoSuchPackage');
 send({plan:true});
 let result=(await f.wait('result')).data;
 assert.equal(result.exitCode,0,result.output+f.errors());
 let plan=JSON.parse(result.output);
 assert.deepEqual(plan.unmatched,['Demo.NoSuchPackage']);
 assert.equal(plan.total,8);
 assert.equal(f.requests.length,10);
 assert.ok(f.requests.every(url=>!url.includes('/doc/')));
 assert.ok(f.requests.filter(url=>url.includes('/docnames/')).every(url=>url.includes('?filter=')));
 assert.equal(fs.existsSync(path.join(job.batch,'export')),false);

 fs.writeFileSync(scopePath,rules);
 send({plan:true});
 result=(await f.wait('result')).data;
 assert.equal(result.exitCode,0,result.output+f.errors());
 plan=JSON.parse(result.output);
 assert.deepEqual(plan.unmatched,[]);
 assert.deepEqual(plan.items.map(x=>x.document).sort(),[
  'Demo.Care.A.cls','Demo.Care.Inner.B.cls','User.CareNew.cls','User.CareUtils.mac',
  'imedical/web/csp/care.main.csp','imedical/web/scripts/care/empty','imedical/web/scripts/care/main.js','imedical/web/scripts/care/nested/logo.png'
 ].sort());
 const previewRequests=f.requests.length;
 fs.writeFileSync(path.join(job.batch,'files.txt'),plan.items.map(x=>(x.webAsset?'/':'')+x.document).join('\n'));
 send({maxFiles:1}); await f.wait('result');
 documents.CSP.push('imedical/web/scripts/care/new.js');
 send({resume:true}); result=(await f.wait('result')).data;
 assert.equal(JSON.parse(result.output).fetched,8,result.output+f.errors());
 assert.equal(f.stats().auth,1);
 assert.equal(f.requests.filter(url=>!url.includes('/doc/')).length,previewRequests);
 assert.ok(f.requests.filter(url=>url.includes('/doc/imedical/')).every(url=>url.endsWith('?binary=1')));
 const local=path.join(job.batch,'export/src/imedical/web/scripts/care');
 assert.deepEqual(fs.readFileSync(path.join(local,'nested/logo.png')),png);
 assert.deepEqual(fs.readFileSync(path.join(local,'main.js')),Buffer.from('original\r\n'));
 assert.equal(fs.statSync(path.join(local,'empty')).size,0);
 assert.equal(fs.existsSync(path.join(local,'new.js')),false);
 f.send({op:'close'});assert.equal((await f.wait('closed')).data.cleanupVerified,true);
});
test('CLI scope resume uses the saved expansion and rejects changed rules before reconnecting',{skip:process.platform!=='win32'},async t=>{
 const names=['Demo.Pkg.One.cls','Demo.Pkg.Two.cls'];
 const f=await fixture(t,{catalog:()=>names});
 const job=f.job('cli-scope'),rules=path.join(job.batch,'rules.txt'),out=path.join(job.batch,'export');
 fs.writeFileSync(rules,'Demo.Pkg');
 async function run(resume){
  const command="$env:PSModulePath=Join-Path $PSHOME Modules; $cred=[pscredential]::new('test',(ConvertTo-SecureString 'synthetic' -AsPlainText -Force)); & $env:IRIS_SCOPE_SCRIPT -ListFile $env:IRIS_SCOPE_RULES -OutputDirectory $env:IRIS_SCOPE_OUT -AtelierUrl $env:IRIS_SCOPE_URL -Namespace TEST -ExpandScope -Credential $cred -MaxFilesPerRun 1 -Resume:($env:IRIS_SCOPE_RESUME -eq '1') 6>$null; exit $LASTEXITCODE";
  const child=spawn('powershell.exe',['-NoProfile','-Command',command],{windowsHide:true,env:{...process.env,
   IRIS_SCOPE_SCRIPT:path.join(root,'export-iris-code.ps1'),IRIS_SCOPE_RULES:rules,IRIS_SCOPE_OUT:out,IRIS_SCOPE_URL:job.url,IRIS_SCOPE_RESUME:resume?'1':'0'}});
  let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  return {code,output};
 }
 let result=await run(false);
 assert.equal(result.code,2,result.output);
 assert.equal(JSON.parse(result.output).fetched,1);
 names.push('Demo.Pkg.New.cls');
 result=await run(true);
 assert.equal(result.code,0,result.output);
 assert.equal(JSON.parse(result.output).fetched,2);
 assert.equal(f.requests.filter(url=>url.includes('/docnames/')).length,1);
 assert.equal(fs.existsSync(path.join(out,'src/Demo/Pkg/New.cls')),false);
 fs.appendFileSync(rules,'\nDemo.Other');
 const before=f.requests.length;
 result=await run(true);
 assert.match(result.output,/resume-source-or-scope-mismatch/);
 assert.equal(result.code,1);
 assert.equal(f.requests.length,before);
});
test('interval bounds request starts without adding a second delay after a slow response',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{delay:600}),job=f.job('slow-response',1,3);job.interval=500;
 f.send({op:'run',job,user:'test',password:'not-a-secret'});await f.wait('result');
 const gaps=f.starts.slice(1).map((value,index)=>value-f.starts[index]);
 assert.ok(gaps.every(gap=>gap>=500),JSON.stringify(gaps));
 assert.ok(gaps.every(gap=>gap<1000),'extra post-response sleep: '+JSON.stringify(gaps));
 assert.equal(f.stats().peak,1);
});
for(const rotateAt of [0,3])test('CSP prefix and MAC refresh preserve identity but a changed identity stops: '+rotateAt,{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{refreshAt:2,rotateAt}),job=f.job('token-refresh',1,4);
 f.send({op:'run',job,user:'test',password:'not-a-secret'});const result=await f.wait('result');
 const receipt=JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8'));
 assert.equal(receipt.session.cookieRefreshCount,1);assert.equal(f.stats().auth,1);
 if(rotateAt){assert.equal(receipt.reason,'atelier-session-changed');assert.equal(f.stats().reads,3);assert.equal(f.stats().exits,2);}
 else{assert.equal(receipt.reason,null);assert.equal(f.stats().reads,4);assert.equal(result.data.retained,true);f.send({op:'close'});await f.wait('closed');assert.equal(f.stats().exits,1);}
});
test('one persistent worker reuses its cookie across batches and finalizes receipts only on close',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);for(const name of ['first','second']){const job=f.job(name);f.send({op:'run',job,user:'test',password:'not-a-secret'});const r=await f.wait('result');assert.equal(r.data.retained,true,JSON.stringify(r)+f.errors());assert.equal(f.stats().auth,1);assert.equal(JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8')).sessionRetained,true);}
 assert.equal(f.stats().reads,4);assert.equal(f.stats().exits,0);f.send({op:'close'});const closed=await f.wait('closed');assert.equal(closed.data.cleanupVerified,true,JSON.stringify(closed)+f.errors());assert.equal(f.stats().exits,1);
});
for(const failLogout of [false,true])test('server session rotation permits explicit resume only after verified cleanup: '+failLogout,{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{rotateAt:2,failLogout}),job=f.job('rotation',1,4);
 f.send({op:'run',job,user:'test',password:'not-a-secret'});const result=await f.wait('result');
 assert.equal(result.data.blocked,failLogout);assert.equal(result.data.retained,false);assert.equal(f.stats().reads,2);assert.equal(f.stats().auth,1);assert.equal(f.stats().exits,2);
 const receipt=JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8'));assert.equal(receipt.reason,'atelier-session-changed');assert.equal(receipt.logoutVerified,!failLogout);
 assert.equal(JSON.parse(result.data.output).logoutVerified,receipt.logoutVerified);
 assert.equal(receipt.sessionChange.phase,'after-response');assert.equal(receipt.sessionChange.cookieValueChanged,true);assert.equal(receipt.sessionChange.cookieScopeChanged,false);assert.equal(receipt.sessionChange.responseSetsCookie,true);
 assert.match(receipt.sessionChange.currentIdentity,/^[a-f0-9]{64}$/i);assert.ok(!JSON.stringify(receipt.sessionChange).includes('rotated'));
 f.send({op:'run',job,user:'test',password:'not-a-secret',resume:true});
 if(failLogout){await f.wait('error');assert.equal(f.stats().auth,1);}else{assert.equal((await f.wait('result')).data.retained,true);assert.equal(f.stats().reads,5);assert.equal(f.stats().auth,2);}
});
test('a pool of four stays four across batches, then idle reclamation closes every owned cookie',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{idle:1});for(const name of ['first','second']){f.send({op:'run',job:f.job(name,4,8),user:'test',password:'not-a-secret',confirmed:true});const r=await f.wait('result');assert.equal(r.data.retained,true,JSON.stringify(r)+f.errors());}
 assert.equal(f.stats().auth,4);assert.ok(f.stats().peak<=4);await f.wait('closed');assert.equal(f.stats().exits,4);
});
test('failed logout blocks the next batch instead of multiplying sessions',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{failLogout:true});f.send({op:'run',job:f.job('first'),user:'test',password:'not-a-secret'});await f.wait('result');f.send({op:'close'});assert.equal((await f.wait('closed')).data.blocked,true);f.send({op:'run',job:f.job('second'),user:'test',password:'not-a-secret'});assert.match((await f.wait('error')).data.reason,/previous-session-unresolved/);assert.equal(f.stats().auth,1);
});


test('ten is a hard ceiling, successful ten-session batches reuse ten identities',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);f.send({op:'run',job:f.job('invalid',11,20),user:'test',password:'not-a-secret',confirmed:true});assert.match((await f.wait('error')).data.reason,/1-through-10/);assert.equal(f.stats().reads,0);
 for(const name of ['ten-a','ten-b']){f.send({op:'run',job:f.job(name,10,20),user:'test',password:'not-a-secret',confirmed:true});assert.equal((await f.wait('result')).data.retained,true);}
 assert.equal(f.stats().auth,10);assert.ok(f.stats().peak<=10);f.send({op:'close'});assert.equal((await f.wait('closed')).data.cleanupVerified,true);assert.equal(f.stats().exits,10);
 assert.equal(fs.readFileSync(path.join(f.dir,'state/session-state.json'),'utf8').includes('not-a-secret'),false);
});
for(const failLogout of [false,true])test('503 drains in-flight work; only unresolved cleanup blocks explicit retry: '+failLogout,{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{failAt:1,failLogout,delay:100}),job=f.job('failure',4,30);f.send({op:'run',job,user:'test',password:'not-a-secret',confirmed:true});const r=await f.wait('result');assert.equal(r.data.blocked,failLogout);assert.ok(f.stats().reads<=4);assert.equal(f.stats().active,0);assert.equal(f.stats().exits,f.stats().auth);
 const receipt=JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8'));assert.equal(receipt.logoutVerified,!failLogout);
 if(!failLogout){f.send({op:'run',job,user:'test',password:'not-a-secret',confirmed:true,resume:true});assert.equal((await f.wait('result')).data.blocked,false);assert.equal(JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8')).items.every(i=>i.status==='fetched'),true);}
 else {const auth=f.stats().auth;f.send({op:'run',job,user:'test',password:'not-a-secret',confirmed:true,resume:true});assert.match((await f.wait('error')).data.reason,/previous-session-unresolved/);assert.equal(f.stats().auth,auth);}
});
test('transport loss after a known session can resume after verified cleanup without manual evidence',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{dropAt:2}),job=f.job('transport',1,3);f.send({op:'run',job,user:'test',password:'not-a-secret'});const r=await f.wait('result');assert.equal(r.data.blocked,false);const saved=JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8'));assert.equal(saved.reason,'atelier-transport-or-timeout');assert.equal(saved.logoutVerified,true);
 const before=f.stats().reads;f.recoverTransport();f.send({op:'run',job,user:'test',password:'not-a-secret',resume:true});assert.equal((await f.wait('result')).data.blocked,false);assert.equal(f.stats().reads,before+2);assert.equal(f.stats().auth,2);
});
test('safe stop finishes in-flight reads, closes cookies and leaves pending items resumable',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{delay:200}),job=f.job('cancel',4,30);f.send({op:'run',job,user:'test',password:'not-a-secret',confirmed:true});
 const limit=Date.now()+10000;while(f.stats().reads===0&&Date.now()<limit)await new Promise(r=>setTimeout(r,25));assert.ok(f.stats().reads>0);fs.writeFileSync(path.join(job.batch,'stop.request'),'stop');
 const r=await f.wait('result');assert.equal(r.data.blocked,false);assert.equal(f.stats().active,0);assert.ok(f.stats().reads<=4);assert.equal(f.stats().exits,f.stats().auth);
 const state=JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8'));assert.ok(state.items.some(x=>x.status==='pending'));assert.equal(state.logoutVerified,true);
});
test('GUI preview needs no credentials and performs zero network requests',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);f.send({op:'run',job:f.job('preview'),plan:true});const r=await f.wait('result');assert.equal(r.data.exitCode,0,JSON.stringify(r));assert.equal(JSON.parse(r.data.output).total,2);assert.equal(f.stats().reads,0);assert.equal(f.stats().auth,0);
});

test('abrupt worker death leaves a persistent barrier; restart cannot authenticate until evidence is recorded',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);f.send({op:'run',job:f.job('first'),user:'test',password:'not-a-secret'});await f.wait('result');
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'state/session-state.json'),'utf8')).active,true);
 assert.equal((await f.restart()).data.blocked,true);
 f.send({op:'run',job:f.job('second'),user:'test',password:'not-a-secret'});assert.match((await f.wait('error')).data.reason,/previous-session-unresolved/);assert.equal(f.stats().auth,1);
 f.send({op:'reconcile',confirm:false,evidence:'not confirmed'});assert.match((await f.wait('error')).data.reason,/evidence-required/);
 f.send({op:'reconcile',confirm:true,evidence:'Local mock: operator has reconciled the intentionally abandoned test session.'});assert.equal((await f.wait('reconciled')).data.blocked,false);
 assert.equal(fs.readdirSync(path.join(f.dir,'state')).filter(x=>x.startsWith('reconciliation-')).length,1);
});
test('resuming a completed trial skips verified bytes and identity switches close the old pool first',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),job=f.job('trial',1,3);f.send({op:'run',job,user:'test',password:'not-a-secret',trial:true});await f.wait('result');await f.wait('closed');assert.equal(f.stats().reads,1);assert.equal(f.stats().exits,1);
 f.send({op:'run',job,user:'test',password:'not-a-secret',resume:true});assert.equal((await f.wait('result')).data.retained,true);assert.equal(f.stats().reads,3);
 const second=f.job('changed');second.ns='OTHER';f.send({op:'run',job:second,user:'test',password:'not-a-secret'});await f.wait('result');await f.wait('closed');assert.equal(f.stats().auth,3);assert.equal(f.stats().exits,2);
 f.send({op:'close'});await f.wait('closed');assert.equal(f.stats().exits,3);
});


test('missing TXT is importable, excludes other statuses, and refreshes after resume',{skip:process.platform!=='win32'},async t=>{
 let phase=0;
 const f=await fixture(t,{documentStatus:name=>phase===0&&name.includes('Missing')?404:200,documentResult:name=>({name,content:name==='Demo.Empty.cls'?[]:name.endsWith('.cls')?['Class '+name.slice(0,-4)+' Extends %RegisteredObject','{','}']:['// content']})});
 const job=f.job('missing-list',1,4);
 fs.writeFileSync(path.join(job.batch,'files.txt'),'Demo.Missing.cls\n/app/Missing.js\nDemo.Good.cls\nDemo.Empty.cls');
 f.send({op:'run',job,user:'test',password:'not-a-secret'});await f.wait('result');
 const txt=path.join(job.batch,'export/missing-objects.txt');
 assert.equal(fs.readFileSync(txt,'utf8'),'Demo.Missing.cls\r\n/app/Missing.js\r\n');
 f.send({op:'close'});await f.wait('closed');
 // Import exactly the generated list into a new single-session batch; genuine 404 stays listed.
 const retry=f.job('retry',1,2);fs.copyFileSync(txt,path.join(retry.batch,'files.txt'));
 f.send({op:'run',job:retry,user:'test',password:'not-a-secret'});await f.wait('result');
 const retryTxt=path.join(retry.batch,'export/missing-objects.txt');assert.equal(fs.readFileSync(retryTxt,'utf8'),fs.readFileSync(txt,'utf8'));
 f.send({op:'close'});await f.wait('closed');phase=1;
 f.send({op:'run',job:retry,user:'test',password:'not-a-secret',resume:true});await f.wait('result');
 assert.equal(fs.readFileSync(retryTxt,'utf8'),'');
 const receipt=JSON.parse(fs.readFileSync(path.join(retry.batch,'export/baseline-state.json'),'utf8'));
 assert.equal(receipt.items.filter(x=>x.status==='fetched').length,2);
 assert.equal(fs.readFileSync(txt,'utf8'),'Demo.Missing.cls\r\n/app/Missing.js\r\n');
});

for(const rejectionCookie of [false,true])test('401 recovery depends on verified cleanup, never on assumed absence of sessions: '+rejectionCookie,{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{rejectAt:1,rejectionCookie}),job=f.job('auth-rejected',1,2);
 f.send({op:'run',job,user:'test',password:'not-a-secret'});const result=await f.wait('result');
 const receipt=JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8'));
 assert.equal(receipt.reason,'atelier-http-401');assert.equal(receipt.fetched,undefined);assert.equal(receipt.items.filter(x=>x.status==='fetched').length,0);
 assert.equal(receipt.logoutVerified,rejectionCookie);assert.equal(result.data.blocked,!rejectionCookie);assert.equal(f.stats().auth,1);
 f.send({op:'run',job,user:'test',password:'not-a-secret',resume:true});
 if(rejectionCookie){assert.equal((await f.wait('result')).data.blocked,false);assert.equal(f.stats().auth,2);}
 else {assert.match((await f.wait('error')).data.reason,/previous-session-unresolved/);assert.equal(f.stats().auth,1);}
});

test('confirmed missing is skipped on resume while raw 404 and partial remain, then can be retried explicitly',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{documentStatus:name=>name==='Demo.Missing.cls'?404:200}),job=f.job('confirmed-missing',1,3);
 fs.writeFileSync(path.join(job.batch,'files.txt'),'Demo.Missing.cls\nDemo.Good.cls\nDemo.Other.cls');
 f.send({op:'run',job,user:'test',password:'not-a-secret',trial:true});await f.wait('result');
 await f.wait('closed');assert.equal(f.stats().reads,1);job.confirmedMissing=['Demo.Missing.cls'];
 f.send({op:'run',job,user:'test',password:'not-a-secret',resume:true});const r=await f.wait('result');
 assert.equal(f.stats().reads,3);assert.equal(JSON.parse(r.data.output).missing,1);assert.equal(JSON.parse(r.data.output).pending,0);
 f.send({op:'close'});await f.wait('closed');
 let receipt=JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8'));
 assert.equal(receipt.state,'partial');assert.equal(receipt.logoutVerified,true);assert.equal(receipt.items[0].status,'missing');assert.equal(receipt.items[0].missingDisposition,'operator-confirmed-no-retry');
 assert.equal(fs.readFileSync(path.join(job.batch,'export/missing-objects.txt'),'utf8'),'Demo.Missing.cls\r\n');
 delete job.confirmedMissing;f.send({op:'run',job,user:'test',password:'not-a-secret',resume:true});await f.wait('result');assert.equal(f.stats().reads,4);
 receipt=JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8'));assert.equal(receipt.items[0].missingDisposition,undefined);
});

test('a fabricated missing confirmation is rejected before another authentication',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),job=f.job('invalid-confirmation',1,2);
 f.send({op:'run',job,user:'test',password:'not-a-secret',trial:true});await f.wait('result');
 job.confirmedMissing=['Demo.C1.cls'];f.send({op:'run',job,user:'test',password:'not-a-secret',resume:true});
 const result=await f.wait('result');assert.equal(result.data.exitCode,1);assert.equal(JSON.parse(result.data.output).operationError,'confirmed-missing-must-match-previous-404');assert.equal(f.stats().auth,1);assert.equal(f.stats().reads,1);
});

test('closing an unused worker reports its no-request state without authentication',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);f.send({op:'close'});assert.equal((await f.wait('closed')).data.cleanupVerified,true);assert.equal(f.stats().auth,0);assert.equal(f.stats().reads,0);
});

test('native GUI validates import, copy, summaries, confirmations and responsive layouts',{skip:process.platform!=='win32'},async t=>{
 const parent=path.join(os.tmpdir(),'Codex');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'iris-gui-native-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),exe=path.join(dir,'exporter.exe');
 async function run(file,args){const child=spawn(file,args,{windowsHide:true});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});return {code,output};}
 const compiled=await run(compiler,['/nologo','/codepage:65001','/target:winexe','/platform:anycpu','/out:'+exe,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/r:System.Security.dll','/r:System.Xml.dll',path.join(root,'ExporterForm.cs'),path.join(root,'ExporterWorkflow.cs'),path.join(root,'ExporterWorkbench.cs'),path.join(root,'ProjectBaseline.cs')]);assert.equal(compiled.code,0,compiled.output);
 const state=path.join(dir,'state'),checked=await run(exe,['--self-test',state]);assert.equal(checked.code,0,fs.existsSync(path.join(state,'failed.txt'))?fs.readFileSync(path.join(state,'failed.txt'),'utf8'):checked.output);
 assert.equal(fs.existsSync(path.join(state,'layout-1.5.png')),true);
});

test('first-item persistence and continuation share one run and one server cookie',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),job=f.job('first-item',1,3);
 f.send({op:'run',job,user:'test',password:'not-a-secret',maxFiles:1});
 const first=await f.wait('result');assert.equal(first.data.retained,true);
 const receipt=JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8'));
 assert.equal(receipt.items.filter(x=>x.status==='fetched').length,1);assert.equal(f.stats().reads,1);
 const item=receipt.items.find(x=>x.status==='fetched');
 assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(job.batch,'export',item.path))).digest('hex').toLowerCase(),item.sha256.toLowerCase());
 f.send({op:'run',job,user:'test',password:'not-a-secret',resume:true});
 await f.wait('result');assert.equal(f.stats().reads,3);assert.equal(f.stats().auth,1);
 f.send({op:'close'});assert.equal((await f.wait('closed')).data.cleanupVerified,true);
});

test('per-item timing captures delayed response and persists without extra requests', {skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{delay:180}),job=f.job('timing',1,2);
 f.send({op:'run',job,user:'test',password:'not-a-secret'});await f.wait('result');
 const r=JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8'));
 assert.equal(f.stats().reads,2);
 for(const item of r.items){const x=item.timing;assert.equal(x.schema,'export-item-timing/v1');assert.ok(x.responseObservedMs>=150);assert.ok(x.parseValidateMs>=0);assert.equal(typeof x.writeVerifyMs,'number');assert.ok(x.writeVerifyMs>=0);assert.ok(x.totalMs>=x.responseObservedMs+x.parseValidateMs);}
});
test('timing on off comparison retains equal requests and checkpoints', {skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{delay:5}),samples={on:[],off:[]};
 for(let round=0;round<4;round++)for(const enabled of (round%2?[false,true]:[true,false])){
  const job=f.job('bench-'+round+'-'+enabled,4,20);
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const command="$env:PSModulePath=Join-Path $PSHOME 'Modules'; $c=New-Object PSCredential('test',(ConvertTo-SecureString 'synthetic' -AsPlainText -Force)); & "+quote(path.join(root,'export-iris-code.ps1'))+" -ListFile "+quote(path.join(job.batch,'files.txt'))+" -OutputDirectory "+quote(path.join(job.batch,'export'))+" -AtelierUrl "+quote(job.url)+" -Namespace TEST -Credential $c -Sessions 4 -IntervalMs 50 -ConfirmedSessionBudget"+(enabled?'':' -DisableTiming');
  const start=performance.now();const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true});let errors='';child.stdout.resume();child.stderr.on('data',b=>errors+=b);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});assert.equal(code,0,errors);
  const elapsed=performance.now()-start;if(round>0)samples[enabled?'on':'off'].push(Math.round(elapsed));
  const r=JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8'));assert.equal(r.session.requestCount,20);assert.equal(r.logoutVerified,true);assert.equal(!!r.items[0].timing,enabled);
  assert.ok(r.checkpointCount>0);
 }
 t.diagnostic(JSON.stringify(samples));assert.equal(f.stats().reads,160);
});
