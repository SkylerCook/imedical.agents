#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const PLAN_VERSION = 1;
const FRONTEND_EXTENSIONS = new Set(['.js', '.csp', '.css']);
const BACKEND_EXTENSIONS = new Set(['.cls', '.mac', '.inc', '.int']);
const EXPORT_SUBJECT = /^\s*(?:export|sync|init\s*\(\s*export\s*\)|int\s*\(\s*export\s*\))/i;

function main(argv = process.argv.slice(2)) {
    try {
        const parsed = parseArgs(argv);
        if (parsed.command === 'plan') return createPlan(parsed);
        if (parsed.command === 'apply') return applyPlan(loadPlan(required(parsed, 'plan')));
        if (parsed.command === 'continue') return continuePlan(loadPlan(required(parsed, 'plan')));
        if (parsed.command === 'verify') return verifyPlan(loadPlan(required(parsed, 'plan')), true);
        usage(`未知命令: ${parsed.command || '(empty)'}`);
    } catch (error) {
        console.error(`[错误] ${error.message}`);
        process.exitCode = error.exitCode || 1;
    }
}

function parseArgs(argv) {
    const result = { command: argv[0] || '' };
    for (let i = 1; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) throw new Error(`无法识别参数: ${arg}`);
        const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const value = argv[i + 1];
        if (!value || value.startsWith('--')) throw new Error(`参数 ${arg} 缺少值`);
        result[key] = value;
        i++;
    }
    return result;
}

function usage(message) {
    if (message) console.error(`[错误] ${message}`);
    console.error('用法:');
    console.error('  promote-demand.js plan --demand <id> --dev-root <path> --prd-root <path> [--prior-plan <verified-plan.json>]');
    console.error('  promote-demand.js apply --plan <plan.json>');
    console.error('  promote-demand.js continue --plan <plan.json>');
    console.error('  promote-demand.js verify --plan <plan.json>');
    process.exitCode = 1;
}

function required(object, key) {
    if (!object[key]) throw new Error(`缺少 --${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`);
    return object[key];
}

