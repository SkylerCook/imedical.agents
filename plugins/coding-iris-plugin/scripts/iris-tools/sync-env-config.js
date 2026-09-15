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

const scriptDir = __dirname;

// Paths
const workspaceContext = resolveWorkspaceContext(process.cwd());
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
  console.error(`[ERROR] Failed to read config: ${err.message}`);
  console.error(`[TIP] Copy ${templatePath} to ${configPath}, then fill in your local IRIS and MCP settings.`);
  process.exit(1);
}

const { iris, mcp, sftp } = config;
const irisScheme = iris.scheme || 'https';
const irisPort = iris.port || 2443;
const irisTlsVerify = String(iris.tlsVerify ?? false);
const sftpEnabled = Boolean(sftp && sftp.enabled);

function isMissing(value) {
  return value === undefined || value === null || String(value).trim() === '' || String(value).trim().startsWith('TODO');
}

function requireValue(section, key, value) {
  if (isMissing(value)) {
    console.error(`[ERROR] Missing config: ${section}.${key}`);
    process.exit(1);
  }
}

requireValue('iris', 'host', iris && iris.host);
requireValue('iris', 'username', iris && iris.username);
requireValue('iris', 'password', iris && iris.password);
requireValue('iris', 'namespace', iris && iris.namespace);
requireValue('mcp', 'serverName', mcp && mcp.serverName);
requireValue('mcp', 'serverPath', mcp && mcp.serverPath);

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
  requireValue('sftp', 'serverName', sftp.serverName);
  requireValue('sftp', 'command', sftp.command);
  requireValue('sftp', 'host', sftp.host);
  requireValue('sftp', 'username', sftp.username);
  if (isMissing(sftp.keyFile)) requireValue('sftp', 'password', sftp.password);
  requireValue('sftp', 'localPath', sftp.localPath);
  requireValue('sftp', 'remotePath', sftp.remotePath);

  mcpConfig.mcpServers[sftp.serverName] = buildSftp(sftp, workspaceContext.capabilityRoot);
}

const mcpPath = path.join(workspaceRoot, '.mcp.json');
fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf8');
console.log('[OK] .mcp.json generated');

console.log('');
console.log('[DONE] MCP config synced from .agents/config/project-env.json');
