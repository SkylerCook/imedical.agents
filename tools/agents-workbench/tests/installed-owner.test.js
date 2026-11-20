'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { fork, spawnSync } = require('node:child_process');
const { inspectFramework } = require('../src/project-context');

const repo = path.resolve(__dirname, '../../..');
test('installed standard owner Check and local DryRun preserve the project', {skip:process.platform !== 'win32'}, async t => {
  const parent = path.join(os.tmpdir(),'Codex');
  fs.mkdirSync(parent,{recursive:true});
  const root = fs.mkdtempSync(path.join(parent,'workbench-owner-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true,maxRetries:3}));
  const pin = '3246ca4e7442c9e81977626c438922b757efbddb';
  const mirror = fs.mkdtempSync(path.join(parent,'workbench-local-source-'));
  t.after(() => fs.rmSync(mirror,{recursive:true,force:true,maxRetries:3}));
  const origin = 'https://gitee.com/skyler-cook/imedical.agents.git';
  const env = {...process.env, GIT_CONFIG_COUNT:'2',
    GIT_CONFIG_KEY_0:'url.' + mirror.replaceAll('\\','/') + '.insteadOf', GIT_CONFIG_VALUE_0:origin,
    GIT_CONFIG_KEY_1:'protocol.allow', GIT_CONFIG_VALUE_1:'never',
    GIT_ALLOW_PROTOCOL:'file', GIT_TERMINAL_PROMPT:'0'};
  env.PSModulePath = path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules');
  delete env.IMEDICAL_DEPLOYMENT_LOCK;
  function run(program,args) {
    const r = spawnSync(program,args,{cwd:root, env, encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
    if (r.error) throw r.error;
    return r;
  }
  assert.equal(run('git',['clone','--bare','--shared',repo,mirror]).status,0);
  assert.equal(run('git',['--git-dir',mirror,'update-ref','HEAD',pin]).status,0);
  const ps = (file,...args) => run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,...args]);
  assert.equal(run('git',['init','-q']).status,0);
  fs.writeFileSync(path.join(root,'AGENTS.md'),'Existing project instructions');
  fs.writeFileSync(path.join(root,'.mcp.json'),JSON.stringify({mcpServers:{custom:{command:'fixture-never-run'}}}));
  fs.writeFileSync(path.join(root,'business.txt'),'fixture business content');
  const installer = path.join(repo,'scripts/install-agents.ps1');
  const approval = pin + ':f0a05c1ee334f4f37fadaaeb313f9f9c67b93ee0f25938fd9b982a0ce155620c';
  const extra = run('git',['--git-dir',mirror,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',
    'commit-tree',pin+'^{tree}','-p',pin,'-m','Unverified first-install revision']);
  assert.equal(extra.status,0,extra.stderr);
  const unknownRevision = extra.stdout.trim();
  assert.equal(run('git',['--git-dir',mirror,'update-ref','HEAD',unknownRevision,pin]).status,0);
  const refused = ps(installer,'-RuntimeAdapter','Codex','-TrustedRuntimeTree',approval);
  assert.notEqual(refused.status,0);
  assert.match(refused.stderr,/Unrecognized framework/);
  assert.ok(!fs.readdirSync(root).some(name=>name.startsWith('.agents')));
  assert.equal(run('git',['--git-dir',mirror,'update-ref','HEAD',pin,unknownRevision]).status,0);
  const installed = ps(installer,'-RuntimeAdapter','Codex','-TrustedRuntimeTree',approval);
  assert.equal(installed.status,0,installed.stderr);
  const owner = path.join(root,'.agents/scripts/update-agents.ps1');
  function snapshot() {
    const files = {};
    function walk(rel) {
      const full = path.join(root,rel);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) {
        for (const entry of fs.readdirSync(full)) walk(path.join(rel,entry));
      } else if (st.isFile()) files[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      else files[rel] = fs.readlinkSync(full);
    }
    for (const item of ['AGENTS.md','business.txt','.agents/.git/info/sparse-checkout','.agents/config','.agents/skills','.agents/rules','.codex','.mcp.json']) {
      if (fs.existsSync(path.join(root,item))) walk(item);
    }
    return {refs:run('git',['-C','.agents','show-ref']).stdout,revision:run('git',['-C','.agents','rev-parse','HEAD']).stdout.trim(),files};
  }
  const before = snapshot();
  assert.ok(Object.keys(before.files).length > 3, 'expected populated configuration and entries');
  assert.equal(inspectFramework(root).status,'standard');
  assert.deepEqual(snapshot(),before);
  for (const mode of ['Check','DryRun']) {
    const result = ps(owner,'-ProjectRoot',root,'-Mode',mode,'-NoPull');
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(snapshot(),before);
    t.diagnostic(mode + ' exit 0; unchanged HEAD ' + before.revision + ', ' + Object.keys(before.files).length + ' files');
  }
  const server = fork(path.join(repo,'tools/agents-workbench/prototype/serve.js'),['--project',root],{
    env:{...env,PORT:'0'},silent:true
  });
  const stopped = once(server,'exit');
  try {
    const [hello] = await once(server,'message');
    const base = new URL(hello.address).origin;
    const headers = {'x-workbench-request':'1',origin:base,'content-type':'application/json'};
    const post = (endpoint,body,extra={}) => fetch(base+'/framework/'+endpoint,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
    const session = await post('session',{token:hello.bootstrap});
    assert.equal(session.status,200);
    const auth = {cookie:session.headers.get('set-cookie').split(';')[0],'x-workbench-csrf':(await session.json()).csrf};
    const read = async () => (await fetch(base+'/framework.json',{headers})).json();
    const initial = await read();
    const request = {projectId:initial.projectId,revision:pin,action:'refresh'};
    const refresh = await post('action',request,auth);
    assert.equal(refresh.status,200);
    assert.equal((await refresh.json()).revision,pin);
    assert.equal((await read()).observedAt,(await read()).observedAt);
    request.action='check';
    assert.equal((await post('action',request)).status,403);
    assert.equal((await post('action',request,{...auth,origin:'null'})).status,403);
    for (const action of ['check','preview']) {
      const response = await post('action',{...request,action},auth);
      const result = await response.json();
      assert.equal(response.status,200,JSON.stringify(result));
      assert.equal(result.exitCode,0);
      assert.equal(result.after.revision,pin);
      assert.equal((await read()).observedAt,result.after.observedAt);
      assert.deepEqual(snapshot(),before);
      t.diagnostic('HTTP ' + action + ': owner exit 0, refs/sparse/config/files unchanged');
    }
    const lockArgs = [path.join(root,'.agents/scripts/plugin-deploy.js')];
    const held = run(process.execPath,[...lockArgs,'acquire-lock','--project-root',root,'--pid',String(process.pid)]);
    assert.equal(held.status,0);
    try {
      const conflict = await post('action',request,auth);
      assert.equal(conflict.status,200);
      assert.equal((await conflict.json()).exitCode,1);
      assert.deepEqual(snapshot(),before);
    } finally {
      assert.equal(run(process.execPath,[...lockArgs,'release-lock','--project-root',root,'--token',JSON.parse(held.stdout).token]).status,0);
    }
    assert.equal((await post('action',{...request,revision:'stale'},auth)).status,409);
    assert.equal((await post('action',{...request,projectId:'other'},auth)).status,409);
    const prior = await read();
    const child = run('git',['-C','.agents','-c','user.name=Fixture','-c','user.email=fixture@example.invalid',
      'commit-tree',pin+'^{tree}','-p',pin,'-m','Different revision, identical execution tree']);
    assert.equal(child.status,0,child.stderr);
    const newHead = child.stdout.trim();
    assert.equal(run('git',['-C','.agents','update-ref','HEAD',newHead,pin]).status,0);
    try {
      assert.deepEqual(await read(),prior);
      const drift = await post('action',request,auth);
      assert.equal(drift.status,409);
      assert.equal((await drift.json()).before.revision,newHead);
      const refreshed = await post('action',{...request,action:'refresh'},auth);
      assert.equal((await refreshed.json()).revision,newHead);
      const unverified = await post('action',{...request,revision:newHead},auth);
      assert.equal(unverified.status,409);
      assert.equal((await unverified.json()).error,'unknown-tree');
    } finally {
      assert.equal(run('git',['-C','.agents','update-ref','HEAD',pin,newHead]).status,0);
      await post('action',{...request,action:'refresh'},auth);
    }
    const manifest = path.join(root,'.agents/plugins/agent-context-kit/.agents-plugin/plugin.json');
    for (const file of [owner,manifest]) {
      const bytes = fs.readFileSync(file);
      try {
        fs.appendFileSync(file,'\n ');
        const rejected = await post('action',request,auth);
        assert.equal(rejected.status,409);
        assert.equal((await rejected.json()).error,'runtime-modified');
        assert.deepEqual(snapshot(),before);
      } finally { fs.writeFileSync(file,bytes); }
    }
    // Materialize an optional plugin's genuine manifest without its migration script.
    const relative = 'plugins/iris-interface-dev/.agents-plugin/plugin.json';
    const optional = path.join(root,'.agents',relative);
    assert.equal(fs.existsSync(optional),false);
    const metadata = run('git',['-C','.agents','show',pin+':'+relative]);
    assert.equal(metadata.status,0);
    fs.mkdirSync(path.dirname(optional),{recursive:true});
    fs.writeFileSync(optional,metadata.stdout);
    try {
      const rejected = await post('action',request,auth);
      assert.equal(rejected.status,409);
      assert.equal((await rejected.json()).error,'runtime-modified');
      assert.deepEqual(snapshot(),before);
    } finally { fs.unlinkSync(optional); }
    run('git',['-C','.agents','remote','set-url','origin','fixture-unknown']);
    try {
      const unknown = await post('action',request,auth);
      assert.equal(unknown.status,409);
      assert.equal((await unknown.json()).before.status,'unknown-source');
    } finally { run('git',['-C','.agents','remote','set-url','origin',origin]); }
  } finally { server.kill(); await stopped; }
  const lockCli = path.join(root,'.agents/scripts/plugin-deploy.js');
  const lock = run(process.execPath,[lockCli,'acquire-lock','--project-root',root,'--pid',String(process.pid)]);
  assert.equal(lock.status,0,lock.stderr);
  try {
    const blocked = ps(owner,'-ProjectRoot',root,'-Mode','Check','-NoPull');
    assert.equal(blocked.status,1);
    assert.deepEqual(snapshot(),before);
    t.diagnostic('Concurrent Check exit 1; protected files unchanged');
  } finally {
    const released = run(process.execPath,[lockCli,'release-lock','--project-root',root,'--token',JSON.parse(lock.stdout).token]);
    assert.equal(released.status,0,released.stderr);
  }
});
