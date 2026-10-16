#!/usr/bin/env node
'use strict';

// Project migration is independent of the removed IRIS entry points.
const fs = require('node:fs');
const path = require('node:path');
const { resolveWorkspaceContext } = require('./lib/workspace-context');
const moves = [
  ['skills/iris-demand-commit/SKILL.md', 'demand-delivery-plugin/skills/demand-commit/SKILL.md'],
  ['skills/iris-demand-entry/SKILL.md', 'bos-plugin/skills/bos-demand-entry/SKILL.md'],
  ['scripts/iris-tools/commit-demand.js', 'demand-delivery-plugin/scripts/commit-demand.js'],
  ['scripts/iris-tools/demand-entry.js', 'bos-plugin/scripts/demand-entry.js'],
  ['scripts/iris-tools/demand-entry-xlsx.js', 'bos-plugin/scripts/demand-entry-xlsx.js'],
  ['references/commit-upstream-check.md', 'demand-delivery-plugin/references/commit-upstream-check.md'],
  ['references/standard-demand-entry.md', 'bos-plugin/references/standard-demand-entry.md'],
].map(([from, to]) => ['plugins/coding-iris-plugin/' + from, 'plugins/' + to]);
const names = { 'iris-demand-commit': ['demand-commit', 'demand-delivery-plugin'], 'iris-demand-entry': ['bos-demand-entry', 'bos-plugin'] };
const normalize = s => s.replace(/\\/g, '/');
const token = /(?<![\w-])iris-demand-(?:commit|entry)(?![\w-]|-plan)/g;
const exists = p => { try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
function safe(p, root) {
  for (let cursor = p;; cursor = path.dirname(cursor)) {
    const stat = exists(cursor);
    if (stat?.isSymbolicLink()) throw Error('linked path preserved: ' + cursor);
    if (cursor === root) return;
    if (path.dirname(cursor) === cursor) throw Error('path outside migration root: ' + p);
  }
}
function read(p) {
  const bytes = fs.readFileSync(p);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return text;
}
function managed(text, name, source) {
  // Recognize the complete generated body, not just a marker that custom text may retain.
  const body = `# 薄索引：${name}\n\n本文件是 thin-index / 薄索引，不包含完整 skill。\n\nAgent 指令：读取本文件后，必须继续读取并遵循插件内真实 skill：\n\n- \`${source}\`\n\n如任务涉及项目差异或服务器能力，还需要读取：\n\n- \`.agents/config/\`\n- \`.mcp.json\`\n\n不要把 MCP 连接信息复制到本文件。`;
  const cleaned = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  const match = cleaned.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  if (!match || match[2] !== body) return false;
  const fields = match[1].split('\n').map(l => l.match(/^(name|description|thin-index|source):\s*(.*)$/));
  if (fields.length !== 4 || fields.some(f => !f) || new Set(fields.map(f => f[1])).size !== 4) return false;
  const values = Object.fromEntries(fields.map(f => [f[1], f[2]]));
  return values.name === name && values['thin-index'] === 'true' && values.source === source;
}
function enabledPlugins(text) {
  return [...new Set([...text.matchAll(/^\|\s*([\w-]+)\s*\|\s*(enabled|initialized)\s*\|/gim)].map(m => m[1].toLowerCase()))].sort();
}
function plan(context, selected = [], excluded = [], expectedEnabled) {
  const { workspaceRoot: root, contextRoot: local, capabilityRoot: capability } = context;
  const changes = [], removals = [], owners = new Set(), conflicts = [], inspected = new Set();
  const skippedWorkspaces = new Map();
  const profile = path.join(local, 'config/plugin_profile.md');
  const addOwner = old => owners.add(names[old][1]);
  const oldFiles = new Set(Object.keys(names).map(n => path.join(local, 'skills', n, 'SKILL.md')));
  function transform(text, file) {
    let result = text;
    for (const [old, next] of moves) {
      if (normalize(result).includes(old)) {
        owners.add(next.split('/')[1]);
        result = result.split(old).join(next).split(old.replaceAll('/', '\\')).join(next.replaceAll('/', '\\'));
      }
    }
    // Markdown links may use relative paths instead of the logical .agents prefix.
    result = result.replace(/(?<=\]\()([^\s)]+)(?=\))/g, target => {
      const resolved = path.resolve(path.dirname(file), target);
      const move = moves.find(([old]) => resolved === path.join(capability, old));
      if (!move) return target;
      owners.add(move[1].split('/')[1]);
      return normalize(path.relative(path.dirname(file), path.join(capability, move[1])));
    });
    return result.replace(token, old => { addOwner(old); return names[old][0]; });
  }
  function inspect(file, editable) {
    if (inspected.has(file)) return;
    inspected.add(file);
    try {
      safe(file, file.startsWith(local + path.sep) ? local : root);
      const before = read(file), after = transform(before, file);
      if (after === before) return;
      if (!editable || /coding-iris-plugin[/\\](?:skills[/\\](?:demand-commit|bos-demand-entry)|scripts[/\\]iris-tools[/\\](?:commit-demand|demand-entry))/.test(after)) {
        conflicts.push('manual reference migration required: ' + file); return;
      }
      changes.push({ file, before, after });
    } catch (e) { conflicts.push(e.message); }
  }
  function walk(dir, all) {
    if (!exists(dir)) return;
    try { safe(dir, dir.startsWith(local) ? local : root); } catch (e) { conflicts.push(e.message); return; }
    // Nested checkouts and Agent contexts own their entrypoints. Never traverse
    // their links or migrate them as documents belonging to the outer project.
    if (dir !== root) {
      const agents = path.join(dir, '.agents');
      const agentStat = exists(agents);
      let reason;
      if (exists(path.join(dir, '.git'))) reason = 'nested-git-workspace';
      else if (agentStat?.isSymbolicLink()) reason = 'nested-linked-agent-context';
      else if (agentStat?.isDirectory() && (exists(path.join(agents, 'capability.json')) || exists(path.join(agents, '.git')))) reason = 'nested-agent-workspace';
      if (reason) { skippedWorkspaces.set(dir, { directory: dir, reason }); return; }
    }
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.agents', 'vendor', 'dist', 'build'].includes(item.name)) continue;
      const file = path.join(dir, item.name);
      if (item.isSymbolicLink()) { if (all || item.name === 'AGENTS.md') conflicts.push('linked path requires review: ' + file); continue; }
      if (item.isDirectory()) walk(file, all);
      else if (!oldFiles.has(file) && (all || item.name === 'AGENTS.md')) {
        if (/\.(md|json|ya?ml|toml|js|ps1|sh)$/i.test(file)) inspect(file, /\.md$/i.test(file));
      }
    }
  }
  walk(root, false);
  // Project-owned automation can invoke removed CLIs. Report it rather than rewriting code.
  for (const dir of ['.github', 'scripts']) walk(path.join(root, dir), true);
  for (const dir of ['config', 'rules', 'skills', 'workflows']) {
    const candidate = path.join(local, dir);
    // Shared Overlay framework directories are not project-owned documents.
    if (context.sharedDirectories?.some(item => item.name === dir) && exists(candidate)?.isSymbolicLink() && fs.realpathSync(candidate) === fs.realpathSync(path.join(capability, dir))) continue;
    walk(candidate, true);
  }
  for (const old of Object.keys(names)) {
    const file = path.join(local, 'skills', old, 'SKILL.md');
    if (!exists(path.dirname(file))) continue;
    addOwner(old); // Even an unrecognized old entry must block, not disappear as "no work".
    try {
      safe(file, local);
      const before = read(file), source = '.agents/plugins/coding-iris-plugin/skills/' + old + '/SKILL.md';
      if (!managed(before, old, source) || fs.readdirSync(path.dirname(file)).length !== 1) throw Error('custom old skill preserved: ' + file);
      addOwner(old); removals.push({ file, before });
    } catch (e) { conflicts.push(e.message); }
  }
  const stateChanges = [];
  function finish(before, after) {
    const enabledBefore = enabledPlugins(before), enabledAfter = enabledPlugins(after);
    if (expectedEnabled !== undefined) {
      const expected = [...new Set(expectedEnabled.map(n => n.trim().toLowerCase()))].sort();
      if (expected.some(n => !/^[a-z0-9][a-z0-9-]*$/.test(n))) conflicts.push('invalid expected enabled plugin name');
      else if (JSON.stringify(expected) !== JSON.stringify(enabledAfter)) conflicts.push('expected enabled plugin set mismatch; projected=' + enabledAfter.join(',') + '; expected=' + expected.join(','));
    }
    return { owners: [...owners], changes, removals, conflicts, stateChanges, enabledBefore, enabledAfter, skippedWorkspaces: [...skippedWorkspaces.values()] };
  }
  if (!owners.size && !removals.length && !changes.length) {
    let current = '';
    try { safe(profile, local); if (exists(profile)) current = read(profile); } catch (e) { conflicts.push(e.message); }
    return finish(current, current);
  }
  // Preserve the old entry's confirmed project facts outside its removed adapter.
  const deliveryProfile = path.join(local, 'config/demand_delivery_profile.md');
  try {
    safe(deliveryProfile, local);
    if (!exists(deliveryProfile)) {
      const irisProfile = path.join(local, 'config/iris_project_profile.md');
      safe(irisProfile, local);
      const irisText = exists(irisProfile) ? read(irisProfile) : '';
      const kind = irisText.match(/默认需求交付类型\s*[：:]\s*(standard|project)\b/)?.[1] || 'TODO';
      changes.push({ file: deliveryProfile, before: '', after: `# 需求交付配置\n\n- 默认需求交付类型：${kind}\n- 产品标识：${owners.has('bos-plugin') ? 'IRIS' : 'TODO'}\n\n由旧需求入口迁移；已有明确项目约定或用户输入优先。TODO 不代表已完成业务配置。\n` });
    }
  } catch (e) { conflicts.push(e.message); }
  let beforeProfile = '';
  try { safe(profile, local); if (exists(profile)) beforeProfile = read(profile); } catch (e) { conflicts.push(e.message); }
  const profileChange = changes.findIndex(c => c.file === profile);
  let afterProfile = (profileChange >= 0 ? changes.splice(profileChange, 1)[0].after : beforeProfile) || '# Plugin Profile\n\n| plugin | status | initSkill | dependsOn | notes |\n|---|---|---|---|---|\n';
  const oldState = beforeProfile.match(/^\|\s*coding-iris-plugin\s*\|\s*(available|disabled|indexed)\s*\|/im)?.[1];
  for (const owner of owners) {
    if ((selected.length && !selected.includes(owner)) || excluded.includes(owner)) conflicts.push('full update required; owner filtered: ' + owner);
    const row = new RegExp('^\\|\\s*' + owner + '\\s*\\|([^\\r\\n]*)', 'im');
    if ([...afterProfile.matchAll(new RegExp(row.source, 'gim'))].length > 1) conflicts.push('duplicate plugin state rows: ' + owner);
    const match = afterProfile.match(row);
    const status = match?.[1].split('|')[0].trim().toLowerCase();
    if (!match && oldState) conflicts.push('legacy plugin state requires explicit successor choice: coding-iris-plugin=' + oldState);
    if (match && !['enabled', 'initialized'].includes(status)) conflicts.push('explicit plugin state preserved: ' + owner + '=' + status);
    if (!match) {
      stateChanges.push({ plugin: owner, from: null, to: 'enabled' });
      afterProfile += `\n| ${owner} | enabled | ${owner === 'bos-plugin' ? 'bos-init' : '-'} | - | migrated demand capability |\n`;
    }
    const manifestPath = path.join(capability, 'plugins', owner, '.agents-plugin/plugin.json');
    try {
      const manifest = JSON.parse(read(manifestPath));
      for (const skill of fs.readdirSync(path.join(capability, 'plugins', owner, 'skills'))) {
        if (manifest.thinIndex?.excludeSkills?.includes(skill)) continue;
        const source = '.agents/plugins/' + owner + '/skills/' + skill + '/SKILL.md';
        if (!exists(path.join(capability, 'plugins', owner, 'skills', skill, 'SKILL.md'))) throw Error('missing new skill: ' + source);
        const target = path.join(local, 'skills', skill, 'SKILL.md'); safe(target, local);
        if (exists(target) && !managed(read(target), skill, source)) throw Error('custom new skill preserved: ' + target);
      }
    } catch (e) { conflicts.push(e.message); }
  }
  if (afterProfile !== beforeProfile) changes.push({ file: profile, before: beforeProfile, after: afterProfile });
  return finish(beforeProfile, afterProfile);
}
// A post-migration Check must verify discovery even when no legacy names remain.
function check(context, requiredOwners) {
  const conflicts = [], profile = path.join(context.contextRoot, 'config/plugin_profile.md');
  try {
    safe(profile, context.contextRoot);
    const enabled = requiredOwners || enabledPlugins(exists(profile) ? read(profile) : '');
    for (const owner of new Set(Object.values(names).map(n => n[1]))) {
      if (!enabled.includes(owner)) continue;
      const ownerRoot = path.join(context.capabilityRoot, 'plugins', owner);
      const manifest = JSON.parse(read(path.join(ownerRoot, '.agents-plugin/plugin.json')));
      const requiredSkill = Object.values(names).find(n => n[1] === owner)[0];
      read(path.join(ownerRoot, 'skills', requiredSkill, 'SKILL.md'));
      for (const skill of fs.readdirSync(path.join(ownerRoot, 'skills'))) {
        if (manifest.thinIndex?.excludeSkills?.includes(skill)) continue;
        const source = '.agents/plugins/' + owner + '/skills/' + skill + '/SKILL.md';
        const entry = path.join(context.contextRoot, 'skills', skill, 'SKILL.md');
        safe(entry, context.contextRoot);
        if (!managed(read(entry), skill, source)) throw Error('new entry not verified: ' + entry);
        const canonical = path.join(ownerRoot, 'skills', skill, 'SKILL.md');
        const logical = path.resolve(context.workspaceRoot, source);
        if (!fs.statSync(canonical).isFile() || fs.realpathSync(logical) !== fs.realpathSync(canonical)) throw Error('new entry target mismatch: ' + logical);
        read(logical);
      }
      const scripts = owner === 'bos-plugin' ? ['demand-entry.js', 'demand-entry-xlsx.js'] : ['commit-demand.js'];
      for (const script of scripts) read(path.join(ownerRoot, 'scripts', script));
    }
  } catch (e) { conflicts.push(e.message); }
  return conflicts;
}
function apply(context, p) {
  if (p.conflicts.length) throw Error(p.conflicts.join('\n'));
  const unreachable = check(context, p.owners);
  if (unreachable.length) throw Error(unreachable.join('\n'));
  for (const c of [...p.changes, ...p.removals]) {
    safe(c.file, c.file.startsWith(context.contextRoot + path.sep) ? context.contextRoot : context.workspaceRoot);
    if ((exists(c.file) ? read(c.file) : '') !== c.before) throw Error('migration input changed: ' + c.file);
  }
  for (const c of p.changes) {
    fs.mkdirSync(path.dirname(c.file), { recursive: true });
    const temporary = c.file + '.demand-migration-' + process.pid + '.tmp';
    let created = false;
    try {
      fs.writeFileSync(temporary, c.after, { flag: 'wx' }); created = true;
      if ((exists(c.file) ? read(c.file) : '') !== c.before) throw Error('migration input changed: ' + c.file);
      fs.renameSync(temporary, c.file);
    } finally { if (created && exists(temporary)) fs.unlinkSync(temporary); }
  }
  for (const c of p.removals) { fs.unlinkSync(c.file); fs.rmdirSync(path.dirname(c.file)); }
}
function main() {
  const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
  const context = resolveWorkspaceContext(value('--project-root'));
  if (!['standard', 'workspace-overlay'].includes(context.mode)) throw Error('invalid workspace context');
  const expected = args.find(arg => arg.startsWith('--expected-enabled='));
  const p = plan(context, args.includes('--selected') ? value('--selected').split(',').filter(Boolean) : [], args.includes('--excluded') ? value('--excluded').split(',').filter(Boolean) : [], expected === undefined ? undefined : expected.slice('--expected-enabled='.length).split(',').filter(Boolean));
  if (args.includes('--check')) {
    if (p.owners.length) p.conflicts.push('demand migration pending; run DryRun then Write');
    p.conflicts.push(...check(context));
  }
  if (args.includes('--apply') && !p.conflicts.length) apply(context, p);
  // Keep project text/private configuration out of logs and avoid PS5.1 console encoding loss.
  const summary = { schema: 'demand-ownership-plan/v1', owners: p.owners, stateChanges: p.stateChanges, enabledBefore: p.enabledBefore, enabledAfter: p.enabledAfter, skippedWorkspaces: p.skippedWorkspaces, changes: p.changes.map(c => ({ file: c.file })), removals: p.removals.map(c => ({ file: c.file })), conflicts: p.conflicts };
  console.log(JSON.stringify(summary).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
  if (p.conflicts.length) process.exitCode = 1;
}
if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { moves, plan, apply, managed, check };
