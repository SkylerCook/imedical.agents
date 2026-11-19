'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createTempDirectory, ownsTempDirectory } = require('./fixtures/temp-directory');

function loadRuntime(file, overrides) {
    const runtimeRequire = require('node:module').createRequire(path.resolve(__dirname, '..', file));
    const loaded = { exports: {} };
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^#![^\n]*\n/, '');
    new Function('require', 'module', source)(name => overrides[name] || runtimeRequire(name), loaded);
    return loaded.exports;
}

function fixture(t, mode = 'standard') {
    const temporary = createTempDirectory('plugin-deployment-member-history-');
    t.after(() => {
        assert.ok(ownsTempDirectory(temporary));
        fs.rmSync(temporary, { recursive: true });
        assert.equal(fs.existsSync(temporary), false);
    });
    const project = path.join(temporary, 'project');
    const root = path.join(project, '.agents');
    const contextRoot = mode === 'standard' ? root : path.join(temporary, 'overlay', '.agents');
    const context = { mode, workspaceRoot: path.dirname(contextRoot), capabilityRoot: root, contextRoot };
    fs.mkdirSync(path.join(root, '.git/info'), { recursive: true });
    fs.mkdirSync(path.join(contextRoot, 'config'), { recursive: true });
    const base = ['agent-context-kit', 'agent-framework-evolution'];
    const definitions = [
        ...base.map(name => ({ name })),
        { name: 'feature-core' },
        { name: 'feature-ui', dependencies: ['feature-core'], runtimeResources: ['vendor/ui-runtime'] },
        { name: 'feature-extra' }
    ];
    const plugins = definitions.map(definition => {
        const manifest = { version: '1.0.0', ...definition };
        const file = path.join(root, 'plugins', manifest.name, '.agents-plugin/plugin.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(manifest));
        return { directory: manifest.name, manifest,
            manifestHash: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex') };
    });
    const catalog = { schema: 'plugin-catalog/v1', basePlugins: base, plugins };
    const stateFile = path.join(root, '.git/plugin-deployment.json');
    const profileFile = path.join(contextRoot, 'config/plugin_profile.md');
    const required = [...base, 'feature-core', 'feature-ui'];
    const originalMember = { contextRoot, lastRequired: required, note: 'existing member metadata' };
    const originalState = { schema: 'plugin-installation/v1', mode: 'on-demand',
        members: [originalMember], installed: required, phase: 'ready' };
    fs.writeFileSync(stateFile, JSON.stringify(originalState));
    fs.writeFileSync(path.join(contextRoot, 'config/plugin-deployment.json'),
        JSON.stringify({ schema: 'plugin-deployment/v1', mode: 'on-demand', autoInstall: false }));
    // Keep state/profile IO and the application flow real; replace only Git and sparse materialization.
    const git = (_command, args) => {
        assert.equal(args[0], '-C'); assert.equal(args[1], root);
        const command = args.slice(2);
        let stdout;
        if (command[0] === 'show') stdout = JSON.stringify(catalog);
        else if (command[0] === 'rev-parse' && command[1] === '--git-path') stdout = '.git/' + command[2];
        else if (command[0] === 'rev-parse' && command[1] === 'HEAD') stdout = 'a'.repeat(40);
        else if (command[0] === 'status') stdout = '';
        else throw new Error('Unexpected Git command: ' + command.join(' '));
        return { status: 0, stdout, stderr: '' };
    };
    const deployment = loadRuntime('lib/plugin-deployment.js', { 'node:child_process': { spawnSync: git } });
    const refreshes = [];
    const cli = loadRuntime('plugin-deploy.js', {
        './lib/plugin-deployment': deployment,
        './lib/workspace-context': require('../lib/workspace-context'),
        './refresh-agents-sparse': { refresh: (capabilityRoot, patterns) => {
            assert.equal(capabilityRoot, root);
            refreshes.push(deployment.sparsePatterns(root, patterns));
        } }
    });
    const apply = action => cli.apply(context, { action, plugins: action === 'ensure' ? ['feature-extra'] : [],
        members: [], membersComplete: true, explicit: true });
    return { root, context, deployment, cli, stateFile, profileFile, originalMember, originalState,
        base, required, refreshes, apply };
}

for (const mode of ['standard', 'workspace-overlay']) {
    test(mode + ': missing current profile preserves recorded requirements in a prune plan', t => {
        const f = fixture(t, mode), before = fs.readFileSync(f.stateFile);
        const plan = f.deployment.plan(f.context, [], 'prune');
        assert.deepEqual(plan.members, [f.originalMember]);
        assert.deepEqual(plan.offlineMembers, [f.context.contextRoot]);
        assert.ok(plan.keep.includes('feature-ui'));
        assert.ok(plan.keep.includes('feature-core'));
        assert.ok(plan.resources.includes('vendor/ui-runtime'));
        assert.ok(!plan.remove.includes('feature-ui'));
        assert.ok(plan.remove.includes('feature-extra'));
        assert.deepEqual(fs.readFileSync(f.stateFile), before);
    });

    test(mode + ': prune and migration stop before state or sparse changes when current profile is missing', t => {
        const f = fixture(t, mode), before = fs.readFileSync(f.stateFile);
        for (const action of ['prune', 'migrate']) assert.throws(() => f.apply(action), /Shared projects unavailable/);
        assert.equal(f.refreshes.length, 0);
        assert.deepEqual(fs.readFileSync(f.stateFile), before);
        assert.equal(fs.existsSync(f.profileFile), false);
        assert.equal(fs.existsSync(path.join(f.root, '.git/plugin-deployment.lock')), false);
    });

    test(mode + ': repeated ensure retains missing profile and history for subsequent pruning and refresh', t => {
        const f = fixture(t, mode);
        for (let attempt = 0; attempt < 2; attempt++) {
            const result = f.apply('ensure');
            assert.deepEqual(result.offlineMembers, [f.context.contextRoot]);
            const saved = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
            assert.deepEqual(saved.members, [f.originalMember]);
            assert.ok(saved.installed.includes('feature-extra'));
            assert.equal(saved.phase, 'ready');
            assert.equal(fs.existsSync(f.profileFile), false);
            const patterns = f.refreshes.at(-1);
            assert.ok(patterns.includes('/plugins/feature-ui/**'));
            assert.ok(patterns.includes('/vendor/ui-runtime/**'));
        }
        const before = fs.readFileSync(f.stateFile);
        assert.throws(() => f.apply('prune'), /Shared projects unavailable/);
        assert.deepEqual(fs.readFileSync(f.stateFile), before);
        assert.equal(f.refreshes.length, 2);
        const patterns = f.deployment.sparsePatterns(f.root, ['/plugins/**', '/vendor/**']);
        assert.ok(patterns.includes('/plugins/feature-ui/**'));
        assert.ok(patterns.includes('/vendor/ui-runtime/**'));
    });

    test(mode + ': restored readable profile replaces historical needs and permits normal pruning', t => {
        const f = fixture(t, mode);
        fs.writeFileSync(f.profileFile, '| feature-extra | enabled | - | - | current project choice |\n| feature-ui | available | - | - | explicit restored choice |\n| feature-core | available | - | - | explicit restored choice |\n');
        const plan = f.deployment.plan(f.context, [], 'prune');
        assert.deepEqual(plan.offlineMembers, []);
        assert.ok(plan.remove.includes('feature-ui'));
        assert.ok(plan.remove.includes('feature-core'));
        const before = fs.readFileSync(f.profileFile);
        f.apply('prune');
        const saved = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
        assert.deepEqual(saved.members[0].lastRequired, [...f.base, 'feature-extra']);
        assert.equal(saved.members[0].note, f.originalMember.note);
        assert.deepEqual(fs.readFileSync(f.profileFile), before);
        assert.ok(!f.refreshes[0].includes('/plugins/feature-ui/**'));
        assert.ok(!f.refreshes[0].includes('/vendor/ui-runtime/**'));
    });
}

test('a genuinely new member without a profile still receives available entries on ensure', t => {
    const f = fixture(t);
    const state = { ...f.originalState, members: [] };
    fs.writeFileSync(f.stateFile, JSON.stringify(state));
    const result = f.apply('ensure');
    assert.deepEqual(result.offlineMembers, []);
    assert.equal(f.deployment.profile(f.context.contextRoot).get('feature-extra'), 'available');
    assert.deepEqual(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).members[0].lastRequired, f.base);
});

test('BOM and indented explicit profile rows take precedence over retained historical requirements', t => {
    const f = fixture(t);
    fs.writeFileSync(f.profileFile, '\uFEFF  | `feature-ui` | disabled | - | - | explicit project choice |\n\t| feature-core | enabled | - | - | retained note |\n');
    const current = f.deployment.profileContext(f.root, f.context.contextRoot);
    assert.equal(current.statuses.get('feature-ui'), 'disabled');
    assert.equal(current.statuses.get('feature-core'), 'enabled');
    assert.ok(!current.retained.includes('feature-ui'));
    assert.ok(!current.retained.includes('feature-core'));
    const plan = f.deployment.plan(f.context, [], 'prune');
    assert.ok(!plan.keep.includes('feature-ui'));
    assert.ok(plan.keep.includes('feature-core'));
    assert.throws(() => f.deployment.plan(f.context, ['feature-ui']), /explicitly disabled/);
});

test('an equivalent recorded context path keeps the same offline-member protection', t => {
    const f = fixture(t);
    const member = { ...f.originalMember, contextRoot: f.context.contextRoot + path.sep + '.' };
    fs.writeFileSync(f.stateFile, JSON.stringify({ ...f.originalState, members: [member] }));
    const result = f.apply('ensure');
    assert.deepEqual(result.offlineMembers, [member.contextRoot]);
    assert.equal(fs.existsSync(f.profileFile), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).members, [member]);
});

