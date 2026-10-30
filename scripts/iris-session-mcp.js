#!/usr/bin/env node
'use strict';
const readline = require('node:readline');
const {createClient} = require('./lib/iris-session-client');
async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i=0;i<args.length;i+=2) {
    const key = {'--project-root':'projectRoot','--server-name':'serverName'}[args[i]];
    if (!key || !args[i+1]) throw new Error('session-adapter-arguments-invalid'); options[key] = args[i+1];
  }
  if (!options.projectRoot) throw new Error('session-project-root-required');
  const clients = new Map();
  const client = createClient({...options, allowWrite: true,onNotification:value=>emit(value)});
  const lines = readline.createInterface({input: process.stdin});
  const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
  lines.on('line', line => {
    let message; try {message = JSON.parse(line);} catch {emit({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}); return;}
    if (message.method === 'notifications/cancelled') {clients.get(message.params?.requestId)?.abort(); return;}
    if (message.id === undefined) return;
    if (clients.has(message.id)) {emit({jsonrpc:'2.0',id:message.id,error:{code:-32600,message:'Duplicate request ID'}});return;}
    const controller = new AbortController(); clients.set(message.id, controller);
    (async () => {
      if (message.method === 'ping') return {result:{}};
      if (message.method === 'tools/call' && !require('./iris-mcp').isClassifiedTool(message.params?.name)) throw new Error('session-unclassified-tool-blocked');
      return client.request(message.method, message.params || {}, 60000, controller.signal);
    })().then(response => {
      emit({jsonrpc:'2.0', ...response, id:message.id, ...(controller.signal.aborted ? {error:{code:-32800,message:'Cancelled; execution outcome requires verification'},result:undefined} : {})});
    }, error => emit({jsonrpc:'2.0',id:message.id,error:{code:-32000,
      message:/^[a-z0-9-]+$/.test(error.code || error.message || '') ? error.code || error.message : 'session-operation-failed',
      data:{beforeSend:error.beforeSend===true}}})).finally(() => clients.delete(message.id));
  });
  lines.on('close', () => {for (const controller of clients.values()) controller.abort(); client.close();});
}
if (require.main === module) main().catch(() => {process.stderr.write('session-adapter-start-failed\n');process.exitCode=1;});
module.exports = {main};
