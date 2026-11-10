#!/usr/bin/env node
'use strict';

// Maintainer-only build step. The portable ZIP contains generated data, not Node.js code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {normalizeDocument} = require('../../plugins/coding-iris-plugin/scripts/iris-tools/xml-package-core');
const {TEXT_EXTENSIONS, IMAGE_EXTENSIONS} = require('../../plugins/coding-iris-plugin/scripts/iris-tools/baseline-catalog');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const catalogRoot = path.resolve(__dirname, '../../docs/reference/project-export-map/doctor');
function fail(reason) { throw new Error(reason); }
function readVersions() {
  const readme = fs.readFileSync(path.join(catalogRoot, 'README.md'));
  const rows = readme.toString('utf8').split(/\r?\n/).filter(line => /^\| v\d/.test(line));
  if (!rows.length) fail('version-table-missing');
  const versions = rows.map(line => {
    const cells = line.split('|').slice(1, -1).map(s => s.trim());
    const [version, link, project, label] = cells, file = link?.match(/^\[[^\]]+\]\((v\d+\.\d+(?:\.\d+)?\.txt)\)$/)?.[1];
    const scope = label === '医生站' ? 'doctor' : /^全仓 \d+ 个产品$/.test(label) ? 'all-products' : null;
    if (!/^v\d+\.\d+(?:\.\d+)?$/.test(version) || !file || file !== `${version}.txt` || !scope || !project) fail('version-table-invalid');
    return {version, file, project, scope, scopeLabel: label};
  });
  if (new Set(versions.map(v => v.version)).size !== versions.length) fail('duplicate-version');
  return {readme, versions};
}
function compileCatalog(bytes) {
  const parsed = require('../../plugins/coding-iris-plugin/scripts/iris-tools/scope-list').parseScopeList(bytes);
  const items = [], excludedImages = [];
  for (const source of parsed) {
    const item = normalizeDocument(source);
    const ext = path.posix.extname(item.document).toLowerCase();
    if (item.type === 'CSP' && IMAGE_EXTENSIONS.has(ext)) { excludedImages.push('/' + item.document); continue; }
    if (item.type === 'CSP' && !TEXT_EXTENSIONS.has(ext)) fail('version-catalog-unsupported-file');
    items.push(item.type === 'CSP' ? '/' + item.document : item.document);
  }
  const webRoots = [...new Set(items.filter(s => s.startsWith('/')).map(s => s.startsWith('/imedical/web/') ? '/imedical/web/' : '/' + s.slice(1).split('/')[0] + '/'))].sort();
  return {items, rawItemCount: parsed.length, duplicateCount: 0, duplicates: [], excludedImages, webRoots};
}
function generate() {
  const {readme, versions} = readVersions(), entries = [], files = new Map();
  for (const version of versions) {
    const bytes = fs.readFileSync(path.join(catalogRoot, version.file)), compiled = compileCatalog(bytes);
    const listName = version.version + '.txt', listBytes = Buffer.from(compiled.items.join('\n') + '\n');
    files.set(listName, listBytes);
    entries.push({version: version.version, scope: version.scope, scopeLabel: version.scopeLabel, project: version.project,
      sourcePath: 'docs/reference/project-export-map/doctor/' + version.file, sourceSha256: hash(bytes),
      rawItemCount: compiled.rawItemCount, duplicateCount: compiled.duplicateCount, duplicates: compiled.duplicates,
      excludedImages: compiled.excludedImages, codeCount: compiled.items.length, webRoots: compiled.webRoots,
      webPathsNeedConfirmation: compiled.webRoots.length > 1, listFile: listName, listSha256: hash(listBytes)});
  }
  const index = {schema: 'iris-version-catalogs/v1', sourceReadmeSha256: hash(readme), entries};
  files.set('index.json', Buffer.from(JSON.stringify(index, null, 2) + '\n'));
  return {index, files};
}
function build(output) {
  const result = generate(), target = path.resolve(output);
  if (fs.existsSync(target)) fail('catalog-output-must-be-new');
  const stage = target + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.mkdirSync(stage, {recursive: true});
    for (const [name, bytes] of result.files) fs.writeFileSync(path.join(stage, name), bytes, {flag: 'wx'});
    fs.renameSync(stage, target);
  } finally { if (fs.existsSync(stage)) fs.rmSync(stage, {recursive: true, force: true}); }
  return result.index;
}
function helperSource() {
  const candidates = [path.resolve(__dirname, '../../plugins/coding-iris-plugin/scripts/iris-tools/source-delivery.ps1'), path.join(__dirname, 'source-delivery.ps1')].filter(p => fs.existsSync(p));
  if (candidates.length !== 1) fail('source-delivery-must-have-one-canonical-source');
  return candidates[0];
}
function packageSources(output) {
  const target = path.resolve(output);
  if (fs.existsSync(target)) fail('package-output-must-be-new');
  const helper = helperSource();
  fs.mkdirSync(target, {recursive: true});
  for (const name of ['README.md', 'export-iris-code.ps1', 'export-version-baseline.ps1', 'files.example.txt']) fs.copyFileSync(path.join(__dirname, name), path.join(target, name), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(helper, path.join(target, 'source-delivery.ps1'), fs.constants.COPYFILE_EXCL);
  fs.mkdirSync(path.join(target, 'images'));
  fs.copyFileSync(path.join(__dirname, 'images/project-layout-example.png'), path.join(target, 'images/project-layout-example.png'), fs.constants.COPYFILE_EXCL);
  return build(path.join(target, 'catalogs'));
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4 || !['--out', '--package-out'].includes(process.argv[2])) fail('usage: node build-catalogs.js --out|--package-out <new-directory>');
    const result = process.argv[2] === '--out' ? build(process.argv[3]) : packageSources(process.argv[3]);
    console.log(JSON.stringify({schema: 'iris-version-catalogs/v1', versions: result.entries.map(e => ({version: e.version, scope: e.scope, codeCount: e.codeCount, duplicateCount: e.duplicateCount}))}));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {compileCatalog, generate, build, helperSource, packageSources};
