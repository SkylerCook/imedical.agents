'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { audit } = require('../../plugins/iris-imedical-doctor-ai/scripts/audit-card-metadata.js');
const entry = (action, persist = 'data') => ({ file: action, source: `class Card { static ACTION_CODE = '${action}'; static PERSIST = '${persist}'; }` });

test('accepts supported persistence policies and unique actions', () => {
    const entries = ['data', 'always', 'adopted', 'adopted+data'].map((p, i) => entry(`A${i}`, p));
    assert.equal(audit(entries).status, 'checked');
});
test('reports duplicate actions without freezing persistence policy', () => {
    assert.equal(audit([entry('A'), entry('A')]).findings[0].code, 'duplicate-action');
    assert.equal(audit([entry('B', 'new-policy')]).status, 'checked');
});
test('does not infer dynamic metadata or accept partial literals', () => {
    for (const value of ["getCode()", "'A' + suffix", "`A`", "'\\u0041'"]) {
        assert.equal(audit([{ file: 'dynamic', source: `class C { static ACTION_CODE = ${value}; static PERSIST = 'data'; }` }]).status, 'incomplete');
    }
});
test('ignores metadata examples inside comments and strings', () => {
    const sample = entry('A');
    sample.source += `\n// static ACTION_CODE = 'fake';\n/* static PERSIST = 'bad'; */\nconst example = "static ACTION_CODE = 'fake';";`;
    assert.equal(audit([sample]).status, 'checked');
});
test('missing input and malformed source cannot pass', () => {
    assert.equal(audit([]).status, 'incomplete');
    assert.equal(audit([{ file: 'broken', source: '/*' }]).status, 'incomplete');
});
test('business source is never executed', () => {
    const sample = entry('A'); sample.source += '\nthrow new Error("must not run");';
    assert.equal(audit([sample]).status, 'checked');
});


const os = require('node:os');
const { spawnSync } = require('node:child_process');
for (const shell of (process.platform === 'win32' ? ['pwsh.exe', 'powershell.exe'] : [])) {
    test(`thin-index DryRun, Write and repeat preserve state (${shell})`, () => {
        const tempBase = path.join(os.tmpdir(), 'codex');
        fs.mkdirSync(tempBase, { recursive: true });
        const root = fs.mkdtempSync(path.join(tempBase, 'ai-workstation-test-'));
        const capability = path.resolve(__dirname, '../..');
        const wrapper = path.join(capability, 'plugins/iris-imedical-doctor-ai/scripts/generate-plugin-thin-index.ps1');
        const context = path.join(root, '.agents');
        const run = mode => {
            const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper,
                '-ProjectRoot', root, '-ContextRoot', context, '-CapabilityRoot', capability, '-Mode', mode], { encoding: 'utf8', timeout: 30000 });
            assert.equal(result.status, 0, result.stderr || result.error?.message);
        };
        try {
            run('DryRun');
            assert.equal(fs.existsSync(context), false);
            run('Write');
            const skills = ['iris-imedical-doctor-ai'];
            assert.equal(fs.existsSync(path.join(context, 'skills/iris-imedical-doctor-ai-init/SKILL.md')), false);
            const files = skills.map(name => path.join(context, 'skills', name, 'SKILL.md'));
            const before = files.map(file => fs.readFileSync(file, 'utf8'));
            before.forEach((text, i) => {
                assert.match(text, /thin-index: true/);
                const source = /^source: (.+)$/m.exec(text)[1].trim();
                assert.equal(fs.existsSync(path.resolve(capability, source.replace(/^\.agents\//, ""))), true, source);
                assert.match(text, new RegExp(skills[i]));
            });
            run('Write');
            assert.deepEqual(files.map(file => fs.readFileSync(file, 'utf8')), before);
        } finally {
            assert.equal(path.dirname(root), tempBase);
            fs.rmSync(root, { recursive: true, force: true });
            assert.equal(fs.existsSync(root), false);
        }
    });
}

test('regex-like source is incomplete instead of inventing metadata', () => {
    assert.equal(audit([{ file: 'regex', source: "const example = /static ACTION_CODE = 'A'; static PERSIST = 'data';/;" }]).status, 'incomplete');
});

test('nested template strings cannot inject fake metadata', () => {
    const sample = entry('A');
    sample.source += '\nconst html = `<div>${flag ? `<span>${"static ACTION_CODE = fake;"}</span>` : ""}</div>`;';
    assert.equal(audit([sample]).status, 'checked');
    assert.equal(audit([sample]).cards[0].ACTION_CODE, 'A');
});
