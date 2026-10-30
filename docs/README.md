# 项目使用文档

插件依赖声明与阶段检查见[可用性依赖](plugin-availability.md)。

本目录随能力包部署，服务业务工程中的接入、开发和运行。先从[能力目录](guides/capability-catalog.md)查找入口，再读[使用指南](guides/capability-guide.md)。业务任务产物保存在目标工程自己的 docs，不写入能力包 docs。

## 按目的阅读

| 目的 | 文档 |
|---|---|
| **第一次使用：让 Agent 部署 / 更新 `.agents`、提请求、宿主适配** | **[团队使用手册](guides/usage-manual.md)** |
| 查看任意自有 skill / Agent 的用法 | [统一帮助](guides/capability-help.md) |
| 查插件、skill、rule | [能力目录](guides/capability-catalog.md) |
| 选择场景、查看请求示例 | [使用指南](guides/capability-guide.md) |
| 查服务地址、凭据来源或排查配置未生效 | [连接信息查看与排查](guides/connection-configuration.md) |
| 安装或更新能力包、旧版迁移 | [安装更新](update-agents.md) |
| 项目知识库骨架、用途说明、旧导航接管、授权归类和恢复 | [项目目录治理](guides/project-knowledge-layout.md) |
| 多模块共享能力包 | [Workspace Overlay](workspace-overlay.md) |
| 创建 worktree 并查看代码差异与历史 | [Worktree 审阅交付](guides/worktree-review.md) |
| 在指定 Agent 宿主发现技能 | [技能适配](coding-agent-adaptation.md) |
| 需求交接和跨会话继续 | [任务交接](task-handoff.md) |
| 执行阶段化协作、恢复任务 | [调度运行手册](agent-orchestration.md) |
| 连续人工验收、逐号交付与编号汇总 | [demand-acceptance](../plugins/demand-delivery-plugin/skills/demand-acceptance/SKILL.md) |
| 夜跑批次与后端/UI 分层验收 | [夜跑接入](night-acceptance.md) |
| 事前 PLAN、双 Developer、冻结交付与持续浏览器 Tester | [无人值守治理](night-governance.md) |
| 可重复验收、空闲会话保活与资源收尾 | [测试运行时](testing-runtime.md) |
| 旧根级技能的插件归属迁移 | [迁移说明](skill-plugin-migration.md) |
| 查询知识与刷新菜单 | [知识接入](guides/imedical-knowledge.md) |
| 接入医生站 AI 插件 | [医生站 AI](guides/iris-imedical-doctor-ai.md) |
| 按 UI 标注改造 HISUI 页面、排查布局与主题兼容 | [IRIS UI](../plugins/iris-ui/README.md) |
| 公司 UI 共性规范、IHOS 海蓝/PURE 天蓝、截图或浏览器评审 | [iMedical UI](../plugins/imedical-ui/README.md) |
| 选择医生站版本清单或 v9.2 全仓对象清单 | [导出参考](reference/project-export-map/doctor/README.md) |
| 按独立开发方式处理带回的源码/完整 XML，保存基线并生成增量/回退交付 | [IRIS 离线开发与交付](../plugins/coding-iris-plugin/references/iris-offline-development.md) |
| 验收 connected XML 双通道导出、代码基线及资源资格 | [IRIS 导出与基线验收](guides/iris-xml-baseline-acceptance.md) |
| connected 项目按需导出、现场合并、部署前同步和 License 准入 | [项目开发协议](../plugins/coding-iris-plugin/references/project-demand-development.md) |
| 查看工作区 manifest 结构 | [capability schema](schemas/workspace-capability.schema.json) |

## 目录约定

- guides/：能力使用与领域接入指南。
- reference/：经核实可复用的参考资产；导出 XML 是带来源与范围的版本化对象清单，可来自服务器工程或离线 checkout。版本标签不证明当前实例版本或内容，实际取确认实例当前源码，不据此自动访问服务器；原有 doctor 路径中的 v9.2 为全仓 10 个产品范围，选择前核对清单口径。
- schemas/：机器可读结构定义。
- 根目录保留已被插件和既有工程引用的稳定操作入口；新增一般指南归入 guides/。

框架治理、设计历史和测试证据仅保存在能力源仓的 maintenance/，不随本目录部署。项目使用文档不依赖维护区链接。xc 的能力手册后续补齐。

人工现场源码导出工具需从能力源仓另行取得独立 ZIP，不随 `.agents` 安装/更新。带回完整源码 XML 后才进入上面的离线编辑流程；ProjectItem 版本清单只有对象范围，不能当源码包修改。离线交付的回退 XML 反映带出时原定义，实际导入或回退前仍须核对现场漂移与授权，本地 Verify 不代表现场已编译或验收。

## BOS 需求

- [需求拆分与代码归属](demand-code-ownership.md)：一级主子关系、共享提交、各自日志与明确无代码阶段。

- [BOS 插件](../plugins/bos-plugin/README.md)：跨技术栈查询与处理入口。
- [个人配置与查询用法](../plugins/bos-plugin/references/usage.md)：按 skill 分段的共享配置、Windows 初始化、显式迁移与查询模式。
- [代码更新日志](../plugins/bos-plugin/references/code-update-log.md)：已有提交的预览、独立配置和授权写入边界。
- [接入与迁移](../plugins/bos-plugin/references/adoption.md)：项目启用、显式私有配置及独立用户级迁移。
- [需求场景验收](../plugins/bos-plugin/references/scenarios.md)：自动检查和真实宿主证据的边界。

需求交付拆分与兼容更新见 [需求交付迁移](demand-delivery-migration.md)：新入口 demand-commit / bos-demand-entry，旧 IRIS 入口已删除，更新器定向迁移项目引用并接入缺失 owner；显式状态冲突阻断，旧数据格式保留。

- [IRIS 统一会话](guides/iris-managed-sessions.md)：CLI/原生 MCP 接入、排队回收、项目升级与定向回退。
