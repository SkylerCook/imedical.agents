'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const { queryArguments, parsePersonalCli, loadConfig, withClient, query, serve, tool } = require('../scripts/bos-demand-query');
const config = { url: 'https://example.invalid/sse?access_key=test-key', headers: { 'X-Gateway-Upstream-BOS-MCP-TOKEN': 'test-token' } };

test('personal identity is supplied by caller or environment and never inferred', () => {
  const date = { date: '2026-01-01', date2: '2026-01-02' };
  assert.throws(() => queryArguments(date), /cuser/);
  assert.equal(queryArguments(date, 'sample-user').cuser, 'sample-user');
  assert.equal(queryArguments({ ...date, cuser: 'explicit-user' }, 'sample-user').cuser, 'explicit-user');
  assert.equal(queryArguments({ ...date, suser: 'other', cuser: '', cgroup: '' }, 'sample-user', 'sample-group').suser, 'other');
});

test('id lookup clears all conditions; list requires real explicit dates', () => {
  const args = queryArguments({ id: '12345', cuser: 'sample-user', date: 'invalid' });
  assert.equal(args.cuser, ''); assert.equal(args.date, ''); assert.equal(args.id, '12345');
  assert.equal(args.explain, '0');
  assert.throws(() => queryArguments({ id: '../invalid' }), /数字/);
  assert.throws(() => queryArguments({ cuser: 'sample-user' }), /date/);
  assert.throws(() => queryArguments({ cuser: 'sample-user', date: '2026-02-30', date2: '2026-03-02' }), /date/);
  assert.throws(() => queryArguments({ cuser: 'sample-user', date: '2026-03-02', date2: '2026-03-01' }), /截止/);
});

test('all upstream query fields are discoverable with their declared types', () => {
  const strings = 'explain id title content source status type sgroup tgroup cgroup suser tuser cuser datetype date date2 product mod'.split(' ');
  for (const key of strings) assert.equal(tool.inputSchema.properties[key].type, 'string', key);
  assert.equal(tool.inputSchema.properties.body.type, 'object');
});

test('explicitly clearing current identity supports each person and group role without hidden defaults', () => {
  for (const key of ['suser', 'tuser', 'cuser', 'sgroup', 'tgroup', 'cgroup']) {
    const input = { mode: 'history', cuser: '', cgroup: '', [key]: 'chosen-scope' };
    const args = queryArguments(input, 'default-user', 'default-group');
    assert.equal(args[key], 'chosen-scope');
    for (const other of ['suser', 'tuser', 'cuser', 'sgroup', 'tgroup', 'cgroup'].filter(field => field !== key)) assert.equal(args[other], '', other);
    assert.equal(args.date, '1900-01-01');
    assert.equal(Object.keys(args).length, 18);
    assert.ok(Object.values(args).every(value => typeof value === 'string'));
  }
  const args = queryArguments({ mode: 'history', cuser: '' }, 'default-user', 'default-group');
  assert.equal(args.cuser, ''); assert.equal(args.cgroup, 'default-group');
  const pending = queryArguments({ mode: 'pending', cuser: '', cgroup: '', tgroup: 'chosen-receiver' }, 'default-user', 'default-group');
  assert.equal(pending.cuser, ''); assert.equal(pending.cgroup, ''); assert.equal(pending.tgroup, 'chosen-receiver');
});

test('empty, whitespace and TODO role scopes stop while explicit conditions remain combined', () => {
  for (const input of [
    { cuser: '', cgroup: '' },
    { cuser: ' ', cgroup: '', suser: ' ', tgroup: ' ' },
    { cuser: '', cgroup: '', body: { suser: 'opaque-value' } }
  ]) assert.throws(() => queryArguments({ mode: 'history', ...input }, 'default-user', 'default-group'), /至少需一个人员或组条件/);
  for (const key of ['suser', 'tuser', 'cuser', 'sgroup', 'tgroup', 'cgroup']) {
    assert.throws(() => queryArguments({ mode: 'history', cuser: '', cgroup: '', [key]: 'TODO' }, 'default-user', 'default-group'), /TODO/);
  }
  const conditions = { suser: 'origin-user', tuser: 'receiver-user', cuser: 'current-user', sgroup: 'origin-group', tgroup: 'receiver-group', cgroup: 'current-group' };
  const args = queryArguments({ mode: 'history', ...conditions }, 'default-user', 'default-group');
  for (const [key, value] of Object.entries(conditions)) assert.equal(args[key], value);
});

test('opaque body must be an object and detail lookup retains transport options while clearing filters', () => {
  const body = { nested: { values: ['synthetic', 7, true, null] } };
  const input = { id: '12345', explain: '0', body, suser: 'origin-user', tuser: 'receiver-user', tgroup: 'receiver-group' };
  const args = queryArguments(input, 'default-user', 'default-group');
  assert.deepEqual(args.body, body); assert.deepEqual(input.body, body);
  assert.equal(args.suser, ''); assert.equal(args.tuser, ''); assert.equal(args.tgroup, '');
  assert.equal(args.cuser, ''); assert.equal(args.cgroup, '');
  for (const value of [null, [], 'text', 7, false]) assert.throws(() => queryArguments({ id: '12345', body: value }), /JSON 对象/);
  assert.throws(() => queryArguments({ id: '12345', explain: 1 }), /参数/);
});

test('configuration requires a skill section, HTTPS and personal token, without leaking invalid input', t => {
  const env = { BOS_MCP_CONFIG: path.resolve('missing-private-config') };
  let selected = config;
  t.mock.method(fs, 'readFileSync', () => JSON.stringify({ 'bos-demand-query': selected }));
  assert.deepEqual(loadConfig(env), config);
  selected = { ...config, url: 'http://example.invalid' };
  assert.throws(() => loadConfig(env), /HTTPS/);
  selected = { ...config, headers: { 'X-Gateway-Upstream-BOS-MCP-TOKEN': 'xxxxx' } };
  assert.throws(() => loadConfig(env), /Token/);
  fs.readFileSync.mock.mockImplementation(() => { throw Error('private-input'); });
  assert.throws(() => loadConfig(env), /无法读取/);
});

