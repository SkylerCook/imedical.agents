'use strict';
// 日志语句定位：app-only 簇（无堆栈、无 source_*）按消息文案在源码里反查 log 调用位置。
// 做法：扫描 self 仓 Java 文件的 log.error/warn/... 语句，抽字符串字面量建索引（缓存 7 天），
// 再用消息里的中文片段/标识符去匹配字面量。属于「文案匹配」，不是堆栈证据，报告里必须标注。

const fs = require('node:fs');
const path = require('node:path');

const CACHE_VERSION = 2;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SKIP_DIRS = new Set(['target', 'node_modules', 'build', 'out', 'bin', 'logs', 'dist', 'test', 'tests']);
const LEVELS = ['error', 'warn', 'info', 'debug', 'trace'];
const IDENT_NOISE = new Set([
  'String', 'Integer', 'Long', 'Boolean', 'Object', 'Exception', 'RuntimeException',
  'NullPointerException', 'IllegalArgumentException', 'IllegalStateException',
  'toString', 'equals', 'getClass', 'class', 'return', 'public', 'private', 'static', 'final',
  'true', 'false', 'null', 'this', 'super', 'void', 'import', 'package',
]);

function cachePath(opts = {}) {
  return opts.cacheFile || '';
}

function walkJava(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name.toLowerCase())) continue;
      walkJava(abs, out);
    } else if (ent.isFile() && ent.name.endsWith('.java')) {
      out.push(abs);
    }
  }
}

function endsStatement(text) {
  const noStrings = text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  let depth = 0;
  for (const ch of noStrings) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
  }
  return depth <= 0 && noStrings.includes(';');
}

function extractStatements(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    const m = line.match(/\.(error|warn|info|debug|trace)\s*\(/);
    if (!m) continue;
    let acc = line;
    let j = i;
    while (!endsStatement(acc) && j < i + 15 && j + 1 < lines.length) {
      j += 1;
      acc += '\n' + lines[j];
    }
    const literals = Array.from(acc.matchAll(/"((?:[^"\\]|\\.)*)"/g))
      .map((x) => x[1])
      .filter((s) => s.length >= 2 && /[\u4e00-\u9fa5A-Za-z]/.test(s));
    if (literals.length > 0) out.push({ l: i + 1, v: m[1], s: literals });
    i = j;
  }
  return out;
}

function scanRepo(rootAbs, entries, scope, repoRoot) {
  const files = [];
  walkJava(rootAbs, files);
  for (const abs of files) {
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!LEVELS.some((lv) => text.includes('.' + lv + '('))) continue;
    const stmts = extractStatements(text);
    if (stmts.length === 0) continue;
    entries.push({ f: path.relative(repoRoot, abs).replace(/\\/g, '/'), k: scope, e: stmts });
  }
}

function buildIndex(cfg, opts = {}) {
  const repoRoot = path.resolve(opts.repoRoot || process.cwd());
  const groups = (cfg.ownerGroups || {});
  const selfRepos = (groups.self || {}).repos || [];
  const infraRepos = (groups.infra || {}).repos || [];
  const entries = [];
  // 也扫基础设施仓：app-only 簇的真实日志点可能落在 hiscfsv/hisbase 等公共仓，
  // 命中非本组仓时报告要如实标注，避免把公共日志算成本组待改码项。
  for (const rel of selfRepos) scanRepo(path.isAbsolute(rel) ? rel : path.join(repoRoot, rel), entries, 'self', repoRoot);
  for (const rel of infraRepos) scanRepo(path.isAbsolute(rel) ? rel : path.join(repoRoot, rel), entries, 'infra', repoRoot);
  return { version: CACHE_VERSION, builtAt: new Date().toISOString(), entries };
}

