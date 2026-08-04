#!/usr/bin/env node
// icg-query.js - 查询 IRISGraph 后端代码图谱（.iris-codegraph/iris-codegraph.db）
// 参考 .agents/plugins/codegraph-query/scripts/cg-query.js 设计。
// 仅只读访问，默认数据库路径相对当前工作目录。
// 当 Node.js 未内置 node:sqlite 时，自动降级为调用 Python sqlite3 执行器。
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  DatabaseSync = null;
}

const DB_DEFAULT = path.resolve(process.cwd(), '.iris-codegraph/iris-codegraph.db');

function openDb(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.error(`[iris-codegraph] 数据库不存在: ${dbPath}`);
    console.error('请先在项目根目录运行 iris-codegraph-build.js 生成 .iris-codegraph/iris-codegraph.db');
    process.exit(1);
  }
  if (DatabaseSync) {
    return new SqliteDb(dbPath);
  }
  return new PyDb(dbPath);
}

class SqliteDb {
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath, { readOnly: true });
  }

  get(sql, ...params) {
    return this.db.prepare(sql).get(...params);
  }

  all(sql, ...params) {
    return this.db.prepare(sql).all(...params);
  }

  close() {
    this.db.close();
  }
}

class PyDb {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.runnerPath = path.join(__dirname, 'icg-query-sql-runner.py');
    if (!fs.existsSync(this.runnerPath)) {
      console.error(`[iris-codegraph] 未找到 Python 查询执行器: ${this.runnerPath}`);
      console.error('当前 Node 不支持 node:sqlite，需要该 Python 脚本作为降级方案。');
      process.exit(1);
    }
    this.proc = spawn('python', [this.runnerPath, this.dbPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.proc.on('error', (err) => {
      console.error('[iris-codegraph] Python 查询执行器启动失败:', err.message);
      process.exit(1);
    });
    this.proc.stderr.on('data', (data) => {
      console.error('[iris-codegraph] Python 执行器错误:', data.toString());
    });
    this.buffer = '';
    this.pending = null;
    this.queue = [];
    this.closed = false;
    this.proc.stdout.on('data', (data) => {
      this.buffer += data.toString();
      let idx;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        this._handleLine(line);
      }
    });
  }

  _handleLine(line) {
    if (!this.pending) return;
    let result;
    try {
      result = JSON.parse(line);
    } catch (e) {
      result = { error: `Python 返回非法 JSON: ${line}` };
    }
    if (result && result.error) {
      this.pending.reject(new Error(result.error));
    } else {
      this.pending.resolve(result);
    }
    this.pending = null;
    this._drain();
  }

  _drain() {
    if (this.pending || this.queue.length === 0) return;
    const { sql, params, resolve, reject } = this.queue.shift();
    this.pending = { resolve, reject };
    this.proc.stdin.write(JSON.stringify({ sql, params }) + '\n');
  }

  _query(sql, params) {
    return new Promise((resolve, reject) => {
      this.queue.push({ sql, params, resolve, reject });
      this._drain();
    });
  }

  async get(sql, ...params) {
    const rows = await this._query(sql, params);
    return rows[0] || null;
  }

  async all(sql, ...params) {
    return await this._query(sql, params);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.proc.stdin.writable) this.proc.stdin.end();
    this.proc.kill();
  }
}

function fmtNode(r) {
  const loc = r.file_path ? `${r.file_path}:${r.start_line || 1}` : '(无文件)';
  const sig = r.signature ? `  ${r.signature}` : '';
  return `${r.kind}\t${r.name}\t${loc}${sig}`;
}

function parseMetadata(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    return {};
  }
}

async function resolveNodes(db, arg) {
  if (!arg) return [];
  if (/^\d+$/.test(arg)) {
    const row = await db.get('SELECT * FROM nodes WHERE id=?', Number(arg));
    return row ? [row] : [];
  }
  let rows = await db.all('SELECT * FROM nodes WHERE qualified_name=?', arg);
  if (rows.length) return rows;
  rows = await db.all('SELECT * FROM nodes WHERE name=?', arg);
  if (rows.length) return rows;
  rows = await db.all(
    `SELECT * FROM nodes
     WHERE name LIKE '%'||?||'%' OR qualified_name LIKE '%'||?||'%' OR file_path LIKE '%'||?||'%'
     ORDER BY kind, name LIMIT 30`,
    arg, arg, arg
  );
  return rows;
}

