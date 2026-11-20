'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { resolveWorkspaceContext, workspaceContextBlockers } = require('../../../scripts/lib/workspace-context');
const { safeFile } = require('../../../scripts/lib/knowledge-sources');
const { validReceiptId } = require('../../ai-dev-offline/configure-project');
const { inspectProjectContext } = require('./project-context');

const run = promisify(execFile);
const frameworkSource = 'https://gitee.com/skyler-cook/imedical.agents.git';
const releaseRef = 'refs/heads/master';
const commitId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const packageRoot = path.resolve(__dirname, '../../..');
const projectProfiles = Object.freeze(['iris_project_profile.md', 'project_context_profile.md', 'cure_form_profile.md',
    'demand_delivery_profile.md', 'i18n_project_profile.md']);
const taskNames = new Map([
    ['plugin-init', '插件初始化核对'], ['iris-connection', 'IRIS 连接核对'], ['iris-mcp', 'IRIS MCP 核对'],
    ['knowledge-index', '知识索引核对'], ['manual', '手册解读'], ['config-review', '项目配置核对'],
    ['recovery-diagnosis', '恢复诊断']
]);

const hosts = new Map([
    ['codex', { name: 'Codex', rules: ['AGENTS.override.md', 'AGENTS.md'], commonSkills: true,
        agents: ['.codex/agents', '.toml'], runtime: 'Codex' }],
    ['claude-code', { name: 'Claude Code', rules: ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'],
        skills: ['.claude/skills'], agents: ['.claude/agents', '.md'], runtime: 'ClaudeCode' }],
    ['opencode', { name: 'OpenCode', rules: ['AGENTS.md', 'CLAUDE.md'], commonSkills: true,
        skills: ['.opencode/skills', '.claude/skills'], config: ['opencode.json', 'opencode.jsonc', '.opencode/config.json'], runtime: 'OpenCode' }],
    ['codebuddy', { name: 'CodeBuddy', rules: ['CODEBUDDY.md', '.codebuddy/CODEBUDDY.md', 'AGENTS.md'],
        skills: ['.codebuddy/skills'], agents: ['.codebuddy/agents', '.md'], runtime: 'CodeBuddy' }],
    ['workbuddy', { name: 'WorkBuddy', rules: ['.codebuddy/CODEBUDDY.md', 'CODEBUDDY.md', 'AGENTS.md'],
        skills: ['.workbuddy/skills', '.codebuddy/skills'], agents: ['.codebuddy/agents', '.md'], runtime: 'WorkBuddy' }],
    ['hermes', { name: 'Hermes' }]
]);

function localEntry(root, relative, allowLink = true) {
    const parts = relative.split(/[\\/]/u);
    if (!relative || path.isAbsolute(relative) || parts.includes('..')) return null;
    let file = root;
    let stat;
    try {
        for (const [index, part] of parts.entries()) {
            file = path.join(file, part);
            stat = fs.lstatSync(file);
            if (index < parts.length - 1 && !stat.isDirectory()) return null;
        }
        if (stat.isSymbolicLink()) {
            if (!allowLink) return null;
            const target = path.resolve(path.dirname(file), fs.readlinkSync(file));
            return localEntry(root, path.relative(root, target), false);
        }
        return { file, stat };
    } catch { return null; }
}

function commonSkillsAt(root) {
    const context = inspectProjectContext(root);
    return context ? path.relative(root, path.join(context.contextRoot, 'skills')).split(path.sep).join('/') : null;
}

