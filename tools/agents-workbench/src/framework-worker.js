'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parentPort, workerData } = require('node:worker_threads');
const deployment = require('../../../scripts/lib/plugin-deployment');
const { inspectFramework } = require('./project-context');

// Pilot execution tree verified at 3246ca4e7442c9e81977626c438922b757efbddb.
const runtimeTrees = ['scripts','plugins','vendor','hooks'];
// SHA-256 of git ls-tree -r -z <revision> -- scripts plugins vendor hooks.
const trustedTrees = new Set([
  'f0a05c1ee334f4f37fadaaeb313f9f9c67b93ee0f25938fd9b982a0ce155620c', // 3246ca4e
  '30b13b1d4a6e499cbc56e7da2355ff345ac269f74d8222a07b8d523e03ce9427', // b65675b6
]);
const sourceUrl = 'https://gitee.com/skyler-cook/imedical.agents.git';

function git(cap, args, input) {
  const result = spawnSync('git', ['--no-replace-objects','--no-optional-locks','-C',cap,...args], {
    input,env:{...process.env,GIT_ALLOW_PROTOCOL:'',GIT_NO_LAZY_FETCH:'1'},windowsHide:true, timeout:10000, maxBuffer:4*1024*1024
  });
  if (result.status !== 0) throw Error('git-unavailable');
  return result.stdout;
}

function blob(bytes) {
  return crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

function verifyRuntime(cap, revision, checkWorkingFiles = true) {
  const output = git(cap,['ls-tree','-r','-z',revision,'--',...runtimeTrees]);
  const deployed = output.toString('latin1').split('\0').filter(row => row.slice(row.indexOf('\t') + 1) !== 'scripts/install-agents.ps1');
  if (!trustedTrees.has(crypto.createHash('sha256').update(deployed.join('\0'),'latin1').digest('hex'))) throw Error('unknown-tree');
  const files = new Map();
  for (const item of output.toString().split('\0').filter(Boolean)) {
    const [header, name] = item.split('\t');
    files.set(name,header.split(' ')[2]);
  }
  function visit(rel) {
    const file = path.join(cap,rel);
    const st = fs.lstatSync(file);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(file)) visit(rel + '/' + name);
      return;
    }
    if (!st.isFile()) throw Error('runtime-modified');
    if (rel === 'scripts/install-agents.ps1') return; // Only the separately shipped installer runs.
    if (!files.has(rel)) {
      // The updater never starts the SFTP Python service. Its local bytecode cache is not an input.
      if (/^vendor\/sftp-server\/src\/__pycache__\/[\w.-]+\.pyc$/.test(rel)) return;
      if (/^scripts\/(check-frontend-encoding|convert-gb2312-upload)\.ps1$/.test(rel)) {
        const expected = "# coding-iris-plugin managed wrapper\n$canonical = Join-Path $PSScriptRoot '../plugins/coding-iris-plugin/" + rel + "'\n& $canonical @args\nexit $LASTEXITCODE";
        if (fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').trimEnd() === expected) return;
      }
      throw Error('runtime-modified');
    }
    const bytes = fs.readFileSync(file);
    const expected = files.get(rel);
    if (blob(bytes) === expected) return;
    if (bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes) ||
        blob(Buffer.from(bytes.toString('latin1').replace(/\r\n/g,'\n'),'latin1')) !== expected) throw Error('runtime-modified');
  }
  if (checkWorkingFiles) for (const dir of runtimeTrees) if (fs.existsSync(path.join(cap,dir))) visit(dir);
  for (const bootstrap of ['scripts/refresh-agents-sparse.js','scripts/lib/plugin-deployment.js']) {
    if (blob(git(cap,['cat-file','blob',revision + ':' + bootstrap])) !== files.get(bootstrap)) throw Error('unknown-bootstrap');
  }
}

function observe(root) {
  const state = inspectFramework(root);
  if (!['standard','no-framework'].includes(state.status)) return {...state,observedAt:new Date().toISOString()};
  const identity = [root];
  if (state.status === 'standard') identity.push(path.join(root,'.agents'),path.join(root,'.agents/.git'));
  if (state.status === 'standard') {
    const cap = path.join(root,'.agents');
    const profile = path.join(cap,'config/plugin_profile.md');
    const skills = path.join(cap,'skills');
    state.installed = {
      sparseRules: fs.existsSync(path.join(cap,'.git/info/sparse-checkout')),
      profile: fs.lstatSync(profile,{throwIfNoEntry:false})?.isFile() ?? false,
      skillEntries: fs.lstatSync(skills,{throwIfNoEntry:false})?.isDirectory() ? fs.readdirSync(skills).length : 0,
    };
  }
  const physical = identity.map(p => {
    const st = fs.statSync(p,{bigint:true});
    return [fs.realpathSync.native(p),String(st.dev),String(st.ino)];
  });
  return {...state,binding:crypto.createHash('sha256').update(JSON.stringify(physical)).digest('hex'),observedAt:new Date().toISOString()};
}

