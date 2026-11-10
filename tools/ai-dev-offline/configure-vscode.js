'use strict';
// Standalone Windows settings editor. Never imports framework code or user modules.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const jsonc = require('./vendor/jsonc-parser/main');
const PROFILE = 'terminal.integrated.profiles.windows';
const AUTOMATION = 'terminal.integrated.automationProfile.windows';
const DEFAULT = 'terminal.integrated.defaultProfile.windows';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function fail(code) { throw new Error(code); }
function safePath(file, writable = false) {
  let current = path.resolve(file);
  while (true) {
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
    if (stat && (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1))) fail('linked-settings-path');
    if (writable && fs.existsSync(path.join(current, '.git'))) fail('settings-and-backups-must-stay-outside-git');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function parse(text) {
  const errors = [];
  const tree = jsonc.parseTree(text, errors, {allowTrailingComma: true, allowEmptyContent: true});
  if (errors.length) fail('invalid-settings-jsonc');
  if (!tree) return undefined;
  if (tree.type !== 'object') fail('settings-root-must-be-object');
  function visit(node) {
    if (node.type === 'object') {
      const keys = new Set();
      for (const property of node.children || []) {
        const key = property.children[0].value;
        if (keys.has(key)) fail('duplicate-settings-key');
        keys.add(key);
      }
    }
    for (const child of node.children || []) visit(child);
  }
  visit(tree);
  return tree;
}
function document(bytes, exists = true) {
  const bom = bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191]));
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(bom ? bytes.subarray(3) : bytes); }
  catch { fail('settings-must-be-utf8'); }
  const tree = parse(text);
  return {bytes, exists, bom, text, tree, sha: exists ? hash(bytes) : 'absent'};
}
function load(file) {
  safePath(file);
  return fs.existsSync(file) ? document(fs.readFileSync(file)) : document(Buffer.alloc(0), false);
}
function value(tree, keys) {
  const node = tree && jsonc.findNodeAtLocation(tree, keys);
  return {exists: !!node, value: node ? jsonc.getNodeValue(node) : undefined};
}
function spec(pwsh) {
  return [
    {path: [PROFILE, 'PowerShell 7', 'source'], value: undefined},
    {path: [PROFILE, 'PowerShell 7', 'path'], value: pwsh},
    {path: [PROFILE, 'PowerShell 7', 'icon'], value: 'terminal-powershell'},
    {path: [DEFAULT], value: 'PowerShell 7'},
    {path: [AUTOMATION, 'path'], value: pwsh},
    {path: [AUTOMATION, 'args'], value: ['-NoLogo', '-NoProfile']}
  ];
}
function formatting(text) {
  const indent = text.match(/\n([ \t]+)"/);
  return {insertSpaces: !indent || !indent[1].includes('\t'), tabSize: indent ? Math.min(indent[1].length, 8) : 2, eol: text.includes('\r\n') ? '\r\n' : '\n'};
}
function edit(text, changes) {
  if (!parse(text)) text += (text && !/[\r\n]$/.test(text) ? '\n' : '') + '{}\n';
  for (const change of changes) text = jsonc.applyEdits(text, jsonc.modify(text, change.path, change.value, {formattingOptions: formatting(text)}));
  parse(text);
  return text;
}
function encode(text, bom) { return Buffer.concat([bom ? Buffer.from([239, 187, 191]) : Buffer.alloc(0), Buffer.from(text, 'utf8')]); }
function plan(snapshot, pwsh) {
  if (!path.isAbsolute(pwsh) || path.basename(pwsh).toLowerCase() !== 'pwsh.exe') fail('explicit-pwsh-exe-required');
  const changes = [], created = new Map();
  for (const desired of spec(pwsh)) {
    for (let n = 1; n < desired.path.length; n++) {
      const prefix = desired.path.slice(0, n), node = snapshot.tree && jsonc.findNodeAtLocation(snapshot.tree, prefix);
      if (node && node.type !== 'object') fail('terminal-parent-must-be-object');
      if (!node && desired.value !== undefined) created.set(JSON.stringify(prefix), prefix);
    }
    const before = value(snapshot.tree, desired.path);
    if ((desired.value === undefined && !before.exists) || (before.exists && equal(before.value, desired.value))) continue;
    changes.push({...desired, conflict: before.exists, operation: desired.value === undefined ? 'remove' : before.exists ? 'replace' : 'add'});
  }
  return {changes, createdParents: [...created.values()], text: changes.length ? edit(snapshot.text, changes) : snapshot.text};
}
function checkPwsh(pwsh) {
  safePath(pwsh);
  if (!fs.statSync(pwsh).isFile()) fail('selected-pwsh-missing');
  const result = spawnSync(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], {encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16384});
  if (result.status !== 0 || result.stdout.trim() !== '7') fail('selected-executable-must-be-powershell-7');
}
function atomicWrite(file, bytes, expected) {
  safePath(file, true);
  if (load(file).sha !== expected) fail('settings-changed-during-operation');
  const temporary = path.join(path.dirname(file), '.ai-dev-pwsh-' + crypto.randomUUID() + '.tmp');
  try {
    fs.writeFileSync(temporary, bytes, {flag: 'wx', mode: 0o600});
    if (load(file).sha !== expected) fail('settings-changed-during-operation');
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function summary(file, pwsh, snapshot, planned) {
  return {state: planned.changes.length ? 'planned' : 'unchanged', settingsFile: file, pwshExe: pwsh, sha256: snapshot.sha,
    changes: planned.changes.map(c => ({path: c.path, operation: c.operation, value: c.value})),
    conflicts: planned.changes.filter(c => c.conflict).map(c => c.path)};
}
function saveReceipt(file, receipt) { fs.writeFileSync(file, JSON.stringify(receipt, null, 2), {mode: 0o600}); }
function apply(options, verifyPwsh = checkPwsh) {
  const file = path.resolve(options.file), pwsh = path.resolve(options.pwsh);
  safePath(file, true);
  const before = load(file), planned = plan(before, pwsh);
  if (options.expected && options.expected !== before.sha) fail('settings-changed-after-preview');
  if (!planned.changes.length) return summary(file, pwsh, before, planned);
  if (!options.replace && planned.changes.some(c => c.conflict)) fail('selected-terminal-keys-conflict-use-explicit-replace');
  verifyPwsh(pwsh);
  const after = encode(planned.text, before.bom), directory = path.dirname(file);
  fs.mkdirSync(directory, {recursive: true});
  const backup = path.join(directory, '.ai-dev-settings-backups', crypto.randomUUID());
  safePath(backup, true);
  fs.mkdirSync(backup, {recursive: true, mode: 0o700});
  if (before.exists) {
    fs.writeFileSync(path.join(backup, 'settings.original'), before.bytes, {flag: 'wx', mode: 0o600});
    if (hash(fs.readFileSync(path.join(backup, 'settings.original'))) !== before.sha) fail('settings-backup-readback-failed');
  }
  const receiptFile = path.join(backup, 'receipt.json');
  const receipt = {schema: 1, tool: 'ai-dev-vscode-shell', state: 'prepared', settingsFile: file, pwshExe: pwsh,
    beforeExists: before.exists, beforeSha: before.sha, afterSha: hash(after),
    changes: planned.changes.map(c => ({path: c.path})), createdParents: planned.createdParents};
  saveReceipt(receiptFile, receipt);
  if (JSON.parse(fs.readFileSync(receiptFile, 'utf8')).afterSha !== receipt.afterSha) fail('receipt-readback-failed');
  try {
    atomicWrite(file, after, before.sha);
    const verified = load(file);
    if (verified.sha !== receipt.afterSha || plan(verified, pwsh).changes.length) fail('settings-write-verification-failed');
    receipt.state = 'applied'; saveReceipt(receiptFile, receipt);
  } catch (error) {
    if (load(file).sha === receipt.afterSha) {
      if (before.exists) atomicWrite(file, before.bytes, receipt.afterSha); else fs.unlinkSync(file);
      receipt.state = 'reverted-after-failure'; saveReceipt(receiptFile, receipt);
    }
    throw error;
  }
  return {...summary(file, pwsh, before, planned), state: 'applied', sha256: receipt.afterSha, receiptFile};
}
function rollback(receiptFile) {
  receiptFile = path.resolve(receiptFile); safePath(receiptFile, true);
  const r = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  if (r.schema !== 1 || r.tool !== 'ai-dev-vscode-shell' || r.state !== 'applied' || !path.isAbsolute(r.settingsFile) || !path.isAbsolute(r.pwshExe)) fail('invalid-settings-receipt');
  const expectedParent = path.join(path.dirname(r.settingsFile), '.ai-dev-settings-backups');
  if (path.dirname(path.dirname(receiptFile)) !== expectedParent || path.basename(receiptFile) !== 'receipt.json') fail('receipt-location-mismatch');
  safePath(r.settingsFile, true);
  const originalFile = path.join(path.dirname(receiptFile), 'settings.original'); safePath(originalFile);
  const original = r.beforeExists ? load(originalFile) : document(Buffer.alloc(0), false);
  if (original.sha !== r.beforeSha) fail('settings-backup-hash-mismatch');
  const originalPlan = plan(original, r.pwshExe);
  if (r.afterSha !== hash(encode(originalPlan.text, original.bom)) || !equal(r.changes.map(c => c.path), originalPlan.changes.map(c => c.path))) fail('invalid-settings-receipt');
  const current = load(r.settingsFile), desired = spec(r.pwshExe);
  const used = new Set();
  for (const c of r.changes) {
    const key = JSON.stringify(c.path), expected = desired.find(s => equal(s.path, c.path));
    if (!expected || used.has(key)) fail('invalid-managed-change');
    used.add(key);
    const now = value(current.tree, c.path);
    if (now.exists !== (expected.value !== undefined) || !equal(now.value, expected.value)) fail('managed-terminal-key-changed-since-apply');
  }
  if (current.sha === r.afterSha) {
    if (original.exists) atomicWrite(r.settingsFile, original.bytes, current.sha); else fs.unlinkSync(r.settingsFile);
  } else {
    const inverse = r.changes.slice().reverse().map(c => ({path: c.path, value: value(original.tree, c.path).value}));
    let text = edit(current.text, inverse);
    const parents = plan(original, r.pwshExe).createdParents.sort((a, b) => b.length - a.length);
    for (const keys of parents) {
      const node = jsonc.findNodeAtLocation(parse(text), keys);
      if (node && node.type === 'object' && !node.children.length) text = edit(text, [{path: keys, value: undefined}]);
    }
    atomicWrite(r.settingsFile, encode(text, current.bom), current.sha);
  }
  r.state = 'rolled-back'; saveReceipt(receiptFile, r);
  return {state: 'rolled-back', settingsFile: r.settingsFile, receiptFile};
}
function main(args) {
  const options = {}; let replace = false;
  for (let n = 0; n < args.length; n++) {
    if (args[n] === '--replace') { replace = true; continue; }
    if (!['--action', '--settings', '--pwsh', '--expected-sha', '--receipt'].includes(args[n]) || !args[n + 1]) fail('invalid-settings-editor-argument');
    options[args[n++].slice(2)] = args[n];
  }
  if (options.action === 'rollback') return rollback(options.receipt || fail('receipt-required'));
  if (!['plan', 'apply'].includes(options.action) || !options.settings || !options.pwsh) fail('settings-and-pwsh-required');
  const file = path.resolve(options.settings), pwsh = path.resolve(options.pwsh);
  if (options.action === 'apply') return apply({file, pwsh, replace, expected: options['expected-sha']});
  const snapshot = load(file); return summary(file, pwsh, snapshot, plan(snapshot, pwsh));
}
module.exports = {parse, document, load, plan, edit, apply, rollback, main};
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2))) + '\n'); }
  catch (error) { process.stderr.write((error.code || error.message) + '\n'); process.exitCode = 1; }
}
