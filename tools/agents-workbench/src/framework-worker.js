'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parentPort, workerData } = require('node:worker_threads');
const { inspectFramework } = require('./project-context');

// Pilot execution tree verified at 3246ca4e7442c9e81977626c438922b757efbddb.
const runtimeTrees = ['scripts','plugins','vendor','hooks'];
// SHA-256 of git ls-tree -r -z <revision> -- scripts plugins vendor hooks.
const treeDigest = '2049e6499f5bb1d1396497df811116789646134cf3f84dbeaacbf770c53e147d';

function git(cap, args) {
  const result = spawnSync('git', ['--no-replace-objects','--no-optional-locks','-C',cap,...args], {
    env:{...process.env,GIT_ALLOW_PROTOCOL:'',GIT_NO_LAZY_FETCH:'1'},windowsHide:true, timeout:10000, maxBuffer:4*1024*1024
  });
  if (result.status !== 0) throw Error('git-unavailable');
  return result.stdout;
}

function blob(bytes) {
  return crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

function verifyRuntime(cap, revision) {
  const output = git(cap,['ls-tree','-r','-z',revision,'--',...runtimeTrees]);
  if (crypto.createHash('sha256').update(output).digest('hex') !== treeDigest) throw Error('unknown-tree');
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
    if (!st.isFile() || !files.has(rel)) throw Error('runtime-modified');
    const bytes = fs.readFileSync(file);
    const expected = files.get(rel);
    if (blob(bytes) === expected) return;
    if (bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes) ||
        blob(Buffer.from(bytes.toString('latin1').replace(/\r\n/g,'\n'),'latin1')) !== expected) throw Error('runtime-modified');
  }
  for (const dir of runtimeTrees) if (fs.existsSync(path.join(cap,dir))) visit(dir);
  for (const bootstrap of ['scripts/refresh-agents-sparse.js','scripts/lib/plugin-deployment.js']) {
    if (blob(git(cap,['cat-file','blob',revision + ':' + bootstrap])) !== files.get(bootstrap)) throw Error('unknown-bootstrap');
  }
}

function observe(root) {
  const state = inspectFramework(root);
  if (state.status !== 'standard') return {...state,observedAt:new Date().toISOString()};
  const identity = [root];
  identity.push(path.join(root,'.agents'),path.join(root,'.agents/.git'));
  const physical = identity.map(p => {
    const st = fs.statSync(p,{bigint:true});
    return [fs.realpathSync.native(p),String(st.dev),String(st.ino)];
  });
  return {...state,binding:crypto.createHash('sha256').update(JSON.stringify(physical)).digest('hex'),observedAt:new Date().toISOString()};
}

function run({root,action,expectedRevision,expectedBinding}) {
  const before = observe(root);
  if (action === 'observe') return before;

  if (before.status !== 'standard' || before.revision !== expectedRevision) {
    return {error:'unsupported-project',before};
  }
  if (before.binding !== expectedBinding) return {error:'binding-changed',before};
  if (process.platform !== 'win32') return {error:'unsupported-platform',before};
  const cap = path.join(root,'.agents');
  // Local Git configuration may name executable filters or redirect repository reads.
  for (const dir of [cap,root]) {
    if (!fs.existsSync(path.join(dir,'.git'))) continue;
    const keys = git(dir,['config','--local','--no-includes','--name-only','--null','--list']).toString().split('\0');
    if (keys.some(k => /^(include(if)?\.|filter\.|diff\..*\.(command|textconv)$|core\.(worktree|attributesfile|alternateRefsCommand)$)/i.test(k))) {
      return {error:'custom-git-config',before};
    }
  }
  verifyRuntime(cap,before.revision);
  const checked = observe(root);
  if (checked.binding !== before.binding || checked.revision !== before.revision || checked.status !== 'standard') {
    return {error:'binding-changed',before:checked};
  }
  const psDir = path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0');
  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path');
  const gitDir = (process.env[pathKey] || '').split(path.delimiter)
    .find(dir => path.isAbsolute(dir) && fs.existsSync(path.join(dir,'git.exe')));
  if (!gitDir) throw Error('git-unavailable');
  const env = {...process.env};
  for (const key of Object.keys(env)) {
    if (/^(path|psmodulepath|node_options|node_path|imedical_deployment_lock|git_.*)$/i.test(key)) delete env[key];
  }
  Object.assign(env,{
    Path:[path.dirname(process.execPath),gitDir,psDir,path.join(process.env.SystemRoot,'System32')].join(path.delimiter),
    NoDefaultCurrentDirectoryInExePath:'1',PSModulePath:path.join(psDir,'Modules'), GIT_NO_REPLACE_OBJECTS:'1',
    GIT_ALLOW_PROTOCOL:'', GIT_NO_LAZY_FETCH:'1', GIT_TERMINAL_PROMPT:'0',
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.fsmonitor',GIT_CONFIG_VALUE_0:'false'
  });
  const mode = {check:'Check',preview:'DryRun'}[action];
  if (!mode) throw Error('unknown-action');
  const result = spawnSync(path.join(psDir,'powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
    '-File',path.join(cap,'scripts/update-agents.ps1'),'-ProjectRoot',root,'-Mode',mode,'-NoPull'],
    {cwd:__dirname,env,windowsHide:true,stdio:'ignore'});
  return {action,exitCode:result.status,before,after:observe(root),...(result.error ? {error:'owner-launch-failed'} : {})};
}

try { parentPort.postMessage(run(workerData)); }
catch (error) {
  const known = ['unknown-tree','runtime-modified','unknown-bootstrap','git-unavailable'];
  parentPort.postMessage({error:known.includes(error.message) ? error.message : 'inspection-failed'});
}
