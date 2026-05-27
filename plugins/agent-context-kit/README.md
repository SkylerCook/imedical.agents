# Agent Context Kit

`agent-context-kit` 提供可复用流程，用于让 Agent 面向项目的上下文保持清晰、短小、可维护。

## 内容

- `skills/project-context-maintenance/`：初始化和维护项目上下文的主流程。
- `scripts/generate-plugin-thin-index.ps1`：插件内置 thin-index 生成脚本。
- `templates/`：`AGENTS.md` 完整模板和片段、项目规则、项目记忆的初始化模板。

## 安装模式

推荐使用 `plugin-reference-thin-index`：

1. 将本插件放在 `.agents/plugins/agent-context-kit/`。
2. 通过 `.agents/skills/` 下的浅层文件暴露 skill。
3. 项目特定事实留在目标项目内，不写入本插件。
4. 直接调用插件内置 thin-index 脚本，不复制到 `.agents/scripts/`。

默认 dry-run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/agent-context-kit/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/agent-context-kit `
  -ProjectRoot . `
  -Mode DryRun
```

确认后写入：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/agent-context-kit/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/agent-context-kit `
  -ProjectRoot . `
  -Mode Write
```

## 安全约束

- 不把 `.mcp.json` 中的密钥复制到 rules、memory、templates 或插件文件。
- 不在插件中硬编码源项目路径、服务器地址、namespace 或模块清单。
- 项目记忆应足够短，便于快速交接；长期规则应放入 rules 文件。
