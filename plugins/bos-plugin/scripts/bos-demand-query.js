#!/usr/bin/env node
'use strict';

// Narrow read-only adapter for the MCP 2024-11-05 HTTP+SSE transport.
const fs = require('node:fs');
const readline = require('node:readline');
const fields = 'id title content source status type sgroup tgroup cgroup suser tuser cuser datetype date date2 product mod'.split(' ');
const upstreamTool = 'post_imedway_ylxt_bosdata';
const descriptions = {
  id: '需求编号；按编号查询忽略其他筛选条件，不保证属于默认当前人。',
  title: '需求标题关键字', content: '需求描述关键字', source: '需求来源', status: '需求状态',
  type: '需求类型', cuser: '当前人；省略时使用 BOS_CUSER 或本机配置默认值。',
  sgroup: '发起组名称；与当前组 cgroup 独立，省略或空字符串表示不限发起组。',
  cgroup: '当前组；省略时使用 BOS_CGROUP 或本机配置 cgroup，显式空字符串查询全部组。',
  datetype: '创建时间、预计完成时间、执行时间、分配时间或操作时间；默认创建时间。',
  date: '起始日期 YYYY-MM-DD；列表查询必须明确提供。',
  date2: '截止日期 YYYY-MM-DD；端点包含规则由上游决定，尚未验证。',
  product: '产品', mod: '产品模块'
};
const tool = {
  name: 'bos_demand_query', description: '只读查询 BOS 需求。列表查询使用当前人 cuser 和明确日期范围；按编号查询不受当前人限制。无分页参数，不将返回集合声称为全部需求。',
  inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(descriptions).map(([key, description]) => [key, { type: 'string', description }])), additionalProperties: false }
};

function queryArguments(input, defaultUser = '', defaultGroup = '') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('查询参数必须为对象');
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(descriptions, key) || typeof value !== 'string') throw new Error('查询参数名称或类型无效');
  }
  const args = Object.fromEntries(fields.map(key => [key, '']));
  args.explain = '0';
  if (input.id) {
    if (!/^\d+$/.test(input.id)) throw new Error('需求编号必须是数字');
    args.id = input.id;
    return args;
  }
  Object.assign(args, input);
  args.cuser = (input.cuser || defaultUser).trim();
  args.cgroup = (Object.hasOwn(input, 'cgroup') ? input.cgroup : defaultGroup).trim();
  if (!args.cuser) throw new Error('请提供 cuser，或设置 BOS_CUSER / 本机配置 cuser');
  for (const key of ['date', 'date2']) {
    const value = args[key];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('列表查询需提供有效 date 和 date2');
  }
  if (args.date2 < args.date) throw new Error('截止日期不得早于起始日期');
  args.datetype ||= '创建时间';
  if (!['创建时间', '预计完成时间', '执行时间', '分配时间', '操作时间'].includes(args.datetype)) throw new Error('datetype 无效');
  return args;
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
  let url;
  try { url = new URL(config.url); } catch { throw new Error('BOS URL 无效'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('BOS URL 必须使用 HTTPS 且不含用户信息');
  const headers = config.headers || {};
  if (!headers['X-Gateway-Upstream-BOS-MCP-TOKEN'] || headers['X-Gateway-Upstream-BOS-MCP-TOKEN'] === 'xxxxx') throw new Error('缺少 BOS 个人 Token');
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

async function query(config, input, defaultUser, defaultGroup = process.env.BOS_CGROUP || config.cgroup || '') {
  const args = queryArguments(input, defaultUser, defaultGroup);
  const result = await withClient(config, rpc => rpc('tools/call', { name: upstreamTool, arguments: args }));
  if (!Array.isArray(result?.content)) throw new Error('BOS 返回结构无效');
  // Some gateways encode business failures inside successful MCP text results.
  for (const item of result.content) {
    if (item.type !== 'text') continue;
    try { const data = JSON.parse(item.text); if (data.code !== undefined && String(data.code) !== '200') result.isError = true; } catch { /* Keep plain-text MCP content. */ }
  }
  return redactResult(config, result);
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
      try { send({ result: await query(config, message.params.arguments || {}, env.BOS_CUSER || config.cuser, env.BOS_CGROUP || config.cgroup || '') }); }
      catch (error) { send({ result: { isError: true, content: [{ type: 'text', text: error.message }] } }); }
    } else send({ error: { code: -32601, message: 'Method not found' } });
  }
}

async function main() {
  const [command = 'serve', json] = process.argv.slice(2);
  if (command === '--help') { console.log('node bos-demand-query.js serve|check|defaults|query <JSON>\nConfiguration (no implicit file lookup): BOS_MCP_CONFIG or BOS_MCP_URL + BOS_MCP_TOKEN.\nUser: query cuser > BOS_CUSER > local config cuser. Node >=22.5.0.'); return; }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) throw new Error('需要 Node.js >=22.5.0（Agent 工具链运行时）');
  const config = loadConfig();
  if (command === 'defaults') {
    console.log(JSON.stringify({ cuser: process.env.BOS_CUSER || config.cuser || '', cgroup: process.env.BOS_CGROUP || config.cgroup || '' }));
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

module.exports = { queryArguments, loadConfig, withClient, query, serve, tool };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
