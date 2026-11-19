'use strict';

const { execFile, fork, spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { promisify } = require('node:util');
const { inspectFramework } = require('./project-context');
const { fingerprint, localApplication, readRecord, releaseDirectory, versionPattern } = require('./release-selection');

const execFileAsync = promisify(execFile);
const sourceImporter = path.resolve(__dirname, '../react/import-workbench-release.ps1');
const importer = fs.existsSync(sourceImporter) ? sourceImporter : path.resolve(__dirname, '../../../import-workbench-release.ps1');
const messages = {
  'unsupported-platform': '当前发行包用于 Windows x64 工作台。',
  'project-unavailable': '原工程目录不可读，请检查工程绑定。',
  'import-failed': '导入失败，请核对发放渠道的 ZIP、发行记录和版本目录。',
  'release-directory-exists': '同名版本目录与可信发行包不一致，原目录已保留。',
  'release-selection-changed': '发行记录在导入期间发生变化，请重新选择。',
  'release-changed': '已核验版本的本地文件发生变化，请从可信渠道重新导入。',
  'startup-failed': '候选工作台无法启动，请继续使用当前版本。',
  'startup-timeout': '候选工作台未在限时内就绪，请继续使用当前版本。',
  'project-not-ready': '候选工作台未识别原工程，请继续使用当前版本。',
  'interface-unavailable': '候选工作台的界面不可用，请继续使用当前版本。',
  'cleanup-failed': '候选实例的退出尚未确认。可以继续使用原工作台。',
  cancelled: '已取消切换，可继续使用当前工作台。',
};

class ReleaseLaunchError extends Error {
  constructor(code) {
    super(messages[code]);
    this.name = 'ReleaseLaunchError';
    this.code = code;
  }
}

const defaultStartupTimeoutMs = 15000;
function checkCancelled(signal) {
  if (signal?.aborted) throw new ReleaseLaunchError('cancelled');
}

function startupError(error, signal, timeout) {
  if (signal?.aborted) return new ReleaseLaunchError('cancelled');
  if (timeout.aborted) return new ReleaseLaunchError('startup-timeout');
  if (error instanceof ReleaseLaunchError) return error;
  return new ReleaseLaunchError('startup-failed');
}

async function importRelease(request) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const command = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; " +
    '& $env:WORKBENCH_IMPORT_SCRIPT -Archive $env:WORKBENCH_IMPORT_ARCHIVE ' +
    '-ReleaseRecord $env:WORKBENCH_IMPORT_RECORD -InstallRoot $env:WORKBENCH_IMPORT_ROOT';
  let receipt;
  try {
    const { stdout } = await execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, WORKBENCH_IMPORT_SCRIPT: importer, WORKBENCH_IMPORT_ARCHIVE: request.archive,
        WORKBENCH_IMPORT_RECORD: request.releaseRecord, WORKBENCH_IMPORT_ROOT: request.installRoot },
    });
    receipt = JSON.parse(stdout);
  } catch (error) {
    const code = /already exists and was left unchanged/u.test(error.stderr ?? '') ? 'release-directory-exists' : 'import-failed';
    throw new ReleaseLaunchError(code);
  }
  if (receipt?.state !== 'imported' || !/^\d+\.\d+\.\d+$/u.test(receipt.version) || typeof receipt.path !== 'string') {
    throw new ReleaseLaunchError('import-failed');
  }
  const expected = path.resolve(request.installRoot, `agents-workbench-react-${receipt.version}`);
  if (path.resolve(receipt.path).toLowerCase() !== expected.toLowerCase() || !fs.lstatSync(expected, { throwIfNoEntry: false })?.isDirectory()) {
    throw new ReleaseLaunchError('import-failed');
  }
  return receipt;
}

async function verifiedRelease(request) {
  // On a second project, reuse the sibling only against the same independently verified archive.
  const version = readRecord(request.releaseRecord)?.version;
  if (typeof version !== 'string' || !versionPattern.test(version)) throw new ReleaseLaunchError('import-failed');
  const target = path.join(request.installRoot, `agents-workbench-react-${version}`);
  if (!fs.lstatSync(target, { throwIfNoEntry: false })) {
    try {
      const release = await importRelease(request);
      return { ...release, treeDigest: await fingerprint(release.path) };
    } catch (error) {
      if (error.code !== 'release-directory-exists') throw error;
    }
  }

  const temporary = fs.mkdtempSync(path.join(request.installRoot, '.workbench-verify-'));
  try {
    const verified = await importRelease({ ...request, installRoot: temporary });
    const treeDigest = await fingerprint(verified.path);
    if (verified.version !== version || (await fingerprint(target).catch(() => null)) !== treeDigest) {
      throw new ReleaseLaunchError('release-directory-exists');
    }
    return { ...verified, path: target, treeDigest };
  } finally {
    if (path.dirname(temporary) !== request.installRoot || !fs.lstatSync(temporary).isDirectory() ||
        fs.realpathSync.native(temporary) !== temporary) throw new ReleaseLaunchError('cleanup-failed');
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3 });
  }
}

