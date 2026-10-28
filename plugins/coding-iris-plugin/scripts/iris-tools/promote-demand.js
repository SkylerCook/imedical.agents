#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const PLAN_VERSION = 2;
const { resolveWorkspaceContext } = require('../../../../scripts/lib/workspace-context');
const FRONTEND_EXTENSIONS = new Set(['.js', '.csp', '.css']);
const BACKEND_EXTENSIONS = new Set(['.cls', '.mac', '.inc', '.int']);
const EXPORT_SUBJECT = /^\s*(?:export|sync|init\s*\(\s*export\s*\)|int\s*\(\s*export\s*\))/i;

async function main(argv = process.argv.slice(2)) {
    try {
        const parsed = parseArgs(argv);
        if (parsed.command === 'plan') return await createPlan(parsed);
        if (parsed.command === 'apply') return await withPlanLock(loadPlan(required(parsed, 'plan')), applyPlan);
        if (parsed.command === 'continue') return await withPlanLock(loadPlan(required(parsed, 'plan')), continuePlan);
        if (parsed.command === 'verify') return await withPlanLock(loadPlan(required(parsed, 'plan')), plan => verifyPlan(plan, true));
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
    console.error('  promote-demand.js plan --demand <id> --dev-root <path> --prd-root <path> [--kind project] [--prior-plan <verified-plan.json>] [--source-review <private-review.json>]');
    console.error('  promote-demand.js apply --plan <plan.json>');
    console.error('  promote-demand.js continue --plan <plan.json>');
    console.error('  promote-demand.js verify --plan <plan.json>');
    process.exitCode = 1;
}

function required(object, key) {
    if (!object[key]) throw new Error(`缺少 --${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`);
    return object[key];
}

async function createPlan(options) {
    const demand = required(options, 'demand').trim();
    if (!/^\d+(?:,\d+)*$/.test(demand)) throw new Error(`需求号格式无效: ${demand}`);
    if (options.kind && options.kind !== 'project') throw new Error('promotion-project-demand-required');
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
    const facts = connectionFacts(prdRoot);
    const controlled = require('./source-sync-core').isOnDemand(facts.context) || facts.config.contextMode === 'intent-first-on-demand-export';
    const kind = controlled ? require('./source-sync-core').demandKind(facts.context, options) : null;
    if (kind && kind.kind !== 'project') throw new Error('promotion-project-demand-required');
    const guarded = controlled;
    const environment = guarded ? require('./source-sync-core').environment(facts.context, options) : undefined;

    const prdCommits = listCommits(prdRoot);
    const prdDemandMatches = prdCommits.filter(commit => demandIds.some(id => containsDemand(commit.subject, id)));
    const prdMessages = new Map(prdCommits.map(commit => [commit.hash, gitText(prdRoot, ['show', '-s', '--format=%B', commit.hash])]));
    const reviewCandidates = replayReviewCandidates({devRoot, prdRoot, devHead, prdHead, demandIds}, devMatches);
    let sourceReview, effective;
    if (options.sourceReview) {
        assertPrivatePath(prdRoot, path.resolve(options.sourceReview));
        sourceReview = JSON.parse(fs.readFileSync(path.resolve(options.sourceReview), 'utf8'));
        effective = reviewedCommits(devRoot, devMatches, reviewCandidates, sourceReview);
    } else {
        try { effective = effectiveCommits(devRoot, devMatches); }
        catch (error) {
            if (!error.message.startsWith('replay-review-required')) throw error;
            const reviewFile = path.join(buildPlanDirectory({devRoot, prdRoot, demand, planId: crypto.randomUUID()}), 'source-review-candidates.json');
            assertPrivatePath(prdRoot, reviewFile);
            fs.mkdirSync(path.dirname(reviewFile), {recursive: true, mode: 0o700});
            fs.writeFileSync(reviewFile, JSON.stringify(reviewCandidates, null, 2) + '\n', {flag: 'wx', mode: 0o600});
            if (JSON.parse(fs.readFileSync(reviewFile, 'utf8')).token !== reviewCandidates.token) throw new Error('replay-review-candidates-readback-mismatch');
            console.error(`复核候选: ${reviewFile}`);
            console.error(`复核 token: ${reviewCandidates.token}`);
            throw error;
        }
    }
    const selected = [];
    const already = [];
    for (const commit of effective) {
        const identities = [commit.hash, ...(commit.aliases || [])];
        const trailerMatch = prdCommits.find(target => identities.some(hash => new RegExp(`^Dev-Commit:\\s*${hash}$`, 'mi').test(prdMessages.get(target.hash))));
        const sourcePatchId = patchId(devRoot, commit.hash);
        const legacyMatch = prdDemandMatches.find(target => patchId(prdRoot, target.hash) === sourcePatchId && patchContentId(prdRoot, target.hash) === patchContentId(devRoot, commit.hash));
        const target = trailerMatch || legacyMatch;
        if (target && !targetContentPresent(prdRoot, target, prdHead)) throw new Error('promotion-source-history-content-mismatch: 历史已移植内容不等于当前 PRD 本地层；先核实当前需求层');
        if (target) already.push(Object.assign({}, commit, { sourcePatchId, targetCommit: target.hash, matchMode: trailerMatch ? 'trailer' : 'patch-id' }));
        else selected.push(Object.assign({}, commit, { sourcePatchId }));
    }

    if (!selected.length) {
        const plan = basePlan({ demand, demandIds, devRoot, prdRoot, devHead, prdHead, devMatches, already, selected, sourceReview, files: [], environment, demandKindSource: kind?.source || 'legacy-promotion', frontendRoot: readFrontendRoot(prdRoot) });
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
    const plan = basePlan({ demand, demandIds, devRoot, prdRoot, devHead, prdHead, devMatches, already, selected, sourceReview, files, environment, demandKindSource: kind?.source || 'legacy-promotion', frontendRoot, priorPlan: priorPlan ? priorPlan.planPath : null });
    plan.status = 'reading-baseline'; plan.completedReads = 0; savePlan(plan);
    let remote;
    try {
        remote = await readDocuments(prdRoot, files, (file, result) => {
            file.remote = result.summary;
            if (result.bytes !== null) stageBaseline(plan, file, result.bytes);
            plan.completedReads++; savePlan(plan);
        });
        plan.remoteOperation = remote.operation;
    } catch (error) {
        plan.status = 'blocked'; plan.blockers = [error.code || error.message]; savePlan(plan); throw error;
    }
    for (let i = 0; i < files.length; i++) {
        const file = files[i], probe = remote[i].summary;
        file.remote = probe;
        const priorFile = priorPlan && priorPlan.files.find(item => normalizeRepoPath(item.path) === file.path);
        if (priorFile && priorBaselineMatches(prdRoot, priorPlan, priorFile, probe)) {
            file.preserveLocalBaseline = true;
            file.priorPlan = priorPlan.planPath;
            file.preservedLocalSha256 = gitObjectExists(prdRoot, `${prdHead}:${file.path}`) ? gitObjectSha256(prdRoot, `${prdHead}:${file.path}`) : null;
        } else if (priorFile && !localBaselineMatches(prdRoot, prdHead, file.path, probe)) {
            blockers.push(`${file.path}: 上一笔未部署需求的服务器基线已变化；先同步并复核原需求层`);
        } else if (!priorFile && !localBaselineMatches(prdRoot, prdHead, file.path, probe) && already.some(commit => commitPaths(devRoot, commit).includes(file.path))) {
            // A history trailer is not evidence that a refreshed server baseline
            // still contains a previously committed, possibly undeployed layer.
            blockers.push(`${file.path}: 已移植需求与本次共享文件，必须提供已验证的 --prior-plan 保护当前需求层`);
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

    assertClean(devRoot, 'DEV'); assertClean(prdRoot, 'PRD');
    assertTransactionSnapshot(plan);
    if (gitText(devRoot, ['rev-parse', 'HEAD']).trim() !== devHead || gitText(prdRoot, ['rev-parse', 'HEAD']).trim() !== prdHead) throw new Error('HEAD 在服务器读取期间发生变化，请重新 plan');
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
    const planId = crypto.randomUUID(), context = resolveWorkspaceContext(values.prdRoot);
    const planDir = buildPlanDirectory({...values, planId});
    const {config, mcp} = connectionFacts(values.prdRoot);
    const plan = Object.assign({
        schema: 'iris-demand-promotion/v2', id: planId, planId,
        projectRoot: context.workspaceRoot, contextRoot: context.contextRoot, gitRoot: values.prdRoot,
        guarded: require('./source-sync-core').isOnDemand(context) || config.contextMode === 'intent-first-on-demand-export',
        demandKind: 'project', demandKindSource: values.demandKindSource || 'legacy-promotion',
        configurationFingerprint: require('./source-publication').fingerprint(require('../../../../scripts/lib/iris-remote-operations').bindDevelopmentMode(context, {config, mcp})),
        version: PLAN_VERSION,
        createdAt: new Date().toISOString(),
        planPath: path.join(planDir, 'plan.json'),
        proposedCommits: {
            baseline: 'export(<PRD IP>):从服务器同步最新文件',
            demand: values.selected.length ? values.selected[0].subject : null
        },
        execution: { mode: values.sourceReview ? 'adapted' : 'exact', nextCommitIndex: 0 }
    }, values);
    for (const file of plan.files) {
        file.sourcePath = safeRepoFile(plan.prdRoot, file.path);
        file.gitPath = file.path;
        const mode = gitText(plan.prdRoot, ['ls-files', '-s', '--', file.path]).split(' ')[0];
        file.mode = /^100(?:644|755)$/.test(mode) ? mode : '100644';
    }
    plan.expected = require('./source-sync-core').repositorySnapshot(plan.prdRoot, plan.files);
    plan.execution.outsideIndexHash = outsideIndexHash(plan);
    return plan;
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
    const context = resolveWorkspaceContext(values.prdRoot);
    return path.join(context.contextRoot, 'work', 'source-sync', 'promotions', repositoryLabel, values.demand.replace(/,/g, '-'), values.planId || crypto.randomUUID());
}

function collectFiles(devRoot, selected, frontendRoot) {
    const touched = new Set();
    for (const commit of selected) {
        if (commit.parents.length !== 1) throw new Error(`不支持自动移植 merge commit: ${commit.hash}`);
        const parts = gitBuffer(devRoot, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '-z', commit.parents[0], commit.hash]).toString('utf8').split('\0');
        for (let i = 0; i < parts.length && parts[i];) {
            const status = parts[i++]; touched.add(normalizeRepoPath(parts[i++]));
            if (/^[RC]/.test(status)) touched.add(normalizeRepoPath(parts[i++]));
        }
    }
    const base = selected[0].parents[0];
    const finalCommit = selected[selected.length - 1].hash;
    return Array.from(touched).sort().map(filePath => {
        const before = gitObjectExists(devRoot, `${base}:${filePath}`);
        const after = gitObjectExists(devRoot, `${finalCommit}:${filePath}`);
        const sourceState = !before && after ? 'A' : before && !after ? 'D' : 'M';
        const classification = classifyFile(filePath, frontendRoot);
        if (classification.extension === '.cls') classification.document = require('./backend-document').documentName(filePath,
            gitBuffer(devRoot, ['show', `${after ? finalCommit : base}:${filePath}`]).toString('utf8'));
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
    const profilePath = path.join(resolveWorkspaceContext(root).contextRoot, 'config', 'iris_project_profile.md');
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

function connectionFacts(prdRoot) {
    const context = resolveWorkspaceContext(prdRoot);
    require('../../../../scripts/lib/iris-remote-operations').assertRemoteAllowed(context);
    const {config} = require('./project-env').readProjectEnv(context);
    const mcpPath = path.join(context.workspaceRoot, '.mcp.json');
    let mcp = {};
    try { if (fs.existsSync(mcpPath)) mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8').replace(/^\uFEFF/, '')); }
    catch { throw new Error('project-mcp-invalid'); }
    const guarded = require('./source-sync-core').isOnDemand(context) || config.contextMode === 'intent-first-on-demand-export';
    if (guarded && !fs.existsSync(mcpPath)) throw new Error('source-sync-mcp-required');
    if (fs.existsSync(mcpPath)) require('./project-env').validateTarget(config, mcp.mcpServers?.[config.mcp?.serverName || 'iris-agentic-dev']?.env || {});
    const iris = config.iris || {};
    for (const name of ['host', 'namespace', 'username', 'password']) if (!iris[name] || String(iris[name]).startsWith('TODO')) throw new Error(`PRD project-env 缺少 iris.${name}`);
    if (guarded) for (const name of ['scheme', 'port']) if (!iris[name] || String(iris[name]).startsWith('TODO')) throw new Error(`PRD project-env 缺少 iris.${name}`);
    const protocol = (iris.scheme || 'https') + ':';
    if (!['http:', 'https:'].includes(protocol)) throw new Error('unsupported-iris-protocol');
    const port = Number(iris.port || 2443);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid-iris-port');
    const env = mcp.mcpServers?.[config.mcp?.serverName || 'iris-agentic-dev']?.env || {};
    return {context, config, mcp, connection: {protocol, hostname: iris.host, port,
        path: '/api/atelier/v1/' + encodeURIComponent(iris.namespace) + '/',
        auth: iris.username + ':' + iris.password,
        rejectUnauthorized: String(env.IRIS_TLS_VERIFY ?? iris.tlsVerify ?? true).toLowerCase() !== 'false'}};
}

async function readDocuments(prdRoot, files, onDocument = () => {}) {
    const {context, connection} = connectionFacts(prdRoot);
    const client = require('../../../../scripts/lib/atelier-client').createAtelierClient({connection, context});
    const results = []; let failure;
    try {
        // One bounded client/lease, serial requests and no per-document processes.
        for (const file of files) {
            const document = await client.readDocument(file.document);
            const bytes = document === null ? null : document.bytes;
            if (bytes !== null && !Buffer.isBuffer(bytes)) throw new Error('atelier-export-format-unknown');
            const result = {bytes, summary: bytes === null ? {status: 'not-found'} : {
                status: 'found', document: file.document, sha256: sha(bytes).toUpperCase(),
                ts: document.ts ?? null, representation: document.representation, length: bytes.length}};
            results.push(result); await onDocument(file, result);
        }
        return results;
    } catch (error) { failure = error; throw error; }
    finally {
        results.operation = await client.close();
        if (!failure && results.operation.cleanupVerified === false) throw new Error('promotion-remote-session-exit-unverified');
    }
}

function stageBaseline(plan, file, bytes) {
    const stagedPath = safeRepoFile(path.join(path.dirname(plan.planPath), 'prd-baseline'), file.path);
    assertPrivatePath(plan.prdRoot, stagedPath);
    fs.mkdirSync(path.dirname(stagedPath), {recursive: true, mode: 0o700});
    fs.writeFileSync(stagedPath, bytes, {mode: 0o600});
    if (sha(fs.readFileSync(stagedPath)).toUpperCase() !== file.remote.sha256) throw new Error('promotion-baseline-readback-mismatch');
    return stagedPath;
}

async function applyPlan(plan) {
    assertPlanReady(plan, 'planned');
    assertHeadsAndClean(plan);
    initializeLegacyTransaction(plan);
    assertTransactionSnapshot(plan);
    const documents = await readDocuments(plan.prdRoot, plan.files);
    plan.remoteOperation = documents.operation;
    assertHeadsAndClean(plan);
    assertTransactionSnapshot(plan);
    for (let i = 0; i < plan.files.length; i++) {
        const file = plan.files[i], current = documents[i].summary;
        if (current.status !== file.remote.status || current.sha256 !== file.remote.sha256) {
            throw new Error(`PRD 服务器文件在 plan 后发生变化，请重新 plan: ${file.path} (planned=${file.remote.status}/${file.remote.sha256 || '-'}, current=${current.status}/${current.sha256 || '-'})`);
        }
    }

    const stagingDir = path.join(path.dirname(plan.planPath), 'prd-baseline');
    fs.mkdirSync(stagingDir, { recursive: true });
    const staged = [];
    for (let i = 0; i < plan.files.length; i++) {
        const file = plan.files[i];
        if (file.remote.status !== 'found' || file.preserveLocalBaseline) continue;
        const stagedPath = safeRepoFile(stagingDir, file.path), bytes = documents[i].bytes;
        fs.mkdirSync(path.dirname(stagedPath), {recursive: true});
        fs.writeFileSync(stagedPath, bytes, {mode: 0o600});
        if (sha(fs.readFileSync(stagedPath)).toUpperCase() !== file.remote.sha256) throw new Error(`导出内容哈希漂移: ${file.path}`);
        staged.push({file, stagedPath});
    }

    assertHeadsAndClean(plan);
    assertTransactionSnapshot(plan);
    plan.status = 'applying-baseline'; savePlan(plan);
    for (const item of staged) {
        writeTransactionFile(plan, item.file, fs.readFileSync(item.stagedPath));
    }
    const {config} = connectionFacts(plan.prdRoot), host = config.iris && config.iris.host;
    if (!host) throw new Error('PRD project-env.json 缺少 iris.host，无法生成 export(IP) 提交');
    plan.execution.step = 'baseline-commit'; savePlan(plan);
    const exportCommit = require('./source-sync-core').scopedCommit(plan,
        plan.files.filter(item => item.remote.status === 'found' && !item.preserveLocalBaseline),
        `export(${host}):从服务器同步最新文件\n\n修改说明: 独立保存本次核对的服务器源码基线，不包含需求补丁。\n\nSource-Sync-Plan: ${plan.id}`, savePlan);
    if (exportCommit) plan.execution.exportCommit = exportCommit;
    require('./source-sync-core').restoreTaskIndex(plan, savePlan);
    plan.execution.baselineHead = gitText(plan.prdRoot, ['rev-parse', 'HEAD']).trim();
    plan.status = 'baseline-committed'; savePlan(plan);
    importSourceObjects(plan);
    savePlan(plan);
    applyRemainingPatches(plan, 0);
    return finishDemandCommit(plan);
}

function continuePlan(plan) {
    if (plan.status !== 'conflict') return resumeTransaction(plan);
    assertPlanReady(plan, 'conflict');
    assertConflictResumeHeads(plan);
    const unmerged = gitText(plan.prdRoot, ['diff', '--name-only', '--diff-filter=U']).trim();
    if (unmerged) throw new Error(`仍有未解决冲突:\n${unmerged}`);
    const unstaged = gitText(plan.prdRoot, ['diff', '--name-only']).trim();
    if (unstaged) throw new Error(`冲突解决结果仍有未暂存文件:\n${unstaged}`);
    const untracked = gitText(plan.prdRoot, ['ls-files', '--others', '--exclude-standard']).trim();
    if (untracked) throw new Error(`冲突恢复期间出现未跟踪文件:\n${untracked}`);
    const staged = gitBuffer(plan.prdRoot, ['diff', '--cached', '--name-only', '-z']).toString('utf8').split('\0').filter(Boolean);
    if (!staged.length) throw new Error('冲突解决后必须先 git add 暂存结果');
    assertOnlyPlannedPaths(plan, staged);
    initializeLegacyTransaction(plan);
    assertConflictOutsideIndex(plan);
    plan.expected = require('./source-sync-core').repositorySnapshot(plan.prdRoot, plan.files);
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
        assertConflictResumeHeads(plan);
        assertTransactionSnapshot(plan);
        // cacheinfo restores object identities without stat information. Refresh
        // only metadata before Git's --index worktree equality check.
        gitText(plan.prdRoot, ['update-index', '--refresh']);
        assertTransactionSnapshot(plan);
        const commit = plan.selected[i];
        plan.execution.currentCommitIndex = i; plan.execution.currentCommit = commit.hash; savePlan(plan);
        const patch = gitBuffer(plan.devRoot, ['diff-tree', '--binary', '--full-index', '-p', commit.parents[0], commit.hash]);
        const predictedIndex = predictPatchIndex(plan, patch);
        // The real index must be exactly the result of applying our patch. A
        // concurrent stage operation cannot be accepted by refreshing a snapshot.
        assertTransactionSnapshot(plan);
        plan.execution.pendingPatch = {index: i, predictedIndex}; savePlan(plan);
        const applied = spawnSync('git', ['-c', `safe.directory=${plan.prdRoot}`, 'apply', '--3way', '--index', '--whitespace=nowarn', '-'], { cwd: plan.prdRoot, input: patch, encoding: null, windowsHide: true });
        try { acceptPatchIndex(plan, predictedIndex, applied.status === 0); }
        catch (error) { if (applied.status !== 0) error.message += `: ${String(applied.stderr || '').trim()}`; throw error; }
        plan.execution.pendingPatch = null;
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
    assertConflictResumeHeads(plan);
    const changed = gitBuffer(plan.prdRoot, ['diff', '--cached', '--name-only', '-z']).toString('utf8').split('\0').filter(Boolean);
    if (!changed.length) throw new Error('DEV 补丁没有产生可提交改动；请检查重复判定');
    assertOnlyPlannedPaths(plan, changed);
    for (const file of plan.files) {
        const entry = gitText(plan.prdRoot, ['ls-files', '-s', '--', file.path]);
        if (entry) {
            if (!/^100(?:644|755) [a-f0-9]+ 0\t/.test(entry)) throw new Error('promotion-source-mode-unsupported');
            file.mode = entry.split(' ')[0];
        }
    }
    for (const file of plan.files.filter(item => item.kind === 'frontend' && item.sourceState !== 'D')) validateUtf8(path.join(plan.prdRoot, file.path));
    const subject = plan.selected[0].subject;
    const bodyLines = ['DEV source commits:', ...plan.selected.map(item => `- ${item.hash} ${item.subject}`), ''];
    bodyLines.unshift('修改说明: 将已核对的 DEV 需求补丁应用到 PRD 本地服务器基线，保留独立需求边界和来源。', '');
    for (const item of plan.selected) for (const hash of [item.hash, ...(item.aliases || [])]) bodyLines.push(`Dev-Commit: ${hash}`);
    if (plan.sourceReview) {
        bodyLines.push(`Replay-Review-Token: ${plan.sourceReview.token}`);
        for (const item of plan.selected) for (const source of item.supersededSources || []) bodyLines.push(`Supersedes-Dev-Commit: ${source.hash} ${item.hash}`);
    }
    for (const id of plan.demandIds) bodyLines.push(`Demand-Id: ${id}`);
    bodyLines.push(`Promotion-Mode: ${plan.execution.mode}`);
    bodyLines.push(`Source-Sync-Plan: ${plan.id}`, `Baseline-Commit: ${plan.execution.baselineHead}`, `Replay-Mode: ${plan.execution.mode}`);
    for (const item of plan.selected) for (const hash of [item.hash, ...(item.aliases || [])]) bodyLines.push(`Replay-Of: ${hash}`);
    plan.execution.step = 'change-commit';
    plan.status = 'committing'; savePlan(plan);
    plan.execution.demandCommit = require('./source-sync-core').scopedCommit(plan, plan.files, `${subject}\n\n${bodyLines.join('\n')}`, savePlan);
    if (!plan.execution.demandCommit) throw new Error('promotion-demand-commit-empty');
    require('./source-sync-core').restoreTaskIndex(plan, savePlan);
    plan.status = 'committed';
    savePlan(plan);
    return verifyPlan(plan, true);
}

function assertTransactionSnapshot(plan) {
    if (!plan.expected) throw new Error('promotion-transaction-snapshot-required: 请重新 plan');
    const core = require('./source-sync-core');
    if (core.canonical(core.repositorySnapshot(plan.prdRoot, plan.files)) !== core.canonical(plan.expected)) throw new Error('promotion-repository-drift');
}

function initializeLegacyTransaction(plan) {
    if (plan.version !== 1 || plan.expected) return;
    plan.gitRoot = plan.prdRoot; plan.id ||= crypto.randomUUID();
    for (const file of plan.files) {
        file.sourcePath = safeRepoFile(plan.prdRoot, file.path); file.gitPath = file.path;
        const mode = gitText(plan.prdRoot, ['ls-files', '-s', '--', file.path]).split(' ')[0];
        file.mode = /^100(?:644|755)$/.test(mode) ? mode : '100644';
    }
    plan.expected = require('./source-sync-core').repositorySnapshot(plan.prdRoot, plan.files);
    plan.execution.outsideIndexHash = outsideIndexHash(plan); savePlan(plan);
}

function writeTransactionFile(plan, file, bytes) {
    assertTransactionSnapshot(plan);
    const destination = safeRepoFile(plan.prdRoot, file.path), after = sha(bytes);
    if (plan.expected.files[file.path] === after) return;
    plan.execution.pendingWrite = {path: file.path, before: plan.expected.files[file.path], after}; savePlan(plan);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    const temporary = destination + '.' + crypto.randomUUID() + '.tmp';
    try {
        fs.writeFileSync(temporary, bytes, {flag: 'wx', mode: file.mode === '100755' ? 0o755 : 0o644});
        assertTransactionSnapshot(plan);
        fs.renameSync(temporary, destination);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    plan.expected.files[file.path] = after;
    plan.execution.pendingWrite = null; savePlan(plan);
}

function outsideIndexHash(plan, env = {}) {
    const entries = require('./source-sync-core').git(plan.prdRoot, ['ls-files', '--stage', '-v', '-z'], {env}).toString('utf8').split('\0');
    const owned = new Set(plan.files.map(file => file.path));
    return sha(entries.filter(entry => entry && !owned.has(entry.slice(entry.indexOf('\t') + 1))).join('\0'));
}

function assertConflictOutsideIndex(plan) {
    if (outsideIndexHash(plan) !== plan.execution.outsideIndexHash) throw new Error('promotion-plan-external-index-drift');
}

function predictPatchIndex(plan, patch) {
    const privateIndex = path.join(path.dirname(plan.planPath), `patch-index-${crypto.randomUUID()}`);
    const actualIndex = path.resolve(plan.prdRoot, gitText(plan.prdRoot, ['rev-parse', '--git-path', 'index']).trim());
    if (plan.version === PLAN_VERSION) assertPrivatePath(plan.prdRoot, privateIndex);
    try {
        fs.copyFileSync(actualIndex, privateIndex);
        const env = {...process.env, GIT_INDEX_FILE: privateIndex};
        const predicted = spawnSync('git', ['-c', `safe.directory=${plan.prdRoot}`, 'apply', '--cached', '--3way', '--whitespace=nowarn', '-'], {cwd: plan.prdRoot, input: patch, env, windowsHide: true});
        if (predicted.error || predicted.signal || predicted.status === null) throw new Error('promotion-patch-preview-failed');
        const core = require('./source-sync-core');
        return {indexHash: sha(core.git(plan.prdRoot, ['ls-files', '--stage', '-v', '-z'], {env: {GIT_INDEX_FILE: privateIndex}})), success: predicted.status === 0};
    } finally {
        for (const file of [privateIndex, privateIndex + '.lock']) if (fs.existsSync(file)) fs.unlinkSync(file);
    }
}

function acceptPatchIndex(plan, predicted, success) {
    const core = require('./source-sync-core'), actual = core.repositorySnapshot(plan.prdRoot, plan.files);
    if (actual.head !== plan.expected.head || actual.indexHash !== predicted.indexHash || success !== predicted.success) throw new Error(`promotion-patch-result-drift: head=${actual.head === plan.expected.head}, index=${actual.indexHash === predicted.indexHash}, apply=${success}/${predicted.success}`);
    assertConflictOutsideIndex(plan);
    for (const args of [['diff', '--cached', '--name-only', '-z'], ['diff', '--name-only', '-z'], ['ls-files', '--others', '--exclude-standard', '-z']]) {
        assertOnlyPlannedPaths(plan, gitBuffer(plan.prdRoot, args).toString('utf8').split('\0').filter(Boolean));
    }
    if (success && gitStatus(plan.prdRoot, ['diff', '--quiet']) !== 0) throw new Error('promotion-patch-worktree-drift');
    plan.expected = actual;
}

function resumeTransaction(plan) {
    const resumable = ['applying-baseline', 'baseline-committed', 'applying', 'committing', 'committed'];
    if (!resumable.includes(plan.status)) throw new Error(`计划状态无法继续: ${plan.status}`);
    const originalStatus = plan.status, core = require('./source-sync-core');
    assertPlanReady(plan, originalStatus);
    assertClean(plan.devRoot, 'DEV');
    if (gitText(plan.devRoot, ['rev-parse', 'HEAD']).trim() !== plan.devHead) throw new Error('DEV HEAD 已变化，请重新 plan');
    if (plan.execution.pendingPatch) {
        const pending = plan.execution.pendingPatch;
        const actual = core.repositorySnapshot(plan.prdRoot, plan.files);
        const notStarted = core.canonical(actual) === core.canonical(plan.expected);
        if (!notStarted) acceptPatchIndex(plan, pending.predictedIndex, pending.predictedIndex.success);
        plan.execution.pendingPatch = null;
        if (!notStarted && !pending.predictedIndex.success) {
            plan.status = 'conflict'; savePlan(plan);
            throw new Error('promotion-patch-conflict: 请完成语义合并并暂存后再次 continue');
        }
        plan.execution.nextCommitIndex = pending.index + (notStarted ? 0 : 1); savePlan(plan);
    }
    core.recoverPending(plan, savePlan);
    if (plan.execution.demandCommit) {
        core.restoreTaskIndex(plan, savePlan);
        return verifyPlan(plan, true);
    }
    if (originalStatus === 'applying-baseline') {
        // A stopped baseline write/commit can resume only from the privately
        // verified bytes; source CAS and the original target HEAD stay binding.
        for (const file of plan.files.filter(item => item.remote.status === 'found' && !item.preserveLocalBaseline)) {
            const stored = fs.readFileSync(safeRepoFile(path.join(path.dirname(plan.planPath), 'prd-baseline'), file.path));
            if (sha(stored).toUpperCase() !== file.remote.sha256) throw new Error('promotion-baseline-readback-mismatch');
            writeTransactionFile(plan, file, stored);
        }
        if (!plan.execution.exportCommit) {
            const {config} = connectionFacts(plan.prdRoot);
            plan.execution.step = 'baseline-commit'; savePlan(plan);
            const committed = core.scopedCommit(plan, plan.files.filter(item => item.remote.status === 'found' && !item.preserveLocalBaseline),
                `export(${config.iris.host}):从服务器同步最新文件\n\n修改说明: 独立保存本次核对的服务器源码基线，不包含需求补丁。\n\nSource-Sync-Plan: ${plan.id}`, savePlan);
            if (committed) plan.execution.exportCommit = committed;
        }
        plan.execution.baselineHead = plan.expected.head;
        plan.status = 'baseline-committed'; savePlan(plan);
    }
    if (plan.status === 'baseline-committed') core.restoreTaskIndex(plan, savePlan);
    if (!plan.execution.baselineHead) throw new Error('promotion-baseline-head-required');
    if (originalStatus === 'committing') return finishDemandCommit(plan);
    importSourceObjects(plan);
    applyRemainingPatches(plan, plan.execution.nextCommitIndex || 0);
    return finishDemandCommit(plan);
}

function verifyPlan(plan, print) {
    if (!plan.execution.demandCommit) throw new Error('计划中没有 demandCommit，无法验证');
    assertPlanReady(plan, plan.status);
    if (plan.version === PLAN_VERSION) assertTransactionSnapshot(plan);
    validateDemandCommitBoundary(plan.selected || [], plan.demandIds || []);
    assertClean(plan.prdRoot, 'PRD');
    if (gitText(plan.prdRoot, ['rev-parse', 'HEAD']).trim() !== plan.execution.demandCommit) throw new Error('PRD HEAD 已离开本次需求提交，不能验证或发布旧计划');
    const message = gitText(plan.prdRoot, ['show', '-s', '--format=%B', plan.execution.demandCommit]);
    for (const commit of plan.selected) for (const hash of [commit.hash, ...(commit.aliases || [])]) {
        if (!new RegExp(`^Dev-Commit:\\s*${hash}$`, 'mi').test(message)) throw new Error(`需求提交缺少 Dev-Commit trailer: ${hash}`);
    }
    for (const id of plan.demandIds) {
        if (!new RegExp(`^Demand-Id:\\s*${escapeRegExp(id)}$`, 'mi').test(message)) throw new Error(`需求提交缺少 Demand-Id trailer: ${id}`);
    }
    if (!new RegExp(`^Promotion-Mode:\\s*${escapeRegExp(plan.execution.mode)}$`, 'mi').test(message)) throw new Error(`需求提交缺少或错误的 Promotion-Mode trailer: ${plan.execution.mode}`);
    const committedSubject = gitText(plan.prdRoot, ['show', '-s', '--format=%s', plan.execution.demandCommit]).trim();
    if (committedSubject !== plan.selected[0].subject) throw new Error(`需求提交标题与 DEV 不一致: ${committedSubject}`);
    const changed = gitBuffer(plan.prdRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', plan.execution.demandCommit]).toString('utf8').split('\0').filter(Boolean);
    assertOnlyPlannedPaths(plan, changed);
    plan.status = 'verified';
    plan.verifiedAt = new Date().toISOString();
    if (plan.guarded && !plan.publication) freezePublication(plan);
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
    if (![1, PLAN_VERSION].includes(plan.version)) throw new Error(`不支持的 plan version: ${plan.version}`);
    if (plan.status !== expected) throw new Error(`计划状态必须为 ${expected}，当前为 ${plan.status}`);
    validateDemandCommitBoundary(plan.selected || [], plan.demandIds || []);
    if (plan.version === PLAN_VERSION) {
        const {context, config, mcp} = connectionFacts(plan.prdRoot);
        const guarded = require('./source-sync-core').isOnDemand(context) || config.contextMode === 'intent-first-on-demand-export';
        if (require('./source-publication').fingerprint(require('../../../../scripts/lib/iris-remote-operations').bindDevelopmentMode(context, {config, mcp})) !== plan.configurationFingerprint || guarded !== plan.guarded) throw new Error('promotion-configuration-changed');
        if (plan.guarded) require('./source-sync-core').environment(context, plan.environment || {});
        if (plan.sourceReview) {
            const candidates = replayReviewCandidates(plan, plan.devMatches);
            const reviewed = reviewedCommits(plan.devRoot, plan.devMatches, candidates, plan.sourceReview);
            if (plan.selected.some(item => !reviewed.some(source => source.hash === item.hash))) throw new Error('replay-review-selected-source-mismatch');
        }
    }
    for (const commit of plan.selected || []) {
        const actual = gitText(plan.devRoot, ['show', '-s', '--format=%P%x1f%s', commit.hash]).trim().split('\x1f');
        if (actual[0] !== commit.parents.join(' ') || actual[1] !== commit.subject || patchId(plan.devRoot, commit.hash) !== commit.sourcePatchId) throw new Error('DEV 来源提交与计划不一致');
        for (const alias of commit.aliases || []) if (!samePatch(plan.devRoot, commit.hash, plan.devRoot, alias)) throw new Error('重放来源内容已不匹配');
    }
}

function savePlan(plan) {
    if (plan.version === PLAN_VERSION) assertPrivatePath(plan.prdRoot, plan.planPath);
    if (plan.version === PLAN_VERSION) {
        const {integrity, ...body} = JSON.parse(JSON.stringify(plan));
        plan.integrity = require('./source-publication').fingerprint(body);
    }
    fs.mkdirSync(path.dirname(plan.planPath), { recursive: true, mode: 0o700 });
    const temporary = plan.planPath + '.' + crypto.randomUUID() + '.tmp';
    try {
        fs.writeFileSync(temporary, JSON.stringify(plan, null, 2) + '\n', {encoding: 'utf8', mode: 0o600, flag: 'wx'});
        fs.renameSync(temporary, plan.planPath);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function loadPlan(planPath) {
    const resolved = path.resolve(planPath);
    const plan = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    if (plan.version === PLAN_VERSION) {
        const {integrity, ...body} = plan;
        if (require('./source-publication').fingerprint(body) !== integrity) throw new Error('promotion-plan-integrity-mismatch');
        assertPrivatePath(plan.prdRoot, resolved);
        if (path.resolve(plan.planPath) !== resolved || path.resolve(buildPlanDirectory(plan), 'plan.json') !== resolved) throw new Error('计划路径身份不匹配');
    }
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

const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function patchContentId(root, hash) {
    // patch-id alone ignores whitespace. Preserve every context and changed byte;
    // ignore only object ids and hunk coordinates when recognizing an exact replay.
    return sha(gitBuffer(root, ['show', '--format=', '--binary', '--full-index', hash]).toString('latin1')
        .replace(/^index [0-9a-f]+\.\.[0-9a-f]+(?: \d+)?\r?\n/gm, '')
        .replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/gm, '@@'));
}

function samePatch(leftRoot, left, rightRoot, right) {
    return Boolean(patchId(leftRoot, left)) && patchId(leftRoot, left) === patchId(rightRoot, right) && patchContentId(leftRoot, left) === patchContentId(rightRoot, right);
}

function replayReviewCandidates(identity, commits) {
    const sources = commits.map(commit => ({hash: commit.hash, parents: commit.parents, subject: commit.subject,
        demandIds: declaredDemandIds(commit.subject), patchId: patchId(identity.devRoot, commit.hash), contentHash: patchContentId(identity.devRoot, commit.hash),
        files: commitPaths(identity.devRoot, commit).map(file => ({path: file,
            beforeSha256: gitObjectExists(identity.devRoot, `${commit.parents[0]}:${file}`) ? gitObjectSha256(identity.devRoot, `${commit.parents[0]}:${file}`) : null,
            afterSha256: gitObjectExists(identity.devRoot, `${commit.hash}:${file}`) ? gitObjectSha256(identity.devRoot, `${commit.hash}:${file}`) : null}))}));
    const binding = {devRoot: path.resolve(identity.devRoot), prdRoot: path.resolve(identity.prdRoot), devHead: identity.devHead,
        prdHead: identity.prdHead, demandIds: identity.demandIds, sources};
    return {schema: 'iris-replay-review-candidates/v1', ...binding, token: require('./source-publication').fingerprint(binding), allowedActions: ['keep-all', 'select']};
}

function reviewedCommits(root, commits, candidates, review) {
    const binding = {devRoot: review.devRoot, prdRoot: review.prdRoot, devHead: review.devHead, prdHead: review.prdHead, demandIds: review.demandIds, sources: review.sources};
    if (review.schema !== 'iris-replay-review/v1' || review.token !== candidates.token || require('./source-publication').fingerprint(binding) !== candidates.token ||
        !['keep-all', 'select'].includes(review.action) || typeof review.evidence !== 'string' || !review.evidence.trim()) throw new Error('replay-review-binding-invalid');
    const hashes = commits.map(commit => commit.hash), selected = review.action === 'keep-all' ? hashes : review.selected;
    if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length || selected.some(hash => !hashes.includes(hash))) throw new Error('replay-review-selection-invalid');
    if (review.action === 'keep-all' && review.selected && (review.selected.length !== hashes.length || hashes.some(hash => !review.selected.includes(hash)))) throw new Error('replay-review-selection-invalid');
    const omitted = review.omitted || [], dropped = hashes.filter(hash => !selected.includes(hash));
    if (!Array.isArray(omitted) || omitted.length !== dropped.length || new Set(omitted.map(item => item.hash)).size !== omitted.length || omitted.some(item => !dropped.includes(item.hash))) throw new Error('replay-review-omissions-incomplete');
    const result = commits.filter(commit => selected.includes(commit.hash)).map(commit => ({...commit, aliases: [], supersededSources: []}));
    for (const item of omitted) {
        const equivalent = typeof item.equivalentTo === 'string', superseded = typeof item.supersededBy === 'string';
        const target = item.equivalentTo || item.supersededBy;
        if (equivalent === superseded || !selected.includes(target) || typeof item.evidence !== 'string' || !item.evidence.trim()) throw new Error('replay-review-omission-invalid');
        const old = commits.find(commit => commit.hash === item.hash), retained = result.find(commit => commit.hash === target);
        const oldDemands = declaredDemandIds(old.subject).sort(), retainedDemands = declaredDemandIds(retained.subject).sort();
        if (!oldDemands.length || JSON.stringify(oldDemands) !== JSON.stringify(retainedDemands)) throw new Error('replay-review-independent-demand');
        if (equivalent) {
            if (!samePatch(root, old.hash, root, retained.hash)) throw new Error('replay-review-equivalence-failed');
            retained.aliases.push(old.hash);
        } else {
            if (gitStatus(root, ['merge-base', '--is-ancestor', old.hash, retained.hash]) !== 0) throw new Error('replay-review-supersession-order-invalid');
            const retainedPaths = new Set(commitPaths(root, retained));
            if (commitPaths(root, old).some(file => !retainedPaths.has(file))) throw new Error('replay-review-partial-supersession: 保留提交未覆盖原需求全部文件；使用 keep-all 后逐层语义重放');
            retained.supersededSources.push({hash: old.hash, patchId: patchId(root, old.hash), contentHash: patchContentId(root, old.hash), evidence: item.evidence});
        }
    }
    return result;
}

function effectiveCommits(root, commits) {
    const effective = [];
    for (const original of commits) {
        if (original.parents.length !== 1) throw new Error(`不支持自动移植 merge commit: ${original.hash}`);
        const commit = {...original, aliases: []};
        const message = gitText(root, ['show', '-s', '--format=%B', commit.hash]);
        const replays = [...message.matchAll(/^Replay-Of:\s*([0-9a-f]{40,64})\s*$/gmi)].map(match => match[1]);
        for (const replay of replays) {
            if (!commits.some(item => item.hash === replay) || gitStatus(root, ['merge-base', '--is-ancestor', replay, commit.hash]) !== 0 || !samePatch(root, replay, root, commit.hash)) {
                throw new Error(`replay-review-required: 非等价或无法核实的 Replay-Of ${replay}；先做语义复核`);
            }
        }
        const crossesExport = previous => {
            const paths = commitPaths(root, commit), shared = commitPaths(root, previous).filter(file => paths.includes(file));
            return shared.length && gitText(root, ['log', '--format=%s', `${previous.hash}..${commit.parents[0]}`, '--', ...shared])
                .split(/\r?\n/).some(subject => EXPORT_SUBJECT.test(subject));
        };
        const identical = effective.findIndex(previous => samePatch(root, previous.hash, root, commit.hash) &&
            (replays.some(hash => hash === previous.hash || previous.aliases?.includes(hash)) || crossesExport(previous)));
        if (identical >= 0) {
            const previous = effective.splice(identical, 1)[0];
            commit.aliases = [...new Set([previous.hash, ...(previous.aliases || [])])];
        } else {
            const paths = commitPaths(root, commit);
            for (const previous of effective) {
                const shared = commitPaths(root, previous).filter(file => paths.includes(file));
                if (!shared.length) continue;
                if (crossesExport(previous)) throw new Error('replay-review-required: 同需求共享文件跨服务器导出后补丁不等价；先核实完整重放或增量修订');
            }
        }
        effective.push(commit);
    }
    return effective;
}

function commitPaths(root, commit) {
    return gitBuffer(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit.hash]).toString('utf8').split('\0').filter(Boolean).map(normalizeRepoPath);
}

function targetContentPresent(root, commit, head) {
    return commitPaths(root, commit).every(file => {
        const left = gitObjectExists(root, `${commit.hash}:${file}`), right = gitObjectExists(root, `${head}:${file}`);
        return left === right && (!left || gitObjectSha256(root, `${commit.hash}:${file}`) === gitObjectSha256(root, `${head}:${file}`));
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
    if (![1, PLAN_VERSION].includes(priorPlan.version) || priorPlan.status !== 'verified') throw new Error('--prior-plan 必须是已 verified 的兼容计划');
    if (path.resolve(priorPlan.devRoot) !== devRoot || path.resolve(priorPlan.prdRoot) !== prdRoot) throw new Error('--prior-plan 的 DEV/PRD 仓库与当前计划不一致');
    if (gitStatus(devRoot, ['merge-base', '--is-ancestor', priorPlan.devHead, devHead]) !== 0) throw new Error('--prior-plan 之后 DEV HEAD 不是原 HEAD 的后代');
    for (const commit of priorPlan.selected || []) {
        if (gitStatus(devRoot, ['merge-base', '--is-ancestor', commit.hash, devHead]) !== 0 || patchId(devRoot, commit.hash) !== commit.sourcePatchId) throw new Error('--prior-plan 的 DEV 来源内容无法核实');
    }
    if (!priorPlan.execution || priorPlan.execution.demandCommit !== prdHead) throw new Error('PRD HEAD 必须正好是 --prior-plan 的需求提交');
}

function priorBaselineMatches(prdRoot, priorPlan, priorFile, probe) {
    const head = priorPlan.execution?.demandCommit;
    if (!head || gitText(prdRoot, ['rev-parse', 'HEAD']).trim() !== head) return false;
    if (probe.status === 'not-found') return priorFile.remote && priorFile.remote.status === 'not-found' && priorFile.sourceState === 'A';
    if (probe.status !== 'found' || !priorPlan.execution.baselineHead) return false;
    const objectName = `${priorPlan.execution.baselineHead}:${priorFile.path}`;
    if (!gitObjectExists(prdRoot, objectName)) return false;
    return gitObjectSha256(prdRoot, objectName) === probe.sha256;
}

function localBaselineMatches(root, head, file, probe) {
    const exists = gitObjectExists(root, `${head}:${file}`);
    return probe.status === 'not-found' ? !exists : probe.status === 'found' && exists && gitObjectSha256(root, `${head}:${file}`) === probe.sha256;
}

function assertPrivatePath(repo, target) {
    const context = resolveWorkspaceContext(repo), allowed = path.join(context.contextRoot, 'work', 'source-sync', 'promotions');
    const relative = path.relative(allowed, path.resolve(target));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('promotion-private-state-outside-owner');
    const root = path.parse(path.resolve(target)).root;
    let cursor = root;
    for (const part of path.relative(root, path.resolve(target)).split(path.sep)) {
        cursor = path.join(cursor, part);
        if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('promotion-private-state-linked');
    }
    const gitRelative = path.relative(repo, target).split(path.sep).join('/');
    if (gitRelative.startsWith('../') || path.isAbsolute(gitRelative) || gitStatus(repo, ['check-ignore', '--no-index', '-q', '--', gitRelative]) !== 0 ||
        gitText(repo, ['ls-files', '--', gitRelative]).trim()) throw new Error('promotion-private-state-must-be-ignored');
    // An installed capability checkout is a nested repository. Its ignores must
    // also protect the new state; the business repository's .agents ignore alone
    // does not prevent accidental staging inside that checkout.
    if (fs.existsSync(path.join(context.contextRoot, '.git'))) {
        const contextRelative = path.relative(context.contextRoot, target).split(path.sep).join('/');
        if (gitStatus(context.contextRoot, ['check-ignore', '--no-index', '-q', '--', contextRelative]) !== 0 || gitText(context.contextRoot, ['ls-files', '--', contextRelative]).trim()) throw new Error('promotion-capability-state-must-be-ignored');
    }
}

async function withPlanLock(plan, operation) {
    if (plan.version === PLAN_VERSION) assertPrivatePath(plan.prdRoot, plan.planPath);
    const release = require('./source-sync-core').acquireRepositoryLock(plan.prdRoot);
    try { return await operation(plan); }
    finally { release(); }
}

function freezePublication(plan) {
    const {context, config, mcp} = connectionFacts(plan.prdRoot), helper = require('./source-publication');
    const {environmentAlias, environmentType} = require('./source-sync-core').environment(context, plan.environment || {});
    plan.state = 'review-pending';
    plan.environmentAlias = environmentAlias; plan.environmentType = environmentType;
    if (plan.files.some(file => file.sourceState === 'D')) {
        plan.publicationBlocked = 'publication-delete-requires-separate-policy';
        return;
    }
    plan.publication = helper.freeze({environmentAlias, environmentType,
        configurationFingerprint: helper.fingerprint(require('../../../../scripts/lib/iris-remote-operations').bindDevelopmentMode(context, {config, mcp})), gitRoot: plan.prdRoot, head: plan.execution.demandCommit,
        files: plan.files.map(file => ({path: file.path, sourcePath: safeRepoFile(plan.prdRoot, file.path), gitPath: file.path,
            document: file.document, kind: file.kind, localSha256: sha(fs.readFileSync(safeRepoFile(plan.prdRoot, file.path))),
            remoteSha256: file.remote.status === 'found' ? file.remote.sha256.toLowerCase() : null, remoteTs: file.remote.ts ?? null}))});
}

function safeRepoFile(root, relative) {
    const resolvedRoot = path.resolve(root);
    const target = path.resolve(resolvedRoot, relative);
    const rel = path.relative(resolvedRoot, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`路径越出 PRD 仓库: ${relative}`);
    let cursor = resolvedRoot;
    for (const part of rel.split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, part);
        if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('promotion-source-path-linked');
    }
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

module.exports = { buildPlanDirectory, classifyFile, containsDemand, collectFiles, createPlan, declaredDemandIds, main, normalizeRepoPath, patchId, patchContentId, samePatch, effectiveCommits, replayReviewCandidates, reviewedCommits, readFrontendRoot, validateDemandCommitBoundary, validatePriorPlan, assertPrivatePath, readDocuments, loadPlan, savePlan };
