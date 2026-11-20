'use strict';

const assert = require('node:assert/strict');
const { fork, spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const { setTimeout: wait } = require('node:timers/promises');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');
const { importAndLaunchRelease, launchSelectedRelease } = require('../src/release-launcher');
const { createReleaseUpdateService } = require('../src/release-update');
const { createFrameworkService } = require('../src/framework-service');
const { readSelection, saveSelection } = require('../src/release-selection');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const versionDirectory = 'agents-workbench-react-0.2.1';
const startScript = releaseService => String.raw`
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const project = process.argv[process.argv.indexOf('--project') + 1];
${releaseService}
const mode = fs.readFileSync(path.join(project, 'scenario'), 'utf8');
const name = path.basename(project);
const dist = path.join(process.cwd(), 'tools/agents-workbench/react/dist');
if (process.cwd().endsWith('0.2.1') && fs.existsSync(path.join(project, 'fail-candidate'))) process.exit(7);
if (process.env.WORKBENCH_STARTUP_PARENT === '1') process.once('disconnect', () => {
  const gate = path.join(project, 'defer-owned-exit');
  if (!fs.existsSync(gate)) process.exit(0);
  fs.writeFileSync(gate + '.seen', '');
  setInterval(() => { if (!fs.existsSync(gate)) process.exit(0); }, 25);
});
const server = http.createServer((req, res) => {
  if (req.url === '/framework.json') {
    const status = ['hold', 'cancel-at-probe'].includes(mode) ? 'observing' : 'no-framework';
    const bindingFile = path.join(project, 'expected-binding');
    const binding = fs.existsSync(bindingFile) ? fs.readFileSync(bindingFile, 'utf8') : undefined;
    res.end(JSON.stringify({ status, name, projectId: 'candidate', observedAt: new Date().toISOString(), revision: null, binding }));
  } else if (req.url === '/project.json') {
    res.end(JSON.stringify({ name: mode === 'bad-project' ? 'wrong-project' : name, hasFramework: false, domains: [] }));
  } else if (req.url === '/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(mode === 'bad-interface' ? '<!doctype html><title>Wrong</title>' : fs.readFileSync(path.join(dist, 'index.html')));
  } else if (req.url === '/react/assets/main.js') {
    res.setHeader('content-type', 'text/javascript; charset=utf-8');
    res.end(fs.readFileSync(path.join(dist, 'assets/main.js')));
  } else { res.writeHead(404).end(); }
});
server.listen(Number(process.env.PORT), '127.0.0.1', () => {
  const origin = 'http://127.0.0.1:' + server.address().port;
  if (mode !== 'ready') fs.writeFileSync(path.join(process.cwd(), 'test-address'), origin);
  process.send({ address: origin + '/#home', bootstrap: 'd'.repeat(64) });
});
`;

function sealFixture(root, name, validRuntime, version = '0.2.1', rememberAnchor = false) {
  const source = path.join(root, name);
  fs.mkdirSync(source);
  const files = {
    'runtime/LICENSE': 'license', 'start-workbench.cmd': 'fixture launcher',
    'scripts/install-agents.ps1': '# fixture installer',
    'docs/guides/usage-manual.md': '# Guide', 'docs/update-agents.md': '# Update',
    'docs/workspace-overlay.md': '# Overlay',
    'tools/agents-workbench/prototype/serve.js': startScript(rememberAnchor ?
      `require(${JSON.stringify(require.resolve('../src/release-update'))}).createReleaseUpdateService(project, { applicationRoot: process.cwd() });` : ''),
    'tools/agents-workbench/react/dist/index.html': `<!doctype html><title>${version}</title><script src="/react/assets/main.js"></script>`,
    'tools/agents-workbench/react/dist/assets/main.js': 'document.title = "Candidate loaded";',
  };
  const inner = {
    version, platform: 'windows-x64', formal: true, sourceBaseRevision: 'a'.repeat(40), localBuildChanges: false,
    node: process.versions.node, installerSha256: digest(files['scripts/install-agents.ps1']),
    documentationSha256: Object.fromEntries(Object.entries(files).filter(([file]) => file.startsWith('docs/'))
      .map(([file, bytes]) => [file, digest(bytes)])),
  };
  for (const [file, bytes] of Object.entries({ ...files, 'workbench-release.json': JSON.stringify(inner) })) {
    const output = path.join(source, file);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes);
  }
  const bundledNode = path.join(source, 'runtime/node.exe');
  if (validRuntime) fs.copyFileSync(process.execPath, bundledNode);
  else fs.writeFileSync(bundledNode, 'invalid executable fixture');

  const archive = path.join(root, `${name}.zip`);
  const releaseRecord = path.join(root, `${name}.json`);
  const zipped = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', String.raw`
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $source = $env:WORKBENCH_LAUNCH_TEST_SOURCE
    $zip = [IO.Compression.ZipFile]::Open($env:WORKBENCH_LAUNCH_TEST_ZIP, [IO.Compression.ZipArchiveMode]::Create)
    try {
      foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File) {
        $entry = $file.FullName.Substring($source.Length + 1).Replace('\', '/')
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entry, [IO.Compression.CompressionLevel]::NoCompression)
      }
    } finally { $zip.Dispose() }
  `], { encoding: 'utf8', timeout: 15000, windowsHide: true, env: {
    ...process.env, WORKBENCH_LAUNCH_TEST_SOURCE: source, WORKBENCH_LAUNCH_TEST_ZIP: archive,
  } });
  assert.equal(zipped.status, 0, zipped.stderr || zipped.error?.message);
  const bytes = fs.readFileSync(archive);
  fs.writeFileSync(releaseRecord, JSON.stringify({ ...inner, file: 'agents-workbench-react.zip', bytes: bytes.length, sha256: digest(bytes) }));
  return { archive, releaseRecord, source };
}

async function readCandidateOrigin(installRoot) {
  const marker = path.join(installRoot, versionDirectory, 'test-address');
  for (let i = 0; i < 200; i++) {
    try { return fs.readFileSync(marker, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await wait(40);
  }
  throw Error('Candidate did not bind a test port');
}

test('trusted release starts the same bound project while the previous instance remains recoverable', {
  skip: process.platform !== 'win32' || process.arch !== 'x64', timeout: 60000,
}, async t => {
  const root = createTempDirectory('workbench-release-launch-');
  const previous = http.createServer((req, res) => res.end('previous instance'));
  t.after(async () => {
    if (previous.listening) await new Promise(resolve => previous.close(resolve));
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  previous.listen(0, '127.0.0.1');
  await once(previous, 'listening');
  const previousOrigin = `http://127.0.0.1:${previous.address().port}`;
  const good = sealFixture(root, 'good', true);
  const invalidRuntime = sealFixture(root, 'bad-runtime', false);

  function request(mode, release = good) {
    const projectRoot = path.join(root, `工程 ${mode}`);
    const installRoot = path.join(root, `版本 ${mode}`);
    fs.mkdirSync(projectRoot);
    fs.writeFileSync(path.join(projectRoot, 'scenario'), mode);
    const old = path.join(installRoot, 'agents-workbench-react-0.2.0');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'sentinel'), 'kept');
    return { ...release, projectRoot, installRoot };
  }

  async function assertOldUsable(input) {
    assert.equal(await (await fetch(previousOrigin, { signal: AbortSignal.timeout(2000) })).text(), 'previous instance');
    assert.equal(fs.readFileSync(path.join(input.installRoot, 'agents-workbench-react-0.2.0/sentinel'), 'utf8'), 'kept');
    assert.deepEqual(fs.readdirSync(input.projectRoot), ['scenario']);
  }

  await t.test('ready candidate uses its own address and return to prior version needs only closing the candidate', async () => {
    const input = request('ready');
    const result = await importAndLaunchRelease(input);
    try {
      assert.equal(result.state, 'ready');
      assert.equal(result.release.version, '0.2.1');
      const address = new URL(result.address);
      assert.notEqual(address.origin, previousOrigin);
      assert.match(address.hash, /^#bootstrap=[a-f0-9]{64}$/);
      const project = await (await fetch(`${address.origin}/project.json`)).json();
      assert.equal(project.name, path.basename(input.projectRoot));
      await assertOldUsable(input);
    } finally { await result.close(); }
    const origin = new URL(result.address).origin;
    await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(2000) }));
    await assertOldUsable(input);
  });

  await t.test('matching ZIP whose runtime cannot execute fails without switching', async () => {
    const input = request('invalid-runtime', invalidRuntime);
    await assert.rejects(importAndLaunchRelease(input), { code: 'startup-failed' });
    await assertOldUsable(input);
  });

  await t.test('a changed release selection is rejected before the imported application starts', async () => {
    const input = request('changed-release-selection');
    await assert.rejects(importAndLaunchRelease({ ...input, expectedRelease: { version: '0.2.1', sha256: '0'.repeat(64) } }),
      { code: 'release-selection-changed' });
    assert.equal(fs.existsSync(path.join(input.installRoot, versionDirectory, 'test-address')), false);
    await assertOldUsable(input);
  });

  for (const [mode, code] of [['bad-project', 'project-not-ready'], ['bad-interface', 'interface-unavailable']]) {
    await t.test(`${mode} closes the candidate and keeps the previous instance`, async () => {
      const input = request(mode);
      await assert.rejects(importAndLaunchRelease(input), { code });
      await assert.rejects(fetch(await readCandidateOrigin(input.installRoot), { signal: AbortSignal.timeout(2000) }));
      await assertOldUsable(input);
    });
  }

  await t.test('bounded startup on an unresponsive application does not select the candidate', async () => {
    const input = request('hold');
    await assert.rejects(importAndLaunchRelease({ ...input, startupTimeoutMs: 500 }), { code: 'startup-timeout' });
    await assertOldUsable(input);
  });

  await t.test('cancelling during the startup probe closes just the new process', async () => {
    const input = request('cancel-at-probe');
    const controller = new AbortController();
    const result = importAndLaunchRelease({ ...input, signal: controller.signal });
    const rejected = assert.rejects(result, { code: 'cancelled' });
    const origin = await readCandidateOrigin(input.installRoot);
    controller.abort();
    await rejected;
    await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(2000) }));
    await assertOldUsable(input);
  });

  await t.test('an already-cancelled request leaves no candidate directory', async () => {
    const input = request('cancelled');
    await assert.rejects(importAndLaunchRelease({ ...input, signal: AbortSignal.abort() }), { code: 'cancelled' });
    assert.deepEqual(fs.readdirSync(input.installRoot), ['agents-workbench-react-0.2.0']);
    await assertOldUsable(input);
  });
});