function mock({ foreign = false, disconnect = false, silence = false, token = 'test-token', result = { tools: [{ name: 'sample-query' }] } } = {}) {
  let stream;
  const calls = [];
  const encode = value => new TextEncoder().encode(value);
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), ...options });
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['X-Gateway-Upstream-BOS-MCP-TOKEN'], token);
    if (!options.method) {
      const body = new ReadableStream({ start(c) {
        stream = c;
        // Exercise CRLF split across byte chunks and UTF-8 decoding.
        c.enqueue(encode(`event: endpoint\r\ndata: ${foreign ? 'https://foreign.invalid/post' : '/post?session=sample'}\r`));
        c.enqueue(encode('\n\r\n'));
        options.signal.addEventListener('abort', () => { try { c.close(); } catch {} });
      } });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    const request = JSON.parse(options.body);
    if (disconnect) stream.close();
    else if (request.id && !silence) {
      const reply = request.method === 'initialize' ? { protocolVersion: '2024-11-05' } : result;
      const event = encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: reply })}\n\n`);
      stream.enqueue(event.slice(0, 7)); stream.enqueue(event.slice(7));
    }
    return new Response(null, { status: 202 });
  };
  return { fetchImpl, calls };
}

test('role queries send the chosen scope and opaque body through the existing upstream tool', async (t) => {
  const result = { content: [{ type: 'text', text: JSON.stringify({ code: 200, data: [] }) }] };
  const body = { vendorDefined: { values: ['synthetic'] } };
  for (const key of ['suser', 'tuser', 'tgroup', 'sgroup', 'cgroup']) {
    const m = mock({ result });
    t.mock.method(globalThis, 'fetch', m.fetchImpl);
    const response = await query(config, { mode: 'history', cuser: '', cgroup: '', [key]: 'chosen-scope', body }, 'default-user', 'default-group');
    const call = JSON.parse(m.calls.at(-1).body).params;
    assert.equal(call.name, 'post_imedway_ylxt_bosdata');
    assert.equal(call.arguments[key], 'chosen-scope');
    assert.equal(call.arguments.cuser, '');
    if (key !== 'cgroup') assert.equal(call.arguments.cgroup, '');
    assert.deepEqual(call.arguments.body, body);
    assert.deepEqual(response._meta.bosDemandQuery.filters, call.arguments);
  }
});

test('explanation requests preserve upstream payload without inventing defaults or list counts', async (t) => {
  const result = { content: [{ type: 'text', text: JSON.stringify({ code: 200, data: { syntheticField: 'synthetic explanation' } }) }] };
  const m = mock({ result });
  t.mock.method(globalThis, 'fetch', m.fetchImpl);
  const response = await query(config, { explain: 'synthetic-explain-value', suser: 'chosen-origin', body: { opaque: true } }, 'default-user', 'default-group');
  assert.deepEqual(response, result);
  const args = JSON.parse(m.calls.at(-1).body).params.arguments;
  assert.equal(args.explain, 'synthetic-explain-value'); assert.equal(args.suser, 'chosen-origin');
  assert.equal(args.cuser, ''); assert.equal(args.cgroup, '');
  assert.equal(args.date, ''); assert.equal(args.date2, '');
  assert.deepEqual(args.body, { opaque: true });
  assert.equal(response._meta, undefined);
});

test('SSE handshake, endpoint routing, notification and response correlation', async () => {
  const m = mock();
  const result = await withClient(config, rpc => rpc('tools/list', {}), m);
  assert.equal(result.tools[0].name, 'sample-query');
  assert.deepEqual(m.calls.slice(1).map(x => JSON.parse(x.body).method), ['initialize', 'notifications/initialized', 'tools/list']);
  assert.ok(m.calls.slice(1).every(x => x.url === 'https://example.invalid/post?session=sample'));
});

test('foreign endpoint is rejected before credentials are forwarded', async () => {
  const m = mock({ foreign: true });
  await assert.rejects(withClient(config, () => {}, m), /BOS/);
  assert.equal(m.calls.length, 1);
});

test('disconnect and timeout reject pending requests without exposing secrets', async () => {
  for (const mode of [{ disconnect: true }, { silence: true }]) {
    await assert.rejects(withClient(config, () => {}, { ...mock(mode), timeoutMs: 30 }), error => {
      assert.doesNotMatch(error.message, /test-token|test-key|example.invalid/); return true;
    });
  }
});

test('query preserves business values and formatting when connection options are not credentials', async (t) => {
  const connection = {
    url: 'https://example.invalid/sse?v=1&transport=sse&access_key=test-key',
    headers: { ...config.headers, 'X-Version': '1', Accept: 'application/json' }
  };
  const result = { content: [{ type: 'text', text: JSON.stringify({ code: 200, data: [{ id: '12345', date: '2026-10-13', title: 'sample 1', transport: 'sse', format: 'application/json' }] }, null, 2) }] };
  const m = mock({ result });
  t.mock.method(globalThis, 'fetch', m.fetchImpl);
  assert.deepEqual(await query(connection, { id: '12345' }), result);
  assert.deepEqual(JSON.parse(m.calls.at(-1).body).params, { name: 'post_imedway_ylxt_bosdata', arguments: queryArguments({ id: '12345' }) });
});

test('query redacts quoted and backslash credentials in plain text, JSON text and nested content', async (t) => {
  const token = 'sample"quoted\\token';
  const key = 'gateway"quoted\\key';
  const connection = { url: `https://example.invalid/sse?access_key=${encodeURIComponent(key)}&v=1`, headers: { 'X-Gateway-Upstream-BOS-MCP-TOKEN': token } };
  const result = {
    content: [
      { type: 'text', text: `failure: ${token}; key: ${key}; url: ${connection.url}` },
      { type: 'text', text: JSON.stringify({ code: 200, token, key, nested: JSON.stringify({ token }), id: '12345' }) },
      { type: 'resource', resource: { uri: connection.url, text: token } }
    ],
    _meta: { echoes: [token, { key }], count: 1 }, isError: true
  };
  t.mock.method(globalThis, 'fetch', mock({ token, result }).fetchImpl);
  const actual = await query(connection, { id: '12345' });
  assert.equal(actual.content[0].text, 'failure: [REDACTED]; key: [REDACTED]; url: [REDACTED]');
  assert.deepEqual(JSON.parse(actual.content[1].text), { code: 200, token: '[REDACTED]', key: '[REDACTED]', nested: JSON.stringify({ token: '[REDACTED]' }), id: '12345' });
  assert.deepEqual(actual.content[2].resource, { uri: '[REDACTED]', text: '[REDACTED]' });
  assert.deepEqual(actual._meta, { echoes: ['[REDACTED]', { key: '[REDACTED]' }], count: 1 });
  assert.equal(actual.isError, true);
  assert.equal(result.content[0].text, `failure: ${token}; key: ${key}; url: ${connection.url}`);
});

