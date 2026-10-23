'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { taskRoot, formRoot, privateRoot, registerPreview } = require('../../plugins/iris-cure-form-dev/scripts/cure-form-workspace');
const { createMount, validateMount } = require('../../plugins/iris-cure-form-dev/scripts/cure-form-preview-mounts');
const { startPreviewServer } = require('../../plugins/iris-cure-form-dev/scripts/cure-form-browser-runner');

test('task outputs share one root without modifying framework configuration', (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cure-workspace-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const args = { projectRoot, taskId: 'task-one' };
  assert.equal(taskRoot(args), path.join(projectRoot, 'docs/work/cure-form/task-one'));
  assert.equal(formRoot(args, 'Example'), path.join(taskRoot(args), 'Example'));
  assert.equal(fs.readFileSync(path.join(privateRoot(args), '.gitignore'), 'utf8'), '*\n');
  const readme = registerPreview(args, 'Example', path.join(formRoot(args, 'Example'), 'preview/preview.html'));
  fs.appendFileSync(readme, '\nUser notes\n');
  registerPreview(args, 'Another', path.join(formRoot(args, 'Another'), 'preview/preview.html'));
  const text = fs.readFileSync(readme, 'utf8');
  assert.match(text, /Example preview/); assert.match(text, /Another preview/); assert.match(text, /User notes/);
  assert.equal(fs.existsSync(path.join(projectRoot, '.agents')), false);
  assert.throws(() => taskRoot({ ...args, taskId: '../unsafe' }), /safe single/);
});

test('localhost serves hash-bound vendor read-only and denies private files', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cure-mount-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vendor = path.join(root, 'vendor'), preview = path.join(root, 'preview');
  fs.mkdirSync(vendor); fs.mkdirSync(preview); fs.mkdirSync(path.join(preview, 'private'));
  fs.writeFileSync(path.join(vendor, 'example.css'), 'body { color: red; }');
  fs.writeFileSync(path.join(vendor, 'secret.json'), '{"secret":true}');
  fs.writeFileSync(path.join(preview, 'preview.html'), '<html>preview</html>');
  fs.writeFileSync(path.join(preview, 'private', 'snapshot.json'), '{}');
  const mount = createMount(vendor);
  validateMount(mount, vendor);
  assert.equal(mount.files.length, 1);
  assert.throws(() => validateMount(mount, preview), /not explicitly allowed/);
  const served = await startPreviewServer(preview, mount);
  t.after(() => new Promise((resolve) => served.server.close(resolve)));
  const request = (url, method = 'GET') => fetch(served.origin + url, { method });
  assert.equal((await request('/__cure_vendor/hisui/example.css')).status, 200);
  assert.equal(await (await request('/__cure_vendor/hisui/example.css', 'HEAD')).text(), '');
  assert.equal((await request('/__cure_vendor/hisui/example.css', 'POST')).status, 405);
  for (const url of ['/private/snapshot.json', '/%70rivate/snapshot.json', '/__cure_vendor/hisui/secret.json', '/.gitignore']) assert.equal((await request(url)).status, 404);
  fs.writeFileSync(path.join(vendor, 'example.css'), 'changed');
  assert.throws(() => validateMount(mount, vendor), /changed/);
  assert.equal((await request('/__cure_vendor/hisui/example.css')).status, 404);
});


test('governed new tasks use local work while explicit and existing tasks remain recoverable', (t) => {
  const projectRoot=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'cure-governed-'));
  t.after(()=>fs.rmSync(projectRoot,{recursive:true,force:true}));
  const put=(file,value)=>{const target=path.join(projectRoot,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);};
  const manifest=fs.readFileSync(path.resolve(__dirname,'../../plugins/iris-cure-form-dev/.agents-plugin/plugin.json'));
  put('.agents/plugins/iris-cure-form-dev/.agents-plugin/plugin.json',manifest);
  put('.agents/config/plugin_profile.md','| iris-cure-form-dev | enabled |\n');
  put('.agents/config/documentation-layout.json',JSON.stringify({schema:'imedical-documentation-layout/v1',enabled:true,workspaceRoot:projectRoot,extensions:[]}));
  const args={projectRoot,taskId:'new-task'};assert.equal(taskRoot(args),path.join(projectRoot,'.agents/work/cure-form/new-task'));
  const privatePath=privateRoot(args);assert.equal(fs.readFileSync(path.join(privatePath,'.gitignore'),'utf8'),'*\n');
  fs.mkdirSync(path.join(projectRoot,'docs/work/cure-form/old-task'),{recursive:true});assert.equal(taskRoot({...args,taskId:'old-task'}),path.join(projectRoot,'docs/work/cure-form/old-task'));
  assert.equal(taskRoot({...args,workRoot:'custom/output'}),path.join(projectRoot,'custom/output'));
  put('.agents/config/cure_form_profile.md','- WorkRoot: docs/custom-cure\n');assert.equal(taskRoot({...args,taskId:'profile-task'}),path.join(projectRoot,'docs/custom-cure/profile-task'));
});
