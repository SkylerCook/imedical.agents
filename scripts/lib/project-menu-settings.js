'use strict';

const fs = require('node:fs');
const {isDeepStrictEqual} = require('node:util');
const store = require('./project-configuration');
const migration = require('./project-configuration-migration');
const prefix = ['pluginSettings','coding-iris-plugin','menuSync','sources'];
const sourcesFrom = value => value.pluginSettings?.['coding-iris-plugin']?.menuSync?.sources;

function validateId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id) ||
      /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9]|__proto__|constructor|prototype)$/i.test(id)) throw Error('Invalid menu source id');
}

function validate(source, id) {
  validateId(id);
  if (!source || source.schema !== 'iris-menu-refresh/v1' || source.sourceId !== id ||
      source.groupFilter !== 'active' || typeof source.allowMenuRead !== 'boolean' ||
      !Number.isFinite(source.maxRemovalRatio) || source.maxRemovalRatio <= 0 || source.maxRemovalRatio > 0.5 ||
      typeof source.targetFingerprint !== 'string' || typeof source.methodSourceHash !== 'string') {
    throw Error('Invalid menu refresh profile');
  }
  return source;
}

function inspect(context, id, main = store.document(context.contextRoot)) {
  validateId(id);
  const name = 'menu-sync/' + id + '.json';
  const file = store.filePath(context.contextRoot, name), legacy = store.fileText(file);
  const existing = legacy === null ? null : validate(JSON.parse(legacy.replace(/^\uFEFF/,'')),id);
  const sources = sourcesFrom(main.value);
  const canonical = sources && Object.hasOwn(sources,id) ? validate(sources[id],id) : null;
  if (canonical && existing && !isDeepStrictEqual(canonical,existing)) throw Error('project-config-conflict: menu-sync / ' + id);
  return {name,file,legacy,canonical,value:canonical || existing};
}

function add(context, source) {
  validate(source,source.sourceId);
  store.withLock(context,() => {
    const main = store.document(context.contextRoot);
    if (inspect(context,source.sourceId,main).value) throw Error('Source already enrolled; review the existing profile explicitly');
    migration.privatePath(context,main.file);
    store.replace(main.file,main.text,store.edited(main,[{path:[...prefix,source.sourceId],value:source}]));
    if (!isDeepStrictEqual(inspect(context,source.sourceId).value,source)) throw Error('project-config-readback-failed');
  });
}

function migrate(context, mode) {
  const directory = store.filePath(context.contextRoot,'menu-sync');
  if (!fs.existsSync(directory)) return [];
  const rows = [];
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    if (!entry.isFile() || !/^[A-Za-z0-9_-]+\.json$/.test(entry.name)) continue;
    const id = entry.name.slice(0,-5);
    const main = store.document(context.contextRoot);
    const state = inspect(context,id,main);
    require('./configuration-file-io').parse(state.legacy);
    const archive = store.filePath(context.contextRoot,'.migrations/' + state.name);
    for (const file of [main.file,state.file,archive]) migration.privatePath(context,file);
    if (store.fileText(archive) !== null) throw Error('project-config-legacy-returned: menu-sync / ' + id);
    if (mode === 'Write') {
      store.replace(main.file,main.text,store.edited(main,state.canonical ? [] : [{path:[...prefix,id],value:state.value}]));
      if (!isDeepStrictEqual(inspect(context,id).value,state.value)) throw Error('project-config-readback-failed');
      migration.retire(context,state.file,state.legacy,state.name);
    }
    rows.push({id:'menuSync.'+id,source:state.name,status:mode === 'Write' ? 'applied' : 'planned'});
  }
  if (mode === 'Write' && rows.length && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  return rows;
}

module.exports = {prefix,validate,inspect,add,migrate};
