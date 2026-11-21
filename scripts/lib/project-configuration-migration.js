'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {isDeepStrictEqual} = require('node:util');
const store = require('./project-configuration');

function privatePath(context, file) {
  const roots = [context.workspaceRoot, context.capabilityRoot, ...(context.gitRoots || [])];
  for (const root of new Set(roots.filter(Boolean))) {
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue;
    if (!fs.existsSync(path.join(root, '.git'))) continue;
    const run = args => spawnSync('git',['--no-optional-locks','-C',root,...args],{windowsHide:true,encoding:'utf8'});
    // A parent Git repository can see a nested capability repository as a gitlink.
    // Only write paths ignored by every applicable repository.
    const tracked = run(['ls-files','--',relative]);
    const ignored = run(['check-ignore','--no-index','-q','--',relative]);
    if (tracked.status !== 0 || tracked.stdout.trim() || ignored.status !== 0) {
      throw Error('project-config-private-path: ' + path.basename(file));
    }
  }
}

function retire(context, file, before, name) {
  const archived = store.filePath(context.contextRoot, '.migrations/' + name);
  privatePath(context, file);
  privatePath(context, archived);
  const existing = store.fileText(archived);
  if (store.fileText(file) !== before || (existing !== null && existing !== before)) {
    throw Error('project-config-migration-source-changed: ' + name);
  }
  fs.mkdirSync(path.dirname(archived), {recursive:true});
  if (existing === null) fs.renameSync(file, archived);
  else fs.unlinkSync(file);
}

function validateSection(context, id, value) {
  switch (id) {
    case 'documentationLayout':
      return require('./project-directories').validateConfig(context, value);
    case 'irisRemotePolicy':
      if (value.schema !== 'iris-remote-policy/v1' || typeof value.enabled !== 'boolean') throw Error('invalid-remote-policy');
      if (value.enabled && (!path.isAbsolute(value.coordinationRoot || '') ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value.poolKey || '') ||
          (value.maxConcurrent !== undefined && value.maxConcurrent !== 1))) throw Error('invalid-remote-policy');
      if (value.maxFrameworkSessions !== undefined &&
          (!Number.isSafeInteger(value.maxFrameworkSessions) || value.maxFrameworkSessions < 1)) throw Error('invalid-remote-session-limit');
      return value;
    case 'irisSessionBackend':
      if (value.schema !== 'iris-session-backend/v1' || typeof value.serverName !== 'string' ||
          typeof value.command !== 'string' || !Array.isArray(value.args) ||
          value.args.some(arg=>typeof arg !== 'string' || /password|[?&]token=|:\/\/[^/\s]*@/i.test(arg))) {
        throw Error('invalid-or-private-session-backend');
      }
      return value;
    default:
      return value;
  }
}

function migrateSection(context, id, mode) {
  const result = store.inspect(context, id);
  if (result.value) validateSection(context,id,result.value);
  if (result.legacy === null) return null;
  require('./configuration-file-io').parse(result.legacy);
  const archive = store.filePath(context.contextRoot, '.migrations/' + result.name);
  for (const file of [result.main.file,result.file,archive]) privatePath(context,file);
  const staged = store.fileText(archive);
  if (staged !== null && staged !== result.legacy) throw Error('project-config-legacy-returned: ' + id);
  if (mode === 'Write') {
    const next = store.edited(result.main,store.delta([id],result.main.value[id],result.value));
    store.replace(result.main.file,result.main.text,next);
    try {
      const actual = store.inspect(context,id);
      if (!actual.canonical || !isDeepStrictEqual(actual.value,result.value)) throw Error('project-config-readback-failed: ' + id);
      retire(context,result.file,result.legacy,result.name);
    } catch (error) {
      if (store.fileText(result.file) === result.legacy && store.fileText(result.main.file) === next) {
        if (result.main.text === null) fs.unlinkSync(result.main.file);
        else store.replace(result.main.file,next,result.main.text);
      }
      throw error;
    }
  }
  return {id,source:result.name,status:mode === 'Write' ? 'applied' : 'planned'};
}

function restoreSection(context, id, mode) {
  if (!Object.hasOwn(store.legacyFiles,id) || !['DryRun','Write'].includes(mode)) throw Error('unsupported-project-config-restore');
  const restore = () => {
    const state = store.inspect(context,id);
    const archive = store.filePath(context.contextRoot,'.migrations/'+state.name);
    const original = store.fileText(archive);
    if (!original) throw Error('project-config-original-missing: '+id);
    const legacy = JSON.parse(original.replace(/^\uFEFF/,''));
    if (id === 'documentationLayout' && legacy.workspaceRoot) {
      if (!require('./project-directories').same(context.workspaceRoot,legacy.workspaceRoot)) throw Error('documentation-layout-workspace-mismatch');
      delete legacy.workspaceRoot;
    }
    for (const file of [state.main.file,state.file,archive]) privatePath(context,file);
    if (!isDeepStrictEqual(state.value,legacy) || state.legacy !== null && state.legacy !== original) {
      throw Error('project-config-restore-drift: '+id);
    }
    if (!state.canonical) return {id,status:'unchanged'};
    if (mode === 'Write') {
      if (state.legacy === null) {
        store.replace(state.file,null,original);
        require('./configuration-file-io').copyFileAccess(archive,state.file);
      }
      const next = require('./configuration-file-io').edit(state.main.text,[{path:[id],value:undefined}]);
      store.replace(state.main.file,state.main.text,next);
      if (!isDeepStrictEqual(store.inspect(context,id).value,legacy)) throw Error('project-config-restore-readback-failed: '+id);
    }
    return {id,status:mode === 'Write' ? 'restored' : 'planned',source:state.name};
  };
  return mode === 'Write' ? store.withLock(context,restore) : restore();
}

module.exports = {privatePath,retire,migrateSection,validateSection,restoreSection};
