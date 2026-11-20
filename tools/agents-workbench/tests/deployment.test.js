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

function packageCli(cwd, args, nodeArgs = []) {
    const command = path.join(__dirname, '..', 'build', 'build-offline-package.js');
    const result = spawnSync(process.execPath, [...nodeArgs, command, ...args], {
        cwd, encoding: 'utf8', windowsHide: true
    });
    assert.ifError(result.error);
    return result;
}

function verifyArgs(f, manifest) {
    return ['verify', '--package', f.output, '--ref', manifest.ref, '--revision', manifest.revision, '--sha256', manifest.sha256];
}

function rejectedCli(result, diagnostic) {
    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, diagnostic);
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
    const record = path.join(f.root, 'unverified.json');
    rejectedCli(packageCli(f.root, [...verifyArgs(f, manifest), '--release-record', record]), /外部前置对象/);
    assert.equal(fs.existsSync(record), false);
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

test('fixed CLI flags keep stdout and export only verified release metadata to a new JSON file', t => {
    const f = fixture(t);
    const built = packageCli(f.root, ['build', '--source', f.source, '--output', f.output]);
    assert.equal(built.status, 0, built.stderr);
    const manifest = JSON.parse(built.stdout);
    const verify = verifyArgs(f, manifest);
    const verified = packageCli(f.root, verify);
    assert.equal(verified.status, 0, verified.stderr);
    assert.deepEqual(JSON.parse(verified.stdout), manifest);

    const record = '另行发放.JSON';
    const withRecord = packageCli(f.root, [...verify, '--release-record', record]);
    assert.equal(withRecord.status, 0, withRecord.stderr);
    assert.deepEqual(JSON.parse(withRecord.stdout), manifest);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, record), 'utf8')), manifest);

    const decorated = { ...manifest, privateNote: 'metadata outside the release schema' };
    fs.writeFileSync(manifestFile(f.output), JSON.stringify(decorated));
    const other = path.join(f.root, 'verified-absolute.json');
    const absolute = packageCli(f.root, [...verify, '--release-record', other]);
    assert.equal(absolute.status, 0, absolute.stderr);
    assert.deepEqual(JSON.parse(absolute.stdout), decorated);
    assert.deepEqual(JSON.parse(fs.readFileSync(other, 'utf8')), manifest);
    assert.deepEqual(fs.readdirSync(f.output).sort(), ['capability.bundle', 'manifest.json']);
});

test('release record rejects mismatched approval, existing files, and physical package paths', async t => {
    const f = fixture(t);
    const manifest = await buildPackage({ source: f.source, output: f.output });
    const verify = verifyArgs(f, manifest);
    const invalid = path.join(f.root, 'invalid.json');
    for (const change of [{ ref: 'refs/heads/another-branch' }, { revision: f.previous }, { sha256: '0'.repeat(64) }]) {
        rejectedCli(packageCli(f.root, [...verifyArgs(f, { ...manifest, ...change }), '--release-record', invalid]), /清单与批准/);
        assert.equal(fs.existsSync(invalid), false);
    }

    const existing = path.join(f.root, 'existing.json');
    fs.writeFileSync(existing, 'existing record');
    rejectedCli(packageCli(f.root, [...verify, '--release-record', existing]), /发行记录输出已存在/);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'existing record');

    const nested = path.join(f.output, 'nested');
    fs.mkdirSync(nested);
    const alias = path.join(f.root, 'linked-package.json');
    fs.symlinkSync(f.output, alias, process.platform === 'win32' ? 'junction' : 'dir');
    rejectedCli(packageCli(f.root, [...verify, '--release-record', alias]), /发行记录输出已存在/);
    assert.ok(fs.lstatSync(alias).isSymbolicLink());
    for (const parent of [f.output, nested, alias]) {
        const inside = path.join(parent, 'release-record.json');
        rejectedCli(packageCli(f.root, [...verify, '--release-record', inside]), /离线包目录之外/);
        assert.equal(fs.existsSync(inside), false);
    }
});

