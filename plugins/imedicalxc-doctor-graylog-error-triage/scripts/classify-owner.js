'use strict';
// 归属判定与聚簇：读 collect-errors.js 的 raw json → 五步短路分类 → 按 errorHash 聚簇
// 输入含两类日志：ERROR 报错（kind=error）与耗时超阈值的慢请求（kind=slow），走同一套归属规则
// 每簇附严重度初判：慢请求与不可预知程序异常 = P0，业务正常处理抛出的异常 = P1
// 输出 classified-<HHmm>.json；本组与待定的簇写入 pending-queue.json 供会话侧分析
// 退出码: 0 成功 / 1 输入或落盘失败 / 2 配置不可用

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, resolvePath, pluginPath } = require('./config-env');
const { parseStack, frameSourceSite } = require('./lib/log-parse');
const oi = require('./lib/owner-index');

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

// 业务正常处理抛出的异常有确定信号（实测）：业务拦截器 logger、消息首行「业务异常(...)：」、业务异常类名。
// 命中任一即视为 P1 候选；都不命中按不可预知程序异常处理（P0），宁可误报不可漏报。
const DEFAULT_BUSINESS = {
  loggers: ['com.mediway.his.server.advise.HisBusinessInterceptor'],
  messagePrefixes: ['业务异常('],
  exceptionClasses: ['HisBusinessException', 'BaseBusinessException', 'BusinessException'],
};

// 簇内来源混合时的定级：self 一票否决（本组缺陷不能被多数掩盖），
// 其余按多数；票数相同时按此顺序取舍。
const ORIGIN_PRIORITY = ['self-calls-external', 'infra', 'unknown', 'external'];

// 源码定位：优先日志自带的 source_* 字段（日志语句所在类/文件/行/方法），
// 缺失时退回堆栈最内层业务帧。同一 errorHash 会并簇不同抛点，所以按位置计数取多数。
function itemSourceSite(it, preferredFrame, frameworkPrefixes) {
  const fields = {
    className: String(it.sourceClassName || ''),
    fileName: String(it.sourceFileName || ''),
    lineNumber: String(it.sourceLineNumber || ''),
    methodName: String(it.sourceMethodName || ''),
  };
  if (fields.className || fields.fileName || fields.lineNumber || fields.methodName) {
    return { ...fields, from: 'logfields' };
  }
  const derived = frameSourceSite(it.fullMessage || it.message || '', preferredFrame, frameworkPrefixes);
  return derived ? { ...derived, from: 'frame' } : null;
}

function businessRules(cfg) {
  const s = cfg.severity || {};
  const arr = (v, d) => (Array.isArray(v) ? v.map(String) : d);
  return {
    loggers: arr(s.businessLoggers, DEFAULT_BUSINESS.loggers),
    messagePrefixes: arr(s.businessMessagePrefixes, DEFAULT_BUSINESS.messagePrefixes),
    exceptionClasses: arr(s.businessExceptionClasses, DEFAULT_BUSINESS.exceptionClasses),
  };
}

function isBusinessItem(it, rules) {
  if (it.loggerName && rules.loggers.includes(String(it.loggerName))) return true;
  const firstLine = String(it.message || it.fullMessage || '').split('\n')[0].trim();
  if (rules.messagePrefixes.some((p) => firstLine.startsWith(p))) return true;
  const cls = String(it.exceptionClass || '');
  const simple = cls.slice(cls.lastIndexOf('.') + 1);
  return Boolean(simple) && rules.exceptionClasses.includes(simple);
}

