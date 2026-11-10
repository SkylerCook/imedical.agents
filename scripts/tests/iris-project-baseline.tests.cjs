const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {spawn} = require('node:child_process');
const http = require('node:http');
const repo = path.resolve(__dirname, '../..');
test('project baseline persists append/check/accept/recovery and protects local source', {skip:process.platform !== 'win32'}, t => {
  const parent = fs.existsSync('D:/tmp') ? 'D:/tmp/Codex' : path.join(os.tmpdir(), 'Codex');
  fs.mkdirSync(parent, {recursive:true});
  const dir = fs.mkdtempSync(path.join(parent, 'iris-project-baseline-test-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const exe = path.join(dir, 'baseline-test.exe');
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const build = spawnSync(compiler, ['/nologo','/codepage:65001','/target:exe','/out:'+exe,'/r:System.Web.Extensions.dll',
    path.join(repo,'tools/iris-code-export/ProjectBaseline.cs'),
    path.join(__dirname,'fixtures/iris-project-baseline-selftest.cs')], {encoding:'utf8',windowsHide:true});
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const run = spawnSync(exe, [dir], {encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const count=run.stdout.match(/passed (\d+) baseline assertions/);
  assert.ok(count&&Number(count[1])>=30,'baseline scenarios did not all execute: '+run.stdout);
});
test('native workbench runs append/check/accept with one persistent worker and stable project folder', {skip:process.platform !== 'win32'}, async t => {
  const parent = fs.existsSync('D:/tmp') ? 'D:/tmp/Codex' : path.join(os.tmpdir(),'Codex');
  fs.mkdirSync(parent,{recursive:true});
  const dir=fs.mkdtempSync(path.join(parent,'iris-project-gui-flow-'));
  let auth=0,reads=0,exits=0;const counts=new Map(),cookies=new Set();
  const server=http.createServer((req,res)=>{
    if(req.method==='HEAD'){exits++;cookies.delete(req.headers.cookie);res.writeHead(401);res.end();return;}
    reads++;let cookie=req.headers.cookie;
    if(req.headers.authorization){auth++;cookie='CSPSESSIONID='+auth;cookies.add(cookie);res.setHeader('Set-Cookie',cookie+'; Path=/api/atelier/');}
    if(!cookies.has(cookie)){res.writeHead(401);res.end();return;}
    const name=decodeURIComponent(req.url.split('/doc/')[1]);counts.set(name,(counts.get(name)||0)+1);
    if(name==='Demo.Missing.cls'||name==='Demo.C.cls'&&counts.get(name)>1){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({status:{errors:[]},result:{name,content:['Class '+name.slice(0,-4)+' Extends %RegisteredObject','{','// version '+counts.get(name),'}']}}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
  const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),exe=path.join(dir,'gui-flow.exe');
  const sources=['ExporterForm.cs','ExporterWorkflow.cs','ExporterWorkbench.cs','ProjectBaseline.cs'].map(n=>path.join(repo,'tools/iris-code-export',n));
  const built=spawnSync(compiler,['/nologo','/codepage:65001','/target:exe','/platform:anycpu','/main:BaselineGuiFlowTest','/out:'+exe,
    '/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/r:System.Security.dll','/r:System.Xml.dll',
    ...sources,path.join(__dirname,'fixtures/iris-project-gui-flow-selftest.cs')],{encoding:'utf8',windowsHide:true});
  assert.equal(built.status,0,built.stdout+built.stderr);
  for(const name of ['gui-worker.ps1','export-iris-code.ps1'])fs.copyFileSync(path.join(repo,'tools/iris-code-export',name),path.join(dir,name));
  const child=spawn(exe,[dir,'http://127.0.0.1:'+server.address().port+'/api/atelier/'],{windowsHide:true});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const code=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill();reject(Error('native-flow-timeout '+output));},60000);
    child.once('error',e=>{clearTimeout(timeout);reject(e);});child.once('exit',c=>{clearTimeout(timeout);resolve(c);});
  });
  assert.equal(code,0,output);assert.match(output,/gui-flow-passed/);
  assert.equal(auth,5,'single-session plus four reused concurrent cookies');
  for(let i=0;i<11;i++)assert.equal(counts.get('Trial.Item'+i+'.cls'),1,'trial and continuation must not reread verified files');
  assert.equal(counts.get('Demo.A.cls'),2,'existing A is skipped during append and re-read during check');
  assert.equal(reads,17);assert.equal(exits,5);
});
