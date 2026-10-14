'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const { plan, apply } = require('../migrate-demand-ownership');
const repo = path.resolve(__dirname, '../..');
const shell = process.env.BOS_TEST_POWERSHELL || 'pwsh';
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
function run(args) {
  const env = { ...process.env };
  if (/^powershell(?:\.exe)?$/i.test(shell)) for (const k of Object.keys(env)) if (k.toLowerCase() === 'psmodulepath') delete env[k];
  const r = spawnSync(shell, ['-NoProfile', '-File', ...args], { encoding: 'utf8', env, windowsHide: true, timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr + String(r.error || ''));
  return r.stdout;
}
function fixture(t, overlay = false) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'demand-owner-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'project'), local = path.join(root, '.agents');
  const capability = overlay ? path.join(temp, 'capability') : local;
  const context = { workspaceRoot: root, contextRoot: local, capabilityRoot: capability };
  for (const owner of ['bos-plugin', 'demand-delivery-plugin']) fs.cpSync(path.join(repo, 'plugins', owner), path.join(capability, 'plugins', owner), { recursive: true });
  for (const name of ['iris-demand-commit', 'iris-demand-entry']) write(path.join(capability, 'plugins/coding-iris-plugin/skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Test legacy entry\n---\n`);
  const generate = owner => run([path.join(repo, 'scripts/generate-plugin-thin-index.ps1'), '-ProjectRoot', root, '-ContextRoot', local, '-CapabilityRoot', capability, '-PluginPath', path.join(capability, 'plugins', owner), '-Mode', 'Write']);
  generate('coding-iris-plugin');
  fs.rmSync(path.join(capability, 'plugins/coding-iris-plugin'), { recursive: true });
  write(path.join(root, 'AGENTS.md'), '# Project\r\n\r\n保留这段说明。使用 iris-demand-commit 和 [录入](.agents/plugins/coding-iris-plugin/skills/iris-demand-entry/SKILL.md)。\r\n');
  write(path.join(local, 'config/iris_project_profile.md'), '- 默认需求交付类型：project\n');
  write(path.join(local, 'config/plugin_profile.md'), '# Plugin Profile\n\n| plugin | status | initSkill | dependsOn | notes |\n|---|---|---|---|---|\n| coding-iris-plugin | enabled | coding-iris-init | - | iris-demand-commit |\n');
  return { context, root, local, capability, generate };
}
for (const overlay of [false, true]) test('migrates references and states only after new entries exist; repeat is a no-op: ' + overlay, t => {
  const f = fixture(t, overlay), p = plan(f.context);
  assert.deepEqual(p.conflicts, []);
  assert.deepEqual(new Set(p.owners), new Set(['bos-plugin', 'demand-delivery-plugin']));
  assert.throws(() => apply(f.context, p));
  assert.match(fs.readFileSync(path.join(f.root, 'AGENTS.md'), 'utf8'), /iris-demand-commit/);
  for (const owner of p.owners) f.generate(owner);
  assert.ok(fs.existsSync(path.join(f.local, 'skills/iris-demand-commit/SKILL.md')), 'generator must preserve old entry until migration commits');
  apply(f.context, p);
  assert.equal(fs.existsSync(path.join(f.local, 'skills/iris-demand-commit')), false);
  assert.match(fs.readFileSync(path.join(f.root, 'AGENTS.md'), 'utf8'), /保留这段说明。使用 demand-commit/);
  assert.match(fs.readFileSync(path.join(f.local, 'config/plugin_profile.md'), 'utf8'), /bos-plugin \| enabled/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.local, 'config/plugin_profile.md'), 'utf8'), /iris-demand-commit/);
  assert.match(fs.readFileSync(path.join(f.local, 'config/demand_delivery_profile.md'), 'utf8'), /产品标识：IRIS/);
  assert.deepEqual(plan(f.context), { owners: [], changes: [], removals: [], conflicts: [] });
});
test('custom content, explicit states, filtered owners, missing targets and input drift block retirement', t => {
  const f = fixture(t), old = path.join(f.local, 'skills/iris-demand-commit/SKILL.md');
  const original = fs.readFileSync(old, 'utf8');
  fs.appendFileSync(old, '\nCustom instructions\n');
  assert.ok(plan(f.context).conflicts.some(x => x.includes('custom old skill')));
  const agents = fs.readFileSync(path.join(f.root, 'AGENTS.md'), 'utf8');
  fs.unlinkSync(path.join(f.root, 'AGENTS.md'));
  assert.ok(plan(f.context).conflicts.some(x => x.includes('custom old skill')), 'a custom old entry alone must still block');
  write(path.join(f.root, 'AGENTS.md'), agents);
  fs.writeFileSync(old, original);
  for (const state of ['available', 'disabled']) {
    write(path.join(f.local, 'config/plugin_profile.md'), `| demand-delivery-plugin | ${state} | - | - | user preference |\n`);
    assert.ok(plan(f.context).conflicts.some(x => x.includes('explicit plugin state')));
  }
  fs.unlinkSync(path.join(f.local, 'config/plugin_profile.md'));
  write(path.join(f.local, 'config/plugin_profile.md'), '| DEMAND-DELIVERY-PLUGIN | initialized | - | - | legacy initialized state |\n');
  assert.deepEqual(plan(f.context).conflicts, []);
  write(path.join(f.local, 'config/plugin_profile.md'), '| demand-delivery-plugin | enabled | - | - | first |\n| demand-delivery-plugin | disabled | - | - | duplicate |\n');
  assert.ok(plan(f.context).conflicts.some(x => x.includes('duplicate')));
  fs.unlinkSync(path.join(f.local, 'config/plugin_profile.md'));
  write(path.join(f.local, 'config/plugin_profile.md'), '| coding-iris-plugin | disabled | - | - | user preference |\n');
  assert.ok(plan(f.context).conflicts.some(x => x.includes('legacy plugin state')));
  fs.unlinkSync(path.join(f.local, 'config/plugin_profile.md'));
  assert.ok(plan(f.context, ['coding-iris-plugin']).conflicts.some(x => x.includes('filtered')));
  assert.ok(plan(f.context, [], ['bos-plugin']).conflicts.some(x => x.includes('filtered')));
  write(path.join(f.local, 'scripts/custom.ps1'), '');
  write(path.join(f.local, 'config/custom.json'), '{"skill":"iris-demand-entry"}');
  assert.ok(plan(f.context).conflicts.some(x => x.includes('custom.json')));
  fs.unlinkSync(path.join(f.local, 'config/custom.json'));
  write(path.join(f.root, '.github/workflows/commit.yml'), 'run: node .agents/plugins/coding-iris-plugin/scripts/iris-tools/commit-demand.js plan');
  assert.ok(plan(f.context).conflicts.some(x => x.includes('commit.yml')));
  fs.unlinkSync(path.join(f.root, '.github/workflows/commit.yml'));
  const p = plan(f.context);
  for (const owner of p.owners) f.generate(owner);
  fs.appendFileSync(path.join(f.root, 'AGENTS.md'), '\nConcurrent edit');
  assert.throws(() => apply(f.context, p), /input changed/);
  assert.ok(fs.existsSync(old));
  fs.unlinkSync(path.join(f.capability, 'plugins/bos-plugin/skills/bos-demand-entry/SKILL.md'));
  assert.ok(plan(f.context).conflicts.some(x => x.includes('missing new skill')));
});

test('linked old entry and custom successor are preserved', t => {
  const f = fixture(t), oldDir = path.join(f.local, 'skills/iris-demand-commit');
  const held = path.join(f.root, 'held');
  fs.renameSync(oldDir, held);
  fs.symlinkSync(held, oldDir, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => { if (fs.existsSync(oldDir) && fs.lstatSync(oldDir).isSymbolicLink()) fs.unlinkSync(oldDir); });
  const p = plan(f.context);
  assert.ok(p.conflicts.some(x => x.includes('linked')));
  assert.throws(() => apply(f.context, p));
  assert.ok(fs.existsSync(path.join(held, 'SKILL.md')));
  write(path.join(f.local, 'skills/demand-commit/SKILL.md'), '# User-owned skill\n');
  assert.ok(plan(f.context).conflicts.some(x => x.includes('custom new skill')));
});
