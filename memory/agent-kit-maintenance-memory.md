# imedical.agents 维护记忆入口

本文件只服务能力包源仓；规则以根 [AGENTS.md](../AGENTS.md) 为准。这里保留接手路由，当前版本查 owner manifest，完成记录查日志，未完成事项查 backlog。

## 当前接手

- IRIS XML 与代码基线[本地接入实现](../maintenance/design/iris-xml-baseline-integration-plan.md)已完成：两个入口归 coding owner，版本 XML 表达范围、源码取实例当前状态；基线图片预筛统计，XML 图片沿无损样本回归。已交付本地实现、类源及[验收步骤](../docs/guides/iris-xml-baseline-acceptance.md)，用户随后授权本批提交推送，结果以 Git 回执为准；未更新项目／服务器，安装 XML 未生成，真实通道／资源资格、跨平台实跑与旧入口迁移沿既有 P1/P2 队列，已验范围查[日志](agent-kit-maintenance-log.md)。

- BOS 需求名称的 `[标版]` 按 IRIS 产品交付目标逐条判断，会议、演示及临时数据/环境准备沿非标版工作处理；三类来源共用 [skill 规则](../plugins/bos-plugin/skills/bos-demand-entry/SKILL.md#需求名称与标版标签各类来源共用)。旧草稿名称不自动改写，升级及验证边界查 owner README 和维护日志。

- 验收默认先提交推送、后补 BOS；Git 完成即释放发布权，日志失败/未知只暂停日志，完整交付仍须全部适用回执。BOS 代码日志必须来自实仓 commit；验收批次与独立补录共用 root/ref/hash 门禁，parent 引用主实仓提交、none 跳过，组状态独立计算。升级与恢复见[迁移说明](../docs/demand-delivery-migration.md#实仓提交门禁升级)，验证及未部署边界查维护日志。

- 项目目录说明复用 owner `projectDirectories` 与本地 extensions；README 受管区可持续更新，无标记旧导航先 navigation-plan 精确评审接管。实现与升级边界见[目录治理](../docs/guides/project-knowledge-layout.md#持续目录说明)；目录、说明、逐文件归类分别判断，业务副本与跨平台结果独立取证。
- 最近全局回看覆盖 `58b852b..16a5b6f`（2026-10-22–24，12 个提交），包含上轮明确未审计的 7 笔及上轮文档收尾。发现、修正和验证见[日志覆盖点](agent-kit-maintenance-log.md#全局回看覆盖点)；当前版本查 owner manifest，逐功能证据按日志读取。
- 项目按需同步发布、知识库目录治理及反馈待审补丁均已有条件入口；实现、项目接入、有效授权、真实服务/License 与跨平台验证分别核实。未完成项按[治理队列](agent-kit-maintenance-backlog.md#治理优先级与执行顺序)原 P0–P3 顺序推进。

## 按任务读取

| 任务 | 必读入口与关键分支 |
|---|---|
| 维护本仓、审计提交 | [维护 skill](../.agents/skills/agent-kit-maintenance/SKILL.md)与[日志覆盖点](agent-kit-maintenance-log.md#全局回看覆盖点)；按实际变更核对 owner、手册及测试 |
| 安装、更新、sparse、vendor、thin-index | [更新 runbook](../docs/update-agents.md)；区分 standard/Overlay、严格只读、旧索引及配置迁移 |
| 修改插件或独立 skill、准备提交 | owner AGENTS/README/manifest 与[组件版本治理](../maintenance/governance/component-version-management.md)；校验暂存内容，功能证据按 scope 复用 |
| 修改 Agent、workflow 或共享协议 | [Agent registry](../agents/agent-registry.md)、[workflow registry](../workflows/workflow-registry.md)、对应 AGENT/bindings 与共享协议；adapter 和 canonical 分开 |
| 夜跑批次、预算、监督与恢复 | [治理顺序](../docs/night-governance.md)、[策略与兼容](../docs/night-policy.md)、[分层验收](../docs/night-acceptance.md)；先初筛/能力预检再详细 PLAN，旧 run 保留原契约 |
| BOS 待办、工作量、来源与排序 | [查询 skill](../plugins/bos-plugin/skills/bos-demand-query/SKILL.md)与[使用契约](../plugins/bos-plugin/references/usage.md)；模式/日期/人员/项目或产品条件按当前定义，查询保持只读 |
| BOS 提需、验收与交付 | [BOS owner](../plugins/bos-plugin/README.md)、[交付 owner](../plugins/demand-delivery-plugin/README.md)；主子/无代码读[代码归属](../docs/demand-code-ownership.md)，人工通过读接收结论，提交漂移读[同步复核](../plugins/demand-delivery-plugin/references/commit-upstream-check.md) |
| IRIS 编码、部署、MCP 或 HISUI | [编码 owner](../plugins/coding-iris-plugin/README.md)；已确认 project＋按需上下文先读[项目开发协议](../plugins/coding-iris-plugin/references/project-demand-development.md)，其它分支沿原契约；菜单刷新读[采集协议](../plugins/coding-iris-plugin/references/menu-knowledge-sync.md#无人值守刷新)，vendor 升级读其 AGENTS/README |
| 公司 UI、截图评审或 HISUI 标注/布局 | [通用 UI](../plugins/imedical-ui/README.md)、[IRIS 适配](../plugins/iris-ui/README.md)；按对象语义核对跨主题共性、兼容基准与候选扫描，接入查强依赖和注册/profile；原件更新读 [vendor 说明](../vendor/imedical-ui-standards/README.md) |
| 项目上下文、技能适配或接续 | 目标项目 AGENTS 与 [project-context-maintenance](../plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md)；规则断链或路由变化按其“规则路由维护”补齐并走查，保留等价入口；[技能适配](../docs/coding-agent-adaptation.md)先查 [source.md](../plugins/agent-context-kit/skills/coding-agent-adaptation/references/source.md)，区分项目 skills/规则 MD 与用户级历史观察，未知由用户说明；[task-handoff](../docs/task-handoff.md)用于显式交接 |
| 项目资料新建、目录接入或迁移 | [目录治理](../docs/guides/project-knowledge-layout.md)与 owner projectDirectories；正式知识、当前 ContextRoot/work、旧任务及显式路径分别处理，首次部署/迁移核对具体授权 |
| 业务验收后经验或源仓待审补丁 | [feedback skill](../plugins/agent-framework-evolution/skills/agent-framework-feedback/SKILL.md)按 taskKind、accepted、信号及有效授权分流；框架维护沿维护生命周期，不递归生成反馈 |
| worktree 审阅、阶段恢复点、人工复验与报告 | [审阅交付](../docs/guides/worktree-review.md#阶段提交与恢复点)、[测试协议](../agents/_shared/testing-protocol.md)；阶段提交授权与剩余差异、固定基点、编号汇总、样本及验收分别核验；入口归通用编码规则与项目模板 |
| 查看 skill / Agent 用法 | [统一帮助](../docs/guides/capability-help.md)覆盖自有 init、xc 与 Agent；先读当前源定义，仅展示说明后结束；vendor 沿上游契约 |
| 查找能力、连接或共享知识 | [项目文档](../docs/README.md)；非 xc [目录](../docs/guides/capability-catalog.md)/[指南](../docs/guides/capability-guide.md)，xc 读 owner；[连接配置](../docs/guides/connection-configuration.md)、[知识接入](../docs/guides/imedical-knowledge.md)按需读取 |

## 维护与部署边界

- 源仓治理/验证归 `maintenance/`、维护记忆归 `memory/`、本地维护 skill 归源仓 `.agents/`，均不部署。业务项目 `.agents/` 是能力包 checkout，私有事实留目标工程。
- 能力更新、插件启用、入口生成、宿主发现与业务验收分别核实。Overlay 沿 capability-once/context-many，模块按原完整流程刷新；源仓提交不替代更新回执。
- 框架维护使用 [maintenance lifecycle](../agents/_shared/maintenance-lifecycle.md)，不继承业务验收或 feedback。提交/推送、远程写入与副本部署沿各自既有授权。

完成归[日志](agent-kit-maintenance-log.md)，稳定约束归[决策](agent-kit-maintenance-decisions.md)，待验归[backlog](agent-kit-maintenance-backlog.md)；下轮合并替换本入口的过期状态。
