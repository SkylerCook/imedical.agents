'use strict';
const environment = require('../../../../scripts/lib/project-environment');

// Resolve only the explicitly declared file; never change WorkspaceRoot or MCP ownership.
function readProjectEnv(context, {optional = false} = {}) {
  try {
    return environment.read(context,{optional});
  } catch (error) {
    if (error.message.startsWith('project-env-') || error.message.startsWith('project-config-conflict:')) throw error;
    throw new Error('project-env-invalid', {cause:error});
  }
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
