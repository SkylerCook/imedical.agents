'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mainPath = '.agents/config/project.jsonc';
const privatePath = '.agents/config/iris-profile-credentials.json';
const publicKeys = ['host','port','scheme','namespace','alias','tlsVerify'];
const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const reject = message => { throw new Error(message); };

function validId(id) {
  if (typeof id !== 'string' || !idPattern.test(id) || Object.hasOwn(Object.prototype,id) || id === 'prototype')
    reject('档案标识应以字母开头，仅使用字母、数字、下划线和短横线。');
  return id;
}
function checkSessionCompatibility(root,io) {
  const client=io.snapshot(path.join(root,'.agents/scripts/lib/iris-session-client.js'));
  if (!client.exists) return;
  const host=io.snapshot(path.join(root,'.agents/scripts/iris-session-host.js'));
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
function readState(root, io) {
  const read = file => io.snapshot(path.join(root,file));
  const main = read(mainPath);
  const stored = io.object(main.text).irisConnections;
  if (stored && (!stored.profiles || !Object.hasOwn(stored.profiles,validId(stored.active)))) reject('工程连接档案结构异常。');
  const settings = io.object(read('.vscode/settings.json').text);
  const conn = settings['objectscript.conn'];
  const server = conn && settings['intersystems.servers']?.[conn.server];
  const projectEnv=io.object(read('.agents/config/project-env.json').text);
  const name=projectEnv.mcp?.serverName || stored?.serverName || 'iris-agentic-dev';
  const entry = io.object(read('.mcp.json').text).mcpServers?.[name];
  const backend = io.object(read('.agents/config/iris-session-backend.json').text);
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
    const credentials=stored.bindings?.central ? projectEnv.irisProfileCredentials : io.object(read(privatePath).text);
    const expected=ref && credentials?.[ref[1]];
    if (expected) for (const [source,row] of [['project-env.json',central],['.mcp.json',{username:env.IRIS_USERNAME,password:env.IRIS_PASSWORD}],['.iris-agentic-dev.toml',t]]) {
      for (const key of ['username','password']) if (row?.[key]!==undefined && row[key]!==expected[key]) conflicts.push(source+' / '+key);
    }
  }
  if (current && publicKeys.some(k=>current[k]!==live[k] && (k!=='alias'||server))) consistent=false;
  const bindings = {vscode:!!server, mcp:!!entry, toml:config.exists, central:!!central};
  if (stored?.serverName && stored.serverName!==name) consistent=false;
  if (conn && !server) consistent=false;
  if (stored?.bindings && Object.keys(bindings).some(k=>bindings[k]!==stored.bindings[k])) consistent=false;
  return {main,stored,live,bindings,name,servers:settings['intersystems.servers'] || {},consistent:consistent && !conflicts.length,conflicts,
    credentials:[central || {},{username:env.IRIS_USERNAME,password:env.IRIS_PASSWORD},t]};
}
function describe(root,io) {
  const s=readState(root,io);
  const current=s.stored?.profiles[s.stored.active];
  const target=current ? Object.fromEntries(publicKeys.map(key=>[key,current[key]])) : s.live;
  return {active:s.stored?.active ?? '',profiles:Object.keys(s.stored?.profiles || {}),target,
    bindings:s.bindings,consistent:s.consistent,conflicts:s.conflicts,verification:'configuration-only'};
}
function prepare(root,request,io) {
  if (!fs.existsSync(path.join(root,'.agents/.git')) || fs.existsSync(path.join(root,'.agents/capability.json')))
    reject('开发库切换当前支持 standard 工程。');
  const s=readState(root,io);
  if (!s.consistent) reject('各入口的当前目标不一致，请核对 '+(s.conflicts.join('、') || '档案绑定')+'。');
  if (!s.live.host || !s.live.namespace || !s.live.port) reject('当前工程缺少可承接的生效连接。');
  const id=validId(request.id);
  const active=s.stored?.active || 'current';
  const profiles=s.stored?.profiles || {[active]:publicProfile(s.live,'private:'+active)};
  const known=Object.hasOwn(profiles,id);
  if (known && request.connection) reject('切换已有档案时只需选择档案标识。');
  if (!known && !request.connection) reject('新档案需要填写目标连接。');
  const activeRef=profiles[active].credentialRef;
  const selectedRef=known ? profiles[id].credentialRef : request.useCurrentCredentials===true ? activeRef : 'private:'+id;
  function privateKey(ref) {
    if (typeof ref!=='string' || !ref.startsWith('private:')) reject('档案凭据引用无法识别。');
    return validId(ref.slice(8));
  }
  const activeKey=privateKey(activeRef), selectedKey=privateKey(selectedRef);
  if (request.useCurrentCredentials && (request.credentials?.username || request.credentials?.password))
    reject('请选择沿用当前凭据或提供独立凭据。');
  const selected=publicProfile(known ? profiles[id] : {...s.live,...request.connection},selectedRef);
  if (!known && s.bindings.vscode) {
    if (!selected.alias || selected.alias===s.live.alias) selected.alias=id;
    if (Object.values(profiles).some(profile=>profile.alias===selected.alias)) reject('该 VS Code 服务器名已被其他开发库档案使用。');
  }
  const reuseVscode = s.bindings.vscode && Object.hasOwn(s.servers,selected.alias);
  const vscodeServer = reuseVscode ? s.servers[selected.alias] : null;
  if (reuseVscode && ['host','port','scheme'].some(key=>String(vscodeServer?.webServer?.[key])!==String(selected[key]))) {
    reject('已有 VS Code 服务器的主机、端口或协议与目标档案不一致，请核对服务器名称和目标。');
  }
  const legacyHost=s.bindings.mcp && publicKeys.some(key=>selected[key]!==s.live[key]) && checkSessionCompatibility(root,io);
  const privateFile=io.snapshot(path.join(root,s.bindings.central?'.agents/config/project-env.json':privatePath));
  const prefix=s.bindings.central?['irisProfileCredentials']:[];
  const contents=io.object(privateFile.text);
  const secrets=s.bindings.central?(contents.irisProfileCredentials || {}):contents;
  const edits=[];
  const needsCredentials=s.bindings.central || s.bindings.mcp || s.bindings.toml;
  let pair;
  if (needsCredentials) {
    const original={};
    for (const key of ['username','password']) {
      const values=[...new Set(s.credentials.map(row=>row[key]).filter(Boolean))];
      if (values.length!==1) reject('当前凭据缺失或多处不一致，请先核对私有来源。');
      original[key]=values[0];
    }
    edits.push({path:[...prefix,activeKey],value:original});
    pair=selectedKey===activeKey ? original : known ? secrets[selectedKey] : request.credentials;
    if (!pair?.username || !pair?.password) reject('目标档案需要独立的私有凭据。');
    if (reuseVscode && ['username','password'].some(key=>vscodeServer[key] && vscodeServer[key]!==pair[key])) {
      reject('已有 VS Code 服务器的私有凭据与目标档案不一致，请核对凭据来源。');
    }
    if (selectedKey!==activeKey) edits.push({path:[...prefix,selectedKey],value:{username:pair.username,password:pair.password}});
  }
  const mainEdits=[{path:['irisConnections','active'],value:id}];
  if (!s.stored) mainEdits.push({path:['irisConnections','bindings'],value:s.bindings},{path:['irisConnections','serverName'],value:s.name});
  if (!s.stored) mainEdits.push({path:['irisConnections','profiles',active],value:profiles[active]});
  if (!known) mainEdits.push({path:['irisConnections','profiles',id],value:selected});
  return {bindings:s.bindings,connection:{...selected,...pair,writeCredentials:!!pair},id,legacyHost,reuseVscode,
    main:s.main,mainEdits,privateFile,edits,from:s.live,to:selected};
}
module.exports={mainPath,privatePath,describe,prepare,awaitLegacyExit};
