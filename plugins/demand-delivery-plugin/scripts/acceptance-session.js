'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SCHEMA = 'demand-acceptance-session/v1';
const HIERARCHY_SCHEMA = 'demand-acceptance-session/v2';
const { hasBindings, normalizeBindings } = require('../../../scripts/lib/demand-code-binding');
const { verifyRealCommits } = require('../../../scripts/lib/real-repository-commit');
const ACTIONS = ['commit', 'bos-log', 'push'];
const PHASES = ['commit', 'bos', 'push'];
const now = () => new Date().toISOString();
const fail = message => { throw new Error(message); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) fail(`${name} is required`);
  return value.trim();
}
function id(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) fail('Demand ID number must be a safe integer; use a string');
  const result = String(value).trim();
  if (!/^[0-9]{1,32}$/.test(result)) fail('Demand ID must contain digits only');
  return result;
}
function idsCsv(values) {
  return [...new Set(values.map(id))].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : a.localeCompare(b)).join(',');
}
function canonical(value) {
  let current = path.resolve(value), suffix = [];
  while (!fs.existsSync(current)) {
    suffix.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) fail('Cannot resolve path');
    current = parent;
  }
  const result = path.join(fs.realpathSync.native(current), ...suffix);
  return process.platform === 'win32' ? result.toLowerCase() : result;
}
function assertDirectory(directory, projectRoot) {
  const relative = path.relative(canonical(projectRoot), canonical(directory));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) ||
      relative.split(path.sep).some(part => ['.git', '.agents', 'node_modules'].includes(part))) {
    fail('Session directory must stay inside the target project, outside capability/Git directories');
  }
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function writeAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function load(directory) {
  const state = json(path.join(directory, 'session.json'));
  if (![SCHEMA, HIERARCHY_SCHEMA].includes(state.schema)) fail('Unsupported session schema');
  if (state.schema === HIERARCHY_SCHEMA) normalizeBindings(state.demands, { idField: 'id', parentField: 'parentId' });
  else if (hasBindings(state.demands, 'parentId')) fail('Legacy session cannot acquire hierarchy without a new scoped session');
  assertDirectory(directory, state.projectRoot);
  const observedScope = { projectRoot: state.projectRoot, deliveryActions: state.scope.deliveryActions, demands: state.demands.map(item => scopeItem(item, state.schema === HIERARCHY_SCHEMA)) };
  if (hash(state.scope) !== state.scopeHash || hash(observedScope) !== state.scopeHash) fail('Session scope changed; reconcile the mapping before continuing');
  return state;
}
function mutate(directory, operation) {
  const lock = path.join(directory, 'session.lock');
  let descriptor;
  try {
    descriptor = fs.openSync(lock, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') fail('Session metadata is busy; no action was performed');
    throw error;
  }
  try {
    const state = load(directory);
    const result = operation(state);
    state.updatedAt = now();
    writeAtomic(path.join(directory, 'session.json'), state);
    return result === undefined ? state : result;
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}
function scopeItem(item, hierarchical) {
  return { id: item.id, repositories: item.repositories, ...(hierarchical ? { parentId: item.parentId, codeBinding: item.codeBinding } : {}) };
}
function mode(item) { return item.codeBinding?.kind || 'own'; }
function codeOwner(state, item) { return mode(item) === 'parent' ? demand(state, { id: item.parentId }) : item; }
function groupReady(state, item) {
  if (state.schema !== HIERARCHY_SCHEMA) return item.decision.status === 'passed';
  const root = item.parentId ? demand(state, { id: item.parentId }) : item;
  return state.demands.filter(entry => entry.id === root.id || entry.parentId === root.id).every(entry => entry.decision.status === 'passed');
}
function applicable(item, phase) { return mode(item) !== 'none' && !(mode(item) === 'parent' && ['commit', 'push'].includes(phase)); }
function codeReady(item) { return item.delivery.commit.status === 'succeeded' || (mode(item) === 'parent' && item.delivery.commit.status === 'inherited'); }
function pushReady(item) { return item.delivery.push.status === 'succeeded' || (mode(item) === 'parent' && item.delivery.push.status === 'inherited'); }
function refreshReferences(state) {
  if (state.schema !== HIERARCHY_SCHEMA) return;
  for (const item of state.demands.filter(entry => mode(entry) === 'parent' && entry.delivery.commit.status === 'inherited')) {
    const parent = codeOwner(state, item);
    if (parent.delivery.commit.status !== 'succeeded' || !sameSelection(selection(item, state), selection(parent, state))) fail('Inherited commit differs from its verified parent receipt');
    if (state.scope.deliveryActions.includes('push') && parent.delivery.push.status === 'succeeded') {
      item.delivery.push = { status: 'inherited', sourceDemand: parent.id, records: parent.delivery.push.records, at: parent.delivery.push.at };
    }
  }
  for (const item of state.demands) if (completed(state, item)) { item.claim = null; item.publication = null; }
}
function validateBosTarget(state, item, receipt) {
  if (state.schema !== HIERARCHY_SCHEMA) return;
  if (receipt?.requirementCode !== item.id || receipt?.codeOwnerRequirementCode !== codeOwner(state, item).id) fail('BOS receipt must identify the target demand and verified code owner');
  text(receipt.linkProject, 'BOS linkProject');
  if (item.delivery.bos.linkProject && receipt.linkProject !== item.delivery.bos.linkProject) fail('BOS associated project changed; preserve the prior result and reconcile the mapping');
}
function create(directory, input) {
  const projectRoot = path.resolve(text(input.projectRoot, 'projectRoot'));
  assertDirectory(directory, projectRoot);
  const actions = [...new Set(input.deliveryActions || [])];
  if (!actions.includes('commit') || actions.some(action => !ACTIONS.includes(action))) fail('Specify deliveryActions including commit');
  const seen = new Set(), repositories = new Map();
  const hierarchical = hasBindings(input.demands, 'parentId');
  const rows = (input.demands || []).map(item => ({ ...item, id: id(item.id), ...(Object.hasOwn(item, 'parentId') ? { parentId: item.parentId === null ? null : id(item.parentId) } : {}) }));
  const relations = hierarchical ? normalizeBindings(rows, { idField: 'id', parentField: 'parentId' }) : null;
  const demands = rows.map(item => {
    const relation = relations?.get(item.id), kind = relation?.codeBinding.kind || 'own';
    if (kind !== 'own' && Object.hasOwn(item, 'repositories')) fail('Inherited or no-code demands cannot duplicate repository ownership');
    const demandId = id(item.id);
    if (seen.has(demandId)) fail(`Duplicate demand: ${demandId}`);
    seen.add(demandId);
    const specs = (item.repositories || []).map(repo => {
      const key = text(repo.key, 'repository key'), root = path.resolve(text(repo.root, 'repository root'));
      const remote = repo.remote || null, ref = repo.ref || null;
      if (actions.includes('push') && (!remote || !/^refs\/heads\/[^\s]+$/.test(ref || ''))) fail('Push requires an explicit remote and branch ref');
      if (actions.includes('bos-log') && !/^refs\/heads\/[^\s]+$/.test(ref || '')) fail('BOS requires an explicit real repository target ref');
      const identity = { key, root, remote, ref };
      if (repositories.has(key) && hash(repositories.get(key)) !== hash(identity)) fail('Repository key maps to different targets');
      if ([...repositories.values()].some(old => old.key !== key && canonical(old.root) === canonical(root))) fail('Use one key per target repository');
      repositories.set(key, identity);
      const files = [...new Set(repo.files || [])];
      if (!files.length || files.some(file => typeof file !== 'string' || !file || path.posix.isAbsolute(file) || path.win32.isAbsolute(file) ||
          file.split(/[\\/]/).some(part => ['..', '.git', '.agents'].includes(part)))) fail('Provide exact repository-relative files');
      return { ...identity, files: files.sort() };
    });
    if ((kind === 'own' && !specs.length) || new Set(specs.map(repo => repo.key)).size !== specs.length) fail('Demand needs unique repository keys');
    const automatic = item.automatic || {};
    return {
      id: demandId, title: text(item.title, 'title'), repositories: specs,
      ...(hierarchical ? { parentId: relation.parent, codeBinding: relation.codeBinding } : {}),
      automatic: { status: automatic.status || 'not-verified', evidenceRefs: automatic.evidenceRefs || [], gaps: automatic.gaps || [] },
      decision: { status: 'pending', quote: null, at: null },
      claim: null, publication: null,
      delivery: { commit: { status: kind === 'none' ? 'not-applicable' : 'pending', records: [], ...(kind === 'none' ? { reason: relation.codeBinding.reason } : {}) },
        bos: { status: kind !== 'none' && actions.includes('bos-log') ? 'pending' : 'not-applicable', ...(kind === 'none' ? { reason: relation.codeBinding.reason } : {}) },
        push: { status: kind !== 'none' && actions.includes('push') ? 'pending' : 'not-applicable', records: [], ...(kind === 'none' ? { reason: relation.codeBinding.reason } : {}) } },
      history: []
    };
  });
  if (!demands.length) fail('No demands provided');
  const scope = { projectRoot, deliveryActions: actions, demands: demands.map(item => scopeItem(item, hierarchical)) };
  const state = { schema: hierarchical ? HIERARCHY_SCHEMA : SCHEMA, taskKind: 'business-demand', projectRoot, createdAt: now(), updatedAt: now(), scope, scopeHash: hash(scope), authorizations: {}, demands };
  fs.mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, 'session.lock');
  const descriptor = fs.openSync(lock, 'wx');
  try {
    if (fs.existsSync(path.join(directory, 'session.json'))) fail('Session already exists; resume it instead');
    writeAtomic(path.join(directory, 'session.json'), state);
  } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
  return state;
}
function human(input) {
  if (input.actor !== 'user') fail('A direct user statement is required');
  return text(input.quote, 'user quote');
}
function demand(state, input) {
  const item = state.demands.find(entry => entry.id === id(input.id));
  if (!item) fail('Demand is outside this session');
  return item;
}
function owned(state, input) {
  const item = demand(state, input);
  if (item.claim?.owner !== text(input.owner, 'owner')) fail('Demand is not claimed by this owner');
  return item;
}
function bosConfirmed(state, item, expected = realSelection(state, item)) {
  const bos = item.delivery.bos;
  const recorded = (bos.selection || []).map(record => ({ ...record,
    ref: record.ref || expected.find(entry => canonical(entry.repo) === canonical(record.repo))?.ref }));
  return bos.status === 'succeeded' && bos.resultCodes?.length > 0 && bos.resultCodes.every(code => code === '000') &&
    sameSelection(recorded, expected) && (state.schema !== HIERARCHY_SCHEMA ||
      (bos.requirementCode === item.id && bos.codeOwnerRequirementCode === codeOwner(state, item).id && typeof bos.linkProject === 'string' && bos.linkProject.trim().length > 0));
}
function completed(state, item) {
  if (mode(item) === 'none') return item.decision.status === 'passed' && ['commit', 'bos', 'push'].every(phase => item.delivery[phase].status === 'not-applicable');
  const done = item.decision.status === 'passed' && codeReady(item) &&
    (!state.scope.deliveryActions.includes('bos-log') || item.delivery.bos.status === 'succeeded') &&
    (!state.scope.deliveryActions.includes('push') || pushReady(item));
  if (!done || !state.scope.deliveryActions.includes('bos-log')) return done;
  try {
    const expected = realSelection(state, item);
    // Historical receipts retain their original fields, but must pass live
    // target verification too. Missing historical refs come from scoped specs.
    if (!bosConfirmed(state, item, expected)) return false;
    if (state.scope.deliveryActions.includes('push')) {
      const owner = codeOwner(state, item), pushes = item.delivery.push.records || [];
      if (pushes.length !== expected.length || new Set(pushes.map(record => record.key)).size !== pushes.length) return false;
      for (const record of pushes) {
        const spec = owner.repositories.find(repo => repo.key === record.key), commit = item.delivery.commit.records.find(entry => entry.key === record.key);
        if (!spec || !commit || record.commit !== commit.hash || record.remote !== spec.remote || record.ref !== spec.ref ||
          record.verified !== true || !/^[a-f0-9]{40}$/.test(record.remoteHash || '') ||
          (record.remoteHash !== commit.hash && record.containsVerified !== true)) return false;
      }
    }
    return mode(item) !== 'parent' ||
      (item.delivery.commit.sourceDemand === codeOwner(state, item).id && sameSelection(expected, realSelection(state, codeOwner(state, item))));
  } catch { return false; }
}
function selection(item, state) {
  return item.delivery.commit.records.map(record => {
    const ref = record.ref || (state && codeOwner(state, item).repositories.find(repo => repo.key === record.key)?.ref);
    return { repo: record.repo, hash: record.hash, ...(ref ? { ref } : {}) };
  });
}
function sameSelection(a, b) {
  const normalize = list => (list || []).map(record => `${canonical(record.repo)}:${record.ref || ''}:${record.hash}`).sort();
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b)) && a?.length === b?.length;
}
function realSelection(state, item) {
  const owner = codeOwner(state, item), records = item.delivery.commit.records;
  if (!owner.repositories.length || records.length !== owner.repositories.length || new Set(records.map(record => record.key)).size !== records.length) fail('All real target repositories must have verified commits');
  return records.map(record => {
    const spec = owner.repositories.find(repo => repo.key === record.key);
    if (!spec || canonical(record.repo) !== canonical(spec.root) || (record.ref && record.ref !== spec.ref)) fail('BOS commit must come from the scoped real repository and target ref');
    const actual = verifyRealCommits(spec.root, spec.ref, [record.hash]);
    return { repo: actual.repo, ref: actual.ref, hash: actual.hashes[0] };
  });
}
function commitReceipt(state, item, receipt) {
  if (receipt.status !== 'verified' || String(receipt.demand) !== item.id) fail('Use the verified official commit plan for this demand');
  const records = (receipt.repositories || []).map(repo => {
    const bos = state.scope.deliveryActions.includes('bos-log');
    const key = bos ? item.repositories.find(spec => canonical(spec.root) === canonical(repo.root))?.key :
      Object.keys(item.claim.worktrees).find(name => canonical(item.claim.worktrees[name]) === canonical(repo.root));
    const spec = item.repositories.find(entry => entry.key === key);
    if (!spec || repo.execution?.status !== 'verified' || !/^[a-f0-9]{40}$/.test(repo.execution.commit || '')) fail('Commit repository/hash is not verified');
    if (JSON.stringify([...repo.files].sort()) !== JSON.stringify(spec.files)) fail('Commit files differ from accepted scope');
    if (!new RegExp('^[a-z]+\\(' + item.id + '\\):').test(repo.message || '')) fail('Commit message has a different demand ID');
    if (bos) {
      const actual = verifyRealCommits(spec.root, spec.ref, [repo.execution.commit]);
      return { key, repo: actual.repo, ref: actual.ref, hash: actual.hashes[0] };
    }
    return { key, repo: path.resolve(repo.root), hash: repo.execution.commit };
  });
  if (records.length !== item.repositories.length || new Set(records.map(record => record.key)).size !== records.length) fail('All target repositories must be verified');
  return records;
}
function applyCore(state, command, input) {
  if (command === 'authorize') {
    const quote = human(input), actions = input.actions || [];
    if (!actions.length || actions.some(action => !state.scope.deliveryActions.includes(action))) fail('Authorization actions differ from session scope');
    for (const action of actions) state.authorizations[action] = { quote, actor: 'user', at: now(), scopeHash: state.scopeHash };
    return state;
  }
  if (command === 'decide') {
    const item = demand(state, input), quote = human(input);
    if (!['passed', 'failed', 'deferred'].includes(input.status)) fail('Invalid human verdict');
    if (item.decision.status === input.status) return state;
    const root = state.schema === HIERARCHY_SCHEMA && item.parentId ? demand(state, { id: item.parentId }) : item;
    const related = state.schema === HIERARCHY_SCHEMA ? state.demands.filter(entry => entry.id === root.id || entry.parentId === root.id) : [item];
    if (related.some(entry => entry.claim || entry.delivery.commit.records.length)) fail('Delivery has started; preserve receipts and reconcile a revised demand explicitly');
    item.decision = { status: input.status, quote, at: now() };
    item.history.push({ event: 'user-decision', status: input.status, at: now() });
    return state;
  }
  if (command === 'claim') {
    const item = demand(state, input), owner = text(input.owner, 'owner');
    if (item.decision.status !== 'passed') fail('Only a human-passed demand can be delivered');
    if (completed(state, item)) fail('Demand is already delivered');
    if (!groupReady(state, item)) fail('All related child demands must pass human acceptance before shared delivery');
    if (mode(item) === 'parent' && codeOwner(state, item).delivery.commit.status !== 'succeeded') fail('Wait for the verified parent commit; do not create a child commit');
    if (item.claim) {
      if (item.claim.owner === owner) {
        for (const [key, root] of Object.entries(input.worktrees || {})) {
          if (!item.claim.worktrees[key] || canonical(item.claim.worktrees[key]) !== canonical(root)) fail('Claimed worktree changed; resume the recorded checkout');
        }
        return state;
      }
      fail('Demand is already claimed by another owner');
    }
    if (Object.keys(input.worktrees || {}).some(key => !item.repositories.some(repo => repo.key === key))) fail('Unknown worktree repository key');
    const worktrees = {};
    for (const repo of item.repositories) {
      worktrees[repo.key] = path.resolve(input.worktrees?.[repo.key] || repo.root);
      if (!fs.existsSync(worktrees[repo.key])) fail('Prepare the actual worktree before claiming it');
      for (const other of state.demands.filter(entry => entry.claim)) {
        if (Object.values(other.claim.worktrees).some(root => canonical(root) === canonical(worktrees[repo.key]))) fail('Worktree is already in use; use an isolated checkout');
      }
    }
    if (new Set(Object.values(worktrees).map(canonical)).size !== Object.values(worktrees).length) fail('Use a distinct worktree for each repository');
    item.claim = { owner, worktrees, at: now() };
    return state;
  }
  if (command === 'publish') {
    const item = owned(state, input);
    if (!groupReady(state, item)) fail('Shared acceptance group is not ready');
    for (const action of state.scope.deliveryActions) {
      if (state.authorizations[action]?.scopeHash !== state.scopeHash) fail(`Missing scoped authorization: ${action}`);
    }
    for (const other of state.demands.filter(entry => entry.publication && entry.id !== item.id)) {
      if (other.repositories.some(a => item.repositories.some(b => canonical(a.root) === canonical(b.root) && a.remote === b.remote && a.ref === b.ref))) fail('Publication is busy; prepare independently and wait before commit/BOS/push');
    }
    item.publication = { owner: item.claim.owner, at: now() };
    return state;
  }
  if (command === 'inherit') {
    const item = owned(state, input);
    if (state.schema !== HIERARCHY_SCHEMA || mode(item) !== 'parent' || !item.publication || !groupReady(state, item)) fail('Only a published accepted child can inherit its parent commit');
    if (item.delivery.commit.status !== 'pending') fail('Parent commit reference already recorded; resume the next phase');
    const parent = codeOwner(state, item);
    if (parent.delivery.commit.status !== 'succeeded' || !selection(parent).length) fail('A verified parent commit is required');
    if (state.scope.deliveryActions.includes('bos-log')) realSelection(state, parent);
    item.delivery.commit = { status: 'inherited', sourceDemand: parent.id, records: parent.delivery.commit.records.map(record => ({ ...record,
      ...(state.scope.deliveryActions.includes('bos-log') ? { ref: parent.repositories.find(repo => repo.key === record.key).ref } : {}) })), at: now() };
    item.history.push({ event: 'inherit-commit', sourceDemand: parent.id, at: now() });
    return state;
  }
  if (command === 'release') {
    const item = owned(state, input);
    if (item.delivery.commit.status !== 'pending' || item.delivery.commit.records.length || item.delivery.bos.status === 'unknown') fail('Keep delivery ownership until the recorded side effects are reconciled');
    item.claim = null; item.publication = null;
    return state;
  }
  if (command === 'reconcile-bos') {
    const item = owned(state, input);
    if (item.delivery.bos.status !== 'unknown') fail('No unknown BOS result to reconcile');
    let reconciliation;
    if (input.status === 'succeeded') {
      validateBosTarget(state, item, input.receipt);
      if (!sameSelection(input.receipt?.select, realSelection(state, item))) fail('Reconciled BOS result must identify the exact commits and real target refs');
    }
    if (input.actor === 'agent' && input.status === 'succeeded') {
      if (input.verification?.source !== 'bos-readback' || input.receipt?.submitted !== true) fail('Agent reconciliation needs an authoritative BOS readback receipt');
      reconciliation = { actor: 'agent', source: 'bos-readback', evidenceRef: text(input.verification.evidenceRef, 'readback evidenceRef'), at: now() };
    } else reconciliation = { actor: 'user', quote: human(input), at: now() };
    if (input.status === 'not-submitted') item.delivery.bos = { ...item.delivery.bos, status: 'pending', reconciliation };
    else if (input.status === 'succeeded') {
      if (input.receipt?.submitted !== true || input.receipt?.resultCodes?.some(code => code !== '000') || !input.receipt?.resultCodes?.length) fail('Reconciled BOS result must identify the exact commits and success codes');
      item.delivery.bos = { status: 'succeeded', selection: realSelection(state, item), resultCodes: [...input.receipt.resultCodes], reconciliation, ...(state.schema === HIERARCHY_SCHEMA ? { requirementCode: item.id, codeOwnerRequirementCode: codeOwner(state, item).id, linkProject: input.receipt.linkProject } : {}) };
    } else fail('Choose not-submitted or succeeded');
    item.history.push({ event: 'reconcile-bos', status: item.delivery.bos.status, at: now() });
    if (completed(state, item)) { item.claim = null; item.publication = null; }
    return state;
  }
  if (command !== 'record') fail('Unknown mutation command');
  const item = owned(state, input), phase = input.phase;
  if (input.durationMs !== undefined && (!Number.isFinite(input.durationMs) || input.durationMs < 0)) fail('durationMs must be finite and non-negative');
  if (!PHASES.includes(phase) || !['running', 'failed', 'unknown', 'succeeded'].includes(input.status)) fail('Invalid delivery phase/status');
  if (!item.publication) fail('Acquire publication ownership before side effects');
  const action = phase === 'bos' ? 'bos-log' : phase;
  if (!state.scope.deliveryActions.includes(action)) fail('Phase is outside the requested delivery actions');
  if (!applicable(item, phase)) fail('Phase is not applicable; shared commit/push must be referenced from the parent');
  if (!groupReady(state, item)) fail('All related child demands must pass before delivery');
  if (phase !== 'commit' && !codeReady(item)) fail('Commit verification must finish first');
  if (state.scope.deliveryActions.includes('bos-log') && ['bos', 'push'].includes(phase) && ['running', 'succeeded'].includes(input.status)) {
    const actual = realSelection(state, item);
    if (mode(item) === 'parent' && !sameSelection(actual, realSelection(state, codeOwner(state, item)))) fail('Inherited real commits differ from the parent');
  }
  if (phase === 'push' && state.scope.deliveryActions.includes('bos-log') && state.demands.some(child => child.parentId === item.id && mode(child) === 'parent' && child.delivery.bos.status !== 'succeeded')) fail('All child BOS results must be confirmed before the single shared push');
  if (phase === 'push' && state.scope.deliveryActions.includes('bos-log') && item.delivery.bos.status !== 'succeeded') fail('BOS result must be confirmed before push');
  if (phase === 'push' && state.scope.deliveryActions.includes('bos-log') && ['running', 'succeeded'].includes(input.status)) {
    if (!bosConfirmed(state, item)) fail('BOS result must confirm the real target selection before push');
    for (const child of state.demands.filter(entry => entry.parentId === item.id && mode(entry) === 'parent')) {
      if (!bosConfirmed(state, child)) fail('All child BOS receipts must confirm their real target selections before the single shared push');
    }
  }
  const previous = item.delivery[phase];
  if (previous.status === 'succeeded') fail('Phase already succeeded; do not repeat the external action');
  if (phase === 'bos' && ['running', 'unknown'].includes(previous.status) && input.status === 'running') fail('BOS may already have been written; reconcile before retry');
  if (phase === 'bos' && previous.status === 'unknown') fail('Reconcile unknown BOS results explicitly');
  if (phase === 'bos' && input.status === 'running') {
    validateBosTarget(state, item, input.receipt);
    if (!sameSelection(input.receipt?.select, realSelection(state, item))) fail('BOS request must use the exact verified commit selection and real target refs');
    if (state.schema === HIERARCHY_SCHEMA) previous.linkProject = input.receipt.linkProject;
  }
  if (input.status === 'succeeded') {
    if (phase === 'commit') item.delivery.commit = { status: 'succeeded', records: commitReceipt(state, item, input.receipt), at: now() };
    if (phase === 'bos') {
      validateBosTarget(state, item, input.receipt);
      if (!sameSelection(input.receipt?.select, realSelection(state, item)) || !input.receipt?.submitted ||
          !input.receipt?.resultCodes?.length || input.receipt.resultCodes.some(code => code !== '000')) fail('BOS receipt must confirm the exact verified commit selection');
      item.delivery.bos = { status: 'succeeded', selection: realSelection(state, item), resultCodes: [...input.receipt.resultCodes], at: now(), ...(input.evidenceRef ? { evidenceRef: text(input.evidenceRef, 'evidenceRef') } : {}),
        ...(state.schema === HIERARCHY_SCHEMA ? { requirementCode: item.id, codeOwnerRequirementCode: codeOwner(state, item).id, linkProject: input.receipt.linkProject } : {}) };
    }
    if (phase === 'push') {
      const records = [...(previous.records || [])];
      for (const record of input.receipt?.repositories || []) {
        const commit = item.delivery.commit.records.find(entry => entry.key === record.key);
        const repo = item.repositories.find(entry => entry.key === record.key);
        if (!commit || record.commit !== commit.hash || record.remote !== repo.remote || record.ref !== repo.ref ||
            record.verified !== true || !/^[a-f0-9]{40}$/.test(record.remoteHash || '') ||
            (record.remoteHash !== commit.hash && record.containsVerified !== true)) fail('Push receipt needs the exact target and independently verified remote containment');
        const old = records.find(entry => entry.key === record.key);
        if (old && JSON.stringify(old) !== JSON.stringify(record)) fail('Conflicting push receipt');
        if (!old) records.push(record);
      }
      if (!records.length) fail('No verified push receipt');
      item.delivery.push = { status: records.length === item.repositories.length ? 'succeeded' : 'partial', records, at: now() };
    }
  } else {
    item.delivery[phase] = { ...previous, status: input.status, at: now() };
    if (input.evidenceRef) item.delivery[phase].evidenceRef = text(input.evidenceRef, 'evidenceRef');
  }
  item.history.push({ event: phase, status: item.delivery[phase].status, at: now(), ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }) });
  if (completed(state, item)) { item.claim = null; item.publication = null; }
  return state;
}
function apply(state, command, input) {
  const result = applyCore(state, command, input);
  refreshReferences(state);
  return result;
}
function readyForClaim(state, item) {
  return item.decision.status === 'passed' && groupReady(state, item) && !completed(state, item) && !item.claim &&
    (mode(item) !== 'parent' || codeOwner(state, item).delivery.commit.status === 'succeeded');
}
function summarize(state, kind = 'accepted') {
  const groups = {
    accepted: state.demands.filter(item => item.decision.status === 'passed'),
    delivered: state.demands.filter(item => completed(state, item)),
    failed: state.demands.filter(item => item.decision.status === 'failed'),
    deferred: state.demands.filter(item => item.decision.status === 'deferred'),
    pending: state.demands.filter(item => item.decision.status === 'pending')
  };
  if (!groups[kind]) fail('Unknown summary kind');
  const csv = idsCsv(groups[kind].map(item => item.id));
  return { kind, count: groups[kind].length, ids: csv ? csv.split(',') : [], csv, deliveryActions: state.scope.deliveryActions,
    ...(state.schema === HIERARCHY_SCHEMA ? { groupCompletion: state.demands.filter(item => !item.parentId).map(root => {
      const members = state.demands.filter(item => item.id === root.id || item.parentId === root.id);
      return { id: root.id, ids: members.map(item => item.id), completed: members.every(item => completed(state, item)) };
    }) } : {}) };
}
function render(state, kind = 'accepted', format = 'markdown') {
  const result = summarize(state, kind);
  if (format === 'json') return JSON.stringify(result, null, 2);
  if (format === 'csv') return result.csv;
  if (format !== 'markdown') fail('Unknown report format');
  const labels = { accepted: '验收通过', delivered: '已完成约定交付', failed: '验收不通过', deferred: '暂缓', pending: '待用户验收结论' };
  if (kind === 'delivered' && state.scope.deliveryActions.includes('bos-log') && state.scope.deliveryActions.includes('push')) labels.delivered = '已完整交付';
  const heading = `${labels[kind]}共 **${result.count} 条**：`;
  return result.count ? `${heading}\n\n\`\`\`text\n${result.csv}\n\`\`\`` : `${heading}暂无。`;
}
function main(argv = process.argv.slice(2)) {
  try {
    if (argv[0] === '--help') { process.stdout.write('acceptance-session.js <init|authorize|decide|claim|publish|inherit|record|reconcile-bos|release|status|next|report> --directory <project task dir> [--input-file file|--stdin] [--id demand] [--kind accepted|delivered|failed|deferred|pending] [--format markdown|json|csv]\n'); return 0; }
    const command = argv.shift(), options = {};
    while (argv.length) {
      const key = argv.shift();
      if (key === '--stdin') options.stdin = true;
      else if (['--directory', '--input-file', '--kind', '--format', '--id'].includes(key) && argv.length) options[key.slice(2)] = argv.shift();
      else fail('Unknown argument; use command --directory <project task dir> [--input-file file|--stdin]');
    }
    const directory = path.resolve(text(options.directory, 'directory'));
    if (command === 'report') { process.stdout.write(`${render(load(directory), options.kind, options.format)}\n`); return 0; }
    if (command === 'next') {
      const state = load(directory), candidates = state.demands.filter(item => readyForClaim(state, item)).sort((a,b) => a.decision.at.localeCompare(b.decision.at));
      process.stdout.write(JSON.stringify({ next: candidates[0] || null }, null, 2) + '\n'); return 0;
    }
    if (command === 'status' && options.id) {
      const state = load(directory); process.stdout.write(JSON.stringify({ scopeHash: state.scopeHash, authorizations: state.authorizations, demand: demand(state, { id: options.id }) }, null, 2) + '\n'); return 0;
    }
    if (command === 'status') { process.stdout.write(`${JSON.stringify(load(directory), null, 2)}\n`); return 0; }
    if (!!options.stdin === !!options['input-file']) fail('Choose --input-file or --stdin for structured input');
    const input = options.stdin ? JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '')) : json(options['input-file']);
    const state = command === 'init' ? create(directory, input) : mutate(directory, state => apply(state, command, input));
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return 0;
  } catch (error) { process.stderr.write(`${error.message}\n`); return 1; }
}
module.exports = { create, load, mutate, apply, completed, selection, idsCsv, summarize, render, readyForClaim, main };
if (require.main === module) process.exitCode = main();
