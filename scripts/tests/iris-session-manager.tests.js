'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const {createTempDirectory, ownsTempDirectory} = require('./fixtures/temp-directory');
const {SessionManager} = require('../lib/iris-session-manager');
const {makeScope, COOLDOWN_MS} = require('../lib/iris-operation-scope');
function fixture(t, overrides = {}) {
  const directory = createTempDirectory('iris-session-manager-');
  const events = []; let active = 0, maximum = 0, clock = 0;
  const manager = new SessionManager({directory, now: () => clock, idleMs: 100,
    open: async op => {
      events.push('open:' + op.label); active++; maximum = Math.max(maximum, active);
      return {call: async request => {events.push(request.label); if (request.wait) await request.wait; if (request.error) throw request.error; return request.label;},
        close: async () => {events.push('close'); active--; return {cleanupVerified: true};}};
    }, ...overrides});
  t.after(async () => {await manager.stop(); if (ownsTempDirectory(directory)) fs.rmSync(directory, {recursive: true});});
  const call = (label, extra = {}) => manager.submit({pool: 'pool', identity: 'identity', client: 'client', ...extra, operation: {label, effects: 'read-only', ...extra.operation}});
  return {manager, call, events, directory, maximum: () => maximum, advance: ms => {clock += ms;}};
}
test('independent calls and projects reuse one session, execute FIFO and expire idle', async t => {
  const f = fixture(t);
  await f.call('one'); await f.call('two', {client: 'another-project'});
  await Promise.all([f.call('three'), f.call('four')]);
  assert.deepEqual(f.events, ['open:one','one','two','three','four']);
  assert.equal(f.maximum(), 1); f.advance(101); await f.manager.sweep();
  assert.equal(f.events.at(-1), 'close'); assert.equal(f.manager.status()[0].active, false);
});
test('identity switch closes previous session before opening the next', async t => {
  const f = fixture(t); await f.call('one'); await f.call('two', {identity: 'different-user'});
  assert.deepEqual(f.events, ['open:one','one','close','open:two','two']); assert.equal(f.maximum(), 1);
});
test('503 sends once, rejects queued work and admits a new request after cooldown', async t => {
  const f = fixture(t); let release;
  const wait = new Promise(resolve => {release = resolve;});
  const first = f.call('first', {operation: {label: 'first', effects: 'read-only', wait, error: Object.assign(new Error('unavailable'), {status: 503})}});
  const second = f.call('second'); const results = Promise.allSettled([first, second]); release();
  assert.deepEqual((await results).map(x => x.status), ['rejected','rejected']);
  assert.deepEqual(f.events, ['open:first','first','close']);
  await assert.rejects(f.call('third'), error => error.code === 'session-service-cooling-down' && error.beforeSend === true);
  f.advance(COOLDOWN_MS + 1);
  assert.equal(await f.call('after-cooldown'), 'after-cooldown');
  assert.equal(f.events.filter(value => value === 'first').length, 1);
  assert.equal(f.events.includes('second'), false);
});
test('uncertain read session is retired and queued reads use a new generation', async t => {
  const f = fixture(t); let release;
  const wait = new Promise(resolve => {release = resolve;});
  const first = f.call('first', {operation: {label: 'first', effects: 'read-only', wait,
    error: Object.assign(new Error('cookie changed'), {sessionUncertain: true, beforeSend: false})}});
  const second = f.call('second'); const results = Promise.allSettled([first, second]); release();
  assert.deepEqual((await results).map(x => x.status), ['rejected', 'fulfilled']);
  assert.deepEqual(f.events, ['open:first', 'first', 'close', 'open:second', 'second']);
  assert.equal(await f.call('third'), 'third');
  assert.equal(f.manager.status()[0].generation, 2);
  assert.equal(f.manager.status()[0].blocked, null);
  assert.equal(f.manager.status()[0].unresolvedWrites.length, 0);
});

