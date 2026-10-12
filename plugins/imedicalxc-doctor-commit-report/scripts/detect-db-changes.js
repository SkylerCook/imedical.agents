#!/usr/bin/env node
'use strict';

/*
 * detect-db-changes.js — 数据库脚本执行提醒 · 确定性检测脚本
 *
 * 输入 collect-commits.js 产出的 raw-commits-<label>.json，对每条提交读取 diff，
 * 检测需要数据库脚本 / 字典维护的变更，输出 db-changes-<label>.json：
 *
 *   1. poChanges    数据结构修改：*PO.java 文件新增/删除 @TableField 字段
 *   2. newStCodes   新增 ST_CODE 常量声明（配置大类）
 *   3. configItems  新增系统标准配置：docconfig 模块 ConfigConstants 文件新增配置项，
 *                   或任意位置以 ST_CODE 字面量直接构造 ConfigItemUtil
 *   4. reminders    新增系统标准提醒：HisBusinessException.build/rpcException(
 *                   XxxConstants.BUSINESS_CODE + "NNN"或字母数字后缀, "msg")；
 *                   硬编码错误码（"500"/"-1000"）与 e.getCode() 透传不属于字典表标准提醒
 *   5. cacheConfigs 新增代码表缓存配置：新增 DocCacheUtils.getByKey/batchByXXX(XxxPO.class)
 *                   调用，且该 PO 首次作为缓存读取对象使用（缓存按 PO 维护，同一 PO 的
 *                   其他方法调用共享既有配置）；已有历史用法（父提交/其他仓库）的复用调用
 *                   归入 cacheReuses，仅存档、不列入提醒。两类记录均解析 PO 的 @TableName
 *                   表名——代码表缓存管理按表名维护
 *
 * 用法：node detect-db-changes.js <raw-commits-YYYY-MM.json>
 * 输出：同目录 db-changes-<label>.json（UTF-8 无 BOM）+ 控制台摘要
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { discoverRepos } = require('./collect-commits.js');

const execFileAsync = promisify(execFile);

const USAGE = `用法: node detect-db-changes.js <raw-commits-YYYY-MM.json>
  读取采集脚本产出的原始提交 JSON，检测数据库相关变更
输出: 同目录 db-changes-<label>.json（UTF-8 无 BOM）+ 控制台摘要`;

// ---------- diff 解析（--unified=0，只关心增删行） ----------

const DIFF_HEADER_RE = /^diff --git a\/(.+?) b\/(.+)$/;
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function parseDiffSections(stdout) {
  const sections = [];
  let cur = null;
  let lineNo = 0;
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line) continue;
    const h = DIFF_HEADER_RE.exec(line);
    if (h) {
      cur = { path: h[2], isNew: false, added: [], removed: [] };
      sections.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file mode')) { cur.isNew = true; continue; }
    if (line.startsWith('@@')) {
      const hk = HUNK_RE.exec(line);
      if (hk) lineNo = Number(hk[1]);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      cur.added.push({ no: lineNo, text: line.slice(1) });
      lineNo += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      cur.removed.push(line.slice(1));
    }
  }
  return sections;
}

// 匹配起点位于 joined 文本第几行（addedLines 下标）
function lineIndexOf(text, offset) {
  let n = 0;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// ---------- 检测正则 ----------

const ST_CODE_DECL_RE = /String\s+(\w*ST_CODE\w*)\s*=\s*"([^"]+)"/;
const CONFIG_ITEM_RE = /new\s+((?:\w*ConfigItem\w*)Util)\s*(?:<[^>]*>)?\s*\(\s*("(?:[^"\\]|\\.)*"|([A-Za-z_]\w*))\s*,\s*"([^"]+)"/g;
const REMINDER_RE = /HisBusinessException\s*\.\s*(build|rpcException)\s*\(\s*([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)\s*\+\s*"(\w{2,})"\s*(?:,\s*"((?:[^"\\]|\\.)*)")?/g;
const CACHE_CALL_RE = /DocCacheUtils\s*\.\s*(getByKey|batchBy[A-Za-z]\w*)\s*\(\s*(?:[^,()]+,\s*)?([A-Za-z_]\w*PO)\s*\.\s*class/g;

const TABLE_NAME_RE = /@TableName\(\s*(?:value\s*=\s*)?"([^"]+)"/;
const TABLE_FIELD_RE = /@TableField\(\s*(?:value\s*=\s*)?"([^"]+)"\s*\)/;
const API_MODEL_RE = /@ApiModelProperty\(\s*(?:value\s*=\s*)?"((?:[^"\\]|\\.)*)"/;
const FIELD_DECL_RE = /private\s+(?!static)([\w.$<>[\], ]+?)\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;/;

// ---------- PO 字段提取（@TableField / @ApiModelProperty 与 private 声明配对） ----------

function extractFields(lines) {
  const fields = [];
  let column = null;
  let comment = null;
  for (const t of lines) {
    if (/^\s*\*/.test(t)) continue;
    const tf = TABLE_FIELD_RE.exec(t);
    if (tf) { column = tf[1]; continue; }
    const cm = API_MODEL_RE.exec(t);
    if (cm) { comment = cm[1]; continue; }
    const fd = FIELD_DECL_RE.exec(t);
    if (fd && fd[2] !== 'serialVersionUID') {
      fields.push({ type: fd[1].trim(), name: fd[2], column, comment: comment || null });
      column = null;
      comment = null;
    }
  }
  return fields;
}

