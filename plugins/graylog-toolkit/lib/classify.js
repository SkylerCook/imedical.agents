'use strict';
// 归属/处置/严重度规则引擎（配置驱动，不依赖任何插件目录）。
// 输入已落盘的日志条目 + 归属索引，输出按 errorHash 聚合的簇与分组。
// 规则数据全部来自 cfg（severity / disposition / classify / ownerGroups），默认值仅作兜底。

const { parseStack, frameSourceSite } = require('./log-parse');
const oi = require('./owner-index');

// 业务正常处理抛出的异常有确定信号（实测）：业务拦截器 logger、消息首行「业务异常(...)：」、业务异常类名。
// 命中任一即视为 P1 候选；都不命中按不可预知程序异常处理（P0），宁可误报不可漏报。
const DEFAULT_BUSINESS = {
  loggers: ['com.mediway.his.server.advise.HisBusinessInterceptor'],
  messagePrefixes: ['业务异常('],
  exceptionClasses: ['HisBusinessException', 'DocBusinessException', 'BaseBusinessException', 'BusinessException'],
};

// 处置分类回答「这条报错要不要动、动哪里」，与严重度正交：
// - runtime-defect     纯代码健壮性问题（NPE 等），必须给源码位置与改法
// - log-level-review   只有 log.error 文案、无异常类，问题是日志级别是否滥用
// - business-control   手动抛出的业务异常且未命中人工处理信号，前端可提示，不强制改码
// - business-escalation 业务异常包裹外部调用失败，或提示本就是给开发排障的
// 混合簇按此顺序取最高优先级（最需要动作的在前），并保留计数。
const DEFAULT_DISPOSITION = {
  businessExceptionClasses: ['HisBusinessException', 'DocBusinessException', 'BaseBusinessException', 'BusinessException'],
  runtimeExceptionClasses: [
    'NullPointerException', 'IllegalArgumentException', 'IllegalStateException',
    'ClassCastException', 'IndexOutOfBoundsException', 'ArrayIndexOutOfBoundsException',
    'NegativeArraySizeException', 'ArithmeticException', 'NumberFormatException',
    'UnsupportedOperationException', 'ConcurrentModificationException', 'NoSuchElementException',
    'StackOverflowError', 'OutOfMemoryError', 'NoClassDefFoundError', 'ClassNotFoundException',
    'NoSuchMethodError', 'AbstractMethodError',
  ],
  externalCallClasses: [
    'FeignException', 'RetryableException', 'HystrixRuntimeException', 'RestClientException',
    'ResourceAccessException', 'SocketTimeoutException', 'ConnectException', 'TimeoutException',
    'HttpClientErrorException', 'HttpServerErrorException',
  ],
  escalationKeywords: [
    '调用失败', '调用异常', '远程调用', '接口返回', '服务不可用', '熔断', '降级',
    '配置缺失', '未配置', '缺少配置', '请联系开发',
    '线程池', '执行失败',
  ],
};
const DISPOSITION_PRIORITY = ['runtime-defect', 'business-escalation', 'log-level-review', 'business-control'];

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

function dispositionRules(cfg) {
  const d = cfg.disposition || {};
  const arr = (v, def) => (Array.isArray(v) && v.length > 0 ? v.map(String) : def);
  return {
    businessExceptionClasses: arr(d.businessExceptionClasses, DEFAULT_DISPOSITION.businessExceptionClasses),
    runtimeExceptionClasses: arr(d.runtimeExceptionClasses, DEFAULT_DISPOSITION.runtimeExceptionClasses),
    externalCallClasses: arr(d.externalCallClasses, DEFAULT_DISPOSITION.externalCallClasses),
    escalationKeywords: arr(d.escalationKeywords, DEFAULT_DISPOSITION.escalationKeywords),
  };
}

function simpleExceptionName(name) {
  const s = String(name || '');
  return s.slice(s.lastIndexOf('.') + 1);
}

// 逐条初判处置分类。日志里能拿到的证据只有：业务信号（logger/前缀/异常类）、
// 异常类、消息中的外部调用类名与人工处理关键词、有无异常类本身。
function itemDisposition(it, business, disp) {
  if (it.kind === 'slow') return 'slow-perf';
  const text = String(it.fullMessage || it.message || '');
  const cls = simpleExceptionName(it.exceptionClass);
  const hasExternal = disp.externalCallClasses.some((c) => text.includes(c));
  const hasEscalationKeyword = disp.escalationKeywords.some((k) => text.includes(k));
  // 运行时异常类优先于业务信号。HisBusinessInterceptor 等统一日志入口只说明
  // 「日志经过业务拦截器」，不代表 NPE 是可预期的业务控制；曾因此把 NPE 误判为 P1。
  if (cls && disp.runtimeExceptionClasses.includes(cls)) return 'runtime-defect';
  const businessThrown = disp.businessExceptionClasses.includes(cls) || isBusinessItem(it, business);
  if (businessThrown) return (hasExternal || hasEscalationKeyword) ? 'business-escalation' : 'business-control';
  if (hasExternal) return 'business-escalation';
  // 有异常类但不在已知运行时清单：仍属不可预知程序异常，宁可误报不可漏报
  if (cls) return 'runtime-defect';
  return 'log-level-review';
}

