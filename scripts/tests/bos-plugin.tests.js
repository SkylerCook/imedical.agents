'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const repo = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(repo, p), 'utf8');
const shell = process.env.BOS_TEST_POWERSHELL || 'pwsh';
function run(cmd, args, cwd, env = process.env) {
  // PS7 prepends its module paths; let Windows PowerShell build its own defaults.
  if (/^powershell(?:\.exe)?$/i.test(cmd)) {
    env = { ...env };
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  }
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.error || '') + r.stderr + r.stdout);
  return r.stdout;
}
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }
function fixture(t, overlay, singleShared = false) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bos-discovery-'));
  const links = [];
  t.after(() => { for (const l of links) if (fs.existsSync(l)) fs.unlinkSync(l); fs.rmSync(root, { recursive: true, force: true }); });
  const project = path.join(root, 'project'), context = path.join(project, '.agents');
  const capability = overlay ? path.join(root, 'capability') : context;
  fs.mkdirSync(context, { recursive: true });
  fs.mkdirSync(capability, { recursive: true });
  run('git', ['init'], capability);
  for (const name of ['scripts', 'hooks', 'agents', 'workflows']) {
    fs.cpSync(path.join(repo, name), path.join(capability, name), { recursive: true, filter: p => !p.includes(path.join('scripts', 'tests')) });
  }
  for (const name of ['bos-plugin', 'demand-delivery-plugin']) fs.cpSync(path.join(repo, 'plugins', name), path.join(capability, 'plugins', name), { recursive: true });
  if (overlay) {
    const shared = singleShared ? ['plugins'] : ['plugins','agents','workflows'];
    const source = path.join(root, 'source'); fs.mkdirSync(source);
    run('git', ['init'], source);
    for (const [target, alias] of [[source, path.join(project, 'backend')], ...shared.map(name => [path.join(capability, name), path.join(context, name)])]) {
      fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir'); links.push(alias);
    }
    write(path.join(context, 'capability.json'), JSON.stringify({
      schemaVersion: 1, mode: 'workspace-overlay', workspace: 'sample', contextRoot: '.agents',
      capabilityRoot: capability, sharedDirectories: shared, localDirectories: ['config','skills'],
      sourceRoots: [{ name: 'backend', path: 'backend', target: source, gitRoot: source }]
    }));
    fs.mkdirSync(path.join(context, 'skills'));
  }
  return { root, project, context, capability };
}
for (const mode of ['standard', 'overlay', 'overlay-single-shared']) test('plugin discovery respects states and bootstrap exclusion: ' + mode, t => {
  const f = fixture(t, mode !== 'standard', mode === 'overlay-single-shared');
  const queryEntry = path.join(f.context, 'skills/bos-demand-query/SKILL.md');
  const logEntry = path.join(f.context, 'skills/bos-code-update-log/SKILL.md');
  for (const status of ['available','disabled','enabled']) {
    write(path.join(f.context, 'config/plugin_profile.md'), '# Plugin Profile\n\n| plugin | status | initSkill | dependsOn | notes |\n|---|---|---|---|---|\n| bos-plugin | '+status+' | bos-init | - | fixture |\n');
    const updateOutput = run(shell, ['-NoProfile','-File',path.join(f.capability,'scripts/update-agents.ps1'),'-ProjectRoot',f.project,'-Plugin','bos-plugin','-Mode','Write','-NoPull','-Detailed'], f.root);
    assert.equal(fs.existsSync(queryEntry), status === 'enabled', updateOutput);
    assert.equal(fs.existsSync(logEntry), status === 'enabled', updateOutput);
  }
  assert.ok(fs.existsSync(path.join(f.context, 'skills/bos-demand-handle/SKILL.md')));
  assert.ok(fs.existsSync(path.join(f.context, 'skills/bos-demand-entry/SKILL.md')));
  assert.equal(fs.existsSync(path.join(f.context, 'skills/bos-init/SKILL.md')), false);
  // A fresh process resolves the generated pointer and invokes its real script.
  const probe = String.raw`
    const fs=require('fs'),path=require('path');
    const entry=fs.readFileSync(process.argv[1],'utf8');
    const pointer=entry.match(/^source:\s*(.+)$/m)[1].trim();
    const skill=path.resolve(process.argv[2],pointer);
    if(!fs.readFileSync(skill,'utf8').includes('BOS 需求查询'))throw Error('wrong skill');
    const script=path.resolve(path.dirname(fs.realpathSync(skill)),'../../scripts/bos-demand-query.js');
    require('child_process').execFileSync(process.execPath,[script,'defaults'],{stdio:'inherit'});
  `;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('BOS_')) delete env[key];
  const out = run(process.execPath, ['-e', probe, queryEntry, f.project], f.root,
    { ...env, BOS_MCP_CONFIG: writeConfig(f.root), BOS_CUSER: 'synthetic-user' });
  assert.equal(JSON.parse(out).cuser, 'synthetic-user');
  const pointer = fs.readFileSync(logEntry, 'utf8').match(/^source:\s*(.+)$/m)[1].trim();
  const logSkill = fs.realpathSync(path.resolve(f.project, pointer));
  const logScript = path.resolve(path.dirname(logSkill), '../../scripts/bos-code-update-log.js');
  const logOutput = run(process.execPath, [logScript, 'defaults'], f.root, { ...env, BOS_MCP_CONFIG: writeConfig(f.root) });
  assert.equal(JSON.parse(logOutput).tokenConfigured, true);
});
function writeConfig(root) {
  const file = path.join(root, 'private.json');
  write(file, JSON.stringify({
    'bos-demand-query': { url: 'https://example.invalid/sse', headers: { 'X-Gateway-Upstream-BOS-MCP-TOKEN': randomBytes(24).toString('hex') }, cuser: 'synthetic-user', cgroup: 'synthetic-group' },
    'bos-code-update-log': { url: 'https://example.invalid/code-log', token: randomBytes(24).toString('hex'), linkProject: 'synthetic-project' }
  }));
  return file;
}
test('BOS workflow delegates lifecycle, domains and authorization without a second state store', () => {
  const workflow = read('workflows/bos-demand.workflow.md');
  for (const marker of ['taskKind=business-demand','standard-change.workflow.md','delivery-lifecycle.md','task-handoff/SKILL.md','iris-coding/SKILL.md','demand-commit/SKILL.md','acceptance-pending','accepted','serial','Coordinator']) assert.ok(workflow.includes(marker), marker);
  for (const marker of ['非 IRIS','预授权','不自动创建','未验证','只读']) assert.ok(workflow.includes(marker), marker);
  const manifest = JSON.parse(read('plugins/bos-plugin/.agents-plugin/plugin.json'));
  assert.deepEqual(manifest.dependencies, []);
  assert.deepEqual(manifest.thinIndex.excludeSkills, ['bos-init']);
  assert.ok(read('workflows/workflow-registry.md').includes('bos-demand'));
});

