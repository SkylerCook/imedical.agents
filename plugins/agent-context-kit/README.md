# Agent Context Kit

`agent-context-kit` 提供可复用流程，用于让 Agent 面向项目的上下文保持清晰、短小、可维护。

## 内容

- `skills/project-context-maintenance/`：初始化和维护项目上下文的主流程。
- `scripts/generate-plugin-thin-index.ps1`：thin-index 生成 wrapper，实际委托根 `scripts/generate-plugin-thin-index.ps1`。
- `templates/`：`AGENTS.md` 完整模板和片段、项目规则、项目记忆、项目上下文配置的初始化模板。

## 上下文模式

初始化目标工程前先判断 `contextMode`：

- `codebase-complete`：本地已有较完整代码、目录、构建配置或用户确认本地代码代表主要工程事实，可从已验证代码归纳架构。
- `intent-first-on-demand-export`：工程刚新建、代码很少或零散，或用户明确说明后续按需从服务器导出文件；AGENTS.md 只写项目定位、上下文状态和按需导出流程，不围绕少量文件推断完整架构。

判定规则采用保守默认：用户明确说按需导出时直接选 `intent-first-on-demand-export`；无法证明本地代码代表完整工程时，也选 `intent-first-on-demand-export`。

推荐用 `templates/project_context_profile.template.md` 初始化 `.agents/config/project_context_profile.md`，保存项目用途、上下文模式、代码来源和本地文件完整性等非敏感语义配置。

## 安装模式

推荐使用 `plugin-reference-thin-index`：

1. 将本插件放在 `.agents/plugins/agent-context-kit/`。
2. 通过 `.agents/skills/` 下的浅层文件暴露 skill。
3. 项目特定事实留在目标项目内，不写入本插件。
4. 直接调用插件内置 thin-index 脚本，不复制到 `.agents/scripts/`。

根 `scripts/generate-plugin-thin-index.ps1` 是唯一 canonical 实现。各插件可以保留同名脚本作为稳定入口，但只能 wrapper 到根脚本，不复制核心逻辑，也不依赖其它插件。

安装脚本会在目标工程写入双层忽略：

- 业务工程 `.gitignore` 忽略 `.agents/`。
- `.agents/.git/info/exclude` 忽略 `/config/`、`/memory/`、`/rules/`、`/skills/`、`/scripts/`、`/work/` 这些本地生成层。

不要把生成层忽略规则写进 `.agents/.gitignore`；它会进入能力包仓库，影响 `imedical.agents` 自身维护。

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
## 部署经验维护

- 可跨项目复用的部署流程、排障根因和验证标准，应沉淀到对应领域插件。
- 项目私有差异只写入目标项目 `.agents/rules/`、`.agents/memory/` 或 `.agents/config/`，并使用非敏感占位。
- 不记录一次性命令日志；只记录长期会影响后续任务的规则、根因和可复核验证标准。
- 若插件规则与实际结果冲突，先修正插件偏差，再更新项目侧摘要，保持单一事实来源。