// ---------- BUSINESS_CODE 前缀解析 ----------

// 按全限定类名定位仓库内的 Java 文件：import 只给包路径，Maven 多模块下实际文件在
// <module>/src/main/java/<包路径>，故依次尝试 锚点同 src root → 包路径直查 → ls-tree 后缀匹配
async function findClassFile(repo, hash, fq, ctx, anchorFile) {
  const rel = fq.replace(/\./g, '/') + '.java';
  const candidates = [];
  const m = anchorFile ? /^(.*\/src\/main\/java)\//.exec(anchorFile) : null;
  if (m) candidates.push(`${m[1]}/${rel}`);
  candidates.push(rel);
  for (const p of candidates) {
    const c = await ctx.gitShowFile(repo, hash, p);
    if (c) return { content: c, file: p };
  }
  const tree = await ctx.lsTree(repo, hash);
  const hit = tree.split('\n').find((p) => p === rel || p.endsWith('/' + rel));
  if (hit) {
    const c = await ctx.gitShowFile(repo, hash, hit);
    if (c) return { content: c, file: hit };
  }
  return null;
}

async function resolveBusinessCodePrefix(repoAbs, hash, filePath, expr, ctx) {
  // 常量可能链式引用其他常量（如 BUSINESS_CODE = XxxConstants.ORD_BUSINESS_CODE），沿链最多 5 跳；
  // 引用类不在本仓库时（如 comoe 引用 ctsv 的常量类），按全限定名在其他仓库 HEAD 近似解析
  const visited = new Set();
  let cur = { repo: repoAbs, hash, file: filePath, expr };
  for (let hop = 0; hop < 5; hop++) {
    const key = `${cur.repo}|${cur.hash}|${cur.file}|${cur.expr}`;
    if (visited.has(key)) return null;
    visited.add(key);
    const content = await ctx.gitShowFile(cur.repo, cur.hash, cur.file);
    if (!content) return null;
    const parts = cur.expr.split('.');
    if (parts.length === 1) {
      const varName = parts[0];
      const vm = new RegExp(`String\\s+${varName}\\s*=\\s*"([^"]+)"`).exec(content);
      if (vm) return vm[1];
      const rm = new RegExp(`String\\s+${varName}\\s*=\\s*([A-Za-z_][\\w.]*)\\s*;`).exec(content);
      if (rm && rm[1] !== varName) {
        cur = { ...cur, expr: rm[1] };
        continue;
      }
      const si = new RegExp(`import\\s+static\\s+([\\w.]+)\\.${varName}\\s*;`).exec(content);
      if (si) {
        cur = { ...cur, expr: si[1] };
        continue;
      }
      return null;
    }
    const cls = parts[parts.length - 2];
    const field = parts[parts.length - 1];
    let fq = null;
    if (parts.length >= 3) {
      fq = parts.slice(0, -1).join('.');
    } else {
      const imp = new RegExp(`import\\s+((?:[\\w.]+\\.)${cls})\\s*;`).exec(content);
      if (imp) fq = imp[1];
    }
    let clsContent = null;
    let at = null;
    if (fq) {
      const found = await findClassFile(cur.repo, cur.hash, fq, ctx, cur.file);
      if (found) {
        clsContent = found.content;
        at = { repo: cur.repo, hash: cur.hash, file: found.file };
      } else {
        for (const r of ctx.repos) {
          const other = path.join(ctx.repoRoot, r);
          if (other === cur.repo) continue;
          const f2 = await findClassFile(other, 'HEAD', fq, ctx, null);
          if (f2) {
            clsContent = f2.content;
            at = { repo: other, hash: 'HEAD', file: f2.file };
            break;
          }
        }
      }
    }
    if (!clsContent && parts.length === 2) {
      // 无导入（同包类）→ 本仓库同目录兜底
      const rel = path.posix.join(path.posix.dirname(cur.file), `${cls}.java`);
      clsContent = await ctx.gitShowFile(cur.repo, cur.hash, rel);
      if (clsContent) at = { repo: cur.repo, hash: cur.hash, file: rel };
    }
    if (!clsContent) return null;
    const cm = new RegExp(`String\\s+${field}\\s*=\\s*"([^"]+)"`).exec(clsContent);
    if (cm) return cm[1];
    const rm = new RegExp(`String\\s+${field}\\s*=\\s*([A-Za-z_][\\w.]*)\\s*;`).exec(clsContent);
    if (rm) {
      cur = { repo: at.repo, hash: at.hash, file: at.file, expr: rm[1] };
      continue;
    }
    return null;
  }
  return null;
}

