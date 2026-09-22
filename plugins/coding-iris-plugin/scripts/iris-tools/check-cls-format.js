#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { check } = require('./cls-format');
function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.status !== 0) throw new Error('Unable to inspect Git baseline');
  return result.stdout;
}
function formatIssues(repo, file, source) {
  const known = spawnSync('git', ['-C', repo, 'cat-file', '-e', `HEAD:${file}`], { windowsHide: true, timeout: 30000 });
  if (known.error) throw known.error;
  if (known.status !== 0) return check(source);
  const diff = git(repo, ['diff', '--no-ext-diff', '--no-textconv', '--unified=0', 'HEAD', '--', file]);
  const ranges = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)]
    .map(m => ({ start: Number(m[1]), end: Number(m[1]) + Math.max(1, Number(m[2] ?? 1)) - 1 }));
  return check(source, ranges);
}
try {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error('Usage: node check-cls-format.js <file.cls> ...');
  const results = files.map(file => {
    const absolute = path.resolve(file);
    const repo = git(path.dirname(absolute), ['rev-parse', '--show-toplevel']).trim();
    const source = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(absolute));
    return { file, mode: 'advisory', issues: formatIssues(repo, path.relative(repo, absolute).replace(/\\/g, '/'), source).map(issue => ({ ...issue, status: issue.status === 'fail' ? 'advisory' : issue.status })) };
  });
  console.log(JSON.stringify(results, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
