'use strict';
// 归属索引与判定：配置声明 ∪ 工作区真实源码扫描（自校准）
// 仓库为多层 Maven 模块，java 源码位于 <repo>/<模块...>/src/main/java/com/mediway/his/<包>/
// 口径：五步短路；解析不出组名时归 unknown，绝不猜前缀

const fs = require('node:fs');
const path = require('node:path');
const { parseStack, extractUrls } = require('./log-parse');

const SKIP_DIR_NAMES = new Set(['target', 'node_modules', 'logs', 'dist', 'build', 'out', 'bin']);
const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_DIRS = 5000;
// 只保留 Feign/负载均衡的专属特征；Connection refused / Read timed out 是通用网络错误，
// 会把数据库连接失败等误判成"调用外部接口失败"
const FEIGN_HINT_RE = /\b(?:feign\.(?:FeignException|RetryableException)|com\.netflix\.hystrix\.exception\.HystrixRuntimeException|Load balancer does not have available server|No instances available)\b/i;

function toArray(v) { return Array.isArray(v) ? v : []; }
function lower(s) { return String(s || '').toLowerCase(); }

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function moduleFromUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let pathname = raw;
  const schemeIdx = raw.indexOf('://');
  if (schemeIdx >= 0) {
    const rest = raw.slice(schemeIdx + 3);
    const slash = rest.indexOf('/');
    pathname = slash >= 0 ? rest.slice(slash) : '/';
  }
  pathname = pathname.split(/[?#]/)[0];
  const seg = pathname.split('/').filter(Boolean);
  return seg.length ? lower(seg[0]) : '';
}

function collectSrcModules(srcDir, into) {
  const javaRoot = path.join(srcDir, 'main', 'java');
  if (!fs.existsSync(javaRoot)) return;
  const candidates = [
    { base: path.join(javaRoot, 'com', 'mediway', 'his'), prefix: 'com.mediway.his' },
    { base: path.join(javaRoot, 'com', 'mediway'), prefix: 'com.mediway' },
  ];
  for (const { base, prefix } of candidates) {
    if (!fs.existsSync(base)) continue;
    for (const e of safeReaddir(base)) {
      if (!e.isDirectory()) continue;
      const mod = lower(e.name);
      if (prefix === 'com.mediway' && mod === 'his') continue;
      if (!into.has(mod)) into.set(mod, { module: mod, prefix: `${prefix}.${mod}`, samples: [] });
      const rec = into.get(mod);
      if (rec.samples.length < 3) rec.samples.push(path.join(base, e.name));
    }
    if (prefix === 'com.mediway.his') return;
  }
}

function scanJavaModules(repoRoot) {
  const found = new Map();
  const queue = [{ dir: repoRoot, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_SCAN_DIRS) {
    const { dir, depth } = queue.shift();
    visited += 1;
    for (const e of safeReaddir(dir)) {
      if (!e.isDirectory()) continue;
      const abs = path.join(dir, e.name);
      if (e.name === 'src') {
        collectSrcModules(abs, found);
        continue;
      }
      if (e.name.startsWith('.') || SKIP_DIR_NAMES.has(e.name)) continue;
      if (depth + 1 <= MAX_SCAN_DEPTH) queue.push({ dir: abs, depth: depth + 1 });
    }
  }
  return { modules: [...found.values()], visitedDirs: visited };
}

function addPrefix(prefixes, seen, prefix, kind, owner, group) {
  const p = String(prefix || '').trim().replace(/\.$/, '');
  if (!p) return;
  const key = `${p}|${kind}|${owner}`;
  if (seen.has(key)) return;
  seen.add(key);
  prefixes.push({ prefix: p, kind, owner, group: group || '' });
}

function scanRepoList(scan, list, kind, target, observedPrefix, repoRoot) {
  for (const rel of list) {
    const abs = path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
    const exists = fs.existsSync(abs);
    const r = exists ? scanJavaModules(abs) : { modules: [], visitedDirs: 0 };
    scan.repos.push({
      repo: rel, kind, exists, visitedDirs: r.visitedDirs,
      modules: r.modules.map((m) => m.module),
    });
    for (const m of r.modules) {
      target.add(m.module);
      observedPrefix.set(`${kind}:${m.module}`, m.prefix);
    }
  }
}

function buildIndex(cfg, opts = {}) {
  const started = Date.now();
  const repoRoot = path.resolve(opts.repoRoot || process.cwd());
  const self = (cfg.ownerGroups || {}).self || {};
  const infra = (cfg.ownerGroups || {}).infra || {};
  const external = (cfg.ownerGroups || {}).external || {};
  const templ = self.packagePrefixTemplate || 'com.mediway.his.{module}';

  const selfModules = new Set(toArray(self.modules).map(lower));
  const infraModules = new Set(toArray(infra.modules).map(lower));

  const scan = { enabled: false, repos: [], durationMs: 0 };
  const observedSelf = new Set();
  const observedInfra = new Set();
  const observedBoth = new Set();
  const observedPrefix = new Map();

  const shouldScan = opts.scan !== false && (cfg.classify || {}).scanWorkspaceRepos !== false;
  if (shouldScan) {
    scan.enabled = true;
    scanRepoList(scan, toArray(self.repos), 'self', observedSelf, observedPrefix, repoRoot);
    scanRepoList(scan, toArray(infra.repos), 'infra', observedInfra, observedPrefix, repoRoot);
    for (const m of observedSelf) {
      if (observedInfra.has(m)) observedBoth.add(m);
    }
    for (const m of observedBoth) {
      observedSelf.delete(m);
      observedInfra.delete(m);
    }
  }
  scan.durationMs = Date.now() - started;

  const prefixes = [];
  const seen = new Set();

  for (const m of new Set([...selfModules, ...observedSelf])) {
    const observed = observedPrefix.get(`self:${m}`);
    addPrefix(prefixes, seen, observed || templ.replace('{module}', m), 'self', m, '');
  }
  for (const m of new Set([...infraModules, ...observedInfra])) {
    const observed = observedPrefix.get(`infra:${m}`);
    addPrefix(prefixes, seen, observed || `com.mediway.his.${m}`, 'infra', m, '');
  }
  for (const p of toArray(infra.packagePrefixes)) {
    const owner = lower(String(p).split('.').pop());
    addPrefix(prefixes, seen, p, 'infra', owner || 'infra', '');
  }
  // logger 缩写前缀：logback 单行日志没有堆栈帧，按 logger 名兜底归属
  const loggerPrefixes = [];
  const addLoggerPrefix = (prefix, kind, owner, group) => {
    const p = lower(prefix).trim();
    if (!p) return;
    loggerPrefixes.push({ prefix: p, kind, owner: owner || kind, group: group || '' });
  };
  for (const [prefix, owner] of Object.entries(infra.loggerPrefixes || {})) {
    addLoggerPrefix(prefix, 'infra', owner);
  }
  for (const [group, list] of Object.entries(external.loggerPrefixes || {})) {
    for (const p of toArray(list)) addLoggerPrefix(p, 'external', lower(String(p).split('.').pop()), group);
  }
  loggerPrefixes.sort((a, b) => b.prefix.length - a.prefix.length);

  // infra 的 URL 首段：聚合进程代基础设施模块应答时按路径归属
  const infraUrlPrefixes = new Set(toArray(infra.urlPrefixes).map(lower));

  const moduleToGroup = new Map();
  for (const [group, codes] of Object.entries(external.appGroups || {})) {
    for (const code of toArray(codes)) moduleToGroup.set(lower(code), group);
  }
  const externalModules = new Set(moduleToGroup.keys());
  for (const [code, group] of moduleToGroup.entries()) {
    addPrefix(prefixes, seen, `com.mediway.his.${code}`, 'external', code, group);
    addPrefix(prefixes, seen, `com.mediway.${code}`, 'external', code, group);
  }

  // 他组自有包前缀（如 com.mediway.hos.nurm），显式声明避免被 infra 的 com.mediway.hos 吞掉
  for (const [group, list] of Object.entries(external.packagePrefixes || {})) {
    for (const p of toArray(list)) {
      addPrefix(prefixes, seen, p, 'external', lower(String(p).split('.').pop()), group);
    }
  }

  // logger 全限定名归属：his-mediway-server 是聚合进程，会用他组模块的类打日志。
  // 只让「他组包」与 hos 框架包参与；his.server/his.base 等共享包几乎所有应用都在用，
  // 按 logger 判会把本组日志算成基础设施。通用拦截器另行排除（见 genericLoggers）。
  const loggerOwnerInfraPrefixes = toArray((cfg.classify || {}).loggerOwnerInfraPrefixes).map(lower);
  const loggerOwners = prefixes
    .filter((p) => p.kind === 'external'
      || (p.kind === 'infra' && loggerOwnerInfraPrefixes.some((x) => x && (p.prefix === x || p.prefix.startsWith(`${x}.`)))))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const genericLoggers = toArray((cfg.classify || {}).genericLoggers).map(lower);
  const businessPackageRoot = lower((cfg.classify || {}).businessPackageRoot || 'com.mediway');

  // app 名前缀索引：应用名 → 归属。顺序 self > infra > 他组，由匹配长度决定优先级
  const appPrefixes = [];
  const seenApp = new Set();
  const addApp = (raw, kind, owner, group) => {
    const p = lower(raw).trim();
    if (!p) return;
    const key = `${p}|${kind}`;
    if (seenApp.has(key)) return;
    seenApp.add(key);
    appPrefixes.push({ prefix: p, kind, owner: owner || p, group: group || '' });
  };
  for (const a of toArray(self.appPrefixes)) addApp(a, 'self', lower(a), '');
  for (const a of toArray(self.appKeywords)) addApp(a, 'self', lower(a), '');
  for (const m of toArray(self.modules)) addApp(m, 'self', lower(m), '');
  for (const a of toArray(infra.appPrefixes)) addApp(a, 'infra', lower(a), '');
  for (const m of toArray(infra.modules)) addApp(m, 'infra', lower(m), '');
  for (const [code, group] of moduleToGroup.entries()) addApp(code, 'external', code, group);
  appPrefixes.sort((a, b) => b.prefix.length - a.prefix.length);

  prefixes.sort((a, b) => b.prefix.length - a.prefix.length);

  const ambiguous = [...observedBoth].map((m) => ({
    module: m,
    reason: 'self 与 infra 仓库同时出现该包，已排除出双方，归入待定',
  }));

  return {
    prefixes,
    appPrefixes,
    loggerPrefixes,
    loggerOwners,
    genericLoggers,
    businessPackageRoot,
    infraUrlPrefixes,
    selfModules: [...new Set([...selfModules, ...observedSelf])].sort(),
    infraModules: [...new Set([...infraModules, ...observedInfra])].sort(),
    moduleToGroup,
    externalModules,
    appKeywords: toArray(self.appKeywords).map(lower),
    frameworkPrefixes: toArray((cfg.classify || {}).frameworkPrefixes),
    feignExceptionTypes: toArray(cfg.feignExceptionTypes),
    appNameRule: (cfg.classify || {}).appNameRule !== false,
    unrelatedLabel: external.unrelatedLabel || '无关（他组自身故障）',
    unknownGroupLabel: external.unknownGroupLabel || '待定',
    ambiguous,
    observedPrefix,
    scan,
  };
}

function isFramework(cls, index) {
  return index.frameworkPrefixes.some((p) => cls.startsWith(p));
}

function ownerFromClass(cls, index) {
  const name = String(cls || '');
  if (!name) return null;
  for (const p of index.prefixes) {
    if (name === p.prefix || name.startsWith(`${p.prefix}.`)) return p;
  }
  return null;
}

function innermostBusinessFrame(frames, index) {
  for (const fr of frames) {
    if (isFramework(fr.cls, index)) continue;
    return fr;
  }
  return null;
}

// 从堆栈最内层向外找第一个「能解析出归属」的帧。
// 旧实现只看第一个非框架帧，遇到 com.mediway.hos.* 这类未登记包就整簇放弃，
// 导致后面的 com.mediway.his.opcare 帧被忽略。
function firstOwnedFrame(frames, index) {
  let firstBusiness = null;
  for (const fr of frames) {
    if (isFramework(fr.cls, index)) continue;
    if (!firstBusiness) firstBusiness = fr;
    const owner = ownerFromClass(fr.cls, index);
    if (owner) return { frame: fr, owner, firstBusiness };
  }
  return { frame: null, owner: null, firstBusiness };
}

// 应用名匹配：appName 精确等于前缀，或以「前缀-」开头，避免 'ma' 误命中 'mdm'
function ownerFromAppName(appName, index) {
  const name = lower(appName).trim();
  if (!name || !index.appNameRule) return null;
  for (const p of index.appPrefixes) {
    if (name === p.prefix || name.startsWith(`${p.prefix}-`)) return p;
  }
  return null;
}

// logger 名是「打印这条日志的类」，比进程应用名更贴近责任主体：
// 聚合进程 his-mediway-server 会代他组模块（comnur / ph.pha / hos）打日志，
// 按 app 名判会把这些日志误算成本组。genericLoggers 是几乎所有业务共用的拦截器，不参与归属。
function ownerFromLoggerName(loggerName, index) {
  const name = lower(loggerName).trim();
  if (!name) return null;
  if (index.genericLoggers.some((g) => g && (name === g || name.startsWith(`${g}.`)))) return null;
  for (const p of index.loggerOwners) {
    if (name === lower(p.prefix) || name.startsWith(`${lower(p.prefix)}.`)) {
      return { prefix: p.prefix, kind: p.kind, owner: p.owner, group: p.group, logger: loggerName };
    }
  }
  return null;
}

// logback 单行格式：... [thread] ERROR c.m.h.h.b.i.s.i.SomeClass - message
// 缩写 logger 只登记了基础设施前缀（c.m.h.h.b. 等），无 raw logger_name 时用它兜底
function ownerFromLogger(text, index) {
  const m = /\b(?:ERROR|WARN)\s+([a-zA-Z][\w]*(?:\.[\w]+)+)\s+-\s/.exec(text);
  if (!m) return null;
  const loggerName = m[1];
  const full = ownerFromLoggerName(loggerName, index);
  if (full) return full;
  for (const p of index.loggerPrefixes) {
    if (loggerName === p.prefix.replace(/\.$/, '') || loggerName.startsWith(p.prefix)) {
      return { ...p, logger: loggerName };
    }
  }
  return null;
}

function groupOfModule(mod, index) {
  const code = lower(mod);
  if (!code) return '';
  const direct = index.moduleToGroup.get(code);
  if (direct) return direct;
  // URL 首段常带后缀（ipnur-station），按配置的模块码前缀兜底
  for (const [k, g] of index.moduleToGroup.entries()) {
    if (code.startsWith(`${k}-`) || code.startsWith(`${k}_`)) return g;
  }
  return '';
}

function isSelfApp(appName, index) {
  const name = lower(appName);
  if (!name) return false;
  return index.appKeywords.some((k) => name === k || name.startsWith(`${k}-`) || name.includes(k));
}

function firstExternalGroup(urls, index) {
  for (const url of toArray(urls)) {
    const mod = moduleFromUrl(url);
    const group = groupOfModule(mod, index);
    if (group) return { group, module: mod, url };
  }
  return null;
}

// 来源（origin）回答「异常源自哪一侧」，与 ownerKind（谁该处理）正交：
//   self                 本组代码/配置/数据自身产生
//   self-calls-external  本组进程发起调用的他组接口/方法失败（责任在被调方，本组需容错并转通知）
//   external             他组自身故障，本组未参与
//   infra                基础设施组件
//   unknown              证据不足
// 判据只看规则与 selfAffected（trace 中本组应用是否参与），不看 ownerKind 单一字段——
// self-app-external-frame / feign-* 的责任在他组，但异常是本组调用链上产生的。
const SELF_CALL_RULES = new Set(['self-app-external-frame', 'feign-exception', 'feign-unresolved']);
const SELF_AFFECTED_EXTERNAL_RULES = new Set(['slow-interface-fqcn', 'trace-peer', 'external-frame']);

function originOf(ownerKind, rule, evidence) {
  if (ownerKind === 'self') return 'self';
  if (ownerKind === 'infra') return 'infra';
  if (ownerKind === 'unrelated') return 'external';
  if (SELF_CALL_RULES.has(rule)) return 'self-calls-external';
  const selfAffected = Boolean(evidence && evidence.selfAffected);
  if (ownerKind === 'external') {
    return selfAffected && SELF_AFFECTED_EXTERNAL_RULES.has(rule) ? 'self-calls-external' : 'external';
  }
  return selfAffected ? 'self-calls-external' : 'unknown';
}

function makeResult(ownerKind, rule, extra = {}) {
  const evidence = extra.evidence || {};
  return {
    ownerKind,
    ownerGroup: extra.ownerGroup || '',
    ownerModule: extra.ownerModule || '',
    rule,
    origin: originOf(ownerKind, rule, evidence),
    confidence: extra.confidence || 'medium',
    // 本组专用证据等级：module-frame = 堆栈命中本组包；app-only = 只有应用名。
    // his-mediway-server 是聚合进程，它打的日志不能证明是本组代码抛的。
    evidenceLevel: extra.evidenceLevel || '',
    evidence: extra.evidence || {},
  };
}

function classify(item, index) {
  const text = String(item.fullMessage || item.message || '');
  const urls = toArray(item.urls).length > 0 ? item.urls : extractUrls(text);
  const { exceptionClass, frames } = parseStack(text);
  const peers = toArray(item.tracePeers);

  const externalPeers = peers.filter((p) => p && p.hasError && p.appName && !isSelfApp(p.appName, index));
  const selfPeers = peers.filter((p) => p && isSelfApp(p.appName, index));
  const selfAffected = selfPeers.length > 0;
  // 「条目自身 app 名」是他的直接证据，但没有本组帧时才能定他的责：
  // 他组进程打印、异常却抛在本组代码帧上的，责任仍在本组（与第 5 节 logger 同款守卫）。
  const hasSelfCodeFrame = frames.some((fr) => {
    const o = ownerFromClass(fr.cls, index);
    return o && o.kind === 'self';
  });
  const fromUrl = firstExternalGroup(urls, index);

  // 慢请求日志没有堆栈帧，接口全限定名就是「哪段代码在跑」的直接证据，比打印进程 app_name 更准：
  // his-mediway-server 是聚合进程，会代他组模块应答，按 app 名判会把他组接口的慢调用算成本组。
  if (item.kind === 'slow' && item.interfaceClass) {
    const ifaceOwner = ownerFromClass(item.interfaceClass, index);
    if (ifaceOwner) {
      const appOwner = ownerFromAppName(item.appName || item.source, index);
      const evidence = {
        interfaceName: item.interfaceName || '',
        durationMs: Number(item.durationMs) || 0,
        appName: item.appName || '',
        ownerPrefix: ifaceOwner.prefix,
        reason: '慢请求日志无堆栈帧，按接口全限定名的包前缀归属',
      };
      if (ifaceOwner.kind === 'external') {
        const forwarded = !appOwner || appOwner.kind === 'self' || appOwner.kind === 'infra';
        return makeResult(forwarded ? 'external' : 'unrelated', 'slow-interface-fqcn', {
          ownerGroup: ifaceOwner.group,
          ownerModule: ifaceOwner.owner,
          confidence: 'high',
          evidence: {
            ...evidence,
            selfAffected: forwarded,
            reason: forwarded
              ? '本组/基础设施进程上应答的是他组接口，按接口包前缀归该组'
              : '该慢请求由他组应用自身打印，本组未参与',
          },
        });
      }
      return makeResult(ifaceOwner.kind, 'slow-interface-fqcn', {
        ownerModule: ifaceOwner.owner,
        confidence: 'high',
        evidenceLevel: ifaceOwner.kind === 'self' ? 'interface-fqcn' : '',
        evidence,
      });
    }
  }

  if (externalPeers.length > 0) {
    // 本条日志自身就是他组 app 打印的：appName 已能定组，不必依赖 URL。
    // trace 里有本组参与也不改判：报错发生在对方进程内，修的也是对方；
    // 只有堆栈里出现本组代码帧（责任确在本组）时才降回车人工。
    const peerAppOwner = ownerFromAppName(item.appName || item.source, index);
    if (peerAppOwner && peerAppOwner.kind === 'external' && !hasSelfCodeFrame) {
      return makeResult('unrelated', 'trace-peer-app-name', {
        ownerGroup: peerAppOwner.group,
        ownerModule: peerAppOwner.owner,
        confidence: 'medium',
        evidence: {
          appName: item.appName || '',
          externalPeers: externalPeers.map((p) => p.appName),
          exceptionClass,
          selfAffected,
          urlModule: fromUrl ? fromUrl.module : '',
          reason: '本条日志由他组应用自身打印，堆栈无本组代码帧，按 app 名归该组（trace 含本组不改变归属）',
        },
      });
    }

    if (fromUrl) {
      return makeResult('external', 'trace-peer', {
        ownerGroup: fromUrl.group, ownerModule: fromUrl.module, confidence: 'high',
        evidence: { externalPeers: externalPeers.map((p) => p.appName), urlModule: fromUrl.module, selfAffected },
      });
    }

    return makeResult('unknown', 'trace-peer-unresolved', {
      confidence: 'low',
      evidence: {
        externalPeers: externalPeers.map((p) => p.appName), exceptionClass,
        reason: '已判定为他组 app 自身报错，但无法解析所属产品组，未发送通知',
        selfAffected,
      },
    });
  }

  const feignHit = FEIGN_HINT_RE.test(text)
    || index.feignExceptionTypes.some((t) => exceptionClass === t || exceptionClass.startsWith(`${t}$`));
  if (feignHit) {
    // 外部组自己调外部组失败：appName 已能定组，堆栈无本组帧时按无关计
    const feignCallerOwner = ownerFromAppName(item.appName || item.source, index);
    if (feignCallerOwner && feignCallerOwner.kind === 'external' && !hasSelfCodeFrame) {
      return makeResult('unrelated', 'feign-app-name', {
        ownerGroup: feignCallerOwner.group,
        ownerModule: feignCallerOwner.owner,
        confidence: 'medium',
        evidence: {
          appName: item.appName || '',
          exceptionClass,
          urlModule: fromUrl ? fromUrl.module : '',
          selfAffected,
          reason: '本条日志由他组应用自身打印，堆栈无本组代码帧，按 app 名归该组（trace 含本组不改变归属）',
        },
      });
    }
    if (fromUrl) {
      return makeResult('external', 'feign-exception', {
        ownerGroup: fromUrl.group, ownerModule: fromUrl.module, confidence: 'high',
        evidence: { exceptionClass, urlModule: fromUrl.module, selfAffected: true },
      });
    }
    return makeResult('unknown', 'feign-unresolved', {
      confidence: 'low',
      evidence: { exceptionClass, reason: '调用外部接口失败，但 URL 无法解析出产品组', selfAffected: true },
    });
  }

  const scan = firstOwnedFrame(frames, index);
  const innermost = scan.firstBusiness || innermostBusinessFrame(frames, index);
  const frameText = scan.frame ? `${scan.frame.cls}.${scan.frame.method}` : '';
  const appOwner = ownerFromAppName(item.appName || item.source, index);
  // raw 字段 logger_name 是完整 FQCN，优先于从正文解析出的缩写名
  const loggerOwner = ownerFromLoggerName(item.loggerName, index) || ownerFromLogger(text, index);
  const infraUrlModule = toArray(urls).map(moduleFromUrl)
    .find((m) => m && index.infraUrlPrefixes.has(m)) || '';

  // 应用名优先：它回答"谁在报错"；堆栈帧只回答"哪段代码抛的"。
  // 共享基础包（com.mediway.hos / his.server / his.base / hisbasesv）几乎出现在
  // 所有应用的堆栈里，若以帧优先，全环境的框架层异常都会被算成本组或基础设施。
  if (appOwner) {
    const evidence = {
      appName: item.appName || '',
      exceptionClass,
      codeFrame: frameText,
      codeFrameOwner: scan.owner ? `${scan.owner.kind}/${scan.owner.owner}` : '',
    };

    if (appOwner.kind === 'self') {
      const hasSelfFrame = Boolean(scan.owner && scan.owner.kind === 'self');
      // 本组堆栈帧优先于 logger：他组代码调用本组接口时用他组 logger 打印，
      // 但异常抛在本组 frame 上（如计费核查医嘱缺少执行记录 → comoe NPE），责任仍在本组。
      if (loggerOwner && !hasSelfFrame) {
        return makeResult(loggerOwner.kind, 'logger-name', {
          ownerGroup: loggerOwner.group || '',
          ownerModule: loggerOwner.owner, confidence: 'high',
          evidence: {
            appName: item.appName || '', exceptionClass, logger: loggerOwner.logger,
            ownerPrefix: loggerOwner.prefix,
            reason: '聚合进程会代他组模块打日志，按 logger 全限定名归属（打印该日志的类）',
          },
        });
      }
      if (!scan.owner && infraUrlModule) {
        return makeResult('infra', 'self-app-infra-url', {
          ownerModule: infraUrlModule, confidence: 'medium',
          evidence: {
            ...evidence, urlModule: infraUrlModule,
            reason: '本组聚合进程上转发的是基础设施模块路径，按 URL 首段归属',
          },
        });
      }
      if (scan.owner && scan.owner.kind === 'infra') {
        return makeResult('infra', 'self-app-infra-frame', {
          ownerModule: scan.owner.owner, confidence: 'high',
          evidence: { ...evidence, innermostFrame: frameText, ownerPrefix: scan.owner.prefix },
        });
      }
      if (scan.owner && scan.owner.kind === 'external') {
        return makeResult('external', 'self-app-external-frame', {
          ownerGroup: scan.owner.group, ownerModule: scan.owner.owner, confidence: 'high',
          evidence: { ...evidence, innermostFrame: frameText, selfAffected: true },
        });
      }
      // his-mediway-server 是聚合进程，会代他组模块应答请求；
      // 路径指向他组模块时归该组，不记为本组
      if (!scan.owner && fromUrl) {
        return makeResult('unrelated', 'self-app-url-module', {
          ownerGroup: fromUrl.group,
          ownerModule: fromUrl.module,
          confidence: 'medium',
          evidence: {
            ...evidence,
            urlModule: fromUrl.module,
            url: fromUrl.url,
            reason: '本组进程上转发的是他组模块的请求，按路径归该组',
          },
        });
      }
      // 应用名只是聚合进程 + 最内层业务帧落在 com.mediway 下却未登记任何归属：
      // 说明这段代码属于尚未接入归属表的产品（如 opspcol），不能按「只有应用名」算本组。
      const unregisteredFrame = !hasSelfFrame && innermost
        && lower(innermost.cls).startsWith(`${index.businessPackageRoot}.`);
      if (unregisteredFrame) {
        return makeResult('unknown', 'unregistered-business-frame', {
          confidence: 'low',
          evidence: {
            ...evidence,
            innermostFrame: `${innermost.cls}.${innermost.method}`,
            reason: '应用名为聚合进程，最内层业务帧未登记任何归属，无法判定责任组',
          },
        });
      }
      return makeResult('self', 'app-name', {
        ownerModule: hasSelfFrame ? scan.owner.owner : appOwner.owner,
        confidence: hasSelfFrame ? 'high' : 'low',
        evidenceLevel: hasSelfFrame ? 'module-frame' : 'app-only',
        evidence: { ...evidence, selfFrame: hasSelfFrame ? frameText : '' },
      });
    }

    if (appOwner.kind === 'infra') {
      return makeResult('infra', 'app-name', { ownerModule: appOwner.owner, confidence: 'medium', evidence });
    }

    return makeResult('unrelated', 'app-self-error', {
      ownerGroup: appOwner.group,
      ownerModule: appOwner.owner,
      confidence: 'medium',
      evidence: {
        ...evidence,
        crossSelfFrame: scan.owner && scan.owner.kind === 'self' ? frameText : '',
        reason: '该日志由他组应用自身打印，本组未参与',
      },
    });
  }

  // 应用名无法识别时，logger 名仍是「谁在打日志」的直接证据（本组堆栈帧同样优先）
  if (loggerOwner && !(scan.owner && scan.owner.kind === 'self')) {
    return makeResult(loggerOwner.kind, 'logger-name', {
      ownerGroup: loggerOwner.group || '',
      ownerModule: loggerOwner.owner, confidence: 'high',
      evidence: {
        appName: item.appName || '', exceptionClass, logger: loggerOwner.logger,
        ownerPrefix: loggerOwner.prefix, selfAffected,
        reason: '按 logger 全限定名归属（打印该日志的类）',
      },
    });
  }

  // 应用名无法识别时，才退回堆栈帧
  if (scan.owner) {
    const owner = scan.owner;
    if (owner.kind === 'external') {
      return makeResult('external', 'external-frame', {
        ownerGroup: owner.group, ownerModule: owner.owner, confidence: 'medium',
        evidence: { innermostFrame: frameText, selfAffected },
      });
    }
    if (owner.kind === 'self') {
      return makeResult('self', 'business-frame', {
        ownerModule: owner.owner, confidence: 'medium',
        evidenceLevel: 'module-frame',
        evidence: { innermostFrame: frameText, ownerPrefix: owner.prefix },
      });
    }
    return makeResult('infra', 'business-frame', {
      ownerModule: owner.owner, confidence: 'medium',
      evidence: { innermostFrame: frameText, ownerPrefix: owner.prefix, selfAffected },
    });
  }

  return makeResult('unknown', 'undecided', {
    confidence: 'low',
    evidence: {
      exceptionClass,
      innermostFrame: innermost ? `${innermost.cls}.${innermost.method}` : '',
      appName: item.appName || '',
      urls,
      reason: innermost ? '最内层业务帧不在已登记归属内' : '无业务堆栈帧',
    },
  });
}

function calibrate(cfg, opts = {}) {
  const index = buildIndex(cfg, { scan: true, repoRoot: opts.repoRoot });
  const declaredSelf = new Set(toArray(((cfg.ownerGroups || {}).self || {}).modules).map(lower));
  const declaredInfra = new Set(toArray(((cfg.ownerGroups || {}).infra || {}).modules).map(lower));
  const observedSelf = new Set();
  const observedInfra = new Set();
  for (const r of index.scan.repos) {
    for (const m of r.modules) {
      if (r.kind === 'self') observedSelf.add(m);
      else observedInfra.add(m);
    }
  }
  const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();
  const prefixMap = (kind) => {
    const out = {};
    for (const [k, v] of index.observedPrefix.entries()) {
      const idx = k.indexOf(':');
      if (k.slice(0, idx) === kind) out[k.slice(idx + 1)] = v;
    }
    return out;
  };
  return {
    repos: index.scan.repos,
    visitedDirs: index.scan.repos.reduce((s, r) => s + (r.visitedDirs || 0), 0),
    durationMs: index.scan.durationMs,
    prefixCount: index.prefixes.length,
    observedPrefixes: { self: prefixMap('self'), infra: prefixMap('infra') },
    declaredSelfMissing: diff(declaredSelf, observedSelf),
    observedSelfUndeclared: diff(observedSelf, declaredSelf),
    declaredInfraMissing: diff(declaredInfra, observedInfra),
    observedInfraUndeclared: diff(observedInfra, declaredInfra),
    ambiguous: index.ambiguous,
  };
}

function summarize(index) {
  const byKind = { self: 0, infra: 0, external: 0 };
  for (const p of index.prefixes) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  return {
    prefixes: index.prefixes.length,
    appPrefixes: index.appPrefixes.length,
    byKind,
    selfModules: index.selfModules.length,
    infraModules: index.infraModules.length,
    externalModules: index.externalModules.size,
    ambiguous: index.ambiguous.length,
    scannedRepos: index.scan.repos.length,
    scanDurationMs: index.scan.durationMs,
  };
}

module.exports = {
  buildIndex, classify, calibrate, summarize,
  moduleFromUrl, ownerFromClass, innermostBusinessFrame, firstOwnedFrame, ownerFromAppName,
  ownerFromLoggerName, ownerFromLogger, isSelfApp, scanJavaModules,
};