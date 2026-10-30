'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createTempDirectory,ownsTempDirectory}=require('./fixtures/temp-directory');
const {serve}=require('../iris-session-host');
const {connect}=require('../lib/iris-session-ipc');
test('two independent IPC clients share a backend; only opaque metadata persists',async t=>{
  const root=createTempDirectory('iris-session-ipc-');let opened=0,calls=0,closed=0;
  const host=await serve({root,describe:p=>({...p,pool:'same-instance',identity:'same-user'}),
    open:async()=>{opened++;return {call:async()=>({number:++calls}),close:async()=>{closed++;return {cleanupVerified:true};}};}});
  const a=await connect({root,start:false}),b=await connect({root,start:false});
  t.after(async()=>{a.close();b.close();await host.stop();if(ownsTempDirectory(root))fs.rmSync(root,{recursive:true});});
  assert.deepEqual(await a.request('call',{sensitive:'not-for-disk'}),{number:1});
  assert.deepEqual(await b.request('call',{}),{number:2});assert.equal(opened,1);
  const status=await a.request('status');assert.equal(status.pools[0].completed,2);
  const persisted=fs.readdirSync(root+'/pools').map(f=>fs.readFileSync(root+'/pools/'+f,'utf8')).join('');
  assert.equal(persisted.includes('not-for-disk'),false);
  a.close();b.close();await host.stop();assert.equal(closed,1);
});
