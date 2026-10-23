'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const toolRoot = path.resolve(__dirname, '..');
const exportScript = path.join(toolRoot, 'export.js');
const promoteScript = path.join(toolRoot, 'promote-demand.js');
const workspaceContextScript = path.resolve(toolRoot, '..', '..', '..', '..', 'scripts', 'lib', 'workspace-context.js');
const promote = require('../promote-demand');
const temporaryRoots = new Set();
function temporary(prefix) {
    const root = fs.mkdtempSync(path.join(process.env.CODEX_TEST_TMPDIR || os.tmpdir(), prefix));
    temporaryRoots.add(root);
    return root;
}
test.after(() => { for (const root of temporaryRoots) fs.rmSync(root, {recursive: true, force: true}); });

test('frontend classification is restricted to configured src/imedical/web root', () => {
    assert.equal(promote.classifyFile('src/imedical/web/scripts/a.js', 'src/imedical/web').kind, 'frontend');
    assert.equal(promote.classifyFile('src/imedical/web/csp/a.csp', 'src/imedical/web').document, 'imedical/web/csp/a.csp');
    assert.equal(promote.classifyFile('src/imedical/web/styles/a.css', 'src/imedical/web').extension, '.css');
    assert.throws(() => promote.classifyFile('src/other/a.js', 'src/imedical/web'));
    assert.throws(() => promote.classifyFile('src/imedical/web/a.html', 'src/imedical/web'));
    assert.equal(promote.containsDemand('feat(7218962): test', '7218962'), true);
    assert.equal(promote.containsDemand('feat(172189620): test', '7218962'), false);
    assert.deepEqual(promote.declaredDemandIds('fix(123,456):修复123；修复456'), ['123', '456']);
    assert.deepEqual(promote.declaredDemandIds('fix(123，456): test'), ['123', '456']);
    assert.deepEqual(promote.declaredDemandIds('fix(core): contains 123 and 456'), []);
});

test('plan directories are isolated for same-named repositories', () => {
    const first = promote.buildPlanDirectory({
        demand: '7654300',
        devRoot: path.join(os.tmpdir(), 'hospital-a', 'DEV'),
        prdRoot: path.join(os.tmpdir(), 'hospital-a', 'PRD')
    });
    const second = promote.buildPlanDirectory({
        demand: '7654300',
        devRoot: path.join(os.tmpdir(), 'hospital-b', 'DEV'),
        prdRoot: path.join(os.tmpdir(), 'hospital-b', 'PRD')
    });
    assert.notEqual(first, second);
    assert.match(first, /PRD-[a-f0-9]{12}/i);
    assert.match(second, /PRD-[a-f0-9]{12}/i);
});

test('export.js probes CSS and stages CSP through Atelier API', async t => {
    const fixture = createWorkspaceFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const server = await createAtelierServer(doc => doc.endsWith('/missing.css') ? null : `content:${doc}`);
    t.after(() => server.close());
    writeProjectConfig(fixture.root, server.port);

    const css = await runNode(exportScript, ['styles/app.css', '--probe', '--json'], fixture.root);
    assert.equal(css.code, 0, css.stderr + css.stdout);
    const cssResult = lastJson(css.stdout);
    assert.equal(cssResult.status, 'found');
    assert.equal(cssResult.type, 'CSS');
    assert.equal(cssResult.document, 'imedical/web/styles/app.css');

    const staging = path.join(fixture.root, 'staging');
    const csp = await runNode(exportScript, ['page.csp', '--json', '--staging-dir', staging], fixture.root);
    assert.equal(csp.code, 0, csp.stderr);
    const cspResult = lastJson(csp.stdout);
    assert.equal(cspResult.status, 'exported');
    assert.equal(fs.readFileSync(cspResult.path, 'utf8'), 'content:imedical/web/csp/page.csp');

    const missing = await runNode(exportScript, ['styles/missing.css', '--probe', '--json'], fixture.root);
    assert.equal(missing.code, 3);
    assert.equal(lastJson(missing.stdout).status, 'not-found');
});

test('end-to-end promotion exports a PRD-local-missing baseline and applies the DEV patch', async t => {
    const fixture = createPromotionFixture('7654321');
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const server = await createAtelierServer(doc => doc === 'Demo.Sample.cls' ? 'Class Demo.Sample\n{\nParameter Value = "BASE";\n}\n' : null);
    t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);

    const planned = await runNode(promoteScript, ['plan', '--demand', '7654321', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    assert.equal(plan.status, 'planned');
    assert.equal(plan.files[0].sourceState, 'M');
    assert.equal(plan.files[0].remote.status, 'found');
    assert.equal(fs.existsSync(path.join(fixture.prd, 'src', 'Demo', 'Sample.cls')), false);

    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev);
    assert.equal(applied.code, 0, applied.stderr);
    const finalPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    assert.equal(finalPlan.status, 'verified');
    assert.match(git(fixture.prd, ['log', '-1', '--format=%B']), /Dev-Commit:/);
    assert.match(fs.readFileSync(path.join(fixture.prd, 'src', 'Demo', 'Sample.cls'), 'utf8'), /DEV/);
    assert.equal(git(fixture.prd, ['status', '--porcelain']).trim(), '');
});

test('PRD local existing file is refreshed and committed before the demand patch', async t => {
    const fixture = createPromotionFixture('7654328');
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const localFile = path.join(fixture.prd, 'src', 'Demo', 'Sample.cls');
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    fs.writeFileSync(localFile, 'Class Demo.Sample\n{\nParameter Value = "LOCAL-STALE";\n}\n');
    git(fixture.prd, ['add', '.']);
    git(fixture.prd, ['commit', '-m', 'export(old): local stale baseline']);

    const serverContent = 'Class Demo.Sample\n{\nParameter Value = "BASE";\n}\n';
    const server = await createAtelierServer(doc => doc === 'Demo.Sample.cls' ? serverContent : null);
    t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);

    const planned = await runNode(promoteScript, ['plan', '--demand', '7654328', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev);
    assert.equal(applied.code, 0, applied.stderr);

    const finalPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    assert.ok(finalPlan.execution.exportCommit);
    assert.ok(finalPlan.execution.demandCommit);
    const subjects = git(fixture.prd, ['log', '-2', '--format=%s']).trim().split(/\r?\n/);
    assert.match(subjects[0], /^feat\(7654328\):/);
    assert.match(subjects[1], /^export\(127\.0\.0\.1\):从服务器同步最新文件$/);
    const exportedBaseline = git(fixture.prd, ['show', `${finalPlan.execution.exportCommit}:src/Demo/Sample.cls`]);
    assert.match(exportedBaseline, /Value = "BASE"/);
    const finalContent = fs.readFileSync(localFile, 'utf8');
    assert.match(finalContent, /Value = "DEV"/);
    assert.equal(git(fixture.prd, ['status', '--porcelain']).trim(), '');
});

