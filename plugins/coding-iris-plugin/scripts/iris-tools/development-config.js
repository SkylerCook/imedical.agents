'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {resolveWorkspaceContext, validateWorkspaceContext} = require('../../../../scripts/lib/workspace-context');
const remote = require('../../../../scripts/lib/iris-remote-operations');
const sync = require('./source-sync-core');

function fail(code) { throw new Error(code); }
function within(root, file) {
    const relative = path.relative(root, file);
    return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}
function assertPhysical(context, file) {
    if (!within(context.workspaceRoot, file)) fail('private-config-outside-workspace');
    let current = context.workspaceRoot;
    for (const segment of path.relative(current, file).split(path.sep)) {
        current = path.join(current, segment);
        try { if (fs.lstatSync(current).isSymbolicLink()) fail('private-config-is-link'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
}
function readObject(file) {
    try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-development-config');
        return value;
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        fail('invalid-development-config');
    }
}
function git(root, args) {
    const result = spawnSync('git', ['--no-optional-locks', '-C', root, ...args], {encoding: 'utf8', windowsHide: true});
    if (result.error) throw result.error;
    return result.status === 0 ? result.stdout.trim() : null;
}
function assertIgnored(context, files) {
    const roots = new Set();
    for (const directory of [...context.gitRoots, context.capabilityRoot]) {
        const root = git(directory, ['rev-parse', '--show-toplevel']);
        if (root) roots.add(path.resolve(root));
    }
    for (const root of roots) for (const file of files) {
        if (!within(root, file)) continue;
        const relative = path.relative(root, file).replace(/\\/g, '/');
        if (git(root, ['ls-files', '--error-unmatch', '--', relative]) !== null) fail('private-config-is-tracked');
        if (git(root, ['check-ignore', '--no-index', '--', relative]) === null) fail('private-config-not-ignored');
    }
}
function createFile(file, value) {
    const bytes = JSON.stringify(value, null, 2) + '\n';
    // Exclusive creation preserves a file another initializer has just written.
    fs.writeFileSync(file, bytes, {flag: 'wx', mode: 0o600});
    if (fs.readFileSync(file, 'utf8') !== bytes) fail('development-config-write-verification-failed');
}
function configure(options = {}) {
    const mode = options.mode || 'DryRun';
    if (!['DryRun', 'Write', 'Check'].includes(mode)) fail('invalid-configure-mode');
    if (options.developmentMode !== undefined && !['connected', 'offline'].includes(options.developmentMode)) fail('development-mode-invalid');
    if (options.environmentAlias !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.environmentAlias)) fail('explicit-environment-required');
    if (options.environmentType !== undefined && !['test', 'development', 'production'].includes(options.environmentType)) fail('explicit-environment-required');
    if (options.kind !== undefined && !['project', 'standard'].includes(options.kind)) fail('explicit-demand-kind-required');
    const context = resolveWorkspaceContext(path.resolve(options.projectRoot || '.'));
    if (!fs.existsSync(context.workspaceRoot) || !fs.statSync(context.workspaceRoot).isDirectory()) fail('workspace-root-missing');
    const invalid = validateWorkspaceContext(context).some(item => ['manifest-invalid', 'schema-version-unsupported'].includes(item.status));
    if (invalid || !['standard', 'workspace-overlay'].includes(context.mode)) fail('invalid-workspace-context');
    if (context.mode === 'workspace-overlay' && within(context.capabilityRoot, context.contextRoot)) fail('private-config-in-shared-capability');
    const directory = path.join(context.contextRoot, 'config');
    const developmentFile = path.join(directory, 'iris-development.json');
    const policyFile = path.join(directory, 'iris-remote-policy.json');
    assertPhysical(context, developmentFile);
    const existing = readObject(developmentFile);
    const developmentMode = remote.developmentMode(context);
    if (existing && options.developmentMode && developmentMode !== options.developmentMode) fail('development-mode-conflict');
    for (const key of ['environmentAlias', 'environmentType']) {
        if (existing?.[key] !== undefined && options[key] !== undefined && existing[key] !== options[key]) fail('environment-declaration-mismatch');
    }
    const selectedMode = options.developmentMode || developmentMode;
    // Updates preserve legacy implicit mode bindings, including old plan fingerprints.
    const declaration = existing || (options.preserveLegacyDefaults && !options.developmentMode ? {} : {developmentMode: selectedMode});
    if (!existing) for (const key of ['environmentAlias', 'environmentType']) {
        if (options[key] !== undefined) declaration[key] = options[key];
    }
    const onDemand = remote.contextMode(context) === 'intent-first-on-demand-export';
    // Public remote admission also applies to standard demands in this context mode.
    const needsPolicy = selectedMode === 'connected' && onDemand;
    if (needsPolicy) assertPhysical(context, policyFile);
    const policy = needsPolicy ? readObject(policyFile) : null;
    const entries = [{path: developmentFile, value: declaration, exists: existing !== null}];
    if (needsPolicy) {
        const initialPolicy = policy || readObject(path.join(__dirname, '../../templates/iris-remote-policy.template.json'));
        if (!initialPolicy) fail('remote-policy-template-missing');
        entries.push({path: policyFile, exists: policy !== null, value: initialPolicy});
    }
    const missing = entries.filter(entry => !entry.exists);
    assertIgnored(context, entries.map(entry => entry.path));
    if (!existing && Object.hasOwn(declaration, 'developmentMode')) {
        const state = path.join(context.contextRoot, 'work/source-sync');
        assertPhysical(context, state);
        if (fs.existsSync(state) && fs.readdirSync(state).length) fail('existing-source-sync-state-requires-review');
    }
    // All local checks precede writes; existing JSON is never rewritten or merged.
    if (mode === 'Write' && missing.length) {
        fs.mkdirSync(directory, {recursive: true});
        for (const entry of missing) createFile(entry.path, entry.value);
    }
    const configurationGaps = [];
    if (!Object.hasOwn(declaration, 'developmentMode')) configurationGaps.push('development-mode-confirmation-required');
    if (mode !== 'Write') for (const entry of missing) configurationGaps.push(path.basename(entry.path) + '-missing');
    let kind = options.kind;
    if (selectedMode === 'connected' && onDemand) {
        try { kind = sync.demandKind(context, options).kind; }
        catch (error) { configurationGaps.push(error.message); }
        if (kind === 'project' && (!declaration.environmentAlias || !declaration.environmentType)) configurationGaps.push('explicit-environment-required');
        if (declaration.environmentAlias && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(declaration.environmentAlias) ||
            declaration.environmentType && !['test', 'development', 'production'].includes(declaration.environmentType)) configurationGaps.push('explicit-environment-required');
    }
    let remoteAdmission = 'not-required', remoteReason = null;
    if (selectedMode === 'offline') remoteAdmission = 'offline';
    else if (needsPolicy) {
        // This is only a local policy check, without reading a connection or making a request.
        try { remote.loadRemotePolicy(context); remoteAdmission = 'locally-configured'; }
        catch (error) {
            remoteAdmission = 'pending';
            remoteReason = fs.existsSync(policyFile) && error.code === 'remote-policy-required' ? 'remote-policy-not-qualified' : error.code || error.message;
        }
    }
    return {mode, contextRoot: context.contextRoot, developmentMode: selectedMode,
        files: entries.map(entry => ({path: path.relative(context.workspaceRoot, entry.path).replace(/\\/g, '/'),
            status: entry.exists ? 'preserved' : mode === 'Write' ? 'created' : 'missing'})),
        configurationReady: configurationGaps.length === 0, configurationGaps,
        remoteAdmission, remoteReason, baseline: 'not-established-by-configure'};
}

function migrate(options = {}) {
    const target = 'config/iris-development.json';
    const entry = (status, reason, file = target) => ({status, target: file, reason});
    try {
        const context = resolveWorkspaceContext(path.resolve(options.projectRoot || '.'));
        if (options.contextRoot && path.resolve(options.contextRoot) !== path.resolve(context.contextRoot)) fail('migration-context-root-mismatch');
        const result = configure({projectRoot: options.projectRoot, mode: options.mode, preserveLegacyDefaults: true});
        const entries = result.files.map(file => entry(file.status === 'created' ? 'config-migration-applied' :
            file.status === 'missing' ? 'config-migration-planned' : 'config-migration-unchanged',
        file.status === 'preserved' ? 'Existing private configuration preserved byte-for-byte.' : 'Create missing private configuration without changing legacy mode defaults.', file.path));
        const pending = [...result.configurationGaps];
        if (result.remoteAdmission === 'pending') pending.push(result.remoteReason);
        if (pending.length) entries.push(entry('config-migration-review-required', [...new Set(pending)].join('; ')));
        return entries;
    } catch (error) {
        return [entry('config-migration-review-required', error.code || error.message)];
    }
}

if (require.main === module) {
    const options = {}, names = {'--project-root': 'projectRoot', '--context-root': 'contextRoot', '--mode': 'mode'};
    try {
        const argv = process.argv.slice(2);
        for (let index = 0; index < argv.length; index += 2) {
            if (!names[argv[index]] || !argv[index + 1] || argv[index + 1].startsWith('--')) fail('invalid-config-migration-argument');
            options[names[argv[index]]] = argv[index + 1];
        }
        console.log(JSON.stringify(migrate(options)));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = {configure, migrate};
