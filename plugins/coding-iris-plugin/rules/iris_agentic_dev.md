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

本矩阵基于 `tools/list`、2026-06-01 的目标项目冒烟测试和 2026-08-25 对仓库内置 `iris-agentic-dev 1.2.6` 的断连本地 schema 复核整理。完整合并 toolset 返回 78 个工具；本仓库 helper 与新生成的 `.mcp.json` 默认使用 `--no-skills`，返回 67 个工具。本文只记录通用能力，不得从 `.mcp.json` 复制 host、用户名、密码、namespace、token 或私有路径。

### 配置与会话

- `check_config`：返回当前连接和配置状态，不发起 IRIS 网络调用。v1.2.6 的 `capabilities` 包含 `private_web_server`、`atelier_rest`、`compile_path` 和 `webgateway_url`，并返回 `server_version`、`iris_version`、`connection_source` 等诊断字段；排查 MCP 问题时优先使用，并以 `compile_path` 判断编译应走 Atelier REST 还是 `docker_exec`。
- `agent_stats`、`agent_history`、`telemetry_query`：查看学习 Agent 状态、当前会话和持久化工具调用记录。

### 多实例、持久会话与跨环境比较

- `iris_servers`、`iris_test_server`：读取已注册 IRIS 实例及连接状态；不得把返回的连接事实写入规则、记忆或报告。
- `iris_add_server`、`iris_remove_server`、`iris_import_servers`：修改本地 server registry 或 OS keychain，必须取得明确配置写入授权；密码不得进入命令日志或持久产物。
- `compare_document`、`compare_namespace`：比较两个已注册实例的文档或 namespace 差异；调用前确认两个 server 都在当前任务授权范围内。
- `iris_ws_open`、`iris_ws_exec`、`iris_ws_close`：维护持久 IRIS terminal 会话。三者统一视为远端执行能力，必须取得任务级授权，并在任务结束时关闭已打开的 session。

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
- `capability_matrix`、`my_access`：读取当前实例能力和当前身份授权摘要。
- `iris_namespace_list`、`iris_database_list`、`iris_database_stats`：读取 namespace、database 和容量统计；`iris_namespace_create` 属于高风险管理写入。
- `global_preview`：在删除前生成范围与确认 token；`global_kill` 是破坏性操作，只有用户批准精确目标且 token 匹配时才能执行。
- `journal_search`、`query_audit_log`、`stream_inspect`：读取 journal、审计和 stream 诊断信息；仍应限制在任务需要的最小范围。
- `hl7_schema_list`、`hl7_schema_inspect`：读取 HL7 schema；`mermaid_class`、`mermaid_production` 用于生成类和 Production 结构图，`resolve_storage` 用于解析 Storage 映射。
- `extract_message_map_routing`、`find_subclass_implementations`、`resolve_dynamic_dispatch`：解析编译后路由、多态实现和动态分发候选。

### 写入、编译与执行

- `iris_doc mode=put/delete/insert/delete_lines`：写入、删除或按行修改 IRIS 文档。仅在用户明确要求时使用；`insert` 和 `delete_lines` 必须遵守 `expected` stale-edit guard，`put` 适用于 `.cls/.mac/.inc` 等 IRIS 文档，不用于 CSP 上传。
- `iris_compile`：编译类、例程或包。部署冒烟检查优先使用 `flags="cuk /checkuptodate=expandedonly"`。
- `iris_execute`：执行 ObjectScript。即使代码看似只读，工具内部也可能创建临时生成类；必须检查返回 status 和 stdout，不能只看传输成功。已授权的只读核验或翻译操作可将这种自清理临时载体记录为 `tool-internal-execution`，它不等同于 `business-code-deploy`，也不得用于上传命名业务类。
- `iris_execute_method`：直接调用 ClassMethod；仍属于远端执行，不能因省略 ObjectScript 包装代码而视为只读查询。
- `iris_global`：get/list 属于读取，set/kill 属于高风险写入；知识查询默认不读取业务或患者 Global。
- `iris_source_control`：查看 SCM 状态/菜单或执行 checkout/action；checkout 和 action 属于状态变更。上游 `IRIS_SCM_ALLOW_CHECKIN=1` 只是额外门禁，不代替用户任务级授权。
- `iris_test`：运行 `%UnitTest.Manager` 测试；`coverage=true` 会继续启动覆盖率采集。
- `iris_coverage`：执行 ObjectScript 行覆盖率 `check/run/start/stop/report`。所有 mode 都可能启动或操作 `%Monitor.System.LineByLine`，使用前需明确远端测试授权；`gmheap` 需至少 256 MB。

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

## 当前内置版本工具名复核：2026-08-25

仓库内置 `iris-agentic-dev 1.2.6` 已通过本地 JSON-RPC `initialize` + `tools/list` 复核。完整合并 toolset 为 78 个工具；默认 `--no-skills` 为 67 个。除原有知识查询和编码工具外，已明确覆盖以下 v1.2.6 能力组：

