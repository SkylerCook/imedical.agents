'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const owned = new Set();
function createTempDirectory(prefix) {
    if (!/^[a-z0-9-]+-$/.test(prefix)) throw new Error('Task-specific temporary prefix required');
    const preferred = process.platform === 'win32' ? 'D:/tmp/Codex' : path.join(os.tmpdir(), 'Codex');
    let root;
    try { fs.mkdirSync(preferred, { recursive: true }); root = fs.mkdtempSync(path.join(preferred, prefix)); }
    catch (error) {
        if (!['EACCES','EPERM','ENOENT','ENOTDIR'].includes(error.code)) throw error;
        const fallback = path.join(os.tmpdir(), 'Codex'); fs.mkdirSync(fallback, { recursive: true }); root = fs.mkdtempSync(path.join(fallback, prefix));
    }
    owned.add(path.resolve(root)); return root;
}
function ownsTempDirectory(root) { return owned.has(path.resolve(root)) && fs.existsSync(root) && !fs.lstatSync(root).isSymbolicLink(); }
module.exports = { createTempDirectory, ownsTempDirectory };
