'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareContract } = require('../../plugins/iris-cure-form-dev/scripts/cure-form-contract-check');
test('layout changes preserve repeated IDs, missing value and historical label mismatch', () => {
  const before = '<input id="x" name="r"><input id="x" name="r" value=""><label for="wrong">Y</label>';
  assert.equal(compareContract(before, '<div class="new">' + before + '</div>').status, 'passed');
  assert.equal(compareContract(before, before.replace('<input id="x" name="r">', '<input id="x" name="r" value="">')).status, 'failed');
  assert.equal(compareContract(before, before.replace('for="wrong"', 'for="x"')).status, 'failed');
});
