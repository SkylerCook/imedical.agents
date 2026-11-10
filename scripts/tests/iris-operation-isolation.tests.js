'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createTempDirectory, ownsTempDirectory} = require('./fixtures/temp-directory');
const {SessionManager} = require('../lib/iris-session-manager');
const {makeScope, conflicts, addUnresolved, admit, COOLDOWN_MS} = require('../lib/iris-operation-scope');

const connection = {protocol: 'https:', hostname: 'synthetic.invalid', port: 443, namespace: 'TEST'};
const scopeA = () => makeScope(connection, ['Demo.A.cls']);
const scopeB = () => makeScope(connection, ['Demo.B.cls']);
const otherNamespace = () => makeScope({...connection, namespace: 'OTHER'}, ['Demo.A.cls']);

function fixture(t, {closeReceipt = {cleanupVerified: true, processExited: true}} = {}) {
    const directory = createTempDirectory('iris-operation-isolation-');
    const events = [];
    let clock = 1000;
    const manager = new SessionManager({directory, idleMs: 100, now: () => clock,
        open: async operation => {
            events.push('open:' + operation.label);
            return {
                async call(request) {
                    events.push('call:' + request.label);
                    if (request.wait) await request.wait;
                    if (request.error) throw request.error;
                    return request.label;
                },
                async close() {events.push('close'); return {...closeReceipt};}
            };
        }
    });
    t.after(async () => {
        await manager.stop();
        if (ownsTempDirectory(directory)) fs.rmSync(directory, {recursive: true});
    });
    const call = (label, scope, extra = {}) => manager.submit({pool: 'same-instance', identity: 'same-auth', client: 'project-one',
        ...extra, operation: {label, scope, effects: 'write', ...extra.operation}});
    return {directory, manager, events, call, advance: amount => {clock += amount;}};
}

test('scope identities are opaque, namespace-aware and independent of client credentials', () => {
    const a = makeScope({...connection, auth: 'private-credential'}, ['Demo.A.cls']);
    const same = makeScope({...connection, auth: 'different-credential'}, ['Demo.A.cls']);
    assert.equal(conflicts(a, same), true);
    assert.equal(conflicts(a, scopeB()), false);
    assert.equal(conflicts(a, otherNamespace()), false);
    assert.equal(conflicts(a, makeScope({...connection, hostname: 'other.invalid'}, ['Demo.A.cls'])), false);
    assert.equal(conflicts(a, makeScope({...connection, port: 8443}, ['Demo.A.cls'])), false);
    for (const secret of ['synthetic.invalid', 'TEST', 'Demo.A.cls', 'private-credential']) {
        assert.equal(JSON.stringify(a).includes(secret), false);
    }
    assert.match(a.instance, /^[a-f0-9]{64}$/);
    assert.match(a.namespace, /^[a-f0-9]{64}$/);
    assert.equal(Array.isArray(a.targets), true);
});

test('broad unknown scope protects its namespace while explicit targets use set intersection', () => {
    const broad = makeScope(connection);
    assert.equal(broad.targets, null);
    assert.equal(conflicts(broad, scopeA()), true);
    assert.equal(conflicts(scopeA(), broad), true);
    assert.equal(conflicts(broad, otherNamespace()), false);
    const ab = makeScope(connection, ['Demo.A.cls', 'Demo.B.cls']);
    const bc = makeScope(connection, ['Demo.B.cls', 'Demo.C.cls']);
    assert.equal(conflicts(ab, bc), true);
    assert.equal(conflicts(ab, makeScope(connection, ['Demo.C.cls'])), false);
});

test('unresolved writes preserve independent risks and admit only nonconflicting work', () => {
    const state = {};
    addUnresolved(state, scopeA(), 'response-lost', 1000);
    addUnresolved(state, scopeB(), 'second-response-lost', 1001);
    assert.equal(state.unresolvedWrites.length, 2);
    assert.equal(new Set(state.unresolvedWrites.map(item => item.id)).size, 2);
    assert.equal(admit(state, {effects: 'read-only', scope: scopeA()}, 1002), null);
    assert.equal(admit(state, {effects: 'write', scope: otherNamespace()}, 1002), null);
    assert.equal(admit(state, {effects: 'write', scope: makeScope(connection, ['Demo.C.cls'])}, 1002), null);
    assert.equal(typeof admit(state, {effects: 'write', scope: scopeA()}, 1002), 'string');
    assert.equal(typeof admit(state, {effects: 'write', scope: scopeB()}, 1002), 'string');
    assert.equal(state.unresolvedWrites.length, 2, 'admission must not resolve or replace prior risks');
});

test('unbounded unknown writes retain namespace write protection and allow diagnostics', () => {
    const state = {};
    addUnresolved(state, makeScope(connection), 'arbitrary-execution-unknown', 1000);
    assert.equal(admit(state, {effects: 'read-only', scope: scopeB()}, 1001), null);
    assert.equal(typeof admit(state, {effects: 'write', scope: scopeA()}, 1001), 'string');
    assert.equal(typeof admit(state, {effects: 'write', scope: scopeB()}, 1001), 'string');
    assert.equal(admit(state, {effects: 'write', scope: otherNamespace()}, 1001), null);
});

