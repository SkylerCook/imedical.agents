# 项目使用文档

本目录随能力包部署，服务业务工程中的接入、开发和运行。先从[能力目录](guides/capability-catalog.md)查找入口，再读[使用指南](guides/capability-guide.md)。业务任务产物保存在目标工程自己的 docs，不写入能力包 docs。

## 按目的阅读

| 目的 | 文档 |
|---|---|
| 查插件、skill、rule | [能力目录](guides/capability-catalog.md) |
| 选择场景、查看请求示例 | [使用指南](guides/capability-guide.md) |
| 安装或更新能力包、旧版迁移 | [安装更新](update-agents.md) |
| 多模块共享能力包 | [Workspace Overlay](workspace-overlay.md) |
| 在指定 Agent 宿主发现技能 | [技能适配](coding-agent-adaptation.md) |
| 需求交接和跨会话继续 | [任务交接](task-handoff.md) |
| 执行阶段化协作、恢复任务 | [调度运行手册](agent-orchestration.md) |
| 旧根级技能的插件归属迁移 | [迁移说明](skill-plugin-migration.md) |
| 查询知识与刷新菜单 | [知识接入](guides/imedical-knowledge.md) |
| 接入医生站 AI 插件 | [医生站 AI](guides/iris-imedical-doctor-ai.md) |
| 按版本选择医生站导出清单 | [导出参考](reference/project-export-map/doctor/README.md) |
| 查看工作区 manifest 结构 | [capability schema](schemas/workspace-capability.schema.json) |

## 目录约定

- guides/：能力使用与领域接入指南。
- reference/：经核实可复用的参考资产；导出 XML 是历史版本清单，不代表当前工程完整源码，不据此自动访问服务器。
- schemas/：机器可读结构定义。
- 根目录保留已被插件和既有工程引用的稳定操作入口；新增一般指南归入 guides/。

框架治理、设计历史和测试证据仅保存在能力源仓的 maintenance/，不随本目录部署。项目使用文档不依赖维护区链接。xc 的能力手册后续补齐。
