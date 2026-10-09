'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../commit-demand.js'), 'utf8');
for (const mode of ['success', 'pull-failed', 'head-changed', 'snapshot-changed', 'local-only']) {
  test('global upstream hook coordination: ' + mode, () => {
    const calls = [];
    const ctx = { require: id => id.includes('workspace-context') ? {} : id === 'fs' ? {...fs, writeFileSync() {}} : require(id),
      module: {exports:{}}, process: {...process, env:{...process.env}}, console:{log(){},error(){}}, mode, calls };
    vm.createContext(ctx); vm.runInContext(source,ctx);
    vm.runInContext(`
      const fakeRepo = {root: '.', upstream: mode === 'local-only' ? '' : 'origin/dev', head: 'abc', stateVersion: 2,
        files: ['target'], execution: {}, message: 'test'};
      readPlan = () => ({repositories:[fakeRepo], kind: mode === 'local-only' ? 'project' : 'standard', planPath:'test-plan'});
      assertRepoUnchanged = () => ({head:'abc'});
      repositoryInfo = () => ({head:mode === 'head-changed' ? 'def' : 'abc'});
      assertSnapshotMatches = () => {if(mode === 'snapshot-changed') throw Error('snapshot changed');};
      writeJson = () => {};
      gitText = () => 'commit-id';
      runGit = (root,args) => {
        calls.push(args);
        if(args[0] === 'pull' && mode === 'pull-failed') throw Error('pull failed');
      };
    `,ctx);
    if(mode === 'pull-failed' || mode === 'snapshot-changed') assert.throws(()=>vm.runInContext('applyCommand({confirmCommit:true})',ctx));
    else vm.runInContext('applyCommand({confirmCommit:true})',ctx);
    const commits = calls.filter(args=>args.includes('commit'));
    assert.equal(commits.length, ['success','local-only'].includes(mode) ? 1 : 0);
    if(commits.length) {
      assert.equal(commits[0].includes('hooks.requireUpToDate=false'),mode === 'success');
      assert.equal(commits[0].includes('--no-verify'),false);
      assert.equal(commits[0].includes('--only'),true);
    }
    assert.ok(calls.filter(args=>!args.includes('commit')).every(args=>!args.includes('hooks.requireUpToDate=false')));
    if(mode !== 'local-only') assert.equal(calls[0].join(' '),'pull --ff-only');
  });
}
