'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');
const { createKnowledgeSearch } = require('../src/knowledge-search');

function fixture(t) {
  const root = createTempDirectory('workbench-local-knowledge-');
  t.after(() => {
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const capability = path.join(root, '.agents');
  const relative = 'plugins/imedical-ui/references/forms.md';
  const source = path.join(capability, relative);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, '# 检索夹具\n\n## 表单标签\n\n标签对齐需要核对表单网格，使用 <label> 对应输入。\n', 'utf8');
  return { root, capability, relative };
}

test('bound workbench search reads installed documents without a vector index or provider', async t => {
  const { root, capability, relative } = fixture(t);
  const knowledge = createKnowledgeSearch(root);
  const result = await knowledge.query({ query: ' 标签对齐 ', domain: 'ui' });
  assert.equal(result.mode, 'lexical');
  assert.equal(result.sourcesAvailable, true);
  const match = result.matches.find(item => item.path === relative && item.text.includes('标签对齐'));
  assert.ok(match, JSON.stringify(result));
  assert.equal(match.heading, '检索夹具 > 表单标签');
  assert.match(match.text, /<label>/);
  assert.ok(match.line <= 5 && match.endLine >= 5);
  assert.deepEqual(Object.keys(match), ['path', 'line', 'endLine', 'heading', 'text']);
  assert.equal(fs.existsSync(path.join(capability, '.knowledge-cache')), false);

  const noSources = await knowledge.query({ query: '标签对齐', domain: 'business' });
  assert.equal(noSources.sourcesAvailable, false);
  assert.deepEqual(noSources.matches, []);
  const noMatches = await knowledge.query({ query: 'missinguniqueterm', domain: 'ui' });
  assert.equal(noMatches.sourcesAvailable, true);
  assert.deepEqual(noMatches.matches, []);
});

test('bound workbench search rejects extra path arguments and malformed workspace declarations', async t => {
  const { root, capability } = fixture(t);
  const knowledge = createKnowledgeSearch(root);
  for (const request of [null, [], { query: ' ' }, { query: 'x'.repeat(513) },
    { query: '标签', domain: 'unknown' }, { query: '标签', projectRoot: root }]) {
    await assert.rejects(knowledge.query(request), { name: 'KnowledgeSearchError' });
  }
  await assert.rejects(createKnowledgeSearch(null).query({ query: '标签' }), /先绑定/);
  fs.writeFileSync(path.join(capability, 'capability.json'), JSON.stringify({ mode: 'standard', capabilityRoot: root }));
  await assert.rejects(knowledge.query({ query: '标签' }), /工作区声明/);
});
