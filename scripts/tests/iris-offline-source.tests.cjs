'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..'),tools=path.join(repo,'plugins/coding-iris-plugin/scripts/iris-tools');
const shell=process.env.IRIS_TEST_POWERSHELL||'powershell.exe';
const windows=process.platform==='win32';
const quote=value=>"'"+String(value).replace(/'/g,"''")+"'";
function write(file,body){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);}
function git(root,...args){const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function fixture(t){
 const base=process.env.CODEX_TEST_TMP_ROOT||path.join(os.tmpdir(),'Codex');fs.mkdirSync(base,{recursive:true});
 const root=fs.mkdtempSync(path.join(fs.realpathSync(base),'offline-source-'));
 t.after(()=>{assert.equal(path.dirname(root),fs.realpathSync(base));fs.rmSync(root,{recursive:true,force:true});assert.equal(fs.existsSync(root),false);});
 const project=path.join(root,'project'),code=path.join(project,'code'),context=path.join(project,'.agents'),original=path.join(project,'incoming/batch');
 const capability=path.join(root,'capability');fs.mkdirSync(path.join(capability,'.git'),{recursive:true});
 const a='src/Custom/A.cls',b='src/Other/B.cls',before=Buffer.from('Class Demo.A\n{\nClassMethod Value() { Quit 1 }\n}\n');
 for(const target of [code,original]){write(path.join(target,a),before);write(path.join(target,b),'Class Demo.B {}\n');}
 git(code,'init','-q');git(code,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','add','.');git(code,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath='+path.join(root,'no-hooks'),'commit','-qm','fixture');
 write(path.join(context,'config/iris-development.json'),JSON.stringify({developmentMode:'offline'}));
 write(path.join(context,'capability.json'),JSON.stringify({schemaVersion:1,mode:'workspace-overlay',workspace:'fixture',contextRoot:'.agents',capabilityRoot:capability,sharedDirectories:[],localDirectories:['config','work'],sourceRoots:[{name:'backend',path:'code',target:'code',gitRoot:'code'}]}));
 const scope=path.join(context,'work/task/scope.json'),baseline=path.join(context,'work/task/baseline'),notes=path.join(project,'notes.md'),output=path.join(project,'docs/delivery/task');
 write(scope,JSON.stringify({files:[a]}));write(notes,'修改 Value 的返回值，已检查最终差异；医院编译与业务验证待用户完成。');
 return {root,project,code,context,original,a,b,before,scope,baseline,notes,output};
}
function framework(f,mode,extra=[]){
 const args=[path.join(tools,'source-delivery.js'),mode,'--project-root',f.project,'--source-directory','code','--baseline-directory',f.baseline,'--powershell',path.basename(shell)];
 if(mode==='prepare')args.push('--original-directory',f.original,'--batch-id','batch-01','--scope-file',f.scope);
 else args.push('--out',f.output);
 if(mode==='pack')args.push('--notes-file',f.notes);
 return spawnSync(process.execPath,[...args,...extra],{encoding:'utf8',windowsHide:true,timeout:30000});
}
function ps(name,args,withoutTools=false,overrides={}){
 const command='[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); & '+quote(path.join(tools,name))+' '+args.map(value=>/^-[A-Za-z]+$/.test(value)?value:quote(value)).join(' ')+'; if (-not $?) { exit 1 }';
 const env={...process.env,...overrides};if(path.basename(shell)==='powershell.exe')env.PSModulePath=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules');
 let executable=shell;
 if(withoutTools){const where=spawnSync('where.exe',[shell],{encoding:'utf8',windowsHide:true});assert.equal(where.status,0,where.stderr);executable=where.stdout.trim().split(/\r?\n/)[0];env.PATH=path.join(process.env.SystemRoot,'System32');}
 return spawnSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{env,encoding:'utf8',windowsHide:true,timeout:30000});
}
function passed(r){assert.equal(r.status,0,r.stderr||r.stdout);return JSON.parse(r.stdout);}
test('framework source helper exposes local help on every platform',()=>{
 const r=spawnSync(process.execPath,[path.join(tools,'source-delivery.js'),'--help'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Local only/);
});
test('Windows short source aliases map to the same declared Git root',{skip:!windows||!fs.existsSync('C:/PROGRA~1')},()=>{
 const alias='C:/PROGRA~1',physical=fs.realpathSync.native(alias),source={target:path.resolve(alias),gitRoot:path.resolve(alias)};
 const resolve=require('../lib/workspace-context').resolveGitRootForPath;
 assert.strictEqual(resolve({sourceRoots:[source]},path.join(physical,'sample.cls')),source);
 assert.throws(()=>resolve({sourceRoots:[source]},path.join(path.parse(physical).root,'outside-scope.cls')),/not inside/);
});
test('PowerShell scope checks normalize an 8.3 TEMP alias without writing to it',{skip:!windows||!fs.existsSync('C:/PROGRA~1')},t=>{
 const f=fixture(t);passed(ps('source-delivery.ps1',['-Mode','Prepare','-SourceDirectory',f.code,'-OriginalDirectory',f.original,'-BatchId','short-path','-ScopeFile',f.scope,'-BaselineDirectory',f.baseline],false,{TEMP:'C:\\PROGRA~1',TMP:'C:\\PROGRA~1'}));
 assert.deepEqual(fs.readFileSync(path.join(f.baseline,f.a)),f.before);
});
test('non-Windows packaging stops explicitly before creating a baseline',{skip:windows},t=>{
 const f=fixture(t),r=framework(f,'prepare');assert.equal(r.status,1);assert.match(r.stderr,/source-delivery-windows-required/);assert.equal(fs.existsSync(f.baseline),false);
});
test('manual source keeps original layout, a single Git tree and only the frozen task scope',{skip:!windows},t=>{
 const f=fixture(t),head=git(f.code,'rev-parse','HEAD');
 write(path.join(f.code,f.b),'Class Demo.B { /* unrelated change */ }\n');
 const beforeStatus=git(f.code,'status','--porcelain=v1');
 const prepared=passed(framework(f,'prepare'));assert.equal(prepared.sourceKind,'manual-source');
 assert.equal(git(f.code,'status','--porcelain=v1'),beforeStatus);assert.equal(fs.existsSync(path.join(f.code,'baseline-state.json')),false);
 const snapshot=JSON.parse(fs.readFileSync(path.join(f.baseline,'manifest.json')));assert.equal(snapshot.exportReceiptSha256,null);assert.equal(snapshot.source.batchId,'batch-01');
 write(path.join(f.code,f.a),f.before.toString().replace('Quit 1','Quit 2'));
 const packed=passed(framework(f,'pack'));assert.equal(packed.changedCount,1);assert.equal(packed.gitHead,head);
 const delivery=JSON.parse(fs.readFileSync(path.join(f.output,'manifest.json')));assert.equal(delivery.schema,'iris-source-delivery/v2');assert.equal(delivery.compileVerified,false);assert.equal(delivery.targetDriftVerified,false);
 assert.equal(delivery.batchId,'batch-01');assert.equal(delivery.localEvidence.gitHead,head);assert.equal(delivery.localEvidence.hospitalAcceptance,'pending');assert.deepEqual(delivery.localEvidence.files.map(item=>item.path),[f.a]);
 assert.deepEqual(fs.readFileSync(path.join(f.output,'rollback',f.a)),f.before);assert.equal(fs.existsSync(path.join(f.output,'changes',f.b)),false);
 assert.equal(fs.readFileSync(path.join(f.output,'files.txt'),'utf8'),f.a+'\n');
 passed(framework(f,'verify'));assert.equal(git(f.code,'rev-parse','HEAD'),head);assert.equal(fs.existsSync(path.join(f.project,'.mcp.json')),false);
 assert.equal(passed(ps('source-delivery.ps1',['-Mode','Verify','-OutputDirectory',f.output],true)).state,'verified');
});
test('scope/baseline/artifact drift is rejected instead of widening delivery',{skip:!windows},t=>{
 const f=fixture(t);passed(framework(f,'prepare'));write(path.join(f.code,f.a),f.before.toString().replace('Quit 1','Quit 2'));
 write(f.scope,JSON.stringify({files:[f.a,f.b]}));let r=framework(f,'pack',['--scope-file',f.scope]);assert.equal(r.status,1);assert.match(r.stderr,/scope-drift|source-git-baseline-scope-mismatch/);
 write(f.scope,JSON.stringify({files:[f.a]}));write(path.join(f.baseline,f.a),'tampered');r=framework(f,'pack');assert.equal(r.status,1);assert.match(r.stderr,/original-baseline-drift/);
 write(path.join(f.baseline,f.a),f.before);passed(framework(f,'pack'));write(path.join(f.output,'changes',f.a),'tampered');r=framework(f,'verify');assert.equal(r.status,1);assert.match(r.stderr,/delivery-file-drift/);
});
test('changed-before-prepare, object renaming and cross-workspace binding cannot become a new baseline',{skip:!windows},t=>{
 const f=fixture(t);write(path.join(f.code,f.a),f.before.toString().replace('Quit 1','Quit 9'));
 let r=framework(f,'prepare');assert.equal(r.status,1);assert.match(r.stderr,/source-changed-before-prepare/);assert.equal(fs.existsSync(f.baseline),false);
 write(path.join(f.code,f.a),f.before);passed(framework(f,'prepare'));write(path.join(f.code,f.a),f.before.toString().replace('Demo.A','Demo.Renamed'));
 r=framework(f,'pack');assert.equal(r.status,1);assert.match(r.stderr,/class-identity-mismatch/);
 const baseline=JSON.parse(fs.readFileSync(path.join(f.baseline,'manifest.json')));baseline.workspaceBindingSha256='0'.repeat(64);write(path.join(f.baseline,'manifest.json'),JSON.stringify(baseline));
 r=framework(f,'pack');assert.equal(r.status,1);assert.match(r.stderr,/workspace-binding-changed/);
});
test('unchanged input makes no empty delivery; manual snapshots compare without a fabricated remote identity',{skip:!windows},t=>{
 const f=fixture(t);passed(framework(f,'prepare'));const unchanged=passed(framework(f,'pack'));assert.equal(unchanged.state,'unchanged');assert.equal(fs.existsSync(f.output),false);
 write(path.join(f.code,f.a),f.before.toString().replace('Quit 1','Quit 2'));passed(framework(f,'pack'));
 const verified=passed(ps('source-delivery.ps1',['-Mode','Verify','-OutputDirectory',f.output,'-CurrentSourceDirectory',f.original],true));assert.equal(verified.currentSnapshot.matches,true);assert.equal(verified.targetDriftVerified,false);
 write(path.join(f.original,f.a),'Class Demo.A { /* concurrent change */ }');const failed=ps('source-delivery.ps1',['-Mode','Verify','-OutputDirectory',f.output,'-CurrentSourceDirectory',f.original]);assert.equal(failed.status,1);assert.match(failed.stderr,/current-source-differs-from-baseline/);
});
test('XML objects are edited inside the source Git and verified in a new process',{skip:!windows},t=>{
 const f=fixture(t),input=path.join(f.project,'incoming/source.xml'),work=path.join(f.code,'xml/current'),out=path.join(f.project,'docs/delivery/xml');
 write(input,'<Export generator="fixture"><Project name="Scope"><ProjectItem name="Demo.Xml.cls" type="CLS"/></Project><Class name="Demo.Xml"><Method name="Value"><Implementation><![CDATA[ Quit 1 ]]></Implementation></Method></Class></Export>');
 passed(ps('edit-export-xml.ps1',['-Mode','Unpack','-InputXml',input,'-WorkDirectory',work]));
 const object=path.join(work,'objects/000001.xml');write(object,fs.readFileSync(object,'utf8').replace('Quit 1','Quit 2'));
 assert.match(git(f.code,'status','--porcelain=v1','--','xml/current/objects'),/xml\/current\/objects/);
 passed(ps('edit-export-xml.ps1',['-Mode','Pack','-WorkDirectory',work,'-NotesFile',f.notes,'-OutputDirectory',out]));
 passed(ps('edit-export-xml.ps1',['-Mode','Verify','-WorkDirectory',work,'-OutputDirectory',out],true));
 assert.equal(fs.readFileSync(input,'utf8').includes('Quit 1'),true);
});

test('managed XML keeps private originals and excludes objects outside the frozen task scope',{skip:!windows},t=>{
 const f=fixture(t),input=path.join(f.original,'source.xml'),work=path.join(f.code,'xml/task');
 write(input,'<Export><Class name="Demo.First"><Method name="V"><Implementation> Quit 1 </Implementation></Method></Class><Class name="Demo.Second"><Method name="V"><Implementation> Quit 1 </Implementation></Method></Class></Export>');
 write(f.scope,JSON.stringify({files:['objects/000001.xml']}));
 const run=(mode,extra=[])=>spawnSync(process.execPath,[path.join(tools,'source-delivery.js'),'xml-'+mode,'--project-root',f.project,'--source-directory',work,'--baseline-directory',f.baseline,'--powershell',path.basename(shell),...extra],{encoding:'utf8',windowsHide:true,timeout:30000});
 const unpacked=passed(run('unpack',['--input-xml',input,'--batch-id','xml-batch','--scope-file',f.scope]));assert.equal(unpacked.count,2);
 assert.equal(unpacked.gitBaselineReady,false);
 git(f.code,'add','xml/task/objects');git(f.code,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath='+path.join(f.root,'no-hooks'),'commit','-qm','original XML');
 assert.equal(fs.existsSync(path.join(work,'package.xml')),false);assert.equal(fs.readFileSync(path.join(f.baseline,'package.xml'),'utf8'),fs.readFileSync(input,'utf8'));
 for(const name of ['000001.xml','000002.xml']){const file=path.join(work,'objects',name);write(file,fs.readFileSync(file,'utf8').replace('Quit 1','Quit 2'));}
 assert.match(git(f.code,'status','--porcelain=v1'),/xml/);
 passed(run('pack',['--out',f.output,'--notes-file',f.notes]));
 const delivery=JSON.parse(fs.readFileSync(path.join(f.output,'manifest.json')));assert.equal(delivery.batchId,'xml-batch');assert.equal(delivery.changedCount,1);assert.equal(delivery.objects[0].name,'Demo.First');
 passed(run('verify',['--out',f.output]));
 const inventory=JSON.parse(fs.readFileSync(path.join(f.baseline,'inventory.json'))),binding=Buffer.from(JSON.stringify({workspaceRoot:fs.realpathSync.native(f.project),sourceRoot:fs.realpathSync.native(f.code),gitRoot:fs.realpathSync.native(f.code)})).toString('base64');
 passed(ps('edit-export-xml.ps1',['-Mode','Verify','-WorkDirectory',work,'-BaselineDirectory',f.baseline,'-WorkspaceBinding',binding,'-OutputDirectory',f.output],true));
 write(f.scope,JSON.stringify({files:['objects/000002.xml']}));assert.match(run('verify',['--out',f.output,'--scope-file',f.scope]).stderr,/xml-scope-drift|source-git-baseline-scope-mismatch/);
 inventory.workspaceBindingSha256='0'.repeat(64);write(path.join(f.baseline,'inventory.json'),JSON.stringify(inventory));assert.match(run('verify',['--out',f.output]).stderr,/workspace-binding-changed/);
});

test('scoped receipt source preserves unknown receipt fields and explicit partial disclosure',{skip:!windows},t=>{
 const f=fixture(t),crypto=require('node:crypto'),hash=value=>crypto.createHash('sha256').update(value).digest('hex');
 const relative='src/Demo/Receipt.cls',bytes=Buffer.from('Class Demo.Receipt {}\n');write(path.join(f.code,relative),bytes);
 const source={atelierUrl:'https://fixture.invalid/api/atelier/',namespace:'FIXTURE'};
 const receipt={schema:'iris-standalone-baseline/v1',target:hash(source.atelierUrl+'|'+source.namespace),source,scriptHash:'fixture-script-unchanged',versionSelection:{scope:'fixture'},state:'partial',startedAt:'fixture-start',updatedAt:'fixture-end',items:[{document:'Demo.Receipt.cls',path:relative,status:'fetched',sha256:hash(bytes),bytes:bytes.length},{document:'Missing.cls',path:'src/Missing.cls',status:'failed'}]};
 const receiptFile=path.join(f.code,'baseline-state.json');write(receiptFile,JSON.stringify(receipt));const original=fs.readFileSync(receiptFile);write(f.scope,JSON.stringify({files:[relative]}));
 const run=(mode,extra=[])=>spawnSync(process.execPath,[path.join(tools,'source-delivery.js'),mode,'--project-root',f.project,'--export-directory',f.code,'--baseline-directory',f.baseline,'--powershell',path.basename(shell),...extra],{encoding:'utf8',windowsHide:true,timeout:30000});
 git(f.code,'add',relative);git(f.code,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath='+path.join(f.root,'no-hooks'),'commit','-qm','receipt original');
 const args=['--scope-file',f.scope,'--batch-id','receipt-batch'];assert.match(run('prepare',args).stderr,/incomplete-export/);
 passed(run('prepare',[...args,'--allow-partial']));write(path.join(f.code,relative),'Class Demo.Receipt { /* edited */ }\n');
 passed(run('pack',['--out',f.output,'--notes-file',f.notes]));passed(run('verify',['--out',f.output]));assert.deepEqual(fs.readFileSync(receiptFile),original);
 const manifest=JSON.parse(fs.readFileSync(path.join(f.output,'manifest.json')));assert.equal(manifest.completeSource,false);assert.equal(manifest.excluded.length,1);assert.equal(manifest.sourceKind,'export-receipt');
 assert.equal(manifest.batchId,'receipt-batch');assert.match(manifest.localEvidence.gitDiffSha256,/^[a-f0-9]{64}$/);
 write(receiptFile,original.toString()+' ');assert.match(run('verify',['--out',f.output]).stderr,/export-receipt-drift/);
});

test('deleted, duplicate and escaping objects are refused',{skip:!windows},t=>{
 const f=fixture(t);write(path.join(f.original,f.b),f.before);write(path.join(f.code,f.b),f.before);write(f.scope,JSON.stringify({files:[f.a,f.b]}));assert.match(framework(f,'prepare').stderr,/duplicate-source-object/);
 write(f.scope,JSON.stringify({files:[f.a]}));passed(framework(f,'prepare'));fs.unlinkSync(path.join(f.code,f.a));assert.match(framework(f,'pack').stderr,/source-add-delete-rename-unsupported/);
 write(path.join(f.code,f.a),f.before);write(f.scope,JSON.stringify({files:['../outside.cls']}));assert.match(framework(f,'pack',['--scope-file',f.scope]).stderr,/source-scope-invalid/);
});


test('Git baseline requires committed originals and common ancestry',t=>{
 const f=fixture(t),api=require(path.join(tools,'source-delivery.js'));
 fs.mkdirSync(f.baseline,{recursive:true});
 const state={gitRoot:f.code,source:f.code,scope:[f.a],baseline:f.baseline};
 api.captureGitBaseline(state);const original=api.requireGitBaseline(state);
 write(path.join(f.code,f.a),f.before.toString().replace('Quit 1','Quit 2'));
 assert.equal(api.requireGitBaseline(state),original);
 git(f.code,'add',f.a);git(f.code,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath='+path.join(f.root,'no-hooks'),'commit','-qm','business change');
 assert.equal(api.requireGitBaseline(state),original);
 const fresh='src/New.cls';write(path.join(f.code,fresh),'Class New {}');state.scope=[fresh];api.captureGitBaseline(state);
 assert.throws(()=>api.requireGitBaseline(state),/baseline-untracked/);
 write(path.join(f.code,fresh),'Class New { /* edited */ }');git(f.code,'add',fresh);git(f.code,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath='+path.join(f.root,'no-hooks'),'commit','-qm','wrong baseline');
 assert.throws(()=>api.requireGitBaseline(state),/original-baseline-not-found/);
 git(f.code,'checkout','--orphan','empty');git(f.code,'rm','-r','--cached','.');
 assert.throws(()=>api.requireGitBaseline(state),/baseline-missing/);
});

test('managed pack blocks untracked originals without output',{skip:!windows},t=>{
 const f=fixture(t);git(f.code,'rm','--cached',f.a);git(f.code,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath='+path.join(f.root,'no-hooks'),'commit','-qm','remove tracked original');
 assert.equal(passed(framework(f,'prepare')).gitBaselineReady,false);
 write(path.join(f.code,f.a),f.before.toString().replace('Quit 1','Quit 2'));
 assert.match(framework(f,'pack').stderr,/baseline-untracked/);assert.equal(fs.existsSync(f.output),false);
});

for(const format of ['CRLF','LF','BOM'])test('XML delivery preserves '+format+' and exact original rollback bytes',{skip:!windows},t=>{
 const f=fixture(t); f.put=(name,value)=>{const file=path.join(f.root,name);write(file,value);return file;};
 let raw='<?xml version="1.0" encoding="UTF-8"?>\r\n<Export generator="fixture">\r\n<Class name="Demo.Line"><Method name="Value"><Implementation><![CDATA[\r\n Quit 1\r\n]]></Implementation></Method></Class>\r\n</Export>\r\n';
 if(format==='LF')raw=raw.replace(/\r\n/g,'\n');if(format==='BOM')raw='\uFEFF'+raw;
 const input=f.put('input.xml',raw),work=path.join(f.root,'work'),output=path.join(f.root,'delivery'),notes=f.put('notes.md','Change return value.');
 let result=ps('edit-export-xml.ps1',['-Mode','Unpack','-InputXml',input,'-WorkDirectory',work]);assert.equal(result.status,0,result.stderr);
 const object=path.join(work,'objects/000001.xml');fs.writeFileSync(object,fs.readFileSync(object,'utf8').replace('Quit 1','Quit 2'));
 result=ps('edit-export-xml.ps1',['-Mode','Pack','-WorkDirectory',work,'-OutputDirectory',output,'-NotesFile',notes]);assert.equal(result.status,0,result.stderr);
 assert.deepEqual(fs.readFileSync(path.join(output,'rollback.xml')),Buffer.from(raw));
 const changed=fs.readFileSync(path.join(output,'changes.xml'),'utf8');assert.equal(changed,raw.replace('Quit 1','Quit 2'));
 result=ps('edit-export-xml.ps1',['-Mode','Verify','-WorkDirectory',work,'-OutputDirectory',output]);assert.equal(result.status,0,result.stderr);
});

test('managed verify rejects source changes after packaging',{skip:!windows},t=>{
 const f=fixture(t);passed(framework(f,'prepare'));write(path.join(f.code,f.a),f.before.toString().replace('Quit 1','Quit 2'));passed(framework(f,'pack'));
 write(path.join(f.code,f.a),f.before.toString().replace('Quit 1','Quit 3'));
 const result=framework(f,'verify');assert.equal(result.status,1);assert.match(result.stderr,/delivery-source-drift/);
});
