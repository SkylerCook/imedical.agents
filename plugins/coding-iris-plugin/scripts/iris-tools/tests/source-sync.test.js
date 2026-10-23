'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const sync = require('../source-sync-core');

function git(root, args) { return execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', windowsHide: true}); }
function fixture(t, {empty = false, ignored = true, source = true} = {}) {
    const base = process.env.CODEX_TEST_TMP_ROOT || os.tmpdir(); fs.mkdirSync(base, {recursive: true});
    const root = fs.mkdtempSync(path.join(base, 'iris-source-sync-'));
    t.after(() => { const resolved = path.resolve(root); assert.ok(resolved.startsWith(path.resolve(base) + path.sep)); fs.rmSync(resolved, {recursive: true, force: true}); });
    git(root, ['init']); git(root, ['config', 'user.name', 'Fixture']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'core.autocrlf', 'false']);
    fs.mkdirSync(path.join(root, '.agents/config'), {recursive: true});
    git(path.join(root, '.agents'), ['init']);
    fs.appendFileSync(path.join(root, '.agents/.git/info/exclude'), '\n/work/\n/config/\n');
    fs.writeFileSync(path.join(root, '.agents/config/project_context_profile.md'), '- contextMode：intent-first-on-demand-export\n');
    fs.writeFileSync(path.join(root, '.agents/config/iris_project_profile.md'), '- 默认需求交付类型：project\n');
    fs.writeFileSync(path.join(root, '.agents/config/project-env.json'), JSON.stringify({iris: {scheme: 'http', host: '127.0.0.1', port: 1, namespace: 'FIXTURE'}, web: {basePath: 'fixture/web', cspBasePath: 'fixture/web/csp'}}));
    fs.writeFileSync(path.join(root, '.gitignore'), ignored ? '.agents/\n' : '.agents/config/\n.agents/.git/\n');
    const file = path.join(root, 'src/Demo/Sample.cls'); fs.mkdirSync(path.dirname(file), {recursive: true});
    const original = 'Class Demo.Sample\n{\n' + Array.from({length: 15}, (_, index) => `Parameter Value${index} = "BASE";`).join('\n') + '\n}\n';
    if (source) fs.writeFileSync(file, original);
    if (!empty) { git(root, ['add', '.gitignore', ...(source ? ['src'] : [])]); git(root, ['commit', '-m', 'chore(fixture): baseline']); }
    const files = ['src/Demo/Sample.cls'];
    const plan = options => sync.createPlan({projectRoot: root, phase: 'before-edit', demand: '123', environmentAlias: 'testing', environmentType: 'test', files, ...options});
    let reads = 0;
    const client = value => ({readDocument: async document => { reads++; return value === null ? null : {document, content: Buffer.from(value), ts: '2026-01-01 00:00:00', representation: 'atelier-text-utf8'}; }});
    const prepare = async (p, value) => sync.prepare(p.planPath, {client: client(value)});
    const count = () => Number(git(root, ['rev-list', '--count', 'HEAD']).trim());
    return {root, file, original, files, plan, prepare, count, reads: () => reads};
}

test('project XML preserves declared types, rejects entities, duplicates and unsupported structures', () => {
    const xml = '<Export><Project name="P"><Items><ProjectItem name="Demo.Sample" type="CLS"/><ProjectItem type="CSP" name="scripts/a.js"></ProjectItem></Items></Project></Export>';
    assert.deepEqual(sync.parseProjectMap(xml), [{name: 'Demo.Sample', type: 'CLS'}, {name: 'scripts/a.js', type: 'CSP'}]);
    assert.throws(() => sync.parseProjectMap('<!DOCTYPE Export SYSTEM "x">' + xml), /unsupported-project-xml/);
    assert.throws(() => sync.parseProjectMap(xml.replace('scripts/a.js', '../a.js')), /unsafe-project-item/);
    assert.throws(() => sync.parseProjectMap(xml.replace('type="CSP"', 'type="PKG"')), /unsupported-project-item/);
    assert.throws(() => sync.parseProjectMap(xml.replace('</Items>', '<ProjectItem name="Demo.Sample" type="CLS"/></Items>')), /duplicate-project-item/);
    const supplied = fs.readFileSync(path.resolve(__dirname, '../../../../..', 'docs/reference/project-export-map/doctor/prj_v9.1.xml'), 'utf8');
    assert.equal(sync.parseProjectMap(supplied).length, 3295);
});

