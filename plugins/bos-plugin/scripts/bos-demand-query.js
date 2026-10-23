#!/usr/bin/env node
'use strict';

// Narrow read-only adapter for the MCP 2024-11-05 HTTP+SSE transport.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const personal = require('./personal-config');
const fields = 'id title content source status type sgroup tgroup cgroup suser tuser cuser datetype date date2 product mod'.split(' ');
const upstreamTool = 'post_imedway_ylxt_bosdata';
const scopeFields = ['suser', 'tuser', 'cuser', 'sgroup', 'tgroup', 'cgroup'];
const descriptions = {
  explain: '上游字段说明参数；默认 0，其它非空值原样交给上游解释，返回值不做本地列表处理。',
  id: '需求编号；按编号查询忽略其他筛选条件，不保证属于默认当前人。',
  title: '需求标题关键字', content: '需求描述关键字', source: '需求来源', status: '需求状态',
  type: '需求类型', suser: '发起人', tuser: '接受人',
  cuser: '当前人；省略时使用 BOS_CUSER 或本机配置默认值，显式空字符串清除默认当前人。',
  sgroup: '发起组名称；作为额外条件，与个人所在的当前组 cgroup 独立，省略或空字符串表示不限发起组。',
  tgroup: '接受组',
  cgroup: '个人所在的当前组；省略时使用 BOS_CGROUP 或本机配置 cgroup，显式空字符串查询全部组。',
  datetype: '创建时间、预计完成时间、执行时间、分配时间或操作时间；通用模式默认创建时间，todo/workload 按各自固定日期口径。',
  date: '起始日期 YYYY-MM-DD；workload 必填执行日期，todo 可省略查全部，提供时按预计完成时间；通用模式按原日期规则。',
  date2: '截止日期 YYYY-MM-DD；todo/workload 省略时等于 date，范围包含截止日；通用模式端点由上游决定。',
  product: '产品', mod: '产品模块'
};
const queryOptions = {
  sourceScope: { type: 'string', enum: ['all', 'project', 'non-project'], description: '个人查询来源口径：all 不限；project 为项目；non-project 为产品（所有非项目来源）。省略 mode 时默认 todo，不发送到上游。' },
  mode: { type: 'string', enum: ['list', 'pending', 'project-pending', 'history', 'todo', 'workload'], description: 'todo 为本人开发待办，日期可省略，提供时按预计完成时间；workload 为本人工作量，必须提供执行日期。旧 pending/project-pending/history 保留原口径。' },
  timezone: { type: 'string', description: '默认日期截止日使用的 IANA 时区；默认 Asia/Shanghai，可按用户时区覆盖。' },
  sort: { type: 'string', enum: ['创建时间', '预计完成时间', '执行时间'], description: '列表排序字段；默认创建时间，todo 默认预计完成时间，workload 默认执行时间；同日需求号升序。' },
  order: { type: 'string', enum: ['asc', 'desc'], description: '日期排序方向；默认 asc，缺失或无效日期置后。' }
};
const pendingExcludedStatuses = new Set(['完成', '取消', '已拆分']);
const workExcludedStatuses = new Set(['取消', '已拆分', '回置']);
const todoStatuses = new Set(['新建', '分配', '分配(开发)', '活动', '修正']);
const handedOffStatuses = new Set(['测试分配', '组内测试', '测试完成', '更新完成', '挂起']);
const tool = {
  name: 'bos_demand_query', description: '只读查询 BOS 需求。todo 为个人开发待办，日期可省略，提供时按预计完成时间；workload 按必填执行日期统计工作量。两者组合接受人/当前人/状态并单列未知组合。原人员/组列表、pending/history、编号详情及字段说明继续可用，不保证上游无截断。',
  inputSchema: { type: 'object', properties: { ...Object.fromEntries(Object.entries(descriptions).map(([key, description]) => [key, { type: 'string', description }])), body: { type: 'object', description: '上游可选对象，内部结构未声明；仅透传调用者明确提供的 JSON 对象。' }, ...queryOptions }, additionalProperties: false }
};

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function nextDay(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const result = date.toISOString().slice(0, 10);
  if (!validDate(result)) throw new Error('截止日期超出支持范围');
  return result;
}

