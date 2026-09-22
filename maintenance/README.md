# 框架维护资料

本目录仅服务 imedical.agents 源仓维护，不加入业务项目 sparse checkout。项目使用说明见[项目文档](../docs/README.md)，维护状态与队列仍由[维护记忆入口](../memory/agent-kit-maintenance-memory.md)管理。

| 任务 | 入口 |
|---|---|
| 调整文档目录或部署边界 | [文档布局与迁移](governance/documentation-layout.md)、[机器核对清单](governance/documentation-layout.json) |
| 插件版本、发布记录与兼容审计 | [组件版本治理](governance/component-version-management.md) |
| 回看早期工作区方案 | [Workspace Kit v0.2.0](design/ai-coding-workspace-kit-v0.2.0.md)，历史设计，不作为当前项目入口 |
| 框架演进证据及待验收基准 | [验证记录](validation/agent-evolution.md) |
| 框架演进维护交接 | [维护者交接](validation/agent-evolution-maintainer-handoff.md) |
| i18n 协作历史样本 | [i18n P1](validation/i18n-agent-p1/README.md) |
| 打印国际化候选经验 | [案例复盘](validation/cases/print-i18n-case.md) |
| 医生站 AI 源仓验证 | [维护验证说明](validation/iris-imedical-doctor-ai.md) |
| 项目工具的源仓验证 | [交接与兼容验证](validation/project-tools.md) |
| 知识资产来源更新 | [知识资产维护](governance/imedical-knowledge.md) |

历史案例和旧运行记录只保留证据语义，不作为当前脚本调用或生产部署指令。新业务项目的部署计划、私有脚本和运行记录应归目标项目；已获用户授权删除的旧部署样本不在维护区保留副本。