function toolEnvironment() {
  const systemRoot = process.env[Object.keys(process.env).find(k => k.toLowerCase() === 'systemroot')];
  const psDir = path.join(systemRoot,'System32/WindowsPowerShell/v1.0');
  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path');
  const gitDir = (process.env[pathKey] || '').split(path.delimiter)
    .find(dir => path.isAbsolute(dir) && fs.existsSync(path.join(dir,'git.exe')));
  if (!gitDir) throw Error('git-unavailable');
  const env = {...process.env};
  for (const key of Object.keys(env)) {
    if (/^(path|psmodulepath|node_options|node_path|imedical_deployment_lock|git_.*)$/i.test(key)) delete env[key];
  }
  Object.assign(env,{
    Path:[path.dirname(process.execPath),gitDir,psDir,path.join(systemRoot,'System32')].join(path.delimiter),
    NoDefaultCurrentDirectoryInExePath:'1',PSModulePath:path.join(psDir,'Modules'), GIT_NO_REPLACE_OBJECTS:'1',
    GIT_ALLOW_PROTOCOL:'', GIT_NO_LAZY_FETCH:'1', GIT_TERMINAL_PROMPT:'0',
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.fsmonitor',GIT_CONFIG_VALUE_0:'false'
  });
  return {env, ps:path.join(psDir,'powershell.exe'),gitExe:path.join(gitDir,'git.exe')};
}

