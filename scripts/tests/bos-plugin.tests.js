'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
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
  fs.cpSync(path.join(repo, 'plugins/bos-plugin'), path.join(capability, 'plugins/bos-plugin'), { recursive: true });
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
  for (const status of ['available','disabled','enabled']) {
    write(path.join(f.context, 'config/plugin_profile.md'), '# Plugin Profile\n\n| plugin | status | initSkill | dependsOn | notes |\n|---|---|---|---|---|\n| bos-plugin | '+status+' | bos-init | - | fixture |\n');
    const updateOutput = run(shell, ['-NoProfile','-File',path.join(f.capability,'scripts/update-agents.ps1'),'-ProjectRoot',f.project,'-Plugin','bos-plugin','-Mode','Write','-NoPull','-Detailed'], f.root);
    assert.equal(fs.existsSync(queryEntry), status === 'enabled', updateOutput);
  }
  assert.ok(fs.existsSync(path.join(f.context, 'skills/bos-demand-handle/SKILL.md')));
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
    { ...env, BOS_MCP_URL: 'https://example.invalid/sse', BOS_MCP_TOKEN: 'synthetic-token', BOS_CUSER: 'synthetic-user' });
  assert.equal(JSON.parse(out).cuser, 'synthetic-user');
});
test('BOS workflow delegates lifecycle, domains and authorization without a second state store', () => {
  const workflow = read('workflows/bos-demand.workflow.md');
  for (const marker of ['taskKind=business-demand','standard-change.workflow.md','delivery-lifecycle.md','task-handoff/SKILL.md','iris-coding/SKILL.md','iris-demand-commit/SKILL.md','acceptance-pending','accepted','serial','Coordinator']) assert.ok(workflow.includes(marker), marker);
  for (const marker of ['非 IRIS','预授权','不自动创建','未验证','只读']) assert.ok(workflow.includes(marker), marker);
  const manifest = JSON.parse(read('plugins/bos-plugin/.agents-plugin/plugin.json'));
  assert.deepEqual(manifest.dependencies, []);
  assert.deepEqual(manifest.thinIndex.excludeSkills, ['bos-init']);
  assert.ok(read('workflows/workflow-registry.md').includes('bos-demand'));
});