test('plan is local-only and reference candidates do not enter the remote read set', t => {
    const f = fixture(t);
    const p = f.plan({files: [{path: f.files[0], reason: 'changed method'}, {path: 'src/Demo/Reference.cls', tier: 'reference', reason: 'sample only'}]});
    assert.equal(p.state, 'planned'); assert.equal(p.files.length, 1); assert.equal(p.candidates.length, 1); assert.equal(f.reads(), 0);
    assert.equal(fs.existsSync(path.join(f.root, '.agents/work/source-sync/tasks', p.id, 'plan.json')), true);
});

test('unchanged export creates no empty export or demand commit', async t => {
    const f = fixture(t), count = f.count(), p = f.plan();
    await f.prepare(p, f.original);
    const result = sync.apply(p.planPath, {confirmCommit: true});
    assert.equal(result.execution.exportCommit, null); assert.equal(result.execution.demandCommit, null); assert.equal(f.count(), count);
    assert.equal(sync.verify(p.planPath).localVerified, true);
});

test('missing local source is imported in one pure export commit', async t => {
    const f = fixture(t, {source: false}), p = f.plan(); await f.prepare(p, f.original);
    const result = sync.apply(p.planPath, {confirmCommit: true});
    assert.ok(result.execution.exportCommit); assert.equal(result.execution.demandCommit, null);
    assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
    assert.match(git(f.root, ['log', '-1', '--format=%B']), /^export\(/);
    assert.equal(git(f.root, ['status', '--porcelain']).trim(), '');
});

test('stale local source without a confirmed server baseline stops without overwriting it', async t => {
    const f = fixture(t), p = f.plan(), remote = f.original.replace('Value0 = "BASE"', 'Value0 = "SERVER"');
    await f.prepare(p, remote);
    assert.throws(() => sync.apply(p.planPath, {confirmCommit: true}), /baseline-confirmation-required/);
    assert.equal(fs.readFileSync(f.file, 'utf8'), f.original); assert.equal(f.count(), 1);
});

test('three-way sync preserves unrelated staged work and commits server baseline before demand', async t => {
    const f = fixture(t), first = f.plan(); await f.prepare(first, f.original); sync.apply(first.planPath, {confirmCommit: true});
    const unrelated = path.join(f.root, 'other.txt'); fs.writeFileSync(unrelated, 'parallel staged\n'); git(f.root, ['add', 'other.txt']);
    const staged = git(f.root, ['diff', '--cached', '--binary', '--', 'other.txt']);
    fs.writeFileSync(path.join(f.root, 'parallel-untracked.txt'), 'keep');
    const local = f.original.replace('Value0 = "BASE"', 'Value0 = "DEMAND"'); fs.writeFileSync(f.file, local);
    const remote = f.original.replace('Value14 = "BASE"', 'Value14 = "SERVER"');
    const p = f.plan({phase: 'pre-deploy'}); await f.prepare(p, remote);
    const result = sync.apply(p.planPath, {confirmCommit: true, title: '保留需求修改', modification: '合并独立服务器修改。'});
    assert.equal(result.state, 'review-pending'); assert.ok(result.execution.exportCommit); assert.ok(result.execution.demandCommit);
    assert.equal(git(f.root, ['show', `${result.execution.exportCommit}:src/Demo/Sample.cls`]), remote);
    const actual = fs.readFileSync(f.file, 'utf8'); assert.match(actual, /DEMAND/); assert.match(actual, /SERVER/);
    assert.equal(git(f.root, ['diff', '--cached', '--binary', '--', 'other.txt']), staged);
    assert.equal(fs.readFileSync(path.join(f.root, 'parallel-untracked.txt'), 'utf8'), 'keep');
    assert.equal(sync.verify(p.planPath).localVerified, true);
});

test('unchanged server baseline is not re-export-committed over an already committed demand', async t => {
    const f = fixture(t), first = f.plan(); await f.prepare(first, f.original); sync.apply(first.planPath, {confirmCommit: true});
    fs.writeFileSync(f.file, f.original.replace('Value0 = "BASE"', 'Value0 = "DEMAND"'));
    git(f.root, ['add', f.files[0]]); git(f.root, ['commit', '-m', 'feat(123): existing demand']);
    const before = f.count(), p = f.plan({phase: 'pre-deploy'}); await f.prepare(p, f.original);
    const result = sync.apply(p.planPath, {confirmCommit: true});
    assert.equal(result.execution.exportCommit, null); assert.equal(result.execution.demandCommit, null); assert.equal(f.count(), before);
    assert.match(fs.readFileSync(f.file, 'utf8'), /DEMAND/);
});

test('new untracked task file is committed without staging unrelated files', async t => {
    const f = fixture(t), baselineRef = git(f.root, ['rev-parse', 'HEAD']).trim();
    const newFile = path.join(f.root, 'src/Demo/New.cls'); fs.writeFileSync(newFile, 'Class Demo.New\n{\n}\n');
    fs.writeFileSync(path.join(f.root, 'unrelated.txt'), 'do not commit');
    const p = f.plan({files: ['src/Demo/New.cls'], baselineRef, phase: 'pre-deploy'}); await f.prepare(p, null);
    const result = sync.apply(p.planPath, {confirmCommit: true});
    assert.equal(result.execution.exportCommit, null); assert.ok(result.execution.demandCommit);
    assert.match(git(f.root, ['status', '--porcelain']), /\?\? unrelated.txt/);
    assert.equal(git(f.root, ['show', '--pretty=format:', '--name-only', 'HEAD']).trim(), 'src/Demo/New.cls');
});

test('conflict keeps user source and index untouched until private resolution is supplied', async t => {
    const f = fixture(t), first = f.plan(); await f.prepare(first, f.original); sync.apply(first.planPath, {confirmCommit: true});
    const local = f.original.replace('Value0 = "BASE"', 'Value0 = "DEMAND"'); fs.writeFileSync(f.file, local);
    const before = git(f.root, ['rev-parse', 'HEAD']), p = f.plan();
    await f.prepare(p, f.original.replace('Value0 = "BASE"', 'Value0 = "SERVER"'));
    const conflict = sync.apply(p.planPath, {confirmCommit: true});
    assert.equal(conflict.state, 'needs-user-input'); assert.equal(fs.readFileSync(f.file, 'utf8'), local); assert.equal(git(f.root, ['rev-parse', 'HEAD']), before);
    fs.writeFileSync(conflict.files[0].resolutionPath, local.replace('DEMAND', 'COMBINED'));
    const resolved = sync.apply(p.planPath, {confirmCommit: true, continue: true});
    assert.equal(resolved.state, 'change-committed'); assert.match(fs.readFileSync(f.file, 'utf8'), /COMBINED/);
});

test('external task or index changes invalidate a prepared plan', async t => {
    const f = fixture(t), p = f.plan(); await f.prepare(p, f.original);
    fs.writeFileSync(f.file, f.original + '// other editor\n');
    assert.throws(() => sync.apply(p.planPath, {confirmCommit: true}), /repository-drift/);
    assert.equal(f.count(), 1);
});

test('unignored private state and missing commit authorization fail closed', async t => {
    const unsafe = fixture(t, {ignored: false}); assert.throws(() => unsafe.plan(), /private-state-not-ignored/);
    const f = fixture(t), p = f.plan(); await f.prepare(p, f.original);
    assert.throws(() => sync.apply(p.planPath), /commit-authorization-required/);
});

test('initial baseline with only confirmed missing files does not force a commit', async t => {
    const f = fixture(t, {empty: true, source: false}), p = f.plan({phase: 'initial-baseline'}); await f.prepare(p, null);
    const result = sync.apply(p.planPath, {confirmCommit: true});
    assert.equal(result.execution.exportCommit, null); assert.equal(result.execution.demandCommit, null); assert.equal(sync.head(f.root), null);
});

test('bulk initialization needs explicit license evidence before any remote reads', async t => {
    const f = fixture(t), files = Array.from({length: 6}, (_, i) => `src/Demo/Other${i}.cls`);
    const p = f.plan({phase: 'initial-baseline', files});
    await assert.rejects(f.prepare(p, f.original), /bulk-license-qualification-required/); assert.equal(f.reads(), 0);
});

test('review binds a committed pre-deploy plan and does not grant production approval', async t => {
    const f = fixture(t), p = f.plan({phase: 'pre-deploy'}); await f.prepare(p, f.original); sync.apply(p.planPath, {confirmCommit: true});
    assert.throws(() => sync.review(p.planPath, {confirmReview: true}), /source-review-required/);
    const reviewed = sync.review(p.planPath, {confirmReview: true, evidence: 'local-review:fixture'});
    assert.equal(reviewed.state, 'ready-to-publish'); assert.equal(reviewed.publication.head, sync.head(f.root));
    assert.equal(reviewed.publication.files[0].remoteSha256, sync.hash(Buffer.from(f.original)));
});

test('Atelier backend line normalization does not force a baseline commit', async t => {
    const f = fixture(t), crlf = '\uFEFF' + f.original.replace(/\n/g, '\r\n');
    fs.writeFileSync(f.file, crlf); git(f.root, ['add', f.files[0]]); git(f.root, ['commit', '-m', 'chore(fixture): CRLF']);
    const before = f.count(), p = f.plan(); await f.prepare(p, f.original);
    const result = sync.apply(p.planPath, {confirmCommit: true});
    assert.equal(result.execution.exportCommit, null); assert.equal(f.count(), before); assert.equal(fs.readFileSync(f.file, 'utf8'), crlf);
});

test('interrupted reads reobserve the entire task slice before accepting it', async t => {
    const f = fixture(t), paths = [...f.files, 'src/Demo/Other.cls'];
    const p = f.plan({files: paths}); let first = 0;
    await assert.rejects(sync.prepare(p.planPath, {client: {readDocument: async () => { if (++first === 2) throw Error('fixture stop'); return {content: Buffer.from(f.original)}; }}}));
    const observed = [];
    await sync.prepare(p.planPath, {client: {readDocument: async document => { observed.push(document); return {content: Buffer.from(document === 'Demo.Other.cls' ? f.original.replace('Demo.Sample', 'Demo.Other') : f.original)}; }}});
    assert.deepEqual(observed, ['Demo.Sample.cls', 'Demo.Other.cls']);
});
test('a document with a mismatched backend declaration never becomes a baseline', async t => {
    const f = fixture(t), p = f.plan();
    await assert.rejects(f.prepare(p, f.original.replace('Demo.Sample', 'Demo.Unexpected')), /remote-document-identity-mismatch/);
    assert.equal(sync.load(p.planPath).plan.state, 'read-blocked'); assert.equal(f.count(), 1); assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
});

test('failed Git hook preserves the server snapshot and continues without empty export commits', async t => {
    const f = fixture(t), p = f.plan({baselineRef: sync.head(f.root)}), remote = f.original.replace('Value14 = "BASE"', 'Value14 = "SERVER"');
    await f.prepare(p, remote);
    const hooks = path.join(f.root, '.git/hooks'); git(f.root, ['config', 'core.hooksPath', hooks]);
    const hook = path.join(hooks, 'pre-commit'); fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', {mode: 0o755});
    assert.throws(() => sync.apply(p.planPath, {confirmCommit: true}), /git-operation-failed/);
    assert.equal(sync.load(p.planPath).plan.state, 'failed-or-unknown'); fs.unlinkSync(hook);
    const result = sync.apply(p.planPath, {confirmCommit: true, continue: true});
    assert.ok(result.execution.exportCommit); assert.equal(result.execution.demandCommit, null); assert.equal(f.count(), 2);
    const again = f.plan(); assert.equal(again.files[0].base.sha256, sync.hash(Buffer.from(remote)));
});

test('test and production use independent local Git and rollback appends history', async t => {
    const dev = fixture(t), prd = fixture(t), old = sync.head(prd.root);
    fs.writeFileSync(prd.file, prd.original.replace('BASE', 'RELEASE')); git(prd.root, ['add', prd.files[0]]); git(prd.root, ['commit', '-m', 'feat(123): release']);
    fs.writeFileSync(path.join(prd.root, 'parallel.txt'), 'parallel'); git(prd.root, ['add', 'parallel.txt']);
    const index = git(prd.root, ['diff', '--cached', '--binary']);
    const p = sync.createRollbackPlan({projectRoot: prd.root, demand: '123', environmentAlias: 'production', environmentType: 'production', files: prd.files, to: old});
    const result = sync.rollbackLocal(p.planPath, {confirmCommit: true});
    assert.equal(result.requiresNewPlan, true); assert.equal(prd.count(), 3); assert.equal(dev.count(), 1);
    assert.equal(fs.readFileSync(prd.file, 'utf8'), prd.original); assert.equal(git(prd.root, ['diff', '--cached', '--binary']), index);
    assert.match(git(prd.root, ['log', '-1', '--format=%B']), /Rollback-Of:/);
    assert.equal(sync.initialize({projectRoot: dev.root, confirmLocalGit: true}).remoteCreated, false);
});

async function storageFixture(t, {mixed = false, frontendDone = false} = {}) {
    const f = fixture(t); let files = f.files;
    if (mixed) { const script = path.join(f.root, 'scripts/a.js'); fs.mkdirSync(path.dirname(script), {recursive: true}); fs.writeFileSync(script, 'console.log("fixture");\n'); git(f.root, ['add', 'scripts/a.js']); git(f.root, ['commit', '-m', 'chore(fixture): frontend']); files = [...files, 'scripts/a.js']; }
    const p = f.plan({phase: 'pre-deploy', files});
    await sync.prepare(p.planPath, {client: {readDocument: async document => ({content: fs.readFileSync(document.endsWith('.cls') ? f.file : path.join(f.root, 'scripts/a.js'))})}});
    sync.apply(p.planPath, {confirmCommit: true}); const reviewed = sync.review(p.planPath, {confirmReview: true, evidence: 'fixture review'});
    const compiled = f.original.replace(/\}\n$/, 'Storage Default\n{\n<Data name="fixture"/>\n}\n}\n'); fs.writeFileSync(f.file, compiled);
    const entry = file => ({file: file.document, document: file.document, localSha256: sync.hash(fs.readFileSync(file.sourcePath)), postCompileSha256: sync.hash(fs.readFileSync(file.sourcePath)), storageSynced: file.kind === 'backend'});
    reviewed.state = 'post-compile-review'; reviewed.deployment = {status: 'post-compile-review', files: [entry(reviewed.publication.files.find(file => file.kind === 'backend'))]};
    if (frontendDone) reviewed.deploymentGroups = {frontend: {status: 'verified', files: [entry(reviewed.publication.files.find(file => file.kind === 'frontend'))]}};
    sync.save(reviewed);
    const client = {readDocument: async document => ({content: Buffer.from(document.endsWith('.cls') ? compiled : 'console.log("fixture");\n')})};
    return {...f, p, compiled, client};
}