test('release record removes a partially written file when writing fails', async t => {
    const f = fixture(t);
    const manifest = await buildPackage({ source: f.source, output: f.output });
    const fault = path.join(f.root, 'fixture-write-error.cjs');
    fs.writeFileSync(fault, `const fs = require('node:fs');
fs.writeFileSync = (fd) => {
    fs.writeSync(fd, 'partial record');
    throw Object.assign(new Error('fixture write failure'), { code: 'EIO' });
};
`);
    const output = path.join(f.root, 'release-record.json');
    const before = fs.readdirSync(f.root).sort();
    rejectedCli(packageCli(f.root, [...verifyArgs(f, manifest), '--release-record', output], ['--require', fault]), /EIO/);
    assert.equal(fs.existsSync(output), false);
    assert.deepEqual(fs.readdirSync(f.root).sort(), before);
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

function windowsLineEndings(root, baseEnv) {
    // Use native Git with fixture system and global files, even when a child discards GIT_*.
    const directory = path.join(root, 'Git settings fixture');
    fs.mkdirSync(directory);
    const system = path.join(directory, 'system.gitconfig');
    const global = path.join(directory, 'global.gitconfig');
    fs.writeFileSync(system, '[core]\n\tautocrlf = true\n\teol = crlf\n');
    fs.writeFileSync(global, '');
    const gitExe = execFileSync('where.exe', ['git.exe'], { encoding:'utf8', windowsHide:true }).trim().split(/\r?\n/)[0];
    const compile = String.raw`
$ErrorActionPreference = 'Stop'
$code = @'
using System;
using System.Diagnostics;
using System.Text;
public static class GitFixture {
    static string Quote(string value) {
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in value) {
            if (ch == '\\') { slashes++; continue; }
            result.Append('\\', ch == '"' ? slashes * 2 + 1 : slashes);
            result.Append(ch);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
    public static int Main(string[] args) {
        var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("WORKBENCH_EOL_FIXTURE_REAL_GIT"),
            String.Join(" ", Array.ConvertAll(args, Quote)));
        start.UseShellExecute = false;
        start.EnvironmentVariables["GIT_CONFIG_SYSTEM"] = Environment.GetEnvironmentVariable("WORKBENCH_EOL_FIXTURE_SYSTEM");
        start.EnvironmentVariables["GIT_CONFIG_GLOBAL"] = Environment.GetEnvironmentVariable("WORKBENCH_EOL_FIXTURE_GLOBAL");
        using (var git = Process.Start(start)) { git.WaitForExit(); return git.ExitCode; }
    }
}
'@
Add-Type -TypeDefinition $code -OutputAssembly $env:WORKBENCH_EOL_FIXTURE_EXE -OutputType ConsoleApplication
`;
    execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(compile,'utf16le').toString('base64')], {
        cwd:root, env:{...baseEnv,WORKBENCH_EOL_FIXTURE_EXE:path.join(directory,'git.exe')}, encoding:'utf8', windowsHide:true, timeout:15000,
    });
    const native = Object.fromEntries(Object.entries(baseEnv).filter(([name])=>!/^path$/iu.test(name)));
    Object.assign(native, {
        PATH:[directory,path.dirname(process.execPath),process.env.PATH].join(path.delimiter),
        WORKBENCH_EOL_FIXTURE_REAL_GIT:gitExe, WORKBENCH_EOL_FIXTURE_SYSTEM:system, WORKBENCH_EOL_FIXTURE_GLOBAL:global,
    });
    const caller = {...native,GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'core.autocrlf',GIT_CONFIG_VALUE_0:'false',
        GIT_CONFIG_KEY_1:'core.eol',GIT_CONFIG_VALUE_1:'lf'};
    const readGit = (cwd, env, ...args) => execFileSync(path.join(directory,'git.exe'),['-C',cwd,...args],{
        env,encoding:'utf8',windowsHide:true,timeout:15000,
    }).trim();
    return { native, caller, readGit };
}

