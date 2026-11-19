'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { createKnowledgeBuildService } = require('./knowledge-build');
const { pickOfflinePackage, readSelection } = require('./offline-framework-actions');
const { createReleaseUpdateService } = require('./release-update');
const { resolveOverlayTarget, createOverlayOpener } = require('./overlay-open');
const { hostHandoff, projectHandoff } = require('./agent-handoff');

function createFrameworkService(root, { pickOffline = pickOfflinePackage, releaseUpdate = createReleaseUpdateService(root) } = {}) {
  const id = crypto.randomUUID();
  const knowledgeBuild = createKnowledgeBuildService(root);
  const overlayOpener = createOverlayOpener();
  const secret = () => crypto.randomBytes(32).toString('hex');
  let bootstrap = secret();
  let cookie, csrf;
  const hasSessionCookie = req => cookie && req.headers.cookie?.split(/;\s*/).includes(cookie);
  let busy = false;
  let initialBinding;
  let preview;
  let overlayPlan, overlayLink, overlay;
  let offlineSelection;
  let observation = {status:root ? 'observing' : 'unbound',observedAt:null};
  function worker(action,expectedRevision,selection,overlaySelection) {
    return new Promise((resolve,reject) => {
      const job = new Worker(path.join(__dirname,'framework-worker.js'),{workerData:{root,action,expectedRevision,
        expectedBinding:initialBinding,offlineSelection:selection,overlaySelection}});
      job.once('message',resolve);
      job.once('error',reject);
      job.once('exit',code => { if (code) reject(Error('worker-exited')); });
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
      if (['standard','overlay-declared'].includes(observation.status) && initialBinding !== observation.binding)
        observation.status = 'binding-changed';
    }
    catch { observation = {status:'unavailable',observedAt:null}; }
  }
  const ready = root ? observe() : Promise.resolve();
  function canApply() {
    return Boolean(preview && preview.revision === observation.revision && preview.binding === observation.binding);
  }
  function offlinePlan() {
    if (!offlineSelection || offlineSelection.revision !== observation.revision || offlineSelection.binding !== observation.binding ||
        offlineSelection.status !== observation.status) return null;
    return { selectionId:offlineSelection.id, revision:offlineSelection.source.release.revision,
      ref:offlineSelection.source.release.ref, install:offlineSelection.status === 'no-framework' };
  }
  const snapshot = () => ({...observation, projectId:id, busy, canApply:canApply(), offline:offlinePlan(), overlay:overlayView(),
    workbenchUpdate: releaseUpdate.available, workbenchRollback: Boolean(releaseUpdate.canRollback)});

  async function overlayRequest(data,reply,refresh) {
    const fields = Object.keys(data).sort().join(',');
    const member = !refresh && fields === 'memberId,overlayPlanId,projectId,revision';
    if ((!member && fields !== 'overlayPlanId,projectId,revision') || !validOverlayId(data.overlayPlanId) ||
      (member && !validOverlayId(data.memberId))) return reply(400,{error:'invalid-action'});
    if (!root || data.projectId !== id) return reply(409,{error:'binding-mismatch'});
    await ready;
    if (!overlayView() || observation.binding !== initialBinding || data.revision !== observation.revision)
      return reply(409,{error:'overlay-target-changed'});
    if (refresh) {
      if (observation.status !== 'overlay-declared' || overlayLink?.id !== data.overlayPlanId)
        return reply(409,{error:'overlay-target-changed'});
      if (busy) return reply(409,{error:'busy'});
      busy = true;
      try {
        const result = receiveOverlay(await worker('overlay-member-refresh',data.revision,undefined,{linkId:overlayLink.id}));
        observation = result.after || observation;
        return reply(result.error ? 409 : 200,{...result,overlay:overlayView()});
      } catch { return reply(503,{error:'worker-failed'}); }
      finally { busy = false; }
    }
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
      const result = await releaseUpdate[data.action](observation);
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
      if (data.action === 'select') {
        const files = await pickOffline();
        if (!files) return reply(200,{cancelled:true,offline:offlinePlan()});
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
      const install = observation.status === 'no-framework';
      const result = receiveOverlay(await worker(install ? 'offline-install' : 'offline-apply',data.revision,source));
      observation = result.after || result.before || observation;
      if (install && result.after?.status === 'standard') initialBinding = result.after.binding;
      preview = undefined;
      return reply(result.error || result.exitCode !== 0 ? 409 : 200,{...result,offline:null,canApply:canApply(),overlay:overlayView()});
    } catch (error) {
      return reply(409,{error:/^offline-[a-z-]+$/.test(error.message) ? error.message : 'offline-request-failed'});
    } finally { busy = false; }
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
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > (route === 'framework/action' ? 40960 : 2048))
        return reply(413,{error:'body-too-large'});
    }
    let data;
    try { data = JSON.parse(body); } catch { return reply(400,{error:'invalid-json'}); }
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
    if (route === 'framework/offline') return offlineRequest(data,reply);
    if (route === 'framework/overlay/open' || route === 'framework/overlay/refresh')
      return overlayRequest(data,reply,route === 'framework/overlay/refresh');
    if (route === 'framework/release-update') return releaseRequest(data,reply);
    if (route === 'framework/agent-handoff') {
      const keys = Object.keys(data).sort().join(',');
      const projectCheck = keys === 'projectId,purpose' && data.purpose === 'project-check';
      if (!projectCheck && (keys !== 'host,projectId' || typeof data.host !== 'string'))
        return reply(400,{error:'invalid-action'});
      if (!root || data.projectId !== id) return reply(409,{error:'binding-mismatch'});
      await ready;
      if (busy) return reply(409,{error:'busy'});
      busy = true;
      try {
        await observe();
        if (initialBinding && observation.binding !== initialBinding) return reply(409,{error:'binding-changed'});
        if (!['standard','overlay-declared','no-framework','partial'].includes(observation.status))
          return reply(409,{error:'handoff-context-invalid'});
        return reply(200,projectCheck ? projectHandoff(root) : hostHandoff(root,data.host));
      } catch (error) {
        return reply(409,{error:['handoff-host-unsupported','handoff-context-invalid'].includes(error.message) ? error.message : 'handoff-unavailable'});
      } finally { busy = false; }
    }
    if (route === 'framework/knowledge-build') {
      const keys = data.action === 'start' ? 'action,planId,projectId,revision' : 'action,projectId,revision';
      if (!['preview','start','status'].includes(data.action) || Object.keys(data).sort().join(',') !== keys)
        return reply(400,{error:'invalid-action'});
      if (!root || data.projectId !== id) return reply(409,{error:'binding-mismatch'});
      if (data.action !== 'status') {
        await ready;
        if (busy) return reply(409,{error:'busy'});
        await observe();
        if (data.revision !== observation.revision) return reply(409,{error:'stale-observation'});
      }
      const result = await knowledgeBuild.handle(data,observation);
      return reply(result.error ? 409 : data.action === 'start' ? 202 : 200,result);
    }
    if (route !== 'framework/action') return reply(404,{error:'unknown-route'});
    const fields = Object.keys(data).sort().join(',');
    const hasOverlaySelection = ['apply','refresh-overlay'].includes(data.action) &&
      fields === 'action,memberIds,overlayPlanId,projectId,revision';
    if ((!hasOverlaySelection && (fields !== 'action,projectId,revision' || data.action === 'refresh-overlay')) ||
      !['refresh','check','preview','install','fetch-preview','apply','refresh-overlay','install-index','remove-index'].includes(data.action) &&
      !require('./project-owner-actions').accepts(data.action)) return reply(400,{error:'invalid-action'});
    if (hasOverlaySelection && (!validOverlayId(data.overlayPlanId) || !Array.isArray(data.memberIds) ||
      !data.memberIds.length || data.memberIds.length > 500 || data.memberIds.some(id => !validOverlayId(id)) ||
      new Set(data.memberIds).size !== data.memberIds.length)) return reply(400,{error:'invalid-action'});
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
      if (data.action === 'apply' && !canApply()) return reply(409,{error:'preview-required'});
      let selection;
      if (hasOverlaySelection) {
        if (observation.status !== 'standard' || !overlayView() || overlayPlan?.id !== data.overlayPlanId)
          return reply(409,{error:'overlay-plan-changed'});
        const readyMembers = new Set(overlayPlan.members.filter(member => member.status === 'ready').map(member => member.id));
        if (data.memberIds.some(id => !readyMembers.has(id))) return reply(409,{error:'overlay-selection-unverified'});
        selection = {plan:overlayPlan,memberIds:data.memberIds};
      }
      if (['fetch-preview','install'].includes(data.action)) preview = undefined;
      if (/^plugin-(install|enable|disable):/.test(data.action)) preview = undefined;
      const result = receiveOverlay(await worker(data.action,data.revision,undefined,selection));
      observation = result.after || result.before || {...observation,status:'needs-refresh'};
      if (data.action === 'install' && result.after?.status === 'standard') initialBinding = result.after.binding;
      if (data.action === 'fetch-preview' && !result.error && result.exitCode === 0) preview = result.after;
      if (data.action === 'apply' && !result.error && result.exitCode === 0) preview = undefined;
      result.canApply = canApply();
      result.overlay = overlayView();
      return reply(result.error ? 409 : 200,result);
    } catch { return reply(503,{error:'worker-failed'}); }
    finally { busy = false; }
  }
  return {handle, bootstrap};
}

const validOverlayId = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

module.exports = {createFrameworkService};
