'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTempDirectory, ownsTempDirectory } = require('./fixtures/temp-directory');
const deployment = require('../lib/plugin-deployment');
const cli = require('../plugin-deploy');
const repo = path.resolve(__dirname, '../..');
const shells = process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh'];

function git(root, args) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
}
function fixture(t, mode, { generatorBody } = {}) {
    const temporary = createTempDirectory('plugin-profile-history-');
    t.after(() => {
        assert.ok(ownsTempDirectory(temporary));
        fs.rmSync(temporary, { recursive: true });
        assert.equal(fs.existsSync(temporary), false);
    });
    const project = path.join(temporary, 'project');
    const root = mode === 'standard' ? path.join(project, '.agents') : path.join(temporary, 'shared/.agents');
    const contextRoot = path.join(project, '.agents');
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(contextRoot, 'config'), { recursive: true });
    git(project, ['init', '-q']);
    git(root, ['init', '-q']);
    git(root, ['config', 'user.name', 'Fixture']);
    git(root, ['config', 'user.email', 'fixture@example.invalid']);
    fs.appendFileSync(path.join(root, '.git/info/exclude'), '\n/config/\n/skills/\n/rules/\n/memory/\n');
    fs.cpSync(path.join(repo, 'scripts'), path.join(root, 'scripts'), {
        recursive: true, filter: source => !source.replaceAll('\\', '/').includes('/scripts/tests')
    });
    if (generatorBody) fs.writeFileSync(path.join(root, 'scripts/generate-plugin-thin-index.ps1'),
        'param($PluginPath,$ProjectRoot,$ContextRoot,$CapabilityRoot,$Mode,[switch]$Remove)\n' + generatorBody + '\n');
    for (const directory of ['agents', 'workflows', 'docs']) {
        fs.mkdirSync(path.join(root, directory));
        fs.writeFileSync(path.join(root, directory, directory === 'docs' ? 'README.md' : directory.slice(0, -1) + '-registry.md'), '# Fixture\n');
    }
    fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Fixture project\n');
    const base = ['agent-context-kit', 'agent-framework-evolution'];
    const plugins = [...base.map(name => ({ name })),
        { name: 'feature-core' },
        { name: 'feature-ui', dependencies: ['feature-core'], runtimeResources: ['vendor/ui-runtime'] },
        { name: 'feature-extra' }, { name: 'feature-unused' }].map(definition => {
        const owner = path.join(root, 'plugins', definition.name), manifest = { version: '1.0.0', entry: 'AGENTS.md', ...definition };
        fs.mkdirSync(path.join(owner, '.agents-plugin'), { recursive: true });
        fs.writeFileSync(path.join(owner, '.agents-plugin/plugin.json'), JSON.stringify(manifest));
        fs.writeFileSync(path.join(owner, 'AGENTS.md'), '# Fixture owner\n');
        if (definition.name === 'feature-extra') {
            fs.mkdirSync(path.join(owner, 'skills/feature-extra'), { recursive: true });
            fs.writeFileSync(path.join(owner, 'skills/feature-extra/SKILL.md'), '---\nname: feature-extra\ndescription: Fixture\n---\n# Extra\n');
        }
        return { directory: definition.name, manifest, manifestHash: require('node:crypto').createHash('sha256').update(JSON.stringify(manifest)).digest('hex') };
    });
    fs.mkdirSync(path.join(root, 'vendor/ui-runtime'), { recursive: true });
    fs.writeFileSync(path.join(root, 'vendor/ui-runtime/asset.txt'), 'historical resource\n');
    fs.writeFileSync(path.join(root, 'scripts/lib/plugin-catalog.json'), JSON.stringify({ schema: 'plugin-catalog/v1', basePlugins: base, groups: [], plugins }));
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'fixture']);
    if (mode === 'workspace-overlay') {
        const backend = path.join(project, 'backend');
        fs.mkdirSync(backend);
        git(backend, ['init', '-q']);
        fs.writeFileSync(path.join(contextRoot, 'capability.json'), JSON.stringify({ schemaVersion: 1, mode,
            workspace: 'fixture', contextRoot: '.agents', capabilityRoot: root, sharedDirectories: [], localDirectories: ['config'],
            sourceRoots: [{ name: 'backend', path: 'backend', target: backend, gitRoot: backend }] }));
    }
    fs.mkdirSync(path.join(contextRoot, 'config'), { recursive: true });
    fs.writeFileSync(path.join(contextRoot, 'config/plugin-deployment.json'), JSON.stringify({ schema: 'plugin-deployment/v1', mode: 'on-demand', autoInstall: false }));
    const required = [...base, 'feature-core', 'feature-ui'];
    deployment.atomicJson(deployment.statePath(root), { schema: 'plugin-installation/v1', mode: 'on-demand', phase: 'ready',
        members: [{ contextRoot, lastRequired: required }], installed: [...required, 'feature-extra', 'feature-unused'] });
    return { project, root, contextRoot, profileFile: path.join(contextRoot, 'config/plugin_profile.md'),
        context: { mode, workspaceRoot: project, contextRoot, capabilityRoot: root } };
}

