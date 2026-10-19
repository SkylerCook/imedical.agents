'use strict';

// The coordinator owns durable actions/results. Adapters only operate the host
// endpoint and return launch-result/v1-compatible receipts; they do not dispatch.
const REQUIRED_METHODS = Object.freeze(['probe', 'injectContext', 'startOrResume', 'status', 'usage', 'stop']);

function validateClientAdapter(adapter) {
    if (!adapter || REQUIRED_METHODS.some(name => typeof adapter[name] !== 'function')) throw new TypeError(`Client adapter requires ${REQUIRED_METHODS.join(', ')}`);
    return adapter;
}

function createClientAdapter(options = {}) {
    const host = options.host || options.provider;
    if (options.adapter) return validateClientAdapter(options.adapter);
    if (host === 'codex') return require('./night-codex-client').createCodexClientAdapter(options);
    throw new Error(`Client adapter unavailable for ${host || 'unspecified host'}; use supervised execution`);
}

module.exports = { REQUIRED_METHODS, validateClientAdapter, createClientAdapter,
    createCodexClientAdapter: options => require('./night-codex-client').createCodexClientAdapter(options) };
