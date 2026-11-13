'use strict';
// Integration with the actual Windows PowerShell worker and selected Code.exe.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const [codeExe, packageDirectory] = process.argv.slice(2);
if (!codeExe || !packageDirectory) throw new Error('Usage: node ai-dev-objectscript.tests.cjs Code.exe package/tools');
const parent = fs.existsSync('D:/tmp') ? 'D:/tmp/Codex' : path.join(require('node:os').tmpdir(), 'Codex');
const root = fs.mkdtempSync(path.join(parent, 'ai-dev-objectscript-test-'));
const portable = fs.existsSync(path.join(path.dirname(codeExe), 'data'));
const extensions = portable ? path.join(path.dirname(codeExe), 'data', 'extensions') : path.join(root, 'user', '.vscode', 'extensions');
const settings = portable ? path.join(path.dirname(codeExe), 'data', 'user-data', 'User', 'settings.json') : path.join(root, 'appdata', 'Code', 'User', 'settings.json');
// Portable validation must receive a disposable, clean application copy.
if (portable && (fs.existsSync(extensions) || fs.existsSync(settings))) throw new Error('Portable test requires a clean disposable copy');
const realIndex = path.join(process.env.USERPROFILE, '.vscode', 'extensions', 'extensions.json');
const realBefore = fs.existsSync(realIndex) ? fs.readFileSync(realIndex) : null;
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
function run(request) {
  const file = path.join(root, 'request.json');
  fs.writeFileSync(file, JSON.stringify({action: 'extensionInstall', codeExe, ...request}));
  const child = spawnSync(path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', path.join(packageDirectory, 'gui-worker.ps1'), '-RequestFile', file],
    {encoding: 'utf8', windowsHide: true, timeout: 240000, env: {...process.env, APPDATA: path.join(root, 'appdata'), USERPROFILE: path.join(root, 'user'), HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9'}});
  if (child.error) throw child.error;
  return child;
}
try {
  fs.mkdirSync(path.dirname(settings), {recursive: true});
  const settingsBytes = Buffer.from('\uFEFF{\r\n  // user preference\r\n  "extensions.autoUpdate": true, "update.mode": "default"\r\n}\r\n');
  fs.writeFileSync(settings, settingsBytes);
  let result = run({});
  check(result.status === 0, result.stdout + result.stderr);
  const indexFile = path.join(extensions, 'extensions.json');
  const entries = () => JSON.parse(fs.readFileSync(indexFile));
  const objectscript = () => entries().find(entry => entry.identifier.id === 'intersystems-community.vscode-objectscript');
  const dependency = () => entries().find(entry => entry.identifier.id === 'intersystems-community.servermanager');
  check(objectscript().version === '3.8.3-SNAPSHOT', 'snapshot not installed');
  check(objectscript().metadata.pinned === true, 'ObjectScript auto update enabled');
  check(dependency().version === '3.16.0' && !dependency().metadata.pinned, 'new dependency unexpectedly pinned');
  check(fs.readFileSync(settings).equals(settingsBytes), 'global update settings changed');
  const beforeDependency = JSON.stringify(dependency());
  result = run({});
  check(result.status === 0, 'repeat failed: ' + result.stdout + result.stderr);
  check(JSON.stringify(dependency()) === beforeDependency, 'existing dependency changed');
  check(objectscript().metadata.pinned === true, 'repeat unpinned snapshot');
  check(fs.readFileSync(settings).equals(settingsBytes), 'repeat changed settings');
  fs.writeFileSync(path.join(extensions, '.ai-dev-objectscript.lock'), 'fixture');
  result = run({});
  check(result.status !== 0, 'concurrent installation accepted');
  fs.unlinkSync(path.join(extensions, '.ai-dev-objectscript.lock'));
  check(!fs.existsSync(path.join(extensions, '.ai-dev-servermanager-pending.json')), 'unfinished dependency state');
  if (realBefore) check(fs.readFileSync(realIndex).equals(realBefore), 'real user extensions modified');
  console.log(`${portable ? 'Portable' : 'Installed'} worker: ${checks} checks passed`);
} finally {
  if (path.dirname(path.resolve(root)) !== path.resolve(parent)) throw new Error('unsafe cleanup');
  fs.rmSync(root, {recursive: true, force: true});
}
