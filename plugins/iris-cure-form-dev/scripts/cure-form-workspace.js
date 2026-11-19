'use strict';
const fs = require('fs');
const path = require('path');

function readSettings(project,explicit) {
  const ctx=require('../../../scripts/lib/workspace-context').resolveWorkspaceContext(project);
  const file=explicit && path.resolve(project,explicit);
  const isBound=name=>file && path.relative(path.join(ctx.contextRoot,'config',name),file)==='';
  if (!explicit || isBound('cure_form_profile.md') || isBound('project.jsonc')) {
    if (!fs.existsSync(ctx.contextRoot)) return {};
    return require('../../../scripts/lib/project-plugin-settings').apply(ctx,'iris-cure-form-dev');
  }
  if (!fs.existsSync(file)) return {};
  const values={};
  for (const line of fs.readFileSync(file,'utf8').split(/\r?\n/)) {
    const match=/^\s*-\s*([^:]+):\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1].trim()]=match[2].trim();
  }
  return values;
}
function segment(value) {
  const name = String(value || 'default');
  if (!/^[\p{L}\p{N}_-]+$/u.test(name)) throw new Error('Task and form names must be safe single directory names.');
  return name;
}
function taskRoot(args = {}) {
  const project = path.resolve(args.projectRoot || process.cwd());
  if (args.workRoot) return path.resolve(project, args.workRoot);
  const task = segment(args.taskId || args.moduleId || args.mapCode);
  const legacy = path.join(project, 'docs', 'work', 'cure-form', task);
  const override = readSettings(project,args.targetProfile).WorkRoot;
  if (override && !/^(?:auto|<required>|<unset>|TODO)$/i.test(override)) return path.resolve(project,override,task);
  // Existing tasks keep their recovery location until an explicitly approved migration.
  if (fs.existsSync(legacy)) return legacy;
  const { resolveDirectory } = require('../../../scripts/lib/project-directories');
  return path.join(resolveDirectory(project, 'iris-cure-form-dev', 'form-work', 'docs/work/cure-form'), task);
}
function formRoot(args, mapCode) { return path.join(taskRoot({ ...args, mapCode: args.mapCode || mapCode }), segment(mapCode || args.mapCode || args.moduleId)); }
function privateRoot(args) {
  const root = path.join(taskRoot(args), 'private');
  fs.mkdirSync(root, { recursive: true });
  const ignore = path.join(root, '.gitignore');
  // Local protection belongs with the data, not in framework or project configuration.
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n', { flag: 'wx' });
  else if (!fs.readFileSync(ignore, 'utf8').split(/\r?\n/).includes('*')) throw new Error('private/.gitignore must ignore all private artifacts.');
  return root;
}
function registerPreview(args, mapCode, html) {
  const context = { ...args, mapCode: args.mapCode || mapCode };
  const root = taskRoot(context);
  const registry = path.join(privateRoot(context), 'preview-index.json');
  const entries = fs.existsSync(registry) ? JSON.parse(fs.readFileSync(registry, 'utf8')) : {};
  entries[segment(mapCode)] = path.resolve(html);
  fs.writeFileSync(registry, JSON.stringify(entries, null, 2) + '\n');
  const readme = path.join(root, 'README.md');
  const marker = '<!-- cure-form-preview-index -->';
  const endMarker = '<!-- /cure-form-preview-index -->';
  const links = Object.entries(entries).sort().map(([name, file]) => '- [' + name + ' preview](<' + file.replace(/\\/g, '/') + '>)');
  const section = `${marker}\n## 预览列表\n\n${links.join('\n')}\n\n使用 canonical preview-run 通过 127.0.0.1 验证；不以 file:// 代替浏览器门禁。\n${endMarker}`;
  const old = fs.existsSync(readme) ? fs.readFileSync(readme, 'utf8') : '# 表单任务\n';
  const start = old.indexOf(marker), end = old.indexOf(endMarker);
  if ((start < 0) !== (end < 0) || (start >= 0 && end < start)) throw new Error('Malformed managed preview index.');
  fs.writeFileSync(readme, start < 0 ? `${old.trimEnd()}\n\n${section}\n` : old.slice(0, start) + section + old.slice(end + endMarker.length));
  return readme;
}
module.exports = { readSettings, taskRoot, formRoot, privateRoot, registerPreview };
