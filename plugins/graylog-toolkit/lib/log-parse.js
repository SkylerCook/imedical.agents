'use strict';
// 堆栈解析与去重键。采集与分类共用，保证 errorHash 口径一致。
// errorHash 不含 traceId（否则每次 occurrence 各自成簇，count 永远为 1）；行级去重用 Graylog 消息 id。

const crypto = require('node:crypto');

const EXCEPTION_RE = /\b([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)+(?:Exception|Error|Throwable))\b/;
const FRAME_RE = /\bat\s+([\w.$]+)\.([\w$<>]+)\(([^)]*)\)/g;
const URL_RE = /url=([^,\s]+)/g;
const PATH_HINT_RE = /(?:^|[\s,;(])(?:path|uri)\s*[:=]\s*(\/[^\s,;)"']+)/gi;
const ABS_URL_RE = /https?:\/\/[^\s,;"']+/g;
const MAX_FRAMES = 80;
const MAX_URLS = 10;
const TRACE_PLACEHOLDER_RE = /[%{}$]/;

function textOf(msg) {
  if (msg && typeof msg === 'object') return String(msg.fullMessage || msg.message || '');
  return String(msg || '');
}

function parseStack(text) {
  const s = String(text || '');
  const m = s.match(EXCEPTION_RE);
  const frames = [];
  let f;
  FRAME_RE.lastIndex = 0;
  while ((f = FRAME_RE.exec(s)) !== null && frames.length < MAX_FRAMES) {
    frames.push({ cls: f[1], method: f[2], location: f[3] });
  }
  return { exceptionClass: m ? m[1] : '', frames };
}

function firstFrameOf(frames, prefixes) {
  if (!prefixes || prefixes.length === 0) return null;
  for (const fr of frames || []) {
    if (prefixes.some((p) => fr.cls.startsWith(p))) return fr;
  }
  return null;
}

function messageTemplate(msg) {
  let t = (textOf(msg).split('\n')[0] || '').trim();
  t = t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>');
  t = t.replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+/g, '<ts>');
  t = t.replace(/\b0x[0-9a-f]+\b/gi, '<hex>');
  t = t.replace(/'[^']*'/g, "'<s>'").replace(/"[^"]*"/g, '"<s>"');
  t = t.replace(/\b\d+\b/g, '<n>');
  return t.trim().slice(0, 300);
}

function deriveErrorKey(msg, selfPrefixes) {
  const text = textOf(msg);
  const { exceptionClass, frames } = parseStack(text);
  const anchorFrame = firstFrameOf(frames, selfPrefixes) || frames[0] || null;
  const anchor = anchorFrame ? `${anchorFrame.cls}.${anchorFrame.method}` : '';
  let template = messageTemplate(msg);
  if (!exceptionClass && !anchor && !template) template = text.slice(0, 200);
  return crypto.createHash('sha1')
    .update([exceptionClass, anchor, template].join('|'))
    .digest('hex')
    .slice(0, 16);
}

// LogFilter 的慢请求 WARN 日志：>>> 接口[com.x.YController.method(DTO)]耗时：7455 毫秒≈7.46秒≈0.12分钟，接口响应超过5秒
// 分档文案最高只到「15秒」，再长的调用也写着「超过15秒」，所以阈值按耗时数值判，tier 只作展示。
const SLOW_IFACE_RE = /接口\[([^\]]+)\]/;
const SLOW_MS_RE = /耗时[：:]\s*(\d+)/;
const SLOW_TIER_RE = /接口响应超过([^\s，,]+)/;

function parseSlow(text) {
  const s = String(text || '');
  const ms = SLOW_MS_RE.exec(s);
  const iface = SLOW_IFACE_RE.exec(s);
  if (!ms || !iface) return null;
  const raw = iface[1];
  const paren = raw.indexOf('(');
  const name = (paren >= 0 ? raw.slice(0, paren) : raw).trim();
  const dot = name.lastIndexOf('.');
  const tier = SLOW_TIER_RE.exec(s);
  return {
    durationMs: Number(ms[1]),
    interfaceName: name,
    interfaceClass: dot > 0 ? name.slice(0, dot) : '',
    interfaceMethod: dot > 0 ? name.slice(dot + 1) : name,
    tier: tier ? tier[1] : '',
  };
}

// 慢请求按接口聚簇：耗时数值进 hash 会让每次调用各自成簇，count 永远为 1
function deriveSlowKey(interfaceName) {
  return crypto.createHash('sha1')
    .update(`slow|${String(interfaceName || '')}`)
    .digest('hex')
    .slice(0, 16);
}

function urlPath(raw) {
  try {
    return new URL(raw).pathname;
  } catch {
    const idx = raw.indexOf('/', raw.indexOf('://') + 3);
    return idx >= 0 ? raw.slice(idx) : raw;
  }
}

function extractUrls(text) {
  const s = String(text || '');
  const out = [];
  const push = (v) => {
    const clean = String(v || '').replace(/[)\].,;]+$/, '');
    if (clean && !out.includes(clean)) out.push(clean);
  };
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(s)) !== null) push(m[1]);
  PATH_HINT_RE.lastIndex = 0;
  while ((m = PATH_HINT_RE.exec(s)) !== null) push(m[1]);
  ABS_URL_RE.lastIndex = 0;
  while ((m = ABS_URL_RE.exec(s)) !== null) push(m[0]);
  return out.slice(0, MAX_URLS);
}

