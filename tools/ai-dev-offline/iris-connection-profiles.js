'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bundledEnvironment = path.join(__dirname,'project-environment-data.js');
const environment = require(fs.existsSync(bundledEnvironment) ? bundledEnvironment : '../../scripts/lib/project-environment-data');
const publicKeys = ['host','port','scheme','namespace','alias','tlsVerify'];
const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const reject = message => { throw new Error(message); };

function projectFiles(root) {
  const standard = path.join(root,'.agents');
  let context = {mode:'standard',contextRoot:standard,capabilityRoot:standard};
  if (fs.existsSync(path.join(standard,'capability.json'))) {
    const bundled = path.join(__dirname,'workspace-context.js');
    const runtime = require(fs.existsSync(bundled) ? bundled : '../../scripts/lib/workspace-context');
    context = runtime.resolveWorkspaceContext(root);
    if (context.mode!=='workspace-overlay' || runtime.workspaceContextBlockers(context).length) {
      reject('工作区的配置根或共享能力声明未就绪。');
    }
  }
  const config = path.join(context.contextRoot,'config');
  return {config,context,main:path.join(config,'project.jsonc'),private:path.join(config,environment.credentialFile),
    env:path.join(config,'project-env.json'),backend:path.join(config,'iris-session-backend.json')};
}

