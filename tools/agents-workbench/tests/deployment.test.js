'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');
const { buildPackage, withVerifiedPackage } = require('../build/build-offline-package');

const ref = 'refs/heads/master';

function git(cwd, args, input) {
    const env = { ...process.env, GIT_ALLOW_PROTOCOL: '', GIT_CONFIG_NOSYSTEM: '1' };
    return execFileSync('git', ['-C', cwd, '-c', 'core.longpaths=true', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgsign=false', ...args], { input, env, encoding: 'utf8', windowsHide: true }).trim();
}

function fixture(t, objectFormat = 'sha1') {
    const root = createTempDirectory('offline-capability-test-');
    t.after(() => { if (ownsTempDirectory(root)) fs.rmSync(root, { recursive: true, force: true }); });
    const source = path.join(root, '离线 源仓.git');
    fs.mkdirSync(source);
    git(source, ['init', '--quiet', '--bare', '--template=', '--initial-branch=master', `--object-format=${objectFormat}`]);
    const oldBlob = git(source, ['hash-object', '-w', '--stdin'], 'first release');
    const oldTree = git(source, ['mktree'], `100644 blob ${oldBlob}\tvendor.bin\n`);
    const previous = git(source, ['commit-tree', oldTree, '-m', 'first release']);
    const blob = git(source, ['hash-object', '-w', '--stdin'], 'asset at the intended revision');
    const tree = git(source, ['mktree'], `100644 blob ${blob}\tvendor.bin\n`);
    const revision = git(source, ['commit-tree', tree, '-p', previous, '-m', 'second release']);
    git(source, ['update-ref', ref, revision]);
    git(source, ['update-ref', 'refs/heads/another-branch', previous]);
    return { root, source, previous, revision, oldBlob, output: path.join(root, '离线 包') };
}

function manifestFile(output) {
    return path.join(output, 'manifest.json');
}

function bundleMetadata(f, file) {
    const bytes = fs.readFileSync(file);
    return { schema: 'imedical-agents-offline-bundle/v1', bundle: 'capability.bundle', objectFormat: 'sha1',
        ref, revision: f.revision, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

test('release defaults yield an isolated, complete offline repository without changing source refs', async t => {
    const f = fixture(t);
    const sourceRefs = git(f.source, ['show-ref']);
    const packageManifest = await buildPackage({ source: f.source, output: f.output });
    assert.equal(packageManifest.ref, ref);
    assert.equal(packageManifest.revision, f.revision);
    assert.deepEqual(JSON.parse(fs.readFileSync(manifestFile(f.output), 'utf8')), packageManifest);
    let temporaryRepo;
    await withVerifiedPackage(f.output, packageManifest, ({ manifest, repository }) => {
        temporaryRepo = repository;
        assert.deepEqual(manifest, packageManifest);
        assert.equal(git(repository, ['symbolic-ref', 'HEAD']), ref);
        assert.equal(git(repository, ['show-ref']), `${f.revision} ${ref}`);
        assert.equal(git(repository, ['show', `${f.previous}:vendor.bin`]), 'first release');
        assert.equal(git(repository, ['show', 'HEAD:vendor.bin']), 'asset at the intended revision');
    });
    assert.equal(fs.existsSync(temporaryRepo), false);
    assert.equal(git(f.source, ['show-ref']), sourceRefs);
    assert.deepEqual(fs.readdirSync(f.output).sort(), ['capability.bundle', 'manifest.json']);
});

test('declines an existing output, stale pinned revision, source-local output and dirty source', async t => {
    const f = fixture(t);
    const sourceLocal = path.join(f.source, 'not-created');
    await assert.rejects(buildPackage({ source: f.source, output: sourceLocal }), /Git 源仓及其工作树之外/);
    assert.equal(fs.existsSync(sourceLocal), false);
    await assert.rejects(buildPackage({ source: f.source, output: f.output, ref, revision: f.previous }), /提交与源分支/);
    assert.equal(fs.existsSync(f.output), false);
    fs.mkdirSync(f.output);
    const userFile = path.join(f.output, 'preserve.txt');
    fs.writeFileSync(userFile, 'already there');
    await assert.rejects(buildPackage({ source: f.source, output: f.output }), /输出目录已存在/);
    assert.equal(fs.readFileSync(userFile, 'utf8'), 'already there');

    const dirty = path.join(f.root, 'dirty');
    fs.mkdirSync(dirty);
    git(dirty, ['init', '--quiet', '--template=']);
    fs.writeFileSync(path.join(dirty, 'untracked.txt'), 'user work');
    await assert.rejects(buildPackage({ source: dirty, output: path.join(f.root, 'new') }), /源工作树有未提交或未跟踪/);
});

test('rejects shallow and missing object sources when all transports are disabled', async t => {
    const f = fixture(t);
    const shallow = path.join(f.source, 'shallow');
    fs.writeFileSync(shallow, `${f.revision}\n`);
    await assert.rejects(buildPackage({ source: f.source, output: f.output }), /浅克隆/);
    fs.unlinkSync(shallow);

    const looseObject = path.join(f.source, 'objects', f.oldBlob.slice(0, 2), f.oldBlob.slice(2));
    fs.unlinkSync(looseObject);
    git(f.source, ['config', 'extensions.partialClone', 'origin']);
    git(f.source, ['config', 'remote.origin.url', 'https://offline-test.invalid/never-fetch.git']);
    git(f.source, ['config', 'remote.origin.promisor', 'true']);
    await assert.rejects(buildPackage({ source: f.source, output: f.output }), /完整 Git bundle|对象缺失/);
    assert.equal(fs.existsSync(f.output), false);
});

test('rejects an incremental bundle even with approved digest and advertised tip', async t => {
    const f = fixture(t);
    fs.mkdirSync(f.output);
    const file = path.join(f.output, 'capability.bundle');
    git(f.source, ['bundle', 'create', '--quiet', file, ref, `^${f.previous}`]);
    const manifest = bundleMetadata(f, file);
    fs.writeFileSync(manifestFile(f.output), JSON.stringify(manifest));
    await assert.rejects(withVerifiedPackage(f.output, manifest, assert.fail), /外部前置对象/);
});

test('rejects a filtered bundle whose promised blobs are unavailable offline', async t => {
    const f = fixture(t);
    fs.mkdirSync(f.output);
    const file = path.join(f.output, 'capability.bundle');
    git(f.source, ['bundle', 'create', '--quiet', '--version=3', file, '--filter=blob:none', ref]);
    const manifest = bundleMetadata(f, file);
    fs.writeFileSync(manifestFile(f.output), JSON.stringify(manifest));
    await assert.rejects(withVerifiedPackage(f.output, manifest, assert.fail), /未随包提供的对象|对象缺失/);
});

test('rejects a re-labelled ref, independent trust mismatch and same-size tampering', async t => {
    const f = fixture(t);
    const manifest = await buildPackage({ source: f.source, output: f.output, ref, revision: f.revision });
    const relabelled = { ...manifest, ref: 'refs/heads/wrong' };
    fs.writeFileSync(manifestFile(f.output), JSON.stringify(relabelled));
    await assert.rejects(withVerifiedPackage(f.output, manifest, assert.fail), /清单与批准/);
    await assert.rejects(withVerifiedPackage(f.output, relabelled, assert.fail), /Git bundle 的分支或提交/);

    fs.writeFileSync(manifestFile(f.output), JSON.stringify(manifest));
    const file = path.join(f.output, 'capability.bundle');
    const bytes = fs.readFileSync(file);
    bytes[bytes.length - 1] ^= 1;
    fs.writeFileSync(file, bytes);
    await assert.rejects(withVerifiedPackage(f.output, manifest, assert.fail), /内容与批准的 SHA-256/);
});

test('fixed CLI flags return independent verification metadata without an ephemeral path', t => {
    const f = fixture(t);
    const command = path.join(__dirname, '..', 'build', 'build-offline-package.js');
    const cli = args => JSON.parse(execFileSync(process.execPath, [command, ...args], { encoding: 'utf8' }));
    const manifest = cli(['build', '--source', f.source, '--output', f.output]);
    assert.deepEqual(cli(['verify', '--package', f.output, '--ref', ref, '--revision', f.revision, '--sha256', manifest.sha256]), manifest);
});

test('a detached SHA-256 source still packages the release branch by default', async t => {
    const f = fixture(t, 'sha256');
    fs.writeFileSync(path.join(f.source, 'HEAD'), `${f.revision}\n`);
    const manifest = await buildPackage({ source: f.source, output: f.output, revision: f.revision });
    assert.equal(manifest.ref, ref);
    assert.equal(manifest.objectFormat, 'sha256');
    await withVerifiedPackage(f.output, manifest, ({ repository }) => {
        assert.equal(git(repository, ['rev-parse', 'HEAD']), f.revision);
        assert.equal(git(repository, ['rev-parse', '--show-object-format']), 'sha256');
    });
});

const framework = path.resolve(__dirname, '../../..');
// Same approved historical execution tree as installed-owner.test.js.
const approvedRevision = '3246ca4e7442c9e81977626c438922b757efbddb';
const approvedTree = approvedRevision + ':f0a05c1ee334f4f37fadaaeb313f9f9c67b93ee0f25938fd9b982a0ce155620c';
const nextRevision = 'b65675b656519b2a2bda02fd2b26e1a19fdbdd62';
const nextTree = nextRevision + ':30b13b1d4a6e499cbc56e7da2355ff345ac269f74d8222a07b8d523e03ce9427';

async function boundFramework(t, stage, project) {
    const { createFrameworkService } = require(path.join(stage, 'tools', 'agents-workbench', 'src', 'framework-service.js'));
    let files, pickCount = 0;
    const service = createFrameworkService(project, { pickOffline: async () => { pickCount++; return files; } });
    const server = http.createServer((req, res) => {
        service.handle(req, res, req.url.slice(1), origin).catch(error => {
            t.diagnostic(error.stack || String(error));
            if (res.headersSent) return res.destroy(error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'fixture-handler-failed' }));
        });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    t.after(() => {
        server.closeAllConnections();
        return new Promise(resolve => server.close(resolve));
    });
    const headers = { origin, connection: 'close', 'x-workbench-request': '1', 'content-type': 'application/json' };
    const session = await fetch(`${origin}/framework/session`, { method: 'POST', headers, body: JSON.stringify({ token: service.bootstrap }) })
        .catch(error => { throw new Error('Fixture session exchange failed', { cause: error }); });
    assert.equal(session.status, 200);
    const cookie = session.headers.get('set-cookie').split(';', 1)[0];
    const { csrf } = await session.json();
    const state = () => fetch(`${origin}/framework.json`, { headers }).then(res => res.json())
        .catch(error => { throw new Error('Fixture framework observation failed', { cause: error }); });
    const post = async (action, revision, extra = {}, authenticated = true, route = 'offline') => {
        const { projectId } = await state();
        const response = await fetch(`${origin}/framework/${route}`, { method: 'POST',
            headers: authenticated ? { ...headers, cookie, 'x-workbench-csrf': csrf } : headers,
            body: JSON.stringify({ action, revision, projectId, ...extra }) })
            .catch(error => { throw new Error(`Framework ${route} request failed at ${action}`, { cause: error }); });
        return { status: response.status, data: await response.json() };
    };
    return { post, state, choose: input => { files = input; }, pickCount: () => pickCount };
}

test('staged Workbench uses Windows PowerShell 5.1 to install and update approved offline Git objects', {
    skip: process.platform !== 'win32' && 'Windows PowerShell 5.1 required'
}, async t => {
    const hasRevision = spawnSync('git', ['-C', framework, 'cat-file', '-e', `${approvedRevision}^{commit}`]);
    const hasNext = spawnSync('git', ['-C', framework, 'cat-file', '-e', `${nextRevision}^{commit}`]);
    if (hasRevision.status !== 0 || hasNext.status !== 0) return t.skip('Historical framework fixtures are unavailable in this clone');
    const root = createTempDirectory('offline-install-test-');
    t.after(() => { if (ownsTempDirectory(root)) fs.rmSync(root, { recursive: true, force: true }); });
    const project = path.join(root, '已有项目');
    fs.mkdirSync(project);
    const stage = path.join(root, '工作台 暂存');
    execFileSync(process.execPath, [path.join(framework, 'tools', 'agents-workbench', 'react', 'package-runtime.mjs'), stage],
        { cwd: root, windowsHide: true, encoding: 'utf8' });
    const objects = git(framework, ['rev-parse', '--path-format=absolute', '--git-path', 'objects']);
    async function makeBundle(name, revision, branch = ref) {
        const source = path.join(root, `${name}.git`);
        const output = path.join(root, name);
        fs.mkdirSync(source);
        git(source, ['init', '--quiet', '--bare', '--template=', '--initial-branch=master']);
        fs.writeFileSync(path.join(source, 'objects', 'info', 'alternates'), `${objects}\n`);
        git(source, ['update-ref', branch, revision]);
        return { output, manifest: await buildPackage({ source, ref: branch, revision, output }) };
    }
    const old = await makeBundle('old', approvedRevision);

    git(project, ['init', '--quiet', '--template=']);
    const business = {
        'AGENTS.md': 'Existing project instructions.\n',
        'business.txt': 'Existing application bytes.\n',
        '.mcp.json': '{"mcpServers":{"fixture":{"command":"never-run-this-fixture"}}}\n'
    };
    for (const [name, contents] of Object.entries(business)) fs.writeFileSync(path.join(project, name), contents);
    const target = path.join(project, '.agents');
    const ownerEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(Git_.*|PSModulePath|IMEDICAL_DEPLOYMENT_LOCK)$/i.test(key)));
    ownerEnv.GIT_ALLOW_PROTOCOL = '';
    ownerEnv.PSModulePath = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules');
    const owner = (file, ...args) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(stage, 'scripts', file), ...args], {
        cwd: project, env: ownerEnv, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024
    });
    const install = (repository, expected) => owner('install-agents.ps1', '-RepositorySource', repository,
        '-ExpectedRevision', expected, '-TrustedRuntimeTree', approvedTree);
    const lock = path.join(target, '.git', 'plugin-deployment.lock');
    const bound = await boundFramework(t, stage, project);
    assert.equal((await bound.post('select', null, {}, false)).status, 403);
    assert.equal((await bound.post('select', null, { bundleDirectory: old.output })).status, 400);
    assert.equal(bound.pickCount(), 0);
    function choose(bundle, metadata = bundle.manifest) {
        const releaseRecord = path.join(root, 'detached-approval.json');
        fs.writeFileSync(releaseRecord, JSON.stringify(metadata));
        bound.choose({ releaseRecord, bundle: path.join(bundle.output, 'capability.bundle') });
        return releaseRecord;
    }
    bound.choose({ releaseRecord: manifestFile(old.output), bundle: path.join(old.output, 'capability.bundle') });
    assert.equal((await bound.post('select', null)).data.error, 'offline-release-record-not-independent');
    choose(old, { ...old.manifest, revision: '0'.repeat(40) });
    assert.equal((await bound.post('select', null)).data.error, 'offline-revision-unapproved');
    const alternative = await makeBundle('alternative', approvedRevision, 'refs/heads/transfer-only');
    choose(alternative);
    assert.equal((await bound.post('select', null)).data.error, 'offline-install-release-branch-required');
    assert.equal(fs.existsSync(target), false);
    let detachedSource;
    await withVerifiedPackage(old.output, old.manifest, ({ repository }) => {
        detachedSource = repository;
        const mismatch = install(repository, '0'.repeat(40));
        assert.notEqual(mismatch.status, 0);
        assert.match(mismatch.stderr, /Offline capability revision does not match/);
        assert.ok(!fs.readdirSync(project).some(name => name.startsWith('.agents')));
    });
    assert.equal(fs.existsSync(detachedSource), false);
    const approval = choose(old);
    const selectedInstall = await bound.post('select', null);
    assert.equal(selectedInstall.status, 200, JSON.stringify(selectedInstall.data));
    assert.equal(selectedInstall.data.offline.install, true);
    assert.equal(selectedInstall.data.offline.revision, approvedRevision);
    assert.equal(fs.existsSync(target), false);
    assert.equal((await bound.post('apply', null, { selectionId: 'stale-plan' })).data.error, 'offline-preview-required');
    const installed = await bound.post('apply', null, { selectionId: selectedInstall.data.offline.selectionId });
    assert.equal(installed.status, 200, JSON.stringify(installed.data));
    assert.equal(installed.data.after.revision, approvedRevision);
    assert.deepEqual(installed.data.steps.map(({step,exitCode}) => [step,exitCode]),
        [['install',0],['initialize',0],['check',0]]);
    assert.equal(installed.data.after.installed.profile, true);
    assert.ok(installed.data.after.installed.skillEntries > 0);
    const initializedGuidance = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8');
    assert.ok(initializedGuidance.startsWith(business['AGENTS.md']));
    assert.match(initializedGuidance, /\(\.agents\/docs\/README\.md\)/);
    assert.equal((await bound.post('apply', null, { selectionId: selectedInstall.data.offline.selectionId })).data.error, 'stale-observation');
    assert.equal(git(target, ['rev-parse', 'HEAD']), approvedRevision);
    assert.equal(git(target, ['config', '--get', 'remote.origin.url']), 'https://gitee.com/skyler-cook/imedical.agents.git');
    assert.equal(git(target, ['rev-parse', '--abbrev-ref', '@{upstream}']), 'origin/master');
    assert.equal(fs.existsSync(path.join(target, '.git', 'objects', 'info', 'alternates')), false);
    assert.equal(fs.existsSync(path.join(target, 'scripts', 'update-agents.ps1')), true);
    assert.equal(fs.existsSync(path.join(target, 'tools')), false);
    assert.ok(Number(git(target, ['cat-file', '-s', 'HEAD:vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe'])) > 1024 * 1024);
    for (const [name, contents] of Object.entries(business)) {
        assert.equal(fs.readFileSync(path.join(project, name), 'utf8'), name === 'AGENTS.md' ? initializedGuidance : contents);
    }

    const next = await makeBundle('new', nextRevision);
    const revision = () => git(target, ['rev-parse', 'HEAD']);
    const remoteRefs = () => git(target, ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/remotes']);
    git(target, ['update-ref', 'refs/remotes/origin/keep', approvedRevision]);
    const refsBefore = remoteRefs();
    const configPath = path.join(target, '.git', 'config');
    const configBefore = fs.readFileSync(configPath);
    const privateFile = path.join(target, 'config', 'offline-test-private.json');
    fs.writeFileSync(privateFile, '{"preserve":true}\n');
    const fetchHead = path.join(target, '.git', 'FETCH_HEAD');
    fs.writeFileSync(fetchHead, 'preserve existing FETCH_HEAD\n');
    const privateBefore = fs.readFileSync(privateFile);
    assert.notEqual(spawnSync('git', ['-C', target, 'cat-file', '-e', `${nextRevision}^{commit}`], {
        env: { ...process.env, GIT_ALLOW_PROTOCOL: '' }
    }).status, 0);
    const assertPreserved = () => {
        assert.deepEqual(fs.readFileSync(configPath), configBefore);
        assert.equal(remoteRefs(), refsBefore);
        assert.equal(fs.readFileSync(fetchHead, 'utf8'), 'preserve existing FETCH_HEAD\n');
        assert.deepEqual(fs.readFileSync(privateFile), privateBefore);
        assert.equal(fs.existsSync(path.join(target, '.git', 'objects', 'info', 'alternates')), false);
    };
    const moveFixtureHead = (expected, actual) => git(target, ['update-ref', ref, expected, actual]);
    choose(next);
    const stagedPreview = await bound.post('select', approvedRevision);
    assert.equal(stagedPreview.status, 200, JSON.stringify(stagedPreview.data));
    assert.equal(stagedPreview.data.offline.install, false);
    assert.equal(stagedPreview.data.offline.revision, nextRevision);
    assert.equal(stagedPreview.data.after.revision, approvedRevision);
    assert.equal(fs.existsSync(lock), false);
    assertPreserved();
    fs.writeFileSync(approval, JSON.stringify({ ...next.manifest, sha256: '0'.repeat(64) }));
    const changed = await bound.post('apply', approvedRevision, { selectionId: stagedPreview.data.offline.selectionId });
    assert.equal(changed.data.error, 'offline-selection-stale');
    assert.equal(revision(), approvedRevision);
    choose(next);
    await withVerifiedPackage(next.output, next.manifest, ({ repository }) => {
        detachedSource = repository;
        const update = (mode, approval = nextTree) => owner('update-agents.ps1', '-ProjectRoot', project, '-Mode', mode,
            '-UpdateSource', repository, '-ExpectedRevision', nextRevision, '-TrustedRuntimeTree', approval, '-Detailed');
        const preview = update('DryRun');
        assert.equal(preview.status, 0, preview.stderr || preview.stdout);
        assert.match(preview.stdout, /offline-update-planned/);
        assert.match(preview.stdout, new RegExp(nextRevision));
        assert.equal(revision(), approvedRevision);
        assertPreserved();
        assert.equal(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'), initializedGuidance);

        const denied = update('Write', `${nextRevision}:${'0'.repeat(64)}`);
        assert.notEqual(denied.status, 0);
        assert.match(denied.stderr, /Unrecognized offline framework execution tree/);
        assert.equal(revision(), approvedRevision);
        assertPreserved();

        const claimedObject = path.join(repository, 'objects', 'pack', 'pretend.promisor');
        fs.writeFileSync(claimedObject, '');
        const incomplete = update('Write');
        assert.notEqual(incomplete.status, 0);
        assert.match(incomplete.stderr, /complete Git history and objects/);
        fs.unlinkSync(claimedObject);

        const installedOwner = path.join(target, 'scripts', 'update-agents.ps1');
        const originalBytes = fs.readFileSync(installedOwner);
        fs.appendFileSync(installedOwner, '\n# unsaved fixture change\n');
        const dirty = update('Write');
        assert.notEqual(dirty.status, 0);
        assert.match(dirty.stderr, /requires a clean capability checkout/);
        assert.match(fs.readFileSync(installedOwner, 'utf8'), /unsaved fixture change/);
        fs.writeFileSync(installedOwner, originalBytes);

        const diverged = git(target, ['commit-tree', `${approvedRevision}^{tree}`, '-p', approvedRevision, '-m', 'Diverged fixture']);
        moveFixtureHead(diverged, approvedRevision);
        const cannotMerge = update('Write');
        assert.notEqual(cannotMerge.status, 0);
        assert.match(cannotMerge.stderr, /cannot fast-forward/);
        assert.equal(revision(), diverged);
        moveFixtureHead(approvedRevision, diverged);
        assertPreserved();

    });
    assert.equal(fs.existsSync(detachedSource), false);
    const approvedPreview = await bound.post('select', approvedRevision);
    assert.equal(approvedPreview.status, 200, JSON.stringify(approvedPreview.data));
    const stagedApply = await bound.post('apply', approvedRevision, { selectionId: approvedPreview.data.offline.selectionId });
    assert.equal(stagedApply.status, 200, JSON.stringify(stagedApply.data));
    assert.equal(stagedApply.data.after.revision, nextRevision);
    assert.equal(fs.existsSync(lock), false);
    assertPreserved();

    await withVerifiedPackage(next.output, next.manifest, ({ repository }) => {
        detachedSource = repository;
        const ahead = git(target, ['commit-tree', `${nextRevision}^{tree}`, '-p', nextRevision, '-m', 'Ahead fixture']);
        moveFixtureHead(ahead, nextRevision);
        const cannotRewind = owner('update-agents.ps1', '-ProjectRoot', project, '-Mode', 'Write',
            '-UpdateSource', repository, '-ExpectedRevision', nextRevision, '-TrustedRuntimeTree', nextTree);
        assert.notEqual(cannotRewind.status, 0);
        assert.match(cannotRewind.stderr, /cannot fast-forward/);
        assert.equal(revision(), ahead);
        moveFixtureHead(nextRevision, ahead);
    });
    assert.equal(fs.existsSync(detachedSource), false);
    assert.equal(revision(), nextRevision);
    assertPreserved();
    assert.ok(Number(git(target, ['cat-file', '-s', 'HEAD:vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe'])) > 1024 * 1024);
    assert.equal(fs.readFileSync(path.join(project, 'business.txt'), 'utf8'), business['business.txt']);
    assert.equal(fs.readFileSync(path.join(project, '.mcp.json'), 'utf8'), business['.mcp.json']);
    const guidance = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8');
    assert.ok(guidance.startsWith(business['AGENTS.md']));
    assert.match(guidance, /\(\.agents\/docs\/README\.md\)/);

    await withVerifiedPackage(next.output, next.manifest, async ({ repository }) => {
        git(repository, ['config', 'uploadpack.allowFilter', 'true']);
        const vars = {
            GIT_ALLOW_PROTOCOL: 'file', GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: `url.${repository.replaceAll('\\', '/')}.insteadOf`,
            GIT_CONFIG_VALUE_0: 'https://gitee.com/skyler-cook/imedical.agents.git',
        };
        const saved = Object.fromEntries(Object.keys(vars).map(name => [name, process.env[name]]));
        try {
            Object.assign(process.env, vars);
            const online = await bound.post('fetch-preview', nextRevision, {}, true, 'action');
            assert.equal(online.status, 200, JSON.stringify(online.data));
            assert.equal(online.data.exitCode, 0, JSON.stringify(online.data));
            assert.equal(online.data.after.revision, nextRevision);
        } finally {
            for (const [name, value] of Object.entries(saved)) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
            }
        }
    });
});