function localToday(timezone, now) {
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    return ['year', 'month', 'day'].map(key => parts.find(item => item.type === key).value).join('-');
  } catch { throw new Error('timezone 必须为有效 IANA 时区'); }
}

function preparePersonalQuery(input, defaultUser, now) {
  const mode = input.mode;
  const sourceScope = input.sourceScope ?? 'all';
  if (!queryOptions.sourceScope.enum.includes(sourceScope)) throw new Error('sourceScope 必须为 all、project 或 non-project');
  const source = input.source?.trim() || '';
  if ((sourceScope === 'project' && source && source !== '项目') || (sourceScope === 'non-project' && source === '项目')) throw new Error('source 与来源口径冲突，不能扩大或替换查询条件');
  const subject = (input.tuser ?? defaultUser ?? '').trim();
  if (!subject || /^TODO$/i.test(subject)) throw new Error('个人待办/工作量需已配置的本人身份，或明确提供 tuser；不能使用 TODO');
  const dated = Object.hasOwn(input, 'date') || Object.hasOwn(input, 'date2');
  if (mode === 'workload' && !dated) throw new Error('workload 必须提供执行日期或日期范围');
  const dateField = mode === 'workload' ? '执行时间' : '预计完成时间';
  const timezone = input.timezone || 'Asia/Shanghai';
  const today = localToday(timezone, now);
  const date = input.date;
  const end = input.date2 ?? date;
  if (dated && (!validDate(date) || !validDate(end))) throw new Error('需提供有效 date 和 date2，格式 YYYY-MM-DD');
  if (dated && end < date) throw new Error('截止日期不得早于起始日期');
  const fixed = { cuser: mode === 'todo' ? subject : '', cgroup: '', datetype: dated ? dateField : '创建时间' };
  for (const [key, value] of Object.entries(fixed)) {
    if (Object.hasOwn(input, key) && input[key] !== value) throw new Error(`${mode} 的 ${key} 固定为 ${value || '空字符串'}；其它口径使用 list/history`);
  }
  const sort = input.sort || dateField;
  const order = input.order || 'asc';
  if (!queryOptions.sort.enum.includes(sort) || !queryOptions.order.enum.includes(order)) throw new Error('sort 或 order 无效');
  const args = Object.fromEntries(fields.map(key => [key, input[key] ?? '']));
  Object.assign(args, fixed, { tuser: subject, explain: '0', date: dated ? date : '1900-01-01', date2: nextDay(dated ? end : today) });
  if (sourceScope === 'project') args.source = '项目';
  if (scopeFields.some(key => /^TODO$/i.test(args[key].trim()))) throw new Error('查询身份尚未配置；不能使用 TODO 查询');
  if (Object.hasOwn(input, 'body')) args.body = input.body;
  return { args, mode, subject, sort, order, timezone, pendingApplied: false,
    personal: { dateField, range: dated ? { date, date2: end, inclusive: true } : null, sourceScope,
      sourceBasis: sourceScope === 'project' ? '来源=项目'
        : sourceScope === 'non-project' ? `产品（非项目）：来源非空且不等于项目${source ? `；另限来源=${source}` : ''}`
          : source ? `来源=${source}` : '来源不限' } };
}

function parsePersonalCli(argv) {
  let mode, sourceScope;
  const values = [];
  for (const token of argv) {
    if (token === '--todo' || token === '--workload') {
      if (mode) throw new Error('--todo / --workload 不可重复或同时使用');
      mode = token.slice(2);
    } else if (token === '--proj' || token === '--dev') {
      if (sourceScope) throw new Error('--proj / --dev 不可重复或同时使用');
      sourceScope = token === '--proj' ? 'project' : 'non-project';
    } else if (token.startsWith('--')) throw new Error('未知个人查询参数');
    else values.push(token);
  }
  mode ||= 'todo';
  if (values.length > 2) throw new Error('日期参数过多；使用单日、起止两日或 YYYY-MM-DD~YYYY-MM-DD');
  const dates = values.length === 1 ? values[0].split('~') : values;
  if (dates.length > 2 || dates.some(value => !validDate(value))) throw new Error('日期格式应为 YYYY-MM-DD 或 YYYY-MM-DD~YYYY-MM-DD');
  if (!dates.length && mode === 'workload') throw new Error('--workload 必须提供执行日期或日期范围');
  if (dates.length === 2 && dates[1] < dates[0]) throw new Error('截止日期不得早于起始日期');
  return { mode, ...(sourceScope ? { sourceScope } : {}), ...(dates.length ? { date: dates[0], date2: dates[1] ?? dates[0] } : {}) };
}