// 噪音过滤：配置 filters.ignoreMessageIncludes 命中的消息不采集、不分析、不进巡检结果
function ignoreIncludes(cfg) {
  const list = ((cfg.filters || {}).ignoreMessageIncludes) || [];
  return (Array.isArray(list) ? list : [list]).map(String).filter(Boolean);
}

function isIgnoredItem(it, includes) {
  if (includes.length === 0) return false;
  const text = String(it.fullMessage || it.message || '');
  return includes.some((s) => text.includes(s));
}

function dispositionBasis(c) {
  if (c.kind === 'slow') return '慢请求不做异常分类，走耗时归因';
  // 混合簇的 exceptionClass 只是首条样本的，用它推导依据会得出错误结论（如业务异常类被判「不在业务异常集合」），
  // 所以混合簇直接按分布描述，不用单类归因
  if (c.dispositionMixed && c.dispositionCounts) {
    const dist = Object.entries(c.dispositionCounts).map(([k, n]) => k + '×' + n).join('，');
    return '簇内混合：' + dist + '，按最高优先级取 ' + c.disposition;
  }
  if (c.disposition === 'business-control') {
    return '业务异常信号，未命中外部调用异常或人工处理关键词';
  }
  if (c.disposition === 'business-escalation') {
    return c.businessCount > 0
      ? '业务异常信号，同时命中外部调用异常或人工处理关键词'
      : '外部调用异常（Feign/HTTP/超时等），非业务控制抛出';
  }
  if (c.disposition === 'runtime-defect') {
    return c.exceptionClass
      ? `异常类 ${simpleExceptionName(c.exceptionClass)} 不在业务异常集合，按程序运行时异常处理`
      : '含异常类，按程序运行时异常处理';
  }
  return '无异常类与堆栈的 log.error 消息，需复核日志级别是否滥用';
}

function buildClusters(items, index, cfg) {
  const maxSamples = Number((cfg.classify || {}).maxSamplesPerCluster) || 3;
  const maxSampleChars = Number((cfg.output || {}).maxSampleMessageChars) || 1200;
  const rules = businessRules(cfg);
  const dispRules = dispositionRules(cfg);
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
        dispositions: {},
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
    const disp = itemDisposition(it, rules, dispRules);
    c.dispositions[disp] = (c.dispositions[disp] || 0) + 1;
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

    const dispEntries = Object.entries(c.dispositions || {});
    if (c.kind === 'slow') {
      c.disposition = 'slow-perf';
    } else if (dispEntries.length > 0) {
      if (dispEntries.length === 1) {
        c.disposition = dispEntries[0][0];
      } else {
        c.disposition = DISPOSITION_PRIORITY.find((d) => c.dispositions[d]) || dispEntries[0][0];
        c.dispositionMixed = true;
        c.dispositionCounts = { ...c.dispositions };
      }
    }
    delete c.dispositions;
    c.dispositionBasis = dispositionBasis(c);

    if (c.kind === 'slow') {
      c.durationAvgMs = c.count > 0 ? Math.round(c.durationSumMs / c.count) : 0;
      c.severity = 'P0';
      c.severityBasis = `接口耗时超过 ${Math.round(thresholdMs / 1000)}s（最大 ${(c.durationMaxMs / 1000).toFixed(1)}s / ${c.count} 次）`;
    } else if (c.disposition === 'business-control') {
      // 业务控制不强制改码；混合簇里只要还有需要动作的条目就落到 P0
      c.severity = 'P1';
      c.severityMixed = c.businessCount > 0 && c.businessCount < c.count;
      c.severityBasis = c.severityMixed
        ? `混合：${c.businessCount}/${c.count} 条为业务控制，其余按需干预处理`
        : '业务正常处理抛出（业务控制，前端可提示）';
    } else {
      c.severity = 'P0';
      c.severityMixed = c.businessCount > 0 && c.businessCount < c.count;
      const why = {
        'runtime-defect': '程序运行时异常，需定位并改码',
        'business-escalation': '业务异常包裹外部调用失败或需开发处理，需人工介入',
        'log-level-review': 'log.error 消息，需复核日志级别是否应降级',
      }[c.disposition] || '未命中业务控制信号';
      c.severityBasis = c.severityMixed
        ? `混合：${c.count - c.businessCount}/${c.count} 条需干预（${why}）`
        : why;
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

module.exports = {
  DEFAULT_BUSINESS, DEFAULT_DISPOSITION, DISPOSITION_PRIORITY, ORIGIN_PRIORITY,
  itemSourceSite, businessRules, isBusinessItem, dispositionRules, simpleExceptionName,
  itemDisposition, ignoreIncludes, isIgnoredItem, dispositionBasis, buildClusters, groupClusters,
};