// ---------- 缓存读取对象首用判定 ----------
// 同仓库按父提交（hash~1）精确裁决；其他仓库按 HEAD 近似（若该 PO 在窗口内更早被其他仓库
// 使用，HEAD 检查同样能命中；仅当"本窗口首用 + 窗口后其他仓库又用"这一罕见时序会误判为非首用）。
// 匹配模式限定同一行内 DocCacheUtils.<method>(...XxxPO，跨行调用的历史用法会被漏检，
// 结果偏向多报 firstUse（提醒多看一眼），不影响漏报方向。

function cacheUsagePattern(poClass) {
  return `DocCacheUtils\\.[A-Za-z_]\\w*[^;]*${poClass}`;
}

async function checkFirstUse(commit, poClass, createdHere, ctx) {
  const repoAbs = path.join(ctx.repoRoot, commit.repo);
  if (createdHere.has(poClass)) {
    return { firstUse: true, priorUsage: null, basis: 'po-created-in-same-commit' };
  }
  const pattern = cacheUsagePattern(poClass);
  const parent = `${commit.hash}~1`;
  const priorSame = await ctx.grep(repoAbs, parent, pattern);
  if (priorSame.length > 0) {
    return { firstUse: false, priorUsage: { sameRepo: priorSame.slice(0, 5) }, basis: 'same-repo@parent' };
  }
  const otherHits = [];
  await Promise.all(
    ctx.repos.filter((r) => r !== commit.repo).map(async (r) => {
      const abs = path.join(ctx.repoRoot, r);
      const hits = await ctx.grep(abs, 'HEAD', pattern);
      if (hits.length > 0) otherHits.push({ repo: r, files: hits.slice(0, 5) });
    })
  );
  if (otherHits.length > 0) {
    return { firstUse: false, priorUsage: { otherRepos: otherHits }, basis: 'other-repos@HEAD' };
  }
  return { firstUse: true, priorUsage: null, basis: 'no-prior-usage' };
}

