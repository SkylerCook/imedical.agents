'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parentPort, workerData } = require('node:worker_threads');
const deployment = require('../../../scripts/lib/plugin-deployment');
const { inspectBundle } = require('../../../scripts/lib/knowledge-retrieval');
const { resolveWorkspaceContext, workspaceContextBlockers } = require('../../../scripts/lib/workspace-context');
const { inspectFramework } = require('./project-context');
const projectActions = require('./project-owner-actions');
const { planOverlayUpdate, inspectOverlayLink, inspectRegisteredMember } = require('./overlay-members');
const { applyOverlayUpdate, refreshBoundOverlay, runCanonicalMember } = require('./overlay-update');
const { runOwnerPowerShell } = require('./owner-powershell');
const { exportProjectState } = require('./state-export');

const runtimeTrees = ['scripts','plugins','vendor','hooks'];
// Each pilot commit is approved with the digest of its deployed runtime entries.
const trustedRuntime = new Map([
  ['eab5539774046e1931efae3baf2e3ccbc824586d', 'fe9fc4900494c1c05dc153d2c36602a3f58b8cbf56c5983d1254598807e05106'],
  ['484699523b38b67989c90e15b43391e220159df0', 'fe9fc4900494c1c05dc153d2c36602a3f58b8cbf56c5983d1254598807e05106'],
  ['f5aa2a3b2c14b91185f487217e498f33cfd938f2', '0fe4cec6d1782b07aef80faeba2034d7cdda293869d838e25feedd862f52a62a'],
  ['9cf2138e8255affbcf9a4c47985109a43e9a8286', 'd87a04242f5ae2f08d09244f15c9a7551bd4d6d518d21d2b025135320c4d32ae'],
  ['4480619355f06168c58796a405a978bdded1badc', '153b87992478940824cd4b64459723d11ca2e4ced8e425b34beaf7e3c53f6bed'],
  ['4222cc7d00267a6cc7dad53f760f63e346029c80', 'adb01aea5358e237475aa01f70b663bfc8902172b255d781176ae3bd745ba0d3'],
  ['3246ca4e7442c9e81977626c438922b757efbddb', 'f0a05c1ee334f4f37fadaaeb313f9f9c67b93ee0f25938fd9b982a0ce155620c'],
  ['b65675b656519b2a2bda02fd2b26e1a19fdbdd62', '30b13b1d4a6e499cbc56e7da2355ff345ac269f74d8222a07b8d523e03ce9427'],
  ['5520bdf7854561bd80e04fcc9330b6bb921bfe80', '30b13b1d4a6e499cbc56e7da2355ff345ac269f74d8222a07b8d523e03ce9427'],
  ['e943fc299efe658e1a2da90602a50d85cf2a3c7b', '30b13b1d4a6e499cbc56e7da2355ff345ac269f74d8222a07b8d523e03ce9427'],
  ['1a8a257cffa676a486a126ceab48b234babdd398', 'e43844b42644d604220126adebf35b8799f76521cb7d603280bd2631adafeb4e'],
  ['536d12b49bea961295162030e0926ebf65562330', '46c8d133986c4f4aaf2480d71e6ec611ca2938f0e77411d6670cc19d7d98a753'],
  ['08fe2e9099dfe95db53118f42fc43d683009023f', '7465f52d4bb222fe3b07868c50bb8001d75c0d31086fbdf163a259ed52f83e8f'],
  ['afb19d0e980a48ce2c49d945aff11c2120861d3a', '7465f52d4bb222fe3b07868c50bb8001d75c0d31086fbdf163a259ed52f83e8f'],
  ['35a8d2109fab6d18d2e529606ff8d8cbc7356408', '0a0a8e8d127f00eb1ffac2fb235a5795b2eb9cb07233b0d99cba06a5d3f53b57'],
  ['1cc5b8bc6b7470979867f55f6efb89bb6d1bf69b', '98db0fe5fd6707cf6c2322f0ee3174865e716983a7225648e6e74d9ec90496c3'],
  ['86b3a123b1a2e5fbca8d5cd29687d7119901da2f', 'c0afe50fe609539219292d5e0bdcbb6dff4ce7255a5647f7125a56c860f7e010'],
  ['b93a5e264493b7c3d876202e187661a48cff7fd1', 'c0afe50fe609539219292d5e0bdcbb6dff4ce7255a5647f7125a56c860f7e010'],
  ['e0d704b98ad51d2fd7727349fe8939ef286959af', '587752854b990b8898427e49d0161af3955fafefe42047b750507fc884aebe6b'],
  ['e2db4f5f37dbfc1d19068b0c384aa3a0c7ec9955', '77eb13c884c6fa12cbb23c5b7dfbf2b2749c3db3987728fb453f202b865676d7'],
]);

