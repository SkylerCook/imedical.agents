const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const g=require('../deploy-guard');
test('direct deployment and identical server need no merge',()=>{
 assert.deepEqual(g.choose('a','b','a'),{content:'b',merged:false});
 assert.equal(g.choose('a','b','b').content,'b');
});
test('new file collision and remote deletion stop',()=>{
 assert.equal(g.choose(null,'x',null).content,'x');
 assert.throws(()=>g.choose(null,'x','y'),/new-file-collision/);
 assert.throws(()=>g.choose('x','y',null),/remote-deleted/);
 assert.throws(()=>g.choose('x',null,'x'),/local-delete/);
});
test('three-way merge keeps both edits',()=>{
 assert.deepEqual(g.choose('a\nb\nc\n','A\nb\nc\n','a\nb\nC\n'),{content:'A\nb\nC\n',merged:true});
});
test('conflict stops instead of guessing',()=>assert.throws(()=>g.choose('a\n','b\n','c\n'),/merge-conflict/));
test('subsequent local delta preserves deployed server edits',()=>{
 const previous={local:'A\nb\nc\n',deployed:'A\nb\nC\n',merged:true};
 assert.equal(g.choose('a\nb\nc\n','AA\nb\nc\n',previous.deployed,previous).content,'AA\nb\nC\n');
 assert.throws(()=>g.choose('a','b','else',previous),/overwritten-again/);
});
test('invalid bytes and storage differences stop',()=>{
 assert.throws(()=>g.text(Buffer.from([255])),/encoding-unknown/);
 assert.throws(()=>g.text(Buffer.from('a\0b')),/binary/);
 assert.throws(()=>g.validate('A.cls','Storage Default\n{\nx\n}', '', ''),/storage/);
 assert.throws(()=>g.validate('A.cls','Storage Default { x }', '', ''),/storage/);
});
test('source syntax is checked',()=>assert.throws(()=>g.validate('a.js','const =;', '', ''),/syntax/));
test('persisted state survives reload; second overwrite and stale decision stop',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guard-test-')),repo=path.join(dir,'repo'),state=path.join(dir,'home');
 fs.mkdirSync(repo);fs.mkdirSync(state);const originalHome=os.homedir;os.homedir=()=>state;
 const git=(...args)=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 try{
  git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
  const localPath=path.join(repo,'a.js');fs.writeFileSync(localPath,'// a\n// b\n// c\n');
  git('add','a.js');git('commit','-m','base');
  g.initialize(repo,'123','HEAD',true);
  fs.writeFileSync(localPath,'// A\n// b\n// c\n');
  const index=git('ls-files','--stage'),head=git('rev-parse','HEAD');
  let remote=Buffer.from('// a\n// b\n// C\n'),writes=0;
  const adapter={read:async()=>remote,put:async f=>{writes++;remote=f.bytes;},compile:async()=>{}};
  const opts={repo,demand:'123',files:[{localPath,remotePath:'a.js'}],target:'mock',adapter,checkUpdates:()=>{}};
  assert.equal((await g.run(opts)).status,'verified');assert.equal(writes,1);
  assert.equal(git('ls-files','--stage'),index);assert.equal(git('rev-parse','HEAD'),head);
  assert.equal(fs.readFileSync(localPath,'utf8'),'// A\n// b\n// c\n');
  remote=Buffer.from('// external\n');
  const result=await g.run(opts);assert.equal(result.reason,'remote-overwritten-again');
  remote=Buffer.from('// external again\n');
  const stale=await g.run({...opts,decision:{action:'overwrite',token:result.details.token}});
  assert.equal(stale.reason,'remote-overwritten-again');assert.equal(writes,1);
  const success=await g.run({...opts,decision:{action:'overwrite',token:stale.details.token}});
  assert.equal(success.status,'verified');assert.equal(writes,2);
  const stateFile=g.location(repo,'123').file;
  const child=spawnSync(process.execPath,['-e','const fs=require("node:fs");const s=JSON.parse(fs.readFileSync(process.argv[1]));const p=Object.values(s.targets)[0].files["a.js"];try{require(process.argv[2]).choose("base","local","overwritten",p);}catch(e){process.stdout.write(e.reason);}',stateFile,require.resolve('../deploy-guard')],{encoding:'utf8',timeout:30000});
  assert.equal(child.status,0);assert.equal(child.stdout,'remote-overwritten-again');
  const session=g.read(stateFile);
  assert.equal(Object.values(session.targets)[0].files['a.js'].merged,true);
  // Unknown transport result prevents a second attempt.
  fs.writeFileSync(localPath,'// changed\n');adapter.put=async()=>{throw new Error('disconnect');};
  assert.equal((await g.run(opts)).partialOrUnknown,true);
  assert.equal((await g.run(opts)).reason,'previous-result-unknown');
  assert.equal((await g.run(opts)).reason,'previous-result-unknown');
 }finally{os.homedir=originalHome;fs.rmSync(dir,{recursive:true,force:true});}
});

