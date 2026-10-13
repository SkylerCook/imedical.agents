#!/usr/bin/env node
'use strict';

// Narrow read-only adapter for the MCP 2024-11-05 HTTP+SSE transport.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const personal = require('./personal-config');
const fields = 'id title content source status type sgroup tgroup cgroup suser tuser cuser datetype date date2 product mod'.split(' ');
const upstreamTool = 'post_imedway_ylxt_bosdata';
const descriptions = {
  id: '需求编号；按编号查询忽略其他筛选条件，不保证属于默认当前人。',
  title: '需求标题关键字', content: '需求描述关键字', source: '需求来源', status: '需求状态',
  type: '需求类型', cuser: '当前人；省略时使用 BOS_CUSER 或本机配置默认值。',
  sgroup: '发起组名称；作为额外条件，与个人所在的当前组 cgroup 独立，省略或空字符串表示不限发起组。',
  cgroup: '个人所在的当前组；省略时使用 BOS_CGROUP 或本机配置 cgroup，显式空字符串查询全部组。',
  datetype: '创建时间、预计完成时间、执行时间、分配时间或操作时间；默认创建时间。',
  date: '起始日期 YYYY-MM-DD；普通 list 模式必须明确提供，待办和 history 可自动生成。',
  date2: '截止日期 YYYY-MM-DD；端点包含规则由上游决定，尚未验证。',
  product: '产品', mod: '产品模块'
};
const queryOptions = {
  mode: { type: 'string', enum: ['list', 'pending', 'project-pending', 'history'], description: 'list 需明确日期；pending 为本人所在组待办；project-pending 另限来源为项目；history 为全部历史，不过滤待办状态。' },
  timezone: { type: 'string', description: '默认日期截止日使用的 IANA 时区；默认 Asia/Shanghai，可按用户时区覆盖。' },
  sort: { type: 'string', enum: ['创建时间', '预计完成时间'], description: '列表排序字段；默认创建时间，按日排序，同日需求号升序。' },
  order: { type: 'string', enum: ['asc', 'desc'], description: '日期排序方向；默认 asc，缺失或无效日期置后。' }
};
const pendingExcludedStatuses = new Set(['完成', '取消', '已拆分']);
const tool = {
  name: 'bos_demand_query', description: '只读查询 BOS 需求。待办默认当前人和个人所在组，可额外筛选发起组；列表统一排序并返回计数。按编号查询不受当前人限制；待办排除规则为暂行口径，不保证服务端无截断。',
  inputSchema: { type: 'object', properties: { ...Object.fromEntries(Object.entries(descriptions).map(([key, description]) => [key, { type: 'string', description }])), ...queryOptions }, additionalProperties: false }
};

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function prepareQuery(input, defaultUser = '', defaultGroup = '', now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('查询参数必须为对象');
  for (const [key, value] of Object.entries(input)) {
    if ((!Object.hasOwn(descriptions, key) && !Object.hasOwn(queryOptions, key)) || typeof value !== 'string') throw new Error('查询参数名称或类型无效');
  }
  const args = Object.fromEntries(fields.map(key => [key, '']));
  args.explain = '0';
  if (input.id) {
    if (!/^\d+$/.test(input.id)) throw new Error('需求编号必须是数字');
    args.id = input.id;
    return { args, mode: 'detail' };
  }
  const mode = input.mode || 'list';
  const sort = input.sort || '创建时间';
  const order = input.order || 'asc';
  if (!queryOptions.mode.enum.includes(mode) || !queryOptions.sort.enum.includes(sort) || !queryOptions.order.enum.includes(order)) throw new Error('mode、sort 或 order 无效');
  for (const key of Object.keys(descriptions)) if (Object.hasOwn(input, key)) args[key] = input[key];
  args.cuser = (input.cuser || defaultUser).trim();
  args.cgroup = (Object.hasOwn(input, 'cgroup') ? input.cgroup : defaultGroup).trim();
  if (/^TODO$/i.test(args.cuser) || /^TODO$/i.test(args.cgroup)) throw new Error('个人身份尚未配置；运行 bos-init 并填写 cuser / cgroup，不能使用 TODO 查询');
  if (!args.cuser) throw new Error('请提供 cuser，或设置 BOS_CUSER / 本机配置 cuser');
  const pending = mode === 'pending' || mode === 'project-pending';
  if (pending && !Object.hasOwn(input, 'cgroup') && !args.cgroup) throw new Error('待办需配置个人所在组 cgroup；明确跨组查询时传 cgroup 空字符串');
  if (mode === 'project-pending') {
    if (Object.hasOwn(input, 'source') && input.source !== '项目') throw new Error('project-pending 的 source 必须为项目；其它来源使用 pending');
    args.source = '项目';
  }
  const timezone = input.timezone || 'Asia/Shanghai';
  let today;
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = name => parts.find(item => item.type === name).value;
    today = `${part('year')}-${part('month')}-${part('day')}`;
  } catch { throw new Error('timezone 必须为有效 IANA 时区'); }
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
  if (plan.mode === 'detail' || result.isError) return result;
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
  const rows = data.data.filter(row => !plan.pendingApplied || !pendingExcludedStatuses.has(String(row['状态'] ?? '').trim()));
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
        completeness: '上游分页和总量限制未知；返回数不保证覆盖全部历史'
      }
    }
  };
}

