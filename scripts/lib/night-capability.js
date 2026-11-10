'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const { diagnosticFields, appendDiagnostics } = require('./night-client-diagnostics');
const { probeClientLifecycle: clientProbe, createClientAdapter } = require('./night-client');
const text = value => typeof value === 'string' && value.trim().length > 0;
const REASONS = new Set(['implementation-missing', 'not-attempted', 'execution-failed', 'exit-unknown', 'not-applicable']);
function requirementCapabilities(row) {
    return [...new Set([...row.capabilities,
        ...(row.level === 'ui' || row.authentication === 'browser-session' ? ['browser'] : []),
        ...(row.authentication && row.authentication !== 'none' ? ['authentication'] : []),
        ...(row.effects === 'write' ? ['fixture-authority', 'data-disposition'] : [])])];
}
function matchesCheck(check, row) {
    return ['*', row.role].includes(check.role) && (!check.demandId || check.demandId === row.demandId) && (!check.caseId || check.caseId === row.caseId);
}
function reasonFields(check) {
    return { ...(REASONS.has(check.reason) ? { reason: check.reason } : {}),
        ...Object.fromEntries(['owner', 'recheckRef'].filter(key => text(check[key])).map(key => [key, check[key]])) };
}
function validCheck(check) {
    return check && check.id !== 'browser-lifecycle' && text(check.id) && text(check.evidenceRef) &&
        ['passed', 'blocked', 'failed'].includes(check.status) &&
        ['demandId', 'caseId', 'role'].every(key => check[key] === undefined || text(check[key]));
}
const executableWork = (manifest, work) => work.status !== 'skipped' && work.night?.phase !== 'cleanup' && !manifest.executionPlan?.demands?.some(d => d.id === work.night?.demandId && ['blocked', 'unsupported'].includes(d.feasibility));
async function probeCapabilities(profile, profileFile, { createExecutor = require('./playwright-runner').createTestExecutor, createClient = createClientAdapter, signal, onProgress } = {}) {
    const requirements = profile.capabilityRequirements;
    if (!Array.isArray(requirements) || !requirements.length || requirements.some(r => !text(r.demandId) || !text(r.role) || !Array.isArray(r.capabilities) || !r.capabilities.length || r.capabilities.some(c => !text(c)))) throw new Error('Initial demand capabilityRequirements required before detailed PLAN');
    for (const row of requirements) {
        if (row.effects !== undefined && !['read-only', 'write'].includes(row.effects) || row.caseId !== undefined && !text(row.caseId)) throw Error('Invalid capability requirement effects or caseId');
        if (row.level !== undefined && !['static-review', 'internal-method', 'external-api', 'ui', 'manual', 'not-applicable'].includes(row.level) || row.authentication !== undefined && !['none', 'browser-session', 'api'].includes(row.authentication)) throw Error('Invalid capability requirement level or authentication');
        if (['level', 'effects', 'authentication', 'caseId'].some(key => row[key] !== undefined) && !text(row.rationale)) throw Error('Case capability requirements need a rationale');
    }
    const options = profile.options || {}, limit = Math.min(options.timeoutMs || 30000, (options.deadlineAt || 0) - Date.now());
    if (!Number.isFinite(limit) || limit <= 0 || typeof profile.preflight !== 'function') throw new Error('Bounded project preflight adapter required');
    const probeDeadline = Date.now() + limit;
    const files = [...new Set([path.resolve(profileFile), ...(options.configurationFiles || []).map(f => path.resolve(f))])];
    const configurationFiles = files.map(file => ({ path: fs.realpathSync.native(file), sha256: digest(file) }));
    const controller = new AbortController(), executors = [], diagnostics = []; let timer, data, settled = false, failure = null, preflightClosed = false, clientLifecycle, clientTask, clientExited = true;
    const combined = AbortSignal.any([controller.signal, ...[signal, options.signal].filter(Boolean)]);
    const operation = Promise.resolve().then(() => { if (combined.aborted) throw Error('capability-probe-stopped'); return profile.preflight({ signal: combined, probeClientLifecycle: settings => {
        if (preflightClosed || combined.aborted || clientTask || typeof onProgress !== 'function') throw Error('One owned client probe requires a live persistent capability receipt');
        clientExited = false;
        clientTask = clientProbe({ ...settings, cwd: settings.cwd || options.projectRoot, deadlineAt: Math.min(typeof settings.deadlineAt === 'number' ? settings.deadlineAt : Date.parse(settings.deadlineAt) || options.deadlineAt, options.deadlineAt, probeDeadline), timeoutMs: Math.min(settings.timeoutMs ?? 30000, limit), closeTimeoutMs: Math.min(settings.closeTimeoutMs ?? 2000, options.closeTimeoutMs ?? 10000), signal: combined,
            recordReceipt: async receipt => { clientLifecycle = receipt; await onProgress({ clientLifecycle: receipt }); } }, { createAdapter: createClient });
        clientTask.then(() => { clientExited = true; }, () => { clientExited = true; });
        return clientTask;
    }, createTestExecutor: settings => {
        if (combined.aborted) throw Error('capability-probe-stopped');
        const executor = createExecutor({ ...settings, deadlineAt: Math.min(settings.deadlineAt || options.deadlineAt, options.deadlineAt), signal: combined });
        executors.push(executor); return executor;
    } }); });
    operation.then(() => { settled = true; }, () => { settled = true; });
    let cancelled;
    try { data = await Promise.race([operation, new Promise((_, reject) => { cancelled = () => reject(Error('capability-probe-cancelled')); combined.addEventListener('abort', cancelled, { once: true }); if (combined.aborted) cancelled(); timer = setTimeout(() => { controller.abort(); reject(Error('capability-probe-timeout')); }, limit); })]); }
    catch (error) { failure = 'capability-probe-failed-or-timeout'; appendDiagnostics(diagnostics, error, 'capability'); }
    finally { clearTimeout(timer); combined.removeEventListener('abort', cancelled); }
    preflightClosed = true;
    if (clientTask) {
        if (!clientExited) controller.abort();
        let closeTimer;
        try { await Promise.race([clientTask, new Promise((_, reject) => { closeTimer = setTimeout(() => reject(Error('client-probe-close-unverified')), (options.closeTimeoutMs || 10000) * 8 + 200); })]); }
        catch { failure ||= 'client-probe-unverified'; }
        finally { clearTimeout(closeTimer); }
    }
    appendDiagnostics(diagnostics, data, 'capability');
    for (const row of clientLifecycle?.endpoints || []) appendDiagnostics(diagnostics, row);
    const exits = [];
    for (const executor of executors) {
        let closeTimer;
        try { exits.push({ info: executor.info(), exit: await Promise.race([executor.stop(), new Promise((_, reject) => { closeTimer = setTimeout(() => reject(Error('probe-close-timeout')), options.closeTimeoutMs || 10000); })]) }); }
        catch (error) { exits.push({ exit: { cleanupVerified: false } }); appendDiagnostics(diagnostics, error, 'capability'); }
        finally { clearTimeout(closeTimer); }
    }
    const configurationUnchanged = configurationFiles.every(f => digest(f.path) === f.sha256);
    const cleanupVerified = settled && clientExited && (!clientTask || clientLifecycle?.cleanupVerified === true) && data?.cleanupVerified === true && exits.every(r => r.exit.cleanupVerified === true && !r.exit.pendingOperations);
    const browserExited = cleanupVerified && exits.some(r => text(r.info?.browserVersion) && r.info.headless === true);
    const checks = (Array.isArray(data?.checks) ? data.checks : []).filter(validCheck).map(c => ({ id: c.id, role: c.role || '*', status: c.reason && c.status === 'passed' ? 'blocked' : c.status, nonInteractive: c.nonInteractive === true, evidenceRef: c.evidenceRef, ...reasonFields(c), ...diagnosticFields(c, 'capability'), ...(text(c.demandId) ? { demandId: c.demandId } : {}), ...(text(c.caseId) ? { caseId: c.caseId } : {}), ...(c.executor ? { executor: c.executor } : {}) }));
    if (clientTask || requirements.some(r => r.capabilities.some(id => ['client-lifecycle', 'client-stop'].includes(id)))) {
        for (let index = checks.length - 1; index >= 0; index--) if (['client-lifecycle', 'client-stop'].includes(checks[index].id)) checks.splice(index, 1);
        checks.push(...(clientLifecycle?.checks || []));
    }
    checks.push({ id: 'browser-lifecycle', role: '*', status: browserExited ? 'passed' : 'blocked', nonInteractive: true, evidenceRef: 'probe:owned-browser-start-and-actual-close' });
    const assessments = requirements.map(r => {
        const declared = requirementCapabilities(r);
        const needed = [...new Set([...declared, ...(declared.includes('browser') ? ['browser-lifecycle'] : [])])];
        const missing = needed.filter(id => {
            const applicable = checks.filter(c => c.id === id && matchesCheck(c, r));
            return !applicable.some(c => c.status === 'passed' && c.nonInteractive && (id !== 'browser' || c.executor === 'playwright-headless')) || applicable.some(c => c.status !== 'passed');
        });
        const gaps = missing.map(id => {
            const check = checks.find(c => c.id === id && matchesCheck(c, r) && c.status !== 'passed');
            return { id, reason: check?.reason || (check?.status === 'failed' ? 'execution-failed' : 'unverified'), ...(check ? { evidenceRef: check.evidenceRef, ...reasonFields(check) } : {}) };
        });
        const blockers = [...(!configurationUnchanged ? ['configuration-changed'] : []), ...(!cleanupVerified ? ['exit-unknown'] : []), ...(failure ? [failure] : [])];
        return { ...r, capabilities: needed, missing, gaps, blockers, executable: !blockers.length && !missing.length };
    });
    const ids = [...new Set(requirements.map(r => r.demandId))];
    const browserLifecycle = { verified: browserExited, instances: exits.map(r => ({ kind: r.info?.kind || 'unknown', nodeVersion: r.info?.nodeVersion || null, playwrightVersion: r.info?.playwrightVersion || null, browserVersion: r.info?.browserVersion || null, headless: r.info?.headless === true, cleanupVerified: r.exit.cleanupVerified === true, pendingOperations: r.exit.pendingOperations ?? null, failureStages: r.exit.failureStages || [] })) };
    return { schema: 'night-capability-probe/v1', ...(clientTask ? { clientLifecycle } : {}), ...(diagnostics.length ? { diagnostics } : {}), checkedAt: new Date().toISOString(), profileFingerprint: digest(profileFile), configurationFiles, cleanupVerified, operationExited: settled && clientExited && (!clientTask || clientLifecycle?.operationExited === true), failure, checks, browserLifecycle, requirements: assessments, eligibleDemandIds: ids.filter(id => assessments.filter(r => r.demandId === id).every(r => r.executable)), limitation: 'Capability evidence only; no business execution or authorization granted.' };
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
