'use strict';
// 前端界面穿透（启发式）：classified-<HHmm>.json → 为每个簇补 ui.candidates
// 精度说明：只给候选页面，不给按钮/JS 行号；codegraph 索引可用时由 build-front-chains.js 补精度
// 退出码: 0 成功 / 1 输入或落盘失败 / 2 配置不可用

const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT, loadConfig, resolvePath } = require('./config-env');

const BOOLEAN_FLAGS = new Set(['latest', 'check', 'stdout', 'help']);
const GENERIC_TOKENS = new Set([
  'html', 'htm', 'doc', 'opdoc', 'ipdoc', 'new', 'hui', 'show', 'list',
  'common', 'main', 'query', 'browse', 'entry', 'json', 'js',
]);

// Feign 走 <服务名>-server 这类内部主机名，浏览器永远不会发这种请求；
// 区分出来才能在报告里说清"为什么定位不到前端"，而不是含糊地说索引没建。
const INTERNAL_HOST_RE = /^https?:\/\/[a-z][a-z0-9-]*-(?:mediway-)?server(?::\d+)?\//i;

function urlKind(url) {
  const s = String(url || '');
  if (INTERNAL_HOST_RE.test(s)) return 'feign';
  if (/^https?:\/\//i.test(s) || s.startsWith('/')) return 'browser';
  return 'unknown';
}

function classifyClusterUrls(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return 'no-http-request';
  if (urls.some((u) => urlKind(u) === 'browser')) return 'browser-request';
  if (urls.every((u) => urlKind(u) === 'feign')) return 'service-call-only';
  return 'browser-request';
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      args[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (!BOOLEAN_FLAGS.has(body) && next !== undefined && !next.startsWith('--')) {
      args[body] = next;
      i += 1;
    } else {
      args[body] = true;
    }
  }
  return args;
}

function splitCells(line) {
  const parts = line.split('|').map((s) => s.trim());
  if (parts.length > 0 && parts[0] === '') parts.shift();
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function parseCatalog(markdown) {
  const pages = [];
  let section = '';
  for (const rawLine of String(markdown).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('## ') || line.startsWith('### ')) {
      section = line.replace(/^#+\s*/, '');
      continue;
    }
    if (!line.startsWith('|')) continue;
    if (/^\|[\s\-:|]+\|$/.test(line)) continue;
    const cells = splitCells(line);
    if (cells.length < 6) continue;
    if (cells[0] === '名称') continue;
    const [name, menu, type, parent, desc, rawPath] = cells;
    const cleanPath = rawPath.replace(/\[.*$/, '').trim().replace(/\\/g, '/');
    if (!cleanPath || !/\.html?$/i.test(cleanPath)) continue;
    const moduleName = cleanPath.includes('/') ? cleanPath.split('/')[0].toLowerCase() : '';
    pages.push({ name, menu, type, parent, desc, page: cleanPath, module: moduleName, section });
  }
  return pages;
}

function pathTokens(filePath) {
  const base = filePath.split('/').pop().replace(/\.html?$/i, '');
  return base.split(/[._\-]+/).map((t) => t.toLowerCase()).filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t));
}

function urlParts(url) {
  const clean = String(url || '').split('?')[0].split('#')[0].toLowerCase();
  const segs = clean.split('/').filter(Boolean);
  const moduleName = segs.length > 0 ? segs[0] : '';
  const tokens = segs.slice(1).map((s) => s.replace(/[^a-z0-9_]/g, '')).filter((s) => s.length >= 3 && !GENERIC_TOKENS.has(s));
  return { module: moduleName, tokens };
}

function matchUrl(url, pages, maxCandidates) {
  const { module: mod, tokens } = urlParts(url);
  if (!mod) return [];
  const scoped = pages.filter((p) => p.module === mod);
  if (scoped.length === 0) return [];

  const scored = [];
  for (const page of scoped) {
    const pt = pathTokens(page.page);
    const overlap = tokens.filter((t) => pt.some((x) => x.includes(t) || t.includes(x)));
    let score = 30;
    const reason = ['module:' + mod];
    if (overlap.length > 0) {
      score += Math.min(overlap.length * 25, 50);
      reason.push('token:' + overlap.join(','));
    }
    if (page.desc && tokens.some((t) => page.desc.toLowerCase().includes(t))) {
      score += 10;
      reason.push('desc');
    }
    if (page.menu && tokens.some((t) => page.menu.toLowerCase().includes(t))) {
      score += 5;
      reason.push('menu');
    }
    let confidence = 'low';
    if (overlap.length >= 2) confidence = 'medium';
    if (overlap.length >= 2 && page.desc && tokens.some((t) => page.desc.toLowerCase().includes(t))) confidence = 'high';
    scored.push({
      page: page.page,
      name: page.name,
      menu: page.menu,
      type: page.type,
      module: page.module,
      section: page.section,
      score,
      confidence,
      reason: reason.join(' + '),
      url,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.page.localeCompare(b.page));
  const withToken = scored.filter((s) => s.reason.includes('token:'));
  const pool = withToken.length > 0
    ? withToken
    : scoped.filter((p) => p.type === '独立入口').map((p) => ({
        page: p.page, name: p.name, menu: p.menu, type: p.type, module: p.module, section: p.section,
        score: 30, confidence: 'low', reason: 'module-only（该模块独立入口，非精确匹配）', url,
      })).sort((a, b) => a.page.localeCompare(b.page));
  return pool.slice(0, maxCandidates);
}

function latestClassified(cfg, envId) {
  const root = resolvePath(cfg, path.join((cfg.output || {}).dir || 'docs/agent-reports/graylog-triage', envId));
  if (!fs.existsSync(root)) return '';
  const days = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
  for (const day of days) {
    let files = [];
    try { files = fs.readdirSync(path.join(root, day)); } catch { continue; }
    const hits = files.filter((f) => /^classified-\d{4}\.json$/.test(f)).sort().reverse();
    if (hits.length > 0) return path.join(root, day, hits[0]);
  }
  return '';
}

function collectClusters(payload) {
  const out = [];
  const groups = payload.groups || {};
  for (const c of ((groups.self || {}).clusters || [])) out.push(c);
  for (const c of ((groups.unknown || {}).clusters || [])) out.push(c);
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const envId = String(args.env || cfg.defaultEnv || '87');
  if (!(cfg.environments || {})[envId]) {
    console.error('[ERROR] 未配置环境 ' + envId);
    process.exit(2);
  }

  const fe = cfg.frontend || {};
  const catalogFile = typeof args.catalog === 'string'
    ? path.resolve(args.catalog)
    : resolvePath(cfg, fe.pageCatalog || 'src/frontend/README.md');
  const chainDb = resolvePath(cfg, fe.chainDb || 'docs/agents/imedicalxc-doctor-front-codegraph/front_chain_db.json');

  if (!fs.existsSync(catalogFile)) {
    console.error('[ERROR] 页面目录不存在: ' + path.relative(REPO_ROOT, catalogFile));
    process.exit(2);
  }
  const pages = parseCatalog(fs.readFileSync(catalogFile, 'utf8'));
  if (pages.length === 0) {
    console.error('[ERROR] 页面目录解析为 0 条，检查 README 表格格式是否变化');
    process.exit(2);
  }

  const chainDbReady = fs.existsSync(chainDb);
  const effectiveMode = 'heuristic';

  let classifiedFile = '';
  if (typeof args.classified === 'string') classifiedFile = path.resolve(args.classified);
  else classifiedFile = latestClassified(cfg, envId);
  if (!classifiedFile || !fs.existsSync(classifiedFile)) {
    console.error('[ERROR] 找不到分类结果，请先运行 classify-owner.js，或用 --classified 指定');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(classifiedFile, 'utf8'));
  } catch (err) {
    console.error('[ERROR] 分类结果解析失败: ' + err.message);
    process.exit(1);
  }
  if (!payload || !payload.groups) {
    console.error('[ERROR] 分类结果缺少 groups');
    process.exit(1);
  }

  const maxCandidates = Number(args['max-candidates']) > 0 ? Number(args['max-candidates']) : 5;
  const clusters = collectClusters(payload);
  let matched = 0;
  let noUrl = 0;
  const byKind = { 'browser-request': 0, 'service-call-only': 0, 'no-http-request': 0 };

  for (const c of clusters) {
    const urls = Array.isArray(c.urls) ? c.urls : [];
    const kind = classifyClusterUrls(urls);
    byKind[kind] += 1;

    if (kind === 'no-http-request') {
      noUrl += 1;
      continue;
    }
    if (kind === 'service-call-only') {
      c.ui = {
        mode: effectiveMode,
        degradeReason: 'no-frontend-entry',
        urlKind: kind,
        urls,
        candidates: [],
        note: '仅含服务间调用（Feign 内部主机名），浏览器不会发出此类请求，无对应前端页面',
      };
      continue;
    }

    const byPage = new Map();
    for (const url of urls) {
      for (const hit of matchUrl(url, pages, maxCandidates)) {
        const prev = byPage.get(hit.page);
        if (!prev || hit.score > prev.score) byPage.set(hit.page, hit);
      }
    }
    const candidates = [...byPage.values()].sort((a, b) => b.score - a.score || a.page.localeCompare(b.page)).slice(0, maxCandidates);
    if (candidates.length > 0) matched += 1;
    c.ui = {
      mode: effectiveMode,
      degradeReason: chainDbReady ? 'codegraph-index-present-but-codegraph-mode-not-enabled' : 'index-missing',
      urlKind: kind,
      urls,
      candidates,
      note: candidates.length === 0
        ? 'URL 首段不在前端页面清单覆盖范围（可能是外部服务接口或路径未登记）'
        : '',
    };
  }

  const degradeReason = !chainDbReady
    ? 'index-missing'
    : clusters.length === 0
      ? 'no-target-cluster'
      : byKind['browser-request'] === 0
        ? 'no-frontend-entry'
        : 'codegraph-index-present-but-codegraph-mode-not-enabled';

  payload.frontend = {
    effectiveMode,
    requestedMode: fe.mode || 'codegraph',
    degradeReason,
    chainDbReady,
    urlKinds: byKind,
    catalogFile: path.relative(REPO_ROOT, catalogFile).replace(/\\/g, '/'),
    catalogPages: pages.length,
    modules: [...new Set(pages.map((p) => p.module))].filter(Boolean).sort(),
    matchedClusters: matched,
    clustersWithoutUrl: noUrl,
    maxCandidates,
    generatedAt: new Date().toISOString(),
  };

  const summary = {
    mode: effectiveMode,
    degradeReason,
    chainDbReady,
    urlKinds: byKind,
    catalogPages: pages.length,
    modules: payload.frontend.modules.length,
    clusters: clusters.length,
    matched,
    noUrl,
  };

  if (args.check) {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  const outFile = typeof args.out === 'string' ? path.resolve(args.out) : classifiedFile;
  try {
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error('[FAIL] 落盘失败: ' + err.message);
    process.exit(1);
  }

  console.log('[OK] 前端穿透完成（' + effectiveMode + '）：目录 ' + pages.length + ' 页 / ' + payload.frontend.modules.length + ' 模块，命中 ' + matched + ' / ' + clusters.length + ' 簇（无 URL ' + noUrl + '）');
  if (degradeReason === 'index-missing') {
    console.log('[INFO] codegraph 索引未构建，当前为候选页面级别；装 Python 后执行 build-front-chains.js --build 可升级到按钮级');
  } else if (degradeReason === 'no-target-cluster') {
    console.log('[INFO] 本轮无本组（医生站）或待定簇，无需前端定位');
  } else if (degradeReason === 'no-frontend-entry') {
    console.log('[INFO] 本轮 ' + clusters.length + ' 簇均无浏览器发起的请求（' + byKind['service-call-only'] + ' 簇仅服务间调用、' + byKind['no-http-request'] + ' 簇无 HTTP 请求），前端穿透无适用对象');
  } else {
    console.log('[INFO] codegraph 索引已存在但 codegraph 分支尚未实现，当前仍为候选页面级别');
  }
  console.log('[OK] 已写回: ' + path.relative(REPO_ROOT, outFile).replace(/\\/g, '/'));

  if (args.stdout) console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main();