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

执行 IRIS/ObjectScript/CSP/HISUI 编码任务时，先读取目标工程 `.agents/config/iris_project_profile.md`，再按任务类型读取对应规则。不要把工程配置、MCP 连接和编码规则混在一起。

## 必读顺序

1. 目标工程 `AGENTS.md`
2. `.agents/config/iris_project_profile.md`
3. 目标工程 `.mcp.json`，仅当任务涉及 MCP、上传、编译、远程读取或 SQL 验证
4. 本索引
5. 任务对应规则文件

## 规则入口

- [通用编辑安全](iris_coding_general.md)：上下文读取、最小改动、编码与 diff 检查。
- [后端 ObjectScript 编码](iris_coding_backend.md)：BLH/DATA/SQL、ObjectScript 风格、Broker、SQL 执行层。
- [前端 CSP/JS/HISUI 编码](iris_coding_frontend.md)：CSP 结构、HISUI 控件、JS 组织、表单回显。
- [MCP 与部署工作流](iris_coding_workflow.md)：本地优先、脚本复制、MCP 使用、上传和 CSP 编译入口。
- [IRIS 知识查询与 MCP 路由](iris_knowledge_lookup.md)：IRIS 类、方法签名、宏、SQL 元数据和官方文档的数据源选择；仅查询任务读取。
- [IRIS 部署执行清单](iris_deploy_checklist.md)：上传、编译、部署和远端验证的逐项检查清单；仅部署任务读取。
- [GB2312 提升流程](iris_gb2312_workflow.md)：将 `{name}.gb2312.{ext}` 替换回原始文件名的安全流程；仅永久替换源文件时读取。
- [HISUI 控件参考](../references/hisui-widget-index.md)：控件选型、源码行号、API 确认；仅在前端任务涉及 HISUI 控件选型或 API 不确定时读取。
- [HISUI 样式与资源参考](../references/hisui-style-index.md)：主题 CSS、locale CSS、语义 class、状态样式、图标和插图；仅在前端任务涉及 HISUI 样式或视觉资源不确定时读取。
- [iris-agentic-dev 配置](iris_agentic_dev.md)：TOML 配置和诊断约束。
- [IRIS 官方文档路由](../references/iris-official-docs-routing.md)：DocBook、Documatic、已知 URL Fetch 和版本冲突处理。
- [sftp-server MCP](sftp_server.md)：SFTP 读取、上传、目录同步和远程命令约束。

## 总原则

- 项目事实以 profile 和 `.mcp.json` 为准。
- 默认不执行远程写入、上传、编译、数据库变更。
- 查询 IRIS 知识时优先使用 `iris-mcp-lookup`，并区分当前实例元数据、本地源码和官方文档版本。
- 历史编码文件优先局部修改，不做整文件格式化。
- HISUI 控件/API 不确定时先查 widget 索引和 JavaScript 源码；样式或视觉资源不确定时先查 style 索引和目标页面实际加载的主题/locale CSS。
