'use strict';

// Native Agent adapters are separate from skill discovery and canonical definitions.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveWorkspaceContext, workspaceContextBlockers } = require('./lib/workspace-context.js');
const marker = '# imedical.agents Codex adapter v1 sha256=';
const buddyMarker = '<!-- imedical.agents CodeBuddy adapter v1 sha256=';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const stat = file => { try { return fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
function physical(root, target) {
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Target escapes project');
  let cursor = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const entry = stat(cursor);
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) throw new Error(`Expected physical directory: ${cursor}`);
  }
}
// Only name and description need scalar decoding; other YAML stays intact as instructions.
function definition(text, expected) {
  const match = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${expected}: missing YAML frontmatter`);
  const scalar = key => {
    const values = match[1].split(/\r?\n/).filter(line => line.startsWith(`${key}:`));
    if (values.length !== 1) throw new Error(`${expected}: requires one ${key}`);
    let value = values[0].slice(key.length + 1).trim();
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw new Error(`${expected}: invalid ${key}`);
      value = value.slice(1, -1).replace(/''/g, "'");
    } else if (/^[|>&*!{[]/.test(value) || /\s#/.test(value)) throw new Error(`${expected}: ${key} must be a single-line plain or quoted scalar`);
    if (!value || /[\r\n]/.test(value)) throw new Error(`${expected}: invalid ${key}`);
    return value;
  };
  const name = scalar('name');
  if (name !== expected) throw new Error(`${expected}: name must match directory`);
  return { name, description: scalar('description') };
}
function managed(text) {
  if (text.startsWith('---\n')) {
    const m = text.match(/<!-- imedical\.agents CodeBuddy adapter v1 sha256=([a-f0-9]{64}) -->\n$/);
    return !!m && hash(text.slice(0, m.index)) === m[1];
  }
  const end = text.indexOf('\n');
  return end >= 0 && text.slice(0, end) === marker + hash(text.slice(end + 1));
}
function render(name, text, source) {
  const data = definition(text, name);
  const instructions = `Canonical source: ${source}\nResolve relative links in the definition against its source directory, not .codex/agents. Read the target project's AGENTS.md before execution. YAML fields below are framework instructions, not Codex sandbox settings. Parent permissions and explicit authorization remain authoritative.\n\n${text}`;
  const body = `name = ${JSON.stringify(data.name)}\ndescription = ${JSON.stringify(data.description)}\ndeveloper_instructions = ${JSON.stringify(instructions)}\n`;
  return marker + hash(body) + '\n' + body;
}
function renderBuddy(name, text, source) {
  const data = definition(text, name);
  const body = `---
name: ${JSON.stringify(data.name)}
description: ${JSON.stringify(data.description)}
agentMode: agentic
enabled: true
enabledAutoRun: false
---

Read the target project's AGENTS.md first. Then read the complete canonical Agent definition at this project-relative path: ${JSON.stringify(source)}. Treat its YAML metadata and Markdown body as the role contract; follow its workflow and dependency references. Resolve relative links against the canonical source directory. Parent permissions and explicit authorization remain authoritative. Do not execute if the canonical definition cannot be read.
`;
  return body + buddyMarker + hash(body) + ' -->\n';
}
function sync({ projectRoot = '.', runtime = 'Codex', mode = 'DryRun' } = {}) {
  if (!['Codex', 'CodeBuddy', 'WorkBuddy'].includes(runtime)) throw new Error('Supported native Agent runtimes: Codex, CodeBuddy, WorkBuddy');
  const buddy = runtime !== 'Codex';
  if (!['Check', 'DryRun', 'Write'].includes(mode)) throw new Error('Invalid mode');
  const root = fs.realpathSync(projectRoot);
  const context = resolveWorkspaceContext(root);
  const blockers = workspaceContextBlockers(context);
  if (blockers.length) throw new Error(`Invalid workspace context: ${blockers.map(x => x.status).join(', ')}`);
  const sourceRoot = path.join(context.capabilityRoot, 'agents');
  const targetRoot = path.join(root, buddy ? '.codebuddy' : '.codex', 'agents');
  physical(root, targetRoot);
  if (!stat(sourceRoot)?.isDirectory()) throw new Error('Canonical agents missing; update capability first');
  const plans = [];
  const names = new Set();
  for (const name of fs.readdirSync(sourceRoot).filter(x => /^[a-z0-9]+(?:-[a-z0-9]+)*-agent$/.test(x)).sort()) {
    const source = path.join(sourceRoot, name, 'AGENT.md');
    const target = path.join(targetRoot, name + (buddy ? '.md' : '.toml'));
    names.add(path.basename(target));
    const reference = path.relative(root, source).split(path.sep).join('/');
    const content = (buddy ? renderBuddy : render)(name, fs.readFileSync(source, 'utf8'), reference);
    const existing = stat(target);
    const old = existing?.isFile() && !existing.isSymbolicLink() ? fs.readFileSync(target, 'utf8') : null;
    const status = existing && (old === null || !managed(old)) ? 'conflict' : old === content ? 'unchanged' : 'planned';
    plans.push({ status, source, target, content });
  }
  if (stat(targetRoot)) for (const file of fs.readdirSync(targetRoot).filter(x => x.endsWith(buddy ? '.md' : '.toml') && !names.has(x))) {
    const target = path.join(targetRoot, file), entry = stat(target);
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const old = fs.readFileSync(target, 'utf8');
    if (buddy ? old.includes(buddyMarker) : old.startsWith(marker)) plans.push({ status: managed(old) ? 'stale' : 'conflict', target });
  }
  for (const item of plans) if (mode === 'Write') {
    if (item.status === 'planned') {
      fs.mkdirSync(targetRoot, { recursive: true });
      physical(root, targetRoot);
      fs.writeFileSync(item.target, item.content, 'utf8');
      item.status = 'generated';
    } else if (item.status === 'stale') { fs.unlinkSync(item.target); item.status = 'removed'; }
  }
  const items = plans.map(({ content, ...item }) => item);
  const failed = items.some(x => x.status === 'conflict' || (mode === 'Check' && ['planned', 'stale'].includes(x.status)));
  return { status: failed ? 'runtime-agent-conflict' : 'runtime-agent-ready', runtime, target: targetRoot, source: sourceRoot, reason: 'Native files only; host discovery and invocation require separate verification', items, failed };
}
function main(args) {
  if (args.includes('--help')) return console.log('Usage: node sync-runtime-agents.js --project-root <project> --runtime Codex|CodeBuddy|WorkBuddy --mode Check|DryRun|Write');
  const keys = { '--project-root': 'projectRoot', '--runtime': 'runtime', '--mode': 'mode' }, options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!keys[args[i]] || !args[i + 1] || Object.hasOwn(options, keys[args[i]])) throw new Error('Invalid or duplicate argument');
    options[keys[args[i]]] = args[i + 1];
  }
  const result = sync(options); console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1;
}
if (require.main === module) try { main(process.argv.slice(2)); } catch (error) { console.log(JSON.stringify({ status: 'runtime-agent-blocked', reason: error.message })); process.exitCode = 2; }
module.exports = { sync, render, renderBuddy, managed };