function entriesAt(root, host, common = commonSkillsAt(root)) {
    const entries = [];
    for (const [kind, paths] of [['rules', host.rules], ['config', host.config]]) {
        for (const relative of paths ?? []) {
            if (localEntry(root, relative)?.stat.isFile()) entries.push({ kind, path: relative });
        }
    }
    const source = common && localEntry(root, common, false);
    for (const relative of new Set([...(host.commonSkills && common ? [common] : []), ...(host.skills ?? [])])) {
        const directory = localEntry(root, relative);
        if (!directory?.stat.isDirectory()) continue;
        const local = path.relative(root, directory.file);
        try {
            if (!fs.readdirSync(directory.file).some(name => localEntry(root, path.join(local, name, 'SKILL.md'))?.stat.isFile())) continue;
            const managed = process.platform === 'win32' ? source?.file.toLowerCase() === directory.file.toLowerCase() : source?.file === directory.file;
            entries.push({ kind: 'skills', path: relative, detail: managed
                ? relative === common ? '项目技能目录' : '链接到项目技能' : '独立技能目录' });
        } catch { /* An unreadable directory is not evidence of an entry. */ }
    }
    if (host.agents) {
        const [relative, extension] = host.agents;
        const directory = localEntry(root, relative);
        if (directory?.stat.isDirectory()) {
            try {
                const local = path.relative(root, directory.file);
                if (fs.readdirSync(directory.file).some(name => name.endsWith(extension) && localEntry(root, path.join(local, name))?.stat.isFile())) {
                    entries.push({ kind: 'agents', path: relative });
                }
            } catch { /* An unreadable directory is not evidence of an entry. */ }
        }
    }
    return entries;
}

function inspectClients(root) {
    const common = commonSkillsAt(root);
    return Array.from(hosts, ([id, host]) => ({ id, name: host.name, entries: entriesAt(root, host, common), status: '尚未验证宿主加载' }));
}

function boundContext(root) {
    const context = resolveWorkspaceContext(fs.realpathSync.native(root));
    const blockers = workspaceContextBlockers(context);
    if (!['standard', 'workspace-overlay'].includes(context.mode) || (context.mode === 'workspace-overlay' && blockers.length)) {
        throw Error('handoff-context-invalid');
    }
    return { context, available: blockers.length === 0 };
}

function projectIdentity({ workspaceRoot, contextRoot, capabilityRoot, mode }) {
    return [
        `- WorkspaceRoot（工作目录） ${workspaceRoot}`,
        `- ContextRoot（本工程配置与发现入口） ${contextRoot}`,
        `- CapabilityRoot（框架脚本与规范） ${capabilityRoot}`,
        ...(mode === 'workspace-overlay' ? ['这是 Overlay 模块，上下文和宿主入口归当前模块。共享能力根只用于读取 owner 与规范。'] : [])
    ];
}

function installedContextSkill(capabilityRoot) {
    const relative = path.join('plugins', 'agent-context-kit', 'skills', 'project-context-maintenance', 'SKILL.md');
    const file = path.join(capabilityRoot, relative);
    if (fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() &&
        path.relative(fs.realpathSync.native(capabilityRoot), fs.realpathSync.native(file)) === relative) return file;
    return null;
}

function projectHandoff(root) {
    const { context, available } = boundContext(root);
    const skill = available ? installedContextSkill(context.capabilityRoot) : null;
    const rules = path.join(context.workspaceRoot, 'AGENTS.md');
    const prompt = [
        '请在以下工程核对项目上下文。',
        ...projectIdentity(context),
        '',
        fs.existsSync(rules) ? `1. 用上述 WorkspaceRoot 打开工程，先读 ${rules}。`
            : '1. 用上述 WorkspaceRoot 打开工程，先确认当前项目入口以及是否需要初始化 AGENTS.md。',
        skill ? `2. 读取已安装的 project-context-maintenance：${skill}。遵循其中的只读审计流程，核对实际项目规则、Skill 路由及配置归属。`
            : '2. 当前未发现已安装的 project-context-maintenance。先只读核对已有入口，在工作台首页确认基础框架和项目上下文能力是否已安装。',
        '3. 先报告缺项、对应位置和建议。用户明确要求补齐时，保留已有项目约定，仅在当前工程授权的上下文范围内处理，保护凭据。',
        '4. 回工作台的「任务与恢复」点击「重新读取」。若修改宿主发现入口，在「Agent 客户端」核对文件变化，并在客户端本身确认加载。'
    ];
    return { name: '工程检查', prompt: prompt.join('\n') };
}