test('query redacts repeated authentication parameters and bare authorization tokens', async (t) => {
  const connection = {
    url: 'https://example.invalid/sse?access_key=first-key&access_key=second-key&token=third-token&v=1',
    headers: { ...config.headers, Authorization: 'Bearer bearer-token', 'X-Api-Key': 'header-key' }
  };
  const result = { content: [{ type: 'text', text: 'first-key second-key third-token Bearer bearer-token bearer-token header-key test-token 12345' }] };
  t.mock.method(globalThis, 'fetch', mock({ result }).fetchImpl);
  const actual = await query(connection, { id: '12345' });
  assert.equal(actual.content[0].text, '[REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED] 12345');
});

test('query preserves business failures and rejects invalid MCP content', async (t) => {
  const result = { content: [{ type: 'text', text: JSON.stringify({ code: 500, message: 'failure: test-token' }) }] };
  t.mock.method(globalThis, 'fetch', mock({ result }).fetchImpl);
  const actual = await query(config, { id: '12345' });
  assert.equal(actual.isError, true);
  assert.deepEqual(JSON.parse(actual.content[0].text), { code: 500, message: 'failure: [REDACTED]' });
  globalThis.fetch.mock.mockImplementation(mock({ result: {} }).fetchImpl);
  await assert.rejects(query(config, { id: '12345' }), /返回结构无效/);
});

test('stdio supports initialization, discovery and rejects unknown tools without network', async () => {
  const input = new PassThrough(); const output = new PassThrough(); let text = '';
  output.on('data', chunk => { text += chunk; });
  const running = serve(config, {}, input, output);
  const messages = [
    { id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { method: 'notifications/initialized' }, { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'write' } },
    { id: 4, method: 'tools/call', params: { name: 'bos_demand_query', arguments: {} } }
  ];
  input.end(messages.map(m => JSON.stringify({ jsonrpc: '2.0', ...m })).join('\n') + '\n');
  await running;
  const replies = text.trim().split('\n').map(JSON.parse);
  assert.equal(replies.length, 4);
  assert.equal(replies[1].result.tools[0].name, 'bos_demand_query');
  assert.equal(replies[2].error.code, -32602);
  assert.equal(replies[3].result.isError, true);
  assert.match(replies[3].result.content[0].text, /cuser/);
});

test('current group defaults, explicit override and cross-group queries preserve other filters', () => {
  const input = { date: '2026-01-01', date2: '2026-01-02', source: '项目', status: '分配' };
  assert.equal(queryArguments(input, 'sample-user', 'sample-group').cgroup, 'sample-group');
  const all = queryArguments({ ...input, cgroup: '' }, 'sample-user', 'sample-group');
  assert.equal(all.cgroup, ''); assert.equal(all.source, '项目'); assert.equal(all.status, '分配');
  assert.equal(queryArguments({ ...input, cgroup: 'other-group' }, 'sample-user', 'sample-group').cgroup, 'other-group');
  assert.equal(queryArguments({ id: '12345', cgroup: 'other-group' }, 'sample-user', 'sample-group').cgroup, '');
  assert.throws(() => queryArguments({ ...input, cgroup: 42 }, 'sample-user'), /参数/);
});

test('local current group is validated without exposing connection values', (t) => {
  t.mock.method(fs, 'readFileSync', () => JSON.stringify({ 'bos-demand-query': { ...config, cgroup: 'sample-group' } }));
  assert.equal(loadConfig({ BOS_MCP_CONFIG: path.resolve('private-fixture') }).cgroup, 'sample-group');
  fs.readFileSync.mock.mockImplementation(() => JSON.stringify({ 'bos-demand-query': { ...config, cgroup: 42 } }));
  assert.throws(() => loadConfig({ BOS_MCP_CONFIG: path.resolve('private-fixture') }), /cgroup/);
});


test('source group combines with identity, current group and source without changing scope', () => {
  const input = { date: '2026-01-01', date2: '2026-01-02', sgroup: 'sample-origin', source: '项目', status: '分配' };
  const args = queryArguments(input, 'sample-user', 'sample-current');
  assert.equal(args.sgroup, 'sample-origin'); assert.equal(args.cuser, 'sample-user');
  assert.equal(args.cgroup, 'sample-current'); assert.equal(args.source, '项目'); assert.equal(args.status, '分配');
  assert.equal(queryArguments({ ...input, cgroup: '' }, 'sample-user', 'sample-current').sgroup, 'sample-origin');
  assert.equal(queryArguments({ ...input, sgroup: '' }, 'sample-user', 'sample-current').cgroup, 'sample-current');
  assert.equal(queryArguments({ date: input.date, date2: input.date2 }, 'sample-user').sgroup, '');
  assert.equal(queryArguments({ id: '12345', sgroup: 'sample-origin' }, 'sample-user', 'sample-current').sgroup, '');
  assert.throws(() => queryArguments({ ...input, sgroup: ['sample-origin'] }, 'sample-user'), /参数/);
});

test('common modes generate historical dates in the user timezone and keep options out of upstream arguments', () => {
  const now = new Date('2026-10-12T16:30:00Z');
  for (const mode of ['pending', 'project-pending', 'history']) {
    const args = queryArguments({ mode, timezone: 'Asia/Shanghai', sort: '预计完成时间', order: 'desc', sgroup: 'origin-group' }, 'sample-user', 'personal-group', now);
    assert.equal(args.date, '1900-01-01'); assert.equal(args.date2, '2026-10-13');
    assert.equal(args.cuser, 'sample-user'); assert.equal(args.cgroup, 'personal-group'); assert.equal(args.sgroup, 'origin-group');
    assert.equal(args.datetype, '创建时间'); assert.equal(args.source, mode === 'project-pending' ? '项目' : '');
    for (const option of ['mode', 'timezone', 'sort', 'order']) assert.equal(Object.hasOwn(args, option), false);
  }
  assert.equal(queryArguments({ mode: 'pending', timezone: 'UTC' }, 'sample-user', 'personal-group', now).date2, '2026-10-12');
});

test('pending defaults require a personal group and keep origin group separate from explicit cross-group scope', () => {
  assert.throws(() => queryArguments({ mode: 'pending', sgroup: 'origin-group' }, 'sample-user'), /个人所在组/);
  const args = queryArguments({ mode: 'project-pending', cuser: 'other-user', cgroup: '', sgroup: 'origin-group' }, 'sample-user', 'personal-group');
  assert.equal(args.cuser, 'other-user'); assert.equal(args.cgroup, ''); assert.equal(args.sgroup, 'origin-group'); assert.equal(args.source, '项目');
  assert.equal(queryArguments({ mode: 'pending', cgroup: 'other-group' }, 'sample-user', 'personal-group').cgroup, 'other-group');
  assert.throws(() => queryArguments({ mode: 'pending' }, '', 'personal-group'), /cuser/);
});

