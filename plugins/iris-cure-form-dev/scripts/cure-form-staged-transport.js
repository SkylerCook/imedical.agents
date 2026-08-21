#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CURE_FORM_DEPLOY_CLASS = 'DHCDoc.Cure.AI.CureFormDeploy';
const CHUNK_SIZE = 6000;
const ALLOWED_METHODS = new Set(['InspectForm', 'InspectConsolidation', 'InspectSharedConsolidation', 'InspectCleanup', 'ValidatePackage', 'ApplyPackage', 'ValidateConsolidation', 'ApplyConsolidation', 'ValidateSharedConsolidation', 'ApplySharedConsolidation', 'ValidateCleanup', 'ApplyCleanup']);
const RESULT_CHUNK_SIZE = 12000;

function fail(message) { throw new Error(message); }

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    result[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = next;
    index += 1;
  }
  return result;
}

function requireOption(args, name) {
  const value = args[name];
  if (value == null || String(value).trim() === '') fail(`Missing required option --${name.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())}`);
  return String(value);
}

function findWorkspaceRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, '.mcp.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) fail('Cannot find workspace root containing .mcp.json');
    current = parent;
  }
}

function objectScriptArgument(value) {
  const encoded = Buffer.from(String(value == null ? '' : value), 'utf8').toString('base64');
  return `$zconvert(##class(%SYSTEM.Encryption).Base64Decode("${encoded}"),"I","UTF8")`;
}

function unwrap(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    try { return JSON.parse(text); } catch { return value; }
  }
  if (!value || typeof value !== 'object') return value;
  for (const key of ['output', 'stdout', 'return_value', 'returnValue', 'result', 'value', 'raw']) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== value) {
      const candidate = unwrap(value[key]);
      if (candidate && (typeof candidate !== 'string' || candidate.trim())) return candidate;
    }
  }
  return value;
}

