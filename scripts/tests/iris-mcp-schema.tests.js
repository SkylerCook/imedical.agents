'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { callTool, listTools } = require('../iris-mcp');
test('namespace follows actual schema and catalog is reused without mutating callers', async () => {
  const calls = [];
  const client = { async request(method, params) {
    calls.push({ method, params });
    if (method === 'tools/list') return { result: { tools: [{ name: 'check_config', inputSchema: { type: 'object', additionalProperties: false, properties: {} } }, { name: 'iris_doc', inputSchema: { properties: { namespace: { type: 'string' } } } }] } };
    return { result: { content: [{ text: '{}' }] } };
  } };
  const args = { mode: 'head' };
  await callTool(client, 'check_config', {}, { defaultNamespace: 'TEST' });
  await callTool(client, 'iris_doc', args, { defaultNamespace: 'TEST' });
  await callTool(client, 'iris_doc', { namespace: 'EXPLICIT' }, { defaultNamespace: 'TEST' });
  assert.deepEqual(calls[1].params.arguments, {});
  assert.deepEqual(calls[2].params.arguments, { mode: 'head', namespace: 'TEST' });
  assert.equal(calls[3].params.arguments.namespace, 'EXPLICIT');
  assert.deepEqual(args, { mode: 'head' });
  const catalog = await listTools(client); catalog[1].inputSchema.properties = {};
  assert.ok((await listTools(client))[1].inputSchema.properties.namespace);
  assert.equal(calls.filter(c => c.method === 'tools/list').length, 1);
  await assert.rejects(callTool(client, 'iris_execute', {}, { defaultNamespace: 'TEST' }), /Blocked/);
  assert.equal(calls.length, 4);
});
test('pagination, concurrent reuse, absent schema and failed catalogs fail safely', async () => {
  let count = 0;
  const client = { async request(method, params) {
    if (method === 'tools/call') return { result: { content: [{ text: '{}' }] } };
    count++;
    return params.cursor ? { result: { tools: [{ name: 'iris_doc' }] } } : { result: { tools: [], nextCursor: 'second' } };
  } };
  await Promise.all([listTools(client), listTools(client)]);
  assert.equal(count, 2);
  await callTool(client, 'iris_doc', {}, { defaultNamespace: 'TEST' });
  assert.equal(count, 2);
  let failed = 0;
  const broken = { async request() { failed++; return { error: { message: 'unavailable' } }; } };
  await assert.rejects(callTool(broken, 'check_config', {}, { defaultNamespace: 'TEST' }), /catalog/);
  await assert.rejects(listTools(broken), /catalog/);
  assert.equal(failed, 2);
});