function validId(id) {
  if (typeof id !== 'string' || !idPattern.test(id) || Object.hasOwn(Object.prototype,id) || id === 'prototype')
    reject('档案标识应以字母开头，仅使用字母、数字、下划线和短横线。');
  return id;
}
function checkSessionCompatibility(capabilityRoot,io) {
  const client=io.snapshot(path.join(capabilityRoot,'scripts/lib/iris-session-client.js'));
  if (!client.exists) return;
  const host=io.snapshot(path.join(capabilityRoot,'scripts/iris-session-host.js'));
  if (!client.text.includes('session-target-changed-reconnect') || !host.text.includes('boundTargets:1'))
    reject('当前工程的会话组件尚未支持跨库目标绑定。请通过框架更新入口更新，再切换开发库。');
  return legacyHostRunning(io);
}
function legacyHostRunning(io) {
  const live=io.snapshot(path.join(os.homedir(),'.imedical/iris-sessions/host.json'));
  if (!live.exists) return;
  const record=io.object(live.text);
  if (record.boundTargets===1) return;
  if (!Number.isSafeInteger(record.pid) || record.pid<=0) reject('已有会话记录无法核对，请检查受管会话状态。');
  try { process.kill(record.pid,0); }
  catch(error) { if (error.code==='ESRCH') return; }
  return true;
}
async function awaitLegacyExit(io) {
  // An idle host exits itself after 30 seconds. Never terminate another project's work.
  const deadline=Date.now()+35000;
  while (legacyHostRunning(io)) {
    if (Date.now()>=deadline) reject('旧版会话宿主仍在运行。请让已发送的操作在原库完成，断开旧客户端，待宿主自动退出后重试切换。');
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
}
function publicProfile(input, credentialRef) {
  if (typeof input.tlsVerify !== 'boolean') reject('请选择是否验证 TLS 证书。');
  return {...Object.fromEntries(publicKeys.map(k=>[k,input[k]])),credentialRef};
}
function projectEnvironment(root, io, data) {
  const files = projectFiles(root);
  const main = data ?? io.object(io.snapshot(files.main).text);
  const legacy = io.snapshot(files.env);
  const canonical = environment.canonical(main);
  const credentials = canonical ? io.object(io.snapshot(files.private).text) : {};
  return {canonical,config:environment.read(main,legacy.exists ? io.object(legacy.text) : null,credentials) || {}};
}
function sessionBackend(root, io, data) {
  const files = projectFiles(root);
  const main = io.snapshot(files.main);
  const canonical = (data ?? io.object(main.text)).irisSessionBackend;
  const legacy = io.snapshot(files.backend);
  if (canonical && legacy.exists) reject('受管 MCP 后端待完成 JSONC 迁移。');
  return {canonical:!!canonical,source:canonical ? main : legacy,value:canonical || io.object(legacy.text)};
}
function readState(root, io) {
  const read = file => io.snapshot(path.join(root,file));
  const files = projectFiles(root);
  const main = io.snapshot(files.main);
  const data = io.object(main.text);
  const stored = data.irisConnections;
  if (stored && (!stored.profiles || !Object.hasOwn(stored.profiles,validId(stored.active)))) reject('工程连接档案结构异常。');
  const settings = io.object(read('.vscode/settings.json').text);
  const conn = settings['objectscript.conn'];
  const server = conn && settings['intersystems.servers']?.[conn.server];
  const centralState=projectEnvironment(root,io,data);
  const projectEnv=centralState.config;
  const name=projectEnv.mcp?.serverName || stored?.serverName || 'iris-agentic-dev';
  const entry = io.object(read('.mcp.json').text).mcpServers?.[name];
  const backend = sessionBackend(root,io,data).value;
  const config = read('.iris-agentic-dev.toml');
  const t = io.toml(config.text);
  const central = projectEnv.iris;
  const env = entry?.env || {};
  const signals = [];
  if (server) signals.push({...server.webServer,namespace:conn.ns});
  if (central) signals.push(central);
  if (config.exists) signals.push({host:t.host,port:t.web_port,scheme:t.scheme,namespace:t.namespace});
  if (entry) signals.push({host:env.IRIS_HOST,port:env.IRIS_WEB_PORT,scheme:env.IRIS_SCHEME,namespace:env.IRIS_NAMESPACE});
  const args = entry?.args?.some(a=>/iris-session-mcp\.js$/.test(a)) ? backend.args : entry?.args;
  const flags = {};
  for (let i=0; i<(args || []).length; i++) {
    const flag = /^--(host|web-port|scheme|namespace|config)(?:=(.*))?$/.exec(args[i]);
    if (!flag) continue;
    const value = flag[2] ?? args[++i];
    if (flag[1]==='config') {
      if (!value || path.resolve(root,value)!==config.file || !config.exists) reject('已有 MCP 引用的 TOML 缺失或位于工程外，请先核对绑定范围。');
    } else flags[flag[1]==='web-port'?'port':flag[1]]=value;
  }
  signals.push(flags);
  const live = {alias:conn?.server || central?.alias || 'project',tlsVerify:String(central?.tlsVerify ?? env.IRIS_TLS_VERIFY ?? t.tls_verify ?? false).toLowerCase()==='true'};
  const tls=[central?.tlsVerify,env.IRIS_TLS_VERIFY,t.tls_verify].filter(v=>v!==undefined).map(v=>String(v).toLowerCase());
  let consistent = tls.every(v=>['true','false'].includes(v)) && new Set(tls).size<=1;
  for (const key of ['host','port','scheme','namespace']) {
    const values = [...new Set(signals.map(s=>s[key]).filter(v=>v!==undefined && v!=='').map(String))];
    if (values.length>1) consistent=false;
    live[key] = key==='port' ? Number(values[0]) : values[0] ?? (key==='scheme'?(entry?'https':'http'):'');
  }
  const current = stored?.profiles[stored.active];
  const conflicts=[];
  if (current) {
    const sources=[
      ['.vscode/settings.json',server && {...server.webServer,namespace:conn.ns,alias:conn.server}],
      ['project-env.json',central],
      ['.iris-agentic-dev.toml',config.exists && {host:t.host,port:t.web_port,scheme:t.scheme,namespace:t.namespace,tlsVerify:t.tls_verify}],
      ['.mcp.json',entry && {host:env.IRIS_HOST,port:env.IRIS_WEB_PORT,scheme:env.IRIS_SCHEME,namespace:env.IRIS_NAMESPACE,tlsVerify:env.IRIS_TLS_VERIFY}],
      [args===backend.args && args ? 'iris-session-backend.json' : '.mcp.json',flags],
    ];
    for (const [source,row] of sources) if (row) {
      for (const key of publicKeys) if (key!=='alias' || source==='.vscode/settings.json') {
        if (row[key]!==undefined && String(row[key])!==String(current[key])) conflicts.push(source+' / '+key);
      }
    }
    if (stored.serverName!==name) conflicts.push('project-env.json / mcp.serverName');
    const ref=/^private:([\w-]+)$/.exec(current.credentialRef);
    const credentials=stored.bindings?.central ? projectEnv.irisProfileCredentials : io.object(io.snapshot(files.private).text);
    const expected=ref && credentials?.[ref[1]];
    if (expected) for (const [source,row] of [['project-env.json',central],['.mcp.json',{username:env.IRIS_USERNAME,password:env.IRIS_PASSWORD}],['.iris-agentic-dev.toml',t]]) {
      for (const key of ['username','password']) if (row?.[key]!==undefined && row[key]!==expected[key]) conflicts.push(source+' / '+key);
    }
  }
  if (current && publicKeys.some(k=>current[k]!==live[k] && (k!=='alias'||server))) consistent=false;
  const bindings = {vscode:!!server, mcp:!!entry, toml:config.exists, central:!!central};
  const externalVscode=files.context.mode==='workspace-overlay' && typeof conn?.server==='string' && !!conn.server &&
    !server && !!entry && stored?.bindings?.vscode!==true;
  if (stored?.serverName && stored.serverName!==name) consistent=false;
  if (conn && !server && !externalVscode) consistent=false;
  if (stored?.bindings && Object.keys(bindings).some(k=>bindings[k]!==stored.bindings[k])) consistent=false;
  return {main,stored,live,bindings,name,centralCanonical:centralState.canonical,servers:settings['intersystems.servers'] || {},consistent:consistent && !conflicts.length,conflicts,
    missingVscode:!!conn && !server && !externalVscode,externalVscode,credentials:[central || {},{username:env.IRIS_USERNAME,password:env.IRIS_PASSWORD},t]};
}
function describe(root,io) {
  const s=readState(root,io);
  const current=s.stored?.profiles[s.stored.active];
  const target=current ? Object.fromEntries(publicKeys.map(key=>[key,current[key]])) : s.live;
  return {active:s.stored?.active ?? '',profiles:Object.keys(s.stored?.profiles || {}),target,
    bindings:s.bindings,consistent:s.consistent,conflicts:s.conflicts,verification:'configuration-only'};
}
function currentCredentials(values) {
  const pair={};
  for (const key of ['username','password']) {
    const candidates=[...new Set(values.map(row=>row[key]).filter(Boolean))];
    if (candidates.length!==1) reject('当前凭据缺失或多处不一致，请先核对私有来源。');
    pair[key]=candidates[0];
  }
  return pair;
}

function availableName(id,occupied) {
  if (!occupied.has(id)) return id;
  for (let n=2; n<=occupied.size+1; n++) {
    const suffix='-'+n;
    const candidate=id.slice(0,40-suffix.length)+suffix;
    if (!occupied.has(candidate)) return candidate;
  }
  reject('无法为当前工程分配档案连接标识。');
}

function prepareOverlay(root,request,io,files,s,mode) {
  const fallback=files.context.manifest?.projectEnvFallback;
  const shared=path.join(files.context.capabilityRoot,'config');
  const sharedEnv=path.join(shared,'project-env.json');
  const samePath=(left,right)=>process.platform==='win32' ? left.toLowerCase()===right.toLowerCase() : left===right;
  if (files.context.mode!=='workspace-overlay' || typeof fallback!=='string' ||
      !samePath(path.resolve(root,fallback),sharedEnv)) reject('当前工作区没有声明与标准根的开发库连接关系。');
  if (s.missingVscode || (s.stored?.serverName && s.stored.serverName!==s.name) ||
      (s.stored?.bindings && Object.keys(s.bindings).some(key=>s.stored.bindings[key] && !s.bindings[key]))) {
    reject('已登记的工程连接绑定无法安全识别，请核对配置来源。');
  }
  if (!s.bindings.mcp && !s.bindings.vscode && !s.bindings.toml && !s.bindings.central)
    reject('当前工作区缺少可同步的 IRIS 连接入口。');
  if (!request.connection) reject('请选择完整的开发库连接。');
  const id=validId(request.id);
  const individual=mode==='individual';
  const projection=!individual && !s.bindings.central && !s.stored;
  const initializeCentral=individual && !s.bindings.central;
  if (individual && !initializeCentral) reject('请从当前工作区的开发库档案编辑已有连接。');
  if (initializeCentral) {
    const main=io.object(io.snapshot(path.join(shared,'project.jsonc')).text);
    const legacy=io.object(io.snapshot(sharedEnv).text);
    const hasServices=['web','sftp'].some(key=>main.serviceConnections?.[key] !== undefined || legacy[key] !== undefined);
    if (hasServices && !io.snapshot(path.join(files.context.capabilityRoot,'scripts/lib/project-environment.js')).text.includes('inheritServices'))
      reject('当前共享框架还未支持模块独立开发库与共享 Web/SFTP，请更新共享 .agents 后重试。');
  }
  const ownProfiles=s.stored?.profiles || {};
  const otherProfiles=Object.entries(ownProfiles).filter(([key])=>key!==id).map(([,profile])=>profile);
  const existing=Object.hasOwn(ownProfiles,id) ? ownProfiles[id] : null;
  let alias=projection ? s.live.alias : existing?.alias || (individual ? request.connection.alias : '') || (!s.stored ? s.live.alias : id);
  if (s.bindings.vscode && !projection) {
    const referenced=new Set(otherProfiles.map(profile=>profile.alias));
    // An unrelated VS Code server stays intact even when its alias matches the incoming profile id.
    if (!alias || referenced.has(alias) || (Object.hasOwn(s.servers,alias) && alias!==existing?.alias && alias!==s.live.alias)) {
      alias=availableName(id,new Set([...Object.keys(s.servers),...referenced]));
    }
  }
  const bindings={...s.bindings, central:s.bindings.central || initializeCentral};
  const centralCanonical=s.centralCanonical || initializeCentral;
  const useLegacySecrets=bindings.central && !centralCanonical;
  const privateFile=projection ? null : io.snapshot(useLegacySecrets?files.env:files.private);
  const prefix=useLegacySecrets?['irisProfileCredentials']:[];
  let selectedKey=id;
  if (!projection) {
    const contents=io.object(privateFile.text);
    const secrets=useLegacySecrets ? contents.irisProfileCredentials || {} : contents;
    const refs=new Set(otherProfiles.map(profile=>profile.credentialRef));
    const current=/^private:([\w-]+)$/.exec(existing?.credentialRef || '')?.[1];
    const occupied=new Set(Object.keys(secrets));
    for (const ref of refs) if (typeof ref==='string' && ref.startsWith('private:')) occupied.add(ref.slice(8));
    if (current && !refs.has('private:'+current)) selectedKey=validId(current);
    else selectedKey=availableName(id,occupied);
  }
  if (request.useCurrentCredentials && (!individual || request.credentials?.username || request.credentials?.password))
    reject('请选择沿用当前凭据或提供独立凭据。');
  const pair=request.useCurrentCredentials ? currentCredentials(s.credentials) : request.credentials;
  const needsCredentials=bindings.central || bindings.mcp || bindings.toml;
  if (needsCredentials && (!pair?.username || !pair?.password)) reject('目标档案需要完整的私有凭据。');
  const selected=publicProfile({...request.connection,alias:alias || id},projection ? undefined : 'private:'+selectedKey);
  if (request.connection.description !== undefined) selected.description=request.connection.description;
  const mainEdits=[],edits=[];
  if (!projection) {
    if (initializeCentral) {
      mainEdits.push({path:['irisConnections','source'],value:'project.jsonc'}, {path:['irisConnections','inheritServices'],value:true});
    }
    for (const [key,value] of Object.entries({active:id,bindings,serverName:s.name})) mainEdits.push({path:['irisConnections',key],value});
    mainEdits.push({path:['irisConnections','profiles',id],value:selected});
    if (needsCredentials) edits.push({path:[...prefix,selectedKey],value:{username:pair.username,password:pair.password}});
  }
  const legacyHost=s.bindings.mcp && (!s.consistent || publicKeys.some(key=>selected[key]!==s.live[key])) &&
    checkSessionCompatibility(files.context.capabilityRoot,io);
  return {bindings,connection:{...selected,username:pair?.username,password:pair?.password,writeCredentials:needsCredentials},id,legacyHost,
    centralCanonical,initializeCentral,projection,overlayMode:mode,externalVscode:s.externalVscode,
    mainEdits,privateFile,edits,from:s.live,to:selected};
}

function prepare(root,request,io,mode) {
  const files = projectFiles(root);
  if (!fs.existsSync(path.join(files.context.capabilityRoot,'.git'))) reject('开发库档案需要已部署框架。');
  if (mode==='batch' || mode==='individual') return prepareOverlay(root,request,io,files,readState(root,io),mode);
  if (files.context.manifest?.projectEnvFallback && !io.snapshot(files.env).exists &&
      !environment.canonical(io.object(io.snapshot(files.main).text))) reject('请在当前连接来源所属工程维护继承的连接。');
  const s=readState(root,io);
  if (!s.consistent) reject('各入口的当前目标不一致，请核对 '+(s.conflicts.join('、') || '档案绑定')+'。');
  if (!s.live.host || !s.live.namespace || !s.live.port) reject('当前工程缺少可承接的生效连接。');
  const id=validId(request.id);
  const active=s.stored?.active || 'current';
  const profiles=s.stored?.profiles || {[active]:publicProfile(s.live,'private:'+active)};
  const known=Object.hasOwn(profiles,id);
  const editing=request.edit===true;
  if (editing && (!s.stored || id!==active || !request.connection)) reject('请先切换到要编辑的档案。');
  if (known && request.connection && !editing) reject('切换已有档案时只需选择档案标识。');
  if (!known && !request.connection) reject('新档案需要填写目标连接。');
  const activeRef=profiles[active].credentialRef;
  const replacement=editing && (request.credentials?.username || request.credentials?.password);
  const shared=replacement && Object.entries(profiles).some(([other,profile])=>other!==id && profile.credentialRef===activeRef);
  const selectedRef=shared ? 'private:'+id+'-local' : known ? profiles[id].credentialRef : request.useCurrentCredentials===true ? activeRef : 'private:'+id;
  function privateKey(ref) {
    if (typeof ref!=='string' || !ref.startsWith('private:')) reject('档案凭据引用无法识别。');
    return validId(ref.slice(8));
  }
  const activeKey=privateKey(activeRef), selectedKey=privateKey(selectedRef);
  if (request.useCurrentCredentials && (request.credentials?.username || request.credentials?.password))
    reject('请选择沿用当前凭据或提供独立凭据。');
  const selected=publicProfile(editing ? {...profiles[id],...request.connection} :
    known ? profiles[id] : {...s.live,...request.connection},selectedRef);
  if (!known && s.bindings.vscode) {
    if (!selected.alias || selected.alias===s.live.alias) selected.alias=id;
    if (Object.values(profiles).some(profile=>profile.alias===selected.alias)) reject('该 VS Code 服务器名已被其他开发库档案使用。');
  }
  const reuseVscode = s.bindings.vscode && Object.hasOwn(s.servers,selected.alias) && !(editing && selected.alias===s.live.alias);
  const vscodeServer = reuseVscode ? s.servers[selected.alias] : null;
  if (reuseVscode && ['host','port','scheme'].some(key=>String(vscodeServer?.webServer?.[key])!==String(selected[key]))) {
    reject('已有 VS Code 服务器的主机、端口或协议与目标档案不一致，请核对服务器名称和目标。');
  }
  const legacyHost=s.bindings.mcp && publicKeys.some(key=>selected[key]!==s.live[key]) && checkSessionCompatibility(files.context.capabilityRoot,io);
  const useLegacySecrets=s.bindings.central && !s.centralCanonical;
  const privateFile=io.snapshot(useLegacySecrets?files.env:files.private);
  const prefix=useLegacySecrets?['irisProfileCredentials']:[];
  const contents=io.object(privateFile.text);
  const secrets=useLegacySecrets?(contents.irisProfileCredentials || {}):contents;
  if (shared && Object.hasOwn(secrets,selectedKey)) reject('该档案的独立凭据标识已占用，请核对私有配置。');
  const edits=[];
  const needsCredentials=s.bindings.central || s.bindings.mcp || s.bindings.toml;
  let pair;
  if (needsCredentials) {
    const original=currentCredentials(s.credentials);
    if (selectedKey!==activeKey || !replacement) edits.push({path:[...prefix,activeKey],value:original});
    pair=replacement ? request.credentials : selectedKey===activeKey ? original : known ? secrets[selectedKey] : request.credentials;
    if (!pair?.username || !pair?.password) reject('目标档案需要独立的私有凭据。');
    if (reuseVscode && ['username','password'].some(key=>vscodeServer[key] && vscodeServer[key]!==pair[key])) {
      reject('已有 VS Code 服务器的私有凭据与目标档案不一致，请核对凭据来源。');
    }
    if (selectedKey!==activeKey || replacement) edits.push({path:[...prefix,selectedKey],value:{username:pair.username,password:pair.password}});
  }
  const mainEdits=[{path:['irisConnections','active'],value:id}];
  if (!s.stored) mainEdits.push({path:['irisConnections','bindings'],value:s.bindings},{path:['irisConnections','serverName'],value:s.name});
  if (!s.stored) mainEdits.push({path:['irisConnections','profiles',active],value:profiles[active]});
  if (!known) mainEdits.push({path:['irisConnections','profiles',id],value:selected});
  if (editing) for (const [key,value] of Object.entries({...selected,
    ...(request.connection.description !== undefined ? {description:request.connection.description} : {})})) {
    if (profiles[id][key]!==value) mainEdits.push({path:['irisConnections','profiles',id,key],value});
  }
  return {bindings:s.bindings,connection:{...selected,...pair,writeCredentials:!!pair},id,legacyHost,reuseVscode,centralCanonical:s.centralCanonical,externalVscode:s.externalVscode,
    main:s.main,mainEdits,privateFile,edits,from:s.live,to:selected};
}
module.exports={projectFiles,describe,prepare,awaitLegacyExit,projectEnvironment,sessionBackend};
