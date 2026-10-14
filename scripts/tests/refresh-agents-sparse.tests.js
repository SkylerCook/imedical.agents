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
function runShell(shell, args, options = {}) {
  const env = { ...process.env };
  // Node does not apply pwsh's automatic PSModulePath handoff to Windows PS5.1.
  if (shell === 'powershell.exe') {
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  }
  return execFileSync(shell, args, { ...options, env });
}
function fixture(run) {
  const base = process.env.AGENTS_TEST_TEMP || os.tmpdir();
  const root = fs.mkdtempSync(path.join(base, 'codex-sparse-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    fs.mkdirSync(path.join(root, '.test-hooks')); git('config', 'core.hooksPath', path.join(root, '.test-hooks'));
    fs.appendFileSync(path.join(root, '.git/info/exclude'), '\n/.test-hooks/\n/legacy-checkout/\n');
    for (const file of ['agents/agent-registry.md', 'docs/a.md', 'scripts/lib/test.js', 'memory/private.md']) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'seed');
    }
    for (const file of ['scripts/refresh-agents-sparse.js', 'scripts/update-agents.ps1', 'scripts/lib/WorkspaceContext.psm1', 'scripts/lib/workspace-context.js']) {
      fs.copyFileSync(path.join(repo, file), path.join(root, file));
    }
    git('add', '.'); git('commit', '-qm', 'seed');
    run(root, git);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function legacyRawFixture(run, realVendor = false) {
  return fixture((root, git) => {
    git('config', 'core.autocrlf', 'false');
    const file = 'vendor/hisui/dist/plugin/datagrid-detailview.js';
    const canonical = Buffer.from('// unchanged upstream blob\nwindow.synthetic = 1;\n');
    if (realVendor) {
      fs.cpSync(path.join(repo, 'vendor/hisui'), path.join(root, 'vendor/hisui'), { recursive: true, filter: at => path.basename(at) !== '.gitattributes' });
    } else {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), canonical);
      fs.writeFileSync(path.join(root, 'vendor/hisui/dist/plugin/z-custom.js'), canonical);
    }
    git('add', 'vendor/hisui'); git('commit', '-qm', 'old vendor without attributes');
    const old = git('rev-parse', 'HEAD').trim();
    const checkout = path.join(root, 'legacy-checkout', '.agents');
    fs.mkdirSync(path.dirname(checkout), { recursive: true });
    git('-c', 'core.autocrlf=true', 'clone', '-q', '--no-local', root, checkout);
    const clientGit = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    clientGit('config', 'core.autocrlf', 'true'); clientGit('config', 'core.hooksPath', path.join(root, '.test-hooks'));
    clientGit('sparse-checkout', 'init', '--no-cone');
    clientGit('sparse-checkout', 'set', '--no-cone', ...patterns, '/vendor/**');
    // Real deployed files predate the index update; avoid a racily-clean fixture.
    const previousTime = new Date(Date.now() - 10000);
    for (const item of clientGit('ls-files', '-z').split('\0').filter(Boolean)) {
      const at = path.join(checkout, item);
      if (fs.existsSync(at)) fs.utimesSync(at, previousTime, previousTime);
    }
    clientGit('update-index', '--refresh');
    fs.writeFileSync(path.join(root, 'vendor/hisui/.gitattributes'), realVendor ? fs.readFileSync(path.join(repo, 'vendor/hisui/.gitattributes')) : '* -text\n');
    git('add', 'vendor/hisui/.gitattributes'); git('commit', '-qm', 'preserve vendor bytes');
    clientGit('pull', '--ff-only');
    assert.equal(clientGit('rev-parse', `HEAD:${file}`).trim(), git('rev-parse', `${old}:${file}`).trim());
    assert.equal(clientGit('status', '--porcelain'), '');
    assert.ok(fs.readFileSync(path.join(checkout, file)).includes(Buffer.from('\r\n')), 'fast-forward leaves the unchanged blob in its legacy CRLF checkout');
    run({ root, checkout, clientGit, file, canonical, runtime: [...patterns, '/vendor/**'] });
  });
}
test('fast-forward from autocrlf vendor checkout converges unchanged raw asset bytes', () => legacyRawFixture(({ checkout, clientGit, file, canonical, runtime }) => {
  refresh(checkout, runtime);
  assert.deepEqual(fs.readFileSync(path.join(checkout, file)), canonical);
  verify(checkout, runtime);
  assert.equal(clientGit('config', '--get', 'core.autocrlf').trim(), 'true');
  assert.equal(clientGit('status', '--porcelain'), '');
  assert.equal(clientGit('diff', '--cached', '--raw'), '');
  refresh(checkout, runtime);
  assert.deepEqual(fs.readFileSync(path.join(checkout, file)), canonical);
}));
test('complete HISUI inventory converges after a clean autocrlf fast-forward', () => legacyRawFixture(({ checkout, clientGit, runtime }) => {
  const { verify: verifyHisui } = require('../../maintenance/hisui-build/update-hisui-vendor');
  assert.throws(() => verifyHisui(path.join(checkout, 'vendor/hisui')), /mismatch/i);
  refresh(checkout, runtime);
  verifyHisui(path.join(checkout, 'vendor/hisui'));
  assert.equal(clientGit('status', '--porcelain'), '');
  assert.equal(clientGit('config', '--get', 'core.autocrlf').trim(), 'true');
}, true));
test('read-only verification rejects clean Git status with stale raw checkout bytes', () => legacyRawFixture(({ checkout, file, runtime }) => {
  const before = fs.readFileSync(path.join(checkout, file));
  assert.throws(() => verify(checkout, runtime), /raw.*bytes|byte.*mismatch/i);
  assert.deepEqual(fs.readFileSync(path.join(checkout, file)), before);
}));
test('raw byte repair protects content changes hidden behind assume-unchanged', () => legacyRawFixture(({ checkout, clientGit, file, runtime }) => {
  const custom = Buffer.from('// user customization\r\nwindow.synthetic = 9;\r\n');
  fs.writeFileSync(path.join(checkout, file), custom);
  clientGit('update-index', '--assume-unchanged', '--', file);
  assert.equal(clientGit('status', '--porcelain'), '');
  assert.throws(() => refresh(checkout, runtime), /raw.*bytes|byte.*mismatch|custom/i);
  assert.deepEqual(fs.readFileSync(path.join(checkout, file)), custom);
}));
test('visible dirty state stops before repairing otherwise eligible EOL bytes', () => legacyRawFixture(({ checkout, file, runtime }) => {
  const before = fs.readFileSync(path.join(checkout, file));
  fs.writeFileSync(path.join(checkout, 'docs/a.md'), 'user edit');
  assert.throws(() => refresh(checkout, runtime), /dirty/);
  assert.deepEqual(fs.readFileSync(path.join(checkout, file)), before);
}));
test('repair validates the complete plan before replacing any eligible asset', () => legacyRawFixture(({ checkout, clientGit, file, runtime }) => {
  const before = fs.readFileSync(path.join(checkout, file));
  const customFile = 'vendor/hisui/dist/plugin/z-custom.js';
  const custom = Buffer.from('// private edit\r\n');
  fs.writeFileSync(path.join(checkout, customFile), custom);
  clientGit('update-index', '--assume-unchanged', '--', customFile);
  assert.throws(() => verify(checkout, runtime, { repairRawBytes: true }), /custom or unsupported/);
  assert.deepEqual(fs.readFileSync(path.join(checkout, file)), before);
  assert.deepEqual(fs.readFileSync(path.join(checkout, customFile)), custom);
}));
test('raw byte repair rejects linked asset directories', () => legacyRawFixture(({ root, checkout, file, runtime }) => {
  const at = path.dirname(path.join(checkout, file)), target = path.join(root, 'linked-assets');
  fs.renameSync(at, target);
  fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
  const before = fs.readFileSync(path.join(target, path.basename(file)));
  assert.throws(() => verify(checkout, runtime, { repairRawBytes: true }), /Linked raw/);
  assert.deepEqual(fs.readFileSync(path.join(target, path.basename(file))), before);
}));
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
  test(`${shell}: actual Check entry stops before generating project files on byte mismatch`, () => legacyRawFixture(({ checkout, file }) => {
    const before = fs.readFileSync(path.join(checkout, file));
    let result;
    try {
      runShell(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(checkout, 'scripts/update-agents.ps1'), '-ProjectRoot', path.dirname(checkout), '-Mode', 'Check', '-NoPull', '-Detailed'], { encoding: 'utf8', stdio: 'pipe' });
      assert.fail('Check falsely succeeded');
    } catch (error) { result = error; }
    assert.equal(result.status, 1);
    assert.match(String(result.stdout) + String(result.stderr), /runtime-assets-invalid/);
    assert.ok(!fs.existsSync(path.join(checkout, 'config')));
    assert.deepEqual(fs.readFileSync(path.join(checkout, file)), before);
  }));
  test(`${shell}: updater modes verify or safely repair without changing sparse rules`, () => legacyRawFixture(({ checkout, file, canonical, runtime }) => {
    const before = fs.readFileSync(path.join(checkout, file));
    const sparseBefore = fs.readFileSync(path.join(checkout, '.git/info/sparse-checkout'));
    const source = fs.readFileSync(path.join(repo, 'scripts/update-agents.ps1'), 'utf8');
    const adapter = source.slice(source.indexOf('function Assert-AgentsNodeRuntime {'), source.indexOf('function Assert-GitSparseCheckoutSubcommandAvailable {'));
    const body = `$ErrorActionPreference = 'Stop'\n${adapter}\n` +
      `function Write-UpdateResult { param($Status,$Target,$Reason,$Phase); [pscustomobject]@{status=$Status;reason=$Reason} }\n` +
      `function Get-RelativePathPortable { param($From,$To); $To }\n` +
      `$runtimeSparsePaths = @(${runtime.map(p => `'${p}'`).join(',')})\n` +
      `$root = '${checkout.replace(/'/g, "''")}'\n` +
      `foreach ($mode in @('Check','DryRun')) {\n` +
      `  $r = Invoke-AgentsRuntimeValidation -Root $root -ProjectRootFull $root -Mode $mode -NoPull\n` +
      `  if ($r.status -ne 'runtime-assets-invalid') { throw "$mode falsely passed" }\n}\n` +
      `$r = Invoke-AgentsRuntimeValidation -Root $root -ProjectRootFull $root -Mode Write -Overlay\n` +
      `if ($r.status -ne 'runtime-assets-invalid') { throw 'Overlay falsely passed' }\n` +
      `if ([IO.File]::ReadAllBytes((Join-Path $root '${file}')).Length -ne ${before.length}) { throw 'Read-only mode changed bytes' }\n` +
      `$r = Invoke-AgentsRuntimeValidation -Root $root -ProjectRootFull $root -Mode Write -NoPull\n` +
      `if ($r.status -ne 'runtime-assets-verified') { throw $r.reason }\n` +
      `$r = Invoke-AgentsRuntimeValidation -Root $root -ProjectRootFull $root -Mode Check\n` +
      `if ($r.status -ne 'runtime-assets-verified') { throw $r.reason }\n`;
    runShell(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(body, 'utf16le').toString('base64')], { stdio: 'pipe' });
    assert.deepEqual(fs.readFileSync(path.join(checkout, file)), canonical);
    assert.deepEqual(fs.readFileSync(path.join(checkout, '.git/info/sparse-checkout')), sparseBefore);
    assert.equal(fs.readdirSync(path.dirname(path.join(checkout, file))).filter(f => f.startsWith('.agents-raw-')).length, 0);
  }));
  for (const script of ['install-agents.ps1', 'update-agents.ps1']) {
    test(`${shell}: ${script} bootstrap bypasses BOM and missing helper on disk`, () => fixture((root, git) => {
      git('sparse-checkout', 'set', '--no-cone', '/docs/**');
      const source = fs.readFileSync(path.join(repo, 'scripts', script), 'utf8');
      const adapter = source.slice(source.indexOf('function Assert-AgentsNodeRuntime {'), source.indexOf('function Assert-GitSparseCheckoutSubcommandAvailable {'));
      const body = `$ErrorActionPreference = 'Stop'\n$OutputEncoding = New-Object System.Text.UTF8Encoding($true)\n${adapter}\nInvoke-AgentsSparseRefresh -Root '${root.replace(/'/g, "''")}' -Patterns @('/agents/**','/docs/**','/scripts/*.js','/scripts/lib/**')\n`;
      // EncodedCommand avoids command-line quoting differences in Windows PowerShell.
      runShell(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(body, 'utf16le').toString('base64')], { stdio: 'pipe' });
      assert.ok(fs.existsSync(path.join(root, 'agents/agent-registry.md')));
      assert.ok(fs.existsSync(path.join(root, 'scripts/refresh-agents-sparse.js')));
      assert.equal(git('status', '--porcelain'), '');
    }));
  }
}