test('identical PRD local and server baselines do not create an export commit', async t => {
    const fixture = createPromotionFixture('7654329');
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const localFile = path.join(fixture.prd, 'src', 'Demo', 'Sample.cls');
    const baseline = 'Class Demo.Sample\n{\nParameter Value = "BASE";\n}\n';
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    fs.writeFileSync(localFile, baseline);
    git(fixture.prd, ['add', '.']);
    git(fixture.prd, ['commit', '-m', 'export(current): current baseline']);
    const originalPrdHead = git(fixture.prd, ['rev-parse', 'HEAD']).trim();

    const server = await createAtelierServer(doc => doc === 'Demo.Sample.cls' ? baseline : null);
    t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);

    const planned = await runNode(promoteScript, ['plan', '--demand', '7654329', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev);
    assert.equal(applied.code, 0, applied.stderr);

    const finalPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    assert.equal(finalPlan.execution.exportCommit, undefined);
    assert.equal(git(fixture.prd, ['rev-parse', `${finalPlan.execution.demandCommit}^`]).trim(), originalPrdHead);
    assert.equal(git(fixture.prd, ['status', '--porcelain']).trim(), '');
});

test('separate sequential demands preserve an undeployed prior demand on a shared file', async t => {
    const fixture = createSequentialPromotionFixture('7654330', '7654331');
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const baseline = 'Class Demo.Shared\n{\nParameter Base = 1;\n}\n';
    const server = await createAtelierServer(doc => doc === 'Demo.Shared.cls' ? baseline : null);
    t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);

    const firstPlanned = await runNode(promoteScript, ['plan', '--demand', '7654330', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(firstPlanned.code, 0, firstPlanned.stderr);
    const firstPlanPath = firstPlanned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const firstApplied = await runNode(promoteScript, ['apply', '--plan', firstPlanPath], fixture.dev);
    assert.equal(firstApplied.code, 0, firstApplied.stderr);

    const secondPlanned = await runNode(promoteScript, ['plan', '--demand', '7654331', '--dev-root', fixture.dev, '--prd-root', fixture.prd, '--prior-plan', firstPlanPath], fixture.dev);
    assert.equal(secondPlanned.code, 0, secondPlanned.stderr);
    const secondPlanPath = secondPlanned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const secondPlan = JSON.parse(fs.readFileSync(secondPlanPath, 'utf8'));
    assert.equal(secondPlan.files[0].preserveLocalBaseline, true);
    const secondApplied = await runNode(promoteScript, ['apply', '--plan', secondPlanPath], fixture.dev);
    assert.equal(secondApplied.code, 0, secondApplied.stderr);

    const finalPlan = JSON.parse(fs.readFileSync(secondPlanPath, 'utf8'));
    assert.equal(finalPlan.execution.exportCommit, undefined);
    const finalContent = fs.readFileSync(path.join(fixture.prd, 'src', 'Demo', 'Shared.cls'), 'utf8');
    assert.match(finalContent, /Parameter First = 1/);
    assert.match(finalContent, /Parameter Second = 1/);
    const subjects = git(fixture.prd, ['log', '-2', '--format=%s']).trim().split(/\r?\n/);
    assert.match(subjects[0], /^feat\(7654331\):/);
    assert.match(subjects[1], /^feat\(7654330\):/);
});

test('planning refuses to squash different demand numbers from separate DEV commits', async t => {
    const fixture = createSequentialPromotionFixture('7654330', '7654331');
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654330,7654331', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 1);
    assert.match(planned.stderr, /不同需求号来自独立 DEV 提交，禁止合并为一笔 PRD 提交/);
    assert.equal(git(fixture.prd, ['status', '--porcelain']).trim(), '');
});

test('a DEV commit that explicitly combines demand numbers stays one PRD commit', async t => {
    const fixture = createCombinedPromotionFixture('7654332', '7654333');
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const server = await createAtelierServer(() => null);
    t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);

    const planned = await runNode(promoteScript, ['plan', '--demand', '7654332', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    assert.deepEqual(plan.demandIds, ['7654332', '7654333']);
    assert.equal(plan.selected.length, 1);

    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev);
    assert.equal(applied.code, 0, applied.stderr);
    const message = git(fixture.prd, ['log', '-1', '--format=%B']);
    assert.match(message, /^fix\(7654332,7654333\): combined fixture/m);
    assert.match(message, /^Demand-Id: 7654332$/m);
    assert.match(message, /^Demand-Id: 7654333$/m);
    assert.equal(git(fixture.prd, ['status', '--porcelain']).trim(), '');
});

test('apply rejects a plan edited to omit a demand declared by DEV', async t => {
    const fixture = createCombinedPromotionFixture('7654334', '7654335');
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const server = await createAtelierServer(() => null);
    t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);

    const planned = await runNode(promoteScript, ['plan', '--demand', '7654334', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    plan.demandIds = ['7654334'];
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');

    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev);
    assert.equal(applied.code, 1);
    assert.match(applied.stderr, /promotion-plan-integrity-mismatch/);
    assert.equal(git(fixture.prd, ['status', '--porcelain']).trim(), '');
});

test('planning stops when DEV modifies a document missing from PRD server', async t => {
    const fixture = createPromotionFixture('7654322');
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const server = await createAtelierServer(() => null);
    t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654322', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 2);
    assert.match(planned.stdout, /PRD=not-found/);
    assert.match(planned.stderr, /停止项/);
    assert.equal(git(fixture.prd, ['status', '--porcelain']).trim(), '');
});

test('DEV-added document is promoted when PRD server reports not found', async t => {
    const fixture = createAddedPromotionFixture('7654323');
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const server = await createAtelierServer(() => null);
    t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654323', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    assert.equal(plan.files[0].sourceState, 'A');
    assert.equal(plan.files[0].remote.status, 'not-found');
    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev);
    assert.equal(applied.code, 0, applied.stderr);
    assert.equal(fs.existsSync(path.join(fixture.prd, 'src', 'Demo', 'Added.cls')), true);
    assert.equal(JSON.parse(fs.readFileSync(planPath, 'utf8')).execution.exportCommit, undefined);
});

