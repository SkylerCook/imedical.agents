'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const crypto = require('node:crypto');
const {generate, compileCatalog, packageSources, helperSource} = require('../../tools/iris-code-export/build-catalogs');

test('preview validates all objects and rejects junction ancestors without contacting a server', {skip:process.platform!=='win32'}, t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iris-preview-test-'));
  const link=path.join(dir,'linked');
  t.after(()=>{if(fs.existsSync(link))fs.unlinkSync(link);fs.rmSync(dir,{recursive:true,force:true});});
  const list=path.join(dir,'files.txt');fs.writeFileSync(list,generate().files.get('v9.2.txt'));
  const run=out=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve(__dirname,'../../tools/iris-code-export/export-iris-code.ps1'),'-ListFile',list,'-OutputDirectory',out,'-PlanOnly'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
  const result=run(path.join(dir,'output'));assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).total,5352);assert.equal(fs.existsSync(path.join(dir,'output')),false);
  fs.mkdirSync(path.join(dir,'actual'));fs.symlinkSync(path.join(dir,'actual'),link,'junction');
  const rejected=run(path.join(link,'output'));assert.equal(rejected.status,1);assert.match(rejected.stderr,/linked-path-forbidden/);
});
test('packaged version scopes and normalized lists remain bound to the original catalogs', () => {
  const {index, files} = generate();
  assert.deepEqual(index.entries.map(e => [e.version, e.scope, e.codeCount, e.duplicateCount]), [
    ['v8.3','doctor',910,0], ['v8.4','doctor',2850,0], ['v8.5','doctor',3141,0], ['v9.0','doctor',3426,0], ['v9.0.2','doctor',3705,0], ['v9.1','doctor',4796,0], ['v9.2','all-products',5352,0]
  ]);
  for (const e of index.entries) {
    assert.equal(crypto.createHash('sha256').update(files.get(e.listFile)).digest('hex'), e.listSha256);
    assert.equal(e.rawItemCount, e.codeCount + e.duplicateCount + e.excludedImages.length);
    assert.equal(new Set(files.get(e.listFile).toString('utf8').trim().split('\n')).size, e.codeCount);
  }
  assert.deepEqual(index.entries.find(e => e.version === 'v9.1').webRoots, ['/imedical/web/', '/scripts/', '/web/']);
  assert.equal(index.entries.find(e => e.version === 'v9.1').webPathsNeedConfirmation, true);
  assert.equal(index.entries.find(e => e.version === 'v9.2').scopeLabel, '全仓 10 个产品');
  assert.deepEqual([...generate().files], [...files], 'build data must be reproducible');
});
test('reconstructed v8.3 includes verified supplements without assuming missing objects exist', () => {
  const list = generate().files.get('v8.3.txt').toString('utf8').trim().split('\n');
  for (const document of ['web.DHCOEOrdItem.cls', 'web.DHCDocOrderEntry.cls', 'DHCOEOrdExec.mac', 'CHPAT13NEW.mac', 'appcom.OEOrdExec.cls', 'User.DHCDocCTModule.cls', '/imedical/web/scripts/dhcdoc/UDHCOEOrder.List.Custom.New.js']) assert.ok(list.includes(document), document);
  for (const document of ['DHCDoc.DHCDocConfig.CodeTable.cls', 'DHCDoc.Order.Exec.cls']) assert.ok(!list.includes(document), document);
  assert.equal(list.filter(d => d.endsWith('.cls')).length, 333);
  assert.equal(list.filter(d => d.endsWith('.mac')).length, 2);
  assert.equal(list.filter(d => d.startsWith('/')).length, 575);
});
test('tag strengthening binds every published list to its audit and preserves unrelated versions', () => {
  const {index,files}=generate();
  const audit=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../maintenance/validation/doctor-tag-baseline-2026-11-03.json')));
  for(const r of audit.reports){
    const entry=index.entries.find(e=>e.version===r.version);
    assert.equal(entry.codeCount,r.after);
    assert.equal(entry.listSha256,r.sha256);
    const names=new Set(files.get(entry.listFile).toString('utf8').trim().split('\n'));
    for(const item of r.added) assert.ok(names.has(item.document),item.document);
    for(const item of r.retainedWithoutTagSource) assert.ok(names.has(item),item);
  }
  for(const [version,hash] of [['v8.3','42973a57db8bb0c782564697cfa115a40a4f7dc9d9847c0a5a2fe7fe96e058a5'],['v9.2','a45ff1a8d8b29fff0c84433d97b363bed76f4b3dafbcd17822fa222ebcda32dd']]) assert.equal(index.entries.find(e=>e.version===version).listSha256,hash);
  assert.ok(index.entries.every(e=>e.sourcePath.endsWith('.txt')));
  assert.equal(fs.readdirSync(path.resolve(__dirname,'../../docs/reference/project-export-map/doctor')).filter(n=>n.endsWith('.xml')).length,0);
});
test('TXT catalog rejects duplicates and XML while reporting binary exclusions', () => {
  const compiled=compileCatalog('Demo.A.cls\n/demo/a.png\n/demo/a.js\n');
  assert.deepEqual(compiled.items,['Demo.A.cls','/demo/a.js']);
  assert.deepEqual(compiled.excludedImages,['/demo/a.png']);
  for(const text of ['Demo.A.cls\nDemo.A.cls','/demo/A.js\n/demo/a.js','<Export/>','../a.js','demo/a.js']) assert.throws(()=>compileCatalog(text));
});
test('package staging contains no Node runtime or framework and copies the unique source helper', t => {
  const parent = process.env.CODEX_TEST_TMP_ROOT || path.join(os.tmpdir(), 'Codex'); fs.mkdirSync(parent, {recursive: true});
  const root = fs.mkdtempSync(path.join(parent, 'iris-version-build-'));
  t.after(() => { assert.equal(fs.lstatSync(root).isSymbolicLink(), false); fs.rmSync(root, {recursive: true, force: true}); });
  const target = path.join(root, 'package'); packageSources(target);
  assert.deepEqual(fs.readdirSync(target).sort(), ['README.md','catalogs','export-iris-code.ps1','export-version-baseline.ps1','files.example.txt','images','source-delivery.ps1'].sort());
  assert.deepEqual(fs.readFileSync(path.join(target,'source-delivery.ps1')), fs.readFileSync(helperSource()));
  assert.throws(() => packageSources(target), /must-be-new/);
});

test('version preview exposes complete document and path contract for workbench planning', {skip:process.platform!=='win32'}, t => {
  const parent=path.join(os.tmpdir(),'Codex');fs.mkdirSync(parent,{recursive:true});
  const dir=fs.mkdtempSync(path.join(parent,'version-plan-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const catalog=path.join(dir,'catalogs');fs.mkdirSync(catalog);
  for(const [name,bytes] of generate().files)fs.writeFileSync(path.join(catalog,name),bytes);
  for(const [version,scope] of [['v8.3','doctor'],['v9.2','all-products']]) {
    const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve(__dirname,'../../tools/iris-code-export/export-version-baseline.ps1'),'-Version',version,'-Scope',scope,'-CatalogDirectory',catalog,'-OutputDirectory',path.join(dir,'output'),'-PlanOnly'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
    assert.equal(result.status,0,result.stderr);const plan=JSON.parse(result.stdout);
    assert.equal(plan.items.length,plan.total);assert.ok(plan.total>100);
    for(const item of plan.items){assert.equal(typeof item.document,'string');assert.equal(typeof item.path,'string');}
    assert.equal(fs.existsSync(path.join(dir,'output')),false);
  }
});
