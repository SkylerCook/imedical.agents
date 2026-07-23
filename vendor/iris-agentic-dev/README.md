# iris-agentic-dev

当前版本：**0.9.3**

This directory vendors the Windows x64 `iris-agentic-dev` MCP server used by IRIS/ObjectScript workflows.

## 更新可执行文件

Agent 自动更新请读取同级 `AGENTS.md`，按 runbook 执行版本检测 → 下载 → 验证 → 文档同步。

### 手工更新

在项目根目录执行以下命令下载最新版本：

```powershell
Invoke-WebRequest -Uri "https://github.com/intersystems-community/iris-agentic-dev/releases/download/v0.9.3/iris-agentic-dev-windows-x86_64.exe" -OutFile "vendor\iris-agentic-dev\windows-x64\iris-agentic-dev.exe"
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
