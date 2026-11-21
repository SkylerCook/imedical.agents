'use strict';

const path = require('node:path');
const data = require('./project-environment-data');
const store = require('./project-configuration');

function json(file) {
  const text = store.fileText(file);
  if (text === null) return null;
  const value = JSON.parse(text.replace(/^\uFEFF/,''));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid-project-environment');
  return value;
}

function local(contextRoot) {
  const main = store.document(contextRoot);
  const file = store.filePath(contextRoot,'project-env.json');
  const legacy = json(file);
  const configured = data.canonical(main.value);
  const credentials = configured ? json(store.filePath(contextRoot,data.credentialFile)) || {} : {};
  return {config:data.read(main.value,legacy,credentials),configPath:configured ? main.file : file,canonical:configured};
}

function read(context, {optional = false, inherit = true} = {}) {
  let result = local(context.contextRoot);
  let inherited = false;
  const fallback = context.mode === 'workspace-overlay' && context.manifest?.projectEnvFallback;
  if (!result.config && inherit && fallback !== undefined && fallback !== false) {
    if (typeof fallback !== 'string' || !fallback.trim()) throw Error('project-env-fallback-invalid');
    const configPath = path.resolve(context.workspaceRoot,fallback);
    const sharedLegacy = context.capabilityRoot && path.join(context.capabilityRoot,'config','project-env.json');
    if (sharedLegacy && require('./project-directories').same(configPath,sharedLegacy)) result = local(context.capabilityRoot);
    else result = {config:json(configPath),configPath,canonical:false};
    inherited = true;
  }
  if (!result.config && (!optional || inherited)) throw Error('project-env-missing');
  if (inherited) for (const field of ['host','port','scheme','namespace']) {
    if (!result.config.iris?.[field] || String(result.config.iris[field]).startsWith('TODO')) {
      throw Error('project-env-target-missing: ' + field);
    }
  }
  return {...result,config:result.config || {},inherited};
}

module.exports = {read,local,json};