function buildClusters(items, index, cfg) {
  const maxSamples = Number((cfg.classify || {}).maxSamplesPerCluster) || 3;
  const maxSampleChars = Number((cfg.output || {}).maxSampleMessageChars) || 1200;
  const rules = businessRules(cfg);
  const thresholdMs = Number((cfg.query || {}).slowThresholdMs) > 0 ? Number(cfg.query.slowThresholdMs) : 15000;
  const frameworkPrefixes = (cfg.classify || {}).frameworkPrefixes || [];
  const map = new Map();

  for (const it of items) {
    const res = oi.classify(it, index);
    const hash = it.errorHash || `nohash-${it.id}`;
    const kind = it.kind === 'slow' ? 'slow' : 'error';
    let c = map.get(hash);
    if (!c) {
      const stack = kind === 'slow' ? { exceptionClass: '' } : parseStack(it.fullMessage || it.message || '');
      c = {
        errorHash: hash,
        kind,
        exceptionClass: stack.exceptionClass || it.exceptionClass || '',
        innermostFrame: (res.evidence && res.evidence.innermostFrame) || '',
        ownerKind: res.ownerKind,
        ownerGroup: res.ownerGroup,
        ownerModule: res.ownerModule,
        rule: res.rule,
        confidence: res.confidence,
        count: 0,
        businessCount: 0,
        firstSeen: it.timestamp || '',
        lastSeen: it.timestamp || '',
        appNames: [],
        traceIds: [],
        urls: [],
        samples: [],
        owners: {},
        origins: {},
        evidenceLevels: {},
        sourceSites: new Map(),
        interfaceName: it.interfaceName || '',
        interfaceClass: it.interfaceClass || '',
        durationMaxMs: 0,
        durationSumMs: 0,
        slowestTraceId: '',
        slowestTimestamp: '',
      };
      map.set(hash, c);
    }
    c.count += 1;
    if (isBusinessItem(it, rules)) c.businessCount += 1;
    if (kind === 'slow') {
      const ms = Number(it.durationMs) || 0;
      c.durationSumMs += ms;
      if (ms > c.durationMaxMs) {
        c.durationMaxMs = ms;
        c.slowestTraceId = it.traceId || '';
        c.slowestTimestamp = it.timestamp || '';
      }
      if (!c.interfaceName && it.interfaceName) c.interfaceName = it.interfaceName;
      if (!c.interfaceClass && it.interfaceClass) c.interfaceClass = it.interfaceClass;
    }
    if (it.timestamp) {
      if (!c.firstSeen || it.timestamp < c.firstSeen) c.firstSeen = it.timestamp;
      if (!c.lastSeen || it.timestamp > c.lastSeen) c.lastSeen = it.timestamp;
    }
    const ownerKey = `${res.ownerKind}/${res.ownerGroup || res.ownerModule || ''}`;
    c.owners[ownerKey] = (c.owners[ownerKey] || 0) + 1;
    const origin = res.origin || 'unknown';
    c.origins[origin] = (c.origins[origin] || 0) + 1;
    if (res.evidenceLevel) c.evidenceLevels[res.evidenceLevel] = (c.evidenceLevels[res.evidenceLevel] || 0) + 1;
    // 首条 item 未必带帧，后续 item 命中时补填，避免 module-frame 簇在报告里显示「最内层业务帧 -」
    if (!c.innermostFrame) {
      c.innermostFrame = (res.evidence && (res.evidence.innermostFrame || res.evidence.codeFrame)) || '';
    }
    if (it.appName && !c.appNames.includes(it.appName)) c.appNames.push(it.appName);
    if (it.traceId && c.traceIds.length < 10 && !c.traceIds.includes(it.traceId)) c.traceIds.push(it.traceId);
    for (const u of Array.isArray(it.urls) ? it.urls : []) {
      if (c.urls.length < 10 && !c.urls.includes(u)) c.urls.push(u);
    }
    // 慢请求日志由 LogFilter 打印，source_* 指向框架日志点而非业务方法，不采集
    if (kind !== 'slow') {
      const site = itemSourceSite(it, (res.evidence && res.evidence.innermostFrame) || '', frameworkPrefixes);
      if (site) {
        const key = [site.className, site.fileName, site.lineNumber, site.methodName].join('|');
        const cur = c.sourceSites.get(key) || { ...site, count: 0 };
        cur.count += 1;
        c.sourceSites.set(key, cur);
      }
    }
    if (c.samples.length < maxSamples) {
      const sample = {
        id: it.id,
        timestamp: it.timestamp,
        traceId: it.traceId,
        appName: it.appName,
        message: String(it.message || '').slice(0, maxSampleChars),
      };
      if (kind === 'slow') sample.durationMs = Number(it.durationMs) || 0;
      c.samples.push(sample);
    }
  }

  for (const c of map.values()) {
    const ranked = Object.entries(c.owners).sort((a, b) => b[1] - a[1]);
    c.mixed = ranked.length > 1;
    if (c.mixed) {
      const [kind, owner] = ranked[0][0].split('/');
      c.ownerKind = kind;
      // unrelated 同样按组名归类：漏掉这一支会让混合簇的组名变成空串，汇总里显示成「未分组」
      if (kind === 'external' || kind === 'unknown' || kind === 'unrelated') c.ownerGroup = owner;
      else c.ownerModule = owner;
      c.mixedOwners = ranked.map(([k, n]) => ({ owner: k, count: n }));
    }
    // 强证据优先：只要有一条本组堆栈帧，整簇就是 module-frame。
    // 不能用多数——app-only 是「缺证据」，缺证据的多数不能覆盖有证据的少数。
    const lv = c.evidenceLevels || {};
    if (lv['module-frame']) {
      c.evidenceLevel = 'module-frame';
      c.evidenceLevelMixed = Boolean(lv['app-only']);
    } else if (lv['interface-fqcn']) {
      // 慢请求没有堆栈，接口全限定名就是它的强证据，不能被当成「无证据」丢掉
      c.evidenceLevel = 'interface-fqcn';
      c.evidenceLevelMixed = Boolean(lv['app-only']);
    } else {
      c.evidenceLevel = lv['app-only'] ? 'app-only' : '';
    }
    if (Object.keys(lv).length > 0) c.evidenceLevelCounts = { ...lv };
    delete c.evidenceLevels;
    delete c.owners;

    // 来源定级：self 一票否决，其余取多数（票数相同按优先级）。
    // 混合簇必须在报告里带 originCounts，避免把少数跨组条目当成整簇性质。
    const originCounts = c.origins || {};
    const originEntries = Object.entries(originCounts);
    if (originEntries.length > 0) {
      if (originCounts.self) {
        c.origin = 'self';
      } else {
        const max = Math.max(...originEntries.map(([, n]) => n));
        const tied = new Set(originEntries.filter(([, n]) => n === max).map(([o]) => o));
        c.origin = ORIGIN_PRIORITY.find((o) => tied.has(o)) || 'unknown';
      }
      c.originCounts = { ...originCounts };
      c.originMixed = originEntries.length > 1;
    } else {
      c.origin = 'unknown';
    }
    delete c.origins;

    const sites = [...c.sourceSites.values()].sort((a, b) => b.count - a.count);
    delete c.sourceSites;
    if (sites.length > 0) {
      c.source = sites[0];
      c.sourceSites = sites.slice(0, 5);
    }

    if (c.kind === 'slow') {
      c.durationAvgMs = c.count > 0 ? Math.round(c.durationSumMs / c.count) : 0;
      c.severity = 'P0';
      c.severityBasis = `接口耗时超过 ${Math.round(thresholdMs / 1000)}s（最大 ${(c.durationMaxMs / 1000).toFixed(1)}s / ${c.count} 次）`;
    } else if (c.businessCount === c.count) {
      c.severity = 'P1';
      c.severityBasis = '业务正常处理抛出的异常（业务拦截器 / 业务异常类）';
    } else {
      c.severity = 'P0';
      c.severityMixed = c.businessCount > 0;
      c.severityBasis = c.severityMixed
        ? `混合：${c.businessCount}/${c.count} 条为业务异常，其余按不可预知程序异常处理`
        : '不可预知的程序异常（未命中业务异常信号）';
    }
    delete c.businessCount;
    delete c.durationSumMs;
    if (c.kind !== 'slow') {
      delete c.interfaceName;
      delete c.interfaceClass;
      delete c.durationMaxMs;
      delete c.slowestTraceId;
      delete c.slowestTimestamp;
    }
  }

  // P0 先出：报告与队列都按严重度优先，同级内再按次数与最近时间
  return [...map.values()].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'P0' ? -1 : 1;
    if (b.count !== a.count) return b.count - a.count;
    return String(b.lastSeen).localeCompare(String(a.lastSeen));
  });
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

  for (const c of clusters) {
    // 本组自身 / 待定 必入队；本组调用他组的报错簇也入队——分析轮要判定被调方与
    // 原始错误、本组是否只需容错，而不是把根因写进本组代码。他组自身/基础设施/
    // 无关簇只走通知。慢请求的跨组簇由被调方优化，不进本组分析队列。
    const queueable = c.ownerKind === 'self' || c.ownerKind === 'unknown'
      || (c.kind !== 'slow' && (c.origin === 'self-calls-external' || c.origin === 'self'));
    if (!queueable) continue;
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

  const entries = [...byHash.values()]
    .sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)))
    .slice(0, 500);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, 'utf8');
  const crossGroup = entries.filter((e) => e.origin === 'self-calls-external' && (e.status || 'pending') === 'pending').length;
  return { file: rel, added, updated, total: entries.length, crossGroup };
}

