#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { check } = require('./cls-format');
function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer:64*1024*1024 });
  if (result.status !== 0) throw new Error('Unable to inspect Git baseline');
  return result.stdout;
}
function inspectFile(repo, file, source, baseRef) {
  const known = spawnSync('git', ['-C', repo, 'cat-file', '-e', `${baseRef}:${file}`], { windowsHide: true, timeout: 30000 });
  if (known.error) throw known.error;
  const tracked = known.status === 0;
  const diff = tracked ? git(repo, ['diff', '--no-ext-diff', '--no-textconv', '--unified=0', baseRef, '--', file]) : '';
  const ranges = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)]
    .map(m => ({ start: Number(m[1]), end: Number(m[1]) + Number(m[2] ?? 1) - 1 }));
  const issues = check(source, tracked ? ranges : undefined).map(issue => ({ ...issue, status: issue.status === 'fail' ? 'advisory' : issue.status }));
  if (process.platform === 'win32' && process.arch === 'x64') {
    const baseline = tracked ? git(repo, ['show', baseRef + ':' + file]) : '';
    const {inspect} = require('./cls-delivery-gate');
    const changed = line => !tracked || ranges.some(({start,end}) => line >= start && line <= end);
    for (const issue of inspect(source, changed, baseline)) issues.push({status:'fail', ...issue});
  }
  return issues;
}
try {
  const files = process.argv.slice(2);
  let requestedBase;
  if (files[0] === '--base-ref') {
    files.shift();
    requestedBase = files.shift();
    if (!requestedBase || requestedBase.startsWith('-')) throw new Error('Expected a Git baseline after --base-ref');
  }
  if (!files.length) throw new Error('Usage: node check-cls-format.js [--base-ref <commit>] <file.cls> ...');
  const bases = new Map();
  const results = files.map(file => {
    const absolute = path.resolve(file);
    const repo = git(path.dirname(absolute), ['rev-parse', '--show-toplevel']).trim();
    const source = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(absolute));
    if (!bases.has(repo)) bases.set(repo, requestedBase ? git(repo,['rev-parse','--verify','--end-of-options',requestedBase+'^{commit}']).trim() : 'HEAD');
    const issues = inspectFile(repo, path.relative(repo, absolute).split(path.sep).join('/'), source, bases.get(repo));
    const blocked = issues.some(issue => issue.status === 'fail');
    if (blocked) process.exitCode = 1;
    return {file, mode:blocked ? 'blocked' : 'advisory', issues};
  });
  console.log(JSON.stringify(results, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
