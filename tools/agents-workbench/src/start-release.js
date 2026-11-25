'use strict';

const { fork } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { localApplication, readSelection, saveSelection } = require('./release-selection');

function recentTarget(args, root) {
  if (!root || !args.includes('--open') || args.includes('--demo')) return null;
  try { return require('./recent-projects').projectIdentity(path.resolve(root)); }
  catch { return null; }
}

async function launchBackground(args) {
  const { openBrowser, readStartupAddress } = require('./release-launcher');
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 25000).unref();
  const open = args.includes('--open');
  const index = args.indexOf('--project');
  const recent = index === -1 ? null : recentTarget(args, args[index + 1]);
  let child;
  try {
    child = fork(__filename, args.filter(arg => !['--background', '--open'].includes(arg)), {
      detached: true, windowsHide: true, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, WORKBENCH_BACKGROUND: '1', WORKBENCH_STARTUP_PARENT: '' },
    });
    const [message] = await Promise.race([
      once(child, 'message', { signal: deadline.signal }),
      once(child, 'exit', { signal: deadline.signal }).then(() => { throw Error('Workbench could not start.'); }),
    ]);
    if (message?.startupError) throw Error(message.startupError);
    const origin = readStartupAddress(message, args.includes('--demo'));
    if (open && !await openBrowser(`${origin}/#bootstrap=${message.bootstrap}`, deadline.signal)) {
      throw Error('Could not open the browser. Please restart Workbench.');
    }
    if (recent) await require('./recent-projects').rememberProject(recent.path, recent.id);
    console.log(`Workbench: ${message.address}`);
    if (process.connected) process.send({ ...message, pid: child.pid });
    if (child.connected) child.disconnect();
    child.unref();
  } catch (error) {
    if (child?.pid && child.exitCode === null && child.signalCode === null) child.kill();
    if (deadline.signal.aborted) throw Error('Workbench startup timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
    deadline.abort();
  }
}

async function openDefault(projectRoot) {
  if (process.platform !== 'win32' || !projectRoot || process.argv.includes('--demo')) return false;
  let anchor;
  let selection;
  try {
    anchor = localApplication(path.resolve(__dirname, '../../..'));
    if (!anchor) return false;
    selection = readSelection(anchor, projectRoot);
  } catch {
    console.error('Could not read the saved Workbench version. Starting this installation.');
    return false;
  }
  if (!selection || selection.current.base) return false;

  const { launchSelectedRelease, openBrowser } = require('./release-launcher');
  const recent = recentTarget(process.argv, projectRoot);
  const startup = new AbortController();
  const signals = ['SIGINT', 'SIGTERM', 'SIGBREAK'];
  let next = selection.current;
  let started;
  const stop = () => {
    if (started) started.disconnect();
    else startup.abort();
  };
  for (const signal of signals) process.on(signal, stop);
  try {
    while (next && !next.base) {
      try {
        started = await launchSelectedRelease({ anchor, entry: next, projectRoot, port: process.env.PORT || '0',
          owned: true, signal: startup.signal });
        break;
      } catch (error) {
        if (startup.signal.aborted) {
          if (error.code === 'cleanup-failed') throw error;
          return true;
        }
        console.error(`Workbench ${next.version} could not start. Trying the previous installation.`);
        next = next === selection.current ? selection.previous : null;
      }
    }
    if (next !== selection.current) {
      // An explicitly occupied port affects both versions. Keep the saved choice for a normal start.
      if (!process.env.PORT || process.env.PORT === '0' || started) {
        try { saveSelection(anchor, projectRoot, selection, next ? { current: next, previous: null } : null); }
        catch { /* A parallel change is retained. Recovery still opens the previous installation. */ }
      }
    }
    if (!started) return false;

    const address = new URL(started.address);
    console.log(`Workbench: ${address.origin}/#home`);
    if (process.send) process.send({ address: `${address.origin}/#home`, bootstrap: address.hash.slice('#bootstrap='.length) });
    if (process.argv.includes('--open') && await openBrowser(started.address) && recent) {
      await require('./recent-projects').rememberProject(recent.path, recent.id);
    }
    const [code] = await started.ended;
    process.exitCode = code ?? 1;
    return true;
  } finally {
    for (const signal of signals) process.removeListener(signal, stop);
  }
}

const projectIndex = process.argv.indexOf('--project');
async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--recent-project') {
    const recent = require('./recent-projects').lastRecentProject();
    if (recent) process.stdout.write(Buffer.from(recent.path, 'utf8').toString('base64') + '\n');
    return;
  }
  if (process.platform === 'win32' && process.argv.includes('--open') && !process.argv.includes('--demo')) {
    process.env.WORKBENCH_TRACK_PROJECTS = '1';
  }
  if (process.platform === 'win32' && process.argv.includes('--background')) return launchBackground(process.argv.slice(2));
  if (!await openDefault(projectIndex === -1 ? null : process.argv[projectIndex + 1])) require('../prototype/serve');
}

main().catch(error => {
  if (process.connected) process.send({ startupError: error.message });
  console.error(error.message);
  process.exitCode = 1;
});
