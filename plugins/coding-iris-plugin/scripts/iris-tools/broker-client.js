'use strict';

const http = require('node:http');
const https = require('node:https');
const { isDeepStrictEqual } = require('node:util');

function matchesAssertions(body, assertions) {
    return assertions.every(assertion => {
        let value = body;
        for (const key of assertion.path) {
            if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return false;
            value = value[key];
        }
        return isDeepStrictEqual(value, assertion.equals);
    });
}

async function callBrokerTransport(options) {
    const { className, methodName, role, effects, authorization, signal } = options;
    const timeoutMs = options.timeoutMs ?? 30000;
    const maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024;
    const result = { schema: 'iris-broker-result/v1', status: 'rejected', transport: 'not-sent', httpStatus: null,
        authentication: 'unknown', business: 'not-asserted', outcome: 'not-executed', errorCode: null };
    function reject(code) { return { ...result, errorCode: code }; }
    let url;
    try { url = new URL(options.url); } catch { return reject('invalid-target'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) return reject('invalid-target');
    if (!className || !methodName || !role || !['read-only', 'write'].includes(effects)) return reject('unverified-effect');
    if (!options.effectEvidence || options.effectEvidence.className !== className || options.effectEvidence.methodName !== methodName || options.effectEvidence.role !== role || options.effectEvidence.effects !== effects || !options.effectEvidence.reference) return reject('effect-evidence-mismatch');
    if (effects === 'write' && (authorization?.write !== true || !authorization.reference || authorization.className !== className || authorization.methodName !== methodName || authorization.role !== role)) return reject('write-not-authorized');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) return reject('invalid-limits');
    if (options.assertions !== undefined && (!Array.isArray(options.assertions) || !options.assertions.length || options.assertions.some(a => !a || !Array.isArray(a.path) || a.path.some(k => typeof k !== 'string') || !Object.hasOwn(a, 'equals')))) return reject('invalid-assertions');
    if (options.params !== undefined && (!options.params || Array.isArray(options.params) || typeof options.params !== 'object')) return reject('invalid-params');
    const form = new URLSearchParams({ ClassName: className, MethodName: methodName });
    for (const [key, value] of Object.entries(options.params || {})) {
        if (/^(classname|methodname)$/i.test(key) || !['string', 'number', 'boolean'].includes(typeof value)) return reject('invalid-params');
        form.append(key, String(value));
    }
    if (signal?.aborted) return reject('cancelled-before-send');
    const headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded',
        RESPONSE_JSON: '1', 'X-Requested-With': 'XMLHttpRequest', MW_TIME_STAMP: String(Date.now()) };
    if (options.token) headers.MW_TOKEN = options.token;
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.requestPage) headers.REQUEST_PAGE = options.requestPage;
    // Authentication and raw responses remain inside this invocation, never in result metadata.
    return new Promise(resolve => {
        let req, timer, settled = false, bytes = 0;
        function finish(code) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            if (code) {
                result.status = 'review-pending'; result.errorCode = code;
                result.transport = 'unknown'; result.outcome = 'unknown';
            }
            resolve({ ...result });
        }
        function abort() { req?.destroy(); finish('cancelled'); }
        try {
            req = (url.protocol === 'https:' ? https : http).request(url, {
                method: 'POST', headers, rejectUnauthorized: true, ...(options.ca ? { ca: options.ca } : {})
            }, res => {
                const chunks = [];
                result.httpStatus = res.statusCode;
                res.on('data', chunk => {
                    bytes += chunk.length;
                    if (bytes > maxResponseBytes) { res.destroy(); req.destroy(); finish('response-too-large'); }
                    else chunks.push(chunk);
                });
                res.on('aborted', () => finish('response-aborted'));
                res.on('error', () => finish('response-error'));
                res.on('end', async () => {
                    if (settled) return;
                    result.transport = 'received';
                    if ([401, 403].includes(res.statusCode)) {
                        result.authentication = 'rejected'; result.status = 'failed'; result.outcome = 'unknown'; finish(); return;
                    }
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        result.status = 'failed'; result.outcome = 'unknown'; finish(); return;
                    }
                    let body;
                    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
                    catch { finish('non-json-response'); return; }
                    try {
                        if (options.classifyAuthentication && await options.classifyAuthentication(body) === 'rejected') {
                            if (settled) return;
                            result.authentication = 'rejected'; result.status = 'failed'; result.outcome = 'unknown'; finish(); return;
                        }
                        if (options.inspectResponse) await options.inspectResponse(body);
                        if (settled) return;
                        if (options.assertBusiness || options.assertions) {
                            const passed = options.assertBusiness ? await options.assertBusiness(body) === true : matchesAssertions(body, options.assertions);
                            if (settled) return;
                            result.business = passed ? 'passed' : 'failed'; result.status = passed ? 'passed' : 'failed';
                            result.outcome = passed ? 'confirmed' : 'unknown';
                        } else { result.status = 'transport-ok'; result.outcome = 'unverified'; }
                        finish();
                    } catch { finish('assertion-or-evidence-error'); }
                });
            });
            req.on('error', () => finish('request-error'));
            signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => { req.destroy(); finish('timeout'); }, timeoutMs);
            req.end(form.toString());
        } catch { req?.destroy(); finish('request-setup-error'); }
    });
}

async function callBroker(options) {
    let url;
    try { url = new URL(options.url); } catch { return callBrokerTransport(options); }
    const remote = require('../../../../scripts/lib/iris-remote-operations');
    const context = options.context || require('../../../../scripts/lib/workspace-context').resolveWorkspaceContext(options.projectRoot || process.cwd());
    let owner, result;
    try {
        const connection = { protocol: url.protocol, hostname: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), rejectUnauthorized: true };
        const policy = remote.loadRemotePolicy(context, {connection});
        if (policy.enabled && (!options.cookie || typeof options.sessionOwnerReference !== 'string' || !options.sessionOwnerReference.trim())) {
            throw new remote.RemoteOperationError('remote-broker-session-owner-required');
        }
        owner = options.remoteOwner || remote.createRemoteOperation({policy, connection, channel: 'broker'});
        result = await owner.run({effects: options.effects || 'read-only', operation: 'broker-method'}, async () => {
            const value = await callBrokerTransport(options);
            if (value.httpStatus === 503 || options.effects === 'write' && value.outcome === 'unknown' && value.transport !== 'not-sent') {
                throw Object.assign(new Error('remote-broker-outcome-unverified'), {status: value.httpStatus, result: value});
            }
            return value;
        });
    } catch (error) {
        result = error.result || { schema: 'iris-broker-result/v1', status: 'rejected', transport: 'not-sent', httpStatus: null,
            authentication: 'unknown', business: 'not-asserted', outcome: 'not-executed', errorCode: error.code || 'remote-admission-rejected' };
    } finally {
        if (owner && !options.remoteOwner) {
            const exit = owner.close({ borrowedSession: !!options.cookie, sessionExitOwner: options.cookie ? 'caller' : 'legacy', cleanupVerified: true });
            if (result) result.remoteOperation = exit;
        }
    }
    return result;
}
module.exports = { callBroker, matchesAssertions };
