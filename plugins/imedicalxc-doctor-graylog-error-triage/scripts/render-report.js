'use strict';
// 报告渲染：读 classified-<HHmm>.json → 总览 / 本组 / 基础设施 / 他组通知 Markdown
// 根因与修正方案不在脚本内生成，从 pending-queue.json 的 analysis 字段注入
// 退出码: 0 成功 / 1 输入非法或落盘失败 / 2 配置不可用

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, resolvePath, pluginPath } = require('./config-env');

const BOOLEAN_FLAGS = new Set(['latest', 'check', 'stdout', 'help']);
const SAFE_NAME_RE = /[\\/:*?"<>|\s]+/g;
// markdown 代码围栏用字符码构造：字面量三反引号在多层代码嵌套里容易被吞掉
const FENCE = String.fromCharCode(96, 96, 96);

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

function safeName(s) {
  return String(s || '未分组').replace(SAFE_NAME_RE, '_').slice(0, 40);
}

const SECRET_PATTERNS = [
  [/(\b(?:token|password|passwd|pwd|secret|authorization|ticket|cookie|access_token|refresh_token)\s*[=:]\s*)("[^"]*"|[^\s,&;)"']+)/gi, '$1***'],
  // 日志里的中文表述：「token 为：xxx」「token信息为：xxx」「传入token：xxx」
  [/((?:token|密码|口令)\s*(?:信息)?\s*(?:为|是)?\s*[：:]\s*)[A-Za-z0-9_\-+/=.]{16,}/gi, '$1***'],
  // URL 编码的凭据字段，如 %22password%22%3A%22xxx
  [/(%22(?:password|token|access_token|refresh_token|secret)%22%3A%22)[^%"]{8,}/gi, '$1***'],
  [/Basic\s+[A-Za-z0-9+/=]{8,}/g, 'Basic ***'],
  [/(https?:\/\/)[^\s/@]+@/g, '$1***@'],
  [/(https?:\/\/)\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/gi, '$1<host>'],
  // 裸 IP（无 scheme）：堆栈里的 Connection refused: 10.x.x.x、正文里的回调地址都属此类。
  // 校验闸门要求正文不得出现 IP，清洗就必须覆盖同一范围，否则会变成「必然被拦、且永远修不好」的死局。
  // 只认四段且每段 1-3 位，三段版本号不会被误伤。
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<host>'],
];

function redact(text, extra) {
  let out = String(text === undefined || text === null ? '' : text);
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  for (const raw of Array.isArray(extra) ? extra : []) {
    try {
      out = out.replace(new RegExp(raw, 'g'), '***');
    } catch {
      console.warn('[WARN] redactPatterns 中存在非法正则，已跳过: ' + raw);
    }
  }
  return out;
}

function stackExcerpt(raw, maxLines) {
  const text = String((raw && (raw.fullMessage || raw.message)) || '');
  const all = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
  if (all.length <= maxLines) return { lines: all, kept: all.length, truncated: false, total: all.length };

  const keep = new Set();
  const take = (idx) => {
    if (idx < 0 || idx >= all.length) return;
    if (keep.size >= maxLines) return;
    keep.add(idx);
  };

  // 1) 头部两行：时间戳与异常声明
  for (let i = 0; i < Math.min(2, all.length); i += 1) take(i);

  // 2) 根因链优先。Caused by 决定这是环境问题还是服务故障，
  //    转发给他组时定性全靠它，不能被中间层的 at 帧按顺序挤掉
  for (let i = 0; i < all.length; i += 1) {
    if (/^Caused by:/.test(all[i])) take(i);
  }

  // 3) 本组业务帧：说明是哪个业务方法发起的这次调用
  const bizIdx = all.findIndex((l) => /^\s*at\s+com\.mediway\./.test(l));
  if (bizIdx >= 0) take(bizIdx);

  // 4) 剩余配额按原顺序补堆栈行
  for (let i = 0; i < all.length && keep.size < maxLines; i += 1) {
    if (/^\s*at\s|^\s*\.\.\.\s\d+\smore/.test(all[i])) take(i);
  }
  // 5) 仍有余量时补齐非堆栈行（多行异常描述等）
  for (let i = 0; i < all.length && keep.size < maxLines; i += 1) take(i);

  // 按原始顺序输出，跨过被丢弃的区段时插入省略标记
  const picked = [...keep].sort((a, b) => a - b);
  const lines = [];
  for (let k = 0; k < picked.length; k += 1) {
    if (k > 0 && picked[k] !== picked[k - 1] + 1) lines.push('\t...');
    lines.push(all[picked[k]]);
  }
  return { lines, kept: picked.length, truncated: true, total: all.length };
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

function loadQueue(cfg) {
  const file = pluginPath((cfg.analysis || {}).queueFile || 'config/pending-queue.json');
  if (!fs.existsSync(file)) return new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entries = Array.isArray(raw.entries) ? raw.entries : [];
    return new Map(entries.map((e) => [e.errorHash, e]));
  } catch {
    console.warn('[WARN] pending-queue.json 解析失败，按空队列处理');
    return new Map();
  }
}

function loadRawItems(classifiedFile, payload) {
  const hm = (path.basename(classifiedFile).match(/^classified-(\d{4})\.json$/) || [])[1];
  const candidates = [];
  if (payload && payload.sourceFile) candidates.push(path.join(path.dirname(classifiedFile), payload.sourceFile));
  if (hm) candidates.push(path.join(path.dirname(classifiedFile), 'raw-errors-' + hm + '.json'));
  for (const file of candidates) {
    if (!file || !fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const map = new Map();
      for (const it of Array.isArray(raw.items) ? raw.items : []) map.set(it.id, it);
      return map;
    } catch {
      // 换下一个候选
    }
  }
  return new Map();
}

function validateInput(payload) {
  const problems = [];
  if (!payload || typeof payload !== 'object') {
    problems.push('分类结果不是对象');
    return problems;
  }
  if (!payload.groups || typeof payload.groups !== 'object') problems.push('缺少 groups');
  if (!payload.stats || typeof payload.stats !== 'object') problems.push('缺少 stats');
  if (payload.groups && !payload.groups.self) problems.push('缺少 groups.self');
  return problems;
}

function validateOutput(name, md) {
  if (!/^# \S/m.test(md)) return name + ': 缺少一级标题';
  if (md.includes('authentication=')) return name + ': 残留 Cookie 凭据';
  if (/Authorization:\s*Basic\s+(?!\*\*\*)/.test(md)) return name + ': 残留 Basic 凭据';
  if (/(?:token|密码)\s*(?:信息)?\s*(?:为|是)?\s*[：:]\s*(?!\*\*\*)[A-Za-z0-9_\-+/=.]{16,}/i.test(md)) return name + ': 残留 token 明文';
  if (/%22(?:password|token)%22%3A%22(?!\*\*\*)/i.test(md)) return name + ': 残留 URL 编码凭据';
  if (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(md)) return name + ': 残留 IP 地址';
  return '';
}

// 只清理「状态快照」型产物：notify 与 infra 报告过期后会让读者以为问题仍在；
// report-self / report-summary 是历史轨迹，不在此列
const STALE_SNAPSHOT_RE = /^(?:notify|report-infra)-.*\.md$/i;

function pruneStale(outDir, keepNames, currentHm) {
  const keep = new Set(keepNames);
  let entries = [];
  try { entries = fs.readdirSync(outDir); } catch { return 0; }
  let removed = 0;
  for (const name of entries) {
    if (keep.has(name)) continue;
    if (!STALE_SNAPSHOT_RE.test(name)) continue;
    // 手工回放旧轮次时不得删除更新的快照：只清理轮次 <= 当前轮次
    const m = name.match(/-(\d{4})\.md$/);
    if (m && currentHm && m[1] > currentHm) continue;
    try {
      fs.unlinkSync(path.join(outDir, name));
      removed += 1;
    } catch { /* 单个文件失败不影响渲染结果 */ }
  }
  return removed;
}

// 报告给本地读者看，统一显示 Asia/Shanghai（UTC+8）。中国无夏令时，用固定偏移，
// 不受运行机时区影响；raw/classified/pending-queue 与 Graylog 查询仍用 ISO UTC。
function fmtLocal(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const p = (n) => String(n).padStart(2, '0');
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate())
    + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + ':' + p(t.getUTCSeconds());
}

function fmtDelta(first, last) {
  if (!first || !last) return '-';
  return fmtLocal(first) + ' → ' + fmtLocal(last);
}

function analysisBlock(entry, c, redactPatterns) {
  const a = entry && entry.analysis ? entry.analysis : null;
  const hash = c.errorHash;
  const slow = c.kind === 'slow';
  const sev = severityOf(c, entry);
  const L = [];
  L.push('### ' + (slow ? '耗时归因与优化方案' : '根因与修正方案'));
  L.push('');
  if (!a) {
    if (slow) {
      L.push('> 待分析（P0 慢请求）。按最慢样例的 traceId 拉全链路日志，分阶段分解耗时，判定是**数据量导致的正常长耗时**还是**代码缺陷**（N+1 逐条调用、慢 SQL、循环内远程调用、缺批量接口）。');
    } else if (sev === 'P1') {
      L.push('> 待分析（P1 业务异常）。确认该抛出是否为业务正常处理、提示文案是否合理即可，不强制出代码修改方案；若发现实为程序缺陷，用 `analysis.severity` 改判 P0。');
    } else {
      L.push('> 待分析（P0 程序异常）。需给出代码修改或报错处理方案。');
    }
    L.push('> 结论写入 `config/pending-queue.json` 中 `errorHash=' + hash + '` 的 `analysis` 字段（`rootCause` / `fix` / `verification`，可选 `severity` 改判），重新渲染即可回填。');
    return L;
  }
  // 分析文本是人工写入的自由文本，可能引用连接串或主机地址，必须同样过一遍脱敏
  if (a.severity) {
    L.push('**严重度（分析结论）**：' + redact(String(a.severity), redactPatterns)
      + (c.severity && String(a.severity) !== c.severity ? '（脚本初判 ' + c.severity + '，已改判）' : '')
      + (a.severityReason ? ' — ' + redact(String(a.severityReason), redactPatterns) : ''));
    L.push('');
  }
  if (a.rootCause) {
    L.push('**' + (slow ? '耗时原因' : '根因') + '**');
    L.push('');
    L.push(redact(String(a.rootCause), redactPatterns));
    L.push('');
  }
  if (a.fix) {
    L.push('**' + (slow ? '优化方案' : '修正方案') + '**');
    L.push('');
    L.push(redact(String(a.fix), redactPatterns));
    L.push('');
  }
  if (a.verification) {
    L.push('**验证方式**');
    L.push('');
    L.push(redact(String(a.verification), redactPatterns));
    L.push('');
  }
  return L;
}

function uiBlock(c) {
  const L = [];
  const ui = c.ui;
  if (!ui) {
    L.push('### 前端定位');
    L.push('');
    // 他组与基础设施的簇由对方应用产生，本组页面清单里本就不该有对应入口；
    // 对转发对象提示「请运行 penetrate-frontend.js」毫无意义
    if (c.ownerKind === 'external' || c.ownerKind === 'infra') {
      L.push('> 该簇归属' + (c.ownerKind === 'external' ? '他组应用' : '基础设施') + '，不涉及医生站前端页面，无需界面定位。');
    } else {
      L.push('> 未执行前端穿透。运行 `penetrate-frontend.js --classified <本文件>` 后重新渲染即可回填。');
    }
    L.push('');
    return L;
  }
  const modeText = ui.mode === 'codegraph' ? 'codegraph 索引（按钮级）' : '启发式匹配（候选页面级）';
  L.push('### 前端定位（' + modeText + '）');
  L.push('');
  if (!ui.candidates || ui.candidates.length === 0) {
    L.push('> ' + (ui.note || '未匹配到候选页面。'));
    L.push('');
    return L;
  }
  if (ui.mode !== 'codegraph') {
    const why = ui.degradeReason === 'index-missing'
      ? '未构建 codegraph 前端索引'
      : (ui.degradeReason === 'codegraph-index-present-but-codegraph-mode-not-enabled'
          ? 'codegraph 索引已构建，但穿透脚本尚未启用按钮级分支'
          : '当前为启发式模式');
    L.push('> ' + why + '，下表按「模块 + URL 词元」匹配，仅作排查入口参考，不等于该操作必然由此页面发起。');
    L.push('');
  }
  L.push('| 候选页面 | 界面名 | 菜单名 | 类型 | 匹配度 | 依据 |');
  L.push('|---|---|---|---|---|---|');
  for (const h of ui.candidates) {
    L.push('| `' + h.page + '` | ' + (h.name || '-') + ' | ' + (h.menu || '-') + ' | ' + (h.type || '-') + ' | ' + (h.confidence || '-') + ' | ' + (h.reason || '-') + ' |');
  }
  L.push('');
  return L;
}

// 本组簇的证据等级。老 classified-*.json 没有该字段，用 confidence 反推，保证历史文件仍可渲染
function evidenceLevelOf(c) {
  if (c.evidenceLevel) return c.evidenceLevel;
  if (c.ownerKind !== 'self') return '';
  return c.confidence === 'high' ? 'module-frame' : 'app-only';
}

function evidenceLabel(c) {
  const lv = evidenceLevelOf(c);
  if (lv === 'module-frame') return '有本组堆栈帧（module-frame）';
  if (lv === 'interface-fqcn') return '接口全限定名（interface-fqcn，慢请求无堆栈，按接口包前缀归属）';
  if (lv === 'app-only') return '仅应用名推断（app-only，无本组代码证据）';
  return '-';
}

function fmtDuration(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return '-';
  if (n < 1000) return n + 'ms';
  const s = n / 1000;
  if (s < 60) return s.toFixed(2) + 's';
  return (s / 60).toFixed(2) + 'min（' + Math.round(s) + 's）';
}

// source_* 字段是日志框架给的，堆栈兜底可能为空；两者都按同一格式展示，口径由标题行说明
function sourceLocation(site, redactPatterns) {
  if (!site) return '-';
  const cls = redact(site.className || '', redactPatterns);
  const method = site.methodName ? '.' + redact(site.methodName, redactPatterns) : '';
  const name = cls + method;
  const loc = site.fileName
    ? redact(site.fileName, redactPatterns) + (site.lineNumber ? ':' + site.lineNumber : '')
    : (site.lineNumber ? ':' + site.lineNumber : '');
  return (name ? '`' + name + '`' : '') + (loc ? '（`' + loc + '`）' : '');
}

// 慢请求没有异常类，标题必须落到接口名；无异常类的报错（多为 app-only）退回消息首行，
// 否则整篇报告与 P0 索引全是「未知异常」，无法区分。标题不经消息样例的脱敏通道，必须在此自行脱敏。
function clusterTitle(c, redactPatterns) {
  if (c.kind === 'slow') return '慢请求 ' + (c.interfaceName || '未知接口');
  if (c.exceptionClass) return c.exceptionClass;
  const first = String((c.samples && c.samples[0] && c.samples[0].message) || '').split('\n')[0].trim();
  if (!first) return '未知异常';
  const clean = redact(first, redactPatterns).replace(/[|`]/g, '/').replace(/\s+/g, ' ').trim();
  if (!clean) return '未知异常';
  // 同类报错首行前缀相同，区分信息（extCode / path / 失效药品名）都在行尾，只截头部会让多簇标题一模一样
  return clean.length > 64 ? clean.slice(0, 32) + '…' + clean.slice(-32) : clean;
}

const ORIGIN_LABELS = {
  self: '本组自身代码/配置/数据',
  'self-calls-external': '本组调用他组失败（责任在被调方，本组容错）',
  external: '他组自身故障（本组未参与）',
  infra: '基础设施组件',
  unknown: '证据不足，待定',
};

// 来源回答「异常源自哪一侧」，与归属（谁该处理）正交；旧版 classified 无 origin 时显式标注，不静默省略
function originLabel(c) {
  if (!c.origin) return '未标注（旧版分类结果，重跑 classify-owner.js 可得）';
  let label = ORIGIN_LABELS[c.origin] || c.origin;
  // 只有外部产品组才能作为「被调方」后缀；infra/self 模块名接在「他组」后面会误导
  if (c.origin === 'self-calls-external' && c.ownerGroup) {
    label += '：' + c.ownerGroup;
  }
  if (c.originMixed && c.originCounts) {
    label += '（混合：' + Object.entries(c.originCounts).map(([k, n]) => k + '×' + n).join('，') + '）';
  }
  return label;
}

// 严重度以分析轮结论为准；脚本只做初判，旧版 classified 无该字段时显示「未初判」而不是默认 P0
function severityOf(c, entry) {
  const a = entry && entry.analysis ? entry.analysis : null;
  if (a && a.severity) return String(a.severity);
  return c.severity ? String(c.severity) : '';
}

function renderCluster(no, c, ctx) {
  const queue = ctx.queue;
  const redactPatterns = ctx.redactPatterns;
  const entry = queue.get(c.errorHash);
  const sev = severityOf(c, entry);
  const overridden = Boolean(sev && c.severity && sev !== c.severity);
  const slow = c.kind === 'slow';
  const sampleId = (c.samples[0] || {}).id;
  const raw = ctx.rawIndex.get(sampleId);
  const L = [];
  L.push('## ' + no + '. ' + (sev ? '[' + sev + '] ' : '') + '`' + clusterTitle(c, redactPatterns) + '` × ' + c.count);
  L.push('');
  L.push('| 项 | 值 |');
  L.push('|---|---|');
  L.push('| errorHash | `' + c.errorHash + '` |');
  L.push('| 类型 | ' + (slow ? '慢请求（接口耗时超阈值）' : '报错异常') + ' |');
  L.push('| 严重度 | ' + (sev
    ? sev + (overridden ? '（分析轮改判，脚本初判 ' + c.severity + '）' : '（脚本初判）')
    : '未初判（旧版分类结果，无 severity 字段）') + ' |');
  if (c.severityBasis) L.push('| 严重度依据 | ' + redact(c.severityBasis, redactPatterns) + (c.severityMixed ? '；**混合簇，按最高级处理**' : '') + ' |');
  L.push('| 归属 | ' + c.ownerKind + (c.ownerModule ? ' / ' + c.ownerModule : '') + (c.ownerGroup ? ' / ' + c.ownerGroup : '') + ' |');
  L.push('| 归属判定 | ' + c.rule + '（' + c.confidence + '） |');
  L.push('| 来源 | ' + originLabel(c) + ' |');
  L.push('| 证据等级 | ' + evidenceLabel(c) + ' |');
  if (slow) {
    L.push('| 接口 | `' + (c.interfaceName || '-') + '` |');
    L.push('| 耗时 最大 / 平均 | ' + fmtDuration(c.durationMaxMs) + ' / ' + fmtDuration(c.durationAvgMs) + ' |');
    L.push('| 最慢样例 | ' + fmtLocal(c.slowestTimestamp) + (c.slowestTraceId ? '（traceId ' + c.slowestTraceId + '）' : '') + ' |');
  } else {
    L.push('| 最内层业务帧 | ' + (c.innermostFrame || '-') + ' |');
    if (c.source) L.push('| 源码位置 | ' + sourceLocation(c.source, redactPatterns) + ' |');
  }
  L.push('| 首次 / 末次 | ' + fmtDelta(c.firstSeen, c.lastSeen) + ' |');
  L.push('| 应用 | ' + (c.appNames && c.appNames.length ? c.appNames.join(', ') : '-') + ' |');
  L.push('| 涉及 URL | ' + (c.urls && c.urls.length ? c.urls.map((u) => '`' + redact(u, redactPatterns) + '`').join(' ') : '-') + ' |');
  L.push('| traceId 样例 | ' + (c.traceIds && c.traceIds.length ? c.traceIds.slice(0, 3).join(', ') : '-') + ' |');
  if (c.mixed) {
    L.push('| 归属混合 | ' + c.mixedOwners.map((m) => m.owner + '×' + m.count).join('，') + ' |');
  }
  if (c.evidenceLevelMixed && c.evidenceLevelCounts) {
    L.push('| 证据混合 | ' + Object.entries(c.evidenceLevelCounts).map(([k, n]) => k + '×' + n).join('，') + ' |');
  }
  L.push('');
  L.push('### 消息样例');
  L.push('');
  L.push(FENCE + 'text');
  L.push(redact((c.samples[0] || {}).message || '', redactPatterns));
  L.push(FENCE);
  L.push('');
  if (!slow && c.source) {
    const sites = Array.isArray(c.sourceSites) && c.sourceSites.length > 0 ? c.sourceSites : [c.source];
    const basis = c.source.from === 'frame'
      ? '堆栈最内层业务帧；日志未带 source_* 字段'
      : '日志 source_* 字段';
    L.push('### 源码定位（' + basis + '）');
    L.push('');
    L.push(FENCE + 'text');
    L.push('source_class_name: ' + (redact(c.source.className, redactPatterns) || '-'));
    L.push('source_file_name: ' + (redact(c.source.fileName, redactPatterns) || '-'));
    L.push('source_line_number: ' + (c.source.lineNumber || '-'));
    L.push('source_method_name: ' + (redact(c.source.methodName, redactPatterns) || '-'));
    L.push(FENCE);
    L.push('');
    if (sites.length > 1) {
      L.push('> 同簇命中 ' + sites.length + ' 处源码位置（同一 errorHash 合并了不同抛点或日志点），上方为出现最多的一处：');
      L.push('');
      for (const s of sites) L.push('- ' + sourceLocation(s, redactPatterns) + (s.count ? ' ×' + s.count : ''));
      L.push('');
    }
  }
  if (slow) {
    const rows = (c.samples || []).filter((s) => Number(s.durationMs) > 0);
    if (rows.length > 0) {
      L.push('### 耗时样例（慢请求无堆栈，按 traceId 追全链路）');
      L.push('');
      L.push('| 时间（本地 UTC+8） | 耗时 | traceId |');
      L.push('|---|---|---|');
      for (const s of rows) {
        L.push('| ' + fmtLocal(s.timestamp) + ' | ' + fmtDuration(s.durationMs) + ' | ' + (s.traceId || '-') + ' |');
      }
      L.push('');
    }
  } else {
    const ex = stackExcerpt(raw || {}, ctx.maxStack);
    if (ex.lines.length > 0) {
      L.push('### 堆栈摘要（保留 ' + (ex.kept || ex.lines.length) + ' 行' + (ex.truncated ? '，原始 ' + ex.total + ' 行已截断' : '') + '）');
      L.push('');
      L.push(FENCE + 'text');
      for (const line of ex.lines) L.push(redact(line, redactPatterns));
      L.push(FENCE);
      L.push('');
    } else if (!raw) {
      // raw 被清理/缺失时静默跳过会让报告看起来完整，实际丢了最关键证据
      L.push('### 堆栈摘要');
      L.push('');
      L.push('> 原始消息未找到（`raw-errors-*.json` 已缺失或被 `output.rawKeepDays` 清理），本簇堆栈不可展示。');
      L.push('> 如需补齐：重新采集同一时间窗后重跑 `classify-owner.js` 与 `render-report.js`。');
      L.push('');
    }
  }
  for (const line of uiBlock(c)) L.push(line);
  // 他组通知只给证据与排查请求，本组内部的分析结论不随通知外发
  if (ctx.showAnalysis !== false) {
    for (const line of analysisBlock(entry, c, redactPatterns)) L.push(line);
  }
  L.push('');
  return L;
}

function allClusters(payload) {
  const g = payload.groups || {};
  const out = [];
  for (const key of ['self', 'infra', 'unknown', 'unrelated']) {
    for (const c of (g[key] || {}).clusters || []) out.push(c);
  }
  for (const b of g.external || []) {
    for (const c of b.clusters || []) out.push(c);
  }
  return out;
}

function renderSummary(payload, fileNames, ctx) {
  const s = payload.stats || {};
  const queue = (ctx && ctx.queue) || new Map();
  const redactPatterns = ctx && ctx.redactPatterns;
  const L = [];
  L.push('# Graylog 报错与慢请求巡检（' + payload.env + ' 环境）');
  L.push('');
  L.push('- 运行 ID：' + (payload.runId || '-'));
  if (payload.window) {
    L.push('- 采集窗口：' + fmtLocal(payload.window.from) + ' → ' + fmtLocal(payload.window.to) + '（' + (payload.window.initial ? '首轮' : '增量') + '，本地时间 UTC+8）');
  }
  L.push('- 生成时间：' + fmtLocal(payload.generatedAt));
  L.push('- 报错查询：`' + (payload.queryUsed || '-') + '`');
  const slowMeta = payload.slow;
  if (slowMeta) {
    const thresholdSec = Math.round((Number(slowMeta.thresholdMs) || 15000) / 1000);
    L.push('- 慢请求查询：`' + (payload.slowQueryUsed || '-') + '`，阈值 >= ' + thresholdSec + 's（按解析出的耗时毫秒数判定，框架文案分档最高只到 15秒）');
    if (slowMeta.disabled) {
      L.push('- 慢请求采集：未启用（`query.slowSelector` 为空），本轮只有 ERROR');
    } else {
      L.push('- 慢请求命中：达标 ' + (slowMeta.kept || 0) + ' 条 / 抓取 ' + (slowMeta.fetched || 0) + ' 条（窗口内共 ' + (slowMeta.total || 0) + ' 条）');
    }
    if (slowMeta.error) L.push('- **慢请求查询失败**：本轮只有 ERROR 日志（' + redact(slowMeta.error, redactPatterns) + '）');
    if (slowMeta.truncated) L.push('- 慢请求结果被截断（' + (slowMeta.truncateReason || '-') + '），水位线按两路中更早的已取最后一条推进，下轮补采');
  }
  L.push('- 簇 ' + (s.clusters || 0) + ' 个，覆盖日志 ' + (s.items || 0) + ' 条（报错 ' + (s.errorItems || 0) + ' / 慢请求 ' + (s.slowItems || 0) + '）');
  const fe = payload.frontend;
  if (fe) {
    const selfCount = s.self || 0;
    const modeText = fe.effectiveMode === 'codegraph'
      ? 'codegraph 索引（按钮级）'
      : '启发式（候选页面级' + (selfCount > 0 ? '，命中 ' + (fe.matchedClusters || 0) + '/' + selfCount + ' 个本组簇' : '') + '）';
    L.push('- 前端穿透：' + modeText + '，目录 ' + fe.catalogPages + ' 页');
    if (fe.degradeReason === 'index-missing') {
      L.push('- 精度限制：未构建 codegraph 前端索引，界面定位为候选级；构建后可达按钮与 JS 行号');
    } else if (fe.degradeReason === 'no-target-cluster') {
      L.push('- 精度说明：本轮无本组或待定簇，未产生界面定位需求');
    } else if (fe.degradeReason === 'no-frontend-entry') {
      L.push('- 精度说明：本组簇均无浏览器发起的请求（服务间调用或后台任务），无对应界面可定位');
    } else if (fe.degradeReason === 'codegraph-index-present-but-codegraph-mode-not-enabled') {
      L.push('- 精度说明：codegraph 索引已构建，但穿透脚本尚未启用按钮级分支，当前为候选页面级');
    }
  } else {
    L.push('- 前端穿透：未执行（未运行 penetrate-frontend.js）');
  }
  L.push('');
  const all = allClusters(payload);
  const sevOf = (c) => severityOf(c, queue.get(c.errorHash));
  const slowAll = all.filter((c) => c.kind === 'slow');
  const p0Err = all.filter((c) => c.kind !== 'slow' && sevOf(c) === 'P0').length;
  const p1Err = all.filter((c) => c.kind !== 'slow' && sevOf(c) === 'P1').length;
  const unjudged = all.filter((c) => !sevOf(c)).length;
  const thresholdSec = Math.round((Number((payload.slow || {}).thresholdMs) || 15000) / 1000);
  L.push('## 严重度分布');
  L.push('');
  L.push('| 严重度 | 簇数 | 处理要求 |');
  L.push('|---|---|---|');
  L.push('| P0 · 不可预知程序异常 | ' + p0Err + ' | 必须给出代码修改或报错处理方案 |');
  L.push('| P0 · 慢请求（>= ' + thresholdSec + 's） | ' + slowAll.length + ' | 必须分析耗时原因：数据量正常长耗时 或 代码缺陷 |');
  L.push('| P1 · 业务正常处理抛出 | ' + p1Err + ' | 确认业务语义与提示文案，不强制改代码 |');
  if (unjudged > 0) L.push('| 未初判 | ' + unjudged + ' | 旧版分类结果无 severity 字段，重跑 classify-owner.js 回填 |');
  L.push('');
  L.push('> 严重度为脚本初判（业务异常信号：业务拦截器 logger / 消息首行「业务异常(」/ 业务异常类名）。分析轮可在 `analysis.severity` 改判，改判后本表与明细同步生效。');
  L.push('');
  L.push('## 归属分布');
  L.push('');
  L.push('| 归属 | 簇数 | 处理 |');
  L.push('|---|---|---|');
  const selfTotal = s.self || 0;
  // 老 classified-*.json 没有拆分字段时退回原样展示，避免汇总与明细对不上
  const selfSlow = typeof s.selfSlow === 'number' ? s.selfSlow : 0;
  const selfMf = typeof s.selfModuleFrame === 'number' ? s.selfModuleFrame : selfTotal - selfSlow;
  const selfAo = typeof s.selfAppOnly === 'number' ? s.selfAppOnly : 0;
  L.push('| 本组（有本组堆栈帧） | ' + selfMf + ' | 出根因与修正方案 |');
  L.push('| 本组（仅应用名推断） | ' + selfAo + ' | 列证据但不定性，需交叉基础设施/他组簇 |');
  L.push('| 本组（慢请求） | ' + selfSlow + ' | 分析耗时原因，出优化方案 |');
  L.push('| 基础设施 | ' + (s.infra || 0) + ' | 仅汇总，不单独推送 |');
  L.push('| 他组 | ' + (s.externalClusters || 0) + '（' + (s.externalGroups || 0) + ' 组） | 生成转发文档并推送 |');
  L.push('| 无关 | ' + (s.unrelated || 0) + ' | 他组应用自身故障，本组未参与，仅统计不推送 |');
  L.push('| 待定 | ' + (s.unknown || 0) + ' | 不推送，进人工确认队列 |');
  L.push('');
  const originN = (o) => all.filter((c) => c.origin === o).length;
  const originMissing = all.filter((c) => !c.origin).length;
  L.push('## 来源分布（异常源自哪一侧，与归属正交）');
  L.push('');
  L.push('| 来源 | 簇数 | 处理 |');
  L.push('|---|---|---|');
  L.push('| 本组自身 | ' + originN('self') + ' | 按本组缺陷分析根因，出修正方案 |');
  L.push('| 本组调用他组（跨组） | ' + originN('self-calls-external') + ' | 分析轮判定被调方与原始错误，本组只做容错；跨组报错进待分析队列 |');
  L.push('| 他组自身故障 | ' + originN('external') + ' | 只生成他组通知，本组不分析 |');
  L.push('| 基础设施 | ' + originN('infra') + ' | 汇总/通知基础设施 |');
  L.push('| 待定 | ' + originN('unknown') + ' | 待定队列，人工校准 |');
  if (originMissing > 0) L.push('| 未标注 | ' + originMissing + ' | 旧版分类结果无 origin 字段，重跑 classify-owner.js 回填 |');
  L.push('');
  if (slowAll.length > 0) {
    L.push('## 慢请求 Top（按最大耗时，跨归属）');
    L.push('');
    L.push('| 接口 | 归属 | 次数 | 最大耗时 | 平均耗时 |');
    L.push('|---|---|---|---|---|');
    const top = slowAll.slice().sort((a, b) => (Number(b.durationMaxMs) || 0) - (Number(a.durationMaxMs) || 0)).slice(0, 10);
    for (const c of top) {
      const owner = c.ownerKind + (c.ownerGroup ? ' / ' + c.ownerGroup : (c.ownerModule ? ' / ' + c.ownerModule : ''));
      L.push('| `' + (c.interfaceName || '-') + '` | ' + owner + ' | ' + (c.count || 0) + ' | ' + fmtDuration(c.durationMaxMs) + ' | ' + fmtDuration(c.durationAvgMs) + ' |');
    }
    L.push('');
  }
  const unrel = (payload.groups || {}).unrelated || {};
  if (Array.isArray(unrel.groups) && unrel.groups.length > 0) {
    L.push('无关簇按疑似归属：' + unrel.groups.map((g) => g.group + ' ' + g.clusters + ' 簇 / ' + g.count + ' 条').join('，'));
    L.push('');
  }
  const promoted = ((payload.groups || {}).external || []).filter((g) => (g.fromUnrelated || 0) > 0);
  if (promoted.length > 0) {
    L.push('已按 `notifyUnrelated` 转发的无关簇：' + promoted.map((g) => g.group + ' ' + g.fromUnrelated + ' 簇').join('，') + '（内容并入对应 notify 文档）');
    L.push('');
  }
  if (fileNames && fileNames.length > 0) {
    L.push('## 本轮产出');
    L.push('');
    for (const f of fileNames) L.push('- `' + f + '`');
    L.push('');
  }
  const pending = payload.pendingQueue || null;
  if (pending) {
    L.push('## 待分析队列');
    L.push('');
    L.push('- 文件：`' + pending.file + '`');
    L.push('- 本轮新增 ' + (pending.added || 0) + ' 条，更新 ' + (pending.updated || 0) + ' 条，累计 ' + (pending.total || 0) + ' 条');
    if (pending.crossGroup > 0) {
      L.push('- 其中本组调用他组（跨组报错）待分析 ' + pending.crossGroup + ' 条：须写明被调方与原始错误，本组只给容错方案');
    }
    L.push('');
  }
  return L.join('\n');
}

function renderSelf(payload, ctx) {
  const g = payload.groups.self || {};
  const unknown = payload.groups.unknown || {};
  const clusters = g.clusters || [];
  // 证据分档只对报错有意义：慢请求走接口全限定名，不能混进「仅应用名推断」段
  const errors = clusters.filter((c) => c.kind !== 'slow');
  const slows = clusters.filter((c) => c.kind === 'slow');
  const withFrame = errors.filter((c) => evidenceLevelOf(c) === 'module-frame');
  const inferred = errors.filter((c) => evidenceLevelOf(c) !== 'module-frame');
  const p0 = clusters.filter((c) => severityOf(c, ctx.queue.get(c.errorHash)) === 'P0').length;
  const p1 = clusters.filter((c) => severityOf(c, ctx.queue.get(c.errorHash)) === 'P1').length;
  const L = [];
  L.push('# 本组报错与慢请求明细（' + payload.env + ' 环境 · ' + (g.label || '医生站') + '）');
  L.push('');
  L.push('- 生成时间：' + fmtLocal(payload.generatedAt) + '（本地时间 UTC+8）');
  L.push('- 本组簇数：' + clusters.length + '（报错 ' + errors.length + '：有本组堆栈帧 ' + withFrame.length + ' / 仅应用名推断 ' + inferred.length + '；慢请求 ' + slows.length + '）');
  L.push('- 严重度：P0 ' + p0 + ' 簇 / P1 ' + p1 + ' 簇（脚本初判，分析轮结论可改判）');
  L.push('');
  // 报告按证据分段，P0 可能落在「二、仅应用名推断」段而被 P1 挤到后面；先给一张按严重度优先的索引
  const ordered = withFrame.concat(inferred, slows);
  const numberOf = new Map(ordered.map((c, i) => [c.errorHash, i + 1]));
  const p0List = ordered.filter((c) => severityOf(c, ctx.queue.get(c.errorHash)) === 'P0');
  if (p0List.length > 0) {
    L.push('## P0 优先处理清单');
    L.push('');
    L.push('| 序号 | 类型 | 簇 | 证据等级 | 次数 |');
    L.push('|---|---|---|---|---|');
    const titles = p0List.map((c) => clusterTitle(c, ctx.redactPatterns));
    const titleCount = new Map();
    for (const t of titles) titleCount.set(t, (titleCount.get(t) || 0) + 1);
    for (let i = 0; i < p0List.length; i += 1) {
      const c = p0List[i];
      // 同一异常类可对应多个簇，重名时补 errorHash 前缀，否则清单里多行长得一模一样
      const title = titles[i] + (titleCount.get(titles[i]) > 1 ? '（' + c.errorHash.slice(0, 8) + '）' : '');
      L.push('| ' + numberOf.get(c.errorHash) + ' | ' + (c.kind === 'slow' ? '慢请求' : '报错') + ' | `' + title + '` | ' + evidenceLabel(c) + ' | ' + (c.count || 0) + ' |');
    }
    L.push('');
    L.push('> 序号对应下文各段明细。落在「二、仅应用名推断」段的 P0 簇**无本组代码证据**，需先交叉同轮基础设施/他组簇再定性。');
    L.push('');
  }
  if (clusters.length === 0) {
    L.push('本窗口内无本组报错，也无本组慢请求。');
    L.push('');
  } else {
    L.push('# 一、有本组堆栈帧（可直接定性）');
    L.push('');
    if (withFrame.length === 0) {
      L.push('> 本段为空：本轮没有任何一条报错的堆栈命中本组模块包。');
      L.push('> 这不等于本组无缺陷——写错的 SQL、被框架包装掉的异常都可能不出现本组帧，');
      L.push('> 仍需结合「二、仅应用名推断」与基础设施报告交叉判断。');
      L.push('');
    }
    withFrame.forEach((c, i) => {
      for (const line of renderCluster(i + 1, c, ctx)) L.push(line);
    });
    L.push('# 二、仅应用名推断（无本组代码证据）');
    L.push('');
    L.push('- 覆盖日志 ' + inferred.reduce((n, c) => n + (c.count || 0), 0) + ' 条');
    L.push('');
    L.push('> 以下簇仅凭应用名 `his-mediway-server` 判定归属。该进程是聚合进程，代多个模块与其他系统应答，');
    L.push('> **不能证明异常由本组代码抛出**。请先看同 traceId 是否存在基础设施/他组簇，再决定是否按本组缺陷处理。');
    L.push('');
    if (inferred.length === 0) {
      L.push('本段为空。');
      L.push('');
    }
    const offset = withFrame.length;
    inferred.forEach((c, i) => {
      for (const line of renderCluster(offset + i + 1, c, ctx)) L.push(line);
    });
    L.push('# 三、慢请求（接口耗时超阈值，一律 P0）');
    L.push('');
    const thresholdMs = Number((payload.slow || {}).thresholdMs) || 15000;
    L.push('- 阈值：接口耗时 >= ' + Math.round(thresholdMs / 1000) + 's（`query.slowThresholdMs`）');
    L.push('- 覆盖日志 ' + slows.reduce((n, c) => n + (c.count || 0), 0) + ' 条，按接口聚簇（同一接口的多次慢调用合并为一簇）');
    L.push('');
    L.push('> 慢请求日志由框架 `LogFilter` 以 WARN 打印，**没有堆栈**。归属优先按接口全限定名的包前缀判定；');
    L.push('> 前缀未登记时退回应用名推断（此时无代码证据，见各簇「证据等级」行，不得直接定性为本组缺陷）。');
    L.push('> 每簇必须分析耗时原因：按最慢样例 traceId 拉全链路，分阶段分解耗时，区分数据量正常与代码缺陷。');
    L.push('');
    if (slows.length === 0) {
      L.push('本段为空：本窗口内无本组接口耗时超过阈值。');
      L.push('');
    }
    const slowOffset = withFrame.length + inferred.length;
    slows.forEach((c, i) => {
      for (const line of renderCluster(slowOffset + i + 1, c, ctx)) L.push(line);
    });
  }
  // 跨组报错不属于本组缺陷，但本组是调用发起方，分析轮要给出「责任在被调方 + 本组容错」的判断。
  // 只收已定位到具体他组的簇：unknown 的来源即使标成 self-calls-external 也没解析出被调方，
  // 仍应留在「待定归属」附录，不能借这个附录宣称责任已明确。
  const crossGroup = allClusters(payload).filter((c) => c.ownerKind === 'external' && c.origin === 'self-calls-external' && c.kind !== 'slow');
  if (crossGroup.length > 0) {
    L.push('# 附录：本组调用他组失败（跨组报错，责任在被调方）');
    L.push('');
    L.push('- 共 ' + crossGroup.length + ' 簇，已按被调方并入对应 `notify-*` 文档；跨组慢请求同样只在通知中，不在此列');
    L.push('');
    L.push('> 这些簇由本组进程打印或本组参与同一 trace，但异常抛在被调方接口/代码内。');
    L.push('> 分析轮须写明被调方与原始错误，本组只给容错/降级/提示方案，**不按本组缺陷改码、不臆造本组堆栈**。');
    L.push('');
    crossGroup.forEach((c, i) => {
      for (const line of renderCluster('C' + (i + 1), c, ctx)) L.push(line);
    });
  }
  if (unknown.clusters && unknown.clusters.length > 0) {
    L.push('# 附录：待定归属（需人工确认，未推送）');
    L.push('');
    L.push('以下簇无法确认归属，已进入待确认队列。确认后可修改 `config/graylog-triage.json` 的 `ownerGroups` 或补充 `external.appGroups`。');
    L.push('');
    const offset = clusters.length;
    unknown.clusters.forEach((c, i) => {
      for (const line of renderCluster(offset + i + 1, c, ctx)) L.push(line);
    });
  }
  return L.join('\n');
}

function renderInfra(payload, ctx) {
  const g = payload.groups.infra || {};
  const clusters = g.clusters || [];
  const slowCount = clusters.filter((c) => c.kind === 'slow').length;
  const L = [];
  L.push('# 基础设施报错' + (slowCount > 0 ? '与慢请求' : '') + '（' + payload.env + ' 环境 · ' + (g.label || '基础设施') + '）');
  L.push('');
  L.push('- 生成时间：' + fmtLocal(payload.generatedAt) + '（本地时间 UTC+8）');
  L.push('- 簇数：' + clusters.length + '（慢请求 ' + slowCount + '），其中疑似由本组调用触发：' + (g.selfAffected || 0));
  L.push('- 配置 `ownerGroups.infra.notify=' + (g.notify === false ? 'false' : 'true') + '`，本类默认只落盘不单独推送');
  L.push('');
  if (clusters.length === 0) {
    L.push('本窗口内无基础设施报错。');
    L.push('');
    return L.join('\n');
  }
  clusters.forEach((c, i) => {
    for (const line of renderCluster(i + 1, c, ctx)) L.push(line);
  });
  return L.join('\n');
}

function renderExternal(payload, bucket, ctx) {
  const L = [];
  const clusters = bucket.clusters || [];
  const slows = clusters.filter((c) => c.kind === 'slow');
  const errors = clusters.filter((c) => c.kind !== 'slow');
  const kindTitle = slows.length === 0 ? '报错通知' : (errors.length === 0 ? '慢请求通知' : '报错与慢请求通知');
  const p0 = clusters.filter((c) => severityOf(c, ctx.queue.get(c.errorHash)) === 'P0').length;
  const p1 = clusters.filter((c) => severityOf(c, ctx.queue.get(c.errorHash)) === 'P1').length;
  L.push('# ' + kindTitle + '：' + bucket.group + '（' + payload.env + ' 环境）');
  L.push('');
  L.push('> 本文件由医生站 Graylog 巡检自动生成，用于转发给对应产品组。');
  L.push('');
  L.push('- 采集窗口：' + (payload.window ? fmtLocal(payload.window.from) + ' → ' + fmtLocal(payload.window.to) + '（本地时间 UTC+8）' : '-'));
  L.push('- 生成时间：' + fmtLocal(payload.generatedAt));
  L.push('- 簇数：' + clusters.length + '（报错 ' + errors.length + ' / 慢请求 ' + slows.length + '），出现次数合计：' + bucket.count);
  L.push('- 严重度：P0 ' + p0 + ' 簇 / P1 ' + p1 + ' 簇（P0 需出方案，P1 为业务正常抛出）');
  const selfCallErr = errors.filter((c) => c.origin === 'self-calls-external').length;
  const ownErr = errors.filter((c) => c.origin === 'external').length;
  const unlabeled = clusters.filter((c) => !c.origin).length;
  if (selfCallErr > 0 || ownErr > 0) {
    const parts = [];
    if (selfCallErr > 0) parts.push('医生站侧调用贵组接口失败 ' + selfCallErr + ' 簇');
    if (ownErr > 0) parts.push('贵组应用自身报错 ' + ownErr + ' 簇');
    L.push('- 判定来源：' + parts.join('；') + '（各簇「来源」行为准）');
  } else {
    L.push('- 判定来源：医生站侧调用贵组接口失败，或同一 trace 内贵组应用自身报错');
  }
  if (unlabeled > 0) L.push('- 来源未标注：' + unlabeled + ' 簇为旧版分类结果，重跑 classify-owner.js 可回填');
  if (slows.length > 0) {
    const thresholdSec = Math.round((Number((payload.slow || {}).thresholdMs) || 15000) / 1000);
    L.push('- 其中 ' + slows.length + ' 个簇为**慢请求**：贵组接口耗时 >= ' + thresholdSec + 's（按接口全限定名归属，非调用失败），请分析耗时原因并给出优化方案');
  }
  if (bucket.fromUnrelated > 0) {
    // 这两类成因不同，混在一起会让对方误判为「医生站调用出错」
    L.push('- 其中 ' + bucket.fromUnrelated + ' 个簇由贵组应用自身打印、医生站未参与调用（已按 `notifyUnrelated` 配置一并告知），请贵组自查');
  }
  L.push('');
  clusters.forEach((c, i) => {
    for (const line of renderCluster(i + 1, c, ctx)) L.push(line);
  });
  return L.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const envId = String(args.env || cfg.defaultEnv || '87');
  if (!(cfg.environments || {})[envId]) {
    console.error('[ERROR] 未配置环境 ' + envId);
    process.exit(2);
  }

  let classifiedFile = '';
  if (typeof args.classified === 'string') classifiedFile = path.resolve(args.classified);
  else classifiedFile = latestClassified(cfg, envId);
  if (!classifiedFile || !fs.existsSync(classifiedFile)) {
    console.error('[ERROR] 找不到分类结果文件，请先运行 classify-owner.js，或用 --classified 指定路径');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(classifiedFile, 'utf8'));
  } catch (err) {
    console.error('[ERROR] 分类结果解析失败: ' + err.message);
    process.exit(1);
  }
  const problems = validateInput(payload);
  if (problems.length > 0) {
    console.error('[ERROR] 分类结果结构非法：' + problems.join('；'));
    process.exit(1);
  }

  const hmMatch = path.basename(classifiedFile).match(/^classified-(\d{4})\.json$/);
  const now = new Date();
  const hm = hmMatch ? hmMatch[1] : String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
  const outDir = path.dirname(classifiedFile);
  const redactPatterns = (cfg.output || {}).redactPatterns;
  const queue = loadQueue(cfg);
  const rawIndex = loadRawItems(classifiedFile, payload);

  const selfCtx = {
    queue, rawIndex, redactPatterns,
    maxStack: Number(args['max-stack']) > 0 ? Number(args['max-stack']) : (Number((cfg.output || {}).maxStackLinesSelf) || 60),
  };
  const notifyCtx = {
    queue, rawIndex, redactPatterns, showAnalysis: false,
    maxStack: Number(args['max-stack']) > 0 ? Number(args['max-stack']) : (Number((cfg.output || {}).maxStackLinesNotify) || 25),
  };

  const outputs = [];
  outputs.push(['report-self-' + hm + '.md', renderSelf(payload, selfCtx)]);
  if (((payload.groups.infra || {}).clusters || []).length > 0) {
    outputs.push(['report-infra-' + hm + '.md', renderInfra(payload, notifyCtx)]);
  }
  for (const bucket of payload.groups.external || []) {
    outputs.push(['notify-' + safeName(bucket.group) + '-' + hm + '.md', renderExternal(payload, bucket, notifyCtx)]);
  }

  const written = [];
  const blocked = [];
  for (const [name, md] of outputs) {
    const err = validateOutput(name, md);
    if (err) blocked.push(err);
    else written.push([name, md]);
  }

  const summaryMd = renderSummary(payload, written.map(([name]) => name), { queue, redactPatterns });
  const finalOutputs = [['report-summary-' + hm + '.md', summaryMd]].concat(written);

  if (args.check) {
    console.log('[CHECK] 将写入 ' + finalOutputs.length + ' 个文件：' + finalOutputs.map(([n]) => n).join(', '));
  } else {
    try {
      for (const [name, md] of finalOutputs) {
        fs.writeFileSync(path.join(outDir, name), md.endsWith('\n') ? md : md + '\n', 'utf8');
      }
    } catch (err) {
      console.error('[FAIL] 落盘失败: ' + err.message);
      process.exit(1);
    }
    console.log('[OK] 已写入 ' + finalOutputs.length + ' 个文件到 ' + outDir);
    for (const [name] of finalOutputs) console.log('     - ' + name);

    // 必须在新文件全部落盘之后再清理：写失败时旧文件是唯一的可用副本
    if ((cfg.output || {}).pruneStaleNotify !== false) {
      const pruned = pruneStale(outDir, finalOutputs.map(([n]) => n), hm);
      if (pruned > 0) console.log('[INFO] 清理本轮未生成的过期通知 ' + pruned + ' 个');
    }
  }

  if (blocked.length > 0) {
    console.error('[FAIL] 以下文件因校验未通过被拦下：' + blocked.join('；'));
    process.exit(1);
  }
  if (args.stdout) {
    console.log('');
    console.log(summaryMd);
  }
  process.exit(0);
}

main();