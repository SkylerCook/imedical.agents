#!/usr/bin/env node
'use strict';

// Maintainer-only: business projects receive the completed vendor snapshot.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const REPOSITORY = 'https://github.com/wanghc/hisui.git';
const REPO = path.resolve(__dirname, '../..');
const SCHEMA = 'imedical-hisui-vendor/v1';
const REQUIRED = ['js/jquery.hisui.js', 'js/jquery.hisui.min.js', 'js/jquery-1.11.3.min.js',
  'js/locale/hisui-lang-zh_CN.js', 'css/hisui.css', 'css/hisui.min.css',
  'css/hisui.lite.css', 'css/hisui.lightblue.css', 'css/hisui.pure.css', 'css/hisui.vben.css'];

function git(root, args) {
  const r = spawnSync('git', ['-C', root, '-c', 'core.autocrlf=false', ...args],
    { encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.error?.message || r.stderr}`);
  return r.stdout.trim();
}
function walk(root, prefix = '') {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error(`Linked directory is not allowed: ${root}`);
  return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap(e => {
      if (e.isSymbolicLink()) throw new Error(`Linked asset is not allowed: ${e.name}`);
      const rel = prefix + e.name, at = path.join(root, e.name);
      if (e.isDirectory()) return walk(at, rel + '/');
      if (!e.isFile()) throw new Error(`Unsupported asset type: ${at}`);
      return [rel];
    });
}
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function inventory(root) {
  return [...walk(path.join(root, 'dist')).map(f => 'dist/' + f), ...walk(path.join(root, 'licenses')).map(f => 'licenses/' + f), 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'source-index.json', 'resource-warnings.json']
    .sort().map(file => ({ path: file, bytes: fs.statSync(path.join(root, file)).size, sha256: hash(path.join(root, file)) }));
}
function inspect(root) {
  for (const f of REQUIRED) if (!fs.statSync(path.join(root, 'dist', f)).size) throw new Error(`Empty asset: ${f}`);
  for (const f of walk(path.join(root, 'dist')).filter(f => f.endsWith('.js'))) {
    new vm.Script(fs.readFileSync(path.join(root, 'dist', f), 'utf8'), { filename: f });
  }
  const source = fs.readFileSync(path.join(root, 'dist/js/jquery.hisui.js'), 'utf8');
  const lines = source.split('\n');
  const widgets = {};
  for (const m of source.matchAll(/[\w$]+\.fn\.(\w+)\s*=\s*function\s*\(/g)) {
    const name = m[1], line = source.slice(0, m.index).split('\n').length;
    const defaults = lines.findIndex(l => new RegExp('\\.fn\\.' + name + '\\.defaults\\s*=').test(l));
    widgets[name] = { definition: line, defaults: defaults < 0 ? null : defaults + 1 };
  }
  for (const widget of ['datagrid', 'panel', 'dialog', 'combobox', 'numberbox', 'lookup']) {
    if (!widgets[widget]) throw new Error(`Missing widget: ${widget}`);
  }
  return { schema: 'imedical-hisui-source-index/v1', file: 'dist/js/jquery.hisui.js', lineCount: lines.length,
    widgets, note: 'Line numbers apply only to this snapshot. Target HIS scripts may include separate application helpers.' };
}
function verify(root) {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'upstream.json'), 'utf8'));
  if (metadata.schema !== SCHEMA || metadata.repository !== REPOSITORY || !/^[a-f0-9]{40}$/.test(metadata.commit)) {
    throw new Error('Invalid upstream identity');
  }
  if (JSON.stringify(inventory(root)) !== JSON.stringify(metadata.files)) throw new Error('Vendor inventory/hash mismatch');
  const index = inspect(root);
  if (JSON.stringify(index) !== JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'source-index.json'), 'utf8')))) {
    throw new Error('Source index does not match the bundled JavaScript');
  }
  const warnings = resources(root);
  if (JSON.stringify(warnings) !== JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'resource-warnings.json'), 'utf8')))) throw new Error('Resource warnings do not match the snapshot');
  return { status: 'verified', commit: metadata.commit, files: metadata.files.length, jqueryEntrypoints: Object.keys(index.widgets).length,
    missingResourceTargets: new Set(warnings.map(w => w.target)).size };
}
function resources(root) {
  const dist = path.join(root, 'dist'), warnings = [];
  const known = JSON.parse(fs.readFileSync(path.join(__dirname, 'known-resource-gaps.json'), 'utf8'));
  for (const file of walk(dist).filter(f => f.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(dist, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)) {
      const url = m[1].split(/[?#]/)[0];
      if (!url || /^(data:|https?:|\/)/.test(url)) continue;
      const at = path.resolve(path.dirname(path.join(dist, file)), url);
      const target = path.relative(dist, at).replaceAll('\\', '/');
      if (target.startsWith('../')) throw new Error(`Resource escapes the snapshot: ${file}: ${url}`);
      if (!fs.existsSync(at)) {
        if (!known.includes(target)) throw new Error(`New upstream resource gap: ${file}: ${url}`);
        warnings.push({ file, url, target });
      }
    }
  }
  return warnings;
}
function parseArray(source, name) {
  const block = source.match(new RegExp('var\\s+' + name + '\\s*=\\s*\\[([^\\]]+)\\]'));
  if (!block) throw new Error(`Upstream build array changed: ${name}`);
  const values = [...block[1].matchAll(/['"]([^'"\r\n]+)['"]/g)].map(m => m[1]);
  if (!values.length || block[1].replace(/['"][^'"\r\n]+['"]/g, '').replace(/[\s,]/g, '')) {
    throw new Error(`Unsupported upstream build array: ${name}`);
  }
  return values;
}
function escapeLocale(source) {
  return source.replace(/[\u4E00-\u9FA5\uFE30-\uFFA0]/g, s => '\\u' + s.charCodeAt(0).toString(16));
}
function copyDistribution(sourceRoot, output, distributionRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'distribution-assets.json'), 'utf8'));
  const copied = [];
  for (const file of manifest.files) {
    if (!/^dist\/[\w./-]+$/.test(file.path) || file.path.split('/').includes('..')) throw new Error('Unsafe distribution asset path');
    if (fs.existsSync(path.join(sourceRoot, file.path))) continue;
    const input = path.join(distributionRoot, file.path), destination = path.join(output, file.path);
    if (fs.lstatSync(input).isSymbolicLink() || hash(input) !== file.sha256) throw new Error(`Distribution input changed: ${file.path}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(input, destination);
    copied.push(file);
  }
  return { origin: manifest.origin, files: copied };
}
async function build(sourceRoot, output, toolsDir, distributionRoot = path.join(REPO, 'vendor/hisui')) {
  const requireTools = createRequire(path.join(path.resolve(toolsDir), 'package.json'));
  const less = requireTools('less'), uglify = requireTools('uglify-js'), CleanCSS = requireTools('clean-css');
  const toolVersions = {};
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).dependencies;
  for (const name of ['less', 'uglify-js', 'clean-css']) {
    toolVersions[name] = requireTools(name + '/package.json').version;
    if (toolVersions[name] !== expected[name]) throw new Error(`Unexpected build tool version: ${name}`);
  }
  walk(path.join(sourceRoot, 'dist'));
  fs.cpSync(path.join(sourceRoot, 'dist'), path.join(output, 'dist'), { recursive: true });
  const distributionAssets = copyDistribution(sourceRoot, output, distributionRoot);
  fs.copyFileSync(path.join(sourceRoot, 'LICENSE'), path.join(output, 'LICENSE'));
  fs.copyFileSync(path.join(__dirname, 'THIRD-PARTY-NOTICES.md'), path.join(output, 'THIRD-PARTY-NOTICES.md'));
  fs.mkdirSync(path.join(output, 'licenses'));
  fs.copyFileSync(path.join(__dirname, 'bootstrap-switch.LICENSE'), path.join(output, 'licenses/bootstrap-switch.txt'));
  const gulp = fs.readFileSync(path.join(sourceRoot, 'gulpfile.js'), 'utf8');
  const inputs = ['lib/json2.js', ...parseArray(gulp, 'orgCmpArr').map(n => 'src/' + n + '.js'), ...parseArray(gulp, 'slfCmpArr')];
  const js = inputs.map(file => {
    if (file === 'lib/json2.js') file = 'json2.js'; // Same upstream file, tracked at the repository root.
    if (file === 'lib/bootstrap-switch-1.8.0/static/js/bootstrap-switch.js') {
      return fs.readFileSync(path.join(__dirname, 'bootstrap-switch.js'), 'utf8');
    }
    return fs.readFileSync(path.join(sourceRoot, file), 'utf8');
  }).join('\n');
  for (const min of [false, true]) {
    const result = uglify.minify(js, { compress: false, ie8: true,
      output: { beautify: !min, comments: /@license|copyright|licensed|license|public domain/i } });
    if (result.error) throw result.error;
    fs.writeFileSync(path.join(output, `dist/js/jquery.hisui${min ? '.min' : ''}.js`), (min ? escapeLocale(result.code) : result.code) + '\n');
  }
  const lessNames = parseArray(gulp, 'lessArr');
  const missingStyleInputs = {};
  for (const theme of ['', 'lite', 'lightblue', 'pure', 'vben']) {
    const lessDir = path.join(sourceRoot, 'less', theme);
    const names = theme ? [...lessNames, 'beautyscroll'] : lessNames;
    const missing = names.filter(n => !fs.existsSync(path.join(lessDir, n + '.less')));
    const knownMissing = ['combogrid', 'numberspinner', 'timespinner', ...(theme ? ['input.hover'] : [])];
    if (missing.some(n => !knownMissing.includes(n))) throw new Error(`Missing upstream style input: ${theme}/${missing.join(',')}`);
    missingStyleInputs[theme || 'default'] = [...new Set(missing)];
    const text = names.filter(n => !missing.includes(n)).map(n => fs.readFileSync(path.join(lessDir, n + '.less'), 'utf8')).join('\n');
    // Upstream icon.less uses inline split/join expressions to generate aliases.
    const css = (await less.render(text, { filename: path.join(lessDir, 'hisui.min.less'), javascriptEnabled: true })).css;
    const min = new CleanCSS({ level: 1, rebase: false }).minify(css);
    if (min.errors.length) throw new Error(min.errors.join('\n'));
    const stem = 'hisui' + (theme ? '.' + theme : '');
    fs.writeFileSync(path.join(output, 'dist/css', stem + '.css'), css);
    fs.writeFileSync(path.join(output, 'dist/css', stem + '.min.css'), min.styles + '\n');
  }
  fs.mkdirSync(path.join(output, 'dist/css/locale'), { recursive: true });
  for (const theme of ['', 'lite', 'pure', 'vben']) for (const language of ['en', 'pt', 'fr']) {
    const file = path.join(sourceRoot, 'less', theme, `locale.${language}.less`);
    const css = (await less.render(fs.readFileSync(file, 'utf8'), { filename: file, javascriptEnabled: true })).css;
    const min = new CleanCSS({ rebase: false }).minify(css);
    if (min.errors.length) throw new Error(min.errors.join('\n'));
    const stem = 'hisui' + (theme ? '.' + theme : '');
    fs.writeFileSync(path.join(output, 'dist/css/locale', `${stem}.${language}.css`), min.styles + '\n');
    if (theme === 'lite') fs.writeFileSync(path.join(output, 'dist/css/locale', `hisui.lightblue.${language}.css`), min.styles + '\n');
  }
  for (const language of ['zh_CN', 'zh_TC', 'bod']) {
    let content = fs.readFileSync(path.join(sourceRoot, 'src', `hisui-lang-${language}.js`), 'utf8');
    content = language === 'bod' ? content.replace(/[\u0F00-\u0FFF]/g, s => '\\u' + s.charCodeAt(0).toString(16).padStart(4, '0')) : escapeLocale(content);
    fs.writeFileSync(path.join(output, 'dist/js/locale', `hisui-lang-${language}.js`), content);
  }
  writeJson(path.join(output, 'source-index.json'), inspect(output));
  writeJson(path.join(output, 'resource-warnings.json'), resources(output));
  return { tools: toolVersions, gulpSha256: hash(path.join(sourceRoot, 'gulpfile.js')), missingStyleInputs, distributionAssets,
    bootstrapSwitch: { repository: 'https://github.com/Bttstrp/bootstrap-switch', commit: 'b85606b3e4389276ab7818184a22ff3dd87a3892', version: '1.8.0', sha256: hash(path.join(__dirname, 'bootstrap-switch.js')) } };
}
function taskDirectory(tempRoot) {
  const preferred = tempRoot || (process.platform === 'win32' ? 'D:/tmp/Codex' : path.join(os.tmpdir(), 'Codex'));
  try { fs.mkdirSync(preferred, { recursive: true }); return fs.mkdtempSync(path.join(preferred, 'hisui-vendor-')); }
  catch (e) {
    if (tempRoot) throw e;
    const fallback = path.join(os.tmpdir(), 'Codex'); fs.mkdirSync(fallback, { recursive: true });
    const root = fs.mkdtempSync(path.join(fallback, 'hisui-vendor-'));
    process.stderr.write(`Temporary directory fallback: ${root}\n`); return root;
  }
}
function removeOwned(target, parent) {
  const rel = path.relative(parent, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Unsafe cleanup target');
  walk(target); fs.rmSync(target, { recursive: true, force: true });
}
function publish(output, target, task) {
  // Keep the vendor directory and README/AGENTS; replace only the owned snapshot.
  const names = ['dist', 'licenses', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'source-index.json', 'resource-warnings.json', 'upstream.json'];
  // Renames stay on the target volume even when the system-temp fallback is on C:.
  const local = fs.mkdtempSync(path.join(target, '.hisui-update-'));
  const next = path.join(local, 'next'), backup = path.join(local, 'previous');
  fs.mkdirSync(backup);
  const saved = [], installed = [];
  let keepRecovery = false;
  try {
    fs.cpSync(output, next, { recursive: true });
    for (const name of names) {
      const at = path.join(target, name);
      if (fs.existsSync(at)) { fs.renameSync(at, path.join(backup, name)); saved.push(name); }
      fs.renameSync(path.join(next, name), at); installed.push(name);
    }
    verify(target);
  } catch (error) {
    try {
      for (const name of installed.reverse()) {
        const at = path.join(target, name);
        if (fs.statSync(at).isDirectory()) removeOwned(at, target); else fs.unlinkSync(at);
      }
      for (const name of saved.reverse()) fs.renameSync(path.join(backup, name), path.join(target, name));
    } catch (recoveryError) {
      keepRecovery = true;
      throw new Error(`${error.message}; rollback failed: ${recoveryError.message}; recovery files preserved at ${local}`);
    }
    throw error;
  } finally { if (!keepRecovery) removeOwned(local, target); }
}
async function update(options) {
  const repo = path.resolve(options.repo || REPO), target = path.join(repo, 'vendor/hisui');
  if (!fs.existsSync(path.join(repo, 'memory/agent-kit-maintenance-memory.md'))) throw new Error('Updates require the capability source repository');
  walk(target);
  const task = taskDirectory(options.tempRoot);
  try {
    let source = options.sourceDir && path.resolve(options.sourceDir);
    if (!source) {
      source = path.join(task, 'upstream'); fs.mkdirSync(source);
      git(source, ['init', '--quiet']);
      git(source, ['fetch', '--depth=1', REPOSITORY, options.commit || 'master']);
      git(source, ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    }
    const commit = git(source, ['rev-parse', 'HEAD']);
    if (options.commit && options.commit !== commit) throw new Error('The source checkout does not match the requested commit');
    if (git(source, ['status', '--porcelain', '--untracked-files=all', '--', 'dist', 'src', 'less', 'lib', 'json2.js', 'gulpfile.js', 'LICENSE'])) {
      throw new Error('Upstream build inputs are dirty');
    }
    if (fs.existsSync(path.join(target, 'upstream.json'))) {
      const local = JSON.parse(fs.readFileSync(path.join(target, 'upstream.json'), 'utf8'));
      if (local.commit === commit) return { ...verify(target), status: 'unchanged' };
    }
    const snapshotPaths = ['dist', 'licenses', 'upstream.json', 'source-index.json', 'resource-warnings.json', 'LICENSE', 'THIRD-PARTY-NOTICES.md'].map(p => 'vendor/hisui/' + p);
    if (git(repo, ['status', '--porcelain', '--untracked-files=all', '--', ...snapshotPaths])) {
      throw new Error('Vendor snapshot has local changes; review/commit them before upgrading');
    }
    if (!options.toolsDir) throw new Error('Build tools are required; see maintenance/hisui-build/README.md');
    const output = path.join(task, 'next'); fs.mkdirSync(output);
    const buildInfo = await build(source, output, options.toolsDir, target);
    writeJson(path.join(output, 'upstream.json'), { schema: SCHEMA, repository: REPOSITORY, branch: 'master', commit,
      commitDate: git(source, ['show', '-s', '--format=%cI', 'HEAD']), build: buildInfo, files: inventory(output) });
    verify(output);
    // Detect a concurrent vendor edit before replacement.
    if (git(repo, ['status', '--porcelain', '--untracked-files=all', '--', ...snapshotPaths])) {
      throw new Error('Vendor changed while the upstream snapshot was being built');
    }
    publish(output, target, task);
    return { ...verify(target), status: 'updated' };
  } finally { removeOwned(task, path.dirname(task)); }
}
function check(repo = REPO) {
  const target = path.join(repo, 'vendor/hisui');
  const local = verify(target);
  const remote = git(repo, ['ls-remote', REPOSITORY, 'refs/heads/master']).split(/\s/)[0];
  if (!/^[a-f0-9]{40}$/.test(remote)) throw new Error('Cannot resolve upstream master');
  return { status: local.commit === remote ? 'up-to-date' : 'update-available', localCommit: local.commit, remoteCommit: remote,
    compareUrl: `https://github.com/wanghc/hisui/compare/${local.commit}...${remote}` };
}
function argumentsOf(argv) {
  const command = argv[0] || 'check', options = {};
  const names = { '--repo': 'repo', '--source-dir': 'sourceDir', '--tools-dir': 'toolsDir', '--temp-root': 'tempRoot', '--commit': 'commit' };
  for (let i = 1; i < argv.length; i += 2) {
    if (!names[argv[i]] || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${argv[i]}`);
    options[names[argv[i]]] = argv[i + 1];
  }
  if (options.commit && !/^[a-f0-9]{40}$/.test(options.commit)) throw new Error('--commit requires a full SHA');
  return { command, options };
}
module.exports = { inspect, inventory, resources, verify, parseArray, build, copyDistribution, publish, update, check, argumentsOf, removeOwned };
if (require.main === module) {
  (async () => {
    const { command, options } = argumentsOf(process.argv.slice(2));
    if (command === 'help' || command === '--help') {
      console.log('check | verify | update [--commit SHA] [--source-dir DIR] [--tools-dir DIR] [--temp-root DIR] [--repo DIR]'); return;
    }
    const result = command === 'check' ? check(options.repo) : command === 'verify' ? verify(path.join(options.repo || REPO, 'vendor/hisui')) : command === 'update' ? await update(options) : null;
    if (!result) throw new Error(`Unknown command: ${command}`);
    console.log(JSON.stringify(result, null, 2));
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