test('Storage finish commits verified bytes and preserves the full mixed scope', async t => {
    const f = await storageFixture(t, {mixed: true, frontendDone: true}), before = f.count();
    const result = await sync.finish(f.p.planPath, {client: f.client, confirmCommit: true, confirmReview: true, evidence: 'Storage reviewed'});
    assert.equal(result.state, 'verified'); assert.equal(result.files.length, 2); assert.equal(f.count(), before + 1);
    assert.equal(sync.verify(f.p.planPath).localVerified, true); assert.equal(git(f.root, ['status', '--porcelain']).trim(), '');
});

test('Storage finish closes a partial publication and requires a new plan for the rest', async t => {
    const f = await storageFixture(t, {mixed: true});
    const result = await sync.finish(f.p.planPath, {client: f.client, confirmCommit: true, confirmReview: true, evidence: 'Storage reviewed'});
    assert.equal(result.state, 'closed'); assert.equal(result.files.length, 2); assert.deepEqual(result.remainingKinds, ['frontend']); assert.equal(result.requiresNewPlan, true);
});

test('Storage finish rejects local drift while awaiting remote evidence', async t => {
    const f = await storageFixture(t), before = f.count();
    await assert.rejects(sync.finish(f.p.planPath, {client: {readDocument: async () => { fs.writeFileSync(f.file, f.compiled + '// another editor\n'); return {content: Buffer.from(f.compiled)}; }}, confirmCommit: true, confirmReview: true, evidence: 'Storage reviewed'}), /repository-drift/);
    assert.equal(f.count(), before);
});

