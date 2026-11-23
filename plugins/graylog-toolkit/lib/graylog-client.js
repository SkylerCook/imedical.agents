'use strict';
// Graylog 查询客户端：Views / legacy 两种搜索、异步轮询、分页与窗口切片、ERROR+慢请求两路并集。
// 只依赖连接对象与查询配置，不读写任何插件文件。

const { parseSlow } = require('./log-parse');

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

module.exports = {
  authHeaders, api, apiGet, waitSearchDone, buildSearchBody,
  searchLegacyPage, searchViewsPage, searchPage, collectPages, collectWindow,
  fetchWindow, fetchSlow, enrichTracePeers, computeWindow,
};
