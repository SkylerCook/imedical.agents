'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { probeCapabilities, validateProbeBinding, executableWork } = require('../lib/night-capability');
const { main } = require('../night-capability-probe');
function fixture(t) {
    const temp = require('./fixtures/temp-directory'), root = temp.createTempDirectory('night-capability-'); t.after(() => { assert.ok(temp.ownsTempDirectory(root)); fs.rmSync(root, { recursive: true, force: true }); assert.equal(fs.existsSync(root), false); });
    const file = path.join(root, 'profile.cjs'); fs.writeFileSync(file, 'module.exports = {};');
    const profile = { options: { deadlineAt: Date.now() + 3000, timeoutMs: 500, closeTimeoutMs: 30 }, capabilityRequirements: [{ demandId: 'API', role: 'doctor', capabilities: ['entry'] }, { demandId: 'UI', role: 'doctor', capabilities: ['browser'] }], preflight: async () => ({ cleanupVerified: true, checks: [{ id: 'entry', role: 'doctor', status: 'passed', nonInteractive: true, evidenceRef: 'actual:entry' }, { id: 'browser', role: 'doctor', status: 'blocked', nonInteractive: true, evidenceRef: 'actual:no-browser' }] }) };
    return { root, file, profile };
}
test('initial capability probe precedes any run and selects an API subset despite a browser gap', async t => {
    const f = fixture(t), receipt = await probeCapabilities(f.profile, f.file);
    assert.deepEqual(receipt.eligibleDemandIds, ['API']); assert.equal(receipt.cleanupVerified, true); assert.ok(receipt.requirements.find(r => r.demandId === 'UI').missing.includes('browser-lifecycle'));
    const file = path.join(f.root, 'probe.json'); fs.writeFileSync(file, JSON.stringify(receipt));
    const plan = { capabilityProbe: { reference: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), maxAgeMinutes: 10 }, demands: [{ id: 'API', feasibility: 'executable' }, { id: 'UI', feasibility: 'blocked' }], minimumTests: [{ demandId: 'API', level: 'external-api' }] };
    validateProbeBinding(plan);
    assert.throws(() => validateProbeBinding(plan, [{ night: { demandId: 'API', authentication: { mode: 'browser-session' } } }]), /browser authentication/);
    plan.demands[1].feasibility = 'executable'; assert.throws(() => validateProbeBinding(plan), /subset/);
    plan.demands[1].feasibility = 'blocked'; fs.appendFileSync(f.file, '\n// configuration drift'); assert.throws(() => validateProbeBinding(plan), /configuration changed/);
});
test('a browser check without an owned full lifecycle cannot satisfy early UI capability', async t => {
    const f = fixture(t); f.profile.preflight = async () => ({ cleanupVerified: true, checks: [{ id: 'browser', status: 'passed', nonInteractive: true, executor: 'playwright-headless', evidenceRef: 'adapter:claim' }] });
    assert.equal((await probeCapabilities(f.profile, f.file)).eligibleDemandIds.includes('UI'), false);
    let stopped = 0;
    f.profile.preflight = async ({ createTestExecutor }) => { createTestExecutor({}); return { cleanupVerified: true, checks: [{ id: 'browser', status: 'passed', nonInteractive: true, executor: 'playwright-headless', evidenceRef: 'actual:browser' }] }; };
    const createExecutor = () => ({ info: () => ({ browserVersion: 'synthetic', headless: true }), stop: async () => { stopped++; return { cleanupVerified: true, pendingOperations: 0 }; } });
    assert.ok((await probeCapabilities(f.profile, f.file, { createExecutor })).eligibleDemandIds.includes('UI')); assert.equal(stopped, 1);
    assert.equal((await probeCapabilities(f.profile, f.file, { createExecutor: () => ({ info: () => ({ browserVersion: 'synthetic', headless: true }), stop: async () => ({ cleanupVerified: false }) }) })).cleanupVerified, false);
});
test('unknown timed-out probe and owned resource close failure never become usable evidence', async t => {
    const f = fixture(t); f.profile.options.timeoutMs = 5; f.profile.preflight = () => new Promise(() => {});
    const result = await probeCapabilities(f.profile, f.file); assert.equal(result.operationExited, false); assert.deepEqual(result.eligibleDemandIds, []);
});
test('declared blocked demands are excluded from startup scope while executable demands still require their own gates', () => {
    const manifest = { executionPlan: { demands: [{ id: 'UI', feasibility: 'blocked' }, { id: 'API', feasibility: 'executable' }] } };
    assert.equal(executableWork(manifest, { status: 'pending', night: { demandId: 'UI', phase: 'verification' } }), false);
    assert.equal(executableWork(manifest, { status: 'pending', night: { demandId: 'API', phase: 'verification' } }), true);
});
test('cancellation closes owned probe resources and blocks any late executor creation', async t => {
    const f = fixture(t), controller = new AbortController(); let stopCount = 0, lateCreate;
    f.profile.preflight = async ({ createTestExecutor }) => { lateCreate = createTestExecutor; createTestExecutor({}); controller.abort(); return new Promise(() => {}); };
    const result = await probeCapabilities(f.profile, f.file, { signal: controller.signal, createExecutor: () => ({ info: () => ({}), stop: async () => { stopCount++; return { cleanupVerified: true, pendingOperations: 0 }; } }) });
    assert.equal(stopCount, 1); assert.deepEqual(result.eligibleDemandIds, []); assert.throws(() => lateCreate({}), /stopped/);
});
test('probe CLI persists and reads back an independent receipt and never overwrites it', async t => {
    const f = fixture(t), output = path.join(f.root, 'early.json');
    fs.writeFileSync(f.file, `module.exports = {options:{deadlineAt:Date.now()+2000},capabilityRequirements:[{demandId:'D1',role:'doctor',capabilities:['entry']}],preflight:async()=>({cleanupVerified:true,checks:[{id:'entry',status:'passed',nonInteractive:true,evidenceRef:'actual:entry'}]})};`);
    const result = await main(['--profile', f.file, '--output', output]); assert.deepEqual(result.eligibleDemandIds, ['D1']); assert.equal(JSON.parse(fs.readFileSync(output)).schema, 'night-capability-probe/v1');
    await assert.rejects(main(['--profile', f.file, '--output', output]), /EEXIST/);
});
test('real headless initial probe owns the browser and verifies full exit before detailed planning', { skip: !process.env.PLAYWRIGHT_RUNTIME_MODULE && !process.env.REQUIRE_PLAYWRIGHT }, async t => {
    assert.ok(process.env.PLAYWRIGHT_RUNTIME_MODULE, 'An existing locked host runtime is required');
    const f = fixture(t); f.profile.options = { deadlineAt: Date.now() + 20000, timeoutMs: 15000, closeTimeoutMs: 3000 };
    f.profile.capabilityRequirements = [{ demandId: 'UI', role: 'doctor', capabilities: ['browser'] }];
    f.profile.preflight = async ({ createTestExecutor }) => {
        const executor = createTestExecutor({ projectRoot: f.root, runtimeModule: process.env.PLAYWRIGHT_RUNTIME_MODULE, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, ...f.profile.options });
        await executor.prepareOwner({ id: 'health', level: 'ui', entry: 'initial-health', role: 'doctor' });
        return { cleanupVerified: true, checks: [{ id: 'browser', role: 'doctor', status: 'passed', nonInteractive: true, executor: 'playwright-headless', evidenceRef: 'synthetic-local:actual-browser-launch' }] };
    };
    const result = await probeCapabilities(f.profile, f.file);
    assert.deepEqual(result.eligibleDemandIds, ['UI']); assert.equal(result.cleanupVerified, true); assert.equal(result.operationExited, true);
    assert.equal(result.checks.find(c => c.id === 'browser-lifecycle').status, 'passed');
    assert.ok(result.browserLifecycle.instances[0].browserVersion); t.diagnostic(JSON.stringify(result.browserLifecycle));
});