test('the bound Workbench release action opens a ready candidate without closing the old instance', {
  skip: process.platform !== 'win32' || process.arch !== 'x64', timeout: 30000,
}, async t => {
  const root = createTempDirectory('workbench-release-action-');
  const project = path.join(root, '工程');
  const previous = path.join(root, 'agents-workbench-react-0.2.0');
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(previous, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(project, 'scenario'), 'ready');
  fs.writeFileSync(path.join(previous, 'runtime/node.exe'), 'current package sentinel');
  fs.writeFileSync(path.join(previous, 'workbench-release.json'), JSON.stringify({
    version: '0.2.0', platform: 'windows-x64', formal: true, localBuildChanges: false,
  }));
  const offered = sealFixture(root, 'newer', true);
  const offeredRecord = JSON.parse(fs.readFileSync(offered.releaseRecord, 'utf8'));
  const chooseRecord = (name, record) => {
    const releaseRecord = path.join(root, `${name}.json`);
    fs.writeFileSync(releaseRecord, JSON.stringify(record));
    return { archive: offered.archive, releaseRecord };
  };
  const selections = [null, chooseRecord('capability-approval', {
    schema: 'imedical-agents-offline-bundle/v1', bundle: 'capability.bundle', ref: 'refs/heads/master',
    revision: 'b'.repeat(40), objectFormat: 'sha1', bytes: 512, sha256: 'c'.repeat(64),
  }), chooseRecord('incomplete-workbench-record', { ...offeredRecord, version: '0.2.0', bytes: undefined }),
  chooseRecord('same-version-record', { ...offeredRecord, version: '0.2.0' }), offered];
  let pickCount = 0;
  let candidate;
  const releaseUpdate = createReleaseUpdateService(project, {
    applicationRoot: previous,
    choose: async () => selections[pickCount++],
    launch: async options => candidate = await importAndLaunchRelease(options),
  });
  const app = createFrameworkService(project, { releaseUpdate });
  let origin;
  const server = http.createServer((req, res) => app.handle(req, res, req.url.slice(1), origin));
  t.after(async () => {
    await candidate?.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-Workbench-Request': '1', 'Content-Type': 'application/json', Origin: origin };
  const post = (route, body, authorization) => fetch(origin + '/framework/' + route, {
    method: 'POST', headers: { ...headers, ...authorization }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const read = async () => (await fetch(origin + '/framework.json', { headers, signal: AbortSignal.timeout(3000) })).json();
  const session = await post('session', { token: app.bootstrap });
  assert.equal(session.status, 200);
  const auth = { cookie: session.headers.get('set-cookie').split(';')[0], 'X-Workbench-CSRF': (await session.json()).csrf };
  const initial = await read();
  const refreshed = await post('action', { action: 'refresh', projectId: initial.projectId, revision: null }, auth);
  const bound = await refreshed.json();
  assert.equal(bound.workbenchUpdate, true);
  assert.ok(bound.binding);
  fs.writeFileSync(path.join(project, 'expected-binding'), bound.binding);
  const request = { action: 'open', projectId: bound.projectId, revision: null };

  assert.equal((await post('release-update', request)).status, 403);
  assert.equal((await post('release-update', { ...request, archive: offered.archive }, auth)).status, 400);
  assert.equal(pickCount, 0);
  const cancelled = await post('release-update', request, auth);
  assert.deepEqual(await cancelled.json(), { cancelled: true });
  assert.equal(fs.existsSync(path.join(root, versionDirectory)), false);
  for (const error of ['release-record-invalid', 'release-record-invalid', 'release-not-newer']) {
    const rejected = await post('release-update', request, auth);
    assert.equal(rejected.status, 409);
    assert.equal((await rejected.json()).error, error);
    assert.equal(candidate, undefined);
    assert.equal(fs.existsSync(path.join(root, versionDirectory)), false);
  }
  const selected = await post('release-update', request, auth);
  const result = await selected.json();
  assert.equal(selected.status, 200, JSON.stringify(result));
  assert.equal(result.version, '0.2.1');
  assert.equal(result.selectionSaved, true);
  assert.equal(new URL(result.address).hostname, '127.0.0.1');
  const candidateOrigin = new URL(result.address).origin;
  const candidateInfo = await (await fetch(candidateOrigin + '/project.json')).json();
  assert.equal(candidateInfo.name, '工程');
  assert.equal((await read()).projectId, bound.projectId);
  assert.equal(fs.readFileSync(path.join(previous, 'runtime/node.exe'), 'utf8'), 'current package sentinel');
});

test('the launcher keeps a verified per-project default, retries the old version, and supports one-click rollback', {
  skip: process.platform !== 'win32' || process.arch !== 'x64', timeout: 90000,
}, async t => {
  const root = createTempDirectory('workbench-release-default-');
  const stop = [];
  t.after(async () => {
    await Promise.all(stop.map(close => close()));
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });

  const offered = sealFixture(root, 'team-offering', true, '0.2.1', true);
  const base = sealFixture(root, '基本安装 甲', true, '0.2.0').source;
  const launcherSource = path.resolve(__dirname, '../src');
  const launcherPath = 'tools/agents-workbench/src/start-release.js';
  fs.mkdirSync(path.dirname(path.join(base, launcherPath)), { recursive: true });
  for (const name of ['start-release.js', 'release-selection.js']) {
    fs.copyFileSync(path.join(launcherSource, name), path.join(path.dirname(path.join(base, launcherPath)), name));
  }
  fs.writeFileSync(path.join(base, 'tools/agents-workbench/src/release-launcher.js'),
    `module.exports = require(${JSON.stringify(path.join(launcherSource, 'release-launcher.js'))});`);
  const other = path.join(root, '基本安装 乙');
  for (const name of [launcherPath, 'tools/agents-workbench/src/release-selection.js', 'tools/agents-workbench/src/release-launcher.js',
    'tools/agents-workbench/prototype/serve.js', 'tools/agents-workbench/react/dist/index.html',
    'tools/agents-workbench/react/dist/assets/main.js', 'workbench-release.json', 'runtime/node.exe']) {
    fs.mkdirSync(path.dirname(path.join(other, name)), { recursive: true });
    fs.copyFileSync(path.join(base, name), path.join(other, name));
  }
  const target = path.join(root, versionDirectory);

  function createProject(name) {
    const project = path.join(root, name);
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'scenario'), 'ready');
    return project;
  }
  async function boot(directory, project, expectedVersion, execArgv = []) {
    const processHandle = fork(path.join(directory, launcherPath), ['--project', project], {
      cwd: directory, execPath: path.join(directory, 'runtime/node.exe'), execArgv, windowsHide: true,
      env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const closed = once(processHandle, 'close');
    const close = async () => { if (processHandle.exitCode === null) processHandle.kill(); await closed; };
    stop.push(close);
    let errors = '';
    processHandle.stderr.on('data', chunk => { errors += chunk; });
    const [hello] = await Promise.race([once(processHandle, 'message', { signal: AbortSignal.timeout(15000) }),
      closed.then(([code]) => { throw Error(`Workbench exited with ${code}: ${errors}`); })]);
    const origin = new URL(hello.address).origin;
    const response = await (await fetch(origin, { signal: AbortSignal.timeout(4000) })).text();
    assert.ok(response.includes(`<title>${expectedVersion}</title>`), response);
    const info = await (await fetch(origin + '/project.json')).json();
    assert.equal(info.name, path.basename(project));
    return { origin, errors: () => errors, close, processHandle, closed };
  }
  function forProject(directory, project) {
    return createReleaseUpdateService(project, { applicationRoot: directory, choose: async () => offered,
      launch: async input => {
        const candidate = await importAndLaunchRelease(input);
        stop.push(candidate.close);
        return candidate;
      },
    });
  }

  const first = createProject('工程 甲');
  const second = createProject('工程 乙');
  const firstService = forProject(base, first);
  const firstImport = await firstService.open({});
  assert.equal(firstImport.selectionSaved, true, JSON.stringify(firstImport));
  await (await boot(base, first, '0.2.1')).close();
  await t.test('launcher signals disconnect the owned version and wait for its exit', async () => {
    const preload = path.join(root, 'signal-probe.cjs');
    // Windows process.kill does not deliver these Node events. Inject only the event;
    // the saved selection, owned subprocess, IPC disconnection and process exit are real.
    fs.writeFileSync(preload, String.raw`
      process.on('message', signal => {
        if (['SIGINT', 'SIGTERM', 'SIGBREAK'].includes(signal)) process.emit(signal);
      });
      process.channel.unref();
    `);
    const gate = path.join(first, 'defer-owned-exit');
    const seen = gate + '.seen';
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
      fs.writeFileSync(gate, '');
      try {
        const workbench = await boot(base, first, '0.2.1', ['--require', preload]);
        workbench.processHandle.send(signal);
        workbench.processHandle.send(signal);
        for (let attempt = 0; attempt < 120 && !fs.existsSync(seen); attempt++) await wait(25);
        assert.ok(fs.existsSync(seen), signal);
        assert.equal(workbench.processHandle.exitCode, null, signal);
        assert.equal(workbench.processHandle.signalCode, null, signal);
        fs.unlinkSync(gate);
        const [code] = await Promise.race([workbench.closed, wait(4000, null, { ref: false }).then(() => {
          throw Error(`Launcher remained running after ${signal}`);
        })]);
        assert.equal(code, 0, signal);
      } finally {
        if (fs.existsSync(gate)) fs.unlinkSync(gate);
        if (fs.existsSync(seen)) fs.unlinkSync(seen);
      }
    }
    assert.equal((await fetch(new URL(firstImport.address).origin)).status, 200);
  });
  await (await boot(base, second, '0.2.0')).close();
  await (await boot(other, first, '0.2.0')).close();

  const secondService = forProject(base, second);
  const reused = await secondService.open({});
  assert.equal(reused.selectionSaved, true, JSON.stringify(reused));
  assert.notEqual(new URL(reused.address).origin, new URL(firstImport.address).origin);
  await (await boot(base, second, '0.2.1')).close();

  const stranger = createProject('待更新工程');
  const standalone = (project, options = {}) => createReleaseUpdateService(project, { applicationRoot: target, inheritedAnchor: '', ...options });
  assert.equal(standalone(second).canRollback, true);
  assert.equal(standalone(stranger).canRollback, false);
  const markerRoot = path.join(target, '.workbench-launch');
  const markers = () => fs.readdirSync(markerRoot).map(name => [name, fs.readFileSync(path.join(markerRoot, name), 'utf8')]);
  const savedMarkers = markers();
  assert.equal(savedMarkers.length, 2);
  assert.ok(savedMarkers.every(([file, text]) => file.startsWith('anchor-') && JSON.parse(text).directory === path.basename(base)));

  const competingFailure = path.join(second, 'fail-candidate');
  fs.writeFileSync(competingFailure, 'failed competing importer');
  try {
    assert.deepEqual(await forProject(other, second).open({}), { error: 'startup-failed' });
    assert.deepEqual(markers(), savedMarkers);
  } finally { fs.unlinkSync(competingFailure); }

  const [marker, markerText] = savedMarkers[0];
  const markerFile = path.join(markerRoot, marker);
  fs.writeFileSync(markerFile, JSON.stringify({ ...JSON.parse(markerText), directory: '../out-of-root' }));
  assert.equal([first, second].filter(project => standalone(project).canRollback).length, 1);
  fs.writeFileSync(markerFile, markerText);
  assert.ok([first, second].every(project => standalone(project).canRollback));

  fs.writeFileSync(path.join(first, 'fail-candidate'), 'real child exit on restart');
  const fallback = await boot(base, first, '0.2.0');
  assert.match(fallback.errors(), /0\.2\.1 could not start/);
  await fallback.close();
  fs.unlinkSync(path.join(first, 'fail-candidate'));
  const stillOld = await boot(base, first, '0.2.0');
  assert.doesNotMatch(stillOld.errors(), /could not start/);
  await stillOld.close();
  await (await boot(base, second, '0.2.1')).close();

  let browserAddress;
  const candidate = standalone(second, {
    relaunch: async input => {
      const previous = await launchSelectedRelease(input);
      stop.push(previous.close);
      return previous;
    },
    openPrevious: address => { browserAddress = address; },
  });
  assert.equal(candidate.canRollback, true);
  const restoring = await candidate.rollback({});
  assert.equal(restoring.version, '0.2.0', JSON.stringify(restoring));
  assert.equal(browserAddress, restoring.address);
  assert.equal(candidate.canRollback, false);
  assert.equal(standalone(second).canRollback, false);
  assert.equal((await fetch(new URL(reused.address).origin)).status, 200);
  await (await boot(base, second, '0.2.0')).close();

  const asset = path.join(target, 'tools/agents-workbench/react/dist/assets/main.js');
  fs.appendFileSync(asset, '\n// local change');
  assert.deepEqual(await forProject(base, stranger).open({}), { error: 'release-directory-exists' });
  assert.match(fs.readFileSync(asset, 'utf8'), /local change/);
  assert.equal(fs.readdirSync(root).some(name => name.startsWith('.workbench-verify-')), false);

  const linkedParent = path.join(root, 'linked version parent');
  fs.mkdirSync(linkedParent);
  fs.symlinkSync(offered.source, path.join(linkedParent, versionDirectory), 'junction');
  await assert.rejects(importAndLaunchRelease({ ...offered, projectRoot: stranger, installRoot: linkedParent }),
    { code: 'release-directory-exists' });
  assert.equal(fs.lstatSync(path.join(linkedParent, versionDirectory)).isSymbolicLink(), true);
  assert.deepEqual(fs.readdirSync(linkedParent), [versionDirectory]);
  assert.deepEqual(fs.readdirSync(first), ['scenario']);
  assert.deepEqual(fs.readdirSync(second), ['scenario']);
  assert.deepEqual(fs.readdirSync(stranger), ['scenario']);
});

test('parallel launchers compare and save under one Windows selection mutex', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const root = createTempDirectory('workbench-selection-race-');
  const processes = [];
  t.after(async () => {
    await Promise.all(processes.map(async ({ child, closed }) => { if (child.exitCode === null) child.kill(); await closed; }));
    assert.ok(ownsTempDirectory(root));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const anchor = { directory: path.join(root, 'installation') };
  const projectRoot = path.join(root, '工程');
  fs.mkdirSync(anchor.directory);
  fs.mkdirSync(projectRoot);
  const original = { current: { version: '0.2.0', base: true, treeDigest: 'a'.repeat(64) }, previous: null };
  const upgrade = { current: { version: '0.2.1', base: false, treeDigest: 'b'.repeat(64) }, previous: original.current };
  saveSelection(anchor, projectRoot, null, original);

  // Both save requests finish the user-space preflight before either acquires the actual mutex.
  const worker = `
    const fs = require('node:fs');
    const cp = require('node:child_process');
    const spawn = cp.spawnSync;
    const request = JSON.parse(process.env.WORKBENCH_SELECTION_RACE);
    cp.spawnSync = (...args) => {
      process.send('snapshot-read');
      const signal = new Int32Array(new SharedArrayBuffer(4));
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(request.barrier)) {
        if (Date.now() > deadline) throw Error('barrier-timeout');
        Atomics.wait(signal, 0, 0, 25);
      }
      return spawn(...args);
    };
    const { saveSelection } = require(request.module);
    try { saveSelection(request.anchor, request.projectRoot, request.previous, request.next); process.send('saved'); }
    catch (error) { process.send(error.message); }
  `;
  const barrier = path.join(root, 'start');
  function save(next) {
    const request = { anchor, projectRoot, barrier, previous: original, next, module: require.resolve('../src/release-selection') };
    const child = spawn(process.execPath, ['-e', worker], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, WORKBENCH_SELECTION_RACE: JSON.stringify(request) },
    });
    const closed = once(child, 'close');
    processes.push({ child, closed });
    return once(child, 'message', { signal: AbortSignal.timeout(5000) }).then(([message]) => {
      assert.equal(message, 'snapshot-read');
      return { next, outcome: once(child, 'message', { signal: AbortSignal.timeout(10000) }) };
    });
  }
  const calls = await Promise.all([save(upgrade), save(null)]);
  fs.writeFileSync(barrier, '');
  const results = await Promise.all(calls.map(async ({ next, outcome }) => ({ next, result: (await outcome)[0] })));
  assert.deepEqual(results.map(result => result.result).sort(), ['saved', 'selection-changed']);
  assert.deepEqual(readSelection(anchor, projectRoot), results.find(result => result.result === 'saved').next);
  assert.equal(fs.readdirSync(path.join(anchor.directory, '.workbench-launch')).some(file => file.endsWith('.tmp')), false);
});
