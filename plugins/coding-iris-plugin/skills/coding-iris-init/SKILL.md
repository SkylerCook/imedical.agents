---
name: coding-iris-init
description: Initialize coding-iris-plugin in a target IRIS project, copy bundled scripts, create project profile guidance, and generate thin indexes.
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

1. 插件根 `AGENTS.md`。
2. 插件根 `README.md`。
3. `templates/coding-iris-init-guide.md`。
4. 目标工程已有 `AGENTS.md`、`.mcp.json`、`.agents/` 状态。

## 初始化流程

1. 检查目标工程：
   - 是否存在 `AGENTS.md`。
   - 是否存在 `.mcp.json`。
   - 是否存在 `.agents/config/iris_project_profile.md`。
   - 是否已有同名 rules/skills，避免覆盖用户定制。
2. 复制编码转换脚本到 `.agents/scripts/`：
   - `convert-gb2312-upload.ps1`
   - 目标不存在则复制；目标存在且内容相同则跳过；目标存在且内容不同则报告 conflict，除非用户明确要求覆盖。
   - `generate-plugin-thin-index.ps1` 不复制到目标工程，只从插件内路径直接调用。
3. 初始化 profile：
   - 若 `.agents/config/iris_project_profile.md` 不存在，基于 `templates/iris_project_profile.template.md` 创建或提示创建。
   - profile 中只能保存项目差异，不保存账号、密码、token。
4. 初始化 IRIS 开发主力脚本配置：
   - 若 `.agents/config/project-env.json` 不存在，提示用户从 `.agents/plugins/coding-iris-plugin/templates/project-env.template.json` 复制后填写。
   - 不要替用户生成真实 host、账号、密码、namespace 或本机 MCP 可执行文件路径。
   - 用户填写完成后，可运行：
     ```powershell
     node .agents/plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js
     ```
   - `.agents/config/project-env.json` 和生成的 `.mcp.json` 可能包含敏感信息，不得提交到业务项目版本库。
5. 生成 thin-index：
   - 先执行 DryRun：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 -PluginPath .agents/plugins/coding-iris-plugin -ProjectRoot . -Mode DryRun -ExcludeSkill coding-iris-init
     ```
   - 用户确认后执行 Write：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 -PluginPath .agents/plugins/coding-iris-plugin -ProjectRoot . -Mode Write -ExcludeSkill coding-iris-init
     ```
6. 接入入口：
   - 将 `templates/AGENTS.coding-iris-snippet.md` 作为目标工程 `AGENTS.md` 的建议片段。
   - 合入前保留目标工程既有业务规则和 Git 规则。
7. 验证：
   - thin-index 指向 `.agents/plugins/coding-iris-plugin/` 内真实 rules/skills。
   - 编码转换脚本已存在于目标工程 `.agents/scripts/`；thin-index 脚本仍位于插件 `scripts/`。
   - IRIS 开发主力脚本位于插件 `.agents/plugins/coding-iris-plugin/scripts/iris-tools/`，不复制到根 `.agents/scripts/`。
   - 插件中没有源工程服务器、namespace、远程路径、业务类名前缀。

## 输出

- 初始化模式。
- 脚本复制结果和插件内置 thin-index 脚本调用结果。
- profile 创建或缺失项。
- thin-index DryRun/Write 结果。
- 被跳过或冲突的文件。
- 仍需目标工程填写的配置项。
