---
name: iris_coding_index
description: Use as the first coding rule index for IRIS/ObjectScript/CSP/HISUI tasks after reading the project profile.
task-affinity: [iris, coding, routing, index]
related:
  - iris_coding_general.md
  - iris_coding_backend.md
  - iris_coding_frontend.md
  - iris_coding_workflow.md
  - iris_knowledge_lookup.md
---

# IRIS 编码规则索引

本索引只负责按任务找到规则；完整门禁由对应 owner 维护。仍持有且未变化的资料可复用。

## 必读顺序

1. 目标工程 `AGENTS.md`
2. `.agents/config/iris_project_profile.md`
3. 本索引、通用编辑安全和任务对应规则文件
4. 目标工程 `.mcp.json`，仅当任务涉及 MCP、上传、编译、远程读取或 SQL 验证

## 规则入口

- [通用编辑安全](iris_coding_general.md)：所有编码任务必读，包含风险分流、授权、最小改动与 diff 检查；业务知识资料按其“自主使用知识资料”查询。
- [后端 ObjectScript 编码](iris_coding_backend.md)：BLH/DATA/SQL、ObjectScript 风格、Broker、SQL 执行层。
- [前端 CSP/JS/HISUI 编码](iris_coding_frontend.md)：前端任务必读，包含修改前与最终 diff 后的条件 i18n 门禁、字节检测、HISUI 复用和页面验证。
- [MCP 与部署工作流](iris_coding_workflow.md)：仅使用 MCP、上传、编译、远程读取或 SQL 验证时读取。
- [Git 基线与部署保护](../references/deployment-protection.md#建立会话)：需要部署的业务需求在第一次修改前读取，部署时复用会话。
- [IRIS 知识查询与 MCP 路由](iris_knowledge_lookup.md)：IRIS 类、方法签名、宏、SQL 元数据和官方文档的数据源选择；仅查询任务读取。
- [IRIS 部署执行清单](iris_deploy_checklist.md)：上传、编译、部署和远端验证的逐项检查清单；仅部署任务读取。
- [Legacy GB2312 提升流程](iris_gb2312_workflow.md)：仅在用户明确处理已确认的历史 GB2312 工程，并要求将 `{name}.gb2312.{ext}` 替换回原始文件名时读取。
- [HISUI 控件参考](../references/hisui-widget-index.md)：控件选型、源码行号、API 确认；仅在前端任务涉及 HISUI 控件选型或 API 不确定时读取。
- [HISUI 样式与资源参考](../references/hisui-style-index.md)：主题 CSS、locale CSS、语义 class、状态样式、图标和插图；仅在前端任务涉及 HISUI 样式或视觉资源不确定时读取。
- [iris-agentic-dev 配置](iris_agentic_dev.md)：TOML 配置和诊断约束。
- [IRIS 官方文档路由](../references/iris-official-docs-routing.md)：DocBook、Documatic、已知 URL Fetch 和版本冲突处理。
- [sftp-server MCP](sftp_server.md)：SFTP 读取、上传、目录同步和远程命令约束。

## 收尾路由

业务需求按[交付生命周期](../../../agents/_shared/delivery-lifecycle.md)进入 `acceptance-pending`；框架维护按[维护生命周期](../../../agents/_shared/maintenance-lifecycle.md)处理。验收、提交与 feedback 授权均沿用对应协议。
