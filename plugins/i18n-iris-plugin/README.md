# i18n-iris-plugin

`i18n-iris-plugin` 是面向 IRIS/ObjectScript/CSP/HISUI 工程的通用 i18n Agent 能力包，覆盖：

- 前后端 i18n 编码改造。
- 用户可见文本提取和翻译表生成。
- 页面级非字典翻译种子生成。
- 字典/表字段展示值翻译 SQL 生成。
- XML 打印模板翻译。
- CSP 页面翻译导出、校验和同步。
- 新工程 i18n 初始化。

## 设计原则

- 插件包只提供通用能力，不绑定具体工程。
- 目标工程差异写入 `.agents/config/i18n_project_profile.md`。
- MCP 连接信息以目标工程 `.mcp.json` 为唯一事实来源。
- 页面级翻译默认沿用 `^websys.TranslationD("PAGE",...)`。
- 字典翻译默认沿用 `BDP_Translation`。

## 标准目录

```text
i18n-iris-plugin/
|-- .agents-plugin/
|   `-- plugin.json
|-- AGENTS.md
|-- README.md
|-- rules/
|-- skills/
`-- templates/
```

## 安装模式

默认使用 `plugin-reference-thin-index`：

- 插件保留在 `.agents/plugins/i18n-iris-plugin/`。
- 使用插件内置脚本生成浅层 thin-index。
- 目标工程 `.agents/rules/` 和 `.agents/skills/` 只放 thin-index，指向插件内真实 rules/skills。
- 首次初始化入口不依赖 thin-index；AI 应直接读取 `.agents/plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md`。

`i18n-project-init` 是 bootstrap skill，负责安装、检查、生成 profile 和调用 thin-index 脚本。安装完成后的日常能力入口才通过浅层 thin-index 触发。

生成前先 dry-run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/i18n-iris-plugin `
  -ProjectRoot . `
  -Mode DryRun `
  -ExcludeSkill i18n-project-init
```

确认后写入：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/i18n-iris-plugin `
  -ProjectRoot . `
  -Mode Write `
  -ExcludeSkill i18n-project-init
```

如需后续通过浅层入口重新检查、升级或重建索引，可以去掉 `-ExcludeSkill i18n-project-init`，为 bootstrap skill 也生成 thin-index。

同时支持：

- `copy`：兼容模式，复制 rules/skills/templates 到目标工程 `.agents/`。
- `plugin-reference`：纯插件模式，只保留插件目录，不生成 thin-index；仅适用于 Agent 明确支持插件发现的场景。

## 接入目标工程

1. 将本插件放到目标工程 `.agents/plugins/i18n-iris-plugin/`。
2. 确保插件内置 thin-index 脚本存在：`.agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1`。
3. 首次初始化时直接读取 `.agents/plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md`。
4. 将 `templates/AGENTS.i18n-snippet.md` 合入目标工程 `AGENTS.md`。
5. 从 `templates/i18n_project_profile.template.md` 生成目标工程 `.agents/config/i18n_project_profile.md`。
6. 配置目标工程 `.mcp.json`。
7. 使用 `i18n-project-init` 或 thin-index 脚本做初始化检查。

更多步骤见 `templates/i18n-init-guide.md`。
