#!/usr/bin/env node

/**
 * Sync environment configuration from centralized config.
 * Generates:
 *   - project.code-workspace (VSCode workspace)
 *   - .mcp.json (MCP server config for iris-dev.exe)
 *   - .vscode/settings.json (iris-dev extension path)
 *
 * Usage: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js
 */

const fs = require('fs');
const path = require('path');

const scriptDir = __dirname;

function findWorkspaceRoot() {
  let dir = scriptDir;
  while (true) {
    if (path.basename(dir).toLowerCase() === '.agents') {
      return path.dirname(dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return process.cwd();
    }
    dir = parent;
  }
}

// Paths
const workspaceRoot = findWorkspaceRoot();
const configPath = path.join(workspaceRoot, '.agents', 'config', 'project-env.json');
const templatePath = path.join(workspaceRoot, '.agents', 'plugins', 'coding-iris-plugin', 'templates', 'project-env.template.json');

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

const { iris, vscode, mcp } = config;
const irisScheme = iris.scheme || 'https';
const irisPort = iris.port || 2443;
const irisTlsVerify = String(iris.tlsVerify ?? false);

console.log(`[INFO] IRIS: ${irisScheme}://${iris.host}:${irisPort} user=${iris.username} ns=${iris.namespace}`);
console.log(`[INFO] MCP: ${mcp.serverName} (${mcp.serverPath})`);

// ===== Generate project.code-workspace =====

const workspaceConfig = {
  folders: [
    { path: '.' }
  ],
  settings: {
    'intersystems.servers': {
      [vscode.serverName]: {
        webServer: {
          scheme: irisScheme,
          host: iris.host,
          port: irisPort
        },
        username: iris.username,
        description: iris.host
      }
    },
    'objectscript.conn': {
      active: true,
      ns: iris.namespace,
      server: vscode.serverName
    },
    'objectscript.syncLocalChanges': 'vscodeOnly'
  }
};

const workspacePath = path.join(workspaceRoot, 'project.code-workspace');
fs.writeFileSync(workspacePath, JSON.stringify(workspaceConfig, null, 2) + '\n', 'utf8');
console.log('[OK] project.code-workspace generated');

// ===== Generate .mcp.json =====

const mcpConfig = {
  mcpServers: {
    [mcp.serverName]: {
      command: mcp.serverPath,
      args: ['mcp'],
      env: {
        IRIS_HOST: iris.host,
        IRIS_WEB_PORT: String(irisPort),
        IRIS_SCHEME: irisScheme,
        IRIS_USERNAME: iris.username,
        IRIS_PASSWORD: iris.password,
        IRIS_NAMESPACE: iris.namespace,
        IRIS_TLS_VERIFY: irisTlsVerify
      }
    }
  }
};

const mcpPath = path.join(workspaceRoot, '.mcp.json');
fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf8');
console.log('[OK] .mcp.json generated');

// ===== Generate .vscode/settings.json =====

const vscodeSettingsDir = path.join(workspaceRoot, '.vscode');
if (!fs.existsSync(vscodeSettingsDir)) {
  fs.mkdirSync(vscodeSettingsDir, { recursive: true });
}

const vscodeSettings = {
  'objectscript.conn': {
    active: true
  },
  'iris-dev.serverPath': mcp.serverPath
};

const vscodeSettingsPath = path.join(vscodeSettingsDir, 'settings.json');
fs.writeFileSync(vscodeSettingsPath, JSON.stringify(vscodeSettings, null, 2) + '\n', 'utf8');
console.log('[OK] .vscode/settings.json generated');

console.log('');
console.log('[DONE] All configs synced from .agents/config/project-env.json');
console.log('[TIP] Reload VSCode window to apply changes.');
