#!/usr/bin/env node
// cg-query.js - 查询 codegraph 生成的代码图谱（.codegraph/codegraph.db）
// 仅依赖 Node 内置 node:sqlite（Node 22.5+），只读访问，无外部依赖。
// 用法见: node cg-query.js help
'use strict';

const path = require('path');
const fs = require('fs');

let DatabaseSync;
try {
  ({DatabaseSync} = require('node:sqlite'));
} catch (e) {
  console.error('[codegraph] 当前 Node 不支持 node:sqlite（需 Node 22.5+）。');
  console.error('错误:', e.message);
  process.exit(1);
}

const DB_DEFAULT = path.resolve(process.cwd(), '.codegraph/codegraph.db');

function openDb(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.error(`[codegraph] 数据库不存在: ${dbPath}`);
    console.error('请先在项目根目录运行 codegraph 生成 .codegraph/codegraph.db');
    console.error('（WSL 内 codegraph 缺 linux 平台包，需在 Windows 侧运行 codegraph，或修复安装：');
    console.error('  npm i -g @colbymchenry/codegraph --registry=https://registry.npmjs.org）');
    process.exit(1);
  }
  return new DatabaseSync(dbPath, {readOnly: true});
}

function fmtNode(r) {
  const loc = `${r.file_path}:${r.start_line}`;
  const sig = r.signature ? `  ${r.signature}` : '';
  return `${r.kind}\t${r.name}\t${loc}${sig}`;
}

const HELP = `用法: node cg-query.js <命令> [参数]

命令:
  stats              图谱统计（文件/节点/边数、kind 与 language 分布、索引状态）
  search <关键词>    按名称或路径模糊搜索节点（LIMIT 30）
  file <路径>        列出某文件中的函数/方法/类/路由节点（按行号排序）
  show <名称|id>     显示节点详情（含 docstring、signature、位置、是否导出）
  callers <名称>     谁调用了名为 <名称> 的节点（上游影响面，calls+references）
  callees <名称>     名为 <名称> 的节点调用了谁（下游依赖，calls+instantiates）
  impact <文件路径>  该文件变更的 1-hop 上游受影响节点（变更影响分析）
  routes [关键词]    列出 API 路由（kind='route'），可按关键词过滤

环境变量:
  CG_DB  指定数据库路径（默认 .codegraph/codegraph.db，相对当前工作目录）

说明:
  图谱由 codegraph CLI (@colbymchenry/codegraph) 生成，仅覆盖前端 JavaScript。
  后端 ObjectScript 不在图谱内，后端任务请用 IRIS MCP 工具（iris_search/iris_symbols）。`;

const cmd = process.argv[2];
const arg = process.argv[3];

if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
  console.log(HELP);
  process.exit(0);
}

const dbPath = process.env.CG_DB ? path.resolve(process.env.CG_DB) : DB_DEFAULT;
const db = openDb(dbPath);

