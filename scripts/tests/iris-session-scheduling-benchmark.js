'use strict';
// Source-only, loopback measurement. No hospital connection or business data.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {performance} = require('node:perf_hooks');
const {SessionManager} = require('../lib/iris-session-manager');
const remote = require('../lib/iris-remote-operations');
const {createAtelierClient} = require('../lib/atelier-client');
const {createTempDirectory, ownsTempDirectory} = require('./fixtures/temp-directory');

async function measure(pattern, fault) {
  const root = createTempDirectory('iris-scheduling-');
  const counts = {authentication:0, logout:0, requests:0, failures:0, lockConflicts:0, manualInterventions:0};
  const waits = [];
  const server = http.createServer((req, res) => {
    if (req.headers.authorization) counts.authentication++;
    if (req.method === 'HEAD') {counts.logout++;res.end();return;}
    counts.requests++;
    if (fault && counts.requests === 6) {req.socket.destroy();return;}
    res.setHeader('Set-Cookie', 'CSPSESSIONID=loopback; Path=/');
    setTimeout(() => res.end(JSON.stringify({result:{content:['ok']}})), 10);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const connection = {protocol:'http:',hostname:'127.0.0.1',port:server.address().port,path:'/api/atelier/v1/TEST/',auth:'synthetic:synthetic'};
  const policy = {enabled:true,coordinationRoot:path.join(root,'admission'),poolKey:'synthetic'};
  const manager = new SessionManager({directory:path.join(root,'pools'),open:async op => {
    const owner = remote.createRemoteOperation({policy,connection,channel:op.channel});
    owner.acquire();
    const client = createAtelierClient({connection,owner,managedHost:true});
    return {call:async () => client.request('GET','doc/Demo.cls'),
      close:async()=>owner.close(await client.close())};
  }});
  const drain=manager.drain.bind(manager);
  manager.drain=pool=>{
    if(!pool.running && pool.queue.length) waits.push(performance.now()-pool.queue[0].operation.enqueuedAt);
    return drain(pool);
  };
  const started = performance.now();
  const submit = async channel => {
    try {await manager.submit({pool:'shared',identity:channel,client:'benchmark',operation:{effects:'read-only',channel,enqueuedAt:performance.now()}});}
    catch {counts.failures++;}
  };
  try {
    if (pattern === 'queued') await Promise.all(Array.from({length:12},()=>submit('mcp')));
    else for (let i=0;i<12;i++) await submit(pattern === 'alternating' ? i%2 ? 'atelier':'mcp' : pattern === 'grouped' && i>=6 ? 'atelier':'mcp');
    if (pattern === 'standalone-contention') {
      const standalone = remote.createRemoteOperation({policy,connection,channel:'atelier-read-batch'});
      try {await standalone.run({},async()=>{});} catch (error) {if(error.code!=='remote-pool-busy-or-unresolved')throw error;counts.lockConflicts++;}
      // Existing independent batches cannot join the daemon queue. An explicit
      // close is the present recovery action, counted here rather than hidden.
      counts.manualInterventions++;
      await manager.close('shared','benchmark');
      await standalone.run({},async()=>{});
      standalone.close({localResourcesClosed:true,cleanupVerified:true});
    }
    await manager.close('shared','benchmark');
    return {pattern,fault:!!fault,...counts,totalMs:Math.round(performance.now()-started),
      queueWaitTotalMs:Math.round(waits.reduce((a,b)=>a+b,0)),queueWaitMaxMs:Math.round(Math.max(...waits))};
  } finally {
    await manager.stop();
    await new Promise(resolve=>server.close(resolve));
    if (ownsTempDirectory(root)) fs.rmSync(root,{recursive:true});
  }
}
async function main() {
  if (process.argv[2] === '--project-root' && process.argv.length === 4) {
    console.log(JSON.stringify(await pilot(path.resolve(process.argv[3])),null,2));
    return;
  }
  const results=[];
  for (const fault of [false,true]) for (const pattern of ['same-channel','alternating','grouped','queued','standalone-contention']) results.push(await measure(pattern,fault));
  console.log(JSON.stringify({environment:'loopback HTTP, 10ms response delay, both channel backends simulated with Atelier',node:process.version,platform:process.platform,results},null,2));
}
async function pilot(projectRoot) {
  const backends=require('../lib/iris-session-backends');
  const ipc=require('../lib/iris-session-ipc');
  const d=backends.describe(projectRoot);
  const admission=remote.poolStatus({policy:d.policy});
  if(admission.ownerPresent || admission.unresolvedWrites.length || admission.localExitUnverified) throw Error('pilot-existing-work-or-risk');
  // Use the ordinary persistent host location so linked risk files remain valid.
  // serve refuses an existing live host. No other process or pool is terminated.
  const host=await require('../iris-session-host').serve();
  let client;
  const results=[];
  try {
    client=await ipc.connect({start:false});
    const call=async channel=>{
      const started=performance.now();
      const params=channel==='mcp' ? {projectRoot,method:'tools/call',params:{name:'iris_query',arguments:{query:'SELECT 1 AS ProbeValue',mode:'read'}}} :
        {projectRoot,channel:'atelier',connection:{...d.connection,path:'/api/atelier/v1/'+encodeURIComponent(d.env.IRIS_NAMESPACE)+'/',
          auth:d.connection.username+':'+d.connection.password},args:['GET','',undefined,{}, {serverInfo:true}]};
      try {
        const response=await client.request('call',params);
        if(response.error || response.result?.isError) throw Object.assign(Error('pilot-tool-failed'),{code:'pilot-tool-failed'});
        results.push({channel,status:'passed',elapsedMs:Math.round(performance.now()-started),generation:host.manager.pool(d.pool).generation});
      } catch(error) {results.push({channel,status:'failed',...require('../lib/iris-operation-scope').failureDetails(error)});throw error;}
    };
    for(let i=0;i<3;i++)await call('mcp');
    try {
      await client.request('call',{projectRoot,method:'tools/call',params:{name:'iris_query',arguments:{query:'SELECT',mode:'read'}}});
      throw Object.assign(Error('pilot-expected-read-error'),{code:'pilot-expected-read-error'});
    } catch(error) {
      if(error.code==='pilot-expected-read-error')throw error;
      results.push({channel:'mcp',scenario:'invalid-read-query',status:'expected-failure',...require('../lib/iris-operation-scope').failureDetails(error)});
      if(host.manager.pool(d.pool).unresolvedWrites.length)throw Error('pilot-read-created-write-risk');
    }
    await call('mcp');
    await call('mcp');
    for(const channel of ['atelier','mcp','atelier','mcp'])await call(channel);
    const closed=await client.request('close',{projectRoot});
    return {environment:'authorized read-only pilot',node:process.version,results,exit:closed.exit,
      warning:closed.warning,blockingReasons:closed.blockingReasons,nextAction:closed.nextAction,
      licenseReleaseVerified:false,serverSessionGoneVerified:false};
  } finally {client?.close();await host.stop();}
}
if(require.main===module) main().catch(error=>{console.error(error.code || error.name);process.exitCode=1;});
module.exports={measure,pilot};
