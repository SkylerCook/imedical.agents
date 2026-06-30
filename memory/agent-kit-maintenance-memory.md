# imedical.agents 维护记忆入口

本文件是 `imedical.agents` 能力包仓库维护记忆的入口摘要，帮助后续 Agent 快速接手。它不是业务项目 `.agents/memory/project-memory.md`，不部署到业务项目，不生成 thin-index。

详细记忆分流如下：

- 长期决策和稳定边界：`agent-kit-maintenance-decisions.md`
- 近期维护流水和验证摘要：`agent-kit-maintenance-log.md`
- 后续计划和治理队列：`agent-kit-maintenance-backlog.md`

## 当前状态

- 本仓库维护可复用 Agent 能力包，核心内容包括 `agents/`、`workflows/`、`plugins/`、`skills/`、`rules/`、`docs/`、`scripts/` 和 `memory/`。
- `agents/` 是厂商无关的智能体 canonical 注册层；`workflows/` 是厂商无关的多智能体/阶段化编排层。工具专属入口只能作为 adapter 生成物。
- `plugins/agent-context-kit/` 负责项目上下文维护，包括 AGENTS 入口、项目规则、项目记忆、项目配置和 thin-index。
- `plugins/coding-iris-plugin/` 负责 IRIS/ObjectScript/CSP/JavaScript/HISUI 编码能力。
- `plugins/i18n-iris-plugin/` 负责 IRIS/ObjectScript/CSP/HISUI 国际化能力。
- `plugins/imedicalxc-doctor-extend-engineer/` 负责 HIS 医生站第三方系统集成编排，主入口为 `skills/imedicalxc-doctor-extend-engineer/SKILL.md`，子 skill 由主编排器按需读取。
- 已落地首个领域样板 `agents/i18n-agent/` 和 `workflows/i18n-change.workflow.md`，用于 IRIS i18n 需求的链路定位、数据分类、编码/模板/种子和验证五阶段处理。
- 当前重点维护方向是降低 rules 常驻上下文成本，并完善多 Agent 协作在已部署 `.agents` 项目中的发现、更新和验证链路。
- 根 `AGENTS.md` 只服务本仓库维护，不部署到业务项目 `.agents/`；业务项目仍使用业务项目自己的 `AGENTS.md` 和 `.agents/` 上下文。

## 必读路由

- 修改安装、更新、sparse checkout 或托管更新流程：读取 `docs/update-agents.md`、`scripts/install-agents.ps1`、`scripts/update-agents.ps1` 和长期决策。
- 修改 thin-index 行为：读取 `scripts/generate-plugin-thin-index.ps1`、相关插件 wrapper、长期决策和近期日志。
- 修改智能体或 workflow：读取 `memory/plan/multi-agent-architecture.md`、`agents/agent-registry.md`、`workflows/workflow-registry.md` 和相关 `AGENT.md` / `.workflow.md`。
- 修改插件能力：读取对应插件 `AGENTS.md`、README、skills、rules、templates 和 manifest。
- 维护记忆：保持本文件短摘要；细节按长期决策、维护日志、治理队列分流。
- 处理业务项目上下文：不要使用本文件作为项目记忆；改用目标项目自己的 `AGENTS.md` 和 `project-context-maintenance`。

## 近期关键变化