function readStartupAddress(message) {
  if (typeof message?.address !== 'string' || typeof message.bootstrap !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(message.bootstrap)) throw new ReleaseLaunchError('startup-failed');
  let url;
  try { url = new URL(message.address); }
  catch { throw new ReleaseLaunchError('startup-failed'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash !== '#home') {
    throw new ReleaseLaunchError('startup-failed');
  }
  return url.origin;
}

function readLocal(origin, route, signal) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port: new URL(origin).port, path: route, signal, agent: false,
      headers: { 'X-Workbench-Request': '1' } }, async response => {
      try {
        const chunks = [];
        for await (const chunk of response) chunks.push(chunk);
        resolve({ status: response.statusCode, type: response.headers['content-type'] ?? '', body: Buffer.concat(chunks) });
      } catch (error) { reject(error); }
    });
    request.once('error', reject);
  });
}

async function probeInterface(origin, releasePath, signal) {
  try {
    const pagePath = path.join(releasePath, 'tools/agents-workbench/react/dist/index.html');
    const expected = fs.readFileSync(pagePath);
    const entry = expected.toString('utf8').match(/<script\b[^>]*\bsrc=["'](\/react\/assets\/[\w-]+\.js)["'][^>]*>/iu)?.[1];
    if (!entry) throw Error('missing-interface-entry');
    const page = await readLocal(origin, '/', signal);
    if (page.status !== 200 || !/^text\/html\b/iu.test(page.type) || !page.body.equals(expected)) throw Error('wrong-interface');
    const script = await readLocal(origin, entry, signal);
    if (script.status !== 200 || !/^text\/javascript\b/iu.test(script.type) ||
        !script.body.equals(fs.readFileSync(path.join(path.dirname(pagePath), entry.slice('/react/'.length))))) {
      throw Error('wrong-interface-script');
    }
  } catch { throw new ReleaseLaunchError('interface-unavailable'); }
}

async function probeProject(origin, expected, signal) {
  try {
    let state;
    for (;;) {
      const response = await readLocal(origin, '/framework.json', signal);
      if (response.status !== 200) throw Error('framework-unavailable');
      state = JSON.parse(response.body);
      if (state?.status !== 'observing') break;
      await wait(50, undefined, { signal });
    }
    if (!state || typeof state.projectId !== 'string' || !state.projectId || !state.observedAt ||
        typeof state.status !== 'string' || ['unavailable', 'unbound', 'binding-changed'].includes(state.status) ||
        state.name !== expected.name || (expected.status && state.status !== expected.status) ||
        (expected.revision !== null && state.revision !== expected.revision) ||
        (expected.binding && state.binding !== expected.binding)) throw Error('wrong-framework');

    const response = await readLocal(origin, '/project.json', signal);
    if (response.status !== 200) throw Error('project-unavailable');
    const project = JSON.parse(response.body);
    if (project?.name !== expected.name || project.hasFramework !== expected.hasFramework || !Array.isArray(project.domains)) {
      throw Error('wrong-project');
    }
    return state;
  } catch { throw new ReleaseLaunchError('project-not-ready'); }
}

async function launchImported(release, projectRoot, expected, { signal, startupTimeoutMs, anchor, port = '0', owned = false }) {
  const timeout = AbortSignal.timeout(startupTimeoutMs);
  const probeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const execPath = path.join(release.path, 'runtime/node.exe');
  const entry = path.join(release.path, 'tools/agents-workbench/prototype/serve.js');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(port|node_options|node_path|node_channel_fd|node_channel_serialization_mode|workbench_launch_anchor|workbench_startup_parent)$/iu.test(key)));
  if (anchor) env.WORKBENCH_LAUNCH_ANCHOR = anchor.directory;
  if (owned) env.WORKBENCH_STARTUP_PARENT = '1';
  let child;
  try {
    const releaseMetadata = JSON.parse(fs.readFileSync(path.join(release.path, 'workbench-release.json'), 'utf8').replace(/^\uFEFF/u, ''));
    const { stdout } = await execFileAsync(execPath, ['-p', 'JSON.stringify([process.versions.node, process.platform, process.arch])'], {
      cwd: release.path, env, encoding: 'utf8', windowsHide: true, signal: probeSignal,
    });
    const [nodeVersion, platform, arch] = JSON.parse(stdout);
    if (nodeVersion !== releaseMetadata.node || platform !== 'win32' || arch !== 'x64') {
      throw new ReleaseLaunchError('startup-failed');
    }
    child = fork(entry, ['--project', projectRoot], {
      cwd: release.path, execPath, execArgv: [], env: { ...env, PORT: port }, windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
  } catch (error) { throw startupError(error, signal, timeout); }

  const startupFailed = once(child, 'exit').then(() => { throw new ReleaseLaunchError('startup-failed'); });
  let stopping;
  const close = () => stopping ??= (async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, 'close', { signal: AbortSignal.timeout(3000) });
    child.kill();
    await closed;
  })();

  try {
    const probe = async () => {
      const [message] = await once(child, 'message', { signal: probeSignal });
      const origin = readStartupAddress(message);
      await probeProject(origin, expected, probeSignal);
      await probeInterface(origin, release.path, probeSignal);
      // Leave the one-time bootstrap for the browser. The probes are read-only.
      return `${origin}/#bootstrap=${message.bootstrap}`;
    };
    const address = await Promise.race([probe(), startupFailed]);
    checkCancelled(signal);
    if (timeout.aborted) throw new ReleaseLaunchError('startup-timeout');
    return { state: 'ready', release, address, close, ended: new Promise(resolve => child.once('close', (...outcome) => resolve(outcome))) };
  } catch (error) {
    try { await close(); }
    catch { throw new ReleaseLaunchError('cleanup-failed'); }
    throw startupError(error, signal, timeout);
  }
}

