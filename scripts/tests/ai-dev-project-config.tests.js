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

test('interrupted credential writes leave only Git-ignored staging files', t => {
  const f = fixture(t);
  const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], {encoding: 'utf8'});
  assert.equal(git(f.root, 'init', '-q').status, 0);
  fs.mkdirSync(path.join(f.root, '.agents'));
  assert.equal(git(path.join(f.root, '.agents'), 'init', '-q').status, 0);
  f.write('.agents/.git/info/exclude', '/config/project-env.json\n');
  const destination = f.write('.agents/config/project-env.json', '{"iris":{}}\n');
  const worker = `
    const fs = require('node:fs');
    const {modulePath, destination, request} = JSON.parse(fs.readFileSync(0, 'utf8'));
    const config = require(modulePath);
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to !== destination) return rename(from, to);
      fs.writeSync(1, from);
      process.exit(87);
    };
    config.apply({...request, fingerprint: config.plan(request).fingerprint}).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  `;
  const crashed = spawnSync(process.execPath, ['-e', worker], {encoding: 'utf8', input: JSON.stringify({
    modulePath: require.resolve('../../tools/ai-dev-offline/configure-project'), destination,
    request: {...f.request, gitExe: 'git', syncProjectEnv: true},
  })});
  assert.equal(crashed.status, 87, crashed.stderr);
  const temporary = crashed.stdout.trim();
  assert.equal(f.read('.agents/config/project-env.json'), '{"iris":{}}\n');
  assert.equal(config.object(fs.readFileSync(temporary, 'utf8')).iris.password, f.request.connection.password);
  assert.equal(git(path.dirname(temporary), 'check-ignore', '--quiet', '--', path.basename(temporary)).status, 0);
});

test('switching a VS Code-only project preserves connection options and creates no unbound consumer',async t=>{
  const f=fixture(t);
  fs.mkdirSync(path.join(f.root,'.agents/config'),{recursive:true});
  assert.equal(spawnSync('git',['-C',path.join(f.root,'.agents'),'init','-q']).status,0);
  f.write('.agents/.git/info/exclude','/config/\n');
  f.write('.vscode/settings.json',JSON.stringify({'objectscript.conn':{server:'original',ns:'A',active:false},
    'intersystems.servers':{original:{webServer:{host:'a.invalid',port:443,scheme:'https'}}}}));
  const req={projectRoot:f.root,profile:{id:'B',connection:{host:'b.invalid',namespace:'B'}}};
  const plan=config.plan(req);
  await config.apply({...req,fingerprint:plan.fingerprint});
  const state=config.inspectProfiles(req);
  assert.equal(state.consistent,true);
  assert.equal(state.target.alias,'B');
  assert.equal(config.object(f.read('.vscode/settings.json'))['objectscript.conn'].active,false);
  for(const file of ['.mcp.json','.iris-agentic-dev.toml','.agents/config/project-env.json','.agents/config/iris-profile-credentials.json'])
    assert.equal(fs.existsSync(path.join(f.root,file)),false);
});

