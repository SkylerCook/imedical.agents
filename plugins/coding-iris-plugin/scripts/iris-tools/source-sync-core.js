'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {TextDecoder} = require('node:util');
const {resolveWorkspaceContext, workspaceContextBlockers} = require('../../../../scripts/lib/workspace-context');
const {readProjectEnv} = require('./project-env');

const SCHEMA = 'iris-source-sync/v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const slash = value => value.replace(/\\/g, '/');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
function stop(reason, details = {}) { throw Object.assign(new Error(reason), {code: reason, details}); }
function within(base, target) { const relative = path.relative(base, target); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
function physical(base, target) {
    if (!within(base, target)) stop('path-outside-declared-root');
    let current = base;
    for (const segment of path.relative(base, target).split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) stop('linked-task-path');
    }
    return target;
}
function git(root, args, options = {}) {
    const result = spawnSync('git', ['-c', `safe.directory=${root}`, ...args], {
        cwd: root, windowsHide: true, encoding: null, maxBuffer: 32 * 1024 * 1024,
        env: {...process.env, ...(options.env || {})}, input: options.input
    });
    if (result.status !== 0 && !options.optional) stop('git-operation-failed', {operation: args[0], exitCode: result.status});
    return result.status === 0 ? result.stdout : null;
}
const textGit = (root, args, options) => git(root, args, options)?.toString('utf8').trim() || '';
function head(root) { return textGit(root, ['rev-parse', '--verify', 'HEAD'], {optional: true}) || null; }
function readBytes(file) {
    if (!fs.existsSync(file)) return null;
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) stop('task-file-not-regular');
    return fs.readFileSync(file);
}
function utf8(bytes) {
    if (bytes === null) return null;
    try { const value = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); if (value.includes('\0')) throw Error(); return value; }
    catch { stop('unsupported-source-encoding'); }
}
function comparisonBytes(file, bytes) {
    return bytes === null || file.kind !== 'backend' ? bytes : Buffer.from(utf8(bytes).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
}
function contentHash(file, bytes) { const value = comparisonBytes(file, bytes); return value === null ? null : hash(value); }
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function atomicJson(file, value) {
    physical(path.dirname(file), file);
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600}); fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function integrity(plan) { const {integrity: _, ...body} = plan; return hash(canonical(body)); }
function save(plan) { plan.updatedAt = new Date().toISOString(); plan.integrity = integrity(plan); atomicJson(plan.planPath, plan); }

