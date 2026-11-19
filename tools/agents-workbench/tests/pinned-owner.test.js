'use strict';

const assert = require('node:assert/strict');
const { execFileSync, fork } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');

const repo = path.resolve(__dirname, '../../..');
const original = 'b65675b656519b2a2bda02fd2b26e1a19fdbdd62';
const sourceUrl = 'https://gitee.com/skyler-cook/imedical.agents.git';
const master = 'refs/heads/master';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { windowsHide: true });
}

function content(root, ...args) { return git(root, ...args).toString('utf8').trim(); }

async function openWorkbench(stage, root, env, stop) {
  const child = fork(path.join(stage, 'tools/agents-workbench/prototype/serve.js'), ['--project',root], {
    cwd: stage, execPath: path.join(stage, 'runtime/node.exe'), env,
    stdio: ['ignore','ignore','pipe','ipc'],
  });
  let errors = '';
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
  const stopped = once(child,'close');
  stop.push(async () => { child.kill(); await stopped; });
  const [hello] = await Promise.race([once(child,'message',{signal:AbortSignal.timeout(10000)}),
    stopped.then(([code]) => { throw Error(`Staged workbench exited with ${code}: ${errors}`); })]);
  const origin = new URL(hello.address).origin;
  const headers = { 'X-Workbench-Request':'1', 'Content-Type':'application/json', Origin:origin };
  const session = await fetch(origin+'/framework/session', {
    method:'POST',headers,body:JSON.stringify({token:hello.bootstrap}),signal:AbortSignal.timeout(5000),
  });
  assert.equal(session.status,200);
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const csrf = (await session.json()).csrf;

  async function read() {
    for (let i=0;i<50;i++) {
      const result = await fetch(origin+'/framework.json',{headers,signal:AbortSignal.timeout(5000)});
      assert.equal(result.status,200);
      const state = await result.json();
      if (state.status !== 'observing') return state;
      await new Promise(resolve => setTimeout(resolve,50));
    }
    throw Error('Project observation did not finish');
  }

  return async action => {
    const state = await read();
    const {projectId,revision} = state;
    assert.ok(projectId && Object.hasOwn(state,'revision'),JSON.stringify(state));
    const result = await fetch(origin+'/framework/action',{
      method:'POST',headers:{...headers,Cookie:cookie,'X-Workbench-CSRF':csrf},
      body:JSON.stringify({action,projectId,revision}),signal:AbortSignal.timeout(180000),
    });
    return {http:result.status,...await result.json()};
  };
}

