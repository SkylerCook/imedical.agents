'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const { queryArguments, loadConfig, withClient, query, serve } = require('../scripts/bos-demand-query');
const config = { url: 'https://example.invalid/sse?access_key=test-key', headers: { 'X-Gateway-Upstream-BOS-MCP-TOKEN': 'test-token' } };

test('personal identity is supplied by caller or environment and never inferred', () => {
  const date = { date: '2026-01-01', date2: '2026-01-02' };
  assert.throws(() => queryArguments(date), /cuser/);
  assert.equal(queryArguments(date, 'sample-user').cuser, 'sample-user');
  assert.equal(queryArguments({ ...date, cuser: 'explicit-user' }, 'sample-user').cuser, 'explicit-user');
  assert.throws(() => queryArguments({ ...date, suser: 'other' }), /参数/);
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

test('configuration requires HTTPS and personal token, without leaking invalid input', () => {
  assert.deepEqual(loadConfig({ BOS_MCP_URL: config.url, BOS_MCP_TOKEN: 'test-token' }), config);
  assert.throws(() => loadConfig({ BOS_MCP_URL: 'http://example.invalid', BOS_MCP_TOKEN: 'test-token' }), /HTTPS/);
  assert.throws(() => loadConfig({ BOS_MCP_URL: config.url, BOS_MCP_TOKEN: 'xxxxx' }), /Token/);
  assert.throws(() => loadConfig({ BOS_MCP_CONFIG: 'missing-private-config' }), /无法读取/);
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
  assert.equal(replies[0].result.serverInfo.version, require('../.agents-plugin/plugin.json').version);
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
  t.mock.method(fs, 'readFileSync', () => JSON.stringify({ ...config, cgroup: 'sample-group' }));
  assert.equal(loadConfig({ BOS_MCP_CONFIG: "explicit-private-file" }).cgroup, 'sample-group');
  fs.readFileSync.mock.mockImplementation(() => JSON.stringify({ ...config, cgroup: 42 }));
  assert.throws(() => loadConfig({ BOS_MCP_CONFIG: "explicit-private-file" }), /cgroup/);
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

test('synthetic BOS detail feeds the existing IRIS standard commit planner without committing', async t => {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bos-iris-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const emptyConfig = path.join(root, 'empty-config');
  fs.writeFileSync(emptyConfig, '');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig };
  const repo = path.join(root, 'business'); fs.mkdirSync(repo);
  function run(command, args) {
    const r = spawnSync(command, args, { cwd: repo, env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
    assert.equal(r.status, 0, String(r.error || '') + r.stderr);
    return r.stdout.trim();
  }
  const git = args => run('git', ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid', ...args]);
  git(['init']); fs.writeFileSync(path.join(repo, 'options.txt'), 'before\n');
  git(['add','.']); git(['commit','-m','fixture']);
  const head = git(['rev-parse','HEAD']);
  fs.writeFileSync(path.join(repo, 'options.txt'), 'valid options\n');
  const detail = { id: '12345', title: '合成需求：申请选项包含失效记录', content: '预期只展示有效选项，实际包含失效项。' };
  const m = mock({ result: { content: [{ type: 'text', text: JSON.stringify({ code: 200, data: [detail] }) }] } });
  t.mock.method(globalThis, 'fetch', m.fetchImpl);
  const response = await query(config, { id: detail.id });
  const payload = JSON.parse(response.content[0].text);
  assert.equal(payload.code, 200);
  const fact = payload.data[0]; assert.equal(fact.id, detail.id);
  // Simulates the documented handoff after facts and scope have been confirmed.
  const script = path.resolve(__dirname, '../../coding-iris-plugin/scripts/iris-tools/commit-demand.js');
  const planned = JSON.parse(run(process.execPath, [script, 'plan', '--project-root', repo,
    '--kind','standard','--demand',fact.id,'--title',fact.title,'--type','fix','--subject','申请选项',
    '--file','options.txt','--modification','使用有效期过滤申请选项，确保失效记录不再显示并保留维护页原有行为',
    '--output',path.join(root,'plan.json')]));
  assert.equal(planned.title, fact.title);
  assert.deepEqual(planned.repositories[0].files, ['options.txt']);
  assert.equal(planned.repositories[0].message.trim().split('\n').length, 3);
  assert.ok(planned.repositories[0].message.includes('需求描述:' + fact.id + ' ' + fact.title));
  assert.equal(git(['rev-parse','HEAD']), head);
  assert.equal(git(['diff','--cached','--name-only']), '');
});
