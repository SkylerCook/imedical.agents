'use strict';

const {createHash} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const store = require('./project-configuration');
const fields = require('./project-configuration-fields');
const migration = require('./project-configuration-migration');
const contextSettings = require('./project-context-settings');
const menus = require('./project-menu-settings');

const editable = new Set(['projectContext','documentationLayout','irisRemotePolicy']);
const blocked = new Set(['__proto__','prototype','constructor']);

function nodeAt(value, path) {
  return path.reduce((current,key) => current && Object.hasOwn(current,key) ? current[key] : undefined,value);
}

function specAt(path) {
  let spec = Object.hasOwn(fields.sections,path[0]) ? fields.sections[path[0]] : undefined;
  for (let i=1;i<path.length;i++) {
    const key = path[i];
    if (!spec || spec.readOnly || blocked.has(key)) return undefined;
    if (path[0] === 'pluginSettings' && i === 2) spec = fields.pluginField(path[1],key);
    else if (spec.properties && Object.hasOwn(spec.properties,key)) spec = spec.properties[key];
    else if (spec.entries && typeof key === 'string') spec = spec.entries;
    else if (spec.items && Number.isInteger(key) && key >= 0) spec = spec.items;
    else return undefined;
  }
  return spec;
}

function display(value, def, path) {
  if (!def || value === undefined) return undefined;
  if (def.type === 'array' && Array.isArray(value)) {
    return value.map((item,index)=>display(item,def.items,[...path,index]));
  }
  if (def.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).flatMap(([key,item])=>{
      const child = display(item,specAt([...path,key]),[...path,key]);
      return child === undefined ? [] : [[key,child]];
    }));
  }
  if (typeof value !== def.type || def.type === 'object') return undefined;
  if (typeof value === 'string' && (/\w+:\/\/[^/\s]*@|(?:[?&]|--)\s*(?:token|password|api[_-]?key)(?:[=\s]|$)/i.test(value))) return undefined;
  return value;
}

function describe() {
  return {version:1,sections:fields.sections};
}

function issue(error) {
  const message = error.message;
  return /^[A-Za-z][A-Za-z0-9 .:/_-]{0,190}$/.test(message) ? message : 'invalid-or-unrecognized-configuration';
}

