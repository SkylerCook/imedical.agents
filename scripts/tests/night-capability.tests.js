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

test('case effects derive minimum capabilities and a write gap leaves an independent read case eligible', async t => {
    const f = fixture(t);
    f.profile.capabilityRequirements = ['READ', 'WRITE'].map(demandId => ({ demandId, caseId: demandId + '-case', role: 'tester', capabilities: ['entry'], level: 'external-api', authentication: 'api', effects: demandId === 'WRITE' ? 'write' : 'read-only', rationale: 'Reviewed actual entry and effects' }));
    f.profile.preflight = async () => ({ cleanupVerified: true, checks: [
        ...['entry', 'authentication'].map(id => ({ id, status: 'passed', nonInteractive: true, evidenceRef: 'actual:' + id })),
        { id: 'fixture-authority', demandId: 'WRITE', caseId: 'WRITE-case', status: 'blocked', reason: 'implementation-missing', owner: 'project-adapter', recheckRef: 'profile:write-case', evidenceRef: 'source:fixture-review' }
    ] });
    const result = await probeCapabilities(f.profile, f.file);
    assert.deepEqual(result.eligibleDemandIds, ['READ']);
    assert.deepEqual(result.requirements[0].capabilities, ['entry', 'authentication']);
    const gap = result.requirements[1].gaps.find(g => g.id === 'fixture-authority');
    assert.equal(gap.reason, 'implementation-missing'); assert.equal(gap.owner, 'project-adapter'); assert.equal(gap.recheckRef, 'profile:write-case');
    assert.equal(result.requirements[1].gaps.find(g => g.id === 'data-disposition').reason, 'unverified');
});

test('scoped case evidence cannot certify another demand or case and blocked checks override broad pass labels', async t => {
    const f = fixture(t);
    f.profile.capabilityRequirements = [
        { demandId: 'D', caseId: 'one', role: 'tester', capabilities: ['entry'], rationale: 'case one' },
        { demandId: 'D', caseId: 'two', role: 'tester', capabilities: ['entry'], rationale: 'case two' },
        { demandId: 'OTHER', role: 'tester', capabilities: ['entry'] }
    ];
    const checks = [{ id: 'entry', demandId: 'D', caseId: 'one', status: 'passed', nonInteractive: true, evidenceRef: 'actual:one' }];
    f.profile.preflight = async () => ({ cleanupVerified: true, checks });
    let result = await probeCapabilities(f.profile, f.file);
    assert.deepEqual(result.requirements.map(r => r.executable), [true, false, false]); assert.deepEqual(result.eligibleDemandIds, []);
    checks.push({ id: 'entry', demandId: '', status: 'passed', nonInteractive: true, evidenceRef: 'invalid:scope' });
    result = await probeCapabilities(f.profile, f.file);
    assert.deepEqual(result.eligibleDemandIds, []);
    checks.push({ id: 'entry', status: 'passed', nonInteractive: true, evidenceRef: 'actual:shared' });
    checks.push({ id: 'entry', demandId: 'D', caseId: 'two', status: 'failed', evidenceRef: 'actual:failed' });
    result = await probeCapabilities(f.profile, f.file);
    assert.deepEqual(result.eligibleDemandIds, ['OTHER']); assert.equal(result.requirements[1].gaps[0].reason, 'execution-failed');
});

test('not applicable never grants a required capability and unresolved resources block otherwise eligible cases', async t => {
    const f = fixture(t);
    f.profile.capabilityRequirements = [{ demandId: 'D', role: 'tester', capabilities: ['entry'] }];
    f.profile.preflight = async () => ({ cleanupVerified: true, checks: [{ id: 'entry', status: 'passed', reason: 'not-applicable', nonInteractive: true, evidenceRef: 'review:omission' }] });
    let result = await probeCapabilities(f.profile, f.file);
    assert.deepEqual(result.eligibleDemandIds, []); assert.equal(result.requirements[0].gaps[0].reason, 'not-applicable');
    f.profile.preflight = async () => ({ cleanupVerified: false, checks: [{ id: 'entry', status: 'passed', nonInteractive: true, evidenceRef: 'actual:entry' }] });
    result = await probeCapabilities(f.profile, f.file);
    assert.deepEqual(result.requirements[0].missing, []); assert.deepEqual(result.requirements[0].blockers, ['exit-unknown']); assert.deepEqual(result.eligibleDemandIds, []);
});

