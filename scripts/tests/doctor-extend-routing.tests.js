'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
const owner = 'imedicalxc-doctor-extend-engineer';
const child = 'imedicalxc-doctor-elechealthcard-vendor';
const plugin = path.join(repo, 'plugins', owner);
const wrapper = path.join(plugin, 'scripts/generate-plugin-thin-index.ps1');
const source = `.agents/plugins/${owner}/skills/${child}/SKILL.md`;
const managed = `---\nname: ${child}\nthin-index: true\nsource: ${source}\n---\nGenerated entry\n`;

function fixture(t) {
    const base = path.join(os.tmpdir(), 'codex');
    fs.mkdirSync(base, { recursive: true });
    const root = fs.mkdtempSync(path.join(base, 'doctor-extend-routing-'));
    const copy = path.join(root, '.agents/plugins', owner);
    fs.cpSync(path.join(plugin, 'skills'), path.join(copy, 'skills'), { recursive: true });
    fs.mkdirSync(path.join(copy, '.agents-plugin'));
    fs.copyFileSync(path.join(plugin, '.agents-plugin/plugin.json'), path.join(copy, '.agents-plugin/plugin.json'));
    const target = path.join(root, '.agents/skills', child, 'SKILL.md');
    t.after(() => {
        assert.equal(path.dirname(root), base);
        fs.rmSync(root, { recursive: true, force: true });
        assert.equal(fs.existsSync(root), false);
    });
    return { root, copy, target };
}

function run(shell, f, mode) {
    const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper,
        '-ProjectRoot', f.root, '-PluginPath', f.copy, '-Mode', mode],
    { encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
    return result.stdout;
}

for (const shell of ['powershell.exe', 'pwsh.exe']) {
    const options = { skip: process.platform !== 'win32' };
    test(`wrapper exposes only the orchestrator and remains idempotent (${shell})`, options, t => {
        const f = fixture(t);
        const skills = path.join(f.root, '.agents/skills');
        run(shell, f, 'DryRun');
        assert.equal(fs.existsSync(skills), false);
        run(shell, f, 'Write');
        assert.deepEqual(fs.readdirSync(skills), [owner]);
        const main = path.join(skills, owner, 'SKILL.md');
        const before = fs.readFileSync(main);
        run(shell, f, 'Write');
        assert.deepEqual(fs.readFileSync(main), before);
    });

    test(`excluded managed entry is planned then removed without deleting other files (${shell})`, options, t => {
        const f = fixture(t);
        fs.mkdirSync(path.dirname(f.target), { recursive: true });
        fs.writeFileSync(f.target, managed);
        const extra = path.join(path.dirname(f.target), 'user-notes.md');
        fs.writeFileSync(extra, 'Keep user notes');
        assert.match(run(shell, f, 'DryRun'), /excluded managed plugin skill thin-index/);
        assert.equal(fs.readFileSync(f.target, 'utf8'), managed);
        run(shell, f, 'Write');
        assert.equal(fs.existsSync(f.target), false);
        assert.equal(fs.readFileSync(extra, 'utf8'), 'Keep user notes');
        run(shell, f, 'Write');
        assert.equal(fs.existsSync(f.target), false);
    });

    test(`custom and foreign entries are preserved (${shell})`, options, t => {
        const f = fixture(t);
        fs.mkdirSync(path.dirname(f.target), { recursive: true });
        const texts = [
            '# Custom skill\n',
            managed.replace(source, `.agents/plugins/${owner}/skills/${owner}/SKILL.md`),
            `# User document\nthin-index: true\nsource: ${source}\n`,
            managed.replace('thin-index: true', 'thin-index: false')
        ];
        for (const text of texts) {
            fs.writeFileSync(f.target, text);
            run(shell, f, 'Write');
            assert.equal(fs.readFileSync(f.target, 'utf8'), text);
        }
    });

    test(`excluded entry behind a junction is preserved (${shell})`, options, t => {
        const f = fixture(t);
        const destination = path.join(f.root, 'linked-content');
        fs.mkdirSync(destination);
        fs.writeFileSync(path.join(destination, 'SKILL.md'), managed);
        fs.mkdirSync(path.dirname(path.dirname(f.target)), { recursive: true });
        const link = path.dirname(f.target);
        fs.symlinkSync(destination, link, 'junction');
        try {
            run(shell, f, 'Write');
            assert.equal(fs.readFileSync(path.join(destination, 'SKILL.md'), 'utf8'), managed);
            assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
        } finally {
            fs.unlinkSync(link);
        }
    });

    test(`canonical updater entry consumes manifest policy and removes the old child entry (${shell})`, options, t => {
        const f = fixture(t);
        fs.mkdirSync(path.dirname(f.target), { recursive: true });
        fs.writeFileSync(f.target, managed);
        const invoke = mode => {
            const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                path.join(repo, 'scripts/generate-plugin-thin-index.ps1'), '-PluginPath', f.copy,
                '-ProjectRoot', f.root, '-ContextRoot', path.join(f.root, '.agents'),
                '-CapabilityRoot', path.join(f.root, '.agents'), '-Mode', mode],
            { encoding: 'utf8', timeout: 30000, windowsHide: true });
            assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
            return result.stdout;
        };
        assert.match(invoke('DryRun'), /excluded managed plugin skill thin-index/);
        assert.equal(fs.readFileSync(f.target, 'utf8'), managed);
        invoke('Write');
        assert.equal(fs.existsSync(f.target), false);
        assert.deepEqual(fs.readdirSync(path.join(f.root, '.agents/skills')).sort(), [child, owner].sort());
        invoke('Write');
        assert.equal(fs.existsSync(f.target), false);
    });
}