function createPlan(options) {
    const demand = required(options, 'demand').trim();
    if (!/^\d+(?:,\d+)*$/.test(demand)) throw new Error(`需求号格式无效: ${demand}`);
    const devRoot = resolveRepository(required(options, 'devRoot'), 'DEV');
    const prdRoot = resolveRepository(required(options, 'prdRoot'), 'PRD');
    assertClean(devRoot, 'DEV');
    assertClean(prdRoot, 'PRD');

    const devHead = gitText(devRoot, ['rev-parse', 'HEAD']).trim();
    const prdHead = gitText(prdRoot, ['rev-parse', 'HEAD']).trim();
    const priorPlan = options.priorPlan ? loadPlan(options.priorPlan) : null;
    if (priorPlan) validatePriorPlan(priorPlan, devRoot, prdRoot, devHead, prdHead);
    let demandIds = demand.split(',');
    const devMatches = listCommits(devRoot).filter(commit =>
        demandIds.some(id => containsDemand(commit.subject, id)) && !EXPORT_SUBJECT.test(commit.subject));
    if (!devMatches.length) throw new Error(`DEV 当前历史中没有找到需求 ${demand} 的非导出提交`);
    devMatches.reverse();

    const coupledDemandIds = new Set(demandIds);
    for (const commit of devMatches) {
        for (const id of declaredDemandIds(commit.subject)) coupledDemandIds.add(id);
    }
    demandIds = [...coupledDemandIds];
    validateDemandCommitBoundary(devMatches, demandIds);

    const prdCommits = listCommits(prdRoot);
    const prdDemandMatches = prdCommits.filter(commit => demandIds.some(id => containsDemand(commit.subject, id)));
    const prdMessages = gitText(prdRoot, ['log', '--format=%B%x1e']).split('\x1e');
    const selected = [];
    const already = [];
    for (const commit of devMatches) {
        const trailerMatch = prdMessages.some(message => new RegExp(`^Dev-Commit:\\s*${commit.hash}$`, 'mi').test(message));
        const sourcePatchId = patchId(devRoot, commit.hash);
        const legacyMatch = prdDemandMatches.some(target => patchId(prdRoot, target.hash) === sourcePatchId);
        if (trailerMatch || legacyMatch) already.push(Object.assign({}, commit, { sourcePatchId, matchMode: trailerMatch ? 'trailer' : 'patch-id' }));
        else selected.push(Object.assign({}, commit, { sourcePatchId }));
    }

    if (!selected.length) {
        const plan = basePlan({ demand, demandIds, devRoot, prdRoot, devHead, prdHead, devMatches, already, selected, files: [], frontendRoot: readFrontendRoot(prdRoot) });
        plan.status = 'already-promoted';
        savePlan(plan);
        printPlan(plan);
        return plan;
    }

    if (prdDemandMatches.length && !already.length) {
        throw new Error(`PRD 已存在需求号 ${demand}，但没有 Dev-Commit trailer 或等价 patch-id；为避免重复覆盖，需人工确认来源`);
    }

    const frontendRoot = readFrontendRoot(prdRoot);
    const files = collectFiles(devRoot, selected, frontendRoot);
    const blockers = [];
    for (const file of files) {
        const probe = exportDocument(prdRoot, file, { probe: true });
        file.remote = probe;
        const priorFile = priorPlan && priorPlan.files.find(item => normalizeRepoPath(item.path) === file.path);
        if (priorFile && priorBaselineMatches(prdRoot, priorPlan, priorFile, probe)) {
            file.preserveLocalBaseline = true;
            file.priorPlan = priorPlan.planPath;
        }
        if (probe.status === 'not-found' && file.sourceState !== 'A' && !file.preserveLocalBaseline) {
            blockers.push(`${file.path}: DEV 状态 ${file.sourceState}，但 PRD 服务器不存在`);
        }
        if (probe.status === 'found' && file.sourceState === 'A') {
            file.risk = 'name-collision';
        } else if (probe.status === 'found' && file.devBeforeSha256 && probe.sha256 !== file.devBeforeSha256) {
            file.risk = 'baseline-diverged';
        }
        if (!['found', 'not-found'].includes(probe.status)) blockers.push(`${file.path}: PRD 探测失败 (${probe.status})`);
    }

    const plan = basePlan({ demand, demandIds, devRoot, prdRoot, devHead, prdHead, devMatches, already, selected, files, frontendRoot, priorPlan: priorPlan ? priorPlan.planPath : null });
    plan.status = blockers.length ? 'blocked' : 'planned';
    plan.blockers = blockers;
    savePlan(plan);
    printPlan(plan);
    if (blockers.length) {
        const error = new Error(`计划存在 ${blockers.length} 个停止项；未修改 PRD`);
        error.exitCode = 2;
        throw error;
    }
    return plan;
}

function basePlan(values) {
    const planDir = buildPlanDirectory(values);
    return Object.assign({
        version: PLAN_VERSION,
        createdAt: new Date().toISOString(),
        planPath: path.join(planDir, 'plan.json'),
        proposedCommits: {
            baseline: 'export(<PRD IP>):从服务器同步最新文件',
            demand: values.selected.length ? values.selected[0].subject : null
        },
        execution: { mode: 'exact', nextCommitIndex: 0 }
    }, values);
}

