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
let workspaceRoot;
let server;
let env = {};
let namespace;

function usage(exitCode = 1) {
  const out = exitCode === 0 ? console.log : console.error;
  out(`Usage:
  node .agents/scripts/iris-mcp.js check
  node .agents/scripts/iris-mcp.js tools
  node .agents/scripts/iris-mcp.js call <toolName> <jsonArgs> [--allow-write]`);
  process.exit(exitCode);
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

function loadWorkspaceContext() {
  workspaceRoot = findWorkspaceRoot();
  const mcpConfig = JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.mcp.json'), 'utf8'));
  server = mcpConfig.mcpServers && mcpConfig.mcpServers['iris-agentic-dev'];
  if (!server) {
    throw new Error('MCP server iris-agentic-dev not found in .mcp.json');
  }

  env = server.env || {};
  namespace = env.IRIS_NAMESPACE;
  if (!namespace) {
    throw new Error('IRIS_NAMESPACE is missing from .mcp.json env');
  }
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
  data = data || {};
  const capabilities = data.capabilities && typeof data.capabilities === 'object'
    ? data.capabilities
    : {};
  const warnings = [];
  if (typeof data.fallback_warning === 'string' && data.fallback_warning.trim()) {
    warnings.push(data.fallback_warning.trim());
  }
  if (data.connected !== true) {
    warnings.push('MCP is not connected; run a task-specific read-only probe before relying on IRIS capabilities.');
  } else if (!data.config_file && (data.namespace === 'USER' || String(data.port) === '52773')) {
    warnings.push('Connection uses fallback-looking defaults; verify the intended target with a read-only probe.');
  }

  return {
    configFileLoaded: Boolean(data.config_file),
    hostLoaded: Boolean(data.host),
    namespaceIsDefaultUser: data.namespace === 'USER',
    portIsDefault52773: String(data.port) === '52773',
    connected: data.connected === true,
    connectionSource: data.connection_source || null,
    workspaceHintLoaded: Boolean(data.objectscript_workspace),
    writeToolsEnabled: data.write_tools_enabled === true,
    capabilities: {
      privateWebServer: typeof capabilities.private_web_server === 'boolean'
        ? capabilities.private_web_server
        : null,
      atelierRest: typeof capabilities.atelier_rest === 'boolean'
        ? capabilities.atelier_rest
        : null,
      compilePath: capabilities.compile_path || null,
      webgatewayConfigured: Boolean(capabilities.webgateway_url)
    },
    warnings
  };
}

const alwaysWriteLikeTools = new Set([
  'iris_compile',
  'iris_credential_manage',
  'iris_coverage',
  'iris_execute',
  'iris_execute_method',
  'iris_generate_class',
  'iris_generate_test',
  'iris_test',
  'kb_index',
  'skill_community_install',
  'skill_forget',
  'skill_optimize',
  'skill_propose',
  'skill_share'
]);

const readOnlyTools = new Set([
  'agent_history',
  'agent_stats',
  'check_config',
  'docs_introspect',
  'extract_message_map_routing',
  'find_subclass_implementations',
  'iris_business_rule_info',
  'iris_credential_list',
  'iris_debug',
  'iris_doc_search',
  'iris_generate',
  'iris_get_log',
  'iris_info',
  'iris_interop_query',
  'iris_macro',
  'iris_message_body',
  'iris_production_diff',
  'iris_search',
  'iris_symbols',
  'iris_symbols_local',
  'iris_table_info',
  'kb_recall',
  'resolve_dynamic_dispatch',
  'skill_community_list',
  'skill_describe',
  'skill_list',
  'skill_search',
  'telemetry_export_trace',
  'telemetry_query'
]);

function normalizedValue(value, fallback = '') {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  return normalized || fallback;
}

function actionIsWriteLike(toolArgs, readActions) {
  const action = normalizedValue(toolArgs.action);
  return !readActions.has(action);
}

function isWriteLike(toolName, toolArgs) {
  if (toolName === 'iris_doc') {
    const mode = normalizedValue(toolArgs.mode, 'get');
    return !new Set(['get', 'head', 'fragment', 'compiled', 'list']).has(mode);
  }

  if (toolName === 'iris_query') {
    const mode = normalizedValue(toolArgs.mode, 'read');
    if (toolArgs.force === true || mode === 'write') return true;
    if (mode === 'count' || mode === 'explain') return false;
    if (mode !== 'read') return true;
    const query = normalizedValue(toolArgs.query);
    return query !== '' && !query.startsWith('select') && !query.startsWith('with');
  }

  if (toolName === 'iris_global') {
    return actionIsWriteLike(toolArgs, new Set(['get', 'list']));
  }
  if (toolName === 'iris_containers') {
    return actionIsWriteLike(toolArgs, new Set(['list']));
  }
  if (toolName === 'iris_admin') {
    return actionIsWriteLike(toolArgs, new Set([
      'list_namespaces',
      'list_databases',
      'list_users',
      'list_roles',
      'list_user_roles',
      'check_permission',
      'list_webapps',
      'get_webapp',
      'view_locks',
      'view_processes',
      'journal_search',
      'namespace_mappings',
      'database_status'
    ]));
  }
  if (toolName === 'iris_source_control') {
    return actionIsWriteLike(toolArgs, new Set(['status', 'menu']));
  }
  if (toolName === 'iris_lookup_manage') {
    return actionIsWriteLike(toolArgs, new Set(['get', 'list_keys', 'list_tables']));
  }
  if (toolName === 'iris_lookup_transfer') {
    return actionIsWriteLike(toolArgs, new Set(['export']));
  }
  if (toolName === 'iris_production') {
    return actionIsWriteLike(toolArgs, new Set(['status', 'check']));
  }
  if (toolName === 'iris_production_item') {
    return actionIsWriteLike(toolArgs, new Set(['get_settings']));
  }
  if (toolName === 'skill') {
    return actionIsWriteLike(toolArgs, new Set(['list', 'describe', 'search']));
  }
  if (toolName === 'skill_community') {
    return actionIsWriteLike(toolArgs, new Set(['list']));
  }
  if (toolName === 'kb') {
    return actionIsWriteLike(toolArgs, new Set(['recall']));
  }

  if (alwaysWriteLikeTools.has(toolName)) return true;
  return !readOnlyTools.has(toolName);
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
    throw new Error(`Blocked write-capable or unclassified MCP tool: ${toolName}. Re-run with --allow-write only after explicit user approval.`);
  }
  const response = await client.request('tools/call', {
    name: toolName,
    arguments: toolArgs || {}
  }, options.timeoutMs || 30000);
  return extractToolText(response);
}

async function main() {
  if (!command || command === '-h' || command === '--help') {
    usage(command ? 0 : 1);
  }

  loadWorkspaceContext();
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

module.exports = {
  isWriteLike,
  summarizeCheck
};

if (require.main === module) {
  main().catch((error) => {
    console.error('ERROR=' + error.message);
    process.exitCode = 1;
  });
}
