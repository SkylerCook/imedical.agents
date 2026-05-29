# AI Coding Workspace Kit v0.1.3

本文定义一套可分享、可迁移的工程级 AI Coding 工作区结构。目标是让不同 Code Agent 在长期演进代码库中快速获得正确上下文，同时避免把规则、经验、专项流程和环境连接信息混在一起。

## 目录树

```text
your-project/
|-- AGENTS.md                         # 工程级唯一主入口，所有 Code Agent 优先读取
|-- CLAUDE.md                         # 兼容入口，建议链接或转发到 AGENTS.md
|-- CODEBUDDY.md                      # 兼容入口，建议链接或转发到 AGENTS.md
|-- .mcp.json                         # MCP 连接事实来源，可选；环境/连接信息放这里
|
|-- .agents/
|   |-- config/                       # 当前工程 AI 配置，非敏感语义配置
|   |-- memory/                       # 项目长期记忆，不是正式项目文档
|   |-- rules/                        # 真实规则或规则 thin-index
|   |-- skills/                       # 真实 skill 或 skill thin-index
|   |-- scripts/                      # 当前工程 AI 辅助脚本，供 agent/skill 主动调用
|   |-- plugins/                      # 可复用、可分享的能力包
|   |   `-- example-plugin/
|   |       |-- .agents-plugin/
|   |       |   `-- plugin.json
|   |       |-- AGENTS.md
|   |       |-- README.md
|   |       |-- rules/                # 可选：插件内通用规则
|   |       |-- skills/               # 可选：插件内通用技能
|   |       |-- templates/            # 可选：插件初始化模板
|   |       |-- scripts/              # 可选：插件专属辅助脚本，例如 thin-index 生成器
|   |       |-- commands/             # 可选：插件内斜杠命令
|   |       |-- agents/               # 可选：插件内子代理定义
|   |       |-- hooks/                # 可选：插件内钩子配置与脚本
|   |       `-- config/               # 可选：插件自身示例配置；不存目标工程差异
|   |-- templates/                    # 当前工程模板，可选；不要与插件 templates 重复维护
|   |-- commands/                     # 当前工程斜杠命令，可选
|   |-- agents/                       # 当前工程子代理定义，可选
|   `-- hooks/                        # 当前工程钩子配置与脚本，可选
|
|-- docs/                             # 项目文档/生成资料，是否入库按工程规则
|-- references/                       # 外部参考资料/源码索引，是否入库按工程规则
`-- src/                              # 业务代码
```

## 核心原则

1. `AGENTS.md` 是工程级唯一主入口。
2. `CLAUDE.md`、`CODEBUDDY.md` 等只做兼容入口，不维护第二份规则。
3. `.agents/config/` 放非敏感工程语义配置；敏感连接信息不放这里。
4. `.mcp.json` 放 MCP、环境、连接事实。
5. `.agents/memory/` 只放长期有效事实、决策、坑点和待办，不放规则全文。
6. `.agents/rules/` 和 `.agents/skills/` 可包含真实内容或 thin-index；Agent 读到 thin-index 后必须继续读取其指向的插件真实文件。若目标 Agent 不能可靠跳转，应使用 `copy` 模式。
7. `.agents/scripts/` 放通用工作区工具；插件专属脚本放 `.agents/plugins/<plugin>/scripts/`；不要使用 `.agents/plugins/scripts` 作为共享脚本目录。
8. `.agents/plugins/` 放可迁移能力包。
9. 插件不写死工程差异；工程差异落到 `.agents/config/` 和 `.mcp.json`。
10. 插件 bootstrap/init skill 可以直接从插件目录读取，不必先有 thin-index；thin-index 适合安装后的日常能力发现，不适合作为唯一安装入口。
11. 插件 `templates/` 用于初始化目标工程；工程级 `templates/` 不重复维护插件模板。
12. `references/` 放外部参考资料和源码索引，不塞进 `.agents/`。
13. `AGENTS.md` 保持轻量，只放全局适用的工程大图、关键入口、禁止事项和索引；细节下沉到 `rules/`、`skills/`、`config/`、`memory/`。
14. 使用 `.gitignore`、`.git/info/exclude` 或 agent ignore 配置排除生成物、第三方源码、大文件和无关资料，减少 agent 搜索噪声。
15. 项目上下文初始化前先判断 `contextMode`：完整工程使用 `codebase-complete`；刚新建、代码零散或后续按需从服务器导出文件的工程使用 `intent-first-on-demand-export`，并在 `.agents/config/project_context_profile.md` 记录非敏感语义配置。
16. `contextMode` 使用保守默认：用户明确说按需导出时直接选 `intent-first-on-demand-export`；无法证明本地代码代表完整工程时，也选 `intent-first-on-demand-export`。
17. 对 `intent-first-on-demand-export` 工程，`AGENTS.md` 不得围绕单个或少量零散文件生成架构结论；本地已有文件最多列为“当前已导出/已存在文件”；需求处理应先确认目标页面、类、JS、CSP 或业务对象，再按需导出相关文件。
18. `.agents` 是独立 Git 仓库时，目标工程本地生成层应写入 `.agents/.git/info/exclude`，不要写入 `.agents/.gitignore`；默认忽略 `/config/`、`/memory/`、`/rules/`、`/skills/`、`/scripts/`。

## 插件体系

插件是可迁移能力包，适合承载跨工程复用的规则、技能、模板、脚本、命令、子代理或 hook 配置。

标准插件根目录：

```text
.agents/plugins/<plugin-name>/
|-- .agents-plugin/
|   `-- plugin.json
|-- AGENTS.md
|-- README.md
|-- rules/
|-- skills/
|-- templates/
|-- scripts/
|-- commands/
|-- agents/
|-- hooks/
`-- config/
```

除 `.agents-plugin/plugin.json`、`AGENTS.md`、`README.md` 外，其它目录都按实际能力形态选择；不要为了形式创建空目录。

## 安装模式

### plugin-reference-thin-index

适用于插件依赖深层 `rules/` 或 `skills/`，且目标 Agent 可能只发现浅层 `.agents/rules/`、`.agents/skills/` 的场景。i18n 这类规则/技能密集型插件默认使用该模式。

行为：

- 插件保留在 `.agents/plugins/<plugin-name>/`。
- 在目标工程 `.agents/rules/` 和 `.agents/skills/` 生成 thin-index。
- thin-index 只指向插件真实文件，不复制规则全文。
- Agent 读到 thin-index 后必须继续读取指向的插件真实文件。

### copy

兼容模式。按用户指定或实际需要复制插件内容到目标工程 `.agents/`。适用于目标 Agent 不支持插件发现，或不能可靠遵循 thin-index 跳转指令的场景。

### plugin-reference

纯插件模式。只保留插件目录，不生成 thin-index。仅适用于 Agent 明确支持插件发现并会读取插件内 `rules/`、`skills/` 的场景。

### symlink

符号链接不作为默认模式。Windows 下通常需要管理员权限或开发者模式，且 Git、压缩包、跨平台同步和不同 Agent 对 symlink 的处理不一致。规范默认使用普通 Markdown thin-index。

## Thin-Index 自动生成

插件可内置 thin-index 生成脚本。i18n 插件脚本位置：

```text
.agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1
```

默认先 dry-run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/i18n-iris-plugin `
  -ProjectRoot . `
  -Mode DryRun `
  -ExcludeSkill i18n-project-init
