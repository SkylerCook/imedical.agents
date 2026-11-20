'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { createKnowledgeBuildService } = require('./knowledge-build');
const { pickOfflinePackage, readSelection } = require('./offline-framework-actions');
const { createReleaseUpdateService } = require('./release-update');
const { resolveOverlayTarget, createOverlayOpener } = require('./overlay-open');
const { hostHandoff, projectHandoff, taskHandoff, updateHandoff } = require('./agent-handoff');
const projectConfig = require('../../ai-dev-offline/configure-project');

const recoveryErrors = new Set(['project-recovery-not-available','project-recovery-conflict','unsupported-project','binding-changed','stale-observation']);
const boundDeploymentStatuses = ['standard','partial','invalid-head','unknown-source'];
const updateNoteStatuses = [...boundDeploymentStatuses,'overlay-declared','invalid-declaration'];

function createFrameworkService(root, { pickOffline = pickOfflinePackage, releaseUpdate = createReleaseUpdateService(root), readUpdateHead, writeSettings, manualSource, pluginEntry, watchPage } = {}) {
  const id = crypto.randomUUID();
  const pickerLifetime = new AbortController();
  const knowledgeBuild = createKnowledgeBuildService(root);
  const overlayOpener = createOverlayOpener();
  const secret = () => crypto.randomBytes(32).toString('hex');
  const recoveryKey = crypto.randomBytes(32);
  const signRecovery = fingerprint => crypto.createHmac('sha256',recoveryKey).update(fingerprint).digest('hex');
  let bootstrap = secret();
  let cookie, csrf;
  const hasSessionCookie = req => cookie && req.headers.cookie?.split(/;\s*/).includes(cookie);
  let busy = false;
  let initialBinding;
  let overlayPlan, overlayLink, overlay;
  let offlineSelection;
  let observation = {status:root ? 'observing' : 'unbound',observedAt:null};
  function worker(action,expectedRevision,selection,overlaySelection) {
    return new Promise((resolve,reject) => {
      const job = new Worker(path.join(__dirname,'framework-worker.js'),{workerData:{root,action,expectedRevision,
        expectedBinding:initialBinding,offlineSelection:selection,overlaySelection}});
      job.once('message',resolve);
      job.once('error',reject);
      job.once('exit',() => reject(Error('worker-exited')));
    });
  }
  function receiveOverlay({overlayPlan:plan,overlayLink:link,overlay:view,...result}) {
    const state = result.after || result.before || result;
    if (view || (state.status && state.status !== observation.status) ||
        (state.revision && state.revision !== observation.revision)) {
      overlay = view;
      overlayPlan = plan;
      overlayLink = link;
    }
    return result;
  }
  function overlayView() {
    if (!['standard','overlay-declared'].includes(observation.status)) return undefined;
    return !overlayPlan || (overlayPlan.root.binding === observation.binding && overlayPlan.root.revision === observation.revision)
      ? overlay : undefined;
  }
  async function observe() {
    try {
      observation = receiveOverlay(await worker('observe'));
      if (initialBinding === undefined && observation.binding) initialBinding = observation.binding;
      if (updateNoteStatuses.includes(observation.status) && initialBinding !== observation.binding)
        observation.status = 'binding-changed';
    }
    catch { observation = {status:'unavailable',observedAt:null}; }
  }
  const ready = root ? observe() : Promise.resolve();
  function offlinePlan() {
    if (!offlineSelection || offlineSelection.revision !== observation.revision || offlineSelection.binding !== observation.binding ||
        offlineSelection.status !== observation.status) return null;
    return { selectionId:offlineSelection.id, revision:offlineSelection.source.release.revision,
      ref:offlineSelection.source.release.ref, install:offlineSelection.status === 'no-framework' };
  }
  const snapshot = () => ({...observation, projectId:id, busy, offline:offlinePlan(), overlay:overlayView(),
    workbenchUpdate: releaseUpdate.available, workbenchRollback: Boolean(releaseUpdate.canRollback)});

  async function overlayRequest(data,reply) {
    const fields = Object.keys(data).sort().join(',');
    const member = fields === 'memberId,overlayPlanId,projectId,revision';
    if ((!member && fields !== 'overlayPlanId,projectId,revision') || !validOverlayId(data.overlayPlanId) ||
      (member && !validOverlayId(data.memberId))) return reply(400,{error:'invalid-action'});
    if (!root || data.projectId !== id) return reply(409,{error:'binding-mismatch'});
    await ready;
    if (!overlayView() || observation.binding !== initialBinding || data.revision !== observation.revision)
      return reply(409,{error:'overlay-target-changed'});
    const currentTarget = () => {
      try { return resolveOverlayTarget(root,overlayPlan,overlayLink,data); }
      catch { return null; }
    };
    const target = currentTarget();
    if (!target) return reply(409,{error:'overlay-target-changed'});
    try {
      const result = await overlayOpener.open(target,() => Boolean(currentTarget()));
      return reply(200,result);
    } catch (error) {
      const code = ['overlay-target-changed','overlay-startup-timeout'].includes(error.message) ? error.message : 'overlay-startup-failed';
      return reply(409,{error:code});
    }
  }

  async function releaseRequest(data, reply) {
    if (!['open','rollback'].includes(data.action) || Object.keys(data).sort().join(',') !== 'action,projectId,revision')
      return reply(400, {error:'invalid-action'});
    if (!root || data.projectId !== id) return reply(409, {error:'binding-mismatch'});
    if (!releaseUpdate.available) return reply(409, {error:'release-update-unavailable'});
    await ready;
    if (busy) return reply(409, {error:'busy'});
    busy = true;
    try {
      await observe();
      if (data.revision !== observation.revision) return reply(409, {error:'stale-observation'});
      if (initialBinding && initialBinding !== observation.binding) return reply(409, {error:'binding-changed'});
      const { run } = await knowledgeBuild.handle({action:'status'}, observation);
      if (run?.status === 'running') return reply(409, {error:'knowledge-build-busy'});
      const result = data.action === 'open' ? await releaseUpdate.open(observation, {signal:pickerLifetime.signal}) :
        await releaseUpdate.rollback(observation);
      return reply(result.error ? 409 : 200, result.cancelled ? result : { ...result, canRollback: Boolean(releaseUpdate.canRollback) });
    } catch { return reply(409, {error:'release-update-failed'}); }
    finally { busy = false; }
  }

  async function offlineRequest(data, reply) {
    const fields = data.action === 'apply' ? 'action,projectId,revision,selectionId' : 'action,projectId,revision';
    if (!['select','apply'].includes(data.action) || Object.keys(data).sort().join(',') !== fields) return reply(400,{error:'invalid-action'});
    if (!root || data.projectId !== id) return reply(409,{error:'binding-mismatch'});
    await ready;
    if (busy) return reply(409,{error:'busy'});
    busy = true;
    try {
      await observe();
      if (!['standard', 'no-framework'].includes(observation.status) || observation.binding !== initialBinding)
        return reply(409,{error:'unsupported-project'});
      if (data.revision !== observation.revision) return reply(409,{error:'stale-observation'});
      if (observation.status === 'standard') return reply(409,{error:'framework-update-use-agent'});
      if (data.action === 'select') {
        const files = await pickOffline({signal:pickerLifetime.signal});
        if (!files || pickerLifetime.signal.aborted) return reply(200,{cancelled:true,offline:offlinePlan()});
        offlineSelection = undefined;
        const source = readSelection(files);
        const result = await worker('offline-preview',data.revision,source);
        if (result.error || result.exitCode !== 0) return reply(409,{...result,offline:null});
        observation = result.after;
        offlineSelection = { id:crypto.randomUUID(), files, source, revision:observation.revision,
          binding:observation.binding, status:observation.status };
        return reply(200,{...result,offline:offlinePlan()});
      }
      if (!offlinePlan() || data.selectionId !== offlineSelection.id) return reply(409,{error:'offline-preview-required'});
      const selected = offlineSelection;
      offlineSelection = undefined;
      const source = readSelection(selected.files);
      if (JSON.stringify(source) !== JSON.stringify(selected.source)) return reply(409,{error:'offline-selection-stale'});
      const result = receiveOverlay(await worker('offline-install',data.revision,source));
      observation = result.after || result.before || observation;
      if (boundDeploymentStatuses.includes(result.after?.status)) initialBinding = result.after.binding;
      return reply(result.error || result.exitCode !== 0 ? 409 : 200,{...result,offline:null,overlay:overlayView()});
    } catch (error) {
      return reply(409,{error:/^offline-[a-z-]+$/.test(error.message) ? error.message : 'offline-request-failed'});
    } finally { busy = false; }
  }
  async function updateNoteRequest(data,reply) {
    if (Object.keys(data).sort().join(',') !== 'projectId,revision') return reply(400,{error:'invalid-action'});
    if (!root || data.projectId !== id) return reply(409,{error:'binding-mismatch'});
    await ready;
    if (busy) return reply(409,{error:'busy'});
    try {
      const start = await worker('observe');
      if (!updateNoteStatuses.includes(start.status)) return reply(409,{error:'unsupported-project'});
      if (start.binding !== initialBinding) return reply(409,{error:'binding-changed'});
      if (start.revision !== data.revision) return reply(409,{error:'stale-observation'});
      const note = await updateHandoff(root,start,start.overlayPlan,start.overlayLink,readUpdateHead);
      const end = await worker('observe');
      if (busy || start.status !== end.status || start.binding !== end.binding || start.revision !== end.revision ||
          start.overlayPlan?.id !== end.overlayPlan?.id || start.overlayLink?.id !== end.overlayLink?.id)
        return reply(409,{error:'binding-changed'});
      return reply(200,note);
    } catch { return reply(503,{error:'worker-failed'}); }
  }

  async function recoverProjectConfig(data,reply) {
    const verify = data.intent === 'verify';
    const undo = data.intent === 'rollback';
    const fields = verify || undo ? 'intent,projectId,receiptId,recoveryToken,revision' : 'projectId,receiptId,recoveryToken,revision';
    if (Object.keys(data).sort().join(',') !== fields ||
        !projectConfig.validReceiptId(data.receiptId) || typeof data.recoveryToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.recoveryToken))
      return reply(400,{error:'invalid-action'});
    if (!root || data.projectId !== id) return reply(409,{error:'binding-mismatch'});
    if (process.platform !== 'win32') return reply(409,{error:'project-recovery-unavailable'});
    await ready;
    if (busy) return reply(409,{error:'busy'});
    busy = true;
    async function assertBinding() {
      await observe();
      let code;
      if (!initialBinding || observation.binding !== initialBinding || observation.status === 'binding-changed') code = 'binding-changed';
      else if (!['standard','overlay-declared','no-framework'].includes(observation.status)) code = 'unsupported-project';
      else if (data.revision !== observation.revision) code = 'stale-observation';
      if (code) throw Object.assign(new Error(code), {code});
    }
    try {
      await assertBinding();
      const received = Buffer.from(data.recoveryToken,'hex');
      const confirmRecovery = fingerprint => crypto.timingSafeEqual(received,Buffer.from(signRecovery(fingerprint),'hex'));
      const restored = await projectConfig.recoverInterrupted({projectRoot:root,receiptId:data.receiptId},
        {beforeRestore:assertBinding,confirmRecovery,verify,undo});
      return reply(200,restored);
    } catch (error) {
      return reply(409,{error:recoveryErrors.has(error.code) ? error.code : 'project-recovery-unavailable'});
    } finally { busy = false; }
  }

  async function exportStateRequest(data,reply) {
    if (Object.keys(data).sort().join(',') !== 'projectId,revision' || (data.revision !== null &&
        (typeof data.revision !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(data.revision))))
      return reply(400,{error:'invalid-action'});
    if (!root || data.projectId !== id) return reply(409,{error:'binding-mismatch'});
    await ready;
    if (busy) return reply(409,{error:'busy'});
    busy = true;
    try {
      const shared = overlayLink?.root;
      const result = await worker('export-state',data.revision,undefined,
        shared && {binding:shared.binding,revision:shared.revision});
      return reply(result.error ? 409 : 200,result);
    } catch { return reply(503,{error:'worker-failed'}); }
    finally { busy = false; }
  }

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
    if (!exchange && (!hasSessionCookie(req) ||
      req.headers['x-workbench-csrf'] !== csrf)) return reply(403,{error:'session-required'});
    const settingsPrefix = 'framework/settings/';
    const isSettings = route.startsWith(settingsPrefix) && typeof writeSettings === 'function';
    const bodyLimit = route === 'framework/action' ? 40960 : isSettings ? 32768 : 2048;
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > bodyLimit) return reply(413,{error:'body-too-large'});
      chunks.push(chunk);
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400,{error:'invalid-json'}); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return reply(400,{error:'invalid-body'});
    if (exchange) {
      if (Object.keys(data).length === 0 && hasSessionCookie(req)) return reply(200,{csrf});
      if (!bootstrap || Object.keys(data).length !== 1 || data.token !== bootstrap) return reply(403,{error:'invalid-token'});
      bootstrap = null;
      // Browser cookies share a host across ports. Each bound workbench owns its cookie.
      cookie = `wb-${id}=${secret()}`; csrf = secret();
      res.setHeader('Set-Cookie',cookie + '; HttpOnly; SameSite=Strict; Path=/framework/');
      return reply(200,{csrf});
    }
    if (route === 'framework/page-presence' && watchPage) {
      if (Object.keys(data).length) return reply(400,{error:'invalid-body'});
      return watchPage(res);
    }
    if (isSettings) return writeSettings(route.slice(settingsPrefix.length), data, reply);
    if (route === 'framework/offline') return offlineRequest(data,reply);
    if (route === 'framework/overlay/open') return overlayRequest(data,reply);
    if (route === 'framework/overlay/refresh')
      return reply(409,{error:'framework-update-use-agent'});
    if (route === 'framework/release-update') return releaseRequest(data,reply);
    if (route === 'framework/update-note') return updateNoteRequest(data,reply);
    if (route === 'framework/recover-project-config') return recoverProjectConfig(data,reply);
    if (route === 'framework/export-state') return exportStateRequest(data,reply);
    if (route === 'framework/agent-handoff') {
      const keys = Object.keys(data).sort().join(',');
      const projectCheck = keys === 'projectId,purpose' && data.purpose === 'project-check';
      const taskRequest = ['projectId,purpose,task','item,projectId,purpose,task'].includes(keys) &&
        data.purpose === 'task' && typeof data.task === 'string';
      if (!taskRequest && !projectCheck && (keys !== 'host,projectId' || typeof data.host !== 'string'))
        return reply(400,{error:'invalid-action'});
      if (!root || data.projectId !== id) return reply(409,{error:'binding-mismatch'});
      await ready;
      if (busy) return reply(409,{error:'busy'});
      busy = true;
      try {
        await observe();
        if (initialBinding && observation.binding !== initialBinding) return reply(409,{error:'binding-changed'});
        if (taskRequest) {
          if (!initialBinding) return reply(409,{error:'handoff-context-invalid'});
          return reply(200,taskHandoff(root,observation.status,data,{manualSource,pluginEntry}));
        }
        if (!['standard','overlay-declared','no-framework','partial'].includes(observation.status))
          return reply(409,{error:'handoff-context-invalid'});
        return reply(200,projectCheck ? projectHandoff(root) : hostHandoff(root,data.host));
      } catch (error) {
        if (error.message === 'invalid-action') return reply(400,{error:'invalid-action'});
        return reply(409,{error:['handoff-host-unsupported','handoff-context-invalid'].includes(error.message) ? error.message : 'handoff-unavailable'});
      } finally { busy = false; }
    }
    if (route === 'framework/knowledge-build') {
      const stop = data.action === 'stop';
      const keys = data.action === 'start' ? 'action,planId,projectId,revision' :
        stop ? 'action,projectId,revision,runId' : 'action,projectId,revision';
      if (!['preview','start','status','stop'].includes(data.action) || Object.keys(data).sort().join(',') !== keys ||
          (stop && (typeof data.runId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(data.runId))))
        return reply(400,{error:'invalid-action'});
      if (!root || data.projectId !== id) return reply(409,{error:'binding-mismatch'});
      if (data.action !== 'status' && !stop) {
        await ready;
        if (busy) return reply(409,{error:'busy'});
        await observe();
        if (data.revision !== observation.revision) return reply(409,{error:'stale-observation'});
      }
      const result = await knowledgeBuild.handle(data,observation);
      return reply(result.error ? 409 : data.action === 'start' ? 202 : 200,result);
    }
    if (route !== 'framework/action') return reply(404,{error:'unknown-route'});
    if (['fetch-preview','apply','refresh-overlay'].includes(data.action))
      return reply(409,{error:'framework-update-use-agent'});
    const fields = Object.keys(data).sort().join(',');
    if (fields !== 'action,projectId,revision' ||
      (!['refresh','check','preview','install','install-index','remove-index'].includes(data.action) &&
        !require('./project-owner-actions').accepts(data.action))) return reply(400,{error:'invalid-action'});
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
      const result = receiveOverlay(await worker(data.action,data.revision));
      observation = result.after || result.before || {...observation,status:'needs-refresh'};
      if (data.action === 'install' && boundDeploymentStatuses.includes(result.after?.status)) initialBinding = result.after.binding;
      result.overlay = overlayView();
      return reply(result.error ? 409 : 200,result);
    } catch { return reply(503,{error:'worker-failed'}); }
    finally { busy = false; }
  }
  function shutdown() {
    pickerLifetime.abort();
    return knowledgeBuild.shutdown();
  }
  return {handle, bootstrap, signRecovery, shutdown};
}

const validOverlayId = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

module.exports = {createFrameworkService};
