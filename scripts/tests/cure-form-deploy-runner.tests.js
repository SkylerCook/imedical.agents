'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { deploy } = require('../../plugins/iris-cure-form-dev/scripts/cure-form-deploy-runner');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cure-deploy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packages = ['ExampleA', 'ExampleB'].map((mapCode) => {
    const file = path.join(root, mapCode + '.json');
    fs.writeFileSync(file, JSON.stringify({ mapCode, changes: { strategy: 'in-place-overwrite', templates: [{ rowId: '10', content: '<div>中文</div>' }] } }));
    return file;
  });
  return { packages, outputRoot: path.join(root, 'output'), mode: 'automatic', confirmWrite: true, operator: 'test', reason: 'unit test' };
}
test('manual path produces content without contacting server', async (t) => {
  const options = fixture(t);
  const result = await deploy({ ...options, mode: 'manual', executeCommand: () => { throw new Error('unexpected remote call'); } }, (p) => p);
  assert.equal(result.status, 'manual-ready');
  assert.equal(result.handoffs.length, 2);
});
test('automatic mode serializes Validate Apply Verify per Map', async (t) => {
  const calls = [], options = fixture(t);
  const result = await deploy({ ...options, executeCommand: async (args, write) => {
    calls.push([args[0], write]);
    return { result: { ok: 1, operationId: '1' } };
  } }, (p) => p);
  assert.equal(result.status, 'verified');
  assert.deepEqual(calls, [['apply', false], ['apply', true], ['verify', false], ['apply', false], ['apply', true], ['verify', false]]);
  assert.match(result.reportPath, /private[\\/]deployment/);
});
test('unknown write stops without retry or starting next Map', async (t) => {
  const calls = [], options = fixture(t);
  const result = await deploy({ ...options, executeCommand: async (args, write) => {
    calls.push(args[0]); if (write) throw new Error('response lost');
    return { result: { ok: 1 } };
  } }, (p) => p);
  assert.equal(result.status, 'write-outcome-unknown');
  assert.equal(result.operations.length, 1); assert.equal(calls.length, 2);
  assert.ok(result.handoffs.every((h) => fs.existsSync(h.readme)));
});
test('expired budget before Apply hands off without a write', async (t) => {
  let now = 0, writes = 0;
  const result = await deploy({ ...fixture(t), budgetOptions: { now: () => now }, executeCommand: async (_, write) => {
    if (write) writes += 1; now = 300000; return { result: { ok: 1 } };
  } }, (p) => p);
  assert.equal(result.status, 'manual-handoff-required'); assert.equal(writes, 0);
});
