'use strict';

const path = require('node:path');
const {OBJECT_TYPES, TEXT_EXTENSIONS, IMAGE_EXTENSIONS} = require('./baseline-catalog');
const {parseScopeList} = require('./scope-list');

const PAGE_SIZE = 256;
const BACKEND = '%Library.RoutineMgr_StudioOpenDialog(?,1,1,0,1,0,0,,0,1)';
const WEB = '%Library.RoutineMgr_StudioOpenDialog(?,1,1,0,0,0,0,,0,1)';
const backendSuffix = /\.(cls|mac|inc|int)$/i;
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const glob = pattern => new RegExp('^' + escapeRegex(pattern).replaceAll('\\*', '.*').replaceAll('\\?', '.') + '$', 'i');

function fail(code, details = {}) {
    throw Object.assign(new Error(code), {code, details});
}

function parseRules(values) {
    return values.map(value => {
        let rule = value.trim().replaceAll('\\', '/');
        if (/[\x00-\x1f\x7f]/.test(rule)) fail('baseline-scope-rule-invalid');
        if (rule.includes('/')) {
            if (!rule.startsWith('/')) rule = '/' + rule;
            if (rule.endsWith('/')) rule += '*';
            const folder = rule.slice(0, rule.lastIndexOf('/') + 1);
            if (folder === '/' || /[*?]/.test(folder)) fail('baseline-web-scope-invalid', {rule});
            // Reuse the exact-name validator for the directory and literal portions.
            if (!/[*?]/.test(rule)) { parseScopeList(rule); return {rule, exact: true}; }
            parseScopeList(rule.replace(/[*?]/g, 'x') + '.js');
            const pattern = rule.slice(folder.length);
            return {rule, folder, recursive: pattern === '*', prefix: pattern.split(/[*?]/, 1)[0], expression: glob(pattern)};
        }
        if (!/^[%a-z][%a-z0-9*?]*(?:\.[%a-z0-9*?]+)*$/i.test(rule)) fail('baseline-backend-scope-invalid', {rule});
        const suffix = rule.match(backendSuffix)?.[1].toLowerCase();
        if (suffix && !/[*?]/.test(rule)) { parseScopeList(rule); return {rule, exact: true}; }
        const isPackage = !/[*?]/.test(rule);
        const pattern = isPackage ? rule + '.*.cls' : rule;
        const spec = isPackage || suffix === 'cls' ? '*.cls' : suffix ? '*.' + suffix : '*.cls,*.mac,*.inc,*.int';
        return {rule, spec, prefix: pattern.split(/[*?]/, 1)[0], expression: glob(pattern)};
    });
}

async function list(session, columns, table, filters, parameters) {
    const rows = [];
    let cursor;
    for (;;) {
        const after = cursor === undefined ? '' : ' AND %EXACT(Name) > ?';
        const query = `SELECT TOP ${PAGE_SIZE} ${columns} FROM ${table} WHERE ${filters}${after} ORDER BY %EXACT(Name)`;
        const result = await session.call('iris_query', {
            query, parameters: cursor === undefined ? parameters : [...parameters, cursor]
        });
        if (!Array.isArray(result?.rows) || result.count !== result.rows.length ||
            result.has_more || result.truncated || result.rows.length > PAGE_SIZE ||
            result.rows.some(row => typeof row?.Name !== 'string' || !row.Name)) {
            fail('baseline-scope-listing-incomplete');
        }
        rows.push(...result.rows);
        if (result.rows.length < PAGE_SIZE) return rows;
        const next = result.rows.at(-1).Name;
        if (next === cursor) fail('baseline-scope-listing-incomplete');
        cursor = next;
    }
}

async function expand(rules, session) {
    const folders = new Map(), objects = new Map(), names = new Set(), unmatched = [];
    for (const selector of rules) {
        const {rule, expression, folder, recursive, spec, prefix} = selector;
        if (selector.exact) { names.add(rule); continue; }
        const matched = [];
        if (folder) {
            const queue = [folder], visited = new Set();
            for (const directory of queue) {
                if (visited.has(directory)) continue;
                visited.add(directory);
                const spec = directory + (recursive ? '' : prefix) + '*';
                if (!folders.has(spec)) {
                    folders.set(spec, await list(session, 'Name, Type', WEB, 'Type IN (5, 10)', [spec]));
                }
                for (const {Name, Type} of folders.get(spec)) {
                    let child = Name.replaceAll('\\', '/').replace(/\/$/, '');
                    if (child.startsWith(directory)) child = child.slice(directory.length);
                    if (child === '.' || child === '..') continue;
                    if (!child || child.includes('/') || ![5, 10].includes(Number(Type))) fail('baseline-web-listing-invalid', {rule});
                    if (Number(Type) === 10) {
                        if (recursive) {
                            parseScopeList(directory + child + '/x.js');
                            queue.push(directory + child + '/');
                        }
                    } else if (recursive || expression.test(child)) matched.push(directory + child);
                }
            }
        } else {
            const key = spec + '|' + prefix;
            if (!objects.has(key)) {
                objects.set(key, await list(session, 'Name', BACKEND, 'Type IN (0, 4) AND Name %STARTSWITH ?', [spec, prefix]));
            }
            for (const {Name} of objects.get(key)) {
                if (backendSuffix.test(Name) && expression.test(Name)) matched.push(Name);
            }
        }
        if (!matched.length) unmatched.push(rule);
        for (const name of matched) names.add(name);
    }
    if (unmatched.length) fail('baseline-scope-unmatched', {rules: unmatched});

    const included = [], excludedNonCode = [];
    for (const name of [...names].sort()) {
        const extension = path.posix.extname(name).toLowerCase();
        if (name.startsWith('/') && !TEXT_EXTENSIONS.has(extension) && !IMAGE_EXTENSIONS.has(extension)) {
            excludedNonCode.push({name, reason: 'non-code-excluded-from-code-baseline'});
        } else included.push(name.startsWith('/') ? name : name.slice(0, -extension.length) + extension);
    }
    if (!included.some(name => OBJECT_TYPES.has(path.posix.extname(name)) || TEXT_EXTENSIONS.has(path.posix.extname(name).toLowerCase()))) {
        fail('baseline-scope-no-code', {matched: names.size, excludedNonCode: excludedNonCode.length});
    }
    return {text: [...new Set(included)].join('\n') + '\n', excludedNonCode};
}

module.exports = {parseRules, expand};
