'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { launchProjectWindow, openBrowser: openDefaultBrowser } = require('./release-launcher');
const { listRecentProjects, resolveRecentProject, rememberProject, projectIdentity } = require('./recent-projects');

const run = promisify(execFile);
const projectIdPattern = /^[a-f0-9]{64}$/u;

async function pickNativeFolder({ signal }) {
  if (process.platform !== 'win32') throw Error('project-pick-unavailable');
  const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const bundled = path.resolve(__dirname, '../../..', 'start-workbench.ps1');
  const source = path.resolve(__dirname, '../react/start-workbench.ps1');
  const script = fs.existsSync(bundled) ? bundled : source;
  const info = fs.lstatSync(script, { throwIfNoEntry: false });
  if (!info?.isFile() || info.nlink !== 1) throw Error('project-pick-unavailable');
  const { stdout } = await run(shell, ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-PickOnly'], {
    cwd: path.dirname(script), encoding: 'utf8', maxBuffer: 32 * 1024, windowsHide: true, signal,
  });
  return stdout.trim() || null;
}

function identity(root) {
  if (!root) return null;
  try { return projectIdentity(root); }
  catch { return null; }
}

function createProjectOpener(root, { pickFolder = pickNativeFolder, openBrowser = openDefaultBrowser, signal } = {}) {
  const current = identity(root);
  let busy = false;
  const sameDirectory = (project, directory) => identity(directory)?.id === project.id;
  const currentStillValid = () => current && sameDirectory(current, root);

  return async function openProject(data) {
    const keys = Object.keys(data).sort().join(',');
    const selected = data.action === 'open';
    if (!(selected ? keys === 'action,id' && typeof data.id === 'string' && projectIdPattern.test(data.id)
      : keys === 'action' && ['list', 'pick'].includes(data.action))) return {error:'invalid-action'};
    if (!currentStillValid()) return {error:'binding-mismatch'};
    if (data.action === 'list') return {projects:listRecentProjects(), currentId:current.id};
    if (signal?.aborted) return {state:'cancelled'};
    if (busy) return {error:'project-picker-busy'};
    busy = true;
    try {
      let target;
      if (selected) target = resolveRecentProject(data.id);
      else {
        let folder;
        try { folder = await pickFolder({ signal }); }
        catch { return signal?.aborted ? {state:'cancelled'} : {error:'project-pick-unavailable'}; }
        if (!folder || signal?.aborted) return {state:'cancelled'};
        target = identity(folder);
      }
      if (!currentStillValid()) return {error:'binding-mismatch'};
      if (!target) return {error:'project-unavailable'};
      if (target.id === current.id) return {state:'current'};
      const stillCurrent = () => currentStillValid() && sameDirectory(target, target.path);
      const expected = {name:target.name, revision:null, hasFramework:fs.existsSync(path.join(target.path, '.agents'))};
      let address;
      try {
        address = await launchProjectWindow(target.path, expected, { signal, standalone:true, stillCurrent });
      } catch (error) {
        if (!currentStillValid()) return {error:'binding-mismatch'};
        if (signal?.aborted) return {state:'cancelled'};
        if (error.message === 'project-target-changed') return {error:'project-unavailable'};
        return {error:error.message === 'project-startup-timeout' ? 'project-startup-timeout' : 'project-startup-failed'};
      }
      if (signal?.aborted) return {state:'cancelled'};
      if (await openBrowser(address, signal).catch(() => false)) {
        await rememberProject(target.path, target.id);
        return {state:'opened'};
      }
      return {state:'ready', address};
    } finally { busy = false; }
  };
}

module.exports = {createProjectOpener};
