'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const objectscript=require('../xml-package-objectscript');
test('class and execute share the exact restricted dispatch body without a predeployed helper',()=>{
    const request={operation:'inspect',namespace:'TEST',runId:'00000000-0000-4000-8000-000000000000',root:'/private/tasks',token:'a'.repeat(64),scopeHash:'b'.repeat(64)};
    const code=objectscript.executeCode(request);
    assert.ok(code.includes(objectscript.body()));assert.ok(!code.includes('##class(DHCDoc.Util.XmlPackage)'));
    assert.match(objectscript.classQuery(request),/^SELECT DHCDoc_Util\.XmlPackage_Dispatch\('/);
    assert.deepEqual(JSON.parse(Buffer.from(objectscript.encode(request),'base64').toString()),request);
});
test('framed executor responses tolerate diagnostics but reject missing or duplicate frames',()=>{
    assert.deepEqual(objectscript.parseExecuteOutput({output:'Export finished\nIRIS_XML_RESULT:{"code":0}\n'}),{code:0});
    assert.throws(()=>objectscript.parseExecuteOutput('IRIS_XML_RESULT:{}\nIRIS_XML_RESULT:{}'),/frame/);
    assert.throws(()=>objectscript.parseExecuteOutput({success:true}),/output/);
});
test('terminal uses a bounded literal XECUTE private block without turning request data into code',()=>{
    const request={operation:'info',namespace:'TEST',note:'" write "INJECT" //'};
    const code=objectscript.terminalCode(request),lines=code.split('\n');assert.equal(lines.length,3);
    assert.ok(Buffer.byteLength(code,'utf8')<=32768);assert.match(lines[1],/^xecute \("\(payload,result\) \{ /);
    const encoded=lines[0].match(/^set payload="([A-Za-z0-9+/=]+)"$/)[1];assert.deepEqual(JSON.parse(Buffer.from(encoded,'base64').toString()),request);
    assert.doesNotMatch(lines[1],/INJECT/);assert.ok(lines[1].includes('$system.OBJ.Export'));
    const program=lines[1].slice('xecute ("'.length,-'",payload,.result)'.length).replace(/""/g,'"');
    const expected='(payload,result) { '+objectscript.body().split('\n').filter(line=>!line.trim().startsWith('//')).map(line=>line.trim()).filter(Boolean).join(' ')+' }';
    assert.equal(program,expected);
    assert.throws(()=>objectscript.terminalCode({...request,note:'x'.repeat(32768)}),/too-large-use-class/);
});
test('self-contained source exposes no import, arbitrary path read or recursive delete surface',()=>{
    const source=fs.readFileSync(objectscript.SOURCE,'utf8');
    assert.match(source,/Class DHCDoc\.Util\.XmlPackage Extends %RegisteredObject/);
    assert.doesNotMatch(source,/QTZ|querySVN|AutoSaveToSVN|GenFile|ext\.util|websys\.Configuration|ImportFiles|LoadStream|RemoveDirectoryTree/);
    assert.match(source,/request\.namespace '= \$namespace/);
    assert.match(source,/xml-task-identity-mismatch/);assert.match(source,/xml-web-namespace-mismatch/);
    assert.ok(source.indexOf('registration.phase = "registered"')<source.indexOf('$system.OBJ.Export('));
    assert.ok(source.indexOf('xml-cleanup-file-failed')<source.indexOf('Delete(markerPath)'));
});