test('three-way conflict requires staged semantic resolution and continue records adapted mode', async t => {
    const fixture = createPromotionFixture('7654324');
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const server = await createAtelierServer(doc => doc === 'Demo.Sample.cls' ? 'Class Demo.Sample\n{\nParameter Value = "PRD-DIVERGED";\n}\n' : null);
    t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654324', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev);
    assert.equal(applied.code, 20);
    assert.equal(JSON.parse(fs.readFileSync(planPath, 'utf8')).status, 'conflict');
    fs.writeFileSync(path.join(fixture.prd, 'src', 'Demo', 'Sample.cls'), 'Class Demo.Sample\n{\nParameter Value = "DEV";\n}\n');
    git(fixture.prd, ['add', 'src/Demo/Sample.cls']);
    const continued = await runNode(promoteScript, ['continue', '--plan', planPath], fixture.dev);
    assert.equal(continued.code, 0, continued.stderr);
    const finalPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    assert.equal(finalPlan.status, 'verified');
    assert.equal(finalPlan.execution.mode, 'adapted');
    assert.match(git(fixture.prd, ['log', '-1', '--format=%B']), /Promotion-Mode: adapted/);
});

test('continue refuses PRD HEAD drift during conflict resolution', async t => {
    const fixture = createPromotionFixture('7654326');
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const server = await createAtelierServer(doc => doc === 'Demo.Sample.cls' ? 'Class Demo.Sample\n{\nParameter Value = "PRD-DIVERGED";\n}\n' : null);
    t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654326', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev);
    assert.equal(applied.code, 20);
    const target = path.join(fixture.prd, 'src', 'Demo', 'Sample.cls');
    fs.writeFileSync(target, 'Class Demo.Sample\n{\nParameter Value = "DEV";\n}\n');
    git(fixture.prd, ['add', 'src/Demo/Sample.cls']);
    git(fixture.prd, ['commit', '-m', 'test: unexpected conflict commit']);
    fs.writeFileSync(target, 'Class Demo.Sample\n{\nParameter Value = "DEV-AGAIN";\n}\n');
    git(fixture.prd, ['add', 'src/Demo/Sample.cls']);
    const continued = await runNode(promoteScript, ['continue', '--plan', planPath], fixture.dev);
    assert.equal(continued.code, 1);
    assert.match(continued.stderr, /PRD HEAD 在冲突处理期间发生变化/);
});

test('apply refuses PRD HEAD drift after planning', async t => {
    const fixture = createPromotionFixture('7654325');
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const server = await createAtelierServer(doc => doc === 'Demo.Sample.cls' ? 'Class Demo.Sample\n{\nParameter Value = "BASE";\n}\n' : null);
    t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654325', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    fs.writeFileSync(path.join(fixture.prd, 'note.txt'), 'drift\n');
    git(fixture.prd, ['add', 'note.txt']);
    git(fixture.prd, ['commit', '-m', 'test: drift']);
    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev);
    assert.equal(applied.code, 1);
    assert.match(applied.stderr, /PRD HEAD 已变化/);
    assert.equal(fs.existsSync(path.join(fixture.prd, 'src', 'Demo', 'Sample.cls')), false);
});

test('apply detects a clean-looking index flag change before reading or writing', async t => {
    const fixture = createPromotionFixture('7654350'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    const server = await createAtelierServer(() => 'Class Demo.Sample\n{\nParameter Value = "BASE";\n}\n'); t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654350', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    git(fixture.prd, ['update-index', '--assume-unchanged', '.gitignore']);
    assert.equal(git(fixture.prd, ['status', '--porcelain']).trim(), '');
    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev);
    assert.equal(applied.code, 1); assert.match(applied.stderr, /promotion-repository-drift/);
    assert.equal(server.reads.length, 1); assert.equal(fs.existsSync(path.join(fixture.prd, 'src', 'Demo', 'Sample.cls')), false);
});

test('continue retries a rejected demand commit using the same owned baseline and source scope', async t => {
    const fixture = createPromotionFixture('7654351'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    const server = await createAtelierServer(() => 'Class Demo.Sample\n{\nParameter Value = "BASE";\n}\n'); t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654351', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim(), hook = path.join(fixture.prd, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\ncase "$(git show :src/Demo/Sample.cls)" in *DEV*) exit 1;; esac\n', {mode: 0o755});
    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev);
    assert.equal(applied.code, 1, applied.stderr);
    const stopped = promote.loadPlan(planPath);
    assert.equal(stopped.status, 'committing'); assert.ok(stopped.execution.exportCommit); assert.equal(stopped.execution.demandCommit, undefined);
    assert.equal(stopped.execution.pendingCommit.step, 'change-commit');
    fs.unlinkSync(hook);
    const continued = await runNode(promoteScript, ['continue', '--plan', planPath], fixture.dev);
    assert.equal(continued.code, 0, continued.stderr);
    const final = promote.loadPlan(planPath);
    assert.equal(final.status, 'verified'); assert.equal(final.execution.exportCommit, stopped.execution.exportCommit);
    assert.equal(git(fixture.prd, ['status', '--porcelain']).trim(), '');
    const message = git(fixture.prd, ['show', '-s', '--format=%B', final.execution.demandCommit]);
    assert.match(message, new RegExp(`^Source-Sync-Plan: ${final.id}$`, 'm'));
    assert.match(message, new RegExp(`^Baseline-Commit: ${final.execution.exportCommit}$`, 'm'));
    assert.match(message, /^Replay-Of: [a-f0-9]{40}$/m);
    assert.equal(server.reads.length, 2);
    writeProjectConfig(fixture.prd, server.port === 65535 ? server.port - 1 : server.port + 1);
    const changedTarget = await runNode(promoteScript, ['verify', '--plan', planPath], fixture.dev);
    assert.equal(changedTarget.code, 1); assert.match(changedTarget.stderr, /promotion-configuration-changed/);
});

