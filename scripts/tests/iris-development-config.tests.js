'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createTempDirectory, ownsTempDirectory} = require('./fixtures/temp-directory');
const {configure, migrate} = require('../../plugins/coding-iris-plugin/scripts/iris-tools/development-config');
const remote = require('../lib/iris-remote-operations');
const cli = path.resolve(__dirname, '../../plugins/coding-iris-plugin/scripts/iris-tools/source-sync.js');
const {args} = require(cli);

function git(root, ...args) {
    const result = spawnSync('git', ['-C', root, ...args], {encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
}
function write(file, value) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}
function fixture(t, {onDemand = true, kind = 'project', ignored = true, overlay = false} = {}) {
    const parent = createTempDirectory('iris-config-');
    t.after(() => {
        assert.ok(ownsTempDirectory(parent));
        fs.rmSync(parent, {recursive: true, force: true});
        assert.equal(fs.existsSync(parent), false);
    });
    const root = path.join(parent, 'workspace');
    fs.mkdirSync(root);
    git(root, 'init', '-q');
    write(path.join(root, '.gitignore'), ignored ? '.agents/\ncontext/\n' : '.agents/.git/\n');
    const contextRoot = path.join(root, overlay ? 'context' : '.agents');
    const capabilityRoot = overlay ? path.join(parent, 'capability') : contextRoot;
    fs.mkdirSync(capabilityRoot, {recursive: true});
    git(capabilityRoot, 'init', '-q');
    if (ignored) fs.appendFileSync(path.join(capabilityRoot, '.git/info/exclude'), '\n/config/\n/work/\n');
    write(path.join(contextRoot, 'config/project_context_profile.md'), '- contextMode: ' + (onDemand ? 'intent-first-on-demand-export' : 'codebase-complete') + '\n');
    if (kind) write(path.join(contextRoot, 'config/iris_project_profile.md'), '- 默认需求交付类型：' + kind + '\n');
    if (overlay) write(path.join(root, '.agents/capability.json'), {schemaVersion: 1, mode: 'workspace-overlay', workspace: 'fixture',
        contextRoot: 'context', capabilityRoot, sharedDirectories: [], localDirectories: ['config'],
        sourceRoots: [{name: 'backend', path: 'code', target: 'code', gitRoot: 'code'}]});
    const developmentFile = path.join(contextRoot, 'config/iris-development.json');
    const policyFile = path.join(contextRoot, 'config/iris-remote-policy.json');
    return {root, parent, contextRoot, capabilityRoot, developmentFile, policyFile,
        run: options => configure({projectRoot: root, mode: 'Write', developmentMode: 'connected',
            environmentAlias: 'confirmed-test', environmentType: 'test', ...options})};
}

test('initialization creates required local configuration without reading connections or creating a baseline', t => {
    const f = fixture(t), originalRead = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
        if (/(?:project-env|\.mcp)\.json$/i.test(String(file))) throw new Error('connection-read-during-configuration');
        return originalRead.call(this, file, ...args);
    };
    let result;
    try { result = f.run(); } finally { fs.readFileSync = originalRead; }
    assert.equal(result.configurationReady, true);
    assert.deepEqual(result.files.map(entry => entry.status), ['created', 'created']);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.developmentFile)), {developmentMode: 'connected', environmentAlias: 'confirmed-test', environmentType: 'test'});
    const policy = JSON.parse(fs.readFileSync(f.policyFile));
    assert.equal(policy.enabled, false);
    assert.equal(policy.qualification.status, 'pending');
    assert.equal(result.remoteAdmission, 'pending');
    assert.equal(result.remoteReason, 'remote-policy-not-qualified');
    assert.throws(() => remote.loadRemotePolicy({contextRoot: f.contextRoot}), /remote-policy-required/);
    assert.equal(fs.existsSync(path.join(f.contextRoot, 'work/source-sync')), false);
    assert.equal(result.baseline, 'not-established-by-configure');
    assert.equal(fs.existsSync(path.join(f.root, '.mcp.json')), false);
    assert.equal(fs.existsSync(path.join(f.contextRoot, 'config/project-env.json')), false);
    // Check new files against both owning repositories, including the nested capability checkout.
    for (const file of [f.developmentFile, f.policyFile]) {
        assert.ok(git(f.root, 'check-ignore', '--no-index', '--', path.relative(f.root, file)));
        assert.ok(git(f.capabilityRoot, 'check-ignore', '--no-index', '--', path.relative(f.capabilityRoot, file)));
    }
});

test('DryRun, Check and the default mode never create configuration or directories', t => {
    const f = fixture(t);
    for (const mode of ['DryRun', 'Check', undefined]) {
        const result = f.run({mode});
        assert.equal(result.configurationReady, false);
        assert.ok(result.configurationGaps.includes('iris-development.json-missing'));
        assert.equal(fs.existsSync(f.developmentFile), false);
        assert.equal(fs.existsSync(f.policyFile), false);
    }
});

