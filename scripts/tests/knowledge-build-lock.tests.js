'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createTempDirectory, ownsTempDirectory } = require('./fixtures/temp-directory');

const owner = require.resolve('../lib/knowledge-retrieval');
const protocol = 'knowledge-build-lock/v1';

const interruptLockFixture = String.raw`
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { isMainThread } = require('node:worker_threads');
const crashMarker = process.env.KNOWLEDGE_TEST_CRASH_MARKER;
if (crashMarker) {
    const link = fs.linkSync;
    fs.linkSync = function(source, destination) {
        link(source, destination);
        if (path.resolve(destination) !== path.resolve(crashMarker)) return;
        if (!isMainThread) process.exit(86);
        fs.writeSync(1, JSON.stringify({ published: true, pid: process.pid }) + '\n');
        process.kill(process.pid, 'SIGKILL');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
}
const legacyRace = process.env.KNOWLEDGE_TEST_LEGACY_RACE;
if (legacyRace) {
    const { execFileSync } = require('node:child_process');
    const unlink = fs.unlinkSync;
    fs.unlinkSync = function(file) {
        unlink(file);
        if (path.resolve(file) !== path.resolve(legacyRace)) return;
        const legacy = execFileSync(process.execPath, ['-e', [
            "const fs = require('node:fs');",
            "const file = fs.openSync(process.argv[1], 'wx');",
            "const marker = JSON.stringify({pid:process.pid,created:new Date().toISOString()});",
            "fs.writeFileSync(file, marker); fs.closeSync(file); process.stdout.write(marker);",
        ].join('\n'), legacyRace], {encoding:'utf8', timeout:5000, windowsHide:true});
        fs.writeSync(1, legacy + '\n');
    };
}
`;

const buildInChild = `
const owner = require(${JSON.stringify(owner)});
const root = require('node:worker_threads').workerData?.root ?? process.argv[1];
owner.build({capabilityRoot: root, contextRoot: root}, {
    provider: 'company', settings: {},
    fetch: () => { throw new Error('Network is disabled in this fixture'); },
}).then(({complete, indexed, remainingVectors, embeddingTokens}) => {
    console.log(JSON.stringify({complete, indexed, remainingVectors, embeddingTokens}));
}, error => {
    console.error(error.message);
    process.exitCode = 1;
});
`;