function packagedRuntime() {
  const root = path.resolve(__dirname, '../../..');
  const record = path.join(root, 'workbench-release.json');
  try {
    if (fs.lstatSync(path.join(root, '.git'), { throwIfNoEntry: false }) ||
        !fs.lstatSync(path.join(root, 'runtime/node.exe'), { throwIfNoEntry: false })?.isFile() ||
        !fs.lstatSync(record, { throwIfNoEntry: false })?.isFile()) return {};
    // This is the local envelope from the publisher-verified full ZIP, never a project's record.
    const release = JSON.parse(fs.readFileSync(record, 'utf8'));
    if (release.platform !== 'windows-x64') return {};
    if (release.formal === false && trustedRuntime.has(release.sourceBaseRevision)) {
      // A trial record can select an already approved public baseline, never approve a new tree.
      return { installBaseline: release.sourceBaseRevision };
    }
    const pin = release.runtimePin;
    if (release.formal !== true || release.localBuildChanges !== false ||
        typeof pin?.revision !== 'string' || pin.revision !== release.sourceBaseRevision ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(pin.revision) ||
        typeof pin.treeDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(pin.treeDigest)) return {};
    return { pin, installBaseline: pin.revision };
  } catch { return {}; }
}

const { pin: ownPin, installBaseline } = packagedRuntime();
if (ownPin && !trustedRuntime.has(ownPin.revision)) trustedRuntime.set(ownPin.revision, ownPin.treeDigest);
const sourceUrl = 'https://gitee.com/skyler-cook/imedical.agents.git';
const companyIndexFile = 'vendor/knowledge-index/company.sqlite';
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
  if (trustedRuntime.get(revision) !== crypto.createHash('sha256').update(deployed.join('\0'),'latin1').digest('hex')) throw Error('unknown-tree');
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
  if (checkWorkingFiles) {
    for (const dir of runtimeTrees) if (fs.existsSync(path.join(cap,dir))) visit(dir);
    for (const name of files.keys()) {
      if (!/^plugins\/[^/]+\/\.agents-plugin\/plugin\.json$/.test(name)) continue;
      const manifest = path.join(cap,name);
      if (!fs.existsSync(manifest)) continue; // An uninstalled optional plugin is absent from sparse checkout.
      const pluginDir = path.posix.dirname(path.posix.dirname(name));
      const metadata = JSON.parse(fs.readFileSync(manifest,'utf8').replace(/^\uFEFF/,''));
      for (const migration of metadata.configMigrations ?? []) {
        const script = path.posix.join(pluginDir,migration.script);
        if (!script.startsWith(pluginDir + '/') || !files.has(script) || !fs.existsSync(path.join(cap,script)))
          throw Error('runtime-modified');
      }
    }
  }
  for (const bootstrap of ['scripts/refresh-agents-sparse.js','scripts/lib/plugin-deployment.js']) {
    if (blob(git(cap,['cat-file','blob',revision + ':' + bootstrap])) !== files.get(bootstrap)) throw Error('unknown-bootstrap');
  }
}

