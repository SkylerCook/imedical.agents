'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
test('new runtime files materialize under deployed sparse patterns; source-only dependencies do not', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'night-sparse-'));
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    const deployed = ['scripts/run-acceptance.js', 'scripts/lib/night-contract.js', 'scripts/lib/night-execution.js', 'scripts/lib/playwright-runner.js', 'scripts/lib/test-session.js', 'scripts/lib/test-evidence.js', 'workflows/bos-demand-unattended.workflow.md', 'docs/night-acceptance.md'];
    const sourceOnly = ['maintenance/testing/playwright/package-lock.json', 'scripts/tests/playwright-runner.tests.js'];
    const files = [...deployed, ...sourceOnly];
    try {
        git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'core.hooksPath', path.join(root, 'no-hooks'));
        for (const file of files) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.copyFileSync(path.join(repo, file), path.join(root, file)); }
        git('add', '.'); git('commit', '-qm', 'fixture');
        git('sparse-checkout', 'set', '--no-cone', '/scripts/*.js', '/scripts/lib/**', '/workflows/**', '/docs/**');
        for (const file of deployed) assert(fs.existsSync(path.join(root, file)), file);
        for (const file of sourceOnly) assert(!fs.existsSync(path.join(root, file)), file);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
