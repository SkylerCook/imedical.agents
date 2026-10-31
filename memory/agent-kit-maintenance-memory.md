# imedical.agents 维护记忆入口

本文件只服务能力包源仓；规则以根 [AGENTS.md](../AGENTS.md) 为准。这里保留接手路由，当前版本查 owner manifest，完成记录查日志，未完成事项查 backlog。

## 当前接手

- 离线交付检查原始 Git 共同基线及打包后源码漂移，XML 保留原换行/BOM；旧任务保留已有修改后按 [迁移入口](../plugins/coding-iris-plugin/references/iris-offline-development.md#git-原始基线与交付一致性)重建，模型执行习惯不纳入本次框架规则。

- IRIS 初始化/重新部署默认沿 [coding-iris-init](../plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md#本地配置初始化与已有项目补齐)生成必要配置并 Check；已启用项目普通更新沿既有迁移自动补缺文件，保留已有字节和旧模式缺省。未知模式/环境集中确认，统一会话迁移先于补缺：无旧策略才生成受管单会话默认值，已有禁用保留；配置、资格、before-edit 基线分开报告；旧恢复材料先核实。
- 人工 [AI 开发离线物料](../tools/ai-dev-offline/README.md)归 tools：固定原包、CodeBuddy、安全模板、PATH及用户默认PowerShell 7自动配置；后者用所选VS Code运行时和固定JSONC库，无需另装Node，含冲突保护和私有备份／增量恢复。文件写入／Process CMD与GUI／Machine／医院验收分开；不随`.agents`分发，没有完整安装或其它配置通用导入。
- 最近全局回看覆盖 `dadd6a9..9a13586`（2026-10-31，9 个提交）。发现、修正、CI 快照及验证见[日志覆盖点](agent-kit-maintenance-log.md#全局回看覆盖点)；版本查 owner manifest，历史实施状态不作当前未提交结论。
- IRIS 帮助先于模式与业务前置；实际开发先按独立 developmentMode 分流，再选择在线项目同步或[离线交付](../plugins/coding-iris-plugin/references/iris-offline-development.md)。在线项目按需分支的待修改文件，无论本地是否存在，先同步、有变化先提交 export，再开始修改；普通导出直写会指向 source-sync。源码助手唯一实现归 coding owner，人工 ZIP 取同一核心；框架绑定批次/范围与源码 Git，原包私有保存，旧任务原位恢复。当前打包限 Windows，本地 Verify 与现场验收分别报告。
- Overlay 实体 SourceRoot 见 [runbook](../docs/workspace-overlay.md#sourceroot引用已有源码或持有本地源码)：path/target 相同声明实体目录，旧 Junction 保持。先更新共享 capability 再按项目授权接入；物理等价路径不扩大源码范围，不自动初始化 Git 或迁移源码。
- 夜跑准备先基础探测、原预算内补齐适配与用例、定向复验，再详细 PLAN；逐用例认证/写入副作用及缺口读[项目适配](../docs/night-acceptance.md#逐需求预检与补齐)。局部通过与共享资源退出分别核验，旧 run 和已确认降级保持。
- XML／基线、目录受管说明、Git/BOS 解耦和部署有限恢复按下表读取 owner；类源、目录检查、Git 推送均保留各自完成边界。源仓实现不代表业务副本已部署。
- 未完成的真实试点、资源资格、旧入口迁移和跨平台结果沿[治理队列](agent-kit-maintenance-backlog.md#治理优先级与执行顺序)原 P0–P3 顺序推进；源仓维护不自动更新业务工程或执行服务器操作。

新增 xc 业务理解/提交周报目录尚待 manifest、发布与依赖治理；外部登记/发送与私有配置历史检查见 backlog，目录存在不作为可安装结论。团队日常入口见[使用手册](../docs/guides/usage-manual.md)。

## 按任务读取

| 任务 | 必读入口与关键分支 |
|---|---|
| 维护本仓、审计提交 | [维护 skill](../.agents/skills/agent-kit-maintenance/SKILL.md)与[日志覆盖点](agent-kit-maintenance-log.md#全局回看覆盖点)；按实际变更核对 owner、手册及测试 |
| 安装、更新、sparse、vendor、thin-index | [更新 runbook](../docs/update-agents.md)；区分 standard/Overlay、严格只读、旧索引及配置迁移 |
| 修改插件或独立 skill、准备提交 | owner AGENTS/README/manifest 与[组件版本治理](../maintenance/governance/component-version-management.md)；校验暂存内容，功能证据按 scope 复用 |
| 修改 Agent、workflow 或共享协议 | [Agent registry](../agents/agent-registry.md)、[workflow registry](../workflows/workflow-registry.md)、对应 AGENT/bindings 与共享协议；adapter 和 canonical 分开 |
| 夜跑批次、预算、监督与恢复 | [治理顺序](../docs/night-governance.md)、[策略与兼容](../docs/night-policy.md)、[分层验收](../docs/night-acceptance.md)；先基础探测、预算内补齐及定向复验再详细 PLAN；逐用例能力与缺口诊断沿验收文档，旧 run 保留原契约 |
| BOS 待办、工作量、来源与排序 | [查询 skill](../plugins/bos-plugin/skills/bos-demand-query/SKILL.md)与[使用契约](../plugins/bos-plugin/references/usage.md)；测试阶段按个人口径分类，数量差异刷新原范围并逐号复核，查询保持只读 |
| BOS 提需、验收与交付 | [BOS owner](../plugins/bos-plugin/README.md)、[交付 owner](../plugins/demand-delivery-plugin/README.md)；名称标签读[产品交付规则](../plugins/bos-plugin/skills/bos-demand-entry/SKILL.md#需求名称与标版标签各类来源共用)，project 暂无编号提交读[demand-commit](../plugins/demand-delivery-plugin/skills/demand-commit/SKILL.md)的显式 --no-id；主子/无代码、实仓日志、Git/BOS 独立恢复读[代码归属](../docs/demand-code-ownership.md)，提交漂移读[同步复核](../plugins/demand-delivery-plugin/references/commit-upstream-check.md) |
| IRIS 会话接入、升级、退出或异常恢复 | [统一会话](../docs/guides/iris-managed-sessions.md)：CLI/原生 MCP 实际回执、standard/Overlay 迁移及回退；服务端会话与 License 分别取证 |
| 移动端开发、日志排障与建仓交接 | [mobile-dev](../plugins/mobile-dev/README.md)；Android 故障先取日志，其它技术栈先核对工具；真实接入沿 backlog P2 |
| IRIS 编码、部署、MCP 或 HISUI | [编码 owner](../plugins/coding-iris-plugin/README.md)先分流开发方式；connected＋project＋按需上下文读[项目开发协议](../plugins/coding-iris-plugin/references/project-demand-development.md)，offline 读[离线协议](../plugins/coding-iris-plugin/references/iris-offline-development.md)；在线失败读[恢复与停止](../plugins/coding-iris-plugin/references/deployment-protection.md#失败恢复与授权)，菜单刷新读[采集协议](../plugins/coding-iris-plugin/references/menu-knowledge-sync.md#无人值守刷新)，vendor 升级读其 AGENTS/README |
| 受管 XML 导出、版本清单或源码基线 | [XML 导出](../plugins/coding-iris-plugin/references/iris-xml-export.md)与[代码基线](../plugins/coding-iris-plugin/references/iris-code-baseline.md)；范围清单／当前实例、包图片／代码预筛、纯采集／项目提交分别处理；真实类安装与资源资格读[验收步骤](../docs/guides/iris-xml-baseline-acceptance.md) |
| 人工现场导出、源码离线交付或带回 XML 编辑 | 人工用[独立 ZIP](../tools/iris-code-export/README.md)或[图形 EXE 包](../tools/iris-code-export/GUI.md)：版本范围/补充 TXT/显式 Web 映射，选择摘要绑定恢复；版本不等同历史源码，v9.2 只声明全仓。带回回执源码、人工目录或完整 XML 后读[离线协议](../plugins/coding-iris-plugin/references/iris-offline-development.md)，沿唯一 helper 生成增量／回退／说明／manifest 并独立 Verify；范围清单不是源码，回退包不替代现场备份与漂移核对 |
| 公司 UI、截图评审或 HISUI 标注/布局 | [通用 UI](../plugins/imedical-ui/README.md)、[IRIS 适配](../plugins/iris-ui/README.md)；按任务核对主题、基准与启用状态，原件更新读 [vendor 说明](../vendor/imedical-ui-standards/README.md) |
| 项目上下文、技能适配或接续 | 目标项目 AGENTS 与 [project-context-maintenance](../plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md)；规则断链按其路由维护走查；宿主发现读[适配指南](../docs/coding-agent-adaptation.md)，项目目录与用户级观察分开；显式交接读[task-handoff](../docs/task-handoff.md) |
| 项目资料新建、目录说明接管或迁移 | [目录治理](../docs/guides/project-knowledge-layout.md)与 owner projectDirectories／本地 extensions；首次接入、旧导航接管、资料迁移分别评审，受管区更新保留人工正文；当前 ContextRoot/work、旧任务及显式路径分别处理 |
| 业务验收后经验或源仓待审补丁 | [feedback skill](../plugins/agent-framework-evolution/skills/agent-framework-feedback/SKILL.md)按 taskKind、accepted、信号及有效授权分流；框架维护沿维护生命周期，不递归生成反馈 |
| worktree 审阅、阶段恢复点、人工复验与报告 | [审阅交付](../docs/guides/worktree-review.md#阶段提交与恢复点)、[测试协议](../agents/_shared/testing-protocol.md)；阶段提交授权与剩余差异、固定基点、编号汇总、样本及验收分别核验；入口归通用编码规则与项目模板 |
| 查看 skill / Agent 用法 | [统一帮助](../docs/guides/capability-help.md)覆盖自有 init、xc 与 Agent；先读当前源定义，仅展示说明后结束；vendor 沿上游契约 |
| 查找能力、连接或共享知识 | [项目文档](../docs/README.md)；非 xc [目录](../docs/guides/capability-catalog.md)/[指南](../docs/guides/capability-guide.md)，xc 读 owner；[连接配置](../docs/guides/connection-configuration.md)、[知识接入](../docs/guides/imedical-knowledge.md)按需读取 |

## 维护与部署边界

- 源仓治理/验证归 `maintenance/`、维护记忆归 `memory/`、本地维护 skill 归源仓 `.agents/`、人工独立工具归 `tools/`，均不部署。业务项目 `.agents/` 是能力包 checkout，私有事实留目标工程；本机工具 ZIP 与共享源分开。
- 能力更新、插件启用、入口生成、宿主发现与业务验收分别核实。Overlay 沿 capability-once/context-many，模块按原完整流程刷新；源仓提交不替代更新回执。
- 框架维护使用 [maintenance lifecycle](../agents/_shared/maintenance-lifecycle.md)，不继承业务验收或 feedback。提交/推送、远程写入与副本部署沿各自既有授权。

完成归[日志](agent-kit-maintenance-log.md)，稳定约束归[决策](agent-kit-maintenance-decisions.md)，待验归[backlog](agent-kit-maintenance-backlog.md)；下轮合并替换本入口的过期状态。
