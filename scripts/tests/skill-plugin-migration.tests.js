"use strict";
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const shell = process.env.TEST_POWERSHELL || (process.platform === 'win32' ? 'powershell.exe' : 'pwsh');
const base = path.join(os.tmpdir(), 'codex'); fs.mkdirSync(base, { recursive: true });
const temp = fs.mkdtempSync(path.join(base, 'skill-owner-migration-'));
const owners = { 'coding-agent-adaptation': 'agent-context-kit', 'agent-framework-feedback': 'agent-framework-evolution', 'reusable-content-packaging': 'agent-framework-evolution' };
const old = Object.fromEntries(Object.keys(owners).map(name => [name, command('git', ['-C', repo, 'show', `f01bf0e:skills/${name}/SKILL.md`])]));
function command(exe, args, expected = 0) {
  const env = { ...process.env };
  // A Node child of PS7 must not pass PS7-only module paths into Windows PowerShell 5.1.
  if (/powershell(?:\.exe)?$/i.test(exe)) for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, env, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, expected, `${exe} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
function git(root, ...args) { return command('git', ['-C', root, ...args]); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function copyRuntime(capability) {
  fs.mkdirSync(path.join(capability, 'scripts'), { recursive: true });
  for (const f of fs.readdirSync(path.join(repo, 'scripts'))) if (/\.(ps1|js)$/.test(f)) fs.copyFileSync(path.join(repo, 'scripts', f), path.join(capability, 'scripts', f));
  for (const f of ['scripts/lib', 'agents', 'workflows', 'hooks', 'plugins/agent-context-kit', 'plugins/agent-framework-evolution']) fs.cpSync(path.join(repo, f), path.join(capability, f), { recursive: true });
}
function init(root) {
  fs.mkdirSync(root, { recursive: true }); git(root, 'init', '-q'); git(root, 'config', 'user.name', 'Migration Test'); git(root, 'config', 'user.email', 'migration@example.invalid');
}
function fixture(name) {
  const root = path.join(temp, name); init(path.join(root, '.agents')); copyRuntime(path.join(root, '.agents'));
  write(path.join(root, 'AGENTS.md'), '# Custom project entry\nDo not rewrite.'); return root;
}
function ps(script, args, expected = 0) { return command(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], expected); }
function update(root, mode = 'Write', noPull = true, expected = 0) {
  return ps(path.join(root, '.agents/scripts/update-agents.ps1'), ['-ProjectRoot', root, '-Mode', mode, ...(noPull ? ['-NoPull'] : []), '-Detailed'], expected);
}
function thin(root, owner, mode = 'Write', force = false) {
  return ps(path.join(root, '.agents/scripts/generate-plugin-thin-index.ps1'), ['-ProjectRoot', root, '-PluginPath', path.join(root, '.agents/plugins', owner), '-Mode', mode, ...(force ? ['-Force'] : [])]);
}
function skill(root, name) { return path.join(root, '.agents/skills', name, 'SKILL.md'); }
function assertRoutes(root) {
  for (const [name, owner] of Object.entries(owners)) {
    const text = fs.readFileSync(skill(root, name), 'utf8');
    assert.ok(text.includes(`source: .agents/plugins/${owner}/skills/${name}/SKILL.md`), name);
    assert.ok(!/^version:/m.test(text));
  }
}
function cleanup(root) {
  assert.ok(path.resolve(root).startsWith(temp + path.sep));
  for (const f of fs.readdirSync(root)) {
    const item = path.join(root, f); const st = fs.lstatSync(item);
    if (st.isSymbolicLink()) fs.unlinkSync(item);
    else if (st.isDirectory()) cleanup(item);
  }
  fs.rmSync(root, { recursive: true, force: true });
}
after(() => { for (const name of fs.readdirSync(temp)) cleanup(path.join(temp, name)); fs.rmdirSync(temp); assert.ok(!fs.existsSync(temp)); });
test('fresh and legacy projects retain stable names, read-only preview, idempotency and custom AGENTS', () => {
  const root = fixture('legacy spaces');
  for (const [name, text] of Object.entries(old)) write(skill(root, name), '\uFEFF' + text.replace(/\r?\n/g, '\r\n'));
  const before = fs.readFileSync(skill(root, 'agent-framework-feedback'));
  assert.match(update(root, 'DryRun'), /skill-owner-migrated/);
  assert.deepEqual(fs.readFileSync(skill(root, 'agent-framework-feedback')), before);
  assert.ok(!fs.existsSync(path.join(root, '.agents/config/plugin_profile.md')));
  update(root); assertRoutes(root);
  const snapshot = fs.readFileSync(skill(root, 'agent-framework-feedback'));
  update(root); assert.deepEqual(fs.readFileSync(skill(root, 'agent-framework-feedback')), snapshot);
  const profile = fs.readFileSync(path.join(root, '.agents/config/plugin_profile.md'), 'utf8');
  assert.match(profile, /agent-framework-evolution \| enabled/);
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), '# Custom project entry\nDo not rewrite.');
  const fresh = fixture('fresh'); update(fresh); assertRoutes(fresh);
});
test('custom content and linked skill directories are preserved even with Force', () => {
  const root = fixture('custom'); const name = 'agent-framework-feedback';
  const custom = '---\nthin-index: true\nsource: .agents/plugins/removed-owner/skills/old/SKILL.md\n---\nUser custom notes';
  write(skill(root, name), custom);
  assert.match(thin(root, owners[name], 'Write', true), /skill-owner-migration-conflict/);
  assert.equal(fs.readFileSync(skill(root, name), 'utf8'), custom);
  assert.match(update(root, 'Write', true, 1), /skill-owner-migration-conflict/);
  const linked = fixture('linked'); const outside = path.join(temp, 'outside'); fs.mkdirSync(outside); write(path.join(outside, 'SKILL.md'), custom);
  const target = path.dirname(skill(linked, name)); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
  assert.match(thin(linked, owners[name], 'Write', true), /skill-owner-migration-conflict/);
  assert.equal(fs.readFileSync(path.join(outside, 'SKILL.md'), 'utf8'), custom);
});
test('explicit available or disabled survives updates and profile helper calls', () => {
  for (const status of ['available', 'disabled']) {
    const root = fixture(status);
    write(path.join(root, '.agents/config/plugin_profile.md'), `| plugin | status | initSkill | dependsOn | notes |\n|---|---|---|---|---|\n| agent-framework-evolution | ${status} | agent-framework-evolution-init | - | user choice |\n`);
    update(root);
    assert.ok(!fs.existsSync(skill(root, 'agent-framework-feedback')));
    ps(path.join(root, '.agents/scripts/update-plugin-profile.ps1'), ['-ProjectRoot', root, '-Plugin', 'agent-context-kit', '-Status', 'enabled']);
    assert.ok(fs.readFileSync(path.join(root, '.agents/config/plugin_profile.md'), 'utf8').includes(`agent-framework-evolution | ${status}`));
  }
});
test('old deployed updater fast-forwards, resumes new updater and preserves CodeBuddy directory link', () => {
  const publisher = path.join(temp, 'publisher'); init(publisher); copyRuntime(publisher);
  // Seed a previously deployed kit: old tracked root skills, no evolution plugin and old updater.
  cleanup(path.join(publisher, 'plugins/agent-framework-evolution'));
  cleanup(path.join(publisher, 'plugins/agent-context-kit/skills/coding-agent-adaptation'));
  write(path.join(publisher, 'scripts/update-agents.ps1'), command('git', ['-C', repo, 'show', 'f01bf0e:scripts/update-agents.ps1']));
  for (const [name, text] of Object.entries(old)) write(path.join(publisher, 'skills', name, 'SKILL.md'), text);
  git(publisher, 'add', '.'); git(publisher, 'commit', '-qm', 'old kit');
  const project = path.join(temp, 'deployed'); fs.mkdirSync(project);
  command('git', ['clone', '-q', '--no-hardlinks', publisher, path.join(project, '.agents')]);
  write(path.join(project, 'AGENTS.md'), '# Keep project entry');
  write(path.join(project, '.agents/.git/info/exclude'), '/config/\n/skills/\n/rules/\n/work/\n');
  write(path.join(project, '.agents/config/plugin_profile.md'), '| plugin | status | initSkill | dependsOn | notes |\n|---|---|---|---|---|\n| agent-context-kit | enabled | project-context-maintenance | - | old project |\n');
  fs.mkdirSync(path.join(project, '.codebuddy'));
  fs.symlinkSync(path.join(project, '.agents/skills'), path.join(project, '.codebuddy/skills'), process.platform === 'win32' ? 'junction' : 'dir');
  const beforeLink = fs.readlinkSync(path.join(project, '.codebuddy/skills'));
  for (const name of Object.keys(old)) fs.unlinkSync(path.join(publisher, 'skills', name, 'SKILL.md'));
  copyRuntime(publisher); git(publisher, 'add', '-A'); git(publisher, 'commit', '-qm', 'plugin ownership');
  const result = update(project, 'Write', false);
  assert.match(result, /agents-updated/); assertRoutes(project);
  assert.equal(fs.readlinkSync(path.join(project, '.codebuddy/skills')), beforeLink);
  assert.equal(git(path.join(project, '.agents'), 'status', '--porcelain').trim(), '');
  assert.equal(fs.readFileSync(path.join(project, '.codebuddy/skills/agent-framework-feedback/SKILL.md'), 'utf8'), fs.readFileSync(skill(project, 'agent-framework-feedback'), 'utf8'));
  update(project, 'Check');
});

test('Overlay generates module-local owner indexes without modifying shared capability', { skip: process.platform !== 'win32' }, () => {
  const capability = fixture('shared capability'); const root = path.join(temp, 'overlay');
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.mkdirSync(path.join(capability, '.agents/vendor'), { recursive: true });
  fs.symlinkSync(capability, path.join(root, 'source'), 'junction');
  write(path.join(root, 'AGENTS.md'), '# Module entry');
  write(path.join(root, '.agents/capability.json'), JSON.stringify({ schemaVersion: 1, mode: 'workspace-overlay', workspace: 'module', contextRoot: '.agents', capabilityRoot: path.join(capability, '.agents'), sharedDirectories: ['plugins', 'agents', 'workflows', 'hooks', 'vendor'], localDirectories: ['skills', 'config', 'rules', 'memory', 'scripts', 'work'], sourceRoots: [{ name: 'source', path: 'source', target: capability, gitRoot: path.join(capability, '.agents') }] }));
  const before = git(path.join(capability, '.agents'), 'status', '--porcelain');
  ps(path.join(capability, '.agents/scripts/initialize-workspace-overlay.ps1'), ['-WorkspaceRoot', root, '-Mode', 'Write']);
  const initName = 'agent-framework-evolution-init';
  const legacyInit = '---\nthin-index: true\nsource: .agents/plugins/agent-framework-evolution/skills/' + initName + '/SKILL.md\n---\n';
  write(skill(root, initName), legacyInit);
  assert.match(update(root, 'Check'), /excluded managed plugin skill thin-index/);
  assert.equal(fs.readFileSync(skill(root, initName), 'utf8'), legacyInit);
  update(root); assertRoutes(root);
  assert.equal(fs.existsSync(skill(root, initName)), false);
  assert.equal(fs.existsSync(path.dirname(skill(root, initName))), false);
  assert.ok(fs.existsSync(path.join(capability, '.agents/plugins/agent-framework-evolution/skills', initName, 'SKILL.md')));
  assert.equal(git(path.join(capability, '.agents'), 'status', '--porcelain'), before);
  assert.ok(!fs.existsSync(path.join(root, '.agents/.git')));
});


test('pure init policy is explicit while daily initSkill entries remain discoverable', () => {
  const pure = ['agent-framework-evolution', 'coding-iris-plugin', 'i18n-iris-plugin', 'imedicalxc-doctor-perf-analysis-engineer', 'iris-cure-form-dev', 'iris-imedical-doctor-ai', 'iris-interface-dev'];
  for (const owner of fs.readdirSync(path.join(repo, 'plugins'))) {
    const manifest = path.join(repo, 'plugins', owner, '.agents-plugin/plugin.json');
    if (!fs.existsSync(manifest)) continue;
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.equal((m.thinIndex?.excludeSkills || []).includes(m.initSkill), pure.includes(owner), owner);
    if (m.initSkill) assert.ok(fs.existsSync(path.join(repo, 'plugins', owner, 'skills', m.initSkill, 'SKILL.md')));
  }
});

test('excluded init cleanup protects custom content, other sources, companions and directory links', () => {
  const root = fixture('init cleanup boundaries');
  const name = 'agent-framework-evolution-init';
  const file = skill(root, name);
  const managed = '---\nname: ' + name + '\nthin-index: true\nsource: .agents/plugins/agent-framework-evolution/skills/' + name + '/SKILL.md\n---\n';
  write(file, '\uFEFF' + managed.replace(/\n/g, '\r\n'));
  const before = fs.readFileSync(file);
  write(path.join(path.dirname(file), 'notes.txt'), 'user notes');
  assert.match(thin(root, 'agent-framework-evolution', 'DryRun'), /excluded managed plugin skill thin-index/);
  assert.deepEqual(fs.readFileSync(file), before);
  thin(root, 'agent-framework-evolution');
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(path.join(path.dirname(file), 'notes.txt'), 'utf8'), 'user notes');
  thin(root, 'agent-framework-evolution');
  assert.equal(fs.existsSync(file), false);
  for (const content of ['# User init', managed.replace('plugins/agent-framework-evolution/skills/' + name, 'plugins/agent-context-kit/skills/project-context-maintenance'), managed.replace('thin-index: true', 'thin-index: false')]) {
    write(file, content); thin(root, 'agent-framework-evolution', 'Write', true);
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
  // A linked skill directory may belong to a user or another workspace.
  fs.unlinkSync(file); fs.unlinkSync(path.join(path.dirname(file), 'notes.txt')); fs.rmdirSync(path.dirname(file));
  const linked = path.join(root, 'user-linked-init'); write(path.join(linked, 'SKILL.md'), managed);
  fs.symlinkSync(linked, path.dirname(file), process.platform === 'win32' ? 'junction' : 'dir');
  thin(root, 'agent-framework-evolution', 'Write', true);
  assert.ok(fs.lstatSync(path.dirname(file)).isSymbolicLink());
  assert.equal(fs.readFileSync(file, 'utf8'), managed);
});

test('excluded init removes only empty directories including leftovers from earlier updates', () => {
  const root = fixture('empty init leftovers');
  const name = 'agent-framework-evolution-init';
  const file = skill(root, name), dir = path.dirname(file);
  const managed = '---\nthin-index: true\nsource: .agents/plugins/agent-framework-evolution/skills/' + name + '/SKILL.md\n---\n';
  write(file, managed);
  assert.match(thin(root, 'agent-framework-evolution', 'DryRun'), /excluded empty plugin skill directory/);
  assert.equal(fs.readFileSync(file, 'utf8'), managed);
  thin(root, 'agent-framework-evolution');
  assert.equal(fs.existsSync(dir), false);
  // Simulate the preceding updater which deleted SKILL.md but left its directory.
  fs.mkdirSync(dir);
  assert.match(thin(root, 'agent-framework-evolution', 'DryRun'), /excluded empty plugin skill directory/);
  assert.ok(fs.existsSync(dir));
  thin(root, 'agent-framework-evolution');
  assert.equal(fs.existsSync(dir), false);
  thin(root, 'agent-framework-evolution');
  assert.equal(fs.existsSync(dir), false);
  write(path.join(dir, '.keep'), 'hidden user file');
  if (process.platform === 'win32') command('attrib', ['+H', path.join(dir, '.keep')]);
  thin(root, 'agent-framework-evolution');
  assert.equal(fs.readFileSync(path.join(dir, '.keep'), 'utf8'), 'hidden user file');
  if (process.platform === 'win32') command('attrib', ['-H', path.join(dir, '.keep')]);
  fs.unlinkSync(path.join(dir, '.keep'));
  fs.mkdirSync(path.join(dir, 'user-folder'));
  thin(root, 'agent-framework-evolution');
  assert.ok(fs.existsSync(path.join(dir, 'user-folder')));
  fs.rmdirSync(path.join(dir, 'user-folder')); fs.rmdirSync(dir);
  const linked = path.join(root, 'empty linked directory'); fs.mkdirSync(linked);
  fs.symlinkSync(linked, dir, process.platform === 'win32' ? 'junction' : 'dir');
  thin(root, 'agent-framework-evolution');
  assert.ok(fs.lstatSync(dir).isSymbolicLink());
  assert.ok(fs.existsSync(linked));
  fs.unlinkSync(dir);
  // An ancestor link is protected even when the skill directory itself is ordinary.
  const skillsDir = path.dirname(dir), movedSkills = path.join(root, 'linked skills root');
  fs.renameSync(skillsDir, movedSkills);
  fs.symlinkSync(movedSkills, skillsDir, process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(dir);
  thin(root, 'agent-framework-evolution');
  assert.ok(fs.existsSync(dir));
});