async function makeHistoricalBundle(root, name, revision, branch = ref) {
    const source = path.join(root, `${name}.git`);
    const output = path.join(root, name);
    fs.mkdirSync(source);
    git(source, ['init', '--quiet', '--bare', '--template=', '--initial-branch=master']);
    const objects = git(framework, ['rev-parse', '--path-format=absolute', '--git-path', 'objects']);
    fs.writeFileSync(path.join(source, 'objects', 'info', 'alternates'), `${objects}\n`);
    git(source, ['update-ref', branch, revision]);
    return { output, manifest: await buildPackage({ source, ref: branch, revision, output }) };
}

function runOwner(cwd, env, file, ...args) {
    return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], {
        cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout:150000,
    });
}

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

test('staged Workbench installs approved offline objects and leaves installed-project updates to the original owner', {
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
    const makeBundle = (name, revision, branch) => makeHistoricalBundle(root, name, revision, branch);
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
    const owner = (file,...args) => runOwner(project,ownerEnv,path.join(stage,'scripts',file),...args);
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
    const releaseRecord = path.join(root, 'verified-approval.json');
    const issued = packageCli(root, [...verifyArgs(old, old.manifest), '--release-record', releaseRecord]);
    assert.equal(issued.status, 0, issued.stderr);
    bound.choose({ releaseRecord, bundle: path.join(old.output, 'capability.bundle') });
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
    const pickCount = bound.pickCount();
    for (const [action, extra] of [['select', {}], ['apply', { selectionId: selectedInstall.data.offline.selectionId }]]) {
        const retired = await bound.post(action, approvedRevision, extra);
        assert.equal(retired.status, 409);
        assert.equal(retired.data.error, 'framework-update-use-agent');
    }
    for (const action of ['fetch-preview', 'apply']) {
        const retired = await bound.post(action, approvedRevision, {}, true, 'action');
        assert.equal(retired.status, 409);
        assert.equal(retired.data.error, 'framework-update-use-agent');
    }
    assert.equal(bound.pickCount(), pickCount);
    assert.equal(revision(), approvedRevision);
    assertPreserved();
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

        const written = update('Write');
        assert.equal(written.status, 0, written.stderr || written.stdout);
        assert.equal(revision(), nextRevision);
    });
    assert.equal(fs.existsSync(detachedSource), false);
    const reread = await bound.post('refresh', approvedRevision, {}, true, 'action');
    assert.equal(reread.status, 200);
    assert.equal(reread.data.revision, nextRevision);
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

});