async function existingServerFixture(t) {
  const f = fixture(t);
  const cap = path.join(f.root, '.agents');
  fs.mkdirSync(cap);
  for (const directory of [f.root, cap]) {
    const init = spawnSync('git', ['-C', directory, 'init', '-q'], {encoding: 'utf8'});
    assert.equal(init.status, 0, init.stderr);
  }
  f.write('.agents/.git/info/exclude', '/config/\n');
  const envFile = '.agents/config/project-env.json';
  const vscodeFile = '.vscode/settings.json';
  const mcpFile = '.mcp.json';
  const tomlFile = '.iris-agentic-dev.toml';
  const current = f.request.connection;
  const target = {alias: 'existing-alt', host: 'alternate.invalid', port: 27443,
    scheme: 'https', namespace: 'ALTERNATE', tlsVerify: true};
  const credentials = {username: crypto.randomBytes(16).toString('hex'), password: crypto.randomBytes(16).toString('hex')};
  f.write(envFile, JSON.stringify({iris: current, sftp: {enabled: false, preserved: true}}));
  f.request.syncProjectEnv = true;
  f.request.gitExe = 'git';
  await f.apply();

  const settings = config.object(f.read(vscodeFile));
  settings['objectscript.conn'].active = false;
  settings['objectscript.conn'].customFlag = 'keep';
  settings['intersystems.servers'][current.alias].password = current.password;
  settings['intersystems.servers'][target.alias] = {
    webServer: {host: target.host, port: target.port, scheme: target.scheme, pathPrefix: '/custom-path'},
    ...credentials, description: 'Existing connection', customOption: {trackedBy: ['editor']},
  };
  settings['editor.fontSize'] = 15;
  const saveSettings = value => f.write(vscodeFile, '\uFEFF// Existing private settings\r\n' +
    JSON.stringify(value, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  saveSettings(settings);

  const mcp = config.object(f.read(mcpFile));
  mcp.mcpServers['iris-agentic-dev'].env.UNRELATED = 'preserve-setting';
  mcp.mcpServers['iris-agentic-dev'].disabled = true;
  mcp.mcpServers.other = {command: 'fixture-only', args: ['untouched']};
  f.write(mcpFile, JSON.stringify(mcp));
  const request = {projectRoot: f.root, gitExe: 'git', profile: {id: 'alternate', connection: target, credentials}};
  const snapshot = () => fs.readdirSync(f.root, {recursive: true, withFileTypes: true})
    .filter(item => item.isFile()).map(item => path.join(item.parentPath, item.name)).sort()
    .map(file => [path.relative(f.root, file), hash(fs.readFileSync(file))]);
  function assertBindings(connection, pair) {
    const after = config.object(config.snapshot(path.join(f.root, vscodeFile)).text);
    assert.deepEqual(after['intersystems.servers'], settings['intersystems.servers']);
    assert.deepEqual(after['objectscript.conn'], {
      ...settings['objectscript.conn'], server: connection.alias, ns: connection.namespace,
    });
    assert.equal(after['editor.fontSize'], 15);
    const bytes = fs.readFileSync(path.join(f.root, vscodeFile));
    assert.deepEqual(bytes.subarray(0, 3), Buffer.from([239, 187, 191]));
    assert.ok(bytes.toString('utf8').includes('// Existing private settings\r\n'));

    const centralized = config.object(f.read(envFile));
    for (const key of ['host', 'port', 'namespace', 'scheme', 'tlsVerify', 'username', 'password']) {
      assert.equal(centralized.iris[key], {...connection, ...pair}[key]);
    }
    assert.deepEqual(centralized.sftp, {enabled: false, preserved: true});
    const afterMcp = config.object(f.read(mcpFile)).mcpServers;
    assert.deepEqual(afterMcp.other, mcp.mcpServers.other);
    assert.equal(afterMcp['iris-agentic-dev'].disabled, true);
    assert.equal(afterMcp['iris-agentic-dev'].command, mcp.mcpServers['iris-agentic-dev'].command);
    assert.deepEqual(afterMcp['iris-agentic-dev'].env, {
      IRIS_HOST: connection.host, IRIS_WEB_PORT: String(connection.port), IRIS_SCHEME: connection.scheme,
      IRIS_NAMESPACE: connection.namespace, IRIS_TLS_VERIFY: String(connection.tlsVerify),
      IRIS_USERNAME: pair.username, IRIS_PASSWORD: pair.password, UNRELATED: 'preserve-setting',
    });
    const afterToml = toml(f.read(tomlFile));
    for (const [key, value] of Object.entries({
      host: connection.host, web_port: connection.port, scheme: connection.scheme, namespace: connection.namespace,
      tls_verify: connection.tlsVerify, username: pair.username, password: pair.password,
    })) assert.equal(afterToml[key], value);
  }
  return {f, settings, current, target, credentials, request, snapshot, saveSettings, assertBindings};
}

test('profile registration and switching reuse existing VS Code server rows without editing their credentials', async t => {
  const x = await existingServerFixture(t);
  async function select(request, connection, pair) {
    const before = x.snapshot();
    const preview = await config.main({...request, action: 'projectPlan'});
    assert.equal(preview.to.alias, connection.alias);
    assert.deepEqual(preview.files.find(file => file.file.endsWith(path.join('.vscode', 'settings.json'))).keys,
      ['objectscript.conn']);
    assert.deepEqual(x.snapshot(), before);
    const receipt = await config.apply({...request, fingerprint: preview.fingerprint});
    assert.equal(receipt.state, 'applied');
    const state = config.inspectProfiles(request);
    assert.equal(state.active, request.profile.id);
    assert.equal(state.consistent, true);
    assert.equal(state.target.alias, connection.alias);
    for (const secret of [x.credentials.username, x.credentials.password, x.current.username, x.current.password]) {
      assert.ok(!JSON.stringify(preview).includes(secret));
      assert.ok(!JSON.stringify(receipt).includes(secret));
      assert.ok(!x.f.read('.agents/config/project.jsonc').includes(secret));
    }
    x.assertBindings(connection, pair);
  }
  await select(x.request, x.target, x.credentials);
  await select({...x.request, profile: {id: 'current'}}, x.current, x.current);
  await select({...x.request, profile: {id: 'alternate'}}, x.target, x.credentials);
});

test('an existing VS Code server mismatch blocks registration and known profile switching without writes', async t => {
  const x = await existingServerFixture(t);
  async function rejectPreview(request) {
    const before = x.snapshot();
    await assert.rejects(() => config.main({...request, action: 'projectPlan'}), /VS Code/);
    assert.deepEqual(x.snapshot(), before);
  }
  for (const mismatch of [{host: 'different.invalid'}, {port: 28443}, {scheme: 'http'}]) {
    await rejectPreview({...x.request, profile: {...x.request.profile, connection: {...x.target, ...mismatch}}});
  }
  for (const key of ['username', 'password']) {
    await rejectPreview({...x.request, profile: {...x.request.profile,
      credentials: {...x.credentials, [key]: crypto.randomBytes(16).toString('hex')}}});
  }
  const apply = request => config.apply({...request, fingerprint: config.plan(request).fingerprint});
  await apply(x.request);
  await apply({...x.request, profile: {id: 'current'}});
  const changed = structuredClone(x.settings);
  changed['intersystems.servers'][x.target.alias].password = crypto.randomBytes(16).toString('hex');
  x.saveSettings(changed);
  await rejectPreview({...x.request, profile: {id: 'alternate'}});
});

test('HTTP Caché and HTTPS IRIS configurations use selected endpoint without persisting VS Code passwords', async t => {
  const f = fixture(t);
  const result = await f.apply();
  assert.equal(result.state, 'applied');
  const settings = config.object(f.read('.vscode/settings.json'));
  assert.deepEqual(settings['intersystems.servers']['cache~test'].webServer, {host: 'localhost', port: 57772, scheme: 'http'});
  assert.equal(settings['intersystems.servers']['cache~test'].password, undefined);
  assert.equal(settings['objectscript.conn'].ns, 'TEST');
  let value = toml(f.read('.iris-agentic-dev.toml'));
  assert.equal(value.password, f.request.connection.password);
  f.request.connection = {...f.request.connection, alias: 'iris~test', scheme: 'https', port: 2443, host: 'example.invalid'};
  await f.apply();
  value = toml(f.read('.iris-agentic-dev.toml'));
  assert.equal(value.scheme, 'https'); assert.equal(value.web_port, 2443);
  const next = config.object(f.read('.vscode/settings.json'));
  assert.ok(next['intersystems.servers']['cache~test']); assert.ok(next['intersystems.servers']['iris~test']);
  assert.ok(!JSON.stringify(result).includes('test-user')); assert.ok(!JSON.stringify(result).includes('fixture-only'));
});
test('projects without .agents can prepare all connection files and later locate the installed MCP', async t => {
  const f = fixture(t);
  f.request.mcpExe = '';
  assert.equal(fs.existsSync(path.join(f.root,'.agents')),false);
  const planned = await config.main({...f.request,action:'projectPlan'});
  assert.equal(planned.mcpProgramPresent,false);
  assert.ok(planned.warnings.some(w=>w.includes('待安装')));
  const result=await f.apply();
  assert.equal(result.state,'applied'); assert.equal(result.mcpProgramPresent,false);
  const command=config.object(f.read('.mcp.json')).mcpServers['iris-agentic-dev'].command;
  assert.equal(command,path.join(f.root,'.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe'));
  assert.equal(fs.existsSync(path.join(f.root,'.agents')),false);
  assert.equal(toml(f.read('.iris-agentic-dev.toml')).namespace,'TEST');
  assert.equal(config.object(f.read('.vscode/settings.json'))['objectscript.conn'].ns,'TEST');
  assert.equal((await f.apply()).state,'unchanged');
  assert.equal(config.inspect(f.request).mcpExe,command);
  fs.mkdirSync(path.dirname(command),{recursive:true});fs.writeFileSync(command,'fixture; never executed');
  const installed=await config.main({...f.request,action:'projectPlan'});
  assert.equal(installed.state,'unchanged');assert.equal(installed.mcpProgramPresent,true);assert.deepEqual(installed.warnings,[]);
});
test('an absent custom MCP path is preserved on reread and an invalid path is still explained', async t => {
  const f=fixture(t);
  f.request.mcpExe=path.join(f.root,'later','iris-agentic-dev.exe');
  await f.apply();assert.equal(config.inspect(f.request).mcpExe,f.request.mcpExe);
  assert.equal((await config.main({...f.request,action:'projectPlan'})).mcpProgramPresent,false);
  await config.rollback({...f.request,receiptFile:path.join(f.root,'.ai-dev-config-backups',fs.readdirSync(path.join(f.root,'.ai-dev-config-backups'))[0],'receipt.json')});
  f.request.mcpExe=path.join(f.root,'wrong-program.exe');
  assert.throws(()=>config.plan(f.request),/完整路径/);
});
test('JSONC comments, unrelated MCP servers and disabled state survive repeated apply', async t => {
  const f = fixture(t);
  const mcp = {mcpServers: {'iris-agentic-dev': {command: f.request.mcpExe, args: ['mcp','--host','old.invalid','--namespace=OLD','--no-skills'], disabled: true, env: {KEEP: 'yes'}},
    other: {command: 'custom-command', args: ['keep'], env: {PRIVATE: 'fixture-secret'}}}};
  f.write('.mcp.json', '// retain comment\n' + JSON.stringify(mcp));
  f.write('.vscode/settings.json', '{// settings comment\n"editor.fontSize":15}');
  await f.apply();
  const after = config.object(f.read('.mcp.json'));
  assert.deepEqual(after.mcpServers.other, mcp.mcpServers.other);
  assert.equal(after.mcpServers['iris-agentic-dev'].disabled, true);
  assert.equal(after.mcpServers['iris-agentic-dev'].env.KEEP, 'yes');
  assert.ok(after.mcpServers['iris-agentic-dev'].args.includes('--namespace=TEST'));
  assert.ok(f.read('.mcp.json').includes('// retain comment'));
  assert.ok(f.read('.vscode/settings.json').includes('// settings comment'));
  assert.equal((await f.apply()).state, 'unchanged');
  assert.equal(fs.readdirSync(path.join(f.root,'.ai-dev-config-backups')).length, 1);
});
test('TOML merge preserves multiline values, quoted keys, tables and exact rollback bytes', async t => {
  const f = fixture(t);
  const original = Buffer.from('\ufeff# keep\r\n"host" = "old.invalid"\r\nother = """\r\nhost = fake\r\nkeep this\r\n"""\r\n[custom]\r\nhost = "table-value"\r\nnumber = 9223372036854775807\r\n');
  f.write('.iris-agentic-dev.toml', original);
  const result = await f.apply();
  const after = toml(f.read('.iris-agentic-dev.toml').replace(/^\uFEFF/, ''));
  assert.equal(after.other, toml(original.toString('utf8').replace(/^\uFEFF/, '')).other);
  assert.equal(after.custom.host, 'table-value');
  await config.rollback({...f.request, receiptFile: result.receiptFile});
  assert.deepEqual(fs.readFileSync(path.join(f.root,'.iris-agentic-dev.toml')), original);
  assert.equal(fs.existsSync(path.join(f.root,'.mcp.json')), false);
  assert.ok(f.read('.gitignore').includes('/.ai-dev-config-backups/'));
});
test('stale preview and post-apply modifications prevent writes and rollback', async t => {
  const f = fixture(t), planned = config.plan(f.request);
  f.write('.vscode/settings.json', '{"later":true}');
  await assert.rejects(() => config.apply({...f.request, fingerprint: planned.fingerprint}), /重新预览/);
  const result = await f.apply();
  f.write('.iris-agentic-dev.toml', 'later = true\n');
  const mcpBefore = f.read('.mcp.json');
  await assert.rejects(() => config.rollback({...f.request, receiptFile: result.receiptFile}), /后续修改/);
  assert.equal(f.read('.mcp.json'), mcpBefore);
});
test('mid-apply failure restores earlier files and prepared receipt is recoverable', async t => {
  const f = fixture(t);
  f.write('.vscode/settings.json', '{"untouched":true}');
  const planned = config.plan(f.request);
  await assert.rejects(() => config.apply({...f.request, fingerprint: planned.fingerprint}, {beforeWrite(file) {if(file.endsWith('.mcp.json')) throw new Error('injected-write-failure');}}), /injected-write-failure/);
  assert.equal(f.read('.vscode/settings.json'), '{"untouched":true}');
  assert.equal(fs.existsSync(path.join(f.root,'.mcp.json')), false);
  const result = await f.apply();
  const receipt = JSON.parse(fs.readFileSync(result.receiptFile, 'utf8')); receipt.state = 'prepared';
  fs.writeFileSync(result.receiptFile, JSON.stringify(receipt));
  await config.rollback({...f.request, receiptFile: result.receiptFile});
  assert.equal(f.read('.vscode/settings.json'), '{"untouched":true}');
});
test('managed Node entry is preserved and backend target flags follow the selected connection', async t => {
  const f = fixture(t);
  const entry = {command: process.execPath, args: [path.join(f.root,'.agents/scripts/iris-session-mcp.js'),'--project-root',f.root,'--server-name','iris-agentic-dev']};
  f.write('.mcp.json', JSON.stringify({mcpServers: {'iris-agentic-dev': {...entry, disabled: true}}}));
  f.write('.agents/config/iris-session-backend.json', JSON.stringify({schema:'iris-session-backend/v1',serverName:'iris-agentic-dev',command:f.request.mcpExe,
    args:['mcp','--host','old.invalid','--web-port','1234'],managedHash:hash(Buffer.from(JSON.stringify(entry))),custom:true}));
  await f.apply();
  const after = config.object(f.read('.mcp.json')).mcpServers['iris-agentic-dev'];
  assert.equal(after.command, entry.command); assert.deepEqual(after.args, entry.args); assert.equal(after.disabled, true);
  const backend = config.object(f.read('.agents/config/iris-session-backend.json'));
  assert.equal(backend.custom,true); assert.ok(backend.args.includes('57772')); assert.ok(backend.args.includes('--config'));
});
test('new managed project uses its adapter and existing credential reuse synchronizes TOML', async t => {
  const f = fixture(t);
  f.write('.agents/scripts/iris-session-mcp.js', '// fixture; never executed'); f.request.nodeExe = process.execPath;
  await f.apply();
  const entry = config.object(f.read('.mcp.json')).mcpServers['iris-agentic-dev'];
  const backend = config.object(f.read('.agents/config/iris-session-backend.json'));
  assert.equal(backend.managedHash,hash(Buffer.from(JSON.stringify({command:entry.command,args:entry.args}))));
  f.request.connection.writeCredentials = false;
  f.write('.iris-agentic-dev.toml', '# credentials recovered from existing MCP\n');
  await f.apply(); assert.equal(toml(f.read('.iris-agentic-dev.toml')).password, f.request.connection.password);
  assert.equal(config.inspect(f.request).hasCredentials,true);
});
test('tracked private files are rejected and new configurations are actually ignored by Git', async t => {
  const f = fixture(t), git = process.platform === 'win32' ? 'git.exe' : 'git';
  const run = args => {const result=spawnSync(git,['-C',f.root,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
  f.request.gitExe=git; run(['init','-q']);
  await f.apply();
  for (const file of ['.mcp.json','.iris-agentic-dev.toml','.vscode/settings.json','.ai-dev-config-backups/probe']) run(['check-ignore','--quiet',file]);
  run(['add','-f','.mcp.json']);
  assert.throws(() => config.plan(f.request), /已被 Git 跟踪/);
});
test('invalid input, malformed TOML and linked targets fail before any configuration write', async t => {
  const f = fixture(t);
  f.request.connection.port=0; assert.throws(()=>config.plan(f.request),/端口/); f.request.connection.port=57772;
  f.write('.iris-agentic-dev.toml','host = "unterminated'); assert.throws(()=>config.plan(f.request),/TOML/);
  assert.equal(fs.existsSync(path.join(f.root,'.mcp.json')),false);
  fs.unlinkSync(path.join(f.root,'.iris-agentic-dev.toml'));
  const linked=path.join(f.root,'.vscode'),target=path.join(f.root,'elsewhere');fs.mkdirSync(target);fs.symlinkSync(target,linked,process.platform==='win32'?'junction':'dir');
  try {assert.throws(()=>config.plan(f.request),/linked-settings-path/);} finally {fs.unlinkSync(linked);}
});
test('vendor TOML parser files match fixed source digests', () => {
  const directory=path.resolve(__dirname,'../../vendor/iarna-toml');
  const upstream=JSON.parse(fs.readFileSync(path.join(directory,'UPSTREAM.json'),'utf8').replace(/^\uFEFF/,''));
  assert.equal(upstream.version,'2.2.5');assert.equal(upstream.license,'ISC');
  for(const [file,digest] of Object.entries(upstream.files))assert.equal(hash(fs.readFileSync(path.join(directory,file))),digest,file);
});
test('inspection automatically restores interrupted project writes and legacy locks', async t => {
  const f = fixture(t);
  f.write('.vscode/settings.json', '{"before":true}');
  const applied = await f.apply();
  const receipt = JSON.parse(fs.readFileSync(applied.receiptFile, 'utf8'));
  fs.unlinkSync(path.join(f.root, '.iris-agentic-dev.toml')); // Interrupted before TOML was applied.
  receipt.state = 'prepared'; fs.writeFileSync(applied.receiptFile, JSON.stringify(receipt));
  f.write('.ai-dev-config.lock', '');
  await config.main({...f.request, action: 'projectInspect'});
  assert.equal(f.read('.vscode/settings.json'), '{"before":true}');
  assert.equal(fs.existsSync(path.join(f.root, '.mcp.json')), false);
  assert.equal(fs.existsSync(path.join(f.root, '.ai-dev-config.lock')), false);
  assert.equal(JSON.parse(fs.readFileSync(applied.receiptFile)).state, 'reverted-after-interruption');
  assert.equal((await f.apply()).state, 'applied');
});

test('inspection confirms an interrupted receipt when every planned file already has its final bytes', async t => {
  const f = fixture(t);
  f.write('.vscode/settings.json', '{"before":true}');
  const applied = await f.apply();
  const receipt = JSON.parse(fs.readFileSync(applied.receiptFile, 'utf8'));
  receipt.state = 'prepared';
  fs.writeFileSync(applied.receiptFile, JSON.stringify(receipt));
  const before = receipt.entries.map(entry => fs.readFileSync(entry.file));
  assert.equal(config.readReceipts(f.root).receipts[0].recovery, 'review-required');
  assert.equal(JSON.parse(fs.readFileSync(applied.receiptFile)).state, 'prepared');
  await config.main({...f.request, action:'projectInspect'});
  assert.equal(JSON.parse(fs.readFileSync(applied.receiptFile)).state, 'applied');
  assert.deepEqual(receipt.entries.map(entry => fs.readFileSync(entry.file)), before);
});

test('explicit recovery restores a real interrupted write and reads it back using the existing owner receipt', async t => {
  const f = fixture(t);
  const original = '{"fixture-private-marker": true}';
  f.write('.vscode/settings.json', original);
  const moduleName = path.resolve(__dirname,'../../tools/ai-dev-offline/configure-project');
  const interrupted = spawnSync(process.execPath,['-e', `
    const owner = require(process.argv[1]);
    const request = JSON.parse(process.argv[2]);
    let count = 0;
    owner.apply({...request,fingerprint:owner.plan(request).fingerprint}, {
      beforeWrite() { if (++count === 2) process.exit(31); }
    });
  `,moduleName,JSON.stringify(f.request)],{encoding:'utf8',windowsHide:true});
  assert.equal(interrupted.status,31,interrupted.stderr);
  let confirmedFingerprint;
  const {receipts:[candidate]} = config.readReceipts(f.root, fingerprint => {
    confirmedFingerprint = fingerprint;
    return 'fixture-confirmation';
  });
  assert.equal(candidate.state,'prepared');
  assert.equal(candidate.recovery,'available');
  assert.equal(candidate.restoreFiles,1);
  assert.doesNotMatch(JSON.stringify(candidate),/fixture-private-marker|password|beforeHash|original/);
  assert.notEqual(f.read('.vscode/settings.json'),original);
  const request = {projectRoot:f.root,receiptId:candidate.id};
  assert.deepEqual(await config.recoverInterrupted(request, {confirmRecovery:fp => fp === confirmedFingerprint}),
    {receiptId:candidate.id,state:'reverted-after-interruption'});
  assert.equal(f.read('.vscode/settings.json'),original);
  assert.equal(config.readReceipts(f.root).receipts[0].state,'reverted-after-interruption');
  await assert.rejects(config.recoverInterrupted(request), {code:'project-recovery-not-available'});
});