function personalDecision(row, plan) {
  const value = key => String(row[key] ?? '').trim();
  const status = value('状态');
  const receiver = value('接受人'), current = value('当前人');
  if (!receiver || !current || !status) return 'unclassified';
  if (receiver !== plan.subject) return 'other-receiver';
  if (workExcludedStatuses.has(status)) return 'non-work';
  if (plan.personal.sourceScope !== 'all') {
    const source = value('来源');
    if (typeof row['来源'] !== 'string' || !source) return 'unclassified';
    if ((source === '项目') !== (plan.personal.sourceScope === 'project')) return 'outside-source';
  }
  const day = value(plan.personal.dateField).slice(0, 10);
  const range = plan.personal.range;
  if (range && (!validDate(day) || day < range.date || day > range.date2)) return 'outside-date';
  if (status === '完成') return plan.mode === 'workload' ? 'include' : 'closed';
  if (current === plan.subject && todoStatuses.has(status)) return plan.mode === 'todo' ? 'include' : 'still-owned';
  if (current !== plan.subject && handedOffStatuses.has(status)) return plan.mode === 'workload' ? 'include' : 'handed-off';
  return 'unclassified';
}

function prepareQuery(input, defaultUser = '', defaultGroup = '', now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('查询参数必须为对象');
  for (const [key, value] of Object.entries(input)) {
    if (key === 'body') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body 必须为 JSON 对象');
      continue;
    }
    if ((!Object.hasOwn(descriptions, key) && !Object.hasOwn(queryOptions, key)) || typeof value !== 'string') throw new Error('查询参数名称或类型无效');
  }
  const args = Object.fromEntries(fields.map(key => [key, '']));
  args.explain = Object.hasOwn(input, 'explain') ? input.explain : '0';
  if (Object.hasOwn(input, 'body')) args.body = input.body;
  if (input.id) {
    if (!/^\d+$/.test(input.id)) throw new Error('需求编号必须是数字');
    args.id = input.id;
    return { args, mode: 'detail' };
  }
  if (args.explain && args.explain !== '0') {
    for (const key of Object.keys(descriptions)) if (Object.hasOwn(input, key)) args[key] = input[key];
    return { args, mode: 'explain' };
  }
  const selectedMode = input.mode || (Object.hasOwn(input, 'sourceScope') ? 'todo' : 'list');
  if (selectedMode === 'todo' || selectedMode === 'workload') return preparePersonalQuery({ ...input, mode: selectedMode }, defaultUser, now);
  if (Object.hasOwn(input, 'sourceScope')) throw new Error('sourceScope 仅用于 todo / workload，普通来源精确筛选请使用 source');
  const mode = input.mode || 'list';
  const sort = input.sort || '创建时间';
  const order = input.order || 'asc';
  if (!queryOptions.mode.enum.includes(mode) || !queryOptions.sort.enum.includes(sort) || !queryOptions.order.enum.includes(order)) throw new Error('mode、sort 或 order 无效');
  for (const key of Object.keys(descriptions)) if (Object.hasOwn(input, key)) args[key] = input[key];
  args.cuser = (Object.hasOwn(input, 'cuser') ? input.cuser : defaultUser).trim();
  args.cgroup = (Object.hasOwn(input, 'cgroup') ? input.cgroup : defaultGroup).trim();
  const explicitScope = scopeFields.some(key => Object.hasOwn(input, key) && input[key].trim());
  if (!Object.hasOwn(input, 'cuser') && !args.cuser && !explicitScope) throw new Error('请提供 cuser，或设置 BOS_CUSER / 本机配置 cuser；按其它人员或组查询时明确提供条件');
  if (scopeFields.some(key => /^TODO$/i.test(args[key].trim()))) throw new Error('查询身份尚未配置；运行 bos-init 或明确提供人员/组条件，不能使用 TODO 查询');
  if (!scopeFields.some(key => args[key].trim())) throw new Error('列表查询至少需一个人员或组条件（suser、tuser、cuser、sgroup、tgroup、cgroup）');
  const pending = mode === 'pending' || mode === 'project-pending';
  if (pending && !Object.hasOwn(input, 'cgroup') && !args.cgroup) throw new Error('待办需配置个人所在组 cgroup；明确跨组查询时传 cgroup 空字符串');
  if (mode === 'project-pending') {
    if (Object.hasOwn(input, 'source') && input.source !== '项目') throw new Error('project-pending 的 source 必须为项目；其它来源使用 pending');
    args.source = '项目';
  }
  const timezone = input.timezone || 'Asia/Shanghai';
  const today = localToday(timezone, now);
  if (mode !== 'list' && !Object.hasOwn(input, 'date') && !Object.hasOwn(input, 'date2')) {
    if (input.datetype && input.datetype !== '创建时间') throw new Error('非创建时间查询需明确 date 和 date2');
    args.date = '1900-01-01';
    args.date2 = today;
  }
  for (const key of ['date', 'date2']) {
    const value = args[key];
    if (!validDate(value)) throw new Error('列表查询需提供有效 date 和 date2');
  }
  if (args.date2 < args.date) throw new Error('截止日期不得早于起始日期');
  args.datetype ||= '创建时间';
  if (!['创建时间', '预计完成时间', '执行时间', '分配时间', '操作时间'].includes(args.datetype)) throw new Error('datetype 无效');
  return { args, mode, sort, order, timezone, pendingApplied: pending && !args.status.trim() };
}

