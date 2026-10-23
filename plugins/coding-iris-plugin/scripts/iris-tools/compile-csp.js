#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const {performance} = require('node:perf_hooks');
const {resolveWorkspaceContext, workspaceContextBlockers} = require('../../../../scripts/lib/workspace-context');

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
  require('./project-env').validateTarget(config, env);
  const tls = String(env.IRIS_TLS_VERIFY ?? true).toLowerCase();
  if (!['true', 'false'].includes(tls)) throw new Error('Invalid IRIS_TLS_VERIFY');
  return {protocol: env.IRIS_SCHEME + ':', hostname: env.IRIS_HOST, port,
    path: '/api/atelier/v1/' + encodeURIComponent(env.IRIS_NAMESPACE) + '/action/compile?flags=cuk&source=0',
    rejectUnauthorized: tls !== 'false', auth: env.IRIS_USERNAME + ':' + env.IRIS_PASSWORD};
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
async function compile(options, deployment, timeoutMs = 60000, remoteOptions = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error('Invalid timeout');
  if (remoteOptions.context && require('./source-publication').required(remoteOptions.context, {}, {kind: remoteOptions.kind}) &&
      (!remoteOptions.client || remoteOptions.reviewedDeployment !== true)) {
    throw Object.assign(new Error('Use reviewed deploy-frontend for on-demand CSP compilation'), {code: 'on-demand-managed-compile-required'});
  }
  const start = performance.now();
  const client = remoteOptions.client || require('../../../../scripts/lib/atelier-client').createAtelierClient({
    connection: options, context: remoteOptions.context, policy: remoteOptions.policy, owner: remoteOptions.owner, timeoutMs, maxResponseBytes: 4 * 1024 * 1024
  });
  try {
    const result = validateResponse(await client.compile(deployment.documents));
    return {...deployment, ...result, elapsedMs: Math.round(performance.now() - start)};
  } finally {
    if (!remoteOptions.client) {
      const exit = await client.close();
      if (!exit.cleanupVerified) throw new Error('remote-session-exit-unverified');
    }
  }
}
function args(argv) {
  const result = {projectRoot: process.cwd(), documents: [], execute: false, timeoutMs: 60000};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--execute') result.execute = true;
    else if (argv[i] === '--project-root') result.projectRoot = required(argv[++i], '--project-root');
    else if (argv[i] === '--kind') result.kind = required(argv[++i], '--kind');
    else if (argv[i] === '--timeout-ms') result.timeoutMs = Number(argv[++i]);
    else if (argv[i] === '--documents') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) result.documents.push(argv[++i]);
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (result.kind !== undefined && !['standard', 'project'].includes(result.kind)) throw Object.assign(new Error('explicit-demand-kind-required'), {code: 'explicit-demand-kind-required'});
  return result;
}
async function main(argv) {
  if (argv.includes('--help')) {
    console.log('Usage: node compile-csp.js --project-root <project> --documents <virtual.csp...> [--execute] [--kind standard|project] [--timeout-ms 60000]\nDefault: local plan only. Confirmed project demands in on-demand mode compile through reviewed deploy-frontend. Standard demands retain explicit --execute compilation and shared License admission. Explicit --kind overrides the project default; unknown on-demand demand kind stops before connecting. No automatic retries or parent-page expansion.');
    return;
  }
  const parsed = args(argv);
  const context = resolveWorkspaceContext(parsed.projectRoot);
  if (workspaceContextBlockers(context).length) {
    const error = new Error('Invalid workspace context');
    error.code = 'invalid-workspace-context';
    throw error;
  }
  if (parsed.execute && context.manifest?.nightRunReference) throw Object.assign(new Error('Use bound deploy-frontend --files for night CSP compilation and receipt'), { code: 'night-managed-frontend-required' });
  if (parsed.execute && require('./source-publication').required(context, {}, {kind: parsed.kind})) {
    throw Object.assign(new Error('Use reviewed deploy-frontend for on-demand CSP compilation'), {code: 'on-demand-managed-compile-required'});
  }
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const {config, inherited} = require('./project-env').readProjectEnv(context);
  if (inherited) require('./project-env').validateTarget(config,
    read(path.join(context.workspaceRoot, '.mcp.json')).mcpServers?.[config.mcp?.serverName || 'iris-agentic-dev']?.env || {});
  const deployment = plan(parsed.documents, config.web?.cspBasePath);
  if (!parsed.execute) { console.log(JSON.stringify(deployment)); return; }
  const options = connection(config, read(path.join(context.workspaceRoot, '.mcp.json')));
  const result = await compile(options, deployment, parsed.timeoutMs, {context, kind: parsed.kind});
  // Do not emit credentials even if a server echoes connection text in a diagnostic.
  const output = JSON.stringify(result).split(options.auth).join('[redacted]').split(options.auth.slice(options.auth.indexOf(':') + 1)).join('[redacted]');
  console.log(output);
  if (result.status !== 'compiled') process.exitCode = 1;
}
module.exports = {plan, connection, compile, validateResponse, args, main};
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  if (['invalid-workspace-context', 'night-managed-frontend-required', 'on-demand-managed-compile-required', 'explicit-demand-kind-required', 'ambiguous-demand-kind'].includes(error.code)) {
    console.error(JSON.stringify({schema: 'iris-csp-compile/v1', status: 'blocked', reason: error.code}));
    process.exitCode = 1;
    return;
  }
  console.error(JSON.stringify({schema: 'iris-csp-compile/v1', status: 'failed-or-unknown', message: 'Check configuration, target names and server compile state before retrying; no automatic retry was made'}));
  process.exitCode = 1;
});
