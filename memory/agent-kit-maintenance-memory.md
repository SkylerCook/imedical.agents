# imedical.agents 维护记忆入口

本文件只服务能力包源仓；规则以根 [AGENTS.md](../AGENTS.md) 为准。这里保留接手路由，当前版本查 owner manifest，完成记录查日志，未完成事项查 backlog。

## 当前接手

- 自有 skill（含 init、xc）和 Agent 的 `--help` / 查看用法从源定义首段进入[统一帮助协议](../docs/guides/capability-help.md)，展示后结束；新旧索引模板保持。分发、PS5.1/PS7 与宿主抽样边界见[本轮验证](../maintenance/validation/capability-help-2026-10-22.md)，业务副本仍按正常更新分别验收。

- 主子需求与共享代码：业务拆分和代码归属按[共享协议](../docs/demand-code-ownership.md)，bos-plugin提供v4草稿/显式日志bindings，交付owner提供验收v2及主提交/push引用；旧数据不自动迁移。验证与服务端边界见[本轮记录](../maintenance/validation/demand-code-ownership-2026-10-22.md)。

- demand-commit 的上游无交集更新由 Agent 复核后沿用已有提交授权接续，条件与次数集中于[同步复核协议](../plugins/demand-delivery-plugin/references/commit-upstream-check.md)；真实宿主与非本机矩阵证据沿既有 P2 需求交付队列取得。
- 最近全局回看覆盖 `087511d..c7e828d`（2026-10-16–21，34 个提交），承接上一轮 `e964d0e..da28585`。范围、修正及验证见[日志覆盖点](agent-kit-maintenance-log.md#全局回看覆盖点)，不代表业务副本或跨平台已验收。
- UI 分层：`imedical-ui` 提炼技术栈无关公司规范并评审截图/浏览器；`iris-ui` 负责 IRIS CSP＋HISUI，强依赖通用层和编码插件。跨主题共性的归类、主题条件核对和只读候选扫描见[本轮回归](../maintenance/validation/ui-cross-theme-2026-10-22.md)；局部验证的范围与停止条件归[共享测试协议](../agents/_shared/testing-protocol.md#验证范围与停止条件)，早期使用复盘见[维护记录](../maintenance/validation/ui-skill-usage-2026-10-22.md)；完整原件与可分发证据边界见[长期决策](agent-kit-maintenance-decisions.md#领域插件与项目资料边界)。
- 真实夜跑/Goal 监督、业务部署与设备验收仍须独立取证。Windows 本地测试、CI 配置和源仓提交各有边界；当前 P0–P3 顺序及责任见[治理队列](agent-kit-maintenance-backlog.md#治理优先级与执行顺序)。

## 按任务读取

| 任务 | 必读入口与关键分支 |
|---|---|
| 维护本仓、审计提交 | [维护 skill](../.agents/skills/agent-kit-maintenance/SKILL.md)与[日志覆盖点](agent-kit-maintenance-log.md#全局回看覆盖点)；按实际变更核对 owner、手册及测试 |
| 安装、更新、sparse、vendor、thin-index | [更新 runbook](../docs/update-agents.md)；区分 standard/Overlay、严格只读、旧索引及配置迁移 |
| 修改插件或独立 skill、准备提交 | owner AGENTS/README/manifest 与[组件版本治理](../maintenance/governance/component-version-management.md)；校验暂存内容，功能证据按 scope 复用 |
| 修改 Agent、workflow 或共享协议 | [Agent registry](../agents/agent-registry.md)、[workflow registry](../workflows/workflow-registry.md)、对应 AGENT/bindings 与共享协议；adapter 和 canonical 分开 |
| 夜跑批次、预算、监督与恢复 | [治理顺序](../docs/night-governance.md)、[策略与兼容](../docs/night-policy.md)、[分层验收](../docs/night-acceptance.md)；先初筛/能力预检再详细 PLAN，旧 run 保留原契约 |
| BOS 查询、处理、提需与交付 | [BOS owner](../plugins/bos-plugin/README.md)、[交付 owner](../plugins/demand-delivery-plugin/README.md)；代码/工作/主题来源与明确验收调用授权按 skill，[旧入口迁移](../docs/demand-delivery-migration.md) |
| IRIS 编码、部署、MCP 或 HISUI | [编码 owner](../plugins/coding-iris-plugin/README.md)；按任务读 CLS/前端规范、UTF-8/legacy、direct/guarded、Atelier/SFTP、Storage；升级资产再读各 vendor AGENTS/README |
| 公司 UI、截图评审或 HISUI 标注/布局 | [通用 UI](../plugins/imedical-ui/README.md)、[IRIS 适配](../plugins/iris-ui/README.md)；原件更新读 [vendor 说明](../vendor/imedical-ui-standards/README.md)，接入核对强依赖和注册/profile |
| 项目上下文、技能适配或接续 | 目标项目 AGENTS 与 [project-context-maintenance](../plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md)；[技能适配](../docs/coding-agent-adaptation.md)区分原生发现/目录链接，[task-handoff](../docs/task-handoff.md)用于显式交接 |
| worktree 审阅、阶段恢复点、人工复验与报告 | [审阅交付](../docs/guides/worktree-review.md#阶段提交与恢复点)、[测试协议](../agents/_shared/testing-protocol.md)；阶段提交授权与剩余差异、固定基点、编号汇总、样本及验收分别核验；入口归通用编码规则与项目模板 |
| 查找能力、连接或共享知识 | [项目文档](../docs/README.md)；非 xc [目录](../docs/guides/capability-catalog.md)/[指南](../docs/guides/capability-guide.md)，xc 读 owner；[连接配置](../docs/guides/connection-configuration.md)、[知识接入](../docs/guides/imedical-knowledge.md)按需读取 |

## 维护与部署边界

- 源仓治理/验证归 `maintenance/`、维护记忆归 `memory/`、本地维护 skill 归源仓 `.agents/`，均不部署。业务项目 `.agents/` 是能力包 checkout，私有事实留目标工程。
- 能力更新、插件启用、入口生成、宿主发现与业务验收分别核实。Overlay 沿 capability-once/context-many，模块按原完整流程刷新；源仓提交不替代更新回执。
- 框架维护使用 [maintenance lifecycle](../agents/_shared/maintenance-lifecycle.md)，不继承业务验收或 feedback。提交/推送、远程写入与副本部署沿各自既有授权。

完成归[日志](agent-kit-maintenance-log.md)，稳定约束归[决策](agent-kit-maintenance-decisions.md)，待验归[backlog](agent-kit-maintenance-backlog.md)；下轮合并替换本入口的过期状态。