function read(context) {
  const main = store.document(context.contextRoot);
  const revision = createHash('sha256').update(context.contextRoot).update('\x00').update(main.text ?? '').digest('hex');
  const result = [];
  for (const [id,definition] of Object.entries(fields.sections)) {
    let value = main.value[id], source = store.MAIN, conflict, pending = false;
    try {
      if (Object.hasOwn(store.legacyFiles,id)) {
        const state = store.inspect(context,id);
        value = state.value ?? undefined;
        pending = state.legacy !== null;
        if (pending && !state.canonical) source = state.name;
      }
      if (id === 'projectContext') {
        const state = contextSettings.contextSettings(context.contextRoot,main.value);
        pending = state.sources.some(source=>Object.keys(source.values).length);
        if (pending) source = 'project_context_profile.md';
        value = state.values;
      }
      if (value !== undefined) migration.validateSection(context,id,value);
    } catch (error) {
      conflict = issue(error);
    }
    const supported = editable.has(id);
    if (supported || value !== undefined || conflict) {
      result.push({id,source,definition,pending,conflict,value:display(value,definition,[id]),
        editable:supported && !pending && !conflict && (id === 'projectContext' || value !== undefined)});
    }
  }
  if (main.value.irisConnections?.source === 'project.jsonc' && !main.value.irisConnections.bindings?.mcp) {
    const path = ['serviceConnections','web'];
    const definition = fields.sections.serviceConnections.properties.web;
    result.push({id:'web',path,source:store.MAIN,definition,editable:true,
      value:display(nodeAt(main.value,path),definition,path)});
  }
  const plugin = main.value.pluginSettings?.['coding-iris-plugin'];
  if (plugin || Object.hasOwn(main.value.plugins || {},'coding-iris-plugin')) {
    const definition = {type:'object',label:'需求交付',description:'用于当前工程的默认需求类型。',
      properties:{defaultDemandKind:fields.pluginField('coding-iris-plugin','defaultDemandKind')}};
    const path = ['pluginSettings','coding-iris-plugin'];
    try {
      const {values,sources} = contextSettings.demandSettings(context.contextRoot,main.value);
      const pending = sources.some(source=>Object.keys(source.values).length);
      result.push({id:'demandKind',path,source:pending?'旧交付配置':store.MAIN,definition,value:values,editable:!pending,pending});
    } catch (error) { result.push({id:'demandKind',path,source:store.MAIN,definition,editable:false,conflict:issue(error)}); }
    const menuDef = fields.pluginField('coding-iris-plugin','menuSync').properties.sources.entries;
    for (const id of Object.keys(plugin?.menuSync?.sources || {})) {
      const path = [...menus.prefix,id], definition = {...menuDef,label:'菜单同步 · '+id};
      try {
        const state = menus.inspect(context,id,main);
        const pending = state.legacy !== null;
        result.push({id:'menuSync.'+id,path,source:pending?state.name:store.MAIN,definition,value:display(state.value,definition,path),editable:!pending,pending});
      } catch (error) { result.push({id:'menuSync.'+id,path,source:store.MAIN,definition,editable:false,conflict:issue(error)}); }
    }
    const encodingKeys = ['frontendPathModes','frontendEncodingOverrides'];
    const encoding = {type:'object',label:'前端目录编码',description:'沿现有编码确认入口核对作用范围及目标库。',
      properties:Object.fromEntries(encodingKeys.map(key=>[key,fields.pluginField('coding-iris-plugin',key)]))};
    try {
      const state = require('./project-frontend-settings').inspect(context,main);
      if (encodingKeys.some(key=>state.values[key].length)) {
        const pending = encodingKeys.some(key=>state.legacy[key].length);
        result.push({id:'frontendEncoding',path,source:pending?'iris_project_profile.md':store.MAIN,definition:encoding,
          value:Object.fromEntries(encodingKeys.map(key=>[key,display(state.values[key],encoding.properties[key],[...path,key])])),
          editable:false,pending});
      }
    } catch (error) {
      result.push({id:'frontendEncoding',path,source:store.MAIN,definition:encoding,editable:false,conflict:issue(error)});
    }
  }
  return {version:1,scope:context.mode,revision,sections:result};
}

function validate(value, spec) {
  if (!spec || spec.readOnly) throw Error('project-config-field-read-only');
  if (spec.items) {
    if (!Array.isArray(value) || value.length > 200) throw Error('invalid-project-config-array');
    value.forEach(item=>validate(item,spec.items));
    return;
  }
  if (spec.properties) {
    if (!value || Array.isArray(value) || typeof value !== 'object') throw Error('invalid-project-config-object');
    for (const [key,item] of Object.entries(value)) validate(item,Object.hasOwn(spec.properties,key) ? spec.properties[key] : undefined);
    return;
  }
  if (typeof value !== spec.type || (typeof value === 'string' && (value.length > 4000 || /[\0\r\n]/.test(value))) ||
      (spec.options && !spec.options.includes(value)) ||
      (spec.type === 'number' && (!Number.isFinite(value) || (spec.integer && !Number.isSafeInteger(value)) ||
      (spec.min !== undefined && value < spec.min) || (spec.minExclusive !== undefined && value <= spec.minExclusive) ||
      (spec.max !== undefined && value > spec.max)))) throw Error('invalid-project-config-value');
}

function supportedPath(path) {
  if (path.length === 2 && editable.has(path[0])) return true;
  if (path.length === 3 && path[0] === 'serviceConnections' && path[1] === 'web') return true;
  if (path[0] !== 'pluginSettings' || path[1] !== 'coding-iris-plugin') return false;
  if (path.length === 3 && path[2] === 'defaultDemandKind') return true;
  return path.length === 6 && path[2] === 'menuSync' && path[3] === 'sources';
}

