'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const owner=require('../../ai-dev-offline/configure-project');
const managedConfiguration = require('../../../scripts/lib/project-configuration-service');
const environment = require('../../../scripts/lib/project-environment');
const configurationIO = require('../../../scripts/lib/configuration-file-io');
const configurationFields = require('../../../scripts/lib/project-configuration-fields');
const policy = require('../../../scripts/lib/project-deployment-policy');
const deployment = require('../../../scripts/lib/plugin-deployment');
const {workspaceContextBlockers} = require('../../../scripts/lib/workspace-context');
const {inspectProjectContext} = require('../src/project-context');
const developmentOwner = require('../../../scripts/lib/iris-development-settings');
const {checkProjectConfig,readDevelopment} = require('./inspect-project');
const developmentFields = ['developmentMode','environmentAlias','environmentType'];
const pluginSettings=require('../../../scripts/lib/project-plugin-settings');
const policyField = 'deployment.autoInstall';
const keys=['host','port','scheme','namespace','alias','description','tlsVerify'];
const sourceKeys=['web.basePath','web.cspBasePath','web.brokerPath','web.cookie','sftp.enabled','sftp.host','sftp.port','sftp.username','sftp.password','sftp.localPath','sftp.remotePath'];
const bindings=['.vscode/settings.json','.mcp.json','.iris-agentic-dev.toml'];
function settingsContext(root) {
 const context=inspectProjectContext(root);
 if (!context) fail('工程声明无法安全读取，请先核对当前工程 .agents/capability.json。');
 return context;
}
const digest=root=>{
 const ctx=settingsContext(root);
 const sources=[...bindings.map(f=>path.join(root,f)),
   ...['project.jsonc','project-env.json','iris-session-backend.json','iris-development.json']
     .map(file=>path.join(ctx.contextRoot,'config',file))];
 const hashes=sources.map(file=>owner.snapshot(file).hash);
 for(const spec of Object.values(pluginSettings.domains)) {
   try { hashes.push(owner.snapshot(path.join(ctx.contextRoot,'config',spec.file)).hash); }
   catch { hashes.push('unreadable'); }
 }
 return crypto.createHash('sha256').update(hashes.join('|')).digest('hex');
};
const fail=message=>{const e=new Error(message);e.name='SettingsError';throw e};
function independentNode() {
 const executable=process.platform==='win32'?'node.exe':'node';
 const fromPath=(process.env.PATH || '').split(path.delimiter).map(folder=>folder.trim().replace(/^"(.*)"$/u,'$1'))
   .filter(folder=>path.isAbsolute(folder) && !folder.startsWith('\\\\'));
 for (const candidate of new Set([...fromPath.map(folder=>path.join(folder,executable)),process.execPath])) {
   try {
     const actual=fs.realpathSync.native(candidate);
     if ([candidate,actual].some(file=>path.basename(path.dirname(file)).toLowerCase()==='runtime' &&
         fs.existsSync(path.join(path.dirname(file),'..','workbench-release.json')))) continue;
     if (owner.supportsManagedNode(actual)) return actual;
   } catch { /* Continue past missing or inaccessible installations. */ }
 }
 fail('受管 MCP 需要可独立使用的 Node.js 22.5.0 或以上。请使用 AI 开发环境离线安装助手准备 Node，再打开工作台。');
}
function createProjectSettings(root){
 const plans=new Map();
 const runtime={resolveNodeExe:independentNode,
   annotateConfiguration:text=>configurationIO.annotate(text,configurationFields.notes(configurationIO.parse(text)))};
 function managedContext(){
   const ctx=settingsContext(root);
   if (ctx.mode==='invalid' || (ctx.mode==='workspace-overlay' && workspaceContextBlockers(ctx).length)) fail('工程工作区尚未就绪');
   return ctx;
 }
 function inspectManaged(){
   const ctx=managedContext();
   const installed=fs.existsSync(path.join(ctx.capabilityRoot,'scripts','configure-agents.js'));
   return {...managedConfiguration.read(ctx),installed};
 }
 function planManaged(request){
   const ctx=managedContext();
   if (!fs.existsSync(path.join(ctx.capabilityRoot,'scripts','configure-agents.js'))) fail('请先更新当前工程的框架');
   let preview;
   try { preview=managedConfiguration.plan(ctx,request); }
   catch (error) { fail(error.message==='project-config-changed'?'配置已变化，请重新读取后再预览。':'存在无效字段、配置冲突或待迁移来源，请核对当前分节。'); }
   for (const [id,value] of plans) if(value.expires<Date.now()) plans.delete(id);
   if (plans.size>=20) fail('预览数量过多，请稍后重试');
   const planId=crypto.randomUUID();
   plans.set(planId,{managed:request,revision:digest(root),expires:Date.now()+300000});
   return {...preview, planId, scope:ctx.mode==='workspace-overlay'?'当前工作区':'当前工程'};
 }
 function readPolicy() {
   const ctx = settingsContext(root);
   if (ctx.mode === 'invalid' || (ctx.mode !== 'standard' && workspaceContextBlockers(ctx).length)) return null;
   if (!fs.existsSync(path.join(ctx.capabilityRoot,'.git'))) return null;
   let current;
   try { current = policy.read(ctx.contextRoot); }
   catch (error) {
     if (error.message.startsWith('Conflicting deployment sources')) fail('project.jsonc 的 deployment 节与 plugin-deployment.json 同时存在，请核对两处部署策略');
     if (error.message.startsWith('Invalid JSONC at offset')) fail('工程配置无法解析：' + error.message);
     fail('部署策略格式或文件路径异常，请检查当前工程 config 目录');
   }
   if (!current.configured && !current.hasOld) return null;
   return {ctx,value:current.value,readOnly:ctx.mode !== 'standard' || current.hasOld,
     source:current.hasOld?'ContextRoot/config/plugin-deployment.json · 通过原更新器 Write 迁移':'ContextRoot/config/project.jsonc · deployment'};

 }
 function inspect(){if(!root)fail('尚未绑定工程');const ctx=settingsContext(root);const data=owner.inspect({projectRoot:root});
 const configIssue=checkProjectConfig(ctx.contextRoot);
 let env={config:{}},connectionIssue;
 if (!configIssue) {
   try { env=environment.read(ctx,{optional:true}); }
   catch { connectionIssue='工程连接来源有冲突或无法读取，请核对有效档案与旧配置。'; }
 }
 const central=env.config;const c=data.active ? {...central.iris,...Object.fromEntries(keys.map(key=>[key,data[key]]))} : central.iris||{};
 let currentPolicy,policyIssue=configIssue;
 if (!policyIssue) {
   try { currentPolicy=readPolicy(); }
   catch(error) { policyIssue=error.name==='SettingsError'?error.message:'部署策略无法读取，请核对配置来源。'; }
 }
 const dev=readDevelopment(ctx.contextRoot,configIssue);
 const issue=(id,label,value,source)=>({id,label,type:'string',value,source,readOnly:true});
 const devFields=dev.issue ? [issue('irisDevelopment.issue','开发模式待核对',dev.issue,dev.source)] : dev.value ? developmentFields.map(key=>({id:'irisDevelopment.'+key,label:key,type:'string',value:dev.value[key]??'',readOnly:ctx.mode!=='standard'||!dev.canonical,source:dev.canonical?'ContextRoot/config/project.jsonc':'ContextRoot/config/iris-development.json'})) : [];
 const policyFields=policyIssue ? [issue('deployment.issue','部署策略待核对',policyIssue,'ContextRoot/config/project.jsonc · deployment')]
   : currentPolicy ? [{id:policyField,label:'允许自动补装插件',type:'boolean',value:currentPolicy.value.autoInstall,readOnly:currentPolicy.readOnly,source:currentPolicy.source}] : [];

 let connectionFields=(dev.issue || connectionIssue) ? [issue('irisConnections.issue','连接写入待核对',connectionIssue || '核对开发声明后可修改或切换连接。','ContextRoot/config/project.jsonc · irisConnections')] : [];
 if(!dev.issue && !connectionIssue && !env.inherited && fs.existsSync(path.join(ctx.capabilityRoot,'.git'))) {
   let state;
   try { state=owner.inspectProfiles({projectRoot:root}); }
   catch { connectionFields=[{id:'irisConnections.status',label:'目标核验',type:'string',readOnly:true,value:'现有连接使用了无法识别的绑定，请核对目标来源。'}]; }
   if(state?.target.host && state.target.namespace) {
     const source='ContextRoot/config/project.jsonc · irisConnections';
     let evidence;
     if (state.active && state.consistent) {
       try { evidence=require('../../../scripts/lib/iris-profile-verification').latest(ctx); } catch { /* An unreadable receipt cannot verify a target. */ }
     }
     const status=evidence ? (evidence.verified?'已核验所选库':'目标核验未通过')+' · '+evidence.checkedAt :
       state.consistent?'配置已读取，服务器身份待核验':'各入口配置不一致'+(state.conflicts?.length?' · '+state.conflicts.join('、'):'');
     connectionFields=[
       {id:'irisConnections.active',label:'切换到已有档案',type:'string',value:state.active||'current',options:state.profiles.length?state.profiles:['current'],source},
       {id:'irisConnections.new',label:'新增并切换（填写标识及下方 IRIS 连接）',type:'string',value:'',source},
       {id:'irisConnections.useCurrentCredentials',label:'新档案沿用当前库的私有凭据',type:'boolean',value:false,source},
       {id:'irisConnections.status',label:'目标核验',type:'string',readOnly:true,value:status,source}
     ];
   }
 }
 const connectionValues=keys.map(k=>({id:k,label:k,type:typeof (k==='port'?(c.port||data.port):k==='tlsVerify'?(c.tlsVerify??data.tlsVerify):c[k]??data[k]),value:k==='port'?(c.port||data.port):k==='tlsVerify'?(c.tlsVerify??data.tlsVerify):c[k]??data[k]})).concat(['username','password'].map(k=>({id:k,label:k,type:'string',secret:true,configured:!!c[k]||data.hasCredentials}))).concat(sourceKeys.filter(k=>{
   const [section,key]=k.split('.');
   return central[section]?.[key]!==undefined || (env.canonical && section==='web');
 }).map(k=>{
   const [section,key]=k.split('.'),value=central[section]?.[key] ?? '';
   const secret=/username|password|cookie/.test(k);
   return {id:k,label:k,type:typeof value,secret,configured:!!value,value:secret?undefined:value};
 }));
 const pluginFields=[];
 for(const [id,spec] of Object.entries(pluginSettings.domains)) {
   if(configIssue || !fs.existsSync(path.join(ctx.capabilityRoot,'plugins',id,'.agents-plugin/plugin.json'))) continue;
   const prefix='pluginSettings.'+id+'.';
   try {
     const state=pluginSettings.inspect(ctx,id);
     if(!state.canonical && !Object.keys(state.values).length) continue;
     for(const key of new Set([...(spec.keys||[]),...Object.values(spec.aliases||{})])) {
       pluginFields.push({id:prefix+key,label:key,type:'string',value:state.values[key]??'',readOnly:!state.canonical || id==='coding-iris-plugin',source:'ContextRoot/config/'+(state.canonical?'project.jsonc':spec.file)});
     }
   } catch {pluginFields.push(issue(prefix+'issue',id,'请核对 '+spec.file+' 和 project.jsonc 中的插件配置。','ContextRoot/config'));}
 }
 const usableConnection=connectionValues.map(field=>({...field,
   source:env.canonical?'ContextRoot/config/project.jsonc':field.source,
   readOnly:!!dev.issue || !!connectionIssue || env.inherited}));
 return {id:'project',revision:digest(root),scope:ctx.mode==='workspace-overlay'?'当前工作区':'当前工程',
   fields:usableConnection.concat(policyFields,devFields,connectionFields,pluginFields)}}
 function plan(request){const model=inspect();if(request.revision!==model.revision)fail('工程配置已变化，请重新读取');const requested=Object.entries(request.changes||{});
 if (requested.some(([key])=>key.startsWith('pluginSettings.'))) {
   const plugin=requested[0][0].split('.')[1],changes={};
   for(const [id,change] of requested) {
     if(!id.startsWith('pluginSettings.'+plugin+'.') || !model.fields.some(f=>f.id===id && !f.readOnly) || typeof change.value!=='string') fail('请分别保存每个插件的配置');
     changes[id.split('.')[2]]=change.value;
   }
   const planId=crypto.randomUUID();
   for(const [key,v] of plans) if(v.expires<Date.now()) plans.delete(key);
   if(plans.size>=20) fail('预览数量过多');
   plans.set(planId,{plugin,changes,revision:model.revision,expires:Date.now()+300000});
   return {planId,scope:plugin,changes:requested.map(([field])=>({field,action:'修改'}))};
 }
 if (requested.some(([key])=>key.startsWith('irisConnections.'))) {
   const changes=request.changes;
   const create=Object.hasOwn(changes,'irisConnections.new');
   const selector=create?'irisConnections.new':'irisConnections.active';
   if(!model.fields.some(f=>f.id===selector) || requested.some(([key])=>key!==selector && (!create || ![...keys,'username','password','irisConnections.useCurrentCredentials'].includes(key)))) fail('请单独预览开发库档案切换');
   const profile={id:changes[selector].value};
   if(create) {
     profile.useCurrentCredentials=changes['irisConnections.useCurrentCredentials']?.value===true;
     profile.connection=Object.fromEntries(keys.map(key=>[key,changes[key]?.value??model.fields.find(f=>f.id===key)?.value]));
     profile.credentials={username:changes.username?.value,password:changes.password?.value};
   }
   const req={projectRoot:root,profile};
   let planned;
   try { planned=owner.plan(req,runtime); }
   catch(error) { fail(/^[\u3400-\u9fff]/.test(error.message)?error.message:'开发库档案或绑定配置无法解析，请检查来源'); }
   for(const [id,value] of plans) if(value.expires<Date.now()) plans.delete(id);
   if(plans.size>=20) fail('预览数量过多');
   const planId=crypto.randomUUID();
   plans.set(planId,{request:{...req,fingerprint:planned.fingerprint},revision:model.revision,expires:Date.now()+300000});
   const target=c=>c.scheme+'://'+c.host+':'+c.port+' / '+c.namespace;
   return {planId,scope:'当前工程',warning:target(planned.profile.from)+' → '+target(planned.profile.to)+'。保存后重连客户端并检查实际目标。',changes:planned.changes.map(c=>({field:path.relative(root,c.file),action:'同步'}))};
 }
 if (requested.some(([key])=>key.startsWith('irisDevelopment.'))) {
   const fields={};
   for (const [id,change] of requested) {
     const key=id.slice('irisDevelopment.'.length);
     if (!id.startsWith('irisDevelopment.') || !developmentFields.includes(key) || !model.fields.some(f=>f.id===id&&!f.readOnly)) fail('请单独保存当前工程的开发声明');
     fields[key]=change.value;
   }
   developmentOwner.validate(fields);
   for(const [key,v] of plans) if(v.expires<Date.now()) plans.delete(key);
   if(plans.size>=20) fail('预览数量过多，请稍后重试');
   const planId=crypto.randomUUID();
   plans.set(planId,{development:fields,revision:model.revision,expires:Date.now()+300000});
   return {planId,scope:'当前工程开发声明',warning:'切换环境可能使既有同步计划需要重新核验。保存不启动远端连接。',changes:requested.map(([field])=>({field,action:'修改'}))};
 }
 if (Object.hasOwn(request.changes || {},policyField)) {
   const change = request.changes[policyField];
   if (!model.fields.some(f=>f.id===policyField && !f.readOnly) || typeof change?.value !== 'boolean') fail('部署策略字段无效');
   if (Object.keys(request.changes).length !== 1) fail('部署策略与连接设置使用不同的应用流程，请分别预览保存');
   const planId = crypto.randomUUID();
   for(const [key,value] of plans) if(value.expires<Date.now()) plans.delete(key);
   if(plans.size>=20) fail('预览数量过多，请稍后重试');
   plans.set(planId,{policyValue:change.value,revision:model.revision,expires:Date.now()+300000});
   return {planId,scope:'当前工程',warning:'保存后由下次插件补装操作读取。',changes:[{field:policyField,action:change.value?'允许自动补装':'关闭自动补装'}]};
 }
 const connection=Object.fromEntries(model.fields.filter(f=>!f.secret&&!f.id.includes('.')).map(f=>[f.id,f.value]));let replace=false;const sourceChanges={};
 for(const [k,v]of Object.entries(request.changes||{})){const f=model.fields.find(f=>f.id===k);if(!f)fail('未知工程字段');if(f.readOnly)fail('此字段待核对，暂不可写入。');if(k.includes('.')){if(f.secret&&(v.action!=='replace'||!v.value))fail('Web/SFTP 凭据只支持保留或替换');if(typeof v.value!==f.type)fail('字段类型不匹配');sourceChanges[k]=v.value;continue}if(f.secret){if(v.action!=='replace'||typeof v.value!=='string'||!v.value)fail('工程凭据只支持保留或成对替换');replace=true;connection[k]=v.value}else{if(typeof v.value!==f.type)fail('工程字段类型不匹配');connection[k]=v.value}}
 if(replace&&(!connection.username||!connection.password))fail('请同时替换账号和密码');connection.writeCredentials=replace;
 const development=require('../../../scripts/lib/iris-development-settings').inspect(settingsContext(root).contextRoot).value;if(development?.developmentMode==='offline')fail('当前为离线开发模式，先通过开发方式入口切换后配置连接');
 const env=environment.read(settingsContext(root),{optional:true,inherit:false});
 const central=!!env.config.iris;
 const active=model.fields.find(field=>field.id==='irisConnections.active')?.value;
 const state=require('../../../scripts/lib/project-configuration').document(settingsContext(root).contextRoot).value.irisConnections;
 const hasProfile=state?.source==='project.jsonc' && state.active===active;
 const changingIris=requested.some(([field])=>!field.includes('.'));
 const req=hasProfile && changingIris ? {projectRoot:root,profile:{id:active,edit:true,connection,
   ...(replace ? {credentials:{username:connection.username,password:connection.password}} : {})},sourceChanges}
   : {projectRoot:root,connection,configureMcp:hasProfile?state.bindings.mcp:true,syncProjectEnv:central,sourceChanges};
 let p;try{p=owner.plan(req,runtime)}catch(e){fail(/^[\u3400-\u9fff]/.test(e.message)?e.message:'工程配置解析或安全检查失败；请核对配置格式和文件边界')}
 for(const [k,v]of plans)if(v.expires<Date.now())plans.delete(k);if(plans.size>=20)fail('预览数量过多，请稍后重试');const id=crypto.randomUUID();plans.set(id,{request:{...req,fingerprint:p.fingerprint},revision:model.revision,expires:Date.now()+300000});
 return {planId:id,scope:'仅当前工程：VS Code、MCP、TOML、集中 IRIS 配置及受管 backend（存在时）',warning:'不连接远端；仅同步选定的 Web/SFTP 字段，不创建或启动 SFTP 服务。原配置恢复回执可能包含凭据，仅保存在工程忽略目录。',changes:p.changes.map(c=>({field:path.relative(root,c.file),action:c.before.exists?'更新':'新增'})),warnings:p.warnings};}
 async function apply(id,dependencies){const p=plans.get(id);plans.delete(id);if(!p||p.expires<Date.now())fail('预览已过期');if(digest(root)!==p.revision)fail('工程配置已变化，保存已停止');if (p.plugin) {
   const ctx=settingsContext(root);
   if(ctx.mode==='invalid'||!fs.existsSync(path.join(ctx.capabilityRoot,'plugins',p.plugin,'.agents-plugin/plugin.json'))) fail('工程插件来源发生变化');
   return deployment.withLock(ctx.capabilityRoot,()=>{
     if(digest(root)!==p.revision || !pluginSettings.inspect(ctx,p.plugin).canonical) fail('插件配置已变化');
     pluginSettings.apply(ctx,p.plugin,'Write',p.changes);
     return {status:'saved',message:'插件参数已保存并读回。'};
   });
 }if (p.managed) {
   try {
     managedConfiguration.apply(managedContext(),p.managed);
     return {status:'saved',message:'工程配置已写入 project.jsonc 并读回。'};
   } catch { fail('工程配置已变化或保存失败，请重新读取后核对当前分节。'); }
 }if (p.development) {
   const ctx=settingsContext(root);
   if(ctx.mode!=='standard'||!developmentOwner.inspect(ctx.contextRoot).canonical) fail('开发声明来源已变化');
   return deployment.withLock(ctx.capabilityRoot,()=>{
     if(digest(root)!==p.revision) fail('工程配置已变化');
     developmentOwner.save(ctx,p.development);
     return {status:'saved',message:'工程开发声明已保存并读回。'};
   });
 }if (Object.hasOwn(p,'policyValue')) {
   const current = readPolicy();
   if (!current || current.readOnly) fail('工程部署策略已变化，请重新读取');
   return deployment.withLock(current.ctx.capabilityRoot,()=>{
     if (digest(root)!==p.revision) fail('部署策略已变化，请重新读取');
     policy.save(current.ctx.contextRoot,{...policy.read(current.ctx.contextRoot).value,autoInstall:p.policyValue});
     if (deployment.policy(current.ctx.contextRoot).autoInstall!==p.policyValue) fail('部署策略读回不一致');
     return {status:'saved',message:'工程部署策略已保存并读回，下次插件补装时生效。'};
   });
 }
 try { await owner.apply(p.request,{...dependencies,...runtime,requireRecoveryConfirmation:true}); }
 catch (error) {
   if (error.code === 'project-recovery-required') throw error;
   fail(/^[\u3400-\u9fff]/.test(error.message) ? error.message : '保存失败，已尝试原入口恢复；请检查本工程配置回执');
 }
 return {status:'saved',message:p.request.profile?'开发库配置已保存并读回，客户端待重连，服务器身份待核验。':'工程配置已同步保存并逐文件读回；未测试远端连接。'};}
 return {inspect,plan,apply,inspectManaged,planManaged};
}
module.exports={createProjectSettings};
