# iris-agentic-dev

当前版本：**1.5.0 + managed-sessions-v1**。

固定上游、许可证、补丁、构建方法及验证边界见 [UPSTREAM.md](UPSTREAM.md)，当前二进制摘要见 [managed-build.json](managed-build.json)。受管模式关闭自动重试及隐式遥测写入，并提供独立注销回执。不得用官方未打补丁的同版本 exe 覆盖；管理入口会检查二进制摘要。
升级兼容性：`iris_macro`、`iris_info`、`iris_execute_method` 和 HTTP `iris_execute` 的部分响应契约发生变化，详见[上游发布说明](https://github.com/intersystems-community/iris-agentic-dev/blob/v1.5.0/docs/release-notes/v1.5.0.md#breaking-changes)。本仓 helper 保留 MCP 转发和未分类工具 fail-closed 门禁；本地断连目录验证为默认 70 个工具、显式开启内置 skill 后 81 个。真实服务器行为需在目标工程验证。

已部署工程通过既有能力包更新流程取得新版，并重启持有旧 exe 的 MCP 进程；受管入口需要配置迁移，见[统一会话手册](../../docs/guides/iris-managed-sessions.md)。独立的 `iris-agentic-dev-skills` 固定快照亦已同步至 v1.5.0 的既有 8 项，来源与边界见其 `UPSTREAM.md`；不执行 `skill install` 或同步业务副本。

This directory vendors the Windows x64 `iris-agentic-dev` MCP server used by IRIS/ObjectScript workflows.

## 更新可执行文件

Agent 自动更新请读取同级 `AGENTS.md`，按 runbook 执行版本检测 → 下载 → 验证 → 文档同步。

### 官方原件下载（仅供上游比对，不可覆盖受管构建）

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

Use this executable only as the managed backend. The project MCP command is the Node session adapter; retain `mcp.serverPath` as the internal vendor source for the configuration generator.

Do not store IRIS hosts, namespaces, usernames, passwords, tokens, TLS settings, or remote paths in this directory. Those connection facts belong only in the target project's local `.mcp.json` or equivalent private environment variables.
