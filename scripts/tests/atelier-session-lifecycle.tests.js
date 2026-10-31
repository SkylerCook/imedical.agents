'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {createAtelierClient} = require('../lib/atelier-client');
const remote = require('../lib/iris-remote-operations');

test('format compatibility requires an explicit binding to the verified instance', () => {
  const connection={protocol:'https:',hostname:'example.invalid',port:443};
  assert.equal(remote.sessionCookieFormat({},connection),'opaque');
  assert.throws(()=>remote.sessionCookieFormat({sessionCookieFormat:'guessed'},connection), e=>e.beforeSend===true);
  assert.throws(()=>remote.sessionCookieFormat({sessionCookieFormat:'csp50-v1'},connection), /target-unverified/);
  const policy={sessionCookieFormat:'csp50-v1',sessionCookieFormatInstance:remote.instanceIdentity(connection)};
  assert.equal(remote.sessionCookieFormat(policy,connection),'csp50-v1');
  assert.throws(()=>remote.sessionCookieFormat(policy,{...connection,port:8443}), /target-unverified/);
});

async function fixture(t, mode, options = {}) {
  const requests = []; let sequence = 0;
  const server = http.createServer((req, res) => {
    requests.push({method: req.method, authenticated: !!req.headers.authorization, cookie: req.headers.cookie});
    if (req.method === 'HEAD') {
      if (mode === 'logout-new-session') res.setHeader('Set-Cookie','CSPSESSIONID=new-session; Path=/');
      res.writeHead(mode === 'logout-404' ? 404 : 200); res.end(); return;
    }
    const headers = {'content-type': 'application/json'};
    sequence++;
    if (mode !== 'no-cookie' && sequence === 1) headers['set-cookie'] = 'CSPSESSIONID=first-session; Path=/';
    if (sequence === 2 && mode === 'deleted-cookie') headers['set-cookie'] = 'CSPSESSIONID=; Max-Age=0; Path=/';
    if (sequence === 2 && mode === 'rotation') headers['set-cookie'] = 'CSPSESSIONID=different-session; Path=/';
    if (mode === 'refresh') headers['set-cookie'] = 'CSPSESSIONID=' + (sequence === 1 ? 'A'.repeat(8) : 'B'.repeat(8)) + 'C'.repeat(14) + (sequence === 1 ? 'D'.repeat(28) : 'E'.repeat(28)) + '; Path=/';
    if (sequence === 2 && mode === 'scope-change') headers['set-cookie'] = 'CSPSESSIONID=first-session; Path=/api/atelier/';
    if (mode === 'foreign-domain') headers['set-cookie'] = 'CSPSESSIONID=first-session; Domain=example.invalid; Path=/';
    if (sequence === 2 && mode === 'expired-cookie') headers['set-cookie'] = 'CSPSESSIONID=first-session; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Path=/';
    res.writeHead(200, headers); res.end(JSON.stringify({result: {content: []}}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = createAtelierClient({managedHost: true, timeoutMs: 2000, connection: {
    protocol: 'http:', hostname: '127.0.0.1', port: server.address().port,
    path: '/api/atelier/v1/TEST/', username: 'synthetic', password: 'synthetic'
  }, ...options});
  t.after(async () => { await client.close(); await new Promise(resolve => server.close(resolve)); });
  return {client, requests, read: () => client.request('GET', 'probe')};
}

for (const mode of ['rotation', 'deleted-cookie', 'scope-change', 'expired-cookie']) {
  test(mode + ' stops further dispatch and retains an unverified cleanup state', async t => {
    const f = await fixture(t, mode); await f.read();
    await assert.rejects(f.read(), e => e.sessionUncertain === true && e.beforeSend === false);
    await assert.rejects(f.read(), e => e.beforeSend === true);
    assert.equal(f.requests.filter(r => r.method === 'GET').length, 2);
    assert.equal(f.requests.filter(r => r.authenticated).length, 1);
    assert.equal((await f.client.close()).cleanupVerified, false);
  });
}
test('explicit verified format permits token renewal without authenticating again', async t => {
  const f = await fixture(t, 'refresh', {sessionCookieFormat:'csp50-v1'});
  await f.read(); await f.read(); await f.read();
  assert.equal(f.requests.filter(r => r.authenticated).length, 1);
  assert.match(f.requests[2].cookie, /BBBBBBBB/);
  assert.equal((await f.client.close()).cleanupVerified, true);
});
test('unverified formats do not infer fixed identity from token length', async t => {
  const f = await fixture(t, 'refresh'); await f.read();
  await assert.rejects(f.read(), e => e.sessionUncertain === true);
});
test('foreign-domain session cookie is never sent back', async t => {
  const f = await fixture(t, 'foreign-domain');
  await assert.rejects(f.read(), e => e.sessionUncertain === true);
  assert.equal((await f.client.close()).cleanupVerified, false);
  assert.equal(f.requests.length, 1);
});
test('successful response without a session cookie cannot trigger repeated authentication', async t => {
  const f = await fixture(t, 'no-cookie');
  await assert.rejects(f.read(), e => e.sessionUncertain === true);
  await assert.rejects(f.read(), e => e.beforeSend === true);
  assert.equal(f.requests.length, 1);
  assert.equal((await f.client.close()).cleanupVerified, false);
});
test('logout 404 is not a verified cleanup receipt', async t => {
  const f = await fixture(t, 'logout-404'); await f.read();
  const exit = await f.client.close();
  assert.equal(exit.logoutHttpStatus, 404);
  assert.equal(exit.cleanupVerified, false);
});
test('successful logout that creates a different session remains unverified', async t => {
  const f = await fixture(t, 'logout-new-session'); await f.read();
  const exit = await f.client.close();
  assert.equal(exit.logoutHttpStatus, 200);
  assert.equal(exit.cleanupVerified, false);
});
