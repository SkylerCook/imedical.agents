'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProbe, observe, nextTurn } = require('../../plugins/iris-imedical-doctor-ai/scripts/async-contract-probe.cjs');

test('undefined return does not settle an independently observed operation', async () => {
    const probe = createProbe(), bridge = probe.callback('device');
    const resource = probe.resource('frame');
    const state = observe(new Promise(resolve => {
        assert.equal(bridge.invoke(resolve, { id: 'synthetic' }), undefined);
    }).then(() => resource.release()));
    await nextTurn();
    assert.equal(state.status, 'pending');
    assert.equal(probe.events.some(e => e.kind === 'release'), false);
    bridge.emit('done');
    await nextTurn();
    assert.equal(state.status, 'fulfilled');
    assert.deepEqual(probe.events.map(e => e.kind), ['acquire', 'invoke', 'callback', 'release']);
});

test('duplicate, late and indexed callbacks are exposed without hiding consumer bugs', () => {
    const probe = createProbe(), bridge = probe.callback('device'), received = [];
    bridge.invoke(value => received.push(['first', value]));
    bridge.invoke(value => received.push(['second', value]));
    bridge.emit(1, 0); bridge.emit(1, 0); bridge.emit(2);
    assert.deepEqual(received, [['first', 1], ['first', 1], ['second', 2]]);
    assert.throws(() => bridge.emit(0, 5), RangeError);
    assert.throws(() => bridge.invoke(null), TypeError);
});

test('no callback stays pending; explicit consumer cancellation is observable', async () => {
    const bridge = createProbe().callback('device');
    let cancel;
    const state = observe(new Promise((resolve, reject) => {
        bridge.invoke(resolve); cancel = reject;
    }));
    await nextTurn();
    assert.equal(state.status, 'pending');
    cancel(new Error('unknown outcome'));
    await nextTurn();
    assert.equal(state.status, 'rejected');
    bridge.emit('late');
    await nextTurn();
    assert.equal(state.status, 'rejected');
});

test('event trace detects premature release in a deliberately broken consumer', async () => {
    const probe = createProbe(), bridge = probe.callback('device'), resource = probe.resource('frame');
    await bridge.invoke(() => {});
    resource.release();
    bridge.emit('done');
    const kinds = probe.events.map(e => e.kind);
    assert.throws(() => assert.ok(kinds.indexOf('callback') < kinds.indexOf('release')));
});