function verifiedEdits(context, request) {
  const model = read(context);
  if (request.revision !== model.revision) throw Error('project-config-changed');
  if (!Array.isArray(request.edits) || !request.edits.length || request.edits.length > 300) throw Error('invalid-project-config-edits');
  const main = store.document(context.contextRoot);
  const names = new Set();
  const edits = request.edits.map(({path,value})=>{
    if (!Array.isArray(path) || path.some(key=>typeof key !== 'string' && !Number.isSafeInteger(key)) ||
        path.some(key=>blocked.has(key)) || !supportedPath(path)) throw Error('unknown-project-config-field');
    const schema = specAt(path);
    validate(value,schema);
    const name = JSON.stringify(path);
    if (names.has(name)) throw Error('duplicate-project-config-field');
    names.add(name);
    const section = model.sections.find(section=>section.id===path[0]);
    if (section?.pending || section?.conflict || (editable.has(path[0]) && !section?.editable)) throw Error('project-config-migration-pending');
    if (path[0] === 'serviceConnections' &&
        (main.value.irisConnections?.source !== 'project.jsonc' || main.value.irisConnections.bindings?.mcp ||
         store.fileText(store.filePath(context.contextRoot,'project-env.json')) !== null)) throw Error('project-config-owner-required');
    if (path[0] === 'pluginSettings' && path[2] === 'menuSync' && !menus.inspect(context,path[4],main).canonical) {
      throw Error('menu-source-enrollment-required');
    }
    if (path[2] === 'defaultDemandKind' && contextSettings.demandSettings(context.contextRoot).sources.some(source=>Object.keys(source.values).length)) {
      throw Error('project-config-migration-pending');
    }
    // Replace explicit leaf values. For document arrays, preserve private extensions
    // stored on a registered row by matching its stable project-relative path.
    if (path[0] === 'documentationLayout' && path[1] === 'extensions') {
      const before = nodeAt(main.value,path) || [];
      value = value.map(entry=>({...before.find(item=>item.path===entry.path),...entry}));
    }
    return {path,value,label:schema.label};
  }).filter(({path,value})=>!isDeepStrictEqual(nodeAt(main.value,path),value));
  const next = store.edited(main,edits);
  const data = require('./configuration-file-io').parse(next);
  for (const {path} of edits) {
    migration.validateSection(context,path[0],data[path[0]]);
    if (path[0] === 'projectContext') contextSettings.contextSettings(context.contextRoot,data);
    if (path[2] === 'menuSync') menus.validate(nodeAt(data,path.slice(0,5)),path[4]);
  }
  migration.privatePath(context,main.file);
  return {main,edits,next};
}

function plan(context, request) {
  const {edits,main} = verifiedEdits(context,request);
  const changes = edits.map(({path,label,value})=>{
    const spec = specAt(path);
    const summary = item => Array.isArray(item) ? item.length+' 项' : display(item,spec,path);
    return {field:path.join('.'),label,action:'修改',before:summary(nodeAt(main.value,path)),after:summary(value)};
  });
  return {revision:request.revision,scope:context.mode,changes};
}

function apply(context, request) {
  return store.withLock(context,()=>{
    const {main,edits,next} = verifiedEdits(context,request);
    if (!edits.length) return {status:'unchanged'};
    store.replace(main.file,main.text,next);
    const confirmed = store.document(context.contextRoot);
    if (!edits.every(({path,value})=>isDeepStrictEqual(nodeAt(confirmed.value,path),value))) throw Error('project-config-readback-failed');
    return {status:'saved',revision:read(context).revision};
  });
}

function migrate(context, mode) {
  if (!['Check','DryRun','Write'].includes(mode)) throw Error('invalid-project-config-migration-mode');
  const run = () => {
    const results = [];
    const step = (id, fn) => {
      try {
        const rows = fn();
        if (rows) results.push(...(Array.isArray(rows) ? rows : [rows]));
      } catch (error) { results.push({id,status:'review-required',reason:issue(error)}); }
    };
    for (const id of Object.keys(store.legacyFiles)) step(id,()=>migration.migrateSection(context,id,mode));
    step('projectContext',()=>contextSettings.migrateMarkdown(context,mode));
    step('frontendEncoding',()=>require('./project-frontend-settings').migrate(context,mode));
    step('menuSync',()=>menus.migrate(context,mode));
    step('connections',()=>require('./project-environment-migration').migrate(context,mode));
    if (mode === 'Write') step('annotations',()=>{
      const main = store.document(context.contextRoot);
      if (main.text === null) return null;
      store.replace(main.file,main.text,store.edited(main,[]));
      return null;
    });
    return results;
  };
  return mode === 'Write' ? store.withLock(context,run) : run();
}

module.exports = {describe,read,plan,apply,migrate};