test('guarded promotion publication integrates with core review and verify (interface-only)', async t => {
    const fixture = createPromotionFixture('7654353'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    const server = await createAtelierServer(() => 'Class Demo.Sample\n{\nParameter Value = "BASE";\n}\n'); t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654353', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev); assert.equal(applied.code, 0, applied.stderr);
    // This synthetic state transition tests the publication interface only. It
    // neither qualifies an HTTP endpoint for guarded remote reads nor deploys.
    const config = path.join(fixture.prd, '.agents', 'config');
    fs.writeFileSync(path.join(config, 'project_context_profile.md'), '- contextMode: intent-first-on-demand-export\n');
    fs.appendFileSync(path.join(config, 'iris_project_profile.md'), '- 默认需求交付类型：project\n');
    fs.writeFileSync(path.join(config, 'iris-development.json'), JSON.stringify({schema: 'iris-project-development/v1', environmentAlias: 'fixture', environmentType: 'test'}));
    fs.writeFileSync(path.join(fixture.prd, '.mcp.json'), JSON.stringify({mcpServers: {'iris-agentic-dev': {env: {IRIS_HOST: '127.0.0.1', IRIS_WEB_PORT: String(server.port), IRIS_SCHEME: 'http', IRIS_NAMESPACE: 'TEST'}}}}));
    fs.appendFileSync(path.join(fixture.prd, '.git', 'info', 'exclude'), '\n.mcp.json\n');
    const core = require('../source-sync-core'), context = require(workspaceContextScript).resolveWorkspaceContext(fixture.prd);
    const synthetic = promote.loadPlan(planPath);
    synthetic.guarded = true; synthetic.environment = {environmentAlias: 'fixture', environmentType: 'test'};
    synthetic.configurationFingerprint = core.configurationFingerprint(context); promote.savePlan(synthetic);
    const verified = await runNode(promoteScript, ['verify', '--plan', planPath], fixture.dev); assert.equal(verified.code, 0, verified.stderr);
    const pending = promote.loadPlan(planPath); assert.equal(pending.state, 'review-pending'); assert.ok(pending.publication.sha256);
    assert.throws(() => core.review(planPath, {confirmReview: true}), /source-review-required/);
    assert.equal(core.review(planPath, {confirmReview: true, evidence: 'synthetic: publication interface review'}).state, 'ready-to-publish');
    const checked = core.verify(planPath); assert.equal(checked.localVerified, true); assert.equal(checked.state, 'ready-to-publish');
    assert.equal(server.reads.length, 2); assert.equal(checked.deployment, undefined);
});

test('legacy v1 plan gains a local transaction snapshot after its original clean gate', async t => {
    const fixture = createPromotionFixture('7654354'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    const server = await createAtelierServer(() => 'Class Demo.Sample\n{\nParameter Value = "BASE";\n}\n'); t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654354', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim(), legacy = promote.loadPlan(planPath);
    legacy.version = 1;
    for (const key of ['schema', 'id', 'guarded', 'expected', 'configurationFingerprint', 'integrity']) delete legacy[key];
    delete legacy.execution.outsideIndexHash;
    for (const file of legacy.files) for (const key of ['sourcePath', 'gitPath', 'mode']) delete file[key];
    fs.writeFileSync(planPath, JSON.stringify(legacy));
    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev); assert.equal(applied.code, 0, applied.stderr);
    const result = promote.loadPlan(planPath);
    assert.equal(result.version, 1); assert.equal(result.schema, undefined); assert.ok(result.expected); assert.equal(result.publication, undefined);
    assert.equal(result.status, 'verified'); assert.equal(git(fixture.prd, ['status', '--porcelain']).trim(), '');
});

test('exact replay across export is applied once and preserves both commit identities', async t => {
    const fixture = createPromotionFixture('7654340');
    t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    const file = path.join(fixture.dev, 'src', 'Demo', 'Sample.cls');
    const original = git(fixture.dev, ['rev-parse', 'HEAD']).trim();
    const baseline = git(fixture.dev, ['show', 'HEAD^:src/Demo/Sample.cls']);
    const desired = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, baseline); git(fixture.dev, ['add', '.']); git(fixture.dev, ['commit', '-m', 'export(sync): refreshed baseline']);
    fs.writeFileSync(file, desired); git(fixture.dev, ['add', '.']);
    git(fixture.dev, ['commit', '-m', 'feat(7654340): replay', '-m', `Replay-Of: ${original}\nReplay-Mode: exact`]);
    const replay = git(fixture.dev, ['rev-parse', 'HEAD']).trim();
    const server = await createAtelierServer(() => baseline); t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654340', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim(), plan = promote.loadPlan(planPath);
    assert.equal(plan.selected.length, 1); assert.equal(plan.selected[0].hash, replay); assert.deepEqual(plan.selected[0].aliases, [original]);
    assert.ok(planPath.startsWith(path.join(fixture.prd, '.agents', 'work', 'source-sync', 'promotions')));
    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev);
    assert.equal(applied.code, 0, applied.stderr);
    assert.equal(git(fixture.prd, ['show', 'HEAD:src/Demo/Sample.cls']).replace(/\r\n/g, '\n'), desired.replace(/\r\n/g, '\n'));
    const message = git(fixture.prd, ['log', '-1', '--format=%B']);
    assert.ok(message.includes(`Dev-Commit: ${original}`)); assert.ok(message.includes(`Dev-Commit: ${replay}`));
    assert.equal(git(fixture.prd, ['remote']).trim(), '');
});

