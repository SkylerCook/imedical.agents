'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createManualSearch } = require('../src/manual-search');

function handbook(file, title, body) {
  return { file, source: `docs/guides/${file}`, title, body };
}

test('manual search matches local titles, body, identifiers and code source lines', () => {
  const guides = [
    handbook('deployment.md', '部署操作', [
      '# 部署操作', '', '## 配置来源', '', '先检查就绪隔离字段。', '',
      '```powershell', '# 这只是注释', 'Write-Output IRIS_SESSION_BACKEND', '```',
    ].join('\r\n')),
    handbook('runtime.md', '运行手册', '# 运行手册\n\n## 故障恢复\n\n通过就绪隔离字段核对生效范围。\n'),
  ];
  const search = createManualSearch(new Map(guides.map(guide => [guide.file, guide])));
  const body = search('  就绪隔离字段  ');
  assert.equal(body.truncated, false);
  assert.deepEqual(body.matches.map(({ file, section, line }) => [file, section, line]).sort(), [
    ['deployment.md', '配置来源', 5], ['runtime.md', '故障恢复', 5],
  ]);
  assert.ok(body.matches.every(result => result.excerpt.includes('就绪隔离字段')));
  const identifier = search('iris_session_backend').matches[0];
  assert.equal(identifier.file, 'deployment.md');
  assert.equal(identifier.line, 9);
  assert.equal(identifier.section, '配置来源');
  assert.match(identifier.excerpt, /IRIS_SESSION_BACKEND/);
  assert.equal(search('DEPLOYMENT.MD').matches[0].file, 'deployment.md');
  assert.equal(search('运行手册').matches[0].file, 'runtime.md');
  assert.deepEqual(search('../../project-private.env'), { matches: [], truncated: false });
  assert.deepEqual(search('  '), { matches: [], truncated: false });
  assert.throws(() => search('字'.repeat(121)), RangeError);
});

test('manual search bounds results and keeps the same order on repeated queries', () => {
  const manuals = new Map(Array.from({ length: 40 }, (_, offset) => {
    const file = `guide-${offset}.md`;
    const body = offset === 0 ? '可识别查询项\n'.repeat(30) : '可识别查询项\n';
    return [file, handbook(file, `手册 ${offset}`, `# 手册 ${offset}\n\n## 配置\n\n${body}`)];
  }));
  const search = createManualSearch(manuals);
  const result = search('可识别查询项');
  assert.equal(result.truncated, true);
  assert.ok(result.matches.length > 0 && result.matches.length <= 24);
  assert.equal(new Set(result.matches.map(match => match.file)).size, result.matches.length);
  assert.deepEqual(search('可识别查询项'), result);
});
