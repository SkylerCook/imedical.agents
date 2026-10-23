# imedical.agents 维护记忆入口

本文件只服务能力包源仓；规则以根 [AGENTS.md](../AGENTS.md) 为准。这里保留接手路由，当前版本查 owner manifest，完成记录查日志，未完成事项查 backlog。

## 当前接手

- UI 规范与需求经验回归优化在独立 worktree 实施，源节点有效状态、条件读取与明确授权的待审补丁契约见[验证记录](../maintenance/validation/ui-framework-optimization-2026-10-23.md)；第一轮未接入框架，不倒推为接入后失效。实施阶段未提交或合并；用户随后明确授权本次 c + p，提交与 Gitee origin/master 推送以 Git 回执为准。业务副本未更新，后续真实接入沿原 UI P2 队列取证。

- 客户端启动就绪、ACK/历史回读分级及温和退出已回归共享库，接口和验证见[生命周期修复记录](../maintenance/validation/night-client-lifecycle-2026-10-23.md)；业务副本未自动更新。夜跑退出与诊断优化已实施，具体差异及验证见[维护日志](agent-kit-maintenance-log.md#2026-10-23-夜跑退出与客户端诊断)；降级唯一契约归 workflow，真实宿主遵循与其它平台验证沿原夜跑治理队列继续。

- 最近全局回看覆盖 `c8c885b..58b852b`（2026-10-22，6 个提交），承接上一轮 34 个提交的全局审计。范围、发现及本轮验证见[日志覆盖点](agent-kit-maintenance-log.md#全局回看覆盖点)；版本查当前 manifest，逐功能历史证据按日志路由读取。
- 真实夜跑/Goal 监督、业务部署、设备及其它宿主验证仍沿[治理队列](agent-kit-maintenance-backlog.md#治理优先级与执行顺序)取证。源码提交、本机测试和 CI 配置分别表达，不等同业务副本或跨平台已验收。

## 按任务读取

| 任务 | 必读入口与关键分支 |
|---|---|
| 维护本仓、审计提交 | [维护 skill](../.agents/skills/agent-kit-maintenance/SKILL.md)与[日志覆盖点](agent-kit-maintenance-log.md#全局回看覆盖点)；按实际变更核对 owner、手册及测试 |
| 安装、更新、sparse、vendor、thin-index | [更新 runbook](../docs/update-agents.md)；区分 standard/Overlay、严格只读、旧索引及配置迁移 |
| 修改插件或独立 skill、准备提交 | owner AGENTS/README/manifest 与[组件版本治理](../maintenance/governance/component-version-management.md)；校验暂存内容，功能证据按 scope 复用 |
| 修改 Agent、workflow 或共享协议 | [Agent registry](../agents/agent-registry.md)、[workflow registry](../workflows/workflow-registry.md)、对应 AGENT/bindings 与共享协议；adapter 和 canonical 分开 |
| 夜跑批次、预算、监督与恢复 | [治理顺序](../docs/night-governance.md)、[策略与兼容](../docs/night-policy.md)、[分层验收](../docs/night-acceptance.md)；先初筛/能力预检再详细 PLAN，旧 run 保留原契约 |
| BOS 查询、处理、提需与交付 | 待办默认创建日期升序、其它日期 `--sort` / `--order` 见[排序口径](../plugins/bos-plugin/references/usage.md#日期排序口径)；默认开发待办，项目 `--proj` / 产品（非项目）`--dev` 见[来源口径](../plugins/bos-plugin/references/usage.md#项目与产品非项目来源口径)；个人开发待办 `--todo [日期或范围]` 与工作量 `--workload 日期或范围` 先读[查询口径](../plugins/bos-plugin/references/usage.md#个人待办与工作量口径)，列表/需求串见[输出格式](../plugins/bos-plugin/skills/bos-demand-query/SKILL.md#输出格式)；[BOS owner](../plugins/bos-plugin/README.md)、[交付 owner](../plugins/demand-delivery-plugin/README.md)；主子/无代码先读[代码归属](../docs/demand-code-ownership.md)，人工通过快捷参数及多行粘贴读 [接收结论](../plugins/demand-delivery-plugin/skills/demand-acceptance/SKILL.md#接收结论)，提交漂移读[同步复核](../plugins/demand-delivery-plugin/references/commit-upstream-check.md)，[旧入口迁移](../docs/demand-delivery-migration.md)保留数据兼容 |
| IRIS 编码、部署、MCP 或 HISUI | [编码 owner](../plugins/coding-iris-plugin/README.md)；按任务读 CLS/前端规范、UTF-8/legacy、direct/guarded、Atelier/SFTP、Storage；菜单定期采集读[无人值守协议](../plugins/coding-iris-plugin/references/menu-knowledge-sync.md#无人值守刷新)；升级资产再读各 vendor AGENTS/README |
| 公司 UI、截图评审或 HISUI 标注/布局 | [通用 UI](../plugins/imedical-ui/README.md)、[IRIS 适配](../plugins/iris-ui/README.md)；按对象语义核对跨主题共性、兼容基准与候选扫描，接入查强依赖和注册/profile；原件更新读 [vendor 说明](../vendor/imedical-ui-standards/README.md) |
| 项目上下文、技能适配或接续 | 目标项目 AGENTS 与 [project-context-maintenance](../plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md)；规则断链或路由变化按其“规则路由维护”补齐并走查，保留等价入口；[技能适配](../docs/coding-agent-adaptation.md)先查 [source.md](../plugins/agent-context-kit/skills/coding-agent-adaptation/references/source.md)，区分项目 skills/规则 MD 与用户级历史观察，未知由用户说明；[task-handoff](../docs/task-handoff.md)用于显式交接 |
| worktree 审阅、阶段恢复点、人工复验与报告 | [审阅交付](../docs/guides/worktree-review.md#阶段提交与恢复点)、[测试协议](../agents/_shared/testing-protocol.md)；阶段提交授权与剩余差异、固定基点、编号汇总、样本及验收分别核验；入口归通用编码规则与项目模板 |
| 查看 skill / Agent 用法 | [统一帮助](../docs/guides/capability-help.md)覆盖自有 init、xc 与 Agent；先读当前源定义，仅展示说明后结束；vendor 沿上游契约 |
| 查找能力、连接或共享知识 | [项目文档](../docs/README.md)；非 xc [目录](../docs/guides/capability-catalog.md)/[指南](../docs/guides/capability-guide.md)，xc 读 owner；[连接配置](../docs/guides/connection-configuration.md)、[知识接入](../docs/guides/imedical-knowledge.md)按需读取 |

## 维护与部署边界

- 源仓治理/验证归 `maintenance/`、维护记忆归 `memory/`、本地维护 skill 归源仓 `.agents/`，均不部署。业务项目 `.agents/` 是能力包 checkout，私有事实留目标工程。
- 能力更新、插件启用、入口生成、宿主发现与业务验收分别核实。Overlay 沿 capability-once/context-many，模块按原完整流程刷新；源仓提交不替代更新回执。
- 框架维护使用 [maintenance lifecycle](../agents/_shared/maintenance-lifecycle.md)，不继承业务验收或 feedback。提交/推送、远程写入与副本部署沿各自既有授权。

完成归[日志](agent-kit-maintenance-log.md)，稳定约束归[决策](agent-kit-maintenance-decisions.md)，待验归[backlog](agent-kit-maintenance-backlog.md)；下轮合并替换本入口的过期状态。