function contextFor(projectRoot) {
    const context = resolveWorkspaceContext(path.resolve(projectRoot));
    if (workspaceContextBlockers(context).length) stop('invalid-workspace-context');
    return context;
}
function isOnDemand(context) {
    return require('../../../../scripts/lib/iris-remote-operations').contextMode(context) === 'intent-first-on-demand-export';
}
function assertIgnored(root, target) {
    if (!within(root, target)) return;
    if (!textGit(root, ['rev-parse', '--show-toplevel'], {optional: true})) stop('local-git-required');
    const relative = slash(path.relative(root, target));
    if (git(root, ['check-ignore', '--no-index', '--', relative], {optional: true}) === null) stop('private-state-not-ignored');
    if (git(root, ['ls-files', '--error-unmatch', '--', relative], {optional: true}) !== null) stop('private-state-is-tracked');
}
function privateRoot(context, roots = context.gitRoots) {
    // This owner path is also declared in the plugin manifest. It never points at shared capability assets.
    const root = physical(context.contextRoot, path.join(context.contextRoot, 'work', 'source-sync'));
    for (const gitRoot of [...new Set([...roots, context.capabilityRoot])]) {
        if (within(gitRoot, root)) {
            assertIgnored(gitRoot, path.join(root, '.privacy-check'));
            if (textGit(gitRoot, ['ls-files', '--', slash(path.relative(gitRoot, root))])) stop('private-state-is-tracked');
        }
    }
    return root;
}
function environment(context, options = {}) {
    const file = path.join(context.contextRoot, 'config', 'iris-development.json');
    const declared = fs.existsSync(file) ? json(file) : {};
    const alias = options.environmentAlias || declared.environmentAlias;
    const type = options.environmentType || declared.environmentType;
    if (!alias || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(alias) || !['test', 'development', 'production'].includes(type)) stop('explicit-environment-required');
    if (declared.environmentAlias && declared.environmentAlias !== alias || declared.environmentType && declared.environmentType !== type) stop('environment-declaration-mismatch');
    return {environmentAlias: alias, environmentType: type};
}
function demandKind(context, options = {}) {
    if (options.kind !== undefined) {
        if (!['standard', 'project'].includes(options.kind)) stop('explicit-demand-kind-required');
        return {kind: options.kind, source: 'explicit-task'};
    }
    for (const name of ['iris_project_profile.md', 'demand_delivery_profile.md']) {
        const file = path.join(context.contextRoot, 'config', name);
        if (!fs.existsSync(file)) continue;
        const matches = [...fs.readFileSync(file, 'utf8').matchAll(/^\s*[-*]?\s*`?默认需求交付类型`?\s*[:：=]\s*`?(standard|project)\b/gm)];
        if (matches.length === 1) return {kind: matches[0][1], source: name};
        if (matches.length > 1) stop('ambiguous-demand-kind');
    }
    stop('explicit-demand-kind-required');
}
function projectConfiguration(context) {
    require('../../../../scripts/lib/iris-remote-operations').assertRemoteAllowed(context);
    const {config} = readProjectEnv(context);
    const mcpFile = path.join(context.workspaceRoot, '.mcp.json');
    const mcp = fs.existsSync(mcpFile) ? json(mcpFile) : {};
    return {config, mcp};
}
function configurationFingerprint(context) {
    return require('./source-publication').fingerprint(require('../../../../scripts/lib/iris-remote-operations').bindDevelopmentMode(context, projectConfiguration(context)));
}
function repositoryFor(context, logicalPath) {
    const normalized = slash(String(logicalPath || ''));
    if (!normalized || path.isAbsolute(normalized) || normalized.split('/').some(part => !part || part === '..' || part === '.')) stop('invalid-source-path');
    if (normalized.split('/').some(part => ['.git', '.agents', '.mcp.json'].includes(part.toLowerCase()))) stop('private-or-framework-source-path');
    const matches = context.sourceRoots.map(source => ({source, prefix: slash(path.relative(context.workspaceRoot, source.path))}))
        .filter(({prefix}) => !prefix || normalized.startsWith(prefix + '/')).sort((a, b) => b.prefix.length - a.prefix.length);
    if (!matches.length) stop('source-root-not-declared');
    const {source, prefix} = matches[0];
    const sourcePath = physical(source.target, path.resolve(source.target, prefix ? normalized.slice(prefix.length + 1) : normalized));
    if (!within(source.gitRoot, sourcePath)) stop('source-outside-git-root');
    const actualRoot = textGit(source.gitRoot, ['rev-parse', '--show-toplevel'], {optional: true});
    if (!actualRoot || path.resolve(actualRoot) !== path.resolve(source.gitRoot)) stop('local-git-required');
    return {path: normalized, sourcePath, gitPath: slash(path.relative(source.gitRoot, sourcePath)), gitRoot: source.gitRoot};
}
function classify(context, logicalPath, options = {}) {
    const mapped = repositoryFor(context, logicalPath), extension = path.extname(mapped.path).toLowerCase();
    const bytes = readBytes(mapped.sourcePath);
    let document;
    if (['.cls', '.mac', '.inc', '.int'].includes(extension)) {
        const supplied = options.document;
        if (bytes !== null) document = require('./backend-document').documentName(mapped.path, utf8(bytes));
        else if (supplied) document = supplied;
        else document = mapped.gitPath.replace(/^src\//, '').replace(/\//g, '.');
        if (supplied && document !== supplied) stop('source-document-mismatch');
        return {...mapped, kind: 'backend', document};
    }
    if (!['.js', '.csp', '.css', '.html', '.htm'].includes(extension)) stop('unsupported-source-type');
    const {config} = projectConfiguration(context);
    const frontSource = context.sourceRoots.find(source => source.name === 'frontend');
    const relative = frontSource ? slash(path.relative(frontSource.target, mapped.sourcePath)) : mapped.path.replace(/^src\//, '');
    if (options.document) document = options.document;
    else if (relative.startsWith(String(config.web?.basePath || '') + '/')) document = relative;
    else if (relative.startsWith('csp/')) document = String(config.web?.cspBasePath || '').replace(/\/$/, '') + '/' + relative.slice(4);
    else document = String(config.web?.basePath || '').replace(/\/$/, '') + '/' + relative;
    if (!document || document.startsWith('TODO') || /[%?#\\\x00-\x20]/.test(document) || document.split('/').some(p => !p || p === '.' || p === '..')) stop('frontend-mapping-required');
    return {...mapped, kind: 'frontend', document};
}

function parseProjectMap(xml) {
    try { return require('./xml-package-core').parseProjectItems(xml); }
    catch (error) {
        if (error.code === 'duplicate-project-item') stop(error.code);
        if (error.code === 'unsafe-document-name') stop('unsafe-project-item');
        if (['unsupported-document-type', 'invalid-backend-document'].includes(error.code)) stop('unsupported-project-item');
        stop('unsupported-project-xml');
    }
}
function mapItems(context, xml) {
    const {config} = projectConfiguration(context), rootFor = name => context.sourceRoots.find(source => source.name === name) || context.sourceRoots[0];
    const logical = (source, relative) => slash(path.join(path.relative(context.workspaceRoot, source.path), relative));
    return parseProjectMap(xml).filter(item => !require('./baseline-catalog').IMAGE_EXTENSIONS.has(path.posix.extname(item.name).toLowerCase())).map(item => {
        if (item.type !== 'CSP') {
            const extension = '.' + item.type.toLowerCase(), name = item.name.endsWith(extension) ? item.name.slice(0, -extension.length) : item.name;
            if (!/^[%A-Za-z][%A-Za-z0-9]*(?:\.[%A-Za-z][%A-Za-z0-9]*)*$/.test(name)) stop('unsupported-project-item');
            return {path: logical(rootFor('backend'), 'src/' + name.replace(/\./g, '/') + extension), document: name + extension};
        }
        if (!/\.(?:js|css|csp|html|htm)$/i.test(item.name)) stop('unsupported-project-item');
        const base = String(config.web?.basePath || '').replace(/\/$/, '');
        if (!base || base.startsWith('TODO')) stop('frontend-mapping-required');
        const front = rootFor('frontend'), explicit = front.name === 'frontend';
        const document = item.name.startsWith(base + '/') ? item.name : item.name.startsWith('scripts/') || item.name.startsWith('css/') ? base + '/' + item.name : item.name;
        if (!document.startsWith(base + '/')) stop('project-web-prefix-ambiguous', {item: item.name});
        return {path: logical(front, explicit ? document.slice(base.length + 1) : 'src/' + document), document};
    });
}
function repositorySnapshot(root, files) {
    return {head: head(root), indexHash: hash(git(root, ['ls-files', '--stage', '-v', '-z'])),
        files: Object.fromEntries(files.map(file => [file.path, readBytes(file.sourcePath) === null ? null : hash(readBytes(file.sourcePath))]))};
}
function indexOutside(root, gitPath) {
    return hash(git(root, ['ls-files', '--stage', '-v', '-z']).toString('utf8').split('\0').filter(entry => entry && entry.slice(entry.indexOf('\t') + 1) !== gitPath).join('\0'));
}
function assertSnapshot(plan) {
    const current = repositorySnapshot(plan.gitRoot, plan.files);
    if (canonical(current) !== canonical(plan.expected)) stop('repository-drift');
}
function fileMode(root, file) { return textGit(root, ['ls-files', '-s', '--', file.gitPath]).split(' ')[0] || '100644'; }
function blobAt(root, ref, file) { return ref ? git(root, ['show', `${ref}:${file.gitPath}`], {optional: true}) : null; }
function dataPath(plan, category, file) { return physical(path.dirname(plan.planPath), path.join(path.dirname(plan.planPath), category, hash(file.path))); }
function storeBytes(plan, category, file, bytes) {
    if (bytes === null) return null;
    const target = dataPath(plan, category, file); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, bytes, {mode: 0o600});
    if (hash(fs.readFileSync(target)) !== hash(bytes)) stop('snapshot-write-verification-failed');
    return {sha256: hash(bytes), length: bytes.length};
}
function storedBytes(plan, category, file, record) {
    if (!record) return null;
    const bytes = fs.readFileSync(dataPath(plan, category, file));
    if (hash(bytes) !== record.sha256) stop('snapshot-corrupt');
    return bytes;
}
function registryPath(context) { return path.join(privateRoot(context), 'baselines.json'); }
function registry(context) { const file = registryPath(context); return fs.existsSync(file) ? json(file) : {schema: 'iris-source-baselines/v1', files: {}}; }
function baselineKey(plan, file) { return hash(canonical([plan.gitRoot, plan.environmentAlias, plan.configurationFingerprint, file.document])); }
function resolveBaseline(context, plan, file, options, currentRegistry) {
    if (options.baselineRef) return {known: true, bytes: blobAt(plan.gitRoot, options.baselineRef, file), ref: options.baselineRef};
    const entry = currentRegistry.files[baselineKey(plan, file)];
    if (entry) {
        const bytes = comparisonBytes(file, entry.commit ? blobAt(plan.gitRoot, entry.commit, file) : null);
        if ((bytes === null ? null : hash(bytes)) !== entry.sha256) stop('baseline-corrupt');
        return {known: true, bytes, ref: entry.commit};
    }
    const local = readBytes(file.sourcePath), committed = blobAt(plan.gitRoot, plan.expected.head, file);
    return {known: local === null && committed === null, bytes: null, ref: null};
}

function createPlan(options) {
    const context = contextFor(options.projectRoot);
    require('../../../../scripts/lib/iris-remote-operations').assertRemoteAllowed(context);
    const env = environment(context, options);
    const kind = demandKind(context, options);
    if (kind.kind !== 'project') stop('source-sync-project-demand-required');
    const phase = options.phase || 'before-edit';
    if (!['before-edit', 'pre-deploy', 'initial-baseline'].includes(phase)) stop('invalid-sync-phase');
    if (phase !== 'initial-baseline' && !/^\d+$/.test(String(options.demand || ''))) stop('demand-required');
    if (options.baselineRef) {
        if (options.baselineRef.startsWith('-')) stop('invalid-baseline-ref');
        options = {...options, baselineRef: textGit(context.gitRoots[0], ['rev-parse', '--verify', `${options.baselineRef}^{commit}`])};
    }
    const specs = options.map ? mapItems(context, fs.readFileSync(path.resolve(options.map))) : (options.files || []).map(value => typeof value === 'string' ? {path: value} : value);
    if (!specs.length) stop('source-files-required');
    const files = specs.map(spec => {
        const mapped = classify(context, spec.path, spec);
        const tier = spec.tier || 'required';
        if (!['required', 'conditional', 'reference'].includes(tier)) stop('invalid-refresh-tier');
        return {...mapped, tier, reason: spec.reason || (tier === 'required' ? 'explicit-task-file' : ''), mode: fileMode(mapped.gitRoot, mapped)};
    });
    const active = files.filter(file => file.tier === 'required');
    if (!active.length) stop('required-source-files-missing');
    if (new Set(files.map(file => file.gitRoot)).size !== 1) stop('one-git-root-per-sync-plan');
    if (new Set(files.map(file => file.document.toLowerCase())).size !== files.length || new Set(files.map(file => file.sourcePath.toLowerCase())).size !== files.length) stop('duplicate-source-target');
    const gitRoot = files[0].gitRoot, stateRoot = privateRoot(context, [gitRoot]);
    const id = crypto.randomUUID(), directory = path.join(stateRoot, 'tasks', id);
    fs.mkdirSync(directory, {recursive: true});
    const plan = {schema: SCHEMA, id, state: 'planned', phase, demand: options.demand || null, projectRoot: context.workspaceRoot, contextRoot: context.contextRoot,
        gitRoot, ...env, demandKind: kind.kind, demandKindSource: kind.source, configurationFingerprint: configurationFingerprint(context), files,
        expected: repositorySnapshot(gitRoot, active), planPath: path.join(directory, 'plan.json'),
        execution: {exportCommit: null, demandCommit: null, completedWrites: []}, createdAt: new Date().toISOString(),
        budget: {documents: active.length, requestCount: active.length, concurrent: 1},
        mapSha256: options.map ? hash(fs.readFileSync(path.resolve(options.map))) : null,
        excludedImages: options.map ? parseProjectMap(fs.readFileSync(path.resolve(options.map))).filter(item => require('./baseline-catalog').IMAGE_EXTENSIONS.has(path.posix.extname(item.name).toLowerCase())) : []};
    // Reference candidates do not silently become deployable files.
    plan.candidates = files.filter(file => file.tier !== 'required'); plan.files = active;
    const currentRegistry = registry(context);
    for (const file of plan.files) {
        const base = resolveBaseline(context, plan, file, options, currentRegistry);
        file.baselineKnown = base.known; file.baselineRef = base.ref;
        file.base = storeBytes(plan, 'base', file, comparisonBytes(file, base.bytes));
        file.local = storeBytes(plan, 'local', file, readBytes(file.sourcePath));
        file.index = storeBytes(plan, 'index', file, git(gitRoot, ['show', `:${file.gitPath}`], {optional: true}));
        file.indexEntry = textGit(gitRoot, ['ls-files', '-s', '--', file.gitPath]);
    }
    save(plan); return plan;
}
function load(planFile, {localOnly = false} = {}) {
    const plan = json(path.resolve(planFile));
    if (plan.schema !== SCHEMA || plan.integrity !== integrity(plan) || plan.planPath !== path.resolve(planFile)) stop('invalid-source-plan');
    const context = contextFor(plan.projectRoot);
    const offlineInspection = localOnly && require('../../../../scripts/lib/iris-remote-operations').developmentMode(context) === 'offline';
    if (!offlineInspection) environment(context, {environmentAlias: plan.environmentAlias, environmentType: plan.environmentType});
    if (plan.demandKind !== 'project' || plan.demandKindSource !== 'explicit-task' && demandKind(context).kind !== 'project') stop('demand-kind-drift');
    if (context.contextRoot !== plan.contextRoot || path.dirname(plan.planPath) !== path.join(privateRoot(context, [plan.gitRoot]), 'tasks', plan.id)) stop('source-plan-identity-mismatch');
    for (const file of plan.files) {
        const actual = repositoryFor(context, file.path);
        if (actual.sourcePath !== file.sourcePath || actual.gitPath !== file.gitPath || actual.gitRoot !== plan.gitRoot) stop('source-plan-scope-mismatch');
    }
    if (!offlineInspection && configurationFingerprint(context) !== plan.configurationFingerprint) stop('source-configuration-drift');
    return {plan, context};
}
async function openClient(context) {
    const {config, mcp} = projectConfiguration(context);
    const connection = require('./compile-csp').connection(config, mcp);
    const operations = require('../../../../scripts/lib/iris-remote-operations');
    const policy = operations.loadRemotePolicy(context, {connection});
    return require('../../../../scripts/lib/atelier-client').createAtelierClient({connection, policy, context});
}
async function prepare(planFile, options = {}) {
    const {plan, context} = load(planFile);
    if (!['planned', 'reading', 'read-blocked'].includes(plan.state)) stop('source-plan-not-preparable');
    assertSnapshot(plan);
    const {config} = projectConfiguration(context);
    if (plan.phase === 'initial-baseline' && plan.files.length > 5) {
        const policyFile = path.join(context.contextRoot, 'config', 'iris-remote-policy.json');
        const policy = fs.existsSync(policyFile) ? json(policyFile) : {};
        const legacyReference = policy.bulkQualification?.status === 'verified' ? policy.bulkQualification.reference : null;
        const batchReference = policy.readBatch?.qualification?.status === 'verified' ? policy.readBatch.qualification.reference : null;
        const reference = batchReference || legacyReference;
        if (policy.qualification?.status !== 'verified' || !policy.qualification?.reference || !reference ||
            !fs.existsSync(path.resolve(context.workspaceRoot, reference)) ||
            !fs.statSync(path.resolve(context.workspaceRoot, reference)).isFile()) stop('bulk-license-qualification-required');
    }
    const client = options.client || require('../../../../scripts/lib/atelier-read-pool').createAtelierReadPool({context,
        connection: require('./compile-csp').connection(config, projectConfiguration(context).mcp)});
    // A resumed slice must be observed again as a whole. Old completed reads are
    // recovery data, not a claim about the server at the new observation time.
    if (plan.state !== 'planned') for (const file of plan.files) delete file.remote;
    plan.state = 'reading'; save(plan);
    try {
        async function observed(file, remote) {
            assertSnapshot(plan);
            const bytes = remote === null ? null : Buffer.isBuffer(remote) ? remote : remote.content || remote.bytes || Buffer.from(remote.text, 'utf8');
            if (bytes !== null && bytes.length === 0) stop('remote-document-empty');
            // A missing document is not an approved server-side deletion. A new
            // local file with a confirmed absent base remains a valid demand.
            if (bytes === null && plan.phase !== 'initial-baseline' && file.base !== null) stop('remote-document-missing');
            if (bytes !== null) utf8(bytes);
            if (bytes !== null && file.kind === 'backend' && require('./backend-document').documentName(file.path, utf8(bytes)) !== file.document) stop('remote-document-identity-mismatch');
            file.remote = storeBytes(plan, 'remote', file, bytes);
            file.remoteTs = remote?.ts || null;
            file.representation = remote?.representation || 'atelier-utf8-lf';
            file.readStatus = bytes === null ? 'missing' : 'fetched';
            file.observedAt = new Date().toISOString();
            if (!file.baselineKnown) {
                const local = storedBytes(plan, 'local', file, file.local);
                if (bytes !== null && local !== null && contentHash(file, bytes) === contentHash(file, local)) {
                    file.base = storeBytes(plan, 'base', file, comparisonBytes(file, bytes)); file.baselineKnown = true;
                    const committed = blobAt(plan.gitRoot, plan.expected.head, file);
                    if (contentHash(file, committed) === contentHash(file, bytes)) file.baselineRef = plan.expected.head;
                    else file.initialEquivalent = true;
                }
            }
            save(plan);
        }
        if (typeof client.readAll === 'function') {
            const batch = await client.readAll(plan.files.map(file => file.document), {onResult: async result => {
                if (['fetched', 'missing', 'empty'].includes(result.status)) await observed(plan.files[result.index], result.status === 'missing' ? null : result.value);
            }});
            plan.budget.concurrent = batch.sessions;
            plan.budget.requestCount = batch.requestCount;
            plan.budget.serverInfoRequests = 1;
        } else for (const file of plan.files) {
            if (file.remote !== undefined) continue;
            await observed(file, await client.readDocument(file.document));
        }
        if (plan.phase === 'initial-baseline') {
            assertSnapshot(plan);
            const missing = plan.files.filter(file => file.readStatus === 'missing');
            if (missing.length) {
                plan.excludedReadItems = missing;
                plan.files = plan.files.filter(file => file.readStatus !== 'missing');
                plan.expected.files = Object.fromEntries(plan.files.map(file => [file.path, plan.expected.files[file.path]]));
                plan.collectionStatus = 'partial';
                plan.partialAcceptanceToken = hash(canonical({mapSha256: plan.mapSha256, missing: missing.map(file => file.document),
                    fetched: plan.files.map(file => [file.document, file.remote?.sha256])}));
            }
        }
        plan.state = 'prepared';
        plan.reason = plan.files.some(file => !file.baselineKnown) ? 'baseline-confirmation-required' : null;
        plan.exportSubject = `export(${config.iris?.host || 'target'}):从服务器同步最新文件`;
        save(plan); return plan;
    } catch (error) {
        plan.state = 'read-blocked'; plan.reason = error.code || 'remote-read-failed'; save(plan); throw error;
    } finally { if (!options.client) {
        plan.remoteCleanup = await client.close();
        if (!plan.remoteCleanup?.cleanupVerified) { plan.state = 'read-blocked'; plan.reason = 'remote-session-exit-unverified'; }
        save(plan);
    } }
}

function mergeFile(plan, file) {
    const rawBase = storedBytes(plan, 'base', file, file.base), rawLocal = storedBytes(plan, 'local', file, file.local), rawRemote = storedBytes(plan, 'remote', file, file.remote);
    if (file.initialEquivalent) return {bytes: rawRemote, conflict: false};
    return mergeLayer(plan, file, rawBase, rawLocal, rawRemote);
}
function mergeLayer(plan, file, rawBase, rawLocal, rawRemote, category = 'merged') {
    const base = comparisonBytes(file, rawBase), local = comparisonBytes(file, rawLocal), remote = comparisonBytes(file, rawRemote);
    const equal = (a, b) => a === null ? b === null : b !== null && a.equals(b);
    if (equal(remote, base)) return {bytes: rawLocal, conflict: false};
    if (equal(local, base) || equal(local, remote)) return {bytes: rawRemote, conflict: false};
    if (base === null || local === null || remote === null) {
        const target = dataPath(plan, category, file); fs.mkdirSync(path.dirname(target), {recursive: true});
        if (!fs.existsSync(target)) fs.writeFileSync(target, Buffer.concat([Buffer.from('<<<<<<< local\n'), rawLocal || Buffer.alloc(0), Buffer.from('\n=======\n'), rawRemote || Buffer.alloc(0), Buffer.from('\n>>>>>>> server\n')]), {mode: 0o600});
        return {bytes: null, conflict: true, reason: 'remote-delete-or-add-collision', resolutionPath: target};
    }
    const mergeDir = path.join(path.dirname(plan.planPath), 'merge'); fs.mkdirSync(mergeDir, {recursive: true});
    const names = ['local', 'base', 'remote'].map(name => path.join(mergeDir, hash(file.path) + '.' + name));
    [local, base, remote].forEach((bytes, i) => fs.writeFileSync(names[i], bytes, {mode: 0o600}));
    const result = spawnSync('git', ['merge-file', '-p', ...names], {encoding: null, windowsHide: true, maxBuffer: 16 * 1024 * 1024});
    if (result.status === null || result.status > 127) stop('three-way-merge-failed');
    const target = dataPath(plan, category, file); fs.mkdirSync(path.dirname(target), {recursive: true});
    // A previous conflict file is user-owned resolution input on continuation.
    if (!fs.existsSync(target)) fs.writeFileSync(target, result.stdout, {mode: 0o600});
    return {bytes: result.stdout, conflict: result.status !== 0, resolutionPath: target};
}
function replaySources(plan, changed) {
    const sources = new Map();
    for (const file of changed.filter(file => file.baselineRef)) {
        if (git(plan.gitRoot, ['merge-base', '--is-ancestor', file.baselineRef, plan.expected.head], {optional: true}) === null) stop('baseline-history-drift');
        const records = textGit(plan.gitRoot, ['log', '--reverse', '--format=%H%x1f%P%x1f%s', `${file.baselineRef}..${plan.expected.head}`, '--', file.gitPath]).split('\n').filter(Boolean);
        for (const record of records) {
            const [source, parents, subject] = record.split('\x1f');
            if (/^export\(/.test(subject)) continue;
            if (!/^[a-z]+\(\d+(?:,\d+)*\):/.test(subject) || parents.split(' ').length !== 1) stop('unclassified-local-commit-layer', {source});
            if (!sources.has(source)) sources.set(source, {source, parent: parents, subject, paths: []});
            sources.get(source).paths.push(file.path);
        }
    }
    if (!sources.size) return [];
    const order = textGit(plan.gitRoot, ['rev-list', '--reverse', '--topo-order', plan.expected.head]).split('\n');
    return order.filter(source => sources.has(source)).map(source => sources.get(source));
}
function prepareReplay(plan, changed, options) {
    if (plan.replaySteps) return true;
    const sources = replaySources(plan, changed);
    if (!sources.length) return false;
    const current = new Map(plan.files.map(file => [file.path, changed.includes(file) ? storedBytes(plan, 'remote', file, file.remote) : blobAt(plan.gitRoot, plan.expected.head, file)]));
    const steps = [];
    function resolve(file, result, category) {
        if (!result.conflict) return result.bytes;
        const prior = plan.replayConflict;
        const target = dataPath(plan, category, file);
        const key = category + ':' + file.path, known = plan.replayResolutions?.[key];
        if (known) return storedBytes(plan, category + '-resolved', file, known.content);
        if (options.continue && prior?.path === file.path && prior.category === category && options.resolveDelete?.includes(file.path)) {
            plan.replayResolutions ||= {}; plan.replayResolutions[key] = {content: null}; plan.replayConflict = null; save(plan); return null;
        }
        if (options.continue && prior?.path === file.path && prior.category === category && fs.existsSync(target)) {
            const bytes = fs.readFileSync(target); validateSource(bytes);
            plan.replayResolutions ||= {}; plan.replayResolutions[key] = {content: storeBytes(plan, category + '-resolved', file, bytes)};
            plan.replayConflict = null; save(plan); return bytes;
        }
        plan.replayConflict = {path: file.path, category, resolutionPath: target, source: steps.length < sources.length ? sources[steps.length]?.source : null};
        plan.state = 'needs-user-input'; plan.reason = 'replay-merge-conflict'; save(plan); return undefined;
    }
    for (let i = 0; i < sources.length; i++) {
        const source = sources[i], category = 'replay-' + i, records = [];
        for (const file of plan.files.filter(file => source.paths.includes(file.path))) {
            const result = mergeLayer(plan, file, blobAt(plan.gitRoot, source.parent, file), blobAt(plan.gitRoot, source.source, file), current.get(file.path), category);
            const bytes = resolve(file, result, category); if (bytes === undefined) return null;
            validateSource(bytes); records.push({path: file.path, content: storeBytes(plan, category + '-result', file, bytes)}); current.set(file.path, bytes);
        }
        steps.push({...source, category: category + '-result', files: records});
    }
    for (const file of plan.files) {
        const category = 'replay-working';
        const result = mergeLayer(plan, file, blobAt(plan.gitRoot, plan.expected.head, file), storedBytes(plan, 'local', file, file.local), current.get(file.path), category);
        const bytes = resolve(file, result, category); if (bytes === undefined) return null;
        validateSource(bytes); file.merged = storeBytes(plan, 'merged', file, bytes);
    }
    plan.replaySteps = steps; plan.replayConflict = null; save(plan); return true;
}
function validateSource(bytes) {
    const text = utf8(bytes);
    if (text !== null && /^(?:<{7}|={7}|>{7})(?: |$)/m.test(text)) stop('unresolved-source-conflict');
}
function acquireRepositoryLock(root) {
    const common = textGit(root, ['rev-parse', '--git-common-dir']);
    const file = path.resolve(root, common, 'iris-source-sync.lock');
    let descriptor;
    try { descriptor = fs.openSync(file, 'wx', 0o600); fs.writeFileSync(descriptor, JSON.stringify({pid: process.pid, createdAt: new Date().toISOString()})); }
    catch { stop('repository-sync-locked'); }
    let released = false;
    return () => { if (!released) { fs.closeSync(descriptor); fs.unlinkSync(file); released = true; } };
}
function repositoryLock(root, action) {
    const release = acquireRepositoryLock(root);
    try { return action(); } finally { release(); }
}
function writeTarget(plan, file, bytes) {
    const existing = readBytes(file.sourcePath), expected = plan.expected.files[file.path];
    if ((existing === null ? null : hash(existing)) !== expected) stop('task-file-drift');
    physical(plan.gitRoot, file.sourcePath);
    if (existing === null && bytes === null || existing !== null && bytes !== null && existing.equals(bytes)) return;
    plan.execution.pendingWrite = {path: file.path, before: expected, after: bytes === null ? null : hash(bytes)}; save(plan);
    if (bytes === null) { if (existing !== null) fs.unlinkSync(file.sourcePath); }
    else {
        physical(path.dirname(file.sourcePath), file.sourcePath); fs.mkdirSync(path.dirname(file.sourcePath), {recursive: true});
        const temporary = file.sourcePath + '.' + crypto.randomUUID() + '.tmp';
        try { fs.writeFileSync(temporary, bytes, {flag: 'wx', mode: file.mode === '100755' ? 0o755 : 0o644}); fs.renameSync(temporary, file.sourcePath); }
        finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    plan.expected.files[file.path] = bytes === null ? null : hash(bytes); plan.execution.pendingWrite = null; save(plan);
}
function scopedCommit(plan, files, message, persist = save) {
    assertSnapshot(plan);
    const index = path.join(path.dirname(plan.planPath), 'commit-index');
    if (fs.existsSync(index)) fs.unlinkSync(index);
    const env = {GIT_INDEX_FILE: index};
    git(plan.gitRoot, plan.expected.head ? ['read-tree', plan.expected.head] : ['read-tree', '--empty'], {env});
    for (const file of files) {
        const bytes = readBytes(file.sourcePath);
        if (bytes === null) git(plan.gitRoot, ['update-index', '--force-remove', '--', file.gitPath], {env});
        else {
            const raw = textGit(plan.gitRoot, ['hash-object', '--stdin'], {input: bytes});
            const filtered = textGit(plan.gitRoot, ['hash-object', `--path=${file.gitPath}`, '--stdin'], {input: bytes});
            if (raw !== filtered && file.kind !== 'backend') stop('git-source-filter-conflict', {file: file.path});
            const blob = textGit(plan.gitRoot, ['hash-object', '-w', ...(raw !== filtered ? [`--path=${file.gitPath}`] : []), '--stdin'], {input: bytes});
            if (contentHash(file, git(plan.gitRoot, ['cat-file', 'blob', blob])) !== contentHash(file, bytes)) stop('git-source-filter-conflict', {file: file.path});
            git(plan.gitRoot, ['update-index', '--add', '--cacheinfo', file.mode || '100644', blob, file.gitPath], {env});
        }
    }
    const tree = textGit(plan.gitRoot, ['write-tree'], {env});
    const previousTree = plan.expected.head ? textGit(plan.gitRoot, ['rev-parse', `${plan.expected.head}^{tree}`]) : textGit(plan.gitRoot, ['hash-object', '-t', 'tree', '--stdin'], {input: Buffer.alloc(0)});
    if (tree === previousTree) { fs.unlinkSync(index); return null; }
    plan.execution.pendingCommit = {parent: plan.expected.head, tree, message, step: plan.execution.step,
        ...(plan.execution.step === 'replay-commit' ? {replayIndex: plan.execution.replayIndex} : {}), files: files.map(file => file.gitPath)}; persist(plan);
    // The isolated index was constructed from this exact HEAD. An unrelated
    // commit or staging change must not silently become this commit's parent.
    assertSnapshot(plan);
    git(plan.gitRoot, ['commit', '-m', message], {env});
    const committed = head(plan.gitRoot);
    if (textGit(plan.gitRoot, ['show', '-s', '--format=%P', committed]) !== (plan.execution.pendingCommit.parent || '')) stop('commit-parent-changed');
    if (textGit(plan.gitRoot, ['rev-parse', `${committed}^{tree}`]) !== tree) stop('commit-hook-changed-tree');
    const changed = git(plan.gitRoot, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', committed]).toString('utf8').split('\0').filter(Boolean);
    if (changed.some(file => !plan.execution.pendingCommit.files.includes(file))) stop('commit-scope-changed');
    plan.expected.head = committed;
    if (plan.execution.step === 'baseline-commit') plan.execution.exportCommit = committed;
    else if (['change-commit', 'rollback-commit'].includes(plan.execution.step)) plan.execution.demandCommit = committed;
    else if (plan.execution.step === 'storage-commit') plan.finalCommit = committed;
    else if (plan.execution.step === 'replay-commit') {
        const replayIndex = plan.execution.pendingCommit.replayIndex;
        if (!Number.isInteger(replayIndex) || !plan.replaySteps?.[replayIndex]) stop('replay-step-identity-invalid');
        plan.replaySteps[replayIndex].commit = committed;
        plan.execution.replayIndex = replayIndex + 1; plan.execution.step = 'change-writing';
    }
    assertSnapshot(plan);
    plan.execution.pendingCommit = null; persist(plan);
    fs.unlinkSync(index); return committed;
}
function restoreTaskIndex(plan, persist = save) {
    for (const file of plan.files) {
        assertSnapshot(plan);
        const entry = plan.expected.head ? textGit(plan.gitRoot, ['ls-tree', 'HEAD', '--', file.gitPath]) : '';
        plan.execution.pendingIndex = {gitPath: file.gitPath, entry, outsideHash: indexOutside(plan.gitRoot, file.gitPath)}; persist(plan);
        if (!entry) git(plan.gitRoot, ['update-index', '--force-remove', '--', file.gitPath]);
        else {
            const match = entry.match(/^(\d+) blob ([a-f0-9]+)\t/); if (!match) stop('committed-source-not-blob');
            git(plan.gitRoot, ['update-index', '--add', '--cacheinfo', match[1], match[2], file.gitPath]);
        }
        plan.expected = repositorySnapshot(plan.gitRoot, plan.files); plan.execution.pendingIndex = null; persist(plan);
    }
    plan.expected = repositorySnapshot(plan.gitRoot, plan.files); persist(plan);
}
function recoverPending(plan, persist = save) {
    const pendingCommit = plan.execution.pendingCommit, currentHead = head(plan.gitRoot);
    if (pendingCommit && currentHead !== pendingCommit.parent) {
        const parents = textGit(plan.gitRoot, ['show', '-s', '--format=%P', currentHead]);
        const message = git(plan.gitRoot, ['show', '-s', '--format=%B', currentHead]).toString('utf8').trimEnd();
        if (parents !== (pendingCommit.parent || '') || textGit(plan.gitRoot, ['rev-parse', `${currentHead}^{tree}`]) !== pendingCommit.tree || message !== pendingCommit.message.trimEnd()) stop('recovery-head-not-owned');
        const allowed = pendingCommit.files || plan.files.map(file => file.gitPath);
        const changed = git(plan.gitRoot, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', currentHead]).toString('utf8').split('\0').filter(Boolean);
        if (changed.some(file => !allowed.includes(file))) stop('recovery-commit-scope-changed');
        plan.expected.head = currentHead;
        if (pendingCommit.step === 'baseline-commit') plan.execution.exportCommit = currentHead;
        else if (pendingCommit.step === 'change-commit') plan.execution.demandCommit = currentHead;
        else if (pendingCommit.step === 'storage-commit') plan.finalCommit = currentHead;
        else if (pendingCommit.step === 'rollback-commit') plan.execution.demandCommit = currentHead;
        else if (pendingCommit.step === 'replay-commit') {
            const replayIndex = pendingCommit.replayIndex ?? plan.execution.replayIndex;
            if (!Number.isInteger(replayIndex) || !plan.replaySteps?.[replayIndex]) stop('recovery-replay-step-invalid');
            plan.replaySteps[replayIndex].commit = currentHead;
            plan.execution.replayIndex = replayIndex + 1; plan.execution.step = 'change-writing';
        }
        else stop('recovery-step-unknown');
    } else if (currentHead !== plan.expected.head) stop('recovery-head-not-owned');
    plan.execution.pendingCommit = null;
    const pendingWrite = plan.execution.pendingWrite;
    if (pendingWrite) {
        const file = plan.files.find(item => item.path === pendingWrite.path); if (!file) stop('recovery-file-not-owned');
        const bytes = readBytes(file.sourcePath), actual = bytes === null ? null : hash(bytes);
        if (actual !== pendingWrite.before && actual !== pendingWrite.after) stop('recovery-source-changed');
        if (actual === pendingWrite.after) plan.expected.files[file.path] = actual;
        plan.execution.pendingWrite = null;
    }
    const pendingIndex = plan.execution.pendingIndex;
    if (pendingIndex) {
        if (indexOutside(plan.gitRoot, pendingIndex.gitPath) !== pendingIndex.outsideHash) stop('recovery-index-changed');
        const actual = textGit(plan.gitRoot, ['ls-files', '-s', '--', pendingIndex.gitPath]);
        const desired = pendingIndex.entry.match(/^(\d+) blob ([a-f0-9]+)\t/);
        const before = repositorySnapshot(plan.gitRoot, plan.files).indexHash === plan.expected.indexHash;
        const after = desired ? actual.startsWith(`${desired[1]} ${desired[2]} 0\t`) : actual === '';
        if (!before && !after) stop('recovery-index-not-owned');
        plan.expected.indexHash = repositorySnapshot(plan.gitRoot, plan.files).indexHash;
        plan.execution.pendingIndex = null;
    }
    assertSnapshot(plan); persist(plan);
}
function apply(planFile, options = {}) {
    const {plan, context} = load(planFile);
    if (!options.confirmCommit) stop('commit-authorization-required');
    if (!['prepared', 'needs-user-input', 'baseline-committed', 'failed-or-unknown'].includes(plan.state)) stop('source-plan-not-applicable');
    if (plan.state === 'failed-or-unknown' && !options.continue) stop('explicit-local-recovery-required');
    if (plan.files.some(file => !file.baselineKnown)) stop('baseline-confirmation-required');
    if (plan.collectionStatus === 'partial' && plan.files.length && (options.acceptPartial || plan.partialAcceptance?.token) !== plan.partialAcceptanceToken) stop('initial-partial-acceptance-required');
    const subject = options.subject || `feat(${plan.demand}):${options.title || '合并项目需求修改'}`;
    if (plan.phase !== 'initial-baseline' && !/^(?:feat|fix|refactor|chore|perf|test|docs)\([\d,]+\):[^\r\n]+$/.test(subject)) stop('invalid-demand-subject');
    return repositoryLock(plan.gitRoot, () => {
        if (options.continue && plan.state === 'failed-or-unknown') recoverPending(plan);
        assertSnapshot(plan);
        if (plan.collectionStatus === 'partial' && plan.files.length && !plan.partialAcceptance) {
            plan.partialAcceptance = {token: plan.partialAcceptanceToken, at: new Date().toISOString()}; save(plan);
        }
        const changedBaselines = plan.files.filter(file => !file.baselineRef || contentHash(file, storedBytes(plan, 'remote', file, file.remote)) !== (file.base?.sha256 || null));
        const replay = !plan.execution.step ? prepareReplay(plan, changedBaselines, options) : Boolean(plan.replaySteps);
        if (replay === null) return plan;
        const merged = new Map(); let conflict = false;
        for (const file of plan.files) {
            let result;
            if (replay) result = {bytes: storedBytes(plan, 'merged', file, file.merged), conflict: false};
            else if (options.continue && file.conflict && options.resolveDelete?.includes(file.path)) result = {bytes: null, conflict: false};
            else if (options.continue && file.conflict) {
                if (!file.resolutionPath || file.resolutionPath !== dataPath(plan, 'merged', file)) stop('resolution-identity-mismatch');
                const bytes = fs.readFileSync(file.resolutionPath); validateSource(bytes); result = {bytes, conflict: false};
            } else if (options.continue && file.merged !== undefined && plan.execution.step) result = {bytes: storedBytes(plan, 'merged', file, file.merged), conflict: false};
            else result = mergeFile(plan, file);
            if (result.conflict) { file.conflict = true; file.resolutionPath = result.resolutionPath; file.conflictReason = result.reason; conflict = true; }
            else { validateSource(result.bytes); file.conflict = false; file.merged = storeBytes(plan, 'merged', file, result.bytes); merged.set(file.path, result.bytes); }
        }
        if (conflict) { plan.state = 'needs-user-input'; plan.reason = 'merge-conflict'; save(plan); return plan; }
        try {
            // Compare against the confirmed server layer, not a HEAD that may already contain a demand.
            if (!plan.execution.step || ['baseline-writing', 'baseline-commit'].includes(plan.execution.step)) {
                plan.execution.step = 'baseline-writing'; save(plan);
                for (const file of changedBaselines) writeTarget(plan, file, storedBytes(plan, 'remote', file, file.remote));
                plan.execution.step = 'baseline-commit'; save(plan);
                if (!plan.execution.exportCommit) plan.execution.exportCommit = changedBaselines.length ? scopedCommit(plan, changedBaselines, `${plan.exportSubject}\n\n修改说明: 同步本次明确文件的服务器基线。\n\nSource-Sync-Plan: ${plan.id}`) : null;
                plan.execution.baselineHead = plan.expected.head;
                plan.state = 'baseline-committed'; plan.execution.step = 'change-writing'; save(plan);
            }
            const bases = registry(context);
            for (const file of plan.files) bases.files[baselineKey(plan, file)] = {commit: changedBaselines.includes(file) ? plan.execution.baselineHead : file.baselineRef,
                sha256: contentHash(file, storedBytes(plan, 'remote', file, file.remote)), document: file.document, observedAt: file.observedAt};
            atomicJson(registryPath(context), bases);
            if (['change-writing', 'change-commit', 'replay-commit'].includes(plan.execution.step)) {
                for (let i = plan.execution.replayIndex || 0; i < (plan.replaySteps || []).length; i++) {
                    const replayStep = plan.replaySteps[i], targets = plan.files.filter(file => replayStep.paths.includes(file.path));
                    plan.execution.replayIndex = i; plan.execution.step = 'change-writing'; save(plan);
                    for (const file of targets) writeTarget(plan, file, storedBytes(plan, replayStep.category, file, replayStep.files.find(record => record.path === file.path).content));
                    plan.execution.step = 'replay-commit'; save(plan);
                    const replayed = scopedCommit(plan, targets, `${replayStep.subject}\n\n修改说明: 在最新服务器基线上逐层保留原需求，保持原需求号边界。\n\nSource-Sync-Plan: ${plan.id}\nReplay-Of: ${replayStep.source}\nReplay-Scope: ${JSON.stringify(targets.map(file => file.gitPath))}\nReplay-Mode: adapted\nBaseline-Commit: ${plan.execution.baselineHead}`);
                    replayStep.commit = replayed; plan.execution.replayIndex = i + 1; plan.execution.step = 'change-writing'; save(plan);
                }
                for (const file of plan.files) writeTarget(plan, file, merged.get(file.path));
                plan.execution.step = 'change-commit'; save(plan);
                if (plan.phase !== 'initial-baseline' && !plan.execution.demandCommit) plan.execution.demandCommit = scopedCommit(plan, plan.files, `${subject}\n\n修改说明:${options.modification || '在最新服务器基线上保留本次需求修改。'}\n\nSource-Sync-Plan: ${plan.id}\nBaseline-Commit: ${plan.execution.exportCommit || plan.expected.head}\nReplay-Mode: ${plan.files.some(file => contentHash(file, storedBytes(plan, 'remote', file, file.remote)) !== (file.base?.sha256 || null)) ? 'adapted' : 'exact'}`);
                plan.execution.step = 'index-sync'; save(plan);
            }
            restoreTaskIndex(plan);
            plan.state = plan.phase === 'pre-deploy' ? 'review-pending' : 'change-committed'; plan.reason = null; save(plan); return plan;
        } catch (error) { plan.state = 'failed-or-unknown'; plan.reason = error.code || 'local-sync-interrupted'; save(plan); throw error; }
    });
}
function review(planFile, options = {}) {
    const publication = require('./source-publication');
    const plan = publication.load(planFile);
    if (plan.state !== 'review-pending' || !options.confirmReview || !options.evidence) stop('source-review-required');
    if (plan.schema === 'iris-demand-promotion/v2') {
        publication.validate(plan.publication); publication.assertSource(plan.publication);
        plan.review = {evidence: options.evidence, head: plan.publication.head, at: new Date().toISOString()};
        plan.state = 'ready-to-publish'; publication.save(plan); return plan;
    }
    assertSnapshot(plan);
    plan.publication = publication.freeze({gitRoot: plan.gitRoot, head: head(plan.gitRoot), configurationFingerprint: plan.configurationFingerprint,
        environmentAlias: plan.environmentAlias, environmentType: plan.environmentType,
        files: plan.files.map(file => ({path: file.path, sourcePath: file.sourcePath, gitPath: file.gitPath, document: file.document, kind: file.kind,
            localSha256: hash(fs.readFileSync(file.sourcePath)), remoteSha256: file.remote?.sha256 || null, remoteTs: file.remoteTs}))});
    plan.review = {evidence: options.evidence, head: head(plan.gitRoot), at: new Date().toISOString()};
    plan.state = 'ready-to-publish'; save(plan); return plan;
}
function verify(planFile) {
    const publication = require('./source-publication'), plan = publication.load(planFile, {localOnly: true});
    if (plan.schema === 'iris-demand-promotion/v2') {
        if (!['review-pending', 'ready-to-publish', 'verified', 'closed'].includes(plan.state)) stop('source-sync-not-complete');
        if (head(plan.gitRoot) !== (plan.finalCommit || plan.publication.head)) stop('source-commit-mismatch');
        const files = plan.publication.files.map(file => ({...file, gitRoot: plan.gitRoot}));
        if (plan.finalCommit) {
            const transaction = {...plan, files}; assertSnapshot(transaction);
            for (const file of files) if (contentHash(file, blobAt(plan.gitRoot, plan.finalCommit, file)) !== contentHash(file, readBytes(file.sourcePath))) stop('source-commit-mismatch');
        } else publication.assertSource(plan.publication);
        if (plan.state === 'verified' && plan.deployment) recordDeployedBaselines(plan, contextFor(plan.projectRoot), files, head(plan.gitRoot));
        plan.localVerified = true; publication.save(plan); return plan;
    }
    assertSnapshot(plan);
    if (!['change-committed', 'review-pending', 'ready-to-publish', 'verified', 'closed'].includes(plan.state)) stop('source-sync-not-complete');
    for (const file of plan.files) {
        const bytes = blobAt(plan.gitRoot, plan.expected.head, file), local = readBytes(file.sourcePath);
        if (contentHash(file, bytes) !== contentHash(file, local)) stop('source-commit-mismatch');
    }
    if (plan.state === 'verified' && plan.deployment) recordDeployedBaselines(plan, contextFor(plan.projectRoot), plan.files, plan.expected.head);
    plan.localVerified = true; save(plan); return plan;
}
function recordDeployedBaselines(plan, context, files, commit) {
    const entries = registry(context);
    for (const file of files) entries.files[baselineKey({...plan, environmentAlias: plan.environmentAlias || plan.environment?.environmentAlias}, file)] = {
        commit, sha256: contentHash(file, blobAt(plan.gitRoot, commit, file)), document: file.document,
        observedAt: new Date().toISOString(), deployed: true
    };
    atomicJson(registryPath(context), entries);
}
async function finish(planFile, options = {}) {
    const publication = require('./source-publication'), plan = publication.load(planFile), context = contextFor(plan.projectRoot);
    const recovering = plan.state === 'failed-or-unknown' && plan.storageFinalizationStarted && options.continue;
    if ((!recovering && plan.state !== 'post-compile-review') || !options.confirmCommit || !options.confirmReview || !options.evidence) stop('post-compile-review-required');
    publication.validate(plan.publication);
    const receipts = new Map();
    for (const result of [...Object.values(plan.deploymentGroups || {}), plan.deployment].filter(result => result && ['verified', 'group-verified', 'post-compile-review'].includes(result.status))) {
        for (const file of result.files || []) receipts.set(file.document || file.file, file);
    }
    const files = plan.publication.files.filter(file => receipts.has(file.document)).map(file => ({...file, gitRoot: plan.gitRoot, mode: fileMode(plan.gitRoot, file)}));
    if (!files.length || !files.some(file => receipts.get(file.document).storageSynced)) stop('storage-receipt-required');
    const originalFiles = plan.files;
    const transaction = {...plan, files: plan.publication.files.map(file => ({...file, gitRoot: plan.gitRoot, mode: fileMode(plan.gitRoot, file)}))};
    const persist = value => { Object.assign(plan, value, {files: originalFiles}); publication.save(plan); };
    const release = acquireRepositoryLock(plan.gitRoot); let client;
    try {
        if (recovering) recoverPending(transaction, persist);
        else {
            if (head(plan.gitRoot) !== plan.publication.head || publication.fingerprint(textGit(plan.gitRoot, ['ls-files', '--stage', '-v', '-z'])) !== plan.publication.indexSha256) stop('post-compile-source-drift');
            transaction.expected = repositorySnapshot(plan.gitRoot, transaction.files);
        }
        const storage = require('./storage-sync');
        for (const file of transaction.files) {
            const before = blobAt(plan.gitRoot, plan.publication.head, file), after = readBytes(file.sourcePath), receipt = receipts.get(file.document);
            if (!receipt) { if (!after || hash(after) !== file.localSha256) stop('post-compile-undeployed-source-drift'); continue; }
            if (!after || hash(after) !== receipt.localSha256 || contentHash(file, after) !== receipt.postCompileSha256) stop('post-compile-receipt-mismatch');
            if (file.kind === 'backend' && path.extname(file.path).toLowerCase() === '.cls') {
                const first = utf8(comparisonBytes(file, before)), second = utf8(comparisonBytes(file, after));
                if (storage.body(first, storage.inspect(first)) !== storage.body(second, storage.inspect(second))) stop('post-compile-non-storage-change');
            } else if (!before?.equals(after)) stop('post-compile-non-storage-change');
        }
        assertSnapshot(transaction);
        transaction.execution ||= {}; transaction.storageFinalizationStarted = true;
        transaction.execution.step = 'storage-commit'; persist(transaction);
        client = options.client || await openClient(context);
        for (const file of files) {
            const remote = await client.readDocument(file.document), bytes = remote?.content || remote?.bytes || null;
            if (contentHash(file, bytes) !== receipts.get(file.document).postCompileSha256) stop('post-compile-remote-drift');
            assertSnapshot(transaction);
        }
        const committed = scopedCommit(transaction, files, `chore(${plan.demand || plan.demandIds?.join(',') || 'source'}):同步编译生成的Storage\n\n修改说明: 仅记录已核验并复审的编译后Storage，未重新部署。\n\nSource-Sync-Plan: ${plan.id}`, persist);
        transaction.finalCommit = committed || head(plan.gitRoot); persist(transaction);
        restoreTaskIndex(transaction, persist);
        Object.assign(plan, transaction, {files: originalFiles});
        plan.postCompileReview = {evidence: options.evidence, at: new Date().toISOString(), commit: plan.finalCommit};
        plan.remainingKinds = [...new Set(plan.publication.files.filter(file => !receipts.has(file.document)).map(file => file.kind))];
        plan.state = plan.remainingKinds.length ? 'closed' : 'verified';
        plan.requiresNewPlan = plan.remainingKinds.length > 0;
        recordDeployedBaselines(plan, context, files, plan.finalCommit); persist(plan); return plan;
    } catch (error) {
        plan.state = 'failed-or-unknown'; plan.reason = error.code || 'storage-finalization-interrupted'; publication.save(plan); throw error;
    } finally {
        try { if (client && !options.client) {
                plan.remoteCleanup = await client.close();
                if (!plan.remoteCleanup?.cleanupVerified) { plan.state = 'failed-or-unknown'; plan.reason = 'remote-session-exit-unverified'; }
                publication.save(plan);
            }
        } finally { release(); }
    }
}
function createRollbackPlan(options) {
    if (!options.to || options.to.startsWith('-')) stop('rollback-commit-required');
    const plan = createPlan({...options, phase: 'pre-deploy', baselineRef: options.to});
    plan.action = 'rollback-local'; plan.rollbackCommit = textGit(plan.gitRoot, ['rev-parse', '--verify', `${options.to}^{commit}`]);
    for (const file of plan.files) file.restored = storeBytes(plan, 'restored', file, blobAt(plan.gitRoot, plan.rollbackCommit, file));
    save(plan); return plan;
}
function rollbackLocal(planFile, options = {}) {
    const {plan} = load(planFile);
    const recovering = plan.state === 'failed-or-unknown' && options.continue;
    if (plan.action !== 'rollback-local' || !['planned', ...(recovering ? ['failed-or-unknown'] : [])].includes(plan.state) || !options.confirmCommit) stop('local-rollback-authorization-required');
    return repositoryLock(plan.gitRoot, () => {
        if (recovering) recoverPending(plan);
        assertSnapshot(plan);
        try {
            if (!plan.execution.step || ['rollback-writing', 'rollback-commit'].includes(plan.execution.step)) {
                plan.execution.step = 'rollback-writing'; save(plan);
                for (const file of plan.files) { const bytes = storedBytes(plan, 'restored', file, file.restored); validateSource(bytes); writeTarget(plan, file, bytes); }
                plan.execution.step = 'rollback-commit'; save(plan);
                if (!plan.execution.demandCommit) plan.execution.demandCommit = scopedCommit(plan, plan.files, `chore(${plan.demand}):恢复指定本地版本\n\n修改说明: 以新提交恢复明确文件，保留原有历史；未部署服务器。\n\nRollback-Of: ${plan.rollbackCommit}\nSource-Sync-Plan: ${plan.id}`);
                plan.execution.step = 'rollback-index-sync'; save(plan);
            }
            restoreTaskIndex(plan); plan.state = 'change-committed'; plan.requiresNewPlan = true; save(plan); return plan;
        } catch (error) { plan.state = 'failed-or-unknown'; plan.reason = error.code || 'local-rollback-interrupted'; save(plan); throw error; }
    });
}
function status(planFile) {
    const plan = require('./source-publication').load(planFile, {localOnly: true});
    const common = textGit(plan.gitRoot, ['rev-parse', '--git-common-dir']);
    const file = path.resolve(plan.gitRoot, common, 'iris-source-sync.lock');
    const lock = fs.existsSync(file) && !fs.lstatSync(file).isSymbolicLink() ? fs.readFileSync(file) : null;
    return {...plan, repositoryLock: lock ? {path: file, token: hash(lock), owner: JSON.parse(lock.toString('utf8'))} : null};
}
function recoverLock(planFile, options = {}) {
    const publication = require('./source-publication'), plan = publication.load(planFile);
    if (!options.confirmRecovery || !options.evidence || !fs.existsSync(options.evidence) || !fs.statSync(options.evidence).isFile() || !options.token) stop('explicit-lock-recovery-required');
    const common = textGit(plan.gitRoot, ['rev-parse', '--git-common-dir']);
    const file = path.resolve(plan.gitRoot, common, 'iris-source-sync.lock');
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) stop('lock-recovery-target-invalid');
    const bytes = fs.readFileSync(file), owner = JSON.parse(bytes.toString('utf8'));
    if (hash(bytes) !== options.token || !Number.isInteger(owner.pid) || owner.pid < 1) stop('lock-recovery-token-changed');
    try { process.kill(owner.pid, 0); stop('lock-owner-still-alive'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    fs.unlinkSync(file); plan.lockRecovery = {token: options.token, evidence: options.evidence, at: new Date().toISOString()}; publication.save(plan); return plan;
}
function initialize(options) {
    if (!options.confirmLocalGit) stop('local-git-initialization-authorization-required');
    const context = resolveWorkspaceContext(path.resolve(options.projectRoot));
    if (context.mode === 'invalid' || !context.sourceRoots.length) stop('invalid-workspace-context');
    for (const root of context.gitRoots) {
        const existing = textGit(root, ['rev-parse', '--show-toplevel'], {optional: true});
        if (existing && path.resolve(existing) !== path.resolve(root)) stop('declared-git-root-is-parent-repository');
        if (!existing) git(root, ['init']);
        const exclude = path.resolve(root, textGit(root, ['rev-parse', '--git-path', 'info/exclude']));
        const relative = slash(path.relative(root, context.contextRoot));
        const rules = [`/${relative}/work/source-sync/`, `/${relative}/config/iris-development.json`, `/${relative}/config/iris-remote-policy.json`, '/.mcp.json'];
        const content = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
        const missing = rules.filter(rule => !content.split(/\r?\n/).includes(rule));
        if (missing.length) fs.appendFileSync(exclude, '\n' + missing.join('\n') + '\n');
    }
    // The nested capability checkout has its own ignore rules and index.
    const capability = context.capabilityRoot;
    if (within(capability, context.contextRoot) && path.resolve(textGit(capability, ['rev-parse', '--show-toplevel'], {optional: true}) || '.') === path.resolve(capability)) {
        const exclude = path.resolve(capability, textGit(capability, ['rev-parse', '--git-path', 'info/exclude']));
        const prefix = slash(path.relative(capability, context.contextRoot));
        const rules = ['work/source-sync/', 'config/iris-development.json', 'config/iris-remote-policy.json'].map(value => '/' + (prefix ? prefix + '/' : '') + value);
        const previous = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
        const missing = rules.filter(rule => !previous.split(/\r?\n/).includes(rule));
        if (missing.length) fs.appendFileSync(exclude, '\n' + missing.join('\n') + '\n');
    }
    return {status: 'initialized', gitRoots: context.gitRoots, remoteCreated: false};
}

module.exports = {SCHEMA, hash, canonical, git, head, contextFor, isOnDemand, privateRoot, projectConfiguration,
    configurationFingerprint, parseProjectMap, mapItems, classify, repositorySnapshot, createPlan, load, save,
    prepare, apply, review, verify, finish, createRollbackPlan, rollbackLocal, recoverLock, status, initialize, scopedCommit, recoverPending, restoreTaskIndex, acquireRepositoryLock, repositoryLock, environment, demandKind, readBytes, utf8, stop};