test('explicit dates and detail lookups take precedence and invalid or conflicting modes fail before transport', () => {
  const explicit = { mode: 'pending', date: '2026-01-01', date2: '2026-01-31', datetype: '操作时间' };
  const args = queryArguments(explicit, 'sample-user', 'personal-group');
  assert.equal(args.date, explicit.date); assert.equal(args.date2, explicit.date2); assert.equal(args.datetype, '操作时间');
  const detail = queryArguments({ id: '12345', mode: 'invalid', timezone: 'invalid', sort: 'invalid', date: 'invalid', sgroup: 'origin' });
  assert.equal(detail.id, '12345'); assert.equal(detail.date, ''); assert.equal(detail.cgroup, ''); assert.equal(detail.sgroup, '');
  for (const input of [{ mode: 'invalid' }, { mode: 'pending', timezone: 'invalid' }, { mode: 'pending', sort: 'invalid' }, { mode: 'pending', order: 'invalid' }, { mode: 'pending', date: '2026-01-01' }, { mode: 'pending', date: '', date2: '' }, { mode: 'pending', datetype: '操作时间' }, { mode: 'project-pending', source: 'other' }, { mode: 'project-pending', source: '' }]) {
    assert.throws(() => queryArguments(input, 'sample-user', 'personal-group'));
  }
  assert.throws(() => queryArguments({}, 'sample-user', 'personal-group'), /date/);
});

const sampleRows = [
  { '需求号': '9007199254740993', '状态': '测试', '创建时间': '2026-10-01 01:00:00', '预计完成时间': '2026-10-05' },
  { '需求号': '10', '状态': '分配', '创建时间': '2026-10-02 01:00:00', '预计完成时间': '2026-10-04' },
  { '需求号': '2', '状态': '活动', '创建时间': '2026-10-02 23:00:00', '预计完成时间': '2026-10-04' },
  { '需求号': '1', '状态': '完成', '创建时间': '2026-10-01' },
  { '需求号': '3', '状态': '取消', '创建时间': '2026-10-01' },
  { '需求号': '4', '状态': '已拆分', '创建时间': '2026-10-01' },
  { '需求号': '9', '状态': '新状态', '创建时间': '2026-10-01', '预计完成时间': '2026-10-06' },
  { '需求号': '12', '状态': null, '创建时间': 'invalid', '预计完成时间': null }
];
const listResult = (rows = sampleRows) => ({ content: [{ type: 'text', text: JSON.stringify({ code: 200, data: rows, message: 'sample' }) }, { type: 'image', data: 'sample-image', mimeType: 'image/png' }], _meta: { existing: 'preserved' } });
const getRows = result => JSON.parse(result.content[0].text).data;

test('source shortcuts default to todo and combine with dated workload in either flag order', () => {
  assert.deepEqual(parsePersonalCli(['--proj']), { mode: 'todo', sourceScope: 'project' });
  assert.deepEqual(parsePersonalCli(['--dev']), { mode: 'todo', sourceScope: 'non-project' });
  for (const args of [['--workload', '2026-10-19', '2026-10-20', '--dev'], ['--dev', '--workload', '2026-10-19~2026-10-20']]) {
    assert.deepEqual(parsePersonalCli(args), { mode: 'workload', sourceScope: 'non-project', date: '2026-10-19', date2: '2026-10-20' });
  }
  assert.deepEqual(parsePersonalCli(['--todo', '--proj', '2026-10-23']), { mode: 'todo', sourceScope: 'project', date: '2026-10-23', date2: '2026-10-23' });
  for (const args of [['--proj', '--dev'], ['--dev', '--dev'], ['--proj', '--workload'], ['--proj', '--unknown']]) assert.throws(() => parsePersonalCli(args));
});

test('source scopes preserve filters and never invent upstream negation or multi-value syntax', () => {
  const project = queryArguments({ sourceScope: 'project' }, 'sample-user', 'ignored-group');
  assert.equal(project.source, '项目'); assert.equal(project.tuser, 'sample-user'); assert.equal(project.cuser, 'sample-user'); assert.equal(project.cgroup, '');
  const dev = queryArguments({ mode: 'workload', sourceScope: 'non-project', date: '2026-10-23', product: 'sample-product' }, 'sample-user');
  assert.equal(dev.source, ''); assert.equal(dev.product, 'sample-product'); assert.equal(Object.hasOwn(dev, 'sourceScope'), false);
  assert.equal(queryArguments({ sourceScope: 'non-project', source: '用户' }, 'sample-user').source, '用户');
  for (const input of [{ sourceScope: 'invalid' }, { sourceScope: 'project', source: '用户' }, { sourceScope: 'non-project', source: '项目' }, { mode: 'history', sourceScope: 'project' }]) assert.throws(() => queryArguments(input, 'sample-user'));
});

test('source classification includes every non-project source and reports absent or malformed sources', async t => {
  const sources = ['项目', '产品', '用户', '实施', '产品部', '', undefined, 7];
  for (const mode of ['todo', 'workload']) {
    const rows = sources.map((source, i) => ({ '需求号': String(i + 1), '来源': source, '状态': mode === 'todo' ? '修正' : '挂起', '接受人': 'sample-user', '当前人': mode === 'todo' ? 'sample-user' : 'reviewer', '执行时间': '2026-10-23', '预计完成时间': '2026-10-23' }));
    t.mock.method(globalThis, 'fetch', mock({ result: listResult(rows) }).fetchImpl);
    for (const [sourceScope, ids] of [['project', ['1']], ['non-project', ['2', '3', '4', '5']], ['all', ['1', '2', '3', '4', '5', '6', '7', '8']]]) {
      const result = await query(config, { mode, sourceScope, date: '2026-10-23' }, 'sample-user', 'ignored-group');
      assert.deepEqual(getRows(result).map(x => x['需求号']), ids);
      const meta = result._meta.bosDemandQuery;
      assert.equal(meta.personal.sourceScope, sourceScope);
      assert.equal(meta.personal.unclassifiedCount, sourceScope === 'all' ? 0 : 3);
      assert.deepEqual(meta.personal.unclassifiedDetails.map(item => item.code), sourceScope === 'all' ? [] : ['missing-source', 'missing-source', 'missing-source']);
      assert.equal(meta.returnedCount, 8);
      assert.equal(meta.includedCount + meta.excludedCount, 8);
    }
    const exact = await query(config, { mode, sourceScope: 'all', source: '产品', date: '2026-10-23' }, 'sample-user');
    assert.equal(exact._meta.bosDemandQuery.personal.sourceBasis, '来源=产品');
    const narrowed = await query(config, { mode, sourceScope: 'non-project', source: '产品', date: '2026-10-23' }, 'sample-user');
    assert.match(narrowed._meta.bosDemandQuery.personal.sourceBasis, /另限来源=产品/);
  }
});

