'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sync, render } = require('../sync-runtime-agents.js');
const base = path.join(os.tmpdir(), 'Codex'); fs.mkdirSync(base, { recursive: true });
const temp = fs.mkdtempSync(path.join(base, 'runtime-agents-'));
after(() => { assert.equal(path.dirname(temp), base); fs.rmSync(temp, { recursive: true }); assert(!fs.existsSync(temp)); });
function fixture(name) {
  const root = path.join(temp, name);
  fs.mkdirSync(path.join(root, '.agents', '.git'), { recursive: true });
  const dir = path.join(root, '.agents', 'agents', 'sample-agent'); fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, 'AGENT.md');
  fs.writeFileSync(source, '---\nname: sample-agent\ndescription: 中文 "quoted" role\nmodelHint: fast\n---\n# Role\nRead ../shared.md.\n');
  return { root, source, target: path.join(root, '.codex', 'agents', 'sample-agent.toml') };
}
test('read-only planning, generation, source refresh and idempotency', () => {
  const f = fixture('中文 space');
  assert(sync({ projectRoot: f.root, mode: 'Check' }).failed);
  sync({ projectRoot: f.root }); assert(!fs.existsSync(f.target));
  assert.equal(sync({ projectRoot: f.root, mode: 'Write' }).items[0].status, 'generated');
  assert.equal(sync({ projectRoot: f.root, mode: 'Check' }).items[0].status, 'unchanged');
  const content = fs.readFileSync(f.target, 'utf8');
  assert(!/^model\s*=/m.test(content)); assert(!/^sandbox_mode\s*=/m.test(content));
  const instructions = JSON.parse(content.split('\n').find(x => x.startsWith('developer_instructions = ')).slice(25));
  assert(instructions.includes('.agents/agents/sample-agent/AGENT.md'));
  assert(instructions.includes(fs.readFileSync(f.source, 'utf8')));
  fs.appendFileSync(f.source, 'New instruction.');
  assert.equal(sync({ projectRoot: f.root, mode: 'Write' }).items[0].status, 'generated');
});
test('custom and modified generated files preserved; stale managed files removed', () => {
  const f = fixture('conflict'); sync({ projectRoot: f.root, mode: 'Write' });
  fs.appendFileSync(f.target, '# custom');
  assert(sync({ projectRoot: f.root, mode: 'Write' }).failed);
  assert(fs.readFileSync(f.target, 'utf8').endsWith('# custom'));
  fs.writeFileSync(f.target, 'name = "custom"');
  assert(sync({ projectRoot: f.root, mode: 'Write' }).failed);
  fs.unlinkSync(f.target); sync({ projectRoot: f.root, mode: 'Write' });
  fs.renameSync(path.dirname(f.source), path.join(path.dirname(path.dirname(f.source)), '_retired'));
  assert.equal(sync({ projectRoot: f.root, mode: 'Write' }).items[0].status, 'removed');
  assert(!fs.existsSync(f.target));
});
test('invalid metadata rejected before any writes', () => {
  const f = fixture('invalid'); fs.writeFileSync(f.source, '# no metadata');
  assert.throws(() => sync({ projectRoot: f.root, mode: 'Write' }), /frontmatter/);
  assert(!fs.existsSync(f.target));
  assert.throws(() => render('sample-agent', '---\nname: other\ndescription: hi\n---\n', 'x'), /match directory/);
});
test('unified CLI defaults to skills and requires explicit --agent for native files', () => {
  const f = fixture('cli'); fs.mkdirSync(path.join(f.root, '.agents', 'skills'));
  const cli = path.resolve(__dirname, '../sync-runtime-skills.js');
  const run = extra => require('node:child_process').spawnSync(process.execPath, [cli, '--project-root', f.root, '--runtime', 'Codex', '--mode', 'Write', ...extra], { encoding: 'utf8', windowsHide: true });
  assert.equal(run([]).status, 0); assert(!fs.existsSync(f.target));
  assert.notEqual(run(['--agent', '--skills-dir', '.test/skills']).status, 0); assert(!fs.existsSync(f.target));
  assert.notEqual(run(['--agent', '--agent']).status, 0);
  assert.equal(run(['--agent']).status, 0); assert(fs.existsSync(f.target));
  assert.equal(run(['--agent', '--help']).status, 0);
});
test('Overlay uses shared canonical source and writes only module native files', () => {
  const f = fixture('overlay');
  const capability = path.join(f.root, '.agents');
  const moduleRoot = path.join(temp, 'module');
  fs.mkdirSync(path.join(moduleRoot, '.agents'), { recursive: true });
  fs.mkdirSync(path.join(moduleRoot, 'source', '.git'), { recursive: true });
  require('node:child_process').execFileSync('git', ['init', '-q', path.join(moduleRoot, 'source')], { stdio: 'ignore', windowsHide: true });
  fs.writeFileSync(path.join(moduleRoot, '.agents', 'capability.json'), JSON.stringify({
    schemaVersion: 1, mode: 'workspace-overlay', workspace: 'module', contextRoot: '.agents',
    capabilityRoot: capability, sharedDirectories: [], localDirectories: [],
    sourceRoots: [{ name: 'source', path: 'source', target: 'source', gitRoot: 'source' }]
  }));
  const before = fs.readFileSync(f.source, 'utf8');
  const result = sync({ projectRoot: moduleRoot, mode: 'Write' });
  assert(!result.failed);
  assert(fs.existsSync(path.join(moduleRoot, '.codex/agents/sample-agent.toml')));
  assert(!fs.existsSync(path.join(f.root, '.codex')));
  assert.equal(fs.readFileSync(f.source, 'utf8'), before);
});
test('linked native parent is rejected and external files remain unchanged', () => {
  const f = fixture('linked'), outside = path.join(temp, 'outside'); fs.mkdirSync(outside);
  const link = path.join(f.root, '.codex');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.throws(() => sync({ projectRoot: f.root, mode: 'Write' }), /physical directory/); assert.deepEqual(fs.readdirSync(outside), []); }
  finally { fs.unlinkSync(link); }
});

test('WorkBuddy and CodeBuddy share thin entries, preserve edits and clean stale entries', () => {
  const f = fixture('buddy');
  const target = path.join(f.root, '.codebuddy/agents/sample-agent.md');
  sync({ projectRoot: f.root, runtime: 'WorkBuddy' }); assert(!fs.existsSync(target));
  assert.equal(sync({ projectRoot: f.root, runtime: 'WorkBuddy', mode: 'Write' }).items[0].status, 'generated');
  assert.equal(sync({ projectRoot: f.root, runtime: 'CodeBuddy', mode: 'Write' }).items[0].status, 'unchanged');
  const text = fs.readFileSync(target, 'utf8');
  assert(text.startsWith('---')); assert(text.includes('enabledAutoRun: false'));
  assert(text.includes('.agents/agents/sample-agent/AGENT.md')); assert(!text.includes('Read ../shared.md.'));
  fs.appendFileSync(target, 'custom');
  assert(sync({ projectRoot: f.root, runtime: 'WorkBuddy', mode: 'Write' }).failed);
  fs.writeFileSync(target, text);
  fs.renameSync(path.dirname(f.source), path.join(path.dirname(path.dirname(f.source)), '_retired'));
  assert.equal(sync({ projectRoot: f.root, runtime: 'CodeBuddy', mode: 'Write' }).items[0].status, 'removed');
  assert(!fs.existsSync(target));
});
