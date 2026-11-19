'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const settings=require('../lib/project-plugin-settings');
const io=require('../lib/configuration-file-io');
const cli=path.resolve(__dirname,'../plugin-settings.js');
test('shared capability keeps plugin settings in each member and preserves notes across recovery',t=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'plugin-settings-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const cap=path.join(base,'shared'), id='iris-interface-dev';
  fs.mkdirSync(cap);execFileSync('git',['init','-q',cap]);
  for (const member of ['one','two']) {
    const project=path.join(base,member),ctx=path.join(project,'.agents'),dir=path.join(ctx,'config');
    fs.mkdirSync(dir,{recursive:true});
    const manifest={schemaVersion:1,mode:'workspace-overlay',workspace:member,contextRoot:'.agents',capabilityRoot:cap,
      sharedDirectories:[],localDirectories:['config'],sourceRoots:[]};
    fs.writeFileSync(path.join(ctx,'capability.json'),JSON.stringify(manifest));
    const main=path.join(dir,'project.jsonc'),old=path.join(dir,settings.domains[id].file);
    fs.writeFileSync(main,'\ufeff{\r\n// keep\r\n"pluginSettings":{"iris-interface-dev":{"future":17}}\r\n}\r\n');
    const notes='\ufeff# notes\r\n<!-- keep -->\r\n- extra: unchanged\r\n';
    const row='- outputRoot: '+member+'/out\r\n';
    fs.writeFileSync(old,notes+row);
    const invoke=(mode,...args)=>JSON.parse(execFileSync(process.execPath,[cli,mode,id,project,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
    assert.equal(invoke('DryRun').status,'config-migration-planned');
    assert.equal(fs.readFileSync(old,'utf8'),notes+row);
    assert.equal(invoke('Write').status,'config-migration-applied');
    assert.equal(invoke('Read').outputRoot,member+'/out');
    assert.equal(fs.readFileSync(old,'utf8'),notes);
    const saved=io.readText(main);
    assert.ok(saved.startsWith('\ufeff') && saved.includes('// keep') && saved.includes('"future":17'));
    fs.appendFileSync(old,row); // Interrupt after copying the same value, before retiring old rows.
    invoke('Write');
    assert.equal(io.readText(main),saved);
    fs.appendFileSync(old,'- outputRoot: conflict\r\n');
    assert.throws(()=>invoke('Write'),/conflicts/);
    assert.equal(io.readText(main),saved);
    fs.writeFileSync(old,notes);
    invoke('Rollback');
    assert.equal(io.parse(io.readText(main)).pluginSettings[id].future,17);
    assert.equal(invoke('Read').outputRoot,member+'/out');
  }
  assert.ok(!fs.existsSync(path.join(cap,'config')));
});

test('rollback preserves settings which still exist only in Markdown', t => {
  const contextRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-settings-'));
  t.after(() => fs.rmSync(contextRoot, {recursive:true, force:true}));
  const config = path.join(contextRoot, 'config');
  fs.mkdirSync(config);
  const id = 'iris-cure-form-dev';
  fs.writeFileSync(path.join(config, 'project.jsonc'), JSON.stringify({pluginSettings:{[id]:{WorkRoot:'work'}}}));
  fs.writeFileSync(path.join(config, settings.domains[id].file), '- PreviewBrowserCommand: custom-browser\n');
  settings.apply({contextRoot}, id, 'Rollback');
  assert.deepEqual(settings.apply({contextRoot}, id), {WorkRoot:'work', PreviewBrowserCommand:'custom-browser'});
});
