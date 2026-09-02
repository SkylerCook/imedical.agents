'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('i18n page translation seed uses one canonical default with project override', () => {
  const manifest = JSON.parse(read('plugins/i18n-iris-plugin/.agents-plugin/plugin.json'));
  const template = read('plugins/i18n-iris-plugin/templates/i18n_project_profile.template.md');
  const rule = read('plugins/i18n-iris-plugin/rules/i18n_page_translation_seed.md');
  const seedSkill = read('plugins/i18n-iris-plugin/skills/i18n-page-trans-seed/SKILL.md');
  const initSkill = read('plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md');
  const syncSkill = read('plugins/i18n-iris-plugin/skills/i18n-csp-trans-sync/SKILL.md');
  const readme = read('plugins/i18n-iris-plugin/README.md');
  const classTemplate = read('plugins/i18n-iris-plugin/templates/DHCDoc/I18n/PageTranslationSeed.cls');

  assert.equal(manifest.version, '0.1.4');
  for (const content of [template, rule, seedSkill, initSkill, syncSkill, readme]) {
    assert.match(content, /DHCDoc\.I18n\.PageTranslationSeed/);
    assert.match(content, /DHCDoc\/I18n\/PageTranslationSeed\.cls/);
  }

  assert.doesNotMatch(template, /Package\.UploadPageTrans\.cls/);
  assert.match(template, /SetPageTrans\(languageCode,page,item,translation\)/);
  assert.match(template, /KillPageTrans\(languageCode,page,item\)/);
  assert.match(template, /Load\{LANG\}Translation\(\)/);
  assert.match(template, /Kill\{LANG\}Translation\(\)/);
  assert.match(readme, /profile 覆盖/);
  assert.match(readme, /字典翻译 SQL 或 XML 模板同步/);
  assert.match(readme, /不授权上传、编译或加载翻译/);
  assert.match(classTemplate, /Class DHCDoc\.I18n\.PageTranslationSeed Extends DHCDoc\.Util\.RegisteredObject/);
  assert.match(classTemplate, /ClassMethod SetPageTrans\(languageCode As %String, page As %String, item As %String, translation As %String\) As %Status/);
  assert.match(classTemplate, /ClassMethod KillPageTrans\(languageCode As %String, page As %String, item As %String\) As %Status/);
  assert.match(classTemplate, /page translation conflict/);
  assert.match(classTemplate, /k \^websys\.TranslationD\("PAGE",languageId,page,item\)/);
  assert.doesNotMatch(classTemplate, /k \^websys\.TranslationD\("PAGE",languageId\)\s*$/m);
});