function buildPlanDirectory(values) {
    const normalizeIdentityPath = value => {
        const resolved = path.resolve(value).replace(/\\/g, '/');
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const identity = crypto.createHash('sha256')
        .update(`${normalizeIdentityPath(values.devRoot)}\0${normalizeIdentityPath(values.prdRoot)}`)
        .digest('hex')
        .slice(0, 12);
    const repositoryLabel = `${path.basename(values.prdRoot)}-${identity}`;
    return path.join(os.tmpdir(), 'codex-iris-demand-promote', repositoryLabel, values.demand.replace(/,/g, '-'));
}

function collectFiles(devRoot, selected, frontendRoot) {
    const touched = new Set();
    for (const commit of selected) {
        if (commit.parents.length !== 1) throw new Error(`不支持自动移植 merge commit: ${commit.hash}`);
        const output = gitText(devRoot, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', commit.parents[0], commit.hash]);
        for (const line of output.split(/\r?\n/).filter(Boolean)) {
            const parts = line.split('\t');
            if (parts[0].startsWith('R')) {
                touched.add(normalizeRepoPath(parts[1]));
                touched.add(normalizeRepoPath(parts[2]));
            } else {
                touched.add(normalizeRepoPath(parts[1]));
            }
        }
    }
    const base = selected[0].parents[0];
    const finalCommit = selected[selected.length - 1].hash;
    return Array.from(touched).sort().map(filePath => {
        const before = gitObjectExists(devRoot, `${base}:${filePath}`);
        const after = gitObjectExists(devRoot, `${finalCommit}:${filePath}`);
        const sourceState = !before && after ? 'A' : before && !after ? 'D' : 'M';
        const classification = classifyFile(filePath, frontendRoot);
        const devBeforeSha256 = before ? gitObjectSha256(devRoot, `${base}:${filePath}`) : null;
        const devAfterSha256 = after ? gitObjectSha256(devRoot, `${finalCommit}:${filePath}`) : null;
        return Object.assign({ path: filePath, sourceState, before, after, devBeforeSha256, devAfterSha256 }, classification);
    });
}

function classifyFile(filePath, frontendRoot) {
    const normalized = normalizeRepoPath(filePath);
    const ext = path.posix.extname(normalized).toLowerCase();
    const rootPrefix = frontendRoot.endsWith('/') ? frontendRoot : frontendRoot + '/';
    if (normalized.startsWith(rootPrefix)) {
        if (!FRONTEND_EXTENSIONS.has(ext)) throw new Error(`不支持的前端文件类型: ${normalized}`);
        if (!normalized.startsWith('src/')) throw new Error(`前端路径无法映射到 IRIS 文档: ${normalized}`);
        return { kind: 'frontend', extension: ext, document: normalized.slice(4) };
    }
    if (BACKEND_EXTENSIONS.has(ext) && normalized.startsWith('src/')) {
        const relative = normalized.slice(4, -ext.length);
        return { kind: 'backend', extension: ext, document: relative.replace(/\//g, '.') + ext };
    }
    throw new Error(`不支持或超出项目路径边界的文件: ${normalized}`);
}

function readFrontendRoot(root) {
    const profilePath = path.join(root, '.agents', 'config', 'iris_project_profile.md');
    const profile = fs.readFileSync(profilePath, 'utf8').replace(/\\/g, '/');
    const explicit = profile.match(/前端源码根目录\s*[：:]\s*`?([^`\r\n]+)`?/i);
    if (explicit) return normalizeRepoPath(explicit[1].trim()).replace(/\/$/, '');
    const candidates = profile.split(/\r?\n/)
        .filter(line => /前端|CSP|CSS|脚本/i.test(line))
        .flatMap(line => Array.from(line.matchAll(/`(src\/[^`]+)`/g), match => normalizeRepoPath(match[1]).replace(/\/$/, '')));
    if (!candidates.length) throw new Error(`项目 profile 未声明前端源码根目录: ${profilePath}`);
    const common = commonPathPrefix(candidates);
    if (!common || common === 'src') throw new Error(`无法从项目 profile 唯一确定前端源码根目录: ${candidates.join(', ')}`);
    return common;
}

function commonPathPrefix(paths) {
    const parts = paths.map(item => item.split('/'));
    const common = [];
    for (let i = 0; i < Math.min(...parts.map(item => item.length)); i++) {
        if (!parts.every(item => item[i].toLowerCase() === parts[0][i].toLowerCase())) break;
        common.push(parts[0][i]);
    }
    return common.join('/');
}

function exportDocument(prdRoot, file, options = {}) {
    const exportScript = path.join(prdRoot, '.agents', 'plugins', 'coding-iris-plugin', 'scripts', 'iris-tools', 'export.js');
    if (!fs.existsSync(exportScript)) throw new Error(`PRD 缺少 export.js: ${exportScript}`);
    const args = [exportScript, file.document, '--json'];
    if (file.kind === 'frontend') args.push('--basePath', '');
    if (options.probe) args.push('--probe');
    if (options.stagingDir) args.push('--staging-dir', options.stagingDir, '--overwrite');
    const result = spawnSync(process.execPath, args, { cwd: prdRoot, encoding: 'utf8', windowsHide: true });
    const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
    let payload = null;
    for (let i = lines.length - 1; i >= 0; i--) {
        try { payload = JSON.parse(lines[i]); break; } catch (_) { /* continue */ }
    }
    if (result.status === 3 && payload) return payload;
    if (result.status !== 0 || !payload) throw new Error(`导出 ${file.path} 失败: ${(result.stderr || result.stdout || '').trim()}`);
    return payload;
}

function applyPlan(plan) {
    assertPlanReady(plan, 'planned');
    assertHeadsAndClean(plan);
    for (const file of plan.files) {
        const current = exportDocument(plan.prdRoot, file, { probe: true });
        if (current.status !== file.remote.status || current.sha256 !== file.remote.sha256) {
            throw new Error(`PRD 服务器文件在 plan 后发生变化，请重新 plan: ${file.path} (planned=${file.remote.status}/${file.remote.sha256 || '-'}, current=${current.status}/${current.sha256 || '-'})`);
        }
    }

    const stagingDir = path.join(path.dirname(plan.planPath), 'prd-baseline');
    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });
    const staged = [];
    for (const file of plan.files.filter(item => item.remote.status === 'found' && !item.preserveLocalBaseline)) {
        const result = exportDocument(plan.prdRoot, file, { stagingDir });
        if (result.sha256 !== file.remote.sha256) throw new Error(`导出内容哈希漂移: ${file.path}`);
        staged.push({ file, stagedPath: result.path });
    }

    for (const item of staged) {
        const destination = safeRepoFile(plan.prdRoot, item.file.path);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(item.stagedPath, destination);
    }
    stagePlannedFiles(plan, plan.files.filter(item => item.remote.status === 'found' && !item.preserveLocalBaseline));
    if (gitStatus(plan.prdRoot, ['diff', '--cached', '--quiet']) !== 0) {
        const config = JSON.parse(fs.readFileSync(path.join(plan.prdRoot, '.agents', 'config', 'project-env.json'), 'utf8'));
        const host = config.iris && config.iris.host;
        if (!host) throw new Error('PRD project-env.json 缺少 iris.host，无法生成 export(IP) 提交');
        gitText(plan.prdRoot, ['commit', '-m', `export(${host}):从服务器同步最新文件`]);
        plan.execution.exportCommit = gitText(plan.prdRoot, ['rev-parse', 'HEAD']).trim();
    }
    plan.execution.baselineHead = gitText(plan.prdRoot, ['rev-parse', 'HEAD']).trim();
    importSourceObjects(plan);
    savePlan(plan);
    applyRemainingPatches(plan, 0);
    return finishDemandCommit(plan);
}