try {
  switch (cmd) {
    case 'stats': {
      const files = db.prepare('SELECT count(*) c FROM files').get().c;
      const nodes = db.prepare('SELECT count(*) c FROM nodes').get().c;
      const edges = db.prepare('SELECT count(*) c FROM edges').get().c;
      const meta = {};
      db.prepare('SELECT key,value FROM project_metadata').all().forEach(r => { meta[r.key] = r.value; });
      console.log(`文件: ${files}  节点: ${nodes}  边: ${edges}`);
      console.log(`索引状态: ${meta.index_state}  版本: ${meta.indexed_with_version}  抽取版本: ${meta.indexed_with_extraction_version}`);
      console.log('\n节点类型分布:');
      db.prepare('SELECT kind,count(*) c FROM nodes GROUP BY kind ORDER BY c DESC').all().forEach(r => console.log(`  ${r.kind}: ${r.c}`));
      console.log('\n边类型分布:');
      db.prepare('SELECT kind,count(*) c FROM edges GROUP BY kind ORDER BY c DESC').all().forEach(r => console.log(`  ${r.kind}: ${r.c}`));
      console.log('\n文件语言分布:');
      db.prepare('SELECT language,count(*) c FROM files GROUP BY language ORDER BY c DESC').all().forEach(r => console.log(`  ${r.language}: ${r.c}`));
      break;
    }

    case 'search': {
      if (!arg) { console.error('用法: search <关键词>'); process.exit(2); }
      const rows = db.prepare(
        `SELECT kind,name,file_path,start_line,signature FROM nodes
         WHERE name LIKE '%'||?||'%' OR file_path LIKE '%'||?||'%'
         ORDER BY kind LIMIT 30`
      ).all(arg, arg);
      if (!rows.length) { console.log('未匹配到节点'); break; }
      rows.forEach(r => console.log(fmtNode(r)));
      break;
    }

    case 'file': {
      if (!arg) { console.error('用法: file <路径>'); process.exit(2); }
      const rows = db.prepare(
        `SELECT kind,name,start_line,end_line,signature,is_exported FROM nodes
         WHERE file_path=? AND kind IN ('function','method','class','route')
         ORDER BY start_line`
      ).all(arg);
      if (!rows.length) { console.log('该文件无函数/方法/类/路由节点，或文件不在图谱内'); break; }
      rows.forEach(r => {
        const exp = r.is_exported ? ' [exported]' : '';
        console.log(`${r.start_line}-${r.end_line}\t${r.kind}\t${r.name}${exp}\t${r.signature || ''}`);
      });
      break;
    }

    case 'show': {
      if (!arg) { console.error('用法: show <名称|id>'); process.exit(2); }
      let row = db.prepare(`SELECT * FROM nodes WHERE id=?`).get(arg);
      if (!row) row = db.prepare(`SELECT * FROM nodes WHERE name=? LIMIT 1`).get(arg);
      if (!row) { console.log('未找到节点'); break; }
      console.log(`id:          ${row.id}`);
      console.log(`kind:        ${row.kind}`);
      console.log(`name:        ${row.name}`);
      console.log(`qualified:   ${row.qualified_name}`);
      console.log(`location:    ${row.file_path}:${row.start_line}-${row.end_line}`);
      console.log(`language:    ${row.language}`);
      if (row.signature) console.log(`signature:   ${row.signature}`);
      if (row.visibility) console.log(`visibility:  ${row.visibility}`);
      console.log(`exported:    ${row.is_exported}  async: ${row.is_async}  static: ${row.is_static}`);
      if (row.docstring) console.log(`docstring:\n${row.docstring.replace(/\r/g, '')}`);
      break;
    }

    case 'callers': {
      if (!arg) { console.error('用法: callers <名称>'); process.exit(2); }
      const rows = db.prepare(
        `SELECT DISTINCT up.kind,up.name,up.file_path,up.start_line,up.signature,e.kind AS edge,me.name AS via
         FROM edges e
         JOIN nodes me ON me.id=e.target
         JOIN nodes up ON up.id=e.source
         WHERE me.name=? AND e.kind IN ('calls','references')
         ORDER BY up.file_path,up.start_line LIMIT 50`
      ).all(arg);
      if (!rows.length) { console.log(`没有节点调用名为 "${arg}" 的节点（或该名称不在图谱内）`); break; }
      rows.forEach(r => console.log(`${r.edge}\t${r.kind}\t${r.name}\t${r.file_path}:${r.start_line}\t(via ${r.via})`));
      break;
    }

    case 'callees': {
      if (!arg) { console.error('用法: callees <名称>'); process.exit(2); }
      const rows = db.prepare(
        `SELECT DISTINCT dn.kind,dn.name,dn.file_path,dn.start_line,dn.signature,e.kind AS edge
         FROM edges e
         JOIN nodes me ON me.id=e.source
         JOIN nodes dn ON dn.id=e.target
         WHERE me.name=? AND e.kind IN ('calls','instantiates')
         ORDER BY dn.file_path,dn.start_line LIMIT 50`
      ).all(arg);
      if (!rows.length) { console.log(`名为 "${arg}" 的节点没有下游调用/实例化`); break; }
      rows.forEach(r => console.log(`${r.edge}\t${r.kind}\t${r.name}\t${r.file_path}:${r.start_line}`));
      break;
    }

    case 'impact': {
      if (!arg) { console.error('用法: impact <文件路径>'); process.exit(2); }
      const rows = db.prepare(
        `SELECT DISTINCT up.kind,up.name,up.file_path,up.start_line,e.kind AS edge
         FROM nodes me
         JOIN edges e ON e.target=me.id
         JOIN nodes up ON up.id=e.source
         WHERE me.file_path=? AND e.kind IN ('calls','references','imports')
         ORDER BY up.file_path,up.start_line LIMIT 80`
      ).all(arg);
      if (!rows.length) { console.log('该文件无上游依赖（或文件不在图谱内）'); break; }
      console.log(`变更 ${arg} 会影响以下 ${rows.length} 个上游节点:`);
      rows.forEach(r => console.log(`${r.edge}\t${r.kind}\t${r.name}\t${r.file_path}:${r.start_line}`));
      break;
    }

    case 'routes': {
      let rows;
      if (arg) {
        rows = db.prepare(`SELECT name,file_path,start_line FROM nodes WHERE kind='route' AND name LIKE '%'||?||'%' ORDER BY file_path`).all(arg);
      } else {
        rows = db.prepare(`SELECT name,file_path,start_line FROM nodes WHERE kind='route' ORDER BY file_path`).all();
      }
      if (!rows.length) { console.log('无匹配路由'); break; }
      rows.forEach(r => console.log(`${r.name}\t->\t${r.file_path}:${r.start_line}`));
      break;
    }

    default:
      console.error(`未知命令: ${cmd}`);
      console.error(HELP);
      process.exit(2);
  }
} finally {
  db.close();
}