test('another offline member does not prevent available entries for the readable current project', t => {
    const f = fixture(t);
    fs.writeFileSync(f.profileFile, '| feature-core | enabled | - | - | current project choice |\n| feature-ui | available | - | - | explicit project choice |\n');
    const other = { contextRoot: path.join(f.context.workspaceRoot, 'offline-context'), lastRequired: f.required };
    fs.writeFileSync(f.stateFile, JSON.stringify({ ...f.originalState, members: [f.originalMember, other] }));
    const result = f.apply('ensure');
    assert.deepEqual(result.offlineMembers, [other.contextRoot]);
    assert.equal(f.deployment.profile(f.context.contextRoot).get('feature-extra'), 'available');
    assert.equal(f.deployment.profile(f.context.contextRoot).get('feature-core'), 'enabled');
    const saved = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
    assert.deepEqual(saved.members[0].lastRequired, [...f.base, 'feature-core']);
    assert.deepEqual(saved.members[1], other);
});

for (const mode of ['standard', 'workspace-overlay']) {
    test(mode + ': a partial profile retains missing historical resources without claiming enablement', t => {
        const f = fixture(t, mode);
        fs.writeFileSync(f.profileFile, '| feature-extra | enabled | - | - | current project choice |\n| feature-core | disabled | - | - | explicit project choice |\n');
        const plan = f.deployment.plan(f.context, [], 'prune');
        assert.deepEqual(plan.offlineMembers, []);
        assert.ok(plan.keep.includes('feature-ui'));
        assert.ok(plan.keep.includes('feature-core'));
        assert.ok(plan.resources.includes('vendor/ui-runtime'));
        assert.equal(f.deployment.profile(f.context.contextRoot).has('feature-ui'), false);
        assert.equal(f.deployment.profile(f.context.contextRoot).get('feature-core'), 'disabled');
        f.apply('ensure');
        assert.equal(f.deployment.profile(f.context.contextRoot).has('feature-ui'), false);
        assert.equal(f.deployment.profile(f.context.contextRoot).get('feature-core'), 'disabled');
        fs.writeFileSync(f.profileFile, '| feature-extra | enabled | - | - | current project choice |\n');
        f.cli.apply(f.context, { action: 'ensure', plugins: ['feature-ui'], members: [], explicit: true });
        assert.equal(f.deployment.profile(f.context.contextRoot).has('feature-ui'), false);
        const after = f.deployment.plan(f.context, [], 'prune');
        assert.ok(!after.remove.includes('feature-ui'));
        // Actual enabled dependencies remain strict even though history is resource-only.
        fs.writeFileSync(f.profileFile, '| feature-ui | enabled | - | - | explicit project choice |\n| feature-core | disabled | - | - | explicit project choice |\n');
        assert.throws(() => f.deployment.plan(f.context, [], 'prune'), /Plugin explicitly disabled/);
    });
}