test('non-equivalent replay stops before any PRD read or write', async t => {
    const fixture = createPromotionFixture('7654341'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    const file = path.join(fixture.dev, 'src', 'Demo', 'Sample.cls'), original = git(fixture.dev, ['rev-parse', 'HEAD']).trim();
    fs.writeFileSync(file, git(fixture.dev, ['show', 'HEAD^:src/Demo/Sample.cls']));
    git(fixture.dev, ['add', '.']); git(fixture.dev, ['commit', '-m', 'export(sync): refreshed baseline']);
    fs.writeFileSync(file, 'Class Demo.Sample\n{\nParameter Value = "DIFFERENT";\n}\n');
    git(fixture.dev, ['add', '.']); git(fixture.dev, ['commit', '-m', 'feat(7654341): adapted replay', '-m', `Replay-Of: ${original}\nReplay-Mode: adapted`]);
    const server = await createAtelierServer(() => { throw Error('must not read'); }); t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654341', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 1); assert.match(planned.stderr, /replay-review-required/);
    assert.equal(fs.existsSync(path.join(fixture.prd, 'src')), false);
});

test('source review explicitly selects an adapted replay and shares the source/deploy repository lock', async t => {
    const fixture = createPromotionFixture('7654349'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    const file = path.join(fixture.dev, 'src', 'Demo', 'Sample.cls'), original = git(fixture.dev, ['rev-parse', 'HEAD']).trim();
    const baseline = git(fixture.dev, ['show', 'HEAD^:src/Demo/Sample.cls']);
    fs.writeFileSync(file, baseline); git(fixture.dev, ['add', '.']); git(fixture.dev, ['commit', '-m', 'export(sync): current server']);
    fs.writeFileSync(file, 'Class Demo.Sample\n{\nParameter Value = "ADAPTED";\n}\n'); git(fixture.dev, ['add', '.']);
    git(fixture.dev, ['commit', '-m', 'feat(7654349): reviewed adaptation', '-m', `Replay-Of: ${original}\nReplay-Mode: adapted`]);
    const retained = git(fixture.dev, ['rev-parse', 'HEAD']).trim();
    const server = await createAtelierServer(() => baseline); t.after(() => server.close()); installExportFixture(fixture.prd, server.port);
    const args = ['plan', '--demand', '7654349', '--dev-root', fixture.dev, '--prd-root', fixture.prd];
    const stopped = await runNode(promoteScript, args, fixture.dev); assert.equal(stopped.code, 1); assert.equal(server.reads.length, 0);
    const candidateFile = stopped.stderr.match(/复核候选:\s*(.+)/)[1].trim(), candidate = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
    assert.equal(candidate.schema, 'iris-replay-review-candidates/v1'); assert.equal(candidate.sources.length, 2);
    const reviewFile = path.join(path.dirname(candidateFile), 'review.json');
    const keepAll = {...candidate, schema: 'iris-replay-review/v1', action: 'keep-all', evidence: 'synthetic: both patches deliberately retained'};
    fs.writeFileSync(reviewFile, JSON.stringify(keepAll));
    const all = await runNode(promoteScript, [...args, '--source-review', reviewFile], fixture.dev); assert.equal(all.code, 0, all.stderr);
    assert.equal(promote.loadPlan(all.stdout.match(/计划文件:\s*(.+)/)[1].trim()).selected.length, 2);
    const review = {...candidate, schema: 'iris-replay-review/v1', action: 'select', evidence: 'synthetic: compare original/server/adapted behavior',
        selected: [retained], omitted: [{hash: original, supersededBy: retained, evidence: 'synthetic: the new patch fully replaces the old behavior'}]};
    fs.writeFileSync(reviewFile, JSON.stringify(review));
    const planned = await runNode(promoteScript, [...args, '--source-review', reviewFile], fixture.dev); assert.equal(planned.code, 0, planned.stderr);
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const release = require('../source-sync-core').acquireRepositoryLock(fixture.prd);
    try {
        const blocked = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev);
        assert.equal(blocked.code, 1); assert.match(blocked.stderr, /repository-sync-locked/); assert.equal(fs.existsSync(path.join(fixture.prd, 'src')), false);
    } finally { release(); }
    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev); assert.equal(applied.code, 0, applied.stderr);
    assert.match(git(fixture.prd, ['show', 'HEAD:src/Demo/Sample.cls']), /ADAPTED/);
    const message = git(fixture.prd, ['log', '-1', '--format=%B']);
    assert.match(message, /Promotion-Mode: adapted/); assert.ok(message.includes(`Supersedes-Dev-Commit: ${original} ${retained}`));
    assert.equal(new RegExp(`^Dev-Commit: ${original}$`, 'm').test(message), false);
});

