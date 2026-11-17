'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const owner=require('../../ai-dev-offline/configure-project');
const keys=['host','port','scheme','namespace','alias','description','tlsVerify'];
const sourceKeys=['web.basePath','web.cspBasePath','web.brokerPath','web.cookie','sftp.host','sftp.port','sftp.username','sftp.password','sftp.localPath','sftp.remotePath'];
const files=['.vscode/settings.json','.mcp.json','.iris-agentic-dev.toml','.agents/config/project-env.json','.agents/config/iris-session-backend.json','.agents/config/iris-development.json'];
const digest=root=>crypto.createHash('sha256').update(files.map(f=>owner.snapshot(path.join(root,f)).hash).join('|')).digest('hex');
const fail=message=>{const e=new Error(message);e.name='SettingsError';throw e};
function createProjectSettings(root){
 const plans=new Map();
 function inspect(){if(!root)fail('尚未绑定工程');const data=owner.inspect({projectRoot:root});const central=owner.object(owner.snapshot(path.join(root,files[3])).text);const c=central.iris||{};
 return {id:'project',revision:digest(root),scope:'当前工程',fields:keys.map(k=>({id:k,label:k,type:typeof (k==='port'?(c.port||data.port):k==='tlsVerify'?(c.tlsVerify??data.tlsVerify):c[k]??data[k]),value:k==='port'?(c.port||data.port):k==='tlsVerify'?(c.tlsVerify??data.tlsVerify):c[k]??data[k]})).concat(['username','password'].map(k=>({id:k,label:k,type:'string',secret:true,configured:!!c[k]||data.hasCredentials}))).concat(sourceKeys.filter(k=>{const [a,b]=k.split('.');return central[a]?.[b]!==undefined}).map(k=>{const [a,b]=k.split('.'),value=central[a][b],secret=/password|cookie/.test(k);return {id:k,label:k,type:typeof value,secret,configured:!!value,value:secret?undefined:value}}))}}
 function plan(request){const model=inspect();if(request.revision!==model.revision)fail('工程配置已变化，请重新读取');const connection=Object.fromEntries(model.fields.filter(f=>!f.secret&&!f.id.includes('.')).map(f=>[f.id,f.value]));let replace=false;const sourceChanges={};
 for(const [k,v]of Object.entries(request.changes||{})){const f=model.fields.find(f=>f.id===k);if(!f)fail('未知工程字段');if(k.includes('.')){if(f.secret&&(v.action!=='replace'||!v.value))fail('Web/SFTP 凭据只支持保留或替换');if(typeof v.value!==f.type)fail('字段类型不匹配');sourceChanges[k]=v.value;continue}if(f.secret){if(v.action!=='replace'||typeof v.value!=='string'||!v.value)fail('工程凭据只支持保留或成对替换');replace=true;connection[k]=v.value}else{if(typeof v.value!==f.type)fail('工程字段类型不匹配');connection[k]=v.value}}
 if(replace&&(!connection.username||!connection.password))fail('请同时替换账号和密码');connection.writeCredentials=replace;
 const development=owner.object(owner.snapshot(path.join(root,files[5])).text);if(development.mode==='offline')fail('当前为离线开发模式，先通过开发方式入口切换后配置连接');
 const central=fs.existsSync(path.join(root,files[3]));
 const req={projectRoot:root,connection,configureMcp:true,syncProjectEnv:central,nodeExe:process.execPath,sourceChanges};
 let p;try{p=owner.plan(req)}catch(e){fail(/^[\u3400-\u9fff]/.test(e.message)?e.message:'工程配置解析或安全检查失败；请核对配置格式和文件边界')}
 for(const [k,v]of plans)if(v.expires<Date.now())plans.delete(k);if(plans.size>=20)fail('预览数量过多，请稍后重试');const id=crypto.randomUUID();plans.set(id,{request:{...req,fingerprint:p.fingerprint},revision:model.revision,expires:Date.now()+300000});
 return {planId:id,scope:'仅当前工程：VS Code、MCP、TOML、集中 IRIS 配置及受管 backend（存在时）',warning:'不连接远端；仅同步选定的 Web/SFTP 字段，不创建或启动 SFTP 服务。原配置恢复回执可能包含凭据，仅保存在工程忽略目录。',changes:p.changes.map(c=>({field:path.relative(root,c.file),action:c.before.exists?'更新':'新增'})),warnings:p.warnings};}
 async function apply(id,dependencies){const p=plans.get(id);plans.delete(id);if(!p||p.expires<Date.now())fail('预览已过期');if(digest(root)!==p.revision)fail('工程配置已变化，保存已停止');try{await owner.apply(p.request,dependencies)}catch(e){fail(/^[\u3400-\u9fff]/.test(e.message)?e.message:'保存失败，已尝试原入口恢复；请检查本工程配置回执')};return {status:'saved',message:'工程配置已同步保存并逐文件读回；未测试远端连接。'};}
 return {inspect,plan,apply};
}
module.exports={createProjectSettings};