function companyIndexObject(cap, revision) {
  return git(cap, ['ls-tree', revision, '--', companyIndexFile]).toString()
    .match(/^100644 blob ([a-f0-9]{40})\t/)?.[1];
}

function hasIndexObject(cap, oid) {
  return !!oid && git(cap, ['cat-file', '--batch-check=%(objecttype)'], oid + '\n').toString().trim() === 'blob';
}

function observeCompanyIndex(root, state) {
  if (!['standard', 'overlay-declared'].includes(state.status)) return;
  try {
    const context = resolveWorkspaceContext(root);
    const shared = state.status === 'overlay-declared';
    if (shared && workspaceContextBlockers(context).length) return;
    const cap = context.capabilityRoot;
    const revision = shared ? 'HEAD' : state.revision;
    const oid = companyIndexObject(cap, revision);
    const selection = git(cap, ['config', '--local', '--no-includes', '--default', '', '--get', 'imedical.knowledgeVectors'])
      .toString().trim().split(',');
    const sparse = git(cap, ['config', '--no-includes', '--bool', '--default', 'false', '--get', 'core.sparseCheckout'])
      .toString().trim() === 'true';
    return {
      available: !!oid, localObject: hasIndexObject(cap, oid), selected: selection.includes('company'), shared,
      writable: !shared && process.platform === 'win32' && sparse && trustedRuntime.has(revision),
      ...inspectBundle(context, 'company'),
    };
  } catch { return undefined; }
}

