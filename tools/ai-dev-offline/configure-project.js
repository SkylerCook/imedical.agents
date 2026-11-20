'use strict';
// Local configuration only. This program never opens an IRIS connection.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {isDeepStrictEqual} = require('node:util');
const editor = require('./configure-vscode');
const runtime = require('./operation-runtime');
const profiles = require('./iris-connection-profiles');
const jsonc = require('./vendor/jsonc-parser/main');
const parseToml = require('./vendor/iarna-toml/parse-string');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const failure = message => { throw new Error(message); };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const BACKUPS = '.ai-dev-config-backups';
const LOCK = '.ai-dev-config.lock';
const receiptIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fileHashPattern = /^[a-f0-9]{64}$/;
const receiptStates = new Set(['prepared', 'applied', 'rolling-back', 'rolled-back', 'reverted-after-failure', 'reverted-after-interruption']);

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
function serverName(root,read=snapshot) {
  const data=object(read(path.join(root,'.agents/config/project-env.json')).text);
  const name=data.mcp?.serverName ?? object(read(path.join(root,profiles.mainPath)).text).irisConnections?.serverName ?? 'iris-agentic-dev';
  if (typeof name!=='string' || !name || Object.hasOwn(Object.prototype,name)) failure('工程 MCP 名称无效。');
  return name;
}
function inspect(request) {
  const root = projectRoot(request);
  const settings = object(snapshot(path.join(root, '.vscode', 'settings.json')).text);
  const mcp = object(snapshot(path.join(root, '.mcp.json')).text);
  const config = toml(snapshot(path.join(root, '.iris-agentic-dev.toml')).text);
  const conn = settings['objectscript.conn'] || {};
  const alias = conn.server || 'project';
  const server = settings['intersystems.servers']?.[alias] || {};
  let selection,state;
  try {
    selection=object(snapshot(path.join(root,profiles.mainPath)).text).irisConnections;
    if (selection) state=profiles.describe(root,{snapshot,object,toml});
  } catch {
    state={consistent:false,conflicts:['project.jsonc / irisConnections']};
  }
  const name=selection?.serverName || object(snapshot(path.join(root,'.agents/config/project-env.json')).text).mcp?.serverName || 'iris-agentic-dev';
  const env = mcp.mcpServers?.[name]?.env || {};
  const entry = mcp.mcpServers?.[name];
  let executable = '';
  if (entry?.args?.some(a => /(?:^|[\\/])iris-session-mcp\.js$/.test(a))) {
    const backend = object(snapshot(path.join(root, '.agents', 'config', 'iris-session-backend.json')).text);
    if (typeof backend.command === 'string') executable = path.resolve(root, backend.command);
  } else if (/(?:^|[\\/])iris-agentic-dev(?:\.exe)?$/i.test(entry?.command || '')) executable = path.resolve(root, entry.command);
  return {state: 'inspected', alias, host: server.webServer?.host || env.IRIS_HOST || config.host || '',
    port: server.webServer?.port || Number(env.IRIS_WEB_PORT) || config.web_port || 0,
    scheme: server.webServer?.scheme || env.IRIS_SCHEME || config.scheme || 'http',
    namespace: conn.ns || env.IRIS_NAMESPACE || config.namespace || '', description: server.description || '',
    hasCredentials: !!((env.IRIS_PASSWORD || config.password) && (env.IRIS_USERNAME || config.username)), hasMcp: !!entry, mcpExe: executable,
    tlsVerify: String(env.IRIS_TLS_VERIFY ?? config.tls_verify ?? false).toLowerCase() === 'true',
    ...(state ? {...state.target,active:state.active,consistent:state.consistent,conflicts:state.conflicts} : {})};
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
  if (configFile && !next.some(arg => arg === '--config' || arg.startsWith('--config='))) next.push('--config', configFile);
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
function supportsManagedNode(executable) {
  if (typeof executable !== 'string' || !path.isAbsolute(executable) ||
      !fs.statSync(executable, {throwIfNoEntry:false})?.isFile()) return false;
  const version = spawnSync(executable, ['--version'], {windowsHide: true, encoding: 'utf8', timeout: 10000});
  const match = /^v(\d+)\.(\d+)\./.exec((version.stdout || '').trim());
  return version.status === 0 && !!match && (+match[1] > 22 || +match[1] === 22 && +match[2] >= 5);
}
function plan(request, dependencies = {}) {
  const root = projectRoot(request), changes = [];
  const specifiedNode = own(request, 'nodeExe');
  const requestedNode = request.nodeExe;
  const observed=new Map();
  function read(file) {
    if (!observed.has(file)) observed.set(file,snapshot(file));
    return observed.get(file);
  }
  const profile = request.profile ? profiles.prepare(root,request.profile,{snapshot:read,object,toml}) : null;
  if (profile) request = {projectRoot:root,connection:profile.connection,configureMcp:profile.bindings.mcp,
    syncProjectEnv:profile.bindings.central,gitExe:request.gitExe};
  const c = connection(request);
  let bindings = profile?.bindings;
  if (!profile && object(read(path.join(root,profiles.mainPath)).text).irisConnections) {
    const state = profiles.describe(root,{snapshot:read,object,toml});
    bindings=state.bindings;
    if ((request.configureMcp && !bindings.mcp) || (request.syncProjectEnv && !bindings.central)) failure('请求的连接来源未绑定到已选档案。');
    if (state.conflicts.length) failure('与已选开发库档案冲突，请核对 '+state.conflicts.join('、')+'。');
    if (!state.consistent || c.writeCredentials || ['host','port','namespace','scheme','alias','tlsVerify'].some(k=>state.target[k]!==c[k]))
      failure('该工程已启用开发库档案，请从档案切换入口变更目标或凭据。');
  }
  let mcpProgram = '';
  const add = (file, bytes, keys) => {
    const before = read(file);
    if (before.exists && before.bytes.equals(bytes)) return;
    changes.push({file, before, bytes, keys});
  };
  const settingsFile = path.join(root, '.vscode', 'settings.json');
  const s = ['intersystems.servers', c.alias];
  // An existing matching profile can select the original VS Code server without rewriting it.
  const selected = profile?.reuseVscode ? [] : [
    {path: [...s, 'webServer', 'host'], value: c.host}, {path: [...s, 'webServer', 'port'], value: c.port},
    {path: [...s, 'webServer', 'scheme'], value: c.scheme}
  ];
  if (bindings) {
    selected.push({path:['objectscript.conn','server'],value:c.alias},{path:['objectscript.conn','ns'],value:c.namespace});
  } else selected.push({path:['objectscript.conn'],value:{server:c.alias,ns:c.namespace,active:true}});
  if (!profile?.reuseVscode) {
    if (c.description) selected.push({path: [...s, 'description'], value: c.description});
    if (c.writeCredentials) selected.push({path: [...s, 'username'], value: c.username}, {path: [...s, 'password'], value: undefined});
  }
  if (!bindings || bindings.vscode) add(settingsFile, jsonChanges(read(settingsFile), selected),
    profile?.reuseVscode ? ['objectscript.conn'] : ['intersystems.servers / 所选服务器', 'objectscript.conn']);
  if (request.configureMcp) {
    const mcpFile = path.join(root, '.mcp.json'), configFile = path.join(root, '.iris-agentic-dev.toml');
    const before = read(mcpFile), mcp = object(before.text);
    const name=serverName(root,read);
    let server = mcp.mcpServers?.[name];
    const m = ['mcpServers', name];
    const updates = [];
    if (!server) {
      mcpProgram = request.mcpExe || path.join(root, '.agents', 'vendor', 'iris-agentic-dev', 'windows-x64', 'iris-agentic-dev.exe');
      if (!path.isAbsolute(mcpProgram) || path.basename(mcpProgram).toLowerCase() !== 'iris-agentic-dev.exe') failure('请填写 iris-agentic-dev.exe 的完整路径，也可以使用自动填入的待部署路径。');
      const adapter = path.join(root, '.agents', 'scripts', 'iris-session-mcp.js');
      if (fs.existsSync(adapter)) {
        const nodeExe = specifiedNode ? requestedNode : dependencies.resolveNodeExe ? dependencies.resolveNodeExe() : profile ? process.execPath : undefined;
        if (!nodeExe || !path.isAbsolute(nodeExe) || !fs.existsSync(nodeExe)) failure('此项目使用受管 MCP，请选择已安装的 node.exe。');
        if (!supportsManagedNode(nodeExe)) failure('受管 MCP 需要 Node.js 22.5.0 或以上。');
        server = {command: nodeExe, args: [adapter, '--project-root', root, '--server-name', name]};
        const backendFile = path.join(root, '.agents', 'config', 'iris-session-backend.json');
        if (fs.existsSync(backendFile)) failure('项目已有受管后端记录但缺少 MCP 入口，请先核对该记录。');
        const backend = {schema: 'iris-session-backend/v1', serverName: name, command: mcpProgram,
          args: ['mcp', '--config', configFile], originalArgsPresent: true, managedHash: sha(Buffer.from(JSON.stringify(server)))};
        add(backendFile, Buffer.from(JSON.stringify(backend, null, 2) + '\n'), ['command', 'args', 'managedHash']);
      } else server = {command: mcpProgram, args: ['mcp', '--config', configFile]};
      updates.push({path: m, value: server});
    } else if (Array.isArray(server.args) && server.args.some(a => /(?:^|[\\/])iris-session-mcp\.js$/.test(a))) {
      const backendFile = path.join(root, '.agents', 'config', 'iris-session-backend.json');
      const backendBefore = read(backendFile), backend = object(backendBefore.text);
      if (backend.schema !== 'iris-session-backend/v1' || backend.serverName !== name) failure('未找到所选项目的受管 MCP 后端记录。');
      if (typeof backend.command !== 'string' || !backend.command.trim()) failure('受管 MCP 后端记录缺少程序路径，请先核对。');
      mcpProgram = path.resolve(root, backend.command);
      const identity = sha(Buffer.from(JSON.stringify({command: server.command, args: server.args})));
      if (backend.managedHash !== identity) failure('受管 MCP 入口与后端记录不一致，请先核对。');
      const rootIndex = server.args.indexOf('--project-root');
      if (rootIndex < 0 || path.resolve(server.args[rootIndex + 1]) !== root) failure('受管 MCP 指向其他项目，请先使用项目迁移入口处理。');
      add(backendFile, jsonChanges(backendBefore, [{path: ['args'], value: updateArgs(backend.args, c, bindings && !bindings.toml ? null : configFile)}]), ['args']);
    } else {
      if (!/(?:^|[\\/])iris-agentic-dev(?:\.exe)?$/i.test(server.command || '')) failure('现有 MCP 启动方式尚未识别，请保留该入口并单独配置 VS Code。');
      mcpProgram = path.resolve(root, server.command);
      updates.push({path: [...m, 'args'], value: updateArgs(server.args || ['mcp'], c, bindings && !bindings.toml ? null : configFile)});
    }
    const environment = {IRIS_HOST: c.host, IRIS_WEB_PORT: String(c.port), IRIS_SCHEME: c.scheme,
      IRIS_NAMESPACE: c.namespace, IRIS_TLS_VERIFY: String(!!c.tlsVerify)};
    const values = {host: c.host, web_port: c.port, scheme: c.scheme, namespace: c.namespace, tls_verify: !!c.tlsVerify};
    if (c.writeCredentials) {
      environment.IRIS_USERNAME = c.username; environment.IRIS_PASSWORD = c.password;
      values.username = c.username; values.password = c.password;
    } else {
      const original = toml(read(configFile).text), env = server.env || {};
      for (const key of ['username', 'password']) {
        const envKey = 'IRIS_' + key.toUpperCase();
        if (env[envKey] && original[key] && env[envKey] !== original[key]) failure('MCP 与 TOML 的已有凭据不一致，请勾选更新账号密码。');
        const value = env[envKey] || original[key];
        if (!value) failure('首次配置 MCP 请勾选更新本机账号密码并填写凭据。');
        environment[envKey] = value; values[key] = value;
      }
    }
    for (const [key, value] of Object.entries(environment)) updates.push({path: [...m, 'env', key], value});
    add(mcpFile, jsonChanges(before, updates), ['mcpServers / '+name+'（保留其他 MCP）']);
    if (!bindings || bindings.toml) add(configFile, editToml(read(configFile), values), Object.keys(values).map(k => /username|password/.test(k) ? '凭据字段（隐藏）' : k));
    // Workbench opts into the canonical source, in the same recoverable transaction.
    if (request.syncProjectEnv) {
      const envFile = path.join(root, '.agents', 'config', 'project-env.json');
      const envBefore = read(envFile);
      if (!envBefore.exists) failure('集中工程配置不存在，请先完成框架初始化。');
      const envData = object(envBefore.text);
      if (!envData.iris || typeof envData.iris !== 'object' || Array.isArray(envData.iris)) failure('集中 IRIS 配置结构无法识别。');
      if (!c.writeCredentials && ['username','password'].some(key => envData.iris[key] && envData.iris[key] !== values[key])) failure('集中配置与 MCP/TOML 凭据不一致，请明确替换凭据后再预览。');
      const central = {host: c.host, port: c.port, scheme: c.scheme, namespace: c.namespace,
        tlsVerify: !!c.tlsVerify, username: values.username, password: values.password};
      if (profile && own(envData.iris,'alias')) central.alias=c.alias;
      const centralChanges = Object.entries(central).map(([key,value]) => ({path:['iris',key],value}));
      const sftpFields = {host:'TARGET_HOST',port:'TARGET_PORT',username:'TARGET_USERNAME',password:'TARGET_PASSWORD',localPath:'LOCAL_PATH',remotePath:'REMOTE_PATH'};
      const sftpUpdates = [];
      for (const [field,value] of Object.entries(request.sourceChanges || {})) {
        const [section,key,...rest] = field.split('.');
        if (rest.length || !(section === 'web' && ['basePath','cspBasePath','brokerPath','cookie'].includes(key) || section === 'sftp' && own(sftpFields,key))) failure('集中配置字段不在支持范围。');
        if (!envData[section] || !own(envData[section],key)) failure('集中配置字段不存在，请先通过初始化入口补齐。');
        if (key === 'port' ? !Number.isInteger(value) || value < 1 || value > 65535 : typeof value !== 'string' || value.length > 8192 || /[\x00\r\n]/.test(value)) failure('Web/SFTP 字段格式无效。');
        centralChanges.push({path:[section,key],value});
        if (section === 'sftp') sftpUpdates.push({key:sftpFields[key],value:key==='port'?String(value):value});
      }
      if (sftpUpdates.length) {
        const existing = changes.find(change => change.file === mcpFile);
        const latest = existing ? {...before,text:existing.bytes.toString('utf8').replace(/^\uFEFF/,'')} : before;
        const current = object(latest.text), name = envData.sftp.serverName || 'sftp-server';
        const target = current.mcpServers?.[name];
        if (['__proto__','prototype','constructor',serverName(root,read)].includes(name) || !target?.env || !own(target.env,'TARGET_HOST')) failure('没有可识别的 SFTP MCP 入口；请先初始化，工作台不会替换自定义启动器。');
        const bytes = jsonChanges(latest,sftpUpdates.map(({key,value})=>({path:['mcpServers',name,'env',key],value})));
        if (existing) { existing.bytes=bytes; existing.keys.push('SFTP / 连接字段（隐藏）'); }
        else add(mcpFile,bytes,['SFTP / 连接字段（隐藏）']);
      }
      add(envFile, jsonChanges(envBefore,centralChanges), ['iris / 连接与凭据（隐藏）', ...(request.sourceChanges ? ['Web/SFTP / 选定字段（隐藏）'] : [])]);
    }
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
    add(file, jsonChanges(read(file), common), common.map(change => change.path.join(' / ')));
  }
  if (profile) {
    if (!request.configureMcp) {
      const values={host:c.host,scheme:c.scheme,namespace:c.namespace,username:c.username,password:c.password};
      if (profile.bindings.toml) {
        const file=path.join(root,'.iris-agentic-dev.toml');
        add(file,editToml(read(file),{...values,web_port:c.port,tls_verify:c.tlsVerify}),['IRIS TOML']);
      }
      if (profile.bindings.central) {
        const file=path.join(root,'.agents/config/project-env.json');
        const fields={...values,port:c.port,tlsVerify:c.tlsVerify};
        if (own(object(read(file).text).iris,'alias')) fields.alias=c.alias;
        const edits=Object.entries(fields).map(([key,value])=>({path:['iris',key],value}));
        add(file,jsonChanges(read(file),edits),['iris']);
      }
    }
    if (profile.edits.length) {
      const existing=changes.find(change=>change.file===profile.privateFile.file);
      if (existing) {
        existing.bytes=jsonChanges({...existing.before,text:new TextDecoder().decode(existing.bytes)},profile.edits);
        existing.keys.push('档案凭据（隐藏）');
      } else add(profile.privateFile.file,jsonChanges(profile.privateFile,profile.edits),['档案凭据（隐藏）']);
    }
    add(profile.main.file,jsonChanges(profile.main,profile.mainEdits),['当前开发库档案']);
  }
  const privateFiles = !bindings || bindings.vscode ? [settingsFile] : [];
  if (request.configureMcp) privateFiles.push(path.join(root, '.mcp.json'));
  if (bindings ? bindings.toml && request.configureMcp : request.configureMcp) privateFiles.push(path.join(root,'.iris-agentic-dev.toml'));
  privateFiles.push(...changes.filter(c => c.file.includes(path.join('.agents', 'config'))).map(c => c.file));
  ensurePrivate(root, privateFiles, request.gitExe);
  // Local backup content may contain the original user's credentials.
  const ignore = read(path.join(root, '.gitignore'));
  const patterns = ['/.ai-dev-config-*.tmp', '/' + BACKUPS + '/', '/' + LOCK];
  if (!bindings || bindings.vscode) patterns.push('/.vscode/settings.json','/.vscode/.ai-dev-config-*.tmp');
  if (request.configureMcp) patterns.push('/.mcp.json','/.agents/config/iris-session-backend.json');
  if (bindings ? bindings.toml && request.configureMcp : request.configureMcp) patterns.push('/.iris-agentic-dev.toml');
  if (request.syncProjectEnv) patterns.push('/.agents/config/project-env.json');
  if (profile) {
    patterns.push('/'+profiles.mainPath);
    if (profile.edits.length && !profile.bindings.central) patterns.push('/'+profiles.privatePath);
  }
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
  return {root, changes, fingerprint, privateFiles, mcpProgramPresent, warnings,profile};
}
function summary(planned, state = 'planned') {
  return {state: planned.changes.length ? state : 'unchanged', fingerprint: planned.fingerprint,
    ...(planned.profile ? {selected:planned.profile.id,from:planned.profile.from,to:planned.profile.to,
      verification:'configuration-only',...(state==='applied'?{clientReconnect:'required'}:{})}:{}),
    mcpProgramPresent: planned.mcpProgramPresent, warnings: planned.warnings,
    files: planned.changes.map(c => ({file: c.file, operation: c.before.exists ? '更新' : '新增', keys: c.keys}))};
}
function writeFile(file, bytes, expected, receiptFile) {
  editor.safePath(file);
  if (snapshot(file).hash !== expected) failure('配置在操作期间发生变化，请重新预览。');
  const directory = path.dirname(file);
  let staging = directory;
  if (receiptFile) {
    const receiptDirectory = path.dirname(receiptFile);
    const project = path.dirname(path.dirname(receiptDirectory));
    const relative = path.relative(project, file);
    if (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..') {
      // A process exit can leave the staged bytes behind. Keep them with the private receipt.
      staging = receiptDirectory;
      editor.safePath(staging);
    }
  }
  fs.mkdirSync(directory, {recursive: true});
  const temporary = path.join(staging, '.ai-dev-config-' + crypto.randomUUID() + '.tmp');
  try {
    fs.writeFileSync(temporary, bytes, {flag: 'wx', mode: 0o600});
    if (snapshot(file).hash !== expected) failure('配置在操作期间发生变化，请重新预览。');
    fs.renameSync(temporary, file);
    if (snapshot(file).hash !== sha(bytes)) failure('配置写入后读回校验失败。');
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function saveReceipt(file, receipt, expected = snapshot(file).hash) {
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
  writeFile(file, bytes, expected);
  return sha(bytes);
}
function recoveryConflict(message) {
  throw Object.assign(new Error(message), {code:'project-recovery-conflict'});
}
function writtenEntries(entries) {
  const written = [];
  for (const entry of entries) {
    const current = snapshot(entry.file);
    if (current.hash === entry.beforeHash) continue;
    if (current.hash !== entry.afterHash) recoveryConflict('配置已有后续修改，恢复已停止。');
    written.push(entry);
  }
  return written;
}
function restoreEntries(entries, receiptFile, expectedWritten) {
  const written = writtenEntries(entries);
  if (expectedWritten && !isDeepStrictEqual(written, expectedWritten)) {
    recoveryConflict('配置在恢复前发生变化，请重新读取。');
  }
  for (const entry of (expectedWritten || entries).slice().reverse()) {
    const current = snapshot(entry.file);
    if (current.hash === entry.beforeHash) continue;
    if (current.hash !== entry.afterHash) recoveryConflict('配置在恢复期间发生变化，请核对后重试。');
    if (entry.beforeHash === 'absent') fs.unlinkSync(entry.file);
    else writeFile(entry.file, Buffer.from(entry.original, 'base64'), current.hash, receiptFile);
  }
  if (entries.some(entry => snapshot(entry.file).hash !== entry.beforeHash)) recoveryConflict('恢复后读回与原配置不一致，请核对后重试。');
}
function validateReceipt(request, root, receipt) {
    if (receipt.schema !== 1 || receipt.tool !== 'ai-dev-project' || receipt.projectRoot !== root || !['applied', 'prepared', 'rolling-back'].includes(receipt.state) || !Array.isArray(receipt.entries)) failure('回执无效或已经恢复。');
    const allowed = [path.join(root, '.vscode', 'settings.json'), path.join(root, '.mcp.json'), path.join(root, '.iris-agentic-dev.toml'), path.join(root, '.agents', 'config', 'iris-session-backend.json'), path.join(root, '.agents', 'config', 'project-env.json')];
    allowed.push(path.join(root,profiles.mainPath),path.join(root,profiles.privatePath));
    if (request.codeExe) allowed.push(userSettings(request));
    const used = new Set();
    for (const entry of receipt.entries) {
      if (!entry || !allowed.includes(entry.file) || used.has(entry.file)) failure('回执文件范围不匹配，请核对 VS Code 用户设置模式。');
      used.add(entry.file);
      if (typeof entry.original !== 'string' || typeof entry.afterHash !== 'string' || !fileHashPattern.test(entry.afterHash) ||
          entry.beforeHash !== 'absent' && (typeof entry.beforeHash !== 'string' || !fileHashPattern.test(entry.beforeHash)) ||
          entry.beforeHash === entry.afterHash) failure('配置回执的文件摘要无效。');
      const original = Buffer.from(entry.original, 'base64');
      if (entry.beforeHash !== 'absent' && sha(original) !== entry.beforeHash || entry.beforeHash === 'absent' && original.length) failure('原配置备份校验失败。');
    }
 }
function validReceiptId(id) {
  return typeof id === 'string' && receiptIdPattern.test(id);
}
function recoveryCode(receipt, written) {
  if (written.length === 0) return 'unchanged';
  return written.length < receipt.entries.length ? 'available' : 'review-required';
}
function recoveryFingerprint(id, saved, written) {
  return sha(JSON.stringify([id,saved.hash,written.map(entry => entry.file)]));
}
function latestUndoReceipt({receipts, unreadableUpdated}) {
  if (receipts.some(row => row.state === 'prepared' && row.recovery !== 'unchanged')) return;
  const inProgress = receipts.filter(row => row.state === 'rolling-back');
  let candidate;
  if (inProgress.length) {
    if (inProgress.length === 1) candidate = inProgress[0];
  } else {
    const [latest, previous] = receipts.filter(row => row.state === 'applied').sort((a,b) => b.updated.localeCompare(a.updated));
    if (latest?.updated !== previous?.updated) candidate = latest;
  }
  if (candidate && unreadableUpdated !== null && (unreadableUpdated === undefined || unreadableUpdated < candidate.updated))
    return candidate;
}
function describeUndo(root, directory, row, signRecovery) {
  if (!row) return;
  try {
    const saved = snapshot(path.join(directory, row.id, 'receipt.json'));
    const receipt = object(saved.text);
    if (receipt.state !== row.state) return;
    validateReceipt({}, root, receipt);
    const written = writtenEntries(receipt.entries);
    if (receipt.state === 'applied' && (!written.length || written.length !== receipt.entries.length)) return;
    row.recovery = 'undo-available';
    row.restoreFiles = written.length;
    row.recoveryToken = signRecovery(recoveryFingerprint(row.id, saved, written));
  } catch (error) {
    if (row.state === 'rolling-back') row.recovery = error.code === 'project-recovery-conflict' ? 'conflict' : 'unsupported';
  }
}
function scanReceipts(root, signRecovery) {
  const receipts = [];
  // Undefined means the scan is complete. Null means an unreadable receipt has no trustworthy timestamp.
  let unreadableUpdated;
  const directory = path.join(root, BACKUPS);
  try {
    editor.safePath(directory);
    const directories = fs.readdirSync(directory);
    for (const id of directories.filter(validReceiptId)) {
      const file = path.join(directory, id, 'receipt.json');
      let updated = null;
      try {
        editor.safePath(file);
        const stat = fs.lstatSync(file, {throwIfNoEntry:false});
        if (!stat) continue;
        if (!stat.isFile()) failure('无效配置回执。');
        updated = stat.mtime.toISOString();
        const saved = snapshot(file);
        const receipt = object(saved.text);
        if (receipt.schema !== 1 || receipt.tool !== 'ai-dev-project' || receipt.projectRoot !== root ||
            !receiptStates.has(receipt.state) || !Array.isArray(receipt.entries)) failure('无效配置回执。');
        const row = {id, state:receipt.state, files:receipt.entries.length, updated};
        if (receipt.state === 'prepared') {
          try {
            validateReceipt({}, root, receipt);
            const written = writtenEntries(receipt.entries);
            row.recovery = recoveryCode(receipt, written);
            if (row.recovery === 'available' && process.platform !== 'win32') row.recovery = 'unsupported';
            if (process.platform === 'win32' && ['available', 'review-required'].includes(row.recovery)) {
              row.restoreFiles = written.length;
              if (signRecovery) row.recoveryToken = signRecovery(recoveryFingerprint(id, saved, written));
            }
          } catch (error) {
            row.recovery = error.code === 'project-recovery-conflict' ? 'conflict' : 'unsupported';
          }
        }
        receipts.push(row);
      } catch {
        if (unreadableUpdated === undefined || updated === null || (unreadableUpdated !== null && updated > unreadableUpdated))
          unreadableUpdated = updated;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') unreadableUpdated = null;
  }
  return {directory, receipts, unreadableUpdated};
}
function readReceipts(root, signRecovery) {
  const scan = scanReceipts(root, signRecovery);
  if (process.platform === 'win32' && signRecovery) describeUndo(root, scan.directory, latestUndoReceipt(scan), signRecovery);
  return {receipts:scan.receipts, ...(scan.unreadableUpdated !== undefined ? {receiptIssue:true} : {})};
}
function finishUndo(file, receipt, expected, written) {
  if (receipt.state !== 'rolling-back') {
    receipt.state = 'rolling-back';
    expected = saveReceipt(file, receipt, expected);
  }
  restoreEntries(receipt.entries, file, written);
  receipt.state = 'rolled-back';
  saveReceipt(file, receipt, expected);
}
function recoverInterrupted(request, dependencies = {}) {
  const root = projectRoot(request);
  const {receiptId} = request;
  const verify = dependencies.verify === true;
  const undo = dependencies.undo === true;
  if (!validReceiptId(receiptId)) failure('配置回执无效。');
  const file = path.join(root, BACKUPS, receiptId, 'receipt.json');
  return runtime.withLock(root, request, async () => {
    await dependencies.beforeRestore?.();
    const saved = snapshot(file);
    const receipt = object(saved.text);
    const notAvailable = () => Object.assign(new Error('当前回执没有可安全处理的配置变更。'), {code:'project-recovery-not-available'});
    if (undo ? !['applied', 'rolling-back'].includes(receipt.state) : receipt.state !== 'prepared') throw notAvailable();
    if (undo && latestUndoReceipt(scanReceipts(root))?.id !== receiptId) throw notAvailable();
    validateReceipt({}, root, receipt);
    const written = writtenEntries(receipt.entries);
    if (undo && receipt.state === 'applied' && (!written.length || written.length !== receipt.entries.length)) throw notAvailable();
    if (!undo && recoveryCode(receipt, written) !== (verify ? 'review-required' : 'available')) throw notAvailable();
    if (!dependencies.confirmRecovery?.(recoveryFingerprint(receiptId, saved, written))) {
      recoveryConflict('配置回执或待恢复文件与确认时不一致，请重新读取。');
    }
    ensurePrivate(path.dirname(file), [file], request.gitExe, true);
    if (!verify) for (const entry of written) ensurePrivate(path.dirname(entry.file), [entry.file], request.gitExe, true);
    if (snapshot(file).hash !== saved.hash) recoveryConflict('配置回执在恢复前发生变化，请重新读取。');
    if (undo) {
      finishUndo(file, receipt, saved.hash, written);
      return {receiptId, state:receipt.state};
    }
    if (verify) {
      verifyAppliedProfiles(root, written);
      if (writtenEntries(receipt.entries).length !== written.length)
        recoveryConflict('配置在核验期间发生变化，请重新读取。');
      receipt.state = 'applied';
    } else {
      restoreEntries(receipt.entries, file, written);
      receipt.state = 'reverted-after-interruption';
    }
    saveReceipt(file, receipt, saved.hash);
    return {receiptId, state:receipt.state};
  });
}
function verifyAppliedProfiles(root, written) {
  const projectFile = path.join(root, profiles.mainPath);
  if (written.some(entry => entry.file === projectFile) && object(snapshot(projectFile).text).irisConnections &&
      !profiles.describe(root, {snapshot,object,toml}).consistent)
    recoveryConflict('已写入的开发库配置读回不一致，请复查项目配置回执。');
}
function recoverPrepared(request, root, requireRecoveryConfirmation = false) {
  const directory = path.join(root, BACKUPS);
  if (!fs.existsSync(directory)) return;
  editor.safePath(directory);
  for (const name of fs.readdirSync(directory)) {
    if (!validReceiptId(name)) continue;
    const file = path.join(directory, name, 'receipt.json');
    if (!fs.existsSync(file)) continue;
    const saved = snapshot(file);
    const receipt = object(saved.text);
    if (receipt.state === 'rolling-back') recoveryConflict('请先处理上次中断的配置撤销。');
    if (receipt.state !== 'prepared') continue;
    validateReceipt(request, root, receipt);
    const written = writtenEntries(receipt.entries);
    if (recoveryCode(receipt, written) === 'review-required') {
      verifyAppliedProfiles(root, written);
      if (requireRecoveryConfirmation) {
        ensurePrivate(path.dirname(file), [file], request.gitExe, true);
        if (writtenEntries(receipt.entries).length !== written.length) recoveryConflict('配置在核验期间发生变化。');
      }
      receipt.state = 'applied'; saveReceipt(file, receipt, saved.hash);
      continue;
    }
    if (requireRecoveryConfirmation && written.length) recoveryConflict('上次保存仍有待确认的部分写入。');
    runtime.progress(request, '正在恢复上次未完成的项目配置…', false);
    restoreEntries(receipt.entries, file, requireRecoveryConfirmation ? written : undefined);
    if (requireRecoveryConfirmation) ensurePrivate(path.dirname(file), [file], request.gitExe, true);
    receipt.state = 'reverted-after-interruption'; saveReceipt(file, receipt, saved.hash);
  }
}
function apply(request, dependencies = {}) {
  const root = projectRoot(request);
  return runtime.withLock(root, request, async () => {
    runtime.progress(request, '正在核对并应用项目配置…', false);
    try { recoverPrepared(request, root, dependencies.requireRecoveryConfirmation); }
    catch (error) {
      if (!dependencies.requireRecoveryConfirmation) throw error;
      throw Object.assign(new Error('请先处理上次保存的回执。'), {code:'project-recovery-required'});
    }
    let planned = plan(request, dependencies);
    if (planned.profile?.legacyHost) {
      await profiles.awaitLegacyExit({snapshot,object});
      planned=plan(request, dependencies);
      if (planned.profile?.legacyHost) failure('旧版宿主正在使用连接，稍后重新预览。');
    }
    if (!request.fingerprint || request.fingerprint !== planned.fingerprint) failure('配置或输入已变化，请重新预览。');
    if (!planned.changes.length) return summary(planned);
    if (request.pwshExe) editor.checkPwsh(request.pwshExe);
    const directory = path.join(root, BACKUPS, crypto.randomUUID());
    editor.safePath(directory);
    // The ignore file is applied first, before saving private originals.
    const ignore = planned.changes.find(c => c.file === path.join(root, '.gitignore'));
    if (ignore) writeFile(ignore.file, ignore.bytes, ignore.before.hash);
    const receiptFile = path.join(directory, 'receipt.json');
    ensurePrivate(root, [...planned.privateFiles, receiptFile], request.gitExe, true);
    fs.mkdirSync(directory, {recursive: true});
    const entries = planned.changes.filter(c => c !== ignore).map(c => ({file: c.file, beforeHash: c.before.hash,
      afterHash: sha(c.bytes), original: c.before.bytes.toString('base64')}));
    // Keep ignore rules after rollback so remaining backup material stays private.
    const receipt = {schema: 1, tool: 'ai-dev-project', projectRoot: root, state: 'prepared', entries};
    saveReceipt(receiptFile, receipt);
    try {
      for (const change of planned.changes.filter(c => c !== ignore)) {
        if (dependencies.beforeWrite) dependencies.beforeWrite(change.file);
        writeFile(change.file, change.bytes, change.before.hash, receiptFile);
      }
      if (planned.profile) {
        const readback=profiles.describe(root,{snapshot,object,toml});
        if (!readback.consistent || readback.active!==planned.profile.id) failure('开发库配置读回不一致。');
      }
      receipt.state = 'applied'; saveReceipt(receiptFile, receipt);
    } catch (error) {
      try { restoreEntries(entries, receiptFile); receipt.state = 'reverted-after-failure'; saveReceipt(receiptFile, receipt); }
      catch { failure('应用失败且存在并发修改。请通过恢复入口检查本项目最新回执。'); }
      throw error;
    }
    return {...summary(planned, 'applied'), receiptFile};
  }, path.join(root, LOCK));
}
function rollback(request) {
  const root = projectRoot(request);
  const file = path.resolve(request.receiptFile || '');
  if (path.dirname(path.dirname(file)) !== path.join(root, BACKUPS) || path.basename(file) !== 'receipt.json') failure('请选择本项目的配置回执。');
  return runtime.withLock(root, request, () => {
    const saved = snapshot(file);
    const receipt = object(saved.text);
    validateReceipt(request, root, receipt);
    finishUndo(file, receipt, saved.hash, writtenEntries(receipt.entries));
    return {state: 'rolled-back', receiptFile: file};
  }, path.join(root, LOCK));
}
function main(request) {
  if (request.action==='projectProfiles') return inspectProfiles(request);
  if (request.action === 'projectInspect' || request.action === 'projectPlan') {
    const root = projectRoot(request);
    return runtime.withLock(root, request, () => {
      recoverPrepared(request, root);
      return request.action === 'projectInspect' ? inspect(request) : summary(plan(request));
    }, path.join(root, LOCK));
  }
  if (request.action === 'projectApply') return apply(request);
  if (request.action === 'projectRollback') return rollback(request);
  failure('无效的项目配置操作。');
}
function inspectProfiles(request) { return profiles.describe(projectRoot(request),{snapshot,object,toml}); }
module.exports = {snapshot, object, editToml, plan, inspect, inspectProfiles, apply, rollback, main, readReceipts, recoverInterrupted, validReceiptId, supportsManagedNode};
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', async () => {
    try { process.stdout.write(JSON.stringify(await main(JSON.parse(input))) + '\n'); }
    catch (error) {
      // Parser/OS exceptions can contain source text or a private path.
      const message = /^[\u3400-\u9fff]/.test(error.message) ? error.message : '项目配置失败，请检查目录权限、配置语法和所选程序。';
      process.stderr.write(message + '\n'); process.exitCode = 1;
    }
  });
}
