'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizePolicy } = require('../lib/night-policy');
const { normalizeQuotaPolicy } = require('../lib/night-quota');
const { updateNight, gateNight, validateNightItems } = require('../lib/night-dispatch');

function fixture() {
    const now = Date.now();
    const work = { id: 'implement', ownerId: 'dev', status: 'pending', writeScopes: [], night: { demandId: '1', phase: 'implementation' } };
    const cleanup = { id: 'cleanup', ownerId: 'dev', status: 'pending', kind: 'cleanup', writeScopes: [], night: { demandId: '1', phase: 'cleanup' } };
    const record = { id: '1', implementationOwnerId: 'dev', assessment: { pre: { businessCertainty: 'confirmed', risk: 'low', changeKinds: ['text'], evidenceRefs: ['scope:1'], rationale: 'Confirmed correction', reviewerId: 'reviewer', minimumChecks: ['diff'], route: 'static-review' } }, results: { knownDefect: false, unknownWrite: false }, resources: { polluted: false, pending: false }, timingSegments: [], failures: [], reassessments: [] };
    const manifest = { coordinatorId: 'leader', participants: [{ id: 'dev' }], actions: [], workItems: [work, cleanup], night: { policy: normalizePolicy(), quotaPolicy: normalizeQuotaPolicy({ provider: 'codex' }), quotaSnapshot: null, limits: { stopClaimingAt: new Date(now + 3600000).toISOString(), stopPublishingAt: new Date(now + 7200000).toISOString(), stopAt: new Date(now + 10800000).toISOString() }, demands: [record], shared: { timingSegments: [], reassessments: [] }, humanReassessments: [], audit: null } };
    function update(usedPercent, observed = now, extra = {}) {
        return updateNight(manifest, { kind: 'quota', rationale: 'Actual host snapshot', evidenceRefs: ['host:usage'], snapshot: { observedAt: new Date(observed).toISOString(), rateLimitsByLimitId: { codex: { primary: { usedPercent, windowDurationMins: 300 } } }, ...extra } }, 'leader');
    }
    return { manifest, work, cleanup, now, update };
}
test('quota unknown and stale block new work without blocking cleanup', () => {
    const f = fixture();
    assert.equal(gateNight(f.manifest, f.work, f.now).allowed, false);
    assert.equal(gateNight(f.manifest, f.work, f.now).quota.mode, 'unknown');
    assert.equal(gateNight(f.manifest, f.cleanup, f.now).allowed, true);
    f.update(1, f.now - 300001);
    assert.ok(gateNight(f.manifest, f.work, f.now).reasons.includes('quota-snapshot-stale'));
    f.update(1);
    assert.equal(gateNight(f.manifest, f.work, f.now).allowed, true);
});
test('drain does not treat pending action as started, but permits actual in-flight work', () => {
    const f = fixture(); f.update(80);
    f.manifest.actions.push({ workItemId: f.work.id, type: 'spawn-subagent', status: 'pending' });
    assert.equal(gateNight(f.manifest, f.work, f.now).allowed, false);
    assert.ok(gateNight(f.manifest, f.work, f.now).reasons.includes('quota-stop-claiming-threshold'));
    f.work.status = 'running';
    assert.equal(gateNight(f.manifest, f.work, f.now).allowed, true);
    f.work.status = 'pending'; f.work.attempts = [{ id: 'started-attempt' }];
    assert.equal(gateNight(f.manifest, f.work, f.now).allowed, true);
});
test('closeout stops started business work, cleanup remains possible and fresh headroom restores dispatch', () => {
    const f = fixture(); f.update(90); f.work.status = 'running';
    assert.equal(gateNight(f.manifest, f.work, f.now).quota.mode, 'closeout');
    assert.equal(gateNight(f.manifest, f.work, f.now).allowed, false);
    assert.equal(gateNight(f.manifest, f.cleanup, f.now).allowed, true);
    f.update(10);
    assert.equal(gateNight(f.manifest, f.work, f.now).allowed, true);
});
test('quota records sanitize unrelated metadata and cannot use reported remainingPercent', () => {
    const f = fixture();
    f.update(85, f.now, { token: 'private', accountId: 'private', credits: { balance: 10 }, remainingPercent: 100 });
    assert.equal(JSON.stringify(f.manifest.night.quotaSnapshot).includes('private'), false);
    assert.equal(f.manifest.night.quotaSnapshot.remainingPercent, undefined);
    assert.equal(gateNight(f.manifest, f.work, f.now).quota.remainingPercent, 15);
    updateNight(f.manifest, { kind: 'quota', rationale: 'Missing host evidence', evidenceRefs: ['host:missing'], snapshot: { observedAt: new Date(f.now).toISOString(), remainingPercent: 100 } }, 'leader');
    assert.equal(gateNight(f.manifest, f.work, f.now).quota.mode, 'unknown');
    assert.equal(gateNight(f.manifest, f.work, f.now).allowed, false);
});
test('quota writes enforce actor, future and monotonic timestamps', () => {
    const f = fixture(); f.update(10);
    assert.throws(() => f.update(10, f.now - 1), /backwards/);
    assert.throws(() => f.update(10, Date.now() + 60000), /future/);
    assert.throws(() => updateNight(f.manifest, { kind: 'quota', rationale: 'host snapshot', evidenceRefs: ['host:1'], snapshot: {} }, 'dev'), /coordinator/);
});
test('missing or explicitly disabled quota policy preserves legacy dispatch', () => {
    const f = fixture(); delete f.manifest.night.quotaPolicy;
    assert.equal(gateNight(f.manifest, f.work, f.now).allowed, true);
    assert.equal(gateNight(f.manifest, f.work, f.now).quota, undefined);
    f.manifest.night.quotaPolicy = normalizeQuotaPolicy({ provider: 'other', enabled: false });
    assert.equal(gateNight(f.manifest, f.work, f.now).allowed, true);
    assert.throws(() => f.update(10), /not enabled/);
});
test('workspace preflight blocks business, permits cleanup and enforces participant target binding', () => {
    const f = fixture(); delete f.manifest.night.quotaPolicy;
    f.manifest.night.workspaces = [{ ownerId: 'dev', plan: { repositories: [] } }];
    assert.ok(gateNight(f.manifest, f.work, f.now).reasons.includes('night-workspace-preflight-failed'));
    assert.equal(gateNight(f.manifest, f.cleanup, f.now).allowed, true);
    f.manifest.night.workspaces[0].ownerId = 'missing-participant';
    assert.throws(() => validateNightItems(f.manifest), /not a participant/);
    f.manifest.night.workspaces[0].ownerId = 'dev';
    f.manifest.participants[0].worktree = { mode: 'isolated', ref: path.resolve('expected-worktree') };
    f.manifest.night.workspaces[0].plan.repositories = [{ target: path.resolve('different-worktree') }];
    assert.throws(() => validateNightItems(f.manifest), /differs/);
});
