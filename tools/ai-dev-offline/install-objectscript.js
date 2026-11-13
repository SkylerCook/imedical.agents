'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const jsonc = require('./vendor/jsonc-parser/main');
const {safePath} = require('./configure-vscode');
const manifest = require('./extensions.json');

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function fail(message) { throw new Error(message); }
function atomic(file, bytes, before) {
  safePath(file);
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, bytes, {flag: 'wx'});
    if (before && !fs.readFileSync(file).equals(before)) fail('扩展记录已被其他进程修改，请重试。');
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function removePin(file, field) {
  const before = fs.readFileSync(file);
  const bom = before.subarray(0, 3).equals(Buffer.from([239, 187, 191]));
  const text = before.toString('utf8').replace(/^\uFEFF/, '');
  const changes = jsonc.modify(text, field, undefined, {formattingOptions: {insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n'}});
  atomic(file, Buffer.from((bom ? '\uFEFF' : '') + jsonc.applyEdits(text, changes)), before);
}
function locateCli(codeRoot) {
  const launcher = path.join(codeRoot, 'bin', 'code.cmd');
  const match = fs.readFileSync(launcher, 'utf8').match(/"%~dp0([^"\r\n]*[\\/]out[\\/]cli\.js)"/i);
  if (!match) fail('无法识别此 VS Code 的命令入口，请选择官方 Code.exe。');
  const cli = path.resolve(codeRoot, 'bin', match[1]);
  if (!cli.toLowerCase().startsWith((codeRoot + path.sep).toLowerCase()) || !fs.existsSync(cli)) fail('VS Code 命令入口不存在。');
  return cli;
}
function install(request) {
  const code = path.resolve(request.codeExe);
  if (path.basename(code).toLowerCase() !== 'code.exe' || !fs.existsSync(code)) fail('请选择已安装的 Code.exe。');
  const codeRoot = path.dirname(code);
  const cli = locateCli(codeRoot);
  const version = read(path.join(path.dirname(cli), '..', 'package.json')).version;
  const numbers = version.split('.').map(Number);
  const minimum = manifest.minimumCodeVersion.split('.').map(Number);
  if (numbers[0] !== minimum[0] || !Number.isFinite(numbers[1]) || numbers[1] < minimum[1]) {
    fail('此 ObjectScript 需要 VS Code ' + manifest.minimumCodeVersion + ' 或以上的 1.x 版本，当前为 ' + version);
  }
  const portable = fs.existsSync(path.join(codeRoot, 'data'));
  const userData = portable ? path.join(codeRoot, 'data', 'user-data') : path.join(process.env.APPDATA, 'Code');
  const extensions = portable ? path.join(codeRoot, 'data', 'extensions') : path.join(process.env.USERPROFILE, '.vscode', 'extensions');
  safePath(extensions);
  fs.mkdirSync(extensions, {recursive: true});
  const indexFile = path.join(extensions, 'extensions.json');
  const pendingFile = path.join(extensions, '.ai-dev-servermanager-pending.json');
  const lock = path.join(extensions, '.ai-dev-objectscript.lock');
  let descriptor;
  try { descriptor = fs.openSync(lock, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') fail('另一个扩展安装任务正在运行；若上次异常退出，请确认进程已结束后移除 ' + lock); throw error; }
  const installed = () => fs.existsSync(indexFile) ? read(indexFile) : [];
  const find = id => installed().find(entry => entry.identifier.id.toLowerCase() === id);
  const cliEnv = {...process.env, ELECTRON_RUN_AS_NODE: '1'};
  delete cliEnv.VSCODE_DEV;
  delete cliEnv.VSCODE_PORTABLE;
  if (portable) cliEnv.VSCODE_PORTABLE = path.join(codeRoot, 'data');
  function run(args) {
    const result = spawnSync(code, [cli, '--user-data-dir', userData, '--extensions-dir', extensions, ...args],
      {env: cliEnv, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024});
    if (result.error || result.status !== 0) fail('VS Code 扩展操作失败，可重试。' + (result.error ? result.error.message : result.stderr + result.stdout));
    return result.stdout;
  }
  function archive(component) {
    const roots = [path.join(__dirname, '..', 'packages', 'extensions'), path.join(__dirname, 'packages', 'extensions'),
      path.join(__dirname, 'payload', 'extensions'), path.join(__dirname, 'assets')];
    const file = roots.map(root => path.join(root, component.file)).find(file => fs.existsSync(file));
    if (!file) fail('缺少离线扩展 ' + component.file + '，请将扩展补充包解压到工具根目录。');
    const bytes = fs.readFileSync(file);
    if (bytes.length !== component.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== component.sha256) fail('离线扩展校验失败：' + component.file);
    return file;
  }
  function unpinNewDependency(component) {
    if (!fs.existsSync(pendingFile)) return;
    const pending = read(pendingFile);
    const entry = find(component.id);
    if (!entry) return;
    if (pending.id !== component.id || pending.version !== entry.version) fail('待恢复的 Server Manager 记录与当前版本不一致，请检查安装日志。');
    const location = path.resolve(extensions, entry.relativeLocation || '');
    if (!entry.relativeLocation || path.dirname(location) !== extensions) fail('扩展安装位置无法核验。');
    // VSIX installation pins new dependencies as well. Restore normal update
    // eligibility only for the dependency installed by this operation.
    removePin(path.join(location, 'package.json'), ['__metadata', 'pinned']);
    const index = installed().findIndex(value => value.identifier.id.toLowerCase() === component.id);
    removePin(indexFile, [index, 'metadata', 'pinned']);
    if (find(component.id).metadata?.pinned) fail('Server Manager 自动更新状态未恢复。');
    fs.unlinkSync(pendingFile);
  }
  try {
    // Ask VS Code to scan its own extension registry before modifying anything.
    run(['--list-extensions', '--show-versions']);
    const [dependency, objectscript] = manifest.extensions;
    const objectscriptArchive = archive(objectscript);
    const dependencyArchive = !find(dependency.id) ? archive(dependency) : null;
    if (!find(dependency.id)) {
      atomic(pendingFile, Buffer.from(JSON.stringify({id: dependency.id, version: dependency.version})));
      run(['--install-extension', dependencyArchive, '--force', '--do-not-include-pack-dependencies']);
    }
    unpinNewDependency(dependency);
    run(['--install-extension', objectscriptArchive, '--force', '--do-not-include-pack-dependencies']);
    const listing = run(['--list-extensions', '--show-versions']);
    const entry = find(objectscript.id);
    if (!entry || entry.version !== objectscript.version || entry.metadata?.pinned !== true || !listing.toLowerCase().includes((objectscript.id + '@' + objectscript.version).toLowerCase())) {
      fail('安装已执行，但版本或禁用自动更新状态未通过核验，请导出日志。');
    }
    return {state: 'installed', codeExe: code, version: objectscript.version, autoUpdate: false, portable, extensionsDirectory: extensions};
  } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(install(JSON.parse(fs.readFileSync(0, 'utf8'))))); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
module.exports = {install, locateCli};
