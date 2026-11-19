'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const io = require('../../../scripts/lib/configuration-file-io');
const { initializeConfiguration, loadSettings } = require('../../../scripts/lib/knowledge-embedding');
const { createSettings } = require('../prototype/personal-settings');

test('JSONC field edits preserve surrounding sections and reject ambiguous input', () => {
  const input = '\uFEFF{\r\n  // project\r\n  "url": "https://example.invalid/*",\r\n  "plugins": { "example": false } /* unchanged */\r\n}\r\n';
  const output = io.edit(input, [{path:['plugins','example'],value:true}]);
  assert.equal(output, input.replace('false', 'true'));
  assert.equal(io.parse(output).plugins.example, true);
  for (const invalid of ['[]', '{"a":}', '{"x":{"a":1,"a":2}}']) {
    assert.throws(() => io.parse(invalid));
  }
});

test('knowledge owner reads edits to the explicitly bound private JSONC file', t => {
  const parent = path.join(os.tmpdir(), 'Codex');
  fs.mkdirSync(parent, {recursive:true});
  const root = fs.mkdtempSync(path.join(parent, 'workbench-config-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const file = path.join(root, 'knowledge.jsonc');
  initializeConfiguration(file);
  const input = '\uFEFF' + fs.readFileSync(file,'utf8').replace('{','{\n  // private settings').replaceAll('\n','\r\n');
  fs.writeFileSync(file,input);
  const env = {KNOWLEDGE_RAG_CONFIG:file};
  const service = createSettings(env);
  const revision = service.inspect('knowledge').revision;
  const {planId} = service.plan('knowledge',{revision,changes:{defaultProvider:{value:'openai'}}});
  service.apply(planId);
  assert.equal(loadSettings(env).defaultProvider, 'openai');
  assert.equal(fs.readFileSync(file,'utf8'), input.replace('"defaultProvider": "company"','"defaultProvider": "openai"'));
});

test('policy migration rejects conflicting or invalid sources and preserves neighboring comments on rollback', t => {
  const policy = require('../../../scripts/lib/project-deployment-policy');
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'workbench-policy-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const dir = path.join(root,'config');
  fs.mkdirSync(dir);
  const main = path.join(dir,'project.jsonc');
  const legacy = path.join(dir,'plugin-deployment.json');
  const old = {schema:'plugin-deployment/v1',mode:'on-demand',autoInstall:false,custom:'extra'};
  fs.writeFileSync(legacy,JSON.stringify(old));
  fs.writeFileSync(main,'{ broken');
  assert.throws(()=>policy.read(root),/Invalid JSONC/);
  assert.equal(fs.readFileSync(legacy,'utf8'),JSON.stringify(old));
  fs.writeFileSync(main,JSON.stringify({deployment:old}));
  assert.throws(()=>policy.save(root,old),/Conflicting/);
  fs.writeFileSync(main,'{\n  "other": 42 // preserve previous section comment\n}\n');
  policy.save(root,policy.read(root).value);
  assert.equal(fs.existsSync(legacy),false);
  const unchanged = fs.readFileSync(main,'utf8');
  policy.save(root,policy.read(root).value);
  assert.equal(fs.readFileSync(main,'utf8'),unchanged);
  policy.rollback(root);
  assert.deepEqual(JSON.parse(fs.readFileSync(legacy,'utf8')),old);
  assert.equal(io.parse(fs.readFileSync(main,'utf8')).other,42);
  assert.match(fs.readFileSync(main,'utf8'),/preserve previous section comment/);
});
test('plugin state migration preserves custom columns, local policy and comments across activation and rollback', t => {
  const profile = require('../../../scripts/lib/project-plugin-profile');
  const policy = require('../../../scripts/lib/project-deployment-policy');
  const parent = path.join(os.tmpdir(),'Codex');
  fs.mkdirSync(parent,{recursive:true});
  const root = fs.mkdtempSync(path.join(parent,'workbench-profile-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const {dir,main,legacy} = profile.locations(root);
  fs.mkdirSync(dir);
  fs.writeFileSync(main,'\uFEFF{\r\n  // keep unrelated\r\n  "other": {"x":17}\r\n}\r\n');
  const old = '| plugin | status | notes | custom |\n|---|---|---|---|\n| example | Initialized | 原备注 | 保留 |\n';
  fs.writeFileSync(legacy,old);
  policy.save(root,{schema:'plugin-deployment/v1',mode:'on-demand',autoInstall:false});
  profile.save(root,{example:{status:'disabled'}});
  assert.equal(fs.existsSync(legacy),false);
  assert.equal(profile.read(root).entries.example.custom,'保留');
  policy.save(root,{...policy.read(root).value,autoInstall:true});
  assert.equal(profile.read(root).entries.example.status,'disabled');
  assert.match(fs.readFileSync(main,'utf8'),/\/\/ keep unrelated\r\n  "other": \{"x":17\}/);
  fs.writeFileSync(legacy,old);
  assert.throws(()=>profile.read(root),/Conflicting/);
  fs.unlinkSync(legacy);
  profile.rollback(root);
  assert.equal(profile.read(root).entries.example.custom,'保留');
  assert.equal(policy.read(root).value.autoInstall,true);
  fs.appendFileSync(legacy,'\n## 项目规则\n本段由项目维护。\n');
  const before = fs.readFileSync(legacy);
  assert.throws(()=>profile.save(root,{example:{status:'available'}}),/prose/);
  assert.deepEqual(fs.readFileSync(legacy),before);
});
