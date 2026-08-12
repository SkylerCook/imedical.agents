'use strict';

const fs = require('fs');
const path = require('path');

function normalizePath(value, basePath = process.cwd()) {
  return path.normalize(path.resolve(basePath, value));
}

function comparable(value) {
  const normalized = normalizePath(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathWithin(filePath, rootPath) {
  const file = comparable(filePath);
  const root = comparable(rootPath);
  return file === root || file.startsWith(`${root}${path.sep}`);
}

function result(status, itemPath = '', expected = '', actual = '', reason = '') {
  return { status, path: itemPath, expected, actual, reason };
}

function safeDirectoryName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name !== '.' && name !== '..';
}

function safeRelativePath(value) {
  return typeof value === 'string' && value.trim() !== '' && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..');
}

function manifestProblems(manifest, workspaceRoot = '', contextRoot = '') {
  const problems = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest is empty'];
  const required = ['schemaVersion', 'mode', 'workspace', 'contextRoot', 'capabilityRoot', 'sharedDirectories', 'localDirectories', 'sourceRoots'];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(manifest, key)) problems.push(`missing ${key}`);
  }
  if (manifest.mode !== undefined && manifest.mode !== 'workspace-overlay') problems.push('mode must be workspace-overlay');
  for (const key of ['workspace', 'contextRoot', 'capabilityRoot']) {
    if (manifest[key] !== undefined && (typeof manifest[key] !== 'string' || manifest[key].trim() === '')) problems.push(`${key} must be non-empty`);
  }
  if (typeof manifest.contextRoot === 'string' && workspaceRoot) {
    if (!safeRelativePath(manifest.contextRoot) || !isPathWithin(contextRoot, workspaceRoot) || comparable(contextRoot) === comparable(workspaceRoot)) {
      problems.push('contextRoot must be a relative path inside WorkspaceRoot');
    }
  }
  const shared = Array.isArray(manifest.sharedDirectories) ? manifest.sharedDirectories : [];
  const local = Array.isArray(manifest.localDirectories) ? manifest.localDirectories : [];
  if (!Array.isArray(manifest.sharedDirectories)) problems.push('sharedDirectories must be an array');
  if (!Array.isArray(manifest.localDirectories)) problems.push('localDirectories must be an array');
  const normalizedShared = shared.map((entry) => String(entry).toLowerCase());
  const normalizedLocal = local.map((entry) => String(entry).toLowerCase());
  if (normalizedShared.some((entry, index) => normalizedShared.indexOf(entry) !== index)) problems.push('sharedDirectories must be unique');
  if (normalizedLocal.some((entry, index) => normalizedLocal.indexOf(entry) !== index)) problems.push('localDirectories must be unique');
  if (normalizedLocal.some((entry) => normalizedShared.includes(entry))) problems.push('sharedDirectories and localDirectories must not overlap');
  if ([...shared, ...local].some((entry) => typeof entry !== 'string' || entry.trim() === '')) problems.push('directory names must be non-empty');
  if ([...shared, ...local].some((entry) => !safeDirectoryName(entry))) problems.push('directory names must be safe single path segments');

  const sourceRoots = Array.isArray(manifest.sourceRoots) ? manifest.sourceRoots : [];
  if (!Array.isArray(manifest.sourceRoots) || sourceRoots.length === 0) problems.push('sourceRoots must contain at least one entry');
  for (const sourceRoot of sourceRoots) {
    if (!sourceRoot || typeof sourceRoot !== 'object' || Array.isArray(sourceRoot)) {
      problems.push('sourceRoot must be an object');
      continue;
    }
    for (const key of ['name', 'path', 'target', 'gitRoot']) {
      if (typeof sourceRoot[key] !== 'string' || sourceRoot[key].trim() === '') problems.push(`sourceRoot ${key} must be non-empty`);
    }
    if (typeof sourceRoot.path === 'string' && workspaceRoot) {
      const resolvedSourcePath = normalizePath(sourceRoot.path, workspaceRoot);
      if (!safeRelativePath(sourceRoot.path) || !isPathWithin(resolvedSourcePath, workspaceRoot) || comparable(resolvedSourcePath) === comparable(workspaceRoot)) {
        problems.push('sourceRoot path must be a relative path inside WorkspaceRoot');
      }
    }
  }
  const names = sourceRoots.filter((entry) => entry && typeof entry.name === 'string').map((entry) => entry.name.toLowerCase());
  if (names.some((entry, index) => names.indexOf(entry) !== index)) problems.push('sourceRoot names must be unique');
  return problems;
}

