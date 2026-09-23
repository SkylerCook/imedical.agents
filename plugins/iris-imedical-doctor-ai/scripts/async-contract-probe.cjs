'use strict';
// Test-only instrumentation. It never chooses business completion or retry policy.
function createProbe() {
    const events = [];
    function record(kind, id, value) {
        events.push({ sequence: events.length, kind, id, value });
    }
    function callback(id) {
        const calls = [];
        return {
            calls,
            invoke(handler, payload) {
                if (typeof handler !== 'function') throw new TypeError('callback handler required');
                calls.push(handler);
                record('invoke', id, payload);
                // Deliberately returns undefined, like many native bridge APIs.
            },
            emit(value, index = calls.length - 1) {
                if (!calls[index]) throw new RangeError('no callback at index');
                record('callback', id, value);
                // Allow duplicate and late callbacks to exercise the consumer.
                return calls[index](value);
            }
        };
    }
    function resource(id) {
        record('acquire', id);
        return { release() { record('release', id); } };
    }
    return { events, record, callback, resource };
}
function observe(promise) {
    const state = { status: 'pending' };
    Promise.resolve(promise).then(value => Object.assign(state, { status: 'fulfilled', value }),
        error => Object.assign(state, { status: 'rejected', error }));
    return state;
}
// Yield one event-loop turn, not an elapsed-time or device-completion assertion.
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
module.exports = { createProbe, observe, nextTurn };
