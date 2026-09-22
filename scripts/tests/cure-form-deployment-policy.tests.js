'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DeploymentBudget, selectDeployment } = require('../../plugins/iris-cure-form-dev/scripts/cure-form-deployment-policy');
const { buildHandoff } = require('../../plugins/iris-cure-form-dev/scripts/cure-form-manual-handoff');
const { validateOverwrite } = require('../../plugins/iris-cure-form-dev/scripts/cure-form-deployment-policy');
const { previewWidths, validWidths } = require('../../plugins/iris-cure-form-dev/scripts/cure-form-layout-checks');
const { packageChunks, decodeFramedResult, readFrame } = require('../../plugins/iris-cure-form-dev/scripts/cure-form-staged-transport');

test('idle and total limits survive progress and distinguish unknown writes', () => {
  let now = 0;
  const budget = new DeploymentBudget({ now: () => now });
  now = 299999; budget.progress();
  now = 599998; budget.progress();
  now = 899997; budget.progress();
  now = 900000;
  assert.throws(() => budget.check(), /manual-handoff-required/);
  budget.writeStarted = true;
  assert.throws(() => budget.check(), /write-outcome-unknown/);
  const idle = new DeploymentBudget({ now: () => now });
  now += 300000;
  assert.throws(() => idle.progress(), /manual-handoff-required/);
});
test('mode, assets and lifecycle are independent', () => {
  for (const mode of ['automatic', 'manual']) for (const strategy of ['versioned-clone', 'in-place-overwrite']) {
    assert.equal(selectDeployment({ mode, strategy, assets: 'manual' }).strategy, strategy);
  }
  assert.throws(() => selectDeployment({ mode: 'unknown' }));
});
test('handoff preserves exact unicode content and does not copy assets', () => {
  const content = '<div id="example">\r\n中文\r\n</div>';
  const pkg = { mapCode: 'Example', changes: { strategy: 'in-place-overwrite', templates: [
    { rowId: '9', referenceOnly: true }, { rowId: '10', content }
  ], map: { showJS: 'scripts/example.js' }, resources: [{ kind: 'javascript', path: 'scripts/example.js' }] } };
  const handoff = buildHandoff(pkg);
  assert.equal(handoff.files.length, 1);
  assert.equal(handoff.files[0].content, content);
  assert.match(handoff.readme, /scripts\/example.js/);
  pkg.changes.templates[1].content = '<html><body>preview</body></html>';
  assert.throws(() => buildHandoff(pkg), /pure template/);
});
test('overwrite preserves composition and metadata, including historical lastId', () => {
  const snapshot = { exists: true, map: { showTemp: '9||10', name: 'Example' }, templates: [{ rowId: '9' }, { rowId: '10', lastId: '8' }] };
  const changes = { strategy: 'in-place-overwrite', templates: [{ rowId: '9', referenceOnly: true }, { rowId: '10', content: '' }] };
  validateOverwrite(changes, snapshot);
  changes.templates[1].lastId = '10';
  assert.throws(() => validateOverwrite(changes, snapshot), /protected template/);
  delete changes.templates[1].lastId;
  changes.templates.reverse();
  assert.throws(() => validateOverwrite(changes, snapshot), /composition/);
});
test('extra widths and breakpoint edges cannot replace the base matrix', () => {
  const widths = previewWidths([443, 595, 639, 1221], [767.98]);
  assert.equal(validWidths(widths), true);
  assert.ok(widths.includes(766) && widths.includes(767) && widths.includes(769));
  assert.equal(validWidths([443]), false);
});

test('transport chunks retain unicode scalars and stay within encoded byte limit', () => {
  const text = '中文😀abc'.repeat(10000);
  const chunks = packageChunks(text);
  assert.equal(chunks.map((s) => Buffer.from(s).toString('utf8')).join(''), text);
  assert.ok(chunks.every((s) => Buffer.byteLength(s, 'utf8') <= 600));
  assert.ok(previewWidths([], [430.98]).includes(431));
});

test('framed responses survive Base64 line folding and reject missing terminators', () => {
  const value = { ok: 1, text: '中文'.repeat(100), sequence: 1, total: 600 };
  const base64 = Buffer.from(JSON.stringify(value)).toString('base64').match(/.{1,76}/g).join('\r\n');
  assert.deepEqual(decodeFramedResult('CURE_RESULT:' + base64 + ':CURE_END\n'), value);
  assert.throws(() => decodeFramedResult('CURE_RESULT:' + base64), /no complete framed/);
});

test('only read frames retry once and never accept truncation', async () => {
  let calls = 0;
  const frame = 'CURE_RESULT:' + Buffer.from('中文').toString('base64') + ':CURE_END';
  assert.equal(await readFrame(async () => (++calls === 1 ? '' : frame), 2), '中文');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(readFrame(async () => { calls++; return frame; }, 3), /length mismatch/);
  assert.equal(calls, 2);
});
