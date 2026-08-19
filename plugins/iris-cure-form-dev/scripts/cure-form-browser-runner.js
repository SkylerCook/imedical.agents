#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

const MIN_NODE = [22, 5, 0];
const GATE_VERSION = 'cure-form-preview-gate/2';
const RUNNER_SCHEMA = 'cure-form-browser-runner/v1';
const MANIFEST_PLACEHOLDER = '__CURE_FORM_PREVIEW_MANIFEST_HASH__';

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (next != null && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function assertNodeVersion() {
  const current = process.versions.node.split('.').map(Number);
  for (let index = 0; index < MIN_NODE.length; index += 1) {
    if (current[index] > MIN_NODE[index]) return;
    if (current[index] < MIN_NODE[index]) fail(`Node.js >= ${MIN_NODE.join('.')} is required; current version is ${process.versions.node}.`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(file, value) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return target;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
    return result;
  }
  return value;
}

function sha256(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(stableValue(value));
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function parseMarkdownProfile(file) {
  const result = {};
  if (!file || !fs.existsSync(file)) return result;
  for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = /^\s*-\s*([^:]+):\s*(.*?)\s*$/.exec(line);
    if (match) result[match[1].trim()] = match[2].trim();
  }
  return result;
}

function executableExists(command) {
  if (!command) return false;
  if (path.isAbsolute(command)) return fs.existsSync(command) && fs.statSync(command).isFile();
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true });
  return !probe.error && probe.status === 0;
}

function browserCandidates() {
  const candidates = [];
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || '';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    candidates.push(
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    candidates.push('chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge', 'microsoft-edge-stable');
  }
  return candidates.filter(Boolean);
}

function resolveBrowser(args) {
  const projectRoot = path.resolve(args.projectRoot || process.cwd());
  const profilePath = args.targetProfile
    ? path.resolve(projectRoot, args.targetProfile)
    : path.join(projectRoot, '.agents', 'config', 'cure_form_profile.md');
  const profile = parseMarkdownProfile(profilePath);
  const explicit = String(args.browserCommand || profile.PreviewBrowserCommand || '').trim();
  if (explicit) {
    const projectCandidate = path.resolve(projectRoot, explicit);
    const resolved = path.isAbsolute(explicit) ? path.resolve(explicit) : (fs.existsSync(projectCandidate) ? projectCandidate : explicit);
    if (!executableExists(resolved)) fail('Configured preview browser does not exist or cannot run.');
    return resolved;
  }
  for (const candidate of browserCandidates()) {
    if (executableExists(candidate)) return candidate;
  }
  fail('No Chromium browser was found. Configure PreviewBrowserCommand in cure_form_profile.md or pass --browser-command.');
}

function pathIsWithin(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject'
  })[extension] || 'application/octet-stream';
}

function startPreviewServer(root) {
  const servedRoot = fs.realpathSync(root);
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url, 'http://127.0.0.1');
        const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'preview.html';
        const target = path.resolve(servedRoot, relative);
        const targetExists = pathIsWithin(target, servedRoot) && fs.existsSync(target) && fs.statSync(target).isFile();
        const realTarget = targetExists ? fs.realpathSync(target) : '';
        if (!targetExists || !pathIsWithin(realTarget, servedRoot)) {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end('Not found');
          return;
        }
        response.writeHead(200, { 'Content-Type': contentType(realTarget), 'Cache-Control': 'no-store' });
        fs.createReadStream(realTarget).pipe(response);
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(String(error.message || error));
      }
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function httpJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(text)); } catch (error) { reject(error); }
      });
    });
    request.once('timeout', () => request.destroy(new Error(`Timed out reading ${url}`)));
    request.once('error', reject);
  });
}

async function waitForBrowserWebSocket(port, child, timeoutMs) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const version = await httpJson(endpoint, Math.min(2000, timeoutMs));
      if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
    } catch { /* retry while Chromium starts or its launcher hands off */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const exitDetail = child && child.exitCode != null ? ` Launcher exit: ${child.exitCode}.` : '';
  fail(`Timed out waiting for Chromium DevTools endpoint.${exitDetail}`);
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode != null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
}

async function removeProfileDirectory(directory, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return true;
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  process.stderr.write(`WARNING=Unable to remove temporary Chromium profile: ${lastError && lastError.code || 'unknown'}\n`);
  return false;
}