- 已新增 vendor skill 运行时同步链路：`vendor/superpowers/` 和 `vendor/word-reader/` 随 `/vendor/**` 部署到业务项目 `.agents/vendor/`，再由 `scripts/sync-vendor-skills.ps1` 同步到运行时 skill 发现目录；vendor 仍不参与 thin-index。
- 已新增并重构 `imedicalxc-doctor-extend-engineer` 插件，采用标准插件结构、内置多模块 Maven 依赖安装脚本，thin-index wrapper 默认只暴露主编排器入口，医生站第三方集成子 skill 由主编排器按需加载。
- 已精简 `imedicalxc-doctor-dbdata` skill，聚焦数据库查询核心规范，重点保留医保对照、基础数据统一对照和合并查询（Merge Query）等高价值领域知识，并同步更新医生站扩展主编排器和架构引用。
- 已新增框架验证反馈机制：`feedback/framework/`、`agents/_shared/feedback-protocol.md`。Agent 处理 HIS 需求时如对框架文件做了修正，自动生成反馈条目；维护者定期 diff 后应用到 master。
- 已新增仓库级 `skills/agent-framework-feedback/SKILL.md`，用于在插件直接使用或无 canonical agent 场景下生成框架反馈条目。
- 已新增 `demo/presentation/` 演示页面，作为能力包、i18n skill 和多智能体架构的可视化说明材料；它不属于业务项目运行入口。
- 已新增部署经验沉淀入口 `feedback/experience/deploy-com-exp.md` 和首个专项部署工具目录 `docs/deploy/dental-ta-159/`；这类内容可随 `docs/` 部署，但不得把业务私有连接信息写入记忆或规则。
- 已新增 IRIS 部署编排入口 `plugins/coding-iris-plugin/skills/iris-deploy/SKILL.md` 和薄清单脚本 `plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js`；默认只生成部署清单和编排验证，远端写入仍需用户明确确认。
- 已新增根 `AGENTS.md`，作为本仓库 AI Coding 维护入口；它不部署到业务项目 `.agents/`。
- 维护记忆已拆分为入口摘要、长期决策、维护日志和治理队列四类文件。
- 已新增统一更新脚本 `scripts/update-agents.ps1` 和托管更新 runbook `docs/update-agents.md`。
- 已将业务项目 `AGENTS.md` 规范调整为必须唯一主入口；`CLAUDE.md`、`CODEBUDDY.md` 改为可选兼容 symlink。
- 已增强 canonical thin-index stale 清理，支持识别插件源规则重命名、移走或删除后的遗留浅层入口。
- 已明确 GitHub Pages 展示页和双远端维护链路；展示页文件不部署到业务项目 `.agents/`。
- 已新增多智能体架构设计 `memory/plan/multi-agent-architecture.md`，明确 canonical `agents/` / `workflows/` 与 Codex、Claude Code、OpenCode、CodeBuddy、WorkBuddy、Hermes 等 adapter 边界。
- 已新增 `agents/`、`workflows/` 首批 canonical 文件和 i18n 领域 Agent 样板。

## 当前治理重点

- 已新增 agent thin-index 生成链：`scripts/generate-agent-thin-index.ps1` 可从 canonical `agents/` 生成 `.agents/skills/<agent-name>/SKILL.md`，并已接入 `update-agents.ps1`。
- 已新增 vendor skill 同步链：`install-agents.ps1` / `update-agents.ps1` 会调用 `scripts/sync-vendor-skills.ps1`，当前主要服务 `vendor/superpowers/` 和 `vendor/word-reader/`。
- 工具专属 adapter 生成器暂缓；当前只做通用 agent skill thin-index，不生成 `.codex/agents/`、`.claude/agents/`、`.opencode/`、`.codebuddy/agents/`、WorkBuddy 或 Hermes 原生入口。
- 继续观察 rules 体量，查找表、API 目录和长参考资料优先迁入插件 `references/`。
- 多 Agent 协作已进入顶层 canonical 设计阶段，但暂不实现复杂运行时调度器；第一阶段以 i18n-agent 样板、workflow、交接协议和适配入口生成器为主。
- 暂不新增 `agent-kit-maintenance` 专用 skill；根 `AGENTS.md` 先承载维护入口和规则。

## 最高优先级约束

- 修改 thin-index 生成行为时，只改根 `scripts/generate-plugin-thin-index.ps1`；其它插件同名脚本只能作为 wrapper 转发参数。
- 修改插件目录结构时，同步检查 `.agents-plugin/plugin.json`、插件 `AGENTS.md`、插件 README、仓库 README 和相关 docs。
- 对已部署工程有影响的变更，必须在 README 或插件 README 中说明同步步骤和兼容清理策略。
- 不把根 `AGENTS.md`、根 `memory/`、展示页文件或 `scripts/tests/` 加入业务项目 sparse checkout。
- `agents/` 和 `workflows/` 是能力包正式内容，已加入业务项目 `.agents` sparse checkout；它们不属于 `.agents/.git/info/exclude` 生成层。
- `.agents/plugins/**` 默认全量拉取用于能力发现；插件目录存在只表示 `available`，是否启用以目标项目 `.agents/config/plugin_profile.md` 为准。
- 不写服务器地址、账号、密码、token、namespace、远程路径或任何敏感连接信息。
- 不写完整 rules 正文、长段脚本说明、大段命令输出或一次性排障日志。
- 不把业务项目私有事实写入本仓库插件、规则或记忆。
- 不把短期待办无限追加到 memory；完成后应合并、替换或删除过期条目。