test('cancelled queue item is never sent and queue timeout is before-send', async t => {
  const f = fixture(t); let release; const wait = new Promise(resolve => {release = resolve;});
  const first = f.call('first', {operation: {label: 'first', wait}});
  const ctrl = new AbortController(); const second = f.call('second', {signal: ctrl.signal});
  ctrl.abort(); await assert.rejects(second, e => e.beforeSend === true);
  await assert.rejects(f.call('third', {timeoutMs: 10}), e => e.code === 'session-queue-timeout' && e.beforeSend);
  release(); await first; assert.equal(f.events.includes('second'), false); assert.equal(f.events.includes('third'), false);
});
test('crashed active state blocks reopen, clean shutdown permits it', async t => {
  const f = fixture(t); await f.call('one');
  const recovered = new SessionManager({directory: f.directory, open: async () => {throw new Error('must not open');}});
  await assert.rejects(recovered.submit({pool: 'pool', identity: 'identity', operation: {}}), /session-exit-unverified/);
  await f.manager.close('pool');
  const clean = new SessionManager({directory: f.directory, open: async () => ({call: async () => true, close: async () => ({cleanupVerified:true})})});
  assert.equal(await clean.submit({pool:'pool', identity:'identity', operation:{}}), true); await clean.stop();
});

test('lease owner can close while other clients wait; another project cannot close it',async t=>{
  const f=fixture(t);await f.call('open-ws',{lease:true});
  await assert.rejects(f.manager.close('pool','another'),/pool-busy/);
  const queued=f.call('other',{client:'another'});
  await f.call('close-ws',{releaseLease:true});await queued;
  assert.deepEqual(f.events,['open:open-ws','open-ws','close-ws','other']);
});

test('queue deadline does not cancel an already dispatched operation',async t=>{
  const f=fixture(t);
  assert.equal(await f.call('slow',{timeoutMs:5,operation:{label:'slow',wait:new Promise(resolve=>setTimeout(resolve,30))}}),'slow');
  assert.equal(f.manager.status()[0].blocked,null);
});

test('cancellation after send preserves unknown write and does not replay',async t=>{
  const f=fixture(t);let release;const ctrl=new AbortController();
  const scope=makeScope({protocol:'https:',hostname:'synthetic.invalid',port:443,namespace:'TEST'},['Demo.Write.cls']);
  const pending=f.call('write',{signal:ctrl.signal,operation:{label:'write',effects:'write',scope,wait:new Promise(resolve=>{release=resolve;})}});
  await new Promise(resolve=>setImmediate(resolve));ctrl.abort();release();
  await assert.rejects(pending,e=>e.code==='session-cancelled-after-send' && e.beforeSend===false);
  const state=f.manager.status()[0];assert.equal(state.pendingEffects,null);assert.equal(state.active,false);
  assert.equal(state.blocked,null);assert.equal(state.unresolvedWrites.length,1);
  await assert.rejects(f.call('same-target',{operation:{effects:'write',scope}}),error=>error.beforeSend===true && error.code==='session-write-conflict-unresolved');
  assert.equal(f.events.includes('same-target'),false);
  assert.throws(()=>f.manager.reconcile('pool',{confirm:true,token:state.reconciliationToken,evidence:{cleanupVerified:true,reference:'evidence'}}),/write-outcome-required/);
  f.manager.reconcile('pool',{confirm:true,token:state.reconciliationToken,evidence:{cleanupVerified:true,reference:'evidence'},writeOutcome:'verified-not-applied'});
  assert.equal(f.manager.status()[0].blocked,null);assert.equal(f.events.filter(e=>e==='write').length,1);
});

test('orphaned durable state appears in status before any new call',async t=>{
  const f=fixture(t);await f.call('one');
  const recovered=new SessionManager({directory:f.directory,open:async()=>{throw Error('no open');}});
  assert.equal(recovered.status()[0].blocked,'session-exit-unverified');
});

test('disconnect of a read lease retires its operation and lets unrelated queued clients continue',async t=>{
  const f=fixture(t);await f.call('ws',{lease:true});let release;
  const sent=f.call('execute',{operation:{label:'execute',wait:new Promise(resolve=>{release=resolve;})}});
  const waiting=f.call('other',{client:'another'});const results=Promise.allSettled([sent,waiting]);
  f.manager.disconnect('client');release();assert.deepEqual((await results).map(x=>x.status),['rejected','fulfilled']);
  assert.equal(f.events.filter(value=>value==='execute').length,1);assert.equal(f.events.includes('other'),true);
  const state=f.manager.status()[0];assert.equal(state.blocked,null);assert.equal(state.unresolvedWrites.length,0);
  assert.equal(state.generation,2);assert.equal(f.events.includes('close'),true);
});

