'use strict';

const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const {promisify} = require('node:util');
const {createTempDirectory, ownsTempDirectory} = require('../../../scripts/tests/fixtures/temp-directory');

const execute = promisify(execFile);
const historyModule = require.resolve('../src/recent-projects');
const startEntry = require.resolve('../src/start-release');
const windowsOnly = {skip: process.platform !== 'win32'};

function fixture(t) {
  const root = createTempDirectory('workbench-recent-projects-');
  t.after(() => {
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root, {recursive: true, force: true, maxRetries: 3});
  });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'localappdata'));
  env.LOCALAPPDATA = path.join(root, 'local-profile');
  const state = path.join(env.LOCALAPPDATA, 'AgentsWorkbench', 'recent-projects.json');
  const options = {env, windowsHide: true, timeout: 15000};
  const invoke = (expr, ...args) => execute(process.execPath, [
    '-e',
    `const recent = require(process.argv[1]); Promise.resolve(${expr}).then(value => console.log(JSON.stringify(value)));`,
    historyModule, ...args,
  ], options).then(({stdout}) => JSON.parse(stdout));
  const directory = (...pieces) => {
    const file = path.join(root, ...pieces);
    fs.mkdirSync(file, {recursive: true});
    return fs.realpathSync.native(file);
  };
  return {root, env, options, state, invoke, directory};
}

test('recent history merges simultaneous launches and validates saved directory identities', windowsOnly, async t => {
  const {options, state, invoke, directory} = fixture(t);
  const one = directory('工程一', '同名');
  const two = directory('工程二', '同名');
  const record = root => invoke('recent.rememberProject(process.argv[2])', root);
  assert.equal((await execute(process.execPath, [startEntry, '--recent-project'], options)).stdout, '');
  assert.deepEqual(await Promise.all([record(one), record(two)]), [true, true]);
  const initial = await invoke('recent.listRecentProjects()');
  assert.deepEqual(new Set(initial.map(project => project.path)), new Set([one, two]));
  assert.equal(initial[0].name, initial[1].name);
  assert.notEqual(initial[0].id, initial[1].id);

  assert.equal(await record(one.toLowerCase()), true);
  const [latest, older] = await invoke('recent.listRecentProjects()');
  assert.equal(latest.path, one);
  assert.equal(older.path, two);
  assert.deepEqual(await invoke('recent.resolveRecentProject(process.argv[2])', latest.id), latest);
  const {stdout} = await execute(process.execPath, [startEntry, '--recent-project'], options);
  assert.equal(Buffer.from(stdout.trim(), 'base64').toString('utf8'), one);

  // Leave the former directory alive so a newly made directory cannot reuse its identity.
  fs.renameSync(one, one + '-old');
  fs.mkdirSync(one);
  assert.equal(await invoke('recent.resolveRecentProject(process.argv[2])', latest.id), null);
  assert.deepEqual(await invoke('recent.listRecentProjects()'), [older]);
  assert.equal((await execute(process.execPath, [startEntry, '--recent-project'], options)).stdout, '');
  assert.equal(await invoke('recent.rememberProject(process.argv[2], process.argv[3])', one, latest.id), false);

  fs.writeFileSync(state, '{broken JSON', 'utf8');
  assert.equal((await execute(process.execPath, [startEntry, '--recent-project'], options)).stdout, '');
  assert.equal(await record(two), true);
  assert.deepEqual(await invoke('recent.listRecentProjects()'), [older]);
});

test('Windows PowerShell 5.1 starts the last Unicode project without running the folder picker', windowsOnly, async t => {
  const {root, options, invoke, directory} = fixture(t);
  const project = directory('带空格的 工程');
  assert.equal(await invoke('recent.rememberProject(process.argv[2])', project), true);
  const app = directory('安装 副本');
  const runtime = directory('安装 副本', 'runtime');
  const entryDirectory = directory('安装 副本', 'tools', 'agents-workbench', 'src');
  const captured = path.join(root, 'launch-args.json');
  const launcher = path.join(app, 'start-workbench.ps1');
  fs.copyFileSync(path.resolve(__dirname, '../react/start-workbench.ps1'), launcher);
  fs.copyFileSync(process.execPath, path.join(runtime, 'node.exe'));
  fs.writeFileSync(path.join(entryDirectory, 'start-release.js'), `
    if (process.argv[2] === '--recent-project') require(${JSON.stringify(startEntry)});
    else require('node:fs').writeFileSync(${JSON.stringify(captured)}, JSON.stringify(process.argv.slice(2)));
  `);
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const {stdout} = await execute(powershell, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], options);
  assert.match(stdout, /^5\.1\./u);
  await execute(powershell, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', launcher], options);
  assert.deepEqual(JSON.parse(fs.readFileSync(captured, 'utf8')), ['--background', '--open', '--project', project]);
});

test('the foreground launcher records a background project only after the browser opens', windowsOnly, async t => {
  const {options, invoke, directory} = fixture(t);
  const project = directory('工程');
  const startup = directory('安装', 'tools', 'agents-workbench', 'src');
  const prototype = directory('安装', 'tools', 'agents-workbench', 'prototype');
  const entry = path.join(startup, 'start-release.js');
  fs.copyFileSync(startEntry, entry);
  fs.copyFileSync(require.resolve('../src/release-selection'), path.join(startup, 'release-selection.js'));
  fs.writeFileSync(path.join(startup, 'recent-projects.js'), `module.exports = require(${JSON.stringify(historyModule)});`);
  fs.writeFileSync(path.join(startup, 'release-launcher.js'), `
    const {readStartupAddress} = require(${JSON.stringify(require.resolve('../src/release-launcher'))});
    module.exports = {readStartupAddress, openBrowser: async () => process.env.WORKBENCH_TEST_BROWSER_OPENED === '1'};
  `);
  fs.writeFileSync(path.join(prototype, 'serve.js'), `
    process.on('disconnect', () => process.exit(0));
    process.send({address: 'http://127.0.0.1:12345/#home', bootstrap: 'a'.repeat(64)});
  `);
  const launch = (opened, extra) => execute(process.execPath, [
    entry, '--background', '--project', project, ...extra,
  ], {...options, env: {...options.env, WORKBENCH_TEST_BROWSER_OPENED: opened ? '1' : '0'}});
  await launch(true, []);
  assert.deepEqual(await invoke('recent.listRecentProjects()'), []);
  await assert.rejects(() => launch(false, ['--open']), /Could not open the browser/u);
  assert.deepEqual(await invoke('recent.listRecentProjects()'), []);
  await launch(true, ['--open']);
  assert.equal((await invoke('recent.lastRecentProject()')).path, project);
});