test('staged online install and update use the reachable approved release when master has advanced', {
  skip:process.platform!=='win32', timeout:240000,
}, async t => {
  const root = createTempDirectory('workbench-pinned-owner-');
  const stop = [];
  t.after(async () => {
    await Promise.all(stop.map(close => close()));
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root,{recursive:true,force:true,maxRetries:3});
  });
  const mirror = path.join(root,'mirror.git');
  git(root,'clone','--quiet','--bare','--shared',repo,mirror);
  git(mirror,'symbolic-ref','HEAD',master);
  git(mirror,'config','uploadpack.allowFilter','true');
  git(mirror,'config','uploadpack.allowAnySHA1InWant','true');
  git(mirror,'update-ref',master,original);
  const tree = content(mirror,'rev-parse',original+'^{tree}');
  const childCommit = (parent,message) => content(mirror,'-c','user.name=Workbench Test','-c','user.email=workbench@example.invalid',
    '-c','commit.gpgSign=false','commit-tree',tree,'-p',parent,'-m',message);
  const approved = childCommit(original,'Approved release fixture B');
  const unapproved = childCommit(approved,'Unapproved same-tree fixture C');
  const rewritten = childCommit(original,'Unapproved same-tree history without the approved release');
  const deployment = git(mirror,'ls-tree','-r','-z',approved,'--','scripts','plugins','vendor','hooks').toString('latin1')
    .split('\0').filter(row=>!row.endsWith('\tscripts/install-agents.ps1')).join('\0');
  const treeDigest = createHash('sha256').update(deployment,'latin1').digest('hex');

  const stage = path.join(root,'发行暂存');
  execFileSync(process.execPath,[path.join(repo,'tools/agents-workbench/react/package-runtime.mjs'),stage],{windowsHide:true});
  fs.mkdirSync(path.join(stage,'runtime'));
  fs.copyFileSync(process.execPath,path.join(stage,'runtime/node.exe'));
  const metadataFile = path.join(stage,'workbench-release.json');
  const metadata = JSON.parse(fs.readFileSync(metadataFile,'utf8'));
  // The separate release-pin suite exercises formal generation from a clean source commit.
  // Here the real staged program uses an authorized fixture release from the mirrored publishing history.
  Object.assign(metadata,{formal:true,localBuildChanges:false,platform:'windows-x64',node:process.versions.node,
    sourceBaseRevision:approved,runtimePin:{revision:approved,treeDigest}});
  fs.writeFileSync(metadataFile,JSON.stringify(metadata));

  const env = {...process.env,PORT:'0',GIT_ALLOW_PROTOCOL:'file',GIT_CONFIG_COUNT:'2',
    GIT_CONFIG_KEY_0:'url.'+mirror.replaceAll('\\','/')+'.insteadOf',GIT_CONFIG_VALUE_0:sourceUrl,
    GIT_CONFIG_KEY_1:'protocol.allow',GIT_CONFIG_VALUE_1:'never'};
  env.PSModulePath = path.join(env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules');
  delete env.IMEDICAL_DEPLOYMENT_LOCK;
  function project(name) {
    const dir = path.join(root,name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir,'business.txt'),'existing business file');
    return dir;
  }
  function assertBinding(dir, revision) {
    const cap = path.join(dir,'.agents');
    assert.equal(content(cap,'rev-parse','HEAD'),revision);
    assert.equal(content(cap,'remote','get-url','origin'),sourceUrl);
    assert.equal(content(cap,'rev-parse','--abbrev-ref','@{upstream}'),'origin/master');
    assert.equal(fs.readFileSync(path.join(dir,'business.txt'),'utf8'),'existing business file');
  }
  const existing = project('Existing project');
  const first = await openWorkbench(stage,existing,env,stop);
  const firstInstall = await first('install');
  assert.equal(firstInstall.exitCode,0,JSON.stringify(firstInstall));
  assertBinding(existing,original);

  git(mirror,'update-ref',master,unapproved,original);
  const fresh = project('新工程');
  const second = await openWorkbench(stage,fresh,env,stop);
  const installed = await second('install');
  assert.equal(installed.http,200,JSON.stringify(installed));
  assert.equal(installed.exitCode,0,JSON.stringify(installed));
  assert.deepEqual(installed.compatibility,{publishedRevision:unapproved,selectedRevision:approved});
  assertBinding(fresh,approved);
  assert.equal(content(path.join(fresh,'.agents'),'rev-parse','origin/master'),unapproved);

  const update = await first('fetch-preview');
  assert.equal(update.http,200,JSON.stringify(update));
  assert.equal(update.exitCode,0,JSON.stringify(update));
  assert.deepEqual(update.compatibility,{publishedRevision:unapproved,selectedRevision:approved});
  assertBinding(existing,approved);
  assert.equal((await first('apply')).exitCode,0);
  const existingRefs = content(path.join(existing,'.agents'),'show-ref');
  const retained = await first('fetch-preview');
  assert.equal(retained.exitCode,0,JSON.stringify(retained));
  assert.deepEqual(retained.compatibility,{publishedRevision:unapproved,selectedRevision:approved});
  assert.equal(content(path.join(existing,'.agents'),'show-ref'),existingRefs);

  git(mirror,'update-ref',master,original,unapproved);
  assert.equal((await second('fetch-preview')).error,'published-history-mismatch');
  assertBinding(fresh,approved);

  git(mirror,'update-ref',master,rewritten,original);
  const blocked = project('Unpublished revision');
  const third = await openWorkbench(stage,blocked,env,stop);
  assert.equal((await third('install')).error,'install-failed');
  assert.deepEqual(fs.readdirSync(blocked),['business.txt']);
  assert.equal((await first('fetch-preview')).error,'unknown-tree');
  assertBinding(existing,approved);

  const direct = execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
    '-File',path.join(repo,'scripts/update-agents.ps1'),'-ProjectRoot',fresh,'-Mode','Check','-NoPull'],{
    cwd:fresh,env:{...env,GIT_ALLOW_PROTOCOL:'',GIT_NO_LAZY_FETCH:'1'},windowsHide:true,encoding:'utf8',
  });
  assert.match(direct,/Check/);
  assertBinding(fresh,approved);
});