function hostHandoff(root, id) {
    const host = hosts.get(id);
    if (!host) throw Error('handoff-host-unsupported');
    const { context, available } = boundContext(root);
    const { workspaceRoot, capabilityRoot } = context;
    const entries = entriesAt(workspaceRoot, host).map(entry => entry.path);
    const rules = path.join(workspaceRoot, 'AGENTS.md');
    const scripts = path.join(capabilityRoot, 'scripts');
    const owner = path.join(scripts, 'sync-runtime-skills.js');
    const guide = path.join(capabilityRoot, 'docs', 'coding-agent-adaptation.md');
    const windows = process.platform === 'win32';
    const quote = value => windows ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
    const cd = windows ? `Set-Location -LiteralPath ${quote(workspaceRoot)}` : `cd -- ${quote(workspaceRoot)}`;
    const runtime = `${windows ? '& ' : ''}${quote(process.execPath)}`;
    const command = mode => `${runtime} ${quote(owner)} --project-root ${quote(workspaceRoot)} --runtime ${host.runtime} --mode ${mode}`;
    const prompt = [
        `请在以下工程核对 ${host.name} 的项目级接入。`,
        ...projectIdentity(context),
        '',
        fs.existsSync(rules) ? `1. 在上述 WorkspaceRoot 打开同一工程，并读取 ${rules}。`
            : `1. 在上述 WorkspaceRoot 打开同一工程。当前未发现 AGENTS.md，请核对该工程已有的规则入口。`,
        `2. 核对当前发现的项目入口 ${entries.length ? entries.join('、') : '暂无'}。入口发现只说明文件存在，宿主加载需在客户端确认。`
    ];
    if (host.runtime && available && fs.lstatSync(scripts, { throwIfNoEntry: false })?.isDirectory() &&
        fs.lstatSync(owner, { throwIfNoEntry: false })?.isFile()) {
        prompt.push('3. 先运行项目技能适配的只读预演，核对计划的来源、目标目录与冲突。需要写入时取得用户明确授权，保留自定义文件。',
            '', `\`\`\`${windows ? 'powershell' : 'sh'}`, cd, command('DryRun'), '```', '',
            '4. 对已生成的入口运行只读检查，再在宿主的新会话或重载后确认一项项目技能确实被发现。规则、原生 Agent 与 MCP 的加载按实际需要分别核对。',
            '', `\`\`\`${windows ? 'powershell' : 'sh'}`, cd, command('Check'), '```', '',
            '5. 报告项目路径、预演和检查结果、宿主实际发现的入口及剩余问题。回工作台的「Agent 客户端」点击「重新检查」。');
    } else {
        prompt.push(fs.lstatSync(guide, { throwIfNoEntry: false })?.isFile() ?
            `3. 从 ${guide} 核对该宿主的入口与项目目录约定，按已确认的实际文件做只读核对。` :
            '3. 从工程规则和宿主本机入口做只读核对。若工程缺所需的框架能力，先回工作台核对安装状态。',
        '4. 在宿主中重新打开该工程，报告实际读取的项目规则或发现的项目技能，以及无法确认的项。需要写入时取得用户明确授权。回工作台的「Agent 客户端」点击「重新检查」。');
    }
    return { name: host.name, prompt: prompt.join('\n') };
}

function existingFile(root, relative) {
    try {
        const file = safeFile(root, relative);
        if (fs.lstatSync(file).isFile()) return file;
    } catch { /* An unavailable or linked file is not an installed reference. */ }
}

