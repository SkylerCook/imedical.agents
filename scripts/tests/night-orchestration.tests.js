'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { normalizePolicy } = require('../lib/night-policy');

test('night CLI records survive replay and repeated next reserves one demand until completion', t => {
    const parent = process.platform === 'win32' ? 'D:/tmp/Codex' : os.tmpdir();
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, 'night-orchestration-'));
    t.after(() => { assert.equal(path.dirname(root), path.resolve(parent)); assert.equal(fs.lstatSync(root).isSymbolicLink(), false); fs.rmSync(root, { recursive: true, force: true }); assert.equal(fs.existsSync(root), false); });
    const run = path.join(root, 'run');
    function input(name, value) { const file = path.join(root, name); fs.writeFileSync(file, JSON.stringify(value)); return file; }
    function cli(command, args = [], expected = 0, runDir = run) {
        const result = spawnSync(process.execPath, [path.resolve(__dirname, '../agent-orchestrator.js'), command, '--run-directory', runDir, ...args], { encoding: 'utf8', windowsHide: true });
        assert.equal(result.status, expected, result.stdout + result.stderr);
        return result.status === 0 ? JSON.parse(result.stdout) : null;
    }
    const now = Date.now();
    input('policy.json', normalizePolicy());
    input('batch.json', { batchId: 'night', decisionPolicyReference: 'policy.json', policy: { stopClaimingAt: new Date(now + 3600000).toISOString(), stopPublishingAt: new Date(now + 7200000).toISOString(), stopAt: new Date(now + 10800000).toISOString() } });
    const plan = { taskKind: 'other', coordinatorId: 'leader', nightBatchReference: 'batch.json', orchestrationMode: 'subagent', adapter: 'subagent', adapterCapabilities: { subagent: true }, participants: [{ id: 'leader', role: 'coordinator', endpoint: { type: 'serial' } }, { id: 'dev', role: 'coding', endpoint: { type: 'subagent' } }], workItems: ['1', '2'].map(id => ({ id: `implement-${id}`, ownerId: 'dev', night: { demandId: id, phase: 'implementation' } })) };
    plan.workItems[0].night.modelTier = 'balanced';
    plan.workItems[0].night.modelMappingReference = 'host:current-model';
    cli('init', ['--plan', input('plan.json', plan)]);
    assert.deepEqual(cli('next'), []);
    for (const id of ['1', '2']) {
        const record = { id, implementationOwnerId: 'dev', assessment: { pre: { businessCertainty: 'confirmed', risk: 'low', changeKinds: ['text'], evidenceRefs: ['source:1'], rationale: 'Confirmed text correction', reviewerId: 'leader', minimumChecks: ['diff'], route: 'static-review' } }, results: { knownDefect: false, unknownWrite: false }, resources: { polluted: false, pending: false }, timingSegments: [], failures: [], reassessments: [] };
        const file = input(`record-${id}.json`, { kind: 'demand', record, rationale: 'Confirmed scope', evidenceRefs: ['source:1'] });
        cli('night-record', ['--record', file, '--actor', 'dev'], 1);
        cli('night-record', ['--record', file, '--actor', 'leader']);
    }
    const first = cli('next'); assert.equal(first.length, 1);
    assert.deepEqual(first[0].modelRequest, { tier: 'balanced', mappingReference: 'host:current-model' });
    assert.deepEqual(cli('next').map(a => a.id), first.map(a => a.id));
    cli('ack', ['--result', input('ack.json', { actionId: first[0].id, status: 'succeeded', endpointId: 'worker-1' })]);
    assert.deepEqual(cli('next'), []);
    cli('validate');
    const manifestFile = path.join(run, '00-run-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile)); manifest.topic = 'damage'; fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const recovered = cli('status'); assert.equal(recovered.projectionRecovered, true);
    assert.deepEqual(cli('next'), []);
    assert.equal(JSON.parse(fs.readFileSync(manifestFile)).night.demands.length, 2);
    cli('result', ['--result', input('result.json', { actionId: first[0].id, status: 'succeeded', endpointId: 'worker-1', artifactRefs: ['result:1'] })]);
    assert.equal(cli('next').length, 1);
    const legacy = { ...plan }; delete legacy.nightBatchReference;
    const legacyRun = path.join(root, 'legacy');
    cli('init', ['--plan', input('legacy.json', legacy)], 0, legacyRun);
    assert.equal(cli('next', [], 0, legacyRun).length, 2);
});
