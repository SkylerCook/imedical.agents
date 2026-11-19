'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTempDirectory, ownsTempDirectory } = require('./fixtures/temp-directory');
const repo = path.resolve(__dirname, '../..');
const shells = process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh'];
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function fixture(t) {
    const project = createTempDirectory('plugin-thin-index-scope-');
    t.after(() => {
        assert.ok(ownsTempDirectory(project));
        fs.rmSync(project, { recursive: true });
        assert.equal(fs.existsSync(project), false);
    });
    const root = path.join(project, '.agents');
    const owner = name => path.join(root, 'plugins', name);
    const manifest = (name, extra = {}) => write(path.join(owner(name), '.agents-plugin/plugin.json'), JSON.stringify({ name, version: '1.0.0', ...extra }));
    const source = (name, kind, entry) => path.join(owner(name), kind === 'skill' ? 'skills/' + entry + '/SKILL.md' : 'rules/' + entry + '.md');
    const target = (kind, entry) => path.join(root, kind === 'skill' ? 'skills/' + entry + '/SKILL.md' : 'rules/' + entry + '.md');
    for (const name of ['selected', 'other']) {
        manifest(name);
        for (const kind of ['skill', 'rule']) write(source(name, kind, name + '-' + kind), '---\nname: ' + name + '-' + kind + '\ndescription: source\n---\n# Source\n');
    }
    return { project, root, owner, manifest, source, target };
}
function ps(shell, script, args) {
    const env = { ...process.env };
    if (/^powershell(?:\.exe)?$/i.test(shell)) for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
    const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'scripts', script), ...args], { encoding: 'utf8', env, timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    return result.stdout;
}
function generate(shell, f, owner, mode = 'Write') {
    return ps(shell, 'generate-plugin-thin-index.ps1', ['-ProjectRoot', f.project, '-ContextRoot', f.root, '-CapabilityRoot', f.root, '-PluginPath', f.owner(owner), '-Mode', mode]);
}
const metadata = (source, extra = '', body = '') => '---\nname: retired\nthin-index: true\nsource: ' + source + '\n' + extra + '---\n' + body;