// 代码表缓存管理按表名维护：解析缓存调用入参 PO 的 @TableName 表名。
// 优先用使用文件的 import 取全限定名（findClassFile：同仓库提交时点 → 其他仓库 HEAD），
// 无显式 import（通配/同包）时按 "<包路径>/XxxPO.java" 后缀在各仓库 HEAD 兜底。
async function resolveCacheTableName(rec, ctx) {
  const repoAbs = path.join(ctx.repoRoot, rec.repo);
  const usage = await ctx.gitShowFile(repoAbs, rec.hash, rec.file);
  let fq = null;
  if (usage) {
    const imp = new RegExp(`import\\s+((?:[\\w.]+\\.)${rec.poClass})\\s*;`).exec(usage);
    if (imp) fq = imp[1];
  }
  let content = null;
  if (fq) {
    const found = await findClassFile(repoAbs, rec.hash, fq, ctx, rec.file);
    if (found) {
      content = found.content;
    } else {
      for (const r of ctx.repos) {
        const other = path.join(ctx.repoRoot, r);
        if (other === repoAbs) continue;
        const f2 = await findClassFile(other, 'HEAD', fq, ctx, null);
        if (f2) { content = f2.content; break; }
      }
    }
  }
  if (!content) {
    for (const r of ctx.repos) {
      const other = path.join(ctx.repoRoot, r);
      const tree = await ctx.lsTree(other, 'HEAD');
      const hit = tree.split('\n').find((p) => p.endsWith(`/${rec.poClass}.java`));
      if (hit) {
        content = await ctx.gitShowFile(other, 'HEAD', hit);
        if (content) break;
      }
    }
  }
  if (!content) return null;
  const m = TABLE_NAME_RE.exec(content);
  return m ? m[1] : null;
}

// 常量声明名位于 new 行的同行前缀（单行声明）或上一行行尾（两行声明，形如
// "public static final XxxUtil<T> NAME =" 换行 "new XxxUtil<>(...)")。
function constantNameBefore(joined, index) {
  const DECL_TAIL_RE = /([A-Za-z_]\w*)\s*=\s*$/;
  const lineStart = joined.lastIndexOf('\n', index - 1) + 1;
  const sameLine = joined.slice(lineStart, index);
  let m = DECL_TAIL_RE.exec(sameLine);
  if (m) return m[1];
  if (lineStart > 0) {
    const prevLine = joined.slice(joined.lastIndexOf('\n', lineStart - 2) + 1, lineStart - 1);
    m = DECL_TAIL_RE.exec(prevLine);
    if (m) return m[1];
  }
  return null;
}

// ---------- 单提交检测 ----------

