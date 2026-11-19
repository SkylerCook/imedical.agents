'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

function createFrameworkService(root) {
  const id = crypto.randomUUID();
  const secret = () => crypto.randomBytes(32).toString('hex');
  let bootstrap = secret();
  let cookie, csrf;
  let busy = false;
  let initialBinding;
  let observation = {status:root ? 'observing' : 'unbound',observedAt:null};
  function worker(action,expectedRevision) {
    return new Promise((resolve,reject) => {
      const job = new Worker(path.join(__dirname,'framework-worker.js'),{workerData:{root,action,expectedRevision,expectedBinding:initialBinding}});
      job.once('message',resolve);
      job.once('error',reject);
      job.once('exit',code => { if (code) reject(Error('worker-exited')); });
    });
  }
  async function observe() {
    try {
      observation = await worker('observe');
      if (initialBinding === undefined && observation.status === 'standard') initialBinding = observation.binding;
      if (observation.status === 'standard' && initialBinding !== observation.binding) observation.status = 'binding-changed';
    }
    catch { observation = {status:'unavailable',observedAt:null}; }
  }
  const ready = root ? observe() : Promise.resolve();
  const snapshot = () => ({...observation, projectId:id, busy});
  async function handle(req,res,route,origin) {
    const reply = (code,data) => {
      res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
    };
    if ('http://' + req.headers.host !== origin || req.headers['x-workbench-request'] !== '1' ||
      (req.headers.origin && req.headers.origin !== origin) ||
      ['none','cross-site'].includes(req.headers['sec-fetch-site'])) return reply(403,{error:'origin-denied'});
    if (route === 'framework.json' && ['GET','HEAD'].includes(req.method)) return reply(200,snapshot());
    if (req.method !== 'POST') return reply(405,{error:'method-denied'});
    if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return reply(403,{error:'origin-denied'});
    const exchange = route === 'framework/session';
    if (!exchange && (!cookie || !req.headers.cookie?.split(/;\s*/).includes('wb=' + cookie) ||
      req.headers['x-workbench-csrf'] !== csrf)) return reply(403,{error:'session-required'});
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 2048) return reply(413,{error:'body-too-large'});
    }
    let data;
    try { data = JSON.parse(body); } catch { return reply(400,{error:'invalid-json'}); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return reply(400,{error:'invalid-body'});
    if (exchange) {
      if (Object.keys(data).length === 0 && cookie && req.headers.cookie?.split(/;\s*/).includes('wb=' + cookie)) return reply(200,{csrf});
      if (!bootstrap || Object.keys(data).length !== 1 || data.token !== bootstrap) return reply(403,{error:'invalid-token'});
      bootstrap = null;
      cookie = secret(); csrf = secret();
      res.setHeader('Set-Cookie','wb=' + cookie + '; HttpOnly; SameSite=Strict; Path=/framework/');
      return reply(200,{csrf});
    }
    if (route !== 'framework/action') return reply(404,{error:'unknown-route'});
    if (Object.keys(data).sort().join(',') !== 'action,projectId,revision' ||
      !['refresh','check','preview'].includes(data.action)) return reply(400,{error:'invalid-action'});
    if (!root || data.projectId !== id) return reply(409,{error:'binding-mismatch'});
    await ready;
    if (busy) return reply(409,{error:'busy'});
    busy = true;
    try {
      if (data.action === 'refresh') {
        await observe();
        return reply(200,{...snapshot(),busy:false});
      }
      if (data.revision !== observation.revision) return reply(409,{error:'stale-observation'});
      const result = await worker(data.action,data.revision);
      observation = result.after || result.before || {...observation,status:'needs-refresh'};
      return reply(result.error ? 409 : 200,result);
    } catch { return reply(503,{error:'worker-failed'}); }
    finally { busy = false; }
  }
  return {handle, bootstrap};
}

module.exports = {createFrameworkService};