for (const shell of shells) {
    test(shell + ': one owner preserves other managed and customized skill/rule entries whether their sources exist or not', t => {
        for (const sourceExists of [true, false]) {
            const f = fixture(t);
            generate(shell, f, 'other');
            const saved = new Map();
            for (const kind of ['skill', 'rule']) {
                const managed = f.target(kind, 'other-' + kind);
                saved.set(managed, fs.readFileSync(managed));
                const custom = f.target(kind, 'other-custom-' + kind);
                write(custom, fs.readFileSync(managed, 'utf8') + '\nProject customization');
                saved.set(custom, fs.readFileSync(custom));
                if (!sourceExists) fs.rmSync(path.join(f.owner('other'), kind === 'skill' ? 'skills' : 'rules'), { recursive: true });
            }
            const preview = generate(shell, f, 'selected', 'DryRun');
            assert.ok(!preview.includes('other-custom'));
            generate(shell, f, 'selected');
            for (const [file, before] of saved) assert.deepEqual(fs.readFileSync(file), before);
            assert.ok(fs.existsSync(f.target('skill', 'selected-skill')));
            assert.ok(fs.existsSync(f.target('rule', 'selected-rule')));
        }
    });

    test(shell + ': source absence alone never retires the selected owner skill or rule', t => {
        const f = fixture(t);
        generate(shell, f, 'selected');
        const saved = new Map();
        for (const kind of ['skill', 'rule']) {
            saved.set(f.target(kind, 'selected-' + kind), fs.readFileSync(f.target(kind, 'selected-' + kind)));
            fs.unlinkSync(f.source('selected', kind, 'selected-' + kind));
        }
        generate(shell, f, 'selected');
        for (const [file, before] of saved) assert.deepEqual(fs.readFileSync(file), before);
    });

    test(shell + ': explicit legacy owner cleanup only removes known unmodified indexes', t => {
        const f = fixture(t);
        f.manifest('selected', { legacyNames: ['selected-old'] });
        const removed = [];
        const preserved = new Map();
        f.manifest('selected-old');
        for (const kind of ['skill', 'rule']) write(f.source('selected-old', kind, 'old-' + kind), '---\nname: old-' + kind + '\ndescription: generated legacy entry\n' + (kind === 'rule' ? 'task-affinity: [legacy]\n' : '') + '---\n# Source\n');
        generate(shell, f, 'selected-old');
        for (const kind of ['skill', 'rule']) {
            const file = f.target(kind, 'old-' + kind);
            removed.push(file);
            const custom = f.target(kind, 'custom-generated-' + kind);
            write(custom, fs.readFileSync(file, 'utf8') + '\nProject customization');
            preserved.set(custom, fs.readFileSync(custom));
        }
        for (const kind of ['skill', 'rule']) {
            const logical = '.agents/plugins/selected-old/' + (kind === 'skill' ? 'skills/retired/SKILL.md' : 'rules/retired.md');
            const managed = f.target(kind, 'retired-' + kind);
            write(managed, metadata(logical));
            removed.push(managed);
            for (const [label, content] of [['body', metadata(logical, '', '\nProject customization')], ['field', metadata(logical, 'custom: preserve\n')], ['owner', metadata(logical.replace('selected-old', 'other-old'))]]) {
                const file = f.target(kind, 'retired-' + kind + '-' + label);
                write(file, content); preserved.set(file, fs.readFileSync(file));
            }
        }
        assert.match(generate(shell, f, 'selected', 'DryRun'), /explicit owner migration/);
        for (const file of removed) assert.ok(fs.existsSync(file));
        generate(shell, f, 'selected');
        for (const file of removed) assert.ok(!fs.existsSync(file));
        for (const [file, before] of preserved) assert.deepEqual(fs.readFileSync(file), before);
    });

    test(shell + ': excluded init removes known generated and legacy indexes but preserves custom body and fields', t => {
        const f = fixture(t), name = 'selected-init';
        write(f.source('selected', 'skill', name), '---\nname: selected-init\ndescription: initialization\n---\n# Init\n');
        generate(shell, f, 'selected');
        const target = f.target('skill', name), generated = fs.readFileSync(target, 'utf8');
        f.manifest('selected', { thinIndex: { excludeSkills: [name] } });
        assert.match(generate(shell, f, 'selected', 'DryRun'), /excluded managed plugin skill thin-index/);
        assert.equal(fs.readFileSync(target, 'utf8'), generated);
        generate(shell, f, 'selected');
        assert.ok(!fs.existsSync(path.dirname(target)));
        const logical = '.agents/plugins/selected/skills/' + name + '/SKILL.md';
        for (const managed of [metadata(logical), generated]) {
            write(target, managed); generate(shell, f, 'selected'); assert.ok(!fs.existsSync(target));
        }
        for (const custom of [generated + '\nProject customization', metadata(logical, '', 'Project customization'), metadata(logical, 'custom: preserve\n')]) {
            write(target, custom); generate(shell, f, 'selected'); assert.equal(fs.readFileSync(target, 'utf8'), custom);
        }
    });

    test(shell + ': unrelated and excluded-init directory links are preserved', t => {
        const f = fixture(t), outside = path.join(f.project, 'linked-data');
        write(path.join(outside, 'SKILL.md'), metadata('.agents/plugins/selected-old/skills/old/SKILL.md'));
        const otherLink = path.join(f.root, 'skills/other-link');
        fs.mkdirSync(path.dirname(otherLink), { recursive: true });
        fs.symlinkSync(outside, otherLink, process.platform === 'win32' ? 'junction' : 'dir');
        const init = 'selected-init';
        write(f.source('selected', 'skill', init), '# Init');
        f.manifest('selected', { legacyNames: ['selected-old'], thinIndex: { excludeSkills: [init] } });
        const initLink = path.dirname(f.target('skill', init));
        fs.symlinkSync(outside, initLink, process.platform === 'win32' ? 'junction' : 'dir');
        const before = fs.readFileSync(path.join(outside, 'SKILL.md'));
        generate(shell, f, 'selected');
        assert.ok(fs.lstatSync(otherLink).isSymbolicLink());
        assert.ok(fs.lstatSync(initLink).isSymbolicLink());
        assert.deepEqual(fs.readFileSync(path.join(outside, 'SKILL.md')), before);

        const linkedRoot = fixture(t);
        write(linkedRoot.source('selected', 'skill', init), '# Init');
        linkedRoot.manifest('selected', { thinIndex: { excludeSkills: [init] } });
        const rootIndex = linkedRoot.target('skill', init);
        write(rootIndex, metadata('.agents/plugins/selected/skills/' + init + '/SKILL.md'));
        const original = fs.readFileSync(rootIndex);
        const physical = path.join(linkedRoot.project, 'context-target');
        fs.renameSync(linkedRoot.root, physical);
        fs.symlinkSync(physical, linkedRoot.root, process.platform === 'win32' ? 'junction' : 'dir');
        generate(shell, linkedRoot, 'selected');
        assert.ok(fs.lstatSync(linkedRoot.root).isSymbolicLink());
        assert.deepEqual(fs.readFileSync(rootIndex), original);
    });

    test(shell + ': actual on-demand enablement preserves unrelated customized rule and skill indexes', t => {
        const f = fixture(t);
        generate(shell, f, 'other');
        const saved = new Map();
        for (const kind of ['skill', 'rule']) {
            const file = f.target(kind, 'other-' + kind);
            fs.appendFileSync(file, '\nProject customization'); saved.set(file, fs.readFileSync(file));
            fs.rmSync(path.join(f.owner('other'), kind === 'skill' ? 'skills' : 'rules'), { recursive: true });
        }
        write(path.join(f.root, 'config/plugin-deployment.json'), JSON.stringify({ schema: 'plugin-deployment/v1', mode: 'on-demand', autoInstall: false }));
        write(path.join(f.root, 'config/plugin_profile.md'), '| selected | available | - | - | fixture |\n| other | available | - | - | fixture |\n');
        ps(shell, 'update-plugin-profile.ps1', ['-ProjectRoot', f.project, '-ContextRoot', f.root, '-CapabilityRoot', f.root, '-Plugin', 'selected', '-Status', 'enabled']);
        assert.equal(require('../lib/project-plugin-profile').read(f.root).entries.selected.status,'enabled');
        assert.ok(fs.existsSync(f.target('skill', 'selected-skill')));
        assert.ok(fs.existsSync(f.target('rule', 'selected-rule')));
        for (const [file, before] of saved) assert.deepEqual(fs.readFileSync(file), before);
    });
}