function continuePlan(plan) {
    assertPlanReady(plan, 'conflict');
    assertConflictResumeHeads(plan);
    const unmerged = gitText(plan.prdRoot, ['diff', '--name-only', '--diff-filter=U']).trim();
    if (unmerged) throw new Error(`仍有未解决冲突:\n${unmerged}`);
    const unstaged = gitText(plan.prdRoot, ['diff', '--name-only']).trim();
    if (unstaged) throw new Error(`冲突解决结果仍有未暂存文件:\n${unstaged}`);
    const untracked = gitText(plan.prdRoot, ['ls-files', '--others', '--exclude-standard']).trim();
    if (untracked) throw new Error(`冲突恢复期间出现未跟踪文件:\n${untracked}`);
    const staged = gitText(plan.prdRoot, ['diff', '--cached', '--name-only']).trim();
    if (!staged) throw new Error('冲突解决后必须先 git add 暂存结果');
    assertOnlyPlannedPaths(plan, staged.split(/\r?\n/));
    plan.execution.mode = 'adapted';
    plan.status = 'applying';
    const next = plan.execution.currentCommitIndex + 1;
    plan.execution.nextCommitIndex = next;
    savePlan(plan);
    applyRemainingPatches(plan, next);
    return finishDemandCommit(plan);
}

function assertConflictResumeHeads(plan) {
    assertClean(plan.devRoot, 'DEV');
    const devHead = gitText(plan.devRoot, ['rev-parse', 'HEAD']).trim();
    if (devHead !== plan.devHead) throw new Error('DEV HEAD 已变化，请重新 plan');
    const expectedPrdHead = plan.execution && plan.execution.baselineHead;
    if (!expectedPrdHead) throw new Error('冲突计划缺少 baselineHead，无法安全继续');
    const prdHead = gitText(plan.prdRoot, ['rev-parse', 'HEAD']).trim();
    if (prdHead !== expectedPrdHead) throw new Error('PRD HEAD 在冲突处理期间发生变化，请停止并重新 plan');
}