const buildAfterWorkerExit = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Worker } = require('node:worker_threads');
const worker = new Worker(${JSON.stringify(buildInChild)}, {
    eval: true, execArgv: ['--require', process.argv[2]], workerData: {root: process.argv[1]},
});
worker.once('exit', code => {
    assert.equal(code, 86);
    const marker = JSON.parse(fs.readFileSync(process.env.KNOWLEDGE_TEST_CRASH_MARKER, 'utf8'));
    assert.equal(marker.pid, process.pid);
    eval(${JSON.stringify(buildInChild)});
});
`;

function fixture(t) {
    const root = createTempDirectory('knowledge-build-lock-');
    t.after(() => {
        assert.ok(ownsTempDirectory(root));
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    });
    const references = path.join(root, 'plugins/imedical-ui/references');
    fs.mkdirSync(references, { recursive: true });
    fs.writeFileSync(path.join(references, 'synthetic.md'), '# Local fixture\n\nOnly synthetic local content.\n');
    const cache = path.join(root, '.knowledge-cache');
    fs.mkdirSync(cache);
    const index = path.join(cache, 'company.sqlite');
    const preload = path.join(root, 'fixture-publish-crash.cjs');
    fs.writeFileSync(preload, interruptLockFixture);
    return { root, index, preload, lock: index + '.lock', recovery: index + '.lock.recovery',
        guard: index + '.build-guard', ticket: index + '.build-ticket' };
}

function childBuild(f, {crashMarker, legacyRace, workerExit = false} = {}) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(NODE_OPTIONS|NODE_PATH|KNOWLEDGE_RAG_CONFIG|KNOWLEDGE_TEST_.*)$/i.test(name)));
    const preloads = [];
    if (!workerExit && (crashMarker || legacyRace)) preloads.push('--require', f.preload);
    if (crashMarker) env.KNOWLEDGE_TEST_CRASH_MARKER = crashMarker;
    if (legacyRace) env.KNOWLEDGE_TEST_LEGACY_RACE = legacyRace;
    const script = workerExit ? buildAfterWorkerExit : buildInChild;
    const result = spawnSync(process.execPath, [...preloads, '-e', script, f.root, f.preload], {
        cwd: f.root, env, encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    assert.ifError(result.error);
    return result;
}

function crashAt(f, marker) {
    const child = childBuild(f, {crashMarker: marker});
    assert.notEqual(child.status, 0, child.stdout || child.stderr);
    const event = JSON.parse(child.stdout);
    assert.deepEqual(event, { published: true, pid: event.pid });
    assert.ok(Number.isInteger(event.pid) && event.pid > 0);
    assert.throws(() => process.kill(event.pid, 0), { code: 'ESRCH' });
    const saved = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.deepEqual(saved, { protocol, id: saved.id, pid: event.pid, created: saved.created, host: os.hostname() });
    assert.match(saved.id, /^[0-9a-f-]{36}$/u);
    assert.match(saved.created, /^\d{4}-\d{2}-\d{2}T/u);
    assert.ok(fs.lstatSync(f.guard).isFile());
    assert.deepEqual(fs.readFileSync(f.ticket), fs.readFileSync(marker));
    return saved;
}

function assertReopened(f, next = childBuild(f)) {
    assert.equal(next.status, 0, next.stderr || next.stdout);
    assert.deepEqual(JSON.parse(next.stdout), { complete: true, indexed: 1, remainingVectors: 0, embeddingTokens: 0 });
    assert.ok(fs.lstatSync(f.index).isFile());
    assert.ok(fs.lstatSync(f.guard).isFile());
    assert.equal(fs.existsSync(f.lock), false);
    assert.equal(fs.existsSync(f.recovery), false);
    assert.equal(fs.existsSync(f.ticket), false);
}

function assertBusy(f) {
    const result = childBuild(f);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /knowledge-build-busy/u);
    assert.equal(fs.existsSync(f.index), false);
}

test('a process killed immediately after publishing its complete main lock can be reopened', t => {
    const f = fixture(t);
    crashAt(f, f.lock);
    assert.equal(fs.existsSync(f.index), false);
    assert.equal(fs.existsSync(f.recovery), false);
    assertReopened(f);
});

test('a process killed after publishing its recovery lock leaves a recoverable takeover', t => {
    const f = fixture(t);
    const deadOwner = crashAt(f, f.lock);
    const takeover = crashAt(f, f.recovery);
    assert.notEqual(takeover.pid, deadOwner.pid);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.lock, 'utf8')), deadOwner);
    assert.equal(fs.existsSync(f.index), false);
    assertReopened(f);
});

test('a known live legacy owner and malformed legacy main markers remain untouched', t => {
    const f = fixture(t);
    const values = [JSON.stringify({ pid: process.pid, created: new Date().toISOString() }), '', '{invalid'];
    for (const value of values) {
        fs.writeFileSync(f.lock, value);
        assertBusy(f);
        assert.equal(fs.readFileSync(f.lock, 'utf8'), value);
        assert.equal(fs.existsSync(f.recovery), false);
    }
});

test('an empty legacy recovery marker blocks takeover without altering either marker', t => {
    const f = fixture(t);
    crashAt(f, f.lock);
    fs.writeFileSync(f.recovery, '');
    const before = fs.readFileSync(f.lock);
    assertBusy(f);
    assert.deepEqual(fs.readFileSync(f.lock), before);
    assert.equal(fs.readFileSync(f.recovery, 'utf8'), '');
});

test('a legacy creator that wins the takeover gap keeps its exclusive main lock', t => {
    const f = fixture(t);
    const old = crashAt(f, f.lock);
    const contested = childBuild(f, {legacyRace: f.lock});
    assert.equal(contested.status, 1, contested.stderr || contested.stdout);
    assert.match(contested.stderr, /knowledge-build-busy/u);
    const winner = JSON.parse(contested.stdout);
    assert.notEqual(winner.pid, old.pid);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.lock, 'utf8')), winner);
    assert.equal(fs.existsSync(f.index), false);
    assert.equal(fs.existsSync(f.recovery), false);
    assert.equal(fs.existsSync(f.ticket), false);
    assertReopened(f);
});

test('a worker exit releases its guard while its host PID is still alive', t => {
    const f = fixture(t);
    assertReopened(f, childBuild(f, {crashMarker: f.lock, workerExit: true}));
});