test('source shortcuts are discoverable and help does not require credentials', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/bos-demand-query.js'), '--proj', '--help'], { encoding: 'utf8', env: { ...process.env, BOS_MCP_CONFIG: path.resolve('nonexistent-config') } });
  assert.equal(r.status, 0); assert.match(r.stdout, /--proj/); assert.match(r.stdout, /--dev/);
  assert.deepEqual(tool.inputSchema.properties.sourceScope.enum, ['all', 'project', 'non-project']);
});

test('personal CLI accepts all date sort fields and directions independently of source or filter dates', () => {
  const fields = ['创建时间', '预计完成时间', '分配时间', '执行时间', '操作时间'];
  for (const sort of fields) {
    assert.deepEqual(parsePersonalCli(['--proj', '--sort', sort, '--order', 'desc']), { mode: 'todo', sourceScope: 'project', sort, order: 'desc' });
    assert.deepEqual(parsePersonalCli(['--order', 'asc', '--dev', '--sort', sort]), { mode: 'todo', sourceScope: 'non-project', sort, order: 'asc' });
  }
  const dated = parsePersonalCli(['--todo', '2026-10-23', '--sort', '分配时间']);
  const args = queryArguments(dated, 'sample-user');
  assert.equal(args.datetype, '预计完成时间'); assert.equal(args.date, '2026-10-23');
  assert.equal(Object.hasOwn(args, 'sort'), false); assert.equal(Object.hasOwn(args, 'order'), false);
  for (const argv of [['--todo', '--sort'], ['--proj', '--sort', '标题'], ['--dev', '--order', 'up'], ['--todo', '--sort', '创建时间', '--sort', '预计完成时间'], ['--dev', '--order', 'asc', '--order', 'desc']]) assert.throws(() => parsePersonalCli(argv));
  const { spawnSync } = require('node:child_process');
  for (const flag of ['--sort', '--order']) {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/bos-demand-query.js'), flag], { encoding: 'utf8', env: { ...process.env, BOS_MCP_CONFIG: path.resolve('nonexistent-config') } });
    assert.equal(result.status, 1); assert.match(result.stderr, /需提供一个合法值/); assert.doesNotMatch(result.stderr, /配置/);
  }
});

test('all todo source scopes default to creation day ascending and allow other date fields in both directions', async t => {
  const rows = [
    { '需求号': '10', '创建时间': '2026-10-02', '预计完成时间': '2026-10-01', '分配时间': '2026-10-03', '执行时间': '2026-10-04', '操作时间': '2026-10-02' },
    { '需求号': '2', '创建时间': '2026-10-01', '预计完成时间': '2026-10-03', '分配时间': '2026-10-01', '执行时间': '2026-10-02', '操作时间': '2026-10-01' },
    { '需求号': '3', '创建时间': '2026-10-02', '预计完成时间': '2026-10-02', '分配时间': '2026-10-02', '执行时间': '2026-10-01', '操作时间': '2026-10-03' },
    { '需求号': '4', '创建时间': 'invalid', '预计完成时间': '', '执行时间': 'invalid', '操作时间': null }
  ].map(row => ({ ...row, '状态': '分配', '接受人': 'sample-user', '当前人': 'sample-user' }));
  const expected = {
    '创建时间': [['2', '3', '10', '4'], ['3', '10', '2', '4']],
    '预计完成时间': [['10', '3', '2', '4'], ['2', '3', '10', '4']],
    '分配时间': [['2', '3', '10', '4'], ['10', '3', '2', '4']],
    '执行时间': [['3', '2', '10', '4'], ['10', '2', '3', '4']],
    '操作时间': [['2', '10', '3', '4'], ['3', '10', '2', '4']]
  };
  for (const sourceScope of ['all', 'project', 'non-project']) {
    t.mock.method(globalThis, 'fetch', mock({ result: listResult(rows.map(row => ({ ...row, '来源': sourceScope === 'project' ? '项目' : '产品' }))) }).fetchImpl);
    const defaults = await query(config, { mode: 'todo', sourceScope }, 'sample-user');
    assert.deepEqual(getRows(defaults).map(x => x['需求号']), expected['创建时间'][0]);
    assert.equal(defaults._meta.bosDemandQuery.sort, '创建时间'); assert.equal(defaults._meta.bosDemandQuery.order, 'asc');
    for (const [sort, orders] of Object.entries(expected)) for (const [index, order] of ['asc', 'desc'].entries()) {
      const result = await query(config, { mode: 'todo', sourceScope, sort, order }, 'sample-user');
      assert.deepEqual(getRows(result).map(x => x['需求号']), orders[index]);
      assert.equal(result._meta.bosDemandQuery.missingSortDateCount, 1);
      assert.equal(result._meta.bosDemandQuery.includedCount, 4);
    }
  }
});

test('personal CLI accepts all todos, single days and inclusive ranges, but workload requires dates', () => {
  assert.deepEqual(parsePersonalCli(['--todo']), { mode: 'todo' });
  for (const flag of ['--todo', '--workload']) {
    const mode = flag.slice(2);
    assert.deepEqual(parsePersonalCli([flag, '2026-10-23']), { mode, date: '2026-10-23', date2: '2026-10-23' });
    for (const dates of [['2026-10-01', '2026-10-23'], ['2026-10-01~2026-10-23']]) {
      assert.deepEqual(parsePersonalCli([flag, ...dates]), { mode, date: '2026-10-01', date2: '2026-10-23' });
    }
  }
  for (const argv of [['--workload'], ['--todo', '2026-02-30'], ['--todo', '2026-10-23~'], ['--todo', '2026-10-23', '2026-10-01'], ['--todo', '--workload'], ['--todo', '2026-01-01', '2026-01-02', 'extra']]) assert.throws(() => parsePersonalCli(argv));
  const { spawnSync } = require('node:child_process');
  const script = path.resolve(__dirname, '../scripts/bos-demand-query.js');
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, BOS_MCP_CONFIG: path.resolve('nonexistent-private-config') } });
  const missing = run(['--workload']);
  assert.equal(missing.status, 1); assert.match(missing.stderr, /必须提供执行日期/); assert.doesNotMatch(missing.stderr, /配置/);
  const help = run(['--workload', '--help']);
  assert.equal(help.status, 0); assert.match(help.stdout, /--todo/); assert.match(help.stdout, /--workload/);
});

