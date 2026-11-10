'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveWorkspaceContext, validateWorkspaceContext, workspaceContextBlockers, resolveSourceFilePath, resolveGitRootForPath } = require('../lib/workspace-context');
const { sync } = require('../sync-runtime-skills');
const handoff = require('../../plugins/agent-context-kit/scripts/task-handoff');
const menu = require('../../plugins/coding-iris-plugin/scripts/iris-tools/sync-menu');

function git(root, ...args) {
  const output = spawnSync('git', ['--no-optional-locks', '-C', root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(output.status, 0, output.stderr || output.error?.message);
  return output.stdout.trim();
}
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function fixture(t) {
  const base = path.join(fs.realpathSync(process.env.AGENTS_TEST_TEMP || os.tmpdir()), 'Codex');
  fs.mkdirSync(base, { recursive: true });
  const parent = fs.mkdtempSync(path.join(base, 'overlay-source-'));
  t.after(() => {
    assert.equal(path.dirname(parent), base);
    function unlinkLinks(directory) {
      for (const name of fs.readdirSync(directory)) {
        const file = path.join(directory, name), stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) fs.unlinkSync(file);
        else if (stat.isDirectory()) unlinkLinks(file);
      }
    }
    unlinkLinks(parent);
    fs.rmSync(parent, { recursive: true });
    assert.equal(fs.existsSync(parent), false);
  });
  const root = path.join(parent, 'workspace'), capability = path.join(parent, 'capability');
  fs.mkdirSync(capability);
  git(capability, 'init', '-q');
  write(path.join(root, '.agents/skills/sample/SKILL.md'), '# Sample');
  const code = path.join(root, 'code');
  fs.mkdirSync(code);
  git(code, 'init', '-q');
  write(path.join(code, 'src/Sample.cls'), 'Class Sample {}\n');
  const manifest = { schemaVersion: 1, mode: 'workspace-overlay', workspace: 'fixture', contextRoot: '.agents', capabilityRoot: capability,
    sharedDirectories: [], localDirectories: ['skills'], sourceRoots: [{ name: 'backend', path: 'code', target: 'code', gitRoot: 'code' }] };
  const save = () => write(path.join(root, '.agents/capability.json'), JSON.stringify(manifest));
  save();
  return { root, code, parent, capability, manifest, save, context: () => resolveWorkspaceContext(root) };
}

test('physical SourceRoot supports existing, new and deleted paths, separate Git roots and read-only consumers', t => {
  const f = fixture(t), before = git(f.code, 'status', '--porcelain=v1');
  assert.deepEqual(workspaceContextBlockers(f.context()), []);
  assert.equal(validateWorkspaceContext(f.context()).filter(r => r.status === 'source-directory-ok').length, 1);
  for (const file of ['src/Sample.cls', 'src/new/fresh.cls', 'src/deleted.cls']) {
    if (file.includes('deleted')) { write(path.join(f.code, file), 'deleted'); fs.unlinkSync(path.join(f.code, file)); }
    assert.equal(resolveSourceFilePath(f.context(), `code/${file}`), path.join(f.code, file));
    assert.equal(resolveSourceFilePath(f.context(), path.join(f.code, file)), path.join(f.code, file));
  }
  const other = path.join(f.root, 'frontend');
  fs.mkdirSync(other); git(other, 'init', '-q');
  f.manifest.sourceRoots.push({ name: 'frontend', path: 'frontend', target: 'frontend', gitRoot: 'frontend' }); f.save();
  assert.deepEqual(workspaceContextBlockers(f.context()), []);
  assert.equal(resolveGitRootForPath(f.context(), path.join(other, 'new.js')).gitRoot, other);
  assert.equal(resolveSourceFilePath(f.context(), 'frontend/new.js'), path.join(other, 'new.js'));
  for (const mode of ['Check', 'DryRun']) assert.equal(sync({ projectRoot: f.root, runtime: 'CodeBuddy', mode }).status, 'runtime-adapter-planned');
  assert.equal(fs.existsSync(path.join(f.root, '.codebuddy')), false);
  assert.equal(handoff.workspace(f.root).context.mode, 'workspace-overlay');
  assert.equal(menu.resolveProject(f.root).mode, 'workspace-overlay');
  assert.equal(git(f.code, 'status', '--porcelain=v1'), before);
});

test('physical SourceRoot rejects files, missing directories, false Git roots and metadata', t => {
  const f = fixture(t);
  f.manifest.sourceRoots[0].gitRoot = '.'; f.save();
  assert.ok(workspaceContextBlockers(f.context()).some(r => r.status === 'source-directory-invalid'));
  f.manifest.sourceRoots[0] = { name: 'backend', path: 'missing', target: 'missing', gitRoot: 'missing' }; f.save();
  assert.ok(workspaceContextBlockers(f.context()).some(r => r.status === 'source-path-missing'));
  write(path.join(f.root, 'file'), 'keep');
  f.manifest.sourceRoots[0] = { name: 'backend', path: 'file', target: 'file', gitRoot: 'file' }; f.save();
  assert.ok(workspaceContextBlockers(f.context()).some(r => r.status === 'source-directory-invalid'));
  assert.equal(fs.readFileSync(path.join(f.root, 'file'), 'utf8'), 'keep');
  f.manifest.sourceRoots[0] = { name: 'backend', path: 'code/.git', target: 'code/.git', gitRoot: 'code' }; f.save();
  assert.ok(workspaceContextBlockers(f.context()).some(r => r.status === 'source-directory-invalid'));
  f.manifest.sourceRoots[0] = { name: 'backend', path: 'code', target: 'code', gitRoot: 'code' }; f.save();
  assert.throws(() => resolveSourceFilePath(f.context(), 'code/.git/config'), /Git metadata/);
  assert.throws(() => resolveSourceFilePath(f.context(), 'code/../../outside.cls'), /not inside a declared SourceRoot/);
});

test('physical SourceRoot rejects context/capability overlap and a repository inherited from a parent', t => {
  const f = fixture(t);
  for (const source of ['.agents', '.agents/skills']) {
    f.manifest.sourceRoots[0] = { name: 'backend', path: source, target: source, gitRoot: source }; f.save();
    assert.ok(workspaceContextBlockers(f.context()).some(r => r.status === 'source-directory-invalid'));
  }
  f.manifest.sourceRoots[0] = { name: 'backend', path: 'code', target: 'code', gitRoot: 'code' };
  f.manifest.capabilityRoot = f.code; f.save();
  assert.ok(workspaceContextBlockers(f.context()).some(r => r.status === 'source-directory-invalid'));
  f.manifest.capabilityRoot = f.capability;
  const inherited = path.join(f.code, 'src');
  f.manifest.sourceRoots[0] = { name: 'backend', path: 'code/src', target: 'code/src', gitRoot: 'code/src' }; f.save();
  assert.ok(workspaceContextBlockers(f.context()).some(r => r.status === 'source-directory-invalid'));
  f.manifest.sourceRoots[0].gitRoot = 'code'; f.save();
  assert.deepEqual(workspaceContextBlockers(f.context()), []);
  assert.equal(resolveSourceFilePath(f.context(), 'code/src/new.cls'), path.join(inherited, 'new.cls'));
});

test('links cannot masquerade as physical sources or escape them; legacy Junction remains compatible', t => {
  const f = fixture(t), linkType = process.platform === 'win32' ? 'junction' : 'dir';
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.code, alias, linkType);
  f.manifest.sourceRoots[0] = { name: 'backend', path: 'alias', target: 'alias', gitRoot: 'code' }; f.save();
  assert.ok(workspaceContextBlockers(f.context()).some(r => r.status === 'source-directory-invalid'));
  f.manifest.sourceRoots[0] = { name: 'backend', path: 'alias/src', target: 'alias/src', gitRoot: 'code' }; f.save();
  assert.ok(workspaceContextBlockers(f.context()).some(r => r.status === 'source-directory-invalid'));
  f.manifest.sourceRoots[0] = { name: 'backend', path: 'alias', target: 'code', gitRoot: 'code' }; f.save();
  assert.deepEqual(workspaceContextBlockers(f.context()), []);
  assert.equal(resolveSourceFilePath(f.context(), 'alias/src/Sample.cls'), path.join(f.code, 'src/Sample.cls'));
  f.manifest.sourceRoots[0] = { name: 'backend', path: 'code', target: 'code', gitRoot: 'code' }; f.save();
  fs.symlinkSync(f.capability, path.join(f.code, 'outside'), linkType);
  assert.throws(() => resolveSourceFilePath(f.context(), 'code/outside/new.cls'), /escapes declared SourceRoot/);
  fs.symlinkSync(path.join(f.parent, 'missing'), path.join(f.code, 'dangling'), linkType);
  assert.throws(() => resolveSourceFilePath(f.context(), 'code/dangling/new.cls'));
  fs.mkdirSync(path.join(f.code, 'nested')); git(path.join(f.code, 'nested'), 'init', '-q');
  assert.throws(() => resolveSourceFilePath(f.context(), 'code/nested/new.cls'), /GitRoot does not match/);
});