test('Windows offline updater preserves the effective caller line endings without changing Git config', {
    skip: process.platform !== 'win32' && 'Windows PowerShell 5.1 required',
}, async t => {
    // Both revisions and pins are from published fixtures, including the historical offline updater.
    const prior = 'afb19d0e980a48ce2c49d945aff11c2120861d3a';
    const priorApproval = prior + ':7465f52d4bb222fe3b07868c50bb8001d75c0d31086fbdf163a259ed52f83e8f';
    const latest = '1cc5b8bc6b7470979867f55f6efb89bb6d1bf69b';
    const targetApproval = latest + ':98db0fe5fd6707cf6c2322f0ee3174865e716983a7225648e6e74d9ec90496c3';
    const app = process.env.WORKBENCH_OFFLINE_OWNER_PILOT_APP;
    const packageDirectory = process.env.WORKBENCH_OFFLINE_OWNER_PILOT_PACKAGE;
    const releaseRecord = process.env.WORKBENCH_OFFLINE_OWNER_PILOT_RECORD;
    assert.equal(Boolean(packageDirectory),Boolean(releaseRecord),'External bundle and independent release record must be provided together');
    const ownerRoot = app ? fs.realpathSync.native(app) : framework;
    let verifyPackage = withVerifiedPackage;
    if (app) {
        assert.equal(fs.existsSync(path.join(ownerRoot,'.git')),false,'Expected the extracted Workbench package');
        const release = JSON.parse(fs.readFileSync(path.join(ownerRoot,'workbench-release.json'),'utf8'));
        assert.equal(release.platform,'windows-x64');
        assert.equal(release.node,process.versions.node);
        assert.equal(fs.realpathSync.native(process.execPath),path.join(ownerRoot,'runtime','node.exe'));
        verifyPackage = require(path.join(ownerRoot,'tools/agents-workbench/build/build-offline-package.js')).withVerifiedPackage;
        t.diagnostic('Running the original installers and verifier from Workbench ' + release.version + ' using its portable Node');
    }
    if ([prior,latest].some(revision=>spawnSync('git',['-C',framework,'cat-file','-e',revision+'^{commit}']).status!==0)) {
        return t.skip('Historical framework fixtures are unavailable in this clone');
    }
    const root = createTempDirectory('offline-caller-line-endings-');
    t.after(() => { assert.ok(ownsTempDirectory(root)); fs.rmSync(root,{recursive:true,force:true,maxRetries:3}); });
    const ownerEnv = Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^(git_.*|psmodulepath|imedical_deployment_lock)$/iu.test(name)));
    ownerEnv.GIT_ALLOW_PROTOCOL = '';
    ownerEnv.PSModulePath = path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules');
    const { native,caller,readGit } = windowsLineEndings(root,ownerEnv);
    const old = await makeHistoricalBundle(root,'historical',prior);
    const current = packageDirectory ? {
        output:fs.realpathSync.native(packageDirectory),
        manifest:JSON.parse(fs.readFileSync(releaseRecord,'utf8').replace(/^\uFEFF/u,'')),
    } : await makeHistoricalBundle(root,'target',latest);
    assert.equal(current.manifest.revision,latest);
    assert.equal(current.manifest.ref,ref);
    const projects = ['原历史更新器','本轮更新器'].map(name=>path.join(root,name));
    const installedUpdate = project => path.join(project,'.agents/scripts/update-agents.ps1');
    const success = result => {
        assert.ifError(result.error);
        assert.equal(result.status,0,(result.stderr || result.stdout || '').slice(-6000));
        return result.stdout;
    };
    await verifyPackage(old.output,old.manifest,({repository})=>{
        for (const project of projects) {
            fs.mkdirSync(project);
            readGit(project,caller,'init','--quiet','--template=');
            fs.writeFileSync(path.join(project,'AGENTS.md'),'# Existing project instructions.\n');
            fs.writeFileSync(path.join(project,'.mcp.json'),'{"mcpServers":{"fixture":{"command":"never-run-this-fixture"}}}\n');
            fs.writeFileSync(path.join(project,'business.txt'),'Preserve isolated business bytes.\r\n');
            success(runOwner(project,caller,path.join(ownerRoot,'scripts/install-agents.ps1'),'-RepositorySource',repository,
                '-ExpectedRevision',prior,'-TrustedRuntimeTree',priorApproval));
            success(runOwner(project,caller,installedUpdate(project),'-ProjectRoot',project,'-Mode','Write','-NoPull'));
        }
    });
    const observe = project => {
        const cap = path.join(project,'.agents');
        assert.equal(readGit(cap,native,'config','--get','core.autocrlf'),'true');
        assert.equal(readGit(cap,native,'config','--get','core.eol'),'crlf');
        assert.equal(readGit(cap,caller,'config','--get','core.autocrlf'),'false');
        assert.equal(readGit(cap,caller,'config','--get','core.eol'),'lf');
        assert.equal(readGit(cap,caller,'rev-parse','HEAD'),prior);
        readGit(cap,caller,'update-ref','refs/remotes/origin/protected',prior);
        fs.writeFileSync(path.join(cap,'.git/FETCH_HEAD'),'fixture FETCH_HEAD survives\r\n');
        fs.writeFileSync(path.join(cap,'config/offline-fixture-private.json'),'{"keep":true}\r\n');
        const files = [path.join(cap,'.git/config'),path.join(cap,'.git/FETCH_HEAD'),
            path.join(cap,'config/offline-fixture-private.json'),...['AGENTS.md','.mcp.json','business.txt'].map(file=>path.join(project,file))];
        const refs = () => readGit(cap,caller,'for-each-ref','--format=%(refname) %(objectname)').split('\n')
            .filter(row=>!row.startsWith(ref+' '));
        const contents = files.map(file=>fs.readFileSync(file));
        const preservedRefs = refs();
        assert.equal(readGit(cap,caller,'status','--porcelain'),'');
        const preserve = () => {
            assert.deepEqual(files.map(file=>fs.readFileSync(file)),contents);
            assert.deepEqual(refs(),preservedRefs);
            assert.doesNotMatch(readGit(cap,caller,'config','--local','--name-only','--list'),/^core\.(autocrlf|eol)$/imu);
        };
        return {cap,preserve};
    };
    const [legacyProject,fixedProject] = projects;
    const legacy = observe(legacyProject);
    const fixed = observe(fixedProject);
    let detachedSource;
    await verifyPackage(current.output,current.manifest,({repository})=>{
        detachedSource = repository;
        const update = (project, entry, mode) => runOwner(project,caller,entry,'-ProjectRoot',project,'-Mode',mode,
            '-UpdateSource',repository,'-ExpectedRevision',latest,'-TrustedRuntimeTree',targetApproval,'-Detailed');
        assert.match(success(update(legacyProject,installedUpdate(legacyProject),'DryRun')),/offline-update-planned/u);
        assert.equal(readGit(legacy.cap,caller,'rev-parse','HEAD'),prior);
        const blocked = update(legacyProject,installedUpdate(legacyProject),'Write');
        assert.ifError(blocked.error);
        assert.equal(blocked.status,1,blocked.stderr || blocked.stdout);
        assert.match(blocked.stderr+'\n'+blocked.stdout,/Cannot refresh a dirty capability checkout/u);
        assert.equal(readGit(legacy.cap,caller,'rev-parse','HEAD'),latest);
        assert.match(readGit(legacy.cap,caller,'status','--porcelain'),/docs\/guides\/capability-guide\.md/u);
        assert.equal(readGit(legacy.cap,native,'status','--porcelain'),'');
        legacy.preserve();
        t.diagnostic('The installed historical owner advanced HEAD and then failed sparse refresh under the caller settings.');

        const repairedOwner = path.join(ownerRoot,'scripts/update-agents.ps1');
        assert.match(success(update(fixedProject,repairedOwner,'DryRun')),/offline-update-planned/u);
        assert.equal(readGit(fixed.cap,caller,'rev-parse','HEAD'),prior);
        fixed.preserve();
        success(update(fixedProject,repairedOwner,'Write'));
        assert.equal(readGit(fixed.cap,caller,'rev-parse','HEAD'),latest);
        assert.equal(readGit(fixed.cap,caller,'status','--porcelain'),'');
        fixed.preserve();
    });
    assert.equal(fs.existsSync(detachedSource),false);
    success(runOwner(fixedProject,caller,installedUpdate(fixedProject),'-ProjectRoot',fixedProject,'-Mode','Check','-NoPull'));
    assert.equal(readGit(fixed.cap,caller,'rev-parse','HEAD'),latest);
    assert.equal(readGit(fixed.cap,caller,'rev-parse','--abbrev-ref','@{upstream}'),'origin/master');
    assert.ok(Number(readGit(fixed.cap,caller,'cat-file','-s','HEAD:vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe'))>1024*1024);
    fixed.preserve();
});