test('new requests wait for idle logout before opening next generation',async t=>{
  let release,opens=0;const closed=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,{open:async()=>{opens++;return {call:async()=>true,close:async()=>{await closed;return {cleanupVerified:true};}};}});
  await f.call('first');f.advance(101);const sweep=f.manager.sweep();const next=f.call('second');
  assert.equal(opens,1);release();await sweep;await next;assert.equal(opens,2);
});

test('a successful prior generation cannot certify a later failed close across restart', async t => {
  let generation=0;
  const f=fixture(t,{open:async()=>{const current=++generation;return {call:async()=>true,close:async()=>{if(current===2)throw Error('close lost');return {cleanupVerified:true,processExited:true};}};}});
  await f.call('first');await f.manager.close('pool');await f.call('second');await f.manager.close('pool');
  const recovered=new SessionManager({directory:f.directory,open:async()=>{throw Error('must not reopen live resources');}});
  try {await assert.rejects(recovered.submit({pool:'pool',identity:'identity',operation:{effects:'read-only'}}),/exit-unverified/);}
  finally {await recovered.stop();}
});

test('backend configuration distinguishes unavailable connection and target mismatch',async()=>{
  const {verifyBackendConfiguration}=require('../lib/iris-session-backends');
  const expected={hostname:'fixture.invalid',port:443,namespace:'TEST'};
  const client={request:async()=>({connected:true,host:expected.hostname,port:443,namespace:'TEST'})};
  await verifyBackendConfiguration(client,expected,()=>{});
  await assert.rejects(verifyBackendConfiguration(client,{...expected,namespace:'OTHER'},()=>{}),{code:'session-backend-target-mismatch',beforeSend:true});
  await assert.rejects(verifyBackendConfiguration({request:async()=>({connected:false})},expected,()=>{}),{code:'session-backend-connection-unavailable',beforeSend:true});
  await assert.rejects(verifyBackendConfiguration(client,expected,()=>{throw Object.assign(Error(),{code:'session-service-unavailable'});}),{code:'session-service-unavailable'});
});

test('failed startup keeps its actual exit receipt without creating a pending write',async t=>{
  const exit={processExited:true,localResourcesClosed:true,cleanupVerified:true};
  const f=fixture(t,{open:async()=>{throw Object.assign(Error('startup'),{code:'session-backend-connection-unavailable',beforeSend:true,backendExit:exit});}});
  await assert.rejects(f.call('write',{operation:{effects:'write'}}),{code:'session-backend-connection-unavailable'});
  assert.deepEqual(f.manager.status()[0].exit,{...exit,generation:1,at:new Date(0).toISOString(),channel:undefined});
  assert.equal(f.manager.status()[0].unresolvedWrites.length,0);
});


test('warning receipts identify the originating generation and historical state',async t=>{
  const f=fixture(t);
  await assert.rejects(f.call('failed-read',{operation:{error:Object.assign(Error('failed'),{beforeSend:false})}}));
  const first=f.manager.status()[0];
  assert.equal(first.warning.generation,first.generation);assert.equal(first.warning.historical,false);
  await f.call('next-read');
  const next=f.manager.status()[0];assert.equal(next.warning.historical,true);
  assert.equal(next.warning.generation,first.generation);assert.equal(next.warning.at,first.warning.at);
});

test('reconciliation gives actionable reasons and is idempotent after verified recovery',async t=>{
  const f=fixture(t),scope=makeScope({host:'fixture',port:443,namespace:'TEST'},['A.cls']);
  assert.throws(()=>f.manager.reconcile('missing',{confirm:true}),{code:'session-reconciliation-pool-not-found'});
  await assert.rejects(f.call('write',{operation:{effects:'write',scope,error:Object.assign(Error('lost'),{beforeSend:false})}}));
  const state=f.manager.status()[0],token=state.reconciliationToken;
  assert.throws(()=>f.manager.reconcile('pool',{}),{code:'session-reconciliation-confirmation-required'});
  assert.throws(()=>f.manager.reconcile('pool',{confirm:true,token:'stale'}),{code:'session-reconciliation-token-stale'});
  assert.throws(()=>f.manager.reconcile('pool',{confirm:true,token}),{code:'session-reconciliation-evidence-required'});
  assert.throws(()=>f.manager.reconcile('pool',{confirm:true,token,evidence:{reference:'fixture'}}),{code:'session-reconciliation-exit-evidence-required'});
  const params={confirm:true,token,evidence:{reference:'fixture',processExited:true}};
  assert.throws(()=>f.manager.reconcile('pool',params),{code:'session-reconciliation-write-outcome-required'});
  assert.equal(f.manager.reconcile('pool',{...params,writeOutcome:'verified-not-applied'}).unresolvedWrites.length,0);
  assert.equal(f.manager.reconcile('pool',params).status,'not-required');
});

