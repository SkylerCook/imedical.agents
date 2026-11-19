'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveWorkspaceContext, workspaceContextBlockers } = require('../../../scripts/lib/workspace-context');

const hosts = new Map([
    ['codex', { name: 'Codex', entries: ['AGENTS.md', '.codex/agents'], runtime: 'Codex' }],
    ['claude-code', { name: 'Claude Code', entries: ['CLAUDE.md', '.claude'], runtime: 'ClaudeCode' }],
    ['opencode', { name: 'OpenCode', entries: ['opencode.json', '.opencode'], runtime: 'OpenCode' }],
    ['codebuddy', { name: 'CodeBuddy', entries: ['CODEBUDDY.md', '.codebuddy'], runtime: 'CodeBuddy' }],
    ['workbuddy', { name: 'WorkBuddy', entries: ['.workbuddy'], runtime: 'WorkBuddy' }],
    ['hermes', { name: 'Hermes', entries: ['.hermes'] }]
]);

function entriesAt(root, host) {
    return host.entries.filter(entry => fs.existsSync(path.join(root, entry)));
}

function inspectClients(root) {
    return Array.from(hosts, ([id, host]) => ({ id, name: host.name, entries: entriesAt(root, host), status: '尚未验证宿主加载' }));
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
    const entries = entriesAt(workspaceRoot, host);
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

module.exports = { inspectClients, hostHandoff, projectHandoff };