function observe(root, includeIndex = false) {
  const state = inspectFramework(root);
  if (includeIndex) state.companyIndex = observeCompanyIndex(root, state);
  if (!['standard','no-framework','partial','invalid-head','unknown-source','invalid-declaration','framework-checkout'].includes(state.status))
    return {...state,observedAt:new Date().toISOString()};
  const identity = [root];
  if (!['no-framework','framework-checkout'].includes(state.status)) identity.push(path.join(root,'.agents'));
  if (state.revision || state.status === 'invalid-head') identity.push(path.join(root,'.agents/.git'));
  if (state.status === 'standard') {
    const cap = path.join(root,'.agents');
    let profileExists = false;
    try { profileExists = require('../../../scripts/lib/project-plugin-profile').read(cap).exists; }
    catch { profileExists = null; }
    const skills = path.join(cap,'skills');
    state.installed = {
      sparseRules: fs.existsSync(path.join(cap,'.git/info/sparse-checkout')),
      profile: profileExists,
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
    if (/^(path|psmodulepath|node_options|node_path|imedical_deployment_lock|imedical_workbench_owner|git_.*)$/i.test(key)) delete env[key];
  }
  Object.assign(env,{
    Path:[path.dirname(process.execPath),gitDir,psDir,path.join(systemRoot,'System32')].join(path.delimiter),
    NoDefaultCurrentDirectoryInExePath:'1',PSModulePath:path.join(psDir,'Modules'), GIT_NO_REPLACE_OBJECTS:'1',
    GIT_ALLOW_PROTOCOL:'', GIT_NO_LAZY_FETCH:'1', GIT_TERMINAL_PROMPT:'0',
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.fsmonitor',GIT_CONFIG_VALUE_0:'false'
  });
  return {env, ps:path.join(psDir,'powershell.exe'),gitExe:path.join(gitDir,'git.exe')};
}

function hasCustomGitConfig(directory) {
  if (!fs.existsSync(path.join(directory,'.git'))) return false;
  const keys = git(directory,['config','--local','--no-includes','--name-only','--null','--list']).toString().split('\0');
  return keys.some(k => /^(include(if)?\.|filter\.|url\.|remote\..*\.(uploadpack|vcs|proxy)$|diff\..*\.(command|textconv)$|core\.(worktree|attributesfile|alternateRefsCommand)$)/i.test(k));
}

function withVerifiedDeploymentLock(root,expected,operation,blocked) {
  const cap = path.join(root,'.agents');
  let lock;
  try { lock = deployment.acquireLock(cap,process.pid); }
  catch (error) {
    if (error.message.includes('Plugin deployment is busy')) return blocked('deployment-busy');
    throw error;
  }
  try {
    const actual = observe(root);
    if (actual.status !== 'standard' || actual.binding !== expected.binding || actual.revision !== expected.revision)
      return blocked('binding-changed');
    verifyRuntime(cap,expected.revision);
    return operation(lock.token);
  } finally { deployment.releaseLock(cap,lock.token); }
}

function checkedMemberOwner(tools) {
  return (target,member,mode,lease) => {
    if (hasCustomGitConfig(member.workspaceRoot)) throw Error('custom-git-config');
    return runCanonicalMember(target,member,mode,lease,tools);
  };
}

function confirmMemberRegistration(link,tools,token) {
  const {root,member} = link;
  const registered = () => inspectRegisteredMember(root,member.id)?.identity === member.identity;
  if (registered()) return true;
  const registry = path.join(root.gitRoot,'plugin-deployment.json');
  const state = deployment.loadState(root.capabilityRoot,registry);
  // Earlier full checkouts skipped Overlay registration. Reuse the packaged owner
  // after a successful refresh. That owner only records the member in full mode.
  if (state.mode !== 'full' || state.members.some(entry=>deployment.sameContextRoot(entry.contextRoot,member.contextRoot))) return false;
  const owner = path.resolve(__dirname,'../../../scripts/plugin-deploy.js');
  if (!fs.lstatSync(owner,{throwIfNoEntry:false})?.isFile()) return false;
  const run = spawnSync(process.execPath,[owner,'register','--project-root',member.workspaceRoot],{
    cwd:member.workspaceRoot,env:{...tools.env,IMEDICAL_DEPLOYMENT_LOCK:token},windowsHide:true,timeout:30000,
    stdio:'ignore',
  });
  return run.status === 0 && registered();
}

function memberRefresh({root,expectedRevision,expectedBinding,overlaySelection}, before) {
  const done = (error,memberUpdate,registered=false) => ({before,after:observe(root,true),
    exitCode:error ? 1 : 0,...(error ? {error} : {}),...(memberUpdate ? {memberUpdate,registered} : {})});
  if (process.platform !== 'win32') return done('unsupported-platform');
  if (before.status !== 'overlay-declared' || before.revision !== expectedRevision) return done('overlay-target-changed');
  let link;
  try { link = inspectOverlayLink(root); } catch { return done('overlay-target-changed'); }
  if (!link || link.id !== overlaySelection?.linkId || link.member.identity !== expectedBinding)
    return done('overlay-target-changed');
  if (link.member.status !== 'ready') return done('overlay-member-unready');
  if ([root,link.root.workspaceRoot,link.root.capabilityRoot].some(hasCustomGitConfig)) return done('custom-git-config');
  const tools = toolEnvironment();
  return withVerifiedDeploymentLock(link.root.workspaceRoot,link.root,token => {
    const result = refreshBoundOverlay(link,checkedMemberOwner(tools),token);
    if (result.status !== 'complete') return done(result.error,result);
    try {
      if (inspectOverlayLink(root)?.id === link.id && confirmMemberRegistration(link,tools,token)) return done(undefined,result,true);
    } catch { /* The refresh receipt is retained if membership cannot be read back. */ }
    return done('overlay-registration-unconfirmed',result);
  },done);
}

function runExportState(root, expectedRevision, expectedBinding, expectedShared) {
  const before = observe(root);
  if (!['standard', 'overlay-declared', 'no-framework'].includes(before.status)) return {error:'unsupported-project'};
  const isOverlay = before.status === 'overlay-declared';
  function overlayLink() {
    try { return inspectOverlayLink(root); }
    catch { return null; }
  }
  const link = isOverlay ? overlayLink() : null;
  const binding = isOverlay ? link?.member.identity : before.binding;
  if (!expectedBinding || binding !== expectedBinding || (isOverlay && link.root.binding !== expectedShared?.binding))
    return {error:'binding-changed'};
  if (before.revision !== expectedRevision || (isOverlay && link.root.revision !== expectedShared.revision))
    return {error:'stale-observation'};
  const contextRoot = isOverlay ? link.member.contextRoot : path.join(root,'.agents');
  const state = exportProjectState(root, {
    layout:isOverlay ? 'overlay' : before.status === 'standard' ? 'standard' : 'not-installed',
    revision:isOverlay ? link.root.revision : before.revision,
    contextRoot,
    capabilityRoot:isOverlay ? link.root.capabilityRoot : before.status === 'standard' ? contextRoot : null,
  });
  const after = observe(root);
  if (after.status !== before.status || after.binding !== before.binding || after.revision !== before.revision ||
      (isOverlay && overlayLink()?.id !== link.id)) return {error:'binding-changed'};
  return state;
}

function run({root,action,expectedRevision,expectedBinding,offlineSelection,overlaySelection}) {
  if (action === 'export-state') return runExportState(root,expectedRevision,expectedBinding,overlaySelection);
  const before = observe(root,true);
  if (action === 'observe') return before;
  if (action === 'overlay-member-refresh') return memberRefresh({root,expectedRevision,expectedBinding,overlaySelection},before);
  const offlineAction = /^offline-(preview|install|apply)$/.exec(action)?.[1];
  const install = action === 'install' || offlineAction === 'install' || (offlineAction === 'preview' && expectedRevision === null);
  if (before.status !== (install ? 'no-framework' : 'standard') || before.revision !== expectedRevision)
    return {error:'unsupported-project',before};
  if (before.binding !== expectedBinding) return {error:'binding-changed',before};
  if (process.platform !== 'win32') return {error:'unsupported-platform',before};
  const cap = path.join(root,'.agents');
  if ([cap,root].some(hasCustomGitConfig)) return {error:'custom-git-config',before};
  if (!install && !offlineAction) verifyRuntime(cap,before.revision);
  if (action === 'verify') return {before};
  const tools = toolEnvironment();
  const steps = [];
  const receipt = (error) => ({action,steps,before,after:observe(root,true),exitCode:steps.at(-1)?.exitCode ?? null,...(error ? {error} : {})});
  function owner(step,entry,parameters,env) {
    const proc = runOwnerPowerShell(tools.ps,entry,parameters,{cwd:root,env});
    const codes = ['pull-blocked-dirty','pull-blocked-diverged','pull-failed','fetch-failed','sparse-refresh-failed','runtime-assets-invalid','unresolved deltas','missing blob','did not send all necessary objects','unrecognized framework execution tree'];
    const diagnostic = proc.status === 0 ? undefined : codes.find(code => (proc.stdout + proc.stderr).toLowerCase().includes(code));
    steps.push({step,exitCode:proc.status,revision:observe(root).revision,diagnostic});
    return proc.status === 0;
  }
  const entry = path.join(cap,'scripts/update-agents.ps1');
  const update = (step,mode,env=tools.env,noPull=true) => owner(step,entry,{ProjectRoot:root,Mode:mode,NoPull:noPull},env);
  if (offlineAction) return runOffline();
  async function runOffline() {
    const result = await require('./offline-framework-actions').execute({action:offlineAction,root,expectedRevision,expectedBinding,
      bundleDirectory:offlineSelection.bundleDirectory,release:offlineSelection.release},
    {trustedRuntime,observe:value=>observe(value,true),verifyRuntime,tools});
    if (offlineAction !== 'install' || result.error || result.exitCode !== 0) return result;
    steps.push({step:'install',exitCode:0,revision:result.after.revision});
    const initialized = initializeInstalled(result.after);
    return {...initialized,action:result.action,approvedRevision:result.approvedRevision};
  }
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
    return withVerifiedDeploymentLock(root,expected,operation,receipt);
  }
  function writeAndCheck(token,step) {
    const env = {...tools.env,IMEDICAL_DEPLOYMENT_LOCK:token};
    if (update(step,'Write',env)) update('check','Check',env);
    return receipt();
  }
  function initializeInstalled(installed) {
    return withDeploymentLock(installed, token => writeAndCheck(token,'initialize'));
  }
  if (action === 'apply' || action === 'refresh-overlay') {
    return withDeploymentLock(before,token => {
      if (!overlaySelection)
        return action === 'apply' ? writeAndCheck(token,'apply') : receipt('overlay-selection-unverified');
      const {plan,memberIds} = overlaySelection;
      if (plan.root.binding !== before.binding || plan.root.revision !== before.revision)
        return receipt('overlay-plan-changed');
      const overlayUpdate = applyOverlayUpdate(plan,memberIds,{
        updateRoot: action === 'apply' ? () => writeAndCheck(token,'apply') : undefined,
        withMemberLease: (target,operation) => {
          const actual = observe(root);
          if (actual.status !== 'standard' || actual.binding !== target.binding || actual.revision !== target.revision)
            throw Error('binding-changed');
          verifyRuntime(cap,target.revision);
          return operation(token);
        },
        runMember: checkedMemberOwner(tools)
      });
      const result = {...receipt(overlayUpdate.status === 'blocked' ? overlayUpdate.error : undefined),overlayUpdate};
      if (action === 'refresh-overlay') result.exitCode = overlayUpdate.status === 'complete' ? 0 : 1;
      return result;
    });
  }
  if (projectActions.accepts(action)) {
    const runProjectAction=token=>{
      const autocrlf=git(cap,['config','--type=bool-or-str','--default','false','--get','core.autocrlf']).toString().trim();
      if (!['true','false','input'].includes(autocrlf)) return receipt('custom-git-config');
      const env={...tools.env,...(token?{IMEDICAL_DEPLOYMENT_LOCK:token}:{}),GIT_CONFIG_COUNT:'3',
        GIT_CONFIG_KEY_1:'core.hooksPath',GIT_CONFIG_VALUE_1:'NUL',
        GIT_CONFIG_KEY_2:'core.autocrlf',GIT_CONFIG_VALUE_2:autocrlf};
      if (action.startsWith('plugin-install:') && !['','file'].includes(process.env.GIT_ALLOW_PROTOCOL) &&
          git(cap,['remote']).toString().trim()==='origin') {
        env.GIT_ALLOW_PROTOCOL='https';
        env.GIT_NO_LAZY_FETCH='0';
      }
      const result=projectActions.execute(action,{root,cap,node:process.execPath,ps:tools.ps,env,verify:()=>verifyRuntime(cap,before.revision)});
      const finish=value=>({...receipt(value.error),...value,exitCode:value.error?1:0});
      if (action==='discover-iris-mcp') return result.then(value=>{
        if (!sameProject()) return receipt('binding-changed');
        verifyRuntime(cap,before.revision);
        return finish(value);
      });
      return finish(result);
    };
    return action.startsWith('plugin-inspect:') || action==='discover-iris-mcp' ? runProjectAction() : withDeploymentLock(before,runProjectAction);
  }
  if (action === 'install-index' || action === 'remove-index') {
    const enable = action === 'install-index';
    const query = path.join(cap,'scripts/knowledge-query.js');
    if (!before.companyIndex?.writable || !fs.lstatSync(query,{throwIfNoEntry:false})?.isFile() ||
        fs.existsSync(path.join(root,'plugins/coding-iris-plugin/.agents-plugin/plugin.json')))
      return receipt('index-selection-unavailable');
    return withDeploymentLock(before, token => {
      const original = observeCompanyIndex(root,before);
      if (!original) return receipt('index-selection-unavailable');
      const autocrlf = git(cap,['config','--type=bool-or-str','--default','false','--get','core.autocrlf']).toString().trim();
      if (!['true','false','input'].includes(autocrlf)) return receipt('index-selection-unavailable');
      const env = {...tools.env, IMEDICAL_DEPLOYMENT_LOCK:token, GIT_CONFIG_COUNT:'3',
        GIT_CONFIG_KEY_1:'core.hooksPath', GIT_CONFIG_VALUE_1:'NUL',
        GIT_CONFIG_KEY_2:'core.autocrlf', GIT_CONFIG_VALUE_2:autocrlf};
      if (enable) {
        const oid = companyIndexObject(cap,before.revision);
        if (!oid) return receipt('index-not-in-release');
        if (!hasIndexObject(cap,oid)) {
          const offline = process.env.GIT_ALLOW_PROTOCOL === '';
          const fixture = process.env.GIT_ALLOW_PROTOCOL === 'file';
          const mapped = fixture && spawnSync(tools.gitExe,['ls-remote','--get-url',sourceUrl],
            {cwd:__dirname,env:process.env,encoding:'utf8',windowsHide:true,timeout:10000});
          const source = fixture ? mapped.stdout?.trim() : sourceUrl;
          if (offline || !source || (fixture && mapped.status !== 0)) return receipt('index-fetch-failed');
          const fetched = spawnSync(tools.gitExe,['-C',cap,'-c','fetch.negotiationAlgorithm=noop',
            'fetch','--no-tags','--no-write-fetch-head','--no-recurse-submodules','--no-auto-maintenance',
            '--filter=blob:none','--stdin',source],{input:oid+'\n',env:{...env,GIT_ALLOW_PROTOCOL:fixture?'file':'https'},
            windowsHide:true,timeout:120000,stdio:['pipe','ignore','ignore']});
          if (fetched.status !== 0 || !hasIndexObject(cap,oid)) return receipt('index-fetch-failed');
        }
      }
      function select(operation, step = operation) {
        const result = spawnSync(process.execPath,[query,'--project-root',root,'--action',operation,'--provider','company'],
          {cwd:root,env,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
        const dirty = result.status !== 0 && /dirty capability checkout/.test(result.stderr ?? '');
        steps.push({step,exitCode:result.status,revision:before.revision,...(dirty ? {diagnostic:'index-worktree-dirty'} : {})});
        return result.status === 0;
      }
      if (!select(action)) return receipt(steps.at(-1).diagnostic || 'index-selection-failed');
      const response = receipt();
      const actual = response.after.companyIndex;
      if (actual?.selected === enable && actual.format === (enable?'readable':'missing')) return response;
      if (enable && !original.selected && original.format === 'missing' && actual?.selected && sameProject()) {
        // Only revert the selection introduced by this request, under the same deployment lock.
        try { verifyRuntime(cap,before.revision); }
        catch { return receipt('index-readback-recovery-failed'); }
        const reverted = select('remove-index','restore-index-selection');
        const restored = receipt('index-readback-recovery-failed');
        const observed = restored.after.companyIndex;
        if (reverted && observed?.selected === false && observed.format === 'missing') restored.error = 'index-readback-restored';
        return restored;
      }
      return {...response,error:'index-readback-mismatch'};
    });
  }
  if (!install && action !== 'fetch-preview') return receipt('unsupported-action');
  if (!install && (git(cap,['symbolic-ref','--short','HEAD']).toString().trim() !== 'master' ||
      git(cap,['rev-parse','--abbrev-ref','@{upstream}']).toString().trim() !== 'origin/master'))
    return receipt('custom-upstream');
  const networkEnv = {...process.env,GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:process.env.GIT_ALLOW_PROTOCOL==='file'?'file':'https'};
  const compatibility = (result,published,selected) => published === selected ? result :
    {...result,compatibility:{publishedRevision:published,selectedRevision:selected}};
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
    const params = {TrustedRuntimeTree:[...trustedRuntime].map(pair => pair.join(':')).join(',')};
    if (installBaseline) params.PublishedRevision = installBaseline;
    if (!owner('install',installer,params,env)) return receipt('install-failed');
    const installed = observe(root);
    if (installed.status !== 'standard') return receipt('revision-mismatch');
    const result = initializeInstalled(installed);
    if (!installBaseline) return result;
    const published = git(cap,['rev-parse','refs/remotes/origin/master']).toString().trim();
    return compatibility(result,published,installed.revision);
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
    const published = git(mirror,['rev-parse','HEAD']).toString().trim();
    const isAncestor = (ancestor,tip) => spawnSync(tools.gitExe,
      ['--no-replace-objects','-C',mirror,'merge-base','--is-ancestor',ancestor,tip],
      {cwd:temp,env:tools.env,windowsHide:true,stdio:'ignore',timeout:10000}).status === 0;
    let target = published;
    if (!trustedRuntime.has(published)) {
      if (!ownPin || !isAncestor(ownPin.revision,published)) return receipt('unknown-tree');
      if (isAncestor(before.revision,ownPin.revision)) target = ownPin.revision;
      else if (isAncestor(before.revision,published)) target = before.revision;
      else return receipt('published-history-mismatch');
    }
    if (target === before.revision) {
      return withDeploymentLock(before, token => {
        update('fetch-preview','DryRun',{...tools.env,IMEDICAL_DEPLOYMENT_LOCK:token});
        return compatibility(receipt(),published,target);
      });
    }
    if (!isAncestor(before.revision,target)) return receipt('published-history-mismatch');
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
    if (target !== published && !transfer(['-C',mirror,'update-ref','refs/heads/master',target,published])) return receipt('fetch-failed');
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
      return compatibility(receipt(),published,target);
    });
  } finally { fs.rmSync(temp,{recursive:true,force:true,maxRetries:3}); }
}

