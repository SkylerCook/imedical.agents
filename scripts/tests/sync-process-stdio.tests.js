'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
function load(file, child, tail) {
  const filename = path.join(root, file), realRequire = createRequire(filename);
  const context = { require: id => /^(node:)?child_process$/.test(id) ? child : id === 'node:fs' && tail.includes('commitRoute =') ? { ...fs, readFileSync: () => '{}' } : realRequire(id),
    module: { exports: {} }, __dirname: path.dirname(filename), process, console, Buffer };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\n' + tail, context, { filename });
  return context.module.exports;
}
const cases = [
  ['plugins/bos-plugin/scripts/bos-code-update-log.js', 'module.exports = git;', f => f(root, ['--version'])],
  ['plugins/demand-delivery-plugin/scripts/commit-demand.js', 'module.exports = runGit;', f => f(root, ['--version'])],
  ['plugins/bos-plugin/scripts/demand-entry.js', 'module.exports = git;', f => f(root, ['--version'])],
  ['plugins/bos-plugin/scripts/personal-config.js', 'module.exports = windowsBinding;', f => f()],
  ['scripts/lib/real-repository-commit.js', 'module.exports = git;', f => f(root, ['--version'])],
  ['plugins/bos-plugin/scripts/demand-entry.js', `commitRoute = () => null; planArguments = () => []; module.exports = main;`, f => f(['plan', '--draft', 'synthetic.json'])],
];
for (const [file, tail, invoke] of cases) test(file + ' ' + tail.slice(0, 24) + ' closes stdin and preserves failure', () => {
  let calls = 0, fail = false;
  function execute(command, args, options) {
    calls++;
    assert.deepEqual(Array.from(options.stdio), ['ignore', 'pipe', 'pipe']);
    assert.equal(options.windowsHide, true);
    return { status: fail ? 128 : 0, stdout: '{}', stderr: fail ? 'synthetic failure' : '' };
  }
  const child = { spawnSync: execute, execFileSync(...args) {
    const result = execute(...args);
    if (result.status) throw Object.assign(new Error(result.stderr), { status: result.status });
    return result.stdout;
  } };
  const fn = load(file, child, tail);
  invoke(fn); fail = true;
  assert.throws(() => invoke(fn));
  assert.equal(calls, 2);
});
for (const [file, tail, invoke] of cases.slice(0, 3)) test(file + ' diagnoses EBUSY without claiming stdin root cause', () => {
  const fn = load(file, { spawnSync: () => ({ error: Object.assign(new Error('spawnSync git EBUSY'), { code: 'EBUSY' }) }) }, tail);
  assert.throws(() => invoke(fn), /EBUSY 不唯一指向 stdin/);
});
