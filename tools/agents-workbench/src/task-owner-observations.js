'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadState } = require('../../../scripts/lib/plugin-deployment');
const { inspectRoot, inspectOverlayLink } = require('./overlay-members');

function observePluginDeployment(workspaceRoot, overlay) {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot) || /^[\\/]{2}/u.test(workspaceRoot)) return;
  try {
    const localContext = path.join(workspaceRoot, '.agents');
    if (!fs.lstatSync(workspaceRoot, { throwIfNoEntry: false })?.isDirectory() ||
        !fs.lstatSync(localContext, { throwIfNoEntry: false })?.isDirectory()) return;
    const declaration = fs.lstatSync(path.join(localContext, 'capability.json'), { throwIfNoEntry: false });
    if (declaration && (!declaration.isFile() || declaration.nlink !== 1)) return;

    const shared = Boolean(declaration);
    const root = shared ? (overlay === undefined ? inspectOverlayLink(workspaceRoot) : overlay)?.root : inspectRoot(workspaceRoot);
    if (!root) return;
    const file = path.join(root.gitRoot, 'plugin-deployment.json');
    const info = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!info?.isFile() || info.nlink !== 1) return;
    const { phase, revision } = loadState(root.capabilityRoot, file);
    if (phase !== 'materializing' && phase !== 'interrupted') return;

    // The phase is a recorded checkpoint. It does not describe a live process.
    return { phase, shared, ...(revision === root.revision ? { revision } : {}) };
  } catch {
    // A missing or unreadable owner record must not block other task observations.
    return undefined;
  }
}

module.exports = { observePluginDeployment };