test('source review rejects stale tokens, incomplete omissions and cross-demand supersession', t => {
    const fixture = createSequentialPromotionFixture('7654350', '7654351'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    const hashes = [git(fixture.dev, ['rev-parse', 'HEAD^']).trim(), git(fixture.dev, ['rev-parse', 'HEAD']).trim()];
    const commits = hashes.map(hash => { const [parents, subject] = git(fixture.dev, ['show', '-s', '--format=%P%x1f%s', hash]).trim().split('\x1f'); return {hash, parents: parents.split(' '), subject}; });
    const candidate = promote.replayReviewCandidates({devRoot: fixture.dev, prdRoot: fixture.prd, devHead: hashes[1], prdHead: git(fixture.prd, ['rev-parse', 'HEAD']).trim(), demandIds: ['7654350', '7654351']}, commits);
    const review = {...candidate, schema: 'iris-replay-review/v1', action: 'select', evidence: 'synthetic: review', selected: [hashes[1]],
        omitted: [{hash: hashes[0], supersededBy: hashes[1], evidence: 'synthetic: explicit omission'}]};
    assert.throws(() => promote.reviewedCommits(fixture.dev, commits, candidate, {...review, prdHead: '0'.repeat(40)}), /binding-invalid/);
    assert.throws(() => promote.reviewedCommits(fixture.dev, commits, candidate, {...review, omitted: []}), /omissions-incomplete/);
    assert.throws(() => promote.reviewedCommits(fixture.dev, commits, candidate, review), /independent-demand/);
    const changed = structuredClone(review); changed.sources[0].contentHash = '0'.repeat(64);
    assert.throws(() => promote.reviewedCommits(fixture.dev, commits, candidate, changed), /binding-invalid/);
});

test('equal deltas without an export boundary or replay provenance are not silently collapsed', t => {
    const fixture = createPromotionFixture('7654347'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    const file = path.join(fixture.dev, 'src', 'Demo', 'Sample.cls'), first = git(fixture.dev, ['rev-parse', 'HEAD']).trim();
    const desired = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, git(fixture.dev, ['show', 'HEAD^:src/Demo/Sample.cls'])); git(fixture.dev, ['add', '.']); git(fixture.dev, ['commit', '-m', 'test: restore fixture']);
    fs.writeFileSync(file, desired); git(fixture.dev, ['add', '.']); git(fixture.dev, ['commit', '-m', 'feat(7654347): independent equal delta']);
    const second = git(fixture.dev, ['rev-parse', 'HEAD']).trim();
    const commits = [first, second].map(hash => { const [parents, subject] = git(fixture.dev, ['show', '-s', '--format=%P%x1f%s', hash]).trim().split('\x1f'); return {hash, parents: parents.split(' '), subject}; });
    assert.equal(promote.samePatch(fixture.dev, first, fixture.dev, second), true);
    assert.equal(promote.effectiveCommits(fixture.dev, commits).length, 2);
});

test('source review cannot replace a whole demand with a replay that covers only some paths', t => {
    const fixture = createPromotionFixture('7654352'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    const other = path.join(fixture.dev, 'src', 'Demo', 'Other.cls'), originalFile = path.join(fixture.dev, 'src', 'Demo', 'Sample.cls');
    fs.writeFileSync(other, 'Class Demo.Other {}\n'); git(fixture.dev, ['add', '.']); git(fixture.dev, ['commit', '--amend', '--no-edit']);
    const original = git(fixture.dev, ['rev-parse', 'HEAD']).trim();
    fs.writeFileSync(originalFile, fs.readFileSync(originalFile, 'utf8').replace('"DEV"', '"ADAPTED"'));
    git(fixture.dev, ['add', '.']); git(fixture.dev, ['commit', '-m', 'feat(7654352): partial adapted replay']);
    const retained = git(fixture.dev, ['rev-parse', 'HEAD']).trim();
    const commits = [original, retained].map(hash => { const [parents, subject] = git(fixture.dev, ['show', '-s', '--format=%P%x1f%s', hash]).trim().split('\x1f'); return {hash, parents: parents.split(' '), subject}; });
    const candidate = promote.replayReviewCandidates({devRoot: fixture.dev, prdRoot: fixture.prd, devHead: retained, prdHead: git(fixture.prd, ['rev-parse', 'HEAD']).trim(), demandIds: ['7654352']}, commits);
    const review = {...candidate, schema: 'iris-replay-review/v1', action: 'select', evidence: 'synthetic: whole source replacement', selected: [retained],
        omitted: [{hash: original, supersededBy: retained, evidence: 'synthetic: partial replay'}]};
    assert.throws(() => promote.reviewedCommits(fixture.dev, commits, candidate, review), /partial-supersession/);
    assert.equal(promote.reviewedCommits(fixture.dev, commits, candidate, {...candidate, schema: 'iris-replay-review/v1', action: 'keep-all', evidence: 'synthetic: keep both layers'}).length, 2);
});

test('prior plan accepts verified DEV descendants and preserves the undeployed layer', async t => {
    const fixture = createPromotionFixture('7654342'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    const baseline = git(fixture.dev, ['show', 'HEAD^:src/Demo/Sample.cls']);
    const server = await createAtelierServer(() => baseline); t.after(() => server.close()); installExportFixture(fixture.prd, server.port);
    const args = ['plan', '--demand', '7654342', '--dev-root', fixture.dev, '--prd-root', fixture.prd];
    const first = await runNode(promoteScript, args, fixture.dev); assert.equal(first.code, 0, first.stderr);
    const priorPath = first.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const applied = await runNode(promoteScript, ['apply', '--plan', priorPath], fixture.dev); assert.equal(applied.code, 0, applied.stderr);
    const file = path.join(fixture.dev, 'src', 'Demo', 'Sample.cls');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('}\n', 'Parameter Added = 1;\n}\n'));
    git(fixture.dev, ['add', '.']); git(fixture.dev, ['commit', '-m', 'feat(7654342): additional behavior']);
    const next = await runNode(promoteScript, [...args, '--prior-plan', priorPath], fixture.dev); assert.equal(next.code, 0, next.stderr);
    const nextPath = next.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    assert.equal(promote.loadPlan(nextPath).files[0].preserveLocalBaseline, true);
    const final = await runNode(promoteScript, ['apply', '--plan', nextPath], fixture.dev); assert.equal(final.code, 0, final.stderr);
    const content = fs.readFileSync(path.join(fixture.prd, 'src', 'Demo', 'Sample.cls'), 'utf8');
    assert.match(content, /"DEV"/); assert.match(content, /Added = 1/);
    assert.equal(promote.loadPlan(nextPath).execution.exportCommit, undefined);
});

test('a prior demand already present on the server is verified instead of treated as drift', async t => {
    const fixture = createPromotionFixture('7654348'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    let remote = git(fixture.dev, ['show', 'HEAD^:src/Demo/Sample.cls']);
    const server = await createAtelierServer(() => remote); t.after(() => server.close()); installExportFixture(fixture.prd, server.port);
    const args = ['plan', '--demand', '7654348', '--dev-root', fixture.dev, '--prd-root', fixture.prd];
    const first = await runNode(promoteScript, args, fixture.dev); assert.equal(first.code, 0, first.stderr);
    const priorPath = first.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const applied = await runNode(promoteScript, ['apply', '--plan', priorPath], fixture.dev); assert.equal(applied.code, 0, applied.stderr);
    // Emulate an independently deployed previous commit; promotion itself never uploads.
    remote = git(fixture.prd, ['show', 'HEAD:src/Demo/Sample.cls']);
    const file = path.join(fixture.dev, 'src', 'Demo', 'Sample.cls');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('}\n', 'Parameter Added = 2;\n}\n'));
    git(fixture.dev, ['add', '.']); git(fixture.dev, ['commit', '-m', 'feat(7654348): incremental follow-up']);
    const next = await runNode(promoteScript, [...args, '--prior-plan', priorPath], fixture.dev); assert.equal(next.code, 0, next.stderr);
    const nextPath = next.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    assert.equal(Boolean(promote.loadPlan(nextPath).files[0].preserveLocalBaseline), false);
    const final = await runNode(promoteScript, ['apply', '--plan', nextPath], fixture.dev); assert.equal(final.code, 0, final.stderr);
    assert.equal(promote.loadPlan(nextPath).execution.exportCommit, undefined);
    assert.match(git(fixture.prd, ['show', 'HEAD:src/Demo/Sample.cls']), /Added = 2/);
});

test('new private state must be ignored before creating it', t => {
    const fixture = createPromotionFixture('7654343'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    fs.writeFileSync(path.join(fixture.prd, '.gitignore'), ''); git(fixture.prd, ['add', '.gitignore']); git(fixture.prd, ['commit', '-m', 'test: remove ignore']);
    const target = path.join(fixture.prd, '.agents', 'work', 'source-sync', 'promotions', 'new', 'plan.json');
    assert.throws(() => promote.assertPrivatePath(fixture.prd, target), /must-be-ignored/);
    assert.equal(fs.existsSync(target), false);
});

test('on-demand promotion requires local policy before sending network requests', async t => {
    const fixture = createPromotionFixture('7654344'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    let requests = 0; const server = await createAtelierServer(() => { requests++; return 'unexpected'; }); t.after(() => server.close());
    installExportFixture(fixture.prd, server.port);
    const config = path.join(fixture.prd, '.agents', 'config');
    fs.writeFileSync(path.join(config, 'project_context_profile.md'), '- contextMode: intent-first-on-demand-export\n');
    fs.writeFileSync(path.join(config, 'iris-development.json'), JSON.stringify({schema: 'iris-project-development/v1', environmentAlias: 'test', environmentType: 'test'}));
    fs.writeFileSync(path.join(fixture.prd, '.mcp.json'), JSON.stringify({mcpServers: {'iris-agentic-dev': {env: {IRIS_HOST: '127.0.0.1', IRIS_WEB_PORT: String(server.port), IRIS_SCHEME: 'http', IRIS_NAMESPACE: 'TEST'}}}}));
    // The connection file is private in real projects; keep the fixture equally isolated.
    fs.appendFileSync(path.join(fixture.prd, '.gitignore'), '.mcp.json\n'); git(fixture.prd, ['add', '.gitignore']); git(fixture.prd, ['commit', '-m', 'test: ignore private MCP']);
    const args = ['plan', '--demand', '7654344', '--dev-root', fixture.dev, '--prd-root', fixture.prd];
    const unclassified = await runNode(promoteScript, args, fixture.dev);
    assert.equal(unclassified.code, 1); assert.match(unclassified.stderr, /explicit-demand-kind-required/);
    const standard = await runNode(promoteScript, [...args, '--kind', 'standard'], fixture.dev);
    assert.equal(standard.code, 1); assert.match(standard.stderr, /promotion-project-demand-required/);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654344', '--kind', 'project', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 1); assert.match(planned.stderr, /remote-policy-required/); assert.equal(requests, 0);
});

test('one serial Atelier session reads all planned documents and apply does not probe then reread', async t => {
    const fixture = createPromotionFixture('7654345'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    const extra = path.join(fixture.dev, 'src', 'Demo', 'Second.cls');
    fs.writeFileSync(extra, 'Class Demo.Second\n{\n}\n'); git(fixture.dev, ['add', '.']); git(fixture.dev, ['commit', '-m', 'feat(7654345): another file']);
    const baseline = git(fixture.dev, ['show', 'HEAD~2:src/Demo/Sample.cls']);
    const server = await createAtelierServer(doc => doc === 'Demo.Sample.cls' ? baseline : null, {cookie: true});
    t.after(() => server.close()); installExportFixture(fixture.prd, server.port);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654345', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 0, planned.stderr);
    assert.equal(server.reads.length, 2); assert.ok(server.reads[1].cookie.includes('CSPSESSIONID'));
    const planPath = planned.stdout.match(/计划文件:\s*(.+)/)[1].trim();
    const applied = await runNode(promoteScript, ['apply', '--plan', planPath], fixture.dev); assert.equal(applied.code, 0, applied.stderr);
    assert.equal(server.reads.length, 4); assert.ok(server.reads[3].cookie.includes('CSPSESSIONID'));
    assert.equal(server.logoutCount(), 2);
});

test('interrupted baseline reads retain verified private progress without touching source', async t => {
    const fixture = createPromotionFixture('7654346'); t.after(() => fs.rmSync(fixture.root, {recursive: true, force: true}));
    fs.writeFileSync(path.join(fixture.dev, 'src', 'Demo', 'Second.cls'), 'Class Demo.Second\n{\n}\n');
    git(fixture.dev, ['add', '.']); git(fixture.dev, ['commit', '-m', 'feat(7654346): another file']);
    const baseline = git(fixture.dev, ['show', 'HEAD~2:src/Demo/Sample.cls']);
    const server = await createAtelierServer(() => baseline, {statusFor: doc => doc === 'Demo.Second.cls' ? 503 : 200});
    t.after(() => server.close()); installExportFixture(fixture.prd, server.port);
    const planned = await runNode(promoteScript, ['plan', '--demand', '7654346', '--dev-root', fixture.dev, '--prd-root', fixture.prd], fixture.dev);
    assert.equal(planned.code, 1); assert.match(planned.stderr, /atelier-http-failed/); assert.equal(server.reads.length, 2);
    assert.equal(fs.existsSync(path.join(fixture.prd, 'src')), false);
    const stateRoot = path.join(fixture.prd, '.agents', 'work', 'source-sync', 'promotions');
    const plans = fs.readdirSync(stateRoot, {recursive: true}).filter(name => name.endsWith('plan.json'));
    assert.equal(plans.length, 1);
    const planPath = path.join(stateRoot, plans[0]), plan = promote.loadPlan(planPath);
    assert.equal(plan.status, 'blocked'); assert.equal(plan.completedReads, 1);
    const staged = path.join(path.dirname(planPath), 'prd-baseline', 'src', 'Demo', 'Sample.cls');
    assert.equal(fs.readFileSync(staged, 'utf8'), baseline);
    assert.equal(git(fixture.prd, ['status', '--porcelain']).trim(), '');
});

function createWorkspaceFixture() {
    const root = temporary('iris-export-test-');
    fs.mkdirSync(path.join(root, '.agents', 'config'), { recursive: true });
    fs.mkdirSync(path.join(root, '.agents', 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(workspaceContextScript, path.join(root, '.agents', 'scripts', 'lib', 'workspace-context.js'));
    installSharedRuntime(root);
    return { root };
}

function createPromotionFixture(demand) {
    const root = temporary('iris-promote-test-');
    const dev = path.join(root, 'DEV');
    const prd = path.join(root, 'PRD');
    initRepo(dev);
    initRepo(prd);
    fs.mkdirSync(path.join(dev, 'src', 'Demo'), { recursive: true });
    fs.writeFileSync(path.join(dev, 'src', 'Demo', 'Sample.cls'), 'Class Demo.Sample\n{\nParameter Value = "BASE";\n}\n');
    git(dev, ['add', '.']);
    git(dev, ['commit', '-m', 'export(sync): baseline']);
    fs.writeFileSync(path.join(dev, 'src', 'Demo', 'Sample.cls'), 'Class Demo.Sample\n{\nParameter Value = "DEV";\n}\n');
    git(dev, ['add', '.']);
    git(dev, ['commit', '-m', `feat(${demand}): promote fixture`]);
    return { root, dev, prd };
}

function createAddedPromotionFixture(demand) {
    const root = temporary('iris-promote-added-test-');
    const dev = path.join(root, 'DEV');
    const prd = path.join(root, 'PRD');
    initRepo(dev);
    initRepo(prd);
    fs.mkdirSync(path.join(dev, 'src', 'Demo'), { recursive: true });
    fs.writeFileSync(path.join(dev, 'src', 'Demo', 'Added.cls'), 'Class Demo.Added\n{\n}\n');
    git(dev, ['add', '.']);
    git(dev, ['commit', '-m', `feat(${demand}): add fixture`]);
    return { root, dev, prd };
}

function createSequentialPromotionFixture(firstDemand, secondDemand) {
    const root = temporary('iris-promote-sequential-test-');
    const dev = path.join(root, 'DEV');
    const prd = path.join(root, 'PRD');
    initRepo(dev);
    initRepo(prd);
    const file = path.join(dev, 'src', 'Demo', 'Shared.cls');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'Class Demo.Shared\n{\nParameter Base = 1;\n}\n');
    git(dev, ['add', '.']);
    git(dev, ['commit', '-m', 'export(sync): baseline']);
    fs.writeFileSync(file, 'Class Demo.Shared\n{\nParameter Base = 1;\nParameter First = 1;\n}\n');
    git(dev, ['add', '.']);
    git(dev, ['commit', '-m', `feat(${firstDemand}): first shared change`]);
    fs.writeFileSync(file, 'Class Demo.Shared\n{\nParameter Base = 1;\nParameter First = 1;\nParameter Second = 1;\n}\n');
    git(dev, ['add', '.']);
    git(dev, ['commit', '-m', `feat(${secondDemand}): second shared change`]);
    return { root, dev, prd };
}

function createCombinedPromotionFixture(firstDemand, secondDemand) {
    const root = temporary('iris-promote-combined-test-');
    const dev = path.join(root, 'DEV');
    const prd = path.join(root, 'PRD');
    initRepo(dev);
    initRepo(prd);
    const file = path.join(dev, 'src', 'Demo', 'Combined.cls');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'Class Demo.Combined\n{\n}\n');
    git(dev, ['add', '.']);
    git(dev, ['commit', '-m', `fix(${firstDemand},${secondDemand}): combined fixture`]);
    return { root, dev, prd };
}

function initRepo(root) {
    fs.mkdirSync(root, { recursive: true });
    git(root, ['init']);
    git(root, ['config', 'user.name', 'Codex Test']);
    git(root, ['config', 'user.email', 'codex-test@example.invalid']);
    // Synthetic repositories must not inherit the operator's unrelated hooks.
    git(root, ['config', 'core.hooksPath', '.git/hooks']);
    fs.writeFileSync(path.join(root, '.gitignore'), '.agents/\n');
    git(root, ['add', '.gitignore']);
    git(root, ['commit', '-m', 'init']);
}

function installExportFixture(prdRoot, port) {
    const destination = path.join(prdRoot, '.agents', 'plugins', 'coding-iris-plugin', 'scripts', 'iris-tools');
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(exportScript, path.join(destination, 'export.js'));
    fs.mkdirSync(path.join(prdRoot, '.agents', 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(workspaceContextScript, path.join(prdRoot, '.agents', 'scripts', 'lib', 'workspace-context.js'));
    installSharedRuntime(prdRoot);
    writeProjectConfig(prdRoot, port);
}

function installSharedRuntime(root) {
    for (const name of ['atelier-client.js', 'iris-remote-operations.js']) {
        fs.copyFileSync(path.join(path.dirname(workspaceContextScript), name), path.join(root, '.agents', 'scripts', 'lib', name));
    }
}

function writeProjectConfig(root, port) {
    const configDir = path.join(root, '.agents', 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'project-env.json'), JSON.stringify({
        iris: { scheme: 'http', host: '127.0.0.1', port, namespace: 'TEST', username: 'test', password: 'test' },
        web: { basePath: 'imedical/web', cspBasePath: 'imedical/web/csp' }
    }, null, 2));
    fs.writeFileSync(path.join(configDir, 'iris_project_profile.md'), '- 前端源码根目录：`src/imedical/web`\n- 前端编码模式：utf8\n');
}

async function createAtelierServer(contentForDocument, options = {}) {
    const reads = []; let logouts = 0;
    const server = http.createServer((request, response) => {
        if (request.url.includes('CacheLogout')) { logouts++; response.statusCode = 200; response.end(); return; }
        const marker = '/doc/';
        const documentName = decodeURIComponent(request.url.slice(request.url.indexOf(marker) + marker.length));
        const content = contentForDocument(documentName);
        reads.push({document: documentName, cookie: request.headers.cookie || ''});
        const status = options.statusFor?.(documentName) || 200;
        if (status !== 200) { response.statusCode = status; response.end('{}'); return; }
        if (options.cookie && !request.headers.cookie) response.setHeader('set-cookie', 'CSPSESSIONID=fixture; Path=/; HttpOnly');
        response.setHeader('content-type', 'application/json');
        if (content === null) {
            response.statusCode = 404;
            response.end(JSON.stringify({ status: { errors: [`Document ${documentName} does not exist`] }, result: {} }));
        } else {
            response.end(JSON.stringify({ status: { errors: [] }, result: { db: '@FS', ts: '2026-10-24 10:00:00.000', content: String(content).split('\n') } }));
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { port: server.address().port, reads, logoutCount: () => logouts, close: () => new Promise(resolve => server.close(resolve)) };
}

function runNode(script, args, cwd, timeoutMs = 60000) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [script, ...args], { cwd, windowsHide: true });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, timeoutMs);
        child.stdout.on('data', data => { stdout += data; });
        child.stderr.on('data', data => { stderr += data; });
        child.on('error', error => {
            clearTimeout(timeout);
            resolve({ code: null, stdout, stderr: `${stderr}\n[spawn-error] ${error.message}`.trim() });
        });
        child.on('close', code => {
            clearTimeout(timeout);
            if (timedOut) stderr = `${stderr}\n[timeout] child process exceeded ${timeoutMs}ms`.trim();
            resolve({ code, stdout, stderr });
        });
    });
}

function lastJson(stdout) {
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
        try { return JSON.parse(lines[i]); } catch (_) { /* continue */ }
    }
    throw new Error(`No JSON in output: ${stdout}`);
}

function git(root, args) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed (status=${result.status}, signal=${result.signal}, error=${result.error?.code || ''}): ${result.stderr || result.stdout}`);
    return result.stdout;
}
