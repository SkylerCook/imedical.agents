---
name: iris-backend-coding
description: Use when working on IRIS ObjectScript backend code with coding-iris-plugin backend rules and the target project's profile.
---

# IRIS Backend Coding

## 使用时机

当任务涉及 IRIS ObjectScript、`.cls`、BLH/DATA/SQL、Broker、Query、SQL 写入层或后端 MCP 编译验证时使用本 Skill。

## 流程

1. 先读取目标工程 `.agents/config/iris_project_profile.md`。
2. 再读取 `rules/iris_coding_index.md`、`rules/iris_coding_general.md`、`rules/iris_coding_backend.md`。
3. 仅当任务涉及上传、编译、远程读取或只读 SQL 时，再读取 `.mcp.json` 和 `rules/iris_coding_workflow.md`。
4. 本地搜索现有实现和同类代码，优先沿用目标工程模式。
5. 按 BLH/DATA/SQL 职责分层修改，不把项目专属类名写回插件规则。
6. 默认只做本地修改；用户明确要求后再上传或编译。

## 完成检查

- ObjectScript 命令的完整后条件表达式无空格分隔，例如 `q:cond=""`、`continue:((cond1)&&(cond2))`；不得生成 `continue:(cond1) && (cond2)`。
- 使用项目约定缩写命令和函数。
- SQL 写入层返回格式稳定。
- 参数校验避免 `<UNDEFINED>`。
- 未引入源工程硬编码服务器、namespace 或业务前缀。
