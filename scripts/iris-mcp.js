#!/usr/bin/env node

/**
 * Reusable iris-agentic-dev MCP helper.
 *
 * Examples:
 *   node .agents/scripts/iris-mcp.js check
 *   node .agents/scripts/iris-mcp.js tools
 *   node .agents/scripts/iris-mcp.js call iris_doc "{\"mode\":\"head\",\"name\":\"Demo.Class.cls\"}"
 *   node .agents/scripts/iris-mcp.js call iris_execute --json-file .agents/work/iris-execute.json --allow-write
 *   node .agents/scripts/iris-mcp.js call iris_compile "{\"target\":\"Demo.Class.cls\"}" --allow-write
 *
 * Write-capable tools are blocked unless --allow-write is passed.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const remoteOperations = require('./lib/iris-remote-operations');

const argv = process.argv.slice(2);
const command = argv[0];
let workspaceRoot;
let server;
let env = {};
let namespace;

function usage(exitCode = 1) {
  const out = exitCode === 0 ? console.log : console.error;
  out(`Usage:
  node .agents/scripts/iris-mcp.js check [--json]
  node .agents/scripts/iris-mcp.js tools [--names <name1,name2>] [--schema] [--json]
  node .agents/scripts/iris-mcp.js call <toolName> <jsonArgs> [--allow-write] [--json]
  node .agents/scripts/iris-mcp.js call <toolName> --json-file <path> [--allow-write] [--json]

tools and call include check_config; a separate check is only needed for diagnosis.
--json emits one object on stdout; errors go to stderr with a nonzero exit code.`);
  process.exit(exitCode);
}

function hasFlag(name) {
  return argv.includes(name);
}

function optionValue(name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
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
  const noSkills = normalizedValue(env.IRIS_NO_SKILLS, 'true');
  if (!new Set(['false', '0', 'no']).has(noSkills)) args.push('--no-skills');
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
    writeToolsEnabled: typeof data.write_tools_enabled === 'boolean' ? data.write_tools_enabled : null,
    destructiveToolsEnabled: typeof data.destructive_tools_enabled === 'boolean' ? data.destructive_tools_enabled : null,
    serverVersion: data.server_version || null,
    irisVersion: data.iris_version || null,
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

function parseToolArgsInput(inlineJson, jsonFile, cwd = process.cwd()) {
  if (inlineJson && jsonFile) throw new Error('Use either inline JSON or --json-file, not both');
  if (!jsonFile) return parseJsonArg(inlineJson || '{}', 'tool arguments');
  const resolved = path.resolve(cwd, jsonFile);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`Tool arguments file is not a regular file: ${resolved}`);
  if (stat.size > 8 * 1024 * 1024) throw new Error(`Tool arguments file exceeds the 8 MiB limit: ${resolved}`);
  return parseJsonArg(fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, ''), 'tool arguments file');
}

const alwaysWriteLikeTools = new Set([
  'global_kill',
  'iris_add_server',
  'iris_compile',
  'iris_credential_manage',
  'iris_coverage',
  'iris_execute',
  'iris_execute_method',
  'iris_generate_class',
  'iris_generate_test',
  'iris_import_servers',
  'iris_namespace_create',
  'iris_remove_server',
  'iris_test',
  'iris_ws_close',
  'iris_ws_exec',
  'iris_ws_open',
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
  'capability_matrix',
  'check_config',
  'compare_document',
  'compare_namespace',
  'docs_introspect',
  'extract_message_map_routing',
  'find_subclass_implementations',
  'global_preview',
  'hl7_schema_inspect',
  'hl7_schema_list',
  'iris_business_rule_info',
  'iris_credential_list',
  'iris_database_list',
  'iris_database_stats',
  'iris_debug',
  'iris_doc_search',
  'iris_generate',
  'iris_get_log',
  'iris_info',
  'iris_interop_query',
  'iris_macro',
  'iris_message_body',
  'iris_namespace_list',
  'iris_production_diff',
  'iris_search',
  'iris_servers',
  'iris_symbols',
  'iris_symbols_local',
  'iris_table_info',
  'iris_test_server',
  'journal_search',
  'kb_recall',
  'mermaid_class',
  'mermaid_production',
  'my_access',
  'query_audit_log',
  'resolve_dynamic_dispatch',
  'resolve_storage',
  'skill_community_list',
  'skill_describe',
  'skill_list',
  'skill_search',
  'stream_inspect',
  'telemetry_export_trace',
  'telemetry_query'
]);

const conditionalTools = new Set([
  'iris_admin',
  'iris_containers',
  'iris_doc',
  'iris_global',
  'iris_lookup_manage',
  'iris_lookup_transfer',
  'iris_production',
  'iris_production_item',
  'iris_query',
  'iris_source_control',
  'kb',
  'skill',
  'skill_community'
]);

function isClassifiedTool(toolName) {
  return alwaysWriteLikeTools.has(toolName)
    || readOnlyTools.has(toolName)
    || conditionalTools.has(toolName);
}

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
  constructor(commandPath, args, childEnv, { remoteOwner } = {}) {
    this.remoteOwner = remoteOwner;
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
    this.proc.on('error', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('MCP process failed'));
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
    if (!this.remoteOwner || method !== 'tools/call') return this.requestRaw(method, params, timeoutMs);
    return this.remoteOwner.run({effects:isWriteLike(params.name,params.arguments || {})?'write':'read-only',operation:'mcp-tools-call'}, async () => {
      const result = await this.requestRaw(method, params, timeoutMs);
      if (result.error || result.result?.isError) {
        const failure = JSON.stringify(result);
        throw new remoteOperations.RemoteOperationError('mcp-remote-tool-failed', /(?:HTTP\s*503|503\s+Service Unavailable|"(?:httpStatus|statusCode)"\s*:\s*503)/i.test(failure) ? {status:503} : {});
      }
      return result;
    });
  }

  requestRaw(method, params, timeoutMs = 30000) {
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

  async close() {
    if (!this.proc || this.proc.exitCode !== null || this.proc.signalCode) return {processExited:true};
    const exited = new Promise(resolve => this.proc.once('exit', () => resolve(true)));
    this.proc.stdin.end();
    let timer;
    const wait = ms => Promise.race([exited,new Promise(resolve => {timer=setTimeout(()=>resolve(false),ms);})]).finally(()=>clearTimeout(timer));
    if (await wait(1000)) return {processExited:true};
    this.proc.kill();
    return {processExited:await wait(1000)};
  }
}

const toolCatalogs = new WeakMap();

async function listTools(client) {
  if (!toolCatalogs.has(client)) {
    const pending = (async () => {
      const tools = [], cursors = new Set();
      let cursor;
      do {
        const response = await client.request('tools/list', cursor === undefined ? {} : { cursor });
        if (response.error || !Array.isArray(response.result?.tools)) throw new Error('MCP tools/list failed or returned an invalid catalog');
        tools.push(...response.result.tools);
        cursor = response.result.nextCursor;
        if (cursor !== undefined && cursor !== null && cursor !== '') {
          if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('MCP tools/list returned an invalid cursor');
          cursors.add(cursor);
        }
      } while (cursor !== undefined && cursor !== null && cursor !== '');
      return tools;
    })();
    toolCatalogs.set(client, pending);
    pending.catch(() => toolCatalogs.delete(client));
  }
  return structuredClone(await toolCatalogs.get(client));
}

async function callTool(client, toolName, toolArgs, options = {}) {
  if (isWriteLike(toolName, toolArgs || {}) && !options.allowWrite) {
    throw new Error(`Blocked write-capable or unclassified MCP tool: ${toolName}. Re-run with --allow-write only after explicit user approval.`);
  }
  const args = { ...(toolArgs || {}) };
  const defaultNamespace = options.defaultNamespace === undefined ? namespace : options.defaultNamespace;
  if (defaultNamespace && !Object.prototype.hasOwnProperty.call(args, 'namespace')) {
    const tool = (await listTools(client)).find(item => item.name === toolName);
    if (Object.prototype.hasOwnProperty.call(tool?.inputSchema?.properties || {}, 'namespace')) args.namespace = defaultNamespace;
  }
  const response = await client.request('tools/call', {
    name: toolName,
    arguments: args
  }, options.timeoutMs || 30000);
  return extractToolText(response);
}

async function main() {
  if (!command || command === '-h' || command === '--help') {
    usage(command ? 0 : 1);
  }

  const namesValue = optionValue('--names');
  if (namesValue !== null && command !== 'tools') throw new Error('--names is only supported by tools');
  const names = namesValue === null ? null : [...new Set(namesValue.split(',').map(name => name.trim()))];
  if (names?.some(name => !name)) throw new Error('--names requires comma-separated nonempty tool names');
  const output = {};
  const emit = (key, value) => {
    output[key] = value;
    if (!hasFlag('--json')) printJson(key, value);
  };
  let finishRequested = false;
  const finish = () => { finishRequested = true; };
  loadWorkspaceContext();
  const context = require('./lib/workspace-context').resolveWorkspaceContext(workspaceRoot);
  const connection = {protocol:(env.IRIS_SCHEME || 'https')+':',hostname:env.IRIS_HOST,port:env.IRIS_WEB_PORT,
    rejectUnauthorized:String(env.IRIS_TLS_VERIFY ?? 'true').toLowerCase()!=='false'};
  const policy = remoteOperations.loadRemotePolicy(context,{connection});
  if (policy.enabled && policy.qualification.channels?.mcp?.processExitVerified !== true) throw new Error('remote-mcp-exit-qualification-required');
  const owner = remoteOperations.createRemoteOperation({policy,connection,channel:'mcp'});
  owner.acquire();
  const client = new JsonLineMcpClient(server.command, buildMcpArgs(), env, {remoteOwner:owner});
  try {
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'iris-mcp-helper', version: '1.0.0' }
    });
    client.notify('notifications/initialized', {});

    const check = await callTool(client, 'check_config', {}, { allowWrite: true });
    if (policy.enabled && (check.connected !== true || String(check.host || '').toLowerCase() !== String(env.IRIS_HOST).toLowerCase() ||
        Number(check.port) !== Number(env.IRIS_WEB_PORT) || check.namespace !== env.IRIS_NAMESPACE)) throw new Error('remote-mcp-target-unverified');
    const checkSummary = summarizeCheck(check);
    emit('CHECK', checkSummary);

    if (command === 'check') {
      finish();
      return;
    }

    if (command === 'tools') {
      const catalog = await listTools(client);
      const missing = names?.filter(name => !catalog.some(tool => tool.name === name)) || [];
      if (missing.length) throw new Error(`Unknown or unavailable MCP tools: ${missing.join(', ')}`);
      const tools = names ? names.map(name => catalog.find(tool => tool.name === name)) : catalog;
      emit('TOOLS', tools.map(tool => tool.name));
      if (hasFlag('--schema')) emit('TOOL_SCHEMAS', tools.map(({ name, inputSchema }) => ({ name, inputSchema })));
      finish();
      return;
    }

    if (command === 'call') {
      const toolName = argv[1];
      if (!toolName) usage();
      const jsonFile = optionValue('--json-file');
      const inlineJson = argv[2] && argv[2] !== '--json-file' ? argv[2] : null;
      const toolArgs = parseToolArgsInput(inlineJson, jsonFile);
      const result = await callTool(client, toolName, toolArgs, { allowWrite: hasFlag('--allow-write'), timeoutMs: 60000 });
      emit('RESULT', result);
      finish();
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    const exit = await client.close();
    if (!exit.processExited && policy.enabled) owner.markUnknown('mcp-process-exit-unverified');
    const receipt = owner.close({cleanupVerified:exit.processExited,processExited:exit.processExited});
    if (finishRequested && hasFlag('--json')) {
      if (policy.enabled) output.REMOTE = receipt;
      console.log(JSON.stringify(output));
    }
  }
}

module.exports = {
  callTool,
  listTools,
  isClassifiedTool,
  isWriteLike,
  parseToolArgsInput,
  summarizeCheck
};

if (require.main === module) {
  main().catch((error) => {
    console.error('ERROR=' + error.message);
    process.exitCode = 1;
  });
}
