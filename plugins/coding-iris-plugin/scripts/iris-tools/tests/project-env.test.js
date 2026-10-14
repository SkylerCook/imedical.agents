'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {readProjectEnv, validateTarget} = require('../project-env');
const {spawnSync} = require('node:child_process');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-env-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const context = {mode: 'workspace-overlay', workspaceRoot: root,
    contextRoot: path.join(root, '.agents'), manifest: {projectEnvFallback: 'main/config.json'}};
  fs.mkdirSync(path.join(context.contextRoot, 'config'), {recursive: true});
  fs.mkdirSync(path.join(root, 'main'));
  const config = {iris: {host: 'example.invalid', port: 443, scheme: 'https', namespace: 'TEST'}};
  fs.writeFileSync(path.join(root, 'main/config.json'), JSON.stringify(config));
  return {context, config, local: path.join(context.contextRoot, 'config/project-env.json')};
}

test('explicit fallback reads parent without changing workspace or source boundaries', t => {
  const {context, config, local} = fixture(t);
  const before = JSON.stringify(context);
  assert.deepEqual(readProjectEnv(context).config, config);
  assert.equal(readProjectEnv(context).inherited, true);
  assert.equal(JSON.stringify(context), before);
  assert.equal(fs.existsSync(local), false);
});

test('local file wins completely; invalid or incomplete local never falls back', t => {
  const {context, local} = fixture(t);
  fs.writeFileSync(local, '{}');
  assert.deepEqual(readProjectEnv(context).config, {});
  assert.equal(readProjectEnv(context).inherited, false);
  fs.writeFileSync(local, '{bad');
  assert.throws(() => readProjectEnv(context), /project-env-invalid/);
  fs.writeFileSync(local, 'null');
  assert.throws(() => readProjectEnv(context), /project-env-invalid/);
});

test('no implicit parent search in standard or undeclared overlay', t => {
  const {context} = fixture(t);
  delete context.manifest.projectEnvFallback;
  assert.throws(() => readProjectEnv(context), /project-env-missing/);
  context.mode = 'standard';
  context.manifest.projectEnvFallback = 'main/config.json';
  assert.throws(() => readProjectEnv(context), /project-env-missing/);
});

test('fallback missing, invalid declaration or incomplete target stops', t => {
  const {context} = fixture(t);
  context.manifest.projectEnvFallback = {};
  assert.throws(() => readProjectEnv(context), /project-env-fallback-invalid/);
  context.manifest.projectEnvFallback = 'missing.json';
  assert.throws(() => readProjectEnv(context), /project-env-missing/);
  context.manifest.projectEnvFallback = 'main/config.json';
  fs.writeFileSync(path.join(context.workspaceRoot, 'main/config.json'), '{}');
  assert.throws(() => readProjectEnv(context), /project-env-target-missing/);
});

test('target checks reject host, port, scheme and namespace mismatch without values', t => {
  const {config} = fixture(t);
  const env = {IRIS_HOST: 'example.invalid', IRIS_WEB_PORT: '443', IRIS_SCHEME: 'https', IRIS_NAMESPACE: 'TEST'};
  validateTarget(config, env);
  for (const key of Object.keys(env)) {
    assert.throws(() => validateTarget(config, {...env, [key]: 'different'}), /project-env-target-mismatch/);
  }
});

test('compile CLI inherits config but still rejects a file outside module SourceRoot', t => {
  const {context, config} = fixture(t);
  fs.mkdirSync(path.join(context.contextRoot, '.git'));
  const source = path.join(context.workspaceRoot, 'source');
  fs.mkdirSync(source);
  const alias = path.join(context.workspaceRoot, 'backend');
  fs.symlinkSync(source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => { if (fs.existsSync(alias)) fs.unlinkSync(alias); });
  const manifest = {schemaVersion: 1, mode: 'workspace-overlay', workspace: 'sample', contextRoot: '.agents',
    capabilityRoot: '.agents', sharedDirectories: [], localDirectories: [],
    projectEnvFallback: context.manifest.projectEnvFallback,
    sourceRoots: [{name: 'backend', path: 'backend', target: source, gitRoot: source}]};
  fs.writeFileSync(path.join(context.contextRoot, 'capability.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(context.workspaceRoot, '.mcp.json'), JSON.stringify({mcpServers: {'iris-agentic-dev': {env: {
    IRIS_HOST: config.iris.host, IRIS_WEB_PORT: '443', IRIS_SCHEME: 'https', IRIS_NAMESPACE: 'TEST',
    IRIS_USERNAME: 'test', IRIS_PASSWORD: 'fake'}}}}));
  fs.writeFileSync(path.join(context.workspaceRoot, 'Outside.cls'), 'Class Outside Extends %RegisteredObject {}');
  const run = execute => spawnSync(process.execPath, [path.resolve(__dirname, '../compile.js'), '--project-root',
    context.workspaceRoot, '--files', 'Outside.cls', ...(execute ? ['--execute'] : [])], {encoding: 'utf8', timeout: 10000});
  const plan = run(false);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  assert.equal(JSON.parse(plan.stdout).inherited, true);
  const blocked = run(true);
  assert.equal(blocked.status, 1, blocked.stdout + blocked.stderr);
  assert.match(blocked.stdout, /file-outside-workspace/);
});
