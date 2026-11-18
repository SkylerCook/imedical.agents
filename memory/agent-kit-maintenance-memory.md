# imedical.agents 维护记忆入口

每轮治理先回读根 [框架维护首要原则](../AGENTS.md#框架维护首要原则)。本文件用于任务路由，版本查 owner manifest，完成证据查[维护日志](agent-kit-maintenance-log.md)，稳定约束查[长期决策](agent-kit-maintenance-decisions.md)，未完成工作查[治理队列](agent-kit-maintenance-backlog.md)。

## 当前重点

- coding 0.34.1 用 `iris-code-baseline --` 查看 [Skill 命令](../plugins/coding-iris-plugin/skills/iris-code-baseline/SKILL.md#命令)。按路径与类包导出继续通过受管查询生成精确 TXT，复用采集和续采。

- coding 0.33.0 提供本地 [XML 转源码](../plugins/coding-iris-plugin/references/iris-offline-development.md#xml-转独立源码目录)，从基线 Skill 的 `--xtoc` 进入。已有项目正常更新并刷新 Skill 入口，验收范围见维护日志。

- UI 评审经验已补属性范围、两主题边界、原生间距和父子布局对照；单批证据及匿名夹具结果见[验证记录](../maintenance/validation/ui-review-feedback-2026-11-18.md)，业务副本按正常更新取得。

- imedical-ui 0.3.0 增加[手机端活力蓝参考](../plugins/imedical-ui/references/vital-blue-mobile.md)，开发和评审按项目基准读取。完整原型留源仓本地，真实设备与宿主验证沿现有 UI 队列。

- 工作台可交互 UI 原型已落在 tools/agents-workbench/prototype；模拟数据、工程级身份与 Root/模块导航，浏览器验收范围见维护日志。正式后端与宿主集成仍沿 docs/agents-workbench-plan.md。

- 新离线部署默认 Node 24.22.3，工作台复用 ai-dev-offline 环境；框架最低兼容要求保留，验证范围见维护日志与工具准备回执。

- BOS 初始化与配置报错已补逐字段凭证获取指引，统一 access_key 与两项个人凭证分开，使用归[配置说明](../plugins/bos-plugin/references/usage.md#凭证来源与填写)；不内置真实凭据，无私有配置迁移。

- 开发复用已接入通用角色和 IRIS 三个编码入口，事实源为[共享流程](../agents/_shared/execution-guidance.md#开发复用)，验收范围与局限见[本轮记录](../maintenance/validation/development-reuse-2026-11-16.md)。

- 插件按需部署见[指南](../docs/guides/plugin-deployment.md)；0.11.3 补齐操作到项目上下文收尾的交接，目录完整重生成与 CRLF 校验兼容已修复。状态、路由与宿主加载分别验收，最新证据见[维护日志](agent-kit-maintenance-log.md)，原范围见[实施记录](../maintenance/validation/plugin-on-demand-2026-11-13.md)。

- coding 0.29.0 的诊断、自动本地退出证据及调度测量见[实施记录](../maintenance/validation/iris-session-governance-2026-11-13.md)。源码运行时已完成授权只读试点，业务副本升级与平台矩阵按记录分别验收。

- 需求经验审计回归见维护日志，XML 长流与空输出已补离线验证；旧 IRIS 与候选规则取证沿 backlog。

- BOS 更新日志当前仅适用于标版需求，其它类型跳过且不列补录待办。范围归 [BOS owner](../plugins/bos-plugin/references/code-update-log.md#适用范围)，普通开发与连续验收共用。

- 0.28.3 覆盖 profile 混合换行/Pending、需求类型和导出覆盖表单 CR、前端原字节导出及恢复错误优先级。验证见维护日志 2026-11-12，升级同时取得 coding 插件和根 scripts。

- 初始化与更新结果优化见[审计及实施记录](../maintenance/validation/framework-user-burden-audit-2026-11-12.md)。配置缺失集中诊断，必要迁移失败返回非成功，已有配置及自定义 MCP 字段保留。
- 前端源码与服务器编码分开配置，首次确认后复用，具体条件及旧配置兼容归[编码契约](../plugins/coding-iris-plugin/references/frontend-encoding.md)。
- MCP 已升级至 1.7.1 + v6，官方 8 项 skill 同步固定原文，构建、30 项专项及验收边界见[升级记录](../maintenance/validation/iris-mcp-171-upgrade-2026-11-13.md)。会话与部署归[统一会话指南](../docs/guides/iris-managed-sessions.md)，真实故障恢复沿既有 P1 队列。
- 人工源码基线已收敛默认全量、按对象保护与安全退出恢复；[GUI](../tools/iris-code-export/GUI.md)支持项目简称 / 项目版本保存、离线导入和继续维护，清单版本独立保留。真实现场与平台兼容验证沿原队列。
- xc 领域能力治理沿既有暂缓队列；按需部署本轮补充其必需资源声明。人工工具、宿主适配和跨平台验证按 backlog 的启动条件推进。

## 按任务读取

| 任务 | 必读入口与关键分支 |
|---|---|
| 维护本仓、审计提交 | [维护 skill](../.agents/skills/agent-kit-maintenance/SKILL.md)与[日志覆盖点](agent-kit-maintenance-log.md#全局回看覆盖点) |
| 更新共享知识或 UI/HISUI 参考、建库或续建 | [知识库维护 skill](../.agents/skills/knowledge-maintenance/SKILL.md)串联来源审查、增量构建、验证和导出 |
| 安装、更新、sparse、vendor、thin-index | [更新 runbook](../docs/update-agents.md) |
| 修改插件或独立 skill、准备提交 | owner AGENTS/README/manifest 与[组件版本治理](../maintenance/governance/component-version-management.md) |
| 修改 Agent、workflow 或共享协议 | [Agent registry](../agents/agent-registry.md)、[workflow registry](../workflows/workflow-registry.md)、对应 AGENT frontmatter 与共享协议 |
| 夜跑批次、预算、监督与恢复 | [治理顺序](../docs/night-governance.md)、[策略与兼容](../docs/night-policy.md)、[分层验收](../docs/night-acceptance.md) |
| BOS 待办、工作量、来源与排序 | [查询 skill](../plugins/bos-plugin/skills/bos-demand-query/SKILL.md)与[使用契约](../plugins/bos-plugin/references/usage.md) |
| BOS 提需、验收与交付 | [BOS owner](../plugins/bos-plugin/README.md)、[交付 owner](../plugins/demand-delivery-plugin/README.md) |
| IRIS 会话接入、升级、退出或异常恢复 | [统一会话](../docs/guides/iris-managed-sessions.md)：CLI/原生 MCP 实际回执、standard/Overlay 迁移及回退 |
| 移动端开发、日志排障与建仓交接 | [mobile-dev](../plugins/mobile-dev/README.md) |
| IRIS 编码、部署、MCP 或 HISUI | [编码 owner](../plugins/coding-iris-plugin/README.md)先分流开发方式 |
| 受管 XML 导出、版本清单或源码基线 | [XML 导出](../plugins/coding-iris-plugin/references/iris-xml-export.md)与[代码基线](../plugins/coding-iris-plugin/references/iris-code-baseline.md) |
| 人工现场导出、源码离线交付或带回 XML 编辑 | 人工用[独立 ZIP](../tools/iris-code-export/README.md)或[图形 EXE 包](../tools/iris-code-export/GUI.md)：版本范围/补充 TXT/显式 Web 映射，选择摘要绑定恢复 |
| 公司 UI、截图评审或 HISUI 标注/布局 | [通用 UI](../plugins/imedical-ui/README.md)、[IRIS 适配](../plugins/iris-ui/README.md) |
| 项目上下文、技能适配或接续 | 目标项目 AGENTS 与 [project-context-maintenance](../plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md) |
| 项目资料新建、目录说明接管或迁移 | [目录治理](../docs/guides/project-knowledge-layout.md)与 owner projectDirectories／本地 extensions |
| 业务验收后经验或源仓待审补丁 | [feedback skill](../plugins/agent-framework-evolution/skills/agent-framework-feedback/SKILL.md)按 taskKind、accepted、信号及有效授权分流 |
| worktree 审阅、阶段恢复点、人工复验与报告 | [审阅交付](../docs/guides/worktree-review.md#阶段提交与恢复点)、[测试协议](../agents/_shared/testing-protocol.md) |
| 查看 skill / Agent 用法 | [统一帮助](../docs/guides/capability-help.md)覆盖自有 init、xc 与 Agent |
| 查找能力、连接或共享知识 | [项目文档](../docs/README.md) |


## 维护与部署边界

源仓目录与部署白名单按根 AGENTS.md。Overlay 先更新共享 CapabilityRoot，再刷新各 ContextRoot；配置、生成物、宿主加载和业务验收分别核实。框架维护沿 [maintenance lifecycle](../agents/_shared/maintenance-lifecycle.md)，真实服务操作按目标项目授权执行。

- 轻量 RAG 默认本地检索、公司向量选装、JSON 配置及验证缺口见[实施记录](../maintenance/validation/knowledge-rag-2026-11-13.md)，使用归[检索指南](../docs/guides/knowledge-retrieval.md)。

- 2026-11-13：插件生命周期操作统一从 agent-context-kit 的 plugin-management 进入。