function extractToolResult(response) {
  if (response && response.error) fail(response.error.message || JSON.stringify(response.error));
  const content = response && response.result && response.result.content;
  const text = Array.isArray(content) && content[0] && content[0].text;
  if (!text) return response;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function resultIsOk(value) {
  const unwrapped = unwrap(value);
  return Boolean(unwrapped && (unwrapped.ok === true || unwrapped.ok === 1));
}

class McpClient {
  constructor(command, commandArgs, cwd, env) {
    this.proc = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.buffer = '';
    this.stderr = '';
    this.nextId = 1;
    this.pending = new Map();
    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.stderr.on('data', (chunk) => { this.stderr += chunk.toString('utf8'); });
    this.proc.on('exit', (code) => {
      for (const pending of this.pending.values()) pending.reject(new Error(`MCP exited ${code}: ${this.stderr.trim()}`));
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
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        pending.resolve(message);
      }
    }
  }

  request(method, params, timeoutMs = 120000) {
    const id = this.nextId++;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (message) => { clearTimeout(timer); resolve(message); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
    });
  }

  notify(method, params) { this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  close() { if (this.proc) { this.proc.stdin.end(); this.proc.kill(); } }
}

function buildServerArgs(workspaceRoot, server) {
  const env = server.env || {};
  const args = ['mcp'];
  const tomlPath = path.join(workspaceRoot, '.iris-agentic-dev.toml');
  if (fs.existsSync(tomlPath)) args.push('--config', tomlPath);
  if (env.IRIS_HOST) args.push('--host', env.IRIS_HOST);
  if (env.IRIS_WEB_PORT) args.push('--web-port', String(env.IRIS_WEB_PORT));
  if (env.IRIS_SCHEME) args.push('--scheme', env.IRIS_SCHEME);
  if (env.IRIS_NAMESPACE) args.push('--namespace', env.IRIS_NAMESPACE);
  return args;
}

async function callClassMethod(client, namespace, method, methodArgs) {
  const methodCall = `##class(${CURE_FORM_DEPLOY_CLASS}).${method}(${methodArgs.map(objectScriptArgument).join(',')})`;
  return unwrap(await callCode(client, namespace, `write ${methodCall}`));
}

async function callCode(client, namespace, code) {
  const response = await client.request('tools/call', {
    name: 'iris_execute',
    arguments: { code, confirmed: true, translate_sql: false, timeout: 120, namespace }
  });
  return extractToolResult(response);
}

function transportText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return String(value == null ? '' : value);
  for (const key of ['output', 'stdout', 'return_value', 'returnValue', 'result', 'value', 'raw']) {
    if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === value) continue;
    const text = transportText(value[key]);
    if (text !== '') return text;
  }
  return '';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const method = requireOption(args, 'method');
  if (!ALLOWED_METHODS.has(method)) fail('Persistent transport method is not allowed.');
  const isInspect = method === 'InspectForm' || method === 'InspectConsolidation' || method === 'InspectSharedConsolidation' || method === 'InspectCleanup';
  const isApply = method === 'ApplyPackage' || method === 'ApplyConsolidation' || method === 'ApplySharedConsolidation' || method === 'ApplyCleanup';
  const packageJson = isInspect ? '' : fs.readFileSync(path.resolve(requireOption(args, 'packageFile')), 'utf8').replace(/^\uFEFF/, '');
  const operator = isApply ? requireOption(args, 'operator') : '';
  const reason = isApply ? requireOption(args, 'reason') : '';
  const workspaceRoot = findWorkspaceRoot();
  const mcpConfig = JSON.parse(fs.readFileSync(path.join(workspaceRoot, '.mcp.json'), 'utf8'));
  const server = mcpConfig.mcpServers && mcpConfig.mcpServers['iris-agentic-dev'];
  if (!server) fail('MCP server iris-agentic-dev not found in .mcp.json');
  const namespace = server.env && server.env.IRIS_NAMESPACE;
  if (!namespace) fail('IRIS_NAMESPACE is missing from .mcp.json env');
  const client = new McpClient(server.command, buildServerArgs(workspaceRoot, server), workspaceRoot, server.env || {});
  const stageId = crypto.randomUUID();
  let stageMayExist = false;
  let appliedCallStarted = false;
  try {
    await client.request('initialize', {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'cure-form-staged-transport', version: '1.0.0' }
    });
    client.notify('notifications/initialized', {});
    if (isInspect) {
      const formType = requireOption(args, 'formType');
      const methodArgs = method === 'InspectCleanup'
        ? [formType, requireOption(args, 'scopeId'), requireOption(args, 'sourceIds'), requireOption(args, 'replacementIds')]
        : (method === 'InspectSharedConsolidation'
          ? [formType, requireOption(args, 'scopeId'), requireOption(args, 'sourceIds'), requireOption(args, 'targetIds')]
          : [formType, requireOption(args, 'mapCode')]);
      const methodCall = `##class(${CURE_FORM_DEPLOY_CLASS}).${method}(${methodArgs.map(objectScriptArgument).join(',')})`;
      const lengthText = transportText(await callCode(client, namespace, `set value=${methodCall} write $length(value)`)).trim();
      if (!/^\d+$/.test(lengthText)) fail(`Remote ${method} returned no readable result length.`);
      const length = Number(lengthText);
      let output = '';
      for (let start = 1; start <= length; start += RESULT_CHUNK_SIZE) {
        const end = Math.min(start + RESULT_CHUNK_SIZE - 1, length);
        const chunk = transportText(await callCode(client, namespace, `set value=${methodCall} write $extract(value,${start},${end})`));
        if (!chunk) fail(`Remote ${method} chunk ${start}-${end} was empty.`);
        output += chunk;
      }
      let snapshot;
      try { snapshot = JSON.parse(output); } catch (error) { fail(`Remote ${method} JSON could not be reassembled: ${error.message}`); }
      console.log(`RESULT=${JSON.stringify(snapshot)}`);
      return;
    }
    let sequence = 0;
    for (let offset = 0; offset < packageJson.length; offset += CHUNK_SIZE) {
      sequence += 1;
      const chunk = packageJson.slice(offset, offset + CHUNK_SIZE);
      const staged = await callClassMethod(client, namespace, 'PutPackageChunk', [stageId, sequence, chunk]);
      stageMayExist = true;
      if (!resultIsOk(staged)) fail(`Server rejected package chunk ${sequence}: ${JSON.stringify(staged)}`);
    }
    if (method === 'ValidatePackage' || method === 'ValidateConsolidation' || method === 'ValidateSharedConsolidation' || method === 'ValidateCleanup') {
      const validationMethod = method === 'ValidatePackage'
        ? 'ValidateStagedPackage'
        : (method === 'ValidateConsolidation'
          ? 'ValidateStagedConsolidation'
          : (method === 'ValidateSharedConsolidation' ? 'ValidateStagedSharedConsolidation' : 'ValidateStagedCleanup'));
      const validated = await callClassMethod(client, namespace, validationMethod, [stageId]);
      const cleared = await callClassMethod(client, namespace, 'ClearStagedPackage', [stageId]);
      stageMayExist = false;
      if (!resultIsOk(cleared)) fail(`Server could not clear the validated package stage: ${JSON.stringify(cleared)}`);
      console.log(`RESULT=${JSON.stringify(validated)}`);
      return;
    }
    appliedCallStarted = true;
    const applyMethod = method === 'ApplyPackage'
      ? 'ApplyStagedPackage'
      : (method === 'ApplyConsolidation'
        ? 'ApplyStagedConsolidation'
        : (method === 'ApplySharedConsolidation' ? 'ApplyStagedSharedConsolidation' : 'ApplyStagedCleanup'));
    const applied = await callClassMethod(client, namespace, applyMethod, [stageId, operator, reason]);
    stageMayExist = false;
    console.log(`RESULT=${JSON.stringify(applied)}`);
  } finally {
    if (stageMayExist && !appliedCallStarted) {
      try { await callClassMethod(client, namespace, 'ClearStagedPackage', [stageId]); } catch { /* best-effort cleanup */ }
    }
    client.close();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(`ERROR=${error.message}`); process.exit(1); });
}

module.exports = { objectScriptArgument, resultIsOk };