test('Storage finish can continue after a hook failure without redeploying', async t => {
    const f = await storageFixture(t), hooks = path.join(f.root, '.git/hooks'); git(f.root, ['config', 'core.hooksPath', hooks]);
    const hook = path.join(hooks, 'pre-commit'); fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', {mode: 0o755});
    const options = {client: f.client, confirmCommit: true, confirmReview: true, evidence: 'Storage reviewed'};
    await assert.rejects(sync.finish(f.p.planPath, options), /git-operation-failed/); fs.unlinkSync(hook);
    const result = await sync.finish(f.p.planPath, {...options, continue: true}); assert.equal(result.state, 'verified');
});

test('demand kind is an independent branch and is never inferred from source context mode', t => {
    const f = fixture(t), profile = path.join(f.root, '.agents/config/iris_project_profile.md');
    fs.writeFileSync(profile, '- 默认需求交付类型：standard\n');
    assert.throws(() => f.plan(), /source-sync-project-demand-required/);
    assert.equal(f.plan({kind: 'project'}).demandKindSource, 'explicit-task');
    fs.writeFileSync(profile, '- 默认需求交付类型：TODO\n');
    assert.throws(() => f.plan(), /explicit-demand-kind-required/);
    assert.equal(sync.demandKind(sync.contextFor(f.root), {kind: 'standard'}).kind, 'standard');
});

