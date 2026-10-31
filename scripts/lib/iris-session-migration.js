'use strict';
const fs = require('node:fs'), path = require('node:path'), {spawnSync} = require('node:child_process');
const {failure, hash} = require('./iris-session-manager');
const {managed} = require('./iris-session-client');
function read(file) {return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));}
function physical(file) {
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw failure('session-migration-linked-path');
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).nlink !== 1) throw failure('session-migration-hardlink');
}
function privateFile(root, file) {
  physical(file);
  const run = args => spawnSync('git', ['-C',root,...args], {windowsHide:true,encoding:'utf8'});
  if (run(['rev-parse','--show-toplevel']).status !== 0) throw failure('session-migration-git-root-required');
  const relative = path.relative(root,file);
  if (run(['ls-files','--error-unmatch','--',relative]).status === 0 || run(['check-ignore','--no-index','--quiet','--',relative]).status !== 0) throw failure('session-migration-private-file-not-ignored');
}
function write(file, value, before) {
  if (before !== undefined && fs.readFileSync(file,'utf8') !== before) throw failure('session-migration-concurrent-change');
  const bytes = JSON.stringify(value,null,2)+'\n';
  if (before === undefined) fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
  else {
    const temp = file+'.'+require('node:crypto').randomUUID()+'.tmp';
    try {fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600}); if (fs.readFileSync(file,'utf8') !== before) throw failure('session-migration-concurrent-change'); fs.renameSync(temp,file);}
    finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  if(fs.readFileSync(file,'utf8')!==bytes)throw failure('session-migration-readback-failed');
}
function assertInactive(context,server) {
  const policyFile=path.join(context.contextRoot,'config','iris-remote-policy.json');
  const policy=fs.existsSync(policyFile)?read(policyFile):null;
  const pool=policy?.allowSharedPool === true ? policy.poolKey : require('./iris-remote-operations').instanceIdentity(server.env || {});
  const state=path.join(require('./iris-session-ipc').location().root,'pools',hash(pool)+'.json');
  if(fs.existsSync(state)) {const p=read(state);if(p.active || p.inFlight || p.blocked)throw failure('session-migration-runtime-unresolved');}
  if(policy?.coordinationRoot && policy?.poolKey) {
    const remote=require('./iris-remote-operations');
    for(const effective of [policy,remote.managedPolicy(context,{...policy,enabled:true},true)]) {
      const p=remote.poolStatus({policy:{...effective,enabled:true}});
      if(p.ownerPresent || p.status!=='ready')throw failure('session-legacy-pool-unresolved');
    }
  }
}
function migrate({projectRoot, mode='DryRun', serverName}={}) {
  if(!['DryRun','Write','Check','Rollback'].includes(mode))throw failure('session-migration-mode-invalid');
  const context=require('./workspace-context').resolveWorkspaceContext(path.resolve(projectRoot));
  const environmentFile=path.join(context.contextRoot,'config','project-env.json');
  serverName ||= (fs.existsSync(environmentFile)?read(environmentFile).mcp?.serverName:null) || 'iris-agentic-dev';
  const configFile=path.join(context.workspaceRoot,'.mcp.json'), backendFile=path.join(context.contextRoot,'config','iris-session-backend.json');
  if(!fs.existsSync(configFile))return {status:'not-applicable',reason:'configuration-missing'};
  const configText=fs.readFileSync(configFile,'utf8'), config=JSON.parse(configText.replace(/^\uFEFF/,'')), server=config.mcpServers?.[serverName];
  if(!server) return {status:'not-applicable',reason:'server-missing'};
  const existing=fs.existsSync(backendFile)?read(backendFile):null;
  const args=[path.join(context.capabilityRoot,'scripts','iris-session-mcp.js'),'--project-root',context.workspaceRoot,'--server-name',serverName];
  const expected={command:process.execPath,args};
  if(mode==='Rollback') {
    if(!existing || hash({command:server.command,args:server.args})!==existing.managedHash)throw failure('session-rollback-drift');
    privateFile(context.workspaceRoot,configFile);
    assertInactive(context,server);
    server.command=existing.command;
    if(existing.originalArgsPresent)server.args=existing.args;else delete server.args;
    write(configFile,config,configText);
    return {status:'rolled-back',managed:false,backendRetained:true};
  }
  if(managed(server)) {
    if(!existing || existing.serverName!==serverName || hash({command:server.command,args:server.args})!==existing.managedHash)throw failure('session-managed-config-drift');
    if(!fs.existsSync(args[0]))throw failure('session-adapter-missing');
    if(!fs.existsSync(path.resolve(context.workspaceRoot,existing.command)))throw failure('session-backend-missing');
    if(mode==='Check')require('./iris-session-backends').verifyVendor(path.resolve(context.workspaceRoot,existing.command));
    if(hash({command:server.command,args:server.args})!==hash(expected))throw failure('session-managed-config-drift');
    return {status:'unchanged',managed:true,restartRequired:true};
  }
  if(mode==='Check')throw failure('session-direct-entry-detected');
  if(server.env?.IRIS_TOOLSET && server.env.IRIS_TOOLSET!=='merged')throw failure('session-toolset-review-required');
  if(!/(?:^|[\\/])iris-agentic-dev(?:\.exe)?$/i.test(server.command || ''))throw failure('session-custom-command-review-required');
  const executable=path.resolve(context.workspaceRoot,server.command);
  if(!fs.existsSync(executable))throw failure('session-backend-missing');
  // Overlay vendor mappings are intentional links into the declared CapabilityRoot.
  // Compare physical targets, while retaining the original command for rollback.
  const commandRelative=path.relative(fs.realpathSync(context.capabilityRoot),fs.realpathSync(executable)).replace(/\\/g,'/');
  if(!/^vendor\/iris-agentic-dev\/[^/]+\/iris-agentic-dev(?:\.exe)?$/.test(commandRelative))throw failure('session-custom-command-review-required');
  const oldArgs=server.args || ['mcp'];
  if(oldArgs[0]!=='mcp')throw failure('session-custom-args-review-required');
  const valueFlags=new Set(['--host','--web-port','--scheme','--namespace','--web-prefix','--config','--workspace']);
  for(let i=1;i<oldArgs.length;i++) {
    if(oldArgs[i]==='--no-skills')continue;
    const flag=oldArgs[i];
    if(!valueFlags.has(flag) || typeof oldArgs[++i]!=='string')throw failure('session-custom-args-review-required');
    const envKey={'--host':'IRIS_HOST','--web-port':'IRIS_WEB_PORT','--scheme':'IRIS_SCHEME','--namespace':'IRIS_NAMESPACE'}[flag];
    if(envKey && String(server.env?.[envKey])!==oldArgs[i])throw failure('session-target-config-conflict');
  }
  const policyFile=path.join(context.contextRoot,'config','iris-remote-policy.json');
  const generatedPolicy=!fs.existsSync(policyFile)?{schema:'iris-remote-policy/v1',enabled:true,admissionMode:'managed-single-session',
    poolKey:require('./iris-remote-operations').instanceIdentity(server.env || {}),
    coordinationRoot:path.join(require('./iris-session-ipc').location().root,'admission'),maxConcurrent:1,qualification:{status:'pending'}}:null;
  assertInactive(context,server);
  privateFile(context.workspaceRoot,configFile); privateFile(context.workspaceRoot,backendFile);
  if(generatedPolicy)privateFile(context.workspaceRoot,policyFile);
  const capabilityRelative=path.relative(context.capabilityRoot,backendFile);
  if(!capabilityRelative.startsWith('..'+path.sep) && !path.isAbsolute(capabilityRelative)) {
    privateFile(context.capabilityRoot,backendFile);if(generatedPolicy)privateFile(context.capabilityRoot,policyFile);
  }
  const backend={schema:'iris-session-backend/v1',serverName,command:server.command,args:oldArgs,originalArgsPresent:Object.hasOwn(server,'args'),managedHash:hash(expected)};
  if(existing && JSON.stringify(existing)!==JSON.stringify(backend))throw failure('session-backend-config-conflict');
  if(mode==='Write') {
    if(!fs.existsSync(args[0]))throw failure('session-adapter-missing');
    fs.mkdirSync(path.dirname(backendFile),{recursive:true});
    if(!existing)write(backendFile,backend);
    if(generatedPolicy)write(policyFile,generatedPolicy);
    Object.assign(server,expected);write(configFile,config,configText);
  }
  return {status:mode==='Write'?'applied':'planned',managed:mode==='Write',restartRequired:true};
}
function preserveManaged({context,config}) {
  const file=path.join(context.workspaceRoot,'.mcp.json');
  const undo=[];
  if(!fs.existsSync(file))return undo;
  const existing=read(file);
  const generated=config.mcpServers || {};
  config.mcpServers={...existing.mcpServers,...generated};
  for(const [name,current] of Object.entries(existing.mcpServers || {})) {
    if(!managed(current))continue;
    const replacement=generated[name];
    if(!replacement)throw failure('session-generator-server-rename-review-required');
    const backendFile=path.join(context.contextRoot,'config','iris-session-backend.json');
    privateFile(context.workspaceRoot,backendFile);
    const before=fs.readFileSync(backendFile,'utf8'),backend=JSON.parse(before);
    if(backend.serverName!==name || backend.managedHash!==hash({command:current.command,args:current.args}))throw failure('session-managed-config-drift');
    const next={...backend,command:replacement.command,args:replacement.args,originalArgsPresent:true};
    if(JSON.stringify(next)!==JSON.stringify(backend)) {
      assertInactive(context,current);
      write(backendFile,next,before);
      const after=fs.readFileSync(backendFile,'utf8');
      undo.push(()=>write(backendFile,JSON.parse(before),after));
    }
    config.mcpServers[name]={...current,...replacement,command:current.command,args:current.args,
      env:{...current.env,...replacement.env},...(Object.hasOwn(current,'disabled')?{disabled:current.disabled}:{})};
  }
  return undo;
}
function writeGenerated({context,config}) {
  const file=path.join(context.workspaceRoot,'.mcp.json');
  const before=fs.existsSync(file)?fs.readFileSync(file,'utf8'):undefined;
  const undo=preserveManaged({context,config});
  try {write(file,config,before);}
  catch(error) {for(const restore of undo.reverse())restore();throw error;}
}
module.exports={migrate,preserveManaged,writeGenerated};
