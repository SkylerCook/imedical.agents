'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const core=path.resolve(__dirname,'../../tools/iris-code-export/export-iris-code.ps1');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function fixture(t,total=16){
 const parent=path.join(os.tmpdir(),'Codex');fs.mkdirSync(parent,{recursive:true});
 const dir=fs.mkdtempSync(path.join(parent,'iris-checkpoints-')),list=path.join(dir,'files.txt');
 fs.writeFileSync(list,Array.from({length:total},(_,i)=>'Demo.C'+String(i).padStart(4,'0')+'.cls').join('\n'));
 let reads=0,auth=0,exits=0,active=0,peak=0;
 const server=http.createServer((req,res)=>{
  if(req.method==='HEAD'){exits++;res.writeHead(401);res.end();return;}
  reads++;active++;peak=Math.max(peak,active);
  if(req.headers.authorization){auth++;res.setHeader('Set-Cookie','CSPSESSIONID='+auth+'; Path=/api/atelier/');}
  const name=decodeURIComponent(req.url.split('/doc/')[1]);
  setTimeout(()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:{errors:[]},result:{name,content:['Class '+name.slice(0,-4)+' Extends %RegisteredObject','{','}']}}));active--;},40);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 async function run(script,out,{max=total,resume=false,point=''}={}){
  const start=performance.now();
  const cmd="$env:PSModulePath=Join-Path $PSHOME 'Modules';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$c=New-Object Management.Automation.PSCredential('test',(ConvertTo-SecureString 'synthetic' -AsPlainText -Force)); & $env:CHECKPOINT_SCRIPT -ListFile $env:CHECKPOINT_LIST -OutputDirectory $env:CHECKPOINT_OUT -AtelierUrl $env:CHECKPOINT_URL -Namespace TEST -Credential $c -Sessions 4 -IntervalMs 100 -ConfirmedSessionBudget -MaxFilesPerRun ([int]$env:CHECKPOINT_MAX) -Resume:($env:CHECKPOINT_RESUME -eq '1'); exit $LASTEXITCODE";
  const child=spawn('powershell.exe',['-NoProfile','-Command',cmd],{windowsHide:true,env:{...process.env,CHECKPOINT_SCRIPT:script,CHECKPOINT_LIST:list,CHECKPOINT_OUT:out,CHECKPOINT_URL:'http://127.0.0.1:'+server.address().port+'/api/atelier/',CHECKPOINT_MAX:String(max),CHECKPOINT_RESUME:resume?'1':'0',CHECKPOINT_FAULT:point}});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('test timeout'));},120000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  return {code,ms:performance.now()-start,output};
 }
 const receipt=out=>JSON.parse(fs.readFileSync(path.join(out,'baseline-state.json'),'utf8').replace(/^\uFEFF/,''));
 const verify=out=>{const s=receipt(out);for(const item of s.items.filter(x=>x.status==='fetched'))assert.equal(hash(fs.readFileSync(path.join(out,item.path))),item.sha256);return s;};
 return {dir,run,receipt,verify,stats:()=>({reads,auth,exits,peak})};
}
test('completed response groups share durable checkpoints and respect four sessions',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,64),out=path.join(f.dir,'normal');const r=await f.run(core,out);assert.equal(r.code,0,r.output);
 const s=f.verify(out);assert.equal(s.items.length,64);assert.equal(s.items.filter(x=>x.status==='fetched').length,64);
 assert.ok(s.checkpointCount<100,'checkpoint writes were not grouped: '+s.checkpointCount);
 assert.equal(f.stats().auth,4);assert.equal(f.stats().exits,4);assert.ok(f.stats().peak<=4);assert.equal(s.logoutVerified,true);
 t.diagnostic(JSON.stringify({milliseconds:r.ms,checkpoints:s.checkpointCount,objects:64}));
});
for(const point of ['before-publish','after-first-publish'])test('crash recovery validates grouped writing state: '+point,{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),script=path.join(f.dir,'instrumented.ps1'),out=path.join(f.dir,'crashed');
 let source=fs.readFileSync(core,'utf8');
 const before='                    Save-State\r\n                    foreach ($pending in $pendingWrites)';
 assert.ok(source.includes(before));source=source.replace(before,"                    Save-State\r\n                    if ($env:CHECKPOINT_FAULT -eq 'before-publish') { [Environment]::Exit(91) }\r\n                    foreach ($pending in $pendingWrites)");
 const after='[IO.File]::Move($temporary, $file)';assert.ok(source.includes(after));source=source.replace(after,after+"\r\n                        if ($env:CHECKPOINT_FAULT -eq 'after-first-publish') { [Environment]::Exit(92) }");fs.writeFileSync(script,source);
 const first=await f.run(script,out,{point});assert.equal(first.code,point==='before-publish'?91:92,first.output);
 const checkpoint=f.receipt(out),writing=checkpoint.items.filter(x=>x.status==='writing');assert.ok(writing.length>0);assert.ok(writing.every(x=>/^[a-f0-9]{64}$/.test(x.sha256)));
 const published=writing.filter(x=>fs.existsSync(path.join(out,x.path)));assert.equal(published.length,point==='before-publish'?0:1);
 const readsBefore=f.stats().reads;
 const second=await f.run(script,out,{resume:true});assert.equal(second.code,0,second.output);const final=f.verify(out);
 assert.equal(final.items.filter(x=>x.status==='fetched').length,16);assert.equal(f.stats().reads-readsBefore,16-published.length);
 assert.equal(final.items.filter(x=>x.status==='writing').length,0);
 // A later local edit must fail before sending even one HTTP request.
 fs.appendFileSync(path.join(out,final.items[0].path),'local edit');const count=f.stats().reads;
 const drift=await f.run(script,out,{resume:true});assert.equal(drift.code,1);assert.match(drift.output,/local-source-drift/);assert.equal(f.stats().reads,count);
});
test('optional identical-scope baseline throughput comparison',{skip:process.platform!=='win32'||!process.env.IRIS_EXPORT_BENCHMARK_BEFORE},async t=>{
 const f=await fixture(t,5352),results=[];
 for(const [name,script] of [['before',process.env.IRIS_EXPORT_BENCHMARK_BEFORE],['after',core]]){
  const out=path.join(f.dir,name),r=await f.run(script,out,{max:200});assert.equal(r.code,2,r.output);const s=f.verify(out);
  assert.equal(s.items.filter(x=>x.status==='fetched').length,200);assert.equal(s.session.authenticationCount,4);assert.equal(s.logoutVerified,true);
  results.push({name,milliseconds:Math.round(r.ms),requests:s.session.requestCount,checkpoints:s.checkpointCount??null});
 }
 t.diagnostic(JSON.stringify({scope:5352,exported:200,sessions:4,intervalMs:100,responseDelayMs:40,results}));
});
