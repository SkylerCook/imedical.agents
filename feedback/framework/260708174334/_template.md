# 反馈：iris-agentic-dev MCP 启动配置显式加载

- 日期：2026-07-08
- 提交人：Codex
- 基于版本：23e5e9e73e08fb69e1d284be0ceb934335f73e77
- HIS 需求号：（无）
- 状态：待处理

## 场景描述

处理 IRIS MCP 只读源码获取时，`iris-agentic-dev` 进程可启动并列出工具，但实际工具调用一度落到默认连接配置，导致业务类源码读取误判为不存在。

## 发现的问题

1. `check_config` 暴露出的配置加载状态没有被优先用于诊断；当配置文件未加载、host 为空、namespace 或端口落到默认值时，应先判断 MCP 启动参数和 TOML 热加载问题。
2. `coding-iris-plugin` 中直接启动 MCP 的脚本没有显式传入 `.iris-agentic-dev.toml`，也没有把 `.mcp.json`/`project-env.json` 中的非敏感定位项同步为 CLI 参数。
3. 规则文档把凭据只由 `.mcp.json` 或环境变量承载写得过于绝对；实际工具版本可能要求本地 TOML 字段参与热加载，规则应强调本地私有边界，而不是否认该路径。
4. 初版 helper 过度封装了 `doc/query` 等业务便利子命令，容易和 MCP server 自身能力重叠；最终应收敛为只负责启动、检测和 `tools/call` 转发的薄 wrapper。

## 本次修改说明

### plugins/coding-iris-plugin/scripts/iris-tools/compile.js

- 改了什么：启动 `iris-agentic-dev` 时构造统一 MCP 参数，发现工作区 `.iris-agentic-dev.toml` 就传 `--config`，并显式传入 `--host`、`--web-port`、`--scheme`、`--namespace`。
- 为什么改：避免直接 spawn MCP 时回退到默认 host、namespace 或端口；账号和密码仍通过环境变量或本地私有配置传递，避免出现在命令行。

### plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js

- 改了什么：生成 `.mcp.json` 时不再只写 `args: ["mcp"]`，而是生成包含 `--config` 和非敏感定位参数的启动参数。
- 为什么改：让 Codex 或其他 MCP 客户端按 `.mcp.json` 启动时能稳定加载目标工程配置，减少依赖工具自动发现。

### plugins/coding-iris-plugin/rules/iris_agentic_dev.md

- 改了什么：补充直接启动 MCP 时应传 `--config` 和非敏感定位参数；补充 `check_config` 中默认端口、默认 namespace、配置文件为空的诊断优先级；调整 TOML 凭据边界表述。
- 为什么改：把本次排障中验证出的可复用判断标准沉淀到规则，避免后续把配置未加载误判为业务类不存在。

### plugins/coding-iris-plugin/README.md

- 改了什么：补充目标工程 `.agents/scripts/iris-mcp.js` 的定位和调用示例。
- 为什么改：让 Agent 知道该 helper 是 MCP 启动与转发入口，不是 `iris_doc`、`iris_query` 等能力的替代实现。

### scripts/iris-mcp.js

- 改了什么：新增通用 MCP helper，只保留 `check`、`tools`、`call` 三类接口，移除专用 `doc/query/raw` 分支；兼容 PowerShell 场景下 JSON 参数引号被剥离后的简单对象写法。
- 为什么改：复用 MCP 原生能力并减少维护面；脚本只处理启动配置、脱敏连接检测、namespace 补齐和写能力门禁。

## 验证状态

- [x] 已验证：`node --check` 通过 `compile.js` 和 `sync-env-config.js` 语法检查。
- [x] 已验证：`node --check` 通过 `iris-mcp.js` 语法检查。
- [x] 已验证：`git diff --check` 对本次相关修改无 whitespace 错误。
- [x] 已验证：使用显式 `--config` 和非敏感 CLI 参数启动 MCP 后，`check_config` 显示 host 已加载、namespace 不是默认 `USER`、端口不是默认 `52773`，连接成功。
- [x] 已验证：`iris-mcp.js check/tools/call iris_doc` 可用，写能力默认拦截。
- [ ] 待验证：由维护者在更多项目的 `.mcp.json` 生成和后端编译流程中确认兼容性。

---

<!-- 维护者处理后填写 -->
## 处理记录

- 处理人：
- 处理日期：
- 处理结果：已应用 / 已跳过 / 需讨论
- 说明：
