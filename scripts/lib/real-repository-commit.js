'use strict';

// Shared, read-only BOS prerequisite. A commit object in the common object
// database is insufficient: it must belong to the confirmed real target ref.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const physical = value => fs.realpathSync.native(path.resolve(value));
const identity = value => process.platform === 'win32' ? physical(value).toLowerCase() : physical(value);
function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', windowsHide: true, stdio: 'pipe', timeout: 30000,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' }
  }).trim();
}

function verifyRealCommits(repo, ref, hashes) {
  if (typeof repo !== 'string' || !repo.trim()) throw new Error('BOS requires a real repository path');
  if (typeof ref !== 'string' || !/^refs\/heads\/[^\s]+$/.test(ref)) throw new Error('BOS requires an explicit target ref (refs/heads/...)');
  if (!Array.isArray(hashes) || hashes.some(hash => typeof hash !== 'string' || !/^[a-f0-9]{40}$/i.test(hash))) throw new Error('BOS requires full 40-character real repository commit hashes');
  const root = physical(repo);
  if (identity(git(root, ['rev-parse', '--show-toplevel'])) !== identity(root)) throw new Error('BOS repository must be the confirmed real Git root');
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir']);
  const commonDir = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']));
  if (identity(gitDir) !== identity(commonDir)) throw new Error('BOS rejects linked worktree sources; use the real repository commit after integration');
  git(root, ['check-ref-format', ref]);
  if (git(root, ['symbolic-ref', '-q', 'HEAD']) !== ref) throw new Error('Real repository checkout differs from the confirmed target ref');
  const head = git(root, ['rev-parse', '--verify', ref + '^{commit}']);
  const commits = [];
  for (const hash of [...new Set(hashes.map(value => value.toLowerCase()))]) {
    const actual = git(root, ['rev-parse', '--verify', hash + '^{commit}']);
    if (actual !== hash) throw new Error('BOS selection must identify the actual real repository commit');
    try { git(root, ['merge-base', '--is-ancestor', actual, head]); }
    catch { throw new Error('BOS commit is not contained in the real target branch; integrate and verify first'); }
    commits.push(actual);
  }
  return { repo: root, ref, head, hashes: commits };
}

module.exports = { verifyRealCommits };
