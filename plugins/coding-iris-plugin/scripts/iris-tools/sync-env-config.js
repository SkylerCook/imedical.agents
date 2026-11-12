#!/usr/bin/env node

/**
 * Sync environment configuration from centralized config.
 * Generates:
 *   - .mcp.json (MCP server config for iris-agentic-dev and optional sftp-server)
 *
 * Usage: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js
 */

const fs = require('fs');
const path = require('path');
const { resolveWorkspaceContext } = require('../../../../scripts/lib/workspace-context');
const { buildSftp } = require('./sftp-config');

// Paths
const workspaceContext = resolveWorkspaceContext(process.cwd());
if (require('../../../../scripts/lib/iris-remote-operations').developmentMode(workspaceContext) === 'offline') {
  console.log(JSON.stringify({status: 'skipped-offline', reason: 'Hospital connection generation is unavailable in offline development'}));
  process.exit(0);
}
const workspaceRoot = workspaceContext.workspaceRoot;
const configPath = path.join(workspaceContext.contextRoot, 'config', 'project-env.json');
const templatePath = path.join(workspaceContext.capabilityRoot, 'plugins', 'coding-iris-plugin', 'templates', 'project-env.template.json');

console.log(`[INFO] Config source: ${configPath}`);
console.log(`[INFO] Workspace root: ${workspaceRoot}`);

// Read centralized config
let config;
try {
  const configContent = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
  config = JSON.parse(configContent);
} catch (err) {
  console.error(`[ERROR] Configuration ${err.code === 'ENOENT' ? 'file missing' : err instanceof SyntaxError ? 'JSON invalid' : 'read failed'}`);
  console.error(`[TIP] Initialize ${configPath} using ${templatePath} and confirmed project settings.`);
  process.exit(1);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

if (!isObject(config)) {
  console.error('[ERROR] Configuration must be a JSON object');
  process.exit(1);
}

const errors = [];
for (const section of ['iris', 'mcp', 'sftp']) {
  if (config[section] !== undefined && !isObject(config[section])) {
    errors.push(`${section}: expected object`);
  }
}
const iris = isObject(config.iris) ? config.iris : {};
const mcp = isObject(config.mcp) ? { ...config.mcp } : {};
const sftp = isObject(config.sftp) ? config.sftp : {};
if (mcp.serverName === undefined) mcp.serverName = 'iris-agentic-dev';
if (mcp.serverPath === undefined && process.platform === 'win32' && process.arch === 'x64') {
  const vendorPath = path.join(workspaceContext.capabilityRoot, 'vendor', 'iris-agentic-dev', 'windows-x64', 'iris-agentic-dev.exe');
  if (fs.existsSync(vendorPath)) mcp.serverPath = vendorPath;
}
const irisScheme = iris.scheme || 'https';
const irisPort = iris.port || 2443;
const irisTlsVerify = String(iris.tlsVerify ?? false);
const sftpEnabled = sftp.enabled === true;
if (sftp.enabled !== undefined && typeof sftp.enabled !== 'boolean') {
  errors.push('sftp.enabled: expected boolean');
}

function isMissing(value) {
  return value === undefined || value === null || String(value).trim() === '' || String(value).trim().startsWith('TODO');
}

function requireValue(section, key, value) {
  if (isMissing(value) || typeof value !== 'string') {
    errors.push(`${section}.${key}: required non-empty string`);
  }
}

requireValue('iris', 'host', iris && iris.host);
requireValue('iris', 'username', iris && iris.username);
requireValue('iris', 'password', iris && iris.password);
requireValue('iris', 'namespace', iris && iris.namespace);
requireValue('mcp', 'serverName', mcp && mcp.serverName);
requireValue('mcp', 'serverPath', mcp && mcp.serverPath);

if (sftpEnabled) {
  for (const key of ['serverName', 'command', 'host', 'username', 'localPath', 'remotePath']) {
    requireValue('sftp', key, sftp[key]);
  }
  if (isMissing(sftp.keyFile)) requireValue('sftp', 'password', sftp.password);
  if (sftp.serverName === mcp.serverName) errors.push('sftp.serverName: must differ from mcp.serverName');
}
if (errors.length) {
  console.error('[ERROR] Invalid configuration fields:\n' + errors.map(error => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`[INFO] IRIS config loaded: ${irisScheme}, port=${irisPort}, host/user/namespace redacted`);
console.log(`[INFO] Backend MCP: ${mcp.serverName}`);
console.log(`[INFO] SFTP MCP: ${sftpEnabled ? 'enabled' : 'disabled'}`);

// ===== Generate .mcp.json =====

function buildIrisMcpArgs() {
  const args = ['mcp'];
  const tomlPath = path.join(workspaceRoot, '.iris-agentic-dev.toml');
  if (fs.existsSync(tomlPath)) {
    args.push('--config', tomlPath);
  }
  args.push('--host', iris.host);
  args.push('--web-port', String(irisPort));
  args.push('--scheme', irisScheme);
  args.push('--namespace', iris.namespace);
  if (mcp.includeBuiltInSkills !== true) {
    args.push('--no-skills');
  }
  return args;
}

const mcpConfig = {
  mcpServers: {
    [mcp.serverName]: {
      command: mcp.serverPath,
      args: buildIrisMcpArgs(),
      env: {
        IRIS_HOST: iris.host,
        IRIS_WEB_PORT: String(irisPort),
        IRIS_SCHEME: irisScheme,
        IRIS_USERNAME: iris.username,
        IRIS_PASSWORD: iris.password,
        IRIS_NAMESPACE: iris.namespace,
        IRIS_TLS_VERIFY: irisTlsVerify,
        IRIS_NO_SKILLS: String(mcp.includeBuiltInSkills !== true)
      }
    }
  }
};

if (sftpEnabled) {
  mcpConfig.mcpServers[sftp.serverName] = buildSftp(sftp, workspaceContext.capabilityRoot);
}

require('../../../../scripts/lib/iris-session-migration').writeGenerated({context:workspaceContext,config:mcpConfig});
console.log('[OK] .mcp.json generated');

console.log('');
console.log('[DONE] MCP config synced from .agents/config/project-env.json');
