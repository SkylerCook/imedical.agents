'use strict';
// 归属判定与聚簇：读 collect-errors.js 的 raw json → 五步短路分类 → 按 errorHash 聚簇
// 输入含两类日志：ERROR 报错（kind=error）与耗时超阈值的慢请求（kind=slow），走同一套归属规则
// 每簇附严重度初判：慢请求与不可预知程序异常 = P0，业务正常处理抛出的异常 = P1
// 输出 classified-<HHmm>.json；本组与待定的簇写入 pending-queue.json 供会话侧分析
// 退出码: 0 成功 / 1 输入或落盘失败 / 2 配置不可用

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, resolvePath, pluginPath } = require('./config-env');
const oi = require('./lib/owner-index');
const {
  ignoreIncludes, isIgnoredItem, buildClusters, groupClusters,
} = require('../../graylog-toolkit/lib/classify');

const BOOLEAN_FLAGS = new Set(['calibrate', 'latest', 'help']);

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

function numArg(value, fallback) {
  if (value === true || value === undefined || value === null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function stateLastRaw(cfg, envId) {
  const file = pluginPath((cfg.state || {}).file || 'config/graylog-triage-state.json');
  if (!fs.existsSync(file)) return '';
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const last = state && state.envs && state.envs[envId] && state.envs[envId].lastRawFile;
    return last && fs.existsSync(last) ? last : '';
  } catch {
    return '';
  }
}

function latestRawFile(cfg, envId) {
  const root = resolvePath(cfg, path.join((cfg.output || {}).dir || 'docs/agent-reports/graylog-triage', envId));
  if (!fs.existsSync(root)) return '';
  const days = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
  for (const day of days) {
    const dir = path.join(root, day);
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    const hits = files.filter((f) => /^raw-errors-\d{4}\.json$/.test(f)).sort().reverse();
    if (hits.length > 0) return path.join(dir, hits[0]);
  }
  return '';
}

function hmFromRawFile(file) {
  const m = path.basename(file).match(/^raw-errors-(\d{4})\.json$/);
  if (m) return m[1];
  const d = new Date();
  return `${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function mergePendingQueue(cfg, clusters, nowIso) {
  const rel = (cfg.analysis || {}).queueFile || 'config/pending-queue.json';
  const file = pluginPath(rel);
  let queue = { version: 1, entries: [] };
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(raw.entries)) queue = { version: raw.version || 1, entries: raw.entries };
    } catch {
      console.warn('[WARN] pending-queue.json 解析失败，重建为空队列');
    }
  }
  const byHash = new Map(queue.entries.map((e) => [e.errorHash, e]));
  let added = 0;
  let updated = 0;
  let pruned = 0;
  const includes = ignoreIncludes(cfg);

  for (const c of clusters) {
    // 本组自身 / 待定 必入队；本组调用他组的报错簇也入队——分析轮要判定被调方与
    // 原始错误、本组是否只需容错，而不是把根因写进本组代码。他组自身/基础设施/
    // 无关簇只走通知。慢请求的跨组簇由被调方优化，不进本组分析队列。
    const queueable = c.ownerKind === 'self' || c.ownerKind === 'unknown'
      || (c.kind !== 'slow' && (c.origin === 'self-calls-external' || c.origin === 'self'));
    if (!queueable) {
      const prev = byHash.get(c.errorHash);
      if (prev && (prev.status || 'pending') === 'analyzed') {
        // 已分析条目保留为历史结论，只同步观测字段，避免丢掉分析轮成果
        prev.count = c.count;
        prev.lastSeen = c.lastSeen;
        prev.ownerKind = c.ownerKind;
        prev.ownerGroup = c.ownerGroup || '';
        prev.ownerModule = c.ownerModule || prev.ownerModule || '';
        prev.origin = c.origin || prev.origin || '';
        continue;
      }
      // pending / blocked 的旧条目在归属改判后直接清理，否则会一直留在待分析队列里
      if (byHash.delete(c.errorHash)) pruned += 1;
      continue;
    }
    const prev = byHash.get(c.errorHash);
    if (prev) {
      prev.count = c.count;
      prev.lastSeen = c.lastSeen;
      prev.ownerKind = c.ownerKind;
      prev.ownerGroup = c.ownerGroup || '';
      prev.ownerModule = c.ownerModule || prev.ownerModule || '';
      prev.origin = c.origin || prev.origin || '';
      prev.kind = c.kind || 'error';
      prev.severity = c.severity || 'P0';
      if (c.disposition) prev.disposition = c.disposition;
      if (c.dispositionBasis) prev.dispositionBasis = c.dispositionBasis;
      prev.dispositionMixed = Boolean(c.dispositionMixed);
      if (c.dispositionCounts) prev.dispositionCounts = c.dispositionCounts;
      else delete prev.dispositionCounts;
      if (c.source) prev.source = c.source;
      if (c.interfaceName) prev.interfaceName = c.interfaceName;
      if (c.durationMaxMs) prev.durationMaxMs = c.durationMaxMs;
      // status / analysis 属于分析轮的结论，采集侧只刷新观测值，不得覆盖
      updated += 1;
      continue;
    }
    const entry = {
      errorHash: c.errorHash,
      ownerKind: c.ownerKind,
      ownerGroup: c.ownerGroup || '',
      ownerModule: c.ownerModule || '',
      origin: c.origin || 'unknown',
      kind: c.kind || 'error',
      severity: c.severity || 'P0',
      ...(c.disposition ? { disposition: c.disposition } : {}),
      ...(c.dispositionBasis ? { dispositionBasis: c.dispositionBasis } : {}),
      ...(c.dispositionMixed ? { dispositionMixed: true, dispositionCounts: c.dispositionCounts } : {}),
      exceptionClass: c.exceptionClass,
      sampleMessage: c.samples[0] ? c.samples[0].message : '',
      ...(c.source ? { source: c.source } : {}),
      count: c.count,
      firstSeen: c.firstSeen,
      lastSeen: c.lastSeen,
      status: 'pending',
      addedAt: nowIso,
    };
    if (c.interfaceName) entry.interfaceName = c.interfaceName;
    if (c.durationMaxMs) entry.durationMaxMs = c.durationMaxMs;
    byHash.set(c.errorHash, entry);
    added += 1;
  }

  // 历史轮次遗留的噪音条目：即使本轮窗口没再命中也要清掉
  if (includes.length > 0) {
    for (const [hash, e] of byHash) {
      if (includes.some((s) => String(e.sampleMessage || '').includes(s))) {
        byHash.delete(hash);
        pruned += 1;
      }
    }
  }

  const entries = [...byHash.values()]
    .sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)))
    .slice(0, 500);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, 'utf8');
  const crossGroup = entries.filter((e) => e.origin === 'self-calls-external' && (e.status || 'pending') === 'pending').length;
  return { file: rel, added, updated, pruned, total: entries.length, crossGroup };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const envId = String(args.env || cfg.defaultEnv || '87');
  const envCfg = (cfg.environments || {})[envId];
  if (!envCfg) {
    console.error(`[ERROR] 未配置环境 ${envId}（见 config/graylog-triage.json 的 environments）`);
    process.exit(2);
  }

  if (args.calibrate) {
    console.log(JSON.stringify(oi.calibrate(cfg), null, 2));
    process.exit(0);
  }

  const index = oi.buildIndex(cfg);
  const summary = oi.summarize(index);
  console.log(`[INFO] 归属索引：前缀 ${summary.prefixes} 个（self ${summary.byKind.self} / infra ${summary.byKind.infra} / external ${summary.byKind.external}），扫描 ${summary.scannedRepos} 仓 ${summary.scanDurationMs}ms`);

  let sourceFile = '';
  if (typeof args.file === 'string') sourceFile = path.resolve(args.file);
  else if (args.latest) sourceFile = latestRawFile(cfg, envId);
  else sourceFile = stateLastRaw(cfg, envId) || latestRawFile(cfg, envId);

  if (!sourceFile || !fs.existsSync(sourceFile)) {
    console.error('[ERROR] 找不到原始采集文件，请先运行 collect-errors.js，或用 --file 指定路径');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  } catch (err) {
    console.error(`[ERROR] 原始文件解析失败: ${sourceFile} ${err.message}`);
    process.exit(1);
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const includes = ignoreIncludes(cfg);
  const items = rawItems.filter((it) => !isIgnoredItem(it, includes));
  const filteredNoise = rawItems.length - items.length;
  if (filteredNoise > 0) console.log(`[INFO] 噪音过滤：${filteredNoise} 条消息命中 filters.ignoreMessageIncludes，不参与分类与巡检结果`);
  const clusters = buildClusters(items, index, cfg);
  const groups = groupClusters(clusters, cfg);
  const minCount = numArg(args['min-count'], 0);
  if (minCount > 0) {
    for (const key of ['self', 'infra', 'unknown', 'unrelated']) {
      groups[key].clusters = groups[key].clusters.filter((c) => c.count >= minCount);
    }
    groups.external = groups.external
      .map((g) => ({
        ...g,
        clusters: g.clusters.filter((c) => c.count >= minCount),
      }))
      .filter((g) => g.clusters.length > 0);
  }

  const nowIso = new Date().toISOString();
  const pendingInfo = mergePendingQueue(cfg, clusters, nowIso);

  const result = {
    runId: payload.runId || '',
    env: envId,
    generatedAt: nowIso,
    sourceFile: path.basename(sourceFile),
    window: payload.window || null,
    queryUsed: payload.queryUsed || '',
    slowQueryUsed: payload.slowQueryUsed || '',
    slow: payload.slow || null,
    calibration: {
      prefixes: summary.prefixes,
      byKind: summary.byKind,
      scannedRepos: summary.scannedRepos,
      ambiguous: summary.ambiguous,
    },
    stats: {
      items: items.length,
      filteredNoise,
      errorItems: items.filter((it) => it.kind !== 'slow').length,
      slowItems: items.filter((it) => it.kind === 'slow').length,
      clusters: clusters.length,
      p0: clusters.filter((c) => c.severity === 'P0').length,
      p1: clusters.filter((c) => c.severity === 'P1').length,
      slowClusters: clusters.filter((c) => c.kind === 'slow').length,
      self: groups.self.clusters.length,
      selfModuleFrame: groups.self.clusters.filter((c) => c.kind !== 'slow' && c.evidenceLevel === 'module-frame').length,
      selfAppOnly: groups.self.clusters.filter((c) => c.kind !== 'slow' && c.evidenceLevel === 'app-only').length,
      selfSlow: groups.self.clusters.filter((c) => c.kind === 'slow').length,
      infra: groups.infra.clusters.length,
      externalGroups: groups.external.length,
      externalClusters: groups.external.reduce((s, g) => s + g.clusters.length, 0),
      unrelated: groups.unrelated.clusters.length,
      unrelatedGroups: groups.unrelated.groups.length,
      unrelatedItems: groups.unrelated.count,
      promotedUnrelated: groups.external.reduce((s, g) => s + (g.fromUnrelated || 0), 0),
      unknown: groups.unknown.clusters.length,
      mixedClusters: clusters.filter((c) => c.mixed).length,
      originSelf: clusters.filter((c) => c.origin === 'self').length,
      originSelfCallsExternal: clusters.filter((c) => c.origin === 'self-calls-external').length,
      originExternal: clusters.filter((c) => c.origin === 'external').length,
      originInfra: clusters.filter((c) => c.origin === 'infra').length,
      originUnknown: clusters.filter((c) => c.origin === 'unknown').length,
      originMixed: clusters.filter((c) => c.originMixed).length,
    },
    pendingQueue: pendingInfo,
    groups,
  };

  const outDir = path.dirname(sourceFile);
  const outFile = path.join(outDir, `classified-${hmFromRawFile(sourceFile)}.json`);
  try {
    fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error(`[FAIL] 落盘失败: ${err.message}`);
    process.exit(1);
  }

  const s = result.stats;
  // 本组拆三档打进单行摘要：只看终端就能分辨「有本组帧」「仅应用名」「慢请求」，避免把 app-only 当强证据
  const selfSplit = s.selfModuleFrame + s.selfAppOnly + s.selfSlow === s.self
    ? `（有本组帧 ${s.selfModuleFrame} / 仅应用名 ${s.selfAppOnly}${s.selfSlow > 0 ? ` / 慢请求 ${s.selfSlow}` : ''}）`
    : '';
  console.log(`[OK] 簇 ${s.clusters} 个 → 本组 ${s.self}${selfSplit} / 基础设施 ${s.infra} / 他组 ${s.externalGroups} 组共 ${s.externalClusters}${s.promotedUnrelated > 0 ? `（含无关提升 ${s.promotedUnrelated}）` : ''} / 无关 ${s.unrelated} / 待定 ${s.unknown}${s.mixedClusters > 0 ? `（跨归属混合 ${s.mixedClusters}）` : ''}`);
  console.log(`[INFO] 严重度初判：P0 ${s.p0} 簇 / P1 ${s.p1} 簇；慢请求 ${s.slowClusters} 簇 ${s.slowItems} 条（报错 ${s.errorItems} 条）`);
  console.log(`[INFO] 来源：本组自身 ${s.originSelf} / 本组调用他组 ${s.originSelfCallsExternal} / 他组自身 ${s.originExternal} / 基础设施 ${s.originInfra} / 待定 ${s.originUnknown}${s.originMixed > 0 ? `（簇内来源混合 ${s.originMixed}）` : ''}`);
  if (s.unrelatedGroups > 0) {
    console.log(`[INFO] 无关簇（他组自身故障，本组未参与，不推送）: ${groups.unrelated.groups.map((g) => `${g.group} ${g.clusters}簇/${g.count}条`).join('，')}`);
  }
  if (s.promotedUnrelated > 0) {
    console.log(`[INFO] notifyUnrelated 提升：${groups.external.filter((g) => g.fromUnrelated > 0).map((g) => `${g.group} ${g.fromUnrelated}簇`).join('，')} 已并入他组通知`);
  }
  if (s.mixedClusters > 0) {
    console.warn(`[WARN] 有 ${s.mixedClusters} 个簇内出现多种归属，已按出现次数取多数，请核对`);
  }
  console.log(`[OK] 分类结果: ${outFile}`);
  console.log(`[OK] 待分析队列: ${pendingInfo.file}（新增 ${pendingInfo.added} / 更新 ${pendingInfo.updated}${pendingInfo.pruned > 0 ? ` / 清理 ${pendingInfo.pruned}` : ''} / 共 ${pendingInfo.total}${pendingInfo.crossGroup > 0 ? ` / 其中本组调用他组 ${pendingInfo.crossGroup}` : ''}）`);
  process.exit(0);
}

module.exports = { buildClusters, mergePendingQueue };

if (require.main === module) main();