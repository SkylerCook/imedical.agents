# iris-agentic-dev

当前版本：**1.5.0**

来源：[官方 v1.5.0 Release](https://github.com/intersystems-community/iris-agentic-dev/releases/tag/v1.5.0)，Windows x86_64 资产大小 `52344832` 字节。
已核对官方 SHA-256：`6aee62484c7bb557466778889ba3520aa5ddbb470d99b10803a489f60be9e213`。

升级兼容性：`iris_macro`、`iris_info`、`iris_execute_method` 和 HTTP `iris_execute` 的部分响应契约发生变化，详见[上游发布说明](https://github.com/intersystems-community/iris-agentic-dev/blob/v1.5.0/docs/release-notes/v1.5.0.md#breaking-changes)。本仓 helper 保留 MCP 转发和未分类工具 fail-closed 门禁；本地断连目录验证为默认 70 个工具、显式开启内置 skill 后 81 个。真实服务器行为需在目标工程验证。

已部署工程通过既有能力包更新流程取得新版，并重启持有旧 exe 的 MCP 进程；无需配置迁移或旧文件清理。独立的 `iris-agentic-dev-skills` 固定快照亦已同步至 v1.5.0 的既有 8 项，来源与边界见其 `UPSTREAM.md`；不执行 `skill install` 或同步业务副本。

This directory vendors the Windows x64 `iris-agentic-dev` MCP server used by IRIS/ObjectScript workflows.

## 更新可执行文件

Agent 自动更新请读取同级 `AGENTS.md`，按 runbook 执行版本检测 → 下载 → 验证 → 文档同步。

### 手工更新

在项目根目录执行以下命令下载最新版本：

```powershell
Invoke-WebRequest -Uri "https://github.com/intersystems-community/iris-agentic-dev/releases/download/v1.5.0/iris-agentic-dev-windows-x86_64.exe" -OutFile "vendor\iris-agentic-dev\windows-x64\iris-agentic-dev.exe"
```

更新后校验版本：

```powershell
vendor\iris-agentic-dev\windows-x64\iris-agentic-dev.exe --version
```

## Layout

```text
vendor/iris-agentic-dev/
`-- windows-x64/
    `-- iris-agentic-dev.exe
```

In deployed business projects the executable is available at:

```text
.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe
```

Use that path as the `command` in the target project's `.mcp.json`, or as `mcp.serverPath` in `.agents/config/project-env.json` when generating `.mcp.json` with `sync-env-config.js`.

Do not store IRIS hosts, namespaces, usernames, passwords, tokens, TLS settings, or remote paths in this directory. Those connection facts belong only in the target project's local `.mcp.json` or equivalent private environment variables.