function installedPluginInitialization(capabilityRoot, id, directory) {
    const pluginPath = `plugins/${directory}`;
    const manifest = existingFile(capabilityRoot, `${pluginPath}/.agents-plugin/plugin.json`);
    if (!manifest) return {};
    try {
        const stat = fs.lstatSync(manifest);
        if (stat.nlink !== 1 || stat.size > 256 * 1024) return {};
        const data = JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''));
        if (data.name !== id) return {};
        if (data.initSkill && (typeof data.initSkill !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(data.initSkill)))
            return {manifest};
        const entry = data.initSkill ? `skills/${data.initSkill}/SKILL.md` : (data.entry ?? 'AGENTS.md');
        if (typeof entry !== 'string' || !/^(?:[a-z0-9_-]+\/)*[a-z0-9_.-]+\.md$/iu.test(entry)) return {manifest};
        const source = `${pluginPath}/${entry}`;
        return {manifest, source: existingFile(capabilityRoot, source) ? source : undefined};
    } catch { return {}; }
}

function taskHandoff(root, status, { task, item }, { manualSource, pluginEntry } = {}) {
    const invalid = () => { throw Error('invalid-action'); };
    const name = taskNames.get(task);
    if (!name) invalid();
    const manual = task === 'manual';
    const plugin = task === 'plugin-init';
    const profile = task === 'config-review';
    const recovery = task === 'recovery-diagnosis';
    const needsItem = manual || plugin || profile;
    if (needsItem ? typeof item !== 'string' : !recovery && item !== undefined) invalid();
    if (recovery && item !== undefined && !validReceiptId(item)) invalid();
    if (profile && !projectProfiles.includes(item)) invalid();
    if (status === 'invalid-declaration' && recovery) {
        return { name, prompt: recoveryHandoff(root, { status, revision: null }).prompt };
    }
    let source;
    let selectedPlugin;
    if (manual) {
        if (item.length > 160 || !item.endsWith('.md') || /[\\/:\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(item)) invalid();
        source = manualSource?.(item);
        if (!source) invalid();
    }
    if (plugin) {
        if (!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(item)) invalid();
        selectedPlugin = pluginEntry?.(item);
        if (typeof selectedPlugin?.directory !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(selectedPlugin.directory)) invalid();
    }
    const installed = ['standard', 'overlay-declared'].includes(status);
    const sourceCheckout = status === 'framework-checkout' && (manual || task === 'knowledge-index');
    if (!installed && !(status === 'no-framework' && manual) &&
        !(['partial', 'invalid-head'].includes(status) && (manual || recovery)) &&
        !sourceCheckout) throw Error('handoff-context-invalid');
    const workspace = fs.realpathSync.native(root);
    if (sourceCheckout && task === 'knowledge-index' &&
        (!existingFile(workspace, 'scripts/knowledge-query.js') ||
            !existingFile(workspace, 'plugins/coding-iris-plugin/.agents-plugin/plugin.json'))) throw Error('handoff-context-invalid');
    const context = installed ? boundContext(workspace).context : sourceCheckout ?
        { workspaceRoot: workspace, contextRoot: workspace, capabilityRoot: workspace, mode: 'framework-checkout' } : null;
    const owner = relative => {
        const file = context && existingFile(context.capabilityRoot, relative);
        return file ? `${sourceCheckout ? '源仓' : '已安装'} owner ${file}` : `先核对当前版本是否提供 ${relative}，该入口缺失时报告缺项`;
    };
    const guide = relative => {
        const installedGuide = context && existingFile(context.capabilityRoot, relative);
        const bundledGuide = installedGuide ? null : existingFile(packageRoot, relative);
        return installedGuide ?? (bundledGuide ? `工作台随包手册 ${bundledGuide}` : `对应版本的 ${relative}`);
    };
    const steps = [];
    switch (task) {
        case 'plugin-init': {
            const initialization = installedPluginInitialization(context.capabilityRoot, item, selectedPlugin.directory);
            steps.push(`目标插件 ${item}。先读 ${guide('docs/guides/plugin-deployment.md')}。`,
                `核对 ${owner('scripts/plugin-deploy.js')}，用原 owner 的 list 和 plan --plugin ${item} 查看本工程真实状态与依赖。`,
                initialization.manifest ? `读取已安装 manifest ${initialization.manifest}。` :
                    '插件或 manifest 尚未就绪。先报告缺项，按项目规则和用户授权使用既有补装入口。',
                initialization.source ? `读取当前 CapabilityRoot 下的初始化入口 ${initialization.source}，核对领域接入和缺失配置。` :
                    '当前没有可读的初始化入口。请核对已安装版本和原 owner 输出，入口缺失时先报告。',
                '保留已禁用和自定义入口。补装后先核对 available；必要配置与依赖通过验收、且获启用授权后，复用 update-plugin-profile.ps1，读回 enabled 和 Skill 发现入口，再在原宿主复查。');
            break;
        }
        case 'iris-connection':
            steps.push(`先读 ${guide('docs/guides/connection-configuration.md')}。`,
                '核对 ContextRoot 的 config/project.jsonc 中 irisConnections.active、WorkspaceRoot 的 .mcp.json 与 .iris-agentic-dev.toml 的有效来源。检查选定档案、绑定一致性、禁用状态及兼容来源，凭据只报告是否已配置。',
                `核对 ${owner('scripts/iris-mcp.js')}。确认目标与只读连接授权后，从当前工程使用 check --verify-profile --json 核对服务器身份与目标一致性。`,
                '报告已选档案、核验结果、证据时间与失败原因，回工作台重新读取连接状态。');
            break;
        case 'iris-mcp':
            steps.push(`先读 ${guide('docs/guides/iris-managed-sessions.md')}。`,
                '只读核对当前 WorkspaceRoot 的 .mcp.json 与 ContextRoot 的 config/iris-session-backend.json，区分已知受管、直连、自定义、禁用和缺失入口。检查有效命令与参数，保护凭据。',
                `核对 ${owner('scripts/iris-session-mcp.js')}。对已核明的受管入口检查 initialize、tools/list 与进程退出，随后在当前工程的宿主中确认实际加载。`,
                '分别报告程序可运行、工具发现、宿主加载和远端连接的证据。工具目录读取和远端连接核验分开，远端核验需确认目标及权限。');
            break;
        case 'knowledge-index':
            steps.push(`先读 ${guide('docs/guides/knowledge-retrieval.md')}。`,
                `核对 ${owner('scripts/knowledge-query.js')}。从当前工程沿手册检查本地关键词检索、当前索引来源和资料版本，先用 --local-only 做一条可验证的查询。`,
                '报告 mode、vectorSources 和 warnings，分别核对项目缓存与公司分发索引。外发查询和构建须先确认资料与组织批准的范围。',
                sourceCheckout ?
                    '这是框架源仓维护请求。先核对仓库可信来源、资料版本和目标索引。仅限获授权的维护者沿手册「维护者建库与导出」检查向量完整性，确认覆盖目标后使用原导出入口，读回 vendor/knowledge-index/company.sqlite 核对来源和查询结果。' :
                    '公司索引导出只限有授权的框架源仓维护者，沿手册「维护者建库与导出」核对当前资料、向量完整性与产物。当前业务工程只核对或按批准物料选装，保持共享索引与发布物原样。');
            break;
        case 'manual':
            steps.push(`阅读选中的 ${source}，使用 ${guide(source)}。`,
                '结合当前工程已有规则和实际状态，解释该手册相关步骤，指出先决条件、验证方法和需用户确认的决定。仅做解读和已授权的只读核对。');
            break;
        case 'config-review':
            steps.push(`先读 ${guide('docs/update-agents.md')} 关于已有工程、配置迁移与续接的说明。`,
                `只读核对 ContextRoot 的 config/project.jsonc 与已选档案 config/${item}。辨认生效配置、仍有用途的说明、旧兼容来源和冲突。`,
                '沿该配置 owner 的原手册和只读检查核对实际来源与字段状态，保留有效值、注释和未知字段。报告哪些需要业务判断或授权写入，然后回工作台重新读取。');
            break;
        case 'recovery-diagnosis':
            steps.push(`先读 ${guide('docs/update-agents.md')} 的「状态判定」和「更新中断与续接」。`,
                ...(item ? [`待核对回执 ${item}。只核对当前 WorkspaceRoot 的 .ai-dev-config-backups 同名回执，确认它与本工程及实际写入范围一致。未找到时报告并停止。`] : []),
                '先只读区分配置保存、部署或生成入口的中断。对照「任务与恢复」和原 owner 记录，核对实际文件、后续编辑、本地版本及可恢复范围。',
                '保留当前文件和回执，报告安全接续方案。授权后复用原 owner 的核对及恢复入口，复查实际结果，再回工作台点「重新读取」。');
            break;
    }
    return {name, prompt: [
        `请在当前工程完成${name}。`,
        ...(context ? projectIdentity(context) : [`- WorkspaceRoot（工作目录） ${workspace}`, '当前框架尚未就绪，先核对已存在的工程文件。']),
        '先读当前 WorkspaceRoot 的 AGENTS.md（如存在）。使用该工程已有的 Agent 会话。写入与远端检查仅在用户有效授权范围执行，报告中省略凭据。',
        ...steps
    ].join('\n')};
}

function gitExecutable() {
    const name = process.platform === 'win32' ? 'git.exe' : 'git';
    const searchPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
    for (const directory of searchPath.split(path.delimiter)) {
        if (!path.isAbsolute(directory) || /^[\\/]{2}/u.test(directory)) continue;
        const executable = path.join(directory, name);
        if (fs.statSync(executable, { throwIfNoEntry: false })?.isFile()) return executable;
    }
    throw Error('git-unavailable');
}

async function gitRead(metadata, args) {
    // Use an explicit Git directory for local reads and an isolated discovery ceiling for network reads.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^git_/iu.test(key)));
    Object.assign(env, {
        GIT_ALLOW_PROTOCOL: metadata ? '' : 'https',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_NO_LAZY_FETCH: '1',
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_CEILING_DIRECTORIES: path.dirname(__dirname),
        NoDefaultCurrentDirectoryInExePath: '1'
    });
    const prefix = ['--no-optional-locks', '--no-replace-objects'];
    if (metadata) prefix.push('--git-dir', metadata);
    const { stdout } = await run(gitExecutable(), [...prefix, ...args], {
        cwd: __dirname, env, encoding: 'utf8', timeout: 8000, maxBuffer: 64 * 1024, windowsHide: true
    });
    return stdout.trim();
}

async function readPublishedHead() {
    const availableProtocols = Object.entries(process.env).find(([key]) => key.toUpperCase() === 'GIT_ALLOW_PROTOCOL')?.[1];
    if (availableProtocols !== undefined && !availableProtocols.split(':').includes('https')) return null;
    const transport = ['-c', 'http.followRedirects=false', '-c', 'http.sslVerify=true'];
    // Reuse the Windows Git credential manager without loading repository or user-defined Git commands.
    if (process.platform === 'win32') transport.push('-c', 'credential.helper=manager');
    const result = await gitRead(null, [...transport, 'ls-remote', '--exit-code', '--refs', frameworkSource, releaseRef]);
    const [revision, ref] = result.split('\t');
    return ref === releaseRef && commitId.test(revision) ? revision : null;
}

async function checkHistory(capabilityRoot, revision, readUpdateHead) {
    const metadata = path.join(capabilityRoot, '.git');
    try {
        const [branch, remote, merge, url] = await Promise.all([
            gitRead(metadata, ['symbolic-ref', '--quiet', 'HEAD']),
            ...['branch.master.remote', 'branch.master.merge', 'remote.origin.url'].map(key =>
                gitRead(metadata, ['config', '--local', '--no-includes', '--get-all', key]))
        ]);
        if (branch !== releaseRef || remote !== 'origin' || merge !== releaseRef || url !== frameworkSource)
            return { status: 'upstream-changed', reason: 'upstream-unrecognized' };
    } catch {
        return { status: 'upstream-changed', reason: 'upstream-unrecognized' };
    }
    let targetRevision;
    try { targetRevision = await readUpdateHead(); } catch { /* Offline and transport errors have the same recovery path. */ }
    if (typeof targetRevision !== 'string' || !commitId.test(targetRevision))
        return { status: 'unavailable', reason: 'upstream-unavailable' };
    if (targetRevision === revision) return { status: 'current', targetRevision };
    try {
        await gitRead(metadata, ['cat-file', '-e', `${targetRevision}^{commit}`]);
    } catch {
        // The observed tip is a candidate until the existing updater verifies ancestry.
        return { status: 'update-available', targetRevision };
    }
    try {
        await gitRead(metadata, ['merge-base', '--is-ancestor', revision, targetRevision]);
        return { status: 'update-available', targetRevision };
    } catch {
        return { status: 'upstream-changed', reason: 'history-not-fast-forward', targetRevision };
    }
}

function updatePrompt(root, target, plan, link, discovery) {
    const display = JSON.stringify;
    const lines = [
        '先只读核对当前工程的 .agents 更新。取版和写入以用户授权为准。',
        `工程 ${display(root)}`
    ];
    if (!target) {
        lines.push('先读 AGENTS.md 和 .agents/capability.json，只读核对所属标准根、ContextRoot 与能力包来源。在本会话报告归属和更新路径。');
        return lines.join('\n');
    }
    lines.push(`已安装 ${target.revision}${discovery.targetRevision ? `，上游观测 ${discovery.targetRevision}` : ''}`);
    const updateGuide = path.join(target.capabilityRoot, 'docs', 'update-agents.md');
    lines.push(`先读工程 AGENTS.md 与更新手册 ${display(updateGuide)}。核对实际 HEAD、上游、快进关系和本地改动。`);
    if (discovery.status === 'current') {
        lines.push('观测版本与上游一致，先用 Check -NoPull 核对实际状态。');
    } else if (discovery.status === 'update-available') {
        lines.push('按授权用原更新器做 DryRun。联网 DryRun 可能推进 .agents HEAD。预演通过后按授权 Write，再做 Check -NoPull。');
    } else {
        lines.push('先只读查明上游或历史差异，确认来源、目标和授权后按手册更新。');
    }
    const overlayGuide = existingFile(packageRoot, 'docs/workspace-overlay.md') ?? path.join(target.capabilityRoot, 'docs', 'workspace-overlay.md');
    if (link) {
        lines.push(`所属标准根 ${display(target.workspaceRoot)}，当前成员 ContextRoot ${display(link.member.contextRoot)}。共享取版在标准根按授权执行。`);
        lines.push(`读标准根 AGENTS.md，按 ${display(overlayGuide)} 核对归属、共享根版本和源码就绪状态。共享根就绪后，只按授权对当前成员做 -NoPull 预演、刷新和复查。未登记时按该手册补登记。`);
    } else {
        lines.push(`有模块、医院等共享工作区时，按项目工作区清单和 ${display(overlayGuide)} 核对归属与授权。标准根更新一次，再对获授权且就绪的成员逐个 -NoPull 预演、刷新和复查，优先使用项目原管理入口。`);
        if (plan?.members.length) lines.push('成员登记线索见 .agents/.git/plugin-deployment.json 的 members，以项目工作区清单核实实际成员。');
    }
    const workbenchGuide = existingFile(packageRoot, 'docs/update-agents.md');
    const exceptions = workbenchGuide ? `工作台手册 ${display(workbenchGuide)}` : '更新手册';
    lines.push(`断网且有批准的离线能力包与独立发行记录时，读${exceptions}中的「离线更新」。遇到 sparse-refresh-failed 或生成层中断时，读同一手册的「更新中断与续接」。`);
    lines.push('保留连接、凭据、已禁用能力及项目定制。在本会话报告实际框架提交、复查结果和未完成项。有工作区时逐个说明成功、跳过或失败的原因。');
    return lines.join('\n');
}

function recoveryHandoff(root, observation) {
    const { revision } = observation;
    const reason = observation.status === 'partial' ? (revision ? 'updater-missing' : 'nonstandard-agents') : observation.status;
    if (reason === 'invalid-declaration') return {
        status: 'recovery-required', reason, scope: 'overlay', revision: null,
        prompt: [
            '请先只读诊断当前工程的 Overlay 声明。',
            `当前工程：${JSON.stringify(root)}`,
            `待核对声明：${JSON.stringify(path.join(root, '.agents', 'capability.json'))}`,
            '先读取当前工程 AGENTS.md（如存在），参照工作台随包 docs/workspace-overlay.md 的「Manifest 与目录边界」和「恢复策略」核对本地声明格式。',
            '声明中的路径尚未核实。先按项目已有规则和工作区清单确认归属，勿从声明猜测标准根、访问候选路径、运行脚本或取版。',
            '先报告缺项和建议，省略连接与凭据。获授权后修复声明，保留已有配置和业务文件，再核对归属并报告结果。'
        ].join('\n')
    };
    const guidance = {
        'invalid-head': '本地存在 .agents/.git 目录，但 HEAD 无法核实。先只读核对 Git 元数据、引用、提交对象、来源和本地变更，报告实际损坏或未完成的步骤。',
        'updater-missing': `当前 HEAD 为 ${revision}，工作台未找到可用的 .agents/scripts/update-agents.ps1。先核对该提交中的原更新入口、sparse checkout 与本地变更，确认应如何从可信来源恢复匹配的运行文件。`,
        'nonstandard-agents': '现有 .agents 缺少可识别的标准 Git 元数据目录。先只读核对目录类型、.git 和 capability.json，按手册「状态判定」查明它是否为非标准目录或另有共享能力根。',
        'unknown-source': `当前 HEAD 为 ${revision}，工作台无法识别该副本的框架来源。先只读核对本地远端配置、当前分支、跟踪关系、提交历史和工作区变更。按项目规则核对是否为团队批准的原始来源、镜像或离线物料，报告判断和依据时省略远端地址及凭据。确认来源、目标版本和更新入口可信并获得相应授权前，停止联网取版、改写远端和运行该副本的脚本。`
    };
    return {
        status: 'recovery-required', reason, scope: 'standard', revision,
        prompt: [
            '请在当前工程诊断 .agents 部署状态，并按用户授权接续。',
            `当前工程：${JSON.stringify(root)}`,
            '先读取当前工程 AGENTS.md（如存在），并参考工作台随包 docs/update-agents.md 的「状态判定」和「更新中断与续接」。',
            guidance[reason],
            '先报告发现和恢复范围。保留现有 .agents、配置、凭据来源、定制入口与业务文件，按授权接续。',
            '目标版本和可信更新器已落盘且仅需补生成层时，按手册用 DryRun -NoPull、Write -NoPull、Check -NoPull 接续，在本会话报告实际版本、复查结果和未完成项。'
        ].join('\n')
    };
}

async function updateHandoff(root, observation, plan, link, readUpdateHead = readPublishedHead) {
    if (['partial', 'invalid-head', 'unknown-source', 'invalid-declaration'].includes(observation.status)) return recoveryHandoff(root, observation);
    const overlay = observation.status === 'overlay-declared';
    const target = overlay ? link?.root : {
        workspaceRoot: root,
        capabilityRoot: path.join(root, '.agents'),
        revision: observation.revision
    };
    const discovery = target ? await checkHistory(target.capabilityRoot, target.revision, readUpdateHead)
        : { status: 'unavailable', reason: 'overlay-unverified' };
    return {
        ...discovery,
        scope: overlay ? 'overlay' : 'standard',
        revision: target?.revision ?? null,
        prompt: updatePrompt(root, target, plan, link, discovery)
    };
}

module.exports = { inspectClients, hostHandoff, projectHandoff, projectProfiles, taskHandoff, updateHandoff };
