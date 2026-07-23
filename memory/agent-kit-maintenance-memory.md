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
- `plugins/coding-iris-plugin/` 负责 IRIS/ObjectScript/CSP/JavaScript/HISUI 编码能力，并提供 `iris-mcp-lookup` 知识查询 skill；7 个上游官方实用 skill 以 optional vendor 快照提供。
- coding-iris 前端编码使用 `standard-gb2312` / `project-utf8` 双模式；路径与仓库角色只提出候选，实际文件字节检测是最终门禁，已部署项目通过插件迁移钩子更新本地 profile。HISUI 控件/API 与主题样式/视觉资源分别由 `hisui-widget-index.md`、`hisui-style-index.md` 按需路由。
- `plugins/extract-doc/` 负责 PDF、DOC、DOCX、XLS、XLSX 的本地解析和结构化落盘，是接口类业务插件的通用文档依赖。
- `plugins/i18n-iris-plugin/` 负责 IRIS/ObjectScript/CSP/HISUI 国际化能力。
- `plugins/iris-interface-dev-plugin/` 负责接口 schema、字段诊断和开发计划，文档读取委托 `extract-doc`。
- `plugins/iris-external-reg/` 负责编排第三方预约挂号接口开发，依赖 `extract-doc` 和 `coding-iris-plugin`。
- `plugins/imedicalxc-doctor-extend-engineer/` 负责 HIS 医生站第三方系统集成编排，主入口为 `skills/imedicalxc-doctor-extend-engineer/SKILL.md`，子 skill 由主编排器按需读取。
- 已落地首个领域样板 `agents/i18n-agent/` 和 `workflows/i18n-change.workflow.md`，用于 IRIS i18n 需求的链路定位、数据分类、编码/模板/种子和验证五阶段处理。
- 当前重点维护方向是先固化多人协作提交准入和仓库一致性检查；`i18n-agent` / `i18n-change.workflow.md` 已完成串行回溯、首次偏差实战和 `#6097891` 标准化实战，schema 1.2 已覆盖暂停恢复与最终验证门禁。通用 workflow/Agent 仍需不同任务形态样本，rules 体量与工具原生 adapter 继续观察，不抢占主线。
- 根 `AGENTS.md` 只服务本仓库维护，不部署到业务项目 `.agents/`；业务项目仍使用业务项目自己的 `AGENTS.md` 和 `.agents/` 上下文。

## 必读路由

- 修改安装、更新、sparse checkout 或托管更新流程：读取 `docs/update-agents.md`、`scripts/install-agents.ps1`、`scripts/update-agents.ps1` 和长期决策。
- 修改 thin-index 行为：读取 `scripts/generate-plugin-thin-index.ps1`、相关插件 wrapper、长期决策和近期日志。
- 修改智能体或 workflow：读取 `memory/plan/multi-agent-architecture.md`、`agents/agent-registry.md`、`workflows/workflow-registry.md` 和相关 `AGENT.md` / `.workflow.md`。
- 修改插件能力：读取对应插件 `AGENTS.md`、README、skills、rules、templates 和 manifest。
- 维护能力包仓库本身、检查插件提交同步或更新维护记忆：读取 `.agents/skills/agent-kit-maintenance/SKILL.md`；该仓库本地 skill 不在业务项目 sparse checkout 部署清单内。
- 维护记忆：保持本文件短摘要；细节按长期决策、维护日志、治理队列分流。
- 处理业务项目上下文：不要使用本文件作为项目记忆；改用目标项目自己的 `AGENTS.md` 和 `project-context-maintenance`。

## 近期关键变化

