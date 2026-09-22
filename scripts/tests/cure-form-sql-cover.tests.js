'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('fs'), os=require('os'), path=require('path');
const {sqlCover,targetOf,resultOf,READ,REFERENCES,UPDATE,hash}=require('../../plugins/iris-cure-form-dev/scripts/cure-form-sql-cover');
const {selectDeployment}=require('../../plugins/iris-cure-form-dev/scripts/cure-form-deployment-policy');
function fixture(t) {
 const outputRoot=fs.mkdtempSync(path.join(os.tmpdir(),'cure-sql-'));
 t.after(()=>fs.rmSync(outputRoot,{recursive:true,force:true}));
 const before={rowId:'10',name:'Example',type:'',content:'<div><input id="a"></div>',appId:'Example',js:'',mapType:'CA',lastId:'9'};
 const map={rowId:'8',code:'Example',showTemp:'10',showJS:'scripts/example.js',mapType:'CA'};
 const snapshot={exists:true,formType:'CA',mapCode:'Example',templates:[before],map};
 const packageValue={mapCode:'Example',formType:'CA',expectedVersion:1,sourceSnapshotHash:hash(snapshot),changes:{strategy:'in-place-overwrite',templates:[{rowId:'10',content:'<div class="responsive"><input id="a"></div>'}],map:{showJS:map.showJS},resources:[]}};
 return {before,map,snapshot,packageValue,options:{snapshot,packageValue,outputRoot,mode:'automatic',confirmWrite:true,confirmRemoteExecution:true,operator:'test',reason:'test'}};
}
test('deployment choices explicitly expose independent SQL channel and shorter budget',()=>{
 assert.equal(selectDeployment({channel:'lightweight-sql'}).totalTimeoutMs,120000);
 assert.equal(selectDeployment().channel,'transaction-package');
 assert.throws(()=>selectDeployment({channel:'arbitrary-sql'}));
});
test('manual SQL handoff never connects',async t=>{
 const {options}=fixture(t);
 const r=await sqlCover({...options,mode:'manual',connect:()=>{throw Error('must not connect');}},()=>{});
 assert.equal(r.status,'manual-ready');assert.equal(r.channel,'lightweight-sql');
});
test('SQL cover performs backup, one parameterized update and readback only',async t=>{
 const {options,before,map}=fixture(t);let current=structuredClone(before),writes=0,closed=0;
 const r=await sqlCover({...options,connect:async()=>({query:async(q,p,w)=>{
  if(q===READ)return {rows:[current]};
  if(q===REFERENCES)return {rows:[map]};
  assert.equal(q,UPDATE);assert.equal(w,true);assert.ok(q.includes('%EXACT(COALESCE(APP_Content,CHAR(0)))'));assert.ok(q.includes('COALESCE(LENGTH(APPMap_ShowJS),0)'));assert.ok(!q.includes('<div'));
  assert.equal(p[1],'10');assert.equal(p[3],before.content);assert.equal(p[4],before.content);writes++;current={...current,content:p[0]};return {rows_affected:1};
 },close:()=>closed++})},()=>{});
 assert.equal(r.status,'verified');assert.equal(writes,1);assert.equal(closed,1);assert.equal(r.operationId,null);assert.equal(r.auditMode,'local-only');
 assert.ok(fs.existsSync(path.join(path.dirname(r.reportPath),'before.json')));
 await assert.rejects(sqlCover(options,()=>{}),/EEXIST/);
});
test('changed baseline and shared references stop before UPDATE',async t=>{
 for(const scenario of ['changed','shared']){
  const f=fixture(t);let writes=0;
  const r=await sqlCover({...f.options,connect:async()=>({query:async q=>{
   if(q===READ)return {rows:[{...f.before,content:scenario==='changed'?'different':f.before.content}]};
   if(q===REFERENCES)return {rows:scenario==='shared'?[f.map,f.map]:[f.map]};
   writes++;return {};
  },close(){}})},()=>{});
  assert.equal(r.status,'manual-handoff-required');assert.equal(writes,0);
 }
});
test('conditional UPDATE zero rows is conflict; missing acknowledgment is unknown without retry',async t=>{
 for(const affected of [0,undefined]){
  const f=fixture(t);let writes=0;
  const r=await sqlCover({...f.options,connect:async()=>({query:async q=>{
   if(q===READ)return {rows:[f.before]};if(q===REFERENCES)return {rows:[f.map]};writes++;return {rows_affected:affected};
  },close(){}})},()=>{});
  assert.equal(r.status,affected===0?'concurrency-conflict':'write-outcome-unknown');assert.equal(writes,1);
 }
});
test('no clear, Map mutation, cache mutation or field contract mutation may use SQL',t=>{
 const f=fixture(t);
 for(const content of ['', '<div><input id="changed"></div>']){
  const p=structuredClone(f.packageValue);p.changes.templates[0].content=content;assert.throws(()=>targetOf(p,f.snapshot));
 }
 const p=structuredClone(f.packageValue);p.changes.map.showJS='changed.js';assert.throws(()=>targetOf(p,f.snapshot),/Map changes/);
 const p2=structuredClone(f.packageValue);p2.changes.templates[0].items=[];assert.throws(()=>targetOf(p2,f.snapshot));
});
test('identical content is no-op and truncated SQL output is never accepted',async t=>{
 const f=fixture(t);f.options.packageValue.changes.templates[0].content=f.before.content;let writes=0;
 const r=await sqlCover({...f.options,connect:async()=>({query:async q=>q===READ?{rows:[f.before]}:q===REFERENCES?{rows:[f.map]}:(writes++,{}),close(){}})},()=>{});
 assert.equal(r.status,'unchanged');assert.equal(writes,0);
 assert.throws(()=>resultOf({result:{structuredContent:{success:true,truncated:true,rows:[]}}}),/truncated/);
 assert.throws(()=>resultOf({result:{structuredContent:{success:false}}}));
});

test('known write followed by read failure is not reported as verified or retried',async t=>{
 const f=fixture(t);let writes=0;
 const r=await sqlCover({...f.options,connect:async()=>({query:async q=>{
  if(q===READ){if(writes)throw Error('read unavailable');return {rows:[f.before]};}
  if(q===REFERENCES)return {rows:[f.map]};writes++;return {rows_affected:1};
 },close(){}})},()=>{});
 assert.equal(r.status,'verification-unavailable');assert.equal(writes,1);
});

test('automatic SQL cannot connect without current write confirmation',async t=>{
 const f=fixture(t);
 await assert.rejects(sqlCover({...f.options,confirmWrite:false,connect:()=>{throw Error('must not connect');}},()=>{}),/explicit write/);
});