function groupClusters(clusters, cfg) {
  const labels = cfg.ownerGroups || {};
  const self = { label: (labels.self || {}).label || '本组', clusters: [] };
  const infra = {
    label: (labels.infra || {}).label || '基础设施',
    clusters: [],
    selfAffected: 0,
    notify: (labels.infra || {}).notify !== false,
  };
  const unknown = { label: ((labels.external || {}).unknownGroupLabel) || '待定', clusters: [] };
  const unrelated = {
    label: ((labels.external || {}).unrelatedLabel) || '无关（他组自身故障）',
    clusters: [],
    groups: [],
    count: 0,
  };
  const unrelatedMap = new Map();
  const externalMap = new Map();
  const externalNotify = (labels.external || {}).notify !== false;
  // 白名单组：configured 组的「本组未参与」簇也要出通知
  const notifyUnrelated = new Set(
    (Array.isArray((labels.external || {}).notifyUnrelated) ? (labels.external || {}).notifyUnrelated : []).map(String),
  );

  for (const c of clusters) {
    if (c.ownerKind === 'self') self.clusters.push(c);
    else if (c.ownerKind === 'infra') infra.clusters.push(c);
    else if (c.ownerKind === 'external') {
      const g = c.ownerGroup || unknown.label;
      if (!externalMap.has(g)) externalMap.set(g, { group: g, notify: externalNotify, count: 0, clusters: [], fromUnrelated: 0 });
      const bucket = externalMap.get(g);
      bucket.clusters.push(c);
      bucket.count += c.count;
    } else if (c.ownerKind === 'unrelated') {
      const g = c.ownerGroup || '未分组';
      if (c.ownerGroup && notifyUnrelated.has(c.ownerGroup)) {
        // 提升到通知桶：从「无关」移出，保证 本组+基础设施+他组+无关+待定 = 总簇数，不重复计数
        if (!externalMap.has(g)) externalMap.set(g, { group: g, notify: externalNotify, count: 0, clusters: [], fromUnrelated: 0 });
        const bucket = externalMap.get(g);
        bucket.clusters.push(c);
        bucket.count += c.count;
        bucket.fromUnrelated += 1;
      } else {
        unrelated.clusters.push(c);
        if (!unrelatedMap.has(g)) unrelatedMap.set(g, { group: g, clusters: 0, count: 0 });
        const b = unrelatedMap.get(g);
        b.clusters += 1;
        b.count += c.count;
      }
    } else unknown.clusters.push(c);
  }

  for (const c of infra.clusters) {
    const ev = null;
    if (c.mixedOwners) c.selfAffected = c.mixedOwners.some((m) => m.owner.startsWith('self/'));
  }
  infra.selfAffected = infra.clusters.filter((c) => c.selfAffected).length;

  const external = [...externalMap.values()].sort((a, b) => b.count - a.count);
  unrelated.groups = [...unrelatedMap.values()].sort((a, b) => b.count - a.count);
  unrelated.count = unrelated.clusters.reduce((s, c) => s + c.count, 0);
  return { self, infra, external, unrelated, unknown };
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

  const items = Array.isArray(payload.items) ? payload.items : [];
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
  console.log(`[OK] 待分析队列: ${pendingInfo.file}（新增 ${pendingInfo.added} / 更新 ${pendingInfo.updated} / 共 ${pendingInfo.total}${pendingInfo.crossGroup > 0 ? ` / 其中本组调用他组 ${pendingInfo.crossGroup}` : ''}）`);
  process.exit(0);
}

module.exports = { buildClusters, mergePendingQueue };

if (require.main === module) main();