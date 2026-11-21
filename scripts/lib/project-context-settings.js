'use strict';

const {isDeepStrictEqual} = require('node:util');
const store = require('./project-configuration');
const {privatePath} = require('./project-configuration-migration');

const pathForContext = ['projectContext'];
const pathForDemand = ['pluginSettings','coding-iris-plugin','defaultDemandKind'];
const options = {
  contextMode: ['codebase-complete','intent-first-on-demand-export'],
  guidanceMode: ['auto','concise','assisted'],
  defaultDemandKind: ['standard','project'],
};

function markdownRows(text, names) {
  const values = {}, output = [];
  let inComment = false, fence = '';
  for (const line of (text || '').replace(/^\uFEFF/,'').match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    const body = line.trim();
    output.push(line);
    if (inComment || body.startsWith('<!--')) { inComment = !body.includes('-->'); continue; }
    const boundary = /^`{3,}|^~{3,}/.exec(body)?.[0];
    if (boundary) { if (!fence) fence = boundary; else if (boundary.startsWith(fence)) fence = ''; continue; }
    if (fence) continue;
    const match = /^[-*]?[ \t]*`?([^`：:=]+?)`?[ \t]*[:：=][ \t]*`?([a-z-]+)`?[。.]?$/u.exec(body);
    const key = match && Object.hasOwn(names,match[1]) && names[match[1]];
    if (!key || !options[key].includes(match[2])) continue;
    if (Object.hasOwn(values,key) && values[key] !== match[2]) throw Error('project-config-conflict: ' + key);
    values[key] = match[2];
    const property = key === 'defaultDemandKind' ? pathForDemand : [...pathForContext,key];
    output[output.length - 1] = '- ' + match[1] + '：见 `project.jsonc` 的 `' +
      property.join('.') + '`。' + (line.match(/\r\n$|\r$|\n$/)?.[0] || '');
  }
  return {values, remaining:(text?.startsWith('\uFEFF')?'\uFEFF':'') + output.join('')};
}

function snapshots(contextRoot, names, fields) {
  return names.map(name => {
    const file = store.filePath(contextRoot,name);
    const previous = store.fileText(file);
    return {file,previous,...markdownRows(previous,fields)};
  });
}

function skillDirectories(source) {
  const {relative} = require('./project-directories');
  const directories = new Set();
  let active = false, comment = false;
  const lines = source.remaining.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g);
  const remaining = lines.filter(line=>{
    const text = line.trim();
    if (comment || text.startsWith('<!--')) { comment = !text.includes('-->'); return true; }
    if (/^#{1,2}\s/.test(text)) { active=/^##\s+技能适配目录\s*$/.test(text); return true; }
    if (!active || !text || /^`{3,}|^~{3,}/.test(text)) return true;
    const value = text.replace(/^[-*]\s+/,'').replace(/[,，]$/,'').replace(/^`([^`]+)`$/,'$1');
    if (!/^[.\w-]+(?:\/[\w. -]+)+$/u.test(value)) return true;
    try { directories.add(relative(value)); }
    catch { return true; }
    return false;
  }).join('');
  if (directories.size) {
    source.values.skillDirectories = [...directories];
    source.remaining = remaining;
  }
}

function merge(canonical, sources) {
  const values = {...canonical};
  for (const source of sources) for (const [key,value] of Object.entries(source.values)) {
    if (Object.hasOwn(values,key) && !isDeepStrictEqual(values[key],value)) throw Error('project-config-conflict: ' + key);
    values[key] = value;
  }
  return values;
}

function contextSettings(contextRoot, data = store.document(contextRoot).value) {
  const sources = snapshots(contextRoot,['project_context_profile.md'],{contextMode:'contextMode',guidanceMode:'guidanceMode'});
  skillDirectories(sources[0]);
  const canonical = data.projectContext;
  if (canonical !== undefined && (!canonical || typeof canonical !== 'object' || Array.isArray(canonical))) throw Error('invalid-project-context');
  const values = merge(canonical,sources);
  for (const key of ['contextMode','guidanceMode']) {
    if (Object.hasOwn(values,key) && !options[key].includes(values[key])) throw Error('invalid-project-context: ' + key);
  }
  if (values.skillDirectories !== undefined) {
    if (!Array.isArray(values.skillDirectories)) throw Error('invalid-skill-directories');
    for (const dir of values.skillDirectories) require('./project-directories').relative(dir);
  }
  return {values,sources};
}

function demandSettings(contextRoot, data = store.document(contextRoot).value) {
  const sources = snapshots(contextRoot,['iris_project_profile.md','demand_delivery_profile.md'],{'默认需求交付类型':'defaultDemandKind'});
  const value = data.pluginSettings?.['coding-iris-plugin']?.defaultDemandKind;
  if (value !== undefined && !options.defaultDemandKind.includes(value)) throw Error('invalid-default-demand-kind');
  return {values:merge(value === undefined ? {} : {defaultDemandKind:value},sources),sources};
}

function migrateMarkdown(context, mode) {
  const main = store.document(context.contextRoot);
  const settings = contextSettings(context.contextRoot,main.value);
  const demand = demandSettings(context.contextRoot,main.value);
  const matched = [...settings.sources,...demand.sources].filter(source => source.previous !== null && source.previous !== source.remaining);
  if (!matched.length) return null;
  for (const file of [main.file,...matched.map(source=>source.file)]) privatePath(context,file);
  const edits = [];
  if (Object.keys(settings.values).length) edits.push(...store.delta(pathForContext,main.value.projectContext,settings.values));
  if (demand.values.defaultDemandKind !== undefined) {
    edits.push(...store.delta(pathForDemand,main.value.pluginSettings?.['coding-iris-plugin']?.defaultDemandKind,demand.values.defaultDemandKind));
  }
  if (mode === 'Write') {
    // Each retired line still agrees with the new value if interrupted between writes.
    store.replace(main.file,main.text,store.edited(main,edits));
    if (!isDeepStrictEqual(contextSettings(context.contextRoot).values,settings.values) ||
        !isDeepStrictEqual(demandSettings(context.contextRoot).values,demand.values)) throw Error('project-config-readback-failed');
    for (const {file,previous,remaining} of matched) store.replace(file,previous,remaining);
  }
  return {id:'projectContext',status:mode === 'Write' ? 'applied' : 'planned'};
}

module.exports = {contextSettings,demandSettings,migrateMarkdown};