function queryArguments(input, defaultUser = '', defaultGroup = '', now = new Date()) {
  return prepareQuery(input, defaultUser, defaultGroup, now).args;
}

function processList(result, plan) {
  if (plan.mode === 'detail' || plan.mode === 'explain' || result.isError) return result;
  const lists = [];
  result.content.forEach((item, index) => {
    if (item.type !== 'text') return;
    try {
      const data = JSON.parse(item.text);
      if (data && Array.isArray(data.data)) lists.push({ data, index });
    } catch { /* Other MCP content is preserved. */ }
  });
  if (lists.length !== 1) throw new Error('BOS 列表结构无效；未执行过滤和排序');
  const { data, index } = lists[0];
  if (data.data.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('BOS 列表行结构无效');
  const returnedCount = data.data.length;
  const reasons = {};
  const unclassified = [];
  const rows = data.data.filter(row => {
    if (!plan.personal) return !plan.pendingApplied || !pendingExcludedStatuses.has(String(row['状态'] ?? '').trim());
    const reason = personalDecision(row, plan);
    if (reason === 'include') return true;
    reasons[reason] = (reasons[reason] || 0) + 1;
    if (reason === 'unclassified') unclassified.push(row);
    return false;
  });
  const sortDate = row => {
    const value = typeof row[plan.sort] === 'string' ? row[plan.sort].trim().slice(0, 10) : '';
    return validDate(value) ? value : '';
  };
  const demandId = row => /^\d+$/.test(String(row['需求号'] ?? '')) ? BigInt(row['需求号']) : null;
  rows.sort((a, b) => {
    const ad = sortDate(a), bd = sortDate(b);
    if (!ad || !bd) { if (ad !== bd) return ad ? -1 : 1; }
    else if (ad !== bd) return (ad < bd ? -1 : 1) * (plan.order === 'desc' ? -1 : 1);
    const ai = demandId(a), bi = demandId(b);
    if (ai === bi) return 0;
    if (ai === null || bi === null) return ai === null ? 1 : -1;
    return ai < bi ? -1 : 1;
  });
  const statuses = new Map();
  for (const row of rows) {
    const status = String(row['状态'] ?? '').trim() || '（缺失）';
    statuses.set(status, (statuses.get(status) || 0) + 1);
  }
  return {
    ...result,
    content: result.content.map((item, i) => i === index ? { ...item, text: JSON.stringify({ ...data, data: rows }) } : item),
    _meta: {
      ...result._meta,
      bosDemandQuery: {
        mode: plan.mode, filters: plan.args, timezone: plan.timezone, sort: plan.sort, order: plan.order,
        returnedCount, includedCount: rows.length, excludedCount: returnedCount - rows.length,
        pendingApplied: plan.pendingApplied, provisionalPendingRule: !!plan.pendingApplied,
        excludedStatuses: plan.pendingApplied ? [...pendingExcludedStatuses] : [], statuses: Object.fromEntries(statuses),
        missingSortDateCount: rows.filter(row => !sortDate(row)).length,
        ...(plan.personal ? { personal: { subject: plan.subject, ...plan.personal, excludedReasons: reasons,
          unclassifiedCount: unclassified.length, unclassified,
          basis: plan.mode === 'todo' ? `接受人和当前人均为本人，状态为${[...todoStatuses].join('/')}` : '接受人为本人，有期间执行记录，已完成或已流转他人；取消/已拆分/回置排除',
          dateBoundary: '向上游请求至截止日次日，再按原字段日期核对包含首尾两日；上游端点与截断仍待核对' } } : {}),
        completeness: '上游分页和总量限制未知；返回数不保证覆盖全部历史'
      }
    }
  };
}

function loadConfig(env = process.env) {
  let config = personal.readSkillConfig(env, 'bos-demand-query');
  if (config.connection === 'company') {
    if (Object.hasOwn(config, 'url')) throw new Error('公司连接配置不能同时设置 url');
    if (typeof config.access_key !== 'string' || !config.access_key.trim() || /^TODO$/i.test(config.access_key.trim())) throw new Error('请在 BOS_MCP_CONFIG 指向的文件补全 access_key TODO');
    const base = personal.companyUrl();
    let endpoint;
    try { endpoint = new URL(base); } catch { throw new Error('BOS URL 无效'); }
    if (endpoint.search || endpoint.hash) throw new Error('公司服务地址不得含鉴权参数；access_key 放私有配置');
    endpoint.searchParams.set('access_key', config.access_key);
    config = { ...config, url: endpoint.href };
  } else if (config.connection !== undefined) throw new Error('BOS connection 无效');
  let url;
  try { url = new URL(config.url); } catch { throw new Error('BOS URL 无效'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('BOS URL 必须使用 HTTPS 且不含用户信息');
  const headers = config.headers || {};
  if (!headers['X-Gateway-Upstream-BOS-MCP-TOKEN'] || headers['X-Gateway-Upstream-BOS-MCP-TOKEN'] === 'xxxxx' || /^TODO$/i.test(String(headers['X-Gateway-Upstream-BOS-MCP-TOKEN']).trim())) throw new Error('缺少 BOS 个人 Token');
  if (config.cuser !== undefined && typeof config.cuser !== 'string') throw new Error('本机 cuser 必须为字符串');
  if (config.cgroup !== undefined && typeof config.cgroup !== 'string') throw new Error('本机 cgroup 必须为字符串');
  return { url: url.href, headers, ...(config.cuser ? { cuser: config.cuser } : {}), ...(config.cgroup ? { cgroup: config.cgroup } : {}) };
}

async function withClient(config, action, { timeoutMs = 30000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const pending = new Map();
  let fail;
  const failure = new Promise((_, reject) => { fail = reject; });
  // All raw transport errors are deliberately hidden: URLs and headers carry credentials.
  const timer = setTimeout(() => { fail(new Error('BOS 请求超时')); controller.abort(); }, timeoutMs);
  let resolveEndpoint;
  const endpointReady = new Promise(resolve => { resolveEndpoint = resolve; });
  let sequence = 1;
  try {
    const response = await Promise.race([fetchImpl(config.url, { headers: { ...config.headers, Accept: 'text/event-stream' }, signal: controller.signal, redirect: 'error' }), failure]);
    if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('BOS SSE 连接失败');
    const reading = (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > 16 * 1024 * 1024) throw new Error('BOS 消息过大');
        let match;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const lines = buffer.slice(0, match.index).split(/\r?\n/);
          buffer = buffer.slice(match.index + match[0].length);
          const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
          const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
          if (event === 'endpoint') resolveEndpoint(data);
          else if (data && (!event || event === 'message')) {
            const message = JSON.parse(data);
            if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
          }
        }
      }
      throw new Error('BOS SSE 连接关闭');
    })();
    reading.catch(() => fail(new Error('BOS SSE 连接中断或消息无效')));
    const endpoint = new URL(await Promise.race([endpointReady, failure]), config.url);
    if (endpoint.origin !== new URL(config.url).origin || endpoint.username || endpoint.password) throw new Error('BOS endpoint 必须与配置同源');
    async function rpc(method, params, notify = false) {
      const id = sequence++;
      const reply = notify ? null : new Promise(resolve => pending.set(id, resolve));
      const sent = await Promise.race([fetchImpl(endpoint, {
        method: 'POST', headers: { ...config.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id }), method, params }), signal: controller.signal, redirect: 'error'
      }), failure]);
      if (!sent.ok) throw new Error('BOS 消息发送失败');
      if (sent.body) await sent.body.cancel();
      if (notify) return;
      const message = await Promise.race([reply, failure]);
      if (message.error) throw new Error('BOS 返回协议错误');
      return message.result;
    }
    const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bos-demand-query', version: require('../.agents-plugin/plugin.json').version } });
    if (init?.protocolVersion !== '2024-11-05') throw new Error('BOS 协议版本不受支持');
    await rpc('notifications/initialized', {}, true);
    return await action(rpc);
  } catch {
    throw new Error('BOS 连接或调用失败；请检查网络、凭据、SSE 协议及服务状态');
  } finally {
    clearTimeout(timer);
    controller.abort();
    pending.clear();
  }
}

