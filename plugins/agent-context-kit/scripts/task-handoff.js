#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { resolveWorkspaceContext, validateWorkspaceContext } = require('../../../scripts/lib/workspace-context.js');
const { check: checkEvidence } = require('../../../scripts/validation-evidence.js');

const SCHEMA = 'imedical-task-handoff/v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const comparable = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
const within = (p, root) => {
  const relative = path.relative(comparable(root), comparable(p));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
function fail(message) { throw new Error(message); }
function noLinks(file) {
  let current = path.resolve(file);
  while (true) {
    try { if (fs.lstatSync(current).isSymbolicLink()) fail(`Linked path is not allowed: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(file);
}
function json(file) { noLinks(file); return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1' }
  });
}
function gitText(root, args) {
  const result = git(root, args);
  if (result.status !== 0) fail(`Local Git check failed (${args[0]}): ${result.error?.message || result.stderr.trim()}`);
  return result.stdout;
}
function stamp(date = new Date()) {
  const n = (v, width = 2) => String(v).padStart(width, '0');
  return `${date.getFullYear()}${n(date.getMonth() + 1)}${n(date.getDate())}-${n(date.getHours())}${n(date.getMinutes())}${n(date.getSeconds())}${n(date.getMilliseconds(), 3)}`;
}
function unique(root, suffix, extension, create) {
  const now = Date.now();
  for (let i = 0; i < 1000; i++) {
    const file = path.join(root, `${stamp(new Date(now + i))}${suffix}${extension}`);
    try { create(file); return file; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  fail('Cannot allocate a unique handoff path');
}
function atomic(file, body) {
  noLinks(file);
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, body, { flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function workspace(projectRoot) {
  if (!projectRoot) fail('--project-root is required');
  const root = noLinks(projectRoot);
  if (!fs.statSync(root).isDirectory()) fail('Project root must be a directory');
  const context = resolveWorkspaceContext(root);
  if (context.mode !== 'standard') {
    const errors = validateWorkspaceContext(context).filter(item => !['workspace-context-resolved', 'junction-ok', 'local-path-ok'].includes(item.status));
    if (context.mode !== 'workspace-overlay' || errors.length) fail(`Invalid workspace context: ${JSON.stringify(errors)}`);
  }
  const base = noLinks(path.join(root, 'docs/handoff'));
  return { root, base, context };
}
function taskPath(ws, input) {
  if (!input) fail('--task-directory is required');
  const directory = noLinks(path.isAbsolute(input) ? input : path.resolve(ws.root, input));
  if (path.dirname(directory) !== ws.base) fail('Task must be a direct child of project docs/handoff');
  return directory;
}
function metadata(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) fail('Missing handoff frontmatter');
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!field || Object.hasOwn(result, field[1])) fail('Frontmatter must contain unique JSON scalar values');
    result[field[1]] = JSON.parse(field[2]);
  }
  for (const key of ['schema', 'taskKey', 'demandId', 'title', 'taskKind', 'status', 'updatedAt']) {
    if (typeof result[key] !== 'string' || !result[key].trim()) fail(`Missing metadata: ${key}`);
  }
  if (result.schema !== SCHEMA) fail('Unsupported handoff schema');
  if (!['business-demand', 'framework-maintenance', 'other'].includes(result.taskKind)) fail('Invalid taskKind');
  if (!['active', 'closed'].includes(result.status)) fail('status must be active or closed');
  if (!Number.isFinite(Date.parse(result.updatedAt))) fail('Invalid updatedAt');
  for (const heading of ['目标', '当前断点', '下一步', '阻塞项']) {
    if (!new RegExp(`^## ${heading}\\r?$`, 'm').test(text)) fail(`Missing section: ${heading}`);
  }
  return result;
}
function document(directory) {
  const file = noLinks(path.join(directory, 'handoff.md'));
  const text = fs.readFileSync(file, 'utf8');
  const meta = metadata(text);
  if (meta.taskKey !== path.basename(directory)) fail('Task identity does not match directory');
  return { file, text, meta, digest: hash(text) };
}
function normalizeInputs(ws, input = {}) {
  const defaults = ws.context.mode === 'workspace-overlay'
    ? ws.context.sourceRoots.map(s => ({ root: s.target, scopes: [] })) : [{ root: ws.root, scopes: [] }];
  const repositories = input.repositories || defaults;
  if (!Array.isArray(repositories) || !repositories.length) fail('repositories must be a non-empty array');
  const normalized = repositories.map(repo => {
    if (typeof repo.root !== 'string' || !path.isAbsolute(repo.root)) fail('Repository root must be an explicit absolute checkout path');
    const root = noLinks(repo.root);
    if (!fs.statSync(root).isDirectory()) fail('Repository root must exist');
    if (ws.context.mode === 'workspace-overlay' && !ws.context.sourceRoots.some(s => within(root, s.target))) fail('Repository is outside declared SourceRoot');
    const scopes = repo.scopes || [];
    if (!Array.isArray(scopes) || scopes.some(s => typeof s !== 'string' || !s)) fail('scopes must be relative paths');
    for (const scope of scopes) {
      const file = path.resolve(root, scope);
      if (path.isAbsolute(scope) || !within(file, root) || within(file, ws.base)) fail(`Invalid scope: ${scope}`);
      noLinks(file);
    }
    return { root, scopes: [...new Set(scopes)].sort() };
  });
  if (new Set(normalized.map(r => comparable(r.root))).size !== normalized.length) fail('Duplicate repository roots');
  const readable = file => [ws.root, ws.context.capabilityRoot, ...normalized.map(r => r.root)].some(root => within(file, root));
  const entrypoints = (input.entrypoints || []).map(entry => {
    if (typeof entry !== 'string') fail('entrypoints must be paths');
    const file = noLinks(path.resolve(ws.root, entry));
    if (!readable(file)) fail('Entrypoint outside declared roots');
    return file;
  });
  const evidence = (input.evidence || []).map(binding => {
    if (!binding || !normalized.some(r => comparable(r.root) === comparable(binding.repoRoot || '')) || !binding.suite || !path.isAbsolute(binding.evidenceFile || '')) fail('Evidence requires a declared repoRoot, suite and absolute evidenceFile');
    noLinks(binding.evidenceFile);
    return { repoRoot: path.resolve(binding.repoRoot), suite: String(binding.suite), evidenceFile: path.resolve(binding.evidenceFile) };
  });
  return { repositories: normalized, entrypoints, evidence };
}
function fileRecords(root, scopes, excluded) {
  const records = new Map();
  function visit(file) {
    if (within(file, excluded) || ['.git', '.agents', 'node_modules'].includes(path.basename(file))) return;
    noLinks(file);
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    if (!fs.existsSync(file)) { records.set(relative, { path: relative, type: 'missing' }); return; }
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
    } else if (stat.isFile()) records.set(relative, { path: relative, type: 'file', hash: hash(fs.readFileSync(file)), executable: stat.mode & 0o111 });
    else fail(`Unsupported scope file: ${relative}`);
  }
  for (const scope of scopes) visit(path.resolve(root, scope));
  return [...records.values()].sort((a, b) => a.path.localeCompare(b.path));
}
function statusRecords(raw, gitRoot, checkout, excluded) {
  const chunks = raw.split('\0');
  const entries = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const entry = { index: chunk[0], worktree: chunk[1], path: chunk.slice(3) };
    if (/[RC]/.test(chunk.slice(0, 2))) entry.originalPath = chunks[++i];
    const file = path.join(gitRoot, entry.path);
    if (within(file, checkout) && !within(file, excluded)) entries.push(entry);
  }
  return entries;
}
function collect(ws, inputs) {
  const warnings = [];
  const repositories = inputs.repositories.map(repo => {
    const probe = git(repo.root, ['rev-parse', '--show-toplevel']);
    const files = fileRecords(repo.root, repo.scopes, ws.base);
    const result = { ...repo, files, fingerprint: hash(JSON.stringify(files)) };
    if (!repo.scopes.length) warnings.push(`no-content-scopes: ${repo.root}`);
    if (probe.status !== 0) {
      result.git = probe.error?.code === 'ENOENT' ? 'unavailable' : /not a git repository/i.test(probe.stderr || '') ? 'not-a-repository' : 'check-failed';
      warnings.push(`${result.git}: ${repo.root}`);
      return result;
    }
    const gitRoot = noLinks(probe.stdout.trim());
    if (ws.context.mode === 'workspace-overlay' && !ws.context.sourceRoots.some(s => within(repo.root, s.target) && comparable(gitRoot) === comparable(s.gitRoot))) fail('Actual Git root differs from declared GitRoot');
    const head = git(repo.root, ['rev-parse', '--verify', 'HEAD']);
    const branch = git(repo.root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    result.git = 'available'; result.gitRoot = gitRoot;
    result.head = head.status === 0 ? head.stdout.trim() : null;
    result.branch = branch.status === 0 ? branch.stdout.trim() : null;
    result.changes = statusRecords(gitText(repo.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']), gitRoot, repo.root, ws.base);
    result.indexFingerprint = repo.scopes.length ? hash(gitText(repo.root, ['ls-files', '--stage', '-z', '--', ...repo.scopes])) : null;
    return result;
  });
  const evidence = inputs.evidence.map(binding => {
    try {
      // Validate the evidence scope before invoking the existing fingerprint reader.
      const stored = json(binding.evidenceFile);
      const saved = stored.suites?.[binding.suite];
      if (!saved) return { ...binding, reusable: false, reason: 'missing-evidence' };
      const safe = normalizeInputs(ws, { repositories: [{ root: binding.repoRoot, scopes: saved.scopes || ['.'] }] });
      fileRecords(safe.repositories[0].root, safe.repositories[0].scopes, ws.base);
      const checked = checkEvidence(binding.repoRoot, binding);
      return { ...binding, reusable: checked.reusable, reason: checked.reason, savedFingerprint: checked.saved?.fingerprint || null };
    } catch (error) { return { ...binding, reusable: false, reason: `unverified: ${error.message}` }; }
  });
  return { repositories, evidence, warnings };
}
function links(ws, doc, inputs) {
  const missing = inputs.entrypoints.filter(file => !fs.existsSync(file));
  const allowed = [ws.root, ws.context.capabilityRoot, ...inputs.repositories.map(r => r.root)];
  const body = doc.text.replace(/```[\s\S]*?```/g, '');
  for (const match of body.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)\)/g)) {
    let target = match[1].replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|obsidian:|#)/i.test(target)) continue;
    target = decodeURIComponent(target.split('#')[0]);
    if (!target) continue;
    const file = path.resolve(path.dirname(doc.file), target);
    if (!allowed.some(root => within(file, root))) { missing.push(`outside-declared-roots: ${target}`); continue; }
    noLinks(file);
    if (!fs.existsSync(file)) missing.push(file);
  }
  return [...new Set(missing)];
}
function ignoreLocal(ws) {
  const probe = git(ws.root, ['rev-parse', '--show-toplevel']);
  if (probe.status !== 0) {
    if (probe.error?.code === 'ENOENT') fail('Git unavailable: cannot ensure local-only handoff; install Git or configure local exclusion before init');
    if (/not a git repository/i.test(probe.stderr || '')) return { status: 'not-a-repository' };
    fail('Cannot determine project Git exclusion; no handoff created');
  }
  const root = probe.stdout.trim();
  const relative = path.relative(root, ws.base).replaceAll(path.sep, '/');
  if (gitText(root, ['ls-files', '-z', '--', relative]).trim()) fail('Handoff material is already tracked; preserve it and resolve tracking explicitly before init');
  const file = noLinks(gitText(root, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']).trim());
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const rule = `/${relative.replace(/([\\*?\[\]#! ])/g, '\\$1')}/`;
  if (!old.split(/\r?\n/).includes(rule)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${old && !old.endsWith('\n') ? '\n' : ''}${rule}\n`);
  }
  return { status: 'local-exclude', file };
}
function stateFile(directory) { return path.join(directory, 'state.json'); }
function readState(ws, directory) {
  const state = json(stateFile(directory));
  if (state.schema !== SCHEMA || state.taskKey !== path.basename(directory) || comparable(state.projectRoot || '') !== comparable(ws.root)) fail('Invalid state identity');
  return state;
}
function inspect(ws, directory, replacement) {
  directory = taskPath(ws, directory);
  const doc = document(directory);
  let previous = null, stateError = null;
  try { previous = readState(ws, directory); } catch (error) { stateError = error.message; }
  if (!previous && !replacement) return { task: doc.meta, valid: false, stateError, action: 'Supply --context-file after verifying roots and scopes', changes: ['state-unavailable'] };
  const inputs = normalizeInputs(ws, replacement || previous.inputs);
  const current = collect(ws, inputs);
  const changes = [];
  if (!previous) changes.push('state-unavailable');
  else {
    if (previous.documentHash !== doc.digest) changes.push('document-changed');
    if (!same(previous.inputs, inputs)) changes.push('inputs-changed');
    if (!same(previous.observed, current)) changes.push('workspace-changed');
  }
  const missingLinks = links(ws, doc, inputs);
  return { task: doc.meta, valid: changes.length === 0 && missingLinks.length === 0, changes, missingLinks, stateError, current, inputs, documentHash: doc.digest };
}
function checkpoint(ws, directory, replacement) {
  directory = taskPath(ws, directory);
  const doc = document(directory);
  const inputs = normalizeInputs(ws, replacement || readState(ws, directory).inputs);
  const missing = links(ws, doc, inputs);
  if (missing.length) fail(`Missing or invalid links: ${JSON.stringify(missing)}`);
  const observed = collect(ws, inputs);
  if (document(directory).digest !== doc.digest) fail('Document changed during capture; retry after review');
  const state = { schema: SCHEMA, taskKey: doc.meta.taskKey, projectRoot: ws.root, capturedAt: new Date().toISOString(), documentHash: doc.digest, inputs, observed };
  atomic(stateFile(directory), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}
function init(ws, options, input) {
  if (!options.title?.trim() || !['business-demand', 'framework-maintenance', 'other'].includes(options.taskKind)) fail('init requires --title and --task-kind');
  const inputs = normalizeInputs(ws, input);
  const observed = collect(ws, inputs);
  for (const file of inputs.entrypoints) if (!fs.existsSync(file)) fail(`Missing entrypoint: ${file}`);
  const ignored = ignoreLocal(ws);
  fs.mkdirSync(ws.base, { recursive: true });
  const demandId = String(options.demandId || '00000');
  const slug = demandId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || '00000';
  const directory = unique(ws.base, `-${slug}`, '', file => fs.mkdirSync(file));
  const meta = { schema: SCHEMA, taskKey: path.basename(directory), demandId, title: options.title, taskKind: options.taskKind, status: 'active', updatedAt: new Date().toISOString() };
  const frontmatter = Object.entries(meta).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
  const template = fs.readFileSync(path.join(__dirname, '../templates/task-handoff.md'), 'utf8');
  const text = `---\n${frontmatter}\n---\n\n${template}`;
  fs.writeFileSync(path.join(directory, 'handoff.md'), text, { flag: 'wx' });
  atomic(stateFile(directory), `${JSON.stringify({ schema: SCHEMA, taskKey: meta.taskKey, projectRoot: ws.root, capturedAt: new Date().toISOString(), documentHash: hash(text), inputs, observed }, null, 2)}\n`);
  return { directory, ignored, warnings: observed.warnings, next: 'Replace TODO sections, then checkpoint and validate before handoff' };
}
function list(ws, all = false) {
  const tasks = [], errors = [];
  if (!fs.existsSync(ws.base)) return { tasks, errors };
  for (const entry of fs.readdirSync(ws.base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    try {
      const directory = taskPath(ws, path.join(ws.base, entry.name));
      const doc = document(directory);
      if (all || doc.meta.status !== 'closed') tasks.push({ ...doc.meta, directory, resumePoint: doc.text.match(/^## 下一步\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1].trim() || '' });
    } catch (error) { errors.push({ directory: entry.name, error: error.message }); }
  }
  return { tasks, errors };
}
function validate(ws, directory) {
  const report = inspect(ws, directory);
  const doc = document(directory);
  const unfinished = /\bTODO\b/.test(doc.text);
  return { ...report, unfinished, valid: report.valid && !unfinished };
}
function snapshot(ws, directory) {
  directory = taskPath(ws, directory);
  const report = validate(ws, directory);
  if (!report.valid) fail(`Handoff is not ready: ${JSON.stringify(report)}`);
  const doc = document(directory);
  const state = readState(ws, directory);
  if (doc.digest !== state.documentHash || doc.digest !== report.documentHash) fail('Document changed before snapshot');
  const history = noLinks(path.join(directory, 'history'));
  fs.mkdirSync(history, { recursive: true });
  // History is one level deeper: keep standard relative Markdown links usable.
  const relocated = doc.text.split(/(```[\s\S]*?```)/g).map(part => part.startsWith('```') ? part : part.replace(/(!?\[[^\]]*\]\()(<[^>]+>|[^\s)]+)(\))/g, (match, prefix, raw, end) => {
    const target = raw.replace(/^<|>$/g, '');
    if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|#|\/)/.test(target) || path.isAbsolute(target)) return match;
    return `${prefix}${raw.startsWith('<') ? `<../${target}>` : `../${target}`}${end}`;
  })).join('');
  const body = `${relocated}\n\n## 交接时的机器现场\n\n采集时间：${state.capturedAt}；最新正文 SHA-256：${state.documentHash}（快照中的相对链接已调整一级）\n\n\`\`\`json\n${JSON.stringify(state.observed, null, 2)}\n\`\`\`\n`;
  const file = unique(history, '', '.md', target => fs.writeFileSync(target, body, { flag: 'wx' }));
  return { file, resume: path.join(directory, 'handoff.md') };
}
function parse(argv) {
  const [command, ...rest] = argv, options = {};
  const flags = new Set(['json', 'all', 'help']);
  const values = new Set(['project-root', 'task-directory', 'context-file', 'title', 'task-kind', 'demand-id']);
  for (let i = 0; i < rest.length; i++) {
    const raw = rest[i].replace(/^--/, '');
    if (!rest[i].startsWith('--') || (!flags.has(raw) && !values.has(raw))) fail(`Unknown option: ${rest[i]}`);
    const key = raw.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (Object.hasOwn(options, key)) fail(`Duplicate option: ${raw}`);
    options[key] = flags.has(raw) ? true : rest[++i];
    if (!options[key] || (typeof options[key] === 'string' && options[key].startsWith('--'))) fail(`Missing value: ${raw}`);
  }
  return { command, options };
}
function main(argv = process.argv.slice(2)) {
  const { command, options } = parse(argv);
  if (!command || command === 'help' || options.help) {
    process.stdout.write('task-handoff.js init|list|inspect|checkpoint|snapshot|validate --project-root <path> [--task-directory <path>] [--context-file <json>] [--title <text> --task-kind business-demand|framework-maintenance|other --demand-id <id>] [--all] [--json]\n');
    return 0;
  }
  if (!['init', 'list', 'inspect', 'checkpoint', 'snapshot', 'validate'].includes(command)) fail(`Unknown command: ${command}`);
  const ws = workspace(options.projectRoot);
  const input = options.contextFile ? json(options.contextFile) : undefined;
  let result;
  if (command === 'init') result = init(ws, options, input);
  else if (command === 'list') result = list(ws, options.all);
  else {
    const directory = taskPath(ws, options.taskDirectory);
    result = ({ inspect, checkpoint, snapshot, validate })[command](ws, directory, input);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return command === 'validate' && !result.valid ? 1 : 0;
}
if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { workspace, init, list, inspect, checkpoint, snapshot, validate, metadata, normalizeInputs, stamp, main };
