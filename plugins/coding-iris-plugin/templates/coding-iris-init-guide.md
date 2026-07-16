# coding-iris-plugin 初始化指南

> **定位**：本文件是人类参考手册，供人工手动初始化时查阅。Agent 执行初始化时应直接读取 `.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`，该文件包含判断逻辑和分支处理，是唯一权威执行指令。

## 最小接入步骤

1. 将插件目录放到目标工程：

```text
.agents/plugins/coding-iris-plugin/
```

2. 直接读取 bootstrap skill：

```text
.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md
```

3. 初始化前端编码 wrapper：

```text
.agents/scripts/convert-gb2312-upload.ps1
.agents/scripts/check-frontend-encoding.ps1
```

运行插件的 `migrate-frontend-encoding-profile.ps1`：已知历史版本自动替换为指向插件 canonical 实现的薄 wrapper，用户定制版只报告冲突。`generate-plugin-thin-index.ps1` 不复制到目标工程。

4. 创建项目 profile：

```text
.agents/config/iris_project_profile.md
```

内容从 `templates/iris_project_profile.template.md` 填写。

5. 准备 IRIS 开发主力脚本配置：

`.agents/config/project-env.json` 是人类可读的配置副本，`.mcp.json` 是 MCP 运行时事实来源。两者共存但 `.mcp.json` 优先。

**若 `.mcp.json` 已存在**：从 `.mcp.json` 提取已知值填充 `project-env.json`，无需运行 `sync-env-config.js`。

**若 `.mcp.json` 不存在**：

```powershell
New-Item -ItemType Directory -Force .agents/config
Copy-Item .agents/plugins/coding-iris-plugin/templates/project-env.template.json .agents/config/project-env.json
notepad .agents/config/project-env.json
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js
```

模板默认把 `mcp.serverPath` 指向内置 Windows x64 可执行文件 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe`。如果目标工程使用其他平台或自定义版本，只改目标工程本地 `project-env.json` 或 `.mcp.json`。

`.agents/config/project-env.json` 和 `.mcp.json` 可能包含敏感信息，不应提交到业务项目版本库。

6. 生成 thin-index：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/coding-iris-plugin `
  -ProjectRoot . `
  -Mode DryRun `
  -ExcludeSkill coding-iris-init
```

确认后：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/coding-iris-plugin `
  -ProjectRoot . `
  -Mode Write `
  -ExcludeSkill coding-iris-init
```

7. 将 `templates/AGENTS.coding-iris-snippet.md` 合入目标工程 `AGENTS.md`。

8. 确认 `.agents/.git/info/exclude` 已隐藏本地生成层：

```gitignore
/config/
/memory/
/rules/
/skills/
/scripts/
```

这些规则用于避免 VS Code 的 `.agents` Git 仓库显示 profile、project-env、thin-index 和本地辅助脚本。不要写入 `.agents/.gitignore`。

## 验证清单

- 插件目录存在。
- `convert-gb2312-upload.ps1` 和 `check-frontend-encoding.ps1` wrapper 已生成到 `.agents/scripts/`。
- `.agents/config/iris_project_profile.md` 的模式只使用 `standard-gb2312` 或 `project-utf8`，并已通过实际文件字节验证。
- `generate-plugin-thin-index.ps1` 保持在插件 `scripts/` 内并可直接调用。
- `.agents/config/iris_project_profile.md` 已填写工程差异（多仓库工作区只填通用项）。
- `.agents/config/project-env.json` 已创建并填写（可从 `.mcp.json` 反向填充）。
- `.mcp.json` 保存实际 MCP 连接事实。
- `.agents/rules/` 和 `.agents/skills/` 的 thin-index 指向插件真实文件。
- `.agents/.git/info/exclude` 已包含生成层忽略规则。
- 插件规则中没有源工程服务器、namespace、远程路径、业务类名前缀或凭据。