test('runtime failure after an effect requires explicit outcome and reuses a current close receipt',async t=>{
  let writes=0;
  const f=fixture(t,{open:async()=>({call:async op=>{
    if(op.effects==='write') {writes++;throw Object.assign(Error('private SQL and output'),{code:'session-write-outcome-unverified',toolErrorCode:'IRIS_RUNTIME_ERROR',beforeSend:false});}
    return 'ok';
  },close:async()=>({processExited:true,cleanupVerified:false})})});
  await assert.rejects(f.call('write',{operation:{effects:'write',channel:'mcp'}}));
  let state=f.manager.status()[0];
  assert.equal(writes,1);
  assert.equal(state.nextAction,'verify-write-outcome');
  assert.equal(state.lastFailedOperation.toolErrorCode,'IRIS_RUNTIME_ERROR');
  assert.equal(state.lastFailedOperation.id,state.unresolvedWrites[0].id);
  assert.equal(state.blockingReasons[0].affects,'conflicting-writes');
  assert.throws(()=>f.manager.reconcile('pool',{confirm:true,token:state.reconciliationToken}),{code:'session-reconciliation-write-outcome-required'});
  const pool=f.manager.pool('pool'),persist=f.manager.persist.bind(f.manager);
  f.manager.persist=()=>{throw Error('synthetic disk failure');};
  assert.throws(()=>f.manager.reconcile('pool',{confirm:true,token:state.reconciliationToken,writeOutcome:'verified-applied'}),/disk failure/);
  assert.equal(pool.unresolvedWrites.length,1);
  f.manager.persist=persist;
  state=f.manager.reconcile('pool',{confirm:true,token:state.reconciliationToken,writeOutcome:'verified-applied'});
  assert.equal(state.unresolvedWrites.length,0);
  assert.equal(f.manager.reconcile('pool',{confirm:true}).status,'not-required');
  assert.equal(await f.call('read'),'ok');
  assert.equal(await f.call('read-again'),'ok');
  assert.equal(writes,1);
  const history=fs.readdirSync(f.directory).filter(x=>x.endsWith('.resolved'));
  for(const name of history) {
    const raw=fs.readFileSync(require('node:path').join(f.directory,name),'utf8');
    assert.equal(raw.includes('private SQL'),false);
    assert.equal(JSON.parse(raw).evidence.source,'local-close-receipt');
  }
});

test('legacy warnings remain unknown and old close receipts cannot certify a new generation',async t=>{
  const risk=require('../lib/iris-operation-scope');
  const warning={reason:'old',at:'2026-01-01T00:00:00Z'};
  assert.equal(risk.warningSummary({warning,generation:2}).historical,null);
  assert.equal(risk.warningSummary({warning,lastReconciledAt:'2026-01-02T00:00:00Z'}).historical,true);
  assert.equal(risk.exitEvidence({generation:2,exit:{generation:1,processExited:true}}),null);
  assert.equal(risk.exitEvidence({generation:2,exit:{cleanupVerified:true}}),null);
  assert.equal(risk.exitEvidence({generation:2,exit:{generation:2,processExited:false,localResourcesClosed:true}}),null);
  assert.deepEqual(risk.failureDetails({code:'private SQL text',beforeSend:true,status:'500',message:'secret'}),{errorCode:'operation-failed',beforeSend:true});
  const f=fixture(t);
  await f.call('read');
  const token=f.manager.status()[0].reconciliationToken;
  await f.call('read-again');
  // Status tokens bind state, while close rechecks the token in the host dispatch.
  await assert.rejects(f.manager.close('pool','client','stale'),{code:'session-reconciliation-token-stale'});
  assert.ok(token);
});
