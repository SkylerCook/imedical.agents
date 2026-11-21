'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {hash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const deployment = require('../../../scripts/lib/plugin-deployment');
const verification = require('../../../scripts/lib/iris-profile-verification');
const configuration = require('../../../scripts/lib/project-configuration');

const pluginAction = /^plugin-(inspect|install|enable|disable):([a-z0-9][a-z0-9-]{0,79})$/;
function accepts(action) { return typeof action==='string' && (['verify-connection','discover-iris-mcp'].includes(action) || pluginAction.test(action)); }
function checked(file) { return fs.lstatSync(file,{throwIfNoEntry:false})?.isFile(); }
function readJson(file) { return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')); }
function failure(code) { throw Object.assign(new Error(code),{workbenchCode:code}); }

function activeProfile(root,cap,unbound='connection-handoff') {
  const context={workspaceRoot:root,contextRoot:cap};
  const current=require('../../ai-dev-offline/configure-project').inspectProfiles({projectRoot:root});
  if (!current.active) failure('profile-required');
  if (!current.consistent || !current.bindings.mcp) failure(unbound);
  const active=verification.snapshot(context);
  if (!active) failure('profile-required');
  return {context,current,active};
}

function verifyConnection({root,cap,node,env}) {
  const {context,current,active}=activeProfile(root,cap);
  const entry=path.join(cap,'scripts/iris-mcp.js');
  if (!fs.readFileSync(entry,'utf8').includes('--verify-profile')) failure('profile-owner-unavailable');
  const {config}=require('../../../scripts/lib/project-environment').read(context,{optional:true,inherit:false});
  const selected=configuration.document(cap).value.irisConnections;
  const name=selected?.serverName || config.mcp?.serverName || 'iris-agentic-dev';
  const server=readJson(path.join(root,'.mcp.json')).mcpServers?.[name];
  const vendor=path.join(cap,'vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe');
  const adapter=path.join(cap,'scripts/iris-session-mcp.js');
  const same=(value,file)=>typeof value==='string' && path.resolve(root,value).toLowerCase()===file.toLowerCase();
  if (!server || server.disabled || !checked(vendor) || Object.keys(server.env||{}).some(key=>!/^IRIS_[A-Z0-9_]+$/.test(key))) failure('connection-handoff');
  const backend=configuration.inspect(context,'irisSessionBackend').value;
  const managed=server.args?.some(arg=>same(arg,adapter));
  if (managed && (!same(server.args[0],adapter) || !same(server.args[server.args.indexOf('--project-root')+1],root) ||
      server.args[server.args.indexOf('--server-name')+1]!==name || !/^node(?:\.exe)?$/i.test(path.basename(server.command||'')))) failure('connection-handoff');
  if (!(managed ? backend && backend.serverName===name && same(backend.command,vendor) : same(server.command,vendor)) ||
      (backend && (!same(backend.command,vendor) || backend.serverName!==name))) failure('connection-handoff');
  const args=(backend || server).args || ['mcp'];
  if (args[0]!=='mcp') failure('connection-handoff');
  for (let i=1;i<args.length;i++) {
    if (args[i]==='--no-skills') continue;
    const match=/^--(config|workspace|host|web-port|namespace|scheme)(?:=(.*))?$/.exec(args[i]);
    if (!match) failure('connection-handoff');
    const value=match[2] ?? args[++i];
    if (!value || match[1]==='config' && !same(value,path.join(root,'.iris-agentic-dev.toml')) ||
        match[1]==='workspace' && !same(value,root)) failure('connection-handoff');
  }
  env={...env};
  for (const key of Object.keys(env)) if (/^IRIS_/i.test(key)) delete env[key];
  const started=Date.now();
  const result=spawnSync(node,[entry,'check','--verify-profile','--json'],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:100000,maxBuffer:1024*1024});
  if (result.status!==0) failure('connection-check-failed');
  const reported=JSON.parse(result.stdout).CHECK?.profileTargetVerified;
  const evidence=verification.latest(context);
  if (!evidence || evidence.verified!==reported || Date.parse(evidence.checkedAt)<started || verification.snapshot(context)?.identity!==active.identity) failure('connection-check-stale');
  return {profile:current.active,verified:evidence.verified,checkedAt:evidence.checkedAt};
}

