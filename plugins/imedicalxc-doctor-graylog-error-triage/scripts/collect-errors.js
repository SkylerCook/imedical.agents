'use strict';
// Graylog 报错增量采集器（计划任务通道，直连 Views API）
// 采集范围：ERROR 报错 + 请求耗时 >= query.slowThresholdMs 的慢请求 WARN（两路并集，各自独立选择器）
// 水位线窗口 + ASC 分页 + 消息 id 去重 + traceId 邻域增强 + 原始 JSON 落盘
// 退出码: 0 成功（含 0 条新增）/ 1 取数或落盘失败 / 2 配置或连接不可用

const fs = require('node:fs');
const path = require('node:path');
const {
  PLUGIN_ROOT, loadConfig, resolvePath, pluginPath, resolveConnection, describeConnection,
} = require('./config-env');
const {
  normalizeMessage, parseStack, deriveErrorKey, extractUrls, parseSlow, deriveSlowKey,
} = require('./lib/log-parse');

const BOOLEAN_FLAGS = new Set(['check', 'dry-run', 'help']);

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

function localParts(d) {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hm: `${pad(d.getHours())}${pad(d.getMinutes())}`,
    hms: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    stamp: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
  };
}

function stateFile(cfg, envId) {
  const rel = (cfg.state || {}).file || 'config/graylog-triage-state.json';
  // 多个环境各注册一个计划任务时会同时触发，共用一个文件会互相覆盖水位线与去重表；
  // 配置里用 {env} 占位即可一环境一文件
  const name = rel.includes('{env}') ? rel.replace(/\{env\}/g, String(envId)) : rel;
  return pluginPath(name);
}

function loadState(cfg, envId) {
  const file = stateFile(cfg, envId);
  if (!fs.existsSync(file)) return { version: 1, envs: {}, dedupe: {} };
  try {
    // PowerShell 的 -Encoding UTF8 会写入 BOM，JSON.parse 遇 \uFEFF 会直接失败
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return { version: raw.version || 1, envs: raw.envs || {}, dedupe: raw.dedupe || {} };
  } catch (err) {
    // 读不到水位线就没有可信起点；按空状态跑会把水位线凭空推到 now，中间数据永久丢失
    console.error(`[FAIL] 状态文件无法解析，为避免误推水位线本轮中止: ${err.message}`);
    console.error(`       文件: ${file}`);
    console.error('       处理方式：删掉文件首行的 BOM 后重试；直接删除文件会退化为首轮，可能重复统计');
    process.exit(2);
  }
}

function saveState(cfg, state, envId) {
  const file = stateFile(cfg, envId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function authHeaders(conn) {
  if (conn.cookie) return { Cookie: `authentication=${conn.cookie}` };
  const basic = Buffer.from(`${conn.token}:token`).toString('base64');
  return { Authorization: `Basic ${basic}` };
}

async function api(conn, pathname, body) {
  const url = `${conn.url}/api${pathname}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-By': 'graylog-triage',
      ...authHeaders(conn),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graylog API ${res.status} ${pathname}: ${String(text).slice(0, 300)}`);
  }
  return res.json();
}

async function apiGet(conn, pathname) {
  const url = `${conn.url}/api${pathname}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      // 定制实例按 Accept 协商输出格式：给 application/json 才返回 JSON；
      // 缺省会被路由到 CSV writer，此时 fields 变必填且响应体不含 _id
      Accept: 'application/json',
      'X-Requested-By': 'graylog-triage',
      ...authHeaders(conn),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graylog API ${res.status} ${pathname}: ${String(text).slice(0, 300)}`);
  }
  return res.json();
}

