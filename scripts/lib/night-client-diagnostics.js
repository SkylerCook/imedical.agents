'use strict';
// Persist only this allowlist. Host messages, parameters and response bodies are untrusted.
const METHODS = new Set(['initialize', 'collaborationMode/list', 'thread/start', 'thread/resume', 'thread/read', 'thread/turns/list', 'turn/start', 'turn/interrupt', 'thread/goal/get', 'thread/goal/set', 'account/rateLimits/read']);
const CATEGORIES = new Set(['rpc-rejected', 'rpc-timeout', 'transport-closed', 'transport-failed', 'protocol-invalid']);
const STAGES = new Set(['probe', 'launch', 'status', 'usage', 'restore', 'stop', 'goal-pause', 'active-turn', 'interrupt', 'recovery-stop', 'recovery-status', 'capability', 'command']);
function rpcError(category, method, rpcCode = null) {
    const diagnostic = { provider: 'codex', category: CATEGORIES.has(category) ? category : 'protocol-invalid', method: METHODS.has(method) ? method : 'unknown', rpcCode: Number.isSafeInteger(rpcCode) ? rpcCode : null };
    return Object.assign(new Error('Codex ' + diagnostic.category + ': ' + diagnostic.method + ' (code ' + (diagnostic.rpcCode ?? 'unknown') + ')'), { code: 'night-client-' + diagnostic.category, diagnostic });
}
function diagnosticFields(value, stage) {
    const candidates = Array.isArray(value?.diagnostics) ? value.diagnostics : value?.diagnostic ? [value.diagnostic] : [];
    const diagnostics = candidates.filter(d => d?.provider === 'codex' && CATEGORIES.has(d.category)).slice(0, 16).map(d => ({ provider: 'codex', category: d.category, method: METHODS.has(d.method) ? d.method : 'unknown', rpcCode: Number.isSafeInteger(d.rpcCode) ? d.rpcCode : null, ...(STAGES.has(stage || d.stage) ? { stage: stage || d.stage } : {}) }));
    return diagnostics.length ? { diagnostics } : {};
}
function appendDiagnostics(target, value, stage) {
    for (const d of diagnosticFields(value, stage).diagnostics || []) if (target.length < 16 && !target.some(old => JSON.stringify(old) === JSON.stringify(d))) target.push(d);
}
module.exports = { rpcError, diagnosticFields, appendDiagnostics };