function overlayDetails(result, {root,action}) {
  const state = action === 'observe' ? result : result.after;
  if (state?.status === 'overlay-declared') {
    let link;
    try { link = inspectOverlayLink(root); } catch { /* Standard root identity could not be verified. */ }
    const bound = {...state,...(link ? {binding:link.member.identity} : {})};
    const canRefresh = link?.member.status === 'ready' && process.platform === 'win32' && trustedRuntime.has(link.root.revision);
    return {...(action === 'observe' ? bound : {...result,after:bound}),overlayLink:link,
      overlay:{scope:'member',standardRoot:link?.root.workspaceRoot ?? null,planId:link?.id,issue:link?.member.issue,canRefresh}};
  }
  if (state?.status !== 'standard') return result;
  try {
    const plan = planOverlayUpdate(root);
    if (plan.root.revision !== state.revision || plan.root.binding !== state.binding) throw Error('overlay-plan-changed');
    const planId = crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    return {...result,overlayPlan:{...plan,id:planId},overlay:{scope:'standard',planId,
      members:plan.members.map(({id,label,status,issue})=>({id,label,status,issue}))}};
  } catch {
    return {...result,overlay:{scope:'standard',error:'overlay-registry-unavailable'}};
  }
}

Promise.resolve().then(() => run(workerData)).then(result => {
  const actions = ['observe','fetch-preview','preview','install','apply','refresh-overlay','overlay-member-refresh','offline-apply','offline-install'];
  parentPort.postMessage(actions.includes(workerData.action) ? overlayDetails(result,workerData) : result);
}).catch(error => {
  const known = ['unknown-tree','runtime-modified','unknown-bootstrap','git-unavailable','binding-changed'];
  const message = typeof error?.message === 'string' ? error.message : '';
  const code = message.includes('Plugin deployment is busy') ? 'deployment-busy' :
    known.includes(message) || /^offline-[a-z-]+$/.test(message) ? message : 'inspection-failed';
  parentPort.postMessage({error:code});
});
