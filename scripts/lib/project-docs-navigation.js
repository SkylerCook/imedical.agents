'use strict';
// Rendering only. Ownership and paths remain in projectDirectories and local extensions.
const fs = require('node:fs');
const path = require('node:path');
const d = require('./project-directories');
const { activeText } = require('../sync-documentation-entry');
const START = '<!-- project-docs:managed:start -->';
const END = '<!-- project-docs:managed:end -->';
const cell = value => String(value).replaceAll('&', '&amp;').replaceAll('|', '&#124;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('[', '\\[').replaceAll(']', '\\]').replaceAll('\n', ' ');
const link = value => encodeURI(value).replaceAll('#','%23').replaceAll('?','%3F').replaceAll('(', '%28').replaceAll(')', '%29');
const logical = (context, file) => d.slash(path.relative(context.workspaceRoot, file));

function catalog(context, extensions) {
  const entries = d.inventory(context).filter(e => e.base !== 'capability');
  for (const e of extensions) {
    d.description(e);
    if (entries.some(item => item.base === 'workspace' && item.path.toLowerCase() === e.path.toLowerCase())) throw Error('Extension overlaps owner declaration: ' + e.path);
    entries.push({...e, owner:'workspace', base:'workspace', role:'knowledge', create:'setup', target:d.safePath(context.workspaceRoot,e.path)});
  }
  if (!entries.some(e => e.owner === 'agent-context-kit' && e.id === 'guides')) throw Error('agent-context-kit directory declarations missing or not enabled');
  return entries.sort((a,b) => logical(context,a.target).localeCompare(logical(context,b.target),'en'));
}

function descriptions(context, entries) {
  const output = new Map(), legacy = new Map();
  // Legacy paths are described only when already present. No old task roots are created.
  for (const e of entries) for (const old of e.legacyPaths || []) {
    if (!old.startsWith('docs/')) continue;
    const file = d.safePath(context.workspaceRoot, old);
    if (fs.existsSync(file)) {
      if (!fs.statSync(file).isDirectory()) throw Error('Legacy directory conflict: ' + old);
      if (!legacy.has(old)) legacy.set(old, []);
      legacy.get(old).push(e);
    }
  }
  const roots = new Set(['docs', ...entries.filter(e => e.base === 'workspace' && (e.create === 'setup' || fs.existsSync(e.target))).map(e => e.owner === 'workspace' ? e.path : e.path.split('/').slice(0,2).join('/'))]);
  for (const old of legacy.keys()) roots.add(old.split('/').slice(0,2).join('/'));
  const work = logical(context,path.join(context.contextRoot,'work'));
  if (entries.some(e => e.base === 'context')) roots.add(work);
  const row = (e, from) => {
    const file = logical(context,e.target), relative = path.posix.relative(from,file) || '.';
    // Task roots need not exist until the task starts; don't emit a dead link for them.
    const available = e.create === 'setup' || fs.existsSync(e.target);
    const name = available ? `[${cell(file)}/](${link(relative)}/)` : '`'+cell(file)+'/`（按任务创建）';
    return `| ${name} | ${cell(e.purpose || 'Owner 尚未声明用途，需补齐说明')} | ${cell(e.examples?.join('；') || '由项目补充典型文件')} | ${cell(e.boundary || '按本目录用途保存；其它专题通过链接引用')} | ${cell(e.lifecycle || (e.owner === 'workspace' ? '项目扩展；现行性与保留期限以项目说明为准' : '遵循 owner 能力契约'))} |`;
  };
  const table = ['| 目录 | 放什么 | 典型产物 | 相邻目录边界 | 状态与生命周期 |','|---|---|---|---|---|'];
  for (const root of [...roots].sort()) {
    const isDocs = root === 'docs', isWork = root === work;
    const selected = entries.filter(e => isDocs || (isWork ? e.base === 'context' : e.base === 'workspace' && (e.path === root || e.path.startsWith(root+'/'))));
    const lines = ['## 当前目录说明','','本区由目录声明和本地扩展生成；区外人工正文与链接保留。说明检查不代表逐文件归类或业务验收。',''];
    if (!isDocs) lines.push('[项目知识库总导航]('+link(path.posix.relative(root,'docs/README.md'))+')','');
    if (selected.length) lines.push(...table,...selected.map(e=>row(e,root)),'');
    if (isDocs) {
      lines.push('### 用途入口','');
      for (const dir of [...roots].filter(r=>r!==root).sort()) lines.push('- ['+cell(dir)+'/README.md]('+link(path.posix.relative(root,dir+'/README.md'))+')');
      lines.push('','正式知识与交付保存在项目 docs；运行状态、私有草稿和断点保存在当前 ContextRoot/work。任务临时材料按当前工具约定保存，用完清理；本更新不执行清理。','');
    }
    const oldEntries = [...legacy].filter(([old]) => isDocs || old === root || old.startsWith(root+'/'));
    if (oldEntries.length) {
      lines.push('### 历史兼容目录','','旧任务沿原路径恢复；新任务使用下表当前默认，显式路径仍按 owner 契约优先。保留旧目录不代表其内容仍是现行规范。','','| 已存在旧目录 | 当前默认 | 保留原因 |','|---|---|---|');
      for (const [old, owners] of oldEntries) lines.push(`| [${cell(old)}/](${link(path.posix.relative(root,old))}/) | ${owners.map(e=>'`'+cell(logical(context,e.target))+'/`').join('；')} | 历史引用、任务状态或业务恢复资料；迁移和清理需单独核对 owner 契约与授权 |`);
      lines.push('');
    }
    output.set(root+'/README.md',lines.join('\n'));
  }
  return output;
}

function section(before, body, file, adopt=false) {
  const text = before === null ? '' : new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(before);
  const newline = text.match(/\r?\n/)?.[0] || '\n';
  const generated = [START,body.trimEnd(),END].join('\n').replaceAll('\n',newline);
  const starts = text.split(START).length-1, ends = text.split(END).length-1;
  if (starts !== ends || starts > 1 || (starts && text.indexOf(START) > text.indexOf(END))) throw Error('Malformed managed section; preserve and review: '+file);
  let output, previous = '';
  if (starts) {
    const from = text.indexOf(START), to = text.indexOf(END)+END.length;
    previous = text.slice(from,to);
    output = text.slice(0,from)+generated+text.slice(to);
  } else {
    // Old navigation remains intact. Appending an ownership boundary needs an exact plan.
    output = (before === null ? '# '+(file==='docs/README.md'?'项目知识库':'目录说明')+newline+newline : text+(text.endsWith('\n')?newline:newline+newline))+generated+newline;
  }
  if (!activeText(output.replace(START,'\nPROJECT_DOCS_VISIBLE_SECTION\n')).includes('PROJECT_DOCS_VISIBLE_SECTION')) throw Error('Managed navigation is hidden by Markdown; preserve and repair: '+file);
  return {state:before===null?'missing':!starts?'unmanaged':previous===generated?'current':'stale',before:previous,after:generated,content:Buffer.from(output),writable:before===null||!!starts||adopt};
}
module.exports = { catalog, descriptions, section, START, END };
