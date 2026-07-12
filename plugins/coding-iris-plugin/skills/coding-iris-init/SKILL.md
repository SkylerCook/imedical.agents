---
name: coding-iris-init
description: Use when initializing coding-iris-plugin in a target IRIS project, including bundled scripts, project profile guidance, and thin indexes.
---

# Coding IRIS Init

## 职责边界

本 Skill 是 `coding-iris-plugin` 的 bootstrap 初始化入口。首次接入目标工程时，Agent 必须直接读取插件真实路径 `.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`，不要依赖安装后才生成的 thin-index。

## 输入

- `targetProjectRoot`：目标工程根目录，默认当前工作区。
- `installMode`：默认 `plugin-reference-thin-index`；可选 `copy` 或 `plugin-reference`。
- `updateAgents`：是否合入 `AGENTS.md` 片段；默认只给出建议，用户明确要求时再编辑。
- `forceScriptOverwrite`：是否覆盖目标工程已有同名脚本；默认 false。

## 必读

先读取：

1. 插件根 `AGENTS.md`。
2. 插件根 `README.md`。
3. 目标工程已有 `AGENTS.md`、`.mcp.json`、`.agents/` 状态。

按条件继续读取：

- 需要人工安装说明或步骤对照时，读取 `templates/coding-iris-init-guide.md`；本文件是 Agent 执行指令，两者冲突时以本文件为准。
- 生成或重建 thin-index 前，读取插件内置 `scripts/generate-plugin-thin-index.ps1` 的调用方式，不复制脚本实现。
- 创建或补齐 profile 时，读取 `templates/iris_project_profile.template.md`；只有用户明确选择项目类型时，才读取 `templates/profile-defaults/<type>.md`。

## 初始化流程

1. 检查目标工程：
   - 是否存在 `AGENTS.md`。
   - 是否存在 `.mcp.json`。
   - 是否存在 `.agents/config/iris_project_profile.md`。
   - 是否已有同名 rules/skills，避免覆盖用户定制。
2. 初始化前端编码脚本入口：
   - 运行插件 `scripts/migrate-frontend-encoding-profile.ps1`，为 `.agents/scripts/convert-gb2312-upload.ps1` 和 `check-frontend-encoding.ps1` 创建指向插件 canonical 实现的薄 wrapper。
   - 已知历史复制版本可自动替换为 wrapper；用户定制或未知版本只报告 `script-conflict`，不得覆盖。
   - `generate-plugin-thin-index.ps1` 不复制到目标工程，只从插件内路径直接调用。
3. 初始化 profile：
   - 若 `.agents/config/iris_project_profile.md` 已存在，保留已有值，只合并缺失段落。
   - 若不存在，询问用户项目类型：
     - `doctor-dev`：从 `templates/profile-defaults/doctor-dev.md` 加载默认值（后端 BLH/DATA/SQL 约定、Broker、前端 CSP/JS 命名、公共 HEAD/JS/CSS 等），再用已知信息填充其余字段。
     - `通用`（或用户未指定）：基于 `templates/iris_project_profile.template.md` 创建，按探索流程填充可确定字段，确实无法确定的标 TODO。
   - `templates/profile-defaults/<type>.md` 只在用户显式选择对应项目类型后加载；它是领域默认值，不是通用规则。加载后仍需用代码探索或用户确认校验，不能自动套用到未确认项目。
   - profile 中只能保存项目差异，不保存账号、密码、token。
   - 前端编码模式只允许 `standard-gb2312` 或 `project-utf8`；路径覆盖只映射这两种模式。目录/仓库角色提出候选，实际文件字节检测是最终门禁。
   - **多仓库工作区**：若目标工程是平铺多仓库架构（如 `corePro-flat`），工作区级别 profile 只填通用项（Web 技术、编码策略、HISUI 基础路径）；仓库特有项（namespace、包前缀、目录路径、命名模板）标注"按仓库填写"，不要填入单一仓库的值当作全局事实。