test('reruns preserve existing JSON bytes, unknown fields, pending qualification and recovery state', t => {
    const f = fixture(t);
    f.run();
    const development = '\ufeff{ "developmentMode": "connected", "environmentAlias": "confirmed-test", "environmentType": "test", "custom": 42 }\r\n';
    const policy = fs.readFileSync(f.policyFile);
    write(f.developmentFile, development);
    write(path.join(f.contextRoot, 'work/source-sync/tasks/existing/plan.json'), 'original recovery bytes');
    for (const mode of ['Write', 'Check']) {
        const result = f.run({mode});
        assert.equal(result.configurationReady, true);
        assert.deepEqual(result.files.map(entry => entry.status), ['preserved', 'preserved']);
        assert.equal(fs.readFileSync(f.developmentFile, 'utf8'), development);
        assert.deepEqual(fs.readFileSync(f.policyFile), policy);
    }
    assert.equal(fs.readFileSync(path.join(f.contextRoot, 'work/source-sync/tasks/existing/plan.json'), 'utf8'), 'original recovery bytes');
});

test('offline initialization needs only its mode and leaves even invalid unused remote configuration alone', t => {
    const f = fixture(t);
    write(path.join(f.contextRoot, 'config/project-env.json'), 'invalid connection');
    const result = f.run({developmentMode: 'offline', environmentAlias: undefined, environmentType: undefined});
    assert.equal(result.configurationReady, true);
    assert.equal(result.remoteAdmission, 'offline');
    assert.deepEqual(JSON.parse(fs.readFileSync(f.developmentFile)), {developmentMode: 'offline'});
    assert.equal(fs.existsSync(f.policyFile), false);
    write(f.policyFile, 'invalid unused policy');
    assert.equal(f.run({developmentMode: undefined}).remoteAdmission, 'offline');
    assert.equal(fs.readFileSync(f.policyFile, 'utf8'), 'invalid unused policy');
    assert.throws(() => remote.assertRemoteAllowed({contextRoot: f.contextRoot}), /offline-development-remote-disabled/);
});

test('complete-code contexts do not acquire a project-only policy or demand/environment prerequisites', t => {
    const f = fixture(t, {onDemand: false, kind: null});
    const result = f.run({environmentAlias: undefined, environmentType: undefined});
    assert.equal(result.configurationReady, true);
    assert.equal(result.remoteAdmission, 'not-required');
    assert.equal(fs.existsSync(f.policyFile), false);
});

test('on-demand standard contexts get public admission configuration without project environment requirements', t => {
    const f = fixture(t, {kind: 'standard'});
    assert.equal(f.run({environmentAlias: undefined, environmentType: undefined}).configurationReady, true);
    assert.equal(fs.existsSync(f.policyFile), true);
});

test('unknown environment or demand kind is reported without inventing defaults or treating contextMode as kind', t => {
    const f = fixture(t, {kind: null});
    let result = f.run({environmentAlias: undefined, environmentType: undefined});
    assert.ok(result.configurationGaps.includes('explicit-demand-kind-required'));
    assert.deepEqual(JSON.parse(fs.readFileSync(f.developmentFile)), {developmentMode: 'connected'});
    result = f.run({kind: 'project'});
    assert.ok(result.configurationGaps.includes('explicit-environment-required'));
    // Supplied options do not overwrite or silently patch an existing declaration.
    assert.deepEqual(JSON.parse(fs.readFileSync(f.developmentFile)), {developmentMode: 'connected'});
});

test('explicit facts must agree with existing declarations before any missing policy is written', t => {
    const f = fixture(t);
    write(f.developmentFile, {developmentMode: 'offline', environmentAlias: 'original'});
    assert.throws(() => f.run(), /development-mode-conflict/);
    assert.throws(() => f.run({developmentMode: 'offline'}), /environment-declaration-mismatch/);
    assert.equal(fs.existsSync(f.policyFile), false);
    assert.equal(JSON.parse(fs.readFileSync(f.developmentFile)).environmentAlias, 'original');
});

test('invalid existing JSON and invalid option values fail before writing anything', t => {
    const f = fixture(t);
    for (const options of [{mode: 'invalid'}, {developmentMode: 'invalid'}, {environmentAlias: '../bad'}, {environmentType: 'invalid'}, {kind: 'TODO'}]) {
        assert.throws(() => f.run(options));
        assert.equal(fs.existsSync(f.developmentFile), false);
    }
    write(f.policyFile, '{');
    assert.throws(() => f.run(), /invalid-development-config/);
    assert.equal(fs.existsSync(f.developmentFile), false);
    fs.unlinkSync(f.policyFile);
    write(f.developmentFile, '[]');
    assert.throws(() => f.run(), /invalid-development-config/);
    assert.equal(fs.existsSync(f.policyFile), false);
});

