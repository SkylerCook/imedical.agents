'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const io = require('./configuration-file-io');

const MAIN = 'project.jsonc';
const legacyFiles = {
  documentationLayout: 'documentation-layout.json',
  irisRemotePolicy: 'iris-remote-policy.json',
  irisSessionBackend: 'iris-session-backend.json',
};

function filePath(root, name = MAIN) {
  const rel = 'config/' + name;
  return fs.existsSync(root) ? require('./project-directories').safePath(root, rel) : path.join(root, rel);
}

function fileText(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1) throw Error('unsafe-config-file');
    return io.readText(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function document(root) {
  const file = filePath(root);
  const text = fileText(file);
  return {file, text, value: text === null ? {} : structuredClone(io.parse(text))};
}

function object(value, section) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('invalid-project-section: ' + section);
  }
  return value;
}

function normalize(root, id, value) {
  object(value, id);
  if (id !== 'documentationLayout' || !Object.hasOwn(value, 'workspaceRoot')) return value;
  const {workspaceRoot, ...layout} = value;
  if (typeof workspaceRoot !== 'string' || !require('./project-directories').same(workspaceRoot, root.workspaceRoot)) {
    throw Error('documentation-layout-workspace-mismatch');
  }
  return layout;
}

function inspect(context, id) {
  const main = document(context.contextRoot);
  const name = Object.hasOwn(legacyFiles, id) ? legacyFiles[id] : null;
  const file = name && filePath(context.contextRoot, name);
  const legacy = file && fileText(file);
  const oldValue = legacy === null ? null : normalize(context, id, JSON.parse(legacy.replace(/^\uFEFF/, '')));
  const canonical = Object.hasOwn(main.value, id);
  const value = canonical ? normalize(context, id, main.value[id]) : oldValue;
  if (canonical && oldValue !== null && !isDeepStrictEqual(value, oldValue)) {
    throw Error('project-config-conflict: ' + id + ' / ' + name);
  }
  return {main, value, canonical, file, legacy, name};
}

function delta(prefix, before, after) {
  if (isDeepStrictEqual(before, after)) return [];
  if (!before || typeof before !== 'object' || Array.isArray(before) ||
      !after || typeof after !== 'object' || Array.isArray(after)) return [{path:prefix,value:after}];
  return Object.entries(after).flatMap(([key,value]) => delta([...prefix,key], before[key], value));
}

function replace(file, before, next) {
  if (fileText(file) !== before) throw Error('project-config-changed: ' + path.basename(file));
  if (before === next) return;
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, next, {flag: 'wx', mode: 0o600});
    if (before !== null) io.copyFileAccess(file, temp);
    if (fileText(file) !== before) throw Error('project-config-changed: ' + path.basename(file));
    fs.renameSync(temp, file);
    if (fileText(file) !== next) throw Error('project-config-readback-failed');
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function withLock(context, callback) {
  if (context.capabilityRoot && fs.existsSync(path.join(context.capabilityRoot, '.git'))) {
    return require('./plugin-deployment').withLock(context.capabilityRoot, callback);
  }
  return callback();
}

function edited(main, edits) {
  const text = edits.length ? io.edit(main.text ?? '{}\n', edits) : main.text ?? '{}\n';
  return io.annotate(text, require('./project-configuration-fields').notes(io.parse(text)));
}

function update(context, makeEdits) {
  return withLock(context, () => {
    const main = document(context.contextRoot);
    const edits = makeEdits(main.value);
    if (!edits.length) return false;
    replace(main.file, main.text, edited(main, edits));
    return true;
  });
}

function save(context, id, value) {
  object(value, id);
  return withLock(context, () => {
    const state = inspect(context, id);
    if (state.legacy !== null && !state.canonical) {
      // Use the original owner's Write while the project still uses its legacy file.
      const next = JSON.stringify(value, null, 2) + '\n';
      replace(state.file, state.legacy, next);
      return;
    }
    if (state.legacy !== null) throw Error('project-config-legacy-pending: ' + id);
    update(context, tree => delta([id], tree[id], value));
  });
}

function contextMode(contextRoot) {
  return require('./project-context-settings').contextSettings(contextRoot).values.contextMode || null;
}

module.exports = {MAIN, legacyFiles, document, inspect, filePath, fileText, withLock, edited, replace, update, save, delta, contextMode};
