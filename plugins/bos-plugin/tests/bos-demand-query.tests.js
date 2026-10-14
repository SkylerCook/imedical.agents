'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const { queryArguments, loadConfig, withClient, query, serve, tool } = require('../scripts/bos-demand-query');
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
