'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {TextDecoder} = require('node:util');
const workspace = require('../../../../scripts/lib/workspace-context');
const {readProjectEnv} = require('./project-env');
const catalog = require('./baseline-catalog');

const SCHEMA = 'iris-code-baseline/v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => require('./source-publication').canonical(value);
const finalStates = new Set(['fetched', 'reused', 'missing', 'empty', 'failed', 'cancelled']);
function stop(code, details = {}) { throw Object.assign(new Error(code), {code, details}); }
function inside(root, file) { const relative = path.relative(root, file); return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }
function bytes(file) {
    catalog.checkPath(file);
    try { if (!fs.lstatSync(file).isFile()) stop('baseline-target-not-file'); return fs.readFileSync(file); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function digestFile(file) { const value = bytes(file); return value === null ? null : hash(value); }
function json(file) { return JSON.parse(fs.readFileSync(catalog.checkPath(file), 'utf8').replace(/^\uFEFF/, '')); }
function integrity(plan) { const {integrity: ignored, ...value} = plan; return hash(canonical(value)); }
function save(plan) { plan.updatedAt = new Date().toISOString(); plan.integrity = integrity(plan); catalog.writeAtomic(plan.planPath, JSON.stringify(plan, null, 2) + '\n'); }
function acquirePlanLock(plan, resume) {
    const lock = path.join(path.dirname(plan.planPath), 'capture.lock');
    const owner = {pid: process.pid, machine: hash(os.hostname()), token: crypto.randomUUID()};
    catalog.checkPath(lock);
    if (fs.existsSync(lock)) {
        const prior = json(lock);
        if (!resume || prior.machine !== owner.machine || !Number.isInteger(prior.pid) || prior.pid < 1) stop('baseline-capture-owner-unresolved');
        let alive = true;
        try { process.kill(prior.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
        if (alive) stop('baseline-capture-owner-live');
        if (json(lock).token !== prior.token) stop('baseline-capture-owner-changed');
        fs.unlinkSync(lock);
    }
    try { fs.writeFileSync(lock, JSON.stringify(owner), {flag: 'wx', mode: 0o600}); }
    catch (error) { if (error.code === 'EEXIST') stop('baseline-capture-owner-live'); throw error; }
    return () => { if (fs.existsSync(lock) && json(lock).token === owner.token) fs.unlinkSync(lock); };
}
function load(file) {
    const plan = json(path.resolve(file));
    if (plan.schema !== SCHEMA || plan.integrity !== integrity(plan) || plan.planPath !== path.resolve(file)) stop('baseline-plan-integrity-invalid');
    if (!Array.isArray(plan.items) || !Array.isArray(plan.excludedImages) || !path.isAbsolute(plan.outputRoot || '') || !path.isAbsolute(plan.workspaceRoot || '') || !path.isAbsolute(plan.contextRoot || '')) stop('baseline-plan-invalid');
    if (!inside(path.join(plan.contextRoot, 'work', 'source-sync', 'baselines'), plan.planPath)) stop('baseline-state-path-invalid');
    for (const item of plan.items) {
        if (!inside(plan.outputRoot, item.destination) || item.destination !== path.join(plan.outputRoot, item.relativePath) || !['pending', ...finalStates].includes(item.status)) stop('baseline-item-path-invalid');
        catalog.checkPath(item.destination);
    }
    return plan;
}
function contextFor(projectRoot) {
    const context = workspace.resolveWorkspaceContext(path.resolve(projectRoot || process.cwd()));
    if (context.manifestError) stop('invalid-workspace-context');
    return context;
}
function sourceIdentity(context, options = {}) {
    const {config} = readProjectEnv(context, {optional: true});
    const mcpPath = path.join(context.workspaceRoot, '.mcp.json');
    const mcp = fs.existsSync(mcpPath) ? json(mcpPath) : {};
    const env = mcp.mcpServers?.[config.mcp?.serverName || 'iris-agentic-dev']?.env || {};
    const iris = config.iris || {};
    if (Object.keys(env).length) require('./project-env').validateTarget(config, env);
    const target = {scheme: env.IRIS_SCHEME || iris.scheme || 'https', host: env.IRIS_HOST || iris.host || '',
        port: Number(env.IRIS_WEB_PORT || iris.port || ((env.IRIS_SCHEME || iris.scheme) === 'http' ? 80 : 443)), namespace: env.IRIS_NAMESPACE || iris.namespace || ''};
    const identity = {workspaceRoot: context.workspaceRoot, contextRoot: context.contextRoot, capabilityRoot: context.capabilityRoot,
        sourceRoots: context.sourceRoots.map(source => ({name: source.name, path: source.path, target: source.target, gitRoot: source.gitRoot})),
        environmentAlias: options.environmentAlias || '', instanceFingerprint: hash(canonical(target)), namespace: target.namespace,
        configurationFingerprint: hash(canonical({config, mcp}))};
    return {identity, config, mcp};
}
function selectItems(items, options = {}) {
    const selected = [], excludedImages = [], types = options.type ? new Set(String(options.type).split(',').map(value => value.trim().toUpperCase())) : null;
    if (types && [...types].some(type => !['CLS', 'MAC', 'INC', 'INT', 'CSP'].includes(type))) stop('baseline-type-invalid');
    const seen = new Set();
    for (const item of items) {
        const normalized = require('./xml-package-core').normalizeDocument(item);
        const extension = path.posix.extname(normalized.document).toLowerCase();
        if (catalog.IMAGE_EXTENSIONS.has(extension)) { excludedImages.push({...item, reason: 'image-excluded-from-code-baseline'}); continue; }
        if (!catalog.OBJECT_TYPES.has(extension) && !catalog.TEXT_EXTENSIONS.has(extension)) stop('baseline-type-unsupported', {document: normalized.document});
        if (types && !types.has(item.type) || options.prefix && !item.name.toLowerCase().startsWith(String(options.prefix).toLowerCase())) continue;
        const object = catalog.OBJECT_TYPES.has(extension);
        const relativePath = object ? extension === '.cls' ? path.join('src', ...normalized.document.slice(0, -4).split('.')) + extension : path.join('src', 'routines', normalized.document) : path.join('src', ...normalized.document.replace(/^\/+/, '').split('/'));
        const collision = relativePath.toLowerCase();
        if (seen.has(collision)) stop('baseline-path-conflict', {path: relativePath});
        seen.add(collision);
        selected.push({...item, document: normalized.document, identity: normalized.identity || `${item.type}:${item.name}`,
            relativePath, kind: object ? 'backend' : 'frontend'});
    }
    return {selected, excludedImages};
}
function assertPrivate(context, directory) {
    if (context.capabilityRoot !== context.contextRoot && inside(context.capabilityRoot, directory)) stop('baseline-state-in-shared-capability');
    for (const root of [...new Set([...(context.gitRoots || []), context.capabilityRoot])]) {
        if (!root || !inside(root, directory)) continue;
        const git = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {encoding: 'utf8', windowsHide: true});
        if (git.status !== 0) continue;
        const relative = path.relative(git.stdout.trim(), path.join(directory, '.privacy-check'));
        const ignored = spawnSync('git', ['-C', git.stdout.trim(), 'check-ignore', '--no-index', '--', relative], {windowsHide: true});
        if (ignored.status !== 0) stop('baseline-private-state-not-ignored');
    }
}
function createPlan(options = {}) {
    if (!options.baseline || !options.out) stop('baseline-input-and-out-required');
    const context = options.context || contextFor(options.projectRoot);
    const source = sourceIdentity(context, options);
    const baseline = path.resolve(options.baseline), outputRoot = catalog.checkPath(path.resolve(options.out));
    if (inside(context.capabilityRoot, outputRoot)) stop('baseline-output-in-capability');
    const baselineBytes = fs.readFileSync(catalog.checkPath(baseline));
    const parsed = require('./xml-package-core').parseProjectItems(baselineBytes);
    const {selected, excludedImages} = selectItems(parsed, options);
    const sourceFingerprint = hash(canonical(source.identity));
    let previous;
    if (options.previousPlan) {
        previous = load(options.previousPlan);
        if (previous.sourceFingerprint !== sourceFingerprint || previous.outputRoot !== outputRoot) stop('baseline-previous-source-mismatch');
    }
    const id = crypto.randomUUID(), stateRoot = path.join(context.contextRoot, 'work', 'source-sync', 'baselines');
    catalog.checkPath(stateRoot); assertPrivate(context, stateRoot);
    const plan = {schema: SCHEMA, id, state: 'planned', createdAt: new Date().toISOString(),
        workspaceRoot: context.workspaceRoot, contextRoot: context.contextRoot, outputRoot,
        planPath: path.join(stateRoot, id, 'plan.json'), baseline, baselineSha256: hash(baselineBytes),
        sourceIdentity: source.identity, sourceFingerprint, filters: {type: options.type || '', prefix: options.prefix || ''},
        acquisition: acquisition(options),
        items: selected.map(item => {
            const destination = path.join(outputRoot, item.relativePath); catalog.checkPath(destination);
            const expectedSha256 = digestFile(destination), prior = previous?.items.find(value => value.document === item.document && ['fetched', 'reused'].includes(value.status));
            if (prior && expectedSha256 !== prior.sha256) stop('baseline-local-drift', {document: item.document});
            return {...item, destination, expectedSha256, owned: !!prior, status: 'pending'};
        }), excludedImages, inputTotal: parsed.length, cleanup: null, acceptance: null};
    plan.binding = hash(canonical({sourceFingerprint, outputRoot, baselineSha256: plan.baselineSha256, filters: plan.filters,
        documents: plan.items.map(item => ({document: item.document, relativePath: item.relativePath})), acquisition: plan.acquisition}));
    save(plan);
    return summary(plan);
}
function acquisition(options) {
    const profiles = {safe: {sessions: 1, intervalMs: 200}, balanced: {sessions: 4, intervalMs: 100}, fast: {sessions: 10, intervalMs: 50}};
    const profile = options.profile || 'balanced';
    if (!profiles[profile]) stop('baseline-profile-invalid');
    const selected = {profile, sessions: options.sessions ?? profiles[profile].sessions, intervalMs: options.intervalMs ?? profiles[profile].intervalMs,
        explicitSessions: options.sessions !== undefined, explicitInterval: options.intervalMs !== undefined};
    if (!Number.isInteger(selected.sessions) || selected.sessions < 1 || selected.sessions > 20 || !Number.isInteger(selected.intervalMs) || selected.intervalMs < 0) stop('baseline-acquisition-invalid');
    return selected;
}
function assertSource(plan) {
    const context = contextFor(plan.workspaceRoot);
    const current = sourceIdentity(context, {environmentAlias: plan.sourceIdentity.environmentAlias});
    if (hash(canonical(current.identity)) !== plan.sourceFingerprint) stop('baseline-source-changed');
    if (hash(fs.readFileSync(catalog.checkPath(plan.baseline))) !== plan.baselineSha256) stop('baseline-catalog-changed');
    return {context, ...current};
}
function summary(plan) {
    const counts = Object.fromEntries(['fetched', 'reused', 'missing', 'empty', 'failed', 'cancelled', 'pending'].map(status => [status, plan.items.filter(item => item.status === status).length]));
    return {schema: SCHEMA, id: plan.id, state: plan.state, planPath: plan.planPath, out: plan.outputRoot, inputTotal: plan.inputTotal,
        total: plan.items.length, excludedImageCount: plan.excludedImages.length, excludedImages: plan.excludedImages, ...counts,
        complete: plan.state === 'complete', acquisition: plan.acquisition, effectiveSessions: plan.effectiveSessions ?? null, cleanup: plan.cleanup, accepted: plan.state === 'accepted-partial',
        items: plan.items.map(({name, type, document, relativePath, status, sha256, reason, observedAt}) => ({name, type, document, relativePath, status, sha256, reason, observedAt}))};
}
function cleanupReceipt(value) {
    if (!value) return null;
    return Object.fromEntries(['schema', 'cleanupVerified', 'licenseReleaseVerified', 'requestedSessions', 'sessions', 'requestedIntervalMs', 'intervalMs', 'channel', 'configurationFingerprint', 'runtimeFingerprint', 'serverVersion', 'instanceId', 'workers', 'remote', 'elapsedMs', 'noRemoteRequests', 'reason']
        .filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}
function validateContent(item, value) {
    const content = value && (Buffer.isBuffer(value) ? value : value.bytes || value.content);
    if (!Buffer.isBuffer(content)) stop('baseline-document-invalid');
    if (value.document && value.document !== item.document) stop('baseline-document-identity-mismatch');
    if (!content.length) return null;
    try { const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(content); if (text.includes('\0') || value.enc) stop('baseline-content-not-text'); }
    catch (error) { if (error.code) throw error; stop('baseline-content-not-text'); }
    if (item.type === 'CLS' && require('./backend-document').documentName(item.destination, content.toString('utf8')) !== item.document) stop('baseline-document-identity-mismatch');
    if (value.sha256 && value.sha256 !== hash(content)) stop('baseline-content-digest-mismatch');
    return content;
}
function saveContent(plan, item, value, hooks = {}) {
    const content = validateContent(item, value);
    if (content === null) { item.status = 'empty'; return; }
    const digest = hash(content), current = digestFile(item.destination);
    if (current !== item.expectedSha256) stop('baseline-local-drift', {document: item.document});
    if (current === digest) item.status = 'reused';
    else {
        if (current !== null && !item.owned) stop('baseline-existing-file-conflict', {document: item.document});
        if (current !== null && (fs.statSync(item.destination).mode & 0o200) === 0) stop('baseline-readonly-file', {document: item.document});
        const temporaryPath = item.destination + '.' + plan.id + '.' + crypto.randomUUID() + '.tmp';
        item.writeIntent = {beforeSha256: item.expectedSha256, afterSha256: digest, temporaryPath,
            ts: value.ts || null, representation: value.representation || 'atelier-text-utf8', observedAt: new Date().toISOString()};
        save(plan);
        catalog.writeAtomic(item.destination, content, () => {
            if (hooks.beforeReplace) hooks.beforeReplace(item);
            if (digestFile(item.destination) !== item.expectedSha256) stop('baseline-local-drift', {document: item.document});
        }, {temporaryPath});
        if (hooks.afterReplace) hooks.afterReplace(item);
        item.status = 'fetched';
    }
    item.sha256 = digest; item.bytes = content.length; item.ts = value.ts || null;
    item.representation = value.representation || 'atelier-text-utf8'; item.observedAt = new Date().toISOString();
    item.expectedSha256 = digest; item.owned = true; delete item.writeIntent;
}
function recoverWrite(plan, item) {
    const intent = item.writeIntent;
    if (!intent) return;
    if (!/^[a-f0-9]{64}$/.test(intent.afterSha256 || '') || intent.beforeSha256 !== item.expectedSha256 ||
        typeof intent.temporaryPath !== 'string' || !intent.temporaryPath.startsWith(item.destination + '.' + plan.id + '.') ||
        path.dirname(intent.temporaryPath) !== path.dirname(item.destination) || !intent.temporaryPath.endsWith('.tmp')) stop('baseline-write-intent-invalid');
    const current = digestFile(item.destination);
    if (current !== intent.beforeSha256 && current !== intent.afterSha256) stop('baseline-local-drift', {document: item.document});
    if (fs.existsSync(intent.temporaryPath)) {
        if (digestFile(intent.temporaryPath) !== intent.afterSha256) stop('baseline-temporary-drift');
        fs.unlinkSync(intent.temporaryPath);
    }
    if (current === intent.afterSha256) {
        const content = bytes(item.destination);
        validateContent(item, {document: item.document, bytes: content, sha256: current});
        item.status = 'fetched'; item.sha256 = current; item.expectedSha256 = current; item.owned = true;
        item.bytes = content.length; item.ts = intent.ts; item.representation = intent.representation; item.observedAt = intent.observedAt;
    }
    delete item.writeIntent;
}
async function capture(planFile, options = {}) {
    const plan = load(planFile), source = assertSource(plan);
    if (!['planned', 'reading', 'partial', 'interrupted', 'accepted-partial', 'blocked'].includes(plan.state)) stop('baseline-state-not-capturable');
    if (plan.state !== 'planned' && options.resume !== true) stop('baseline-resume-required');
    const release = acquirePlanLock(plan, options.resume === true);
    try {
    const pending = [];
    for (const item of plan.items) {
        recoverWrite(plan, item);
        if (['fetched', 'reused'].includes(item.status)) {
            if (digestFile(item.destination) !== item.sha256) stop('baseline-local-drift', {document: item.document});
        } else {
            if (digestFile(item.destination) !== item.expectedSha256) stop('baseline-local-drift', {document: item.document});
            item.status = 'pending'; delete item.reason; pending.push(item);
        }
    }
    plan.acceptance = null; plan.state = 'reading'; plan.startedAt ||= new Date().toISOString(); save(plan);
    let reader;
    try {
        if (pending.length) {
            const createReader = options.readerFactory || require('../../../../scripts/lib/atelier-read-pool').createAtelierReadPool;
            const connection = require('./compile-csp').connection(source.config, source.mcp);
            reader = await createReader({context: source.context, connection, ...plan.acquisition, qualification: options.qualification});
            const seen = new Set();
            const result = await reader.readAll(pending.map(item => item.document), {onResult: async record => {
                const item = pending[record.index];
                if (!item || item.document !== record.document || seen.has(record.index) || !finalStates.has(record.status)) stop('baseline-reader-result-invalid');
                seen.add(record.index);
                if (record.status === 'fetched') {
                    try { saveContent(plan, item, record.value, options); }
                    catch (error) { item.status = 'failed'; item.reason = error.code || 'baseline-write-failed'; }
                } else { item.status = record.status; item.reason = record.error?.code || record.status; }
                save(plan);
            }});
            for (const item of pending) if (item.status === 'pending') { item.status = 'cancelled'; item.reason = 'reader-did-not-complete'; }
            plan.cleanup = cleanupReceipt(result?.cleanup || result);
            plan.effectiveSessions = result?.actualSessions ?? result?.sessions ?? null;
        } else plan.cleanup = {cleanupVerified: true, noRemoteRequests: true, licenseReleaseVerified: false};
    } catch (error) {
        for (const item of pending) if (item.status === 'pending') { item.status = 'cancelled'; item.reason = error.code || 'baseline-reader-interrupted'; }
        plan.reason = error.code || 'baseline-reader-interrupted'; plan.state = 'interrupted';
    } finally {
        if (reader) {
            try { plan.cleanup = cleanupReceipt(await reader.close()); }
            catch (error) { plan.cleanup = {cleanupVerified: false, reason: error.code || 'baseline-reader-close-failed'}; }
        }
        plan.finishedAt = new Date().toISOString();
        if (plan.cleanup?.cleanupVerified !== true) plan.state = 'blocked';
        else if (plan.state !== 'interrupted') plan.state = plan.items.every(item => ['fetched', 'reused'].includes(item.status)) ? 'complete' : 'partial';
        save(plan);
    }
    return summary(plan);
    } finally { release(); }
}
function status(file) { return summary(load(file)); }
async function qualify(planFile, options = {}) {
    const plan = load(planFile), source = assertSource(plan), budgetMs = options.budgetMs;
    if (plan.state !== 'planned' || options.confirm !== true || !Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 3600000 || !plan.items.length) stop('baseline-qualification-budget-required');
    const pool = require('../../../../scripts/lib/atelier-read-pool');
    const connection = require('./compile-csp').connection(source.config, source.mcp);
    const grant = {confirm: true, targetHash: pool.readTargetHash(connection), documents: plan.items.map(item => item.document),
        sessions: plan.acquisition.sessions, intervalMs: plan.acquisition.intervalMs, budgetMs};
    const result = await capture(planFile, {...options, qualification: grant});
    const receipt = {schema: 'iris-read-qualification/v1', status: 'pending', targetHash: grant.targetHash,
        channel: result.cleanup?.channel || 'atelier', configurationFingerprint: result.cleanup?.configurationFingerprint || pool.readConfigurationHash(connection),
        runtimeFingerprint: result.cleanup?.runtimeFingerprint || pool.readRuntimeHash(), serverVersion: result.cleanup?.serverVersion || null,
        instanceId: result.cleanup?.instanceId ?? null,
        sessions: grant.sessions, intervalMs: grant.intervalMs, maxDocuments: grant.documents.length,
        documentsSha256: hash(canonical(grant.documents)), budgetMs, shutdownVerified: result.cleanup?.cleanupVerified === true,
        resourceReturnVerified: false, planId: plan.id, observedAt: new Date().toISOString()};
    const qualificationPath = path.join(path.dirname(plan.planPath), 'qualification.pending.json');
    catalog.writeAtomic(qualificationPath, JSON.stringify(receipt, null, 2) + '\n');
    return {...result, qualification: receipt, qualificationPath};
}
function acceptanceToken(plan) {
    return hash(canonical({binding: plan.binding, items: plan.items.map(item => ({identity: item.identity, status: item.status, sha256: item.sha256 || null, reason: item.reason || null}))}));
}
function acceptPartial(file, {confirm = false, token, evidence} = {}) {
    const plan = load(file); assertSource(plan);
    if (plan.state !== 'partial' || plan.items.some(item => ['failed', 'cancelled', 'pending'].includes(item.status)) || plan.cleanup?.cleanupVerified !== true || !confirm || !evidence || token !== acceptanceToken(plan)) stop('baseline-partial-acceptance-required', {token: acceptanceToken(plan)});
    for (const item of plan.items.filter(item => ['fetched', 'reused'].includes(item.status))) if (digestFile(item.destination) !== item.sha256) stop('baseline-local-drift', {document: item.document});
    plan.acceptance = {token, evidence, at: new Date().toISOString()}; plan.state = 'accepted-partial'; save(plan); return summary(plan);
}
function successfulScope(file) {
    const plan = load(file); assertSource(plan);
    if (!['complete', 'accepted-partial'].includes(plan.state) || plan.state === 'accepted-partial' && plan.acceptance?.token !== acceptanceToken(plan)) stop('baseline-scope-not-accepted');
    return plan.items.filter(item => ['fetched', 'reused'].includes(item.status)).map(item => {
        if (digestFile(item.destination) !== item.sha256) stop('baseline-local-drift', {document: item.document});
        return {document: item.document, name: item.name, type: item.type, sourcePath: item.destination, sha256: item.sha256};
    });
}
function projectPlan(options) {
    const sync = require('./source-sync-core');
    return sync.createPlan({...options, kind: 'project', map: options.baseline});
}
module.exports = {SCHEMA, hash, createPlan, capture, qualify, status, load, save, selectItems, sourceIdentity, validateContent, saveContent, acceptanceToken, acceptPartial, successfulScope, projectPlan};
