'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function validator(result) {
  const filename = path.resolve(__dirname, '../deploy-guard.js');
  const localRequire = require('node:module').createRequire(filename);
  const module = {exports: {}};
  const mockedRequire = name => name === 'node:child_process'
    ? {spawnSync: () => result} : localRequire(name);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: mockedRequire, module, process, Buffer, console
  }, {filename});
  return () => module.exports.validate('valid.js', 'const ok = 1;', '', '');
}

test('syntax validation distinguishes process failures from syntax errors', () => {
  for (const code of ['EBUSY', 'ENOENT', 'ETIMEDOUT']) {
    assert.throws(validator({status:null, error:{code}, signal:null}), error =>
      error.reason === 'javascript-check-failed' && error.details.code === code);
  }
  assert.throws(validator({status:null, signal:'SIGTERM'}), error =>
    error.reason === 'javascript-check-failed' && error.details.signal === 'SIGTERM');
  assert.throws(validator({status:1}), error => error.reason === 'javascript-syntax-failed');
  assert.doesNotThrow(validator({status:0}));
});
