'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');
const { spawnSync } = require('node:child_process');
const { sync } = require('../sync-runtime-skills.js');
const tempBase = path.join(os.tmpdir(), 'codex');
fs.mkdirSync(tempBase, { recursive: true });
const temporary = fs.mkdtempSync(path.join(tempBase, 'runtime-skills-'));
function fixture(name) {
  const root = path.join(temporary, name);
  fs.mkdirSync(path.join(root, '.agents', '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents', 'skills', 'sample'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'skills', 'sample', 'SKILL.md'), 'original');
  return root;
}
function link(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
}
function run(root, runtime = 'CodeBuddy', mode = 'Write') { return sync({ projectRoot: root, runtime, mode }); }
after(() => {
  assert.equal(path.dirname(temporary), tempBase);
  // Remove links themselves first; never traverse link targets during cleanup.
  function cleanLinks(dir) {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name); const entry = fs.lstatSync(file);
      if (entry.isSymbolicLink()) fs.unlinkSync(file);
      else if (entry.isDirectory()) cleanLinks(file);
    }
  }
  cleanLinks(temporary);
  fs.rmSync(temporary, { recursive: true });
  assert.equal(fs.existsSync(temporary), false);
});
test('Check and DryRun never create directories; Check CLI reports missing link', () => {
  const root = fixture('read only');
  for (const mode of ['Check', 'DryRun']) assert.equal(run(root, 'CodeBuddy', mode).status, 'runtime-adapter-planned');
  assert.equal(fs.existsSync(path.join(root, '.codebuddy')), false);
  const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../sync-runtime-skills.js'), '--project-root', root, '--runtime', 'CodeBuddy', '--mode', 'Check']);
  assert.equal(cli.status, 1);
});
for (const runtime of ['CodeBuddy', 'ClaudeCode', 'WorkBuddy', 'WorkBuddyDonghua', 'Qoder']) test(`${runtime}: create, idempotency and live source changes`, () => {
  const root = fixture(runtime + ' 中文 space');
  const first = run(root, runtime);
  assert.equal(first.status, 'runtime-adapter-linked');
  assert.equal(fs.lstatSync(first.target).isSymbolicLink(), true);
  const before = fs.lstatSync(first.target).mtimeMs;
  assert.equal(run(root, runtime).status, 'runtime-adapter-unchanged');
  assert.equal(fs.lstatSync(first.target).mtimeMs, before);
  fs.writeFileSync(path.join(first.source, 'sample', 'SKILL.md'), 'updated');
  assert.equal(fs.readFileSync(path.join(first.target, 'sample', 'SKILL.md'), 'utf8'), 'updated');
  fs.mkdirSync(path.join(first.source, 'new-skill'));
  assert.equal(fs.existsSync(path.join(first.target, 'new-skill')), true);
  assert.equal(run(root, runtime, 'Check').status, 'runtime-adapter-unchanged');
});
test('Codex reuses source without creating .codex', () => {
  const root = fixture('codex');
  assert.equal(run(root, 'Codex').status, 'runtime-adapter-reused');
  assert.equal(fs.existsSync(path.join(root, '.codex')), false);
});
for (const [runtime, directory] of Object.entries({ OpenCode: '.opencode', Cursor: '.cursor',
  GeminiCLI: '.gemini', GitHubCopilot: '.github' })) test(`${runtime}: reuse common layer or explicitly link native directory`, () => {
  const root = fixture(runtime);
  assert.equal(run(root, runtime).status, 'runtime-adapter-reused');
  assert.equal(fs.existsSync(path.join(root, directory)), false);
  const result = sync({ projectRoot: root, runtime, skillsDir: `${directory}/skills`, mode: 'Write' });
  assert.equal(result.status, 'runtime-adapter-linked');
  assert.equal(fs.readFileSync(path.join(result.target, 'sample/SKILL.md'), 'utf8'), 'original');
});
test('custom discovery: dry run, CLI write, check and preserve conflict', () => {
  const root = fixture('custom-discovery');
  const options = { projectRoot: root, runtime: 'Custom', skillsDir: '.custom/nested/skills' };
  assert.equal(sync(options).status, 'runtime-adapter-planned');
  assert.equal(fs.existsSync(path.join(root, '.custom')), false);
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../sync-runtime-skills.js'),
    '--project-root', root, '--runtime', 'Custom', '--skills-dir', options.skillsDir, '--mode', 'Write']);
  assert.equal(result.status, 0, result.stdout.toString());
  assert.equal(sync({ ...options, mode: 'Check' }).status, 'runtime-adapter-unchanged');
  fs.mkdirSync(path.join(root, '.existing/skills'), { recursive: true });
  assert.equal(sync({ ...options, skillsDir: '.existing/skills', mode: 'Write' }).status, 'runtime-adapter-conflict');
});
test('custom discovery rejects traversal, metadata, source overlap and linked parent', () => {
  const root = fixture('custom-boundary');
  for (const skillsDir of ['', '../skills', '/tmp/skills', 'C:/skills', '.host/../skills',
    '.host\\skills', '.git/skills', '.GIT/skills', '.agents/private/skills', '.host//skills']) {
    assert.throws(() => sync({ projectRoot: root, runtime: 'Custom', skillsDir, mode: 'Write' }), /requires|skills-dir/);
  }
  assert.throws(() => sync({ projectRoot: root, runtime: 'Custom' }), /requires/);
  const outside = path.join(temporary, 'custom-outside'); fs.mkdirSync(outside);
  link(outside, path.join(root, '.host'));
  assert.throws(() => sync({ projectRoot: root, runtime: 'Custom', skillsDir: '.host/skills', mode: 'Write' }), /physical directory/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
test('PowerShell entrypoints accept every named runtime on PS5.1 and PS7', { skip: process.platform !== 'win32' }, () => {
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    const command = `foreach ($file in @('scripts/install-agents.ps1','scripts/update-agents.ps1')) {
      $values = (Get-Command $file).Parameters['RuntimeAdapter'].Attributes.ValidValues
      foreach ($runtime in @('CodeBuddy','ClaudeCode','Codex','WorkBuddy','WorkBuddyDonghua','OpenCode','Cursor','GeminiCLI','GitHubCopilot','Qoder')) {
        if ($values -notcontains $runtime) { throw "$file rejects $runtime" }
      }
    }`;
    const result = spawnSync(shell, ['-NoProfile', '-Command', command], { encoding: 'utf8', cwd: path.resolve(__dirname, '../..'), windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
  }
});
test('preserves custom directory and files in all modes', () => {
  const root = fixture('custom'); const target = path.join(root, '.codebuddy', 'skills');
  fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'custom.txt'), 'keep');
  for (const mode of ['Check', 'DryRun', 'Write']) assert.equal(run(root, 'CodeBuddy', mode).status, 'runtime-adapter-conflict');
  assert.equal(fs.readFileSync(path.join(target, 'custom.txt'), 'utf8'), 'keep');
});
test('wrong and dangling links are preserved', () => {
  for (const broken of [false, true]) {
    const root = fixture('wrong-' + broken); const outside = path.join(temporary, 'outside-' + broken);
    fs.mkdirSync(outside); const target = path.join(root, '.codebuddy', 'skills'); link(outside, target);
    if (broken) fs.rmdirSync(outside);
    const before = fs.readlinkSync(target);
    assert.equal(run(root).status, 'runtime-adapter-conflict');
    assert.equal(fs.readlinkSync(target), before);
  }
});
test('blocks linked destination parent without writing outside project', () => {
  const root = fixture('escape'); const outside = path.join(temporary, 'external'); fs.mkdirSync(outside);
  link(outside, path.join(root, '.codebuddy'));
  assert.throws(() => run(root), /physical directory/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
test('rejects invalid runtime and invalid manifest before writing', () => {
  const root = fixture('invalid');
  assert.throws(() => run(root, '../other'), /runtime must/);
  fs.writeFileSync(path.join(root, '.agents', 'capability.json'), '{');
  assert.throws(() => run(root), /Invalid workspace context/);
  assert.equal(fs.existsSync(path.join(root, '.codebuddy')), false);
});
test('rejects linked source and missing capability', () => {
  const root = fixture('linked-source'); const skills = path.join(root, '.agents', 'skills');
  const old = path.join(root, 'old-skills'); fs.renameSync(skills, old); link(old, skills);
  assert.throws(() => run(root), /physical directory/);
  const missing = path.join(temporary, 'missing'); fs.mkdirSync(missing);
  assert.throws(() => run(missing), /capability-root-missing/);
});
test('overlay links module-local skills and leaves shared capability unchanged', () => {
  const capability = fixture('capability'); const root = path.join(temporary, 'overlay');
  fs.mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true });
  link(capability, path.join(root, 'source'));
  fs.writeFileSync(path.join(root, '.agents', 'capability.json'), JSON.stringify({
    schemaVersion: 1, mode: 'workspace-overlay', workspace: 'module', contextRoot: '.agents',
    capabilityRoot: path.join(capability, '.agents'), sharedDirectories: [], localDirectories: ['skills'],
    sourceRoots: [{ name: 'source', path: 'source', target: capability, gitRoot: capability }]
  }));
  const result = run(root);
  assert.equal(fs.realpathSync(result.target), fs.realpathSync(path.join(root, '.agents', 'skills')));
  assert.equal(fs.existsSync(path.join(result.target, 'sample')), false);
  assert.equal(fs.readFileSync(path.join(capability, '.agents', 'skills', 'sample', 'SKILL.md'), 'utf8'), 'original');
});

test('legacy Claude copier rejects linked targets before changing canonical content', { skip: process.platform !== 'win32' }, () => {
  const root = fixture('legacy-link'); run(root, 'ClaudeCode');
  const script = path.resolve(__dirname, '../sync-claudecode-skills.ps1');
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProjectRoot', root,
      '-ContextRoot', path.join(root, '.agents'), '-CapabilityRoot', path.join(root, '.agents'), '-Mode', 'Write'], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /legacy copying is disabled/);
  }
  assert.equal(fs.readFileSync(path.join(root, '.agents', 'skills', 'sample', 'SKILL.md'), 'utf8'), 'original');
});
