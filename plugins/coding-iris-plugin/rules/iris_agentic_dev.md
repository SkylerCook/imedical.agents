---
name: iris_agentic_dev
description: Use when an IRIS coding task needs iris-agentic-dev MCP capability boundaries or diagnostics.
task-affinity: [iris, mcp, diagnostics, coding]
related:
  - iris_coding_workflow.md
  - iris_knowledge_lookup.md
---

# iris-agentic-dev 使用约束

## MCP 能力矩阵

本矩阵基于 `tools/list`、2026-06-01 的目标项目冒烟测试和 2026-07-23 对仓库内置 `iris-agentic-dev 0.9.3` 的本地 schema 复核整理。本文只记录通用能力，不得从 `.mcp.json` 复制 host、用户名、密码、namespace、token 或私有路径。

### 配置与会话

- `check_config`：返回当前连接和配置状态，不发起 IRIS 网络调用。排查 MCP 问题时优先使用。
- `agent_stats`、`agent_history`、`telemetry_query`：查看学习 Agent 状态、当前会话和持久化工具调用记录。

### 安全发现与读取

- `iris_info`：发现 namespace 元数据、文档列表、最近修改、作业、CSP app、CSP debug、SQL Analytics schema。
- `iris_query`：执行 SQL SELECT；破坏性 SQL 默认拦截，除非显式 force 且环境允许。
- `iris_symbols`、`iris_symbols_local`：搜索已编译 IRIS 类或本地 `.cls/.mac/.inc` 文件。
- `iris_search`：跨 IRIS 文档全文搜索。
- `iris_doc`：`mode=get` / `mode=head` 用于读取或检查文档存在性。
- `docs_introspect`：查看类方法、属性和类型信息。
- `iris_doc_search`：搜索 InterSystems 官方文档；仍需先以当前 `tools/list` 确认可用性。
- `iris_table_info`：查看投影 SQL 表和存储元数据。
- `iris_macro`：列出、定位、查看或展开宏。
- `iris_debug`：通过 `action=error_logs|capture|map_int|source_map` 读取诊断和调试上下文。
- `iris_get_log`：工具结果被截断并返回 `log_id` 时读取完整结果。
- `extract_message_map_routing`、`find_subclass_implementations`、`resolve_dynamic_dispatch`：解析编译后路由、多态实现和动态分发候选。

### 写入、编译与执行

- `iris_doc mode=put/delete`：写入或删除 IRIS 文档。仅在用户明确要求时使用；`put` 适用于 `.cls/.mac/.inc` 等 IRIS 文档，不用于 CSP 上传。
- `iris_compile`：编译类、例程或包。部署冒烟检查优先使用 `flags="cuk /checkuptodate=expandedonly"`。
- `iris_execute`：执行 ObjectScript。即使代码看似只读，工具内部也可能创建临时生成类；必须检查返回 status 和 stdout，不能只看传输成功。已授权的只读核验或翻译操作可将这种自清理临时载体记录为 `tool-internal-execution`，它不等同于 `business-code-deploy`，也不得用于上传命名业务类。
- `iris_execute_method`：直接调用 ClassMethod；仍属于远端执行，不能因省略 ObjectScript 包装代码而视为只读查询。
- `iris_global`：read/list 属于读取，write/kill 属于高风险写入；知识查询默认不读取业务或患者 Global。
- `iris_source_control`：查看 SCM 状态/菜单或执行 checkout/action；checkout 和 action 属于状态变更。
- `iris_test`：运行 `%UnitTest.Manager` 测试。

### Interop、lookup、凭据、Production 与容器

- `iris_interop_query`：读取互操作日志、队列或消息。
- `iris_lookup_manage`、`iris_lookup_transfer`：get/export 属于读取；set/delete/import 属于写入门控能力。
- `iris_credential_list`：只列出凭据 ID 和用户名，不返回密码。
- `iris_credential_manage`：创建、更新或删除凭据，高风险写操作。
- `iris_production`、`iris_production_item`：status/get_settings 可读；start/stop/update/recover/enable/disable/set_settings 属于高风险写操作。
- `iris_containers`：容器发现、选择或启动能力以当前 schema 为准；仅在项目实际使用 IRIS 容器且任务明确需要时使用。

### 生成、知识库与技能

- `iris_generate`：为调用方准备生成 ObjectScript 类或测试的上下文。
- `iris_generate_class`、`iris_generate_test`：依赖模型/API key 环境变量，具体是否写入取决于调用方式。
- `kb`、`kb_index`、`kb_recall`：索引或召回知识库内容。
- `skill*` 工具：学习 Agent 技能注册表操作；正常业务部署中不要使用写入、分享或社区安装能力。

## 当前内置版本工具名复核：2026-07-23

仓库内置 `iris-agentic-dev 0.9.3` 已通过本地 JSON-RPC `initialize` + `tools/list` 复核。与知识查询和官方 vendor skill 兼容相关的工具包括：

- `docs_introspect`
- `iris_symbols`
- `iris_symbols_local`
- `iris_doc_search`
- `iris_search`
- `iris_macro`
- `iris_table_info`
- `iris_debug`
- `iris_containers`
- `iris_generate_test`
- `iris_compile`
- `iris_test`