test('new requirement metadata needs valid effects and rationale and UI derives owned browser lifecycle', async t => {
    const f = fixture(t);
    f.profile.capabilityRequirements[0].effects = 'write';
    await assert.rejects(probeCapabilities(f.profile, f.file), /rationale/);
    Object.assign(f.profile.capabilityRequirements[0], { rationale: 'checked', effects: 'readonly' });
    await assert.rejects(probeCapabilities(f.profile, f.file), /effects/);
    Object.assign(f.profile.capabilityRequirements[0], { effects: 'read-only', level: 'ui', authentication: 'browser-session' });
    const result = await probeCapabilities(f.profile, f.file);
    for (const id of ['browser', 'authentication', 'browser-lifecycle']) assert.ok(result.requirements[0].missing.includes(id));
});
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

test('CLI exposes persisted scoped gap diagnostics without converting unattempted work into an execution failure', async t => {
    const f = fixture(t), output = path.join(f.root, 'gap.json');
    fs.writeFileSync(f.file, `module.exports = {options:{deadlineAt:Date.now()+2000},capabilityRequirements:[{demandId:'D',caseId:'C',role:'tester',capabilities:['entry'],rationale:'reviewed case'}],preflight:async()=>({cleanupVerified:true,checks:[{id:'entry',demandId:'D',caseId:'C',status:'blocked',reason:'not-attempted',owner:'project',recheckRef:'profile:C',evidenceRef:'source:review'}]})};`);
    const result = await main(['--profile', f.file, '--output', output]);
    assert.deepEqual(result.blockedDemandIds, ['D']); assert.equal(result.gaps[0].caseId, 'C');
    assert.equal(result.gaps[0].gaps[0].reason, 'not-attempted');
    assert.deepEqual(result.gaps[0].gaps, JSON.parse(fs.readFileSync(output)).requirements[0].gaps);
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


function clientFixture(overrides = {}) {
    const calls = [], launches = new Map();
    const adapter = {
        probe: async () => ({ available: true }),
        startOrResume: async request => { calls.push(['launch', request.actionId]); const result = { actionId: request.actionId, status: 'succeeded', endpointId: request.actionId + '-endpoint', host: { turnId: request.actionId + '-turn' } }; launches.set(request.actionId, result); return result; },
        waitForReady: async ({ actionId }) => { calls.push(['ready', actionId]); const l = launches.get(actionId); return { ready: true, endpointId: l.endpointId, turnId: l.host.turnId }; },
        status: async ({ actionId }) => { calls.push(['read', actionId]); const l = launches.get(actionId); return { endpointId: l.endpointId, turnId: l.host.turnId, turnStatus: calls.some(c => c[0] === 'stop' && c[1] === actionId) ? 'interrupted' : 'inProgress' }; },
        stop: async ({ actionId }) => { calls.push(['stop', actionId]); return { interruptRequested: true, interruptAcknowledged: true }; },
        waitForTerminal: async ({ actionId }) => { const l = launches.get(actionId); return { terminalObserved: true, endpointId: l.endpointId, turnId: l.host.turnId, turnStatus: 'interrupted' }; },
        shutdown: async () => { calls.push(['shutdown']); return { localTransportClosed: true, processCleanupVerified: true, endpointStopped: false }; }
    };
    Object.assign(adapter, overrides); return { adapter, calls, launches };
}
function clientOptions(extra = {}) { return { cwd: path.resolve(__dirname), authorization: { actor: 'user', reference: 'user:probe-only' }, deadlineAt: Date.now() + 1000, timeoutMs: 500, closeTimeoutMs: 10, recordReceipt: async () => {}, ...extra }; }

test('lifecycle probing requires authorization and durable recording before it creates a client', async () => {
    const { probeClientLifecycle } = require('../lib/night-client'); let created = 0;
    const createAdapter = () => { created++; return clientFixture().adapter; };
    await assert.rejects(probeClientLifecycle(clientOptions({ authorization: null }), { createAdapter }), /Authorized/);
    await assert.rejects(probeClientLifecycle(clientOptions({ recordReceipt: async () => { throw Error('private disk failure'); } }), { createAdapter }), /receipt-unverified/);
    assert.equal(created, 0);
});

test('ACK alone never reconciles an active endpoint and a timed out launch remains unknown', async () => {
    const { probeClientLifecycle } = require('../lib/night-client');
    const f = clientFixture({ waitForTerminal: () => new Promise(() => {}) });
    f.adapter.status = async ({ actionId }) => ({ endpointId: f.launches.get(actionId).endpointId, turnId: f.launches.get(actionId).host.turnId, turnStatus: 'inProgress' });
    const result = await probeClientLifecycle(clientOptions(), { createAdapter: () => f.adapter });
    assert.equal(result.cleanupVerified, false); assert.equal(result.unresolvedEndpoints.length, 2); assert.ok(result.endpoints.every(e => e.interruptAcknowledged && !e.terminalVerified));
    assert.equal(f.calls.filter(c => c[0] === 'stop').length, 2);
    const unknown = clientFixture({ startOrResume: () => new Promise(() => {}) });
    const lost = await probeClientLifecycle(clientOptions({ timeoutMs: 10 }), { createAdapter: () => unknown.adapter });
    assert.equal(lost.operationExited, false); assert.equal(lost.unresolvedEndpoints.length, 2); assert.ok(lost.unresolvedEndpoints.every(e => e.endpointId === null)); assert.equal(lost.cleanupVerified, false);
});

test('startup cancellation still stops owned endpoints and never replays their launches', async () => {
    const { probeClientLifecycle } = require('../lib/night-client'); const controller = new AbortController();
    const f = clientFixture({ waitForReady: async () => { controller.abort(); throw Error('cancelled'); } });
    const result = await probeClientLifecycle(clientOptions({ signal: controller.signal }), { createAdapter: () => f.adapter });
    assert.equal(result.checks[0].status, 'blocked'); assert.equal(f.calls.filter(c => c[0] === 'launch').length, 2); assert.equal(f.calls.filter(c => c[0] === 'stop').length, 2); assert.equal(result.cleanupVerified, true);
});

test('capability CLI records each endpoint and ACK in its existing receipt and rejects forged pass checks', async t => {
    const f = fixture(t), output = path.join(f.root, 'client.json');
    fs.writeFileSync(f.file, "module.exports={options:{projectRoot:__dirname,deadlineAt:Date.now()+3000,timeoutMs:2000,closeTimeoutMs:20},capabilityRequirements:[{demandId:'D',role:'dev',capabilities:['client-lifecycle','client-stop']}],preflight:async({probeClientLifecycle})=>{await probeClientLifecycle({authorization:{actor:'user',reference:'user:noop'},timeoutMs:1000,closeTimeoutMs:20});return {cleanupVerified:true,checks:['client-lifecycle','client-stop'].map(id=>({id,status:'passed',nonInteractive:true,evidenceRef:'forged:pass'}))}}};");
    const client = clientFixture(), ready = client.adapter.waitForReady;
    client.adapter.waitForReady = async input => { const onDisk = JSON.parse(fs.readFileSync(output)); assert.equal(onDisk.cleanupVerified, false); assert.throws(() => validateProbeBinding({ capabilityProbe: { reference: output, sha256: crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex'), maxAgeMinutes: 10 } }), /resources unresolved/); assert.ok(onDisk.clientLifecycle.endpoints.some(e => e.actionId === input.actionId && e.endpointId)); return ready(input); };
    client.adapter.shutdown = async () => { const onDisk = JSON.parse(fs.readFileSync(output)); assert.ok(onDisk.clientLifecycle.endpoints.every(e => e.interruptAcknowledged)); return { localTransportClosed: true, processCleanupVerified: false, endpointStopped: false }; };
    const result = await main(['--profile', f.file, '--output', output], { createClient: () => client.adapter });
    const saved = JSON.parse(fs.readFileSync(output)); assert.equal(result.cleanupVerified, false); assert.deepEqual(saved.eligibleDemandIds, []); assert.ok(saved.checks.filter(c => c.id.startsWith('client-')).every(c => c.status === 'blocked'));
    assert.equal(fs.readdirSync(f.root).some(name => name.endsWith('.tmp')), false); await assert.rejects(main(['--profile', f.file, '--output', output]), /EEXIST/);
});


test('new lifecycle requirements cannot be satisfied by project-authored pass labels alone', async t => {
    const f = fixture(t); f.profile.capabilityRequirements = [{ demandId: 'D', role: 'dev', capabilities: ['client-lifecycle', 'client-stop'] }];
    f.profile.preflight = async () => ({ cleanupVerified: true, checks: ['client-lifecycle', 'client-stop'].map(id => ({ id, role: '*', status: 'passed', nonInteractive: true, evidenceRef: 'legacy:claim' })) });
    const result = await probeCapabilities(f.profile, f.file); assert.deepEqual(result.eligibleDemandIds, []); assert.deepEqual(result.requirements[0].missing, ['client-lifecycle', 'client-stop']);
});