// /views/search/{id}/execute 是异步接口：大数据量环境下它立刻返回 execution.done=false 与空 results，
// 真实结果要等任务跑完才出现在 results 里。
// 标准 Graylog 用 GET /views/search/{id}/status 轮询；部分定制实例没有这个路由（404），
// 但 execute 本身是幂等的，重复 POST 会返回当前执行状态。
// 所以两条入口都试，谁先给出 done=true 就用谁；status 一旦不可用就本次运行内不再尝试。
// 老环境（查询瞬间完成）首次即 done=true，此处直接放行，行为与修复前完全一致。
async function waitSearchDone(conn, searchId, first, timeoutMs = 45000) {
  const needPoll = first && first.execution && first.execution.done === false;
  if (!needPoll) return first;

  const deadline = Date.now() + timeoutMs;
  let snap = first;
  let attempt = 0;
  let useStatus = true;

  while (Date.now() < deadline) {
    attempt += 1;
    await new Promise((r) => setTimeout(r, attempt <= 3 ? 300 : 800));

    if (useStatus) {
      try {
        snap = await apiGet(conn, `/views/search/${searchId}/status`);
      } catch (err) {
        useStatus = false;
        console.warn(`[WARN] /views/search/{id}/status 不可用，改用重复 execute 轮询：${err.message}`);
      }
    }
    if (!useStatus) {
      snap = await api(conn, `/views/search/${searchId}/execute`, {});
    }

    const ex = snap && snap.execution;
    if (ex && ex.done === true) {
      if (ex.completed_exceptionally) {
        throw new Error(`views search ${searchId} 执行异常: ${JSON.stringify(ex.error || ex).slice(0, 300)}`);
      }
      return snap;
    }
    if (ex && ex.cancelled === true) throw new Error(`views search ${searchId} 已被取消`);
  }
  throw new Error(`views search ${searchId} 超过 ${timeoutMs}ms 仍未完成（异步执行超时）；请缩小窗口或降低 pageSize`);
}

function buildSearchBody(envCfg, queryCfg, { query, from, to, limit, offset, sort }) {
  const searchType = {
    type: 'messages',
    id: 'triage',
    limit,
    offset: offset || 0,
    sort: [{ field: 'timestamp', order: sort || 'ASC' }],
  };
  const fields = String(queryCfg.fields || '*').trim();
  if (fields && fields !== '*') searchType.fields = fields.split(',').map((f) => f.trim()).filter(Boolean);
  if (Array.isArray(envCfg.streamIds) && envCfg.streamIds.length) searchType.streams = envCfg.streamIds;
  return {
    queries: [{
      query: { query_string: query },
      timerange: { type: 'absolute', from, to },
      search_types: [searchType],
    }],
  };
}

// 部分实例的 Views 搜索是"异步执行 + 无 /status 轮询入口"（execute 返回 done=false，轮询直接 404），
// 完全取不到结果，这类实例只能走 legacy 同步接口。用 environments.<env>.apiMode 控制：
//   views（默认）= /views/search 提交后等 done；老环境同步返回，新环境需轮询
//   legacy       = /search/universal/absolute 同步取数，一次请求即返回 messages 与 total_results
// legacy 在 Graylog 3.x/4.x 存在、5.0 起移除；配错成 legacy 但不支持的实例会自动降级回 views。
// 降级标记挂在 searchPage / searchLegacyPage 函数自身，避免依赖模块级声明（编辑块局部应用时容易丢）。
async function searchLegacyPage(conn, envCfg, queryCfg, { query, from, to, limit, offset }) {
  const params = new URLSearchParams();
  params.set('query', query);
  params.set('from', from);
  params.set('to', to);
  params.set('limit', String(Math.min(Number(limit) || 500, 10000)));
  params.set('offset', String(offset || 0));
  // 该实例的 JSON 分支只认 <field>:<order> 形式，传 asc/ASC 一律 500 Invalid sorting parameter；
  // 若连这种形式也不被接受（searchLegacyPage.noSort），则完全不传，交给服务端默认排序，
  // 实际方向由 collectPages 从首尾 timestamp 实测得出，游标据此推进。
  const sortExpr = envCfg.legacySort === undefined ? 'timestamp:asc' : String(envCfg.legacySort);
  if (sortExpr && !searchLegacyPage.noSort) params.set('sort', sortExpr);
  const fields = String(queryCfg.fields || '*').trim();
  if (fields && fields !== '*') params.set('fields', fields);
  const data = await apiGet(conn, `/search/universal/absolute?${params.toString()}`);
  const messages = [];
  for (const item of data.messages || []) if (item && item.message) messages.push(item.message);
  // total_results 是 3.x/4.x 字段名，个别版本只给 total
  const rawTotal = data.total_results !== undefined ? data.total_results : data.total;
  return { messages, total: Number(rawTotal) || 0 };
}