function applyRemainingPatches(plan, startIndex) {
    plan.status = 'applying';
    for (let i = startIndex; i < plan.selected.length; i++) {
        const commit = plan.selected[i];
        const patch = gitBuffer(plan.devRoot, ['diff-tree', '--binary', '--full-index', '-p', commit.parents[0], commit.hash]);
        const applied = spawnSync('git', ['-c', `safe.directory=${plan.prdRoot}`, 'apply', '--3way', '--index', '--whitespace=nowarn', '-'], { cwd: plan.prdRoot, input: patch, encoding: null, windowsHide: true });
        if (applied.status !== 0) {
            plan.status = 'conflict';
            plan.execution.currentCommitIndex = i;
            plan.execution.currentCommit = commit.hash;
            plan.execution.nextCommitIndex = i;
            savePlan(plan);
            console.error(`[冲突] ${commit.hash} 应用失败。请按 Skill 做三方语义合并、git add 后运行 continue。`);
            process.exitCode = 20;
            return;
        }
        plan.execution.nextCommitIndex = i + 1;
        savePlan(plan);
    }
}

function finishDemandCommit(plan) {
    if (plan.status === 'conflict') return plan;
    const changed = gitText(plan.prdRoot, ['diff', '--cached', '--name-only']).trim().split(/\r?\n/).filter(Boolean);
    if (!changed.length) throw new Error('DEV 补丁没有产生可提交改动；请检查重复判定');
    assertOnlyPlannedPaths(plan, changed);
    for (const file of plan.files.filter(item => item.kind === 'frontend' && item.sourceState !== 'D')) validateUtf8(path.join(plan.prdRoot, file.path));
    const subject = plan.selected[0].subject;
    const bodyLines = ['DEV source commits:', ...plan.selected.map(item => `- ${item.hash} ${item.subject}`), ''];
    for (const item of plan.selected) bodyLines.push(`Dev-Commit: ${item.hash}`);
    for (const id of plan.demandIds) bodyLines.push(`Demand-Id: ${id}`);
    bodyLines.push(`Promotion-Mode: ${plan.execution.mode}`);
    gitText(plan.prdRoot, ['commit', '-m', subject, '-m', bodyLines.join('\n')]);
    plan.execution.demandCommit = gitText(plan.prdRoot, ['rev-parse', 'HEAD']).trim();
    plan.status = 'committed';
    savePlan(plan);
    return verifyPlan(plan, true);
}