test('Atelier adapter uses isolated content and checks compile errors',async()=>{
 const http=require('node:http'),{backendAdapter}=require('../deploy-protected');
 let content=['Class Demo.Test','{','}'],fail=false,puts=0;
 const server=http.createServer((req,res)=>{
  const chunks=[];req.on('data',x=>chunks.push(x));req.on('end',()=>{
   res.setHeader('Content-Type','application/json');
   if(req.method==='PUT'){assert.equal(req.headers['if-none-match'],'2026-09-16 00:00:00.000');puts++;content=JSON.parse(Buffer.concat(chunks)).content;}
   if(req.url.includes('action/compile'))return res.end(JSON.stringify({status:{errors:fail?[{error:'test'}]:[]},result:{content:[]},console:[]}));
   res.end(JSON.stringify({status:{errors:[]},result:{content,enc:false,ts:'2026-09-16 00:00:00.000'}}));
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const a=backendAdapter({protocol:'http:',hostname:'127.0.0.1',port:server.address().port,path:'/api/atelier/v1/TEST/action/compile',auth:'test:test'});
  const f={remotePath:'Demo.Test.cls',content:'Class Demo.Test\n{\n// local\n}'};
  assert.equal(g.text(await a.read(f)),'Class Demo.Test\n{\n}');
  await a.put(f);assert.equal(puts,1);assert.equal(g.text(await a.read(f)),f.content);
  await a.compile([f]);fail=true;await assert.rejects(a.compile([f]),/compile-failed/);
 }finally{await new Promise(r=>server.close(r));}
});
test('Git update stops before remote access and batch conflict stops all writes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guard-batch-')),repo=path.join(dir,'repo');
 fs.mkdirSync(repo);const home=os.homedir;os.homedir=()=>dir;
 const git=(...a)=>{const r=spawnSync('git',['-C',repo,...a],{encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);};
 try{
  git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
  for(const n of ['a.js','b.js'])fs.writeFileSync(path.join(repo,n),'// base\n');
  git('add','.');git('commit','-m','base');g.initialize(repo,'456','HEAD',true);
  const files=['a.js','b.js'].map(n=>({localPath:path.join(repo,n),remotePath:n}));
  for(const f of files)fs.writeFileSync(f.localPath,'// local\n');
  let reads=0,writes=0;
  const adapter={read:async f=>{reads++;return Buffer.from(f.remotePath==='b.js'?'// remote\n':'// base\n');},put:async()=>{writes++;},compile:async()=>{}};
  const opts={repo,demand:'456',files,target:'mock',adapter};
  assert.equal((await g.run({...opts,checkUpdates:()=>g.stop('git-upstream-update')})).reason,'git-upstream-update');assert.equal(reads,0);
  assert.equal((await g.run({...opts,checkUpdates:()=>{}})).reason,'merge-conflict');assert.equal(writes,0);
 }finally{os.homedir=home;fs.rmSync(dir,{recursive:true,force:true});}
});

test('partial upload is recorded, repeat is blocked, and source stays untouched',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guard-partial-')),repo=path.join(dir,'repo');fs.mkdirSync(repo);
 const home=os.homedir;os.homedir=()=>dir;
 const git=(...a)=>{const r=spawnSync('git',['-C',repo,...a],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);return r.stdout;};
 try{
  git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');
  const files=['a.js','b.js'].map(n=>({localPath:path.join(repo,n),remotePath:n}));
  for(const f of files)fs.writeFileSync(f.localPath,'// base\r\n');
  git('add','.');git('commit','-m','base');g.initialize(repo,'789','HEAD',true);
  const head=git('rev-parse','HEAD'),index=git('ls-files','--stage');
  const remote=new Map(files.map(f=>[f.remotePath,Buffer.from('// base\r\n')]));let writes=0;
  const adapter={read:async f=>remote.get(f.remotePath),put:async f=>{writes++;if(f.remotePath==='b.js')throw Error('disconnect');remote.set(f.remotePath,f.bytes);},compile:async()=>{}};
  const opts={repo,demand:'789',files,target:'partial',adapter,checkUpdates:()=>{}};
  assert.equal((await g.run(opts)).status,'verified');assert.equal(writes,0);
  for(const f of files)fs.writeFileSync(f.localPath,'// local\r\n');
  const result=await g.run(opts);assert.equal(result.status,'needs-user-input');assert.equal(result.partialOrUnknown,true);assert.equal(result.sourceUnchanged,true);
  assert.equal(writes,2);assert.equal((await g.run(opts)).reason,'previous-result-unknown');assert.equal(writes,2);
  assert.equal(git('rev-parse','HEAD'),head);assert.equal(git('ls-files','--stage'),index);
  for(const f of files)assert.equal(fs.readFileSync(f.localPath,'utf8'),'// local\r\n');
  git('add','.');git('commit','-m','local change');assert.equal(git('show','HEAD:a.js').replace(/\r\n/g,'\n'),'// local\n');
  g.initialize(repo,'790','HEAD',true);git('mv','a.js','renamed.js');
  const renamed=await g.run({...opts,demand:'790',files:[{localPath:path.join(repo,'renamed.js'),remotePath:'renamed.js'}],adapter:{read:async()=>{throw Error('must not read');}}});assert.equal(renamed.reason,'local-delete-or-rename');
 }finally{os.homedir=home;fs.rmSync(dir,{recursive:true,force:true});}
});