function boundProject(projectRoot, binding) {
  try {
    const root = fs.realpathSync.native(projectRoot);
    if (!fs.statSync(root).isDirectory()) throw Error('project-unavailable');
    const { name, revision } = inspectFramework(root);
    return { root, expected: { name, revision, binding, hasFramework: fs.existsSync(path.join(root, '.agents')) } };
  } catch { throw new ReleaseLaunchError('project-unavailable'); }
}

async function importAndLaunchRelease({ archive, releaseRecord, installRoot, projectRoot, expectedBinding, expectedRelease, anchor, signal,
  startupTimeoutMs = defaultStartupTimeoutMs }) {
  checkCancelled(signal);
  if (process.platform !== 'win32') throw new ReleaseLaunchError('unsupported-platform');
  const { root, expected } = boundProject(projectRoot, expectedBinding);
  let installParent;
  try { installParent = fs.realpathSync.native(installRoot); }
  catch { throw new ReleaseLaunchError('import-failed'); }
  let release;
  try { release = await verifiedRelease({ archive, releaseRecord, installRoot: installParent }); }
  catch (error) { throw error instanceof ReleaseLaunchError ? error : new ReleaseLaunchError('import-failed'); }
  if (expectedRelease && (release.version !== expectedRelease.version ||
      release.sha256.toLowerCase() !== expectedRelease.sha256.toLowerCase())) throw new ReleaseLaunchError('release-selection-changed');
  checkCancelled(signal);
  return launchImported(release, root, expected, { signal, startupTimeoutMs, anchor });
}

async function launchSelectedRelease({ anchor, entry, projectRoot, expectedBinding, port, owned,
  signal, startupTimeoutMs = defaultStartupTimeoutMs }) {
  const { root, expected } = boundProject(projectRoot, expectedBinding);
  const directory = releaseDirectory(anchor, entry);
  try {
    const application = localApplication(directory);
    if (application?.version !== entry.version || application.directory !== directory ||
        (await fingerprint(directory)) !== entry.treeDigest) throw Error('release-changed');
  } catch { throw new ReleaseLaunchError('release-changed'); }
  checkCancelled(signal);
  return launchImported({ path: directory, version: entry.version }, root, expected, { signal, startupTimeoutMs, anchor, port, owned });
}

function openBrowser(address) {
  const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  const browser = spawn(command, ['/d', '/c', 'start', '""', address], {
    windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore',
  });
  const report = () => console.error('Could not open the browser. Open the address above.');
  browser.on('error', report);
  browser.on('exit', code => { if (code !== 0) report(); });
  browser.unref();
}

module.exports = { importAndLaunchRelease, launchSelectedRelease, openBrowser, ReleaseLaunchError, readStartupAddress, probeProject };
