'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const TOOL_PATH = path.resolve(__dirname, '../../.agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js');
const tool = require(TOOL_PATH);

const BASE_COMMIT = 'c79055e';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'imedical-component-version-'));
}

function writeFile(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function pluginManifest(name, version, options = {}) {
  const dependencies = options.dependencies || [];
  const manifest = {
    name,
    version,
    displayName: name,
    description: `${name} test fixture`,
    entry: 'AGENTS.md',
    skills: 'skills/',
    dependencies
  };
  if (options.dependencyVersions) manifest.dependencyVersions = options.dependencyVersions;
  if (options.legacyNames) manifest.legacyNames = options.legacyNames;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function writePlugin(root, name, version, options = {}) {
  writeFile(root, `plugins/${name}/.agents-plugin/plugin.json`, pluginManifest(name, version, options));
  writeFile(root, `plugins/${name}/AGENTS.md`, `# ${name}\n`);
}

function writeSkill(root, name, version) {
  writeFile(root, `skills/${name}/SKILL.md`, `---\nname: ${name}\nversion: ${version}\ndescription: fixture\n---\n\n# ${name}\n`);
}

function releaseContent(type, name, version, options = {}) {
  const level = options.level || 'baseline';
  const previousVersion = options.previousVersion === undefined ? null : options.previousVersion;
  const breaking = options.breaking === true;
  const status = options.status || 'active';
  const migration = options.migration || (breaking ? 'required' : 'none');
  const migrationBody = migration === 'required' ? '\n## Migration\n\nPerform the documented migration.\n' : '';
  return `---
schema: ${tool.RELEASE_SCHEMA}
component: ${type}
name: ${name}
version: ${version}
previousVersion: ${previousVersion == null ? 'null' : previousVersion}
level: ${level}
breaking: ${breaking}
status: ${status}
date: 2026-08-19
migration: ${migration}
commit: ${options.commit || BASE_COMMIT}
---

# ${name} ${version}
${migrationBody}`;
}

function writeRelease(root, type, name, version, options = {}) {
  writeFile(root, `releases/${type}/${name}/${version}.md`, releaseContent(type, name, version, options));
}

function makeBasicRoot(options = {}) {
  const root = tempRoot();
  const pluginVersion = options.pluginVersion || '0.1.0';
  writePlugin(root, 'sample-plugin', pluginVersion, options.pluginOptions);
  if (options.pluginRelease && options.pluginRelease.previousVersion && options.pluginRelease.previousVersion !== pluginVersion) {
    writeRelease(root, 'plugin', 'sample-plugin', options.pluginRelease.previousVersion);
  }
  writeRelease(root, 'plugin', 'sample-plugin', pluginVersion, options.pluginRelease);
  if (options.withSkill !== false) {
    writeSkill(root, 'sample-skill', '0.1.0');
    writeRelease(root, 'skill', 'sample-skill', '0.1.0');
  }
  return root;
}

function codes(issues) {
  return new Set(issues.map((item) => item.code));
}

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test('real repository exposes 13 plugins and 2 independent skills with valid governance metadata', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const snapshot = tool.buildSnapshot(repoRoot);
  assert.equal([...snapshot.components.values()].filter((item) => item.type === 'plugin').length, 13);
  assert.equal([...snapshot.components.values()].filter((item) => item.type === 'skill').length, 2);
  assert.deepEqual(tool.validateSnapshot(snapshot), []);
});

test('strict SemVer parser rejects prefixes, prereleases, and skipped numeric forms', () => {
  assert.deepEqual(tool.parseSemver('1.2.3'), { raw: '1.2.3', major: 1, minor: 2, patch: 3 });
  for (const value of ['v1.2.3', '1.2', '1.2.3-beta', '01.2.3']) assert.equal(tool.parseSemver(value), null);
});

test('duplicate canonical component names are rejected even when directories differ', () => {
  const root = makeBasicRoot({ withSkill: false });
  writeFile(root, 'plugins/other-directory/.agents-plugin/plugin.json', pluginManifest('sample-plugin', '0.1.0'));
  assert(codes(tool.validateSnapshot(tool.buildSnapshot(root))).has('component-name-duplicate'));
});

test('component changes require a version bump after bootstrap', () => {
  const previousRoot = makeBasicRoot();
  const nextRoot = makeBasicRoot();
  writeFile(nextRoot, 'plugins/sample-plugin/README.md', 'changed\n');
  const result = tool.validateChanges(tool.buildSnapshot(previousRoot), tool.buildSnapshot(nextRoot), ['plugins/sample-plugin/README.md']);
  assert(codes(result.issues).has('component-version-not-bumped'));
});

test('missing release and nonconsecutive bump are rejected', () => {
  const previousRoot = makeBasicRoot();
  const nextRoot = tempRoot();
  writePlugin(nextRoot, 'sample-plugin', '0.1.2');
  writeSkill(nextRoot, 'sample-skill', '0.1.0');
  writeRelease(nextRoot, 'skill', 'sample-skill', '0.1.0');
  const comparison = tool.compareSnapshots(tool.buildSnapshot(previousRoot), tool.buildSnapshot(nextRoot));
  const found = codes(comparison.issues);
  assert(found.has('component-release-missing'));
  assert(found.has('component-version-nonconsecutive'));
});

test('0.x breaking change requires a minor bump and migration', () => {
  const previousRoot = makeBasicRoot();
  const validRoot = makeBasicRoot({
    pluginVersion: '0.2.0',
    pluginRelease: { previousVersion: '0.1.0', level: 'minor', breaking: true, migration: 'required' }
  });
  assert.equal(tool.compareSnapshots(tool.buildSnapshot(previousRoot), tool.buildSnapshot(validRoot)).issues.length, 0);

  const invalidRoot = makeBasicRoot({
    pluginVersion: '0.1.1',
    pluginRelease: { previousVersion: '0.1.0', level: 'patch', breaking: true, migration: 'required' }
  });
  assert(codes(tool.compareSnapshots(tool.buildSnapshot(previousRoot), tool.buildSnapshot(invalidRoot)).issues).has('breaking-version-level-invalid'));
});

test('1.x breaking change requires a major bump', () => {
  const previousRoot = makeBasicRoot({ pluginVersion: '1.0.0', pluginRelease: { level: 'baseline' } });
  const validRoot = makeBasicRoot({
    pluginVersion: '2.0.0',
    pluginRelease: { previousVersion: '1.0.0', level: 'major', breaking: true, migration: 'required' }
  });
  assert.equal(tool.compareSnapshots(tool.buildSnapshot(previousRoot), tool.buildSnapshot(validRoot)).issues.length, 0);

  const invalidRoot = makeBasicRoot({
    pluginVersion: '1.1.0',
    pluginRelease: { previousVersion: '1.0.0', level: 'minor', breaking: true, migration: 'required' }
  });
  assert(codes(tool.compareSnapshots(tool.buildSnapshot(previousRoot), tool.buildSnapshot(invalidRoot)).issues).has('breaking-version-level-invalid'));
});

test('release records are immutable', () => {
  const previousRoot = makeBasicRoot();
  const modifiedRoot = makeBasicRoot();
  fs.appendFileSync(path.join(modifiedRoot, 'releases/plugin/sample-plugin/0.1.0.md'), '\nmodified\n');
  assert(codes(tool.compareSnapshots(tool.buildSnapshot(previousRoot), tool.buildSnapshot(modifiedRoot)).issues).has('release-record-modified'));

  const deletedRoot = makeBasicRoot();
  fs.rmSync(path.join(deletedRoot, 'releases/plugin/sample-plugin/0.1.0.md'));
  assert(codes(tool.compareSnapshots(tool.buildSnapshot(previousRoot), tool.buildSnapshot(deletedRoot)).issues).has('release-record-deleted'));
});

test('dependency ranges must match names, contain current versions, and remain acyclic', () => {
  const root = tempRoot();
  writePlugin(root, 'base-plugin', '0.2.0');
  writeRelease(root, 'plugin', 'base-plugin', '0.2.0');
  writePlugin(root, 'consumer-plugin', '0.1.0', {
    dependencies: ['base-plugin'],
    dependencyVersions: { 'base-plugin': { minVersion: '0.1.0', maxVersionExclusive: '0.2.0' }, extra: { minVersion: '0.1.0', maxVersionExclusive: '0.2.0' } }
  });
  writeRelease(root, 'plugin', 'consumer-plugin', '0.1.0');
  let found = codes(tool.validateSnapshot(tool.buildSnapshot(root)));
  assert(found.has('dependency-version-incompatible'));
  assert(found.has('dependency-version-redundant'));

  const cycleRoot = tempRoot();
  writePlugin(cycleRoot, 'a-plugin', '0.1.0', { dependencies: ['b-plugin'], dependencyVersions: { 'b-plugin': { minVersion: '0.1.0', maxVersionExclusive: '0.2.0' } } });
  writePlugin(cycleRoot, 'b-plugin', '0.1.0', { dependencies: ['a-plugin'], dependencyVersions: { 'a-plugin': { minVersion: '0.1.0', maxVersionExclusive: '0.2.0' } } });
  writeRelease(cycleRoot, 'plugin', 'a-plugin', '0.1.0');
  writeRelease(cycleRoot, 'plugin', 'b-plugin', '0.1.0');
  found = codes(tool.validateSnapshot(tool.buildSnapshot(cycleRoot)));
  assert(found.has('dependency-cycle'));
});

test('plugin-internal skills cannot declare independent versions', () => {
  const root = makeBasicRoot();
  writeFile(root, 'plugins/sample-plugin/skills/child/SKILL.md', '---\nname: child\nversion: 9.0.0\ndescription: child\n---\n');
  assert(codes(tool.validateSnapshot(tool.buildSnapshot(root))).has('plugin-internal-version-forbidden'));
});

test('new components require initial release records', () => {
  const previousRoot = makeBasicRoot();
  const nextRoot = makeBasicRoot();
  writePlugin(nextRoot, 'new-plugin', '0.1.0');
  writeRelease(nextRoot, 'plugin', 'new-plugin', '0.1.0', { level: 'initial' });
  assert.equal(tool.compareSnapshots(tool.buildSnapshot(previousRoot), tool.buildSnapshot(nextRoot)).issues.length, 0);

  const invalidRoot = makeBasicRoot();
  writePlugin(invalidRoot, 'new-plugin', '0.1.0');
  writeRelease(invalidRoot, 'plugin', 'new-plugin', '0.1.0', { level: 'baseline' });
  assert(codes(tool.compareSnapshots(tool.buildSnapshot(previousRoot), tool.buildSnapshot(invalidRoot)).issues).has('component-initial-release-invalid'));
});

test('canonical rename requires legacyNames and a breaking migration release', () => {
  const previousRoot = makeBasicRoot({ withSkill: false });
  const nextRoot = tempRoot();
  writePlugin(nextRoot, 'renamed-plugin', '0.2.0', { legacyNames: ['sample-plugin'] });
  writeRelease(nextRoot, 'plugin', 'sample-plugin', '0.1.0');
  writeRelease(nextRoot, 'plugin', 'renamed-plugin', '0.2.0', { previousVersion: '0.1.0', level: 'minor', breaking: true, migration: 'required' });
  assert.equal(tool.compareSnapshots(tool.buildSnapshot(previousRoot), tool.buildSnapshot(nextRoot)).issues.length, 0);
});

test('component removal requires a breaking tombstone release', () => {
  const previousRoot = makeBasicRoot({ withSkill: false });
  const validRoot = tempRoot();
  writeRelease(validRoot, 'plugin', 'sample-plugin', '0.1.0');
  writeRelease(validRoot, 'plugin', 'sample-plugin', '0.2.0', { previousVersion: '0.1.0', level: 'minor', breaking: true, migration: 'required', status: 'removed' });
  assert.equal(tool.compareSnapshots(tool.buildSnapshot(previousRoot), tool.buildSnapshot(validRoot)).issues.length, 0);

  const invalidRoot = tempRoot();
  assert(codes(tool.compareSnapshots(tool.buildSnapshot(previousRoot), tool.buildSnapshot(invalidRoot)).issues).has('component-removal-release-missing'));
});

test('breaking comparison accepts only an exact component and target version', () => {
  const previousRoot = makeBasicRoot();
  const nextRoot = makeBasicRoot({
    pluginVersion: '0.2.0',
    pluginRelease: { previousVersion: '0.1.0', level: 'minor', breaking: true, migration: 'required' }
  });
  const previous = tool.buildSnapshot(previousRoot);
  const next = tool.buildSnapshot(nextRoot);
  assert(codes(tool.compareSnapshots(previous, next, { blockBreaking: true }).issues).has('breaking-upgrade-not-accepted'));
  assert.equal(tool.compareSnapshots(previous, next, { blockBreaking: true, acceptBreaking: ['plugin:sample-plugin@0.2.0'] }).issues.length, 0);
  assert(codes(tool.compareSnapshots(previous, next, { blockBreaking: true, acceptBreaking: ['plugin:sample-plugin@0.3.0'] }).issues).has('breaking-authorization-unused'));
  assert(codes(tool.compareSnapshots(previous, next, { blockBreaking: true, acceptBreaking: ['plugin:*@0.2.0'] }).issues).has('breaking-authorization-invalid'));
});

test('compare CLI audits two Git refs without changing the repository', () => {
  const root = makeBasicRoot({ withSkill: false });
  git(root, 'init');
  git(root, 'config', 'user.email', 'component-version@example.invalid');
  git(root, 'config', 'user.name', 'Component Version Test');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'baseline');
  const fromRef = git(root, 'rev-parse', 'HEAD');
  writePlugin(root, 'sample-plugin', '0.2.0');
  writeRelease(root, 'plugin', 'sample-plugin', '0.2.0', { previousVersion: '0.1.0', level: 'minor', breaking: true, migration: 'required' });
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'breaking release');
  const toRef = git(root, 'rev-parse', 'HEAD');
  const beforeStatus = git(root, 'status', '--porcelain');

  let result = spawnSync(process.execPath, [TOOL_PATH, 'compare', '--repo-root', root, '--from-ref', fromRef, '--to-ref', toRef], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /breaking-upgrade-not-accepted/);
  result = spawnSync(process.execPath, [TOOL_PATH, 'compare', '--repo-root', root, '--from-ref', fromRef, '--to-ref', toRef, '--accept-breaking', 'plugin:sample-plugin@0.2.0'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(git(root, 'status', '--porcelain'), beforeStatus);
});

test('downgrades cannot be authorized', () => {
  const previousRoot = makeBasicRoot({ pluginVersion: '0.2.0', pluginRelease: { level: 'baseline' } });
  const nextRoot = makeBasicRoot();
  const result = tool.compareSnapshots(tool.buildSnapshot(previousRoot), tool.buildSnapshot(nextRoot), { blockBreaking: true, acceptBreaking: ['plugin:sample-plugin@0.1.0'] });
  assert(codes(result.issues).has('component-version-downgrade'));
  assert(codes(result.issues).has('breaking-authorization-unused'));
});
