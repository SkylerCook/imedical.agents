'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const handoff = require('../../plugins/agent-context-kit/scripts/task-handoff.js');
const evidence = require('../validation-evidence.js');
const repo = path.resolve(__dirname, '../..');
const tool = path.join(repo, 'plugins/agent-context-kit/scripts/task-handoff.js');

function fixture(t) {
  const parent = path.join(fs.realpathSync(os.tmpdir()), 'codex');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'task-handoff-'));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    function unlinkChildren(dir) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isSymbolicLink()) fs.unlinkSync(file);
        else if (item.isDirectory()) unlinkChildren(file);
      }
    }
    unlinkChildren(root);
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false);
  });
  return root;
}
function write(file, body) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); }
function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function repository(root, commit = true) {
  fs.mkdirSync(root, { recursive: true });
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Handoff fixture']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  write(path.join(root, 'src/main.js'), 'one\n');
  write(path.join(root, 'AGENTS.md'), '# Fixture rules\n');
  if (commit) { git(root, ['add', '.']); git(root, ['-c', 'core.hooksPath=', 'commit', '-qm', 'fixture']); }
  return root;
}
function create(root, input, options = {}) {
  const ws = handoff.workspace(root);
  const created = handoff.init(ws, { title: '需求接续', taskKind: 'business-demand', ...options }, input || { repositories: [{ root, scopes: ['src'] }], entrypoints: ['AGENTS.md'] });
  return { ws, directory: created.directory, created };
}
function finish(ws, directory, input) {
  const file = path.join(directory, 'handoff.md');
  let text = fs.readFileSync(file, 'utf8').replaceAll('TODO:', '已确认：').replaceAll('TODO', '已确认');
  text = text.replace(/## 下一步\n[\s\S]*?(?=\n## )/, '## 下一步\n\n检查 src/main.js 的待实现行为，并沿用已有授权。\n');
  fs.writeFileSync(file, text);
  return handoff.checkpoint(ws, directory, input);
}

test('init is local-only, preserves exclusions and rejects unfinished snapshots', t => {
  const root = repository(fixture(t));
  const exclude = path.join(root, '.git/info/exclude');
  fs.appendFileSync(exclude, '\n/private-fixture/\n');
  const before = fs.readFileSync(exclude, 'utf8');
  const { ws, directory } = create(root);
  assert.ok(fs.readFileSync(exclude, 'utf8').startsWith(before));
  assert.match(fs.readFileSync(exclude, 'utf8'), /\/docs\/handoff\//);
  assert.equal(git(root, ['status', '--porcelain']), '');
  assert.equal(fs.existsSync(path.join(root, '.gitignore')), false);
  assert.throws(() => handoff.snapshot(ws, directory), /not ready/);
  finish(ws, directory);
  assert.equal(handoff.validate(ws, directory).valid, true);
});

test('stable identity survives later demand ID; snapshots are immutable and unique', t => {
  const root = repository(fixture(t));
  const { ws, directory } = create(root);
  const second = create(root).directory;
  assert.notEqual(directory, second);
  assert.match(path.basename(directory), /^\d{8}-\d{9}-00000$/);
  finish(ws, directory);
  const first = handoff.snapshot(ws, directory).file, body = fs.readFileSync(first, 'utf8');
  const file = path.join(directory, 'handoff.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('demandId: "00000"', 'demandId: "REQ-42"'));
  assert.equal(handoff.inspect(ws, directory).valid, false);
  finish(ws, directory);
  assert.notEqual(handoff.snapshot(ws, directory).file, first);
  assert.equal(fs.readFileSync(first, 'utf8'), body);
  assert.equal(handoff.list(ws).tasks.find(v => v.directory === directory).demandId, 'REQ-42');
  assert.equal(handoff.list(ws).tasks.length, 2);
});

test('same-path unstaged and staged changes are detected without updating the baseline', t => {
  const root = repository(fixture(t));
  const { ws, directory } = create(root);
  write(path.join(root, 'src/main.js'), 'two\n');
  finish(ws, directory);
  const baseline = fs.readFileSync(path.join(directory, 'state.json'), 'utf8');
  write(path.join(root, 'src/main.js'), 'three\n');
  let report = handoff.inspect(ws, directory);
  assert.ok(report.changes.includes('workspace-changed'));
  assert.equal(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'), baseline);
  git(root, ['add', 'src/main.js']);
  report = handoff.inspect(ws, directory);
  assert.equal(report.current.repositories[0].changes[0].index, 'M');
  finish(ws, directory);
  git(root, ['mv', 'src/main.js', 'src/renamed.js']);
  assert.ok(handoff.inspect(ws, directory).changes.includes('workspace-changed'));
  fs.unlinkSync(path.join(root, 'src/renamed.js'));
  assert.equal(handoff.validate(ws, directory).valid, false);
});

test('multiple repositories retain separate checkout identity and unowned changes', t => {
  const base = fixture(t), root = repository(path.join(base, 'project')), other = repository(path.join(base, 'other'));
  const input = { repositories: [{ root, scopes: ['src'] }, { root: other, scopes: ['src'] }] };
  const { ws, directory } = create(root, input);
  write(path.join(other, 'unrelated.txt'), 'preserve me');
  finish(ws, directory);
  const report = handoff.inspect(ws, directory);
  assert.equal(report.current.repositories.length, 2);
  assert.ok(report.current.repositories[1].changes.some(v => v.path === 'unrelated.txt'));
  assert.equal(fs.readFileSync(path.join(other, 'unrelated.txt'), 'utf8'), 'preserve me');
});

test('missing or damaged state requires explicit recovery inputs; interrupted document updates stay visible', t => {
  const root = repository(fixture(t));
  const { ws, directory } = create(root);
  finish(ws, directory);
  fs.appendFileSync(path.join(directory, 'handoff.md'), '\nUser correction\n');
  assert.ok(handoff.inspect(ws, directory).changes.includes('document-changed'));
  write(path.join(directory, 'state.json'), '{broken');
  assert.equal(handoff.inspect(ws, directory).valid, false);
  assert.throws(() => handoff.checkpoint(ws, directory));
  finish(ws, directory, { repositories: [{ root, scopes: ['src'] }] });
  assert.equal(handoff.validate(ws, directory).valid, true);
});

test('list preserves healthy candidates alongside corrupt records and excludes closed by default', t => {
  const root = repository(fixture(t));
  const one = create(root), two = create(root);
  finish(one.ws, one.directory);
  finish(two.ws, two.directory);
  const file = path.join(two.directory, 'handoff.md');
  write(file, fs.readFileSync(file, 'utf8').replace('status: "active"', 'status: "closed"'));
  write(path.join(one.ws.base, 'corrupt/handoff.md'), 'broken');
  const listed = handoff.list(one.ws);
  assert.equal(listed.tasks.length, 1);
  assert.match(listed.tasks[0].resumePoint, /src\/main.js/);
  assert.equal(listed.errors.length, 1);
  assert.equal(handoff.list(one.ws, true).tasks.length, 2);
});

test('non-Git projects and unborn Git repos report real capability limits', t => {
  const base = fixture(t), root = path.join(base, 'plain');
  write(path.join(root, 'src/main.js'), 'one'); write(path.join(root, 'AGENTS.md'), '# plain');
  const plain = create(root); finish(plain.ws, plain.directory);
  assert.equal(handoff.inspect(plain.ws, plain.directory).current.repositories[0].git, 'not-a-repository');
  const unborn = create(repository(path.join(base, 'unborn'), false)); finish(unborn.ws, unborn.directory);
  assert.equal(handoff.inspect(unborn.ws, unborn.directory).current.repositories[0].head, null);
});

test('missing Git is explicit on inspect and blocks new local-only initialization', t => {
  const root = repository(fixture(t));
  const { directory } = create(root);
  const run = command => spawnSync(process.execPath, [tool, command, '--project-root', root, '--task-directory', directory, '--title', 'Missing Git', '--task-kind', 'other'], { encoding: 'utf8', env: { ...process.env, PATH: '' }, windowsHide: true });
  const read = run('inspect'); assert.equal(read.status, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout).current.repositories[0].git, 'unavailable');
  const init = run('init'); assert.equal(init.status, 1); assert.match(init.stderr, /Git unavailable/);
});

test('tracked handoffs are preserved, never automatically removed from Git', t => {
  const root = repository(fixture(t));
  write(path.join(root, 'docs/handoff/existing.md'), 'keep');
  git(root, ['add', 'docs/handoff/existing.md']);
  const before = git(root, ['ls-files', '--stage']);
  assert.throws(() => create(root), /already tracked/);
  assert.equal(git(root, ['ls-files', '--stage']), before);
  assert.equal(fs.readFileSync(path.join(root, 'docs/handoff/existing.md'), 'utf8'), 'keep');
});

test('actual Git worktree uses its own checkout and Git-resolved exclude path', t => {
  const base = fixture(t), main = repository(path.join(base, 'main')), worktree = path.join(base, 'worktree');
  git(main, ['worktree', 'add', '-qb', 'handoff-fixture', worktree]);
  const { ws, directory } = create(worktree); finish(ws, directory);
  const observed = handoff.inspect(ws, directory).current.repositories[0];
  assert.equal(observed.branch, 'handoff-fixture');
  assert.equal(path.resolve(observed.gitRoot), path.resolve(worktree));
  assert.equal(git(worktree, ['status', '--porcelain']), '');
});

test('scope, task path and symlink escapes are rejected before foreign writes', t => {
  const base = fixture(t), root = repository(path.join(base, 'project')), outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  const ws = handoff.workspace(root);
  assert.throws(() => create(root, { repositories: [{ root, scopes: ['../outside'] }] }), /Invalid scope/);
  assert.throws(() => handoff.inspect(ws, outside), /direct child/);
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'docs/handoff'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => handoff.workspace(root), /Linked path/);
  assert.equal(fs.readdirSync(outside).length, 0);
});

test('invalid and valid Overlay contexts respect declared SourceRoot and GitRoot', t => {
  const base = fixture(t), root = path.join(base, 'module'), source = repository(path.join(base, 'source')), capability = path.join(base, 'capability');
  fs.mkdirSync(path.join(capability, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  const manifest = { schemaVersion: 1, mode: 'workspace-overlay', workspace: 'module', contextRoot: '.agents', capabilityRoot: capability, sharedDirectories: [], localDirectories: [], sourceRoots: [{ name: 'source', path: 'source', target: source, gitRoot: source }] };
  write(path.join(root, '.agents/capability.json'), JSON.stringify(manifest));
  assert.throws(() => handoff.workspace(root), /Invalid workspace/);
  fs.symlinkSync(source, path.join(root, 'source'), process.platform === 'win32' ? 'junction' : 'dir');
  const ws = handoff.workspace(root);
  const input = { repositories: [{ root: source, scopes: ['src'] }] };
  const { directory } = create(root, input); finish(ws, directory);
  assert.equal(handoff.validate(ws, directory).valid, true);
  assert.throws(() => handoff.normalizeInputs(ws, { repositories: [{ root: capability, scopes: [] }] }), /SourceRoot/);
  manifest.sourceRoots[0].gitRoot = capability;
  write(path.join(root, '.agents/capability.json'), JSON.stringify(manifest));
  assert.throws(() => handoff.inspect(handoff.workspace(root), directory), /Git root differs/);
});

test('entrypoints and document links must exist; unknown evidence never becomes passed', t => {
  const root = repository(fixture(t));
  const { ws, directory } = create(root);
  finish(ws, directory, { repositories: [{ root, scopes: ['src'] }], evidence: [{ repoRoot: root, suite: 'missing', evidenceFile: path.join(root, 'absent.json') }] });
  assert.equal(handoff.inspect(ws, directory).current.evidence[0].reusable, false);
  fs.appendFileSync(path.join(directory, 'handoff.md'), '\n[missing](../../../missing.md)\n');
  assert.throws(() => handoff.checkpoint(ws, directory), /Missing or invalid links/);
  assert.throws(() => create(root, { entrypoints: ['absent.md'] }), /Missing entrypoint/);
});

test('evidence reuse is scope-bound and external evidence replacement is observable', t => {
  const root = repository(fixture(t));
  const evidenceFile = path.join(root, 'evidence.json');
  evidence.record(root, { suite: 'fixture', scopes: ['src'], command: 'fixture verified', evidenceFile });
  const { ws, directory } = create(root, { repositories: [{ root, scopes: ['src'] }], evidence: [{ repoRoot: root, suite: 'fixture', evidenceFile }] });
  finish(ws, directory);
  assert.equal(handoff.inspect(ws, directory).current.evidence[0].reusable, true);
  write(path.join(root, 'unrelated.md'), 'unrelated');
  assert.equal(handoff.inspect(ws, directory).current.evidence[0].reusable, true);
  write(path.join(root, 'src/main.js'), 'changed');
  assert.equal(handoff.inspect(ws, directory).current.evidence[0].reusable, false);
  evidence.record(root, { suite: 'fixture', scopes: ['src'], command: 'fixture verified again', evidenceFile });
  assert.ok(handoff.inspect(ws, directory).changes.includes('workspace-changed'));
});

test('atomic state failure preserves baseline and removes only its temporary file', t => {
  const root = repository(fixture(t)), { ws, directory } = create(root);
  finish(ws, directory);
  const before = fs.readFileSync(path.join(directory, 'state.json'), 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated interrupted write'); };
  try { assert.throws(() => handoff.checkpoint(ws, directory), /simulated/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['handoff.md', 'state.json']);
});

test('CLI rejects unknown options and validates without mutating files', t => {
  const root = repository(fixture(t)), { ws, directory } = create(root); finish(ws, directory);
  const before = fs.readFileSync(path.join(directory, 'state.json'), 'utf8');
  const call = args => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(call(['validate', '--project-root', root, '--task-directory', directory]).status, 0);
  assert.equal(call(['list', '--project-root', root, '--unexpected']).status, 1);
  assert.equal(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'), before);
});

test('snapshot relocates Markdown links, preserves code and resolves timestamp collisions', t => {
  const root = fixture(t);
  write(path.join(root, 'AGENTS.md'), '# local');
  write(path.join(root, 'src/main.js'), 'one');
  const original = Date.now;
  Date.now = () => 1789740000000;
  try {
    const first = create(root), second = create(root, undefined, { demandId: '../unsafe:id' });
    const third = create(root);
    assert.notEqual(first.directory, third.directory);
    assert.equal(path.dirname(second.directory), first.ws.base);
    finish(first.ws, first.directory);
    fs.appendFileSync(path.join(first.directory, 'handoff.md'), '\n[rules](../../../AGENTS.md)\n\n```text\n[example](unchanged.md)\n```\n');
    handoff.checkpoint(first.ws, first.directory);
    const snap = handoff.snapshot(first.ws, first.directory);
    const text = fs.readFileSync(snap.file, 'utf8');
    assert.match(text, /\[rules\]\(\.\.\/\.\.\/\.\.\/\.\.\/AGENTS.md\)/);
    assert.match(text, /\[example\]\(unchanged.md\)/);
    assert.notEqual(snap.file, handoff.snapshot(first.ws, first.directory).file);
  } finally { Date.now = original; }
});

test('sparse deployment includes runtime dependencies and preserves local handoffs', t => {
  const base = fixture(t), origin = repository(path.join(base, 'origin')), project = path.join(base, 'project');
  fs.cpSync(path.join(repo, 'plugins/agent-context-kit'), path.join(origin, 'plugins/agent-context-kit'), { recursive: true });
  for (const file of ['scripts/lib/workspace-context.js', 'scripts/validation-evidence.js']) {
    write(path.join(origin, file), fs.readFileSync(path.join(repo, file)));
  }
  git(origin, ['add', '.']); git(origin, ['-c', 'core.hooksPath=', 'commit', '-qm', 'capability']);
  fs.mkdirSync(project);
  const installed = path.join(project, '.agents');
  git(base, ['clone', '--no-checkout', '--local', origin, installed]);
  const { refresh } = require('../refresh-agents-sparse.js');
  refresh(installed, ['/plugins/**', '/scripts/*.js', '/scripts/lib/**'], true);
  const result = spawnSync(process.execPath, [path.join(installed, 'plugins/agent-context-kit/scripts/task-handoff.js'), 'list', '--project-root', project], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).tasks, []);
  write(path.join(project, 'docs/handoff/preserved.txt'), 'local handoff');
  refresh(installed, ['/plugins/**', '/scripts/*.js', '/scripts/lib/**'], true);
  assert.equal(fs.readFileSync(path.join(project, 'docs/handoff/preserved.txt'), 'utf8'), 'local handoff');
  assert.equal(fs.existsSync(path.join(installed, 'scripts/tests')), false);
});

test('entry route is conditional, preserves existing projects and has no implicit creation hook', () => {
  const template = fs.readFileSync(path.join(repo, 'plugins/agent-context-kit/templates/AGENTS.template.md'), 'utf8');
  const maintenance = fs.readFileSync(path.join(repo, 'plugins/agent-context-kit/skills/project-context-maintenance/references/initialization.md'), 'utf8');
  const skill = fs.readFileSync(path.join(repo, 'plugins/agent-context-kit/skills/task-handoff/SKILL.md'), 'utf8');
  assert.match(template, /enabled.*task-handoff/);
  assert.match(maintenance, /available\/disabled 不加入/);
  assert.match(maintenance, /普通能力包更新不执行此合并/);
  assert.match(skill, /不自动启用/);
  for (const file of ['scripts/install-agents.ps1', 'scripts/update-agents.ps1']) assert.doesNotMatch(fs.readFileSync(path.join(repo, file), 'utf8'), /task-handoff\.js.*init/);
});

for (const shell of process.platform === 'win32' ? ['pwsh.exe', 'powershell.exe'] : []) {
  test(`thin-index exposes task-handoff and preserves existing handoff (${shell})`, t => {
    const root = repository(fixture(t)), { directory } = create(root);
    const file = path.join(directory, 'handoff.md'), before = fs.readFileSync(file, 'utf8');
    const generator = path.join(repo, 'scripts/generate-plugin-thin-index.ps1');
    const run = mode => {
      const r = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', generator, '-PluginPath', path.join(repo, 'plugins/agent-context-kit'), '-ProjectRoot', root, '-ContextRoot', path.join(root, '.agents'), '-CapabilityRoot', repo, '-Mode', mode], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
      assert.equal(r.status, 0, r.stderr);
    };
    run('DryRun'); assert.equal(fs.existsSync(path.join(root, '.agents')), false);
    run('Write'); run('Write');
    assert.match(fs.readFileSync(path.join(root, '.agents/skills/task-handoff/SKILL.md'), 'utf8'), /thin-index: true/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
}
