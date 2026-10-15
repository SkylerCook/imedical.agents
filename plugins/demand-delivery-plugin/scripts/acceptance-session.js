'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SCHEMA = 'demand-acceptance-session/v1';
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
  if (state.schema !== SCHEMA) fail('Unsupported session schema');
  assertDirectory(directory, state.projectRoot);
  const observedScope = { projectRoot: state.projectRoot, deliveryActions: state.scope.deliveryActions, demands: state.demands.map(item => ({ id: item.id, repositories: item.repositories })) };
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
function create(directory, input) {
  const projectRoot = path.resolve(text(input.projectRoot, 'projectRoot'));
  assertDirectory(directory, projectRoot);
  const actions = [...new Set(input.deliveryActions || [])];
  if (!actions.includes('commit') || actions.some(action => !ACTIONS.includes(action))) fail('Specify deliveryActions including commit');
  const seen = new Set(), repositories = new Map();
  const demands = (input.demands || []).map(item => {
    const demandId = id(item.id);
    if (seen.has(demandId)) fail(`Duplicate demand: ${demandId}`);
    seen.add(demandId);
    const specs = (item.repositories || []).map(repo => {
      const key = text(repo.key, 'repository key'), root = path.resolve(text(repo.root, 'repository root'));
      const remote = repo.remote || null, ref = repo.ref || null;
      if (actions.includes('push') && (!remote || !/^refs\/heads\/[^\s]+$/.test(ref || ''))) fail('Push requires an explicit remote and branch ref');
      const identity = { key, root, remote, ref };
      if (repositories.has(key) && hash(repositories.get(key)) !== hash(identity)) fail('Repository key maps to different targets');
      if ([...repositories.values()].some(old => old.key !== key && canonical(old.root) === canonical(root))) fail('Use one key per target repository');
      repositories.set(key, identity);
      const files = [...new Set(repo.files || [])];
      if (!files.length || files.some(file => typeof file !== 'string' || !file || path.posix.isAbsolute(file) || path.win32.isAbsolute(file) ||
          file.split(/[\\/]/).some(part => ['..', '.git', '.agents'].includes(part)))) fail('Provide exact repository-relative files');
      return { ...identity, files: files.sort() };
    });
    if (!specs.length || new Set(specs.map(repo => repo.key)).size !== specs.length) fail('Demand needs unique repository keys');
    const automatic = item.automatic || {};
    return {
      id: demandId, title: text(item.title, 'title'), repositories: specs,
      automatic: { status: automatic.status || 'not-verified', evidenceRefs: automatic.evidenceRefs || [], gaps: automatic.gaps || [] },
      decision: { status: 'pending', quote: null, at: null },
      claim: null, publication: null,
      delivery: { commit: { status: 'pending', records: [] }, bos: { status: actions.includes('bos-log') ? 'pending' : 'not-applicable' }, push: { status: actions.includes('push') ? 'pending' : 'not-applicable', records: [] } },
      history: []
    };
  });
  if (!demands.length) fail('No demands provided');
  const scope = { projectRoot, deliveryActions: actions, demands: demands.map(item => ({ id: item.id, repositories: item.repositories })) };
  const state = { schema: SCHEMA, taskKind: 'business-demand', projectRoot, createdAt: now(), updatedAt: now(), scope, scopeHash: hash(scope), authorizations: {}, demands };
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
function completed(state, item) {
  return item.decision.status === 'passed' && item.delivery.commit.status === 'succeeded' &&
    (!state.scope.deliveryActions.includes('bos-log') || item.delivery.bos.status === 'succeeded') &&
    (!state.scope.deliveryActions.includes('push') || item.delivery.push.status === 'succeeded');
}
function selection(item) {
  return item.delivery.commit.records.map(record => ({ repo: record.repo, hash: record.hash }));
}
function sameSelection(a, b) {
  const normalize = list => (list || []).map(record => `${canonical(record.repo)}:${record.hash}`).sort();
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b)) && a?.length === b?.length;
}
function commitReceipt(item, receipt) {
  if (receipt.status !== 'verified' || String(receipt.demand) !== item.id) fail('Use the verified official commit plan for this demand');
  const records = (receipt.repositories || []).map(repo => {
    const key = Object.keys(item.claim.worktrees).find(name => canonical(item.claim.worktrees[name]) === canonical(repo.root));
    const spec = item.repositories.find(entry => entry.key === key);
    if (!spec || repo.execution?.status !== 'verified' || !/^[a-f0-9]{40}$/.test(repo.execution.commit || '')) fail('Commit repository/hash is not verified');
    if (JSON.stringify([...repo.files].sort()) !== JSON.stringify(spec.files)) fail('Commit files differ from accepted scope');
    if (!new RegExp('^[a-z]+\\(' + item.id + '\\):').test(repo.message || '')) fail('Commit message has a different demand ID');
    return { key, repo: path.resolve(repo.root), hash: repo.execution.commit };
  });
  if (records.length !== item.repositories.length || new Set(records.map(record => record.key)).size !== records.length) fail('All target repositories must be verified');
  return records;
}
function apply(state, command, input) {
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
    if (item.claim || item.delivery.commit.records.length) fail('Delivery has started; preserve receipts and reconcile a revised demand explicitly');
    item.decision = { status: input.status, quote, at: now() };
    item.history.push({ event: 'user-decision', status: input.status, at: now() });
    return state;
  }
  if (command === 'claim') {
    const item = demand(state, input), owner = text(input.owner, 'owner');
    if (item.decision.status !== 'passed') fail('Only a human-passed demand can be delivered');
    if (completed(state, item)) fail('Demand is already delivered');
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
    for (const action of state.scope.deliveryActions) {
      if (state.authorizations[action]?.scopeHash !== state.scopeHash) fail(`Missing scoped authorization: ${action}`);
    }
    for (const other of state.demands.filter(entry => entry.publication && entry.id !== item.id)) {
      if (other.repositories.some(a => item.repositories.some(b => canonical(a.root) === canonical(b.root) && a.remote === b.remote && a.ref === b.ref))) fail('Publication is busy; prepare independently and wait before commit/BOS/push');
    }
    item.publication = { owner: item.claim.owner, at: now() };
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
    if (input.actor === 'agent' && input.status === 'succeeded') {
      if (input.verification?.source !== 'bos-readback' || input.receipt?.submitted !== true) fail('Agent reconciliation needs an authoritative BOS readback receipt');
      reconciliation = { actor: 'agent', source: 'bos-readback', evidenceRef: text(input.verification.evidenceRef, 'readback evidenceRef'), at: now() };
    } else reconciliation = { actor: 'user', quote: human(input), at: now() };
    if (input.status === 'not-submitted') item.delivery.bos = { status: 'pending', reconciliation };
    else if (input.status === 'succeeded') {
      if (!sameSelection(input.receipt?.select, selection(item)) || input.receipt?.resultCodes?.some(code => code !== '000') || !input.receipt?.resultCodes?.length) fail('Reconciled BOS result must identify the exact commits and success codes');
      item.delivery.bos = { status: 'succeeded', selection: selection(item), resultCodes: [...input.receipt.resultCodes], reconciliation };
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
  if (phase !== 'commit' && item.delivery.commit.status !== 'succeeded') fail('Commit verification must finish first');
  if (phase === 'push' && state.scope.deliveryActions.includes('bos-log') && item.delivery.bos.status !== 'succeeded') fail('BOS result must be confirmed before push');
  const previous = item.delivery[phase];
  if (previous.status === 'succeeded') fail('Phase already succeeded; do not repeat the external action');
  if (phase === 'bos' && ['running', 'unknown'].includes(previous.status) && input.status === 'running') fail('BOS may already have been written; reconcile before retry');
  if (phase === 'bos' && previous.status === 'unknown') fail('Reconcile unknown BOS results explicitly');
  if (input.status === 'succeeded') {
    if (phase === 'commit') item.delivery.commit = { status: 'succeeded', records: commitReceipt(item, input.receipt), at: now() };
    if (phase === 'bos') {
      if (!sameSelection(input.receipt?.select, selection(item)) || !input.receipt?.submitted ||
          !input.receipt?.resultCodes?.length || input.receipt.resultCodes.some(code => code !== '000')) fail('BOS receipt must confirm the exact verified commit selection');
      item.delivery.bos = { status: 'succeeded', selection: selection(item), resultCodes: [...input.receipt.resultCodes], at: now(), ...(input.evidenceRef ? { evidenceRef: text(input.evidenceRef, 'evidenceRef') } : {}) };
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
  return { kind, count: groups[kind].length, ids: csv ? csv.split(',') : [], csv, deliveryActions: state.scope.deliveryActions };
}
function render(state, kind = 'accepted', format = 'markdown') {
  const result = summarize(state, kind);
  if (format === 'json') return JSON.stringify(result, null, 2);
  if (format === 'csv') return result.csv;
  if (format !== 'markdown') fail('Unknown report format');
  const labels = { accepted: '验收通过', delivered: '已完成约定交付', failed: '验收不通过', deferred: '暂缓', pending: '待确认' };
  if (kind === 'delivered' && state.scope.deliveryActions.includes('bos-log') && state.scope.deliveryActions.includes('push')) labels.delivered = '已完整交付';
  const heading = `${labels[kind]}共 **${result.count} 条**：`;
  return result.count ? `${heading}\n\n\`\`\`text\n${result.csv}\n\`\`\`` : `${heading}暂无。`;
}
function main(argv = process.argv.slice(2)) {
  try {
    if (argv[0] === '--help') { process.stdout.write('acceptance-session.js <init|authorize|decide|claim|publish|record|reconcile-bos|release|status|next|report> --directory <project task dir> [--input-file file|--stdin] [--id demand] [--kind accepted|delivered|failed|deferred|pending] [--format markdown|json|csv]\n'); return 0; }
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
      const state = load(directory), candidates = state.demands.filter(item => item.decision.status === 'passed' && !completed(state, item) && !item.claim).sort((a,b) => a.decision.at.localeCompare(b.decision.at));
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
module.exports = { create, load, mutate, apply, completed, selection, idsCsv, summarize, render, main };
if (require.main === module) process.exitCode = main();
