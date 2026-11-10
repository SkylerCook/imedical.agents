'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const sync = require('../source-sync-core');
const {createTempDirectory} = require('../../../../../scripts/tests/fixtures/temp-directory');

function fixture(t) {
    const root = createTempDirectory('iris-transaction-test-');
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', windowsHide: true}).trimEnd();
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'core.autocrlf', 'false');
    const file = {path: 'Demo.cls', gitPath: 'Demo.cls', sourcePath: path.join(root, 'Demo.cls'), kind: 'backend', mode: '100644'};
    const original = 'Class Demo\n{\nParameter Value = "BASE";\n}\n'; fs.writeFileSync(file.sourcePath, original);
    git('add', 'Demo.cls'); git('commit', '-m', 'chore(fixture): baseline'); const baseline = sync.head(root);
    const directory = path.join(root, 'state'); fs.mkdirSync(directory);
    const changed = original.replace('BASE', 'LOCAL');
    const plan = (step = 'change-commit') => ({gitRoot: root, files: [file], planPath: path.join(directory, 'plan.json'),
        expected: sync.repositorySnapshot(root, [file]), execution: {step}});
    return {root, file, original, changed, baseline, git, plan, count: () => Number(git('rev-list', '--count', 'HEAD'))};
}
test('scoped commit detects external HEAD movement at the final pre-commit boundary', t => {
    const f = fixture(t); fs.writeFileSync(f.file.sourcePath, f.changed); const p = f.plan(); let moved = false;
    assert.throws(() => sync.scopedCommit(p, p.files, 'feat(123): local\n\n修改说明: fixture', value => {
        if (value.execution.pendingCommit && !moved) {moved = true; f.git('commit', '--allow-empty', '-m', 'chore(parallel): external');}
    }), /repository-drift/);
    assert.equal(f.count(), 2); assert.equal(f.git('show', '-s', '--format=%s'), 'chore(parallel): external');
    assert.equal(fs.readFileSync(f.file.sourcePath, 'utf8'), f.changed);
});
test('scoped commit keeps real hooks and rejects a hook that changes the staged tree', t => {
    const f = fixture(t), hooks = path.join(f.root, '.git/hooks'); f.git('config', 'core.hooksPath', hooks);
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nprintf hook > hook.txt\ngit add hook.txt\n', {mode: 0o755});
    fs.writeFileSync(f.file.sourcePath, f.changed); const p = f.plan();
    assert.throws(() => sync.scopedCommit(p, p.files, 'feat(123): local\n\n修改说明: fixture', () => {}), /commit-hook-changed-tree/);
    assert.ok(p.execution.pendingCommit); assert.equal(fs.readFileSync(path.join(f.root, 'hook.txt'), 'utf8'), 'hook');
});
test('successful commit attribution survives persistence interruption and owned replay recovery advances once', t => {
    for (const step of ['baseline-commit', 'change-commit', 'storage-commit', 'rollback-commit', 'replay-commit']) {
        const f = fixture(t); fs.writeFileSync(f.file.sourcePath, f.changed); const p = f.plan(step);
        if (step === 'replay-commit') {p.replaySteps = [{source: 'fixture'}]; p.execution.replayIndex = 0;}
        let persisted;
        assert.throws(() => sync.scopedCommit(p, p.files, 'feat(123): local\n\n修改说明: fixture', value => {
            if (value.expected.head !== f.baseline) throw Error('injected-persistence-interruption');
            persisted = structuredClone(value);
        }), /injected-persistence-interruption/);
        assert.equal(f.count(), 2); const committed = sync.head(f.root);
        if (step === 'baseline-commit') assert.equal(p.execution.exportCommit, committed);
        else if (step === 'storage-commit') assert.equal(p.finalCommit, committed);
        else if (step === 'replay-commit') assert.equal(p.replaySteps[0].commit, committed);
        else assert.equal(p.execution.demandCommit, committed);
        sync.recoverPending(persisted, () => {});
        assert.equal(persisted.expected.head, committed); assert.equal(f.count(), 2);
        if (step === 'replay-commit') {assert.equal(persisted.execution.replayIndex, 1); assert.equal(persisted.execution.step, 'change-writing'); assert.equal(persisted.replaySteps[0].commit, committed);}
    }
});
test('index intent recovery accepts both before-write and after-write states while preserving foreign staging', t => {
    for (const applied of [false, true]) {
        const f = fixture(t); fs.writeFileSync(path.join(f.root, 'parallel.txt'), 'keep\n'); f.git('add', 'parallel.txt');
        fs.writeFileSync(f.file.sourcePath, f.changed); const p = f.plan(); sync.scopedCommit(p, p.files, 'feat(123): local\n\n修改说明: fixture', () => {});
        const entry = f.git('ls-tree', 'HEAD', '--', f.file.gitPath);
        const outside = f.git('ls-files', '--stage', '-v', '-z').split('\0').filter(item => item && item.slice(item.indexOf('\t') + 1) !== f.file.gitPath).join('\0');
        p.execution.pendingIndex = {gitPath: f.file.gitPath, entry, outsideHash: sync.hash(outside)};
        if (applied) {const match = entry.match(/^(\d+) blob ([a-f0-9]+)\t/); f.git('update-index', '--add', '--cacheinfo', match[1], match[2], f.file.gitPath);}
        sync.recoverPending(p, () => {}); sync.restoreTaskIndex(p, () => {});
        assert.equal(f.git('diff', '--cached', '--name-only'), 'parallel.txt'); assert.equal(p.execution.pendingIndex, null);
    }
});
test('source byte filters stop before committing instead of leaving an unpublishable raw blob', t => {
    const f = fixture(t); f.git('config', 'core.autocrlf', 'true');
    fs.writeFileSync(f.file.sourcePath, f.changed.replace(/\n/g, '\r\n')); const p = f.plan();
    p.files[0].kind = 'frontend';
    assert.throws(() => sync.scopedCommit(p, p.files, 'feat(123): local\n\n修改说明: fixture', () => {}), /git-source-filter-conflict/);
    assert.equal(f.count(), 1);
});
test('backend permits Git newline cleanup only within the declared canonical source representation', t => {
    const f = fixture(t); f.git('config', 'core.autocrlf', 'true');
    const local = f.changed.replace(/\n/g, '\r\n'); fs.writeFileSync(f.file.sourcePath, local); const p = f.plan();
    sync.scopedCommit(p, p.files, 'feat(123): local\n\n修改说明: fixture', () => {}); sync.restoreTaskIndex(p, () => {});
    assert.equal(f.count(), 2); assert.equal(fs.readFileSync(f.file.sourcePath, 'utf8'), local);
    assert.equal(f.git('status', '--porcelain', '--', f.file.gitPath), '');
    assert.equal(f.git('show', 'HEAD:Demo.cls') + '\n', f.changed);
});
test('rollback continues after an interrupted write and a rejected commit without losing other staging', async t => {
    const f = fixture(t), other = {...f.file, path: 'Other.cls', gitPath: 'Other.cls', sourcePath: path.join(f.root, 'Other.cls')};
    fs.writeFileSync(other.sourcePath, f.original.replace('Demo', 'Other')); f.git('add', 'Other.cls'); f.git('commit', '-m', 'chore(fixture): second class');
    const baseline = sync.head(f.root); fs.writeFileSync(f.file.sourcePath, f.changed); fs.writeFileSync(other.sourcePath, f.changed.replace('Demo', 'Other')); f.git('add', 'Demo.cls', 'Other.cls'); f.git('commit', '-m', 'feat(123): existing');
    fs.writeFileSync(path.join(f.root, '.gitignore'), '.agents/\nstate/\n'); f.git('add', '.gitignore'); f.git('commit', '-m', 'chore(fixture): privacy');
    fs.mkdirSync(path.join(f.root, '.agents/config'), {recursive: true}); f.git('-C', path.join(f.root, '.agents'), 'init');
    fs.appendFileSync(path.join(f.root, '.agents/.git/info/exclude'), '\n/work/\n/config/\n'); fs.writeFileSync(path.join(f.root, '.agents/config/project-env.json'), '{}');
    fs.writeFileSync(path.join(f.root, 'parallel.txt'), 'keep\n'); f.git('add', 'parallel.txt');
    const plan = sync.createRollbackPlan({projectRoot: f.root, kind: 'project', demand: '123', environmentAlias: 'fixture', environmentType: 'test', to: baseline, files: [f.file.path, other.path]});
    const rename = fs.renameSync; let interrupted = false;
    const mock = t.mock.method(fs, 'renameSync', (source, target) => {if (target === other.sourcePath && !interrupted) {interrupted = true; throw Object.assign(Error('injected'), {code: 'EIO'});} return rename(source, target);});
    assert.throws(() => sync.rollbackLocal(plan.planPath, {confirmCommit: true}), /injected/); mock.mock.restore();
    assert.equal(sync.load(plan.planPath).plan.state, 'failed-or-unknown'); assert.equal(fs.readFileSync(f.file.sourcePath, 'utf8'), f.original);
    const hooks = path.join(f.root, '.git/hooks'), hook = path.join(hooks, 'pre-commit'); f.git('config', 'core.hooksPath', hooks); fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', {mode: 0o755});
    assert.throws(() => sync.rollbackLocal(plan.planPath, {confirmCommit: true, continue: true}), /git-operation-failed/); fs.unlinkSync(hook);
    const count = f.count(); const result = sync.rollbackLocal(plan.planPath, {confirmCommit: true, continue: true});
    assert.equal(result.state, 'change-committed'); assert.equal(f.count(), count + 1);
    assert.equal(f.git('diff', '--cached', '--name-only'), 'parallel.txt'); assert.equal(fs.readFileSync(other.sourcePath, 'utf8'), f.original.replace('Demo', 'Other'));
});
