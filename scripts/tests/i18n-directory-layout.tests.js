'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');
const plugin = path.join(repo, 'plugins/i18n-iris-plugin');
const resolverFile = path.join(plugin, 'scripts/resolve-project-directory.js');
const { resolveI18nDirectories, readProfile } = require(resolverFile);
const declaration = JSON.parse(fs.readFileSync(path.join(plugin, '.agents-plugin/plugin.json'), 'utf8'));
const psScript = path.join(plugin, 'scripts/sync-xml-print-template.ps1');
function put(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); }
function fixture(t, overlay = false) {
  const parent = path.resolve(process.env.IMEDICAL_TEST_TMP || os.tmpdir());
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, 'i18n-directory-'));
  t.after(() => { assert.equal(path.dirname(base), parent); assert.ok(!fs.lstatSync(base).isSymbolicLink()); fs.rmSync(base, { recursive: true, force: true }); });
  const project = path.join(base, 'project'), context = path.join(project, '.agents');
  fs.mkdirSync(path.join(context, 'config'), { recursive: true });
  const capability = overlay ? path.join(base, 'capability') : context;
  put(path.join(capability, 'plugins/i18n-iris-plugin/.agents-plugin/plugin.json'), declaration);
  put(path.join(context, 'config/plugin_profile.md'), '| plugin | status |\n|---|---|\n| i18n-iris-plugin | enabled |\n');
  if (overlay) {
    const source = path.join(base, 'source'); fs.mkdirSync(source); fs.mkdirSync(path.join(capability, '.git'));
    fs.symlinkSync(source, path.join(project, 'backend'), process.platform === 'win32' ? 'junction' : 'dir');
    put(path.join(context, 'capability.json'), { schemaVersion: 1, mode: 'workspace-overlay', workspace: 'fixture', contextRoot: '.agents', capabilityRoot: capability, sharedDirectories: [], localDirectories: ['config'], sourceRoots: [{ name: 'backend', path: 'backend', target: source, gitRoot: source }] });
  }
  const config = enabled => put(path.join(context, 'config/documentation-layout.json'), { schema: 'imedical-documentation-layout/v1', enabled, workspaceRoot: project, extensions: [] });
  return { base, project, context, capability, config, profile: path.join(context, 'config/i18n_project_profile.md') };
}
function snapshot(root) {
  const result = [];
  function scan(dir) { for (const name of fs.readdirSync(dir).sort()) { const file = path.join(dir, name), stat = fs.lstatSync(file); if (stat.isSymbolicLink()) result.push([path.relative(root, file), fs.readlinkSync(file)]); else if (stat.isDirectory()) scan(file); else result.push([path.relative(root, file), fs.readFileSync(file).toString('base64')]); } }
  scan(root); return result;
}
test('legacy and disabled projects retain XML, terms and CSP defaults without file mutation', t => {
  const f = fixture(t);
  put(path.join(f.project, 'docs/xmlPrintTemp/Existing-EN.txt'), '<xml/>');
  for (const enabled of [undefined, false]) {
    if (enabled !== undefined) f.config(enabled);
    const before = snapshot(f.base);
    assert.deepEqual(resolveI18nDirectories(f.project), { referencesDir: path.join(f.project, 'references/xmlPrintTemp'), outputDir: path.join(f.project, 'docs/xmlPrintTemp') });
    assert.equal(resolveI18nDirectories(f.project, { kind: 'terms' }).path, path.join(f.project, 'docs'));
    assert.equal(resolveI18nDirectories(f.project, { kind: 'csp-backups' }).path, path.join(f.project, 'docs/i18n-csp-trans-sync/backups'));
    assert.deepEqual(snapshot(f.base), before);
  }
});
test('enabled projects resolve all declared i18n outputs but create no artifacts', t => {
  const f = fixture(t); f.config(true); const before = snapshot(f.base);
  assert.deepEqual(resolveI18nDirectories(f.project), { referencesDir: path.join(f.project, 'docs/delivery/print-templates/source'), outputDir: path.join(f.project, 'docs/delivery/print-templates') });
  assert.equal(resolveI18nDirectories(f.project, { kind: 'terms' }).path, path.join(f.project, 'docs/delivery/i18n/terms'));
  assert.equal(resolveI18nDirectories(f.project, { kind: 'csp-backups' }).path, path.join(f.project, 'docs/delivery/i18n/csp-trans-sync/backups'));
  assert.deepEqual(snapshot(f.base), before);
});
test('valid profile and per-call overrides preserve object paths and old CSP backup choice', t => {
  const f = fixture(t); f.config(true);
  put(f.profile, '- xmlPrintReferencesDir: '+String.fromCharCode(96)+'private originals'+String.fromCharCode(96)+'\n- xmlPrintOutputDir: docs/delivery/print-templates/ReportA\n- i18nTermsDir: docs/custom-terms\n## CSP 翻译同步配置\n- 备份目录：'+String.fromCharCode(96)+'docs/old-recovery'+String.fromCharCode(96)+'。\n');
  assert.deepEqual(resolveI18nDirectories(f.project), { referencesDir: path.join(f.project, 'private originals'), outputDir: path.join(f.project, 'docs/delivery/print-templates/ReportA') });
  assert.equal(resolveI18nDirectories(f.project, { outputDir: 'custom-output' }).outputDir, path.join(f.project, 'custom-output'));
  assert.equal(resolveI18nDirectories(f.project, { referencesDir: 'references/xmlPrintTemp', outputDir: 'docs/xmlPrintTemp' }).outputDir, path.join(f.project, 'docs/xmlPrintTemp'));
  assert.equal(resolveI18nDirectories(f.project, { kind: 'terms' }).path, path.join(f.project, 'docs/custom-terms'));
  assert.equal(resolveI18nDirectories(f.project, { kind: 'csp-backups' }).path, path.join(f.project, 'docs/old-recovery'));
});
test('profile examples and unrelated backup sections do not become overrides; conflicting keys stop', t => {
  const f = fixture(t); f.config(true);
  put(f.profile, '<!--\n- xmlPrintOutputDir: ignored\n-->\n'+String.fromCharCode(96).repeat(3)+'text\n- xmlPrintOutputDir: ignored-too\n'+String.fromCharCode(96).repeat(3)+'\n## Other\n- 备份目录：wrong\n');
  assert.deepEqual(readProfile(f.profile), {});
  assert.equal(resolveI18nDirectories(f.project).outputDir, path.join(f.project, 'docs/delivery/print-templates'));
  put(f.profile, '- xmlPrintOutputDir: first\n- OutputDir: second\n');
  assert.throws(() => resolveI18nDirectories(f.project), /Conflicting i18n profile/);
});
test('new profile template resolves defaults instead of turning prose into a path', t => {
  const f = fixture(t); f.config(true); put(f.profile, fs.readFileSync(path.join(plugin, 'templates/i18n_project_profile.template.md'), 'utf8'));
  assert.deepEqual(readProfile(f.profile), {});
  assert.equal(resolveI18nDirectories(f.project, { kind: 'csp-backups' }).path, path.join(f.project, 'docs/delivery/i18n/csp-trans-sync/backups'));
});
test('Overlay resolves module outputs using shared owner declarations without modifying shared capability', t => {
  const f = fixture(t, true); f.config(true); const before = snapshot(f.capability);
  assert.equal(resolveI18nDirectories(f.project).outputDir, path.join(f.project, 'docs/delivery/print-templates'));
  assert.deepEqual(snapshot(f.capability), before);
  assert.equal(fs.existsSync(path.join(f.capability, 'docs')), false);
});
test('enabled governance rejects an unavailable owner instead of silently using legacy defaults', t => {
  const f = fixture(t); f.config(true); put(path.join(f.context, 'config/plugin_profile.md'), '| i18n-iris-plugin | available |\n');
  assert.throws(() => resolveI18nDirectories(f.project), /owner not enabled/);
});
test('CLI emits only resolved JSON and does not create selected directories', t => {
  const f = fixture(t); f.config(true); const result = spawnSync(process.execPath, [resolverFile, 'xml', '--project-root', f.project, '--output-dir', 'docs/custom'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).outputDir, path.join(f.project, 'docs/custom'));
  assert.equal(fs.existsSync(path.join(f.project, 'docs/custom')), false);
});
for (const engine of process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh']) {
  test('XML directory argument wiring works offline in '+engine, t => {
    const probe = spawnSync(engine, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    if (probe.error?.code === 'ENOENT') { t.skip('PowerShell host unavailable'); return; }
    assert.equal(probe.status, 0, probe.stderr);
    const f = fixture(t); f.config(true);
    const source = fs.readFileSync(psScript, 'utf8');
    const start = source.indexOf('$directoryResolver ='), end = source.indexOf('$languageDisplayMap = Get-I18nLanguageDisplayMap');
    assert.ok(start > 0 && end > start);
    const block = source.slice(start, end).replace('$PSScriptRoot', "'"+path.dirname(psScript).replaceAll("'", "''")+"'");
    const harness = path.join(f.base, 'directory-wiring.ps1');
    put(harness, '\uFEFFparam([string]$ProjectRoot,[string]$ReferencesDir,[string]$OutputDir)\n$ErrorActionPreference="Stop"\n$projectRootResolved=$ProjectRoot\n$I18nProfilePath=".agents/config/i18n_project_profile.md"\n'+block+'\n[pscustomobject]@{referencesDir=$refDir;outputDir=$outDir} | ConvertTo-Json -Compress\n');
    for (const explicit of [false, true]) {
      const args = ['-NoProfile','-File',harness,'-ProjectRoot',f.project];
      if (explicit) args.push('-ReferencesDir','references/xmlPrintTemp','-OutputDir','docs/xmlPrintTemp');
      const result = spawnSync(engine,args,{encoding:'utf8'});assert.equal(result.status,0,result.stderr+result.stdout);
      assert.deepEqual(JSON.parse(result.stdout.trim()), resolveI18nDirectories(f.project, explicit ? { referencesDir: 'references/xmlPrintTemp', outputDir: 'docs/xmlPrintTemp' } : {}));
    }
  });
}