async function searchViewsPage(conn, envCfg, queryCfg, opts) {
  const created = await api(conn, '/views/search', buildSearchBody(envCfg, queryCfg, opts));
  const executed = await api(conn, `/views/search/${created.id}/execute`, {});
  const result = await waitSearchDone(conn, created.id, executed);
  const messages = [];
  let total = 0;
  for (const queryResult of Object.values(result.results || {})) {
    for (const st of Object.values(queryResult.search_types || {})) {
      if (st.error) {
        const detail = typeof st.error === 'string' ? st.error : JSON.stringify(st.error);
        console.warn(`[WARN] search type ${st.id || '?'} 返回错误: ${String(detail).slice(0, 300)}`);
      }
      if (Array.isArray(st.messages)) {
        for (const m of st.messages) if (m && m.message) messages.push(m.message);
      }
      if (typeof st.total_results === 'number') total = Math.max(total, st.total_results);
    }
  }
  return { messages, total };
}

async function searchPage(conn, envCfg, queryCfg, opts) {
  // apiMode：
  //   views（默认）= /views/search 提交后等 done；老环境同步返回，新环境需轮询
  //   legacy       = /search/universal/absolute 同步取数，一次请求即返回 messages 与 total_results
  const mode = String((envCfg && envCfg.apiMode) || 'views').toLowerCase();
  if (mode !== 'legacy') return searchViewsPage(conn, envCfg, queryCfg, opts);

  // 配了 legacy 但该实例其实没有这个路由（如 Graylog 5.x）：本次运行内降级到 views，
  // 避免一处配置失误让整轮巡检静默失效。
  if (searchPage.legacyBroken) return searchViewsPage(conn, envCfg, queryCfg, opts);

  try {
    return await searchLegacyPage(conn, envCfg, queryCfg, opts);
  } catch (err) {
    const msg = String(err.message || '');
    // sort 参数不被接受：去掉 sort 重试一次，之后本进程都不再传
    if (/invalid sorting parameter/i.test(msg) && !searchLegacyPage.noSort) {
      searchLegacyPage.noSort = true;
      console.warn(`[WARN] legacy 不接受 sort 参数（${msg.slice(-60)}），改用服务端默认排序`);
      return searchLegacyPage(conn, envCfg, queryCfg, opts);
    }
    const fatal = /\b(404|405)\b/.test(msg) || /searchAbsoluteChunked/i.test(msg);
    if (!fatal) throw err;
    searchPage.legacyBroken = true;
    console.warn(`[WARN] legacy 搜索不可用（${msg}），本次运行降级到 views；请检查该环境的 apiMode 配置`);
    return searchViewsPage(conn, envCfg, queryCfg, opts);
  }
}

async function collectPages(conn, envCfg, queryCfg, query, win, cap) {
  const pageSize = Math.min(Number(envCfg.pageSize) || 500, 10000);
  const maxPages = Math.max(1, Math.ceil(cap / pageSize)) + 2;
  const collected = [];
  const seen = new Set();
  let offset = 0;
  let total = 0;
  let idlePages = 0;
  let truncated = false;
  let truncateReason = '';
  // legacy 不传 sort 时方向由服务端决定，用首页首尾 timestamp 实测，供 collectWindow 决定游标方向
  let order = 'asc';

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await searchPage(conn, envCfg, queryCfg, {
      query, from: win.from.toISOString(), to: win.to.toISOString(),
      limit: pageSize, offset, sort: 'ASC',
    });
    total = Math.max(total, page.total);

    if (pageIndex === 0 && page.messages.length >= 2) {
      const firstMs = Date.parse(page.messages[0].timestamp);
      const lastMs = Date.parse(page.messages[page.messages.length - 1].timestamp);
      if (Number.isFinite(firstMs) && Number.isFinite(lastMs)) order = firstMs <= lastMs ? 'asc' : 'desc';
    }

    if (page.messages.length === 0) {
      // 服务端说还有 total 条却返回空页，通常是被 ES max_result_window 拒了，不能当取尽
      if (total > offset) { truncated = true; truncateReason = 'empty-page'; }
      else { truncateReason = 'exhausted'; }
      break;
    }

    const before = collected.length;
    for (const m of page.messages) {
      const id = String(m._id || m.id || '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      collected.push(m);
    }

    if (collected.length === before) {
      idlePages += 1;
      console.warn(`[WARN] 第 ${pageIndex + 1} 页未产生新消息，连续 ${idlePages} 页（服务端 offset 可能未生效）`);
      if (idlePages >= 2) { truncated = true; truncateReason = 'offset-stuck'; break; }
    } else {
      idlePages = 0;
    }

    offset += page.messages.length;
    // offset 覆盖到 total 说明窗口内的消息已经取尽，不是截断
    if (total > 0 && offset >= total) { truncateReason = 'exhausted'; break; }
    if (collected.length >= cap) { truncated = true; truncateReason = 'cap'; break; }
    if (pageIndex === maxPages - 1) { truncated = true; truncateReason = 'page-guard'; }
  }

  return { messages: collected, total, truncated, truncateReason, order };
}