async function detectCommit(commit, ctx) {
  const hasJava = commit.files.some((f) => f.path.endsWith('.java'));
  if (!hasJava) return null;

  const repoAbs = path.join(ctx.repoRoot, commit.repo);
  const diff = await ctx.git(repoAbs, [
    'diff-tree', '--no-color', '-M', '-r', '-p', '--unified=0', '--no-commit-id', '--root', commit.hash
  ]);
  const sections = parseDiffSections(diff);
  const result = { poChanges: [], newStCodes: [], configItems: [], reminders: [], cacheConfigs: [] };
  const base = {
    repo: commit.repo,
    hash: commit.hash,
    author: commit.author,
    date: commit.date,
    subject: commit.subject
  };

  // 本提交内新建的 PO（新建 PO 的缓存调用必然首用，免 grep）
  const createdPoHere = new Set(
    sections
      .filter((s) => s.isNew && /PO\.java$/.test(s.path))
      .map((s) => path.basename(s.path, '.java'))
  );

  const firstUseMemo = new Map();

  for (const sec of sections) {
    if (!sec.path.endsWith('.java')) continue;
    const addedTexts = sec.added.map((l) => l.text);
    const joined = addedTexts.join('\n');
    const removedSet = new Set(sec.removed.map((t) => t.trim()));
    const isPoFile = /PO\.java$/.test(sec.path);
    const isDocconfig = sec.path.includes('docconfig');
    const isConfigConstants = /ConfigConstants\.java$/.test(sec.path);

    // --- 1. PO 数据结构修改 ---
    if (isPoFile) {
      let content = await ctx.gitShowFile(repoAbs, commit.hash, sec.path);
      if (!content && !sec.isNew) content = await ctx.gitShowFile(repoAbs, `${commit.hash}~1`, sec.path);
      const tableName = content ? (TABLE_NAME_RE.exec(content) || [])[1] || null : null;
      const looksEntity = Boolean(tableName) || /entity/i.test(sec.path);
      if (looksEntity) {
        const addedFields = extractFields(addedTexts);
        const removedFields = extractFields(sec.removed);
        const sig = (list) => JSON.stringify(list.map((f) => [f.name, f.column]).sort());
        const movedOnly = addedFields.length > 0 && removedFields.length > 0 && sig(addedFields) === sig(removedFields);
        const tableNameAdd = addedTexts.some((t) => TABLE_NAME_RE.test(t));
        if (!movedOnly && (addedFields.length > 0 || removedFields.length > 0 || tableNameAdd)) {
          result.poChanges.push({
            ...base,
            file: sec.path,
            tableName,
            isNewFile: sec.isNew,
            addedFields,
            removedFields
          });
        }
      }
    }

    // --- 2a. 新增 ST_CODE 常量声明 ---
    for (const { no, text } of sec.added) {
      if (removedSet.has(text.trim())) continue;
      const m = ST_CODE_DECL_RE.exec(text);
      if (m) {
        result.newStCodes.push({ ...base, file: sec.path, lineNo: no, constantName: m[1], stCode: m[2] });
      }
    }

    // --- 2b. 新增配置项（docconfig ConfigConstants 变量引用；字面量首参不限位置） ---
    // matchAll 同步快照匹配结果后再处理：模块级 /g 正则若在循环体内 await 会被并发
    // worker 的 exec 抢占 lastIndex，产生错位/截断的捕获组。
    for (const m of joined.matchAll(CONFIG_ITEM_RE)) {
      const startLine = lineIndexOf(joined, m.index);
      if (removedSet.has(addedTexts[startLine].trim())) continue;
      // m[2] 是整个 alternation（字面量或变量名都会填它）；m[3] 仅变量分支参与
      const varName = m[3];
      const itemCode = m[4];
      let stCode = null;
      let stCodeRaw = null;
      let scope;
      if (varName === undefined) {
        stCode = m[2].slice(1, -1);
        stCodeRaw = stCode;
        scope = 'inline-literal';
      } else {
        if (!(isDocconfig && isConfigConstants)) continue;
        stCodeRaw = varName;
        const map = await ctx.stCodeMap(repoAbs, commit.hash, sec.path, joined);
        stCode = map[varName] || null;
        scope = 'docconfig';
      }
      const cn = constantNameBefore(joined, m.index);
      result.configItems.push({
        ...base,
        file: sec.path,
        lineNo: sec.added[startLine].no,
        constantName: cn,
        utilClass: m[1],
        stCode,
        stCodeRaw,
        itemCode,
        scope
      });
    }

    // --- 3. 新增系统标准提醒 ---
    for (const m of joined.matchAll(REMINDER_RE)) {
      const startLine = lineIndexOf(joined, m.index);
      if (removedSet.has(addedTexts[startLine].trim())) continue;
      const expr = m[2].replace(/\s+/g, '');
      const prefixValue = await resolveBusinessCodePrefix(repoAbs, commit.hash, sec.path, expr, ctx);
      result.reminders.push({
        ...base,
        file: sec.path,
        lineNo: sec.added[startLine].no,
        method: m[1],
        expr,
        codeSuffix: m[3],
        message: m[4] || null,
        resolvedCode: prefixValue ? prefixValue + m[3] : null
      });
    }

    // --- 4. 新增代码表缓存配置（含 PO 首用判定） ---
    for (const m of joined.matchAll(CACHE_CALL_RE)) {
      const startLine = lineIndexOf(joined, m.index);
      if (removedSet.has(addedTexts[startLine].trim())) continue;
      const poClass = m[2];
      if (!firstUseMemo.has(poClass)) {
        firstUseMemo.set(poClass, checkFirstUse(commit, poClass, createdPoHere, ctx));
      }
      const info = await firstUseMemo.get(poClass);
      result.cacheConfigs.push({
        ...base,
        file: sec.path,
        lineNo: sec.added[startLine].no,
        method: m[1],
        poClass,
        firstUse: info.firstUse,
        priorUsage: info.priorUsage,
        basis: info.basis
      });
    }
  }
  return result;
}