test('personal scopes clear hidden group filters and map due dates or execution dates including the last day', () => {
  const now = new Date('2026-10-22T16:30:00Z');
  const all = queryArguments({ mode: 'todo' }, 'sample-user', 'sample-group', now);
  assert.equal(all.tuser, 'sample-user'); assert.equal(all.cuser, 'sample-user'); assert.equal(all.cgroup, '');
  assert.equal(all.datetype, '创建时间'); assert.equal(all.date, '1900-01-01'); assert.equal(all.date2, '2026-10-24');
  for (const mode of ['todo', 'workload']) {
    const args = queryArguments({ mode, date: '2026-10-23' }, 'sample-user', 'sample-group', now);
    assert.equal(args.tuser, 'sample-user'); assert.equal(args.cgroup, '');
    assert.equal(args.cuser, mode === 'todo' ? 'sample-user' : '');
    assert.equal(args.datetype, mode === 'todo' ? '预计完成时间' : '执行时间');
    assert.equal(args.date, '2026-10-23'); assert.equal(args.date2, '2026-10-24');
    assert.equal(Object.hasOwn(args, 'mode'), false);
    for (const input of [{ mode, date: '2026-10-23', cgroup: 'hidden-group' }, { mode, date: '2026-10-23', datetype: '操作时间' }, { mode, date2: '2026-10-23' }, { mode, date: '2026-10-23', date2: '2026-10-01' }]) assert.throws(() => queryArguments(input, 'sample-user', 'sample-group'));
  }
  assert.throws(() => queryArguments({ mode: 'workload' }, 'sample-user'), /必须提供执行日期/);
  assert.throws(() => queryArguments({ mode: 'todo' }), /本人身份/);
  assert.throws(() => queryArguments({ mode: 'todo' }, 'TODO'), /TODO/);
  assert.throws(() => queryArguments({ mode: 'todo', sgroup: 'TODO' }, 'sample-user'), /TODO/);
  const filtered = queryArguments({ mode: 'workload', date: '2026-10-23', source: '项目', sgroup: 'chosen-origin', body: { opaque: true } }, 'sample-user', 'ignored-group');
  assert.equal(filtered.source, '项目'); assert.equal(filtered.sgroup, 'chosen-origin'); assert.deepEqual(filtered.body, { opaque: true });
  assert.throws(() => queryArguments({ mode: 'workload', date: '9999-12-31' }, 'sample-user'), /截止日期/);
});

const personalRows = [
  ['1', '分配', 'sample-user', 'sample-user', ''],
  ['2', '修正', 'sample-user', 'sample-user', '2026-10-23 01:00:00'],
  ['3', '挂起', 'sample-user', 'reviewer', '2026-10-23 02:00:00'],
  ['4', '组内测试', 'sample-user', 'tester', '2026-10-23 03:00:00'],
  ['5', '完成', 'sample-user', 'sample-user', '2026-10-23 23:59:59'],
  ['6', '完成', 'other-developer', 'sample-user', '2026-10-23 04:00:00'],
  ['7', '分配', 'sample-user', 'sample-user', '2026-10-23 05:00:00'],
  ['8', '取消', 'sample-user', 'reviewer', '2026-10-23 06:00:00'],
  ['9', '回置', 'sample-user', 'reviewer', ''],
  ['10', '新状态', 'sample-user', 'reviewer', '2026-10-23 07:00:00'],
  ['11', '完成', 'sample-user', 'reviewer', '2026-10-24 00:00:00'],
  ['12', '完成', 'sample-user', 'reviewer', ''],
  ['13', '活动', 'sample-user', 'sample-user', ''],
  ['14', '已拆分', 'sample-user', 'reviewer', '2026-10-23 08:00:00'],
  ['15', '测试分配', 'sample-user', 'reviewer', '2026-10-23 09:00:00'],
  ['16', '更新完成', 'sample-user', 'reviewer', '2026-10-23 10:00:00'],
  ['17', '测试完成', 'sample-user', 'reviewer', '2026-10-23 11:00:00'],
  ['18', '分配(开发)', 'sample-user', 'sample-user', ''],
  ['19', '新建', 'sample-user', 'sample-user', '']
].map(([id, status, receiver, current, executed]) => ({ '需求号': id, '状态': status, '接受人': receiver, '当前人': current, '执行时间': executed, '创建时间': '2026-01-01', '预计完成时间': id === '13' ? '' : '2026-10-23 23:59:59' }));

test('todo uses both people and active states, includes rework and previously executed assignments, and allows undated work', async t => {
  t.mock.method(globalThis, 'fetch', mock({ result: listResult(personalRows) }).fetchImpl);
  const all = await query(config, { mode: 'todo' }, 'sample-user', 'sample-group');
  assert.deepEqual(getRows(all).map(x => x['需求号']), ['1', '2', '7', '13', '18', '19']);
  assert.equal(all._meta.bosDemandQuery.personal.range, null);
  const dated = await query(config, { mode: 'todo', date: '2026-10-23' }, 'sample-user', 'sample-group');
  assert.deepEqual(getRows(dated).map(x => x['需求号']), ['1', '2', '7', '18', '19']);
  assert.equal(dated._meta.bosDemandQuery.personal.unclassifiedCount, 1);
  assert.equal(dated._meta.bosDemandQuery.personal.unclassified[0]['需求号'], '10');
});

test('workload counts handoffs including suspended and self-completed work, not rework, cancellations or next-day rows', async t => {
  const m = mock({ result: listResult(personalRows) });
  t.mock.method(globalThis, 'fetch', m.fetchImpl);
  const actual = await query(config, { mode: 'workload', date: '2026-10-23' }, 'sample-user', 'sample-group');
  assert.deepEqual(getRows(actual).map(x => x['需求号']), ['3', '4', '5', '15', '16', '17']);
  const summary = actual._meta.bosDemandQuery;
  assert.equal(summary.returnedCount, 19); assert.equal(summary.includedCount, 6); assert.equal(summary.excludedCount, 13);
  assert.deepEqual(summary.personal.range, { date: '2026-10-23', date2: '2026-10-23', inclusive: true });
  assert.equal(summary.personal.unclassifiedCount, 1);
  assert.equal(summary.personal.excludedReasons['other-receiver'], 1);
  assert.equal(summary.personal.excludedReasons['non-work'], 3);
  assert.equal(summary.filters.cuser, ''); assert.equal(summary.filters.cgroup, '');
  assert.equal(summary.filters.date2, '2026-10-24');
  const call = JSON.parse(m.calls.at(-1).body).params;
  assert.equal(call.name, 'post_imedway_ylxt_bosdata'); assert.deepEqual(call.arguments, summary.filters);
  const narrowed = await query(config, { mode: 'workload', date: '2026-10-23', status: '修正' }, 'sample-user');
  assert.ok(!getRows(narrowed).some(x => x['状态'] === '修正'));
});

