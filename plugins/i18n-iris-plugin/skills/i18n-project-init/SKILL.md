---
name: i18n-project-init
description: Initialize the reusable IRIS i18n agent kit in a target project with plugin-reference-thin-index, copy, or plugin-reference mode.
---

# I18N Project Init

## 职责边界

本文件是 `i18n-iris-plugin` 初始化的执行准则。Agent 实际落地插件、生成 profile、检查 `.mcp.json`、生成 thin-index 和输出初始化结果时，以本 Skill 为准。

`templates/i18n-init-guide.md` 是给用户和后续 agent 阅读的操作说明；若两者出现冲突，以本 Skill 为准，并同步修正 guide。

本 Skill 是 bootstrap skill。首次初始化时，Agent 必须直接读取插件真实路径 `.agents/plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md`，不要依赖安装后才会生成的 shallow thin-index。

## 触发条件

当用户要求把 i18n 能力初始化到新工程、迁移到下个工程、安装 `i18n-iris-plugin`，或检查目标工程 i18n 接入状态时使用本 Skill。

## 输入

- `targetProjectRoot`：目标工程根目录，默认当前工作区。
- `installMode`：`plugin-reference-thin-index`、`copy` 或 `plugin-reference`。默认 `plugin-reference-thin-index`。
- `hisuiMode`：HISUI 索引安装策略。可选 `auto`、`include`、`skip`，默认 `auto`。
- `updateAgents`：是否更新目标工程 `AGENTS.md`。默认只生成建议片段；用户明确要求时再合入。

## 安装模式

- `plugin-reference-thin-index`：默认模式。目标工程保留插件目录 `.agents/plugins/i18n-iris-plugin/`，使用插件内置 `.agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1` 在浅层 `.agents/rules/` 和 `.agents/skills/` 生成 thin-index。
- `copy`：兼容模式。将插件 `rules/`、`skills/`、必要 `templates/` 复制到目标工程 `.agents/` 下，适用于不支持插件发现或不保留插件目录的工程。
- `plugin-reference`：纯插件模式。只保留 `.agents/plugins/i18n-iris-plugin/`，不生成 thin-index；仅适用于 Agent 明确支持插件发现并会读取插件内 rules/skills 的场景。

## 必读

1. 插件根 `AGENTS.md`。
2. 插件根 `README.md`。
3. `templates/i18n-init-guide.md`。
4. 目标工程已有 `AGENTS.md`、`.mcp.json` 和 `.agents/` 状态。
5. 插件内置 thin-index 脚本：`.agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1`。

## 初始化流程

1. 检查目标工程：
   - 是否存在 `AGENTS.md`。
   - 是否存在 `.mcp.json`。
   - 是否已有 `.agents/config/i18n_project_profile.md`。
   - 是否已有同名 rules/skills，避免覆盖用户定制。

2. 安装通用能力：
   - `plugin-reference-thin-index`：确保插件位于 `.agents/plugins/i18n-iris-plugin/`，先运行 thin-index 脚本 `DryRun`，确认后再 `Write`；默认排除 `i18n-project-init`，避免用安装结果触发安装过程。
   - `copy`：复制插件 `rules/` 到 `.agents/rules/`，复制插件 `skills/` 到 `.agents/skills/`，必要时复制插件 `templates/` 到 `.agents/templates/`。
   - `plugin-reference`：只保留插件目录，不生成 `.agents/rules/` 或 `.agents/skills/` thin-index；执行前必须确认当前 Agent 能发现并读取插件内 rules/skills。
   - HISUI 索引是否启用由 `hisuiMode` 决定；HISUI 源码路径只写入 profile 的 `HISUI_SRC`。

3. 生成 thin-index：
   - 默认先执行：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1 -PluginPath .agents/plugins/i18n-iris-plugin -ProjectRoot . -Mode DryRun -ExcludeSkill i18n-project-init
     ```
   - 用户确认后执行：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1 -PluginPath .agents/plugins/i18n-iris-plugin -ProjectRoot . -Mode Write -ExcludeSkill i18n-project-init
     ```
   - 如果需要后续通过 shallow skill 重新检查、升级或重建索引，可以去掉 `-ExcludeSkill i18n-project-init`，为本 bootstrap skill 也生成 thin-index。
   - 若脚本不可用，才手工生成 thin-index；手工 thin-index 必须指向插件真实文件，并要求 Agent 继续读取目标插件文件。

4. 初始化项目配置：
   - 从 `templates/i18n_project_profile.template.md` 生成 `.agents/config/i18n_project_profile.md`。
   - 默认保留当前 IRIS i18n 存储：页面级 `^websys.TranslationD("PAGE",...)`，字典级 `BDP_Translation`。
   - **语言目录补全**：
     - 若 `.mcp.json` 提供 IRIS 执行能力（`iris_execute`），运行以下 ObjectScript 查询服务器语言：
       ```
       s id="" f  s id=$o(^SS("LAN",id)) q:id=""  w id,"=",^SS("LAN",id),!
       ```
       输出格式（每行）：`langId=Code^Name^Active^...`，取 langId、Code、Name 写入 profile 语言目录表。
     - 若 MCP 不可用，使用兜底：`EN -> 1`、`CH -> 20`。
   - 标记仍需目标工程确认的页面组、种子类路径、业务边界和 `HISUI_SRC`。

5. 接入入口：
   - 将 `templates/AGENTS.i18n-snippet.md` 作为目标工程 `AGENTS.md` 的建议片段。
   - 合入前保留目标工程已有业务规则和 Git 规则。

6. 校验：
   - 检查 thin-index 路径是否指向 `.agents/plugins/i18n-iris-plugin/`。
   - 检查插件内 `rules/`、`skills/` 无旧工程硬编码。
   - 检查 `.mcp.json` 是否提供 IRIS 命令执行、编译、类方法、SQL、SFTP 等所需能力。
   - 检查 `.agents/.git/info/exclude` 是否包含生成层忽略规则：`/config/`、`/memory/`、`/rules/`、`/skills/`、`/scripts/`。
   - 输出仍需人工确认的 profile 项。

## 安全约束

- 不把 `.mcp.json` 中的 host、端口、账号、密码复制到 rules、skills 或 profile。
- 不覆盖目标工程已有 `AGENTS.md`，除非用户明确要求合入。
- 不默认执行服务器写入、上传、编译或加载翻译。
- 若目标工程已有不同 i18n 存储机制，只更新 profile，不修改通用 rules/skills。
- `i18n_project_profile.md`、thin-index 和本地生成脚本属于目标工程本地生成层，应由 `.agents/.git/info/exclude` 隐藏；不要把生成层忽略规则写进 `.agents/.gitignore`。

## 输出

- 初始化模式，以及生成/复制/引用了哪些文件。
- thin-index 脚本 `DryRun` 和 `Write` 的结果。
- 哪些文件因已存在而跳过或需要人工合并。
- `.agents/config/i18n_project_profile.md` 中仍需确认的项目。
- `.agents/.git/info/exclude` 生成层忽略规则检查结果。
- `.mcp.json` 能力检查结果。
- 下一步建议：先执行文本提取只读验证，再生成小批量页面翻译种子，最后进行服务器 report-only 校验。