async function findPageWebSocket(browserWebSocket, timeoutMs, targetId) {
  const endpoint = new URL(browserWebSocket);
  const listUrl = `http://${endpoint.host}/json/list`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await httpJson(listUrl, Math.min(2000, timeoutMs));
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl && (!targetId || target.id === targetId));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry while Chromium initializes */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail('Timed out waiting for a Chromium page target.');
}

async function createPageWebSocket(browserWebSocket, timeoutMs) {
  const browser = new CdpClient(browserWebSocket, timeoutMs);
  await browser.connect();
  try {
    const created = await browser.send('Target.createTarget', { url: 'about:blank' });
    if (!created.targetId) fail('Chromium did not return a targetId for the preview page.');
    return await findPageWebSocket(browserWebSocket, timeoutMs, created.targetId);
  } finally {
    browser.close();
  }
}

class CdpClient {
  constructor(url, timeoutMs) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const timer = setTimeout(() => reject(new Error('Timed out connecting to Chromium DevTools WebSocket.')), this.timeoutMs);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Chromium DevTools WebSocket failed.')); });
      socket.addEventListener('message', (event) => this.onMessage(event.data));
      socket.addEventListener('close', () => {
        for (const pending of this.pending.values()) pending.reject(new Error('Chromium DevTools WebSocket closed.'));
        this.pending.clear();
      });
    });
  }

  onMessage(data) {
    const message = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    if (message.method && this.listeners.has(message.method)) {
      for (const listener of this.listeners.get(message.method)) listener(message.params || {});
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP ${method}.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method) {
    return new Promise((resolve, reject) => {
      const listener = (params) => {
        clearTimeout(timer);
        this.off(method, listener);
        resolve(params);
      };
      const timer = setTimeout(() => {
        this.off(method, listener);
        reject(new Error(`Timed out waiting for CDP event ${method}.`));
      }, this.timeoutMs);
      this.on(method, listener);
    });
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
  }

  off(method, listener) {
    if (this.listeners.has(method)) this.listeners.get(method).delete(listener);
  }

  close() {
    if (this.socket && this.socket.readyState < 2) this.socket.close();
  }
}

