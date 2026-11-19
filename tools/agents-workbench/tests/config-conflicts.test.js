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

test('configuration conflicts stay scoped across the real Workbench routes', async t => {
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
    const post = (route,body) => fetch(base+route,{method:'POST',headers:{...headers,origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
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
    assert.equal((await post('/settings/plan/project',{revision:settings.revision,changes:{host:{value:'other.invalid'}}})).status,409);
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
    assert.equal((await post('/settings/plan/project',{revision:settings.revision,changes:{'deployment.autoInstall':{value:false}}})).status,409);
    await assertIndependentPages();
    assert.deepEqual(content(directory),before);
  } finally { server.kill(); await stopped; }
});
