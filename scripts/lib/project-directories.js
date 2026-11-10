"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveWorkspaceContext, workspaceContextBlockers } = require('./workspace-context');
const SCHEMA = 'imedical-documentation-layout/v1';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const slash = value => value.split(path.sep).join('/');
const same = (a,b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
function within(file, root) { const rel = path.relative(path.resolve(root), path.resolve(file)); return !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); }
function relative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split('/').some(s => !s || s === '.' || s === '..' || s.toLowerCase() === '.git' || /[:*?"<>|]/.test(s) || /[. ]$/.test(s))) throw Error('Unsafe relative path: ' + value);
  return value;
}
function safePath(root, rel) {
  relative(rel); const file = path.resolve(root, rel);
  if (!within(file, root) || same(file, root)) throw Error('Path escapes root: ' + rel);
  if (fs.lstatSync(root).isSymbolicLink()) throw Error('Root must be physical: ' + root);
  let cursor = root;
  for (const part of rel.split('/')) {
    cursor = path.join(cursor, part);
    let st; try { st = fs.lstatSync(cursor); } catch (e) { if (e.code === 'ENOENT') break; throw e; }
    if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile()) || (st.isFile() && st.nlink !== 1)) throw Error('Linked or special path preserved: ' + cursor);
  }
  return file;
}
function json(file) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file))); }
function description(entry) {
  for (const key of ['purpose','boundary','lifecycle']) if (entry[key] !== undefined && (typeof entry[key] !== 'string' || !entry[key].trim() || /[\r\n]/.test(entry[key]))) throw Error('Invalid directory description: ' + key);
  if (entry.examples !== undefined && (!Array.isArray(entry.examples) || !entry.examples.length || entry.examples.some(v => typeof v !== 'string' || !v.trim() || /[\r\n]/.test(v)))) throw Error('Invalid directory examples');
}
function contextFor(root) {
  let ancestor = path.resolve(root);
  for (;;) {
    const st = fs.lstatSync(ancestor);
    if (!st.isDirectory() || st.isSymbolicLink()) throw Error('Workspace ancestors must be physical directories: ' + ancestor);
    const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
  }
  const context = resolveWorkspaceContext(path.resolve(root));
  if (!['standard','workspace-overlay'].includes(context.mode)) throw Error('Invalid workspace context');
  if (context.mode === 'workspace-overlay') {
    const blockers = workspaceContextBlockers(context);
    if (blockers.length) throw Error('Invalid Overlay: ' + blockers.map(b => b.status).join(', '));
  }
  safePath(context.workspaceRoot, slash(path.relative(context.workspaceRoot, context.contextRoot)));
  return context;
}
function configFor(context) {
  if (!fs.existsSync(context.contextRoot)) return null;
  const file = safePath(context.contextRoot, 'config/documentation-layout.json');
  if (!fs.existsSync(file)) return null;
  const config = json(file);
  if (config.schema !== SCHEMA || typeof config.enabled !== 'boolean' || !same(config.workspaceRoot || '', context.workspaceRoot) || !Array.isArray(config.extensions)) throw Error('Invalid documentation layout config; preserve and review');
  for (const item of config.extensions) {
    if (!item || typeof item.purpose !== 'string' || !item.purpose.trim() || !item.path.startsWith('docs/')) throw Error('Extension needs docs path and purpose');
    safePath(context.workspaceRoot, item.path);
    description(item);
  }
  if (new Set(config.extensions.map(e=>e.path.toLowerCase())).size !== config.extensions.length) throw Error('Duplicate extension path');
  return config;
}
function enabledPlugins(context) {
  const file = safePath(context.contextRoot, 'config/plugin_profile.md');
  if (!fs.existsSync(file)) throw Error('plugin_profile.md missing; enable plugins before directory setup');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file));
  const enabled = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*\|\s*([a-z0-9-]+)\s*\|\s*(enabled|available|disabled)\s*\|/);
    if (m && m[2] === 'enabled') enabled.add(m[1]);
  }
  return enabled;
}
function inventory(context, all = false) {
  const enabled = enabledPlugins(context);
  const root = path.join(context.capabilityRoot, 'plugins');
  const result = [];
  for (const name of fs.readdirSync(root).sort()) {
    if (!/^[a-z0-9-]+$/.test(name) || (!all && !enabled.has(name))) continue;
    const plugin = path.join(root, name);
    if (!fs.lstatSync(plugin).isDirectory() || fs.lstatSync(plugin).isSymbolicLink()) throw Error('Plugin directory must be physical: ' + name);
    const manifestFile = path.join(plugin, '.agents-plugin/plugin.json');
    if (!fs.existsSync(manifestFile)) continue;
    const manifest = json(manifestFile);
    if (manifest.name !== name) throw Error('Plugin identity mismatch: ' + name);
    const ids = new Set();
    for (const entry of manifest.projectDirectories || []) {
      if (!entry || !/^[a-z0-9-]+$/.test(entry.id) || ids.has(entry.id) || !['workspace','context','capability'].includes(entry.base) || !['knowledge','delivery','runtime','recovery','source','temporary','capability'].includes(entry.role) || !['setup','task','never'].includes(entry.create)) throw Error('Invalid projectDirectories in ' + name);
      ids.add(entry.id); relative(entry.path);
      description(entry);
      if (entry.base === 'capability' && entry.create !== 'never') throw Error('Capability assets are read-only');
      if (entry.base === 'context' && !entry.path.startsWith('work/')) throw Error('Context output must be inside work/');
      if (entry.base === 'workspace' && !entry.path.startsWith('docs/')) throw Error('Workspace documentation must be inside docs/');
      const base = context[entry.base === 'workspace' ? 'workspaceRoot' : entry.base === 'context' ? 'contextRoot' : 'capabilityRoot'];
      // Shared assets are inventoried by logical path; no creation or traversal through Overlay links.
      const target = entry.base === 'capability' ? path.join(base, entry.path) : safePath(base, entry.path);
      result.push({ ...entry, owner: name, enabled: enabled.has(name), target });
    }
  }
  for (const name of enabled) if (!fs.existsSync(path.join(root, name, '.agents-plugin/plugin.json'))) throw Error('Enabled plugin missing: ' + name);
  return result;
}
function resolveDirectory(projectRoot, owner, id, fallback) {
  const context = contextFor(projectRoot), config = configFor(context);
  if (!config || !config.enabled) return path.resolve(context.workspaceRoot, fallback);
  const entry = inventory(context).find(e => e.owner === owner && e.id === id);
  if (!entry) throw Error('Directory declaration missing or owner not enabled: ' + owner + '/' + id);
  return entry.target;
}
function fingerprint(context) {
  const files = [path.join(context.contextRoot,'config/plugin_profile.md'),path.join(context.contextRoot,'config/documentation-layout.json'), context.manifestPath].filter(Boolean);
  const plugins = path.join(context.capabilityRoot, 'plugins');
  for (const name of fs.readdirSync(plugins).sort()) if (/^[a-z0-9-]+$/.test(name)) {
    const file = path.join(plugins,name,'.agents-plugin/plugin.json'); if (fs.existsSync(file)) files.push(file);
  }
  return digest(JSON.stringify(files.map(file => [file, fs.existsSync(file) ? digest(fs.readFileSync(file)) : null])));
}
module.exports = { SCHEMA, digest, slash, same, within, relative, safePath, json, description, contextFor, configFor, enabledPlugins, inventory, resolveDirectory, fingerprint };