function contextObject({
  mode,
  workspaceName,
  workspaceRoot,
  contextRoot,
  capabilityRoot,
  manifestPath,
  sharedDirectories,
  localDirectories,
  sourceRoots,
  gitRoots,
  manifest = null,
  manifestError = '',
}) {
  return {
    mode,
    workspaceName,
    workspaceRoot,
    contextRoot,
    capabilityRoot,
    manifestPath,
    sharedDirectories,
    localDirectories,
    sourceRoots,
    gitRoots,
    manifest,
    manifestError,
  };
}

function resolveWorkspaceContext(startDir) {
  const workspaceRoot = normalizePath(startDir);
  const manifestPath = path.join(workspaceRoot, '.agents', 'capability.json');
  if (!fs.existsSync(manifestPath)) {
    const contextRoot = path.join(workspaceRoot, '.agents');
    const sourceRoot = { name: 'workspace', path: workspaceRoot, target: workspaceRoot, gitRoot: workspaceRoot };
    return contextObject({
      mode: 'standard',
      workspaceName: path.basename(workspaceRoot),
      workspaceRoot,
      contextRoot,
      capabilityRoot: contextRoot,
      manifestPath: '',
      sharedDirectories: [],
      localDirectories: [],
      sourceRoots: [sourceRoot],
      gitRoots: [workspaceRoot],
    });
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    const contextRoot = path.join(workspaceRoot, '.agents');
    return contextObject({
      mode: 'invalid',
      workspaceName: '',
      workspaceRoot,
      contextRoot,
      capabilityRoot: contextRoot,
      manifestPath,
      sharedDirectories: [],
      localDirectories: [],
      sourceRoots: [],
      gitRoots: [],
      manifestError: error.message,
    });
  }

  const contextRoot = normalizePath(typeof manifest.contextRoot === 'string' && manifest.contextRoot.trim() ? manifest.contextRoot : '.agents', workspaceRoot);
  const capabilityRoot = normalizePath(typeof manifest.capabilityRoot === 'string' && manifest.capabilityRoot.trim() ? manifest.capabilityRoot : '.agents', workspaceRoot);
  const sharedDirectories = (Array.isArray(manifest.sharedDirectories) ? manifest.sharedDirectories : []).map((name) => ({
    name: String(name),
    path: normalizePath(String(name), contextRoot),
    target: normalizePath(String(name), capabilityRoot),
  }));
  const localDirectories = (Array.isArray(manifest.localDirectories) ? manifest.localDirectories : []).map((name) => ({
    name: String(name),
    path: normalizePath(String(name), contextRoot),
  }));
  const sourceRoots = (Array.isArray(manifest.sourceRoots) ? manifest.sourceRoots : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      name: typeof entry.name === 'string' ? entry.name : '',
      path: normalizePath(typeof entry.path === 'string' && entry.path ? entry.path : '.', workspaceRoot),
      target: normalizePath(typeof entry.target === 'string' && entry.target ? entry.target : '.', workspaceRoot),
      gitRoot: normalizePath(typeof entry.gitRoot === 'string' && entry.gitRoot ? entry.gitRoot : '.', workspaceRoot),
    }));
  const gitRoots = [];
  for (const sourceRoot of sourceRoots) {
    if (!gitRoots.some((entry) => comparable(entry) === comparable(sourceRoot.gitRoot))) gitRoots.push(sourceRoot.gitRoot);
  }
  return contextObject({
    mode: typeof manifest.mode === 'string' ? manifest.mode : 'invalid',
    workspaceName: typeof manifest.workspace === 'string' ? manifest.workspace : '',
    workspaceRoot,
    contextRoot,
    capabilityRoot,
    manifestPath,
    sharedDirectories,
    localDirectories,
    sourceRoots,
    gitRoots,
    manifest,
  });
}