test('new private files must be ignored before creation and tracked files cannot pass Check', t => {
    const f = fixture(t, {ignored: false});
    assert.throws(() => f.run(), /private-config-not-ignored/);
    assert.equal(fs.existsSync(f.developmentFile), false);
    write(path.join(f.root, '.gitignore'), '.agents/\n');
    write(f.developmentFile, {developmentMode: 'connected'});
    git(f.capabilityRoot, 'add', '-f', 'config/iris-development.json');
    assert.throws(() => f.run({mode: 'Check'}), /private-config-is-tracked/);
    assert.equal(fs.existsSync(f.policyFile), false);
});

test('missing legacy declarations with existing source-sync state cannot silently change configuration fingerprints', t => {
    const f = fixture(t);
    write(path.join(f.contextRoot, 'work/source-sync/tasks/existing/plan.json'), 'recovery');
    assert.throws(() => f.run(), /existing-source-sync-state-requires-review/);
    assert.equal(fs.existsSync(f.developmentFile), false);
    assert.equal(fs.existsSync(f.policyFile), false);
});

test('Overlay creates configuration only in the resolved ContextRoot and preserves shared capability content', t => {
    const f = fixture(t, {overlay: true});
    write(path.join(f.capabilityRoot, 'marker.txt'), 'shared');
    const result = f.run();
    assert.equal(result.contextRoot, f.contextRoot);
    assert.equal(result.configurationReady, true);
    assert.equal(fs.existsSync(path.join(f.root, '.agents/config')), false);
    assert.equal(fs.existsSync(path.join(f.capabilityRoot, 'config')), false);
    assert.equal(fs.readFileSync(path.join(f.capabilityRoot, 'marker.txt'), 'utf8'), 'shared');
});

test('configuration directories cannot redirect writes through a Junction or symbolic link', t => {
    const f = fixture(t), outside = path.join(f.parent, 'outside');
    fs.mkdirSync(outside);
    fs.rmSync(path.join(f.contextRoot, 'config'), {recursive: true});
    fs.symlinkSync(outside, path.join(f.contextRoot, 'config'), process.platform === 'win32' ? 'junction' : 'dir');
    try {
        assert.throws(() => f.run(), /private-config-is-link/);
        assert.deepEqual(fs.readdirSync(outside), []);
    } finally { fs.unlinkSync(path.join(f.contextRoot, 'config')); }
});

test('CLI exposes configuration status and help without accessing the target workspace', t => {
    const f = fixture(t);
    const result = spawnSync(process.execPath, [cli, 'configure', '--project-root', f.root, '--mode', 'Check', '--kind', 'project'], {encoding: 'utf8', windowsHide: true});
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).configurationReady, false);
    const created = spawnSync(process.execPath, [cli, 'configure', '--project-root', f.root, '--mode', 'Write',
        '--development-mode', 'connected', '--kind', 'project', '--environment-alias', 'confirmed-cli', '--environment-type', 'production'], {encoding: 'utf8', windowsHide: true});
    assert.equal(created.status, 0, created.stderr);
    assert.deepEqual(JSON.parse(created.stdout).files.map(entry => entry.status), ['created', 'created']);
    const checked = spawnSync(process.execPath, [cli, 'configure', '--project-root', f.root, '--mode', 'Check', '--kind', 'project'], {encoding: 'utf8', windowsHide: true});
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(JSON.parse(checked.stdout).configurationReady, true);
    assert.equal(JSON.parse(fs.readFileSync(f.developmentFile)).environmentType, 'production');
    const missing = path.join(f.parent, 'not-created');
    const help = spawnSync(process.execPath, [cli, 'configure', '--project-root', missing, '--mode', 'Write', '--help'], {encoding: 'utf8', windowsHide: true});
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /configure/);
    assert.throws(() => configure({projectRoot: missing, mode: 'Write'}), /workspace-root-missing/);
    assert.equal(fs.existsSync(missing), false);
});

test('configuration-only flags cannot be silently accepted by remote source-sync commands', () => {
    assert.throws(() => args(['prepare', '--development-mode', 'offline']), /unknown-source-sync-option/);
    assert.throws(() => args(['apply', '--mode', 'Check']), /unknown-source-sync-option/);
    assert.throws(() => args(['configure', '--scope-file', 'not-read.json']), /unknown-source-sync-option/);
});

