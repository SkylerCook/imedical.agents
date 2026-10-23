'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const { diagnosticFields, appendDiagnostics } = require('./night-client-diagnostics');
const text = value => typeof value === 'string' && value.trim().length > 0;
const executableWork = (manifest, work) => work.status !== 'skipped' && work.night?.phase !== 'cleanup' && !manifest.executionPlan?.demands?.some(d => d.id === work.night?.demandId && ['blocked', 'unsupported'].includes(d.feasibility));
async function probeCapabilities(profile, profileFile, { createExecutor = require('./playwright-runner').createTestExecutor, signal } = {}) {
    const requirements = profile.capabilityRequirements;
    if (!Array.isArray(requirements) || !requirements.length || requirements.some(r => !text(r.demandId) || !text(r.role) || !Array.isArray(r.capabilities) || !r.capabilities.length || r.capabilities.some(c => !text(c)))) throw new Error('Initial demand capabilityRequirements required before detailed PLAN');
    const options = profile.options || {}, limit = Math.min(options.timeoutMs || 30000, (options.deadlineAt || 0) - Date.now());
    if (!Number.isFinite(limit) || limit <= 0 || typeof profile.preflight !== 'function') throw new Error('Bounded project preflight adapter required');
    const files = [...new Set([path.resolve(profileFile), ...(options.configurationFiles || []).map(f => path.resolve(f))])];
    const configurationFiles = files.map(file => ({ path: fs.realpathSync.native(file), sha256: digest(file) }));
    const controller = new AbortController(), executors = [], diagnostics = []; let timer, data, settled = false, failure = null;
    const combined = AbortSignal.any([controller.signal, ...[signal, options.signal].filter(Boolean)]);
    const operation = Promise.resolve().then(() => { if (combined.aborted) throw Error('capability-probe-stopped'); return profile.preflight({ signal: combined, createTestExecutor: settings => {
        if (combined.aborted) throw Error('capability-probe-stopped');
        const executor = createExecutor({ ...settings, deadlineAt: Math.min(settings.deadlineAt || options.deadlineAt, options.deadlineAt), signal: combined });
        executors.push(executor); return executor;
    } }); });
    operation.then(() => { settled = true; }, () => { settled = true; });
    let cancelled;
    try { data = await Promise.race([operation, new Promise((_, reject) => { cancelled = () => reject(Error('capability-probe-cancelled')); combined.addEventListener('abort', cancelled, { once: true }); if (combined.aborted) cancelled(); timer = setTimeout(() => { controller.abort(); reject(Error('capability-probe-timeout')); }, limit); })]); }
    catch (error) { failure = 'capability-probe-failed-or-timeout'; appendDiagnostics(diagnostics, error, 'capability'); }
    finally { clearTimeout(timer); combined.removeEventListener('abort', cancelled); }
    appendDiagnostics(diagnostics, data, 'capability');
    const exits = [];
    for (const executor of executors) {
        let closeTimer;
        try { exits.push({ info: executor.info(), exit: await Promise.race([executor.stop(), new Promise((_, reject) => { closeTimer = setTimeout(() => reject(Error('probe-close-timeout')), options.closeTimeoutMs || 10000); })]) }); }
        catch (error) { exits.push({ exit: { cleanupVerified: false } }); appendDiagnostics(diagnostics, error, 'capability'); }
        finally { clearTimeout(closeTimer); }
    }
    const configurationUnchanged = configurationFiles.every(f => digest(f.path) === f.sha256);
    const cleanupVerified = settled && data?.cleanupVerified === true && exits.every(r => r.exit.cleanupVerified === true && !r.exit.pendingOperations);
    const browserExited = cleanupVerified && exits.some(r => text(r.info?.browserVersion) && r.info.headless === true);
    const checks = (Array.isArray(data?.checks) ? data.checks : []).filter(c => c.id !== 'browser-lifecycle' && text(c.id) && text(c.evidenceRef) && ['passed', 'blocked', 'failed'].includes(c.status)).map(c => ({ id: c.id, role: c.role || '*', status: c.status, nonInteractive: c.nonInteractive === true, evidenceRef: c.evidenceRef, ...diagnosticFields(c, 'capability'), ...(c.executor ? { executor: c.executor } : {}) }));
    checks.push({ id: 'browser-lifecycle', role: '*', status: browserExited ? 'passed' : 'blocked', nonInteractive: true, evidenceRef: 'probe:owned-browser-start-and-actual-close' });
    const assessments = requirements.map(r => {
        const needed = [...new Set([...r.capabilities, ...(r.capabilities.includes('browser') ? ['browser-lifecycle'] : [])])];
        const missing = needed.filter(id => !checks.some(c => c.id === id && ['*', r.role].includes(c.role) && c.status === 'passed' && c.nonInteractive && (id !== 'browser' || c.executor === 'playwright-headless')));
        return { ...r, capabilities: needed, missing, executable: !failure && configurationUnchanged && cleanupVerified && !missing.length };
    });
    const ids = [...new Set(requirements.map(r => r.demandId))];
    const browserLifecycle = { verified: browserExited, instances: exits.map(r => ({ kind: r.info?.kind || 'unknown', nodeVersion: r.info?.nodeVersion || null, playwrightVersion: r.info?.playwrightVersion || null, browserVersion: r.info?.browserVersion || null, headless: r.info?.headless === true, cleanupVerified: r.exit.cleanupVerified === true, pendingOperations: r.exit.pendingOperations ?? null, failureStages: r.exit.failureStages || [] })) };
    return { schema: 'night-capability-probe/v1', ...(diagnostics.length ? { diagnostics } : {}), checkedAt: new Date().toISOString(), profileFingerprint: digest(profileFile), configurationFiles, cleanupVerified, operationExited: settled, failure, checks, browserLifecycle, requirements: assessments, eligibleDemandIds: ids.filter(id => assessments.filter(r => r.demandId === id).every(r => r.executable)), limitation: 'Capability evidence only; no business execution or authorization granted.' };
}
function validateProbeBinding(plan, workItems = [], { started = false } = {}) {
    const binding = plan.capabilityProbe;
    if (binding === undefined) return; // Existing approved plans are not migrated.
    if (!path.isAbsolute(binding.reference || '') || !/^[a-f0-9]{64}$/.test(binding.sha256 || '') || !Number.isFinite(binding.maxAgeMinutes) || binding.maxAgeMinutes <= 0 || digest(binding.reference) !== binding.sha256) throw new Error('Capability probe binding unavailable or changed');
    const receipt = JSON.parse(fs.readFileSync(binding.reference, 'utf8')), age = Date.now() - Date.parse(receipt.checkedAt);
    if (receipt.schema !== 'night-capability-probe/v1' || !receipt.cleanupVerified || !receipt.operationExited || !Number.isFinite(age) || age < 0 || !started && age > binding.maxAgeMinutes * 60000 || !receipt.configurationFiles?.length || receipt.configurationFiles.some(f => digest(f.path) !== f.sha256)) throw new Error('Capability probe stale, configuration changed or resources unresolved');
    for (const demand of plan.demands.filter(d => !['blocked', 'unsupported'].includes(d.feasibility))) {
        const rows = receipt.requirements.filter(r => r.demandId === demand.id);
        if (!rows.length || !receipt.eligibleDemandIds.includes(demand.id) || rows.some(r => !r.executable)) throw new Error('Executable demand is outside the pre-PLAN capability subset');
        const browserNeeded = plan.minimumTests.some(t => t.demandId === demand.id && t.level === 'ui') || workItems.some(w => w.night?.demandId === demand.id && (w.night.route === 'ui' || w.night.authentication === 'browser-session' || w.night.authentication?.mode === 'browser-session'));
        if (browserNeeded && !rows.some(r => r.capabilities.includes('browser') && r.capabilities.includes('browser-lifecycle'))) throw new Error('UI or browser authentication lacks pre-PLAN browser lifecycle evidence');
        for (const work of workItems.filter(w => w.night?.demandId === demand.id)) if (work.night.requiredCapabilities?.some(c => !rows.some(r => ['*', work.night.role].includes(r.role) && r.capabilities.includes(c)))) throw new Error('Planned capability outside initial probe');
    }
}
module.exports = { executableWork, probeCapabilities, validateProbeBinding };
