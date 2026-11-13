#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const deployment = require('./lib/plugin-deployment');
const { resolveWorkspaceContext, workspaceContextBlockers } = require('./lib/workspace-context');
const { refresh } = require('./refresh-agents-sparse');
const runtimePatterns = ['/agents/**', '/docs/**', '/workflows/**', '/rules/**', '/skills/**', '/plugins/**',
    '/vendor/**', '/feedback/**', '/hooks/**', '/scripts/*.ps1', '/scripts/*.js', '/scripts/lib/**'];

function resolveContext(root) {
    const context = resolveWorkspaceContext(path.resolve(root));
    if (context.mode === 'invalid' || (context.mode !== 'standard' && workspaceContextBlockers(context).length)) throw new Error('Invalid workspace context');
    return context;
}
function preserveAvailable(context, names) {
    const file = path.join(context.contextRoot, 'config/plugin_profile.md');
    for (const target of [path.dirname(file),file]) if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Linked project profile preserved');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Plugin Profile\n\n| plugin | status | initSkill | dependsOn | notes |\n|---|---|---|---|---|\n';
    const newline = before.includes('\r\n') ? '\r\n' : '\n';
    const value = deployment.catalog(context.capabilityRoot), statuses = deployment.profile(context.contextRoot);
    let next = before;
    for (const name of names) {
        const item = deployment.find(value, name);
        if ([name, item.directory, ...(item.manifest.legacyNames || [])].some(alias => statuses.has(alias))) continue;
        if (!next.endsWith('\n')) next += newline;
        next += `| ${name} | available | ${item.manifest.initSkill || '-'} | ${(item.manifest.dependencies || []).join(', ') || '-'} | awaiting initialization |` + newline;
    }
    if (next !== before || !fs.existsSync(file)) {
        if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== before) throw new Error('Plugin profile changed concurrently');
        fs.writeFileSync(file, next);
    }
}
function ignoreLocalConfig(root) {
    const file = path.resolve(root, deployment.git(root, ['rev-parse', '--git-path', 'info/exclude']));
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!before.split(/\r?\n/).includes('/config/')) fs.appendFileSync(file, '\n/config/\n');
}
function initialize(root, contextRoot, autoInstall = false) {
    return deployment.withLock(root, () => {
        const existing = deployment.loadState(root);
        if (existing.members.length || existing.mode !== 'full') throw new Error('Installation already initialized; use configure or migrate');
        ignoreLocalConfig(root);
        deployment.atomicJson(deployment.statePath(root), { ...existing, mode: 'on-demand', members: [{ contextRoot: path.resolve(contextRoot), lastRequired: [] }] });
        deployment.atomicJson(path.join(contextRoot, 'config/plugin-deployment.json'), { schema: 'plugin-deployment/v1', mode: 'on-demand', autoInstall });
        return { mode: 'on-demand', autoInstall };
    });
}
function apply(context, options) {
    const root = context.capabilityRoot;
    return deployment.withLock(root, () => {
        const before = deployment.loadState(root);
        const result = deployment.plan(context, options.plugins, options.action, associatedRoots(context, options.members), options.optionalSkills);
        if (result.requiresMigration) throw new Error('Full deployment requires explicit migrate before pruning');
        if (deployment.git(root, ['status', '--porcelain'])) throw new Error('Capability checkout has local changes; resolve the reported files before deployment');
        if (options.action !== 'ensure' && result.offlineMembers.length) throw new Error('Shared projects unavailable; preserving their resources: ' + result.offlineMembers.join(', '));
        if (options.action === 'migrate' && context.mode !== 'standard' && !options.membersComplete) throw new Error('Overlay migration requires --member-project for associated projects and --members-complete');
        const value = deployment.catalog(root);
        const optionalSkills = [...(before.optionalSkills || [])];
        for (const skill of result.optionalSkills) {
            if (!optionalSkills.some(entry => entry.plugin === skill.plugin && entry.capability === skill.capability)) optionalSkills.push(skill);
        }
        const acquiresResources = result.added.length || optionalSkills.length > (before.optionalSkills || []).length;
        if (options.action === 'ensure' && acquiresResources && !result.policy.autoInstall && !options.explicit) throw new Error('Automatic installation is not authorized; use --explicit for a user-requested installation');
        const required = deployment.requiredSelection(root, { ...before, members: result.members }, value);
        const keep = deployment.closure(value, [...required.names, ...result.selected]).map(item => item.manifest.name);
        const installed = options.action === 'ensure' ? [...new Set([...before.installed, ...keep])] : keep;
        const state = { ...before, mode: options.action === 'migrate' ? 'on-demand' : before.mode, members: result.members,
            installed, optionalSkills: optionalSkills.filter(entry => installed.includes(entry.plugin)), revision: result.revision, phase: 'materializing' };
        for (const member of state.members) {
            const selected = deployment.memberSelection(value, member);
            if (!selected.offline) member.lastRequired = selected.names;
        }
        ignoreLocalConfig(root);
        deployment.atomicJson(deployment.statePath(root), state);
        try {
            refresh(root, runtimePatterns);
            if (deployment.git(root, ['rev-parse', 'HEAD']) !== result.revision) throw new Error('Capability revision changed during installation');
            for (const name of installed) {
                const item = deployment.find(value, name);
                const bytes = fs.readFileSync(path.join(root, 'plugins', item.directory, '.agents-plugin/plugin.json'));
                const actual = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
                if (require('node:crypto').createHash('sha256').update(JSON.stringify(actual)).digest('hex') !== item.manifestHash) throw new Error('Catalog and plugin revision differ: ' + name);
            }
            preserveAvailable(context, result.selected);
            if (options.action === 'migrate') {
                for (const member of state.members) deployment.atomicJson(path.join(member.contextRoot, 'config/plugin-deployment.json'), {
                    ...deployment.policy(member.contextRoot), mode: 'on-demand'
                });
            } else if (state.mode === 'on-demand') {
                deployment.atomicJson(path.join(context.contextRoot,'config/plugin-deployment.json'),{...result.policy,mode:state.mode});
            }
            state.phase = 'ready';
            deployment.atomicJson(deployment.statePath(root), state);
            return { ...result, installed, mode: state.mode, next: result.initialization.length ? 'Read initialization skills in dependency order, complete configuration and verify discovery before enabling.' : 'Ready' };
        } catch (error) {
            state.phase = 'interrupted';
            deployment.atomicJson(deployment.statePath(root), state);
            error.recovery = {phase:state.phase,revision:state.revision,next:'Restore connectivity or resolve the reported conflict, then repeat this operation.'};
            throw error;
        }
    });
}
function associatedRoots(context, projects = []) {
    return projects.map(project => {
        const member = resolveContext(project);
        if (fs.realpathSync(member.capabilityRoot) !== fs.realpathSync(context.capabilityRoot)) throw new Error('Member project uses another capability root');
        return member.contextRoot;
    });
}
function registerMember(context) {
    const root = context.capabilityRoot;
    return deployment.withLock(root, () => {
        const state = deployment.loadState(root);
        if (state.mode === 'full') return {registered:false,mode:'full'};
        let member = state.members.find(item => path.resolve(item.contextRoot) === path.resolve(context.contextRoot));
        if (!member) { member = {contextRoot:context.contextRoot,lastRequired:[]}; state.members.push(member); }
        if (fs.existsSync(path.join(context.contextRoot,'config/plugin_profile.md'))) {
            member.lastRequired = deployment.memberSelection(deployment.catalog(root),member).names;
        }
        ignoreLocalConfig(root);
        deployment.atomicJson(deployment.statePath(root),state);
        const configuration = deployment.policy(context.contextRoot);
        deployment.atomicJson(path.join(context.contextRoot,'config/plugin-deployment.json'),{...configuration,mode:'on-demand'});
        refresh(root,runtimePatterns);
        return {registered:true,contextRoot:context.contextRoot,mode:state.mode};
    });
}
function recommend(workspaceRoot) {
    const groups = new Set(['general']), evidence = [];
    let inspected = 0;
    function scan(directory, depth) {
        if (depth > 5 || inspected >= 3000) return;
        for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
            if (inspected++ >= 3000) return;
            if (entry.isSymbolicLink() || ['.git','.agents','node_modules','vendor','dist'].includes(entry.name)) continue;
            const file = path.join(directory,entry.name);
            if (entry.isDirectory()) { scan(file,depth+1); continue; }
            if (/\.(cls|mac|int)$/i.test(entry.name)) { groups.add('iris'); evidence.push(path.relative(workspaceRoot,file)); }
            if (/\.(csp|vue|tsx|jsx)$/i.test(entry.name)) { groups.add('ui'); if (/\.csp$/i.test(entry.name)) groups.add('iris'); evidence.push(path.relative(workspaceRoot,file)); }
            if (/^(package\.json|README\.md)$/i.test(entry.name) && fs.statSync(file).size < 256000 && /imedicalxc|信创/.test(fs.readFileSync(file,'utf8'))) {
                groups.add('xc'); evidence.push(path.relative(workspaceRoot,file));
            }
        }
    }
    scan(workspaceRoot,0);
    const recommendedPlugins = ['agent-context-kit','agent-framework-evolution'];
    if (groups.has('iris')) recommendedPlugins.push('coding-iris-plugin');
    if (groups.has('ui')) recommendedPlugins.push('imedical-ui');
    if (groups.has('iris') && groups.has('ui')) recommendedPlugins.push('iris-ui');
    if (groups.has('xc')) recommendedPlugins.push('imedicalxc-doctor-extend-engineer');
    return {recommendedGroups:[...groups],recommendedPlugins,evidence:[...new Set(evidence)].slice(0,12),requiresUserSelection:true};
}
function main(argv) {
    if (argv.includes('--help')) return {usage:[
        'plugin-deploy.js groups|recommend|list --project-root <workspace>',
        'plugin-deploy.js plan|ensure --project-root <workspace> [--group general|iris|xc|ui] [--plugin <name>] [--all --exclude-group xc] [--explicit]',
        'plugin-deploy.js configure --project-root <workspace> --auto-install true|false',
        'plugin-deploy.js migrate|prune --project-root <workspace> [--member-project <workspace>] [--members-complete] [--execute]',
        'plugin-deploy.js recover --project-root <workspace>'
    ]};
    const action = argv.shift() || 'list';
    const options = { action, plugins: [], members: [], groups: [], excludeGroups: [], excludePlugins: [], optionalSkills: [] };
    while (argv.length) {
        const key = argv.shift();
        if (['--execute', '--explicit', '--members-complete', '--all'].includes(key)) options[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = true;
        else if (['--project-root', '--plugin', '--group', '--exclude-group', '--exclude-plugin', '--optional-skill', '--member-project', '--auto-install', '--capability-root', '--context-root', '--pid', '--token'].includes(key) && argv.length) {
            const value = argv.shift();
            if (key === '--plugin') options.plugins.push(value);
            else if (key === '--group') options.groups.push(value);
            else if (key === '--exclude-group') options.excludeGroups.push(value);
            else if (key === '--exclude-plugin') options.excludePlugins.push(value);
            else if (key === '--optional-skill') options.optionalSkills.push(value);
            else if (key === '--member-project') options.members.push(value);
            else options[key.slice(2)] = value;
        } else throw new Error('Invalid deployment argument: ' + key);
    }
    if (action === 'initialize') return initialize(path.resolve(options['capability-root']), path.resolve(options['context-root']), options['auto-install'] === 'true');
    if (options['capability-root'] && ['acquire-lock','release-lock'].includes(action)) {
        const root = path.resolve(options['capability-root']);
        if (action === 'acquire-lock') return fs.existsSync(path.join(root,'.git')) ? deployment.acquireLock(root,Number(options.pid)) : {token:null};
        deployment.releaseLock(root,options.token); return {released:true};
    }
    if (!options['project-root']) throw new Error('Explicit --project-root is required');
    if (action === 'acquire-lock') {
        let lockContext;
        try { lockContext = resolveContext(options['project-root']); } catch { return {token:null}; }
        if (!fs.existsSync(path.join(lockContext.capabilityRoot, '.git'))) return {token:null};
        return deployment.acquireLock(lockContext.capabilityRoot, Number(options.pid));
    }
    const context = resolveContext(options['project-root']);
    if (action === 'release-lock') { deployment.releaseLock(context.capabilityRoot, options.token); return {released:true}; }
    if (action === 'recover') return deployment.recoverLock(context.capabilityRoot);
    if (action === 'register') return registerMember(context);
    const catalogValue = deployment.catalog(context.capabilityRoot);
    options.plugins = deployment.expandSelection(catalogValue, options);
    if (action === 'groups') return catalogValue.groups;
    if (action === 'recommend') return recommend(path.resolve(options['project-root']));
    if (action === 'configure') {
        if (!['true', 'false'].includes(options['auto-install'])) throw new Error('--auto-install must be true or false');
        return deployment.withLock(context.capabilityRoot, () => {
            const value = { ...deployment.policy(context.contextRoot), mode: deployment.loadState(context.capabilityRoot).mode, autoInstall: options['auto-install'] === 'true' };
            ignoreLocalConfig(context.capabilityRoot);
            deployment.atomicJson(path.join(context.contextRoot, 'config/plugin-deployment.json'), value);
            return value;
        });
    }
    if (action === 'list') {
        const statuses = deployment.profile(context.contextRoot);
        return deployment.catalog(context.capabilityRoot).plugins.map(item => ({ name: item.manifest.name, description: item.manifest.description,
            prompts: item.manifest.defaultPrompt || [], status: deployment.statusOf(item, statuses),
            installed: fs.existsSync(path.join(context.capabilityRoot, 'plugins', item.directory, '.agents-plugin/plugin.json')) }));
    }
    if (!['plan', 'ensure', 'migrate', 'prune'].includes(action)) throw new Error('Unknown deployment action');
    if (action === 'ensure' && !options.plugins.length) throw new Error('Select at least one --plugin');
    if (action === 'plan' || (action !== 'ensure' && !options.execute)) return deployment.plan(context, options.plugins, action, associatedRoots(context,options.members), options.optionalSkills);
    return apply(context, options);
}

if (require.main === module) {
    try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)); }
    catch (error) {
        console.error(JSON.stringify({error:error.message, conflicts:error.conflicts || [], excludedGroups:error.excludedGroups || [], recovery:error.recovery || null}, null, 2));
        process.exitCode = 1;
    }
}
module.exports = { main, initialize, apply, runtimePatterns, resolveContext };
