'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {resolveWorkspaceContext, workspaceContextBlockers} = require('../lib/workspace-context');
const repo = path.resolve(__dirname, '../..');
const tools = path.join(repo, 'plugins/coding-iris-plugin/scripts/iris-tools');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-preflight-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, '.agents/.git'), {recursive: true});
  return root;
}

test('all context filesystem errors block deployment, while a standard workspace passes', t => {
  const root = fixture(t);
  const context = resolveWorkspaceContext(root);
  assert.deepEqual(workspaceContextBlockers(context), []);
  fs.rmdirSync(path.join(root, '.agents/.git'));
  assert.deepEqual(workspaceContextBlockers(context).map(x => x.status), ['capability-git-missing']);
  fs.mkdirSync(path.join(root, '.agents/.git'));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  const alias = path.join(root, 'alias');
  fs.mkdirSync(alias);
  const manifest = {schemaVersion: 1, mode: 'workspace-overlay', workspace: 'test', contextRoot: '.agents',
    capabilityRoot: '.agents', sharedDirectories: [], localDirectories: [],
    sourceRoots: [{name: 'backend', path: 'alias', target: source, gitRoot: source}]};
  fs.writeFileSync(path.join(root, '.agents/capability.json'), JSON.stringify(manifest));
  assert.ok(workspaceContextBlockers(resolveWorkspaceContext(root)).some(x => x.status === 'source-path-not-junction'));
  fs.rmdirSync(alias);
  fs.symlinkSync(source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(workspaceContextBlockers(resolveWorkspaceContext(root)), []);
  fs.unlinkSync(alias);
});

test('deployment and configuration CLIs reject invalid contexts before reading config or connecting', t => {
  const root = fixture(t);
  fs.rmdirSync(path.join(root, '.agents/.git'));
  const probe = path.join(root, 'config-read-probe.cjs');
  const configPaths = [path.join(root, '.agents/config/project-env.json'), path.join(root, '.mcp.json')];
  fs.writeFileSync(probe, `const fs=require('node:fs'),path=require('node:path');const original=fs.readFileSync;
const forbidden=${JSON.stringify(configPaths)};
fs.readFileSync=function(file,...args){if(forbidden.includes(path.resolve(String(file))))process.exit(77);return original.call(this,file,...args);};`);
  for (const [script, args] of [
    ['compile.js', ['--project-root', root, '--files', 'Sample.cls', '--execute']],
    ['deploy-frontend.js', ['--project-root', root, '--source-root', '.', '--files', 'page.csp', '--execute']],
    ['compile-csp.js', ['--project-root', root, '--documents', 'web/csp/page.csp', '--execute']],
    ['sftp-config.js', [root, '.agents', 'Write']],
  ]) {
    const output = spawnSync(process.execPath, ['--require', probe, path.join(tools, script), ...args], {encoding: 'utf8', windowsHide: true, timeout: 30000});
    assert.equal(output.status, 1, `${script}: ${output.stdout} ${output.stderr}`);
    assert.match(output.stdout + output.stderr, /invalid-workspace-context|Invalid workspace context|config-migration-failed/i);
    assert.equal(fs.existsSync(path.join(root, '.mcp.json')), false);
  }
});