test('workload recognizes testing stages and self test assignment while retaining ownership and date guards', async t => {
  const rows = [
    ['1', '测试', 'sample-user', 'tester', '2026-10-23'],
    ['2', '发布测试', 'sample-user', 'tester', '2026-10-23'],
    ['3', '测试分配', 'sample-user', 'sample-user', '2026-10-23'],
    ['4', '分配', 'sample-user', 'sample-user', '2026-10-23'],
    ['5', '修正', 'sample-user', 'sample-user', '2026-10-23'],
    ['6', '测试', 'other-developer', 'sample-user', '2026-10-23'],
    ['7', '测试', 'sample-user', 'tester', '2026-10-24'],
    ['8', '发布测试', 'sample-user', 'tester', ''],
    ['9', '未知阶段', 'sample-user', 'tester', '2026-10-23'],
    ['10', '测试', 'sample-user', 'sample-user', '2026-10-23'],
    ['11', '发布测试', 'sample-user', 'sample-user', '2026-10-23'],
    ['12', '测试分配', 'sample-user', '', '2026-10-23']
  ].map(([id, status, receiver, current, day]) => ({ '需求号': id, '状态': status, '接受人': receiver, '当前人': current, '执行时间': day }));
  t.mock.method(globalThis, 'fetch', mock({ result: listResult(rows) }).fetchImpl);
  const result = await query(config, { mode: 'workload', date: '2026-10-23' }, 'sample-user');
  assert.deepEqual(getRows(result).map(row => row['需求号']), ['1', '2', '3']);
  const meta = result._meta.bosDemandQuery;
  assert.equal(meta.returnedCount, 12); assert.equal(meta.includedCount, 3); assert.equal(meta.excludedCount, 9);
  assert.equal(meta.personal.excludedReasons['still-owned'], 2);
  assert.equal(meta.personal.excludedReasons['other-receiver'], 1);
  assert.equal(meta.personal.excludedReasons['outside-date'], 2);
  assert.equal(meta.personal.unclassifiedCount, 4);
  assert.deepEqual(meta.personal.unclassifiedDetails.map(({ id, code }) => [id, code]), [
    ['9', 'unknown-status'], ['10', 'ownership-status-mismatch'], ['11', 'ownership-status-mismatch'], ['12', 'missing-fields']
  ]);
  assert.match(meta.personal.unclassifiedDetails[0].reason, /未知阶段/);
  const todo = await query(config, { mode: 'todo' }, 'sample-user');
  assert.deepEqual(getRows(todo).map(row => row['需求号']), ['4', '5']);
});

test('requery classifies the current status and execution date instead of a previous snapshot', async t => {
  const row = { '需求号': '1', '接受人': 'sample-user', '当前人': 'sample-user', '状态': '分配', '执行时间': '2026-10-22' };
  t.mock.method(globalThis, 'fetch', mock({ result: listResult([row]) }).fetchImpl);
  const input = { mode: 'workload', date: '2026-10-23' };
  assert.equal(getRows(await query(config, input, 'sample-user')).length, 0);
  Object.assign(row, { '当前人': 'tester', '状态': '发布测试', '执行时间': '2026-10-23' });
  t.mock.method(globalThis, 'fetch', mock({ result: listResult([row]) }).fetchImpl);
  assert.deepEqual(getRows(await query(config, input, 'sample-user')).map(item => item['需求号']), ['1']);
});

test('stdio exposes and executes the same personal workload mode', async t => {
  t.mock.method(globalThis, 'fetch', mock({ result: listResult(personalRows) }).fetchImpl);
  const input = new PassThrough(), output = new PassThrough(); let text = '';
  output.on('data', chunk => text += chunk);
  const running = serve(config, { BOS_CUSER: 'sample-user', BOS_CGROUP: 'sample-group' }, input, output);
  input.end([
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bos_demand_query', arguments: { mode: 'workload', date: '2026-10-23' } } }
  ].map(JSON.stringify).join('\n') + '\n');
  await running;
  const result = JSON.parse(text.trim().split('\n')[1]).result;
  assert.equal(result._meta.bosDemandQuery.includedCount, 6);
  assert.ok(tool.inputSchema.properties.mode.enum.includes('todo'));
  assert.ok(tool.inputSchema.properties.mode.enum.includes('workload'));
});

test('personal ranges retain both whole endpoint days and all-todo retains future and unset due dates', async t => {
  const row = (id, day) => ({ '需求号': id, '状态': '完成', '接受人': 'sample-user', '当前人': 'reviewer', '执行时间': day });
  const rows = [row('1', '2026-10-01 00:00:00'), row('2', '2026-10-23 23:59:59'), row('3', '2026-09-30 23:59:59'), row('4', '2026-10-24 00:00:00'), row('5', 'invalid'), { ...row('6', '2026-10-10'), '当前人': '' }];
  const m = mock({ result: listResult(rows) });
  t.mock.method(globalThis, 'fetch', m.fetchImpl);
  const result = await query(config, { mode: 'workload', date: '2026-10-01', date2: '2026-10-23' }, 'sample-user');
  assert.deepEqual(getRows(result).map(x => x['需求号']), ['1', '2']);
  assert.equal(result._meta.bosDemandQuery.personal.unclassifiedCount, 1);
  assert.equal(JSON.parse(m.calls.at(-1).body).params.arguments.date2, '2026-10-24');
  const todos = ['', '2027-01-01'].map((day, i) => ({ '需求号': String(i), '状态': '分配', '接受人': 'sample-user', '当前人': 'sample-user', '预计完成时间': day }));
  globalThis.fetch.mock.mockImplementation(mock({ result: listResult(todos) }).fetchImpl);
  const all = await query(config, { mode: 'todo' }, 'sample-user');
  assert.equal(getRows(all).length, 2);
  assert.equal(all._meta.bosDemandQuery.personal.range, null);
});

