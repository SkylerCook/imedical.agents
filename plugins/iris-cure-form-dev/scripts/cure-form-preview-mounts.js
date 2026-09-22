'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PREFIX = '/__cure_vendor/hisui/';
const within = (file, root) => { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); };
const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function createMount(root) {
  const realRoot = fs.realpathSync(root);
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Vendor mount may not contain symbolic links.');
      const real = fs.realpathSync(target);
      if (!within(real, realRoot)) throw new Error('Vendor mount escapes its allowed root.');
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && /\.(?:css|js|png|gif|svg|jpe?g|ico|woff2?|ttf|eot)$/i.test(entry.name)) {
        files.push({ path: path.relative(realRoot, real).replace(/\\/g, '/'), contentHash: hashFile(real) });
      }
    }
  };
  walk(realRoot);
  return { prefix: PREFIX, root: realRoot, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

function validateMount(mount, allowedRoot) {
  if (!allowedRoot || !mount || mount.prefix !== PREFIX || fs.realpathSync(allowedRoot) !== fs.realpathSync(mount.root)) throw new Error('Vendor mount root is not explicitly allowed.');
  const root = fs.realpathSync(allowedRoot);
  if (!Array.isArray(mount.files) || !mount.files.length || new Set(mount.files.map((item) => item.path)).size !== mount.files.length) throw new Error('Invalid vendor mount inventory.');
  for (const item of mount.files) {
    if (path.isAbsolute(item.path) || item.path.split(/[\\/]/).includes('..')) throw new Error('Unsafe vendor mount path.');
    const file = fs.realpathSync(path.resolve(root, item.path));
    if (!within(file, root) || hashFile(file) !== item.contentHash) throw new Error(`Vendor source changed: ${item.path}`);
  }
  return mount;
}

function mountedFile(mount, pathname) {
  if (!mount || !pathname.startsWith(PREFIX)) return null;
  const relative = pathname.slice(PREFIX.length);
  const item = mount.files.find((entry) => entry.path === relative);
  if (!item) throw new Error('Vendor file is not in the manifest.');
  const file = fs.realpathSync(path.resolve(mount.root, relative));
  if (!within(file, fs.realpathSync(mount.root)) || hashFile(file) !== item.contentHash) throw new Error('Vendor file changed or escaped its mount.');
  return file;
}
module.exports = { PREFIX, createMount, validateMount, mountedFile };
