'use strict';
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const remote = require('./iris-remote-operations');

function normalizeConnection(input = {}) {
  const protocol = String(input.protocol || input.scheme || 'https').replace(/:$/, '') + ':';
  const hostname = input.hostname || input.host;
  const port = Number(input.port || (protocol === 'https:' ? 443 : 80));
  let base = input.path || (input.namespace ? '/api/atelier/v1/' + encodeURIComponent(input.namespace) + '/' : '');
  base = base.replace(/(?:action\/compile.*|doc\/.*|docs(?:\?.*)?)$/, '');
  if (!base.endsWith('/')) base += '/';
  if (!['http:', 'https:'].includes(protocol) || !hostname || !Number.isInteger(port) || port < 1 || port > 65535 || !/^\/.*\/api\/atelier\//.test('/' + base) && !base.startsWith('/api/atelier/') || /[\r\n]/.test(base)) throw new remote.RemoteOperationError('atelier-connection-invalid');
  return { protocol, hostname, port, path: base, auth: input.auth || (input.username ? input.username + ':' + (input.password || '') : undefined), rejectUnauthorized: input.rejectUnauthorized ?? input.tlsVerify ?? true,
    ...(input.ca ? { ca: input.ca } : {}) };
}
function createAtelierClient({ connection, context, policy, qualification, owner: sharedOwner, timeoutMs = 60000, maxResponseBytes = 16 * 1024 * 1024 } = {}) {
  remote.assertRemoteAllowed(context || {});
  const conn = normalizeConnection(connection);
  const selected = remote.loadRemotePolicy(context || {}, { connection: conn, policy, qualification });
  const owner = sharedOwner || remote.createRemoteOperation({ policy: selected, connection: conn, channel: 'atelier' });
  const agent = conn.protocol === 'https:' ? new https.Agent({ keepAlive: true, maxSockets: 1, rejectUnauthorized: conn.rejectUnauthorized, ...(conn.ca ? { ca: conn.ca } : {}) }) : new http.Agent({ keepAlive: true, maxSockets: 1 });
  const cookies = new Map();
  const qualificationReads = qualification ? new Set(qualification.documents.map(name => 'doc/' + encodeURIComponent(name))) : null;
  const qualificationSeen = new Set(), qualificationDeadline = qualification ? Date.now() + qualification.budgetMs : null;
  const logoutPath = conn.path.slice(0, conn.path.lastIndexOf('/api/atelier/') + '/api/atelier/'.length) + '?CacheLogout=end';
  const serverInfoPath = logoutPath.slice(0, logoutPath.indexOf('?'));
  let busy = false, closed = false, closing;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) throw new remote.RemoteOperationError('atelier-limits-invalid');
  function raw(method, suffix, body, headers = {}, options = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      let sent = false;
      const fail = (code, details = {}) => reject(new remote.RemoteOperationError(code, { beforeSend: !sent, ...details }));
      const authenticatedHeaders = cookies.size || options.logout ? Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'authorization')) : headers;
      const request = (conn.protocol === 'https:' ? https : http).request({ ...conn, path: options.logout ? logoutPath : options.serverInfo ? serverInfoPath : conn.path + suffix, method, agent,
        auth: cookies.size || options.logout ? undefined : conn.auth, headers: { Accept: 'application/json', ...authenticatedHeaders,
          ...(cookies.size ? { Cookie: [...cookies].map(([name, value]) => name + '=' + value).join('; ') } : {}),
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) } }, response => {
        for (const value of response.headers['set-cookie'] || []) {
          const pair = value.split(';')[0], position = pair.indexOf('=');
          if (position > 0) { const name = pair.slice(0, position), content = pair.slice(position + 1); if (/max-age=0/i.test(value) || !content) cookies.delete(name); else cookies.set(name, content); }
        }
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > maxResponseBytes) request.destroy(Object.assign(new Error('atelier-response-too-large'), {code:'ATELIER_RESPONSE_TOO_LARGE'})); else chunks.push(chunk); });
        response.on('error', () => fail('atelier-response-error'));
        response.on('end', () => {
          const status = response.statusCode;
          if (options.logout) return resolve({ httpStatus: status, responseReceived: true });
          if (method === 'GET' && status === 404) return resolve(null);
          if (method === 'GET' && status === 304) return resolve({ notModified: true });
          if (status < 200 || status >= 300) return fail('atelier-http-failed', { status, writeOutcome: status >= 400 && status < 500 ? 'rejected' : 'unknown' });
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!options.allowErrors && (result.status?.errors?.length || result.status?.summary || result.result?.status && result.result.status !== 'OK')) return fail('atelier-remote-error', { status, writeOutcome: 'unknown' });
            resolve(result);
          } catch { fail('atelier-response-invalid'); }
        });
      });
      const timer = setTimeout(() => request.destroy(Object.assign(new Error('atelier-deadline'), {code:'ATELIER_DEADLINE'})), options.timeoutMs || timeoutMs);
      request.on('close', () => clearTimeout(timer));
      request.on('error', error => fail(error.code === 'ATELIER_DEADLINE' ? 'atelier-deadline-outcome-unknown' : 'atelier-transport-unknown', { transportCode: /^[A-Z][A-Z0-9_]+$/.test(error.code || '') ? error.code : 'TRANSPORT_ERROR' }));
      sent = true; request.end(data);
    });
  }
  async function request(method, suffix, body, headers = {}, options = {}) {
    remote.assertRemoteAllowed(context || {});
    if (closed || closing) throw new remote.RemoteOperationError('atelier-client-closed', { beforeSend: true });
    if (busy) throw new remote.RemoteOperationError('atelier-client-busy', { beforeSend: true });
    if (qualificationReads) {
      const allowed = qualificationReads.has(suffix) || suffix === '@server-info' && options.serverInfo === true;
      if (method !== 'GET' || !allowed || qualificationSeen.has(suffix) || options.effects && options.effects !== 'read-only') throw new remote.RemoteOperationError('atelier-qualification-read-only', {beforeSend: true});
      if (Date.now() >= qualificationDeadline) throw new remote.RemoteOperationError('atelier-qualification-deadline', {beforeSend: true});
      qualificationSeen.add(suffix);
      options = {...options, effects: 'read-only', timeoutMs: Math.max(1, Math.min(options.timeoutMs || timeoutMs, qualificationDeadline - Date.now()))};
    }
    busy = true;
    try { return await owner.run({ effects: options.effects || (['GET', 'HEAD'].includes(method) || suffix === 'docs' ? 'read-only' : 'write'), operation: options.operation || 'atelier-' + method.toLowerCase(), method, suffix }, () => raw(method, suffix, body, headers, options)); }
    finally { busy = false; }
  }
  function document(name, result) {
    if (result === null || result.notModified) return result;
    const value = result.result;
    if (value?.name && value.name !== name) throw new remote.RemoteOperationError('atelier-document-identity-mismatch');
    if (!value || !Array.isArray(value.content) || !value.content.every(line => typeof line === 'string') || typeof value.ts !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(value.ts)) throw new remote.RemoteOperationError('atelier-document-invalid');
    const bytes = value.enc ? Buffer.concat(value.content.map(line => Buffer.from(line, 'base64'))) : Buffer.from(value.content.join('\n'), 'utf8');
    return { document: name, content: bytes, bytes, text: bytes.toString('utf8'), lines: value.content, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), ts: value.ts, db: value.db || '', enc: !!value.enc, representation: value.enc ? 'atelier-binary' : 'atelier-text-utf8' };
  }
  async function readDocument(name, options = {}) {
    const identifier = typeof name === 'string' ? name : name.remotePath;
    return document(identifier, await request('GET', 'doc/' + encodeURIComponent(identifier) + (options.binary ? '?binary=1' : ''), undefined, options.headers || {}, { effects: 'read-only', ...(options.timeoutMs ? {timeoutMs: options.timeoutMs} : {}) }));
  }
  async function readDocuments(names) {
    const result = await request('POST', 'docs', names, {}, { effects: 'read-only' });
    if (!Array.isArray(result?.result?.content) || result.result.content.length !== names.length) throw new remote.RemoteOperationError('atelier-batch-incomplete');
    const entries = new Map();
    for (const entry of result.result.content) {
      if (entry.status || !names.includes(entry.name) || entries.has(entry.name)) throw new remote.RemoteOperationError('atelier-document-error');
      entries.set(entry.name, entry);
    }
    return names.map(name => document(name, {result:entries.get(name)}));
  }
  async function serverInfo() {
    const result = await request('GET', '@server-info', undefined, {}, {effects: 'read-only', serverInfo: true});
    const value = result?.result?.content;
    if (!value || typeof value.version !== 'string' || !value.version || value.version.length > 2048 ||
        value.id !== undefined && typeof value.id !== 'string') throw new remote.RemoteOperationError('atelier-server-info-invalid');
    return {version: value.version, instanceId: value.id || null, api: value.api ?? null};
  }
  async function writeDocument(name, bytes, { ts } = {}) {
    if (Buffer.isBuffer(bytes)) new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(bytes);
    const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
    return request('PUT', 'doc/' + encodeURIComponent(name), { enc: false, content: text.split('\n') }, ts ? { 'IF-NONE-MATCH': ts } : {}, { effects: 'write' });
  }
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      let exit = { logoutRequested: false, logoutResponseReceived: false, cleanupVerified: !busy, licenseReleaseVerified: false };
      try {
        if (busy) { owner.markUnknown('atelier-owner-exit-in-flight'); exit.cleanupVerified = false; }
        else if ([...cookies.keys()].some(name => /^CSPSESSION/i.test(name))) {
          exit.logoutRequested = true;
          const result = await raw('HEAD', '', undefined, {}, { logout: true, timeoutMs: Math.min(timeoutMs, 10000) });
          exit.logoutResponseReceived = result.responseReceived;
          exit.logoutHttpStatus = result.httpStatus;
          exit.cleanupVerified = result.httpStatus >= 200 && result.httpStatus < 500;
        }
      } catch { exit.cleanupVerified = false; }
      finally { closed = true; cookies.clear(); agent.destroy(); }
      if (!exit.cleanupVerified && selected.enabled) owner.markUnknown('remote-session-exit-unverified');
      return sharedOwner ? { ...owner.snapshot(), ...exit } : owner.close(exit);
    })();
    return closing;
  }
  return { request, readDocument, readDocuments, serverInfo, writeDocument, compile: documents => request('POST', 'action/compile?flags=cuk&source=0', documents, {}, {effects:'write',allowErrors:true}), close,
    markUnknown: reason => owner.markUnknown(reason), snapshot: () => ({ ...owner.snapshot(), cookiePresent: cookies.size > 0, closed }) };
}
function createAtelierRecoveryReader({connection, context, policy, documents, token, confirmRecovery, timeoutMs, maxResponseBytes} = {}) {
  remote.assertRemoteAllowed(context || {});
  const conn = normalizeConnection(connection), selected = remote.loadRemotePolicy(context || {}, {connection:conn, policy});
  const owner = remote.createRecoveryReadOperation({policy:selected, connection:conn, documents, token, confirmRecovery});
  const client = createAtelierClient({connection:conn, context, policy:selected, owner, timeoutMs, maxResponseBytes});
  const denied = async () => { throw new remote.RemoteOperationError('remote-recovery-read-only', {beforeSend:true}); };
  return {async readDocument(name) { try { return await client.readDocument(name); } catch (error) { if (owner.snapshot().reads.length) owner.markUnknown(error.code || 'remote-inspection-document-invalid'); throw error; } }, request:denied, readDocuments:denied, writeDocument:denied, compile:denied,
    snapshot:owner.snapshot,
    async close() { let exit; try { exit = await client.close(); } finally { exit = owner.close(exit || {cleanupVerified:false}); } return exit; }};
}
module.exports = { normalizeConnection, createAtelierClient, createAtelierRecoveryReader };
