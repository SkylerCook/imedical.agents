'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Resolve only the explicitly declared file; never change WorkspaceRoot or MCP ownership.
function readProjectEnv(context, {optional = false} = {}) {
  let configPath = path.join(context.contextRoot, 'config', 'project-env.json');
  let inherited = false;
  try {
    fs.lstatSync(configPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const fallback = context.mode === 'workspace-overlay' ? context.manifest?.projectEnvFallback : undefined;
    if (fallback !== undefined) {
      if (typeof fallback !== 'string' || !fallback.trim()) throw new Error('project-env-fallback-invalid');
      configPath = path.resolve(context.workspaceRoot, fallback);
      inherited = true;
    } else if (optional) {
      return {config: {}, configPath, inherited};
    }
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('invalid object');
  } catch (error) {
    throw new Error(error.code === 'ENOENT' ? 'project-env-missing' : 'project-env-invalid');
  }
  if (inherited) {
    for (const field of ['host', 'port', 'scheme', 'namespace']) {
      if (!config.iris?.[field] || String(config.iris[field]).startsWith('TODO')) {
        throw new Error(`project-env-target-missing: ${field}`);
      }
    }
  }
  return {config, configPath, inherited};
}

function validateTarget(config, env) {
  for (const [field, key] of [['host', 'IRIS_HOST'], ['port', 'IRIS_WEB_PORT'], ['scheme', 'IRIS_SCHEME'], ['namespace', 'IRIS_NAMESPACE']]) {
    const value = config.iris?.[field];
    if (value === undefined) continue;
    if (field === 'port' ? Number(value) !== Number(env[key]) : String(value) !== String(env[key])) {
      throw new Error(`project-env-target-mismatch: ${field}`);
    }
  }
}

module.exports = {readProjectEnv, validateTarget};
