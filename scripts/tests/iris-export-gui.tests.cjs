'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../../tools/iris-code-export');
async function fixture(t,{idle=120,failLogout=false,failAt=0,delay=40}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iris-gui-test-'));let auth=0,reads=0,active=0,peak=0,exits=0;const cookies=new Set();
 const server=http.createServer((req,res)=>{
  if(req.method==='HEAD'){exits++; if(!failLogout)cookies.delete(req.headers.cookie);res.writeHead(failLogout?500:401);res.end();return;}
  reads++;const requestNumber=reads;active++;peak=Math.max(active,peak);let cookie=req.headers.cookie;
  if(req.headers.authorization){auth++;cookie='CSPSESSIONID='+auth;cookies.add(cookie);res.setHeader('Set-Cookie',cookie+'; Path=/api/atelier/');}
  if(!cookies.has(cookie)){res.writeHead(401);res.end();active--;return;}
  const name=decodeURIComponent(req.url.split('/doc/')[1]);
  setTimeout(()=>{if(requestNumber===failAt){res.writeHead(503);res.end();active--;return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:{errors:[]},result:{name,content:['Class '+name.slice(0,-4)+' Extends %RegisteredObject','{','}']}}));active--;},delay);
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
 await wait('ready');return {send,wait,job,dir,restart,stats:()=>({auth,reads,active,peak,exits}),errors:()=>errors};
}
test('one persistent worker reuses its cookie across batches and finalizes receipts only on close',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);for(const name of ['first','second']){const job=f.job(name);f.send({op:'run',job,user:'test',password:'not-a-secret'});const r=await f.wait('result');assert.equal(r.data.retained,true,JSON.stringify(r)+f.errors());assert.equal(f.stats().auth,1);assert.equal(JSON.parse(fs.readFileSync(path.join(job.batch,'export/baseline-state.json'),'utf8')).sessionRetained,true);}
 assert.equal(f.stats().reads,4);assert.equal(f.stats().exits,0);f.send({op:'close'});const closed=await f.wait('closed');assert.equal(closed.data.cleanupVerified,true,JSON.stringify(closed)+f.errors());assert.equal(f.stats().exits,1);
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
test('503 stops dispatch, drains in-flight work and blocks further batches',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{failAt:1,delay:100});f.send({op:'run',job:f.job('failure',4,30),user:'test',password:'not-a-secret',confirmed:true});const r=await f.wait('result');assert.equal(r.data.blocked,true);assert.ok(f.stats().reads<=4);assert.equal(f.stats().active,0);assert.equal(f.stats().exits,f.stats().auth);
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