function verifyPlan(plan, print) {
    if (!plan.execution.demandCommit) throw new Error('计划中没有 demandCommit，无法验证');
    validateDemandCommitBoundary(plan.selected || [], plan.demandIds || []);
    assertClean(plan.prdRoot, 'PRD');
    const message = gitText(plan.prdRoot, ['show', '-s', '--format=%B', plan.execution.demandCommit]);
    for (const commit of plan.selected) {
        if (!new RegExp(`^Dev-Commit:\\s*${commit.hash}$`, 'mi').test(message)) throw new Error(`需求提交缺少 Dev-Commit trailer: ${commit.hash}`);
    }
    for (const id of plan.demandIds) {
        if (!new RegExp(`^Demand-Id:\\s*${escapeRegExp(id)}$`, 'mi').test(message)) throw new Error(`需求提交缺少 Demand-Id trailer: ${id}`);
    }
    if (!new RegExp(`^Promotion-Mode:\\s*${escapeRegExp(plan.execution.mode)}$`, 'mi').test(message)) throw new Error(`需求提交缺少或错误的 Promotion-Mode trailer: ${plan.execution.mode}`);
    const committedSubject = gitText(plan.prdRoot, ['show', '-s', '--format=%s', plan.execution.demandCommit]).trim();
    if (committedSubject !== plan.selected[0].subject) throw new Error(`需求提交标题与 DEV 不一致: ${committedSubject}`);
    const changed = gitText(plan.prdRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', plan.execution.demandCommit]).trim().split(/\r?\n/).filter(Boolean);
    assertOnlyPlannedPaths(plan, changed);
    plan.status = 'verified';
    plan.verifiedAt = new Date().toISOString();
    savePlan(plan);
    if (print) {
        console.log(`[完成] export commit: ${plan.execution.exportCommit || '(no baseline changes)'}`);
        console.log(`[完成] demand commit: ${plan.execution.demandCommit}`);
        console.log(`[完成] promotion mode: ${plan.execution.mode}`);
        console.log(`[完成] plan: ${plan.planPath}`);
    }
    return plan;
}

function importSourceObjects(plan) {
    gitText(plan.prdRoot, ['-c', `safe.directory=${plan.devRoot}`, 'fetch', '--no-tags', '--no-write-fetch-head', plan.devRoot, 'HEAD']);
}

function stagePlannedFiles(plan, files) {
    if (!files.length) return;
    gitText(plan.prdRoot, ['add', '-A', '--', ...files.map(item => item.path)]);
}

function assertOnlyPlannedPaths(plan, paths) {
    const allowed = new Set(plan.files.map(item => normalizeRepoPath(item.path)));
    const unexpected = paths.map(normalizeRepoPath).filter(item => item && !allowed.has(item));
    if (unexpected.length) throw new Error(`检测到计划外文件变更: ${unexpected.join(', ')}`);
}

function assertHeadsAndClean(plan) {
    assertClean(plan.devRoot, 'DEV');
    assertClean(plan.prdRoot, 'PRD');
    const devHead = gitText(plan.devRoot, ['rev-parse', 'HEAD']).trim();
    const prdHead = gitText(plan.prdRoot, ['rev-parse', 'HEAD']).trim();
    if (devHead !== plan.devHead) throw new Error('DEV HEAD 已变化，请重新 plan');
    if (prdHead !== plan.prdHead) throw new Error('PRD HEAD 已变化，请重新 plan');
}

function assertPlanReady(plan, expected) {
    if (plan.version !== PLAN_VERSION) throw new Error(`不支持的 plan version: ${plan.version}`);
    if (plan.status !== expected) throw new Error(`计划状态必须为 ${expected}，当前为 ${plan.status}`);
    validateDemandCommitBoundary(plan.selected || [], plan.demandIds || []);
}

function savePlan(plan) {
    fs.mkdirSync(path.dirname(plan.planPath), { recursive: true });
    fs.writeFileSync(plan.planPath, JSON.stringify(plan, null, 2) + '\n', 'utf8');
}

function loadPlan(planPath) {
    const resolved = path.resolve(planPath);
    const plan = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    plan.planPath = resolved;
    return plan;
}

function printPlan(plan) {
    console.log(`需求: ${plan.demand}`);
    console.log(`状态: ${plan.status}`);
    console.log(`DEV HEAD: ${plan.devHead}`);
    console.log(`PRD HEAD: ${plan.prdHead}`);
    console.log(`已移植 DEV commits: ${plan.already.map(item => item.hash.slice(0, 12)).join(', ') || '(none)'}`);
    console.log(`待移植 DEV commits: ${plan.selected.map(item => item.hash.slice(0, 12)).join(', ') || '(none)'}`);
    for (const file of plan.files) console.log(`- ${file.sourceState} ${file.path} [${file.kind}] PRD=${file.remote.status}${file.risk ? ` risk=${file.risk}` : ''}${file.preserveLocalBaseline ? ' preserve=prior-demand' : ''}`);
    for (const blocker of plan.blockers || []) console.log(`! ${blocker}`);
    if (plan.proposedCommits && plan.proposedCommits.demand) {
        console.log(`计划基线提交: ${plan.proposedCommits.baseline}`);
        console.log(`计划需求提交: ${plan.proposedCommits.demand}`);
    }
    console.log(`计划文件: ${plan.planPath}`);
}

function listCommits(root) {
    return gitText(root, ['log', '--format=%H%x1f%P%x1f%s%x1e']).split('\x1e').map(record => record.trim()).filter(Boolean).map(record => {
        const [hash, parents, subject] = record.split('\x1f');
        return { hash, parents: parents ? parents.split(' ') : [], subject };
    });
}

function patchId(root, hash) {
    const patch = gitBuffer(root, ['show', '--format=', hash]);
    const result = spawnSync('git', ['patch-id', '--stable'], { cwd: root, input: patch, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(`计算 patch-id 失败: ${hash}`);
    return String(result.stdout || '').trim().split(/\s+/)[0] || '';
}

function containsDemand(subject, id) {
    return new RegExp(`(^|\\D)${escapeRegExp(id)}(?!\\d)`).test(subject);
}

function declaredDemandIds(subject) {
    const match = String(subject || '').match(/^\s*[a-z][a-z0-9-]*\(([^)]+)\)\s*:/i);
    if (!match) return [];
    const values = match[1].split(/[,，]/).map(value => value.trim()).filter(Boolean);
    return values.length && values.every(value => /^\d+$/.test(value)) ? [...new Set(values)] : [];
}

function validateDemandCommitBoundary(commits, demandIds) {
    if (!Array.isArray(demandIds) || !demandIds.length) throw new Error('计划缺少 Demand-Id');
    const declaredUnion = new Set(commits.flatMap(commit => declaredDemandIds(commit.subject)));
    const omitted = [...declaredUnion].filter(id => !demandIds.includes(id));
    if (omitted.length) throw new Error(`计划遗漏 DEV 提交声明的需求号: ${omitted.join(', ')}`);
    if (demandIds.length <= 1) return;
    const separateCommits = commits.filter(commit => !demandIds.every(id => declaredDemandIds(commit.subject).includes(id)));
    if (separateCommits.length) {
        throw new Error(`不同需求号来自独立 DEV 提交，禁止合并为一笔 PRD 提交: ${demandIds.join(', ')}。请按需求号从旧到新分别 plan；共享未部署文件时为后一笔传入 --prior-plan`);
    }
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveRepository(root, label) {
    const resolved = path.resolve(root);
    if (!fs.existsSync(path.join(resolved, '.git'))) throw new Error(`${label} 不是 Git 仓库: ${resolved}`);
    return resolved;
}

function assertClean(root, label) {
    const status = gitText(root, ['status', '--porcelain']).trim();
    if (status) throw new Error(`${label} 工作区不干净:\n${status}`);
}

function gitObjectExists(root, objectName) {
    return gitStatus(root, ['cat-file', '-e', objectName]) === 0;
}

function gitObjectSha256(root, objectName) {
    return crypto.createHash('sha256').update(gitBuffer(root, ['show', objectName])).digest('hex').toUpperCase();
}

function validatePriorPlan(priorPlan, devRoot, prdRoot, devHead, prdHead) {
    if (priorPlan.version !== PLAN_VERSION || priorPlan.status !== 'verified') throw new Error('--prior-plan 必须是已 verified 的兼容计划');
    if (path.resolve(priorPlan.devRoot) !== devRoot || path.resolve(priorPlan.prdRoot) !== prdRoot) throw new Error('--prior-plan 的 DEV/PRD 仓库与当前计划不一致');
    if (priorPlan.devHead !== devHead) throw new Error('--prior-plan 之后 DEV HEAD 已变化');
    if (!priorPlan.execution || priorPlan.execution.demandCommit !== prdHead) throw new Error('PRD HEAD 必须正好是 --prior-plan 的需求提交');
}

function priorBaselineMatches(prdRoot, priorPlan, priorFile, probe) {
    if (probe.status === 'not-found') return priorFile.remote && priorFile.remote.status === 'not-found' && priorFile.sourceState === 'A';
    if (probe.status !== 'found' || !priorPlan.execution.baselineHead) return false;
    const objectName = `${priorPlan.execution.baselineHead}:${priorFile.path}`;
    if (!gitObjectExists(prdRoot, objectName)) return false;
    return gitObjectSha256(prdRoot, objectName) === probe.sha256;
}

function safeRepoFile(root, relative) {
    const resolvedRoot = path.resolve(root);
    const target = path.resolve(resolvedRoot, relative);
    const rel = path.relative(resolvedRoot, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`路径越出 PRD 仓库: ${relative}`);
    return target;
}

function normalizeRepoPath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function validateUtf8(filePath) {
    if (!fs.existsSync(filePath)) return;
    const bytes = fs.readFileSync(filePath);
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (_) { throw new Error(`前端文件不是有效 UTF-8: ${filePath}`); }
}

function gitBuffer(root, args) {
    const safeArgs = ['-c', `safe.directory=${root}`, ...args];
    const result = spawnSync('git', safeArgs, { cwd: root, encoding: null, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${String(result.stderr || '').trim()}`);
    return result.stdout;
}

function gitText(root, args) {
    const safeArgs = ['-c', `safe.directory=${root}`, ...args];
    const result = spawnSync('git', safeArgs, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${(result.stderr || result.stdout || '').trim()}`);
    return result.stdout;
}

function gitStatus(root, args) {
    return spawnSync('git', ['-c', `safe.directory=${root}`, ...args], { cwd: root, encoding: 'utf8', windowsHide: true }).status;
}

if (require.main === module) main();

module.exports = { buildPlanDirectory, classifyFile, containsDemand, collectFiles, createPlan, declaredDemandIds, main, normalizeRepoPath, patchId, readFrontendRoot, validateDemandCommitBoundary };
