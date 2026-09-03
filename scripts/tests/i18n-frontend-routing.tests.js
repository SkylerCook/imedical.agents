'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('unified and direct frontend routes share the conditional i18n gate', () => {
  const unified = read('plugins/coding-iris-plugin/skills/iris-coding/SKILL.md');
  const frontend = read('plugins/coding-iris-plugin/skills/iris-frontend-coding/SKILL.md');
  const rule = read('plugins/coding-iris-plugin/rules/iris_coding_frontend.md');

  for (const content of [unified, frontend, rule]) {
    assert.match(content, /\.agents\/config\/plugin_profile\.md/);
    assert.match(content, /i18n-iris-plugin/);
    assert.match(content, /enabled/);
    assert.match(content, /\$g/);
    assert.match(content, /\$trans/);
    assert.match(content, /i18n_project_profile\.md/);
    assert.match(content, /i18n_coding_frontend\.md/);
  }

  assert.match(rule, /修改前/);
  assert.match(rule, /最终 diff/);
  assert.match(rule, /available/);
  assert.match(rule, /disabled/);
  assert.match(rule, /完整.*i18n.*workflow|完整.*workflow/s);
});

test('i18n frontend rule and skill require the read-only helper checker', () => {
  const skill = read('plugins/i18n-iris-plugin/skills/i18n-coding/SKILL.md');
  const rule = read('plugins/i18n-iris-plugin/rules/i18n_coding_frontend.md');
  const readme = read('plugins/i18n-iris-plugin/README.md');

  for (const content of [skill, rule, readme]) {
    assert.match(content, /check-i18n-helper-usage\.js/);
    assert.match(content, /稳定.*字面量|stable.*literal/i);
  }
  assert.match(rule, /动态翻译 key/);
  assert.match(rule, /占位符参数/);
});

test('plugin manifests remain compatible after the conditional gate release', () => {
  const codingManifest = JSON.parse(read('plugins/coding-iris-plugin/.agents-plugin/plugin.json'));
  const i18nManifest = JSON.parse(read('plugins/i18n-iris-plugin/.agents-plugin/plugin.json'));

  assert.match(codingManifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(i18nManifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(i18nManifest.dependencies.includes('coding-iris-plugin'));
  assert.equal(i18nManifest.dependencyVersions['coding-iris-plugin'].maxVersionExclusive, '0.7.0');
});
