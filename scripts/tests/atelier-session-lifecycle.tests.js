'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {createAtelierClient} = require('../lib/atelier-client');

test('HTTPS trust includes system CA locally, preserves explicit CA and supports older Node', async t => {
  const tls=require('node:tls'),https=require('node:https'), OriginalAgent=https.Agent;
  const cert=tls.rootCertificates[0], extra=tls.rootCertificates[1];
  let options, reads=0;
  t.mock.method(https,'Agent',function(value){options=value;return new OriginalAgent(value);});
  const original=tls.getCACertificates;
  t.after(()=>{tls.getCACertificates=original;});
  tls.getCACertificates=kind=>{reads++;return kind==='system'?[cert,extra]:[cert];};
  const connection={protocol:'https:',hostname:'synthetic.invalid',path:'/api/atelier/v1/TEST/'};
  const make=overrides=>createAtelierClient({managedHost:true,connection:{...connection,...overrides}});
  const client=make({tlsVerify:true});
  assert.equal(options.rejectUnauthorized,true);assert.deepEqual(options.ca,[cert,extra]);
  require('node:tls').createSecureContext({ca:options.ca});
  await client.close();
  reads=0;
  const explicit=make({ca:[cert]});assert.deepEqual(options.ca,[cert]);assert.equal(reads,0);await explicit.close();
  const disabled=make({tlsVerify:false});assert.equal(options.rejectUnauthorized,false);assert.equal(reads,0);await disabled.close();
  tls.getCACertificates=undefined;
  const legacy=make({tlsVerify:true});assert.equal(options.rejectUnauthorized,true);assert.equal(options.ca,undefined);await legacy.close();
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
    if (mode === 'continuous-refresh') headers['set-cookie'] = 'CSPSESSIONID=token-' + sequence + '; Path=/';
    if (sequence === 2 && mode === 'scope-change') headers['set-cookie'] = 'CSPSESSIONID=first-session; Path=/api/atelier/';
    if (mode === 'foreign-domain') headers['set-cookie'] = 'CSPSESSIONID=first-session; Domain=example.invalid; Path=/';
    if (sequence === 2 && mode === 'expired-cookie') headers['set-cookie'] = 'CSPSESSIONID=first-session; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Path=/';
    res.writeHead(sequence > 1 && /^auth-/.test(mode) ? Number(mode.slice(5)) : 200, headers); res.end(JSON.stringify({result: {content: []}}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = createAtelierClient({managedHost: true, timeoutMs: 2000, connection: {
    protocol: 'http:', hostname: '127.0.0.1', port: server.address().port,
    path: '/api/atelier/v1/TEST/', username: 'synthetic', password: 'synthetic'
  }, ...options});
  t.after(async () => { await client.close(); await new Promise(resolve => server.close(resolve)); });
  return {client, requests, read: () => client.request('GET', 'probe')};
}

for (const mode of ['deleted-cookie', 'scope-change', 'expired-cookie']) {
  test(mode + ' stops further dispatch and retains an unverified cleanup state', async t => {
    const f = await fixture(t, mode); await f.read();
    await assert.rejects(f.read(), e => e.sessionUncertain === true && e.beforeSend === false);
    await assert.rejects(f.read(), e => e.beforeSend === true);
    assert.equal(f.requests.filter(r => r.method === 'GET').length, 2);
    assert.equal(f.requests.filter(r => r.authenticated).length, 1);
    assert.equal((await f.client.close()).cleanupVerified, false);
  });
}
test('token renewal needs no cookie format registration or repeated authentication', async t => {
  const f = await fixture(t, 'refresh');
  await f.read(); await f.read(); await f.read();
  assert.equal(f.requests.filter(r => r.authenticated).length, 1);
  assert.match(f.requests[2].cookie, /BBBBBBBB/);
  assert.equal((await f.client.close()).cleanupVerified, true);
});
test('opaque rotation is reused even with obsolete format settings', async t => {
  const f = await fixture(t, 'rotation', {policy:{sessionCookieFormat:'obsolete',sessionCookieFormatInstance:'stale'}});
  await f.read(); await f.read(); await f.read();
  assert.equal(f.requests[2].cookie,'CSPSESSIONID=different-session');
  assert.equal(f.requests.filter(r=>r.authenticated).length,1);
  assert.equal((await f.client.close()).cleanupVerified,true);
});
test('100 renewed tokens reuse one authentication and logout uses the latest cookie', async t => {
  const f = await fixture(t, 'continuous-refresh');
  for(let i=0;i<100;i++) await f.read();
  assert.equal(f.requests.length,100);
  assert.equal(f.requests.filter(r=>r.authenticated).length,1);
  for(let i=1;i<100;i++) assert.equal(f.requests[i].cookie,'CSPSESSIONID=token-'+i);
  await f.client.close();
  assert.equal(f.requests.at(-1).method,'HEAD');
  assert.equal(f.requests.at(-1).cookie,'CSPSESSIONID=token-100');
});
for (const status of [401,403]) {
  test('authentication failure '+status+' stops without reauthenticating or replaying', async t => {
    const f = await fixture(t, 'auth-'+status); await f.read();
    await assert.rejects(f.read(), error=>error.status===status && error.sessionUncertain===true);
    await assert.rejects(f.read(), error=>error.beforeSend===true);
    assert.equal(f.requests.length,2);
    assert.equal(f.requests.filter(r=>r.authenticated).length,1);
  });
}
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
