'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {createTempDirectory, ownsTempDirectory} = require('./fixtures/temp-directory');
const runtime = require('../../tools/ai-dev-offline/operation-runtime');
const runtimePath = require.resolve('../../tools/ai-dev-offline/operation-runtime');
function fixture(t) {
  const root = createTempDirectory('ai-dev-runtime-');
  t.after(() => {assert.ok(ownsTempDirectory(root)); fs.rmSync(root, {recursive: true, force: true});});
  return root;
}
test('OS lock serializes callers and reclaims the legacy marker', async t => {
  const root = fixture(t), order = [];
  const marker = path.join(root, '.ai-dev-config.lock'); fs.writeFileSync(marker, '');
  let release;
  const first = runtime.withLock(root, {}, async () => {order.push('first'); await new Promise(resolve => {release = resolve;});}, marker);
  while (!release) await new Promise(resolve => setTimeout(resolve, 10));
  const second = runtime.withLock(root, {}, () => order.push('second'), marker);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(order, ['first']); release(); await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'second']); assert.equal(fs.existsSync(marker), false);
});
test('a killed owner automatically releases the OS lock', async t => {
  const root = fixture(t);
  const child = spawn(process.execPath, ['-e', `require(${JSON.stringify(runtimePath)}).withLock(process.argv[1],{},()=>{process.send('ready');return new Promise(()=>{});});`, root], {stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true});
  t.after(() => {if(child.exitCode === null && child.signalCode === null)child.kill();});
  await once(child, 'message');
  const exited = once(child, 'exit'); child.kill(); await exited;
  let executed = false;
  await runtime.withLock(root, {}, () => {executed = true;});
  assert.equal(executed, true);
});
test('waiting for another operation can be cancelled without entering its critical section', async t => {
  const root = fixture(t), cancelFile = path.join(root, 'cancel');
  let release;
  const owner = runtime.withLock(root, {}, () => new Promise(resolve => {release = resolve;}));
  while (!release) await new Promise(resolve => setTimeout(resolve, 10));
  let executed = false;
  const waiting = runtime.withLock(root, {cancelFile}, () => {executed = true;});
  fs.writeFileSync(cancelFile, 'cancel');
  await assert.rejects(waiting, /取消/); assert.equal(executed, false);
  release(); await owner;
});
