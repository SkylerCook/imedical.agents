'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {needsInput,decisionError}=require('../deploy-question');
const {run}=require('../deploy-guard');
const token='a'.repeat(64);

test('question has stable codes independent of labels or order',()=>{
  const r=needsInput('remote-overwritten-again',{token,file:'example.js'});
  assert.equal(r.question.schema,'iris-deploy-question/v1');
  assert.equal(r.question.recommendedAction,'pause');
  assert.equal(r.question.requiresExplicitResponse,true);
  assert.deepEqual(r.question.choices.map(x=>x.code),['pause','inspect','merge','overwrite']);
  assert.deepEqual(r.details.options,r.question.choices.map(x=>x.code));
  assert.equal(r.question.token,token);
});
test('Storage and unknown failures do not offer an override',()=>{
  for(const reason of ['storage-review-required','encoding-unknown','git-upstream-update','transport-or-compile-failed']){
    assert.deepEqual(needsInput(reason,{token}).details.options,['pause','inspect']);
  }
});
test('recovery and conflict expose only meaningful actions',()=>{
  assert.deepEqual(needsInput('previous-result-unknown',{token}).details.options,['pause','inspect','resume']);
  assert.deepEqual(needsInput('merge-conflict',{token}).details.options,['pause','inspect','overwrite']);
  assert.deepEqual(needsInput('remote-deleted',{}).details.options,['pause','inspect']);
});
test('legacy and versioned exact receipts remain accepted',()=>{
  assert.equal(decisionError({action:'overwrite',token}),null);
  assert.equal(decisionError({schema:'iris-deploy-decision/v1',action:'merge',token}),null);
});
test('labels, positions, empty answers and future schemas cannot authorize',()=>{
  for(const value of ['yes',1,{},[],{action:'覆盖当前文件',token},{action:'1',token},{action:'toString',token},{schema:'future',action:'overwrite',token}]){
    assert.equal(decisionError(value),'invalid-decision');
  }
  assert.equal(decisionError({action:'overwrite'}),'invalid-decision-token');
});
test('pause, inspect and malformed receipts stop before filesystem or adapter access',async()=>{
  for(const action of ['pause','inspect','yes']){
    let calls=0;
    const result=await run({repo:'nonexistent-test-repository',decision:{action},adapter:{read:async()=>{calls++;}}});
    assert.equal(result.status,'needs-user-input');
    assert.equal(result.reason,action==='yes'?'invalid-decision':'decision-'+action);
    assert.equal(calls,0);
  }
});
test('original machine-readable failure fields remain available',()=>{
  const r=needsInput('previous-result-unknown',{token,file:'example.cls'},{partialOrUnknown:true,stateFile:'private/session.json'});
  assert.equal(r.status,'needs-user-input');
  assert.equal(r.reason,'previous-result-unknown');
  assert.equal(r.details.file,'example.cls');
  assert.equal(r.partialOrUnknown,true);
});