function redactResult(config, result) {
  const secrets = new Set([config.url]);
  const add = value => { if (typeof value === 'string' && value) secrets.add(value); };
  for (const [name, value] of Object.entries(config.headers || {})) {
    if (/^(?:authorization|proxy-authorization|cookie)$/i.test(name) || /(?:^|[-_])(?:token|key|secret|password|passwd)$/i.test(name)) {
      add(value);
      if (/^(?:authorization|proxy-authorization)$/i.test(name) && typeof value === 'string') add(value.match(/^\s*(?:Bearer|Basic)\s+(.+)$/i)?.[1]);
    }
  }
  for (const [name, value] of new URL(config.url).searchParams) {
    if (/^(?:accesskey|apikey|mcpkey|authkey|key|accesstoken|authtoken|token|secret|password|passwd|authorization|auth)$/i.test(name.replace(/[-_]/g, ''))) {
      add(value);
      add(encodeURIComponent(value));
    }
  }
  const replacements = [...secrets].sort((a, b) => b.length - a.length);
  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    if (typeof value !== 'string') return value;
    // Business payloads are often JSON inside MCP text. Decode before masking
    // so quotes/backslashes in credentials cannot bypass or break serialization.
    if (/^\s*[{[\"]/.test(value)) {
      let parsed;
      try { parsed = JSON.parse(value); } catch { /* Plain text is masked below. */ }
      if (parsed !== undefined) {
        const clean = JSON.stringify(visit(parsed));
        return clean === JSON.stringify(parsed) ? value : clean;
      }
    }
    for (const secret of replacements) value = value.split(secret).join('[REDACTED]');
    return value;
  }
  return visit(result);
}

async function query(config, input, defaultUser, defaultGroup = process.env.BOS_CGROUP ?? config.cgroup ?? '') {
  const plan = prepareQuery(input, defaultUser, defaultGroup);
  const args = plan.args;
  const result = await withClient(config, rpc => rpc('tools/call', { name: upstreamTool, arguments: args }));
  if (!Array.isArray(result?.content)) throw new Error('BOS 返回结构无效');
  // Some gateways encode business failures inside successful MCP text results.
  for (const item of result.content) {
    if (item.type !== 'text') continue;
    try { const data = JSON.parse(item.text); if (data.code !== undefined && String(data.code) !== '200') result.isError = true; } catch { /* Keep plain-text MCP content. */ }
  }
  return redactResult(config, processList(result, plan));
}

async function serve(config, env = process.env, input = process.stdin, output = process.stdout) {
  let initialized = false;
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    let message;
    try { message = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
    const send = value => output.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...value }) + '\n');
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }) + '\n'); continue;
    }
    if (message.id === undefined) continue;
    if (message.method === 'initialize') {
      initialized = true;
      send({ result: { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'bos-demand-query', version: require('../.agents-plugin/plugin.json').version } } });
    } else if (message.method === 'ping') send({ result: {} });
    else if (!initialized) send({ error: { code: -32000, message: 'Initialize first' } });
    else if (message.method === 'tools/list') send({ result: { tools: [tool] } });
    else if (message.method === 'tools/call') {
      if (message.params?.name !== tool.name) { send({ error: { code: -32602, message: 'Unknown tool' } }); continue; }
      try { send({ result: await query(config, message.params.arguments || {}, env.BOS_CUSER || config.cuser, env.BOS_CGROUP ?? config.cgroup ?? '') }); }
      catch (error) { send({ result: { isError: true, content: [{ type: 'text', text: error.message }] } }); }
    } else send({ error: { code: -32601, message: 'Method not found' } });
  }
}

