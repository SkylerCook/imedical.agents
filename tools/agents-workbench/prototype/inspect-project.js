// Read fixed known sources only. Never return any configuration value, even unknown fields.
const fs=require('node:fs'),path=require('node:path');
const configuration = require('../../../scripts/lib/configuration-file-io');
const developmentOwner = require('../../../scripts/lib/iris-development-settings');
const pluginOwner = require('../../../scripts/lib/project-plugin-profile');
const { inspectClients } = require('../src/agent-handoff');

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

module.exports=function inspect(root){
 const sources=[['IRIS / Web / SFTP','.agents/config/project-env.json','当前工程'],['MCP 服务','.mcp.json','当前工程'],['受管 MCP backend','.agents/config/iris-session-backend.json','当前工程'],['BOS 查询与日志',process.env.BOS_MCP_CONFIG,'共享个人配置'],['知识提供方与 Key',process.env.KNOWLEDGE_RAG_CONFIG,'共享个人配置']];
 const domains=sources.map(([name,file,scope])=>{const out={name,scope,source:scope==='当前工程'?file:name.startsWith('BOS')?'BOS_MCP_CONFIG':'KNOWLEDGE_RAG_CONFIG',fields:[]};if(!file)return {...out,status:'当前进程未绑定来源'};try{const raw=fs.readFileSync(path.isAbsolute(file)?file:path.join(root,file),'utf8').replace(/^\uFEFF/,'');const data=out.source==='KNOWLEDGE_RAG_CONFIG'?require('../../../scripts/lib/configuration-file-io').parse(raw):JSON.parse(raw);function walk(v,p){if(v&&typeof v==='object'){for(const [k,x]of Object.entries(v))walk(x,p?p+'.'+k:k)}else out.fields.push({key:p,status:v===null||v===''?'未填写':'已设置',sensitive:/password|token|key|cookie|secret/i.test(p)});}walk(data,'');return {...out,status:'已真实读取'}}catch(e){return {...out,status:e.code==='ENOENT'?'来源文件不存在':'读取或格式解析失败，未改动原文件'}}});
 const context=require('../../../scripts/lib/workspace-context').resolveWorkspaceContext(root);
 const configIssue=checkProjectConfig(context.contextRoot);
 const declaration=readDevelopment(context.contextRoot,configIssue);
 domains.push({name:'开发方式',scope:'当前工程',source:declaration.source || (declaration.canonical?'config/project.jsonc · irisDevelopment':'config/iris-development.json'),status:declaration.issue?'待核对':declaration.value?'已真实读取':'未声明',issue:declaration.issue,fields:Object.keys(declaration.value||{}).map(key=>({key,status:'已设置',sensitive:false}))});
 const state=readPluginState(context.contextRoot,configIssue);
 const plugins=Object.entries(state.entries).map(([name,row])=>({name,status:row.status}));
 const profiles=['iris_project_profile.md','project_context_profile.md','cure_form_profile.md','demand_delivery_profile.md','i18n_project_profile.md'].map(name=>({name,exists:fs.existsSync(path.join(root,'.agents/config',name))}));
 const clients=inspectClients(context.workspaceRoot);
 const indexes=['index.sqlite','company.sqlite','local.sqlite'].map(name=>{try{const st=fs.statSync(path.join(root,'.agents/.knowledge-cache',name));return {name,exists:true,bytes:st.size,updated:st.mtime.toISOString()}}catch{return {name,exists:false}}});
 const receipts=[];const dir=path.join(root,'.ai-dev-config-backups');
 if(fs.existsSync(dir))for(const id of fs.readdirSync(dir).filter(n=>/^[a-f0-9-]{36}$/.test(n))){try{const f=path.join(dir,id,'receipt.json');const r=JSON.parse(fs.readFileSync(f,'utf8'));if(r.tool==='ai-dev-project')receipts.push({id,state:r.state,files:r.entries?.length||0,updated:fs.statSync(f).mtime.toISOString()})}catch{}}
 return {name:path.basename(root),checkedAt:new Date().toISOString(),domains,plugins,configIssue,pluginIssue:state.issue,profiles,clients,indexes,receipts,hasFramework:fs.existsSync(path.join(root,'.agents'))};
};

module.exports.checkProjectConfig = checkProjectConfig;
module.exports.readDevelopment = readDevelopment;
