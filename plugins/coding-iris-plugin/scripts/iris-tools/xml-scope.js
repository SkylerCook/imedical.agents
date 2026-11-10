#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {TextDecoder} = require('node:util');
const {resolveWorkspaceContext} = require('../../../../scripts/lib/workspace-context');
const {readProjectEnv} = require('./project-env');
const catalog = require('./baseline-catalog');
const {normalizeDocument} = require('./xml-package-core');

const HELP = 'xml-scope.js files <paths...> [options]\nxml-scope.js changed [--since <revision>] [options]\nxml-scope.js grep <literal> [options]\nxml-scope.js page <path> [--with-backend] [options]\nxml-scope.js all [options]\nOptions: --project-root <workspace> --web-base <virtual-prefix> --out-list <scope.json> --json\nOffline candidates only; images are included. baseline is an alias for all and outputs document membership only. Deleted, missing, dynamic and unresolved references are fully reported. A candidate list does not establish complete module dependencies and requires Agent/user review before export. No credentials, server connection, deployment or automatic export.';
const SKIP_DIRECTORIES = new Set(['.git', '.agents', '.codex', '.claude', 'node_modules']);
function stop(code, details = {}) { throw Object.assign(new Error(code), {code, details}); }
function inside(root, target) { const value = path.relative(root, target); return !value || value !== '..' && !value.startsWith('..' + path.sep) && !path.isAbsolute(value); }
const slash = value => value.split(path.sep).join('/');
const identity = item => normalizeDocument(item).identity.toLowerCase();
function sourceRoots(context) {
    return context.sourceRoots.flatMap(source => {
        const conventional = ['backend', 'frontend'].map(name => ({...source, target: path.join(source.target, 'src', name), path: path.join(source.path, 'src', name), role: name})).filter(root => fs.existsSync(root.target));
        if (conventional.length) return conventional;
        const sub = fs.existsSync(path.join(source.target, 'src')) ? 'src' : '';
        return [{...source, target: path.join(source.target, sub), path: path.join(source.path, sub), role: source.name}];
    });
}
function createEnvironment(options = {}) {
    const context = options.context || resolveWorkspaceContext(path.resolve(options.projectRoot || process.cwd()));
    if (context.manifestError || !Array.isArray(context.sourceRoots) || !context.sourceRoots.length) stop('xml-scope-workspace-invalid');
    const webBase = String(options.webBase || readProjectEnv(context, {optional: true}).config.web?.basePath || '').replace(/^\/+|\/+$/g, '');
    if (webBase && (/[\\%?#\x00-\x20]/.test(webBase) || webBase.split('/').some(part => !part || part === '.' || part === '..'))) stop('xml-scope-web-base-invalid');
    const roots = sourceRoots(context);
    for (const root of roots) catalog.checkPath(root.target);
    return {context, roots, webBase};
}
function locate(file, environment) {
    const absolute = path.resolve(environment.context.workspaceRoot, file);
    const matches = environment.roots.flatMap(root => [root.target, root.path].map(base => ({root, base})))
        .filter(value => inside(value.base, absolute)).sort((a, b) => b.base.length - a.base.length);
    if (!matches.length) stop('xml-scope-outside-source', {path: absolute});
    const {root, base} = matches[0], physical = path.resolve(root.target, path.relative(base, absolute));
    if (path.relative(root.target, physical).split(path.sep).some(part => SKIP_DIRECTORIES.has(part.toLowerCase()))) stop('xml-scope-private-source');
    catalog.checkPath(physical);
    if (!inside(root.target, physical)) stop('xml-scope-outside-source');
    return {root, physical};
}
function supported(file, root) {
    const extension = path.extname(file).toLowerCase(), object = catalog.OBJECT_TYPES.has(extension);
    if (!object && !catalog.TEXT_EXTENSIONS.has(extension) && !catalog.IMAGE_EXTENSIONS.has(extension)) return false;
    if (root.role === 'backend' && !object || root.role === 'frontend' && object) return false;
    return true;
}
function descriptor(file, environment) {
    const {root, physical} = locate(file, environment);
    if (!fs.existsSync(physical)) stop('xml-scope-source-missing', {path: physical});
    if (!fs.lstatSync(physical).isFile()) stop('xml-scope-source-not-file', {path: physical});
    if (!supported(physical, root)) stop('xml-scope-unsupported-source', {path: physical});
    return {...catalog.localItem(physical, {root: root.target, webBase: environment.webBase}), sourcePath: physical,
        logicalPath: slash(path.relative(environment.context.workspaceRoot, path.join(root.path, path.relative(root.target, physical))))};
}
function enumerate(environment, result) {
    const files = [], visited = new Set();
    function walk(directory, root) {
        if (!fs.existsSync(directory)) { result.unresolved.push({path: directory, reason: 'source-root-missing'}); return; }
        const real = fs.realpathSync(directory); if (visited.has(real)) return; visited.add(real);
        for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
            if (SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue;
            const file = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) { result.unresolved.push({path: file, reason: 'linked-source-skipped'}); continue; }
            if (entry.isDirectory()) walk(file, root);
            else if (entry.isFile() && supported(file, root)) files.push(file);
        }
    }
    for (const root of environment.roots) walk(root.target, root);
    return files;
}
function git(root, args) {
    const value = spawnSync('git', ['-C', root, ...args], {windowsHide: true, encoding: null, maxBuffer: 64 * 1024 * 1024});
    if (value.status !== 0) stop('xml-scope-git-failed', {operation: args[0], gitRoot: root});
    return value.stdout;
}
function parsePorcelain(bytes) {
    const tokens = bytes.toString('utf8').split('\0'), records = [];
    for (let index = 0; index < tokens.length && tokens[index]; index++) {
        const token = tokens[index];
        if (token.length < 4 || token[2] !== ' ') stop('xml-scope-git-status-invalid');
        const status = token.slice(0, 2), file = token.slice(3), renamed = /[RC]/.test(status);
        const from = renamed ? tokens[++index] : null;
        if (renamed && !from) stop('xml-scope-git-status-invalid');
        records.push({path: file, status, ...(from ? {from} : {}), deleted: status.includes('D')});
    }
    return records;
}
function parseDiff(bytes) {
    const tokens = bytes.toString('utf8').split('\0'), records = [];
    for (let index = 0; index < tokens.length && tokens[index];) {
        const status = tokens[index++], first = tokens[index++];
        if (!/^[ACDMRTUXB][0-9]*$/.test(status) || !first) stop('xml-scope-git-diff-invalid');
        const renamed = /^[RC]/.test(status), file = renamed ? tokens[index++] : first;
        if (!file) stop('xml-scope-git-diff-invalid');
        records.push({path: file, status, ...(renamed ? {from: first} : {}), deleted: status[0] === 'D'});
    }
    return records;
}
function changed(environment, options, result, add) {
    const groups = new Map();
    for (const root of environment.roots) {
        const gitRoot = path.resolve(root.gitRoot);
        if (!inside(gitRoot, root.target)) stop('xml-scope-git-source-mismatch');
        if (!groups.has(gitRoot)) groups.set(gitRoot, []); groups.get(gitRoot).push(root);
    }
    for (const [gitRoot, roots] of groups) {
        const actual = git(gitRoot, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
        // Windows may canonicalize directory casing in Git's result. Compare
        // the actual directories, while still rejecting another physical root.
        if (fs.realpathSync.native(path.resolve(actual)) !== fs.realpathSync.native(gitRoot)) stop('xml-scope-git-root-mismatch');
        const scopes = [...new Set(roots.map(root => path.relative(gitRoot, root.target) || '.'))].map(relative => ':(literal)' + slash(relative));
        const records = parsePorcelain(git(gitRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...scopes]));
        if (options.since) {
            if (String(options.since).startsWith('-')) stop('xml-scope-revision-invalid');
            const revision = git(gitRoot, ['rev-parse', '--verify', String(options.since) + '^{commit}']).toString('utf8').trim();
            records.push(...parseDiff(git(gitRoot, ['diff', '--name-status', '-z', '--find-renames', revision, '--', ...scopes])));
        }
        const seen = new Set();
        for (const record of records) {
            const file = path.resolve(gitRoot, record.path), key = file + ':' + record.deleted;
            if (seen.has(key)) continue; seen.add(key);
            if (!roots.some(root => inside(root.target, file))) continue;
            if (record.from) result.renames.push({from: path.resolve(gitRoot, record.from), to: file, gitRoot});
            if (record.deleted || !fs.existsSync(file)) { result.deleted.push({path: file, reason: 'deleted-or-missing-not-exportable', status: record.status, gitRoot}); continue; }
            add(file, {gitStatus: record.status, gitRoot});
        }
    }
}
function references(text) {
    const found = [];
    const collect = (regex, kind, pick) => { let match; while ((match = regex.exec(text))) found.push({value: pick(match), kind, offset: match.index}); };
    collect(/\b(?:src|href|include)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, 'attribute', match => match[1] ?? match[2] ?? match[3]);
    collect(/(?:<csp:include\b[^>]*?\bpage|#include\s+(?:virtual|file)|<%@\s*include\s+file)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, 'include', match => match[1] ?? match[2] ?? match[3]);
    collect(/\binclude\s*\(\s*(?:"([^"]*)"|'([^']*)')\s*\)/gi, 'include-call', match => match[1] ?? match[2]);
    collect(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*?))\s*\)/gi, 'css-url', match => match[1] ?? match[2] ?? match[3]);
    collect(/@import\s+(?:"([^"]*)"|'([^']*)')/gi, 'css-import', match => match[1] ?? match[2]);
    return found.sort((a, b) => a.offset - b.offset);
}
function pageScope(file, environment, options, result, add) {
    const universe = enumerate(environment, result), byDocument = new Map();
    for (const source of universe) {
        try {
            const item = descriptor(source, environment), key = normalizeDocument(item).document.toLowerCase();
            if (!byDocument.has(key)) byDocument.set(key, []); byDocument.get(key).push(item);
        } catch (error) { result.unresolved.push({path: source, reason: error.code || error.reason || 'document-mapping-failed'}); }
    }
    const first = add(file), queue = first ? [first] : [], visited = new Set();
    while (queue.length) {
        const item = queue.shift();
        if (visited.has(item.sourcePath) || item.type !== 'CSP' || catalog.IMAGE_EXTENSIONS.has(path.extname(item.sourcePath).toLowerCase())) continue;
        visited.add(item.sourcePath);
        let text;
        try { text = new TextDecoder('utf-8', {fatal: true}).decode(fs.readFileSync(item.sourcePath)); }
        catch { result.unresolved.push({path: item.sourcePath, reason: 'unsupported-reference-encoding'}); continue; }
        const document = normalizeDocument(item).document;
        for (const reference of references(text)) {
            const value = reference.value.trim(), line = text.slice(0, reference.offset).split('\n').length;
            const context = {path: item.sourcePath, line, reference: value, kind: reference.kind};
            if (!value) continue;
            if (/#\(|<%|\{\{|\$\{|["']\s*\+|\+\s*["']/.test(value)) { result.unresolved.push({...context, reason: 'dynamic-reference'}); continue; }
            if (value.startsWith('#')) continue;
            if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) { result.externalReferences.push(context); continue; }
            const clean = value.split(/[?#]/)[0];
            let decoded;
            try { decoded = decodeURIComponent(clean); } catch { result.unresolved.push({...context, reason: 'invalid-url-encoding'}); continue; }
            const target = decoded.startsWith('/') ? decoded.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(document), decoded));
            if (!environment.webBase || !target.startsWith(environment.webBase + '/') || target.split('/').some(part => !part || part === '..' || part === '.')) {
                result.unresolved.push({...context, reason: 'reference-outside-web-base'}); continue;
            }
            const matches = byDocument.get(target.toLowerCase()) || [];
            if (matches.length !== 1) { result.unresolved.push({...context, document: target, reason: matches.length ? 'ambiguous-reference' : 'missing-reference'}); continue; }
            const next = add(matches[0].sourcePath, {from: item.sourcePath, reference: value});
            if (next) queue.push(next);
        }
        if (options.withBackend) {
            const pattern = /##class\s*\(([^)]*)\)/gi; let match;
            while ((match = pattern.exec(text))) {
                const name = match[1].trim(), line = text.slice(0, match.index).split('\n').length;
                if (!/^[%A-Za-z][%\w]*(?:\.[%A-Za-z][%\w]*)*$/.test(name)) { result.unresolved.push({path: item.sourcePath, line, reference: name, reason: 'dynamic-class-reference'}); continue; }
                const matches = byDocument.get((name + '.cls').toLowerCase()) || [];
                if (matches.length !== 1) result.unresolved.push({path: item.sourcePath, line, document: name + '.cls', reason: matches.length ? 'ambiguous-class-reference' : 'missing-class-reference'});
                else add(matches[0].sourcePath, {from: item.sourcePath, reason: 'static-class-reference'});
            }
        }
    }
}
function query(options = {}) {
    const environment = createEnvironment(options), mode = options.command === 'baseline' ? 'all' : options.command;
    const result = {schema: 'iris-xml-scope/v1', mode, candidateOnly: true, items: [], unresolved: [], missing: [], deleted: [], renames: [], externalReferences: [], excluded: [],
        warning: 'Candidates require Agent/user review; static references do not prove complete business dependencies.'};
    const seen = new Map();
    function add(file, extra = {}) {
        try {
            const item = descriptor(file, environment), key = identity(item), prior = seen.get(key);
            if (prior) {
                if (prior.sourcePath !== item.sourcePath) result.unresolved.push({document: normalizeDocument(item).document, paths: [prior.sourcePath, item.sourcePath], reason: 'duplicate-document-mapping'});
                return prior;
            }
            const value = {...item, ...extra}; seen.set(key, value); result.items.push(value); return value;
        } catch (error) {
            const value = {path: path.resolve(environment.context.workspaceRoot, file), reason: error.code || error.reason || 'source-mapping-failed'};
            if (error.code === 'xml-scope-source-missing') result.missing.push(value);
            else if (error.code === 'xml-scope-unsupported-source') result.excluded.push(value);
            else result.unresolved.push(value);
            return null;
        }
    }
    switch (mode) {
    case 'files': if (!options.paths?.length) stop('xml-scope-paths-required'); options.paths.forEach(file => add(file)); break;
    case 'all': enumerate(environment, result).forEach(file => add(file)); break;
    case 'changed': changed(environment, options, result, add); break;
    case 'grep':
        if (typeof options.literal !== 'string' || !options.literal) stop('xml-scope-literal-required');
        for (const file of enumerate(environment, result)) {
            if (catalog.IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
            try { if (new TextDecoder('utf-8', {fatal: true}).decode(fs.readFileSync(file)).includes(options.literal)) add(file); }
            catch { result.unresolved.push({path: file, reason: 'unsupported-search-encoding'}); }
        }
        break;
    case 'page': if (!options.paths?.length || options.paths.length !== 1) stop('xml-scope-page-required'); pageScope(options.paths[0], environment, options, result, add); break;
    default: stop('xml-scope-command-invalid');
    }
    result.total = result.items.length;
    result.imageCount = result.items.filter(item => catalog.IMAGE_EXTENSIONS.has(path.extname(item.sourcePath).toLowerCase())).length;
    result.unresolvedCount = result.unresolved.length;
    if (options.outList) {
        const output = path.resolve(environment.context.workspaceRoot, options.outList), privateWork = path.join(environment.context.contextRoot, 'work');
        const relative = path.relative(environment.context.workspaceRoot, output).toLowerCase().split(path.sep);
        if (!inside(environment.context.workspaceRoot, output) || path.extname(output).toLowerCase() !== '.json' ||
            relative.includes('.git') || relative.includes('.mcp.json') || inside(environment.context.capabilityRoot, output) && !inside(privateWork, output) ||
            environment.roots.some(root => root.target !== environment.context.workspaceRoot && inside(root.target, output))) stop('xml-scope-output-invalid');
        catalog.checkPath(output); catalog.writeAtomic(output, JSON.stringify(result, null, 2) + '\n'); result.outList = output;
    }
    return result;
}
function parseArgs(argv) {
    const options = {command: argv[0], paths: []};
    for (let index = 1; index < argv.length; index++) {
        const value = argv[index];
        if (value === '--with-backend') { options.withBackend = true; continue; }
        if (value === '--json') continue;
        if (['--project-root', '--web-base', '--out-list', '--since'].includes(value)) {
            if (!argv[index + 1] || argv[index + 1].startsWith('--')) stop('xml-scope-option-value-required');
            options[value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index]; continue;
        }
        if (value.startsWith('--')) stop('xml-scope-option-invalid');
        if (options.command === 'grep' && options.literal === undefined) options.literal = value;
        else options.paths.push(value);
    }
    return options;
}
function main(argv = process.argv.slice(2)) {
    if (!argv.length || argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return; }
    const result = query(parseArgs(argv)); console.log(JSON.stringify(result)); return result;
}
if (require.main === module) { try { main(); } catch (error) { console.error(JSON.stringify({schema: 'iris-xml-scope/v1', status: 'blocked', reason: error.code || error.message, details: error.details || {}})); process.exitCode = 1; } }
module.exports = {createEnvironment, sourceRoots, locate, descriptor, parsePorcelain, parseDiff, references, query, parseArgs, main};