const HELP = `用法: node icg-query.js <命令> [参数]

命令:
  stats                     图谱统计（文件/节点/边数、kind 分布、索引状态）
  search <关键词>           按名称、全限定名或路径模糊搜索节点（LIMIT 30）
  show <名称|id>            显示节点详情
  class <类名|id>           显示类详情（含成员、继承、调用方）
  method <全限定名|id>      显示方法详情（含调用方/被调用方）
  callers <名称|id>         谁调用了该节点（上游影响面，calls/extends）
  callees <名称|id>         该节点调用了谁（下游依赖，calls）
  impact <类名|文件路径>    变更某类或文件的 1-hop 上游受影响节点
  global [名称]             列出 Global 节点（暂无数据时提示）
  route [关键词]            列出 REST/CSP 路由节点（暂无数据时提示）

环境变量:
  ICG_DB  指定数据库路径（默认 .iris-codegraph/iris-codegraph.db，相对当前工作目录）

说明:
  图谱由 iris-codegraph-build.js 生成，覆盖后端 ObjectScript 类、方法、属性、参数及调用关系。
  节点全限定名格式：ClassName::MemberName（方法/属性/参数）。`;

const cmd = process.argv[2];
const arg = process.argv[3];

if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
  console.log(HELP);
  process.exit(0);
}

const dbPath = process.env.ICG_DB ? path.resolve(process.env.ICG_DB) : DB_DEFAULT;
const db = openDb(dbPath);

