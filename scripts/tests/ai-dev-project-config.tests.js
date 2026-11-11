'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {createTempDirectory, ownsTempDirectory} = require('./fixtures/temp-directory');
const config = require('../../tools/ai-dev-offline/configure-project');
const toml = require('../../tools/ai-dev-offline/vendor/iarna-toml/parse-string');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = createTempDirectory('ai-dev-project-');
  t.after(() => {assert.ok(ownsTempDirectory(root)); fs.rmSync(root, {recursive: true, force: true});});
  const exe = path.join(root, 'runtime', 'iris-agentic-dev.exe');
  fs.mkdirSync(path.dirname(exe)); fs.writeFileSync(exe, 'fixture; never executed');
  const request = {projectRoot: root, configureMcp: true, mcpExe: exe, commonSettings: false,
    connection: {alias: 'cache~test', host: 'localhost', scheme: 'http', port: 57772, namespace: 'TEST',
      tlsVerify: false, writeCredentials: true, username: 'test-user', password: 'fixture-only-"\\中文'}};
  function write(name, content) { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, content); return file; }
  function apply() {const planned = config.plan(request);return config.apply({...request, fingerprint: planned.fingerprint});}
  return {root, request, write, apply, read: name => fs.readFileSync(path.join(root, name), 'utf8')};
}
test('HTTP Caché and HTTPS IRIS configurations use selected endpoint without persisting VS Code passwords', t => {
  const f = fixture(t);
  const result = f.apply();
  assert.equal(result.state, 'applied');
  const settings = config.object(f.read('.vscode/settings.json'));
  assert.deepEqual(settings['intersystems.servers']['cache~test'].webServer, {host: 'localhost', port: 57772, scheme: 'http'});
  assert.equal(settings['intersystems.servers']['cache~test'].password, undefined);
  assert.equal(settings['objectscript.conn'].ns, 'TEST');
  let value = toml(f.read('.iris-agentic-dev.toml'));
  assert.equal(value.password, f.request.connection.password);
  f.request.connection = {...f.request.connection, alias: 'iris~test', scheme: 'https', port: 2443, host: 'example.invalid'};
  f.apply();
  value = toml(f.read('.iris-agentic-dev.toml'));
  assert.equal(value.scheme, 'https'); assert.equal(value.web_port, 2443);
  const next = config.object(f.read('.vscode/settings.json'));
  assert.ok(next['intersystems.servers']['cache~test']); assert.ok(next['intersystems.servers']['iris~test']);
  assert.ok(!JSON.stringify(result).includes('test-user')); assert.ok(!JSON.stringify(result).includes('fixture-only'));
});
test('projects without .agents can prepare all connection files and later locate the installed MCP', t => {
  const f = fixture(t);
  f.request.mcpExe = '';
  assert.equal(fs.existsSync(path.join(f.root,'.agents')),false);
  const planned = config.main({...f.request,action:'projectPlan'});
  assert.equal(planned.mcpProgramPresent,false);
  assert.ok(planned.warnings.some(w=>w.includes('待安装')));
  const result=f.apply();
  assert.equal(result.state,'applied'); assert.equal(result.mcpProgramPresent,false);
  const command=config.object(f.read('.mcp.json')).mcpServers['iris-agentic-dev'].command;
  assert.equal(command,path.join(f.root,'.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe'));
  assert.equal(fs.existsSync(path.join(f.root,'.agents')),false);
  assert.equal(toml(f.read('.iris-agentic-dev.toml')).namespace,'TEST');
  assert.equal(config.object(f.read('.vscode/settings.json'))['objectscript.conn'].ns,'TEST');
  assert.equal(f.apply().state,'unchanged');
  assert.equal(config.inspect(f.request).mcpExe,command);
  fs.mkdirSync(path.dirname(command),{recursive:true});fs.writeFileSync(command,'fixture; never executed');
  const installed=config.main({...f.request,action:'projectPlan'});
  assert.equal(installed.state,'unchanged');assert.equal(installed.mcpProgramPresent,true);assert.deepEqual(installed.warnings,[]);
});
test('an absent custom MCP path is preserved on reread and an invalid path is still explained', t => {
  const f=fixture(t);
  f.request.mcpExe=path.join(f.root,'later','iris-agentic-dev.exe');
  f.apply();assert.equal(config.inspect(f.request).mcpExe,f.request.mcpExe);
  assert.equal(config.main({...f.request,action:'projectPlan'}).mcpProgramPresent,false);
  config.rollback({...f.request,receiptFile:path.join(f.root,'.ai-dev-config-backups',fs.readdirSync(path.join(f.root,'.ai-dev-config-backups'))[0],'receipt.json')});
  f.request.mcpExe=path.join(f.root,'wrong-program.exe');
  assert.throws(()=>config.plan(f.request),/完整路径/);
});
test('JSONC comments, unrelated MCP servers and disabled state survive repeated apply', t => {
  const f = fixture(t);
  const mcp = {mcpServers: {'iris-agentic-dev': {command: f.request.mcpExe, args: ['mcp','--host','old.invalid','--namespace=OLD','--no-skills'], disabled: true, env: {KEEP: 'yes'}},
    other: {command: 'custom-command', args: ['keep'], env: {PRIVATE: 'fixture-secret'}}}};
  f.write('.mcp.json', '// retain comment\n' + JSON.stringify(mcp));
  f.write('.vscode/settings.json', '{// settings comment\n"editor.fontSize":15}');
  f.apply();
  const after = config.object(f.read('.mcp.json'));
  assert.deepEqual(after.mcpServers.other, mcp.mcpServers.other);
  assert.equal(after.mcpServers['iris-agentic-dev'].disabled, true);
  assert.equal(after.mcpServers['iris-agentic-dev'].env.KEEP, 'yes');
  assert.ok(after.mcpServers['iris-agentic-dev'].args.includes('--namespace=TEST'));
  assert.ok(f.read('.mcp.json').includes('// retain comment'));
  assert.ok(f.read('.vscode/settings.json').includes('// settings comment'));
  assert.equal(f.apply().state, 'unchanged');
  assert.equal(fs.readdirSync(path.join(f.root,'.ai-dev-config-backups')).length, 1);
});
test('TOML merge preserves multiline values, quoted keys, tables and exact rollback bytes', t => {
  const f = fixture(t);
  const original = Buffer.from('\ufeff# keep\r\n"host" = "old.invalid"\r\nother = """\r\nhost = fake\r\nkeep this\r\n"""\r\n[custom]\r\nhost = "table-value"\r\nnumber = 9223372036854775807\r\n');
  f.write('.iris-agentic-dev.toml', original);
  const result = f.apply();
  const after = toml(f.read('.iris-agentic-dev.toml').replace(/^\uFEFF/, ''));
  assert.equal(after.other, toml(original.toString('utf8').replace(/^\uFEFF/, '')).other);
  assert.equal(after.custom.host, 'table-value');
  config.rollback({...f.request, receiptFile: result.receiptFile});
  assert.deepEqual(fs.readFileSync(path.join(f.root,'.iris-agentic-dev.toml')), original);
  assert.equal(fs.existsSync(path.join(f.root,'.mcp.json')), false);
  assert.ok(f.read('.gitignore').includes('/.ai-dev-config-backups/'));
});
test('stale preview and post-apply modifications prevent writes and rollback', t => {
  const f = fixture(t), planned = config.plan(f.request);
  f.write('.vscode/settings.json', '{"later":true}');
  assert.throws(() => config.apply({...f.request, fingerprint: planned.fingerprint}), /重新预览/);
  const result = f.apply();
  f.write('.iris-agentic-dev.toml', 'later = true\n');
  const mcpBefore = f.read('.mcp.json');
  assert.throws(() => config.rollback({...f.request, receiptFile: result.receiptFile}), /后续修改/);
  assert.equal(f.read('.mcp.json'), mcpBefore);
});
test('mid-apply failure restores earlier files and prepared receipt is recoverable', t => {
  const f = fixture(t);
  f.write('.vscode/settings.json', '{"untouched":true}');
  const planned = config.plan(f.request);
  assert.throws(() => config.apply({...f.request, fingerprint: planned.fingerprint}, {beforeWrite(file) {if(file.endsWith('.mcp.json')) throw new Error('injected-write-failure');}}), /injected-write-failure/);
  assert.equal(f.read('.vscode/settings.json'), '{"untouched":true}');
  assert.equal(fs.existsSync(path.join(f.root,'.mcp.json')), false);
  const result = f.apply();
  const receipt = JSON.parse(fs.readFileSync(result.receiptFile, 'utf8')); receipt.state = 'prepared';
  fs.writeFileSync(result.receiptFile, JSON.stringify(receipt));
  config.rollback({...f.request, receiptFile: result.receiptFile});
  assert.equal(f.read('.vscode/settings.json'), '{"untouched":true}');
});
test('managed Node entry is preserved and backend target flags follow the selected connection', t => {
  const f = fixture(t);
  const entry = {command: process.execPath, args: [path.join(f.root,'.agents/scripts/iris-session-mcp.js'),'--project-root',f.root,'--server-name','iris-agentic-dev']};
  f.write('.mcp.json', JSON.stringify({mcpServers: {'iris-agentic-dev': {...entry, disabled: true}}}));
  f.write('.agents/config/iris-session-backend.json', JSON.stringify({schema:'iris-session-backend/v1',serverName:'iris-agentic-dev',command:f.request.mcpExe,
    args:['mcp','--host','old.invalid','--web-port','1234'],managedHash:hash(Buffer.from(JSON.stringify(entry))),custom:true}));
  f.apply();
  const after = config.object(f.read('.mcp.json')).mcpServers['iris-agentic-dev'];
  assert.equal(after.command, entry.command); assert.deepEqual(after.args, entry.args); assert.equal(after.disabled, true);
  const backend = config.object(f.read('.agents/config/iris-session-backend.json'));
  assert.equal(backend.custom,true); assert.ok(backend.args.includes('57772')); assert.ok(backend.args.includes('--config'));
});
test('new managed project uses its adapter and existing credential reuse synchronizes TOML', t => {
  const f = fixture(t);
  f.write('.agents/scripts/iris-session-mcp.js', '// fixture; never executed'); f.request.nodeExe = process.execPath;
  f.apply();
  const entry = config.object(f.read('.mcp.json')).mcpServers['iris-agentic-dev'];
  const backend = config.object(f.read('.agents/config/iris-session-backend.json'));
  assert.equal(backend.managedHash,hash(Buffer.from(JSON.stringify({command:entry.command,args:entry.args}))));
  f.request.connection.writeCredentials = false;
  f.write('.iris-agentic-dev.toml', '# credentials recovered from existing MCP\n');
  f.apply(); assert.equal(toml(f.read('.iris-agentic-dev.toml')).password, f.request.connection.password);
  assert.equal(config.inspect(f.request).hasCredentials,true);
});
test('tracked private files are rejected and new configurations are actually ignored by Git', t => {
  const f = fixture(t), git = process.platform === 'win32' ? 'git.exe' : 'git';
  const run = args => {const result=spawnSync(git,['-C',f.root,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
  f.request.gitExe=git; run(['init','-q']);
  f.apply();
  for (const file of ['.mcp.json','.iris-agentic-dev.toml','.vscode/settings.json','.ai-dev-config-backups/probe']) run(['check-ignore','--quiet',file]);
  run(['add','-f','.mcp.json']);
  assert.throws(() => config.plan(f.request), /已被 Git 跟踪/);
});
test('invalid input, malformed TOML and linked targets fail before any configuration write', t => {
  const f = fixture(t);
  f.request.connection.port=0; assert.throws(()=>config.plan(f.request),/端口/); f.request.connection.port=57772;
  f.write('.iris-agentic-dev.toml','host = "unterminated'); assert.throws(()=>config.plan(f.request),/TOML/);
  assert.equal(fs.existsSync(path.join(f.root,'.mcp.json')),false);
  fs.unlinkSync(path.join(f.root,'.iris-agentic-dev.toml'));
  const linked=path.join(f.root,'.vscode'),target=path.join(f.root,'elsewhere');fs.mkdirSync(target);fs.symlinkSync(target,linked,process.platform==='win32'?'junction':'dir');
  try {assert.throws(()=>config.plan(f.request),/linked-settings-path/);} finally {fs.unlinkSync(linked);}
});
test('vendor TOML parser files match fixed source digests', () => {
  const directory=path.resolve(__dirname,'../../tools/ai-dev-offline/vendor/iarna-toml');
  const upstream=JSON.parse(fs.readFileSync(path.join(directory,'UPSTREAM.json'),'utf8').replace(/^\uFEFF/,''));
  assert.equal(upstream.version,'2.2.5');assert.equal(upstream.license,'ISC');
  for(const [file,digest] of Object.entries(upstream.files))assert.equal(hash(fs.readFileSync(path.join(directory,file))),digest,file);
});
