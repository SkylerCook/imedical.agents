'use strict';
const fs = require('node:fs'), path = require('node:path');
const ipc = require('./iris-session-ipc');
const {failure} = require('./iris-session-manager');
function catalog(full=false) {return JSON.parse(fs.readFileSync(path.join(__dirname, '../../vendor/iris-agentic-dev',full?'tools-full.json':'tools-no-skills.json'), 'utf8')).tools;}
function managed(server) {return Array.isArray(server?.args) && server.args.some(arg => typeof arg === 'string' && /(?:^|[\\/])iris-session-mcp\.js$/.test(arg));}
function createClient({projectRoot, serverName = 'iris-agentic-dev', root, allowWrite = false, onNotification} = {}) {
  let connection, connecting, closed = false, lastRoute = null;
  const get = async () => {
    if (closed) throw failure('session-client-closed');
    if (!connection || connection.socket.destroyed) {
      connecting ||= ipc.connect({root});
      try {connection = await connecting;connection.onNotification=onNotification;} finally {connecting = null;}
    }
    if (closed) {connection.close();throw failure('session-client-closed');}
    return connection;
  };
  return {
    async request(method, params, timeoutMs = 60000, signal) {
      if (method === 'initialize') return {result: {protocolVersion: params.protocolVersion, capabilities: {tools: {}}, serverInfo: {name: 'imedical-iris-managed', version: '1.0.0'}}};
      if (method === 'tools/list') {
        const configuration=JSON.parse(fs.readFileSync(path.join(projectRoot,'.mcp.json'),'utf8').replace(/^\uFEFF/,''));
        const server=configuration.mcpServers?.[serverName];
        let args=server?.args || [];
        if(managed(server)) {
          const context=require('./workspace-context').resolveWorkspaceContext(projectRoot);
          args=JSON.parse(fs.readFileSync(path.join(context.contextRoot,'config','iris-session-backend.json'),'utf8')).args;
        }
        const noSkills=args.includes('--no-skills') || ['true','1'].includes(String(server?.env?.IRIS_NO_SKILLS).toLowerCase());
        return {result: {tools: catalog(!noSkills)}};
      }
      if (method !== 'tools/call') throw failure('session-mcp-method-unsupported');
      const response=await (await get()).request('call', {projectRoot, serverName, method, params, allowWrite, timeoutMs}, timeoutMs + 65000, signal);
      lastRoute=response.result?._meta?.['imedical/session'] || null;
      return response;
    },
    notify() {},
    snapshot(){return lastRoute;},
    async close() {closed = true; connection?.close(); connection = null; return {processExited: false, sessionRetained: true, clientReleased:true, cleanupVerified: true};},
    async endSession() {return (await get()).request('close', {projectRoot, serverName});}
    ,async markUnknown() {return (await get()).request('markUnknown',{projectRoot,serverName});}
  };
}
function createAtelierTransport({context, connection, root}) {
  let client;
  const get = async () => client ||= await ipc.connect({root});
  return {
    async request(args) {
      const d = require('./iris-session-backends').describe(context.workspaceRoot);
      if (connection.hostname !== d.connection.hostname || connection.port !== d.connection.port || connection.protocol !== d.connection.protocol ||
          connection.rejectUnauthorized !== d.connection.rejectUnauthorized) throw failure('session-atelier-target-mismatch');
      return (await get()).request('call', {projectRoot:context.workspaceRoot, channel:'atelier', connection, args});
    },
    async close() {
      if (!client) return {cleanupVerified:true,noRemoteRequests:true,licenseReleaseVerified:false};
      try {const result = await client.request('close',{projectRoot:context.workspaceRoot});return {...result.exit,sessionRetained:result.active};}
      finally {client.close();client=null;}
    }
  };
}
module.exports = {catalog, managed, createClient, createAtelierTransport};
