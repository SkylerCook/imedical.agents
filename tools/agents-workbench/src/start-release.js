'use strict';

const path = require('node:path');
const { localApplication, readSelection, saveSelection } = require('./release-selection');

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
  let next = selection.current;
  let started;
  while (next && !next.base) {
    try {
      started = await launchSelectedRelease({ anchor, entry: next, projectRoot, port: process.env.PORT || '0', owned: true });
      break;
    } catch {
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
  if (process.argv.includes('--open')) openBrowser(started.address);
  const [code] = await started.ended;
  process.exitCode = code ?? 1;
  return true;
}

const projectIndex = process.argv.indexOf('--project');
openDefault(projectIndex === -1 ? null : process.argv[projectIndex + 1]).then(started => {
  if (!started) require('../prototype/serve');
}).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
