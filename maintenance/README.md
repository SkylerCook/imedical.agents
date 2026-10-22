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
| UI 插件首版与匿名 HISUI 测量 | [验证及本地接入边界](validation/iris-ui-2026-10-21.md) |
| 公司 UI 规范、截图/浏览器评审及 IRIS 适配依赖 | [本轮验证与试读边界](validation/imedical-ui-2026-10-21.md) |
| UI 技能实际使用、局部修复与过度验证纠偏 | [流程复盘及框架回归](validation/ui-skill-usage-2026-10-22.md) |
| UI 业务共性、主题条件与候选扫描 | [改造、场景试读及验证边界](validation/ui-cross-theme-2026-10-22.md) |
| 项目工具的源仓验证 | [交接与兼容验证](validation/project-tools.md) |
| BOS 夜跑 2.1 源仓验证与试点边界 | [验证说明](validation/bos-night-framework-v2.1.md) |
| 事前 PLAN、并行/冻结交付与持续浏览器治理 | [本轮验证及限制](validation/night-governance-2026-10-19.md) |
| 夜跑成果保护、监督与成本回归 | [六处修复及验证边界](validation/night-cost-regression-2026-10-20.md) |
| 第三次无人值守需求处理的框架观察 | [原始观察记录](validation/bos-night-run-3-observations-2026-10-18.md)，本轮治理实施与限制见上方验证 |
| 知识资产来源更新 | [知识资产维护](governance/imedical-knowledge.md) |
| HISUI 固定提交资产升级与校验 | [HISUI 源仓构建](hisui-build/README.md) |

历史案例和旧运行记录只保留证据语义，不作为当前脚本调用或生产部署指令。新业务项目的部署计划、私有脚本和运行记录应归目标项目；已获用户授权删除的旧部署样本不在维护区保留副本。
