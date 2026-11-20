// Read fixed known sources only. Never return any configuration value, even unknown fields.
const fs=require('node:fs'),path=require('node:path');
const configuration = require('../../../scripts/lib/configuration-file-io');
const developmentOwner = require('../../../scripts/lib/iris-development-settings');
const pluginOwner = require('../../../scripts/lib/project-plugin-profile');
const { databasePath } = require('../../../scripts/lib/knowledge-retrieval');
const { safeFile } = require('../../../scripts/lib/knowledge-sources');
const { inspectClients, projectProfiles } = require('../src/agent-handoff');
const { readReceipts } = require('../../ai-dev-offline/configure-project');
const { observePluginDeployment } = require('../src/task-owner-observations');
const { inspectOverlayLink } = require('../src/overlay-members');
const { inspectFramework, inspectProjectContext } = require('../src/project-context');

function checkProjectConfig(contextRoot) {
 const directory = path.join(contextRoot,'config');
 const main = path.join(directory,'project.jsonc');
 try {
  for (const name of [contextRoot,directory]) {
   const stat = fs.lstatSync(name,{throwIfNoEntry:false});
   if (stat && !stat.isDirectory()) throw Error();
  }
  const stat = fs.lstatSync(main,{throwIfNoEntry:false});
  if (!stat) return;
  if (!stat.isFile() || stat.nlink !== 1) throw Error();
  configuration.parse(configuration.readText(main));
 } catch {
  return '工程主配置 config/project.jsonc 无法安全读取。请核对文件路径、UTF-8 编码与 JSONC 格式，再重新读取。';
 }
}

function readDevelopment(contextRoot,configIssue) {
 if (configIssue) return {issue:configIssue,source:'config/project.jsonc · irisDevelopment'};
 try { return developmentOwner.inspect(contextRoot); }
 catch (error) {
  const issue = error.message === 'conflicting-development-config'
   ? '主配置 irisDevelopment 与旧 iris-development.json 同时有效。请核对实际开发模式及来源后重新读取。'
   : '开发声明无法读取。请核对主配置的 irisDevelopment 节与旧 iris-development.json。';
  return {issue,source:'config/project.jsonc · irisDevelopment / config/iris-development.json'};
 }
}

function readPluginState(contextRoot,configIssue) {
 if (configIssue) return {issue:configIssue,entries:{}};
 try { return pluginOwner.read(contextRoot); }
 catch (error) {
  const issue = error.message.startsWith('Conflicting plugin states:')
   ? '主配置 plugins 节与旧 plugin_profile.md 同时有效。请核对实际启停状态及来源后重新读取。'
   : '插件状态无法读取。请核对主配置的 plugins 节与旧 plugin_profile.md。';
  return {issue,entries:{}};
 }
}

function observeKnowledgeCaches(root, context, overlay) {
 const shared = context?.mode === 'workspace-overlay';
 const local = path.isAbsolute(root) && !/^[\\/]{2}/u.test(root);
 let capabilityRoot = shared ? overlay?.root.capabilityRoot : context?.capabilityRoot;
 if (local && capabilityRoot && !shared && fs.existsSync(path.join(root,'scripts/install-agents.ps1')) &&
     inspectFramework(root).status === 'framework-checkout') {
  capabilityRoot = undefined;
  try {
   const marker = safeFile(root,'plugins/coding-iris-plugin/.agents-plugin/plugin.json');
   if (fs.lstatSync(marker).isFile()) capabilityRoot = root;
  } catch { /* A partial source checkout cannot establish the cache root. */ }
 }
 return ['openai','company','local'].map(provider => {
  const file = databasePath({capabilityRoot:capabilityRoot ?? root},{provider});
  const index = {name:path.basename(file),shared,status:'unverified',exists:false};
  if (!local || !capabilityRoot) return index;
  try {
   const cache = fs.lstatSync(path.dirname(file),{throwIfNoEntry:false});
   if (!cache) return {...index,status:'missing'};
   if (!cache.isDirectory()) return index;
   const stat = fs.lstatSync(file,{throwIfNoEntry:false});
   if (!stat) return {...index,status:'missing'};
   if (!stat.isFile() || stat.nlink !== 1) return index;
   return {...index,status:'present',exists:true,bytes:stat.size,updated:stat.mtime.toISOString()};
  } catch { return index; }
 });
}

module.exports=function inspect(root,signRecovery){
 const sources=[['IRIS / Web / SFTP','.agents/config/project-env.json','当前工程'],['MCP 服务','.mcp.json','当前工程'],['受管 MCP backend','.agents/config/iris-session-backend.json','当前工程'],['BOS 查询与日志',process.env.BOS_MCP_CONFIG,'共享个人配置'],['知识提供方与 Key',process.env.KNOWLEDGE_RAG_CONFIG,'共享个人配置']];
 const domains=sources.map(([name,file,scope])=>{
  const out={name,scope,source:scope==='当前工程'?file:name.startsWith('BOS')?'BOS_MCP_CONFIG':'KNOWLEDGE_RAG_CONFIG',fields:[]};
  if(!file)return {...out,status:'当前进程未绑定来源'};
  try{
   const full=path.isAbsolute(file)?file:path.join(root,file);
   const data=scope==='共享个人配置'
    ? configuration.parse(configuration.readText(full))
    : JSON.parse(fs.readFileSync(full,'utf8').replace(/^\uFEFF/,''));
   function walk(v,p){if(v&&typeof v==='object'){for(const [k,x]of Object.entries(v))walk(x,p?p+'.'+k:k)}else out.fields.push({key:p,status:v===null||v===''?'未填写':'已设置',sensitive:/password|token|key|cookie|secret/i.test(p)});}
   walk(data,'');
   return {...out,status:'已真实读取'};
  }catch(e){return {...out,status:e.code==='ENOENT'?'来源文件不存在':'读取或格式解析失败，未改动原文件'}}
 });
 const context=inspectProjectContext(root);
 const configIssue=context ? checkProjectConfig(context.contextRoot) : '工程声明无法安全读取，请先核对当前工程 .agents/capability.json。';
 const declaration=readDevelopment(context?.contextRoot,configIssue);
 domains.push({name:'开发方式',scope:'当前工程',source:declaration.source || (declaration.canonical?'config/project.jsonc · irisDevelopment':'config/iris-development.json'),status:declaration.issue?'待核对':declaration.value?'已真实读取':'未声明',issue:declaration.issue,fields:Object.keys(declaration.value||{}).map(key=>({key,status:'已设置',sensitive:false}))});
 const state=readPluginState(context?.contextRoot,configIssue);
 const plugins=Object.entries(state.entries).map(([name,row])=>({name,status:row.status}));
 const profiles=projectProfiles.map(name=>({name,exists:!!context && fs.existsSync(path.join(context.contextRoot,'config',name))}));
 const clients=inspectClients(root);
 let overlay;
 if (context?.mode === 'workspace-overlay' && path.isAbsolute(root) && !/^[\\/]{2}/u.test(root)) {
  try { overlay=inspectOverlayLink(root) ?? null; }
  catch { overlay=null; }
 }
 const indexes=observeKnowledgeCaches(root,context,overlay);
 return {name:path.basename(root),checkedAt:new Date().toISOString(),domains,plugins,configIssue,pluginIssue:state.issue,profiles,clients,indexes,
  ...readReceipts(root,signRecovery),pluginDeployment:context ? observePluginDeployment(root,overlay) : undefined,hasFramework:fs.existsSync(path.join(root,'.agents'))};
};

module.exports.checkProjectConfig = checkProjectConfig;
module.exports.readDevelopment = readDevelopment;
