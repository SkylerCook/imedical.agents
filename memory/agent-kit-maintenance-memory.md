# imedical.agents 维护记忆入口

每轮治理先回读根 [框架维护首要原则](../AGENTS.md#框架维护首要原则)。本文件用于任务路由，版本查 owner manifest，完成证据查[维护日志](agent-kit-maintenance-log.md)，稳定约束查[长期决策](agent-kit-maintenance-decisions.md)，未完成工作查[治理队列](agent-kit-maintenance-backlog.md)。

## 当前重点

- coding 0.29.0 的诊断、自动本地退出证据及调度测量见[实施记录](../maintenance/validation/iris-session-governance-2026-11-13.md)。源码运行时已完成授权只读试点，业务副本升级与平台矩阵按记录分别验收。

- 需求经验审计回归见维护日志，XML 长流与空输出已补离线验证；旧 IRIS 与候选规则取证沿 backlog。

- BOS 更新日志当前仅适用于标版需求，其它类型跳过且不列补录待办。范围归 [BOS owner](../plugins/bos-plugin/references/code-update-log.md#适用范围)，普通开发与连续验收共用。

- 0.28.3 覆盖 profile 混合换行/Pending、需求类型和导出覆盖表单 CR、前端原字节导出及恢复错误优先级。验证见维护日志 2026-11-12，升级同时取得 coding 插件和根 scripts。

- 初始化与更新结果优化见[审计及实施记录](../maintenance/validation/framework-user-burden-audit-2026-11-12.md)。配置缺失集中诊断，必要迁移失败返回非成功，已有配置及自定义 MCP 字段保留。
- 前端源码与服务器编码分开配置，首次确认后复用，具体条件及旧配置兼容归[编码契约](../plugins/coding-iris-plugin/references/frontend-encoding.md)。
- 会话发送阶段恢复、v5 vendor、资源预算和部署方式归[统一会话指南](../docs/guides/iris-managed-sessions.md)。真实故障恢复沿既有 P1 队列，普通工作按当前配置与回执执行。
- xc 能力本轮全部暂缓，只保留原治理记录。人工工具、宿主适配和跨平台验证按 backlog 的启动条件推进。

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
