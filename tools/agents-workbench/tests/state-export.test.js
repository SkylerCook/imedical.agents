'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const { createFrameworkService } = require('../src/framework-service');
const { createTempDirectory, ownsTempDirectory } = require('../../../scripts/tests/fixtures/temp-directory');

const canonical = 'https://gitee.com/skyler-cook/imedical.agents.git';
const privateValue = 'workbench-private-sentinel';
const hash = value => createHash('sha256').update(value).digest('hex');

function temporary(t) {
    const directory = createTempDirectory('workbench-state-export-');
    t.after(() => {
        assert.ok(ownsTempDirectory(directory));
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    });
    return directory;
}

function put(root, file, value) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
    return target;
}

function git(root, ...args) {
    return execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function install(root) {
    const capabilityRoot = path.join(root, '.agents');
    put(capabilityRoot, 'scripts/update-agents.ps1', '# Owner fixture\n');
    git(capabilityRoot, 'init', '-q', '-b', 'master');
    git(capabilityRoot, 'add', '--', 'scripts/update-agents.ps1');
    const revision = git(capabilityRoot, 'commit-tree', git(capabilityRoot, 'write-tree'), '-m', 'Installed fixture');
    git(capabilityRoot, 'update-ref', 'refs/heads/master', revision);
    git(capabilityRoot, 'remote', 'add', 'origin', canonical);
    return { capabilityRoot, revision };
}

function receipt(root) {
    const id = randomUUID();
    const oldConfig = JSON.stringify({ password: privateValue });
    const newConfig = JSON.stringify({ token: privateValue, host: 'fixture.example.invalid', namespace: 'PRIVATE' });
    const file = put(root, '.mcp.json', newConfig);
    const beforeHash = hash(oldConfig), afterHash = hash(newConfig);
    const original = Buffer.from(oldConfig).toString('base64');
    const record = put(root, `.ai-dev-config-backups/${id}/receipt.json`, JSON.stringify({
        schema: 1, tool: 'ai-dev-project', projectRoot: root, state: 'prepared', recoveryToken: privateValue,
        entries: [
            { file, beforeHash, afterHash, original },
            { file: path.join(root, '.iris-agentic-dev.toml'), beforeHash: 'absent', afterHash: hash('fixture'), original: '' },
        ],
    }));
    return { row: { id, state: 'prepared', files: 2, updated: fs.statSync(record).mtime.toISOString() },
        sensitive: [file, beforeHash, afterHash, original, 'fixture.example.invalid', 'PRIVATE'], record };
}

async function serve(t, root) {
    const service = createFrameworkService(root, { releaseUpdate: { available: false } });
    const server = http.createServer((req, res) => service.handle(req, res, req.url.slice(1), origin).catch(err => res.destroy(err)));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const headers = { origin, 'x-workbench-request': '1', 'content-type': 'application/json' };
    const post = async (route, body, extras) => {
        const result = await fetch(`${origin}/framework/${route}`, {
            method: 'POST', headers: { ...headers, ...extras }, body: JSON.stringify(body),
        });
        return { status: result.status, type: result.headers.get('content-type'), cookie: result.headers.get('set-cookie'),
            cache: result.headers.get('cache-control'), body: await result.json() };
    };
    const session = await post('session', { token: service.bootstrap });
    assert.equal(session.status, 200);
    const auth = { cookie: session.cookie.split(';')[0], 'x-workbench-csrf': session.body.csrf };
    let snapshot;
    for (let attempt = 0; attempt < 100; attempt++) {
        snapshot = await (await fetch(`${origin}/framework.json`, { headers })).json();
        if (snapshot.status !== 'observing') break;
        await delay(30);
    }
    assert.notEqual(snapshot.status, 'observing');
    const request = { projectId: snapshot.projectId, revision: snapshot.revision };
    return { snapshot, auth, export: (body = {}, extras = auth) => post('export-state', { ...request, ...body }, extras) };
}

test('State export requires the bound session and emits only non-sensitive values for a new project', async t => {
    const directory = temporary(t);
    const root = path.join(directory, privateValue);
    put(root, 'AGENTS.md', privateValue);
    const { row, sensitive, record } = receipt(root);
    const previous = fs.readFileSync(record);
    const window = await serve(t, root);
    const otherRoot = path.join(directory, 'other project');
    fs.mkdirSync(otherRoot);
    const otherWindow = await serve(t, otherRoot);
    assert.equal(window.snapshot.status, 'no-framework');
    assert.equal((await window.export({}, {})).status, 403);
    assert.equal((await window.export({}, { cookie: window.auth.cookie })).status, 403);
    assert.equal((await window.export({}, otherWindow.auth)).status, 403);
    assert.equal((await window.export({}, { ...window.auth, origin: 'http://example.invalid' })).status, 403);
    assert.deepEqual((await window.export({ projectId: otherWindow.snapshot.projectId })).body, { error: 'binding-mismatch' });
    assert.deepEqual((await window.export({ root: path.join(directory, 'other project') })).body, { error: 'invalid-action' });

    const result = await window.export();
    assert.equal(result.status, 200);
    assert.match(result.type, /^application\/json/);
    assert.equal(result.cache, 'no-store');
    assert.deepEqual(Object.keys(result.body), ['schema', 'observedAt', 'framework', 'plugins', 'hosts', 'knowledge', 'configuration']);
    assert.equal(result.body.schema, 'agents-workbench-state/v1');
    assert.equal(new Date(result.body.observedAt).toISOString(), result.body.observedAt);
    assert.deepEqual(result.body.framework, { layout: 'not-installed', revision: null });
    assert.deepEqual(result.body.plugins, { profile: 'absent', counts: { available: 0, enabled: 0, disabled: 0 } });
    assert.deepEqual(result.body.knowledge, { scope: 'none', indexes: [] });
    assert.deepEqual(result.body.hosts.find(host => host.id === 'codex'), { id: 'codex', entryObserved: true });
    assert.deepEqual(result.body.configuration, { receipts: [row], receiptIssue: false });
    const data = JSON.stringify(result.body);
    for (const value of [privateValue, root, ...sensitive, 'recoveryToken', 'restoreFiles', 'projectId', 'binding']) {
        assert.equal(data.includes(value), false);
    }
    assert.deepEqual(fs.readFileSync(record), previous);

    assert.ok(ownsTempDirectory(directory));
    fs.renameSync(root, path.join(directory, 'moved fixture'));
    fs.mkdirSync(root);
    assert.deepEqual((await window.export()).body, { error: 'binding-changed' });
});

test('State export reads installed legacy and JSONC profiles without copying any fields or index content', async t => {
    const root = path.join(temporary(t), privateValue);
    const { capabilityRoot, revision } = install(root);
    const profileContents = '# Plugin Profile\n\n| plugin | status | notes |\n|---|---|---|\n' +
        `| ${privateValue} | initialized | ${privateValue} |\n| sample-disabled | disabled | ${privateValue} |\n`;
    const profile = put(capabilityRoot, 'config/plugin_profile.md', profileContents);
    put(capabilityRoot, '.knowledge-cache/local.sqlite', privateValue);
    put(capabilityRoot, 'vendor/knowledge-index/company.sqlite', privateValue);
    const window = await serve(t, root);
    assert.equal(window.snapshot.status, 'standard');
    assert.deepEqual((await window.export({ revision: 'f'.repeat(40) })).body, { error: 'stale-observation' });
    const { body, status } = await window.export();
    assert.equal(status, 200);
    assert.deepEqual(body.framework, { layout: 'standard', revision });
    assert.deepEqual(body.plugins, { profile: 'legacy-markdown', counts: { available: 0, enabled: 1, disabled: 1 } });
    assert.deepEqual(body.knowledge, { scope: 'local-capability', indexes: [
        { provider: 'openai', cachePresent: false, bundlePresent: false },
        { provider: 'company', cachePresent: false, bundlePresent: true },
        { provider: 'local', cachePresent: true, bundlePresent: false },
    ] });
    assert.equal(JSON.stringify(body).includes(privateValue), false);
    assert.equal(fs.readFileSync(profile, 'utf8'), profileContents);
    put(capabilityRoot, 'config/project.jsonc', `// ${privateValue}\n` + JSON.stringify({
        plugins: { [privateValue]: { status: 'available', secret: privateValue } },
        [privateValue]: privateValue,
    }));
    assert.deepEqual((await window.export()).body.plugins, { profile: 'unreadable' });
    fs.unlinkSync(profile);
    const canonicalExport = await window.export();
    assert.deepEqual(canonicalExport.body.plugins, { profile: 'jsonc', counts: { available: 1, enabled: 0, disabled: 0 } });
    assert.equal(JSON.stringify(canonicalExport.body).includes(privateValue), false);
});

test('Overlay export uses the member ContextRoot and requires the observed shared revision and identity', async t => {
    const directory = temporary(t);
    const standard = path.join(directory, 'fixture standard');
    const { capabilityRoot, revision } = install(standard);
    put(standard, 'AGENTS.md', privateValue);
    const sharedReceipt = receipt(standard);
    put(capabilityRoot, '.knowledge-cache/local.sqlite', privateValue);
    const root = path.join(directory, 'fixture overlay');
    const contextRoot = path.join(root, 'member-context');
    const backend = path.join(root, 'backend');
    fs.mkdirSync(backend, { recursive: true });
    git(backend, 'init', '-q');
    put(root, '.agents/capability.json', JSON.stringify({
        schemaVersion: 1, mode: 'workspace-overlay', workspace: privateValue, contextRoot: 'member-context', capabilityRoot,
        sharedDirectories: [], localDirectories: [], sourceRoots: [{ name: 'backend', path: 'backend', target: backend, gitRoot: backend }],
    }));
    put(contextRoot, 'config/project.jsonc', JSON.stringify({ plugins: { local: { status: 'disabled' } } }));
    put(root, '.opencode/config.json', privateValue);
    const localReceipt = receipt(root);
    const window = await serve(t, root);
    assert.equal(window.snapshot.status, 'overlay-declared');
    const { status, body } = await window.export();
    assert.equal(status, 200);
    assert.deepEqual(body.framework, { layout: 'overlay', revision });
    assert.deepEqual(body.plugins, { profile: 'jsonc', counts: { available: 0, enabled: 0, disabled: 1 } });
    assert.deepEqual(body.hosts.find(host => host.id === 'codex'), { id: 'codex', entryObserved: false });
    assert.deepEqual(body.hosts.find(host => host.id === 'opencode'), { id: 'opencode', entryObserved: true });
    assert.equal(body.knowledge.scope, 'shared-capability');
    assert.equal(body.knowledge.indexes.find(index => index.provider === 'local').cachePresent, true);
    assert.deepEqual(body.configuration, { receipts: [localReceipt.row], receiptIssue: false });
    for (const value of [privateValue, 'fixture overlay', 'fixture standard', 'member-context', sharedReceipt.row.id]) {
        assert.equal(JSON.stringify(body).includes(value), false);
    }

    const next = git(capabilityRoot, 'commit-tree', git(capabilityRoot, 'write-tree'), '-p', revision, '-m', 'Next framework');
    git(capabilityRoot, 'update-ref', 'refs/heads/master', next);
    assert.deepEqual((await window.export()).body, { error: 'stale-observation' });
    git(capabilityRoot, 'update-ref', 'refs/heads/master', revision);
    assert.ok(ownsTempDirectory(directory));
    const moved = path.join(directory, 'moved standard fixture');
    fs.renameSync(standard, moved);
    fs.cpSync(moved, standard, { recursive: true });
    assert.deepEqual((await window.export()).body, { error: 'binding-changed' });
});
