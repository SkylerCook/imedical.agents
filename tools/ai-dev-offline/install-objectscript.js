'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const jsonc = require('./vendor/jsonc-parser/main');
const {safePath} = require('./configure-vscode');
const manifest = require('./extensions.json');
const runtime = require('./operation-runtime');

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
function setPin(file, field, value) {
  const before = fs.readFileSync(file);
  const bom = before.subarray(0, 3).equals(Buffer.from([239, 187, 191]));
  const text = before.toString('utf8').replace(/^\uFEFF/, '');
  const changes = jsonc.modify(text, field, value || undefined, {formattingOptions: {insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n'}});
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
async function install(request) {
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
  return runtime.withLock(extensions, request, () => {
  const warnings = [];
  const backupRoot = path.join(extensions, '.ai-dev-objectscript-backups');
  const installed = () => fs.existsSync(indexFile) ? read(indexFile) : [];
  const find = id => installed().find(entry => entry.identifier.id.toLowerCase() === id);
  const cliEnv = {...process.env, ELECTRON_RUN_AS_NODE: '1'};
  delete cliEnv.VSCODE_DEV;
  delete cliEnv.VSCODE_PORTABLE;
  if (portable) cliEnv.VSCODE_PORTABLE = path.join(codeRoot, 'data');
  function run(args, message = '正在调用 VS Code…') {
    runtime.checkCancelled(request);
    runtime.progress(request, message);
    const result = spawnSync(code, [cli, '--user-data-dir', userData, '--extensions-dir', extensions, ...args],
      {env: cliEnv, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024});
    if (result.error || result.status !== 0) fail('VS Code 扩展操作失败，可重试。' + (result.error ? result.error.message : result.stderr + result.stdout));
    return result.stdout;
  }
  function archive(component) {
    const roots = [path.join(__dirname, '..', 'packages', 'extensions'), path.join(__dirname, 'packages', 'extensions'),
      path.join(__dirname, 'payload', 'extensions'), path.join(__dirname, 'assets')];
    const candidates = [request.archives?.[component.id], ...roots.map(root => path.join(root, component.file))];
    const file = candidates.find(file => file && fs.existsSync(file));
    if (!file) fail(request.archiveErrors?.[component.id] || '缺少离线扩展 ' + component.file + '，请点击「离线包…」选择 ZIP 或目录。');
    const bytes = fs.readFileSync(file);
    if (bytes.length !== component.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== component.sha256) fail('离线扩展校验失败：' + component.file);
    return file;
  }
  function location(entry) {
    const folder = path.resolve(extensions, entry.relativeLocation || '');
    if (!entry.relativeLocation || path.dirname(folder).toLowerCase() !== extensions.toLowerCase()) fail('扩展安装位置无法核验。');
    safePath(folder);
    return folder;
  }
  function updatePin(component, pinned) {
    const entry = find(component.id);
    if (!entry) fail('未找到需要核验的扩展。');
    setPin(path.join(location(entry), 'package.json'), ['__metadata', 'pinned'], pinned);
    const index = installed().findIndex(value => value.identifier.id.toLowerCase() === component.id);
    setPin(indexFile, [index, 'metadata', 'pinned'], pinned);
    if (!!find(component.id).metadata?.pinned !== pinned) fail('扩展自动更新状态未能核验。');
  }
  function unpinNewDependency(component) {
    if (!fs.existsSync(pendingFile)) return;
    try {
      const pending = read(pendingFile);
      const entry = find(component.id);
      if (!entry || pending.id !== component.id || pending.version !== entry.version) {
        warnings.push('Server Manager 已被后续操作变更，已保留其当前状态并清理过期记录。');
        fs.unlinkSync(pendingFile);
        return;
      }
      updatePin(component, false);
      fs.unlinkSync(pendingFile);
    } catch (error) {
      warnings.push('Server Manager 更新状态恢复未完成，ObjectScript 安装将继续。下次操作会重试。' + error.message);
    }
  }
  function fingerprint(entry) {
    const folder = location(entry);
    const hash = crypto.createHash('sha256');
    function visit(directory) {
      for (const name of fs.readdirSync(directory).sort()) {
        const file = path.join(directory, name);
        safePath(file);
        const stat = fs.statSync(file);
        if (stat.isDirectory()) visit(file);
        else {
          const relative = path.relative(folder, file).replace(/\\/g, '/');
          if (relative === '.vsixmanifest') continue;
          let bytes = fs.readFileSync(file);
          if (relative === 'package.json') {const value = read(file); delete value.__metadata; bytes = Buffer.from(JSON.stringify(value));}
          hash.update(relative).update(bytes);
        }
      }
    }
    visit(folder);
    return hash.digest('hex');
  }
  function receipts() {
    if (!fs.existsSync(backupRoot)) return [];
    safePath(backupRoot);
    const result = [];
    for (const directory of fs.readdirSync(backupRoot)) {
      if (!/^[a-f0-9-]{36}$/.test(directory)) continue;
      const file = path.join(backupRoot, directory, 'receipt.json');
      safePath(file);
      if (!fs.existsSync(file)) continue;
      const receipt = read(file);
      if (receipt.schema === 1 && receipt.tool === 'ai-dev-objectscript' && receipt.extensionsDirectory === extensions) result.push({file, receipt});
    }
    return result.sort((a, b) => b.receipt.created.localeCompare(a.receipt.created));
  }
  function save(record) {atomic(record.file, Buffer.from(JSON.stringify(record.receipt, null, 2) + '\n'));}
  function backup(entry, component) {
    runtime.progress(request, entry ? '正在备份已安装的 ObjectScript '+entry.version+'…' : '正在记录首次安装状态…');
    const directory = path.join(backupRoot, crypto.randomUUID());
    safePath(directory);
    fs.mkdirSync(directory, {recursive: true});
    const record = {file: path.join(directory, 'receipt.json'), receipt: {
      schema: 1, tool: 'ai-dev-objectscript', extensionsDirectory: extensions, created: new Date().toISOString(),
      state: 'preparing', beforeVersion: entry?.version || null, beforePinned: !!entry?.metadata?.pinned,
      beforeFingerprint: entry ? fingerprint(entry) : null, afterVersion: component.version
    }};
    save(record);
    if (entry) {
      const file = path.join(directory, 'previous.vsix');
      const powershell = path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', path.join(__dirname, 'package-extension.ps1'),
        '-ExtensionDirectory', location(entry), '-OutputFile', file], {encoding: 'utf8', windowsHide: true});
      if (result.error || result.status !== 0) fail('旧版本备份未完成，已保留原扩展。' + (result.error?.message || result.stderr));
      if (fingerprint(find(component.id)) !== record.receipt.beforeFingerprint) fail('备份期间扩展已被其他操作变更，请重新检查。');
      record.receipt.archiveHash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
    runtime.checkCancelled(request);
    record.receipt.state = 'prepared'; save(record);
    return record;
  }
  function restore(record, component) {
    const previous = record.receipt;
    if (previous.beforeVersion) {
      const file = path.join(path.dirname(record.file), 'previous.vsix');
      safePath(file);
      if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== previous.archiveHash) fail('旧版本恢复包校验失败。');
      run(['--install-extension', file, '--force', '--do-not-include-pack-dependencies'], '正在恢复 ObjectScript '+previous.beforeVersion+'…');
      updatePin(component, previous.beforePinned);
      const entry = find(component.id);
      if (entry.version !== previous.beforeVersion || fingerprint(entry) !== previous.beforeFingerprint) fail('旧版本恢复结果未通过校验，请保留恢复包并查看日志。');
    } else if (find(component.id)) {
      run(['--uninstall-extension', component.id, '--force'], '正在撤销未完成的首次安装…');
      if (find(component.id)) fail('未完成的首次安装尚未撤销。');
    }
    previous.state = 'rolled-back'; save(record);
  }
  function recover(component) {
    for (const record of receipts()) {
      const receipt = record.receipt;
      if (receipt.state === 'preparing') {
        // No installation is dispatched until the backup is complete.
        const partial = path.join(path.dirname(record.file), 'previous.vsix.partial');
        if (fs.existsSync(partial)) {safePath(partial); fs.unlinkSync(partial);}
        receipt.state = 'cancelled-before-install'; save(record);
      }
      if (receipt.state !== 'prepared') continue;
      const entry = find(component.id);
      if (entry?.version === receipt.afterVersion && entry.metadata?.pinned === true) {
        receipt.afterFingerprint = fingerprint(entry); receipt.state = 'applied'; save(record);
      } else if (entry?.version === receipt.beforeVersion && fingerprint(entry) === receipt.beforeFingerprint) {
        receipt.state = 'cancelled-before-install'; save(record);
      } else if (!entry || entry.version === receipt.afterVersion) {
        restore(record, component);
        warnings.push('已从上次未完成的安装恢复，可以继续操作。');
      } else {
        receipt.state = 'superseded'; save(record);
        warnings.push('ObjectScript 已有后续版本变更，保留当前版本；旧恢复包仍保留。');
      }
    }
  }
  const [dependency, objectscript] = manifest.extensions;
  run(['--list-extensions', '--show-versions'], '正在检查所选 VS Code 的扩展…');
  recover(objectscript);
  unpinNewDependency(dependency);
  const entry = find(objectscript.id);
  const previous = receipts().find(record => record.receipt.state === 'applied' && record.receipt.beforeVersion && record.receipt.beforeVersion !== record.receipt.afterVersion);
  function result() {
    const current = find(objectscript.id);
    const saved = receipts().find(record => record.receipt.state === 'applied' && record.receipt.beforeVersion && record.receipt.beforeVersion !== record.receipt.afterVersion);
    return {codeExe: code, version: current?.version || '', autoUpdate: !current?.metadata?.pinned,
      dependencyPresent: !!find(dependency.id), dependencyVersion: find(dependency.id)?.version || '',
      portable, extensionsDirectory: extensions, warnings, backupVersion: saved?.receipt.beforeVersion || '',
      restoreAvailable: !!saved && current?.version === saved.receipt.afterVersion,
      receiptFile: saved?.file || '', backupDescription: current ? '替换前自动备份当前 '+current.version+'，可从本窗口恢复。' : '首次安装，当前没有需要恢复的旧版本。'};
  }
  if (request.action === 'extensionInspect') return {...result(), state: 'inspected'};
  if (request.action === 'extensionRestore') {
    if (!previous || request.receiptFile && path.resolve(request.receiptFile) !== previous.file) fail('未找到可用的上次版本恢复记录，请重新检查。');
    if (!entry || entry.version !== previous.receipt.afterVersion || fingerprint(entry) !== previous.receipt.afterFingerprint || entry.metadata?.pinned !== true) fail('扩展已有后续变更，已保留当前状态，请重新检查。');
    restore(previous, objectscript);
    return {...result(), state: 'restored'};
  }
  if (request.action && request.action !== 'extensionInstall') fail('无效的扩展操作。');
  const objectscriptArchive = archive(objectscript);
  const dependencyArchive = !find(dependency.id) ? archive(dependency) : null;
  if (!find(dependency.id)) {
    atomic(pendingFile, Buffer.from(JSON.stringify({id: dependency.id, version: dependency.version})));
    run(['--install-extension', dependencyArchive, '--force', '--do-not-include-pack-dependencies'], '正在补装 Server Manager…');
    unpinNewDependency(dependency);
  }
  if (entry?.version === objectscript.version && entry.metadata?.pinned === true) return {...result(), state: 'unchanged'};
  const record = backup(entry, objectscript);
  try {
    run(['--install-extension', objectscriptArchive, '--force', '--do-not-include-pack-dependencies'], '正在安装指定 ObjectScript 版本…');
    const listing = run(['--list-extensions', '--show-versions'], '正在核验版本及自动更新状态…');
    const current = find(objectscript.id);
    if (!current || current.version !== objectscript.version || current.metadata?.pinned !== true || !listing.toLowerCase().includes((objectscript.id + '@' + objectscript.version).toLowerCase())) {
      fail('安装结果的版本或自动更新状态未通过核验。');
    }
    record.receipt.afterFingerprint = fingerprint(current); record.receipt.state = 'applied'; save(record);
  } catch (error) {
    // Cancellation leaves the prepared receipt for the next invocation, while
    // ordinary failures attempt immediate restoration under the same lock.
    if (!request.cancelFile || !fs.existsSync(request.cancelFile)) {
      try {restore(record, objectscript);} catch (recovery) {fail(error.message+' 恢复尚未完成：'+recovery.message);}
    }
    throw error;
  }
  return {...result(), state: 'installed'};
  }, path.join(extensions, '.ai-dev-objectscript.lock'));
}
if (require.main === module) {
  (async () => {
    try {process.stdout.write(JSON.stringify(await install(JSON.parse(fs.readFileSync(0, 'utf8')))));}
    catch (error) {process.stderr.write(error.message+'\n');process.exitCode=1;}
  })();
}
module.exports = {install, locateCli};
