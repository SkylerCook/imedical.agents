#!/usr/bin/env node
'use strict';

// Read-only planning/preflight. Creation is performed by the existing Git and
// workspace-overlay tools, never by a second capability installer.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveWorkspaceContext } = require('./lib/workspace-context');
const same = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const segment = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value);
function absolute(value, label) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`${label} must be absolute`);
    return path.resolve(value);
}
function relative(value) {
    if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/).some(p => !p || p === '..' || p === '.')) throw new Error('Unsafe relative path');
    return value;
}
function git(repo, args) {
    const r = spawnSync('git', ['--no-optional-locks', '-C', repo, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    if (r.status !== 0) throw new Error(`Git check failed (${args[0]}): ${r.error?.message || r.stderr.trim()}`);
    return r.stdout.trim();
}
function noLinkedAncestors(target) {
    let current = path.resolve(target);
    while (true) {
        try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Workspace path traverses a link: ${current}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        const parent = path.dirname(current); if (parent === current) break; current = parent;
    }
}
function inspectRepository(source, target, revision, allowProgress) {
    if (!fs.existsSync(target)) return { status: 'create', clean: null };
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Repository worktree must be physical');
    if (!same(git(target, ['rev-parse', '--show-toplevel']), target)) throw new Error('Target is not a Git worktree root');
    const common = repo => fs.realpathSync(path.resolve(repo, git(repo, ['rev-parse', '--git-common-dir'])));
    if (!same(common(source), common(target))) throw new Error('Existing worktree belongs to another repository');
    const entries = git(source, ['worktree', 'list', '--porcelain']).split(/\r?\n/).filter(line => line.startsWith('worktree ')).map(line => line.slice(9));
    if (!entries.some(entry => same(entry, target))) throw new Error('Existing target is not a registered worktree');
    const head = git(target, ['rev-parse', 'HEAD']);
    if (head !== revision) {
        if (!allowProgress) throw new Error('Existing worktree revision differs from explicit ref');
        git(target, ['merge-base', '--is-ancestor', revision, head]);
    }
    const clean = !git(target, ['status', '--porcelain=v1', '--untracked-files=all']);
    if (!clean && !allowProgress) throw new Error('Existing worktree is dirty; preserve and reassess');
    return { status: 'reuse', clean, head };
}
function planWorkspace(request, { allowProgress = false } = {}) {
    const businessWorkspace = absolute(request.businessWorkspace, 'businessWorkspace');
    if (request.runReference) absolute(request.runReference, 'runReference');
    if (!segment(request.batchId) || !segment(request.role) || typeof request.roleOwnerId !== 'string' || !request.roleOwnerId.trim()) throw new Error('Safe batchId, role and explicit roleOwnerId required');
    const origin = resolveWorkspaceContext(businessWorkspace);
    const capabilityRoot = absolute(request.capabilityRoot || origin.capabilityRoot, 'capabilityRoot');
    if (origin.manifestError) throw new Error('Original workspace manifest is invalid');
    if (!fs.existsSync(path.join(capabilityRoot, '.git'))) throw new Error('Shared capability Git missing');
    const worktreeRoot = absolute(request.worktreeRoot || path.join(businessWorkspace, '.worktrees'), 'worktreeRoot');
    const workspaceRoot = path.join(worktreeRoot, request.batchId, request.role);
    noLinkedAncestors(workspaceRoot);
    if (!Array.isArray(request.repositories) || !request.repositories.length) throw new Error('Explicit repositories required');
    const names = new Set();
    const repositories = request.repositories.map(item => {
        if (!segment(item.name) || names.has(item.name.toLowerCase())) throw new Error('Repository names must be safe and unique');
        names.add(item.name.toLowerCase());
        const sourceRepo = fs.realpathSync(absolute(item.sourceRepo, 'sourceRepo'));
        if (!same(git(sourceRepo, ['rev-parse', '--show-toplevel']), sourceRepo)) throw new Error('sourceRepo must be the actual Git root');
        if (typeof item.ref !== 'string' || !item.ref || item.ref.startsWith('-')) throw new Error('Explicit source ref required');
        const revision = git(sourceRepo, ['rev-parse', '--verify', '--end-of-options', `${item.ref}^{commit}`]);
        const target = path.join(workspaceRoot, 'repos', item.name);
        noLinkedAncestors(target);
        return { name: item.name, sourceRepo, ref: item.ref, revision, target, ...inspectRepository(sourceRepo, target, revision, allowProgress) };
    });
    const requiredSkills = request.requiredSkills || [];
    if (!Array.isArray(requiredSkills) || !requiredSkills.length || requiredSkills.some(name => !segment(name))) throw new Error('At least one explicit required skill is needed');
    const requiredScripts = request.requiredScripts || ['scripts/agent-orchestrator.js', 'scripts/run-acceptance.js'];
    if (!Array.isArray(requiredScripts) || !requiredScripts.length) throw new Error('Required scripts must be a nonempty array');
    requiredScripts.forEach(relative);
    const contextReferences = (request.contextReferences || []).map(ref => ({ path: relative(ref.path), source: absolute(ref.source, 'context reference source') }));
    if (!contextReferences.some(ref => ref.path === 'config/plugin_profile.md')) throw new Error('Original plugin_profile context reference required');
    const entrypointReference = absolute(request.entrypointReference || path.join(businessWorkspace, 'AGENTS.md'), 'entrypointReference');
    const requiredRules = request.requiredRules || [];
    if (!Array.isArray(requiredRules)) throw new Error('requiredRules must be an array');
    requiredRules.forEach(relative);
    const manifest = { ...(request.runReference ? { nightRunReference: path.resolve(request.runReference) } : {}), schemaVersion: 1, mode: 'workspace-overlay', workspace: `${request.batchId}-${request.role}`, contextRoot: '.agents', capabilityRoot, sharedDirectories: ['plugins', 'vendor', 'agents', 'workflows'], localDirectories: ['config', 'rules', 'memory', 'skills', 'scripts', 'work'], sourceRoots: repositories.map(repo => ({ name: repo.name, path: `src/${repo.name}`, target: repo.target, gitRoot: repo.target })) };
    return { schema: 'imedical-night-workspace/v1', request: { ...request, businessWorkspace, capabilityRoot, worktreeRoot, entrypointReference, repositories: repositories.map(repo => ({ name: repo.name, sourceRepo: repo.sourceRepo, ref: repo.revision })) }, roleOwnerId: request.roleOwnerId, workspaceRoot, capabilityRoot, originalContextRoot: origin.contextRoot, repositories, requiredSkills, requiredScripts, requiredRules, entrypointReference, contextReferences, manifest, actions: [
        ...repositories.filter(repo => repo.status === 'create').map(repo => ({ executable: 'git', args: ['-C', repo.sourceRepo, 'worktree', 'add', '--detach', repo.target, repo.revision] })),
        { owner: 'agent', action: 'initialize-existing-overlay', script: path.join(capabilityRoot, 'scripts/initialize-workspace-overlay.ps1'), modes: ['DryRun', 'Write', 'Check'], workspaceRoot, instruction: 'Write reviewed manifest, link AGENTS.md to entrypointReference and declared project context files; generate skill/rule thin indexes with existing overlay updater. Never copy credentials or replace local context directories with links.' }
    ], warnings: ['No files or runtime directories written. Agent must perform authorized Git/Overlay setup then rerun check from workspaceRoot.', 'Default business workspaces on Windows should be on the D drive; explicit worktreeRoot overrides are preserved.'] };
}
function checkWorkspace(input) {
    const request = input?.schema === 'imedical-night-workspace/v1' ? input.request : input;
    const issues = []; let plan;
    try { plan = planWorkspace(request, { allowProgress: true }); } catch (error) { return { schema: 'imedical-night-workspace-check/v1', ok: false, roleOwnerId: request?.roleOwnerId, issues: [error.message] }; }
    if (input?.schema === 'imedical-night-workspace/v1') {
        try {
            if (!same(input.workspaceRoot, plan.workspaceRoot) || !same(input.capabilityRoot, plan.capabilityRoot) || input.roleOwnerId !== plan.roleOwnerId || !Array.isArray(input.repositories) || input.repositories.length !== plan.repositories.length || plan.repositories.some(repo => !input.repositories.some(saved => saved.name === repo.name && same(saved.target, repo.target) && same(saved.sourceRepo, repo.sourceRepo) && saved.revision === repo.revision))) issues.push('Saved workspace plan differs from its request');
        } catch { issues.push('Saved workspace plan differs from its request'); }
    }
    for (const repo of plan.repositories) if (repo.status !== 'reuse') issues.push(`Worktree missing: ${repo.name}`);
    try {
        // Execute the existing resolver in a fresh process rooted at the worker's
        // actual cwd, so caller cwd cannot accidentally supply its context.
        const resolver = path.join(plan.capabilityRoot, 'scripts/lib/workspace-context.js');
        const child = spawnSync(process.execPath, ['-e', 'const m=require(process.argv[1]); const c=m.resolveWorkspaceContext(process.cwd()); console.log(JSON.stringify({context:c,issues:m.workspaceContextBlockers(c)}));', resolver], { cwd: plan.workspaceRoot, encoding: 'utf8', windowsHide: true, timeout: 15000 });
        if (child.status !== 0) throw new Error('Worker cwd context resolution failed');
        const loaded = JSON.parse(child.stdout);
        issues.push(...loaded.issues.map(item => item.status));
        const context = loaded.context;
        if (request.runReference && (!context.manifest?.nightRunReference || !same(context.manifest.nightRunReference, path.resolve(request.runReference)))) issues.push('Worker nightRunReference differs from plan');
        if (context.mode !== 'workspace-overlay' || !same(context.capabilityRoot, plan.capabilityRoot)) issues.push('Worker context does not use planned shared capability');
        if (context.sourceRoots.length !== plan.repositories.length || plan.repositories.some(repo => !context.sourceRoots.some(src => src.name === repo.name && same(src.path, path.join(plan.workspaceRoot, 'src', repo.name)) && same(src.target, repo.target) && same(src.gitRoot, repo.target)))) issues.push('Worker SourceRoot/GitRoot differs from plan');
        const entrypoint = path.join(plan.workspaceRoot, 'AGENTS.md');
        if (!same(fs.realpathSync(entrypoint), fs.realpathSync(plan.entrypointReference)) || !fs.readFileSync(entrypoint, 'utf8').trim()) issues.push('Worker AGENTS entrypoint differs from original project');
        for (const ref of plan.contextReferences) {
            const target = path.join(context.contextRoot, ref.path);
            if (!same(fs.realpathSync(target), fs.realpathSync(ref.source))) issues.push(`Context reference does not resolve to original fact source: ${ref.path}`);
            if (!fs.statSync(target).isFile()) throw new Error(`Context reference must be a readable file: ${ref.path}`);
            fs.accessSync(target, fs.constants.R_OK);
        }
        for (const name of plan.requiredSkills) {
            const entry = path.join(context.contextRoot, 'skills', name, 'SKILL.md');
            const text = fs.readFileSync(entry, 'utf8');
            if (!text.trim()) throw new Error(`Empty skill: ${name}`);
            const thinSource = text.match(/^source:\s*(.+?)\s*$/m)?.[1];
            if (/^thin-index:\s*true\s*$/m.test(text)) {
                if (!thinSource) throw new Error(`Thin skill lacks source: ${name}`);
                const canonical = path.resolve(plan.workspaceRoot, relative(thinSource));
                if (!fs.readFileSync(canonical, 'utf8').trim()) throw new Error(`Empty canonical skill: ${name}`);
            }
        }
        for (const rule of plan.requiredRules) {
            const text = fs.readFileSync(path.join(context.contextRoot, 'rules', rule), 'utf8');
            if (!text.trim()) throw new Error(`Empty rule: ${rule}`);
            const source = text.match(/^source:\s*(.+?)\s*$/m)?.[1];
            if (source && !fs.readFileSync(path.resolve(plan.workspaceRoot, relative(source)), 'utf8').trim()) throw new Error(`Empty canonical rule: ${rule}`);
        }
        for (const script of plan.requiredScripts) {
            const canonical = path.join(plan.capabilityRoot, script);
            const output = spawnSync(process.execPath, ['--check', canonical], { cwd: plan.workspaceRoot, encoding: 'utf8', windowsHide: true, timeout: 15000 });
            if (output.status !== 0) throw new Error(`Required script not loadable: ${script}`);
        }
    } catch (error) { issues.push(error.message); }
    return { schema: 'imedical-night-workspace-check/v1', ok: issues.length === 0, roleOwnerId: plan.roleOwnerId, workspaceRoot: plan.workspaceRoot, capabilityRoot: plan.capabilityRoot, issues: [...new Set(issues)], repositories: plan.repositories.map(({ name, target, revision, status, clean, head }) => ({ name, target, revision, status, clean, head })), checkedAt: new Date().toISOString() };
}
if (require.main === module) {
    try {
        const [mode, file] = process.argv.slice(2);
        if (!['plan', 'check'].includes(mode) || !file) throw new Error('Usage: node night-workspace.js plan|check <request-or-plan.json>');
        const input = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        const result = mode === 'plan' ? planWorkspace(input) : checkWorkspace(input);
        console.log(JSON.stringify(result, null, 2));
        if (result.ok === false) process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { planWorkspace, checkWorkspace };
