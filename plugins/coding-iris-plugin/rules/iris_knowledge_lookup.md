---
name: iris_knowledge_lookup
description: Use when IRIS knowledge, class APIs, signatures, macros, SQL metadata, or official documentation must be queried through the correct iris-agentic-dev MCP and web-documentation routes.
task-affinity: [iris, mcp, documentation, lookup, diagnostics]
related:
  - iris_agentic_dev.md
  - ../references/iris-official-docs-routing.md
---

# IRIS 知识查询与 MCP 路由规则

## MCP server 归属

- IRIS 类、方法、宏、SQL 投影和 namespace 元数据只路由到 `iris-agentic-dev` MCP server。
- 当前运行器暴露 `mcp__iris_agentic_dev__*` 等原生入口时优先使用；工具前缀可以因运行器变化，但逻辑工具名和 server 归属必须可确认。
- 运行器只暴露无前缀工具时，先通过 `tools/list` 或 `check_config` 确认它们来自 `iris-agentic-dev`，不要把其它 MCP 的搜索或文档工具误当作 IRIS 能力。
- 原生入口缺失时，仅在目标工程真实存在 `.agents/scripts/iris-mcp.js` 后使用 `node .agents/scripts/iris-mcp.js check|tools|call ...`。
- `.mcp.json`、`.iris-agentic-dev.toml` 和环境变量是连接事实来源；本规则不得保存或复述其中的敏感连接信息。

## 来源选择

| 问题 | 首选来源 | 说明 |
|---|---|---|
| 当前实例类/方法是否存在 | `iris_symbols` + `docs_introspect` | 反映当前 namespace 的已编译状态 |
| 本地类和调用位置 | `iris_symbols_local` + 工作区文本搜索 | 反映当前待修改源码 |
| 宏定义和展开 | `iris_macro` | 先定位再查看或展开 |
| SQL 表投影与存储 | `iris_table_info` | 不用业务数据查询代替元数据检查 |
| 当前实例类/例程源码 | `iris_doc mode=get/head` | `iris_doc` 不是官方文档站 |
| 概念、语义、教程、错误说明 | InterSystems 官方文档 | 使用匹配产品版本的页面 |
| 已知官方 URL | 当前运行器网页读取能力 | Claude Code 可显示为 Fetch/WebFetch |
| 官方文档模糊检索 | `iris_doc_search`（若存在）或官方域名网页搜索 | 调用前检查工具实际存在 |

## 当前内置版本兼容映射

仓库内置 `iris-agentic-dev 0.9.3` 使用以下合并工具名：

| 上游 skill 中的逻辑/旧工具名 | 当前工具 |
|---|---|
| `objectscript_iris_generate_test` | `iris_generate_test` |
| `objectscript_iris_compile` | `iris_compile` |
| `objectscript_iris_test` | `iris_test` |
| `debug_capture_packet` | `iris_debug action=capture` |
| `debug_map_int_to_cls` | `iris_debug action=map_int` |
| `objectscript_debug_get_error_logs` / `debug_get_error_logs` | `iris_debug action=error_logs` |
| `debug_source_map` | `iris_debug action=source_map` |
| `iris_list_containers` / `iris_select_container` | 先检查当前 `iris_containers` schema；不得按旧参数猜测 |

官方 vendor skill 保留上游原文。执行前必须以当前 `tools/list` schema 为准应用本表，不直接照抄旧工具名。

## 证据优先级

- 当前部署兼容性：目标实例 `docs_introspect` / 元数据结果优先。
- 待修改内容：本地工作区源码优先。
- 产品规范语义：与目标版本匹配的 `docs.intersystems.com` 官方文档优先。
- `irislatest` 不是目标实例版本的证据；页面版本不匹配时必须提示。
- 任何来源都不得描述为“100% 准确”。出现差异时分别报告，不用一个来源覆盖另一个来源。

## 安全门禁

- 知识查询默认只读。
- 禁止以验证知识为由调用编译、执行、测试、文档写入、Global 写入、Production 生命周期、凭据、安全管理或数据库写入能力。
- `iris_query` 仅限必要的系统字典只读查询；不要读取患者、消息正文或业务表数据。
- 用户明确要求行为验证时，先说明 `iris_execute`、`iris_execute_method` 或 `iris_test` 可能产生的远端影响，再按任务级授权执行。
- 输出只记录工具名、namespace 是否匹配、产品版本和证据摘要；不输出 host、端口、用户名、密码、token 或远程私有路径。
