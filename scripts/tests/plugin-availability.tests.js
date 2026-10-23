'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { checkAvailability } = require('../check-plugin-availability');
const repo = path.resolve(__dirname, '../..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'availability-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const capabilityRoot = path.join(root, 'capability'), contextRoot = path.join(root, 'project/.agents');
  const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
  const owner = path.join(capabilityRoot, 'plugins/source/.agents-plugin/plugin.json');
  const entries = [{ plugin: 'target', stage: 'submit', trigger: 'Submit', entries: ['skills/run/SKILL.md'] }];
  write(owner, JSON.stringify({ name: 'source', availableDependencies: entries }));
  write(path.join(capabilityRoot, 'plugins/target/.agents-plugin/plugin.json'), JSON.stringify({ name: 'target' }));
  const entry = path.join(capabilityRoot, 'plugins/target/skills/run/SKILL.md'); write(entry, '# Run');
  const profile = path.join(contextRoot, 'config/plugin_profile.md'); write(profile, '| target | available |\n');
  return { root, write, owner, entries, entry, profile, options: { capabilityRoot, contextRoot, plugin: 'source' } };
}
test('available/enabled pass; disabled blocks without changing profile', t => {
  const f = fixture(t);
  for (const state of ['available', 'enabled', 'disabled', 'indexed', 'initialized']) {
    const text = `| target | ${state} |\n`; f.write(f.profile, text);
    assert.equal(checkAvailability({ ...f.options, stage: 'submit' }).ok, state !== 'disabled');
    assert.equal(fs.readFileSync(f.profile, 'utf8'), text);
  }
});
test('inventory warns, selected stage blocks, unknown stage and malformed declaration fail', t => {
  const f = fixture(t); fs.unlinkSync(f.entry);
  const args = ['scripts/check-plugin-availability.js', '--capability-root', f.options.capabilityRoot, '--context-root', f.options.contextRoot, '--plugin', 'source'];
  const run = extra => spawnSync(process.execPath, [...args, ...extra], { cwd: repo, encoding: 'utf8', windowsHide: true });
  assert.equal(run([]).status, 0);
  const stage = run(['--stage', 'submit']); assert.equal(stage.status, 1); assert.equal(JSON.parse(stage.stdout).ok, false);
  assert.equal(run(['--stage', 'typo']).status, 2);
  f.entries[0].entries = ['../escape']; f.write(f.owner, JSON.stringify({ name: 'source', availableDependencies: f.entries }));
  assert.equal(run([]).status, 2);
});
test('only selected stage blocks; manifest identity and file type are checked', t => {
  const f = fixture(t);
  f.entries.push({ plugin: 'missing', stage: 'optional', trigger: 'Optional', entries: ['skills/run/SKILL.md'] });
  f.write(f.owner, JSON.stringify({ name: 'source', availableDependencies: f.entries }));
  assert.equal(checkAvailability({ ...f.options, stage: 'submit' }).ok, true);
  assert.equal(checkAvailability(f.options).ok, false);
  fs.unlinkSync(f.entry); fs.mkdirSync(f.entry);
  assert.equal(checkAvailability({ ...f.options, stage: 'submit' }).ok, false);
  f.write(path.join(f.options.capabilityRoot, 'plugins/target/.agents-plugin/plugin.json'), '{}');
  assert.ok(checkAvailability({ ...f.options, stage: 'submit' }).checks[0].problems.includes('manifest-missing-or-invalid'));
});
test('BOS-independent exports load without Delivery; dependent stage gives explicit error', t => {
  const f = fixture(t);
  for (const file of ['plugins/bos-plugin/scripts/demand-entry.js', 'plugins/bos-plugin/scripts/demand-entry-xlsx.js',
    'plugins/bos-plugin/.agents-plugin/plugin.json', 'scripts/check-plugin-availability.js', 'scripts/lib/workspace-context.js', 'scripts/lib/demand-code-binding.js']) {
    f.write(path.join(f.options.capabilityRoot, file), fs.readFileSync(path.join(repo, file)));
  }
  const entry = require(path.join(f.options.capabilityRoot, 'plugins/bos-plugin/scripts/demand-entry.js'));
  assert.equal(typeof entry.collect, 'function');
  assert.throws(() => entry.prepare({ kind: 'standard' }, f.root), /BOS 补录依赖不可用/);
});
test('real declarations resolve without recursing bilateral availability', () => {
  for (const plugin of ['bos-plugin', 'demand-delivery-plugin']) {
    const result = checkAvailability({ capabilityRoot: repo, contextRoot: path.join(repo, '.agents'), plugin });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
});

test('Overlay CLI reads project-local state, not capability-local state', t => {
  const f = fixture(t);
  const project = path.dirname(f.options.contextRoot);
  f.write(path.join(f.options.contextRoot, 'capability.json'), JSON.stringify({ schemaVersion: 1,
    mode: 'workspace-overlay', workspace: 'sample', contextRoot: '.agents', capabilityRoot: f.options.capabilityRoot,
    sharedDirectories: ['plugins'], localDirectories: ['config', 'skills'], sourceRoots: [] }));
  f.write(f.profile, '| target | disabled |\n');
  f.write(path.join(f.options.capabilityRoot, 'config/plugin_profile.md'), '| target | enabled |\n');
  const r = spawnSync(process.execPath, ['scripts/check-plugin-availability.js', '--project-root', project, '--plugin', 'source', '--stage', 'submit'], { cwd: repo, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 1, r.stderr);
  assert.ok(JSON.parse(r.stdout).checks[0].problems.includes('plugin-disabled'));
});

test('entry directory links cannot escape the dependency plugin', t => {
  const f = fixture(t);
  const outside = path.join(f.root, 'outside'); f.write(path.join(outside, 'SKILL.md'), '# Outside');
  const linked = path.dirname(f.entry); fs.rmSync(linked, { recursive: true });
  fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.equal(checkAvailability({ ...f.options, stage: 'submit' }).ok, false); }
  finally { fs.unlinkSync(linked); }
});

test('explicit project state protects BOS prepare even when called from another directory', () => {
  // Reject before reading evidence or writing output.
  const entry = require('../../plugins/bos-plugin/scripts/demand-entry');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'availability-project-'));
  try {
    fs.mkdirSync(path.join(root, '.agents/config'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agents/config/plugin_profile.md'), '| demand-delivery-plugin | disabled |\n');
    assert.throws(() => entry.prepare({ kind: 'standard' }, root, root), /plugin-disabled/);
    assert.throws(() => entry.planArguments({ kind: 'standard', schema: 'iris-standard-demand/v2', requirements: [{ key: 'r1' }] }, 'r1', root), /plugin-disabled/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Exercise the UI stage through the same resolver used by deployed projects.
test('UI regression stage uses real manifests; disabled/missing stop only this stage', t => {
  const f = fixture(t);
  const ui = JSON.parse(readSource('plugins/iris-ui/.agents-plugin/plugin.json'));
  const target = 'agent-framework-evolution';
  f.write(path.join(f.options.capabilityRoot, 'plugins/iris-ui/.agents-plugin/plugin.json'), JSON.stringify(ui));
  const targetManifest = path.join(f.options.capabilityRoot, 'plugins', target, '.agents-plugin/plugin.json');
  f.write(targetManifest, readSource('plugins/' + target + '/.agents-plugin/plugin.json'));
  const entry = path.join(f.options.capabilityRoot, 'plugins', target, 'skills/agent-framework-feedback/SKILL.md');
  f.write(entry, readSource('plugins/' + target + '/skills/agent-framework-feedback/SKILL.md'));
  const options = { ...f.options, plugin: 'iris-ui', stage: 'ui-self-regression' };
  for (const state of ['available', 'enabled', 'disabled']) {
    const profile = '| ' + target + ' | ' + state + ' |\n'; f.write(f.profile, profile);
    assert.equal(checkAvailability(options).ok, state !== 'disabled');
    assert.equal(fs.readFileSync(f.profile, 'utf8'), profile);
  }
  f.write(f.profile, '| ' + target + ' | available |\n');
  fs.unlinkSync(entry);
  assert.equal(checkAvailability(options).ok, false);
  assert.equal(checkAvailability({ ...options, stage: undefined }).checks[0].problems.length > 0, true);
  f.write(entry, '# Entry restored'); fs.unlinkSync(targetManifest);
  assert.equal(checkAvailability(options).ok, false);
  assert.equal(ui.dependencies.includes(target), false);
  assert.deepEqual(ui.availableDependencies[0].entries, ['skills/agent-framework-feedback/SKILL.md']);
});
function readSource(relative) { return fs.readFileSync(path.join(repo, relative), 'utf8'); }

test('feedback authorization pointers share one owner instead of per-item-only contracts', () => {
  const owner = readSource('plugins/agent-framework-evolution/skills/agent-framework-feedback/SKILL.md');
  assert.match(owner, /## 写入授权与自动待审补丁/);
  for (const text of ['默认模式', '当前任务或项目明确授权', '独立 worktree/branch', '同一需求多次返修',
    '缺少任一证据', '源仓未知、不可用、权限不足', '不递归生成自身反馈']) assert.ok(owner.includes(text), text);
  for (const file of ['agents/_shared/delivery-lifecycle.md', 'agents/_shared/feedback-protocol.md',
    'plugins/agent-context-kit/templates/AGENTS.template.md', 'plugins/agent-context-kit/templates/AGENTS.context-snippet.md',
    'plugins/coding-iris-plugin/skills/iris-deploy/SKILL.md', 'docs/update-agents.md']) {
    const text = readSource(file);
    assert.doesNotMatch(text, /仍需用户逐项授权|均必须由用户逐项授权|只有逐项授权/);
    assert.match(text, /feedback skill|feedback.*授权/);
  }
});