- `docs_introspect`
- `iris_symbols`
- `iris_symbols_local`
- `iris_doc_search`
- `iris_search`
- `iris_macro`
- `iris_table_info`
- `iris_debug`
- `iris_containers`
- `iris_coverage`
- `iris_generate_test`
- `iris_compile`
- `iris_test`
- `iris_servers` / `iris_add_server` / `iris_remove_server` / `iris_import_servers` / `iris_test_server`
- `compare_document` / `compare_namespace`
- `iris_ws_open` / `iris_ws_exec` / `iris_ws_close`
- `global_preview` / `global_kill`
- `iris_namespace_list` / `iris_namespace_create` / `iris_database_list` / `iris_database_stats`
- `journal_search` / `query_audit_log` / `my_access` / `capability_matrix`
- `hl7_schema_list` / `hl7_schema_inspect` / `mermaid_class` / `mermaid_production` / `resolve_storage` / `stream_inspect`

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
- 安全策略采用三层门禁：`write_tools_enabled` 控制一般写工具，`destructive_tools_enabled` 控制 Global kill、namespace 创建、凭据和其它破坏性工具，`write_allowed_servers` 把写入限制到明确命名的 server。三层都不能代替用户对当前任务的远程动作授权。
- 本仓库默认在 helper 和新生成的 `.mcp.json` 中使用 `--no-skills` / `IRIS_NO_SKILLS=true`，由 `imedical.agents` 统一治理 vendor skills。只有明确需要上游 skill registry、KB 或学习工具时，才在目标工程本地设置 `mcp.includeBuiltInSkills=true` 或 `IRIS_NO_SKILLS=false`。
- 由脚本直接启动 MCP 进程时，应显式传入 `--config <workspace>/.iris-agentic-dev.toml`；同时可用命令行参数传入非敏感定位项 `--host`、`--web-port`、`--scheme`、`--namespace`，账号、密码、token 保持走环境变量或本地私有配置。
- 需要减少工具噪声或从源头隐藏不应暴露的工具时，可在目标工程私有 TOML 中配置 `disabled_tools = ["iris_admin", "iris_source_control"]`，或设置 `IRIS_DISABLED_TOOLS`。该机制只控制 MCP 暴露面，不替代任务级远程写入授权。
- 多实例写入应同时配置 `write_allowed_servers = ["<approved-server-name>"]`；server 名必须来自本地注册表，不得在公共规则或模板中内置真实环境名称。

## 诊断

- 原生 `mcp__iris_agentic_dev__*` 工具优先。只有当前运行器没有暴露原生工具且目标工程确实存在 `.agents/scripts/iris-mcp.js` 时，才使用 `node .agents/scripts/iris-mcp.js check|tools|call ...`；helper 不存在时报告入口缺失，不得假定它已部署。
- `check_config` 只说明配置解析结果，不发起 IRIS 网络调用。先确认目标 host、namespace、`connection_source`、`fallback_warning`、`objectscript_workspace` 和 `capabilities` 是否合理，再立即执行 `iris_query("SELECT 1 AS Probe")` 作为最小无副作用网络探针。
- `capabilities.compile_path=docker_exec` 时，允许 `iris_compile` 使用上游自动路由，不要先把 Atelier REST 不可用扩大为整个 MCP 不可用；`capabilities` 仍是连接状态推导，不替代真实工具调用验证。
- 当 `connection_source=auto_discovered` 或环境变量发现已生效，且 `SELECT 1 AS Probe` 成功时，`config_file=null` 不构成配置失败，也不要求为了形式补 TOML 或强制热加载。
- 查询成功即继续任务。只有真实探针失败时，才保留完整错误、重启一次 MCP 会话并复测；单次 HTTP 404/405 或单个工具失败不得扩大为“整个 MCP 不可用”。
- 网络探针后按任务分别记录 `query`、`execute`、`document` 等 capability。某项失败只降级该项：`iris_query` 仍失败时，只有在 `tool-internal-execution` 已授权且临时载体自清理时，才可用 `iris_execute` + `%SQL.Statement` 只读降级；`iris_doc` 失败时可通过已验证的类或 Global 读取路径复核，不能直接断言文档不存在。
- 只读调用示例：`node .agents/scripts/iris-mcp.js call iris_doc "{...}"`、`node .agents/scripts/iris-mcp.js call iris_query "{...}"`。helper 按工具的 `mode` / `action` 区分读取与写入；文档行编辑、SQL write/force、Global set/kill、namespace 创建、多实例注册变更、持久会话、容器 select/start、SCM checkout/execute、测试和覆盖率等能力必须在用户明确要求后添加 `--allow-write`，并继续遵守部署/写入门禁。helper 尚未分类的未来工具也默认进入该门禁，不能因新工具名未命中旧黑名单而放行。
- `connected=false`，或定位项明显仍是默认值且真实探针失败时，才优先处理配置加载；不要仅凭 `config_file=null` 阻塞业务调用。
- 直接手写 JSON-RPC 或脚本调用 `iris_doc`、`iris_query`、`iris_execute` 时，显式传入目标 namespace；不要依赖工具 schema 的默认 `USER`。
- 不把某个工程的 host、namespace 或端口写入插件规则。