// ES 的 index.max_result_window 默认 10000，offset 越过它会被静默拒绝；
// 单片预算压在 9000 以内，取不完就把起点推到已取最后一条 +1ms 续取
async function collectWindow(conn, envCfg, queryCfg, query, win, cap) {
  const budgetPerSlice = Math.min(Number(envCfg.sliceBudget) || 8000, 9000);
  const maxSlices = Math.max(1, Number(envCfg.maxSlicesPerRun) || 4);
  const out = [];
  const seen = new Set();
  let total = 0;
  let reason = '';
  let from = win.from;
  let to = win.to;

  for (let slice = 0; slice < maxSlices; slice += 1) {
    const remain = cap - out.length;
    if (remain <= 0) { reason = 'cap'; break; }

    const sliceCap = Math.min(remain, budgetPerSlice);
    const r = await collectPages(conn, envCfg, queryCfg, query, { from, to }, sliceCap);
    if (slice === 0) total = r.total;

    for (const m of r.messages) {
      const id = String(m._id || m.id || '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(m);
    }

    if (!r.truncated) { reason = 'exhausted'; break; }

    const last = r.messages[r.messages.length - 1];
    const lastMs = last ? Date.parse(last.timestamp) : NaN;
    if (!Number.isFinite(lastMs)) { reason = 'no-cursor'; break; }
    // asc 时最后一条是最新，推进起点；desc 时最后一条是最旧，推进终点
    if (r.order === 'desc') {
      const nextMs = lastMs - 1;
      if (nextMs >= to.getTime()) { reason = 'no-progress'; break; }
      to = new Date(nextMs);
    } else {
      const nextMs = lastMs + 1;
      if (nextMs <= from.getTime()) { reason = 'no-progress'; break; }
      from = new Date(nextMs);
    }
    reason = 'window-sliced';
  }

  const truncated = total > 0 && out.length < total;
  return { messages: out, total, truncated, truncateReason: truncated ? reason : 'exhausted' };
}

async function fetchWindow(conn, envCfg, cfg, win, capOverride) {
  const q = cfg.query || {};
  const cap = capOverride || Number(envCfg.maxMessagesPerRun) || 12000;
  const selectors = [q.errorSelector, q.fallbackSelector].filter(Boolean);
  let lastErr = null;
  let errResult = null;

  for (const selector of selectors) {
    const query = [selector, q.extraFilter].filter(Boolean).join(' AND ');
    try {
      const r = await collectWindow(conn, envCfg, q, query, win, cap);
      if (r.messages.length > 0 || selector === selectors[selectors.length - 1]) {
        errResult = { ...r, queryUsed: query, cap };
        break;
      }
      console.log(`[INFO] 查询「${query}」无结果，回退到下一个选择器`);
    } catch (err) {
      lastErr = err;
      console.warn(`[WARN] 查询「${query}」失败: ${err.message}`);
    }
  }
  if (!errResult) throw lastErr || new Error('所有查询选择器均失败');

  const slow = await fetchSlow(conn, envCfg, q, win, cap);
  return { ...errResult, slow };
}

// 慢请求与 ERROR 是并集，不是回退：ERROR 选择器命中后仍要跑这一路。
// 慢请求日志是 LogFilter 打的 WARN，带接口全限定名与耗时毫秒数，没有堆栈帧。
async function fetchSlow(conn, envCfg, q, win, cap) {
  const thresholdMs = Number(q.slowThresholdMs) > 0 ? Number(q.slowThresholdMs) : 15000;
  const base = {
    thresholdMs, queryUsed: '', total: 0, fetched: 0, kept: 0,
    messages: [], truncated: false, truncateReason: 'exhausted',
  };
  if (!q.slowSelector) return { ...base, disabled: true };
  const query = [q.slowSelector, q.extraFilter].filter(Boolean).join(' AND ');
  try {
    const r = await collectWindow(conn, envCfg, q, query, win, Math.min(cap, 2000));
    const kept = r.messages.filter((m) => {
      const p = parseSlow(m.full_message || m.message || '');
      return p && p.durationMs >= thresholdMs;
    });
    return {
      ...base, queryUsed: query, total: r.total, fetched: r.messages.length,
      kept: kept.length, messages: kept, truncated: r.truncated, truncateReason: r.truncateReason,
      lastTs: r.messages.length > 0 ? r.messages[r.messages.length - 1].timestamp : '',
    };
  } catch (err) {
    // 慢请求取数失败不该让整轮 ERROR 采集作废，但必须留痕，不能静默丢一路数据
    console.warn(`[WARN] 慢请求查询「${query}」失败，本轮只有 ERROR: ${err.message}`);
    return { ...base, queryUsed: query, error: err.message };
  }
}

async function enrichTracePeers(conn, envCfg, cfg, items, win) {
  const q = cfg.query || {};
  if (q.traceLookup === false) return new Map();
  const ids = [...new Set(items.map((i) => i.traceId).filter(Boolean))]
    .slice(0, Number(q.maxTraceLookups) || 20);
  const peers = new Map();

  for (const id of ids) {
    try {
      const r = await searchPage(conn, envCfg, q, {
        query: `traceId:${id}`, from: win.from.toISOString(), to: win.to.toISOString(),
        limit: 200, offset: 0, sort: 'ASC',
      });
      const apps = new Map();
      for (const m of r.messages) {
        const appName = String(m.app_name || m.application || '') || '(未标注)';
        const cur = apps.get(appName) || { appName, count: 0, hasError: false };
        cur.count += 1;
        const lvl = String(m.level_name || m.level || '').toUpperCase();
        if (lvl.includes('ERROR') || lvl === '3') cur.hasError = true;
        apps.set(appName, cur);
      }
      peers.set(id, [...apps.values()]);
    } catch (err) {
      console.warn(`[WARN] traceId ${id} 邻域查询失败，跳过: ${err.message}`);
      peers.set(id, []);
    }
  }
  return peers;
}

function computeWindow(envCfg, envState, now) {
  const overlapMs = (Number(envCfg.overlapSeconds) || 120) * 1000;
  const lookbackMin = Number(envCfg.initialLookbackMinutes) || (Number(envCfg.intervalMinutes) || 30) * 2;
  if (!envState.cursor) {
    return { from: new Date(now - lookbackMin * 60000), to: new Date(now), initial: true };
  }
  const cursorMs = Date.parse(envState.cursor);
  const fromMs = Number.isFinite(cursorMs) ? cursorMs - overlapMs : now - lookbackMin * 60000;
  return { from: new Date(Math.min(fromMs, now)), to: new Date(now), initial: false };
}

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();

  if (args.env === true) {
    console.error('[ERROR] --env 缺少取值，示例：--env 87 或 --env=87');
    process.exit(2);
  }
  const envId = String(args.env || cfg.defaultEnv || '87');
  const envCfg = (cfg.environments || {})[envId];

  if (!envCfg) {
    console.error(`[ERROR] 未配置环境 ${envId}（见 config/graylog-triage.json 的 environments）`);
    process.exit(2);
  }
  if (envCfg.enabled === false) {
    console.log(`[SKIP] 环境 ${envId} 已禁用（environments.${envId}.enabled=false）`);
    process.exit(0);
  }

  const conn = resolveConnection(cfg, envId, { mcpConfig: args['mcp-config'] });

  if (args.check) {
    console.log(JSON.stringify({ env: envId, ...describeConnection(conn) }, null, 2));
    process.exit(conn.status === 'ready' ? 0 : 2);
  }
  if (conn.status !== 'ready') {
    console.error(`[ERROR] 连接不可用（${conn.status}）：${conn.detail}`);
    console.error('        先完成 IDE mcp.json 的 graylog-<env> 注册，或设置 GRAYLOG_<env>_URL / _TOKEN 环境变量');
    process.exit(2);
  }

  const now = Date.now();
  const state = loadState(cfg, envId);
  const envState = state.envs[envId] || {};
  const win = computeWindow(envCfg, envState, now);
  const runAt = new Date(now);
  const parts = localParts(runAt);
  const runId = `${envId}-${parts.stamp}`;

  console.log(`[INFO] 环境 ${envId} 窗口 ${win.from.toISOString()} → ${win.to.toISOString()}（${win.initial ? '首轮' : '增量'}，重叠 ${envCfg.overlapSeconds}s）`);

  let result;
  try {
    result = await fetchWindow(conn, envCfg, cfg, win, numArg(args.limit, 0));
  } catch (err) {
    console.error(`[FAIL] 取数失败，水位线保持不变: ${err.message}`);
    state.envs[envId] = { ...envState, lastRunAt: runAt.toISOString(), lastRunId: runId, lastError: err.message };
    if (!args['dry-run']) saveState(cfg, state, envId);
    process.exit(1);
  }

  const slow = result.slow || { messages: [], thresholdMs: 15000 };
  const slowRaw = Array.isArray(slow.messages) ? slow.messages : [];
  const peerMap = await enrichTracePeers(
    conn, envCfg, cfg, result.messages.concat(slowRaw).map((m) => normalizeMessage(m)), win,
  );

  if (result.truncated) {
    const missed = Math.max(0, (result.total || 0) - result.messages.length);
    console.warn(`[WARN] 本轮触达采集上限（${result.truncateReason}）：窗口内命中 ${result.total} 条，仅取回 ${result.messages.length} 条，缺口 ${missed} 条顺延下一轮`);
  }
  if (slow.truncated) {
    console.warn(`[WARN] 慢请求触达采集上限（${slow.truncateReason}）：命中 ${slow.total} 条，仅取回 ${slow.fetched} 条，水位线按已取位置推进`);
  }
  if (slow.error) console.warn(`[WARN] 本轮慢请求缺失（ERROR 采集不受影响）: ${slow.error}`);

  const items = [];
  let duplicateCount = 0;
  const pushItem = (raw, kind) => {
    const item = buildItem(raw, cfg, { kind });
    if (item.traceId && peerMap.has(item.traceId)) item.tracePeers = peerMap.get(item.traceId);
    if (item.id && state.dedupe[item.id]) { duplicateCount += 1; return; }
    items.push(item);
    if (item.id) state.dedupe[item.id] = now;
  };
  for (const raw of result.messages) pushItem(raw, 'error');
  for (const raw of slowRaw) pushItem(raw, 'slow');

  const pruned = pruneDedupe(
    state,
    { hours: (cfg.state || {}).dedupeTtlHours, days: (cfg.state || {}).dedupeTtlDays },
    (cfg.state || {}).dedupeMaxEntries,
  );
  const hashCount = new Map();
  for (const it of items) {
    if (it.kind === 'slow') continue;
    hashCount.set(it.errorHash, (hashCount.get(it.errorHash) || 0) + 1);
  }
  const exceptionTop = [...hashCount.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([key, count]) => ({ errorHash: key, count }));

  const slowAgg = new Map();
  for (const it of items) {
    if (it.kind !== 'slow') continue;
    const cur = slowAgg.get(it.errorHash) || {
      errorHash: it.errorHash, interfaceName: it.interfaceName, count: 0, maxMs: 0,
    };
    cur.count += 1;
    cur.maxMs = Math.max(cur.maxMs, Number(it.durationMs) || 0);
    slowAgg.set(it.errorHash, cur);
  }
  const slowTop = [...slowAgg.values()].sort((a, b) => b.maxMs - a.maxMs).slice(0, 10);
  const slowNewCount = items.filter((it) => it.kind === 'slow').length;

  const payload = {
    runId, env: envId, generatedAt: runAt.toISOString(),
    window: { from: win.from.toISOString(), to: win.to.toISOString(), initial: win.initial },
    queryUsed: result.queryUsed,
    slowQueryUsed: slow.queryUsed || '',
    slow: {
      thresholdMs: slow.thresholdMs,
      total: slow.total || 0,
      fetched: slow.fetched || 0,
      kept: slow.kept || 0,
      newCount: slowNewCount,
      truncated: Boolean(slow.truncated),
      truncateReason: slow.truncateReason || '',
      disabled: Boolean(slow.disabled),
      error: slow.error || '',
    },
    total: result.total, fetched: result.messages.length, cap: result.cap,
    newCount: items.length, duplicateCount,
    truncated: result.truncated, truncateReason: result.truncateReason,
    dedupePruned: pruned, dedupeSize: Object.keys(state.dedupe).length,
    exceptionTop, slowTop, items,
  };

  const truncNote = result.truncated ? `（截断:${result.truncateReason}）` : '';
  console.log(`[INFO] 报错命中 ${result.total} 条，取回 ${result.messages.length} 条${truncNote}`);
  if (slow.disabled) {
    console.log('[INFO] 慢请求采集未启用（query.slowSelector 为空）');
  } else {
    console.log(`[INFO] 慢请求（>=${Math.round((slow.thresholdMs || 15000) / 1000)}s）命中 ${slow.total || 0} 条，取回 ${slow.fetched || 0} 条，达标 ${slow.kept || 0} 条`);
  }
  console.log(`[INFO] 本轮新增 ${items.length} 条（报错 ${items.length - slowNewCount} / 慢请求 ${slowNewCount}），重叠重复 ${duplicateCount} 条`);

  const outDir = resolvePath(cfg, path.join((cfg.output || {}).dir || 'docs/agent-reports/graylog-triage', envId, parts.date));
  const outFile = path.join(outDir, `raw-errors-${parts.hm}.json`);

  if (args['dry-run']) {
    console.log(`[DRY-RUN] 不落盘、不推进水位线；原本将写入 ${outFile}`);
    console.log(JSON.stringify({ ...payload, items: payload.items.slice(0, 3) }, null, 2));
    process.exit(0);
  }

  try {
    fs.mkdirSync(outDir, { recursive: true });
    if (fs.existsSync(outFile) && (cfg.output || {}).preserveExisting !== false) {
      console.warn(`[WARN] 本轮文件已存在，覆盖写入（同为 ${parts.hm} 分的时间窗）: ${outFile}`);
    }
    fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error(`[FAIL] 落盘失败，水位线保持不变: ${err.message}`);
    state.envs[envId] = { ...envState, lastRunAt: runAt.toISOString(), lastRunId: runId, lastError: `write: ${err.message}` };
    saveState(cfg, state, envId);
    process.exit(1);
  }

  let nextCursor = win.to.toISOString();
  let cursorNote = '推进到窗口结束';
  const truncLastTs = [];
  if (result.truncated && result.messages.length > 0) {
    truncLastTs.push(result.messages[result.messages.length - 1].timestamp);
  }
  if (slow.truncated && slow.lastTs) truncLastTs.push(slow.lastTs);
  if (truncLastTs.length > 0) {
    // 两路取更早的那个：只按一路推进会把另一路没取完的数据甩在水位线之后，永久丢失
    const lastMs = Date.parse(truncLastTs.filter(Boolean).sort()[0]);
    if (Number.isFinite(lastMs)) {
      nextCursor = new Date(lastMs + 1).toISOString();
      cursorNote = '截断，推进到两路中更早的已取最后一条 +1ms';
    }
  }

  const nextMs = Date.parse(nextCursor);
  const lagSeconds = Number.isFinite(nextMs) ? Math.max(0, Math.round((now - nextMs) / 1000)) : 0;

  state.envs[envId] = {
    ...envState,
    cursor: nextCursor,
    lastRunAt: runAt.toISOString(),
    lastRunId: runId,
    lastRawFile: outFile,
    lastError: '',
    lagSeconds,
    dedupeSize: Object.keys(state.dedupe).length,
  };
  saveState(cfg, state, envId);

  const rawRoot = resolvePath(cfg, (cfg.output || {}).dir || 'docs/agent-reports/graylog-triage');
  const rawPruned = pruneRawFiles(rawRoot, (cfg.output || {}).rawKeepDays);

  console.log(`[OK] 原始数据: ${outFile}`);
  console.log(`[OK] 水位线: ${nextCursor}（${cursorNote}）`);
  if (lagSeconds >= 60) {
    console.warn(`[WARN] 水位线落后实时约 ${Math.round(lagSeconds / 60)} 分钟；持续落后说明单轮采集能力不足，需提高 environments.${envId}.maxMessagesPerRun 或缩短采集间隔`);
  }
  if (rawPruned > 0) console.log(`[INFO] 清理过期原始数据 ${rawPruned} 个（output.rawKeepDays=${(cfg.output || {}).rawKeepDays}）`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[FAIL] 采集异常: ${err.message}`);
  process.exit(1);
});