async function discoverTools({root,cap,node,env}) {
  const {context,current,active}=activeProfile(root,cap,'mcp-discovery-binding-required');
  const {parse}=require('../../../scripts/lib/configuration-file-io');
  const name=parse(fs.readFileSync(path.join(cap,'config/project.jsonc'),'utf8')).irisConnections.serverName;
  const server=readJson(path.join(root,'.mcp.json')).mcpServers?.[name];
  const adapter=path.join(cap,'scripts/iris-session-mcp.js');
  const args=server?.args;
  const same=(value,file)=>typeof value==='string' && path.resolve(root,value).toLowerCase()===file.toLowerCase();
  if (!server || typeof name!=='string' || !name || !Array.isArray(args) || args.length!==5 ||
      !same(args[0],adapter) || args[1]!=='--project-root' || !same(args[2],root) || args[3]!=='--server-name' || args[4]!==name ||
      !/^node(?:\.exe)?$/i.test(path.basename(server.command||''))) failure('mcp-discovery-handoff');
  if (server.disabled) failure('mcp-discovery-disabled');
  const backend=configuration.inspect(context,'irisSessionBackend').value;
  const vendor=path.join(cap,'vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe');
  if (backend?.schema!=='iris-session-backend/v1' || backend.serverName!==name || !same(backend.command,vendor) ||
      !Array.isArray(backend.args) || backend.args[0]!=='mcp' ||
      backend.managedHash!==hash('sha256',JSON.stringify({command:server.command,args}))) failure('mcp-discovery-handoff');
  const helper=path.join(cap,'scripts/iris-mcp.js');
  if (!checked(adapter) || !checked(helper)) failure('mcp-discovery-program-missing');
  const {JsonLineMcpClient,listTools}=require(helper);
  if (typeof JsonLineMcpClient!=='function' || typeof listTools!=='function') failure('mcp-discovery-program-missing');

  // Child code receives no saved credentials or user-supplied command from the browser.
  const childEnvironment=Object.fromEntries(Object.keys(process.env).map(key=>[key,undefined]));
  for (const [key,value] of Object.entries(env)) if (!/^IRIS_/i.test(key)) childEnvironment[key]=value;
  const client=new JsonLineMcpClient(node,[adapter,'--project-root',root,'--server-name',name],childEnvironment,
    {cwd:root,shutdownTimeoutMs:5000});
  let names;
  try {
    const protocolVersion='2024-11-05';
    const {result}=await client.request('initialize',{protocolVersion,capabilities:{},clientInfo:{name:'agents-workbench',version:'1.0.0'}},5000);
    if (result?.protocolVersion!==protocolVersion || result.serverInfo?.name!=='imedical-iris-managed') failure('mcp-discovery-failed');
    client.notify('notifications/initialized',{});
    names=(await listTools(client)).map(tool=>tool.name);
    if (!names.length || names.some(name=>typeof name!=='string' || !/^[a-z0-9_][a-z0-9_.-]{0,127}$/i.test(name))) failure('mcp-discovery-failed');
  } catch { failure('mcp-discovery-failed'); }
  finally {
    const exit=await client.close();
    if (!exit.processExited || !exit.gracefulExit) failure('mcp-discovery-exit-unverified');
  }
  if (verification.snapshot(context)?.identity!==active.identity) failure('connection-check-stale');
  return {profile:current.active,tools:names,processExited:true,backendPresent:Boolean(checked(vendor)),checkedAt:new Date().toISOString()};
}

