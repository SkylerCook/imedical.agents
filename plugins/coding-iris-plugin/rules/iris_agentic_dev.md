---
name: iris_agentic_dev
description: Use when an IRIS coding task needs iris-agentic-dev MCP capability boundaries or diagnostics.
task-affinity: [iris, mcp, diagnostics, coding]
related:
  - iris_coding_workflow.md
---

# iris-agentic-dev 使用约束

## MCP 能力矩阵

本矩阵基于 `tools/list` 和 2026-06-01 的冒烟测试整理。本文只记录通用能力，不得从 `.mcp.json` 复制 host、用户名、密码、namespace、token 或私有路径。

### 配置与会话

- `check_config`：返回当前连接和配置状态，不发起 IRIS 网络调用。排查 MCP 问题时优先使用。
- `agent_info`、`agent_stats`、`agent_history`：查看会话、工具调用历史和学习 Agent 状态。

### 安全发现与读取

- `iris_info`：发现 namespace 元数据、文档列表、最近修改、作业、CSP app、CSP debug、SQL Analytics schema。
- `iris_query`：执行 SQL SELECT；破坏性 SQL 默认拦截，除非显式 force 且环境允许。
- `iris_symbols`、`iris_symbols_local`：搜索已编译 IRIS 类或本地 `.cls/.mac/.inc` 文件。
- `iris_search`：跨 IRIS 文档全文搜索。
- `iris_doc`：`mode=get` / `mode=head` 用于读取或检查文档存在性。
- `docs_introspect`：查看类方法、属性和类型信息。
- `iris_table_info`：查看投影 SQL 表和存储元数据。
- `iris_macro`：列出、定位、查看或展开宏。
- `debug_get_error_logs`、`debug_capture_packet`、`debug_map_int_to_cls`、`debug_source_map`：读取诊断和调试上下文。
- `extract_message_map_routing`、`find_subclass_implementations`、`resolve_dynamic_dispatch`：解析编译后路由、多态实现和动态分发候选。

### 写入、编译与执行

- `iris_doc mode=put/delete`：写入或删除 IRIS 文档。仅在用户明确要求时使用；`put` 适用于 `.cls/.mac/.inc` 等 IRIS 文档，不用于 CSP 上传。
- `iris_compile`：编译类、例程或包。部署冒烟检查优先使用 `flags="cuk /checkuptodate=expandedonly"`。
- `iris_execute`：执行 ObjectScript。即使代码看似只读，工具内部也可能创建临时生成类；必须检查返回 status 和 stdout，不能只看传输成功。
- `iris_source_control`：查看 SCM 状态/菜单或执行 checkout/action；checkout 和 action 属于状态变更。
- `iris_test`：运行 `%UnitTest.Manager` 测试。

### Interop、lookup、凭据、Production 与容器

- `iris_interop_query`：读取互操作日志、队列或消息。
- `iris_lookup_manage`、`iris_lookup_transfer`：get/export 属于读取；set/delete/import 属于写入门控能力。
- `iris_credential_list`：只列出凭据 ID 和用户名，不返回密码。
- `iris_credential_manage`：创建、更新或删除凭据，高风险写操作。
- `iris_production`、`iris_production_item`：status/get_settings 可读；start/stop/update/recover/enable/disable/set_settings 属于高风险写操作。
- `iris_list_containers`、`iris_select_container`、`iris_start_sandbox`：Docker/容器目标选择能力；仅在项目实际使用 IRIS 容器时使用。

### 生成、知识库与技能

- `iris_generate`：为调用方准备生成 ObjectScript 类或测试的上下文。
- `iris_generate_class`、`iris_generate_test`：依赖模型/API key 环境变量，具体是否写入取决于调用方式。
- `kb`、`kb_index`、`kb_recall`：索引或召回知识库内容。
- `skill*` 工具：学习 Agent 技能注册表操作；正常业务部署中不要使用写入、分享或社区安装能力。

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
- 凭据，例如用户名、密码、TLS 验证、token，不写入 TOML，由目标工程 `.mcp.json` 或环境变量承载。
- TOML 注释必须使用 ASCII 字符；非 ASCII 注释可能导致解析器静默失败。
- 修改 TOML 后，调用任意相关 MCP 工具通常可触发热加载，无需重启会话。

## 诊断

- 使用目标工程 MCP 提供的配置检查能力确认配置是否加载成功。
- 若检查结果中配置文件为空但连接仍可用，说明工具可能回退到自动发现或环境变量，应检查 TOML 路径、编码和注释字符。
- 不把某个工程的 host、namespace 或端口写入插件规则。
