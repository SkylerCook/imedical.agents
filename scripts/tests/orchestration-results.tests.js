"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
test('launch ACK is immutable and completion is separately consumed', () => {
  const base = process.env.TEMP || os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'result-contract-'));
  const run = path.join(dir, 'run');
  function call(command, options = [], expected = 0) {
    const r = spawnSync(process.execPath, [path.resolve(__dirname, '../agent-orchestrator.js'), command, '--run-directory', run, ...options], { encoding: 'utf8' });
    assert.equal(r.status, expected, r.stdout + r.stderr);
    return r.status === 0 ? JSON.parse(r.stdout) : null;
  }
  function input(name, value) { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(value)); return p; }
  try {
    call('init', ['--plan', input('plan.json', { taskKind: 'other', orchestrationMode: 'subagent', adapter: 'subagent', adapterCapabilities: { subagent: true }, workItems: [{ id: 'test' }] })]);
    const [action] = call('next');
    const ack = input('ack.json', { actionId: action.id, status: 'succeeded', endpointId: 'opaque-task' });
    call('ack', ['--result', ack]);
    const read = () => JSON.parse(fs.readFileSync(path.join(run, '00-run-manifest.json')));
    assert.equal(read().actions[0].result.projectionPatches, undefined);
    assert.equal(read().workItems[0].status, 'running');
    call('transition', ['--entity', 'work-item', '--id', 'test', '--status', 'completed'], 1);
    call('ack', ['--result', ack]);
    call('validate');
    assert.deepEqual(call('next'), []);
    const result = input('result.json', { actionId: action.id, status: 'succeeded', endpointId: 'opaque-task', artifactRefs: ['handoffs/test.md'] });
    call('result', ['--result', result]);
    assert.equal(read().workItems[0].status, 'completed');
    const sequence = read().eventLog.lastSequence;
    call('result', ['--result', result]);
    assert.equal(read().eventLog.lastSequence, sequence);
    call('result', ['--result', input('conflict.json', { actionId: action.id, status: 'failed', endpointId: 'opaque-task' })], 1);
    call('validate');
    // A physically damaged projection is recovered from immutable event snapshots.
    const damaged = read(); damaged.topic = 'damaged';
    fs.writeFileSync(path.join(run, '00-run-manifest.json'), JSON.stringify(damaged));
    assert.equal(call('status').projectionRecovered, true);
    call('next'); call('validate');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('legacy launch completion is readable but cannot satisfy final completion evidence', () => {
  const { createManifest, validateV2 } = require('../agent-orchestrator');
  const dir = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'legacy-result-'));
  try {
    const plan = path.join(dir, 'plan.json'); fs.writeFileSync(plan, '{}');
    const manifest = createManifest({ runDirectory: dir, plan });
    delete manifest.orchestration.resultLifecycle;
    manifest.actions.push({ id: 'a', type: 'spawn-subagent', status: 'acknowledged', idempotencyKey: 'a', result: { actionId: 'a', status: 'succeeded' } });
    assert(validateV2(manifest, '.', true, { skipProjection: true }).some(issue => issue.includes('legacy launch completion')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
