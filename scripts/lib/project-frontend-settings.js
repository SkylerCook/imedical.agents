'use strict';

const {isDeepStrictEqual} = require('node:util');
const store = require('./project-configuration');
const {privatePath} = require('./project-configuration-migration');
const {relative} = require('./project-directories');
const prefix = ['pluginSettings','coding-iris-plugin'];
const simple = /^[ \t]*\|[ \t]*`?([^|`]+?)`?[ \t]*\|[ \t]*(utf8|standard-gb2312|project-utf8)[ \t]*\|[ \t]*$/i;
const full = /^[ \t]*\|[ \t]*`?([^|`]+?)`?[ \t]*\|[ \t]*([a-z0-9-]+)[ \t]*\|[ \t]*([a-z0-9-]+)[ \t]*\|[ \t]*(confirmed|pending)[ \t]*\|[ \t]*$/i;
const keys = ['frontendPathModes','frontendEncodingOverrides'];
const normalize = raw => raw.trim().replace(/\\/g,'/').replace(/^\.\//,'').replace(/\/$/,'');

function inspect(context, main = store.document(context.contextRoot)) {
  const file = store.filePath(context.contextRoot,'iris_project_profile.md');
  const before = store.fileText(file), canonical = main.value.pluginSettings?.['coding-iris-plugin'] || {};
  const legacy = {frontendPathModes:[],frontendEncodingOverrides:[]};
  const text = (before || '').replace(/^\uFEFF/,'');
  let comment=false, fence='';
  const remaining = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g).filter(line=>{
    const body=line.trim();
    if (comment || body.startsWith('<!--')) {comment=!body.includes('-->');return true;}
    const marker=/^`{3,}|^~{3,}/.exec(body)?.[0];
    if (marker) {if(!fence)fence=marker;else if(marker.startsWith(fence))fence='';return true;}
    if (fence) return true;
    const path = simple.exec(body);
    const rule = full.exec(body);
    if (path) legacy.frontendPathModes.push({path:normalize(path[1]),mode:path[2].toLowerCase()});
    if (rule) legacy.frontendEncodingOverrides.push({path:normalize(rule[1]),source:rule[2].toLowerCase(),
      server:rule[3].toLowerCase(),confirmation:rule[4].toLowerCase()});
    return !path && !rule;
  }).join('');
  const values = {};
  for (const key of keys) {
    const declared = canonical[key];
    if (declared !== undefined && !Array.isArray(declared)) throw Error('invalid-frontend-configuration: '+key);
    if (legacy[key].length && declared !== undefined && !isDeepStrictEqual(declared,legacy[key])) {
      throw Error('project-config-conflict: '+key);
    }
    values[key] = declared ?? legacy[key];
  }
  return {before,file,remaining:(before?.startsWith('\uFEFF')?'\uFEFF':'')+remaining,values,legacy};
}

function validate(values) {
  for (const key of keys) for (const row of values[key] || []) {
    relative(row.path);
    if (key === 'frontendPathModes' && !['utf8','project-utf8','standard-gb2312'].includes(row.mode)) {
      throw Error('invalid-frontend-path-mode');
    }
    if (key === 'frontendEncodingOverrides' && (!/^[a-z0-9-]+$/.test(row.source || '') ||
        !/^[a-z0-9-]+$/.test(row.server || '') || !['confirmed','pending'].includes(row.confirmation))) {
      throw Error('invalid-frontend-encoding-override');
    }
  }
}

function migrate(context,mode) {
  const main = store.document(context.contextRoot), state = inspect(context,main);
  if (state.before === null || state.before === state.remaining) return null;
  validate(state.values);
  for (const file of [main.file,state.file]) privatePath(context,file);
  if (mode === 'Write') {
    const edits = keys.filter(key=>state.legacy[key].length)
      .map(key=>({path:[...prefix,key],value:state.values[key]}));
    store.replace(main.file,main.text,store.edited(main,edits));
    if (!isDeepStrictEqual(inspect(context).values,state.values)) throw Error('frontend-configuration-readback-failed');
    store.replace(state.file,state.before,state.remaining);
  }
  return {id:'frontendEncoding',status:mode==='Write'?'applied':'planned'};
}

module.exports = {inspect,migrate};
