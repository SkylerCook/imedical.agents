'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {parse} = require('./configuration-file-io');

const environment = {host:'IRIS_HOST', port:'IRIS_WEB_PORT', scheme:'IRIS_SCHEME',
  namespace:'IRIS_NAMESPACE', tlsVerify:'IRIS_TLS_VERIFY', username:'IRIS_USERNAME', password:'IRIS_PASSWORD'};

function conflict(source, field) {
  const code = 'iris-profile-conflict: ' + source + ' / ' + field;
  throw Object.assign(new Error(code), {code, beforeSend:true});
}
function read(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')); }
  catch { conflict(path.basename(file),'JSON'); }
}
function selection(context) {
  const dir = path.join(context.contextRoot,'config');
  const main = path.join(dir,'project.jsonc');
  if (!fs.existsSync(main)) return;
  const state = parse(fs.readFileSync(main,'utf8')).irisConnections;
  if (state === undefined) return;
  const profile = state?.profiles?.[state.active];
  if (!profile || !Object.hasOwn(state.profiles,state.active) || !profile.host || !profile.namespace ||
      !Number.isInteger(profile.port) || !['http','https'].includes(profile.scheme) ||
      typeof profile.tlsVerify !== 'boolean' || !state.serverName) conflict('project.jsonc','irisConnections');
  return state;
}
function selected(context,{requireBindings=false}={}) {
  const state=selection(context);
  if (!state) return;
  const dir=path.join(context.contextRoot,'config');
  const profile=state.profiles[state.active];
  const central = read(path.join(dir,'project-env.json'));
  if (requireBindings && state.bindings?.central && !central.iris) conflict('project-env.json','iris');
  const credentials = state.bindings?.central ? central.irisProfileCredentials : read(path.join(dir,'iris-profile-credentials.json'));
  const reference = /^private:([\w-]+)$/.exec(profile.credentialRef);
  const pair = reference && credentials?.[reference[1]];
  const expected = {...profile, username:pair?.username, password:pair?.password};
  function compare(field,value,source) {
    if (value !== undefined && expected[field] !== undefined && String(value) !== String(expected[field])) conflict(source,field);
  }
  function checkArgs(args,source) {
    for (let i=0; i<(args || []).length; i++) {
      const match = /^--(host|web-port|scheme|namespace|config)(?:=(.*))?$/.exec(args[i]);
      if (!match) continue;
      const value = match[2] ?? args[++i];
      if (!value) conflict(source,match[1]);
      if (match[1]==='config') {
        if (path.resolve(context.workspaceRoot,value)!==path.join(context.workspaceRoot,'.iris-agentic-dev.toml')) conflict(source,'--config');
      } else compare(match[1]==='web-port'?'port':match[1],value,source);
    }
  }
  function checkServer(server,source, effective=false) {
    for (const [field,key] of Object.entries(environment)) compare(field,server?.env?.[key],source);
    checkArgs(server?.args,source);
    if (effective) {
      if (!state.bindings?.mcp || !server) conflict(source,'mcp binding');
      for (const key of ['IRIS_HOST','IRIS_WEB_PORT','IRIS_NAMESPACE']) if (!server.env?.[key]) conflict(source,key);
      compare('tlsVerify',server.env.IRIS_TLS_VERIFY ?? false,source);
      compare('scheme',server.env.IRIS_SCHEME || 'https',source);
    }
  }
  function checkName(name,source) {
    if (name!==state.serverName) conflict(source,'serverName');
  }
  if (central.mcp?.serverName !== undefined) checkName(central.mcp.serverName,'project-env.json');
  for (const field of Object.keys(environment)) compare(field,central.iris?.[field],'project-env.json');
  const toml = path.join(context.workspaceRoot,'.iris-agentic-dev.toml');
  const vscode = path.join(context.workspaceRoot,'.vscode/settings.json');
  if (state.bindings?.vscode) {
    if (!fs.existsSync(vscode)) conflict('.vscode/settings.json','missing');
    const settings=parse(fs.readFileSync(vscode,'utf8'));
    const conn=settings['objectscript.conn'];
    const web=settings['intersystems.servers']?.[conn?.server]?.webServer;
    if (!web || conn.server!==profile.alias) conflict('.vscode/settings.json','objectscript.conn');
    compare('namespace',conn.ns,'.vscode/settings.json');
    for (const key of ['host','scheme','port']) compare(key,web[key],'.vscode/settings.json');
  }
  if (state.bindings?.toml) {
    if (!fs.existsSync(toml)) conflict('.iris-agentic-dev.toml','missing');
    let data;
    try { data = require('../../vendor/iarna-toml/parse-string')(fs.readFileSync(toml,'utf8').replace(/^\uFEFF/,'')); }
    catch { conflict('.iris-agentic-dev.toml','TOML'); }
    for (const [field,key] of Object.entries({host:'host',port:'web_port',scheme:'scheme',namespace:'namespace',tlsVerify:'tls_verify',username:'username',password:'password'}))
      compare(field,data[key],'.iris-agentic-dev.toml');
  }
  const server = read(path.join(context.workspaceRoot,'.mcp.json')).mcpServers?.[state.serverName];
  checkServer(server,'.mcp.json',requireBindings && state.bindings?.mcp);
  const backend = read(path.join(dir,'iris-session-backend.json'));
  if (backend.serverName !== undefined) {
    checkName(backend.serverName,'iris-session-backend.json');
    checkArgs(backend.args,'iris-session-backend.json');
  }
  const {host,port,scheme,namespace,tlsVerify}=profile;
  return {profile:{host,port,scheme,namespace,tlsVerify},serverName:state.serverName,bindings:state.bindings,checkName,checkServer};
}
module.exports = {selected,selection};
