'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../scripts/commit-demand.js'), 'utf8');
for (const mode of ['success', 'pull-failed', 'head-changed', 'snapshot-changed', 'local-only']) {
  test('global upstream hook coordination: ' + mode, () => {
    const calls = [];
    const ctx = { require: id => id.includes('workspace-context') ? {} : id === 'fs' ? {...fs, writeFileSync() {}} : require(id),
      module: {exports:{}}, process: {...process, env:{...process.env}}, console:{log(){},error(){}}, mode, calls };
    vm.createContext(ctx); vm.runInContext(source,ctx);
    vm.runInContext(`
      const fakeRepo = {root: '.', branch:'dev', fingerprint:'unchanged', upstream: mode === 'local-only' ? '' : 'origin/dev', head: 'abc', stateVersion: 2,
        files: ['target'], execution: {}, message: 'test'};
      readPlan = () => ({repositories:[fakeRepo], kind: mode === 'local-only' ? 'project' : 'standard', planPath:'test-plan'});
      // File ownership is covered by the real-repository suite; isolate hook ordering here.
      let scopeChecks = 0;
      assertPlanScope = () => { scopeChecks++; };
      let snapshotReads = 0;
      repositoryInfo = () => {
        snapshotReads++;
        const pulled = calls.some(args => args[0] === 'pull');
        return {...fakeRepo, head:mode === 'head-changed' && pulled ? 'def' : 'abc',
          fingerprint:mode === 'snapshot-changed' && pulled ? 'changed' : 'unchanged'};
      };
      writeJson = () => {};
      gitText = () => 'commit-id';
      runGit = (root,args) => {
        calls.push(args);
        if(args[0] === 'pull' && mode === 'pull-failed') throw Error('pull failed');
      };
    `,ctx);
    if(mode === 'pull-failed' || mode === 'snapshot-changed') assert.throws(()=>vm.runInContext('applyCommand({confirmCommit:true})',ctx));
    else vm.runInContext('applyCommand({confirmCommit:true})',ctx);
    assert.equal(vm.runInContext('scopeChecks', ctx), ['success','local-only'].includes(mode) ? 2 : 1);
    const commits = calls.filter(args=>args.includes('commit'));
    assert.equal(commits.length, ['success','local-only'].includes(mode) ? 1 : 0);
    if(commits.length) {
      assert.equal(commits[0].includes('hooks.requireUpToDate=false'),mode === 'success');
      assert.equal(commits[0].includes('--no-verify'),false);
      assert.equal(commits[0].includes('--only'),true);
    }
    assert.ok(calls.filter(args=>!args.includes('commit')).every(args=>!args.includes('hooks.requireUpToDate=false')));
    if(mode !== 'local-only') assert.equal(calls[0].join(' '),'pull --ff-only');
    assert.equal(calls.some(args => args[0] === 'fetch'), false);
    if (commits.length) assert.equal(vm.runInContext('snapshotReads', ctx), mode === 'local-only' ? 3 : 4);
  });
}

for (const field of ['head', 'branch', 'upstream', 'fingerprint']) {
  test('live state changed during a later repository pull blocks all staging: ' + field, () => {
    const calls = [];
    const ctx = { require: id => id.includes('workspace-context') ? {} : require(id),
      module:{exports:{}}, process:{...process,env:{...process.env}}, console:{log(){}}, calls, field };
    vm.createContext(ctx); vm.runInContext(source, ctx);
    vm.runInContext(`
      const repos = ['repo-a', 'repo-b'].map(root => ({root, head:'abc', branch:'dev', upstream:'origin/dev',
        fingerprint:'original', stateVersion:2, files:['target'], message:'test', execution:{}}));
      const live = new Map(repos.map(repo => [repo.root,{...repo}]));
      readPlan = () => ({kind:'standard',repositories:repos,planPath:'unused'});
      assertPlanScope = () => {};
      repositoryInfo = root => ({...live.get(root)});
      writeJson = () => {};
      runGit = (root,args) => {
        calls.push({root,args});
        if (root === 'repo-b' && args[0] === 'pull') live.get('repo-a')[field] = 'concurrent-change';
      };
    `,ctx);
    assert.throws(() => vm.runInContext('applyCommand({confirmCommit:true})',ctx), /重新 plan/);
    assert.equal(calls.filter(call => call.args[0] === 'pull').length, 2);
    assert.equal(calls.some(call => call.args[0] === 'add' || call.args.includes('commit')), false);
  });
}

for (const phase of ['before-first-stage', 'after-first-commit']) {
  test('each staging rechecks live state and preserves partial receipts: ' + phase, () => {
    const calls = [];
    const ctx = { require: id => id.includes('workspace-context') ? {} : id === 'fs' ? {...fs,writeFileSync(){}} : require(id),
      module:{exports:{}}, process:{...process,env:{...process.env}}, console:{log(){}}, calls, phase };
    vm.createContext(ctx); vm.runInContext(source,ctx);
    vm.runInContext(`
      const repos = ['repo-a', 'repo-b'].map(root => ({root, head:'abc', branch:'dev', upstream:'origin/dev',
        fingerprint:'original', stateVersion:2, files:['target'], message:'test', execution:{}}));
      const live = new Map(repos.map(repo => [repo.root,{...repo}]));
      const planned = {kind:'standard',repositories:repos,planPath:'unused'};
      let saved;
      readPlan = () => planned;
      assertPlanScope = () => {};
      repositoryInfo = root => ({...live.get(root)});
      writeJson = (file,plan) => {
        saved = JSON.parse(JSON.stringify(plan));
        if (phase === 'before-first-stage' && plan.status === 'committing') live.get('repo-a').fingerprint = 'changed';
      };
      gitText = root => root + '-commit';
      runGit = (root,args) => {
        calls.push({root,args});
        if (phase === 'after-first-commit' && root === 'repo-a' && args.includes('commit')) live.get('repo-b').fingerprint = 'changed';
      };
    `,ctx);
    assert.throws(() => vm.runInContext('applyCommand({confirmCommit:true})',ctx), /重新 plan/);
    const committed = calls.filter(call => call.args.includes('commit'));
    assert.equal(committed.length, phase === 'after-first-commit' ? 1 : 0);
    assert.equal(calls.some(call => call.root === 'repo-b' && call.args[0] === 'add'), false);
    if (committed.length) {
      assert.equal(vm.runInContext('saved.repositories[0].execution.commit',ctx),'repo-a-commit');
      assert.equal(vm.runInContext('saved.repositories[1].execution.status',ctx),undefined);
    }
  });
}