for (const shell of shells) {
    test(shell + ': ordinary updater preserves profile bytes on generic conflicts and unknown generation output', t => {
        for (const unknown of [false, true]) {
            const f = fixture(t, 'standard', unknown ? { generatorBody: 'Write-Output "unrecognized discovery output"' } : {});
            fs.writeFileSync(f.profileFile, '| feature-extra | enabled | - | - | keep this profile verbatim |\n');
            const before = fs.readFileSync(f.profileFile);
            const target = path.join(f.contextRoot, 'skills/feature-extra');
            if (!unknown) {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, 'project-owned conflict\n');
            }
            const result = run(shell, f, 'update-agents.ps1', ['-Mode', 'Write', '-NoPull', '-Detailed']);
            assert.notEqual(result.status, 0, result.stdout + result.stderr);
            assert.match(result.stderr, /Plugin thin-index verification incomplete/);
            assert.deepEqual(fs.readFileSync(f.profileFile), before);
            if (!unknown) assert.equal(fs.readFileSync(target, 'utf8'), 'project-owned conflict\n');
        }
    });
}
function run(shell, f, script, args) {
    const env = { ...process.env };
    // PS5.1 must discover its own built-in modules rather than inherit PS7-only paths.
    if (shell === 'powershell.exe') delete env.PSModulePath;
    return spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(f.root, 'scripts', script),
        '-ProjectRoot', f.project, ...args], { env, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
}
function success(result) { assert.equal(result.status, 0, result.stdout + '\n' + result.stderr); }

for (const shell of shells) for (const mode of ['standard', 'workspace-overlay']) {
    test(shell + ' ' + mode + ': ensure, real enablement, ordinary update and prune preserve missing history automatically', t => {
        const f = fixture(t, mode);
        const options = { action: 'ensure', plugins: ['feature-extra'], members: [], explicit: true };
        cli.apply(f.context, options);
        assert.equal(fs.existsSync(f.profileFile), false);
        success(run(shell, f, 'update-plugin-profile.ps1', ['-ContextRoot', f.contextRoot, '-CapabilityRoot', f.root, '-Plugin', 'feature-extra', '-Status', 'enabled']));
        let statuses = deployment.profile(f.contextRoot);
        assert.equal(statuses.get('feature-extra'), 'enabled');
        assert.equal(statuses.has('feature-ui'), false);
        assert.equal(statuses.has('feature-core'), false);
        assert.ok(fs.existsSync(path.join(f.contextRoot, 'skills/feature-extra/SKILL.md')));
        fs.appendFileSync(f.profileFile, '| `FEATURE-CORE` | disabled | - | - | quoted explicit choice |\n');
        success(run(shell, f, 'update-agents.ps1', ['-Mode', 'Write', '-NoPull', '-Detailed']));
        statuses = deployment.profile(f.contextRoot);
        assert.equal(statuses.has('feature-ui'), false);
        assert.equal(statuses.get('feature-core'), 'disabled');
        assert.match(fs.readFileSync(f.profileFile, 'utf8'), /quoted explicit choice/);
        assert.equal(statuses.get('feature-extra'), 'enabled');
        const plan = deployment.plan(f.context, [], 'prune');
        assert.deepEqual(plan.offlineMembers, []);
        assert.ok(!plan.remove.includes('feature-ui'));
        assert.ok(plan.remove.includes('feature-unused'));
        cli.apply(f.context, { action: 'prune', plugins: [], members: [], execute: true });
        assert.ok(fs.existsSync(path.join(f.root, 'plugins/feature-ui/AGENTS.md')));
        assert.ok(fs.existsSync(path.join(f.root, 'vendor/ui-runtime/asset.txt')));
        assert.ok(!fs.existsSync(path.join(f.root, 'plugins/feature-unused')));
        success(run(shell, f, 'update-plugin-profile.ps1', ['-ContextRoot', f.contextRoot, '-CapabilityRoot', f.root, '-Plugin', 'feature-core', '-Status', 'disabled']));
        cli.apply(f.context, options);
        assert.equal(deployment.profile(f.contextRoot).get('feature-core'), 'disabled');
        assert.equal(deployment.profile(f.contextRoot).has('feature-ui'), false);
        assert.ok(!deployment.plan(f.context, [], 'prune').remove.includes('feature-ui'));
        success(run(shell, f, 'update-plugin-profile.ps1', ['-ContextRoot', f.contextRoot, '-CapabilityRoot', f.root, '-Plugin', 'feature-ui', '-Status', 'available']));
        const explicit = deployment.plan(f.context, [], 'prune');
        assert.ok(explicit.remove.includes('feature-ui'));
        assert.ok(explicit.remove.includes('feature-core'));
        assert.equal(deployment.profile(f.contextRoot).get('feature-ui'), 'available');
    });
}
