---
name: agent-kit-maintenance
description: Use when maintaining the imedical.agents repository itself, especially after plugin, skill, rule, reference, script, vendor, README, AGENTS, memory, install/update, thin-index, or deployment-boundary changes. This maintenance-only skill lives under root skills/ but must be excluded from business-project deployment and thin-index.
---

# Agent Kit Maintenance

## 目标

维护 `imedical.agents` 能力包仓库时使用本 skill，避免多人提交插件或脚本后遗漏 README、维护记忆、manifest、docs 或测试。

本 skill 是维护者专用入口，位于根 `skills/agent-kit-maintenance/`。它用于维护本仓库本身，必须从业务项目 `.agents` sparse checkout 中排除，也不参与 thin-index。

## 必读入口

按任务读取，避免一次性加载过多上下文：

1. 总是先读根 `AGENTS.md` 和 `memory/agent-kit-maintenance-memory.md`。
2. 涉及长期边界、目录分层、thin-index、vendor、adapter 或部署范围时，读 `memory/agent-kit-maintenance-decisions.md`。
3. 需要了解近期提交和验证状态时，读 `memory/agent-kit-maintenance-log.md`。
4. 需要判断后续治理优先级时，读 `memory/agent-kit-maintenance-backlog.md`。
5. 涉及安装、更新、sparse checkout、plugin profile、vendor skill 同步或 thin-index 生成时，读 `docs/update-agents.md` 和相关脚本。
6. 涉及具体插件时，读该插件 `AGENTS.md`、README、`.agents-plugin/plugin.json`、相关 `skills/`、`rules/`、`references/`、`templates/`、`scripts/`。

## 插件提交同步门禁

提交任何插件能力变更前，必须检查并按需更新：

- 插件 `AGENTS.md`
- 插件 README
- `.agents-plugin/plugin.json`
- 相关 `SKILL.md`、rule、reference、template、script
- 仓库 README
- `memory/agent-kit-maintenance-memory.md`
- `memory/agent-kit-maintenance-log.md`
- `memory/agent-kit-maintenance-backlog.md`
- 相关 `docs/`
- 对应测试，例如 `scripts/tests/update-agents.tests.ps1` 或插件专项测试

禁止只提交插件实现而遗漏对应说明、记忆或验证入口。

## 业务需求夹带框架变更的回看门禁

实际业务需求提交中可能同时修正 `agents/`、`workflows/`、`skills/`、`feedback/`、共享协议、插件通用能力或根脚本。此类变更仍属于能力包维护，不能因为提交主题是业务需求而跳过维护同步。

1. 读取 `memory/agent-kit-maintenance-log.md`，确定上次维护记录覆盖到的提交。
2. 用 `git log` 和 `git show --name-status` 检查此后提交；按实际文件判断影响面，不只依赖 commit message。
3. 对 canonical agent/workflow 变更，同步检查 registry、`AGENT.md`、`bindings.yaml`、workflow、共享 handoff/feedback 协议、仓库 README、验证文档和专项测试。
4. 对需求经验或框架反馈机制变更，同步检查 `skills/agent-framework-feedback/SKILL.md`、`agents/_shared/feedback-protocol.md`、项目入口模板、owner rule、维护记忆和提交/推送授权边界。
5. 已完成事项写入维护日志；仍未完成的真实验证或治理工作留在 backlog。不要把已完成事项继续写成“下一步”。

## 影响面判断

- **新增或重构插件**：同步插件 README、插件 `AGENTS.md`、manifest、仓库 README、维护记忆、安装/更新说明和 thin-index 行为。
- **修改 skill/rule/reference/template**：同步触发条件、路由说明、相关 README/AGENTS、维护日志；若影响已部署项目，说明兼容清理策略。
- **修改 thin-index 行为**：只改根 `scripts/generate-plugin-thin-index.ps1`；插件 wrapper 只能转发参数；同步测试、README、docs 和维护记忆。
- **修改 install/update/vendor 同步**：同步 `docs/update-agents.md`、`scripts/tests/update-agents.tests.ps1`、仓库 README 和维护日志。
- **新增 vendor 资产或 vendor skill**：同步 `vendor/` 边界说明、安装/更新路径、vendor skill 同步说明和敏感信息边界。
- **修改 canonical agent/workflow、handoff 或反馈协议**：同步 registry/bindings、仓库 README、维护记忆、验证样例和专项测试；多智能体与远程写入授权必须分别表达。
- **新增长期规则或治理约束**：判断应进入根 `AGENTS.md`、`memory/agent-kit-maintenance-decisions.md`、README、docs 还是本 skill；不要复制长篇规则到多个地方。

## 验证清单

完成维护后至少执行：

```powershell
git diff -- <changed-files>
git status --short
```

按影响面补充：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/update-agents.tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-vendor-skills.ps1 -AgentsRoot . -Mode DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-plugin-thin-index.ps1 -PluginPath plugins/<plugin-name> -ProjectRoot . -Mode DryRun
```

如果任务涉及脚本、测试、文档解析、Office/PDF 转换或 Windows 子进程调用，收尾时检查仓库根是否出现字面量 `%SystemDrive%/` 目录；若存在，只能在确认解析路径位于当前 workspace 内后删除。

## 维护记忆写法

- `agent-kit-maintenance-memory.md` 只写短摘要、当前重点和路由。
- `agent-kit-maintenance-decisions.md` 写长期稳定决策。
- `agent-kit-maintenance-log.md` 写近期完成、提交索引和验证摘要。
- `agent-kit-maintenance-backlog.md` 写未完成治理队列。
- 不写完整规则正文、大段脚本说明、大段命令输出、一次性失败流水或业务私有事实。

## 禁止事项

- 不写服务器地址、账号、密码、token、namespace、远程路径或敏感连接信息。
- 不把业务项目私有事实写入本仓库插件、规则、模板或维护记忆。
- 不把根 `AGENTS.md` 复制成 `CLAUDE.md` 或 `CODEBUDDY.md`。
- 不把工具专属 adapter 当成 canonical 源。
- 不把 plugin thin-index、agent thin-index 和工具 adapter 生成逻辑混在同一脚本中。
