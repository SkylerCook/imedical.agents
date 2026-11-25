'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {safePath} = require('../../ai-dev-offline/configure-vscode');
const {withLock} = require('../../ai-dev-offline/operation-runtime');
const {directoryIdentity} = require('./overlay-members');

const limit = 12;
const idPattern = /^[a-f0-9]{64}$/u;
const localPath = value => typeof value === 'string' && path.isAbsolute(value) && !/^[\\/]{2}/u.test(value);

function projectIdentity(root) {
  if (!localPath(root)) throw Error('project-directory-not-local');
  const [directory, device, inode] = directoryIdentity(fs.realpathSync.native(root));
  const identityPath = process.platform === 'win32' ? directory.toLowerCase() : directory;
  const id = createHash('sha256').update(JSON.stringify([identityPath, device, inode])).digest('hex');
  return {id, name: path.basename(directory) || directory, path: directory};
}

function projectId(root) {
  return projectIdentity(root).id;
}

function stateFile() {
  const userProfile = process.env.LOCALAPPDATA;
  if (process.platform !== 'win32' || !localPath(userProfile)) return null;
  const file = path.join(userProfile, 'AgentsWorkbench', 'recent-projects.json');
  safePath(file, true);
  return file;
}

function readRecords(file) {
  try {
    const stat = fs.lstatSync(file, {throwIfNoEntry: false});
    if (!stat?.isFile() || stat.size > 1024 * 1024) return [];
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    return content?.schemaVersion === 1 && Array.isArray(content.projects) ? content.projects.slice(0, limit) : [];
  } catch { return []; }
}

function available(record) {
  if (typeof record?.id !== 'string' || !idPattern.test(record.id)) return null;
  try {
    const project = projectIdentity(record.path);
    return project.id === record.id ? project : null;
  } catch { return null; }
}

function currentRecords() {
  try {
    const file = stateFile();
    return file ? readRecords(file) : [];
  } catch { return []; }
}

function listRecentProjects() {
  const projects = currentRecords().map(available).filter(Boolean);
  return [...new Map(projects.map(project => [project.id, project])).values()];
}

function lastRecentProject() {
  return available(currentRecords()[0]);
}

function resolveRecentProject(id) {
  if (typeof id !== 'string' || !idPattern.test(id)) return null;
  return available(currentRecords().find(record => record?.id === id));
}

async function rememberProject(root, expectedId) {
  try {
    const file = stateFile();
    if (!file) return false;
    const directory = path.dirname(file);
    fs.mkdirSync(directory, {recursive: true});
    return await withLock(directory, {}, () => {
      safePath(file, true);
      const project = projectIdentity(root);
      if (expectedId !== undefined && project.id !== expectedId) return false;
      const updates = [project, ...readRecords(file).map(available).filter(Boolean)];
      const seen = new Set();
      const projects = [];
      for (const {id, path: projectPath} of updates) {
        if (seen.has(id)) continue;
        seen.add(id);
        projects.push({id, path: projectPath});
        if (projects.length === limit) break;
      }
      const temporary = path.join(directory, `recent-projects-${randomUUID()}.tmp`);
      let owned = false;
      try {
        const handle = fs.openSync(temporary, 'wx', 0o600);
        owned = true;
        try { fs.writeFileSync(handle, JSON.stringify({schemaVersion: 1, projects}) + '\n', 'utf8'); }
        finally { fs.closeSync(handle); }
        fs.renameSync(temporary, file);
        owned = false;
        return true;
      } finally {
        if (owned) fs.unlinkSync(temporary);
      }
    });
  } catch { return false; }
}

module.exports = {lastRecentProject, listRecentProjects, resolveRecentProject, rememberProject, projectIdentity, projectId};
