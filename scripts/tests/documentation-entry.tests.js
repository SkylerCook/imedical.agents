'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sync, route, overlayRoute } = require('../sync-documentation-entry');
const cli = path.resolve(__dirname, '../sync-documentation-entry.js');
function fixture(t, content = '# Project\n') {
  const parent = process.env.AGENTS_TEST_TEMP || os.tmpdir();
  const root = fs.mkdtempSync(path.join(parent, 'documentation-entry-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); assert.ok(!fs.existsSync(root)); });
  fs.mkdirSync(path.join(root, '.agents/docs'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/docs/README.md'), '# Docs\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), content);
  return root;
}
test('deployed project: DryRun and Check do not write; Write preserves bytes and is idempotent', t => {
  const original = '\ufeff# Project\r\n\r\n用户自己的规则\r\n';
  const root = fixture(t, original), file = path.join(root, 'AGENTS.md');
  assert.equal(sync(root).status, 'docs-entry-missing');
  assert.equal(spawnSync(process.execPath, [cli, '--project-root', root, '--mode', 'Check']).status, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(sync(root, 'Write').status, 'docs-entry-added');
  const updated = fs.readFileSync(file, 'utf8'), stamp = fs.statSync(file).mtimeMs;
  assert.equal(updated, original + '\r\n' + route + '\r\n');
  assert.equal(sync(root, 'Write').status, 'docs-entry-ok');
  assert.equal(fs.statSync(file).mtimeMs, stamp);
  assert.equal(spawnSync(process.execPath, [cli, '--project-root', root, '--mode', 'Check']).status, 0);
  assert.deepEqual(fs.readdirSync(root).sort(), ['.agents', 'AGENTS.md']);
});
test('existing live route remains untouched; comments and fenced examples do not count', t => {
  const root = fixture(t, '# Project\n<!-- .agents/docs/README.md -->\n````md\n```\n.agents/docs/README.md\n````\n');
  assert.equal(sync(root, 'Write').status, 'docs-entry-added');
  const file = path.join(root, 'AGENTS.md');
  fs.writeFileSync(file, '自定义导航：[指南](./.agents/docs/README.md#入口)\n');
  const before = fs.readFileSync(file);
  assert.equal(sync(root, 'Write').status, 'docs-entry-ok');
  assert.deepEqual(fs.readFileSync(file), before);
});
test('missing entry is not fabricated; missing docs and invalid encoding stop before write', t => {
  const root = fixture(t), file = path.join(root, 'AGENTS.md');
  fs.unlinkSync(file);
  assert.equal(sync(root, 'Write').status, 'docs-entry-no-agents');
  assert.ok(!fs.existsSync(file));
  fs.writeFileSync(file, Buffer.from([0xff, 0xfe, 0x41, 0]));
  assert.throws(() => sync(root, 'Write'));
  fs.writeFileSync(file, '# Preserved');
  fs.unlinkSync(path.join(root, '.agents/docs/README.md'));
  assert.throws(() => sync(root, 'Write'), /missing/);
  assert.equal(fs.readFileSync(file, 'utf8'), '# Preserved');
});
test('unclosed Markdown and hard links are preserved', t => {
  const root = fixture(t), file = path.join(root, 'AGENTS.md');
  for (const text of ['# Project\n<!-- unfinished', '# Project\n```md\n']) {
    fs.writeFileSync(file, text);
    assert.throws(() => sync(root, 'Write'), /Unclosed/);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  }
  fs.writeFileSync(file, '# Project');
  fs.linkSync(file, path.join(root, 'linked.md'));
  assert.throws(() => sync(root, 'Write'), /Linked/);
});
test('Overlay without docs junction uses resolved capability, never writes shared source', t => {
  const root = fixture(t), shared = path.join(root, 'shared');
  fs.renameSync(path.join(root, '.agents/docs'), shared);
  fs.mkdirSync(path.join(shared, 'docs'));
  fs.renameSync(path.join(shared, 'README.md'), path.join(shared, 'docs/README.md'));
  fs.writeFileSync(path.join(root, '.agents/capability.json'), JSON.stringify({ schemaVersion: 1, mode: 'workspace-overlay', contextRoot: '.agents', capabilityRoot: 'shared' }));
  const before = fs.readFileSync(path.join(shared, 'docs/README.md'));
  assert.equal(sync(root, 'Write').status, 'docs-entry-added');
  assert.ok(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').includes(overlayRoute));
  assert.equal(sync(root, 'Write').status, 'docs-entry-ok');
  assert.deepEqual(fs.readFileSync(path.join(shared, 'docs/README.md')), before);
});
test('initialization templates carry the same documentation route', () => {
  for (const file of ['AGENTS.template.md', 'AGENTS.context-snippet.md']) {
    assert.ok(fs.readFileSync(path.resolve(__dirname, '../../plugins/agent-context-kit/templates', file), 'utf8').includes(route));
  }
});
