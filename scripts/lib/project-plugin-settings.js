'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const io = require('./configuration-file-io');
const {safePath} = require('./project-directories');

// Only fields with an identified consumer belong here. Narrative and unknown rows stay in place.
const domains = {
  'coding-iris-plugin': {file:'iris_project_profile.md', aliases:{
    '前端编码模式':'frontendMode','前端源码根目录':'frontendRoot','前端源码编码':'sourceEncoding','前端服务器编码':'serverEncoding','前端服务器编码确认':'serverEncodingConfirmation',
    '前端服务器编码确认环境':'serverEncodingTarget'}, defaults:{frontendMode:'utf8',sourceEncoding:'utf8',serverEncoding:'pending',serverEncodingConfirmation:'pending'}},
  'iris-cure-form-dev': {file:'cure_form_profile.md', keys:['WorkRoot','PreviewVendorRoot','PreviewHisuiCss','PreviewJqueryJs','PreviewHisuiJs','PreviewHisuiLocaleJs','PreviewAsscomCss','PreviewAdaptationCss','PreviewBrowserCommand','CommonMigrationConfig','ResponsiveDeploymentStrategy'],defaults:{
    WorkRoot:'auto',ResponsiveDeploymentStrategy:'versioned-clone',PreviewVendorRoot:'.agents/vendor/hisui',
    PreviewHisuiCss:'.agents/vendor/hisui/dist/css/hisui.pure.min.css',PreviewJqueryJs:'.agents/vendor/hisui/dist/js/jquery-1.11.3.min.js',
    PreviewHisuiJs:'.agents/vendor/hisui/dist/js/jquery.hisui.min.js',PreviewHisuiLocaleJs:'.agents/vendor/hisui/dist/js/locale/hisui-lang-zh_CN.js'}},
  'i18n-iris-plugin': {file:'i18n_project_profile.md',keys:['xmlPrintReferencesDir','xmlPrintOutputDir','i18nTermsDir','cspTransBackupsDir'],
    aliases:{ReferencesDir:'xmlPrintReferencesDir',OutputDir:'xmlPrintOutputDir','备份目录':'cspTransBackupsDir'},defaults:{}},
  'iris-interface-dev': {file:'iris_interface_profile.md',keys:['outputRoot'],defaults:{outputRoot:'auto'}}
};
function schema(id) {
  if (!Object.hasOwn(domains,id)) throw Error('Unknown plugin settings owner');
  return domains[id];
}
function checkValue(key,value) {
  if (typeof value!=='string' || /[\r\n\0]/.test(value) ||
      /\w+:\/\/[^/\s]*@|[?&](?:token|password|secret|key|access_token|api_key)=/i.test(value)) throw Error('Invalid or private plugin setting: '+key);
}
function rows(before,id) {
  const spec=schema(id), values={}, retained=[];
  let fence='', comment=false, section='';
  for (const line of (before || '').replace(/^\uFEFF/,'').match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    retained.push(line);
    const trimmed=line.trim();
    if (comment || trimmed.includes('<!--')) { comment=(comment || trimmed.includes('<!--')) && !trimmed.includes('-->'); continue; }
    const delimiter=/^(`{3,}|~{3,})/.exec(trimmed)?.[1];
    if (delimiter) { if (!fence) fence=delimiter; else if (delimiter.startsWith(fence)) fence=''; continue; }
    if (fence) continue;
    if (/^##\s/.test(trimmed)) section=trimmed.slice(3).trim();
    const match=/^[ \t]*-[ \t]*`?([^`：:\r\n]+?)`?[ \t]*[:：][ \t]*(.*?)[ \t]*$/.exec(trimmed);
    if (!match || match[1]==='备份目录' && section!=='CSP 翻译同步配置') continue;
    const key=spec.keys?.includes(match[1]) ? match[1] : spec.aliases && Object.hasOwn(spec.aliases,match[1]) ? spec.aliases[match[1]] : undefined;
    if (!key) continue;
    const value=match[2].replace(/^`([^`]+)`[。.]?$/,'$1');
    if (!value || /^(?:<required>|<unset>)$/i.test(value) || /^TODO(?:$|\s|[:：])/i.test(value)) continue;
    if (key==='frontendMode' && !/^(?:utf8|project-utf8|standard-gb2312|N\/A [(（]backend-only[)）]|backend-only N\/A)$/i.test(value)) continue;
    checkValue(key,value);
    if (Object.hasOwn(values,key) && values[key]!==value) throw Error('Conflicting '+(id==='i18n-iris-plugin'?'i18n profile: ':'profile: ')+spec.file+' / '+key);
    values[key]=value;
    retained.pop();
  }
  return {values,remaining:(before?.startsWith('\uFEFF')?'\uFEFF':'')+retained.join('')};
}
function inspect(context,id) {
  const spec=schema(id);
  const configFile=name=>fs.existsSync(context.contextRoot) ? safePath(context.contextRoot,'config/'+name) : path.join(context.contextRoot,'config',name);
  const main=configFile('project.jsonc');
  const legacy=configFile(spec.file);
  const read=file=>fs.existsSync(file)?io.readText(file):null;
  const before=read(main), old=read(legacy);
  const tree=before===null?{}:io.parse(before);
  const canonical=tree.pluginSettings?.[id];
  for (const node of [tree.pluginSettings,canonical]) if (node!==undefined && (!node || typeof node!=='object' || Array.isArray(node))) throw Error('Invalid project.jsonc pluginSettings / '+id);
  const {values,remaining}=rows(old,id);
  const keys=[...(spec.keys||[]),...Object.values(spec.aliases||{})];
  for (const key of keys) if (canonical && Object.hasOwn(canonical,key)) {
    checkValue(key,canonical[key]);
    if (Object.hasOwn(values,key) && values[key]!==canonical[key]) throw Error(spec.file+' conflicts with project.jsonc / '+key);
  }
  return {id,main,legacy,before,old,canonical,values:{...values,...Object.fromEntries(keys.filter(k=>canonical && Object.hasOwn(canonical,k)).map(k=>[k,canonical[k]]))},remaining};
}
function replace(file,before,next) {
  const current=fs.existsSync(file)?io.readText(file):null;
  if (current!==before) throw Error('Configuration changed: '+path.basename(file));
  if (current===next) return;
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  try {
    fs.writeFileSync(tmp,next,{flag:'wx',mode:0o600});
    fs.renameSync(tmp,file);
  } finally { if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function apply(context,id,mode='Read',changes={}) {
  function run() {
    const s=inspect(context,id), spec=schema(id);
    if (mode==='Read') return s.values;
    const keys=new Set([...(spec.keys||[]),...Object.values(spec.aliases||{})]);
    if (mode==='Rollback') {
      if (!s.canonical) return {status:'unchanged'};
      const entries=Object.entries(s.canonical).filter(([key])=>keys.has(key));
      if (!entries.length) return {status:'unchanged'};
      const eol=s.old?.match(/\r\n|\r|\n/)?.[0] || '\n';
      const labels=Object.entries(spec.aliases||{});
      const restored=Object.entries(s.values).map(([key,v])=>'- '+(spec.keys?.includes(key)?key:labels.find(pair=>pair[1]===key)[0])+': '+v);
      if (restored.length) replace(s.legacy,s.old,(s.remaining||'')+eol+restored.join(eol)+eol);
      const edits=entries.map(([key])=>({path:['pluginSettings',id,key],value:undefined}));
      replace(s.main,s.before,io.edit(s.before,edits));
      return {status:'restored'};
    }
    for (const [key,value] of Object.entries(changes)) {
      if (!keys.has(key)) throw Error('Unknown plugin setting: '+key);
      checkValue(key,value);
    }
    const template=context.capabilityRoot && path.join(context.capabilityRoot,'plugins',id,'templates',spec.file.replace('.md','.template.md'));
    const fresh=!s.canonical && s.old?.includes('`pluginSettings.'+id+'`') && template && fs.existsSync(template);
    const initialize=mode==='Init' || fresh;
    const defaults=initialize?{...spec.defaults}:{};
    if (id==='coding-iris-plugin' && s.values.frontendMode && s.values.frontendMode!=='utf8') delete defaults.sourceEncoding;
    const value={...defaults,...s.values,...changes};
    const edits=Object.entries(value).filter(([key,v])=>s.canonical?.[key]!==v).map(([key,v])=>({path:['pluginSettings',id,key],value:v}));
    if (initialize && !s.canonical && !edits.length) edits.push({path:['pluginSettings',id],value:{}});
    const mdChanged=s.old!==null && s.remaining!==s.old;
    const target='config/project.jsonc / pluginSettings / '+id;
    if (!mdChanged && !edits.length) return {status:'config-migration-unchanged',target};
    if (mode==='DryRun') return {status:'config-migration-planned',target};
    if (!['Init','Write'].includes(mode)) throw Error('Unknown migration mode');
    const next=edits.length?io.edit(s.before??'{}\n',edits):s.before;
    fs.mkdirSync(path.dirname(s.main),{recursive:true});
    let published=s.before;
    if (mdChanged) {
      const migration=Object.entries(s.values).filter(([k,v])=>s.canonical?.[k]!==v).map(([k,v])=>({path:['pluginSettings',id,k],value:v}));
      published=io.edit(s.before??'{}\n',migration);
      replace(s.main,s.before,published);
      // Both files still agree if interrupted before retiring the old rows.
      replace(s.legacy,s.old,s.remaining);
    }
    replace(s.main,published,next);
    const after=inspect(context,id);
    for (const [key,v] of Object.entries(value)) if (after.values[key]!==v) throw Error('Plugin settings readback failed: '+key);
    return {status:'config-migration-applied',target};
  }
  if (['Read','DryRun'].includes(mode) || !context.capabilityRoot || !fs.existsSync(path.join(context.capabilityRoot,'.git'))) return run();
  return require('./plugin-deployment').withLock(context.capabilityRoot,run);
}
module.exports={apply,inspect,domains};
