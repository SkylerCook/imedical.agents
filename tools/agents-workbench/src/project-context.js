'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveWorkspaceContext, validateWorkspaceDeclaration } = require('../../../scripts/lib/workspace-context');

function stat(file) {
  return fs.lstatSync(file, { throwIfNoEntry: false });
}

function inspectProjectContext(root) {
  try {
    const local = path.join(root, '.agents');
    const directory = stat(local);
    if (directory && !directory.isDirectory()) return null;
    const manifest = stat(path.join(local, 'capability.json'));
    if (manifest && (!manifest.isFile() || manifest.nlink !== 1)) return null;
    const context = resolveWorkspaceContext(root);
    return validateWorkspaceDeclaration(context).length ? null : context;
  } catch { return null; }
}

function inspectFramework(projectRoot) {
  const result = { name: path.basename(projectRoot), status: 'unavailable', revision: null };
  const status = value => ({ ...result, status: value });
  if (projectRoot.startsWith('\\\\') || !stat(projectRoot)?.isDirectory()) return result;
  const root = fs.realpathSync.native(projectRoot);
  const cap = path.join(root, '.agents');
  const directory = stat(cap);
  if (fs.existsSync(path.join(root, 'scripts/install-agents.ps1')) &&
      fs.existsSync(path.join(root, 'scripts/update-agents.ps1'))) return status('framework-checkout');
  if (!directory) return status('no-framework');
  if (!directory.isDirectory()) return status('custom-layout');
  if (stat(path.join(cap, 'capability.json'))?.isSymbolicLink()) return status('custom-layout');
  const context = inspectProjectContext(root);
  if (!context) return status('invalid-declaration');
  if (context.manifestPath) return status(context.mode === 'workspace-overlay' ? 'overlay-declared' : 'invalid-declaration');
  const metadata = path.join(cap, '.git');
  if (!stat(metadata)?.isDirectory()) return status('partial');
  const git = (...args) => spawnSync('git', ['--no-optional-locks','--git-dir', metadata, ...args], {
    env:{...process.env,GIT_NO_LAZY_FETCH:'1',GIT_ALLOW_PROTOCOL:'',GIT_NO_REPLACE_OBJECTS:'1'},
    encoding: 'utf8', windowsHide: true, timeout: 5000
  });
  const head = git('rev-parse', '--verify', 'HEAD');
  if (head.error) return status('git-unavailable');
  if (head.status || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head.stdout.trim())) return status('invalid-head');
  result.revision = head.stdout.trim();
  const origin = git('config','--local','--no-includes','--get','remote.origin.url');
  if (origin.stdout?.trim() !== 'https://gitee.com/skyler-cook/imedical.agents.git') return status('unknown-source');
  if (!stat(path.join(cap, 'scripts'))?.isDirectory() ||
      !stat(path.join(cap, 'scripts/update-agents.ps1'))?.isFile()) return status('partial');
  return status('standard');
}

module.exports = { inspectFramework, inspectProjectContext };