```

确认输出后再写入：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/i18n-iris-plugin `
  -ProjectRoot . `
  -Mode Write `
  -ExcludeSkill i18n-project-init
```

默认不覆盖已有文件；只有显式指定 `-Force` 才覆盖。
当 `PluginPath` 使用相对路径时，脚本按 `ProjectRoot` 解析插件位置；如需引用工程外插件，应传入绝对路径。

脚本行为：

- 扫描插件 `rules/*.md`，生成 `.agents/rules/<rule>.md` thin-index。
- 扫描插件 `skills/*/SKILL.md`，生成 `.agents/skills/<skill>/SKILL.md` thin-index。
- 可通过 `-ExcludeRule` 和 `-ExcludeSkill` 排除不需要 shallow 入口的项目，例如 bootstrap/init skill。
- 不扫描、不复制 `templates/`、`config/`、`scripts/`、`hooks/` 等目录。
- 输出 `generated`、`skipped`、`conflict`、`missing` 等结果。

thin-index 必须明确：

- 本文件只是 thin-index。
- 真实插件文件路径。
- Agent 读取本文件后必须继续读取目标插件文件。
- 可提醒读取 `.agents/config/` 和 `.mcp.json`，但不得保存连接信息。

## 从零接入一个插件

最小流程：

1. 将插件放入目标工程：

   ```text
   .agents/plugins/example-plugin/
   ```

2. 如果插件提供 bootstrap/init skill，首次接入时直接读取插件内真实 skill，不依赖安装后才生成的 thin-index。

3. 将插件提供的 `AGENTS` 片段合入目标工程 `AGENTS.md`。

4. 按插件模板准备目标工程配置：

   ```text
   .agents/config/<plugin-profile>.md
   .mcp.json
   ```

5. 生成 thin-index 前先 dry-run：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/example-plugin/scripts/generate-plugin-thin-index.ps1 `
     -PluginPath .agents/plugins/example-plugin `
     -ProjectRoot . `
     -Mode DryRun `
     -ExcludeSkill example-project-init
   ```

6. 确认后写入：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/example-plugin/scripts/generate-plugin-thin-index.ps1 `
     -PluginPath .agents/plugins/example-plugin `
     -ProjectRoot . `
     -Mode Write `
     -ExcludeSkill example-project-init
   ```

7. 验证浅层入口：

   ```text
   .agents/rules/
   .agents/skills/
   ```

8. 让 Agent 从浅层 skill/rule 进入，并确认它继续读取插件真实文件。

若第 8 步不可靠，改用 `copy` 模式。

## Hooks 边界

`hooks/` 是约定目录，不保证自动生效。

- 未接入具体 Agent 的 hook runner 或 settings 时，`hooks/` 只是脚本/配置存放位置。
- Claude Code 等工具可能有自己的 hooks/settings 机制，需要额外适配。
- Codex 或其它 Agent 是否执行 hooks，取决于其运行器能力。
- 对跨 Agent 通用能力，优先使用 `scripts/` 作为主动调用脚本；需要事件触发时再接入具体 hooks 机制。

插件内 `hooks/` 同理：它可以随插件分发 hook 模板，但落地目标工程后必须显式接入目标 Agent 的实际 hook 机制。

## 版本兼容

v0.1.3 只要求插件 `.agents-plugin/plugin.json` 保留 `version` 字段。

以下能力留到 v0.2 设计：

- 插件升级检测。
- copy 模式漂移检测。
- 目标工程安装记录。
- thin-index 来源版本校验。

## 当前工程落地示例

```text
.agents/
|-- config/
|   `-- i18n_project_profile.md
|-- memory/
|   `-- project-memory.md
|-- plugins/
|   `-- i18n-iris-plugin/
|-- rules/
|-- scripts/
`-- skills/
```

当前工程的 `AGENTS.md` 聚焦技工单需求处理；i18n 能力已沉淀为 `.agents/plugins/i18n-iris-plugin/`，工程差异由 `.agents/config/i18n_project_profile.md` 和 `.mcp.json` 承载。
