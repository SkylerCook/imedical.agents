'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const markdown = fs.readFileSync(path.resolve(__dirname, '../../plugins/coding-iris-plugin/templates/javascript-page-template.md'), 'utf8');
const blocks = [...markdown.matchAll(/~~~javascript\r?\n([\s\S]*?)~~~/g)].map(x => x[1]);
assert.equal(blocks.length, 3);
function harness() {
  const ready = [], events = [];
  const context = vm.createContext({
    $: function (value) {
      if (typeof value === 'function') { ready.push(value); return; }
      return { on: function (event, callback) { events.push({ selector: value, event, callback }); } };
    }
  });
  return { context, ready, events };
}
test('ordinary template waits for ready and binds once after initialization', () => {
  const h = harness();
  vm.runInContext(blocks[0], h.context);
  assert.equal(h.events.length, 0);
  assert.equal(h.ready.length, 1);
  h.context.pageState.selectedId = 'before-ready';
  h.ready[0]();
  assert.equal(h.context.pageState.selectedId, '');
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].selector, '#sampleReset');
  assert.equal(h.events[0].event, 'click');
  h.context.pageState.selectedId = 'selected';
  h.events[0].callback();
  assert.equal(h.context.pageState.selectedId, '');
  assert.equal(h.events.length, 1);
});
test('closure template waits for caller and keeps event binding private', () => {
  const h = harness();
  const namespace = {};
  h.context.createObjByStr = function (name) { assert.equal(name, 'example.page'); return namespace; };
  h.context.example = { page: namespace };
  let calls = 0;
  // Minimal caller contract only; this does not validate the project's helper implementation.
  h.context.cspInitClosure = function (page, options) { calls++; page.init(options); };
  vm.runInContext(blocks[1], h.context);
  assert.equal(h.ready.length, 0);
  assert.equal(h.events.length, 0);
  assert.equal(namespace.view.initEvent, undefined);
  assert.equal(namespace.view.xhrRefresh, undefined);
  assert.equal(namespace.view.onBeforeCloseTab, undefined);
  vm.runInContext(blocks[2].replace('initialId: ""', 'initialId: "selected"'), h.context);
  assert.equal(calls, 1);
  assert.equal(namespace.view.getSelectedId(), 'selected');
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].selector, '#sampleReset');
  h.events[0].callback();
  assert.equal(namespace.view.getSelectedId(), '');
  assert.equal(h.events.length, 1);
});
test('closure template exposes missing dependencies instead of installing fallbacks', () => {
  assert.throws(() => vm.runInNewContext(blocks[1], {}), /createObjByStr is not defined/);
});
