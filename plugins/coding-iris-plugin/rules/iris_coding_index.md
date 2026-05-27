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
- [MCP 与部署工作流](iris_coding_workflow.md)：本地优先、脚本复制、GB2312 转换、上传和 CSP 编译。
- [HISUI 控件索引](hisui-widget-index.md)：控件选型、源码行号、API 确认。
- [iris-agentic-dev 配置](iris-agentic-dev.md)：TOML 配置和诊断约束。

## 总原则

- 项目事实以 profile 和 `.mcp.json` 为准。
- 默认不执行远程写入、上传、编译、数据库变更。
- 历史编码文件优先局部修改，不做整文件格式化。
- HISUI API 不确定时，先查索引，再读目标工程 profile 指定的源码。