4. 初始化 IRIS 开发主力脚本配置：
   - `.agents/config/project-env.json` 是人类可读的配置副本，`.mcp.json` 是 MCP 运行时事实来源；两者共存但 `.mcp.json` 优先。
   - **若 `.mcp.json` 已存在**：从 `.mcp.json` 反向填充 `project-env.json`（Agent 直接读取 `.mcp.json` 提取 iris/sftp/mcp 字段），web.* 部分无法从 `.mcp.json` 推导的标注 TODO。无需运行 `sync-env-config.js`。
   - **若 `.mcp.json` 不存在**：提示用户从 `.agents/plugins/coding-iris-plugin/templates/project-env.template.json` 复制后填写，填写完成后运行：
     ```powershell
     node .agents/plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js
     ```
   - 不要替用户生成真实 host、账号、密码、namespace 或本机 MCP 可执行文件路径。
   - `.agents/config/project-env.json` 和 `.mcp.json` 可能包含敏感信息，不得提交到业务项目版本库。
5. 生成 thin-index：
   - 先执行 DryRun：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 -PluginPath .agents/plugins/coding-iris-plugin -ProjectRoot . -Mode DryRun -ExcludeSkill coding-iris-init
     ```
   - **若 DryRun 全部 skipped**：补充提示"所有 thin-index 已存在且指向正确插件路径，无需更新。如需强制重建，使用 `-Force` 参数。"然后跳到步骤 6。
   - 若有需要写入的条目，用户确认后执行 Write：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 -PluginPath .agents/plugins/coding-iris-plugin -ProjectRoot . -Mode Write -ExcludeSkill coding-iris-init
     ```
6. 接入入口：
   - 将 `templates/AGENTS.coding-iris-snippet.md` 作为目标工程 `AGENTS.md` 的建议片段。
   - 合入前保留目标工程既有业务规则和 Git 规则。
7. 验证：
   - thin-index 指向 `.agents/plugins/coding-iris-plugin/` 内真实 rules/skills。
   - 前端编码 wrapper 已存在于目标工程 `.agents/scripts/`，canonical 实现与迁移/提升脚本位于插件 `scripts/`。
   - IRIS 开发主力脚本位于插件 `.agents/plugins/coding-iris-plugin/scripts/iris-tools/`，不复制到根 `.agents/scripts/`。
   - `.agents/.git/info/exclude` 已包含生成层忽略规则：`/config/`、`/memory/`、`/rules/`、`/skills/`、`/scripts/`。
   - 插件中没有源工程服务器、namespace、远程路径、业务类名前缀。
8. 更新插件状态：
   - 初始化闭环验收通过后，运行脚本机械维护 `.agents/config/plugin_profile.md`：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-plugin-profile.ps1 -ProjectRoot . -Plugin coding-iris-plugin -Status enabled
     ```
   - 将 `coding-iris-plugin` 状态标记为 `enabled`。
   - 若文件不存在，脚本会按 Markdown 表格创建；插件目录存在但未启用的其它插件保持 `available`。
9. 更新项目记忆：
   - 将初始化结果写入 `.agents/memory/project-memory.md` 的"最近变化"段落，记录接入了哪些插件、关键配置路径和仍需用户填写的 TODO 项。

## Git 忽略边界

`iris_project_profile.md`、`project-env.json`、thin-index 和复制到 `.agents/scripts/` 的本地脚本属于目标工程本地生成层。初始化或重建索引后，必须确认这些路径由 `.agents/.git/info/exclude` 隐藏，不要把生成层忽略规则写进 `.agents/.gitignore`。

## 输出

- 初始化模式。
- 脚本复制结果和插件内置 thin-index 脚本调用结果。
- profile 创建或缺失项。
- thin-index DryRun/Write 结果。
- `plugin_profile.md` 中 `coding-iris-plugin` 的最终状态。
- 被跳过或冲突的文件。
- `.agents/.git/info/exclude` 生成层忽略规则检查结果。
- 仍需目标工程填写的配置项。
- `.mcp.json` 已存在时，`project-env.json` 反向填充结果。
- project-memory.md 更新结果。
