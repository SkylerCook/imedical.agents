---
name: iris-mcp-lookup
description: Use when querying InterSystems IRIS classes, methods, signatures, macros, SQL metadata, runtime capabilities, or official documentation, especially when answers must be grounded in iris-agentic-dev MCP metadata and/or a docs.intersystems.com URL instead of guessed from memory.
---

# IRIS MCP Lookup

## 目标

使用目标 IRIS 实例、当前工作区源码和 InterSystems 官方文档交叉查询 IRIS 知识。不要把任一来源描述为绝对准确；必须记录实例 namespace、文档版本或本地源码范围。

## 必读入口

1. 读取目标工程 `AGENTS.md`。
2. 读取 `../../rules/iris_knowledge_lookup.md`，按其中规则选择 IRIS MCP、官方文档或本地源码。
3. 涉及 MCP 配置、工具名称或连接诊断时，再读取 `../../rules/iris_agentic_dev.md`。
4. 涉及官方 DocBook、Documatic 或文档搜索时，读取 `../../references/iris-official-docs-routing.md`。

## 查询流程

### 1. 分类问题

- 当前实例是否存在类或方法、实际签名、属性、继承关系：查询 IRIS MCP。
- 当前 namespace 中的类、例程或宏源码：优先本地文件；本地缺失时用 IRIS MCP 只读获取。
- 概念、语义、教程、错误说明、版本差异：查询 InterSystems 官方文档。
- 用户提供 `docs.intersystems.com` URL：直接使用当前运行器的网页读取能力。
- 答案同时涉及“当前实例实际能力”和“官方定义”：分别查询并标出差异。

### 2. 选择工具

IRIS MCP 逻辑能力按以下顺序使用：

1. `iris_symbols`：按名称搜索当前 IRIS namespace 中的类或方法。
2. `docs_introspect`：确认类方法、参数、返回类型、属性和继承关系。
3. `iris_symbols_local`：IRIS 不可用或需要检查本地 `.cls/.mac/.inc` 时搜索工作区。
4. `iris_search`、`iris_macro`、`iris_table_info`：按问题补充全文、宏或 SQL 投影元数据。
5. `iris_doc mode=get/head`：只读检查当前 IRIS 实例中的文档；它不是官方文档搜索工具。

官方文档逻辑能力：

1. 已知 URL：使用当前运行器的网页 Fetch/WebFetch/Open 能力读取。
2. 当前 MCP 暴露 `iris_doc_search`：可用于官方文档发现。
3. 未暴露 `iris_doc_search`：使用运行器网页搜索，并限制到 `docs.intersystems.com`。

不要假设某工具一定存在。工具名称或来源不明确时先列出当前 MCP 工具，并确认来自 `iris-agentic-dev`。

### 3. 交叉验证

- 方法签名以目标实例的 `docs_introspect` 结果作为当前部署兼容性证据。
- 语义、约束和推荐用法以与目标产品版本匹配的官方文档作为规范证据。
- 本地项目类以工作区当前源码作为待修改事实；远端已编译定义可能落后或领先，必须报告差异。
- 出现冲突时不要静默合并：分别写明实例版本/namespace、文档版本和本地文件状态。

### 4. 保持只读

- 默认不调用 `iris_execute`、`iris_execute_method`、`iris_compile`、`iris_test`、`iris_coverage` 或任何写入工具。
- `iris_query` 只在确需验证系统字典元数据时使用只读 `SELECT`，不得查询患者或业务数据。
- `iris_doc` 只允许 `get/head`；`put/delete` 必须另行取得用户明确授权。
- 不为“验证知识”创建临时类、修改数据库、启动/停止 Production 或改变容器目标。

## URL Fetch 示例

用户给出如下 URL 时，直接读取页面正文并记录页面版本：

```text
https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=GGBL_structure
```

Claude Code 可显示为 `Fetch(...)` 或 `WebFetch(...)`；其它运行器使用等价网页读取能力。canonical 流程只依赖“可读取 URL”的能力，不绑定具体工具名。

## 降级路径

- 原生 IRIS MCP 工具未暴露：目标工程存在 `.agents/scripts/iris-mcp.js` 时，使用 `check|tools|call` 薄封装。
- MCP 不可用但本地源码存在：使用本地搜索并明确缺少运行时元数据。
- 官方网页抓取失败：尝试官方文档搜索或让用户提供页面内容，不把抓取失败解释为知识不存在。
- 当前实例版本与 `irislatest` 不一致：优先改查匹配版本的文档 URL；找不到时明确版本风险。

## 输出

按以下结构返回：

1. 简短结论。
2. 查询范围：IRIS 实例/namespace、本地源码、官方文档版本。
3. 关键签名或规则，避免无关的完整类清单。
4. 来源：MCP 工具名、本地文件或官方 URL。
5. 不一致、版本风险和仍未验证事项。

不得输出服务器地址、账号、密码、token、私有路径或业务数据。