function loadIndex(cfg, opts = {}) {
  const repoRoot = path.resolve(opts.repoRoot || process.cwd());
  const file = cachePath(opts);
  // 未指定缓存文件（如 CLI 一次性调用）时直接现扫，不落盘
  if (!file) return buildIndex(cfg, opts);
  const refresh = String(process.env.GRAYLOG_TRIAGE_REFRESH_LOG_SITES || '') === '1';
  if (!refresh) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      const age = Date.now() - Date.parse(cached.builtAt);
      if (cached.version === CACHE_VERSION && Array.isArray(cached.entries)
        && cached.entries.length > 0 && age >= 0 && age < CACHE_MAX_AGE_MS) {
        return cached;
      }
    } catch {
      // 缓存缺失/损坏则重建
    }
  }
  const index = buildIndex(cfg, opts);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(index), 'utf8');
  } catch (err) {
    console.warn('[WARN] 日志语句索引缓存写入失败: ' + err.message);
  }
  return index;
}

function isCjkAnchor(s) {
  return (s.match(/[\u4e00-\u9fa5]/g) || []).length >= 6;
}

function isCjkAnchorText(s) {
  return /^[\u4e00-\u9fa5，。！？；：、（）《》]+$/.test(s);
}

function isIdentAnchor(s) {
  if (s.length < 8 || IDENT_NOISE.has(s)) return false;
  if (/^[A-Z][a-z]+$/.test(s)) return false;
  return /[A-Z]/.test(s.slice(1)) || s.includes('_');
}

function anchorsOf(cluster) {
  const weights = new Map();
  const add = (s, w) => {
    if (!weights.has(s) || weights.get(s) < w) weights.set(s, w);
  };
  for (const sample of (cluster.samples || []).slice(0, 4)) {
    const msg = String(sample.message || '');
    // 保留中文标点做锚点：「没有关联扩展数据，请注意！」比截出的 8 字短语更能区分近似日志
    for (const raw of msg.match(/[\u4e00-\u9fa5，。！？；：、（）《》]{6,}/g) || []) {
      const frag = raw.replace(/^[，。！？；：、]+|[，。！？；：、]+$/g, '');
      if (isCjkAnchor(frag)) add(frag, frag.length * 2);
    }
    // 消息里的 类名.方法名 引用（如 EnsCloseLoopAbstract.queryClosedLoopStatusLog）
    for (const id of msg.match(/[A-Za-z][A-Za-z0-9_]{5,}/g) || []) {
      if (isIdentAnchor(id)) add(id, id.length);
    }
  }
  const all = Array.from(weights.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([anchor, weight]) => ({ anchor, weight }));
  // 中文文案锚点必须保留：SQL/参数列表这类长消息会塞进大量 snake_case 字段名（权重更高），
  // 按权重直接截断会把唯一的「查询结果行数」挤掉，导致明明有中文锚点却降级为英文兜底。
  const cjk = all.filter((a) => isCjkAnchorText(a.anchor));
  const rest = all.filter((a) => !isCjkAnchorText(a.anchor));
  return cjk.slice(0, 4).concat(rest.slice(0, Math.max(0, 8 - Math.min(cjk.length, 4))));
}

function scoreEntry(entry, anchors) {
  const blob = entry.s.join('\u0001');
  let score = 0;
  let cjkHits = 0;
  let identHits = 0;
  let longestCjk = 0;
  let longestIdent = 0;
  const hit = [];
  for (const { anchor, weight } of anchors) {
    if (!blob.includes(anchor)) continue;
    score += weight;
    hit.push(anchor);
    if (isCjkAnchorText(anchor)) {
      cjkHits += 1;
      longestCjk = Math.max(longestCjk, (anchor.match(/[\u4e00-\u9fa5]/g) || []).length);
    } else {
      identHits += 1;
      longestIdent = Math.max(longestIdent, anchor.length);
    }
  }
  return { score, cjkHits, identHits, longestCjk, longestIdent, hit };
}

function snippetOf(relFile, line, repoRoot) {
  try {
    const abs = path.join(repoRoot, relFile);
    const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    const raw = lines[line - 1] || '';
    const text = raw.trim().replace(/\s+/g, ' ');
    return text.length > 300 ? text.slice(0, 300) + '…' : text;
  } catch {
    return '';
  }
}