test('refresh replays already committed independent demands in order before the working delta', async t => {
    const f = fixture(t), baseline = f.plan(); await f.prepare(baseline, f.original); sync.apply(baseline.planPath, {confirmCommit: true});
    let local = f.original.replace('Value0 = "BASE"', 'Value0 = "DEMAND_A"');
    fs.writeFileSync(f.file, local); git(f.root, ['add', f.files[0]]); git(f.root, ['commit', '-m', 'feat(101):需求A']); const sourceA = sync.head(f.root);
    local = local.replace('Value7 = "BASE"', 'Value7 = "DEMAND_B"'); fs.writeFileSync(f.file, local); git(f.root, ['add', f.files[0]]); git(f.root, ['commit', '-m', 'feat(102):需求B']); const sourceB = sync.head(f.root);
    fs.writeFileSync(f.file, local.replace('Value4 = "BASE"', 'Value4 = "CURRENT"'));
    const p = f.plan({phase: 'pre-deploy', demand: '103'}); await f.prepare(p, f.original.replace('Value14 = "BASE"', 'Value14 = "SERVER"'));
    const result = sync.apply(p.planPath, {confirmCommit: true, title: '当前需求'});
    assert.equal(result.replaySteps.length, 2); assert.equal(result.replaySteps[0].source, sourceA); assert.equal(result.replaySteps[1].source, sourceB);
    const first = git(f.root, ['show', `${result.replaySteps[0].commit}:${f.files[0]}`]); assert.match(first, /DEMAND_A/); assert.match(first, /SERVER/); assert.doesNotMatch(first, /DEMAND_B|CURRENT/);
    const second = git(f.root, ['show', `${result.replaySteps[1].commit}:${f.files[0]}`]); assert.match(second, /DEMAND_A/); assert.match(second, /DEMAND_B/); assert.doesNotMatch(second, /CURRENT/);
    const subjects = git(f.root, ['log', '-4', '--format=%s']).trim().split('\n'); assert.match(subjects[0], /^feat\(103\)/); assert.match(subjects[1], /^feat\(102\)/); assert.match(subjects[2], /^feat\(101\)/); assert.match(subjects[3], /^export\(/);
    assert.equal(sync.verify(p.planPath).localVerified, true);
});

test('committed-demand replay conflict is resolved privately before any baseline write', async t => {
    const f = fixture(t), baseline = f.plan(); await f.prepare(baseline, f.original); sync.apply(baseline.planPath, {confirmCommit: true});
    const local = f.original.replace('Value0 = "BASE"', 'Value0 = "DEMAND_A"'); fs.writeFileSync(f.file, local); git(f.root, ['add', f.files[0]]); git(f.root, ['commit', '-m', 'feat(101):需求A']);
    const before = sync.head(f.root), p = f.plan(); await f.prepare(p, f.original.replace('Value0 = "BASE"', 'Value0 = "SERVER"'));
    const result = sync.apply(p.planPath, {confirmCommit: true}); assert.equal(result.state, 'needs-user-input'); assert.equal(sync.head(f.root), before); assert.equal(fs.readFileSync(f.file, 'utf8'), local);
    fs.writeFileSync(result.replayConflict.resolutionPath, local.replace('DEMAND_A', 'REVIEWED_COMBINED'));
    const continued = sync.apply(p.planPath, {confirmCommit: true, continue: true}); assert.equal(continued.state, 'change-committed'); assert.match(fs.readFileSync(f.file, 'utf8'), /REVIEWED_COMBINED/);
});