test('context identity normalizes path segments and folds casing only on Windows', () => {
    const { sameContextRoot } = require('../lib/plugin-deployment');
    const root = path.resolve('MemberContext'), variant = root.toLowerCase();
    assert.notEqual(root, variant);
    for (const platform of ['win32', 'linux', 'darwin']) {
        assert.equal(sameContextRoot(root, root + path.sep + '.', platform), true);
        assert.equal(sameContextRoot(root, variant, platform), platform === 'win32');
        assert.equal(sameContextRoot(root, root + '-other', platform), false);
    }
});

for (const mode of ['standard', 'workspace-overlay']) {
    test(mode + ': Windows casing aliases retain one offline member through planning and repeated ensure',
        { skip: process.platform !== 'win32' }, t => {
            const f = fixture(t, mode);
            const member = { ...f.originalMember, contextRoot: f.context.contextRoot.toUpperCase() };
            assert.notEqual(member.contextRoot, f.context.contextRoot);
            assert.ok(fs.existsSync(member.contextRoot));
            fs.writeFileSync(f.stateFile, JSON.stringify({ ...f.originalState, members: [member] }));
            const plan = f.deployment.plan(f.context, [], 'prune', [f.context.contextRoot, member.contextRoot]);
            assert.deepEqual(plan.members, [member]);
            assert.deepEqual(plan.offlineMembers, [member.contextRoot]);
            for (let attempt = 0; attempt < 2; attempt++) {
                f.apply('ensure');
                assert.deepEqual(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).members, [member]);
                assert.equal(fs.existsSync(f.profileFile), false);
            }
            if (mode === 'standard') {
                f.cli.main(['register', '--project-root', f.context.workspaceRoot]);
                assert.deepEqual(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).members, [member]);
                assert.equal(fs.existsSync(f.profileFile), false);
            }
            assert.throws(() => f.apply('prune'), /Shared projects unavailable/);
        });
}