- 新增 `iris-mcp-lookup`，统一路由当前实例元数据、本地源码、IRIS 官方文档，并支持 DocBook `Fetch` URL；从 `iris-agentic-dev` v0.9.4 固定提交引入 7 个官方实用 skill，保持上游原文和许可证，作为 optional vendor 分发。根 `iris-mcp.js` 已按 v0.9.3 schema 精确门控 `mode` / `action`，摘要 `check_config.capabilities`，并允许断连状态下继续列出工具进行诊断。
- coding-iris 已拆分 HISUI 控件/API 与 CSS 样式/资源索引，前端规则按控件、主题、locale、语义 class、图标和插图分流读取；索引维护同时区分源仓 `vendor/` 与部署态 `.agents/vendor/`。
- 文档解析能力已从 `iris-interface-dev-plugin` 拆分为通用 `extract-doc` 插件；接口插件保留 `iris-interface-doc-ingest` 适配入口和 `iris-interface-doc-ingest/v2` schema，专项测试直接验证新的 parser owner 路径。
- 已新增 `iris-external-reg` 插件，覆盖第三方预约挂号接口规范解析、执行计划、ObjectScript 实现和验证，manifest 显式依赖 `extract-doc`、`coding-iris-plugin`。
- 框架反馈模板与共享协议已统一要求记录“问题发现过程”；已应用反馈必须更新状态和处理记录，不能继续保留为无 diff 的“待处理”条目。
- `i18n-agent` 已建立三种运行模式、Step 0 启动契约和编号 handoff；schema 1.2 增加 attempts、capability matrix、远程动作终态、finalization 和限定 verification scope，并保留 1.0/1.1 校验兼容。`#6097891` 已形成脱敏异常恢复回归样本。
- `agent-framework-feedback` 已升级为 HIS 任务统一收尾入口：需求经验与独立框架修正分流处理，无候选时不生成空反馈；反馈提交和推送仍需用户明确要求。
- XML 打印模板同步在远端保存遇到临时类 `Execute+...<SYNTAX>` 时，会复用既有 XML/manifest/备份并自动切换 Base64 分块 fallback，专项离线回归覆盖成功、收敛和清理路径。
- 已新增 `imedicalxc-doctor-perf-analysis-engineer` 插件，覆盖医生站接口性能分析与优化、前后端链路追踪、Graylog 日志分析、N+1/批量调用优化和性能报告输出；init skill 与主编排 skill 分离，thin-index wrapper 默认只暴露主编排器入口。
- 已新增 `imedicalxc-doctor-data-extraction` 插件，用于 HIS 数据抽取、`@OpenApi` Controller 扫描、第三方接口对照文档和字段映射生成，Feign/API 文档生成作为辅助能力。
- 已新增 `imedicalxc-doctor-print-template-design` 插件，用于 HIS 打印模板设计和 `.xlsx` 模板生成，覆盖 Word/docx 参考文档到主模板/扩展模板的工作流。
- `scripts/install-agents.ps1` 和 `scripts/update-agents.ps1` 已新增 Git 版本前置校验；`docs/update-agents.md` 和更新脚本测试已同步覆盖。
- vendor skill 已改为按 enabled 插件 capability 发现：`vendor/superpowers/` 和 `vendor/word-reader/` 仍随 `/vendor/**` 部署作为 fallback，但常规安装/更新不再全量写用户目录；resolver 只为 required skill 生成 `.agents/skills` 通用入口，optional 按任务触发，用户级 runtime 同步必须显式指定 skill。
- 已新增并重构 `imedicalxc-doctor-extend-engineer` 插件，采用标准插件结构、内置多模块 Maven 依赖安装脚本，thin-index wrapper 默认只暴露主编排器入口，医生站第三方集成子 skill 由主编排器按需加载。
- 已精简 `imedicalxc-doctor-dbdata` skill，聚焦数据库查询核心规范，重点保留医保对照、基础数据统一对照和合并查询（Merge Query）等高价值领域知识，并同步更新医生站扩展主编排器和架构引用。
- 已新增 `demo/presentation/` 演示页面，作为能力包、i18n skill 和多智能体架构的可视化说明材料；它不属于业务项目运行入口。
- 已新增部署经验沉淀入口 `feedback/experience/deploy-com-exp.md` 和首个专项部署工具目录 `docs/deploy/dental-ta-159/`；这类内容可随 `docs/` 部署，但不得把业务私有连接信息写入记忆或规则。
- 已新增提交前差异降噪 Git hook 分发能力：`.agents/hooks/pre-commit`、`.agents/scripts/check-functional-diff.ps1` 和 `.agents/scripts/install-git-hooks.ps1` 随 `.agents` 更新可用，但 `install-agents.ps1` / `update-agents.ps1` 不自动修改业务项目 `core.hooksPath`，只报告 hook 可用或启用状态。
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

- P0 一致性回归已补充本轮暴露的 targeted 检查：新插件总览、依赖 manifest、HISUI reference 路由、反馈模板字段，以及 `extract-doc` 拆分后的专项测试 owner 路径；全插件通用结构门禁仍按 backlog 继续推进。
- 已新增 agent thin-index 生成链：`scripts/generate-agent-thin-index.ps1` 可从 canonical `agents/` 生成 `.agents/skills/<agent-name>/SKILL.md`，并已接入 `update-agents.ps1`。
- vendor skill 核心链路已厂商无关化：manifest 声明 capability，resolver 生成 required 项目 thin-index；Claude Code/Codex 只保留显式 runtime adapter，同步不再是常规更新前置。OpenCode、CodeBuddy、WorkBuddy、Hermes 使用项目通用层或直接源文件降级。
- 工具专属 agent adapter 生成器仍暂缓；当前已开始做 Claude Code/Codex 的 skill 发现层适配，但不生成 `.codex/agents/`、`.claude/agents/`、`.opencode/`、`.codebuddy/agents/`、WorkBuddy 或 Hermes 原生 agent 入口。
- 继续观察 rules 体量，查找表、API 目录和长参考资料优先迁入插件 `references/`。
- 多 Agent 协作已完成 i18n 样板的脱敏串行回溯、运行 manifest 和事后校验器；下一阶段是在真实需求中验证明确授权的多智能体编排，暂不实现复杂运行时调度器或工具原生 adapter。
- 维护者专用 `agent-kit-maintenance` 已迁入 `.agents/skills/agent-kit-maintenance/SKILL.md`，作为受版本控制的仓库本地上下文；根 `skills/` 只保留会部署到业务项目的通用 skill，根 `AGENTS.md` 仍承载最高优先级维护入口和规则。

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