test('automatic updates create missing configuration while preserving implicit legacy mode and recovery fingerprints', t => {
    const f = fixture(t), context = {contextRoot: f.contextRoot};
    const before = remote.bindDevelopmentMode(context, {synthetic: true});
    const recovery = path.join(f.contextRoot, 'work/source-sync/tasks/legacy/plan.json');
    write(recovery, 'original recovery');
    const result = migrate({projectRoot: f.root, mode: 'Write', contextRoot: f.contextRoot});
    assert.equal(result.filter(entry => entry.status === 'config-migration-applied').length, 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.developmentFile)), {});
    assert.deepEqual(remote.bindDevelopmentMode(context, {synthetic: true}), before);
    assert.equal(fs.readFileSync(recovery, 'utf8'), 'original recovery');
    assert.equal(JSON.parse(fs.readFileSync(f.policyFile)).enabled, false);
    assert.ok(result.some(entry => entry.reason.includes('development-mode-confirmation-required')));
    assert.ok(result.some(entry => entry.reason.includes('explicit-environment-required')));
    assert.ok(configure({projectRoot: f.root, mode: 'Check'}).configurationGaps.includes('development-mode-confirmation-required'));
    const declaration = fs.readFileSync(f.developmentFile), policy = fs.readFileSync(f.policyFile);
    const rerun = migrate({projectRoot: f.root, mode: 'Write'});
    assert.equal(rerun.filter(entry => entry.status === 'config-migration-applied').length, 0);
    assert.deepEqual(fs.readFileSync(f.developmentFile), declaration);
    assert.deepEqual(fs.readFileSync(f.policyFile), policy);
});

test('automatic completion respects read-only modes, offline configuration, Overlay and bound ContextRoot', t => {
    const f = fixture(t, {overlay: true});
    for (const mode of ['DryRun', 'Check']) {
        const planned = migrate({projectRoot: f.root, mode});
        assert.equal(planned.filter(entry => entry.status === 'config-migration-planned').length, 2);
        assert.equal(fs.existsSync(f.developmentFile), false);
    }
    const mismatched = migrate({projectRoot: f.root, contextRoot: f.capabilityRoot, mode: 'Write'});
    assert.equal(mismatched[0].reason, 'migration-context-root-mismatch');
    assert.equal(fs.existsSync(path.join(f.capabilityRoot, 'config')), false);
    write(f.developmentFile, '\ufeff{ "developmentMode": "offline", "custom": 17 }\r\n');
    const before = fs.readFileSync(f.developmentFile);
    const result = migrate({projectRoot: f.root, contextRoot: f.contextRoot, mode: 'Write'});
    assert.equal(result.length, 1);
    assert.equal(result[0].status, 'config-migration-unchanged');
    assert.deepEqual(fs.readFileSync(f.developmentFile), before);
    assert.equal(fs.existsSync(f.policyFile), false);
});

test('automatic completion reports invalid or unignored configuration and performs no writes', t => {
    const f = fixture(t, {ignored: false});
    assert.equal(migrate({projectRoot: f.root, mode: 'Write'})[0].reason, 'private-config-not-ignored');
    assert.equal(fs.existsSync(f.developmentFile), false);
    write(f.developmentFile, 'invalid JSON');
    assert.equal(migrate({projectRoot: f.root, mode: 'Write'})[0].reason, 'invalid-development-config');
    assert.equal(fs.existsSync(f.policyFile), false);
});

test('Windows update migration wrapper forwards Write and DryRun and reports actionable pending facts', {skip: process.platform !== 'win32'}, t => {
    const f = fixture(t), wrapper = path.resolve(__dirname, '../../plugins/coding-iris-plugin/scripts/migrate-development-config.ps1');
    for (const shell of ['powershell.exe', 'pwsh.exe']) {
        const dry = spawnSync(shell, ['-NoProfile', '-File', wrapper, '-ProjectRoot', f.root, '-AgentsRoot', f.contextRoot, '-Mode', 'DryRun'], {encoding: 'utf8', windowsHide: true});
        assert.equal(dry.status, 0, dry.stderr);
        assert.ok(JSON.parse(dry.stdout).some(entry => entry.status === 'config-migration-planned'));
        assert.equal(fs.existsSync(f.developmentFile), false);
    }
    const applied = spawnSync('powershell.exe', ['-NoProfile', '-File', wrapper, '-ProjectRoot', f.root, '-AgentsRoot', f.contextRoot, '-Mode', 'Write'], {encoding: 'utf8', windowsHide: true});
    assert.equal(applied.status, 0, applied.stderr);
    assert.ok(JSON.parse(applied.stdout).some(entry => entry.status === 'config-migration-applied'));
    assert.ok(JSON.parse(applied.stdout).some(entry => entry.status === 'config-migration-review-required'));
    assert.equal(fs.existsSync(f.policyFile), true);
});