// 日志 logger_name 是完整 FQCN 时，优先在对应类文件里找，避免同文案在多个模块复制造成误配
function loggerFileSuffix(loggerName) {
  const name = String(loggerName || '').trim();
  if (!name || name.startsWith('c.m.')) return '';
  const clean = name.split('$')[0];
  const parts = clean.split('.');
  if (parts.length < 4) return '';
  return '/' + parts.join('/') + '.java';
}

function collectCandidates(entries, anchors, hasCjkAnchor, requireError, scopedOk) {
  const candidates = [];
  for (const fileEntry of entries) {
    for (const stmt of fileEntry.e) {
      if (requireError && stmt.v !== 'error') continue;
      const r = scoreEntry(stmt, anchors);
      // 中文文案是最可靠的锚点：必须命中；只有纯英文消息才退化为「两个长标识符」兜底。
      // 否则 orderItmMastRowId 这类字段名会把「参数 xxx 不能为空」之类的通用日志全部命中。
      if (hasCjkAnchor) {
        if (r.longestCjk < 6) continue;
      } else if (scopedOk) {
        // 已按 logger 类文件收窄范围时，单个长标识符（如 prescNoStr）足够在同类内定位
        if (r.identHits < 1 || r.longestIdent < 8) continue;
      } else if (r.identHits < 2 || r.longestIdent < 12) {
        continue;
      }
      candidates.push({
        file: fileEntry.f, line: stmt.l, level: stmt.v, scope: fileEntry.k || 'self',
        score: r.score, hit: r.hit,
      });
    }
  }
  return candidates;
}

function locate(cluster, index, repoRoot) {
  const anchors = anchorsOf(cluster);
  if (anchors.length === 0) return null;
  const hasCjkAnchor = anchors.some((a) => isCjkAnchorText(a.anchor));
  const suffix = loggerFileSuffix(cluster.loggerName);
  let candidates = [];
  let loggerScoped = false;
  if (suffix) {
    const scopedEntries = index.entries.filter((e) => e.f.endsWith(suffix));
    if (scopedEntries.length > 0) {
      // logger 已知时不再限制级别：工作区代码是 warn 也能定位，并据此提示「采集 ERROR / 代码 warn」的不一致
      candidates = collectCandidates(scopedEntries, anchors, hasCjkAnchor, false, true);
      loggerScoped = candidates.length > 0;
    }
  }
  if (candidates.length === 0) {
    // 无 logger 兜底：只在 error 级语句里找，匹配到 info/warn 多为近似文案的另一条日志
    candidates = collectCandidates(index.entries, anchors, hasCjkAnchor, true, false);
  }
  if (candidates.length === 0) return null;
  // 同文案多级别时（如 SqlLimitInterceptor 的 warn/error 共用前缀）优先 error：簇来自 ERROR 流
  const levelRank = (lv) => { const i = LEVELS.indexOf(lv); return i < 0 ? 9 : i; };
  candidates.sort((a, b) => b.score - a.score
    || levelRank(a.level) - levelRank(b.level)
    || a.file.localeCompare(b.file) || a.line - b.line);
  const best = candidates[0];
  const near = candidates.filter((c) => c.score >= best.score * 0.8)
    .filter((c, i, arr) => arr.findIndex((x) => x.file === c.file && x.line === c.line) === i);
  const distinct = near.slice(0, 3);
  return {
    best: { ...best, snippet: snippetOf(best.file, best.line, repoRoot) },
    alternatives: distinct.slice(1).map((c) => ({ file: c.file, line: c.line, level: c.level })),
    ambiguous: new Set(distinct.map((c) => c.file)).size > 1,
    loggerScoped,
    loggerName: cluster.loggerName || '',
  };
}

function locateLogSites(cfg, clusters, opts = {}) {
  const index = loadIndex(cfg, opts);
  const result = new Map();
  const repoRoot = path.resolve(opts.repoRoot || process.cwd());
  for (const cluster of clusters) {
    const hit = locate(cluster, index, repoRoot);
    if (hit) result.set(cluster.errorHash, hit);
  }
  return result;
}

module.exports = { locateLogSites, buildIndex, anchorsOf, extractStatements, cachePath };
