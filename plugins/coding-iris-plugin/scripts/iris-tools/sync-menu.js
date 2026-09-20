'use strict';

// Acquisition uses the existing MCP through iris-menu-sync; this tool is offline.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveWorkspaceContext, validateWorkspaceContext } = require('../../../../scripts/lib/workspace-context');
const SCHEMA = 'iris-menu-snapshot/v1';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function fail(message) { throw new Error(message); }
function text(v, label) { return typeof v === 'string' && v.trim() && !/[\u0000-\u001f]/.test(v) ? v : fail(`Invalid ${label}`); }
function id(v) { return /^[A-Za-z0-9_-]+$/.test(text(v, 'id')) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(v) ? v : fail('Invalid id'); }
function unique(items, label) {
  if (new Set(items.map(i => i.id)).size !== items.length) fail(`Duplicate ${label} id`);
  return items;
}
function nodes(items, depth = 0) {
  if (!Array.isArray(items) || depth > 64) fail('Invalid menu tree');
  return unique(items.map(item => ({ id: id(item.id), text: text(item.text, 'menu text'),
    code: String(item.code || ''), url: String(item.url || ''), children: nodes(item.children || [], depth + 1) })), 'sibling menu');
}
function normalize(input) {
  if (input.schema !== SCHEMA || input.complete !== true) fail('A complete acquisition is required');
  if (!['all', 'groups'].includes(input.scope)) fail('scope must be all or groups');
  id(input.sourceId);
  if (!Number.isFinite(Date.parse(input.capturedAt))) fail('capturedAt must be a timestamp');
  if (!Array.isArray(input.groups)) fail('groups must be an array');
  const groups = unique(input.groups.map(g => ({ id: id(g.id), name: text(g.name, 'group name'),
    menus: nodes(g.menus), capturedAt: input.capturedAt })), 'group').sort((a,b) => a.id.localeCompare(b.id));
  if (input.scope === 'groups' && !groups.length) fail('Selected groups cannot be empty');
  if (input.scope === 'all' && !Array.isArray(input.catalog)) fail('Full sync requires a separate menu catalog');
  if (input.scope === 'groups' && input.catalog !== undefined) fail('Partial sync must not replace the catalog');
  const catalog = input.scope === 'all' ? unique(input.catalog.map(i => ({ id: id(i.id),
    text: text(i.text, 'catalog text'), code: String(i.code || ''), url: String(i.url || ''),
    parentId: String(i.parentId || '') })), 'catalog').sort((a,b) => a.id.localeCompare(b.id)) : undefined;
  return { schema: SCHEMA, sourceId: input.sourceId, scope: input.scope, capturedAt: input.capturedAt,
    groups, ...(catalog ? { catalog } : {}) };
}
function noLinks(root) {
  let current = path.resolve(root);
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('Output cannot traverse links');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
function current(root) {
  noLinks(root);
  const pointer = path.join(root, 'current.json');
  if (!fs.existsSync(pointer)) return { snapshot: null, revision: 'none' };
  noLinks(pointer); const p = read(pointer);
  if (p.schema !== 'iris-menu-current/v1' || !/^[0-9a-f-]{36}$/.test(p.generation)) fail('Invalid current pointer');
  const file = path.join(root, p.generation, 'snapshot.json'); noLinks(file); const snapshot = read(file);
  if (hash(snapshot) !== p.revision || snapshot.schema !== SCHEMA) fail('Snapshot integrity check failed');
  return { snapshot, revision: p.revision, generation: p.generation };
}
function flatten(snapshot) {
  const result = new Map(); if (!snapshot) return result;
  for (const item of snapshot.catalog || []) result.set(`catalog/${item.id}`, item);
  const visit = (items, prefix) => items.forEach((item, order) => {
    const key = `${prefix}/${item.id}`, { children, ...value } = item;
    result.set(key, { ...value, order }); visit(children, key);
  });
  for (const group of snapshot.groups) { result.set(`group/${group.id}`, { name: group.name }); visit(group.menus, `group/${group.id}`); }
  return result;
}
function diff(before, after) {
  const old = flatten(before), next = flatten(after), result = { added: [], removed: [], changed: [] };
  for (const [key, value] of next) {
    if (!old.has(key)) result.added.push(key);
    else if (hash(value) !== hash(old.get(key))) result.changed.push(key);
  }
  for (const key of old.keys()) if (!next.has(key)) result.removed.push(key);
  return result;
}
function prepare(root, input, allowEmpty = false) {
  const incoming = normalize(input), previous = current(root);
  if (previous.snapshot && previous.snapshot.sourceId !== incoming.sourceId) fail('Source mismatch');
  if (incoming.scope === 'all' && (!incoming.groups.length || !incoming.catalog.length) && !allowEmpty) fail('Empty full snapshot requires --allow-empty');
  const groups = incoming.scope === 'all' ? [] : [...(previous.snapshot?.groups || [])];
  for (const group of incoming.groups) {
    const index = groups.findIndex(item => item.id === group.id);
    if (index < 0) groups.push(group); else groups[index] = group;
  }
  const snapshot = { schema: SCHEMA, sourceId: incoming.sourceId,
    coverage: incoming.scope === 'all' ? 'all' : (previous.snapshot?.coverage || 'groups'),
    catalogCapturedAt: incoming.scope === 'all' ? incoming.capturedAt : (previous.snapshot?.catalogCapturedAt || null),
    catalog: incoming.scope === 'all' ? incoming.catalog : (previous.snapshot?.catalog || []),
    groups: groups.sort((a,b) => a.id.localeCompare(b.id)) };
  return { snapshot, previous, inputHash: hash(incoming), changes: diff(previous.snapshot, snapshot) };
}
const cell = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/[\r\n]/g, ' ');
function render(snapshot) {
  const files = { 'Menu.md': '# Menu catalog\n\n| ID | Menu | Code | URL | Parent |\n|---|---|---|---|---|\n' +
    snapshot.catalog.map(i => `| ${[i.id,i.text,i.code,i.url,i.parentId].map(cell).join(' | ')} |`).join('\n') + '\n',
  'Group.md': '# Groups\n\n' + snapshot.groups.map(g => `- ${cell(g.name)}: group-menu/${g.id}.md`).join('\n') + '\n' };
  for (const group of snapshot.groups) {
    const lines = [`# ${cell(group.name)}`, '', `Captured: ${group.capturedAt}`, '', '| Menu path | Code | URL |', '|---|---|---|'];
    const visit = (items, parents) => items.forEach(item => {
      const trail = [...parents,item.text]; lines.push(`| ${[trail.join(' > '),item.code,item.url].map(cell).join(' | ')} |`); visit(item.children,trail);
    });
    visit(group.menus, []); files[`group-menu/${group.id}.md`] = lines.join('\n') + '\n';
  }
  return files;
}
function sync({ root, input, write = false, allowEmpty = false, expectHash, expectInput }) {
  noLinks(root);
  if (!write) { const p = prepare(root,input,allowEmpty); return { status:'planned', revision:p.previous.revision,inputHash:p.inputHash,changes:p.changes }; }
  fs.mkdirSync(root,{recursive:true}); const lock = path.join(root,'.lock'); fs.mkdirSync(lock);
  let generation, published = false, pointerTemp;
  try {
    const p = prepare(root,input,allowEmpty);
    if (expectHash !== p.previous.revision || expectInput !== p.inputHash) fail('Plan changed; run plan again');
    if (hash(p.snapshot) === p.previous.revision) return {status:'unchanged',revision:p.previous.revision,changes:p.changes};
    generation = crypto.randomUUID(); const dir = path.join(root,generation); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir,'snapshot.json'), JSON.stringify(p.snapshot,null,2)+'\n',{flag:'wx'});
    for (const [name,content] of Object.entries(render(p.snapshot))) {
      const file = path.join(dir,name); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,content,{flag:'wx'});
    }
    const revision = hash(p.snapshot); pointerTemp = path.join(root,`${generation}.tmp`);
    fs.writeFileSync(pointerTemp,JSON.stringify({schema:'iris-menu-current/v1',generation,revision,previous:p.previous.generation || null})+'\n',{flag:'wx'});
    fs.renameSync(pointerTemp,path.join(root,'current.json')); published = true;
    return { status:'applied',revision,generation,changes:p.changes };
  } finally {
    if (pointerTemp && fs.existsSync(pointerTemp)) fs.unlinkSync(pointerTemp);
    if (generation && !published) fs.rmSync(path.join(root,generation),{recursive:true,force:true});
    fs.rmdirSync(lock);
  }
}
function resolveProject(workspace) {
  const context = resolveWorkspaceContext(path.resolve(workspace));
  if (context.mode === 'invalid') fail('Invalid workspace context');
  if (context.mode !== 'standard') {
    const checks = validateWorkspaceContext(context);
    if (checks.some(c => !['workspace-context-resolved','junction-ok','local-path-ok'].includes(c.status))) fail('Overlay must pass workspace context validation');
  }
  if (fs.existsSync(path.join(context.workspaceRoot,'plugins','coding-iris-plugin','.agents-plugin','plugin.json'))) fail('Choose a business project, not the capability repository');
  return context;
}
function main(argv) {
  if (argv.includes('--help')) { console.log('sync-menu.js plan|apply --project-root <workspace> --input <snapshot.json> [--allow-empty] [--expect-hash <revision> --expect-input <inputHash>]'); return; }
  const mode = argv.shift(); if (!['plan','apply'].includes(mode)) fail('Use plan or apply'); const opts = {};
  while (argv.length) { const key = argv.shift(); if (key === '--allow-empty') {opts.allowEmpty=true;continue;}
    if (!['--project-root','--input','--expect-hash','--expect-input'].includes(key) || !argv.length || argv[0].startsWith('--')) fail('Invalid arguments');
    if (opts[key]) fail('Duplicate argument'); opts[key] = argv.shift(); }
  if (!opts['--project-root'] || !opts['--input']) fail('Explicit project root and input required');
  const context = resolveProject(opts['--project-root']);
  const input = read(path.resolve(opts['--input'])); id(input.sourceId);
  const root = path.join(context.contextRoot,'work','menu-sync',input.sourceId);
  console.log(JSON.stringify(sync({root,input,write:mode==='apply',allowEmpty:opts.allowEmpty,
    expectHash:opts['--expect-hash'],expectInput:opts['--expect-input']}),null,2));
}
module.exports = {normalize,prepare,diff,render,sync,current,main,resolveProject,noLinks,id};
if (require.main === module) {try {main(process.argv.slice(2));} catch(error) {console.error(error.message);process.exitCode=1;}}