function initConfig(filePath, options) { return personal.initialize(filePath, options); }

async function main() {
  const argv = process.argv.slice(2);
  const [command = 'serve', json] = argv;
  if (argv.includes('--help')) { console.log('node bos-demand-query.js --todo [YYYY-MM-DD [YYYY-MM-DD] | YYYY-MM-DD~YYYY-MM-DD] [--proj|--dev]\nnode bos-demand-query.js --workload YYYY-MM-DD [YYYY-MM-DD] [--proj|--dev]\n--proj / --dev: project / non-project sources; default to todo without --workload.\n--todo: personal development todos, optional due dates; --workload: personal workload, required execution dates. Both ends inclusive.\nnode bos-demand-query.js serve|check|defaults|query <JSON>|init-config [absolute-private-path]|migrate-config <existing-private-path>\nBOS_MCP_CONFIG: shared private JSON with bos-demand-query and bos-code-update-log sections. Only the selected skill section is read. migrate-config converts the old flat query file in place. Node >=22.5.0.'); return; }
  const personalInput = ['--todo', '--workload', '--proj', '--dev'].includes(command) ? parsePersonalCli(argv) : null;
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) throw new Error('需要 Node.js >=22.5.0（Agent 工具链运行时）');
  if (command === 'init-config') { console.log(JSON.stringify(initConfig(json))); return; }
  if (command === 'migrate-config') { console.log(JSON.stringify(personal.migrate(json))); return; }
  const config = loadConfig();
  if (command === 'defaults') {
    console.log(JSON.stringify({ cuser: process.env.BOS_CUSER || config.cuser || '', cgroup: process.env.BOS_CGROUP ?? config.cgroup ?? '' }));
    return;
  }
  if (command === 'serve') return serve(config);
  if (command === 'check') {
    const result = await withClient(config, async rpc => {
      let cursor;
      for (let page = 0; page < 20; page++) {
        const list = await rpc('tools/list', cursor ? { cursor } : {});
        if (list.tools?.some(item => item.name === upstreamTool)) return { connected: true, queryToolAvailable: true };
        cursor = list.nextCursor;
        if (!cursor) break;
      }
      throw new Error('未发现 BOS 查询工具');
    });
    console.log(JSON.stringify(result));
  } else if (command === 'query' || personalInput) {
    let args;
    try { args = personalInput || JSON.parse(json); } catch { throw new Error('query 需要合法 JSON 参数'); }
    const result = await query(config, args, process.env.BOS_CUSER || config.cuser);
    console.log(JSON.stringify(result));
    if (result.isError) process.exitCode = 1;
  } else throw new Error('未知命令；使用 --help');
}

module.exports = { main, initConfig, queryArguments, parsePersonalCli, loadConfig, withClient, query, serve, tool };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