function managePlugin({root,cap,node,ps,env,verify},operation,name) {
  const catalog=deployment.catalog(cap);
  const item=catalog.plugins.find(row=>row.manifest.name===name);
  if (!item || catalog.basePlugins.includes(name)) failure('plugin-unavailable');
  const owner=path.join(cap,'scripts/plugin-deploy.js');
  const profileOwner=path.join(cap,'scripts/update-plugin-profile.ps1');
  const pluginDir=path.join(cap,'plugins',item.directory);
  const thin=path.join(cap,'scripts/generate-plugin-thin-index.ps1');
  function run(program,args) {
    const r=spawnSync(program,args,{cwd:root,env,timeout:120000,windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024});
    if (r.status!==0) {
      const diagnostic=r.stderr || '';
      const reasons=[[/busy|locked/i,'deployment-busy'],[/local changes/,'plugin-checkout-dirty'],
        [/Catalog and plugin revision differ/,'plugin-catalog-mismatch'],[/Git .* failed|sparse|fetch/i,'plugin-materialization-failed'],
        [/Custom discovery|thin-index|discovery/i,'plugin-discovery-pending']];
      failure(reasons.find(([pattern])=>pattern.test(diagnostic))?.[1] || 'plugin-owner-failed');
    }
    return r.stdout;
  }
  const cli=(command,...args)=>JSON.parse(run(node,[owner,command,'--project-root',root,...args]));
  const powershell=(file,args)=>run(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,...args]);
  function inspect() {
    const rows=cli('list'), selected=rows.find(row=>row.name===name);
    if (!selected) failure('plugin-unavailable');
    const selection=deployment.closure(catalog,[name]).map(p=>p.manifest.name);
    const added=selection.filter(id=>!rows.some(row=>row.name===id && row.installed));
    const dependencies=selection.filter(id=>id!==name && !rows.some(row=>row.name===id && row.installed && row.status==='enabled'));
    const requiredBy=catalog.plugins.filter(row=>(row.manifest.dependencies||[]).some(id=>deployment.find(catalog,id).manifest.name===name)
      && rows.some(p=>p.name===row.manifest.name && p.status==='enabled')).map(row=>row.manifest.name);
    const missing=(item.manifest.requiresProjectFiles||[]).filter(relative=>!fs.existsSync(path.join(root,relative)));
    const init=item.manifest.initSkill;
    return {name,installed:selected.installed,status:selected.status,added,dependencies,requiredBy,missing,
      initialization:init && selected.status!=='enabled' && (selected.status!=='disabled' || missing.length) ? '.agents/plugins/'+item.directory+'/skills/'+init+'/SKILL.md' : null};
  }
  const before=inspect();
  if (operation==='inspect') return before;
  if (operation==='install') {
    if (before.added.length) cli('ensure','--explicit','--plugin',name);
    verify();
    const after=inspect();
    if (!after.installed || after.added.length) failure('plugin-readback-failed');
    return after;
  }
  const enable=operation==='enable';
  if (!before.installed || (enable && (before.initialization || before.dependencies.length || before.missing.length)) ||
      (!enable && before.requiredBy.length)) failure('plugin-action-conflict');
  const status=enable?'enabled':'disabled';
  if (before.status!==status) powershell(profileOwner,['-ProjectRoot',root,'-Plugin',name,'-Status',status]);
  const thinArgs=['-ProjectRoot',root,'-PluginPath',pluginDir,'-Mode','DryRun',...(enable?[]:['-Remove'])];
  const report=powershell(thin,thinArgs);
  const entries=report.trim().split(/\r?\n\s*\r?\n/).filter(block=>/^status\s*:/mi.test(block));
  const discovered=[];
  for (const block of entries) {
    const value=field=>block.match(new RegExp('^'+field+'[ \\t]*:[ \\t]*([^\\r\\n]*)','mi'))?.[1]?.trim();
    const code=value('status'),target=value('target');
    if (code==='skipped' || code==='missing' && /^plugin has no (rules|skills) directory$/.test(value('reason'))) continue;
    if (!target || !['removed','unchanged'].includes(code)) failure('plugin-discovery-pending');
    const file=path.resolve(root,target);
    if (!file.startsWith(cap+path.sep) || (enable ? code!=='unchanged' || !checked(file) : fs.existsSync(file))) failure('plugin-discovery-pending');
    discovered.push(target);
  }
  if (!entries.length) failure('plugin-discovery-pending');
  const after=inspect();
  if (after.status!==status) failure('plugin-readback-failed');
  return {...after,discoveryChecked:true,discovered};
}
function execute(action,options) {
  if (action==='discover-iris-mcp') return discoverTools(options)
    .then(discovery=>({discovery}),error=>({error:error.workbenchCode || 'owner-action-unavailable'}));
  try {
    if (action==='verify-connection') return {connection:verifyConnection(options)};
    const [,operation,name]=pluginAction.exec(action);
    return {plugin:managePlugin(options,operation,name)};
  } catch(error) { return {error:error.workbenchCode || 'owner-action-unavailable'}; }
}
module.exports={accepts,execute};