test('unknown target A does not stop reads or target B and never replays the original write', async t => {
    const f = fixture(t);
    const lost = Object.assign(new Error('write response lost'), {beforeSend: false});
    await assert.rejects(f.call('lost-a', scopeA(), {operation: {error: lost}}), error => error === lost);
    assert.equal(f.manager.status()[0].unresolvedWrites.length, 1);
    assert.equal(await f.call('read-a', scopeA(), {client: 'project-two', operation: {effects: 'read-only'}}), 'read-a');
    assert.equal(await f.call('write-b', scopeB(), {client: 'project-two'}), 'write-b');
    await assert.rejects(f.call('retry-a', scopeA(), {client: 'project-two'}), error => error.beforeSend === true);
    assert.equal(f.events.includes('call:retry-a'), false);
    assert.equal(f.events.filter(value => value === 'call:lost-a').length, 1);
    const lostB = Object.assign(new Error('B response lost'), {beforeSend: false});
    await assert.rejects(f.call('lost-b', scopeB(), {operation: {error: lostB}}), error => error === lostB);
    assert.equal(f.manager.status()[0].unresolvedWrites.length, 2);
    await assert.rejects(f.call('retry-b', scopeB()), error => error.beforeSend === true);
    assert.equal(await f.call('write-other-namespace', otherNamespace()), 'write-other-namespace');
});

test('before-send and definitively rejected writes do not leave pending write protection', async t => {
    const f = fixture(t);
    for (const error of [
        Object.assign(new Error('not sent'), {beforeSend: true}),
        Object.assign(new Error('server rejected'), {beforeSend: false, writeOutcome: 'rejected'})
    ]) {
        await assert.rejects(f.call('known-failure', scopeA(), {operation: {error}}), actual => actual === error);
        assert.equal(f.manager.status()[0].pendingEffects, null);
        assert.equal(f.manager.status()[0].unresolvedWrites.length, 0);
        assert.equal(await f.call('next-write', scopeA()), 'next-write');
    }
});

test('unknown target protection survives restart without blocking unrelated work', async t => {
    const f = fixture(t);
    await assert.rejects(f.call('lost-a', scopeA(), {operation: {error: Object.assign(new Error('lost'), {beforeSend: false})}}));
    await f.manager.stop();
    const events = [];
    const restarted = new SessionManager({directory: f.directory, open: async () => ({
        call: async operation => {events.push(operation.label); return operation.label;},
        close: async () => ({cleanupVerified: true, processExited: true})
    })});
    const call = (label, scope, effects) => restarted.submit({pool: 'same-instance', identity: 'same-auth', client: 'new-project', operation: {label, scope, effects}});
    try {
        assert.equal(restarted.status()[0].unresolvedWrites.length, 1);
        assert.equal(await call('read-a', scopeA(), 'read-only'), 'read-a');
        assert.equal(await call('write-b', scopeB(), 'write'), 'write-b');
        await assert.rejects(call('write-a', scopeA(), 'write'), error => error.beforeSend === true);
        assert.deepEqual(events, ['read-a', 'write-b']);
    } finally {await restarted.stop();}
});

test('unconfirmed logout after local process exit is a warning and the next generation can run', async t => {
    const f = fixture(t, {closeReceipt: {cleanupVerified: false, processExited: true, gracefulExit: true, logoutAcknowledged: false}});
    await f.call('read-first', scopeA(), {operation: {effects: 'read-only'}});
    const closed = await f.manager.close('same-instance');
    assert.equal(closed.exit.cleanupVerified, false);
    assert.equal(closed.pendingEffects, null);
    assert.equal(closed.blocked, null);
    assert.equal(await f.call('next-read', scopeB(), {operation: {effects: 'read-only'}}), 'next-read');
    assert.equal(f.manager.status()[0].generation, 2);
});

test('a process that has not exited is not mistaken for a harmless logout warning', async t => {
    const f = fixture(t, {closeReceipt: {cleanupVerified: false, processExited: false, gracefulExit: false}});
    await f.call('first', scopeA(), {operation: {effects: 'read-only'}});
    await f.manager.close('same-instance');
    await assert.rejects(f.call('next', scopeB(), {operation: {effects: 'read-only'}}), error => error.beforeSend === true);
    assert.equal(f.events.includes('call:next'), false);
});

test('503 cooldown rejects queued work once but a later request can probe without replay', async t => {
    const f = fixture(t);
    assert.equal(COOLDOWN_MS, 5000);
    let release;
    const first = f.call('unavailable', scopeA(), {operation: {effects: 'read-only', wait: new Promise(resolve => {release = resolve;}),
        error: Object.assign(new Error('service unavailable'), {status: 503, beforeSend: false})}});
    const queued = f.call('already-queued', scopeB(), {operation: {effects: 'read-only'}});
    const results = Promise.allSettled([first, queued]);
    release();
    assert.deepEqual((await results).map(result => result.status), ['rejected', 'rejected']);
    await assert.rejects(f.call('during-cooldown', scopeB(), {operation: {effects: 'read-only'}}), error => error.beforeSend === true);
    f.advance(COOLDOWN_MS + 1);
    assert.equal(await f.call('new-probe', scopeB(), {operation: {effects: 'read-only'}}), 'new-probe');
    assert.equal(f.events.filter(value => value === 'call:unavailable').length, 1);
    assert.equal(f.events.includes('call:already-queued'), false);
});

test('cancelling an already sent read does not fence later writes', async t => {
    const f = fixture(t);
    const controller = new AbortController();
    let release;
    const pending = f.call('cancelled-read', scopeA(), {signal: controller.signal, operation: {effects: 'read-only',
        wait: new Promise(resolve => {release = resolve;})}});
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    release();
    await assert.rejects(pending, error => error.beforeSend === false);
    assert.equal(f.manager.status()[0].pendingEffects, null);
    assert.equal(f.manager.status()[0].unresolvedWrites.length, 0);
    assert.equal(await f.call('next-write', scopeA()), 'next-write');
});