上游 vendor skill 中的 `objectscript_iris_*`、`debug_*` 和旧容器工具名不得直接调用；按 `iris_knowledge_lookup.md` 映射后，再以当前工具 schema 为准。

## 冒烟测试结果：2026-06-01

已通过目标项目配置的 MCP server 执行 JSON-RPC `tools/list` 和 `tools/call` 验证。

已通过：

- `check_config`
- `agent_info`
- `iris_info` 的 metadata 与 namespace 查询
- `iris_query` 只读字典 SELECT
- `iris_symbols`
- `iris_doc mode=head`
- `docs_introspect`
- `iris_execute` 执行 `write $ZVERSION,!`
- `iris_compile` 对既有类执行 check-up-to-date 编译

有意未冒烟测试：

- 文档 `put/delete`、凭据变更、lookup 变更/import、Production 生命周期变更、Production item 变更、容器切换/沙箱启动、社区技能安装/分享。这些会改变服务器状态，必须有明确任务级理由。

## 部署注意

- CSP 文件不通过 `iris_doc` 部署。应先通过 SFTP 上传，再用 WebApp 虚拟路径 `$system.OBJ.Load("<web-app-virtual-root>/csp/<file>.csp","c")` 编译。
- `iris_execute` 传输成功不等于部署成功。必须检查 ObjectScript 内层 status 和生成物。
- 带 `Storage Default` 的持久化实体类应上传去掉完整 Storage 块后的源码，让 IRIS 在编译时重新生成 Storage。

## TOML 配置文件

- Windows x64 的 `iris-agentic-dev.exe` 已内置在 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe`，可作为目标工程 `.mcp.json` 的 `command` 或 `.agents/config/project-env.json` 的 `mcp.serverPath`。
- 内置可执行文件只解决工具位置问题；host、web_port、scheme、namespace、用户名、密码、token 和 TLS 选项仍只能由目标工程 `.mcp.json`、`.iris-agentic-dev.toml` 或环境变量承载。
- 配置文件通常位于目标工程根目录 `.iris-agentic-dev.toml`，用于声明 IRIS 连接参数，例如 host、web_port、scheme、namespace。
- 凭据优先由目标工程 `.mcp.json` 或环境变量承载；若当前 `iris-agentic-dev` 版本要求 TOML 字段才能完成热加载，TOML 也只能作为目标工程本地私有配置，不得提交、复制到插件、rules、memory 或对话输出。
- TOML 注释必须使用 ASCII 字符；非 ASCII 注释可能导致解析器静默失败。
- 修改 TOML 后，调用任意相关 MCP 工具通常可触发热加载，无需重启会话。
- 由脚本直接启动 MCP 进程时，应显式传入 `--config <workspace>/.iris-agentic-dev.toml`；同时可用命令行参数传入非敏感定位项 `--host`、`--web-port`、`--scheme`、`--namespace`，账号、密码、token 保持走环境变量或本地私有配置。

## 诊断

- 原生 `mcp__iris_agentic_dev__*` 工具优先。只有当前运行器没有暴露原生工具且目标工程确实存在 `.agents/scripts/iris-mcp.js` 时，才使用 `node .agents/scripts/iris-mcp.js check|tools|call ...`；helper 不存在时报告入口缺失，不得假定它已部署。
- `check_config` 只说明配置解析结果，不发起 IRIS 网络调用。先确认目标 host、namespace 等定位是否合理，再立即执行 `iris_query("SELECT 1 AS Probe")` 作为最小无副作用网络探针。
- 当 `connection_source=auto_discovered` 或环境变量发现已生效，且 `SELECT 1 AS Probe` 成功时，`config_file=null` 不构成配置失败，也不要求为了形式补 TOML 或强制热加载。
- 查询成功即继续任务。只有真实探针失败时，才保留完整错误、重启一次 MCP 会话并复测；单次 HTTP 404/405 或单个工具失败不得扩大为“整个 MCP 不可用”。
- 网络探针后按任务分别记录 `query`、`execute`、`document` 等 capability。某项失败只降级该项：`iris_query` 仍失败时，只有在 `tool-internal-execution` 已授权且临时载体自清理时，才可用 `iris_execute` + `%SQL.Statement` 只读降级；`iris_doc` 失败时可通过已验证的类或 Global 读取路径复核，不能直接断言文档不存在。
- 只读调用示例：`node .agents/scripts/iris-mcp.js call iris_doc "{...}"`、`node .agents/scripts/iris-mcp.js call iris_query "{...}"`。写能力必须在用户明确要求后添加 `--allow-write`，并继续遵守部署/写入门禁。
- `connected=false`，或定位项明显仍是默认值且真实探针失败时，才优先处理配置加载；不要仅凭 `config_file=null` 阻塞业务调用。
- 直接手写 JSON-RPC 或脚本调用 `iris_doc`、`iris_query`、`iris_execute` 时，显式传入目标 namespace；不要依赖工具 schema 的默认 `USER`。
- 不把某个工程的 host、namespace 或端口写入插件规则。
