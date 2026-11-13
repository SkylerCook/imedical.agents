'use strict';

// Built-ins only: the sparse bootstrap can load this module from the selected Git revision.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function git(root, args, options = {}) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options });
    if (result.error || result.status !== 0) throw new Error('Git ' + args[0] + ' failed: ' + (result.stderr || result.error?.message));
    return result.stdout.trim();
}
function readJson(file, fallback) {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function atomicJson(file, value) {
    for (let parent = path.dirname(file); parent !== path.dirname(parent); parent = path.dirname(parent)) {
        if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('Linked deployment state directory');
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Linked deployment state');
    const temporary = file + '.' + crypto.randomUUID() + '.tmp';
    try {
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
        fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function statePath(root) { return path.resolve(root, git(root, ['rev-parse', '--git-path', 'plugin-deployment.json'])); }
function loadState(root) {
    const state = readJson(statePath(root), { schema: 'plugin-installation/v1', mode: 'full', members: [], installed: [], phase: 'ready' });
    if (state.schema !== 'plugin-installation/v1' || !['full', 'on-demand'].includes(state.mode) || !Array.isArray(state.members) || !Array.isArray(state.installed)) throw new Error('Invalid plugin installation state');
    if (state.installed.some(name => !namePattern.test(name)) || state.members.some(member => !member || typeof member.contextRoot !== 'string' || !path.isAbsolute(member.contextRoot) ||
        !Array.isArray(member.lastRequired) || member.lastRequired.some(name => !namePattern.test(name)))) throw new Error('Invalid deployment member record');
    return state;
}
function catalog(root, revision = 'HEAD') {
    const value = JSON.parse(git(root, ['show', revision + ':scripts/lib/plugin-catalog.json']));
    if (value.schema !== 'plugin-catalog/v1' || !Array.isArray(value.plugins)) throw new Error('Invalid plugin catalog');
    const names = new Set();
    for (const item of value.plugins) {
        if (!namePattern.test(item.directory) || !namePattern.test(item.manifest.name) || names.has(item.manifest.name)) throw new Error('Invalid or duplicate catalog plugin');
        names.add(item.manifest.name);
        for (const resource of item.manifest.runtimeResources || []) {
            if (!/^vendor\/[\w-]+$/.test(resource)) throw new Error('Invalid runtime resource for ' + item.manifest.name);
        }
    }
    return value;
}
function profile(contextRoot) {
    const file = path.join(contextRoot, 'config/plugin_profile.md');
    if (!fs.existsSync(file)) return new Map();
    const statuses = new Map();
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/^\|\s*`?([\w-]+)`?\s*\|\s*(enabled|disabled|available|initialized|indexed)\s*\|/gim)) {
        const name = match[1].toLowerCase(), raw = match[2].toLowerCase();
        const status = { initialized: 'enabled', indexed: 'available' }[raw] || raw;
        if (statuses.has(name) && statuses.get(name) !== status) throw new Error('Conflicting plugin profile: ' + name);
        statuses.set(name, status);
    }
    return statuses;
}
function policy(contextRoot) {
    const value = readJson(path.join(contextRoot, 'config/plugin-deployment.json'), { schema: 'plugin-deployment/v1', mode: 'full', autoInstall: false });
    if (value.schema !== 'plugin-deployment/v1' || !['full', 'on-demand'].includes(value.mode) || typeof value.autoInstall !== 'boolean') throw new Error('Invalid project deployment policy');
    return value;
}
function find(catalogValue, name) {
    const matches = catalogValue.plugins.filter(item => item.manifest.name === name || item.directory === name || (item.manifest.legacyNames || []).includes(name));
    if (matches.length !== 1) throw new Error('Unknown or ambiguous plugin: ' + name);
    return matches[0];
}
function statusOf(item, statuses) {
    const values = [item.manifest.name, item.directory, ...(item.manifest.legacyNames || [])].filter(name => statuses.has(name)).map(name => statuses.get(name));
    if (new Set(values).size > 1) throw new Error('Conflicting plugin aliases: ' + item.manifest.name);
    return values[0] || 'available';
}
function versionMatches(version, range) {
    if (!range) return true;
    const parse = value => {
        if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) throw new Error('Invalid dependency version');
        return value.split('.').map(Number);
    };
    const compare = (a, b) => {
        const x = parse(a), y = parse(b);
        return Math.sign(x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
    };
    return compare(version, range.minVersion) >= 0 && compare(version, range.maxVersionExclusive) < 0;
}
function closure(catalogValue, requested, statuses = new Map(), excluded = new Set()) {
    const ordered = [], visiting = new Set(), visited = new Set();
    const conflicts = [];
    function visit(name) {
        const item = find(catalogValue, name), manifest = item.manifest;
        if (excluded.has(manifest.name)) {
            const chain = [...visiting, manifest.name];
            conflicts.push({ code: 'excluded-required-dependency', selected: chain[0], excluded: manifest.name, chain,
                edges: chain.slice(1).map((target, index) => ({ from: chain[index], to: target,
                    requiredVersion: find(catalogValue, chain[index]).manifest.dependencyVersions?.[target] || null,
                    declaration: 'plugins/' + find(catalogValue, chain[index]).directory + '/.agents-plugin/plugin.json' })),
                choices: ['Allow the excluded dependency explicitly', 'Remove the selected capability that requires it'] });
            return;
        }
        if (statusOf(item, statuses) === 'disabled') throw new Error('Plugin explicitly disabled: ' + manifest.name);
        if (visiting.has(manifest.name)) throw new Error('Plugin dependency cycle: ' + manifest.name);
        if (visited.has(manifest.name)) return;
        visiting.add(manifest.name);
        for (const dependency of manifest.dependencies || manifest.dependsOn || []) {
            const target = find(catalogValue, dependency);
            if (!versionMatches(target.manifest.version, manifest.dependencyVersions?.[dependency])) throw new Error('Dependency version incompatible: ' + manifest.name + ' -> ' + dependency);
            visit(dependency);
        }
        visiting.delete(manifest.name); visited.add(manifest.name); ordered.push(item);
    }
    requested.forEach(visit);
    if (conflicts.length) {
        const error = new Error('Required dependencies were excluded: ' + conflicts.map(item => item.chain.join(' -> ')).join('; '));
        error.conflicts = conflicts;
        throw error;
    }
    return ordered;
}
function expandSelection(value, options) {
    const names = new Set(options.all ? value.plugins.map(item => item.manifest.name) : options.plugins || []);
    const excluded = new Set(options.excludePlugins || []);
    for (const [ids, target] of [[options.groups || [], names], [options.excludeGroups || [], excluded]]) {
        for (const id of ids) {
            const group = value.groups.find(item => item.id === id);
            if (!group) throw new Error('Unknown capability group: ' + id);
            group.plugins.forEach(name => target.add(name));
        }
    }
    const canonicalExcluded = new Set([...excluded].map(name => find(value, name).manifest.name));
    const excludedBase = (value.basePlugins || []).filter(name => canonicalExcluded.has(name));
    if (excludedBase.length) {
        const error = new Error('Excluded capabilities are required by the base runtime: ' + excludedBase.join(', '));
        error.conflicts = excludedBase.map(name => ({code:'excluded-base-capability',selected:'base-runtime',excluded:name,chain:['base-runtime',name],
            edges:[{from:'base-runtime',to:name,requiredVersion:null,declaration:'scripts/lib/plugin-catalog.json#basePlugins'}],
            choices:['Keep the base runtime and exclude only general business capabilities','Cancel deployment']}));
        error.excludedGroups = options.excludeGroups || [];
        throw error;
    }
    const selected = [...names].map(name => find(value, name).manifest.name).filter(name => !canonicalExcluded.has(name));
    const conflicts = [];
    for (const name of selected) {
        try { closure(value, [name], new Map(), canonicalExcluded); }
        catch (error) { if (!error.conflicts) throw error; conflicts.push(...error.conflicts); }
    }
    if (conflicts.length) {
        const error = new Error('Selected capabilities require excluded plugins; review all dependency chains');
        error.conflicts = conflicts;
        error.excludedGroups = options.excludeGroups || [];
        throw error;
    }
    return selected;
}
function memberSelection(catalogValue, member) {
    if (!fs.existsSync(member.contextRoot)) return { names: member.lastRequired || [], offline: true };
    if (member.lastRequired?.length && !fs.existsSync(path.join(member.contextRoot,'config/plugin_profile.md'))) {
        return {names:member.lastRequired,offline:true};
    }
    const statuses = profile(member.contextRoot);
    for (const [name,status] of statuses) if (status === 'enabled') find(catalogValue,name);
    const names = catalogValue.plugins.filter(item => statusOf(item, statuses) === 'enabled').map(item => item.manifest.name);
    return { names: closure(catalogValue, [...catalogValue.basePlugins, ...names], statuses).map(item => item.manifest.name), offline: false };
}
function requiredSelection(root, state, catalogValue) {
    const names = new Set(catalogValue.basePlugins), offline = [];
    for (const member of state.members) {
        const selected = memberSelection(catalogValue, member);
        selected.names.forEach(name => names.add(name));
        if (selected.offline) offline.push(member.contextRoot);
    }
    return { names: [...names], offline };
}
function requiredResources(items) {
    const resources = new Set();
    for (const item of items) {
        for (const resource of item.manifest.runtimeResources || []) resources.add(resource);
        for (const dependency of item.manifest.skillDependencies?.required || []) {
            if (!namePattern.test(dependency.provider)) throw new Error('Invalid required vendor provider');
            resources.add('vendor/' + dependency.provider);
        }
    }
    return resources;
}
function sparsePatterns(root, original) {
    const state = loadState(root);
    if (state.mode === 'full') return original;
    const value = catalog(root);
    const required = requiredSelection(root, state, value);
    const selected = closure(value, [...required.names, ...state.installed]);
    const patterns = original.filter(pattern => !pattern.startsWith('/plugins/') && !pattern.startsWith('/vendor/'));
    const resources = requiredResources(selected);
    for (const item of selected) {
        patterns.push('/plugins/' + item.directory + '/**');
    }
    for (const entry of state.optionalSkills || []) {
        const item = find(value, entry.plugin);
        const skill = (item.manifest.skillDependencies?.optional || []).find(skill => skill.capability === entry.capability);
        const provider = skill?.provider || entry.provider;
        if (!namePattern.test(provider || '')) throw new Error('Invalid installed optional skill provider');
        resources.add('vendor/' + provider);
    }
    resources.forEach(resource => patterns.push('/' + resource + '/**'));
    patterns.push('/vendor/knowledge-index/README.md', '/vendor/knowledge-index/.gitattributes');
    return [...new Set(patterns)];
}
function withLock(root, callback) {
    const lock = path.resolve(root, git(root, ['rev-parse', '--git-path', 'plugin-deployment.lock']));
    const existing = readJson(lock, null);
    if (existing?.token && process.env.IMEDICAL_DEPLOYMENT_LOCK === existing.token) return callback();
    let handle;
    try { handle = fs.openSync(lock, 'wx'); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const owner = readJson(lock, {});
        if (!Number.isInteger(owner.pid)) throw new Error('Plugin deployment lock requires inspection');
        try { process.kill(owner.pid, 0); } catch (probe) {
            if (probe.code === 'ESRCH') throw new Error('Interrupted deployment lock; run recover after inspecting installation state');
        }
        throw new Error('Plugin deployment is busy');
    }
    const previous = process.env.IMEDICAL_DEPLOYMENT_LOCK;
    const token = crypto.randomUUID();
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, created: new Date().toISOString(), token }));
    process.env.IMEDICAL_DEPLOYMENT_LOCK = token;
    try { return callback(); } finally {
        if (previous === undefined) delete process.env.IMEDICAL_DEPLOYMENT_LOCK; else process.env.IMEDICAL_DEPLOYMENT_LOCK = previous;
        fs.closeSync(handle); fs.unlinkSync(lock);
    }
}
function acquireLock(root, pid) {
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid lock owner PID');
    const file = path.resolve(root, git(root, ['rev-parse', '--git-path', 'plugin-deployment.lock']));
    const token = crypto.randomUUID();
    let handle;
    try { handle = fs.openSync(file, 'wx'); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Plugin deployment is busy; inspect interrupted owners with recover'); throw error; }
    try { fs.writeFileSync(handle, JSON.stringify({pid,token,created:new Date().toISOString()})); }
    finally { fs.closeSync(handle); }
    return {token};
}
function releaseLock(root, token) {
    const file = path.resolve(root, git(root, ['rev-parse', '--git-path', 'plugin-deployment.lock']));
    if (readJson(file, {})?.token !== token) throw new Error('Deployment lock ownership changed');
    fs.unlinkSync(file);
}
function recoverLock(root) {
    const file = path.resolve(root, git(root, ['rev-parse', '--git-path', 'plugin-deployment.lock']));
    const owner = readJson(file, null);
    if (!owner) return {recovered:false};
    if (!Number.isInteger(owner.pid) || !owner.token) throw new Error('Unknown lock owner; preserve state for inspection');
    try { process.kill(owner.pid, 0); throw new Error('Lock owner is still alive'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    const recovery = file + '.recovery';
    const handle = fs.openSync(recovery, 'wx');
    try { releaseLock(root, owner.token); } finally { fs.closeSync(handle); fs.unlinkSync(recovery); }
    return {recovered:true,next:'Repeat the interrupted operation; existing downloaded files will be reused.'};
}
function plan(context, requested = [], operation = 'ensure', memberRoots = [], optionalCapabilities = []) {
    const root = context.capabilityRoot, value = catalog(root), state = loadState(root), statuses = profile(context.contextRoot);
    const selected = closure(value, requested, statuses);
    const optionalSkills = optionalCapabilities.map(capability => {
        const matches = selected.flatMap(item => (item.manifest.skillDependencies?.optional || []).filter(skill => skill.capability === capability)
            .map(skill => ({plugin:item.manifest.name,capability,provider:skill.provider,name:skill.name})));
        if (matches.length !== 1 || !namePattern.test(matches[0].provider) || !namePattern.test(matches[0].name)) throw new Error('Unknown or ambiguous optional skill: ' + capability);
        return matches[0];
    });
    const members = state.members.filter(member => path.resolve(member.contextRoot) !== path.resolve(context.contextRoot));
    members.push({ contextRoot: context.contextRoot, lastRequired: [] });
    for (const contextRoot of memberRoots) if (!members.some(member => path.resolve(member.contextRoot) === path.resolve(contextRoot))) members.push({contextRoot,lastRequired:[]});
    const required = requiredSelection(root, { ...state, members }, value);
    const keep = closure(value, [...required.names, ...selected.map(item => item.manifest.name)]).map(item => item.manifest.name);
    const installed = value.plugins.filter(item => fs.existsSync(path.join(root, 'plugins', item.directory, '.agents-plugin/plugin.json'))).map(item => item.manifest.name);
    const remove = operation === 'ensure' ? [] : installed.filter(name => !keep.includes(name));
    const missingConfiguration = selected.flatMap(item => (item.manifest.requiresProjectFiles || []).filter(relative => {
        const file = relative.startsWith('.agents/') ? path.join(context.contextRoot,relative.slice(8)) : path.join(context.workspaceRoot,relative);
        return !fs.existsSync(file);
    }).map(relative => ({plugin:item.manifest.name,path:relative})));
    return { operation, revision: git(root, ['rev-parse', 'HEAD']), selected: selected.map(item => item.manifest.name),
        added: selected.filter(item => !installed.includes(item.manifest.name)).map(item => item.manifest.name),
        ready: selected.filter(item => statusOf(item, statuses) === 'enabled' && installed.includes(item.manifest.name)).map(item => item.manifest.name),
        initialization: selected.filter(item => statusOf(item, statuses) !== 'enabled').map(item => ({ plugin: item.manifest.name, skill: item.manifest.initSkill || null,
            source: item.manifest.initSkill ? 'plugins/' + item.directory + '/skills/' + item.manifest.initSkill + '/SKILL.md' : item.manifest.entry })),
        keep, remove, optionalSkills, requiresMigration: state.mode === 'full' && operation === 'prune',
        resources: [...new Set([...requiredResources(closure(value,keep)), ...optionalSkills.map(skill => 'vendor/'+skill.provider)])],
        missingConfiguration, offlineMembers: required.offline, policy: policy(context.contextRoot), members };
}

module.exports = { git, readJson, atomicJson, statePath, loadState, catalog, profile, policy, find, statusOf, closure, expandSelection, versionMatches, memberSelection, requiredSelection, sparsePatterns, withLock, acquireLock, releaseLock, recoverLock, plan };
