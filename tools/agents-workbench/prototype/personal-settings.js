const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const configIO=require('../../../scripts/lib/configuration-file-io');
const {connectionMode,parseConnectionUrl}=require('../../../plugins/bos-plugin/scripts/bos-connection');
class SettingsError extends Error{constructor(message){super(message);this.name='SettingsError'}}
const bosSections=['bos-demand-query','bos-code-update-log'];
const fields={bos:[['bos-demand-query','url'],['bos-demand-query','access_key'],['bos-demand-query','headers','X-Gateway-Upstream-BOS-MCP-TOKEN'],['bos-demand-query','cuser'],['bos-demand-query','cgroup'],['bos-code-update-log','url'],['bos-code-update-log','token'],['bos-code-update-log','linkProject'],['bos-code-update-log','timeout']],knowledge:[['defaultProvider'],...['company','openai'].flatMap(p=>['type','model','dimensions',...(p==='company'?['baseUrl','method','appId','appKey']:['apiKey'])].map(k=>['providers',p,k]))]};
const bosUrl=p=>bosSections.includes(p[0])&&p[1]==='url';
const secret=p=>bosUrl(p)||/access_key|token|appKey|apiKey|baseUrl/i.test(p.join('.'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const get=(o,p)=>p.reduce((v,k)=>v?.[k],o);

function editableField(data, keys) {
 return get(data,keys)!==undefined && (!bosUrl(keys) || connectionMode(data[keys[0]])==='custom');
}

function readField(data, keys) {
 const id=keys.join('.');
 const value=get(data,keys);
 if (bosUrl(keys)) {
  let configured=true;
  try { parseConnectionUrl(keys[0],value); } catch { configured=false; }
  return {id,label:'url',type:'string',secret:true,configured,clearable:false,draftable:false};
 }
 const sensitive=secret(keys);
 return {id,label:keys.at(-1),secret:sensitive,type:typeof value,value:sensitive?undefined:value,configured:value!==''&&value!==null};
}

function createSettings(env=process.env){
 const plans=new Map();const cleanup=setInterval(()=>{for(const [k,v]of plans)if(v.expires<Date.now())plans.delete(k)},60000);cleanup.unref();
 function source(id){
  if(!Object.hasOwn(fields,id))throw new SettingsError('未知配置域');
  const file=env[id==='bos'?'BOS_MCP_CONFIG':'KNOWLEDGE_RAG_CONFIG'];
  if(!file||!path.isAbsolute(file))throw new SettingsError('个人配置来源未绑定');
  const info=fs.lstatSync(file);
  if(!info.isFile())throw new SettingsError('仅支持普通本机配置文件');
  const physical=fs.realpathSync.native(file);
  for(const parent of new Set([path.dirname(file),path.dirname(physical)])){
   for(let directory=parent;;directory=path.dirname(directory)){
    if(fs.existsSync(path.join(directory,'.git')))throw new SettingsError('个人配置位于 Git 工作区，禁止写入凭据');
    if(directory===path.dirname(directory))break;
   }
  }
  return physical;
 }
 function read(id){const file=source(id),bytes=fs.readFileSync(file),raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),data=configIO.parse(raw);return {file,bytes,raw,data,revision:hash(bytes)}}
 function inspect(id){
  const {data,revision}=read(id);
  const actual=fields[id].filter(keys=>editableField(data,keys)).map(keys=>readField(data,keys));
  const modelFields=id==='bos'?bosSections.flatMap(section=>{
   if(!Object.hasOwn(data,section))return [];
   const sectionFields=actual.filter(field=>field.id.startsWith(section+'.'));
   const mode=connectionMode(data[section]);
   const url=sectionFields.find(field=>field.id===section+'.url');
   const label=mode==='company'?'公司连接':url?.configured?'自定义连接':'待核对';
   return [{id:section+'.connectionMode',label:'connectionMode',type:'string',readOnly:true,value:label},...sectionFields];
  }):actual;
  return {id,revision,scope:'共享个人配置',fields:modelFields};
 }
 function plan(id,request){
  const source=read(id);
  if(request.revision!==source.revision)throw new SettingsError('配置已被外部修改，请重新读取后编辑');
  const data=structuredClone(source.data),changes=[];
  if(!request.changes||Array.isArray(request.changes))throw new SettingsError('修改格式错误');
  for(const [key,change]of Object.entries(request.changes)){
   const keys=fields[id].find(keys=>keys.join('.')===key);
   if(!keys||!editableField(source.data,keys))throw new SettingsError('字段不在支持范围');
   const oldValue=get(source.data,keys);
   const sensitive=secret(keys);
   const url=bosUrl(keys);
   let value=change.value;
   if(sensitive){
    if(change.action==='keep')continue;
    if(url&&change.action!=='replace')throw new SettingsError('自定义连接地址必须替换为有效地址');
    if(!['replace','clear'].includes(change.action))throw new SettingsError('凭据操作无效');
    value=change.action==='clear'?'':value;
    if(typeof value!=='string'||(change.action==='replace'&&!value.trim()))throw new SettingsError(url?'自定义连接地址不能为空':'替换凭据不能为空');
   }else if(typeof value!==typeof oldValue)throw new SettingsError('字段类型不匹配');
   if(typeof value==='string'&&value.length>8192)throw new SettingsError('字段过长');
   if(url){
    try { parseConnectionUrl(keys[0],value); } catch(error) { throw new SettingsError(error.message); }
   }
   if(keys.at(-1)==='dimensions'&&(!Number.isInteger(value)||value<1||value>65536))throw new SettingsError('向量维度应为 1–65536 整数');
   if(keys.at(-1)==='timeout'&&(!Number.isFinite(Number(value))||Number(value)<=0))throw new SettingsError('超时必须大于零');
   if(key==='defaultProvider'&&!['company','openai'].includes(value))throw new SettingsError('未知提供方');
   if(oldValue===value)continue;
   get(data,keys.slice(0,-1))[keys.at(-1)]=value;
   changes.push({field:key,action:sensitive?change.action:'修改'});
  }
  const token=crypto.randomUUID();
  for(const [key,value]of plans)if(value.expires<Date.now())plans.delete(key);
  if(plans.size>20)throw new SettingsError('待保存预览过多，请稍后重试');
  plans.set(token,{id,file:fs.realpathSync(source.file),revision:source.revision,data,changes,expires:Date.now()+300000});
  return {planId:token,changes,scope:'所有引用同一个人配置文件的工程；无法枚举未登记工程',warning:id==='knowledge'?'提供方、模型或维度变更可能使已有索引不匹配；本次不删除或重建索引。':'查询与日志连接分别保存；本次不发起 BOS 请求。'};
 }
 function apply(token){
  const plan=plans.get(token);
  plans.delete(token);
  if(!plan||plan.expires<Date.now())throw new SettingsError('预览已过期，请重新预览');
  const current=read(plan.id);
  if(fs.realpathSync(current.file)!==plan.file||current.revision!==plan.revision)throw new SettingsError('配置已变更，已停止保存');
  if(!plan.changes.length)return {status:'saved',revision:current.revision,message:'配置没有变化。'};
  const encoded=configIO.edit(current.raw,plan.changes.map(({field})=>{
   const keys=field.split('.');
   return {path:keys,value:get(plan.data,keys)};
  }));
  const temporary=current.file+'.workbench-'+crypto.randomUUID()+'.tmp';
  const descriptor=fs.openSync(temporary,'wx',0o600);
  try{
   try{
    configIO.copyFileAccess(current.file,temporary);
    fs.writeFileSync(descriptor,encoded);
   }finally{fs.closeSync(descriptor)}
   if(hash(fs.readFileSync(current.file))!==current.revision)throw new SettingsError('写入前来源发生变化');
   fs.renameSync(temporary,current.file);
   const checked=read(plan.id);
   if(JSON.stringify(checked.data)!==JSON.stringify(plan.data))throw new SettingsError('读回未匹配，请保留现状检查');
   return {status:'saved',revision:checked.revision,message:'文件已保存并读回一致；远端认证未测试。'};
  }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary)}
 }
 return {inspect,plan,apply,sourcePath:id=>fs.realpathSync.native(source(id))};
}
module.exports={createSettings};
