'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { refresh, verify } = require('../refresh-agents-sparse');
const repo = path.resolve(__dirname, '../..');
const patterns = ['/agents/**', '/docs/**', '/scripts/*.js', '/scripts/*.ps1', '/scripts/lib/**'];
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sparse-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    for (const file of ['agents/agent-registry.md', 'docs/a.md', 'scripts/lib/test.js', 'memory/private.md']) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'seed');
    }
    fs.copyFileSync(path.join(repo, 'scripts/refresh-agents-sparse.js'), path.join(root, 'scripts/refresh-agents-sparse.js'));
    git('add', '.'); git('commit', '-qm', 'seed');
    run(root, git);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('new sparse paths materialize and maintenance files remain excluded', () => fixture((root, git) => {
  git('sparse-checkout', 'set', '--no-cone', '/docs/**');
  refresh(root, patterns);
  assert.ok(fs.existsSync(path.join(root, 'agents/agent-registry.md')));
  assert.ok(fs.existsSync(path.join(root, 'scripts/lib/test.js')));
  assert.ok(!fs.existsSync(path.join(root, 'memory/private.md')));
  refresh(root, patterns);
  assert.equal(git('status', '--porcelain'), '');
}));
test('dirty checkout stops before changing sparse rules', () => fixture((root, git) => {
  git('sparse-checkout', 'set', '--no-cone', '/docs/**');
  fs.writeFileSync(path.join(root, 'docs/a.md'), 'user change');
  assert.throws(() => refresh(root, patterns), /dirty/);
  assert.equal(fs.readFileSync(path.join(root, 'docs/a.md'), 'utf8'), 'user change');
  assert.ok(!fs.existsSync(path.join(root, 'agents')));
}));
test('verification rejects both skip-worktree paths and missing working files', () => fixture((root, git) => {
  git('sparse-checkout', 'set', '--no-cone', '/docs/**');
  assert.throws(() => verify(root, patterns), /not materialized/);
  refresh(root, patterns);
  fs.unlinkSync(path.join(root, 'agents/agent-registry.md'));
  assert.throws(() => verify(root, patterns), /not materialized/);
}));
test('fresh no-checkout clone materializes runtime files', () => fixture((root, git) => {
  const clone = path.join(root, 'clone');
  git('clone', '--no-checkout', root, clone);
  assert.throws(() => verify(clone, patterns), /not materialized/);
  refresh(clone, patterns, true);
  assert.ok(fs.existsSync(path.join(clone, 'agents/agent-registry.md')));
}));
test('new top-level directory introduced by an upgrade is materialized', () => fixture((root, git) => {
  const base = git('rev-parse', 'HEAD').trim();
  fs.mkdirSync(path.join(root, 'workflows'));
  fs.writeFileSync(path.join(root, 'workflows/new.md'), 'new runtime');
  git('add', 'workflows'); git('commit', '-qm', 'new runtime directory');
  const next = git('rev-parse', 'HEAD').trim();
  git('checkout', '--detach', base);
  git('sparse-checkout', 'set', '--no-cone', '/docs/**');
  git('merge', '--ff-only', next);
  assert.ok(!fs.existsSync(path.join(root, 'workflows/new.md')));
  refresh(root, [...patterns, '/workflows/**']);
  assert.ok(fs.existsSync(path.join(root, 'workflows/new.md')));
}));
for (const shell of process.platform === 'win32' ? ['pwsh.exe', 'powershell.exe'] : ['pwsh']) {
  for (const script of ['install-agents.ps1', 'update-agents.ps1']) {
    test(`${shell}: ${script} bootstrap bypasses BOM and missing helper on disk`, () => fixture((root, git) => {
      git('sparse-checkout', 'set', '--no-cone', '/docs/**');
      const source = fs.readFileSync(path.join(repo, 'scripts', script), 'utf8');
      const adapter = source.slice(source.indexOf('function Assert-AgentsNodeRuntime {'), source.indexOf('function Assert-GitSparseCheckoutSubcommandAvailable {'));
      const body = `$ErrorActionPreference = 'Stop'\n$OutputEncoding = New-Object System.Text.UTF8Encoding($true)\n${adapter}\nInvoke-AgentsSparseRefresh -Root '${root.replace(/'/g, "''")}' -Patterns @('/agents/**','/docs/**','/scripts/*.js','/scripts/lib/**')\n`;
      // EncodedCommand avoids command-line quoting differences in Windows PowerShell.
      execFileSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(body, 'utf16le').toString('base64')], { stdio: 'pipe' });
      assert.ok(fs.existsSync(path.join(root, 'agents/agent-registry.md')));
      assert.ok(fs.existsSync(path.join(root, 'scripts/refresh-agents-sparse.js')));
      assert.equal(git('status', '--porcelain'), '');
    }));
  }
}
