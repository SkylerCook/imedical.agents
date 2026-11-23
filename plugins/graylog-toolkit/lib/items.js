'use strict';
// 原始日志 → 落盘条目：脱敏、截断、解析堆栈/慢请求、按配置计算 errorHash；去重状态与原始文件清理工具。

const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeMessage, parseStack, parseSlow, deriveErrorKey, deriveSlowKey, extractUrls,
} = require('./log-parse');

function selfPrefixes(cfg) {
  const self = (cfg.ownerGroups || {}).self || {};
  const base = self.packagePrefixTemplate
    ? self.packagePrefixTemplate.replace('{module}.', '').replace('{module}', '')
    : 'com.mediway.his.';
  const list = [base];
  for (const m of self.modules || []) {
    if (self.packagePrefixTemplate) list.push(self.packagePrefixTemplate.replace('{module}', m));
  }
  return [...new Set(list.filter(Boolean))];
}

// 日志里会出现 token、密码、SSO 认证对象明文，落盘前统一打码。
// 打码在算 errorHash 之前完成，保证同一错误簇的 hash 跨轮稳定。
const MASK_RULES = [
  // 「token 为：xxx」「token信息为：xxx」「传入token：xxx」（含全角冒号与中文连接词）
  [/((?:token|密码|口令)\s*(?:信息)?\s*(?:为|是)?\s*[：:]\s*)[A-Za-z0-9_\-+/=.]{16,}/gi, '$1***'],
  // 标准 key=value / key: value
  [/(\b(?:token|password|passwd|pwd|secret|authorization|ticket|cookie|access_token|refresh_token)\s*[=:]\s*)("[^"]*"|[^\s,&;)"']+)/gi, '$1***'],
  // URL 编码的 "password":"xxx" / "token":"xxx"
  [/(%22(?:password|token|access_token|refresh_token|secret)%22%3A%22)[^%"]{8,}/gi, '$1***'],
  // Basic 认证串
  [/(Basic\s+)[A-Za-z0-9+/=]{16,}/g, '$1***'],
];

function maskSecrets(text) {
  let out = String(text || '');
  for (const [re, rep] of MASK_RULES) out = out.replace(re, rep);
  return out;
}

function buildItem(raw, cfg, opts = {}) {
  const msg = normalizeMessage(raw);
  const maxChars = Number((cfg.classify || {}).maxFullMessageChars) || 4000;
  const cut = msg.fullMessage.length > maxChars ? msg.fullMessage.slice(0, maxChars) : msg.fullMessage;
  const text = maskSecrets(cut);
  const stack = parseStack(text);
  const slow = opts.kind === 'slow' ? parseSlow(text) : null;
  // 报告要能直接跳到源码，source_* 字段必须落盘；日志源未提供时不写空对象，
  // 分类层会退回堆栈最内层业务帧并在报告里注明口径
  const sourceSite = (msg.sourceClassName || msg.sourceFileName || msg.sourceLineNumber || msg.sourceMethodName)
    ? {
      className: msg.sourceClassName,
      fileName: msg.sourceFileName,
      lineNumber: msg.sourceLineNumber,
      methodName: msg.sourceMethodName,
    }
    : null;
  return {
    id: msg.id,
    timestamp: msg.timestamp,
    traceId: msg.traceId,
    appName: msg.appName,
    source: msg.source,
    level: msg.level,
    loggerName: msg.loggerName,
    kind: slow ? 'slow' : 'error',
    message: maskSecrets(msg.message).slice(0, 500),
    fullMessage: text,
    errorHash: slow ? deriveSlowKey(slow.interfaceName) : deriveErrorKey({ ...msg, fullMessage: text }, selfPrefixes(cfg)),
    exceptionClass: slow ? '' : stack.exceptionClass,
    frameCount: slow ? 0 : stack.frames.length,
    durationMs: slow ? slow.durationMs : null,
    interfaceName: slow ? slow.interfaceName : '',
    interfaceClass: slow ? slow.interfaceClass : '',
    interfaceMethod: slow ? slow.interfaceMethod : '',
    slowTier: slow ? slow.tier : '',
    urls: extractUrls(text),
    ...(sourceSite ? { sourceSite } : {}),
  };
}

function pruneDedupe(state, ttl, maxEntries) {
  const hours = Number(ttl && ttl.hours);
  const days = Number(ttl && ttl.days);
  const ttlMs = hours > 0 ? hours * 3600000 : (days > 0 ? days * 86400000 : 30 * 86400000);
  const cutoff = Date.now() - ttlMs;
  let removed = 0;
  for (const [id, ts] of Object.entries(state.dedupe)) {
    if (typeof ts !== 'number' || ts < cutoff) { delete state.dedupe[id]; removed += 1; }
  }
  // TTL 配得过长时按时间淘汰最旧，防止状态文件无限膨胀
  const limit = Number(maxEntries) || 0;
  if (limit > 0 && Object.keys(state.dedupe).length > limit) {
    const entries = Object.entries(state.dedupe).sort((a, b) => a[1] - b[1]);
    for (const [id] of entries.slice(0, entries.length - limit)) {
      delete state.dedupe[id];
      removed += 1;
    }
  }
  return removed;
}

function pruneRawFiles(rootDir, keepDays) {
  const days = Number(keepDays);
  if (!(days > 0) || !fs.existsSync(rootDir)) return 0;
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (!/^raw-errors-.*\.json$/i.test(ent.name)) continue;
      try {
        if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); removed += 1; }
      } catch (err) { /* 单个文件删除失败不影响主流程 */ }
    }
  };
  walk(rootDir);
  return removed;
}

module.exports = { MASK_RULES, maskSecrets, selfPrefixes, buildItem, pruneDedupe, pruneRawFiles };
