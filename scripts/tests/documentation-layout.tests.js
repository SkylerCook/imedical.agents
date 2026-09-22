'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { refresh } = require('../refresh-agents-sparse');
const repo = path.resolve(__dirname, '../..');
const layout = JSON.parse(fs.readFileSync(path.join(repo, 'maintenance/governance/documentation-layout.json'), 'utf8'));
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
function read(file) { return fs.readFileSync(path.join(repo, file), 'utf8'); }
function patterns(file, name) {
  const block = read(file).match(new RegExp('\\$' + name + ' = @\\(([\\s\\S]*?)\\)'));
  assert.ok(block, file);
  return [...block[1].matchAll(/"([^"\r\n]+)"/g)].map(m => m[1]);
}
const install = patterns('scripts/install-agents.ps1', 'sparsePaths');
const update = patterns('scripts/update-agents.ps1', 'runtimeSparsePaths');
function covered(file, list) { return list.some(p => new RegExp('^' + p.slice(1).split('**').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')).join('.*') + '$').test(file)); }
function anchors(text) {
  const counts = new Map();
  return new Set(text.split(/\r?\n/).filter(l => /^#{1,6} /.test(l)).map(l => {
    const base = l.replace(/^#+ /, '').toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const n = counts.get(base) || 0; counts.set(base, n + 1); return base + (n ? '-' + n : '');
  }));
}
test('exact destinations, absent old files and stable runtime entries', () => {
  assert.deepEqual(install, update);
  assert.equal(layout.moves.length, new Set(layout.moves.map(m => m.to)).size);
  for (const m of layout.moves) {
    assert.ok(!fs.existsSync(path.join(repo, m.from)), m.from);
    assert.ok(fs.existsSync(path.join(repo, m.to)), m.to);
    assert.equal(covered(m.to, install), m.to.startsWith('docs/'), m.to);
  }
  for (const f of layout.deleted) assert.ok(!fs.existsSync(path.join(repo, f)), f);
  for (const f of layout.stableDocs) assert.ok(fs.existsSync(path.join(repo, f)) && covered(f, install), f);
  for (const f of walk(path.join(repo, 'maintenance'))) assert.ok(!covered(path.relative(repo, f).replaceAll('\\', '/'), install), f);
});
test('project links resolve within deployment and skill/rule inventory remains complete', () => {
  const failures = [];
  // Only distributable tracked/new files; ignored local handoffs are user data.
  const docs = execFileSync('git', ['-C', repo, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'docs'], { encoding: 'utf8' }).split('\0').filter(f => f.endsWith('.md') && fs.existsSync(path.join(repo, f)));
  for (const logicalDoc of docs) {
    const f = path.join(repo, logicalDoc);
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(m[1])) continue;
      const [rel, anchor] = m[1].split('#');
      const target = rel ? path.resolve(path.dirname(f), rel) : f;
      const logical = path.relative(repo, target).replaceAll('\\', '/');
      if (!fs.existsSync(target)) { failures.push(path.relative(repo, f) + ': missing ' + m[1]); continue; }
      if (!covered(logical, install) && !covered(logical + '/', install)) failures.push('Not deployed: ' + logical);
      if (anchor && fs.statSync(target).isFile() && !anchors(fs.readFileSync(target, 'utf8')).has(anchor)) failures.push('Missing anchor: ' + m[1]);
    }
  }
  assert.deepEqual(failures, []);
  const catalog = read('docs/guides/capability-catalog.md'), guide = read('docs/guides/capability-guide.md');
  for (const p of fs.readdirSync(path.join(repo, 'plugins')).filter(p => !p.startsWith('imedicalxc-'))) {
    for (const f of walk(path.join(repo, 'plugins', p)).filter(f => /[\\/]skills[\\/][^\\/]+[\\/]SKILL\.md$/.test(f) || /[\\/]rules[\\/][^\\/]+\.md$/.test(f))) {
      const logical = path.relative(repo, f).replaceAll('\\', '/');
      assert.ok(catalog.includes('](../../' + logical + ')'), logical);
      if (f.endsWith('SKILL.md')) assert.ok(guide.includes('](../../' + logical + ')'), logical);
    }
  }
});
function fixture(run) {
  const parent = path.join(os.tmpdir(), 'codex'); fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'documentation-layout-'));
  const source = path.join(root, 'source'), checkout = path.join(root, 'checkout');
  const git = (at, ...args) => execFileSync('git', ['-C', at, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const put = (at, file, text) => { fs.mkdirSync(path.dirname(path.join(at, file)), { recursive: true }); fs.writeFileSync(path.join(at, file), text); };
  try {
    fs.mkdirSync(source); git(source, 'init', '-q'); git(source, 'config', 'user.name', 'Test'); git(source, 'config', 'user.email', 'test@example.invalid'); git(source, 'config', 'core.autocrlf', 'false');
    for (const f of [...layout.moves.map(m => m.from), ...layout.deleted, ...layout.stableDocs]) put(source, f, 'previous managed file\n');
    put(source, 'scripts/refresh-agents-sparse.js', read('scripts/refresh-agents-sparse.js'));
    git(source, 'add', '.'); git(source, 'commit', '-qm', 'old layout');
    git(root, 'clone', '-q', '--no-local', source, checkout); refresh(checkout, install);
    const publish = () => {
      for (const f of [...layout.moves.map(m => m.from), ...layout.deleted]) fs.unlinkSync(path.join(source, f));
      for (const m of layout.moves) put(source, m.to, 'new managed file\n');
      for (const f of ['docs/README.md', 'maintenance/README.md']) put(source, f, 'new navigation\n');
      git(source, 'add', '-A'); git(source, 'commit', '-qm', 'new layout');
    };
    run({ root, source, checkout, git, put, publish });
  } finally {
    const resolved = fs.realpathSync(root);
    assert.equal(resolved.toLowerCase(), path.resolve(root).toLowerCase());
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(parent).toLowerCase());
    fs.rmSync(root, { recursive: true, force: true });
    assert.ok(!fs.existsSync(root));
  }
}
test('existing project removes old files and empty directories and excludes maintenance', () => fixture(({ checkout, git, publish }) => {
  publish(); git(checkout, 'pull', '--ff-only'); refresh(checkout, update);
  for (const f of [...layout.moves.map(m => m.from), ...layout.deleted]) assert.ok(!fs.existsSync(path.join(checkout, f)), f);
  for (const m of layout.moves) assert.equal(fs.existsSync(path.join(checkout, m.to)), m.to.startsWith('docs/'), m.to);
  for (const d of ['docs/validation', 'docs/deploy', 'docs/project-export-map']) assert.ok(!fs.existsSync(path.join(checkout, d)), d);
  assert.ok(!fs.existsSync(path.join(checkout, 'maintenance')));
  const head = git(checkout, 'rev-parse', 'HEAD'); refresh(checkout, update);
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), head); assert.equal(git(checkout, 'status', '--porcelain'), '');
}));
test('new install uses current paths only', () => fixture(({ root, source, git, publish }) => {
  publish(); const fresh = path.join(root, 'fresh'); git(root, 'clone', '-q', '--no-checkout', source, fresh); refresh(fresh, install, true);
  assert.ok(fs.existsSync(path.join(fresh, 'docs/README.md')));
  assert.ok(!fs.existsSync(path.join(fresh, 'maintenance')));
  for (const m of layout.moves) assert.equal(fs.existsSync(path.join(fresh, m.to)), m.to.startsWith('docs/'), m.to);
  for (const f of [...layout.moves.map(m => m.from), ...layout.deleted]) assert.ok(!fs.existsSync(path.join(fresh, f)), f);
}));
test('ignored custom remnants survive old-folder cleanup', () => fixture(({ checkout, git, put, publish }) => {
  put(checkout, '.git/info/exclude', '/docs/validation/custom.md\n'); put(checkout, 'docs/validation/custom.md', 'user-owned\n');
  publish(); git(checkout, 'pull', '--ff-only'); refresh(checkout, update);
  assert.equal(fs.readFileSync(path.join(checkout, 'docs/validation/custom.md'), 'utf8'), 'user-owned\n');
  assert.ok(!fs.existsSync(path.join(checkout, 'docs/validation/i18n-agent-p1')));
}));
test('dirty managed files and nonignored custom files stop sparse mutation', () => fixture(({ checkout, git, put }) => {
  const old = layout.moves[0].from; put(checkout, old, 'local edit\n');
  const before = fs.readFileSync(path.join(checkout, '.git/info/sparse-checkout'), 'utf8');
  assert.throws(() => refresh(checkout, update), /dirty/);
  assert.equal(fs.readFileSync(path.join(checkout, old), 'utf8'), 'local edit\n');
  git(checkout, 'restore', old); put(checkout, 'docs/custom.md', 'custom');
  assert.throws(() => refresh(checkout, update), /dirty/);
  assert.equal(fs.readFileSync(path.join(checkout, '.git/info/sparse-checkout'), 'utf8'), before);
}));