// ---------- 执行上下文（git 调用 + 缓存） ----------

function makeCtx(repoRoot, repos) {
  const showFileCache = new Map();
  const stCodeCache = new Map();
  const grepCache = new Map();
  const treeCache = new Map();

  const ctx = {
    repoRoot,
    repos,
    async git(cwd, args) {
      const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' });
      return stdout;
    },
    lsTree(cwd, hash) {
      const key = `${cwd}\n${hash}`;
      if (!treeCache.has(key)) {
        treeCache.set(key, ctx.git(cwd, ['ls-tree', '-r', '--name-only', hash]).catch(() => ''));
      }
      return treeCache.get(key);
    },
    gitShowFile(cwd, hash, filePath) {
      const key = `${cwd}\n${hash}:${filePath}`;
      if (!showFileCache.has(key)) {
        // 用 cat-file 而非 show：Windows 上 git show <40位hash>:<长路径> 会把参数当
        // 文件名 stat，超过 MAX_PATH 报 "Filename too long"；cat-file 只走对象名解析
        showFileCache.set(key, ctx.git(cwd, ['cat-file', 'blob', `${hash}:${filePath}`]).catch(() => null));
      }
      return showFileCache.get(key);
    },
    stCodeMap(cwd, hash, filePath, diffJoined) {
      const key = `${cwd}\n${hash}:${filePath}`;
      if (!stCodeCache.has(key)) {
        stCodeCache.set(
          key,
          (async () => {
            const map = {};
            for (const mm of diffJoined.matchAll(/String\s+(\w*ST_CODE\w*)\s*=\s*"([^"]+)"/g)) map[mm[1]] = mm[2];
            const content = await ctx.gitShowFile(cwd, hash, filePath);
            if (content) {
              for (const mm of content.matchAll(/String\s+(\w*ST_CODE\w*)\s*=\s*"([^"]+)"/g)) {
                if (!(mm[1] in map)) map[mm[1]] = mm[2];
              }
            }
            return map;
          })()
        );
      }
      return stCodeCache.get(key);
    },
    async grep(cwd, rev, pattern) {
      const key = `${cwd}|${rev}|${pattern}`;
      if (!grepCache.has(key)) {
        // git grep 带 rev 时每行输出为 "<rev>:<path>"，需剥掉前缀得到纯路径
        grepCache.set(
          key,
          execFileAsync('git', ['grep', '-l', '-w', '-E', pattern, rev, '--', '*.java'], {
            cwd,
            maxBuffer: 128 * 1024 * 1024,
            encoding: 'utf8'
          }).then(
            (r) =>
              r.stdout
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => (s.startsWith(`${rev}:`) ? s.slice(rev.length + 1) : s)),
            (err) => {
              if (err.code === 1 || err.code === 128) return [];
              throw err;
            }
          )
        );
      }
      return grepCache.get(key);
    }
  };
  return ctx;
}

