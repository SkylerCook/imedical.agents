'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {createSession, verifiedPut} = require('../sftp-worker');

function fixture(options = {}) {
    let spawns = 0;
    const progress = [];
    const session = createSession('unused', 'worker.py', {}, {
        ...options, progress: event => progress.push(event),
        spawnProcess(command, args, settings) {
            spawns++;
            assert.deepEqual(args, ['-B', 'worker.py', '--session']);
            return spawn(process.execPath, [path.join(__dirname, 'fixtures/sftp-session.cjs')], settings);
        }
    });
    return {session, progress, spawns: () => spawns};
}

test('one process handles sequential requests, filters progress, and closes idempotently', async () => {
    const f = fixture();
    try {
        const a = await f.session.request({mode: 'read'});
        const b = await f.session.request({mode: 'read'});
        assert.equal(a.pid, b.pid);
        assert.equal(f.spawns(), 1);
        assert.equal(f.session.stats.counts.connections, 1);
        assert.ok(f.progress.some(e => e.stage === 'compare'));
        assert.ok(!JSON.stringify(f.progress).includes('private'));
    } finally {
        await f.session.close();
        await f.session.close();
    }
});

test('timeout terminates the session and cannot silently restart', async () => {
    const f = fixture({timeoutMs: 1500});
    try {
        await assert.rejects(f.session.request({mode: 'hang'}), /inspect remote/);
        await assert.rejects(f.session.request({mode: 'read'}), /unavailable/);
        assert.equal(f.spawns(), 1);
    } finally { await f.session.close(); }
});

test('crash retains completed files and exact pending temporary evidence', async () => {
    const f = fixture();
    try {
        await assert.rejects(f.session.request({mode: 'crash'}), error => {
            assert.equal(error.fileResults.get(0).verified, true);
            assert.equal(error.activeIndex, 1);
            assert.deepEqual(error.transport.cleanupPending, ['/web/b.js.imedical-test.tmp']);
            return true;
        });
    } finally { await f.session.close(); }
});

test('evidence must bind final destination and bytes; legacy adapters still read back', () => {
    const f = {remotePath: '/web/a', bytes: Buffer.from('x')};
    const hash = () => 'digest';
    const evidence = {status: 'verified', verification: 'final-target-sha256', remotePath: f.remotePath, sha256: 'digest'};
    assert.equal(verifiedPut(evidence, f, hash), true);
    assert.equal(verifiedPut(undefined, f, hash), false);
    assert.throws(() => verifiedPut({...evidence, remotePath: '/web/b'}, f, hash));
    assert.throws(() => verifiedPut({...evidence, verification: 'temporary'}, f, hash));
});
