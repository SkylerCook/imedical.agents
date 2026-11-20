'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const { createFrameworkService } = require('../src/framework-service');
const inspectProject = require('../prototype/inspect-project');
const { createProjectSettings } = require('../prototype/project-settings');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');

const canonical = 'https://gitee.com/skyler-cook/imedical.agents.git';

function git(root, ...args) {
    return execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function fixture(t) {
    const directory = createTempDirectory('workbench-update-note-');
    t.after(() => {
        assert.ok(ownsTempDirectory(directory));
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    });
    const root = path.join(directory, 'Standard owner');
    const cap = path.join(root, '.agents');
    fs.mkdirSync(path.join(cap, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(cap, 'scripts', 'update-agents.ps1'), '# Runner fixture\n');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Local rules\n');
    git(cap, 'init', '-q', '-b', 'master');
    git(cap, 'add', '--', 'scripts/update-agents.ps1');
    const revision = git(cap, 'commit-tree', git(cap, 'write-tree'), '-m', 'Installed fixture');
    git(cap, 'update-ref', 'refs/heads/master', revision);
    git(cap, 'remote', 'add', 'origin', canonical);
    git(cap, 'config', 'branch.master.remote', 'origin');
    git(cap, 'config', 'branch.master.merge', 'refs/heads/master');
    return { directory, root, cap, revision };
}

async function start(t, root, readUpdateHead, expectedStatus) {
    const service = createFrameworkService(root, { readUpdateHead, releaseUpdate: { available: false } });
    const server = http.createServer((req, res) => {
        service.handle(req, res, req.url.slice(1), `http://127.0.0.1:${server.address().port}`)
            .catch(error => res.destroy(error));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const headers = { origin, 'x-workbench-request': '1', 'content-type': 'application/json', connection: 'close' };
    const session = await fetch(`${origin}/framework/session`, {
        method: 'POST', headers, body: JSON.stringify({ token: service.bootstrap })
    });
    assert.equal(session.status, 200);
    const auth = { ...headers, cookie: session.headers.get('set-cookie').split(';')[0], 'x-workbench-csrf': (await session.json()).csrf };
    let snapshot;
    for (let attempt = 0; attempt < 40; attempt++) {
        snapshot = await (await fetch(`${origin}/framework.json`, { headers })).json();
        if (snapshot.status !== 'observing') break;
        await delay(50);
    }
    if (expectedStatus) assert.equal(snapshot.status, expectedStatus);
    else assert.ok(['standard', 'overlay-declared'].includes(snapshot.status), snapshot.status);
    const request = { projectId: snapshot.projectId, revision: snapshot.revision };
    return async (overrides, authorized = true, endpoint = 'update-note') => {
        const response = await fetch(`${origin}/framework/${endpoint}`, {
            method: 'POST', headers: authorized ? auth : headers, body: JSON.stringify({ ...request, ...overrides })
        });
        return { status: response.status, body: await response.json() };
    };
}

test('Update note checks project binding, reports upstream state, and never advances or fetches the framework', async t => {
    const { root, cap, revision } = fixture(t);
    const [tree, parent] = [git(cap, 'rev-parse', 'HEAD^{tree}'), revision];
    const next = git(cap, 'commit-tree', tree, '-p', parent, '-m', 'New upstream revision');
    const unrelated = git(cap, 'commit-tree', tree, '-m', 'Unrelated upstream revision');
    let target = next;
    let lookups = 0;
    const request = await start(t, root, async () => {
        lookups++;
        if (!target) throw Error('fixture-private-transport-error');
        return target;
    });
    const indexBefore = fs.readFileSync(path.join(cap, '.git', 'index'));
    assert.equal((await request({}, false)).status, 403);
    assert.equal((await request({ projectId: 'another-session' })).status, 409);
    assert.equal((await request({ revision: next })).body.error, 'stale-observation');
    assert.equal(lookups, 0);

    const updated = await request();
    assert.equal(updated.status, 200);
    assert.equal(updated.body.status, 'update-available');
    assert.equal(updated.body.revision, revision);
    assert.equal(updated.body.targetRevision, next);
    assert.match(updated.body.prompt, /update-agents\.md/);
    assert.match(updated.body.prompt, /取版和写入以用户授权为准/);
    assert.match(updated.body.prompt, /联网 DryRun 可能推进/);
    assert.match(updated.body.prompt, /Check -NoPull/);
    assert.match(updated.body.prompt, /在本会话报告实际框架提交、复查结果和未完成项/);
    assert.doesNotMatch(updated.body.prompt, /重新读取|plugin-deployment\.json|runtime\/node\.exe/);
    assert.match(updated.body.prompt, /模块、医院等共享工作区/);
    assert.match(updated.body.prompt, /项目工作区清单.*workspace-overlay\.md/);

    target = revision;
    assert.equal((await request()).body.status, 'current');
    target = null;
    const offline = await request();
    assert.equal(offline.body.status, 'unavailable');
    assert.match(offline.body.prompt, /批准的离线能力包/);
    assert.match(offline.body.prompt, /独立发行记录.*update-agents\.md.*「离线更新」/);
    assert.match(offline.body.prompt, /sparse-refresh-failed.*「更新中断与续接」/);
    assert.doesNotMatch(offline.body.prompt, /该随包更新器|runtime\/node\.exe/);
    assert.doesNotMatch(JSON.stringify(offline), /fixture-private-transport-error/);
    target = unrelated;
    assert.equal((await request()).body.reason, 'history-not-fast-forward');
    git(cap, 'config', 'branch.master.remote', 'fixture-other-remote');
    const before = lookups;
    assert.equal((await request()).body.reason, 'upstream-unrecognized');
    assert.equal(lookups, before);
    assert.equal(git(cap, 'rev-parse', 'HEAD'), revision);
    assert.deepEqual(fs.readFileSync(path.join(cap, '.git', 'index')), indexBefore);
    assert.equal(fs.existsSync(path.join(cap, '.git', 'FETCH_HEAD')), false);
});

function createMember(directory, cap, name) {
    const root = path.join(directory, name);
    const contextRoot = path.join(root, '.agents');
    const backend = path.join(root, 'backend');
    fs.mkdirSync(contextRoot, { recursive: true });
    fs.mkdirSync(backend);
    git(backend, 'init', '-q');
    fs.writeFileSync(path.join(contextRoot, 'capability.json'), JSON.stringify({
        schemaVersion: 1, mode: 'workspace-overlay', workspace: name, contextRoot: '.agents', capabilityRoot: cap,
        sharedDirectories: [], localDirectories: [],
        sourceRoots: [{ name: 'backend', path: 'backend', target: backend, gitRoot: backend }]
    }));
    return { root, contextRoot };
}

test('Update note uses actual standard registration and scopes an Overlay note to its own member', async t => {
    const { directory, root, cap, revision } = fixture(t);
    const moduleMember = createMember(directory, cap, 'Module member');
    const hospitalMember = createMember(directory, cap, 'Hospital member');
    fs.writeFileSync(path.join(cap, '.git', 'plugin-deployment.json'), JSON.stringify({
        schema: 'plugin-installation/v1', mode: 'full', phase: 'ready', installed: [],
        members: [moduleMember, hospitalMember].map(member => ({
            workspaceRoot: member.root, contextRoot: member.contextRoot, lastRequired: []
        }))
    }));
    const target = 'f'.repeat(40);
    const standard = await start(t, root, async () => target);
    const standardNote = (await standard()).body;
    assert.equal(standardNote.status, 'update-available');
    assert.equal(standardNote.scope, 'standard');
    assert.match(standardNote.prompt, /\.agents\/\.git\/plugin-deployment\.json 的 members/);
    assert.match(standardNote.prompt, /标准根更新一次.*获授权且就绪的成员逐个 -NoPull/);
    assert.doesNotMatch(standardNote.prompt, /Module member|Hospital member/);

    const overlay = await start(t, moduleMember.root, async () => revision);
    const memberNote = (await overlay()).body;
    assert.equal(memberNote.status, 'current');
    assert.equal(memberNote.scope, 'overlay');
    assert.equal(memberNote.revision, revision);
    assert.match(memberNote.prompt, /Standard owner/);
    assert.match(memberNote.prompt, /Module member/);
    assert.match(memberNote.prompt, /只按授权对当前成员做 -NoPull/);
    assert.doesNotMatch(memberNote.prompt, /Hospital member/);
});

test('An offline runtime can copy an update note without a network fixture', async t => {
    const { root, cap, revision } = fixture(t);
    const original = process.env.GIT_ALLOW_PROTOCOL;
    process.env.GIT_ALLOW_PROTOCOL = 'file';
    t.after(() => {
        if (original === undefined) delete process.env.GIT_ALLOW_PROTOCOL;
        else process.env.GIT_ALLOW_PROTOCOL = original;
    });
    const request = await start(t, root);
    const { body } = await request();
    assert.equal(body.status, 'unavailable');
    assert.equal(body.revision, revision);
    assert.equal(body.targetRevision, undefined);
    assert.match(body.prompt, /批准的离线能力包/);
    assert.equal(git(cap, 'rev-parse', 'HEAD'), revision);
    assert.equal(fs.existsSync(path.join(cap, '.git', 'FETCH_HEAD')), false);
});

test('Incomplete or unreadable deployments receive local recovery notes without executing recovery', async t => {
    const cases = [
        { status: 'partial', reason: 'nonstandard-agents', guidance: /可识别的标准 Git 元数据目录/ },
        { status: 'partial', reason: 'updater-missing', guidance: /未找到可用的 .agents\/scripts\/update-agents\.ps1/ },
        { status: 'invalid-head', reason: 'invalid-head', guidance: /HEAD 无法核实/ }
    ];
    for (const { status, reason, guidance } of cases) await t.test(reason, async sub => {
        const { directory, root, cap, revision } = fixture(sub);
        const metadata = path.join(cap, '.git');
        if (reason === 'nonstandard-agents') fs.renameSync(metadata, path.join(directory, 'isolated-git'));
        else if (reason === 'updater-missing') fs.unlinkSync(path.join(cap, 'scripts', 'update-agents.ps1'));
        else fs.writeFileSync(path.join(metadata, 'HEAD'), 'ref: refs/heads/missing\n');
        fs.mkdirSync(path.join(cap, 'config'));
        fs.writeFileSync(path.join(cap, 'config', 'local.jsonc'), '{"value":"private-fixture"}\n');
        fs.writeFileSync(path.join(root, 'business.txt'), 'Existing business file\n');
        const snapshot = () => fs.readdirSync(root, { recursive: true, withFileTypes: true })
            .filter(entry => entry.isFile())
            .map(entry => [path.join(entry.parentPath, entry.name), fs.readFileSync(path.join(entry.parentPath, entry.name))]);
        const before = snapshot();
        let lookups = 0;
        const request = await start(sub, root, async () => { lookups++; return revision; }, status);
        assert.equal((await request({}, false)).status, 403);
        assert.equal((await request({ projectId: 'another-session' })).body.error, 'binding-mismatch');
        assert.equal((await request({ revision: 'f'.repeat(40) })).body.error, 'stale-observation');

        const note = await request();
        assert.equal(note.status, 200);
        assert.equal(note.body.status, 'recovery-required');
        assert.equal(note.body.reason, reason);
        assert.equal(note.body.revision, reason === 'updater-missing' ? revision : null);
        assert.equal(note.body.targetRevision, undefined);
        assert.ok(note.body.prompt.includes(JSON.stringify(root)));
        assert.match(note.body.prompt, guidance);
        assert.match(note.body.prompt, /状态判定.*更新中断与续接/);
        assert.match(note.body.prompt, /DryRun -NoPull.*Write -NoPull.*Check -NoPull/);
        assert.doesNotMatch(note.body.prompt, /private-fixture|重新读取/);
        assert.equal(lookups, 0);
        assert.deepEqual(snapshot(), before);

        const replaced = reason === 'nonstandard-agents' ? cap : metadata;
        const original = path.join(directory, 'original-deployment-location');
        fs.renameSync(replaced, original);
        fs.cpSync(original, replaced, { recursive: true });
        const changed = await request();
        assert.equal(changed.status, 409);
        assert.equal(changed.body.error, 'binding-changed');
        assert.equal(lookups, 0);
    });
});

test('An unrecognized framework source can be diagnosed read-only without exposing its address', async t => {
    const { directory, root, cap, revision } = fixture(t);
    const metadata = path.join(cap, '.git');
    const remote = 'https://fixture-user:fixture-secret@mirror.invalid/agents.git?token=fixture-token';
    git(cap, 'remote', 'set-url', 'origin', remote);
    let lookups = 0;
    const request = await start(t, root, async () => { lookups++; return revision; }, 'unknown-source');
    const snapshot = () => fs.readdirSync(root, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => [path.join(entry.parentPath, entry.name), fs.readFileSync(path.join(entry.parentPath, entry.name))]);
    const before = snapshot();
    assert.equal((await request({}, false)).status, 403);
    assert.equal((await request({ projectId: 'another-session' })).body.error, 'binding-mismatch');
    assert.equal((await request({ revision: 'f'.repeat(40) })).body.error, 'stale-observation');

    const note = await request();
    assert.equal(note.status, 200);
    assert.equal(note.body.status, 'recovery-required');
    assert.equal(note.body.reason, 'unknown-source');
    assert.equal(note.body.revision, revision);
    assert.equal(note.body.targetRevision, undefined);
    assert.ok(note.body.prompt.includes(JSON.stringify(root)));
    assert.match(note.body.prompt, /远端配置、当前分支、跟踪关系、提交历史/);
    assert.match(note.body.prompt, /团队批准.*镜像或离线物料/);
    assert.match(note.body.prompt, /确认.*可信.*授权前.*停止.*运行该副本的脚本/);
    assert.doesNotMatch(JSON.stringify(note.body), /mirror\.invalid|fixture-user|fixture-secret|fixture-token/);

    for (const action of ['install', 'check', 'preview', 'install-index', 'remove-index']) {
        const denied = await request({ action }, true, 'action');
        assert.equal(denied.status, 409);
        assert.equal(denied.body.error, 'unsupported-project');
    }
    assert.equal((await request({ action: 'select' }, true, 'offline')).body.error, 'unsupported-project');
    assert.equal(lookups, 0);
    assert.deepEqual(snapshot(), before);

    git(cap, 'remote', 'set-url', 'origin', canonical);
    assert.equal((await request()).body.status, 'current');
    assert.equal(lookups, 1);

    git(cap, 'remote', 'set-url', 'origin', remote);
    const original = path.join(directory, 'original-source-metadata');
    fs.renameSync(metadata, original);
    fs.cpSync(original, metadata, { recursive: true });
    const changed = await request();
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error, 'binding-changed');
    assert.equal(lookups, 1);
});

test('An invalid Overlay declaration receives the same local-only recovery guidance from both entry points', async t => {
    const { directory, cap, revision } = fixture(t);
    const member = createMember(directory, cap, 'Invalid Overlay member');
    const file = path.join(member.contextRoot, 'capability.json');
    const valid = fs.readFileSync(file);
    const candidate = path.join(directory, 'untrusted-declared-target');
    const token = randomBytes(20).toString('hex');
    const invalid = Buffer.from(JSON.stringify({ ...JSON.parse(valid), schemaVersion: 999,
        contextRoot: candidate, capabilityRoot: candidate, token,
        sourceRoots: [{ name: 'private-declaration-source', path: 'backend', target: candidate, gitRoot: candidate }] }));
    fs.writeFileSync(file, invalid);

    const probes = [];
    for (const method of ['existsSync', 'lstatSync', 'statSync', 'readFileSync']) {
        const original = fs[method];
        t.mock.method(fs, method, (file, ...options) => {
            if (typeof file === 'string' && (file === candidate || file.startsWith(candidate + path.sep))) probes.push(file);
            return original(file, ...options);
        });
    }
    const summary = inspectProject(member.root);
    assert.match(summary.configIssue, /capability\.json/);
    assert.throws(() => createProjectSettings(member.root).inspect(), /capability\.json/);
    assert.deepEqual(probes, []);

    let lookups = 0;
    const lookup = async () => { lookups++; return revision; };
    const request = await start(t, member.root, lookup, 'invalid-declaration');
    const task = { revision: undefined, purpose: 'task', task: 'recovery-diagnosis' };
    assert.equal((await request({}, false)).status, 403);
    assert.equal((await request(task, false, 'agent-handoff')).status, 403);
    assert.equal((await request({ projectId: 'another-session' })).body.error, 'binding-mismatch');
    assert.equal((await request({ revision })).body.error, 'stale-observation');
    const note = await request();
    assert.equal(note.status, 200);
    assert.equal(note.body.status, 'recovery-required');
    assert.equal(note.body.reason, 'invalid-declaration');
    assert.equal(note.body.revision, null);
    assert.ok(note.body.prompt.includes(JSON.stringify(file)));
    assert.match(note.body.prompt, /workspace-overlay\.md/);
    assert.match(note.body.prompt, /勿从声明猜测标准根、访问候选路径、运行脚本或取版/);
    assert.doesNotMatch(note.body.prompt, /untrusted-declared-target|private-declaration|DryRun|Write -NoPull/);
    assert.ok(!note.body.prompt.includes(token));
    const handoff = await request(task, true, 'agent-handoff');
    assert.equal(handoff.status, 200);
    assert.equal(handoff.body.prompt, note.body.prompt);
    const receiptId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const selected = await request({ ...task, item: receiptId }, true, 'agent-handoff');
    assert.equal(selected.status, 200);
    assert.equal(selected.body.prompt, note.body.prompt);
    assert.equal((await request({ action: 'install' }, true, 'action')).body.error, 'unsupported-project');
    assert.equal((await request({ action: 'check' }, true, 'action')).body.error, 'unsupported-project');
    assert.equal((await request({ action: 'select' }, true, 'offline')).body.error, 'unsupported-project');
    assert.equal(lookups, 0);
    assert.deepEqual(fs.readFileSync(file), invalid);
    assert.equal(git(cap, 'rev-parse', 'HEAD'), revision);

    fs.writeFileSync(file, valid);
    const stale = await request({ action: 'refresh' }, true, 'action');
    assert.equal(stale.body.status, 'binding-changed');
    assert.equal((await request()).body.error, 'binding-changed');
    const reopened = await start(t, member.root, lookup, 'overlay-declared');
    const current = (await reopened()).body;
    assert.equal(current.status, 'current');
    assert.equal(current.scope, 'overlay');
    assert.equal(current.revision, revision);
    assert.equal(lookups, 1);
});
