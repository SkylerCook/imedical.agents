'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTempDirectory, ownsTempDirectory } = require('./fixtures/temp-directory');
const { profile } = require('../lib/plugin-deployment');

const repo = path.resolve(__dirname, '../..');
const shells = process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh'];

function fixture(t, plugin = 'bos-plugin', mode = 'on-demand') {
    const project = createTempDirectory('plugin-profile-enablement-');
    t.after(() => { if (ownsTempDirectory(project)) fs.rmSync(project, { recursive: true }); });
    const root = path.join(project, '.agents');
    const owner = path.join(root, 'plugins', plugin);
    fs.cpSync(path.join(repo, 'plugins', plugin), owner, { recursive: true });
    fs.mkdirSync(path.join(root, 'config'));
    fs.writeFileSync(path.join(root, 'config/plugin-deployment.json'), JSON.stringify({ schema: 'plugin-deployment/v1', mode, autoInstall: false }));
    const profileFile = path.join(root, 'config/plugin_profile.md');
    fs.writeFileSync(profileFile, `| ${plugin} | available | - | - | retained note |\n`);
    return { project, root, owner, plugin, profileFile };
}

function run(shell, f, status, { entry = path.join(repo, 'scripts/update-plugin-profile.ps1'), plugin = f.plugin } = {}) {
    return spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', entry,
        '-ProjectRoot', f.project, '-ContextRoot', f.root, '-CapabilityRoot', f.root,
        '-Plugin', plugin, '-Status', status], { encoding: 'utf8', timeout: 30000 });
}
function success(result) { assert.equal(result.status, 0, result.stdout + '\n' + result.stderr); }

for (const shell of shells) {
    test(shell + ': BOS adoption enables and generates discovery, then disables and restores without manual generation', t => {
        const f = fixture(t);
        success(run(shell, f, 'enabled'));
        assert.equal(profile(f.root).get(f.plugin), 'enabled');
        const entry = path.join(f.root, 'skills/bos-demand-query/SKILL.md');
        const bytes = fs.readFileSync(entry);
        assert.match(bytes.toString('utf8'), /plugins\/bos-plugin\/skills\/bos-demand-query\/SKILL.md/);
        assert.ok(!fs.existsSync(path.join(f.root, 'skills/bos-init/SKILL.md')));
        success(run(shell, f, 'enabled'));
        assert.deepEqual(fs.readFileSync(entry), bytes);
        success(run(shell, f, 'disabled'));
        assert.equal(profile(f.root).get(f.plugin), 'disabled');
        assert.ok(!fs.existsSync(entry));
        success(run(shell, f, 'available'));
        success(run(shell, f, 'enabled'));
        assert.equal(profile(f.root).get(f.plugin), 'enabled');
        assert.deepEqual(fs.readFileSync(entry), bytes);
    });

    test(shell + ': UI adoption generates skills and rules while full deployment retains registration-first compatibility', t => {
        const f = fixture(t, 'imedical-ui');
        success(run(shell, f, 'enabled'));
        assert.ok(fs.existsSync(path.join(f.root, 'rules/imedical_ui.md')));
        assert.ok(fs.existsSync(path.join(f.root, 'skills/imedical-ui/SKILL.md')));
        assert.ok(!fs.existsSync(path.join(f.root, 'skills/imedical-ui-init/SKILL.md')));
        const legacy = fixture(t, 'imedical-ui', 'full');
        success(run(shell, legacy, 'enabled'));
        assert.equal(profile(legacy.root).get(legacy.plugin), 'enabled');
        assert.ok(!fs.existsSync(path.join(legacy.root, 'skills/imedical-ui/SKILL.md')));
    });

    test(shell + ': dependencies and custom discovery conflicts stop before generation or profile changes', t => {
        const f = fixture(t, 'imedical-ui');
        const manifestFile = path.join(f.owner, '.agents-plugin/plugin.json');
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        manifest.dependencies = ['test-core'];
        fs.writeFileSync(manifestFile, JSON.stringify(manifest));
        const core = path.join(f.root, 'plugins/test-core/.agents-plugin');
        fs.mkdirSync(core, { recursive: true });
        fs.writeFileSync(path.join(core, 'plugin.json'), JSON.stringify({ name: 'test-core', version: '1.0.0' }));
        const before = fs.readFileSync(f.profileFile);
        const missing = run(shell, f, 'enabled');
        assert.notEqual(missing.status, 0);
        assert.match(missing.stderr, /Initialize required dependency/);
        assert.deepEqual(fs.readFileSync(f.profileFile), before);
        assert.ok(!fs.existsSync(path.join(f.root, 'skills/imedical-ui/SKILL.md')));
        success(run(shell, f, 'enabled', { plugin: 'test-core' }));
        success(run(shell, f, 'enabled'));

        const custom = fixture(t);
        const target = path.join(custom.root, 'skills/bos-demand-query/SKILL.md');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, '# Project customization\n');
        const profileBefore = fs.readFileSync(custom.profileFile);
        const conflict = run(shell, custom, 'enabled');
        assert.notEqual(conflict.status, 0);
        assert.match(conflict.stderr, /Custom discovery entries require review/);
        assert.deepEqual(fs.readFileSync(custom.profileFile), profileBefore);
        assert.equal(fs.readFileSync(target, 'utf8'), '# Project customization\n');
        assert.ok(!fs.existsSync(path.join(custom.root, 'skills/bos-demand-entry/SKILL.md')));
    });

    test(shell + ': missing generator and unsuccessful readback cannot mark the plugin enabled', t => {
        const f = fixture(t);
        const runtime = path.join(f.project, 'runtime');
        fs.mkdirSync(runtime);
        const entry = path.join(runtime, 'update-plugin-profile.ps1');
        fs.copyFileSync(path.join(repo, 'scripts/update-plugin-profile.ps1'), entry);
        const before = fs.readFileSync(f.profileFile);
        const missing = run(shell, f, 'enabled', { entry });
        assert.notEqual(missing.status, 0);
        assert.match(missing.stderr, /discovery generator is missing/);
        assert.deepEqual(fs.readFileSync(f.profileFile), before);
        fs.writeFileSync(path.join(runtime, 'generate-plugin-thin-index.ps1'),
            'param($PluginPath,$ProjectRoot,$ContextRoot,$CapabilityRoot,$Mode)\n[pscustomobject]@{status="generated"} | Format-List\n');
        const unverified = run(shell, f, 'enabled', { entry });
        assert.notEqual(unverified.status, 0);
        assert.match(unverified.stderr, /discovery verification incomplete/);
        assert.deepEqual(fs.readFileSync(f.profileFile), before);
    });
}
