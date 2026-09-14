'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildBoundUpdate,executeBoundUpdate}=require('../../plugins/iris-cure-form-dev/scripts/cure-form-sql-binding');
const params=["中文's\n",'10','CA','old','old','%||10||%','8','CA','Example','10','10','',''];
test('fixed SQL binds count and update separately, transports unicode as data, and rolls back wrong row count',()=>{
 const code=buildBoundUpdate(params);
 assert.ok(code.includes('counter.%Execute(p.%Get(1),'));assert.ok(code.includes('updater.%Execute(p.%Get(0),'));
 assert.ok(code.includes('if result.precheckRows=1'));assert.ok(code.includes('wr.%ROWCOUNT=1'));assert.ok(code.includes('trollback'));
 assert.ok(!code.includes("中文's"));
 const data=[...code.matchAll(/set payload=payload_"([A-Za-z0-9+/=]+)"/g)].map(m=>m[1]).join('');
 assert.deepEqual(JSON.parse(Buffer.from(data,'base64').toString('utf8')),params);
 assert.throws(()=>buildBoundUpdate(params.slice(1)));
 const bad=[...params];bad[1]='10 OR 1=1';assert.throws(()=>buildBoundUpdate(bad));
});
test('fixed SQL accepts only framed acknowledgments and never retries unknown outcomes',async()=>{
 let calls=0;const c={request:async()=>{calls++;return {result:{content:[{type:'text',text:'{}'}]}};}};
 await assert.rejects(executeBoundUpdate(c,'TEST',params),/acknowledgment missing/);assert.equal(calls,1);
 const v={success:true,rows_affected:1,rows_check_skipped:false};
 const text='CURE_SQL_RESULT:'+Buffer.from(JSON.stringify(v)).toString('base64')+':CURE_SQL_END';
 assert.deepEqual(await executeBoundUpdate({request:async()=>({result:{content:[{type:'text',text:JSON.stringify({stdout:text})}]}})},'TEST',params),v);
});
