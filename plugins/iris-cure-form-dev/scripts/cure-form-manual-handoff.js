'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function buildHandoff(packageValue) {
  const changes = packageValue.changes;
  if (!changes || !Array.isArray(changes.templates)) throw new Error('Missing template changes.');
  const strategy = packageValue.expectedVersion === 'NEW' ? 'create' : (changes.strategy || 'versioned-clone');
  const mapCode = String(packageValue.mapCode || changes.mapCode || '');
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(mapCode)) throw new Error('Unsafe Map code.');
  const files = [];
  const lines = ['# 手动部署', '', `Map: ${mapCode}`, `发布策略: ${strategy}`, '',
    '复制下列 HTML 的全部内容到模板 content；不要复制 preview.html。', '',
    '| 文件 | 目标 RowID | 动作 |', '|---|---|---|'];
  for (const template of changes.templates.filter((item) => !item.referenceOnly)) {
    const sourceId = String(template.rowId || template.sourceTemplateRowId || '');
    const id = sourceId || String(files.length + 1);
    if (strategy === 'in-place-overwrite' && !sourceId) throw new Error('Overwrite requires an explicit RowID.');
    if (!/^\d+$/.test(id)) throw new Error('Manual handoff requires a numeric template source/target RowID.');
    if (typeof template.content !== 'string' || /<(?:html|head|body)\b|__cureFormPreview|previewOnly/i.test(template.content)) throw new Error('Expected pure template content, not a preview page.');
    const file = `${id}-${mapCode}-content.html`;
    if (files.some((item) => item.path === file)) throw new Error('Duplicate template target.');
    files.push({ path: file, content: template.content, sha256: hash(template.content) });
    lines.push(`| ${file} | ${strategy === 'in-place-overwrite' ? id : strategy === 'create' ? '新正式 RowID' : '新模板 RowID'} | ${strategy === 'in-place-overwrite' ? '仅覆盖 content' : strategy === 'create' ? '按批准规格创建正式模板' : sourceId ? `从正式 ${sourceId} 创建灰度；APP_LastID 指向 ${sourceId}` : '来源 RowID 未提供，人工核实批准规格后创建；文件名前缀仅为序号'} |`);
  }
  if (!files.length) throw new Error('No materialized template content.');
  lines.push('', '## JS 配置与静态资源', '', '静态源码不重复复制；使用工作区现有文件，保持部署路径。', '');
  if (changes.map && changes.map.showJS != null) lines.push('Map showJS：', '', '```text', String(changes.map.showJS), '```', '');
  for (const resource of changes.resources || []) {
    if (['javascript', 'stylesheet'].includes(resource.kind)) lines.push(`- ${resource.kind}: ${resource.path}${resource.contentHash ? `；SHA-256: ${resource.contentHash}` : ''}`);
    if (['javascript', 'stylesheet'].includes(resource.kind) && resource.sourcePath) lines.push(`  工作区文件：[${path.basename(resource.sourcePath)}](<${resource.sourcePath.replace(/\\/g, '/')}>)`);
  }
  lines.push('', '## 验证与恢复', '', '先备份服务器当前模板和 Map 配置。仅修改本清单指定字段；回读并核对 content 哈希、JS 引用及模板组成。',
    '若自动写入结果未知，先核实操作状态，不要重复部署。失败时使用已保存基线按原 RowID 恢复。', '');
  return { files, readme: lines.join('\n'), manifest: { schema: 'cure-form-manual-handoff/v1', mapCode, strategy,
    packageHash: hash(JSON.stringify(packageValue)), expectedVersion: packageValue.expectedVersion,
    files: files.map(({ path: file, sha256 }) => ({ path: file, sha256 })) } };
}

function writeHandoff(packageValue, outputRoot) {
  const handoff = buildHandoff(packageValue);
  const target = path.resolve(outputRoot);
  // Never overwrite an earlier handoff: retain a package-specific immutable folder.
  const directory = path.join(target, handoff.manifest.packageHash.slice(0, 16));
  fs.mkdirSync(directory, { recursive: true });
  const outputs = [...handoff.files, { path: 'README.md', content: handoff.readme },
    { path: '.handoff.json', content: JSON.stringify(handoff.manifest, null, 2) + '\n' }];
  for (const item of outputs) {
    const file = path.join(directory, item.path);
    if (fs.existsSync(file)) {
      if (fs.readFileSync(file, 'utf8') !== item.content) throw new Error(`Existing handoff differs: ${file}`);
    } else fs.writeFileSync(file, item.content, { encoding: 'utf8', flag: 'wx' });
  }
  return { mode: 'manual', serverWrite: false, directory, readme: path.join(directory, 'README.md'), files: handoff.manifest.files };
}
module.exports = { buildHandoff, writeHandoff };
