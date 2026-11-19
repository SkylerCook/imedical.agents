'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const helper = path.resolve(__dirname, '../iris-mcp.js');

test('CLI filters schemas, emits one JSON object, preserves legacy output and write gates', () => {
  const tempBase = process.env.CODEX_TEST_TMP_ROOT || path.join(os.tmpdir(), 'Codex');
  fs.mkdirSync(tempBase, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempBase, 'iris-mcp-cli-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('IRIS_')) delete env[key];
  const run = (...args) => spawnSync(process.execPath, [helper, ...args], { cwd: root, env, encoding: 'utf8', timeout: 20000 });
  try {
    fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { 'iris-agentic-dev': { command: process.execPath, env: { IRIS_NAMESPACE: 'TEST' } } } }));
    fs.writeFileSync(path.join(root, 'mcp'), `
const fs = require('node:fs');
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const req = JSON.parse(line);
  fs.appendFileSync('requests.jsonl', line + '\\n');
  if (!req.id) return;
  let result = {};
  if (req.method === 'tools/list') result = { tools: ['check_config', 'iris_doc', 'iris_global'].map(name => ({ name, inputSchema: { type: 'object', properties: name === 'check_config' ? {} : { namespace: { type: 'string' } } } })) };
  if (req.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify(req.params.name === 'check_config' ? (fs.existsSync('fixture-check.json') ? JSON.parse(fs.readFileSync('fixture-check.json')) : {connected:false}) : req.params.arguments) }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\\n');
});`);
    let result = run('tools', '--names', 'iris_global,iris_doc,iris_global', '--schema', '--json');
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.TOOLS, ['iris_global', 'iris_doc']);
    assert.deepEqual(output.TOOL_SCHEMAS.map(tool => tool.name), output.TOOLS);
    assert.equal(output.CHECK.connected, false);
    assert.equal(output.CHECK.warnings.length, 1);
    const requests = fs.readFileSync(path.join(root, 'requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(requests.filter(req => req.method === 'tools/list').length, 1);
    assert.equal(requests.filter(req => req.params?.name === 'check_config').length, 1);
    result = run('tools', '--names', 'iris_missing', '--schema', '--json');
    assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).ERROR.code, 'iris-operation-failed'); assert.match(result.stderr, /Unknown or unavailable/);
    for (const args of [['tools', '--names'], ['tools', '--names', 'iris_doc,'], ['check', '--names', 'iris_doc']]) {
      result = run(...args, '--json'); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).ERROR.code, 'iris-operation-failed');
    }
    result = run('tools', '--schema');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split(/\r?\n/).map(line => line.split('=')[0]), ['CHECK', 'TOOLS', 'TOOL_SCHEMAS']);
    result = run('call', 'iris_doc', '{}', '--json');
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).RESULT.namespace, 'TEST');
    result = run('call', 'iris_doc', '{"mode":"put"}', '--json');
    assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).ERROR.code, 'iris-operation-failed'); assert.match(result.stderr, /Blocked/);
    result = run('call', 'iris_doc', '{"mode":"put"}', '--allow-write', '--json');
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).RESULT.mode, 'put');
    fs.writeFileSync(path.join(root, 'args.json'), JSON.stringify({ mode: 'head', namespace: 'EXPLICIT' }));
    result = run('call', 'iris_doc', '--json-file', path.join(root, 'args.json'), '--json');
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).RESULT.namespace, 'EXPLICIT');
    result = run('check', '--json');
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(Object.keys(JSON.parse(result.stdout)), ['CHECK']);

    const context={workspaceRoot:root,contextRoot:path.join(root,'.agents')};
    const config=path.join(context.contextRoot,'config');
    fs.mkdirSync(config,{recursive:true});
    const expected={host:'a.invalid',port:19721,namespace:'TEST',scheme:'https',tlsVerify:false};
    const name='iris-agentic-dev';
    fs.writeFileSync(path.join(root,'.mcp.json'),JSON.stringify({mcpServers:{[name]:{command:process.execPath,env:{IRIS_HOST:expected.host,IRIS_WEB_PORT:'19721',IRIS_NAMESPACE:'TEST'}}}}));
    fs.writeFileSync(path.join(config,'project.jsonc'),JSON.stringify({irisConnections:{active:'A',serverName:name,bindings:{mcp:true},profiles:{A:expected}}}));
    const evidence=require('../lib/iris-profile-verification');
    assert.equal(evidence.latest(context),null);
    for (const [actual,verified] of [[expected,true],[{...expected,namespace:'OTHER'},false]]) {
      fs.writeFileSync(path.join(root,'fixture-check.json'),JSON.stringify({...actual,connected:true}));
      result=run('check','--verify-profile','--json');
      assert.equal(result.status,0,result.stderr);
      assert.equal(JSON.parse(result.stdout).CHECK.profileTargetVerified,verified);
      assert.equal(evidence.latest(context).verified,verified);
    }
    fs.appendFileSync(path.join(root,'.mcp.json'),' ');
    assert.equal(evidence.latest(context),null);

    if (process.env.IRIS_MCP_BUNDLED_EXE) {
      fs.unlinkSync(path.join(config,'project.jsonc'));
      fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { 'iris-agentic-dev': { command: process.env.IRIS_MCP_BUNDLED_EXE, env: { IRIS_NAMESPACE: 'USER', IRIS_NO_SKILLS: 'true' } } } }));
      result = run('tools', '--names', 'iris_global,iris_execute_method,iris_doc', '--schema', '--json');
      assert.equal(result.status, 0, result.stderr);
      const actual = JSON.parse(result.stdout);
      assert.deepEqual(actual.TOOLS, ['iris_global', 'iris_execute_method', 'iris_doc']);
      for (const tool of actual.TOOL_SCHEMAS) assert.ok(tool.inputSchema.properties);
      console.log('Bundled MCP: 3 real schemas parsed; no business tools called.');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false);
  }
});