test('pending queries exclude only provisional terminal states, sort by day and numeric ID, and report actual counts', async (t) => {
  const m = mock({ result: listResult() });
  t.mock.method(globalThis, 'fetch', m.fetchImpl);
  const actual = await query(config, { mode: 'pending', sgroup: 'origin-group' }, 'sample-user', 'personal-group');
  assert.deepEqual(getRows(actual).map(row => row['需求号']), ['9', '9007199254740993', '2', '10', '12']);
  assert.deepEqual(actual.content[1], listResult().content[1]);
  const summary = actual._meta.bosDemandQuery;
  assert.equal(actual._meta.existing, 'preserved');
  assert.equal(summary.returnedCount, 8); assert.equal(summary.includedCount, 5); assert.equal(summary.excludedCount, 3);
  assert.equal(summary.pendingApplied, true); assert.equal(summary.provisionalPendingRule, true); assert.equal(summary.missingSortDateCount, 1);
  assert.deepEqual(summary.excludedStatuses, ['完成', '取消', '已拆分']);
  assert.equal(summary.statuses['测试'], 1); assert.equal(summary.statuses['新状态'], 1); assert.equal(summary.statuses['（缺失）'], 1);
  const upstream = JSON.parse(m.calls.at(-1).body).params.arguments;
  assert.equal(upstream.cuser, 'sample-user'); assert.equal(upstream.cgroup, 'personal-group'); assert.equal(upstream.sgroup, 'origin-group');
  assert.equal(upstream.date, '1900-01-01'); assert.equal(upstream.datetype, '创建时间');
  assert.equal(Object.hasOwn(upstream, 'mode'), false);
});

test('history and explicit status queries preserve terminal states without applying pending filtering', async (t) => {
  const m = mock({ result: listResult() });
  t.mock.method(globalThis, 'fetch', m.fetchImpl);
  for (const input of [{ mode: 'history' }, { mode: 'pending', status: '完成' }, { date: '2026-10-01', date2: '2026-10-13' }]) {
    const actual = await query(config, input, 'sample-user', 'personal-group');
    assert.equal(getRows(actual).length, 8);
    assert.equal(actual._meta.bosDemandQuery.pendingApplied, false);
    assert.equal(actual._meta.bosDemandQuery.provisionalPendingRule, false);
    assert.equal(actual._meta.bosDemandQuery.excludedCount, 0);
    assert.deepEqual(actual._meta.bosDemandQuery.excludedStatuses, []);
    assert.equal(JSON.parse(m.calls.at(-1).body).params.arguments.status, input.status || '');
  }
});

test('explicit due-date sorting supports both directions while missing dates remain last', async (t) => {
  t.mock.method(globalThis, 'fetch', mock({ result: listResult() }).fetchImpl);
  for (const [order, expected] of [['asc', ['2', '10', '9007199254740993', '9', '12']], ['desc', ['9', '9007199254740993', '2', '10', '12']]]) {
    const actual = await query(config, { mode: 'project-pending', sort: '预计完成时间', order }, 'sample-user', 'personal-group');
    assert.deepEqual(getRows(actual).map(row => row['需求号']), expected);
    assert.equal(actual._meta.bosDemandQuery.filters.source, '项目');
  }
});

test('empty results produce zero counts; malformed lists fail without pretending they are empty', async (t) => {
  t.mock.method(globalThis, 'fetch', mock({ result: listResult([]) }).fetchImpl);
  const empty = await query(config, { mode: 'pending' }, 'sample-user', 'personal-group');
  assert.deepEqual(getRows(empty), []); assert.equal(empty._meta.bosDemandQuery.returnedCount, 0);
  for (const result of [{ content: [{ type: 'text', text: '{"code":200,"data":null}' }] }, { content: [{ type: 'text', text: '{"code":200,"data":[null]}' }] }, { content: [listResult().content[0], listResult().content[0]] }]) {
    globalThis.fetch.mock.mockImplementation(mock({ result }).fetchImpl);
    await assert.rejects(query(config, { mode: 'pending' }, 'sample-user', 'personal-group'), /列表.*结构无效/);
  }
  const failure = { content: [{ type: 'text', text: '{"code":500,"message":"sample failure"}' }] };
  globalThis.fetch.mock.mockImplementation(mock({ result: failure }).fetchImpl);
  const actual = await query(config, { mode: 'pending' }, 'sample-user', 'personal-group');
  assert.equal(actual.isError, true); assert.equal(actual._meta, undefined);
});

test('stdio uses the same pending rules and keeps personal group and origin group independent', async (t) => {
  const m = mock({ result: listResult() });
  t.mock.method(globalThis, 'fetch', m.fetchImpl);
  const input = new PassThrough(); const output = new PassThrough(); let text = '';
  output.on('data', chunk => { text += chunk; });
  const running = serve(config, { BOS_CUSER: 'sample-user', BOS_CGROUP: 'personal-group' }, input, output);
  input.end([
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bos_demand_query', arguments: { mode: 'pending', sgroup: 'origin-group' } } }
  ].map(JSON.stringify).join('\n') + '\n');
  await running;
  const result = JSON.parse(text.trim().split('\n')[1]).result;
  assert.equal(result._meta.bosDemandQuery.includedCount, 5);
  assert.equal(result._meta.bosDemandQuery.filters.cgroup, 'personal-group');
  assert.equal(result._meta.bosDemandQuery.filters.sgroup, 'origin-group');
});

test('stdio discovers the full upstream parameters and queries an origin role without current defaults', async (t) => {
  const m = mock({ result: listResult() });
  t.mock.method(globalThis, 'fetch', m.fetchImpl);
  const input = new PassThrough(); const output = new PassThrough(); let text = '';
  output.on('data', chunk => { text += chunk; });
  const running = serve(config, { BOS_CUSER: 'default-current', BOS_CGROUP: 'default-group' }, input, output);
  input.end([
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bos_demand_query', arguments: { mode: 'pending', suser: 'chosen-origin', cuser: '', cgroup: '', body: { opaque: true } } } }
  ].map(JSON.stringify).join('\n') + '\n');
  await running;
  const replies = text.trim().split('\n').map(JSON.parse);
  const properties = replies[1].result.tools[0].inputSchema.properties;
  for (const key of ['suser', 'tuser', 'tgroup', 'explain']) assert.equal(properties[key].type, 'string');
  assert.equal(properties.body.type, 'object');
  const result = replies[2].result;
  assert.equal(result._meta.bosDemandQuery.filters.suser, 'chosen-origin');
  assert.equal(result._meta.bosDemandQuery.filters.cuser, '');
  assert.equal(result._meta.bosDemandQuery.filters.cgroup, '');
  assert.equal(result._meta.bosDemandQuery.includedCount, 5);
  assert.deepEqual(JSON.parse(m.calls.at(-1).body).params.arguments.body, { opaque: true });
});
