'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const {createTempDirectory, ownsTempDirectory} = require('./fixtures/temp-directory');
const {SessionManager} = require('../lib/iris-session-manager');
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
  const call = (label, extra = {}) => manager.submit({pool: 'pool', identity: 'identity', client: 'client', operation: {label, effects: 'read-only', ...extra.operation}, ...extra});
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
test('503 sends once and rejects queued work without opening another connection', async t => {
  const f = fixture(t); let release;
  const wait = new Promise(resolve => {release = resolve;});
  const first = f.call('first', {operation: {label: 'first', effects: 'read-only', wait, error: Object.assign(new Error('unavailable'), {status: 503})}});
  const second = f.call('second'); const results = Promise.allSettled([first, second]); release();
  assert.deepEqual((await results).map(x => x.status), ['rejected','rejected']);
  assert.deepEqual(f.events, ['open:first','first','close']);
  await assert.rejects(f.call('third'), /session-service-unavailable/);
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
  const pending=f.call('write',{signal:ctrl.signal,operation:{label:'write',effects:'write',wait:new Promise(resolve=>{release=resolve;})}});
  await new Promise(resolve=>setImmediate(resolve));ctrl.abort();release();
  await assert.rejects(pending,e=>e.code==='session-cancelled-after-send' && e.beforeSend===false);
  const state=f.manager.status()[0];assert.equal(state.pendingEffects,'write');assert.equal(state.active,false);
  assert.throws(()=>f.manager.reconcile('pool',{confirm:true,token:state.reconciliationToken,evidence:{cleanupVerified:true,reference:'evidence'}}),/evidence-required/);
  f.manager.reconcile('pool',{confirm:true,token:state.reconciliationToken,evidence:{cleanupVerified:true,reference:'evidence'},writeOutcome:'verified-not-applied'});
  assert.equal(f.manager.status()[0].blocked,null);assert.equal(f.events.filter(e=>e==='write').length,1);
});

test('orphaned durable state appears in status before any new call',async t=>{
  const f=fixture(t);await f.call('one');
  const recovered=new SessionManager({directory:f.directory,open:async()=>{throw Error('no open');}});
  assert.equal(recovered.status()[0].blocked,'session-exit-unverified');
});

test('disconnect of active lease blocks queued clients and closes its resources',async t=>{
  const f=fixture(t);await f.call('ws',{lease:true});let release;
  const sent=f.call('execute',{operation:{label:'execute',wait:new Promise(resolve=>{release=resolve;})}});
  const waiting=f.call('other',{client:'another'});const results=Promise.allSettled([sent,waiting]);
  f.manager.disconnect('client');release();assert.deepEqual((await results).map(x=>x.status),['rejected','rejected']);
  assert.equal(f.manager.status()[0].active,false);
});

test('new requests wait for idle logout before opening next generation',async t=>{
  let release,opens=0;const closed=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,{open:async()=>{opens++;return {call:async()=>true,close:async()=>{await closed;return {cleanupVerified:true};}};}});
  await f.call('first');f.advance(101);const sweep=f.manager.sweep();const next=f.call('second');
  assert.equal(opens,1);release();await sweep;await next;assert.equal(opens,2);
});
