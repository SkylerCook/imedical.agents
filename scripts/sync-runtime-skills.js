'use strict';

// Project discovery adapters only. Never copy skills or modify the capability source.
const fs = require('node:fs');
const path = require('node:path');
const { resolveWorkspaceContext, validateWorkspaceContext } = require('./lib/workspace-context.js');
const adapters = { CodeBuddy: '.codebuddy', ClaudeCode: '.claude', Codex: null };
const same = (a, b) => process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b);
function stat(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function physicalChain(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path escapes project');
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const entry = stat(cursor);
    if (entry && (entry.isSymbolicLink() || !entry.isDirectory())) throw new Error(`Expected physical directory: ${cursor}`);
  }
}
function sync({ projectRoot = '.', runtime, mode = 'DryRun' }) {
  if (!Object.hasOwn(adapters, runtime)) throw new Error('runtime must be CodeBuddy, ClaudeCode or Codex');
  if (!['Check', 'DryRun', 'Write'].includes(mode)) throw new Error('mode must be Check, DryRun or Write');
  const root = fs.realpathSync(projectRoot);
  const context = resolveWorkspaceContext(root);
  const failures = validateWorkspaceContext(context).filter(x => !['workspace-context-resolved', 'junction-ok', 'local-path-ok'].includes(x.status));
  if (failures.length) throw new Error(`Invalid workspace context: ${failures.map(x => x.status).join(', ')}`);
  const source = path.join(context.contextRoot, 'skills');
  physicalChain(root, source);
  if (!stat(source)?.isDirectory()) throw new Error('Project skills missing; initialize/update the project first');
  const target = adapters[runtime] ? path.join(root, adapters[runtime], 'skills') : source;
  const output = (status, reason) => ({ status, runtime, source, target, reason });
  if (runtime === 'Codex') return output('runtime-adapter-reused', 'Codex uses the common project discovery layer');
  physicalChain(root, path.dirname(target));
  const current = stat(target); // lstat also detects dangling links; never replace existing content.
  if (current) {
    if (!current.isSymbolicLink()) return output('runtime-adapter-conflict', 'Existing directory/file preserved; review custom and legacy skills before migration');
    const linked = path.resolve(path.dirname(target), fs.readlinkSync(target));
    if (!same(linked, source) || !fs.existsSync(target)) return output('runtime-adapter-conflict', 'Wrong or broken link preserved; review and explicitly remove the link itself before retrying');
    if (!same(fs.realpathSync(target), fs.realpathSync(source))) return output('runtime-adapter-conflict', 'Resolved target mismatch');
    return output('runtime-adapter-unchanged', 'Project skill link is current');
  }
  if (mode !== 'Write') return output('runtime-adapter-planned', 'Create directory link; no files written');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  physicalChain(root, path.dirname(target));
  fs.symlinkSync(process.platform === 'win32' ? source : path.relative(path.dirname(target), source), target,
    process.platform === 'win32' ? 'junction' : 'dir');
  if (!same(fs.realpathSync(target), fs.realpathSync(source))) throw new Error('Link verification failed');
  return output('runtime-adapter-linked', 'Directory link verified; host discovery still requires host evidence');
}
function main(args) {
  if (args.includes('--help')) {
    console.log('Usage: node sync-runtime-skills.js --project-root <project> --runtime CodeBuddy|ClaudeCode|Codex --mode Check|DryRun|Write');
    return;
  }
  const options = {};
  const keys = { '--project-root': 'projectRoot', '--runtime': 'runtime', '--mode': 'mode' };
  for (let i = 0; i < args.length; i += 2) {
    if (!keys[args[i]] || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(options, keys[args[i]])) throw new Error('Invalid or duplicate argument');
    options[keys[args[i]]] = args[i + 1];
  }
  const result = sync(options);
  console.log(JSON.stringify(result));
  if (result.status === 'runtime-adapter-conflict' || (options.mode === 'Check' && result.status === 'runtime-adapter-planned')) process.exitCode = 1;
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) {
    console.log(JSON.stringify({ status: 'runtime-adapter-blocked', reason: error.message }));
    process.exitCode = 2;
  }
}
module.exports = { sync };