(async () => {
  try {
    switch (cmd) {
      case 'stats': {
        const files = (await db.get('SELECT count(*) c FROM files')).c;
        const nodes = (await db.get('SELECT count(*) c FROM nodes')).c;
        const edges = (await db.get('SELECT count(*) c FROM edges')).c;
        const meta = {};
        (await db.all('SELECT key,value FROM project_metadata')).forEach(r => { meta[r.key] = r.value; });
        console.log(`文件: ${files}  节点: ${nodes}  边: ${edges}`);
        console.log(`索引状态: ${meta.index_state || 'unknown'}  命名空间: ${meta.namespace || '-'}`);
        console.log(`版本: ${meta.indexed_with_version || '-'}  抽取版本: ${meta.indexed_with_extraction_version || '-'}`);
        console.log('\n节点类型分布:');
        (await db.all('SELECT kind,count(*) c FROM nodes GROUP BY kind ORDER BY c DESC')).forEach(r => console.log(`  ${r.kind}: ${r.c}`));
        console.log('\n边类型分布:');
        (await db.all('SELECT kind,count(*) c FROM edges GROUP BY kind ORDER BY c DESC')).forEach(r => console.log(`  ${r.kind}: ${r.c}`));
        console.log('\n文件语言分布:');
        (await db.all('SELECT language,count(*) c FROM files WHERE language IS NOT NULL GROUP BY language ORDER BY c DESC')).forEach(r => console.log(`  ${r.language}: ${r.c}`));
        break;
      }

      case 'search': {
        if (!arg) { console.error('用法: search <关键词>'); process.exit(2); }
        const rows = await db.all(
          `SELECT kind,name,qualified_name,file_path,start_line,signature FROM nodes
           WHERE name LIKE '%'||?||'%' OR qualified_name LIKE '%'||?||'%' OR file_path LIKE '%'||?||'%'
           ORDER BY kind, name LIMIT 30`,
          arg, arg, arg
        );
        if (!rows.length) { console.log('未匹配到节点'); break; }
        rows.forEach(r => console.log(fmtNode(r)));
        break;
      }

      case 'show': {
        if (!arg) { console.error('用法: show <名称|id>'); process.exit(2); }
        const rows = await resolveNodes(db, arg);
        if (!rows.length) { console.log('未找到节点'); break; }
        if (rows.length > 1) {
          console.log(`找到 ${rows.length} 个匹配节点，请使用 id 或更精确的名称：`);
          rows.forEach(r => console.log(fmtNode(r)));
          break;
        }
        const row = rows[0];
        console.log(`id:          ${row.id}`);
        console.log(`kind:        ${row.kind}`);
        console.log(`name:        ${row.name}`);
        console.log(`qualified:   ${row.qualified_name || '-'}`);
        console.log(`location:    ${row.file_path ? row.file_path + ':' + (row.start_line || 1) : '-'}`);
        console.log(`language:    ${row.language || '-'}`);
        if (row.signature) console.log(`signature:   ${row.signature}`);
        if (row.visibility) console.log(`visibility:  ${row.visibility}`);
        console.log(`exported:    ${row.is_exported}  static: ${row.is_static}`);
        const meta = parseMetadata(row.metadata);
        if (Object.keys(meta).length) console.log(`metadata:    ${JSON.stringify(meta)}`);
        if (row.docstring) console.log(`docstring:\n${row.docstring.replace(/\r/g, '')}`);
        break;
      }

      case 'class': {
        if (!arg) { console.error('用法: class <类名|id>'); process.exit(2); }
        let row;
        if (/^\d+$/.test(arg)) {
          row = await db.get('SELECT * FROM nodes WHERE id=? AND kind=\'class\'', Number(arg));
        } else {
          row = await db.get('SELECT * FROM nodes WHERE kind=\'class\' AND qualified_name=?', arg);
          if (!row) row = await db.get('SELECT * FROM nodes WHERE kind=\'class\' AND name=?', arg);
        }
        if (!row) { console.log('未找到类节点'); break; }

        console.log(`id:          ${row.id}`);
        console.log(`name:        ${row.name}`);
        console.log(`qualified:   ${row.qualified_name}`);
        console.log(`location:    ${row.file_path || '-'}`);
        const meta = parseMetadata(row.metadata);
        if (meta.super) console.log(`super:       ${meta.super}`);
        if (meta.abstract) console.log(`abstract:    ${meta.abstract}`);
        if (meta.classType) console.log(`classType:   ${meta.classType}`);
        if (meta.stub) console.log(`stub:        true`);
        if (row.docstring) console.log(`docstring:\n${row.docstring.replace(/\r/g, '')}`);

        const members = await db.all(
          `SELECT kind,name,qualified_name,start_line,signature,visibility,is_static FROM nodes
           WHERE file_path=? AND kind IN ('method','property','parameter')
           ORDER BY kind, start_line, name`,
          row.file_path
        );
        if (members.length) {
          console.log(`\n成员 (${members.length}):`);
          members.forEach(m => {
            const vis = m.visibility ? ` [${m.visibility}]` : '';
            const stat = m.is_static ? ' [static]' : '';
            const sig = m.signature ? `  ${m.signature}` : '';
            console.log(`  ${m.kind}\t${m.name}${vis}${stat}${sig}`);
          });
        }

        const supers = await db.all(
          `SELECT n.qualified_name, n.name, e.metadata FROM edges e JOIN nodes n ON n.id=e.target
           WHERE e.source=? AND e.kind='extends'`,
          row.id
        );
        if (supers.length) {
          console.log('\n继承:');
          supers.forEach(s => console.log(`  extends ${s.qualified_name}`));
        }

        const subclasses = await db.all(
          `SELECT n.qualified_name, n.name FROM edges e JOIN nodes n ON n.id=e.source
           WHERE e.target=? AND e.kind='extends'`,
          row.id
        );
        if (subclasses.length) {
          console.log(`\n子类 (${subclasses.length}):`);
          subclasses.forEach(s => console.log(`  ${s.qualified_name}`));
        }

        const callers = await db.all(
          `SELECT DISTINCT n.qualified_name, n.name, e.kind, e.metadata FROM edges e
           JOIN nodes n ON n.id=e.source
           WHERE e.target=? AND e.kind='calls'
           ORDER BY n.qualified_name LIMIT 50`,
          row.id
        );
        if (callers.length) {
          console.log(`\n调用方 (${callers.length}):`);
          callers.forEach(c => {
            const cm = parseMetadata(c.metadata);
            const method = cm.targetMethod ? `.${cm.targetMethod}` : '';
            console.log(`  ${c.kind}\t${c.qualified_name}${method}`);
          });
        }
        break;
      }

      case 'method': {
        if (!arg) { console.error('用法: method <全限定名|id>'); process.exit(2); }
        let row;
        if (/^\d+$/.test(arg)) {
          row = await db.get('SELECT * FROM nodes WHERE id=? AND kind=\'method\'', Number(arg));
        } else {
          row = await db.get('SELECT * FROM nodes WHERE kind=\'method\' AND qualified_name=?', arg);
          if (!row) row = await db.get('SELECT * FROM nodes WHERE kind=\'method\' AND name=?', arg);
        }
        if (!row) { console.log('未找到方法节点'); break; }

        console.log(`id:          ${row.id}`);
        console.log(`name:        ${row.name}`);
        console.log(`qualified:   ${row.qualified_name}`);
        console.log(`location:    ${row.file_path || '-'}:${row.start_line || 1}`);
        console.log(`visibility:  ${row.visibility || '-'}`);
        console.log(`exported:    ${row.is_exported}  static: ${row.is_static}`);
        if (row.signature) console.log(`signature:   ${row.signature}`);
        const meta = parseMetadata(row.metadata);
        if (meta.returnType) console.log(`returnType:  ${meta.returnType}`);
        if (meta.formalSpec) console.log(`formalSpec:  ${meta.formalSpec}`);
        if (row.docstring) console.log(`docstring:\n${row.docstring.replace(/\r/g, '')}`);

        const className = row.qualified_name.split('::')[0];
        const classRow = await db.get('SELECT id FROM nodes WHERE kind=\'class\' AND qualified_name=?', className);
        if (classRow) {
          const callerEdges = await db.all(
            `SELECT e.source, e.metadata, n.qualified_name, n.name FROM edges e
             JOIN nodes n ON n.id=e.source
             WHERE e.target=? AND e.kind='calls'`,
            classRow.id
          );
          const methodCallers = callerEdges.filter(e => {
            const em = parseMetadata(e.metadata);
            return em.targetMethod === row.name;
          });
          if (methodCallers.length) {
            console.log(`\n方法调用方 (${methodCallers.length}):`);
            methodCallers.forEach(c => console.log(`  class\t${c.qualified_name}`));
          }

          const callees = await db.all(
            `SELECT e.target, e.metadata, n.qualified_name, n.name FROM edges e
             JOIN nodes n ON n.id=e.target
             WHERE e.source=? AND e.kind='calls'`,
            classRow.id
          );
          if (callees.length) {
            console.log(`\n类下游调用 (${callees.length})，本方法可能涉及：`);
            callees.forEach(c => {
              const cm = parseMetadata(c.metadata);
              const method = cm.targetMethod ? `.${cm.targetMethod}` : '';
              console.log(`  class\t${c.qualified_name}${method}`);
            });
          }
        }
        break;
      }

      case 'callers': {
        if (!arg) { console.error('用法: callers <名称|id>'); process.exit(2); }
        const targets = await resolveNodes(db, arg);
        if (!targets.length) { console.log('未找到节点'); break; }
        if (targets.length > 1) {
          console.log(`找到 ${targets.length} 个匹配节点，请使用 id 或更精确的名称：`);
          targets.forEach(r => console.log(fmtNode(r)));
          break;
        }
        const target = targets[0];
        let rows;
        if (target.kind === 'method') {
          const className = target.qualified_name.split('::')[0];
          const classRow = await db.get('SELECT id FROM nodes WHERE kind=\'class\' AND qualified_name=?', className);
          if (!classRow) { console.log('未找到方法所属类'); break; }
          rows = await db.all(
            `SELECT DISTINCT n.kind, n.name, n.qualified_name, n.file_path, n.start_line, e.kind AS edge, e.metadata
             FROM edges e JOIN nodes n ON n.id=e.source
             WHERE e.target=? AND e.kind='calls'`,
            classRow.id
          );
          rows = rows.filter(r => {
            const m = parseMetadata(r.metadata);
            return m.targetMethod === target.name;
          });
        } else {
          rows = await db.all(
            `SELECT DISTINCT n.kind, n.name, n.qualified_name, n.file_path, n.start_line, e.kind AS edge, e.metadata
             FROM edges e JOIN nodes n ON n.id=e.source
             WHERE e.target=? AND e.kind IN ('calls','extends')
             ORDER BY n.file_path, n.start_line LIMIT 50`,
            target.id
          );
        }
        if (!rows.length) { console.log(`没有节点调用/继承 "${target.qualified_name || target.name}"`); break; }
        console.log(`"${target.qualified_name || target.name}" 的上游节点：`);
        rows.forEach(r => {
          const m = parseMetadata(r.metadata);
          const via = m.targetMethod ? ` (via .${m.targetMethod})` : '';
          const loc = r.file_path ? `\t${r.file_path}:${r.start_line || 1}` : '';
          console.log(`${r.edge}\t${r.kind}\t${r.qualified_name || r.name}${loc}${via}`);
        });
        break;
      }

      case 'callees': {
        if (!arg) { console.error('用法: callees <名称|id>'); process.exit(2); }
        const sources = await resolveNodes(db, arg);
        if (!sources.length) { console.log('未找到节点'); break; }
        if (sources.length > 1) {
          console.log(`找到 ${sources.length} 个匹配节点，请使用 id 或更精确的名称：`);
          sources.forEach(r => console.log(fmtNode(r)));
          break;
        }
        const source = sources[0];
        const rows = await db.all(
          `SELECT DISTINCT n.kind, n.name, n.qualified_name, n.file_path, n.start_line, e.kind AS edge, e.metadata
           FROM edges e JOIN nodes n ON n.id=e.target
           WHERE e.source=? AND e.kind='calls'
           ORDER BY n.file_path, n.start_line LIMIT 50`,
          source.id
        );
        if (!rows.length) { console.log(`"${source.qualified_name || source.name}" 没有下游调用`); break; }
        console.log(`"${source.qualified_name || source.name}" 的下游节点：`);
        rows.forEach(r => {
          const m = parseMetadata(r.metadata);
          const via = m.targetMethod ? ` (via .${m.targetMethod})` : '';
          const loc = r.file_path ? `\t${r.file_path}:${r.start_line || 1}` : '';
          console.log(`${r.edge}\t${r.kind}\t${r.qualified_name || r.name}${loc}${via}`);
        });
        break;
      }

      case 'impact': {
        if (!arg) { console.error('用法: impact <类名|文件路径>'); process.exit(2); }
        let filePath = arg;
        let className = null;
        if (!arg.includes('/') && !arg.includes('\\') && !arg.toLowerCase().endsWith('.cls')) {
          const classRow = await db.get('SELECT id, file_path FROM nodes WHERE kind=\'class\' AND qualified_name=?', arg);
          if (classRow) {
            className = arg;
            filePath = classRow.file_path;
          }
        }
        if (!filePath) { console.log('未找到对应的类或文件'); break; }

        const rows = await db.all(
          `SELECT DISTINCT up.kind, up.name, up.qualified_name, up.file_path, up.start_line, e.kind AS edge, e.metadata
           FROM nodes me
           JOIN edges e ON e.target=me.id
           JOIN nodes up ON up.id=e.source
           WHERE me.file_path=? AND e.kind IN ('calls','extends')
           ORDER BY up.file_path, up.start_line LIMIT 80`,
          filePath
        );
        if (!rows.length) { console.log(`${className ? '类 ' + className : '文件 ' + filePath} 无上游依赖`); break; }
        console.log(`变更 ${className || filePath} 会影响以下 ${rows.length} 个上游节点:`);
        rows.forEach(r => {
          const m = parseMetadata(r.metadata);
          const via = m.targetMethod ? ` (via .${m.targetMethod})` : '';
          console.log(`${r.edge}\t${r.kind}\t${r.qualified_name || r.name}\t${r.file_path || '-'}:${r.start_line || 1}${via}`);
        });
        break;
      }

      case 'global': {
        const rows = await db.all("SELECT kind,name,qualified_name,file_path,start_line FROM nodes WHERE kind='global' ORDER BY name");
        if (!rows.length) { console.log('当前图谱中暂无 Global 节点（待 1D.3 静态解析实现）'); break; }
        if (arg) {
          rows.filter(r => r.name.includes(arg) || (r.qualified_name && r.qualified_name.includes(arg))).forEach(r => console.log(fmtNode(r)));
        } else {
          rows.forEach(r => console.log(fmtNode(r)));
        }
        break;
      }

      case 'route': {
        const rows = await db.all("SELECT kind,name,qualified_name,file_path,start_line FROM nodes WHERE kind IN ('route','csp_page') ORDER BY file_path");
        if (!rows.length) { console.log('当前图谱中暂无 route/csp_page 节点（待 1D.6 静态解析实现）'); break; }
        if (arg) {
          rows.filter(r => r.name.includes(arg) || (r.qualified_name && r.qualified_name.includes(arg))).forEach(r => console.log(fmtNode(r)));
        } else {
          rows.forEach(r => console.log(fmtNode(r)));
        }
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
})();