function run({root,action,expectedRevision,expectedBinding}) {
  const before = observe(root);
  if (action === 'observe') return before;
  const install = action === 'install';
  if (before.status !== (install ? 'no-framework' : 'standard') || before.revision !== expectedRevision)
    return {error:'unsupported-project',before};
  if (before.binding !== expectedBinding) return {error:'binding-changed',before};
  if (process.platform !== 'win32') return {error:'unsupported-platform',before};
  const cap = path.join(root,'.agents');
  for (const dir of [cap,root]) {
    if (!fs.existsSync(path.join(dir,'.git'))) continue;
    const keys = git(dir,['config','--local','--no-includes','--name-only','--null','--list']).toString().split('\0');
    if (keys.some(k => /^(include(if)?\.|filter\.|url\.|remote\..*\.(uploadpack|vcs|proxy)$|diff\..*\.(command|textconv)$|core\.(worktree|attributesfile|alternateRefsCommand)$)/i.test(k)))
      return {error:'custom-git-config',before};
  }
  if (!install) verifyRuntime(cap,before.revision);
  if (action === 'verify') return {before};
  const tools = toolEnvironment();
  const steps = [];
  const receipt = (error) => ({action,steps,before,after:observe(root),exitCode:steps.at(-1)?.exitCode ?? null,...(error ? {error} : {})});
  function owner(step,entry,args,env) {
    const proc = spawnSync(tools.ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',entry,...args],
      {cwd:root,env,windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024});
    const codes = ['pull-blocked-dirty','pull-blocked-diverged','pull-failed','fetch-failed','sparse-refresh-failed','runtime-assets-invalid','unresolved deltas','missing blob','did not send all necessary objects','unrecognized framework execution tree'];
    const diagnostic = proc.status === 0 ? undefined : codes.find(code => (proc.stdout + proc.stderr).toLowerCase().includes(code));
    steps.push({step,exitCode:proc.status,revision:observe(root).revision,diagnostic});
    return proc.status === 0;
  }
  const entry = path.join(cap,'scripts/update-agents.ps1');
  const update = (step,mode,env=tools.env,noPull=true) => owner(step,entry,['-ProjectRoot',root,'-Mode',mode,...(noPull?['-NoPull']:[])],env);
  const sameProject = () => {
    const now = observe(root);
    return now.status === before.status && now.binding === before.binding && now.revision === before.revision;
  };
  if (!sameProject()) return receipt('binding-changed');
  if (action === 'check' || action === 'preview') {
    update(action,action === 'check' ? 'Check' : 'DryRun');
    return receipt();
  }
  function withDeploymentLock(expected, operation) {
    let lock;
    try { lock = deployment.acquireLock(cap,process.pid); }
    catch (error) {
      if (error.message.includes('Plugin deployment is busy')) return receipt('deployment-busy');
      throw error;
    }
    try {
      const actual = observe(root);
      if (actual.status !== 'standard' || actual.binding !== expected.binding || actual.revision !== expected.revision)
        return receipt('binding-changed');
      verifyRuntime(cap,expected.revision);
      return operation(lock.token);
    } finally { deployment.releaseLock(cap,lock.token); }
  }
  function writeAndCheck(expected,step) {
    return withDeploymentLock(expected, token => {
      const env = {...tools.env,IMEDICAL_DEPLOYMENT_LOCK:token};
      if (update(step,'Write',env)) update('check','Check',env);
      return receipt();
    });
  }
  if (action === 'apply') return writeAndCheck(before,'apply');
  if (!install && action !== 'fetch-preview') return receipt('unsupported-action');
  if (!install && (git(cap,['symbolic-ref','--short','HEAD']).toString().trim() !== 'master' ||
      git(cap,['rev-parse','--abbrev-ref','@{upstream}']).toString().trim() !== 'origin/master'))
    return receipt('custom-upstream');
  const networkEnv = {...process.env,GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:process.env.GIT_ALLOW_PROTOCOL==='file'?'file':'https'};
  if (install) {
    const installer = path.resolve(__dirname,'../../../scripts/install-agents.ps1');
    const env = {...tools.env,GIT_ALLOW_PROTOCOL:networkEnv.GIT_ALLOW_PROTOCOL};
    delete env.GIT_NO_LAZY_FETCH; // The original filtered clone fetches the selected runtime blobs during sparse checkout.
    // An isolated caller can map the canonical source to its local Git fixture.
    if (networkEnv.GIT_ALLOW_PROTOCOL === 'file') {
      const mapped = spawnSync(tools.gitExe,['ls-remote','--get-url',sourceUrl],{cwd:__dirname,env:networkEnv,encoding:'utf8',windowsHide:true});
      const url = mapped.stdout?.trim();
      if (mapped.status !== 0 || !url || url === sourceUrl) return receipt('fetch-failed');
      Object.assign(env,{GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_1:'url.'+url+'.insteadOf',GIT_CONFIG_VALUE_1:sourceUrl});
    }
    if (!owner('install',installer,['-TrustedRuntimeTree',[...trustedTrees].join(',')],env)) return receipt('install-failed');
    const installed = observe(root);
    if (installed.status !== 'standard') return receipt('revision-mismatch');
    return writeAndCheck(installed,'initialize');
  }
  // The installed historical updater performs both fetch and pull. Give it one frozen source.
  const tempParent = path.join(require('node:os').tmpdir(),'Codex');
  fs.mkdirSync(tempParent,{recursive:true});
  const temp = fs.mkdtempSync(path.join(tempParent,'workbench-source-'));
  try {
    const advertised = spawnSync(tools.gitExe,['ls-remote','--exit-code',sourceUrl,'refs/heads/master'],
      {cwd:temp,env:networkEnv,windowsHide:true,encoding:'utf8'});
    if (advertised.status !== 0) return receipt('fetch-failed');
    if (advertised.stdout.split('\t')[0] === before.revision) {
      return withDeploymentLock(before, token => {
        update('fetch-preview','DryRun',{...tools.env,IMEDICAL_DEPLOYMENT_LOCK:token});
        return receipt();
      });
    }
    const mirror = path.join(temp,'source.git');
    const transfer = (args,input) => spawnSync(tools.gitExe,args,{cwd:temp,windowsHide:true,stdio:['pipe','ignore','ignore'],input,env:networkEnv}).status === 0;
    if (!transfer(['init','--bare','--initial-branch=master',mirror])) return receipt('fetch-failed');
    // Start negotiation at the actual installed commit, including partial clones.
    // Only the new history is fetched. The temporary ref stays fixed during the owner's fetch/pull.
    fs.writeFileSync(path.join(mirror,'objects/info/alternates'),path.join(cap,'.git/objects').replaceAll('\\','/')+'\n');
    // Match the real source's branches so the owner's fetch --prune retains other live upstreams.
    const seeds = git(cap,['for-each-ref','--format=%(objectname) %(refname) %(symref)','refs/remotes/origin','refs/tags'])
      .toString().trimEnd().split('\n').filter(Boolean).flatMap(line => {
        const [oid,ref,symbolic] = line.trim().split(' ');
        return symbolic ? [] : ['update '+ref.replace('refs/remotes/origin/','refs/heads/')+' '+oid];
      });
    if (!transfer(['-C',mirror,'update-ref','--stdin'],seeds.join('\n')+'\n') ||
        !transfer(['-C',mirror,'remote','add','origin',sourceUrl]) ||
        !transfer(['-C',mirror,'config','remote.origin.promisor','true']) ||
        !transfer(['-C',mirror,'config','remote.origin.partialclonefilter','blob:none']) ||
        !transfer(['-C',mirror,'config','uploadpack.allowFilter','true']) ||
        !transfer(['-C',mirror,'config','uploadpack.allowAnySHA1InWant','true']) ||
        !transfer(['-C',mirror,'fetch','--prune','--filter=blob:none','origin','+refs/heads/*:refs/heads/*']))
      return receipt('fetch-failed');
    const target = git(mirror,['rev-parse','HEAD']).toString().trim();
    const missing = git(mirror,['rev-list','--objects','--no-object-names','--missing=print',before.revision+'..'+target])
      .toString().split(/\r?\n/).filter(row => /^\?[a-f0-9]{40}$/.test(row)).map(row => row.slice(1));
    // Fast-forward checkout may request the old as well as new blob for changed sparse-excluded paths.
    const delta = git(mirror,['diff-tree','--raw','--no-renames','--no-abbrev','-r','-z',before.revision,target]).toString().split('\0');
    const sides = new Set(delta.filter((row,index) => index % 2 === 0 && row.startsWith(':'))
      .flatMap(row => row.split(' ').slice(2,4)).filter(oid => /^[a-f0-9]{40}$/.test(oid) && !/^0+$/.test(oid)));
    // Git status/checkout can also consult excluded attribute and ignore blobs from the index.
    for (const revision of new Set([before.revision,target])) {
      const rows = git(mirror,['ls-tree','-r','-z',revision]).toString().split('\0');
      for (const row of rows) {
        const [head,name] = row.split('\t');
        if (name && /(^|\/)\.(gitignore|gitattributes|gitmodules)$/.test(name)) sides.add(head.split(' ')[2]);
      }
    }
    if (sides.size) {
      const objects = git(mirror,['cat-file','--batch-check'],[...sides].join('\n')+'\n').toString();
      for (const line of objects.trim().split(/\r?\n/)) if (line.endsWith(' missing')) missing.push(line.split(' ')[0]);
    }
    if (missing.length && !transfer(['-C',mirror,'-c','fetch.negotiationAlgorithm=noop','fetch','--no-tags',
      '--no-write-fetch-head','--filter=blob:none','--stdin','origin'],[...new Set(missing)].join('\n')+'\n')) return receipt('fetch-failed');
    verifyRuntime(mirror,target,false);
    if (!sameProject()) return receipt('binding-changed');
    verifyRuntime(cap,before.revision);
    const env = {...tools.env,GIT_ALLOW_PROTOCOL:'file',GIT_CONFIG_COUNT:'3',
      GIT_CONFIG_KEY_1:'url.'+mirror.replaceAll('\\','/')+'.insteadOf',GIT_CONFIG_VALUE_1:sourceUrl,
      GIT_CONFIG_KEY_2:'core.hooksPath',GIT_CONFIG_VALUE_2:path.join(temp,'no-hooks')};
    // Freeze refs for the owner, but let native partial clones request individual blobs by their Git IDs.
    // A distinct URL prefix avoids redirecting the promisor itself back to the frozen ref view.
    const objectSource = spawnSync(tools.gitExe,['ls-remote','--get-url',sourceUrl],{cwd:temp,env:networkEnv,windowsHide:true,encoding:'utf8'});
    if (objectSource.status !== 0) return receipt('fetch-failed');
    Object.assign(env,{GIT_ALLOW_PROTOCOL:networkEnv.GIT_ALLOW_PROTOCOL === 'file'?'file':'file:https',GIT_CONFIG_COUNT:'7',
      GIT_CONFIG_KEY_3:'remote.workbench-objects.url',GIT_CONFIG_VALUE_3:'workbench-objects:',
      GIT_CONFIG_KEY_4:'remote.workbench-objects.promisor',GIT_CONFIG_VALUE_4:'true',
      GIT_CONFIG_KEY_5:'remote.workbench-objects.partialclonefilter',GIT_CONFIG_VALUE_5:'blob:none',
      GIT_CONFIG_KEY_6:'url.'+objectSource.stdout.trim()+'.insteadOf',GIT_CONFIG_VALUE_6:'workbench-objects:'});
    delete env.GIT_NO_LAZY_FETCH; // Checkout can request approved blobs from the frozen local source.
    return withDeploymentLock(before, token => {
      env.IMEDICAL_DEPLOYMENT_LOCK = token;
      if (!update('fetch-preview','DryRun',env,false)) return receipt('preview-failed');
      const after = observe(root);
      if (after.status !== 'standard' || after.revision !== target) return receipt('revision-mismatch');
      verifyRuntime(cap,target);
      return receipt();
    });
  } finally { fs.rmSync(temp,{recursive:true,force:true,maxRetries:3}); }
}

try { parentPort.postMessage(run(workerData)); }
catch (error) {
  const known = ['unknown-tree','runtime-modified','unknown-bootstrap','git-unavailable'];
  parentPort.postMessage({error:known.includes(error.message) ? error.message : 'inspection-failed'});
}
