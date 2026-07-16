#!/usr/bin/env node

/**
 * Reusable iris-agentic-dev MCP helper.
 *
 * Examples:
 *   node .agents/scripts/iris-mcp.js check
 *   node .agents/scripts/iris-mcp.js tools
 *   node .agents/scripts/iris-mcp.js call iris_doc "{\"mode\":\"head\",\"name\":\"Demo.Class.cls\"}"
 *   node .agents/scripts/iris-mcp.js call iris_compile "{\"target\":\"Demo.Class.cls\"}" --allow-write
 *
 * Write-capable tools are blocked unless --allow-write is passed.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
const command = argv[0];

function usage(exitCode = 1) {
  const out = exitCode === 0 ? console.log : console.error;
  out(`Usage:
  node .agents/scripts/iris-mcp.js check
  node .agents/scripts/iris-mcp.js tools
  node .agents/scripts/iris-mcp.js call <toolName> <jsonArgs> [--allow-write]`);
  process.exit(exitCode);
}

if (!command || command === '-h' || command === '--help') {
  usage(command ? 0 : 1);
}

function hasFlag(name) {
  return argv.includes(name);
}

function findWorkspaceRoot() {
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, '.mcp.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Cannot find workspace root containing .mcp.json');
    }
    dir = parent;
  }
}

const workspaceRoot = findWorkspaceRoot();
const mcpConfig = JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.mcp.json'), 'utf8'));
const server = mcpConfig.mcpServers && mcpConfig.mcpServers['iris-agentic-dev'];
if (!server) {
  throw new Error('MCP server iris-agentic-dev not found in .mcp.json');
}

const env = server.env || {};
const namespace = env.IRIS_NAMESPACE;
if (!namespace) {
  throw new Error('IRIS_NAMESPACE is missing from .mcp.json env');
}

function buildMcpArgs() {
  const args = ['mcp'];
  const tomlPath = path.join(workspaceRoot, '.iris-agentic-dev.toml');
  if (fs.existsSync(tomlPath)) args.push('--config', tomlPath);
  if (env.IRIS_HOST) args.push('--host', env.IRIS_HOST);
  if (env.IRIS_WEB_PORT) args.push('--web-port', String(env.IRIS_WEB_PORT));
  if (env.IRIS_SCHEME) args.push('--scheme', env.IRIS_SCHEME);
  if (env.IRIS_NAMESPACE) args.push('--namespace', env.IRIS_NAMESPACE);
  return args;
}

function parseJsonArg(text, label) {
  try {
    return JSON.parse(text || '{}');
  } catch (error) {
    const relaxed = parseRelaxedObject(text || '');
    if (relaxed) return relaxed;
    throw new Error(`Invalid JSON for ${label}: ${error.message}`);
  }
}

function parseRelaxedObject(text) {
  const value = text.trim();
  if (!value.startsWith('{') || !value.endsWith('}')) return null;
  const body = value.slice(1, -1).trim();
  if (!body) return {};
  const result = {};
  for (const part of body.split(',')) {
    const index = part.indexOf(':');
    if (index < 0) return null;
    const key = part.slice(0, index).trim().replace(/^["']|["']$/g, '');
    const rawValue = part.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (!key) return null;
    result[key] = rawValue;
  }
  return result;
}

function extractToolText(response) {
  const text = response.result && response.result.content && response.result.content[0] && response.result.content[0].text;
  if (!text) return response;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function printJson(prefix, value) {
  console.log(`${prefix}=${JSON.stringify(value)}`);
}

function summarizeCheck(data) {
  return {
    configFileLoaded: Boolean(data.config_file),
    hostLoaded: Boolean(data.host),
    namespaceIsDefaultUser: data.namespace === 'USER',
    portIsDefault52773: String(data.port) === '52773',
    connected: data.connected === true,
    writeToolsEnabled: data.write_tools_enabled === true
  };
}

function assertConfigLoaded(summary) {
  if (!summary.hostLoaded || summary.namespaceIsDefaultUser || summary.portIsDefault52773) {
    throw new Error('MCP config is not loaded correctly; inspect .iris-agentic-dev.toml and .mcp.json');
  }
}

const writeTools = new Set([
  'iris_admin',
  'iris_compile',
  'iris_credential_manage',
  'iris_doc',
  'iris_execute',
  'iris_generate_class',
  'iris_generate_test',
  'iris_lookup_manage',
  'iris_lookup_transfer',
  'iris_production',
  'iris_production_item',
  'iris_source_control',
  'iris_test',
  'skill',
  'skill_community'
]);

function isWriteLike(toolName, toolArgs) {
  if (toolName === 'iris_doc') {
    return ['put', 'delete'].includes(String(toolArgs.mode || '').toLowerCase());
  }
  if (toolName === 'iris_query') {
    const query = String(toolArgs.query || '').trim().toLowerCase();
    return !query.startsWith('select') && !query.startsWith('with');
  }
  return writeTools.has(toolName);
}

class JsonLineMcpClient {
  constructor(commandPath, args, childEnv) {
    this.proc = spawn(commandPath, args, {
      cwd: workspaceRoot,
      env: { ...process.env, ...childEnv },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';

    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString('utf8');
    });
    this.proc.on('exit', (code) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`MCP exited ${code}`));
      }
      this.pending.clear();
    });
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        pending.resolve(message);
      }
    }
  }

  request(method, params, timeoutMs = 30000) {
    const id = this.nextId++;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  close() {
    if (this.proc) {
      this.proc.stdin.end();
      this.proc.kill();
    }
  }
}

async function callTool(client, toolName, toolArgs, options = {}) {
  if (namespace && toolArgs && !Object.prototype.hasOwnProperty.call(toolArgs, 'namespace')) {
    toolArgs.namespace = namespace;
  }
  if (isWriteLike(toolName, toolArgs || {}) && !options.allowWrite) {
    throw new Error(`Blocked write-capable MCP tool: ${toolName}. Re-run with --allow-write only after explicit user approval.`);
  }
  const response = await client.request('tools/call', {
    name: toolName,
    arguments: toolArgs || {}
  }, options.timeoutMs || 30000);
  return extractToolText(response);
}

async function main() {
  const client = new JsonLineMcpClient(server.command, buildMcpArgs(), env);
  try {
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'iris-mcp-helper', version: '1.0.0' }
    });
    client.notify('notifications/initialized', {});

    const check = await callTool(client, 'check_config', {}, { allowWrite: true });
    const checkSummary = summarizeCheck(check);
    printJson('CHECK', checkSummary);

    if (command !== 'check') {
      assertConfigLoaded(checkSummary);
    }

    if (command === 'check') {
      return;
    }

    if (command === 'tools') {
      const response = await client.request('tools/list', {});
      const names = (response.result && response.result.tools || []).map((tool) => tool.name);
      printJson('TOOLS', names);
      return;
    }

    if (command === 'call') {
      const toolName = argv[1];
      const jsonArgs = argv[2] || '{}';
      if (!toolName) usage();
      const toolArgs = parseJsonArg(jsonArgs, 'tool arguments');
      const result = await callTool(client, toolName, toolArgs, { allowWrite: hasFlag('--allow-write'), timeoutMs: 60000 });
      printJson('RESULT', result);
      return;
    }

    usage();
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error('ERROR=' + error.message);
  process.exitCode = 1;
});
