'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const python = process.env.SFTP_TEST_PYTHON;
const repo = path.resolve(__dirname, '../../../../..');

function invoke(args, cwd, env) {
    const result = spawnSync(process.execPath, args, {cwd, env, encoding: 'utf8', timeout: 180000, windowsHide: true});
    assert.ifError(result.error);
    return result;
}

function setup(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-cli-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const project = path.join(root, 'project');
    fs.mkdirSync(path.join(project, 'css'), {recursive: true});
    fs.mkdirSync(path.join(project, '.agents/config'), {recursive: true});
    fs.writeFileSync(path.join(project, '.agents/config/project-env.json'), '{}');
    fs.writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({mcpServers: {'sftp-server': {
        command: python, env: {TARGET_HOST: 'example.invalid', TARGET_USERNAME: 'test', REMOTE_PATH: '/web'}
    }}}));
    for (const name of ['a', 'b']) fs.writeFileSync(path.join(project, 'css', name + '.css'), 'new');
    const env = {...process.env, PYTHONPATH: path.join(repo, 'vendor/sftp-server/tests/fixtures'), PYTHONDONTWRITEBYTECODE: '1',
        HOME: root, USERPROFILE: root, GIT_CONFIG_GLOBAL: path.join(root, 'no-global-config'), GIT_CONFIG_NOSYSTEM: '1'};
    const args = [path.join(repo, 'plugins/coding-iris-plugin/scripts/iris-tools/deploy-frontend.js'),
        '--project-root', project, '--source-root', project, '--files', 'css/a.css', 'css/b.css'];
    return {root, project, env, args};
}

test('actual direct CLI uses one worker and one connection for changed/mixed/unchanged batches', {skip: !python}, t => {
    const f = setup(t);
    const planned = invoke(f.args, f.project, f.env);
    assert.equal(planned.status, 0, planned.stdout + planned.stderr);
    assert.equal(JSON.parse(planned.stdout).status, 'planned');
    assert.equal(planned.stderr, '');
    for (let unchanged = 0; unchanged <= 2; unchanged++) {
        const result = invoke([...f.args, '--execute'], f.project, {...f.env, SFTP_TEST_UNCHANGED: String(unchanged)});
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const value = JSON.parse(result.stdout);
        assert.equal(value.status, 'verified');
        assert.equal(value.transport.processes, 1);
        assert.equal(value.transport.counts.connections, 1);
        assert.equal(value.transport.counts.writes, 2 - unchanged);
        assert.equal(value.files.length, 2);
        assert.ok(value.timings.totalMs >= value.timings.uploadVerifyMs);
        assert.ok(result.stderr.includes('final-verify'));
        assert.ok(!result.stderr.includes('example.invalid'));
    }
});

test('actual direct CLI stops later writes on final mismatch', {skip: !python}, t => {
    const f = setup(t);
    const result = invoke([...f.args, '--execute'], f.project, {...f.env, SFTP_TEST_CORRUPT: '1'});
    const value = JSON.parse(result.stdout);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(value.files.map(file => file.status), ['failed', 'not-executed']);
    assert.equal(value.transport.counts.writes, 1);
});

test('actual guarded CLI retains Git baseline checks and uses one persistent session', {skip: !python}, t => {
    const f = setup(t);
    const git = (...args) => {
        const result = spawnSync('git', ['-C', f.project, ...args], {env: f.env, encoding: 'utf8', windowsHide: true, timeout: 60000});
        assert.equal(result.status, 0, result.stderr);
    };
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    for (const name of ['a', 'b']) fs.writeFileSync(path.join(f.project, 'css', name + '.css'), 'old');
    git('add', 'css');
    git('commit', '-m', 'baseline');
    git('clone', '--bare', f.project, path.join(f.root, 'remote.git'));
    git('remote', 'add', 'origin', path.join(f.root, 'remote.git'));
    git('fetch', 'origin');
    git('branch', '--set-upstream-to=origin/main');
    const initialized = invoke([path.join(repo, 'plugins/coding-iris-plugin/scripts/iris-tools/deploy-guard.js'),
        'init', f.project, '123', 'HEAD', '--confirm-baseline'], f.project, f.env);
    assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
    for (const name of ['a', 'b']) fs.writeFileSync(path.join(f.project, 'css', name + '.css'), 'new');
    const result = invoke([...f.args, '--mode', 'guarded', '--demand', '123', '--execute'], f.project, f.env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.status, 'verified');
    assert.equal(value.transport.processes, 1);
    assert.equal(value.transport.counts.connections, 1);
    assert.equal(value.transport.counts.writes, 2);
    assert.deepEqual(value.files.map(file => file.status), ['uploaded', 'uploaded']);
    assert.deepEqual(fs.readdirSync(f.root).filter(name => name.startsWith('iris-deploy-artifacts-')), []);
});
