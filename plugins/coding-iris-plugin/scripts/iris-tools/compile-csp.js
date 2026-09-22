#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const {performance} = require('node:perf_hooks');
const {resolveWorkspaceContext, validateWorkspaceContext} = require('../../../../scripts/lib/workspace-context');

function required(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('TODO')) throw new Error(`Missing ${field}`);
  return value;
}
function virtualPath(value) {
  required(value, 'CSP virtual path');
  const normalized = value.replace(/^\//, '');
  if (normalized.includes('\\') || /[%?#\x00-\x20]/.test(normalized) || normalized.split('/').some(p => !p || p === '.' || p === '..')) {
    throw new Error('Invalid CSP virtual path');
  }
  return normalized;
}
function plan(documents, basePath) {
  const base = virtualPath(basePath);
  if (!Array.isArray(documents) || !documents.length) throw new Error('At least one CSP document is required');
  const targets = [...new Set(documents.map(virtualPath))];
  for (const target of targets) {
    if (!target.startsWith(base + '/') || !target.toLowerCase().endsWith('.csp')) throw new Error('Document must be a CSP below web.cspBasePath');
  }
  return {schema: 'iris-csp-compile/v1', status: 'planned', transport: 'atelier', documents: targets, flags: 'cuk', requestCount: 1};
}
function connection(config, mcp) {
  const env = mcp.mcpServers?.[config.mcp?.serverName || 'iris-agentic-dev']?.env || {};
  for (const key of ['IRIS_HOST', 'IRIS_SCHEME', 'IRIS_USERNAME', 'IRIS_PASSWORD', 'IRIS_NAMESPACE']) required(env[key], key);
  if (!['http', 'https'].includes(env.IRIS_SCHEME)) throw new Error('Unsupported IRIS_SCHEME');
  const port = Number(env.IRIS_WEB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid IRIS_WEB_PORT');
  if (config.iris?.namespace && config.iris.namespace !== env.IRIS_NAMESPACE) throw new Error('Namespace differs between .mcp.json and project-env.json');
  const tls = String(env.IRIS_TLS_VERIFY ?? true).toLowerCase();
  if (!['true', 'false'].includes(tls)) throw new Error('Invalid IRIS_TLS_VERIFY');
  return {protocol: env.IRIS_SCHEME + ':', hostname: env.IRIS_HOST, port,
    path: '/api/atelier/v1/' + encodeURIComponent(env.IRIS_NAMESPACE) + '/action/compile?flags=cuk&source=0',
    rejectUnauthorized: tls !== 'false', auth: env.IRIS_USERNAME + ':' + env.IRIS_PASSWORD};
}
function requestCompile(options, documents, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(documents));
    const client = options.protocol === 'https:' ? https : http;
    const request = client.request({...options, method: 'POST', headers: {'Content-Type': 'application/json', 'Content-Length': body.length}}, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) request.destroy(new Error('Compile response too large; inspect server state before retrying'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`Atelier HTTP ${response.statusCode}; inspect server state before retrying`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('Invalid Atelier JSON response; outcome unknown')); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('Compile deadline exceeded; outcome unknown, do not automatically retry')), timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
    request.end(body);
  });
}
function validateResponse(response) {
  if (!response || !Array.isArray(response.status?.errors) || !Array.isArray(response.result?.content) || !Array.isArray(response.console)) {
    throw new Error('Incomplete Atelier response; outcome unknown');
  }
  const failedDocuments = response.result.content.filter(item => item?.status && item.status !== 'OK');
  const errors = [...response.status.errors, ...failedDocuments.map(item => ({document: item.name, status: item.status}))];
  if (response.status.summary) errors.push({summary: response.status.summary});
  return {status: errors.length ? 'compile-failed' : 'compiled', errors, console: response.console};
}
async function compile(options, deployment, timeoutMs = 60000) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error('Invalid timeout');
  const start = performance.now();
  const result = validateResponse(await requestCompile(options, deployment.documents, timeoutMs));
  return {...deployment, ...result, elapsedMs: Math.round(performance.now() - start)};
}
function args(argv) {
  const result = {projectRoot: process.cwd(), documents: [], execute: false, timeoutMs: 60000};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--execute') result.execute = true;
    else if (argv[i] === '--project-root') result.projectRoot = required(argv[++i], '--project-root');
    else if (argv[i] === '--timeout-ms') result.timeoutMs = Number(argv[++i]);
    else if (argv[i] === '--documents') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) result.documents.push(argv[++i]);
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return result;
}
async function main(argv) {
  if (argv.includes('--help')) {
    console.log('Usage: node compile-csp.js --project-root <project> --documents <virtual.csp...> [--execute] [--timeout-ms 60000]\nDefault: local plan only. Upload files first. --execute authorizes one compile request; no automatic retries or parent-page expansion.');
    return;
  }
  const parsed = args(argv);
  const context = resolveWorkspaceContext(parsed.projectRoot);
  if (validateWorkspaceContext(context).some(item => ['manifest-invalid', 'schema-version-unsupported'].includes(item.status))) throw new Error('Invalid workspace context');
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const config = read(path.join(context.contextRoot, 'config/project-env.json'));
  const deployment = plan(parsed.documents, config.web?.cspBasePath);
  if (!parsed.execute) { console.log(JSON.stringify(deployment)); return; }
  const options = connection(config, read(path.join(context.workspaceRoot, '.mcp.json')));
  const result = await compile(options, deployment, parsed.timeoutMs);
  // Do not emit credentials even if a server echoes connection text in a diagnostic.
  const output = JSON.stringify(result).split(options.auth).join('[redacted]').split(options.auth.slice(options.auth.indexOf(':') + 1)).join('[redacted]');
  console.log(output);
  if (result.status !== 'compiled') process.exitCode = 1;
}
module.exports = {plan, connection, compile, validateResponse, args};
if (require.main === module) main(process.argv.slice(2)).catch(() => {
  console.error(JSON.stringify({schema: 'iris-csp-compile/v1', status: 'failed-or-unknown', message: 'Check configuration, target names and server compile state before retrying; no automatic retry was made'}));
  process.exitCode = 1;
});
