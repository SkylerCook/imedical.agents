#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const remote = require('./lib/iris-remote-operations');
const risk = require('./lib/iris-operation-scope');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function offlineSession(file, pool) {
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  const state={...saved, pool, hostRunning:false, running:false, queued:0, leased:false,
    blocked:saved.blocked || (saved.active ? 'session-exit-unverified' : null)};
  return {...state,...risk.statusDetails(state)};
}
function evidenceTarget(context, input) {
  if (!path.isAbsolute(input || '')) throw new remote.RemoteOperationError('remote-inspection-evidence-required');
  const root = path.resolve(context.contextRoot, 'work/source-sync'), target = path.resolve(input), relative = path.relative(root, target);
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new remote.RemoteOperationError('remote-inspection-evidence-outside-private-root');
  let cursor = path.parse(target).root;
  for (const part of target.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new remote.RemoteOperationError('remote-inspection-evidence-linked');
  }
  if (fs.existsSync(target)) throw new remote.RemoteOperationError('remote-inspection-evidence-exists');
  for (const gitRoot of new Set([...(context.gitRoots || []), context.capabilityRoot].filter(Boolean))) {
    const local = path.relative(gitRoot, target);
    if (local.startsWith('..' + path.sep) || path.isAbsolute(local)) continue;
    const options = {cwd:gitRoot, encoding:'utf8', windowsHide:true};
    if (spawnSync('git', ['rev-parse','--show-toplevel'], options).status !== 0) continue;
    if (spawnSync('git', ['check-ignore','--no-index','--quiet','--',local], options).status !== 0 ||
        spawnSync('git', ['ls-files','--error-unmatch','--',local], options).status === 0) throw new remote.RemoteOperationError('remote-inspection-evidence-not-private');
  }
  fs.mkdirSync(path.dirname(target), {recursive:true,mode:0o700});
  return target;
}
async function inspectDocuments({context, connection, policy, documents, token, confirmRecovery, evidenceFile}) {
  const reader = require('./lib/atelier-client').createAtelierRecoveryReader({context,connection,policy,documents,token,confirmRecovery});
  const target = evidenceTarget(context, evidenceFile);
  const evidence = {schema:'iris-remote-inspection-evidence/v1',status:'inspection-started',startedAt:new Date().toISOString(),originalToken:token,requestedDocuments:[...documents],documents:[]};
  fs.writeFileSync(target, JSON.stringify(evidence) + '\n', {flag:'wx',mode:0o600});
  const persist = () => {
    const temporary = target + '.' + crypto.randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(evidence,null,2) + '\n', {flag:'wx',mode:0o600}); fs.renameSync(temporary,target); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  };
  try {
    for (const name of documents) {
      const value = await reader.readDocument(name);
      evidence.documents.push(value ? {document:name,found:true,sha256:value.sha256,ts:value.ts,db:value.db,representation:value.representation,contentEncoding:'base64',content:value.content.toString('base64')} : {document:name,found:false});
      persist();
    }
  } catch (error) { evidence.reason = error.code || 'remote-inspection-failed'; if (error.status) evidence.httpStatus = error.status; }
  finally {
    try { evidence.remote = await reader.close(); }
    catch (error) { evidence.reason ||= error.code || 'remote-inspection-close-failed'; evidence.remote = {cleanupVerified:false,writeEnabled:false,licenseReleaseVerified:false}; }
    evidence.completedAt = new Date().toISOString();
    evidence.status = !evidence.reason && evidence.remote.status === 'inspected' && evidence.remote.cleanupVerified ? 'inspected' : 'inspection-incomplete';
    persist();
  }
  return {schema:'iris-remote-inspection/v1',status:evidence.status,reason:evidence.reason || null,evidenceFile:target,evidenceSha256:hash(fs.readFileSync(target)),
    documents:evidence.documents.map(({content,...summary})=>summary),remote:evidence.remote,writeEnabled:false,licenseReleaseVerified:false};
}
async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) { console.log('Usage: node iris-remote.js status|sessions|close-sessions|reconcile-session|reconcile --project-root <workspace> [--token <status-token> --evidence <absolute-file> --write-outcome verified-applied|verified-not-applied --write-id <unresolved-id> --confirm]\n       node iris-remote.js inspect|read --project-root <workspace> --token <status-token> --confirm-recovery --documents <1-to-5-documents...> --evidence <new-absolute-private-file>\nstatus/reconcile are local only. inspect performs only admitted GET doc reads and its own HEAD logout, saves private evidence under ContextRoot/work/source-sync, and keeps the circuit blocked. No write replay or license reservation.'); return; }
  const command = argv.shift(), args = {};
  for (let i=0;i<argv.length;i++) {
    if (argv[i] === '--write-id' && argv[i+1]) (args.writeIds ||= []).push(argv[++i]);
    else if (argv[i] === '--confirm') args.confirm = true;
    else if (argv[i] === '--confirm-recovery') args.confirmRecovery = true;
    else if (argv[i] === '--documents') { args.documents = []; while (argv[i+1] && !argv[i+1].startsWith('--')) args.documents.push(argv[++i]); }
    else if (['--project-root','--token','--evidence','--write-outcome'].includes(argv[i]) && argv[i+1]) args[argv[i].slice(2)] = argv[++i];
    else throw new Error('remote-status-argument-invalid');
  }
  if (!['status','sessions','close-sessions','reconcile-session','reconcile','inspect','read'].includes(command) || !args['project-root']) throw new Error('remote-status-command-required');
  const context = require('./lib/workspace-context').resolveWorkspaceContext(args['project-root']);
  if(command==='status') {
    const admission=remote.localPoolStatus(context);
    const backendFile=path.join(context.contextRoot,'config','iris-session-backend.json');
    if (!fs.existsSync(backendFile)) {console.log(JSON.stringify({...risk.statusDetails(admission), ...admission}));return;}
    const ipc=require('./lib/iris-session-ipc');
    const description=require('./lib/iris-session-backends').describe(context.workspaceRoot,undefined,{localOnly:true});
    const poolId=require('./lib/iris-session-manager').hash(description.pool);
    let client, session=null;
    try {
      client=await ipc.connect({start:false});
      session=(await client.request('status',{})).pools.find(pool=>pool.pool===poolId) || null;
    } catch(error) {
      if (!['ENOENT','ECONNREFUSED'].includes(error.code)) throw error;
      const file=path.join(ipc.location().root,'pools',poolId+'.json');
      if (fs.existsSync(file)) session=offlineSession(file,poolId);
    } finally {client?.close();}
    const sessionBlocked=!!session?.blocked || !!session?.unresolvedWrites?.length;
    const details = risk.statusDetails({...admission, ...session, ownerPresent:admission.ownerPresent, ownerAlive:admission.ownerAlive,
      localExitUnverified:admission.localExitUnverified, retryAfter:Math.max(admission.retryAfter || 0,session?.retryAfter || 0),
      unresolvedWrites:[...(admission.unresolvedWrites || []), ...(session?.unresolvedWrites || [])]});
    console.log(JSON.stringify({...admission, ...details, blockingReasons:[...(admission.blockingReasons || []), ...(session?.blockingReasons || [])], status:sessionBlocked?'reconciliation-required':admission.status,
      admission,session,poolId,maxFrameworkSessions:remote.frameworkSessionLimit(description.policy),
      ...(sessionBlocked?{recoveryCommand:'reconcile-session'}:{})}));
    return;
  }
  if(command==='reconcile') {
    const policy=remote.localPolicy(context);
    console.log(JSON.stringify(remote.reconcileRemotePool({policy,token:args.token,evidenceFile:args.evidence,confirm:args.confirm,writeOutcome:args['write-outcome'],writeIds:args.writeIds})));return;
  }
  if(['sessions','close-sessions','reconcile-session'].includes(command)) {
    const ipc=require('./lib/iris-session-ipc');let client;
    try {
      client=await ipc.connect({start:command==='reconcile-session'});
      let params={projectRoot:context.workspaceRoot};
      if(command==='reconcile-session') {
        if(!args.confirm)throw new remote.RemoteOperationError('session-reconciliation-confirmation-required');
        const description=require('./lib/iris-session-backends').describe(context.workspaceRoot,undefined,{localOnly:true});
        const poolId=require('./lib/iris-session-manager').hash(description.pool);
        const status=await client.request('status',{});
        let selected=status.pools.find(pool=>pool.pool===poolId);
        if(!selected)throw new remote.RemoteOperationError('session-reconciliation-pool-not-found');
        let evidence;
        if(args.evidence !== undefined) {
          if(!path.isAbsolute(args.evidence || ''))throw new remote.RemoteOperationError('session-reconciliation-evidence-path-required');
          try {
            const bytes=fs.readFileSync(args.evidence);
            const parsed=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
            evidence={cleanupVerified:parsed.cleanupVerified===true,processExited:parsed.processExited===true,localResourcesClosed:parsed.localResourcesClosed===true,reference:hash(bytes)};
          } catch {throw new remote.RemoteOperationError('session-reconciliation-evidence-invalid');}
        }
        if(args.token && args.token !== selected.reconciliationToken)throw new remote.RemoteOperationError('session-reconciliation-token-stale');
        if(selected.running || selected.queued || selected.leased)throw new remote.RemoteOperationError('session-pool-busy');
        if(selected.active) selected=await client.request('close',{...params,token:selected.reconciliationToken});
        const token=selected.reconciliationToken;
        const policy=remote.localPolicy(context), prior=remote.poolStatus({policy});
        if(prior.ownerPresent)throw new Error('session-reconcile-admission-first');
        params={...params,token,confirm:true,writeOutcome:args['write-outcome'],writeIds:args.writeIds,evidence};
      }
      console.log(JSON.stringify(await client.request(command==='sessions'?'status':command==='close-sessions'?'close':'reconcile',params)));
    } catch(error) {
      if(command==='sessions' && ['ENOENT','ECONNREFUSED'].includes(error.code)) {
        const directory=path.join(ipc.location().root,'pools');
        const pools=fs.existsSync(directory)?fs.readdirSync(directory).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>offlineSession(path.join(directory,n),n.slice(0,-5))):[];
        console.log(JSON.stringify({status:'not-running',pools,cleanupVerified:false}));
      } else throw error;
    } finally {client?.close();}return;
  }
  remote.assertRemoteAllowed(context);
  const mcp = JSON.parse(fs.readFileSync(path.join(context.workspaceRoot,'.mcp.json'),'utf8').replace(/^\uFEFF/,''));
  const {readProjectEnv,validateTarget} = require('../plugins/coding-iris-plugin/scripts/iris-tools/project-env');
  const config = readProjectEnv(context, {optional: !['inspect','read'].includes(command)}).config;
  const env = mcp.mcpServers?.[config.mcp?.serverName || 'iris-agentic-dev']?.env || {};
  validateTarget(config,env);
  let result;
  if (['inspect','read'].includes(command)) {
    if (require('./lib/workspace-context').workspaceContextBlockers(context).length) throw new remote.RemoteOperationError('invalid-workspace-context');
    const connection = require('../plugins/coding-iris-plugin/scripts/iris-tools/compile-csp').connection(config,mcp);
    const policy = remote.loadRemotePolicy(context, {connection, recoveryRead:true});
    result = await inspectDocuments({context,connection,policy,documents:args.documents,token:args.token,confirmRecovery:args.confirmRecovery,evidenceFile:args.evidence});
    if (result.status !== 'inspected') process.exitCode = 2;
  } else {
    const policy = remote.loadRemotePolicy(context, {connection:env});
    result = command === 'status' ? remote.poolStatus({policy}) : remote.reconcileRemotePool({policy, token:args.token, evidenceFile:args.evidence, confirm:args.confirm, writeOutcome:args['write-outcome']});
  }
  console.log(JSON.stringify(result));
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({schema:'iris-remote-inspection/v1',status:'blocked',reason:error.code || (/^[a-z][a-z0-9-]{0,99}$/.test(error.message || '') ? error.message : 'remote-coordination-invalid'),diagnostic:{type:error.name || 'Error',...(typeof error.syscall==='string'?{syscall:error.syscall}:{})}})); process.exitCode=1; });
module.exports = {main,inspectDocuments};
