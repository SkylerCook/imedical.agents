'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseScopeList, buildScopeList} = require('../scope-list');
test('TXT supports BOM, CRLF, comments, all backend types and literal Web names', () => {
  const input = '\uFEFF# scope\r\n\r\nDemo.A.cls\r\nROUTINE.mac\r\nHeader.inc\r\nCode.int\r\n/web/a&b.js\r\n/web/logo.png\r\n';
  const items = parseScopeList(Buffer.from(input));
  assert.equal(items.length, 6);
  assert.deepEqual(items.map(i => i.type), ['CLS','MAC','INC','INT','CSP','CSP']);
  assert.equal(items[4].name, 'web/a&b.js');
  assert.deepEqual(parseScopeList(buildScopeList(items)), items);
});
test('TXT refuses XML, malformed UTF-8, empty scope, missing extensions and unsafe expansion', () => {
  for (const input of ['<Export/>', '# empty', 'Demo.A', 'Demo.*.cls', 'web/a.js', '/../a.js', '/web//a.js', 'Demo.A.cls\nDemo.A.CLS', '/web/A.js\n/web/a.js', 'Demo.A.cls,是', Buffer.from([0xff])]) assert.throws(() => parseScopeList(input));
});
