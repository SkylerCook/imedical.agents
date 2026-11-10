'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {encodeDocumentPath} = require('../lib/atelier-document-path');
const {createAtelierClient} = require('../lib/atelier-client');

test('document encoding preserves separators and escapes each segment once', () => {
  assert.equal(encodeDocumentPath('%Library.Test.cls'), '%25Library.Test.cls');
  assert.equal(encodeDocumentPath('web/scripts/a b#?.js'), 'web/scripts/a%20b%23%3F.js');
  assert.equal(encodeDocumentPath('web/中文/%2F.js'), 'web/%E4%B8%AD%E6%96%87/%252F.js');
});

test('Web GET, binary GET and conditional PUT use slash-preserving routes', async t => {
  const seen = [];
  const name = 'web/scripts/test page.js';
  const expected = '/api/atelier/v1/TEST/doc/web/scripts/test%20page.js';
  const server = http.createServer((req, res) => {
    if (req.method === 'HEAD') { res.end(); return; }
    seen.push({method:req.method, url:req.url, ts:req.headers['if-none-match']});
    res.setHeader('Set-Cookie','CSPSESSIONID=synthetic; Path=/');
    res.setHeader('Content-Type','application/json');
    if (req.url.split('?')[0] !== expected) { res.statusCode=404; res.end('{}'); return; }
    res.end(JSON.stringify({result:{name,content:['test'],ts:'2026-01-01 00:00:00'}}));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const client=createAtelierClient({managedHost:true,connection:{protocol:'http:',hostname:'127.0.0.1',port:server.address().port,namespace:'TEST'}});
  t.after(async()=>{await client.close(); await new Promise(resolve=>server.close(resolve));});
  assert.equal((await client.readDocument(name)).text,'test');
  await client.readDocument(name,{binary:true});
  await client.writeDocument(name,Buffer.from('test'),{ts:'2026-01-01 00:00:00'});
  assert.deepEqual(seen.map(r=>r.url),[expected,expected+'?binary=1',expected]);
  assert.equal(seen[2].method,'PUT');
  assert.equal(seen[2].ts,'2026-01-01 00:00:00');
});
