'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const moduleUnderTest = path.join(repoRoot, 'scripts', 'lib', 'workspace-context.js');
assert.ok(fs.existsSync(moduleUnderTest), 'workspace-context.js should exist');

const {
  resolveWorkspaceContext,
  validateWorkspaceContext,
  resolveGitRootForPath,
} = require(moduleUnderTest);

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createDirectoryJunction(target, junctionPath) {
  fs.symlinkSync(target, junctionPath, 'junction');
}

function createFixture(parent, name, options = {}) {
  const root = path.join(parent, name);
  const capabilityRoot = path.join(parent, `${name}-capability`);
  const backendTarget = path.join(parent, `${name}-backend-target`);
  const backendGitRoot = path.join(parent, `${name}-backend-git`);
  const frontendTarget = path.join(parent, `${name}-frontend-target`);
  const frontendGitRoot = path.join(parent, `${name}-frontend-git`);
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.mkdirSync(path.join(capabilityRoot, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(capabilityRoot, 'vendor'), { recursive: true });
  if (!options.skipCapabilityGit) fs.mkdirSync(path.join(capabilityRoot, '.git'));
  fs.mkdirSync(backendTarget);
  fs.mkdirSync(backendGitRoot);
  if (!options.backendOnly) {
    fs.mkdirSync(frontendTarget);
    fs.mkdirSync(frontendGitRoot);
  }

  const sourceRoots = [{
    name: 'backend',
    path: 'backend',
    target: path.relative(root, backendTarget).replaceAll('\\', '/'),
    gitRoot: path.relative(root, backendGitRoot).replaceAll('\\', '/'),
  }];
  if (!options.backendOnly) {
    sourceRoots.push({
      name: 'frontend',
      path: 'frontend',
      target: path.relative(root, frontendTarget).replaceAll('\\', '/'),
      gitRoot: path.relative(root, frontendGitRoot).replaceAll('\\', '/'),
    });
  }

  const manifest = {
    schemaVersion: 1,
    mode: 'workspace-overlay',
    workspace: name,
    contextRoot: '.agents',
    capabilityRoot: path.relative(root, capabilityRoot).replaceAll('\\', '/'),
    sharedDirectories: ['plugins', 'vendor'],
    localDirectories: ['config', 'rules'],
    sourceRoots,
  };
  writeJson(path.join(root, '.agents', 'capability.json'), manifest);

  if (!options.skipLinks) {
    createDirectoryJunction(backendTarget, path.join(root, 'backend'));
    if (!options.backendOnly) createDirectoryJunction(frontendTarget, path.join(root, 'frontend'));
    createDirectoryJunction(path.join(capabilityRoot, 'plugins'), path.join(root, '.agents', 'plugins'));
    createDirectoryJunction(path.join(capabilityRoot, 'vendor'), path.join(root, '.agents', 'vendor'));
    fs.mkdirSync(path.join(root, '.agents', 'config'));
    fs.mkdirSync(path.join(root, '.agents', 'rules'));
  }

  return { root, capabilityRoot, backendTarget, backendGitRoot, frontendTarget, frontendGitRoot };
}

function countStatus(results, status) {
  return results.filter((entry) => entry.status === status).length;
}

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-workspace-context-'));
try {
  const standardRoot = path.join(testRoot, 'standard');
  fs.mkdirSync(standardRoot);
  const standard = resolveWorkspaceContext(standardRoot);
  assert.equal(standard.mode, 'standard');
  assert.equal(standard.workspaceRoot, path.resolve(standardRoot));
  assert.equal(standard.contextRoot, path.join(path.resolve(standardRoot), '.agents'));
  assert.equal(standard.capabilityRoot, standard.contextRoot);
  assert.equal(standard.sourceRoots.length, 1);

  const validFixture = createFixture(testRoot, 'valid');
  const valid = resolveWorkspaceContext(validFixture.root);
  const expectedFields = ['mode', 'workspaceName', 'workspaceRoot', 'contextRoot', 'capabilityRoot', 'manifestPath', 'sharedDirectories', 'localDirectories', 'sourceRoots', 'gitRoots'];
  assert.deepEqual(Object.keys(valid).filter((key) => expectedFields.includes(key)), expectedFields);
  assert.equal(valid.mode, 'workspace-overlay');
  assert.equal(valid.workspaceName, 'valid');
  assert.equal(valid.capabilityRoot, path.resolve(validFixture.capabilityRoot));
  assert.equal(valid.sourceRoots.length, 2);
  assert.equal(valid.gitRoots.length, 2);
  const validResults = validateWorkspaceContext(valid);
  assert.equal(countStatus(validResults, 'workspace-context-resolved'), 1);
  assert.equal(countStatus(validResults, 'junction-ok'), 4);

  const mapped = resolveGitRootForPath(valid, path.join(validFixture.backendTarget, 'src', 'file.cls'));
  assert.equal(mapped.name, 'backend');
  assert.equal(mapped.gitRoot, path.resolve(validFixture.backendGitRoot));
  assert.throws(
    () => resolveGitRootForPath(valid, path.join(testRoot, 'outside', 'file.cls')),
    /not inside a declared source root/,
  );

  const backendOnlyFixture = createFixture(testRoot, 'backend-only', { backendOnly: true });
  const backendOnly = resolveWorkspaceContext(backendOnlyFixture.root);
  assert.equal(backendOnly.sourceRoots.length, 1);
  assert.equal(backendOnly.sourceRoots[0].name, 'backend');

  const invalidRoot = path.join(testRoot, 'invalid-json');
  fs.mkdirSync(path.join(invalidRoot, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(invalidRoot, '.agents', 'capability.json'), '{invalid', 'utf8');
  assert.equal(countStatus(validateWorkspaceContext(resolveWorkspaceContext(invalidRoot)), 'manifest-invalid'), 1);

  const unsupportedFixture = createFixture(testRoot, 'unsupported', { skipLinks: true });
  const unsupportedPath = path.join(unsupportedFixture.root, '.agents', 'capability.json');
  const unsupported = JSON.parse(fs.readFileSync(unsupportedPath, 'utf8'));
  unsupported.schemaVersion = 2;
  writeJson(unsupportedPath, unsupported);
  assert.equal(countStatus(validateWorkspaceContext(resolveWorkspaceContext(unsupportedFixture.root)), 'schema-version-unsupported'), 1);

  const duplicateFixture = createFixture(testRoot, 'duplicate', { skipLinks: true });
  const duplicatePath = path.join(duplicateFixture.root, '.agents', 'capability.json');
  const duplicate = JSON.parse(fs.readFileSync(duplicatePath, 'utf8'));
  duplicate.sourceRoots[1].name = 'backend';
  writeJson(duplicatePath, duplicate);
  assert.equal(countStatus(validateWorkspaceContext(resolveWorkspaceContext(duplicateFixture.root)), 'manifest-invalid'), 1);
} finally {
  const resolved = path.resolve(testRoot);
  const temp = path.resolve(os.tmpdir());
  assert.ok(resolved.startsWith(`${temp}${path.sep}`), 'cleanup root must stay under TEMP');
  fs.rmSync(resolved, { recursive: true, force: true });
}

console.log('workspace context Node.js tests passed');
