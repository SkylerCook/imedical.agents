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

test('export.js probes CSS and stages CSP through Atelier API', async t => {
    const fixture = createWorkspaceFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const server = await createAtelierServer(doc => doc.endsWith('/missing.css') ? null : `content:${doc}`);
    t.after(() => server.close());
    writeProjectConfig(fixture.root, server.port);

    const css = await runNode(exportScript, ['styles/app.css', '--probe', '--json'], fixture.root);
    assert.equal(css.code, 0, css.stderr);
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
    assert.match(applied.stderr, /计划遗漏 DEV 提交声明的需求号: 7654335/);
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

function createWorkspaceFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-export-test-'));
    fs.mkdirSync(path.join(root, '.agents', 'config'), { recursive: true });
    fs.mkdirSync(path.join(root, '.agents', 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(workspaceContextScript, path.join(root, '.agents', 'scripts', 'lib', 'workspace-context.js'));
    return { root };
}

function createPromotionFixture(demand) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-promote-test-'));
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-promote-added-test-'));
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-promote-sequential-test-'));
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-promote-combined-test-'));
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
    writeProjectConfig(prdRoot, port);
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

async function createAtelierServer(contentForDocument) {
    const server = http.createServer((request, response) => {
        const marker = '/doc/';
        const documentName = decodeURIComponent(request.url.slice(request.url.indexOf(marker) + marker.length));
        const content = contentForDocument(documentName);
        response.setHeader('content-type', 'application/json');
        if (content === null) {
            response.end(JSON.stringify({ status: { errors: [`Document ${documentName} does not exist`] }, result: {} }));
        } else {
            response.end(JSON.stringify({ status: { errors: [] }, result: { db: '@FS', content: String(content).split('\n') } }));
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { port: server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}

function runNode(script, args, cwd) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [script, ...args], { cwd, windowsHide: true });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', data => { stdout += data; });
        child.stderr.on('data', data => { stderr += data; });
        child.on('close', code => resolve({ code, stdout, stderr }));
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
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout;
}
