#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveWorkspaceContext } = require('./lib/workspace-context');
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

function readableFile(file, root) {
  try {
    const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
    if (!fs.statSync(file).isFile()) return false;
    const fd = fs.openSync(file, 'r');
    fs.closeSync(fd);
    return true;
  } catch { return false; }
}

function checkAvailability({ capabilityRoot, contextRoot, plugin, stage }) {
  if (!namePattern.test(plugin || '')) throw Error('Invalid --plugin');
  if (stage !== undefined && !namePattern.test(stage)) throw Error('Invalid --stage');
  const pluginRoot = path.join(capabilityRoot, 'plugins', plugin);
  const manifest = readJson(path.join(pluginRoot, '.agents-plugin/plugin.json'));
  if (manifest.name !== plugin) throw Error('Plugin manifest name mismatch');
  const entries = manifest.availableDependencies ?? [];
  if (!Array.isArray(entries)) throw Error('availableDependencies must be an array');
  const keys = new Set();
  for (const entry of entries) {
    if (!entry || !namePattern.test(entry.plugin || '') || !namePattern.test(entry.stage || '') ||
        typeof entry.trigger !== 'string' || !entry.trigger.trim() || !Array.isArray(entry.entries) || !entry.entries.length ||
        entry.entries.some(p => typeof p !== 'string' || !/^[\w.-]+(?:\/[\w.-]+)+$/.test(p) || p.split('/').some(s => s === '..' || s === '.'))) {
      throw Error('Invalid availableDependencies declaration');
    }
    const key = `${entry.stage}:${entry.plugin}`;
    if (keys.has(key)) throw Error('Duplicate availableDependencies declaration: ' + key);
    keys.add(key);
  }
  if (stage && !entries.some(e => e.stage === stage)) throw Error('Undeclared dependency stage: ' + stage);
  const profileFile = path.join(contextRoot, 'config/plugin_profile.md');
  const profile = new Map();
  if (fs.existsSync(profileFile)) {
    for (const match of fs.readFileSync(profileFile, 'utf8').matchAll(/^\|\s*`?([\w-]+)`?\s*\|\s*(available|enabled|disabled|initialized|indexed)\s*\|/gim)) {
      const key = match[1].toLowerCase(), status = match[2].toLowerCase();
      if (profile.has(key) && profile.get(key) !== status) throw Error('Conflicting plugin profile: ' + key);
      profile.set(key, status);
    }
  }
  const checks = entries.filter(e => !stage || e.stage === stage).map(entry => {
    const root = path.join(capabilityRoot, 'plugins', entry.plugin);
    const problems = [];
    let target;
    try {
      const file = path.join(root, '.agents-plugin/plugin.json');
      if (!readableFile(file, root)) throw Error('unreadable');
      target = readJson(file);
      if (target.name !== entry.plugin) throw Error('name mismatch');
    } catch { problems.push('manifest-missing-or-invalid'); }
    const names = [entry.plugin, ...(Array.isArray(target?.legacyNames) ? target.legacyNames : [])];
    if (names.some(n => profile.get(String(n).toLowerCase()) === 'disabled')) problems.push('plugin-disabled');
    for (const file of entry.entries) {
      if (!readableFile(path.join(root, file), root)) problems.push('entry-unreadable:' + file);
    }
    return { ...entry, available: problems.length === 0, problems };
  });
  return { schema: 'plugin-availability/v1', plugin, stage: stage || null, ok: checks.every(c => c.available), checks };
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--project-root', '--capability-root', '--context-root', '--plugin', '--stage'].includes(key) ||
        !argv[i + 1] || argv[i + 1].startsWith('--') || args[key]) throw Error('Invalid argument: ' + key);
    args[key] = argv[i + 1];
  }
  const context = resolveWorkspaceContext(path.resolve(args['--project-root'] || '.'));
  if (context.mode === 'invalid') throw Error('Invalid workspace context');
  const result = checkAvailability({ capabilityRoot: path.resolve(args['--capability-root'] || context.capabilityRoot),
    contextRoot: path.resolve(args['--context-root'] || context.contextRoot), plugin: args['--plugin'], stage: args['--stage'] });
  // Keep the machine channel valid under Windows legacy console code pages.
  console.log(JSON.stringify(result, null, 2).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
  // Inventory is advisory; only an explicitly selected stage blocks execution.
  if (args['--stage'] && !result.ok) process.exitCode = 1;
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
module.exports = { checkAvailability };
