'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createTempDirectory,ownsTempDirectory}=require('./fixtures/temp-directory');
test('temporary fixtures resolve parent aliases before strict runtime link checks',t=>{
 const root=createTempDirectory('temp-alias-test-'),physical=path.join(root,'physical'),alias=path.join(root,'alias');
 fs.mkdirSync(physical);fs.symlinkSync(physical,alias,process.platform==='win32'?'junction':'dir');
 t.after(()=>{assert.equal(fs.lstatSync(alias).isSymbolicLink(),true);fs.unlinkSync(alias);assert.equal(fs.existsSync(alias),false);assert.equal(fs.realpathSync.native(root),root);fs.rmSync(root,{recursive:true,force:true});});
 const prior=process.env.CODEX_TEST_TMP_ROOT;let created;
 try{process.env.CODEX_TEST_TMP_ROOT=alias;created=createTempDirectory('physical-fixture-');}
 finally{if(prior===undefined)delete process.env.CODEX_TEST_TMP_ROOT;else process.env.CODEX_TEST_TMP_ROOT=prior;}
 assert.equal(path.dirname(created),physical);assert.equal(ownsTempDirectory(created),true);
 const remote=require('../lib/iris-remote-operations');
 assert.doesNotThrow(()=>remote.poolStatus({policy:{enabled:true,coordinationRoot:created,poolKey:'fixture'}}));
 assert.throws(()=>remote.poolStatus({policy:{enabled:true,coordinationRoot:alias,poolKey:'fixture'}}),{code:'remote-coordination-link'});
});