function junctionResult(itemPath, expectedTarget, nonJunctionStatus, missingStatus) {
  if (!fs.existsSync(itemPath)) return result(missingStatus, itemPath, expectedTarget, '', 'path is missing');
  const stats = fs.lstatSync(itemPath);
  if (!stats.isSymbolicLink()) return result(nonJunctionStatus, itemPath, expectedTarget, '', 'path is not a Junction');
  let actualTarget;
  try {
    actualTarget = normalizePath(fs.realpathSync.native(itemPath));
  } catch (error) {
    return result('junction-target-mismatch', itemPath, expectedTarget, '', error.message);
  }
  const expected = normalizePath(expectedTarget);
  if (comparable(actualTarget) !== comparable(expected)) return result('junction-target-mismatch', itemPath, expected, actualTarget, 'Junction target does not match manifest');
  return result('junction-ok', itemPath, expected, actualTarget, 'Junction target matches manifest');
}

function validateWorkspaceContext(context) {
  const results = [];
  if (context.manifestError) return [result('manifest-invalid', context.manifestPath, '', context.manifestError, 'capability manifest is not valid JSON')];
  if (context.manifestPath) {
    if (Object.prototype.hasOwnProperty.call(context.manifest, 'schemaVersion') && context.manifest.schemaVersion !== 1) {
      return [result('schema-version-unsupported', context.manifestPath, '1', String(context.manifest.schemaVersion), 'unsupported capability manifest schema')];
    }
    const problems = manifestProblems(context.manifest, context.workspaceRoot, context.contextRoot);
    if (problems.length) return [result('manifest-invalid', context.manifestPath, '', problems.join('; '), 'capability manifest violates schemaVersion 1 contract')];
  }

  results.push(result('workspace-context-resolved', context.workspaceRoot, context.mode, context.mode, 'workspace context resolved'));
  if (!fs.existsSync(context.capabilityRoot) || !fs.statSync(context.capabilityRoot).isDirectory()) {
    results.push(result('capability-root-missing', context.capabilityRoot, '', '', 'CapabilityRoot directory is missing'));
  } else if (!fs.existsSync(path.join(context.capabilityRoot, '.git'))) {
    results.push(result('capability-git-missing', context.capabilityRoot, path.join(context.capabilityRoot, '.git'), '', 'CapabilityRoot is not a Git deployment'));
  }

  for (const sourceRoot of context.sourceRoots) {
    if (!fs.existsSync(sourceRoot.target) || !fs.statSync(sourceRoot.target).isDirectory()) results.push(result('source-root-missing', sourceRoot.target, sourceRoot.name, '', 'declared source target is missing'));
    if (!fs.existsSync(sourceRoot.gitRoot) || !fs.statSync(sourceRoot.gitRoot).isDirectory()) results.push(result('git-root-missing', sourceRoot.gitRoot, sourceRoot.name, '', 'declared GitRoot is missing'));
    if (context.mode === 'workspace-overlay') results.push(junctionResult(sourceRoot.path, sourceRoot.target, 'source-path-not-junction', 'source-path-missing'));
  }
  if (context.mode === 'workspace-overlay') {
    for (const shared of context.sharedDirectories) results.push(junctionResult(shared.path, shared.target, 'shared-path-not-junction', 'shared-path-missing'));
    for (const local of context.localDirectories) {
      if (!fs.existsSync(local.path)) {
        results.push(result('local-path-missing', local.path, '', '', 'local directory is missing'));
        continue;
      }
      const stats = fs.lstatSync(local.path);
      if (stats.isSymbolicLink()) results.push(result('local-path-is-link', local.path, '', 'link', 'local directory must be physical'));
      else if (!stats.isDirectory()) results.push(result('local-path-not-directory', local.path, '', '', 'local path must be a directory'));
      else results.push(result('local-path-ok', local.path, '', '', 'local directory is physical'));
    }
  }
  return results;
}

function resolveGitRootForPath(context, filePath) {
  const file = normalizePath(filePath);
  const matches = context.sourceRoots
    .filter((sourceRoot) => isPathWithin(file, sourceRoot.target))
    .sort((left, right) => right.target.length - left.target.length);
  if (!matches.length) throw new Error(`Path is not inside a declared source root: ${file}`);
  return matches[0];
}

module.exports = {
  resolveWorkspaceContext,
  validateWorkspaceContext,
  resolveGitRootForPath,
};
