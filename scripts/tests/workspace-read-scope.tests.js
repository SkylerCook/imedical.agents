'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const contract = read('docs/workspace-overlay.md');
for (const phrase of ['只读调查无需另行授权', '停止模块外写入', '不新增 frontend SourceRoot', '不扫描父目录猜测根路径', '不改变当前项目的 contextMode']) {
  assert.ok(contract.includes(phrase), 'Overlay contract missing: ' + phrase);
}
const entrypoints = [
  'plugins/agent-context-kit/AGENTS.md',
  'plugins/agent-context-kit/README.md',
  'plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md',
  'plugins/coding-iris-plugin/AGENTS.md',
  'plugins/coding-iris-plugin/README.md'
];
for (const file of entrypoints) {
  const text = read(file);
  assert.ok(text.includes('docs/workspace-overlay.md'), file + ' must route to the common contract');
  assert.doesNotMatch(text, /只扫描声明的 .SourceRoot.|源码探索禁止扫描|事实只能从 manifest 声明的 SourceRoot|源码和 Git 操作不得越过 manifest 声明边界|SourceRoot 探索没有越界/, file + ' must not reintroduce blanket read restrictions');
}
assert.ok(read(entrypoints[2]).includes('项目成熟度和完整性仍按当前 SourceRoot 判断'));
assert.ok(read(entrypoints[4]).includes('工具源码写入限制在声明的 SourceRoot'));
console.log('PASS: Overlay read scope and write authorization contract');
