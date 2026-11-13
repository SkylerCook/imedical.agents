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
const childEnv = {...process.env, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'local'), USERPROFILE: path.join(root, 'user'), HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9'};
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
function run(request) {
  const file = path.join(root, 'request.json');
  fs.writeFileSync(file, JSON.stringify({action: 'extensionInstall', codeExe, ...request}));
  const child = spawnSync(path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', path.join(packageDirectory, 'gui-worker.ps1'), '-RequestFile', file],
    {encoding: 'utf8', windowsHide: true, timeout: 240000, env: childEnv});
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
  check(result.status === 0, 'legacy stale lock was not recovered');
  check(!fs.existsSync(path.join(extensions, '.ai-dev-objectscript.lock')), 'legacy lock remains');
  check(!fs.existsSync(path.join(extensions, '.ai-dev-servermanager-pending.json')), 'unfinished dependency state');
  fs.writeFileSync(path.join(extensions, '.ai-dev-servermanager-pending.json'), JSON.stringify({id: 'intersystems-community.servermanager', version: '0.0.0'}));
  result = run({});
  check(result.status === 0, 'stale dependency state blocked ObjectScript');
  check(JSON.stringify(dependency()) === beforeDependency, 'stale recovery overwrote dependency');
  check(!fs.existsSync(path.join(extensions, '.ai-dev-servermanager-pending.json')), 'stale dependency marker remains');

  const fixture = path.join(root, 'old-extension');
  fs.cpSync(path.join(extensions, objectscript().relativeLocation), fixture, {recursive: true});
  const oldPackage = JSON.parse(fs.readFileSync(path.join(fixture, 'package.json')));
  oldPackage.version = '3.8.2';
  delete oldPackage.__metadata;
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify(oldPackage));
  const oldArchive = path.join(root, 'old-version.vsix');
  const packaged = spawnSync(path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', path.join(packageDirectory, 'package-extension.ps1'), '-ExtensionDirectory', fixture, '-OutputFile', oldArchive],
    {env: childEnv, encoding: 'utf8', windowsHide: true});
  check(packaged.status === 0, 'fixture VSIX failed: ' + packaged.stderr);
  const cli = require(path.join(path.resolve(packageDirectory), 'install-objectscript.js')).locateCli(path.dirname(path.resolve(codeExe)));
  const installedOld = spawnSync(codeExe, [cli, '--user-data-dir', path.dirname(path.dirname(settings)), '--extensions-dir', extensions,
    '--install-extension', oldArchive, '--force', '--do-not-include-pack-dependencies'],
    {env: {...childEnv, ELECTRON_RUN_AS_NODE: '1'}, encoding: 'utf8', windowsHide: true});
  check(installedOld.status === 0 && objectscript().version === '3.8.2', 'old version fixture not installed: ' + installedOld.stderr);
  // Model the user's earlier auto-update choice before replacement.
  const oldIndex = entries();
  delete oldIndex.find(entry => entry.identifier.id === 'intersystems-community.vscode-objectscript').metadata.pinned;
  fs.writeFileSync(indexFile, JSON.stringify(oldIndex));
  const oldManifestPath = path.join(extensions, objectscript().relativeLocation, 'package.json');
  const oldManifest = JSON.parse(fs.readFileSync(oldManifestPath));
  delete oldManifest.__metadata.pinned;
  fs.writeFileSync(oldManifestPath, JSON.stringify(oldManifest));
  result = run({});
  check(result.status === 0 && objectscript().version === '3.8.3-SNAPSHOT', 'replacement failed: ' + result.stdout + result.stderr);
  const response = output => JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('PROJECT_RESULT:')).slice(15));
  const receiptFile = response(result.stdout).receiptFile;
  check(fs.existsSync(path.join(path.dirname(receiptFile), 'previous.vsix')), 'recovery VSIX missing');
  result = run({action: 'extensionInspect'});
  check(response(result.stdout).restoreAvailable && response(result.stdout).backupVersion === '3.8.2', 'recovery was not offered');
  result = run({action: 'extensionRestore', receiptFile});
  check(result.status === 0, 'restore failed: ' + result.stdout + result.stderr);
  check(objectscript().version === '3.8.2' && !objectscript().metadata.pinned, 'version or previous update setting not restored');
  check(fs.readFileSync(settings).equals(settingsBytes), 'restore changed global settings');
  result = run({});
  check(result.status === 0, 'reinstall after restore failed');
  const interruptedFile = response(result.stdout).receiptFile;
  const interrupted = JSON.parse(fs.readFileSync(interruptedFile));
  interrupted.state = 'prepared'; fs.writeFileSync(interruptedFile, JSON.stringify(interrupted));
  result = run({action: 'extensionInspect'});
  check(result.status === 0 && JSON.parse(fs.readFileSync(interruptedFile)).state === 'applied', 'completed install after interrupted acknowledgement was not recognized');
  interrupted.state = 'prepared'; fs.writeFileSync(interruptedFile, JSON.stringify(interrupted));
  const partialIndex = entries();
  delete partialIndex.find(entry => entry.identifier.id === 'intersystems-community.vscode-objectscript').metadata.pinned;
  fs.writeFileSync(indexFile, JSON.stringify(partialIndex));
  const partialManifestPath = path.join(extensions, objectscript().relativeLocation, 'package.json');
  const partialManifest = JSON.parse(fs.readFileSync(partialManifestPath)); delete partialManifest.__metadata.pinned;
  fs.writeFileSync(partialManifestPath, JSON.stringify(partialManifest));
  result = run({action: 'extensionInspect'});
  check(result.status === 0 && objectscript().version === '3.8.2' && !objectscript().metadata.pinned, 'incomplete install did not automatically recover');
  check(JSON.parse(fs.readFileSync(interruptedFile)).state === 'rolled-back', 'interrupted receipt not closed');
  if (realBefore) check(fs.readFileSync(realIndex).equals(realBefore), 'real user extensions modified');
  console.log(`${portable ? 'Portable' : 'Installed'} worker: ${checks} checks passed`);
} finally {
  if (path.dirname(path.resolve(root)) !== path.resolve(parent)) throw new Error('unsafe cleanup');
  fs.rmSync(root, {recursive: true, force: true});
}
