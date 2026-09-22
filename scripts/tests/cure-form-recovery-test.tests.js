'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { recoveryTest } = require('../../plugins/iris-cure-form-dev/scripts/cure-form-recovery-test');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cure-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = { version: 1, contentHash: 'before', map: { showTemp: '10' }, templates: [{ rowId: '10', content: '<div>original</div>', lastId: '8' }] };
  const packageValue = { expectedVersion: 1, expectedContentHash: 'before', changes: { strategy: 'in-place-overwrite', templates: [{ rowId: '10', content: '<div>original</div>' }] } };
  return { snapshot, options: { packageValue, rowId: '10', outputRoot: root, confirmClear: true, operator: 'test', reason: 'test' } };
}
test('no clear when restore content differs from current server', async (t) => {
  const { snapshot, options } = fixture(t); let writes = 0;
  options.packageValue.changes.templates[0].content = '<div>different</div>';
  await assert.rejects(recoveryTest(options, { validate() {}, inspect: async () => snapshot, apply() { writes++; } }), /preserve exactly/);
  assert.equal(writes, 0);
});
test('authorized clear restores exact original content and metadata', async (t) => {
  const { snapshot, options } = fixture(t); let current = structuredClone(snapshot), calls = [];
  const report = await recoveryTest(options, {
    validate() {}, inspect: async () => structuredClone(current), validateRemote: async () => ({ ok: 1 }),
    apply: async (clear) => { calls.push('clear'); assert.equal(clear.previewVerification, null); current.templates[0].content = ''; current.version++; current.contentHash = 'empty'; return { ok: 1, operationId: 'clear-id' }; },
    deploy: async (file) => { calls.push('restore'); const restore = JSON.parse(fs.readFileSync(file)); assert.equal(restore.expectedContentHash, 'empty'); current = structuredClone(snapshot); return { status: 'verified', operations: [{ operationId: 'restore-id' }] }; }
  });
  assert.equal(report.status, 'restored-and-verified'); assert.deepEqual(calls, ['clear', 'restore']);
});
test('unknown clear outcome is not retried', async (t) => {
  const { snapshot, options } = fixture(t); let writes = 0;
  const report = await recoveryTest(options, { validate() {}, inspect: async () => snapshot, validateRemote: async () => ({ ok: 1 }), apply: async () => { writes++; throw new Error('connection lost'); } });
  assert.equal(report.status, 'clear-outcome-unknown'); assert.equal(writes, 1); assert.ok(fs.existsSync(report.reportPath));
});

test('one recovery deadline blocks clear after slow preflight', async (t) => {
  const { snapshot, options } = fixture(t); let now = 0, writes = 0, deadline;
  options.budgetOptions = { now: () => now, totalMs: 10, idleMs: 100 };
  const report = await recoveryTest(options, { setDeadline: (value) => { deadline = value; }, validate() {}, inspect: async () => snapshot,
    validateRemote: async () => { now = 10; return { ok: 1 }; }, apply: async () => { writes++; } });
  assert.equal(deadline, 10); assert.equal(writes, 0); assert.equal(report.status, 'manual-handoff-required');
});

test('lost rollback response is explicitly unknown and never repeated', async (t) => {
  const { snapshot, options } = fixture(t); let reads = 0, rollbacks = 0;
  const report = await recoveryTest(options, { validate() {}, inspect: async () => { if (++reads > 1) throw new Error('read unavailable'); return snapshot; },
    validateRemote: async () => ({ ok: 1 }), apply: async () => ({ ok: 1, operationId: 'clear' }),
    rollback: async () => { rollbacks++; throw new Error('response lost'); } });
  assert.equal(report.status, 'rollback-outcome-unknown'); assert.equal(rollbacks, 1);
});