function normalizeMessage(raw) {
  const r = raw || {};
  return {
    id: String(r._id || r.id || ''),
    timestamp: r.timestamp || '',
    traceId: isUsableTraceId(r.traceId || r.trace_id) ? String(r.traceId || r.trace_id).trim() : '',
    appName: String(r.app_name || r.application || ''),
    source: String(r.source || ''),
    level: r.level_name || r.level || '',
    loggerName: String(r.logger_name || ''),
    message: String(r.message || ''),
    fullMessage: String(r.full_message || r.message || ''),
    // 日志框架的 source_* 结构化字段：日志语句所在的类/文件/行/方法。
    // 比堆栈锚点更稳（异常被包装时堆栈首帧可能是框架类），报告用它做快速定位。
    sourceClassName: String(r.source_class_name || ''),
    sourceFileName: String(r.source_file_name || ''),
    sourceLineNumber: r.source_line_number === undefined || r.source_line_number === null
      ? '' : String(r.source_line_number),
    sourceMethodName: String(r.source_method_name || ''),
  };
}

// 日志未带 source_* 字段时的兜底：优先用归属判定已选中的业务帧，
// 否则取堆栈里第一个非框架帧（跳过 JDK/Spring 等）。位置串形如 File.java:665。
function frameSourceSite(text, preferredFrame, frameworkPrefixes) {
  const { frames } = parseStack(text);
  const skip = (Array.isArray(frameworkPrefixes) ? frameworkPrefixes : []).map(String);
  const toSite = (fr) => {
    const loc = String(fr.location || '').trim();
    const m = /^(.+):(\d+)$/.exec(loc);
    const named = loc && !/^(?:Unknown Source|Native Method)$/i.test(loc);
    return {
      className: fr.cls,
      methodName: fr.method,
      fileName: m ? m[1] : (named ? loc : ''),
      lineNumber: m ? m[2] : '',
    };
  };
  if (preferredFrame) {
    const hit = frames.find((fr) => `${fr.cls}.${fr.method}` === preferredFrame);
    if (hit) return toSite(hit);
  }
  const biz = frames.find((fr) => !skip.some((p) => p && fr.cls.startsWith(p)));
  return biz ? toSite(biz) : null;
}

// 业务拦截器统一日志的 errorLevel：「接收到业务异常，错误级别为：<level>，错误码为：…」
// 只取「错误级别为：」后到下一个逗号前的值，小写归一，供分类层判「异常 / 提醒」。
// 实测该值由 CompletionExceptionComp.getDescOfAlertLevel 转成中文（错误/提醒/信息/警告/严重）。
const BUSINESS_LEVEL_RE = /错误级别为[：:]\s*([^，,]+?)\s*(?:[，,]|$)/;

function parseBusinessErrorLevel(text) {
  const m = BUSINESS_LEVEL_RE.exec(String(text || ''));
  return m ? m[1].trim().toLowerCase() : '';
}

function stackLines(text) {
  return String(text || '').split(/\r?\n/);
}

// 未解析的 MDC 占位符（%{traceId}、${traceId}）不是真实 trace，参与邻域查询会串味
function isUsableTraceId(value) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  if (s.length < 8 || s.length > 128) return false;
  if (TRACE_PLACEHOLDER_RE.test(s)) return false;
  return true;
}

module.exports = {
  EXCEPTION_RE, FRAME_RE, MAX_FRAMES,
  textOf, parseStack, firstFrameOf, messageTemplate, deriveErrorKey,
  parseSlow, deriveSlowKey,
  extractUrls, urlPath, normalizeMessage, frameSourceSite, stackLines, isUsableTraceId,
  BUSINESS_LEVEL_RE, parseBusinessErrorLevel,
};
