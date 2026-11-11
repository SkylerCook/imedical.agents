'use strict';
// Local configuration only. This program never opens an IRIS connection.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {isDeepStrictEqual} = require('node:util');
const editor = require('./configure-vscode');
const jsonc = require('./vendor/jsonc-parser/main');
const parseToml = require('./vendor/iarna-toml/parse-string');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const failure = message => { throw new Error(message); };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const BACKUPS = '.ai-dev-config-backups';
const LOCK = '.ai-dev-config.lock';

function snapshot(file) {
  editor.safePath(file);
  const exists = fs.existsSync(file);
  const bytes = exists ? fs.readFileSync(file) : Buffer.alloc(0);
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { failure('配置文件需要使用 UTF-8 编码。'); }
  return {file, exists, bytes, text, bom: bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])), hash: exists ? sha(bytes) : 'absent'};
}
function object(text) {
  const tree = editor.parse(text);
  return tree ? JSON.parse(JSON.stringify(jsonc.getNodeValue(tree))) : {};
}
function toml(text) {
  try { return parseToml(text); }
  catch { failure('TOML 解析失败，请检查原配置语法。原文和凭据不会写入日志。'); }
}
function jsonChanges(before, changes) {
  // Validate every parent before editing, including previously created parents.
  let text = before.text;
  for (const change of changes) {
    const tree = editor.parse(text);
    for (let n = 1; n < change.path.length; n++) {
      const node = tree && jsonc.findNodeAtLocation(tree, change.path.slice(0, n));
      if (node && node.type !== 'object') failure('待修改配置的父节点需要是 JSON 对象。');
    }
    const node = tree && jsonc.findNodeAtLocation(tree, change.path);
    if (!node && change.value === undefined) continue;
    if (node && isDeepStrictEqual(JSON.parse(JSON.stringify(jsonc.getNodeValue(node))), change.value)) continue;
    text = editor.edit(text, [change]);
  }
  return editor.encode(text, before.bom);
}
function editToml(before, updates) {
  const original = toml(before.text), eol = before.text.includes('\r\n') ? '\r\n' : '\n';
  let text = before.text;
  for (const [key, desired] of Object.entries(updates)) {
    if (own(original, key) && isDeepStrictEqual(original[key], desired)) continue;
    const line = key + ' = ' + JSON.stringify(desired) + eol;
    if (!own(original, key)) { text = line + text; continue; }
    const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
    let offset = 0, found = false;
    for (let i = 0; i < lines.length; i++) {
      const start = offset;
      offset += lines[i].length;
      if (!new RegExp('^\\s*(?:' + key + '|"' + key + '"|\'' + key + '\')\\s*=').test(lines[i])) continue;
      let prefix;
      try { prefix = parseToml(text.slice(0, start)); } catch { continue; }
      // A match inside a multiline string or a later table is not the root key.
      if (own(prefix, key)) continue;
      let end = offset;
      for (let j = i; j < lines.length; j++) {
        if (j > i) end += lines[j].length;
        let candidate;
        try { candidate = parseToml(text.slice(0, end)); } catch { continue; }
        if (!own(candidate, key)) break;
        text = text.slice(0, start) + line + text.slice(end);
        found = true;
        break;
      }
      if (found) break;
    }
    if (!found) failure('无法安全定位 TOML 顶层连接字段，请检查原配置结构。');
  }
  const expected = {...original, ...updates};
  if (!isDeepStrictEqual(toml(text), expected)) failure('TOML 合并校验失败，未写入文件。');
  return editor.encode(text, before.bom);
}
function projectRoot(request) {
  if (!request.projectRoot || !path.isAbsolute(request.projectRoot)) failure('请选择项目文件夹。');
  const root = path.resolve(request.projectRoot);
  editor.safePath(root);
  if (!fs.statSync(root).isDirectory()) failure('项目文件夹不存在。');
  return root;
}
function userSettings(request) {
  if (!request.codeExe || !path.isAbsolute(request.codeExe) || path.basename(request.codeExe).toLowerCase() !== 'code.exe' || !fs.existsSync(request.codeExe)) failure('请选择有效的 Code.exe。');
  if (request.userDataMode === 'Portable') {
    const data = path.join(path.dirname(request.codeExe), 'data');
    if (!fs.existsSync(data)) failure('所选 VS Code 没有 data 目录，请选择普通安装模式。');
    return path.join(data, 'user-data', 'User', 'settings.json');
  }
  if (request.userDataMode !== 'Installed' || !process.env.APPDATA) failure('请选择 VS Code 用户设置模式。');
  return path.join(process.env.APPDATA, 'Code', 'User', 'settings.json');
}
function inspect(request) {
  const root = projectRoot(request);
  const settings = object(snapshot(path.join(root, '.vscode', 'settings.json')).text);
  const mcp = object(snapshot(path.join(root, '.mcp.json')).text);
  const config = toml(snapshot(path.join(root, '.iris-agentic-dev.toml')).text);
  const conn = settings['objectscript.conn'] || {};
  const alias = conn.server || 'project';
  const server = settings['intersystems.servers']?.[alias] || {};
  const env = mcp.mcpServers?.['iris-agentic-dev']?.env || {};
  const entry = mcp.mcpServers?.['iris-agentic-dev'];
  let executable = '';
  if (entry?.args?.some(a => /(?:^|[\\/])iris-session-mcp\.js$/.test(a))) {
    const backend = object(snapshot(path.join(root, '.agents', 'config', 'iris-session-backend.json')).text);
    if (typeof backend.command === 'string') executable = path.resolve(root, backend.command);
  } else if (/(?:^|[\\/])iris-agentic-dev(?:\.exe)?$/i.test(entry?.command || '')) executable = path.resolve(root, entry.command);
  return {state: 'inspected', alias, host: server.webServer?.host || env.IRIS_HOST || config.host || '',
    port: server.webServer?.port || Number(env.IRIS_WEB_PORT) || config.web_port || 0,
    scheme: server.webServer?.scheme || env.IRIS_SCHEME || config.scheme || 'http',
    namespace: conn.ns || env.IRIS_NAMESPACE || config.namespace || '', description: server.description || '',
    hasCredentials: !!(env.IRIS_PASSWORD || config.password), hasMcp: !!mcp.mcpServers?.['iris-agentic-dev'], mcpExe: executable,
    tlsVerify: String(env.IRIS_TLS_VERIFY ?? config.tls_verify ?? false).toLowerCase() === 'true'};
}
function connection(request) {
  const c = request.connection;
  if (!c || !['http', 'https'].includes(c.scheme) || !Number.isInteger(c.port) || c.port < 1 || c.port > 65535) failure('请选择 HTTP/HTTPS，并填写有效 Web 端口。');
  for (const key of ['host', 'namespace', 'alias']) {
    if (typeof c[key] !== 'string' || !c[key].trim() || /[\x00-\x20\x7f]/.test(c[key])) failure('请完整填写服务器名称、主机和命名空间。');
  }
  if (/[\/\\?#@]/.test(c.host)) failure('主机字段只填写域名或 IP，协议和端口使用各自输入框。');
  if (['__proto__', 'prototype', 'constructor'].includes(c.alias)) failure('请更换服务器名称。');
  if (c.writeCredentials && (typeof c.username !== 'string' || !c.username.trim() || typeof c.password !== 'string' || !c.password)) failure('请填写本机使用的账号和密码，或选择保留已有凭据。');
  return c;
}
function updateArgs(args, c, configFile) {
  if (!Array.isArray(args) || args[0] !== 'mcp' || args.some(arg => typeof arg !== 'string')) failure('MCP 启动参数无法识别，请先核对现有入口。');
  const fields = {'--host': c.host, '--web-port': String(c.port), '--scheme': c.scheme, '--namespace': c.namespace, '--config': configFile};
  const next = args.slice();
  if (next.some(arg => /^--(?:username|password)(?:=|$)/.test(arg))) failure('现有 MCP 将账号密码放在命令行中，请先迁入本机私有配置。');
  for (let i = 1; i < next.length; i++) {
    const flag = next[i].split('=')[0];
    if (!own(fields, flag)) continue;
    if (next[i].includes('=')) next[i] = flag + '=' + fields[flag];
    else {
      if (!next[i + 1] || next[i + 1].startsWith('--')) failure('MCP 参数缺少值。');
      next[++i] = fields[flag];
    }
  }
  if (!next.some(arg => arg === '--config' || arg.startsWith('--config='))) next.push('--config', configFile);
  return next;
}
function ensurePrivate(root, files, gitExe, requireIgnored = false) {
  let current = root, repository = false;
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) { repository = true; break; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!repository) return;
  // Git resolves nested repositories and worktrees. No credentials are sent to it.
  for (const file of files) {
    let directory = path.dirname(file);
    while (!fs.existsSync(directory)) directory = path.dirname(directory);
    const result = spawnSync(gitExe || 'git.exe', ['-C', directory, 'ls-files', '--error-unmatch', '--', path.relative(directory, file)], {windowsHide: true, encoding: 'utf8', timeout: 10000});
    if (result.error || result.status === null || ![0, 1].includes(result.status)) failure('需要可用的 Git 检查项目私有配置是否已被跟踪。请安装 Git 或选择 git.exe。');
    if (result.status === 0) failure('待写入的私有配置已被 Git 跟踪，请先处理该文件的版本管理边界。');
    if (requireIgnored) {
      const ignored = spawnSync(gitExe || 'git.exe', ['-C', directory, 'check-ignore', '--no-index', '--quiet', '--', path.relative(directory, file)], {windowsHide: true, encoding: 'utf8', timeout: 10000});
      if (ignored.status !== 0) failure('项目私有配置或备份的 Git 忽略规则未生效，请检查嵌套仓库的忽略规则。');
    }
  }
}
function plan(request) {
  const root = projectRoot(request), c = connection(request), changes = [];
  let mcpProgram = '';
  const add = (file, bytes, keys) => {
    const before = snapshot(file);
    if (before.exists && before.bytes.equals(bytes)) return;
    changes.push({file, before, bytes, keys});
  };
  const settingsFile = path.join(root, '.vscode', 'settings.json');
  const s = ['intersystems.servers', c.alias];
  const selected = [
    {path: [...s, 'webServer', 'host'], value: c.host}, {path: [...s, 'webServer', 'port'], value: c.port},
    {path: [...s, 'webServer', 'scheme'], value: c.scheme},
    {path: ['objectscript.conn'], value: {server: c.alias, ns: c.namespace, active: true}}
  ];
  if (c.description) selected.push({path: [...s, 'description'], value: c.description});
  if (c.writeCredentials) selected.push({path: [...s, 'username'], value: c.username}, {path: [...s, 'password'], value: undefined});
  add(settingsFile, jsonChanges(snapshot(settingsFile), selected), ['intersystems.servers / 所选服务器', 'objectscript.conn']);
  if (request.configureMcp) {
    const mcpFile = path.join(root, '.mcp.json'), configFile = path.join(root, '.iris-agentic-dev.toml');
    const before = snapshot(mcpFile), mcp = object(before.text);
    let server = mcp.mcpServers?.['iris-agentic-dev'];
    const m = ['mcpServers', 'iris-agentic-dev'];
    const updates = [];
    if (!server) {
      mcpProgram = request.mcpExe || path.join(root, '.agents', 'vendor', 'iris-agentic-dev', 'windows-x64', 'iris-agentic-dev.exe');
      if (!path.isAbsolute(mcpProgram) || path.basename(mcpProgram).toLowerCase() !== 'iris-agentic-dev.exe') failure('请填写 iris-agentic-dev.exe 的完整路径，也可以使用自动填入的待部署路径。');
      const adapter = path.join(root, '.agents', 'scripts', 'iris-session-mcp.js');
      if (fs.existsSync(adapter)) {
        if (!request.nodeExe || !path.isAbsolute(request.nodeExe) || !fs.existsSync(request.nodeExe)) failure('此项目使用受管 MCP，请选择已安装的 node.exe。');
        const version = spawnSync(request.nodeExe, ['--version'], {windowsHide: true, encoding: 'utf8', timeout: 10000});
        const match = /^v(\d+)\.(\d+)\./.exec((version.stdout || '').trim());
        if (version.status !== 0 || !match || +match[1] < 22 || +match[1] === 22 && +match[2] < 5) failure('受管 MCP 需要 Node.js 22.5.0 或以上。');
        server = {command: request.nodeExe, args: [adapter, '--project-root', root, '--server-name', 'iris-agentic-dev']};
        const backendFile = path.join(root, '.agents', 'config', 'iris-session-backend.json');
        if (fs.existsSync(backendFile)) failure('项目已有受管后端记录但缺少 MCP 入口，请先核对该记录。');
        const backend = {schema: 'iris-session-backend/v1', serverName: 'iris-agentic-dev', command: mcpProgram,
          args: ['mcp', '--config', configFile], originalArgsPresent: true, managedHash: sha(Buffer.from(JSON.stringify(server)))};
        add(backendFile, Buffer.from(JSON.stringify(backend, null, 2) + '\n'), ['command', 'args', 'managedHash']);
      } else server = {command: mcpProgram, args: ['mcp', '--config', configFile]};
      updates.push({path: m, value: server});
    } else if (Array.isArray(server.args) && server.args.some(a => /(?:^|[\\/])iris-session-mcp\.js$/.test(a))) {
      const backendFile = path.join(root, '.agents', 'config', 'iris-session-backend.json');
      const backendBefore = snapshot(backendFile), backend = object(backendBefore.text);
      if (backend.schema !== 'iris-session-backend/v1' || backend.serverName !== 'iris-agentic-dev') failure('未找到所选项目的受管 MCP 后端记录。');
      if (typeof backend.command !== 'string' || !backend.command.trim()) failure('受管 MCP 后端记录缺少程序路径，请先核对。');
      mcpProgram = path.resolve(root, backend.command);
      const identity = sha(Buffer.from(JSON.stringify({command: server.command, args: server.args})));
      if (backend.managedHash !== identity) failure('受管 MCP 入口与后端记录不一致，请先核对。');
      const rootIndex = server.args.indexOf('--project-root');
      if (rootIndex < 0 || path.resolve(server.args[rootIndex + 1]) !== root) failure('受管 MCP 指向其他项目，请先使用项目迁移入口处理。');
      add(backendFile, jsonChanges(backendBefore, [{path: ['args'], value: updateArgs(backend.args, c, configFile)}]), ['args']);
    } else {
      if (!/(?:^|[\\/])iris-agentic-dev(?:\.exe)?$/i.test(server.command || '')) failure('现有 MCP 启动方式尚未识别，请保留该入口并单独配置 VS Code。');
      mcpProgram = path.resolve(root, server.command);
      updates.push({path: [...m, 'args'], value: updateArgs(server.args || ['mcp'], c, configFile)});
    }
    const environment = {IRIS_HOST: c.host, IRIS_WEB_PORT: String(c.port), IRIS_SCHEME: c.scheme,
      IRIS_NAMESPACE: c.namespace, IRIS_TLS_VERIFY: String(!!c.tlsVerify)};
    const values = {host: c.host, web_port: c.port, scheme: c.scheme, namespace: c.namespace, tls_verify: !!c.tlsVerify};
    if (c.writeCredentials) {
      environment.IRIS_USERNAME = c.username; environment.IRIS_PASSWORD = c.password;
      values.username = c.username; values.password = c.password;
    } else {
      const original = toml(snapshot(configFile).text), env = server.env || {};
      for (const key of ['username', 'password']) {
        const envKey = 'IRIS_' + key.toUpperCase();
        if (env[envKey] && original[key] && env[envKey] !== original[key]) failure('MCP 与 TOML 的已有凭据不一致，请勾选更新账号密码。');
        const value = env[envKey] || original[key];
        if (!value) failure('首次配置 MCP 请勾选更新本机账号密码并填写凭据。');
        environment[envKey] = value; values[key] = value;
      }
    }
    for (const [key, value] of Object.entries(environment)) updates.push({path: [...m, 'env', key], value});
    add(mcpFile, jsonChanges(before, updates), ['mcpServers / iris-agentic-dev（保留其他 MCP）']);
    add(configFile, editToml(snapshot(configFile), values), Object.keys(values).map(k => /username|password/.test(k) ? '凭据字段（隐藏）' : k));
  }
  if (request.commonSettings || request.pwshExe) {
    const file = userSettings(request);
    editor.safePath(file, true);
    const common = request.commonSettings ? [
      {path: ['files.autoGuessEncoding'], value: true}, {path: ['editor.detectIndentation'], value: false},
      {path: ['objectscript.format', 'commandCase'], value: 'word'}, {path: ['objectscript.format', 'functionCase'], value: 'word'},
      {path: ['intersystems.language-server.formatting.system.case'], value: 'lower'}
    ] : [];
    if (request.pwshExe) {
      if (!path.isAbsolute(request.pwshExe) || path.basename(request.pwshExe).toLowerCase() !== 'pwsh.exe') failure('请选择 PowerShell 7 的 pwsh.exe。');
      common.push(...editor.spec(request.pwshExe));
    }
    add(file, jsonChanges(snapshot(file), common), common.map(change => change.path.join(' / ')));
  }
  const privateFiles = [settingsFile];
  if (request.configureMcp) privateFiles.push(path.join(root, '.mcp.json'), path.join(root, '.iris-agentic-dev.toml'));
  privateFiles.push(...changes.filter(c => c.file.includes(path.join('.agents', 'config'))).map(c => c.file));
  ensurePrivate(root, privateFiles, request.gitExe);
  // Local backup content may contain the original user's credentials.
  const ignore = snapshot(path.join(root, '.gitignore'));
  const patterns = ['/.vscode/settings.json', '/.vscode/.ai-dev-config-*.tmp', '/.ai-dev-config-*.tmp', '/' + BACKUPS + '/', '/' + LOCK];
  if (request.configureMcp) patterns.push('/.mcp.json', '/.iris-agentic-dev.toml', '/.agents/config/iris-session-backend.json');
  const existing = ignore.text.split(/\r?\n/), missing = patterns.filter(p => !existing.includes(p));
  if (missing.length) {
    const eol = ignore.text.includes('\r\n') ? '\r\n' : '\n';
    const text = ignore.text + (ignore.text && !ignore.text.endsWith('\n') ? eol : '') + missing.join(eol) + eol;
    // Ignore rules must be in place before any private file is written.
    changes.unshift({file: ignore.file, before: ignore, bytes: editor.encode(text, ignore.bom), keys: ['本机配置和备份忽略规则']});
  }
  const fingerprint = sha(Buffer.from(JSON.stringify(changes.map(c => [c.file, c.before.hash, sha(c.bytes)]))));
  const mcpProgramPresent = mcpProgram ? fs.existsSync(mcpProgram) && fs.statSync(mcpProgram).isFile() : null;
  const warnings = mcpProgramPresent === false ? ['MCP 程序待安装，当前可先保存配置。部署到所选路径后，重新启动 MCP 客户端并验证连接。'] : [];
  return {root, changes, fingerprint, privateFiles, mcpProgramPresent, warnings};
}
function summary(planned, state = 'planned') {
  return {state: planned.changes.length ? state : 'unchanged', fingerprint: planned.fingerprint,
    mcpProgramPresent: planned.mcpProgramPresent, warnings: planned.warnings,
    files: planned.changes.map(c => ({file: c.file, operation: c.before.exists ? '更新' : '新增', keys: c.keys}))};
}
function writeFile(file, bytes, expected) {
  editor.safePath(file);
  if (snapshot(file).hash !== expected) failure('配置在操作期间发生变化，请重新预览。');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = path.join(path.dirname(file), '.ai-dev-config-' + crypto.randomUUID() + '.tmp');
  try {
    fs.writeFileSync(temporary, bytes, {flag: 'wx', mode: 0o600});
    if (snapshot(file).hash !== expected) failure('配置在操作期间发生变化，请重新预览。');
    fs.renameSync(temporary, file);
    if (snapshot(file).hash !== sha(bytes)) failure('配置写入后读回校验失败。');
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function withLock(root, operation) {
  const file = path.join(root, LOCK);
  editor.safePath(file);
  let descriptor;
  try { descriptor = fs.openSync(file, 'wx', 0o600); }
  catch { failure('项目配置正在处理，或上次进程留下锁文件。请确认原任务退出后移除 .ai-dev-config.lock 再重试。'); }
  try { return operation(); }
  finally { fs.closeSync(descriptor); fs.unlinkSync(file); }
}
function saveReceipt(file, receipt) {
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
  writeFile(file, bytes, snapshot(file).hash);
}
function restoreEntries(entries) {
  for (const entry of entries) {
    const current = snapshot(entry.file);
    if (current.hash === entry.beforeHash) continue;
    if (current.hash !== entry.afterHash) failure('配置已有后续修改，恢复已停止。');
  }
  for (const entry of entries.slice().reverse()) {
    const current = snapshot(entry.file);
    if (current.hash === entry.beforeHash) continue;
    if (current.hash !== entry.afterHash) failure('配置在恢复期间发生变化，请核对后重试。');
    if (entry.beforeHash === 'absent') fs.unlinkSync(entry.file);
    else writeFile(entry.file, Buffer.from(entry.original, 'base64'), current.hash);
  }
}
function apply(request, dependencies = {}) {
  const root = projectRoot(request);
  return withLock(root, () => {
    const planned = plan(request);
    if (!request.fingerprint || request.fingerprint !== planned.fingerprint) failure('配置或输入已变化，请重新预览。');
    if (!planned.changes.length) return summary(planned);
    if (request.pwshExe) editor.checkPwsh(request.pwshExe);
    const directory = path.join(root, BACKUPS, crypto.randomUUID());
    editor.safePath(directory);
    // The ignore file is applied first, before saving private originals.
    const ignore = planned.changes.find(c => c.file === path.join(root, '.gitignore'));
    if (ignore) writeFile(ignore.file, ignore.bytes, ignore.before.hash);
    ensurePrivate(root, [...planned.privateFiles, path.join(root, BACKUPS, 'probe')], request.gitExe, true);
    fs.mkdirSync(directory, {recursive: true});
    const receiptFile = path.join(directory, 'receipt.json');
    const entries = planned.changes.filter(c => c !== ignore).map(c => ({file: c.file, beforeHash: c.before.hash,
      afterHash: sha(c.bytes), original: c.before.bytes.toString('base64')}));
    // Keep ignore rules after rollback so remaining backup material stays private.
    const receipt = {schema: 1, tool: 'ai-dev-project', projectRoot: root, state: 'prepared', entries};
    saveReceipt(receiptFile, receipt);
    try {
      for (const change of planned.changes.filter(c => c !== ignore)) {
        if (dependencies.beforeWrite) dependencies.beforeWrite(change.file);
        writeFile(change.file, change.bytes, change.before.hash);
      }
      receipt.state = 'applied'; saveReceipt(receiptFile, receipt);
    } catch (error) {
      try { restoreEntries(entries); receipt.state = 'reverted-after-failure'; saveReceipt(receiptFile, receipt); }
      catch { failure('应用失败且存在并发修改。请通过恢复入口检查本项目最新回执。'); }
      throw error;
    }
    return {...summary(planned, 'applied'), receiptFile};
  });
}
function rollback(request) {
  const root = projectRoot(request);
  const file = path.resolve(request.receiptFile || '');
  if (path.dirname(path.dirname(file)) !== path.join(root, BACKUPS) || path.basename(file) !== 'receipt.json') failure('请选择本项目的配置回执。');
  return withLock(root, () => {
    const receipt = object(snapshot(file).text);
    if (receipt.schema !== 1 || receipt.tool !== 'ai-dev-project' || receipt.projectRoot !== root || !['applied', 'prepared'].includes(receipt.state) || !Array.isArray(receipt.entries)) failure('回执无效或已经恢复。');
    const allowed = [path.join(root, '.vscode', 'settings.json'), path.join(root, '.mcp.json'), path.join(root, '.iris-agentic-dev.toml'), path.join(root, '.agents', 'config', 'iris-session-backend.json')];
    if (request.codeExe) allowed.push(userSettings(request));
    const used = new Set();
    for (const entry of receipt.entries) {
      if (!allowed.includes(entry.file) || used.has(entry.file)) failure('回执文件范围不匹配，请核对 VS Code 用户设置模式。');
      used.add(entry.file);
      const original = Buffer.from(entry.original, 'base64');
      if (entry.beforeHash !== 'absent' && sha(original) !== entry.beforeHash || entry.beforeHash === 'absent' && original.length) failure('原配置备份校验失败。');
    }
    restoreEntries(receipt.entries);
    receipt.state = 'rolled-back'; saveReceipt(file, receipt);
    return {state: 'rolled-back', receiptFile: file};
  });
}
function main(request) {
  if (request.action === 'projectInspect') return inspect(request);
  if (request.action === 'projectPlan') return summary(plan(request));
  if (request.action === 'projectApply') return apply(request);
  if (request.action === 'projectRollback') return rollback(request);
  failure('无效的项目配置操作。');
}
module.exports = {snapshot, object, editToml, plan, inspect, apply, rollback, main};
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try { process.stdout.write(JSON.stringify(main(JSON.parse(input))) + '\n'); }
    catch (error) {
      // Parser/OS exceptions can contain source text or a private path.
      const message = /^[\u3400-\u9fff]/.test(error.message) ? error.message : '项目配置失败，请检查目录权限、配置语法和所选程序。';
      process.stderr.write(message + '\n'); process.exitCode = 1;
    }
  });
}
