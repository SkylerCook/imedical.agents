'use strict';
const fs = require('node:fs');
const path = require('node:path');
const remote = require('./iris-remote-operations');
const {hash, failure} = require('./iris-session-manager');
const mcp = require('../iris-mcp');
const verifiedBinaries=new Map();

function verifyVendor(executable) {
  executable=fs.realpathSync(executable);
  const stat=fs.statSync(executable),metadata=path.join(path.dirname(executable),'..','managed-build.json');
  if(!fs.existsSync(metadata))throw failure('session-patched-vendor-required');
  const build=JSON.parse(fs.readFileSync(metadata,'utf8').replace(/^\uFEFF/,''));
  if(build.schema!=='iris-managed-vendor/v1' || build.patch!=='managed-sessions-v2')throw failure('session-patched-vendor-mismatch');
  const fingerprint=hash([executable,stat.size,stat.mtimeMs,build.sha256]);
  if(!verifiedBinaries.has(fingerprint)) {
    const actual=require('node:crypto').createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
    if(actual!==build.sha256)throw failure('session-patched-vendor-mismatch');
    verifiedBinaries.set(fingerprint,true);
  }
  return build;
}

function describe(projectRoot, serverName, {localOnly=false} = {}) {
  const context = require('./workspace-context').resolveWorkspaceContext(path.resolve(projectRoot));
  const localEnv=path.join(context.contextRoot,'config','project-env.json');
  serverName ||= (fs.existsSync(localEnv)?JSON.parse(fs.readFileSync(localEnv,'utf8').replace(/^\uFEFF/,'')).mcp?.serverName:null) || 'iris-agentic-dev';
  if(!localOnly)remote.assertRemoteAllowed(context);
  const config = JSON.parse(fs.readFileSync(path.join(context.workspaceRoot, '.mcp.json'), 'utf8').replace(/^\uFEFF/, ''));
  const server = config.mcpServers?.[serverName];
  if (!server || !localOnly && server.disabled === true) throw failure('session-server-disabled-or-missing');
  const env = server.env || {};
  if(env.IRIS_TOOLSET && env.IRIS_TOOLSET!=='merged')throw failure('session-toolset-review-required');
  if (!env.IRIS_HOST || !env.IRIS_NAMESPACE || !env.IRIS_WEB_PORT) throw failure('session-target-incomplete');
  const connection = {protocol: (env.IRIS_SCHEME || 'https') + ':', hostname: env.IRIS_HOST, port: Number(env.IRIS_WEB_PORT),
    namespace: env.IRIS_NAMESPACE, username: env.IRIS_USERNAME, password: env.IRIS_PASSWORD,
    rejectUnauthorized: String(env.IRIS_TLS_VERIFY ?? 'true').toLowerCase() !== 'false'};
  const instance = remote.instanceIdentity(connection);
  const policyFile = path.join(context.contextRoot, 'config', 'iris-remote-policy.json');
  let policy;
  if (fs.existsSync(policyFile)) {
    policy = JSON.parse(fs.readFileSync(policyFile, 'utf8').replace(/^\uFEFF/, ''));
    if (!localOnly && policy.enabled !== true) throw failure('session-policy-explicitly-disabled');
    if (policy.schema !== 'iris-remote-policy/v1') throw failure('session-policy-invalid');
    if(!require('node:path').isAbsolute(policy.coordinationRoot || '') || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(policy.poolKey || '') || policy.maxConcurrent!==undefined && policy.maxConcurrent!==1)throw failure('session-policy-invalid');
    if (!localOnly && policy.coordinationRoot && policy.poolKey) {
      const status = remote.poolStatus({policy});
      if (status.status !== 'ready') throw failure('session-legacy-pool-unresolved');
    }
    policy=remote.managedPolicy(context,policy,true);
  }
  if (!localOnly) remote.sessionCookieFormat(policy, connection);
  const backendFile = path.join(context.contextRoot, 'config', 'iris-session-backend.json');
  let backend;
  if (fs.existsSync(backendFile)) backend = JSON.parse(fs.readFileSync(backendFile, 'utf8'));
  if (!backend && /(?:^|[\\/])iris-agentic-dev(?:\.exe)?$/i.test(server.command || '')) {
    backend = {schema: 'iris-session-backend/v1', serverName, command: server.command,
      args: server.args || ['mcp']};
  }
  if (!backend || backend.schema !== 'iris-session-backend/v1' || backend.serverName !== serverName) throw failure('session-managed-entry-required');
  if (!backend.command || !Array.isArray(backend.args)) throw failure('session-backend-invalid');
  const executable=fs.realpathSync(path.resolve(context.workspaceRoot,backend.command)),stat=fs.statSync(executable);
  let runtimeIdentity=[executable,stat.size,stat.mtimeMs];
  if(!localOnly && /(?:^|[\\/])iris-agentic-dev(?:\.exe)?$/i.test(executable)) {
    const build=verifyVendor(executable);
    runtimeIdentity=['managed-vendor',build.sha256];
  }
  backend={...backend,command:executable};
  const effectiveArgs=[];
  for(let i=0;i<backend.args.length;i++) {
    const flag=backend.args[i];
    if(flag==='--config') {const configPath=path.resolve(context.workspaceRoot,backend.args[++i]);effectiveArgs.push(flag,hash(fs.readFileSync(configPath,'utf8')));}
    else if(flag==='--workspace') {i++;}
    else effectiveArgs.push(flag);
  }
  // Credentials are resolved here, in the user's process, never sent in CLI arguments or receipts.
  return {context, connection, env, backend, policy, pool: policy?.allowSharedPool === true ? policy.poolKey : instance,
    identity: hash([instance, Object.fromEntries(Object.entries(env).sort(([a],[b])=>a.localeCompare(b))), connection.rejectUnauthorized, runtimeIdentity, effectiveArgs, env.IRIS_NAMESPACE, policy?.sessionCookieFormat ?? 'opaque'])};
}
async function open(operation) {
  const d = describe(operation.projectRoot, operation.serverName);
  if (d.identity !== (operation.configurationIdentity || operation.identity) || d.pool !== operation.pool) throw failure('session-configuration-changed');
  const owner = d.policy?.coordinationRoot && d.policy?.poolKey
    ? remote.createRemoteOperation({policy:d.policy,connection:d.connection,channel:operation.channel}) : null;
  try {owner?.acquire();} catch(error) {error.beforeSend=true;throw error;}
  if (operation.channel === 'atelier') {
    const client = require('./atelier-client').createAtelierClient({connection: operation.connection, context: d.context, managedHost:true,owner:owner || undefined,sessionCookieFormat:d.policy?.sessionCookieFormat});
    return {call: op => {if(describe(op.projectRoot,op.serverName).identity!==d.identity)throw failure('session-configuration-changed');return client.request(...op.args);}, close: async () => {const exit=await client.close();return owner?owner.close(exit):exit;}};
  }
  const inherited=Object.fromEntries(Object.keys(process.env).filter(key=>key.startsWith('IRIS_')).map(key=>[key,undefined]));
  const client = new mcp.JsonLineMcpClient(d.backend.command, d.backend.args, {...inherited,...d.env, IRIS_MANAGED_NO_RETRIES:'1', IRIS_SESSION_COOKIE_FORMAT:d.policy?.sessionCookieFormat ?? 'opaque'}, {cwd: d.context.workspaceRoot});
  const assertSession = () => {
    const stopped=client.stderr.match(/IMEDICAL_HTTP_STOP=(401|403|503)/);
    if(stopped)throw Object.assign(failure(stopped[1]==='503'?'session-service-unavailable':'session-authentication-failed',false),{status:Number(stopped[1])});
    if (client.stderr.includes('IMEDICAL_SESSION_STOP=identity-unverified')) throw Object.assign(failure('session-identity-unverified',false),{sessionUncertain:true,writeOutcome:'unknown'});
  };
  try {
    await client.request('initialize', {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'imedical-session-manager', version: '1.0.0'}});
    client.notify('notifications/initialized', {});
    const check = mcp.extractToolText(await client.request('tools/call', {name: 'check_config', arguments: {}}));
    assertSession();
    if (check.connected !== true || String(check.host).toLowerCase() !== d.connection.hostname.toLowerCase() || Number(check.port) !== d.connection.port || check.namespace !== d.env.IRIS_NAMESPACE) throw failure('session-backend-target-mismatch');
  } catch(e) {const exit=await client.close(); owner?.close({cleanupVerified:exit.processExited && exit.gracefulExit && exit.logout?.completed===true && exit.logout.attempted===exit.logout.acknowledged && !client.stderr.includes('IMEDICAL_SESSION_STOP=')}); throw e;}
  return {
    async call(op) {
      // Re-read local authorization/configuration at dispatch, including queued requests.
      const current = describe(op.projectRoot, op.serverName);
      if (current.identity !== d.identity) throw failure('session-configuration-changed');
      const params = structuredClone(op.params);
      if(params.name==='iris_symbols_local') {
        params.arguments ||= {};
        params.arguments.workspace_path=path.resolve(current.context.workspaceRoot,params.arguments.workspace_path || '.');
      }
      if(params.name==='kb' && params.arguments?.path)params.arguments.path=path.resolve(current.context.workspaceRoot,params.arguments.path);
      if (params.arguments?.namespace && params.arguments.namespace !== d.env.IRIS_NAMESPACE) throw failure('session-namespace-mismatch');
      const execute = async () => {
      assertSession();
      const result = await client.request(op.method, params, op.timeoutMs || 60000);
      assertSession();
      if (result.error || result.result?.isError) {
        const unavailable = /(?:HTTP\s*503|503\s+Service Unavailable|"(?:httpStatus|statusCode)"\s*:\s*503)/i.test(JSON.stringify(result));
        if (unavailable) throw Object.assign(failure('session-service-unavailable', false), {status: 503});
        if (/(?:HTTP\s*(401|403)|401\s+Unauthorized|403\s+Forbidden)/i.test(JSON.stringify(result))) throw Object.assign(failure('session-authentication-failed',false),{status:401});
        if (op.effects === 'write') throw failure('session-write-outcome-unverified', false);
      }
      return result;
      };
      client.onNotification=op.notify;
      try {return await (owner ? owner.run({effects:op.effects,operation:'managed-mcp-call'},execute) : execute());}
      finally {client.onNotification=null;}
    },
    async close() {
      const receipt = await client.close();
      const logoutAcknowledged = receipt.logout?.completed === true && receipt.logout.attempted === receipt.logout.acknowledged && !client.stderr.includes('IMEDICAL_SESSION_STOP=');
      const exit = {...receipt, logoutAcknowledged, cleanupVerified: receipt.processExited && receipt.gracefulExit && logoutAcknowledged,
        serverSessionGoneVerified:false,licenseReleaseVerified: false};
      if(!exit.cleanupVerified)owner?.markUnknown('mcp-process-exit-unverified');
      return owner ? owner.close(exit) : exit;
    }
  };
}
function operation(params) {
  const d = describe(params.projectRoot, params.serverName);
  if (params.channel === 'atelier') {
    const c=params.connection, a=params.args;
    if (!c || c.hostname!==d.connection.hostname || c.port!==d.connection.port || c.protocol!==d.connection.protocol || c.rejectUnauthorized!==d.connection.rejectUnauthorized ||
      c.auth !== (d.connection.username ? d.connection.username+':'+(d.connection.password || '') : undefined) || !Array.isArray(a) || !['GET','HEAD','POST','PUT','DELETE'].includes(a[0])) throw failure('session-atelier-target-mismatch');
    const prefix='/api/atelier/v1/'+encodeURIComponent(d.env.IRIS_NAMESPACE)+'/';
    if(c.path!==prefix || typeof a[1]!=='string' || /(?:^|\/)\.\.(?:\/|$)|[\r\n#]/.test(a[1]) || a[1].startsWith('/') ||
      Object.keys(a[3] || {}).some(key=>['authorization','cookie','host'].includes(key.toLowerCase())))throw failure('session-atelier-path-not-admitted');
    return {...params,effects:['GET','HEAD'].includes(a[0]) || a[0]==='POST' && a[1]==='docs' ? 'read-only':'write',pool:d.pool,configurationIdentity:d.identity,identity:hash([d.identity,'atelier',c.path,c.ca])};
  }
  if (params.method !== 'tools/call' || typeof params.params?.name !== 'string') throw failure('session-operation-invalid');
  const name = params.params.name, args = params.params.arguments || {};
  if (['iris_add_server','iris_remove_server','iris_import_servers','compare_document','compare_namespace','iris_test_server'].includes(name) || args.server || args.server_name) throw failure('session-multi-target-not-admitted');
  const write = mcp.isWriteLike(name, args);
  if (write && params.allowWrite !== true) throw failure('session-write-authorization-required');
  return {...params, channel: 'mcp', effects: write ? 'write' : 'read-only', identity: d.identity, pool: d.pool};
}
module.exports = {describe, open, operation, verifyVendor};
