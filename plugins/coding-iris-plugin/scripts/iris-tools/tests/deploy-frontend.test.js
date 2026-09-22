const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {parse,buildPlan,execute}=require('../deploy-frontend');
const plan={schema:'iris-frontend-deploy/v1',files:[{file:'csp/page.csp',sha256:'abc'}],documents:['web/csp/page.csp']};
const evidence={status:'verified',files:[{...plan.files[0],status:'uploaded'}]};
test('upload verification precedes exactly one compile',async()=>{
 const calls=[];
 const result=await execute(plan,async()=>{calls.push('upload');return evidence;},async docs=>{calls.push('compile');assert.deepEqual(docs,plan.documents);return {status:'compiled'};});
 assert.equal(result.status,'verified');assert.deepEqual(calls,['upload','compile']);
});
test('unchanged files still compile requested CSP',async()=>{
 let count=0;
 const result=await execute(plan,async()=>({...evidence,files:[{...evidence.files[0],status:'unchanged'}]}),async()=>{count++;return {status:'compiled'};});
 assert.equal(result.status,'verified');assert.equal(count,1);
});
test('failure or incomplete hash evidence prevents compilation',async()=>{
 for(const response of [{status:'upload-failed'}, {status:'verified',files:[]},{status:'verified',files:[{...evidence.files[0],sha256:'wrong'}]}]) {
  let called=false;const result=await execute(plan,async()=>response,async()=>{called=true;});
  assert.notEqual(result.status,'verified');assert.equal(called,false);
 }
});
test('compile failure is preserved without retry',async()=>{
 let calls=0;const result=await execute(plan,async()=>evidence,async()=>{calls++;return {status:'compile-failed'};});
 assert.equal(result.status,'compile-failed');assert.equal(calls,1);
});
test('static assets require no compiler',async()=>{
 const result=await execute({...plan,documents:[]},async()=>evidence,async()=>{throw Error('unexpected compile');});assert.equal(result.status,'verified');
});
test('local plan maps explicit files and rejects escapes, duplicate and invalid UTF8',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frontend-plan-'));
 try {
  fs.mkdirSync(path.join(root,'csp'));fs.writeFileSync(path.join(root,'csp/page.csp'),'hello');
  const args={sourceRoot:root,files:['csp/page.csp']};const config={web:{cspBasePath:'web/csp'}};
  const context={workspaceRoot:root,sourceRoots:[{target:root}]};const env={REMOTE_PATH:'/web'};
  const p=buildPlan(args,config,env,context);assert.equal(p.files[0].remotePath,'/web/csp/page.csp');assert.deepEqual(p.documents,['web/csp/page.csp']);
  assert.throws(()=>buildPlan({...args,files:[...args.files,...args.files]},config,env,context));
  assert.throws(()=>buildPlan(args,config,{REMOTE_PATH:'/web/../other'},context));
  fs.writeFileSync(path.join(root,'csp/page.csp'),Buffer.from([0xff]));assert.throws(()=>buildPlan(args,config,env,context));
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('execution and trust must be explicit',()=>{
 assert.equal(parse(['--files','a.js']).execute,false);
 assert.throws(()=>parse(['--files','a.js','--host-key-sha256','invalid']));
 assert.throws(()=>parse(['--files','a.js','--known-hosts','hosts','--host-key-sha256','SHA256:'+'A'.repeat(43)]));
});