// ---------- 主流程 ----------

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === '--help' || arg === '-h') {
    console.log(USAGE);
    return;
  }
  const rawPath = path.resolve(arg);
  if (!fs.existsSync(rawPath)) {
    throw new Error(`输入文件不存在: ${rawPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const label = raw.meta.window.label;
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const ctx = makeCtx(repoRoot, discoverRepos(repoRoot));

  const commits = raw.commits || [];
  const results = new Array(commits.length);
  const errors = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(6, Math.max(commits.length, 1)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= commits.length) break;
      try {
        results[i] = await detectCommit(commits[i], ctx);
      } catch (err) {
        errors.push({ repo: commits[i].repo, hash: commits[i].hash, error: String((err && err.message) || err) });
        results[i] = null;
      }
    }
  });
  await Promise.all(workers);

  const agg = { poChanges: [], newStCodes: [], configItems: [], reminders: [], cacheConfigs: [], cacheReuses: [] };
  let javaCommits = 0;
  for (const r of results) {
    if (!r) continue;
    javaCommits += 1;
    for (const k of ['poChanges', 'newStCodes', 'configItems', 'reminders']) agg[k].push(...r[k]);
    for (const c of r.cacheConfigs) (c.firstUse ? agg.cacheConfigs : agg.cacheReuses).push(c);
  }
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.hash < b.hash ? -1 : 1);
  for (const k of Object.keys(agg)) agg[k].sort(byDate);

  // 缓存配置按表名维护：为各缓存记录解析 PO 的 @TableName 表名（同一使用文件内去重）
  const cacheTableMemo = new Map();
  for (const rec of [...agg.cacheConfigs, ...agg.cacheReuses]) {
    const key = `${rec.repo}\n${rec.file}\n${rec.poClass}`;
    if (!cacheTableMemo.has(key)) cacheTableMemo.set(key, resolveCacheTableName(rec, ctx));
    rec.tableName = (await cacheTableMemo.get(key)) || null;
  }

  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      window: raw.meta.window,
      sourceFile: path.basename(rawPath),
      commitsScanned: commits.length,
      javaCommits,
      counts: {
        poChanges: agg.poChanges.length,
        newStCodes: agg.newStCodes.length,
        configItems: agg.configItems.length,
        reminders: agg.reminders.length,
        cacheConfigs: agg.cacheConfigs.length,
        cacheReuses: agg.cacheReuses.length
      }
    },
    ...agg,
    errors
  };

  const outPath = path.join(path.dirname(rawPath), `db-changes-${label}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(`时间窗: ${raw.meta.window.since} ~ ${raw.meta.window.until}`);
  console.log(`检测提交: ${commits.length} 条（含 Java 改动: ${javaCommits}）`);
  console.log(`数据结构修改(PO): ${agg.poChanges.length} 条`);
  console.log(`新增 ST_CODE: ${agg.newStCodes.length} 条`);
  console.log(`新增配置项: ${agg.configItems.length} 条`);
  console.log(`新增系统标准提醒: ${agg.reminders.length} 条`);
  console.log(`新增缓存配置: ${agg.cacheConfigs.length} 条（仅 PO 首次使用；既有缓存复用 ${agg.cacheReuses.length} 条不计入提醒）`);
  if (errors.length > 0) {
    console.log(`检测错误: ${errors.length} 条`);
    for (const e of errors) console.log(`  ${e.repo} ${e.hash}: ${e.error}`);
  }
  console.log(`原始数据: ${outPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[detect-db-changes] 失败: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseDiffSections, lineIndexOf, extractFields, resolveBusinessCodePrefix, detectCommit, makeCtx };