function uniqueErrors(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanBrowserLog(value) {
  return String(value || '').replace(/[\r\n]+/g, ' | ').replace(/\s+/g, ' ').trim();
}

async function runBrowser(args) {
  assertNodeVersion();
  const timeoutMs = Number(args.timeoutMs || 20000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 120000) fail('--timeout-ms must be an integer between 5000 and 120000.');
  const manifestPath = path.resolve(args.manifest || fail('Missing required option --manifest'));
  const outputPath = path.resolve(args.output || fail('Missing required option --output'));
  const manifest = readJson(manifestPath);
  if (manifest.schema !== 'cure-form-preview-manifest/v1' || manifest.gateVersion !== GATE_VERSION) {
    fail(`Expected a current cure-form-preview-manifest/v1 using ${GATE_VERSION}.`);
  }
  if (!Array.isArray(manifest.widths) || !manifest.widths.length) fail('Preview manifest widths are missing.');
  const previewRoot = path.dirname(manifestPath);
  const previewHtml = path.resolve(previewRoot, manifest.previewHtml || 'preview.html');
  if (!pathIsWithin(previewHtml, previewRoot) || !fs.existsSync(previewHtml)) fail('Preview HTML is missing or outside the manifest directory.');
  const manifestHash = sha256(manifest);
  const html = fs.readFileSync(previewHtml, 'utf8');
  if (html.split(manifestHash).length - 1 !== 1 || sha256(html.replace(manifestHash, MANIFEST_PLACEHOLDER)) !== manifest.previewHtmlTemplateHash) {
    fail('Preview HTML does not match the manifest.');
  }
  const browserCommand = resolveBrowser(args);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cure-form-browser-'));
  let server;
  let child;
  let cdp;
  let stage = 'startup';
  let browserLog = '';
  try {
    stage = 'start-preview-server';
    const served = await startPreviewServer(previewRoot);
    server = served.server;
    const previewUrl = `${served.origin}/${encodeURIComponent(path.basename(previewHtml))}`;
    const debuggingPort = await availablePort();
    const browserArgs = [
      '--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--disable-gpu-compositing', '--use-gl=disabled',
      '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debuggingPort}`, '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--disable-component-update', '--disable-sync', '--metrics-recording-only', '--disable-default-apps', '--disable-extensions',
      '--mute-audio'
    ];
    if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) browserArgs.push('--no-sandbox');
    browserArgs.push('about:blank');
    stage = 'launch-browser';
    child = spawn(browserCommand, browserArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const collectBrowserLog = (chunk) => { browserLog = (browserLog + chunk.toString()).slice(-4000); };
    child.stdout.on('data', collectBrowserLog);
    child.stderr.on('data', collectBrowserLog);
    stage = 'wait-for-devtools';
    const browserWebSocket = await waitForBrowserWebSocket(debuggingPort, child, timeoutMs);
    stage = 'create-page-target';
    const pageWebSocket = await createPageWebSocket(browserWebSocket, timeoutMs);
    cdp = new CdpClient(pageWebSocket, timeoutMs);
    stage = 'connect-cdp';
    await cdp.connect();
    stage = 'enable-cdp-domains';
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable'), cdp.send('Log.enable')]);
    stage = 'read-browser-version';
    const version = await cdp.send('Browser.getVersion');
    let currentNetworkErrors = [];
    let currentConsoleErrors = [];
    let currentRequestUrls = new Map();
    cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
      if (requestId && request) currentRequestUrls.set(requestId, String(request.url || ''));
    });
    cdp.on('Network.responseReceived', ({ response }) => {
      if (response && Number(response.status) >= 400) currentNetworkErrors.push({ url: String(response.url || ''), status: Number(response.status) });
    });
    cdp.on('Network.loadingFailed', ({ requestId, errorText, canceled, type }) => {
      if (!canceled) currentNetworkErrors.push({ url: currentRequestUrls.get(requestId) || String(type || 'resource'), error: String(errorText || 'loading failed') });
      currentRequestUrls.delete(requestId);
    });
    cdp.on('Network.loadingFinished', ({ requestId }) => currentRequestUrls.delete(requestId));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      currentConsoleErrors.push(String(exceptionDetails && (exceptionDetails.text || (exceptionDetails.exception && exceptionDetails.exception.description)) || 'runtime exception'));
    });
    cdp.on('Runtime.consoleAPICalled', ({ type, args: consoleArgs }) => {
      if (type !== 'error' && type !== 'assert') return;
      currentConsoleErrors.push((consoleArgs || []).map((item) => item.value ?? item.description ?? '').join(' '));
    });
    cdp.on('Log.entryAdded', ({ entry }) => {
      if (entry && entry.level === 'error') currentConsoleErrors.push(String(entry.text || 'console error'));
    });
    const results = [];
    for (const width of manifest.widths) {
      stage = `run-width-${width}`;
      currentNetworkErrors = [];
      currentConsoleErrors = [];
      currentRequestUrls = new Map();
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: 900, deviceScaleFactor: 1, mobile: false });
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: `${previewUrl}?width=${width}&run=${Date.now()}` });
      await loaded;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const evaluated = await cdp.send('Runtime.evaluate', {
        expression: 'window.__cureFormPreviewCheck && window.__cureFormPreviewCheck()',
        returnByValue: true,
        awaitPromise: true
      });
      if (evaluated.exceptionDetails || !evaluated.result || !evaluated.result.value) fail(`Preview probe failed at width ${width}.`);
      const result = evaluated.result.value;
      result.networkErrors = uniqueErrors([...(result.networkErrors || []), ...currentNetworkErrors]);
      result.consoleErrors = uniqueErrors(currentConsoleErrors.map(String));
      results.push(result);
    }
    const runner = {
      schema: RUNNER_SCHEMA,
      gateVersion: GATE_VERSION,
      manifestHash,
      engine: 'chromium-cdp',
      browser: path.basename(browserCommand),
      browserProduct: String(version.product || ''),
      protocolVersion: String(version.protocolVersion || ''),
      completedAt: new Date().toISOString()
    };
    const output = writeJson(outputPath, { schema: 'cure-form-browser-results/v1', runner, results });
    process.stdout.write(JSON.stringify({ command: 'preview-run', output, runner, widths: manifest.widths }, null, 2) + '\n');
  } catch (error) {
    const detail = cleanBrowserLog(browserLog);
    throw new Error(`${stage}: ${error.message}${detail ? ` Browser log: ${detail}` : ''}`);
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch { /* browser may already be closing */ }
      cdp.close();
    }
    if (child && !(await waitForExit(child, 3000))) {
      child.kill();
      await waitForExit(child, 3000);
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await removeProfileDirectory(profileDir);
  }
}

if (require.main === module) {
  runBrowser(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`ERROR=${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { browserCandidates, parseArgs, runBrowser };
