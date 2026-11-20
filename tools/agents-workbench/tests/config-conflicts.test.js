'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');

function content(root) {
  const files = {};
  function walk(directory) {
    for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const file = path.join(directory,entry.name);
      if (entry.isDirectory()) walk(file);
      else files[path.relative(root,file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
  walk(root);
  return files;
}

test('configuration writes require the bound session and conflicts stay scoped across the Workbench routes', async t => {
  const directory = createTempDirectory('workbench-configuration-conflicts-');
  t.after(() => {
    assert.ok(ownsTempDirectory(directory));
    fs.rmSync(directory,{recursive:true,force:true,maxRetries:3});
  });
  const root = path.join(directory,'工程');
  const cap = path.join(root,'.agents');
  const config = path.join(cap,'config');
  const knowledge = path.join(cap,'plugins/imedical-ui/references');
  for (const dir of [path.join(root,'.vscode'),config,knowledge,path.join(cap,'.git')]) fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(root,'.vscode/settings.json'),JSON.stringify({
    'objectscript.conn':{server:'fixture',ns:'FIXTURE'},
    'intersystems.servers':{fixture:{webServer:{host:'fixture.invalid',port:52773,scheme:'http'}}},
  }));
  fs.writeFileSync(path.join(knowledge,'fixture.md'),'# 检索夹具\n\n表单标签对齐需要核对网格。\n');
  const privateFile = path.join(directory,'knowledge-private.json');
  fs.writeFileSync(privateFile,JSON.stringify({schema:'knowledge-rag-config/v1',defaultProvider:'openai',providers:{
    openai:{model:'fixture-model',apiKey:crypto.randomBytes(24).toString('hex')},
  }}));
  const main = path.join(config,'project.jsonc');
  fs.writeFileSync(main,JSON.stringify({
    plugins:{'agent-context-kit':{status:'enabled'}}, irisDevelopment:{developmentMode:'connected'},
    deployment:{schema:'plugin-deployment/v1',mode:'on-demand',autoInstall:true},
  }));
  const pluginLegacy = path.join(config,'plugin_profile.md');
  fs.writeFileSync(pluginLegacy,'| plugin | status |\n|---|---|\n| agent-context-kit | disabled |\n');

  const server = fork(path.join(__dirname,'../prototype/serve.js'),['--project',root],{
    env:{...process.env,KNOWLEDGE_RAG_CONFIG:privateFile,BOS_MCP_CONFIG:'',PORT:'0',GIT_ALLOW_PROTOCOL:'',GIT_NO_LAZY_FETCH:'1'},silent:true,
  });
  const stopped = once(server,'exit');
  try {
    const [ready] = await Promise.race([once(server,'message'),stopped.then(() => {throw Error('Workbench exited');})]);
    const base = new URL(ready.address).origin;
    const headers = {'x-workbench-request':'1'};
    const get = route => fetch(base+route,{headers});
    function post(route,body,requestHeaders = {},destination = base) {
      return fetch(destination+route,{method:'POST',headers:{...headers,origin:destination,
        'content-type':'application/json',...requestHeaders},body:JSON.stringify(body)});
    }
    async function openSession(ready) {
      const response = await post('/framework/session',{token:ready.bootstrap},{},new URL(ready.address).origin);
      assert.equal(response.status,200);
      const cookie = response.headers.get('set-cookie');
      assert.match(cookie, /; HttpOnly; SameSite=Strict; Path=\/framework\//);
      const { csrf } = await response.json();
      return {cookie:cookie.split(';',1)[0],'x-workbench-csrf':csrf};
    }
    const auth = await openSession(ready);
    async function read(route) {
      const response = await get(route);
      assert.equal(response.status,200,route);
      return response.json();
    }
    async function assertIndependentPages() {
      assert.ok((await read('/manuals.json')).length);
      assert.ok((await read('/catalog.json')).plugins.length);
      const response = await post('/knowledge/query',{query:'标签对齐',domain:'ui'});
      assert.equal(response.status,200);
      assert.equal((await response.json()).matches[0].path,'plugins/imedical-ui/references/fixture.md');
      const settings = await read('/settings/knowledge');
      const key = settings.fields.find(field => field.id === 'providers.openai.apiKey');
      assert.equal(key.configured,true);
      assert.equal(Object.hasOwn(key,'value'),false);
    }
    let before = content(directory);
    let summary = await read('/project.json');
    assert.match(summary.pluginIssue,/plugin_profile\.md/);
    assert.deepEqual(summary.plugins,[]);
    assert.equal(summary.configIssue,undefined);
    assert.equal(summary.domains.find(domain => domain.name === '开发方式').status,'已真实读取');
    let settings = await read('/settings/project');
    assert.equal(settings.fields.find(field => field.id === 'host').value,'fixture.invalid');
    assert.ok(!settings.fields.find(field => field.id === 'host').readOnly);
    assert.ok(!settings.fields.find(field => field.id === 'deployment.autoInstall').readOnly);
    await assertIndependentPages();
    assert.deepEqual(content(directory),before);

    fs.unlinkSync(pluginLegacy);
    fs.writeFileSync(path.join(config,'iris-development.json'),'{"developmentMode":"offline"}');
    before = content(directory);
    summary = await read('/project.json');
    assert.match(summary.domains.find(domain => domain.name === '开发方式').issue,/iris-development\.json/);
    assert.deepEqual(summary.plugins,[{name:'agent-context-kit',status:'enabled'}]);
    assert.equal(summary.pluginIssue,undefined);
    settings = await read('/settings/project');
    assert.ok(settings.fields.find(field => field.id === 'irisDevelopment.issue').readOnly);
    assert.ok(!settings.fields.find(field => field.id === 'deployment.autoInstall').readOnly);
    assert.ok(settings.fields.find(field => field.id === 'host').readOnly);
    assert.equal((await post('/framework/settings/plan/project',{revision:settings.revision,changes:{host:{value:'other.invalid'}}},auth)).status,409);
    await assertIndependentPages();
    assert.deepEqual(content(directory),before);

    fs.writeFileSync(main,'{"plugins":\n');
    before = content(directory);
    summary = await read('/project.json');
    assert.match(summary.configIssue,/config\/project\.jsonc/);
    assert.equal(summary.pluginIssue,summary.configIssue);
    assert.deepEqual(summary.plugins,[]);
    settings = await read('/settings/project');
    for (const name of ['deployment.issue','irisDevelopment.issue','irisConnections.issue','host']) {
      assert.ok(settings.fields.find(field => field.id === name).readOnly,name);
    }
    assert.equal((await post('/framework/settings/plan/project',{revision:settings.revision,changes:{'deployment.autoInstall':{value:false}}},auth)).status,409);
    await assertIndependentPages();
    assert.deepEqual(content(directory),before);

    const otherRoot = path.join(directory,'另一工程');
    fs.mkdirSync(otherRoot);
    const other = fork(path.join(__dirname,'../prototype/serve.js'),['--project',otherRoot],{
      env:{...process.env,PORT:'0',GIT_ALLOW_PROTOCOL:'',GIT_NO_LAZY_FETCH:'1'},silent:true,
    });
    const otherStopped = once(other,'exit');
    let otherAuth;
    try {
      const [otherReady] = await Promise.race([once(other,'message'),otherStopped.then(() => {throw Error('Other Workbench exited');})]);
      otherAuth = await openSession(otherReady);
    } finally { other.kill(); await otherStopped; }

    const settingsBefore = await read('/settings/knowledge');
    const draft = {revision:settingsBefore.revision,changes:{'providers.openai.model':{value:'fixture-model-updated'}}};
    const planRoute = '/framework/settings/plan/knowledge';
    before = content(directory);
    for (const domain of ['project','bos','knowledge']) {
      const response = await post(`/framework/settings/plan/${domain}`,draft);
      assert.equal(response.status,403);
      assert.equal((await response.json()).error,'session-required');
    }
    assert.equal((await post('/settings/plan/knowledge',draft,auth)).status,405);
    assert.equal((await post(planRoute,draft,{cookie:auth.cookie})).status,403);
    assert.equal((await post(planRoute,draft,otherAuth)).status,403);
    assert.equal((await post(planRoute,draft,{...auth,origin:'null'})).status,403);
    assert.equal((await post(planRoute,{...draft,projectId:'foreign'},auth)).status,400);
    assert.equal((await post(planRoute,{...draft,changes:{padding:'过'.repeat(12000)}},auth)).status,413);
    assert.deepEqual(content(directory),before);

    const preview = await post(planRoute,draft,auth);
    assert.equal(preview.status,200);
    const { planId } = await preview.json();
    assert.deepEqual(content(directory),before);
    const apply = '/framework/settings/apply';
    for (const unapproved of [{},{cookie:auth.cookie},otherAuth]) {
      const response = await post(apply,{planId},unapproved);
      assert.equal(response.status,403);
      assert.equal((await response.json()).error,'session-required');
    }
    assert.equal((await post('/settings/apply',{planId},auth)).status,405);
    assert.equal((await post(apply,{planId,projectId:'foreign'},auth)).status,400);
    assert.deepEqual(content(directory),before);

    const saved = await post(apply,{planId},auth);
    assert.equal(saved.status,200);
    assert.equal((await saved.json()).status,'saved');
    assert.deepEqual({...content(directory),'knowledge-private.json':before['knowledge-private.json']},before);
    const settingsAfter = await read('/settings/knowledge');
    assert.equal(settingsAfter.fields.find(field => field.id === 'providers.openai.model').value,'fixture-model-updated');
    assert.equal(Object.hasOwn(settingsAfter.fields.find(field => field.id === 'providers.openai.apiKey'),'value'),false);
    assert.equal((await post(apply,{planId},auth)).status,409);

    const secondDraft = {revision:settingsAfter.revision,changes:{'providers.openai.model':{value:'fixture-model-next'}}};
    const approvedBeforeReplacement = await post(planRoute,secondDraft,auth);
    assert.equal(approvedBeforeReplacement.status,200);
    const { planId: replacementPlan } = await approvedBeforeReplacement.json();
    const clone = path.join(directory,'同内容工程');
    const originalFiles = content(root);
    fs.mkdirSync(path.join(clone,'.agents','.git'),{recursive:true});
    for (const file of Object.keys(originalFiles)) {
      const destination = path.join(clone,file);
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      fs.writeFileSync(destination,fs.readFileSync(path.join(root,file)));
    }
    assert.deepEqual(content(clone),originalFiles);
    fs.renameSync(root,path.join(directory,'已移走工程'));
    fs.renameSync(clone,root);
    const replaced = content(directory);
    for (const [route, body] of [[apply,{planId:replacementPlan}],[planRoute,secondDraft]]) {
      const rejected = await post(route,body,auth);
      assert.equal(rejected.status,409);
      assert.equal((await rejected.json()).code,'binding-changed');
    }
    assert.deepEqual(content(directory),replaced);
  } finally { server.kill(); await stopped; }
});