test('preflight RPC failure preserves safe diagnostics and keeps all demands blocked', async t => {
    const f = fixture(t), { rpcError } = require('../lib/night-client-diagnostics');
    f.profile.preflight = async () => { throw rpcError('rpc-rejected', 'thread/read', -32603); };
    const receipt = await probeCapabilities(f.profile, f.file);
    assert.deepEqual(receipt.eligibleDemandIds, []); assert.equal(receipt.cleanupVerified, false);
    assert.equal(receipt.diagnostics[0].method, 'thread/read'); assert.equal(receipt.diagnostics[0].rpcCode, -32603);
});

test('project preflight can return sanitized RPC diagnostics on both receipt and check', async t => {
    const f = fixture(t), { rpcError, diagnosticFields } = require('../lib/night-client-diagnostics');
    const error = rpcError('rpc-rejected', 'thread/read', -32603);
    f.profile.preflight = async () => ({ cleanupVerified: true, ...diagnosticFields(error, 'probe'), checks: [{ id: 'entry', status: 'blocked', nonInteractive: true, evidenceRef: 'probe:failed', ...diagnosticFields(error, 'probe') }] });
    const receipt = await probeCapabilities(f.profile, f.file);
    assert.equal(receipt.diagnostics[0].method, 'thread/read'); assert.equal(receipt.checks[0].diagnostics[0].rpcCode, -32603);
    assert.deepEqual(receipt.eligibleDemandIds, []);
});
