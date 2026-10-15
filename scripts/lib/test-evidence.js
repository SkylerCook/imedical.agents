"use strict";
const { createHash } = require('node:crypto');

// Capture ancestry while a request is alive; detached frames cannot reconstruct it.
function captureLineage(frame) {
  const ancestors = [], seen = new Set();
  try {
    while (frame) {
      if (seen.has(frame)) return { ancestors, complete: false };
      seen.add(frame); ancestors.push(frame);
      frame = frame.parentFrame();
    }
    return { ancestors, complete: true };
  } catch { return { ancestors, complete: false }; }
}
function classifyLineage(lineage, target) {
  if (!target) return 'frame-lineage-unverified';
  const depth = lineage.ancestors.indexOf(target);
  if (depth >= 0) return depth === 0 ? 'case-frame' : 'case-descendant-frame';
  return lineage.complete ? 'context-frame' : 'frame-lineage-unverified';
}

// A browser adapter supplies the event source; no browser package or process is created.
function createRequestCollector(source, { early = false, resourceKey = () => null } = {}) {
  const requests = new WeakMap(), records = [], pendingBodies = new Set();
  let target, phase = 'prepare', stopped = false;
  function request(req) {
    if (requests.has(req)) return;
    let lineage;
    try { lineage = captureLineage(req.frame()); } catch { lineage = { ancestors: [], complete: false }; }
    let resource = null, resourceType = null;
    try { resource = resourceKey(req); resourceType = req.resourceType(); } catch { /* No version proof without request type. */ }
    const item = { lineage, phase, observedAt: new Date().toISOString(), resource, resourceType, status: null, sha256: null, failed: false };
    requests.set(req, item); records.push(item);
  }
  function response(res) {
    const req = res.request();
    if (!requests.has(req)) { request(req); requests.get(req).late = true; }
    const item = requests.get(req);
    item.status = res.status();
    if (item.resource) {
      const work = Promise.resolve().then(() => res.body()).then(body => {
        item.sha256 = createHash('sha256').update(body).digest('hex');
      }, () => { item.bodyUnavailable = true; }).finally(() => pendingBodies.delete(work));
      pendingBodies.add(work);
    }
  }
  function failed(req) {
    if (!requests.has(req)) { request(req); requests.get(req).late = true; }
    const item = requests.get(req);
    item.failed = true; item.failedAt = new Date().toISOString(); item.failedPhase = phase;
    let code;
    try { code = req.failure()?.errorText; } catch { /* Preserve unknown failure without raw transport text. */ }
    item.failureCode = /^net::[A-Z_]+$/.test(code || '') ? code : 'unknown';
  }
  const handlers = { request, response, requestfailed: failed };
  for (const [event, listener] of Object.entries(handlers)) source.on(event, listener);
  function snapshot() {
    return records.map(({ lineage, ...record }) => ({ ...record, ownership: classifyLineage(lineage, target) }));
  }
  function loaded(resource, sha256) {
    const matching = snapshot().filter(r => r.resource === resource && r.ownership === 'case-frame');
    const last = matching.at(-1);
    return Boolean(early && last && ['script', 'stylesheet', 'document'].includes(last.resourceType) && !last.late && !last.failed && last.status === 200 && last.sha256 === sha256);
  }
  async function stop({ timeoutMs = 10000 } = {}) {
    if (!stopped) { for (const [event, listener] of Object.entries(handlers)) source.off(event, listener); stopped = true; }
    let timer;
    await Promise.race([Promise.all([...pendingBodies]), new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
    clearTimeout(timer);
    return { events: snapshot(), cleanupVerified: pendingBodies.size === 0, pendingBodies: pendingBodies.size };
  }
  return { setTarget(value) { target = value; }, setPhase(value) { phase = value; }, snapshot, loaded, stop };
}

async function runTestCase({ demandId, caseId, scope, version, adapter, session, now = Date.now }) {
  if (!caseId || !scope || !version || !adapter) throw new Error('Case, scope, version and adapter required');
  for (const name of ['prepare', 'verifyVersion', 'execute', 'assert', 'sideEffects', 'close']) {
    if (typeof adapter[name] !== 'function') throw new Error(`Missing test adapter: ${name}`);
  }
  const frozenVersion = structuredClone(version);
  const result = { schema: 'imedical-test-result/v1', demandId, caseId, scope: structuredClone(scope), version: structuredClone(frozenVersion), startedAt: new Date(now()).toISOString(), status: 'review-pending', assertions: [], evidenceRefs: [], untested: [], failureCategory: null, durations: {}, cleanup: { verified: false } };
  async function step(name, fn) { const start = now(); try { return await fn(); } finally { result.durations[name] = now() - start; } }
  try {
    if (session && !await session.ensureReady()) { result.failureCategory = 'authentication'; return result; }
    if (await step('prepare', adapter.prepare) !== true) { result.failureCategory = 'environment'; return result; }
    if (await step('versionBefore', () => adapter.verifyVersion(structuredClone(frozenVersion))) !== true) { result.failureCategory = 'version'; return result; }
    // No automatic replay: a thrown/unknown write outcome must be independently reconciled.
    await step('execute', adapter.execute);
    const assertions = await step('assert', adapter.assert);
    if (!Array.isArray(assertions) || !assertions.length) throw new Error('No assertions');
    result.assertions = assertions.map(a => ({ id: a.id, passed: a.passed === true, evidenceRefs: Array.isArray(a.evidenceRefs) ? a.evidenceRefs : [] }));
    result.evidenceRefs = [...new Set(result.assertions.flatMap(a => a.evidenceRefs))];
    const effects = await step('sideEffects', adapter.sideEffects);
    const unchanged = await step('versionAfter', () => adapter.verifyVersion(structuredClone(frozenVersion)));
    if (unchanged !== true) result.failureCategory = 'version';
    else if (result.assertions.some(a => !a.passed)) { result.status = 'failed'; result.failureCategory = 'business'; }
    else if (effects !== true || result.assertions.some(a => !a.evidenceRefs.length)) result.failureCategory = 'evidence';
    else result.status = 'passed';
  } catch {
    result.failureCategory = 'execution-unknown';
    result.untested.push('Reconcile operation outcome before retry; adapter retains protected raw evidence.');
  } finally {
    try { result.cleanup.verified = await step('close', adapter.close) === true; } catch { result.cleanup.verified = false; }
    if (!result.cleanup.verified) { result.status = 'review-pending'; result.failureCategory ||= 'cleanup'; }
    result.finishedAt = new Date(now()).toISOString();
  }
  return result;
}
module.exports = { captureLineage, classifyLineage, createRequestCollector, runTestCase };
