'use strict';

// Also loaded from HEAD by the PowerShell bootstrap when this file is sparse-excluded.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.error?.message || result.stderr || result.status}`);
  }
  return result.stdout;
}

function verify(root, patterns) {
  const specs = patterns.map(pattern => `:(glob)${pattern.replace(/^\//, '')}`);
  const entries = git(root, ['ls-files', '-t', '-z', '--', ...specs]).split('\0').filter(Boolean);
  const missing = entries.filter(entry => entry.startsWith('S ') || !fs.existsSync(path.join(root, entry.slice(2))));
  if (missing.length) throw new Error(`Sparse runtime files not materialized: ${missing.slice(0, 10).map(entry => entry.slice(2)).join(', ')}`);
  // A --no-checkout clone can have an empty index: do not accept vacuous success.
  const matchers = patterns.map(pattern => new RegExp('^' + pattern.slice(1).split('**').map(part => part.split('*').map(text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$'));
  const expected = git(root, ['ls-tree', '-r', '--name-only', '-z', 'HEAD']).split('\0').filter(file => file && matchers.some(re => re.test(file)));
  const absent = expected.filter(file => !fs.existsSync(path.join(root, file)));
  if (absent.length) throw new Error(`Sparse HEAD files not materialized: ${absent.slice(0, 10).join(', ')}`);
}

function refresh(root, patterns, initial = false) {
  if (!Array.isArray(patterns) || !patterns.length || patterns.some(p => typeof p !== 'string' || !/^\/[\w/.*-]+$/.test(p))) {
    throw new Error('Expected non-empty positive runtime sparse patterns');
  }
  if (!initial && git(root, ['status', '--porcelain']).trim()) throw new Error('Cannot refresh a dirty capability checkout');
  // Argument input is independent of PowerShell $OutputEncoding and its UTF-8 BOM.
  git(root, ['sparse-checkout', 'init', '--no-cone']);
  git(root, ['sparse-checkout', 'set', '--no-cone', '--', ...patterns]);
  if (initial) git(root, ['checkout']);
  verify(root, patterns);
}

module.exports = { refresh, verify };
if (require.main === module || process.argv[1] === '--sparse-bootstrap') {
  try {
    const args = process.argv.slice(3);
    refresh(process.argv[2], args.filter(arg => arg !== '--initial'), args.includes('--initial'));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