function loadConfig(env = process.env) {
  let config;
  const filePath = env.BOS_MCP_CONFIG;
  if (filePath !== undefined && (typeof filePath !== 'string' || !filePath.trim())) throw new Error('BOS_MCP_CONFIG 必须为明确的私有配置路径');
  if (!filePath && (!env.BOS_MCP_URL || !env.BOS_MCP_TOKEN)) throw new Error('缺少 BOS 配置；设置 BOS_MCP_CONFIG 或 BOS_MCP_URL + BOS_MCP_TOKEN');
  if (filePath) {
    try {
      const file = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
      config = file.mcpServers ? file.mcpServers[env.BOS_MCP_SERVER || 'bos-demand-query'] : file;
    } catch { throw new Error('无法读取 BOS 本机 JSON 配置；请设置 BOS_MCP_CONFIG ；显式配置失败不会切换到其它身份'); }
  } else {
    config = { url: env.BOS_MCP_URL, headers: { 'X-Gateway-Upstream-BOS-MCP-TOKEN': env.BOS_MCP_TOKEN } };
  }
  if (!config || config.enabled === false) throw new Error('BOS 服务未配置或已禁用');
  if (typeof config !== 'object' || Array.isArray(config)) throw new Error('BOS 配置必须为对象');
  if (config.connection === 'company') {
    if (Object.hasOwn(config, 'url')) throw new Error('公司连接配置不能同时设置 url');
    if (typeof config.access_key !== 'string' || !config.access_key.trim() || /^TODO$/i.test(config.access_key.trim())) throw new Error('请在 BOS_MCP_CONFIG 指向的文件补全 access_key TODO');
    const base = env.BOS_MCP_URL && env.BOS_MCP_URL !== env.BOS_MANAGED_MCP_URL ? env.BOS_MCP_URL : personal.companyUrl();
    let endpoint;
    try { endpoint = new URL(base); } catch { throw new Error('BOS URL 无效'); }
    if (endpoint.search || endpoint.hash) throw new Error('公司服务地址不得含鉴权参数；access_key 放私有配置');
    endpoint.searchParams.set('access_key', config.access_key);
    config = { ...config, url: endpoint.href };
  } else if (config.connection !== undefined) throw new Error('BOS connection 无效');
  // Only identity-only files opt into environment connections. Partial legacy
  // connection files remain errors; never combine credentials across sources.
  if (!Object.hasOwn(config, 'url') && !Object.hasOwn(config, 'headers')) {
    if (Object.keys(config).some(key => !['enabled', 'cuser', 'cgroup'].includes(key))) throw new Error('身份配置包含未知字段');
    if (!env.BOS_MCP_URL || !env.BOS_MCP_TOKEN) throw new Error('身份配置需要 BOS_MCP_URL + BOS_MCP_TOKEN');
    config = { ...config, url: env.BOS_MCP_URL, headers: { 'X-Gateway-Upstream-BOS-MCP-TOKEN': env.BOS_MCP_TOKEN } };
  }
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
  const [command = 'serve', json] = process.argv.slice(2);
  if (command === '--help') { console.log('node bos-demand-query.js serve|check|defaults|query <JSON>|init-config [absolute-private-path]|migrate-config <existing-private-path>\nBOS_MCP_CONFIG: explicit private JSON; identity-only files use BOS_MCP_URL + BOS_MCP_TOKEN. No implicit lookup. Node >=22.5.0.'); return; }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) throw new Error('需要 Node.js >=22.5.0（Agent 工具链运行时）');
  if (command === 'init-config') { console.log(JSON.stringify(initConfig(json))); return; }
  if (command === 'migrate-config') { if (!json) throw new Error('migrate-config 需要原私有文件绝对路径'); console.log(JSON.stringify(personal.initialize(undefined, { migrateFrom: json }))); return; }
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
  } else if (command === 'query') {
    let args;
    try { args = JSON.parse(json); } catch { throw new Error('query 需要合法 JSON 参数'); }
    const result = await query(config, args, process.env.BOS_CUSER || config.cuser);
    console.log(JSON.stringify(result));
    if (result.isError) process.exitCode = 1;
  } else throw new Error('未知命令；使用 --help');
}

module.exports = { main, initConfig, queryArguments, loadConfig, withClient, query, serve, tool };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
