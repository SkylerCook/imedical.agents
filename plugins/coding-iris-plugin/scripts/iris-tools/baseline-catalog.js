#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {resolveWorkspaceContext} = require('../../../../scripts/lib/workspace-context');
const {readProjectEnv} = require('./project-env');

const OBJECT_TYPES = new Map([['.cls', 'CLS'], ['.mac', 'MAC'], ['.inc', 'INC'], ['.int', 'INT']]);
const TEXT_EXTENSIONS = new Set(['.csp', '.csr', '.js', '.css', '.html', '.htm']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.svg', '.webp', '.avif']);
const WEB_SEGMENTS = new Set(['csp', 'css', 'js', 'scripts', 'html', 'htm']);
const HELP = 'baseline-catalog.js build --project-root <workspace> --out <ProjectItem.xml> [--source-root <directory> ...] [--web-base <virtual-prefix>] [--project-name <name>] [--version <label>] [--source-ref <ref>] [--scope <description>] [--type CLS,CSP] [--prefix <name>] [--dry-run]\nbaseline-catalog.js compare --left <ProjectItem.xml> --right <ProjectItem.xml>\nOffline only; images are excluded and fully reported. Build does not publish or commit a catalog. Compare reports membership, not historical source contents.';

function stop(code, details = {}) { throw Object.assign(new Error(code), {code, details}); }
function xmlCore() { return require('./xml-package-core'); }
function escapeXml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function key(item) { return `${item.type}:${item.name}`.toLowerCase(); }
function readItems(file) { return xmlCore().parseProjectItems(fs.readFileSync(path.resolve(file))); }
function buildXml(items, options = {}) {
    const projectName = options.projectName || 'IRISProject';
    const timestamp = options.timestamp || new Date().toISOString();
    const body = items.map(item => `    <ProjectItem name="${escapeXml(item.name)}" type="${escapeXml(item.type)}"/>`);
    const metadata = JSON.stringify({version: options.version || '', sourceRef: options.sourceRef || '', scope: options.scope || ''}).replace(/--/g, '\\u002d\\u002d');
    const xml = ['<?xml version="1.0" encoding="UTF-8"?>', `<!-- iris-baseline ${metadata} -->`, `<Export generator="IRIS" version="26" ts="${escapeXml(timestamp)}">`,
        `<Project name="${escapeXml(projectName)}">`, '  <Items>', ...body, '  </Items>', '</Project>', '</Export>', ''].join('\n');
    if (items.length) xmlCore().parseProjectItems(xml);
    return xml;
}
function checkPath(file) {
    const absolute = path.resolve(file);
    let current = path.parse(absolute).root;
    for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        try { if (fs.lstatSync(current).isSymbolicLink()) stop('baseline-linked-path', {path: current}); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return absolute;
}
function writeAtomic(file, bytes, beforeWrite, options = {}) {
    const absolute = checkPath(file);
    fs.mkdirSync(path.dirname(absolute), {recursive: true});
    checkPath(absolute);
    const temporary = options.temporaryPath || absolute + '.' + crypto.randomUUID() + '.tmp';
    if (path.dirname(temporary) !== path.dirname(absolute) || !temporary.startsWith(absolute + '.') || !temporary.endsWith('.tmp')) stop('baseline-temporary-path-invalid');
    checkPath(temporary);
    try {
        const mode = fs.existsSync(absolute) ? fs.statSync(absolute).mode & 0o777 : 0o600;
        fs.writeFileSync(temporary, bytes, {flag: 'wx', mode});
        if (beforeWrite) beforeWrite();
        checkPath(absolute);
        fs.renameSync(temporary, absolute);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function localItem(file, {root, webBase} = {}) {
    const extension = path.extname(file).toLowerCase();
    let item;
    if (OBJECT_TYPES.has(extension)) {
        const document = extension === '.cls' ? require('./backend-document').documentName(file, fs.readFileSync(file, 'utf8')) : path.basename(file);
        item = {name: document.slice(0, -extension.length), type: OBJECT_TYPES.get(extension)};
    } else {
        if (!TEXT_EXTENSIONS.has(extension) && !IMAGE_EXTENSIONS.has(extension)) stop('baseline-file-type-unsupported');
        if (!webBase) stop('baseline-web-base-required');
        const parts = path.relative(root, file).split(path.sep);
        const frontend = parts.lastIndexOf('frontend');
        const scope = frontend >= 0 ? parts.slice(frontend + 1) : parts;
        const existing = scope.join('/');
        const index = scope.findIndex(segment => WEB_SEGMENTS.has(segment.toLowerCase()) || ['images', 'img'].includes(segment.toLowerCase()));
        const tail = index >= 0 ? scope.slice(index).join('/') : existing;
        item = {name: existing.startsWith(webBase + '/') ? existing : webBase + '/' + tail, type: 'CSP'};
    }
    xmlCore().normalizeDocument(item);
    return item;
}
function collect(options = {}) {
    const context = options.context || resolveWorkspaceContext(path.resolve(options.projectRoot || process.cwd()));
    if (context.manifestError) stop('invalid-workspace-context');
    const roots = options.sourceRoots?.length ? options.sourceRoots.map(value => path.resolve(value)) : context.sourceRoots.flatMap(source => {
        const conventional = ['backend', 'frontend'].map(name => path.join(source.target, 'src', name)).filter(directory => fs.existsSync(directory));
        return conventional.length ? conventional : [fs.existsSync(path.join(source.target, 'src')) ? path.join(source.target, 'src') : source.target];
    });
    const configured = readProjectEnv(context, {optional: true}).config;
    const webBase = String(options.webBase || configured.web?.basePath || '').replace(/^\/+|\/+$/g, '');
    if (webBase && (/[\\%?#\x00-\x20]/.test(webBase) || webBase.split('/').some(part => !part || part === '.' || part === '..'))) stop('baseline-web-base-invalid');
    const result = {items: [], excludedImages: [], unresolved: [], duplicates: [], skippedLinks: [], sourceRoots: roots};
    const seen = new Map(), visited = new Set();
    function walk(directory, root, role) {
        if (!fs.existsSync(directory)) stop('baseline-source-root-missing', {path: directory});
        const real = fs.realpathSync(directory);
        if (visited.has(real)) return;
        visited.add(real);
        for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
            if (['.git', '.agents', '.codex', 'node_modules'].includes(entry.name)) continue;
            const file = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) { result.skippedLinks.push(file); continue; }
            if (entry.isDirectory()) { walk(file, root, role); continue; }
            if (!entry.isFile()) continue;
            const extension = path.extname(file).toLowerCase();
            if (IMAGE_EXTENSIONS.has(extension)) { result.excludedImages.push(file); continue; }
            if (!OBJECT_TYPES.has(extension) && !TEXT_EXTENSIONS.has(extension)) continue;
            if (role === 'backend' && !OBJECT_TYPES.has(extension) || role === 'frontend' && OBJECT_TYPES.has(extension)) continue;
            try {
                const item = localItem(file, {root, webBase});
                const identity = key(item);
                if (seen.has(identity)) { result.duplicates.push({name: item.name, type: item.type, paths: [seen.get(identity), file]}); continue; }
                seen.set(identity, file);
                result.items.push(item);
            } catch (error) { result.unresolved.push({path: file, reason: error.code || error.reason || error.message}); }
        }
    }
    for (const root of roots) {
        checkPath(root);
        const declared = context.sourceRoots.find(source => source.target === root)?.name;
        const role = ['backend', 'frontend'].includes(declared) ? declared : path.basename(root).toLowerCase();
        walk(root, root, role);
    }
    const types = options.type ? new Set(String(options.type).split(',').map(value => value.trim().toUpperCase())) : null;
    if (types && [...types].some(type => !['CLS', 'MAC', 'INC', 'INT', 'CSP'].includes(type))) stop('baseline-type-invalid');
    result.items = result.items.filter(item => (!types || types.has(item.type)) && (!options.prefix || item.name.toLowerCase().startsWith(String(options.prefix).toLowerCase())));
    result.items.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
    result.total = result.items.length;
    result.excludedImageCount = result.excludedImages.length;
    result.unresolvedCount = result.unresolved.length;
    result.duplicateCount = result.duplicates.length;
    return result;
}
function build(options = {}) {
    if (!options.out) stop('baseline-out-required');
    const result = collect(options);
    const metadata = {projectName: options.projectName || 'IRISProject', version: options.version || '', sourceRef: options.sourceRef || '', scope: options.scope || '', sourceRoots: result.sourceRoots};
    if (result.unresolved.length || result.duplicates.length || result.skippedLinks.length) return {...result, metadata, state: 'blocked', written: false};
    if (!result.items.length) return {...result, metadata, state: 'empty', written: false};
    const xml = buildXml(result.items, options);
    if (!options.dryRun) writeAtomic(path.resolve(options.out), xml);
    return {...result, metadata, state: options.dryRun ? 'planned' : 'built', written: !options.dryRun, out: path.resolve(options.out)};
}
function compare(options = {}) {
    if (!options.left || !options.right) stop('baseline-comparison-inputs-required');
    const left = readItems(options.left), right = readItems(options.right);
    const leftSet = new Set(left.map(key)), rightSet = new Set(right.map(key));
    return {schema: 'iris-baseline-comparison/v1', left: left.length, right: right.length,
        added: right.filter(item => !leftSet.has(key(item))), removed: left.filter(item => !rightSet.has(key(item))), common: left.filter(item => rightSet.has(key(item))).length,
        comparison: 'document-membership-only'};
}
function args(argv) {
    const options = {command: argv[0], sourceRoots: []};
    const values = new Set(['project-root', 'source-root', 'out', 'web-base', 'project-name', 'version', 'source-ref', 'scope', 'type', 'prefix', 'left', 'right']);
    for (let index = 1; index < argv.length; index++) {
        const name = argv[index].replace(/^--/, '');
        if (['dry-run', 'json'].includes(name)) { options[name === 'dry-run' ? 'dryRun' : 'json'] = true; continue; }
        if (!argv[index].startsWith('--') || !values.has(name) || !argv[index + 1] || argv[index + 1].startsWith('--')) stop('baseline-option-invalid', {option: argv[index]});
        const value = argv[++index];
        if (name === 'source-root') options.sourceRoots.push(value);
        else options[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    return options;
}
function main(argv = process.argv.slice(2)) {
    if (!argv.length || argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return; }
    const options = args(argv);
    const result = options.command === 'build' ? build(options) : options.command === 'compare' ? compare(options) : stop('baseline-command-invalid');
    console.log(JSON.stringify(result));
    if (result.state === 'blocked') process.exitCode = 2;
    return result;
}
if (require.main === module) { try { main(); } catch (error) { console.error(JSON.stringify({status: 'blocked', reason: error.code || error.message, details: error.details || {}})); process.exitCode = 1; } }
module.exports = {OBJECT_TYPES, TEXT_EXTENSIONS, IMAGE_EXTENSIONS, readItems, buildXml, localItem, collect, build, compare, checkPath, writeAtomic, args, main};
