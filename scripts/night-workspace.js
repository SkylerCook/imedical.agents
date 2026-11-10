#!/usr/bin/env node
'use strict';

// Planning/checking remain read-only. Explicit materialization only projects an
// approved run's PLAN into an already-created worker; Git/Overlay setup stays
// with the existing tools.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveWorkspaceContext } = require('./lib/workspace-context');
const nightPlan = require('./lib/night-plan');
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
function checkWorktreeRootIgnored(worktreeRoot) {
    // Inspect the destination's ancestors, not the source repositories: an
    // Overlay workspace can live outside Git or inside a different repository.
    let parent = path.dirname(worktreeRoot);
    while (true) {
        if (fs.existsSync(path.join(parent, '.git'))) {
            const root = git(parent, ['rev-parse', '--show-toplevel']);
            const relativeRoot = path.relative(root, worktreeRoot).split(path.sep).join('/') + '/';
            const result = spawnSync('git', ['--no-optional-locks', '-C', root, 'check-ignore', '--quiet', '--', relativeRoot], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
            if (result.status === 1) throw new Error(`Worktree root is not ignored by Git: ${worktreeRoot}. Add a directory ignore rule in ${root} (.gitignore or local .git/info/exclude), or set worktreeRoot outside Git.`);
            if (result.status !== 0) throw new Error(`Git ignore check failed: ${result.error?.message || result.stderr.trim()}`);
        }
        const next = path.dirname(parent);
        if (next === parent) break;
        parent = next;
    }
}
function planWorkspace(request, { allowProgress = false } = {}) {
    const businessWorkspace = absolute(request.businessWorkspace, 'businessWorkspace');
    if (request.runReference) absolute(request.runReference, 'runReference');
    if (!segment(request.batchId) || !segment(request.role) || typeof request.roleOwnerId !== 'string' || !request.roleOwnerId.trim()) throw new Error('Safe batchId, role and explicit roleOwnerId required');
    const executionPlan = request.executionPlanVersion !== undefined;
    if (executionPlan && (request.executionPlanVersion !== 1 || !request.runReference || !segment(request.roleOwnerId))) throw new Error('Execution PLAN workspace requires version 1, runReference and safe owner');
    const origin = resolveWorkspaceContext(businessWorkspace);
    const capabilityRoot = absolute(request.capabilityRoot || origin.capabilityRoot, 'capabilityRoot');
    if (origin.manifestError) throw new Error('Original workspace manifest is invalid');
    if (!fs.existsSync(path.join(capabilityRoot, '.git'))) throw new Error('Shared capability Git missing');
    const worktreeRoot = absolute(request.worktreeRoot || path.join(businessWorkspace, '.worktrees'), 'worktreeRoot');
    const workspaceRoot = path.join(worktreeRoot, request.batchId, executionPlan ? request.roleOwnerId : request.role);
    noLinkedAncestors(workspaceRoot);
    checkWorktreeRootIgnored(worktreeRoot);
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
const PLAN_RULE = 'night_run_plan.md';
const MANAGED_START = '<!-- night-run-plan:start -->';
const MANAGED_END = '<!-- night-run-plan:end -->';
function isExecutionWorkspace(plan) { return plan.request.executionPlanVersion === 1; }
function commonDirectory(repo) { return fs.realpathSync(path.resolve(repo, git(repo, ['rev-parse', '--git-common-dir']))); }
function currentPlan(plan, supplied) {
    const runDirectory = plan.request.runReference;
    if (!runDirectory) throw new Error('Execution PLAN workspace is not bound to a run');
    // Reuse the event projection loader: a loose caller-provided JSON file is
    // never an alternative authority for materialization.
    const manifest = supplied || require('./agent-orchestrator').loadManifest(runDirectory);
    if (!supplied && (!Number.isSafeInteger(manifest.eventLog?.lastSequence) || manifest.eventLog.lastSequence < 1 || !fs.existsSync(path.join(runDirectory, 'events.jsonl')))) throw new Error('Approved run event history required for PLAN materialization');
    const execution = nightPlan.validateExecutionPlan(manifest);
    if (!execution || !manifest.night?.runReference || !same(manifest.night.runReference, runDirectory)) throw new Error('Execution PLAN run binding differs from workspace');
    const grant = manifest.authorizations?.collaborationPlan;
    if (grant?.state !== 'granted' || grant.revoked || !manifest.orchestration?.planHash || grant.scopeHash !== manifest.orchestration.planHash) throw new Error('Current approved collaborationPlan required to materialize/check PLAN');
    const approvedReference = execution.authorizationReferences.collaborationPlan;
    if (manifest.night.authorizationReferences?.collaborationPlan !== approvedReference || grant.sourceReference && grant.sourceReference !== approvedReference) throw new Error('Execution PLAN approval reference differs from run');
    const worker = execution.workers.find(w => w.ownerId === plan.roleOwnerId);
    if (!worker || !same(worker.workspaceRoot, plan.workspaceRoot) || worker.role !== plan.request.role || !same(worker.entrypointReference, plan.entrypointReference)) throw new Error('Worker identity differs from approved Execution PLAN');
    if (worker.repositories.length !== plan.repositories.length || plan.repositories.some(repo => !worker.repositories.some(saved => saved.name === repo.name && same(saved.sourceRepo, repo.sourceRepo) && same(saved.target, repo.target) && saved.revision === repo.revision && same(saved.sourceIdentity.gitCommonDir, commonDirectory(repo.sourceRepo))))) throw new Error('Worker source identity or fixed base differs from approved Execution PLAN');
    if (worker.requiredRules.some(rule => !plan.requiredRules.includes(rule))) throw new Error('Workspace requiredRules omit an approved role rule');
    const registered = manifest.night.workspaces?.find(w => w.ownerId === plan.roleOwnerId);
    if (!registered?.plan || !same(registered.plan.workspaceRoot, plan.workspaceRoot) || registered.plan.request?.executionPlanVersion !== 1) throw new Error('Worker is not registered in the approved run');
    return { manifest, worker };
}
function managedSection(plan, manifest, worker) {
    const rules = worker.requiredRules.map(rule => path.join(plan.workspaceRoot, '.agents/rules', rule));
    return `${MANAGED_START}\n本批 ${manifest.runId}，owner ${worker.ownerId}，planHash ${manifest.orchestration.planHash}。\n执行本批工作前必须读取原项目入口 [AGENTS.md](${plan.entrypointReference})、本目录 [.agents/rules/${PLAN_RULE}](.agents/rules/${PLAN_RULE}) 及本角色规则：${rules.map(rule => `[${path.basename(rule)}](${rule})`).join('、')}。按当前 action context 的 hash 校验后执行并向既有 run 回传结果。\n${MANAGED_END}`;
}
function localFile(file, root) {
    const relativePath = path.relative(root, file);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new Error('PLAN artifact is outside worker root');
    noLinkedAncestors(path.dirname(file));
    const stat = statIfPresent(file);
    if (stat) {
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error(`PLAN artifact must be a private physical file: ${file}`);
    }
}
function statIfPresent(file) { try { return fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function ruleSources(plan, worker) {
    for (const rule of worker.requiredRules) {
        const file = path.join(plan.workspaceRoot, '.agents/rules', rule);
        const body = fs.readFileSync(file, 'utf8');
        if (!body.trim()) throw new Error(`Empty role rule: ${rule}`);
        const source = body.match(/^source:\s*(.+?)\s*$/m)?.[1];
        if (source && !fs.readFileSync(path.resolve(plan.workspaceRoot, relative(source)), 'utf8').trim()) throw new Error(`Empty canonical role rule: ${rule}`);
    }
}
function artifactRoots(plan) { return [plan.workspaceRoot, ...plan.repositories.map(r => r.target)]; }
function checkPlanArtifacts(plan, manifest, worker) {
    const expectedRule = nightPlan.renderWorkerRule(manifest, plan.roleOwnerId), section = managedSection(plan, manifest, worker);
    const checked = [];
    for (const root of artifactRoots(plan)) {
        const rule = path.join(root, '.agents/rules', PLAN_RULE), entry = path.join(root, 'AGENTS.md');
        localFile(rule, root); localFile(entry, root);
        if (fs.readFileSync(rule, 'utf8') !== expectedRule) throw new Error(`Worker PLAN artifact hash differs from current planHash: ${root}`);
        const body = fs.readFileSync(entry, 'utf8');
        if (!body.includes(section) || body.split(MANAGED_START).length !== 2 || body.split(MANAGED_END).length !== 2) throw new Error(`Worker AGENTS does not load current PLAN: ${root}`);
        // Check each real cwd, including the physical Git entrypoint. Reading
        // the Overlay successfully cannot stand in for a direct worktree read.
        const child = spawnSync(process.execPath, ['-e', 'const fs=require("node:fs"); console.log(JSON.stringify({cwd:process.cwd(),entry:fs.readFileSync("AGENTS.md","utf8"),rule:fs.readFileSync(".agents/rules/night_run_plan.md","utf8")}));'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000 });
        if (child.status !== 0) throw new Error(`Actual worker cwd cannot read PLAN: ${root}`);
        const actual = JSON.parse(child.stdout);
        if (!same(actual.cwd, root) || actual.rule !== expectedRule || !actual.entry.includes(section)) throw new Error(`Actual worker cwd PLAN differs: ${root}`);
        checked.push({ cwd: root, rule, sha256: nightPlan.buildActionContext(manifest, { id: 'workspace-check', ownerId: plan.roleOwnerId }).workerRuleSha256 });
    }
    ruleSources(plan, worker);
    return checked;
}
function materializeWorkspace(input) {
    if (input?.schema !== 'imedical-night-workspace/v1' || input.request?.executionPlanVersion !== 1) throw new Error('materialize requires an explicit Execution PLAN workspace plan');
    const plan = planWorkspace(input.request, { allowProgress: true });
    if (!same(input.workspaceRoot, plan.workspaceRoot) || input.roleOwnerId !== plan.roleOwnerId || plan.repositories.some(r => r.status !== 'reuse')) throw new Error('Materialize requires the already-created planned worker');
    const { manifest, worker } = currentPlan(plan);
    ruleSources(plan, worker);
    if (!fs.readFileSync(plan.entrypointReference, 'utf8').trim()) throw new Error('Approved original project entrypoint must be readable');
    const rendered = nightPlan.renderWorkerRule(manifest, plan.roleOwnerId), section = managedSection(plan, manifest, worker), writes = [];
    for (const root of artifactRoots(plan)) {
        noLinkedAncestors(root);
        const rule = path.join(root, '.agents/rules', PLAN_RULE), entry = path.join(root, 'AGENTS.md');
        localFile(rule, root);
        let original = '';
        let replaceLink = false;
        const entryStat = statIfPresent(entry);
        if (entryStat) {
            if (entryStat.isSymbolicLink()) {
                if (!same(fs.realpathSync(entry), fs.realpathSync(plan.entrypointReference))) throw new Error('Worker AGENTS link does not resolve to approved original entrypoint');
                replaceLink = true;
            } else { localFile(entry, root); original = fs.readFileSync(entry, 'utf8'); }
        }
        const start = original.indexOf(MANAGED_START), end = original.indexOf(MANAGED_END);
        if ((start < 0) !== (end < 0) || end >= 0 && end < start || original.split(MANAGED_START).length > 2 || original.split(MANAGED_END).length > 2) throw new Error('Malformed managed PLAN section; preserve and reassess');
        if (start >= 0 && !original.slice(start, end).includes(`本批 ${manifest.runId}，owner ${worker.ownerId}，`)) throw new Error('Existing managed PLAN section belongs to another run/owner');
        const body = start < 0 ? `${original}${original && !original.endsWith('\n') ? '\n' : ''}\n${section}\n` : original.slice(0, start) + section + original.slice(end + MANAGED_END.length);
        writes.push({ rule, entry, body, replaceLink });
    }
    // All paths and sources are checked before the first mutation. A shared
    // .agents link or an unrelated AGENTS link aborts the whole projection.
    for (const item of writes) {
        fs.mkdirSync(path.dirname(item.rule), { recursive: true });
        fs.writeFileSync(item.rule, rendered, 'utf8');
        if (item.replaceLink) fs.unlinkSync(item.entry);
        fs.writeFileSync(item.entry, item.body, 'utf8');
    }
    return { schema: 'imedical-night-workspace-materialization/v1', ok: true, ownerId: plan.roleOwnerId, planHash: manifest.orchestration.planHash, artifacts: checkPlanArtifacts(plan, manifest, worker) };
}
function checkWorkspace(input, { manifest } = {}) {
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
        if (isExecutionWorkspace(plan)) {
            const binding = currentPlan(plan, manifest);
            checkPlanArtifacts(plan, binding.manifest, binding.worker);
            if (!fs.readFileSync(plan.entrypointReference, 'utf8').trim()) issues.push('Original project entrypoint is empty');
        } else if (!same(fs.realpathSync(entrypoint), fs.realpathSync(plan.entrypointReference)) || !fs.readFileSync(entrypoint, 'utf8').trim()) issues.push('Worker AGENTS entrypoint differs from original project');
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
        if (!['plan', 'check', 'materialize'].includes(mode) || !file) throw new Error('Usage: node night-workspace.js plan|check|materialize <request-or-plan.json>');
        const input = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        const result = mode === 'plan' ? planWorkspace(input) : mode === 'materialize' ? materializeWorkspace(input) : checkWorkspace(input);
        console.log(JSON.stringify(result, null, 2));
        if (result.ok === false) process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { planWorkspace, checkWorkspace, materializeWorkspace };