for (const overlay of [false, true]) test('updater retires deployed demand names and enables successors: ' + overlay, t => {
  const f = fixture(t, overlay);
  const oldRoot = path.join(f.capability, 'plugins/coding-iris-plugin');
  for (const name of ['iris-demand-commit', 'iris-demand-entry']) write(path.join(oldRoot, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: old deployed entry\n---\n`);
  run(shell, ['-NoProfile', '-File', path.join(f.capability, 'scripts/generate-plugin-thin-index.ps1'), '-ProjectRoot', f.project, '-ContextRoot', f.context, '-CapabilityRoot', f.capability, '-PluginPath', oldRoot, '-Mode', 'Write'], f.root);
  fs.rmSync(oldRoot, { recursive: true });
  write(path.join(f.project, 'AGENTS.md'), '# Project\nUse iris-demand-commit; use iris-demand-entry.\n');
  const args = ['-NoProfile', '-File', path.join(f.capability, 'scripts/update-agents.ps1'), '-ProjectRoot', f.project, '-NoPull', '-Detailed'];
  const preview = run(shell, [...args, '-Mode', 'DryRun'], f.root);
  assert.match(preview, /demand-migration-planned/);
  assert.match(fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'), /iris-demand-commit/);
  const output = run(shell, [...args, '-Mode', 'Write'], f.root);
  assert.match(output, /demand-migration-applied/);
  for (const name of ['demand-commit', 'bos-demand-entry']) assert.ok(fs.existsSync(path.join(f.context, 'skills', name, 'SKILL.md')));
  for (const name of ['iris-demand-commit', 'iris-demand-entry']) assert.equal(fs.existsSync(path.join(f.context, 'skills', name)), false);
  assert.match(fs.readFileSync(path.join(f.context, 'config/plugin_profile.md'), 'utf8'), /demand-delivery-plugin\s*\|\s*enabled/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.project, 'AGENTS.md'), 'utf8'), /iris-demand-/);
  assert.doesNotMatch(run(shell, [...args, '-Mode', 'Write'], f.root), /demand-migration-applied/);
});

for (const overlay of [false, true]) test('generic demand skill is discoverable without IRIS: ' + overlay, t => {
  const f = fixture(t, overlay);
  const entry = path.join(f.context, 'skills/demand-commit/SKILL.md');
  for (const status of ['available', 'disabled', 'enabled']) {
    write(path.join(f.context, 'config/plugin_profile.md'), '# Plugin Profile\n\n| plugin | status | initSkill | dependsOn | notes |\n|---|---|---|---|---|\n| demand-delivery-plugin | '+status+' | - | - | fixture |\n');
    const out = run(shell, ['-NoProfile', '-File', path.join(f.capability, 'scripts/update-agents.ps1'), '-ProjectRoot', f.project, '-Plugin', 'demand-delivery-plugin', '-Mode', 'Write', '-NoPull'], f.root);
    assert.equal(fs.existsSync(entry), status === 'enabled', out);
    if (status === 'enabled') {
      const pointer = fs.readFileSync(entry, 'utf8').match(/^source:\s*(.+)$/m)[1].trim();
      assert.ok(fs.readFileSync(path.resolve(f.project, pointer), 'utf8').includes('name: demand-commit'));
      assert.equal(fs.existsSync(path.join(f.capability, 'plugins/coding-iris-plugin')), false);
    }
  }
});
