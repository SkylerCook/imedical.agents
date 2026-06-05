# AI Coding Workspace Kit v0.1.3

本文定义一套可分享、可迁移的工程级 AI Coding 工作区结构。目标是让不同 Code Agent 在长期演进代码库中快速获得正确上下文，同时避免把规则、经验、专项流程和环境连接信息混在一起。

## 目录树

```text
your-project/
|-- AGENTS.md                         # 工程级唯一主入口，所有 Code Agent 优先读取
|-- CLAUDE.md                         # 可选兼容入口，可作为指向 AGENTS.md 的 symlink
|-- CODEBUDDY.md                      # 可选兼容入口，可作为指向 AGENTS.md 的 symlink
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
|   |       |-- references/           # 可选：插件内按需查阅的参考资料、查找表、源码/API 索引
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

1. `AGENTS.md` 是工程级唯一主入口，必须存在。
2. `CLAUDE.md`、`CODEBUDDY.md` 等只做可选兼容入口；如存在，只允许是指向 `AGENTS.md` 的 symlink，不维护第二份规则。
3. `.agents/config/` 放非敏感工程语义配置；敏感连接信息不放这里。
4. `.mcp.json` 放 MCP、环境、连接事实。
5. `.agents/memory/` 只放长期有效事实、决策、坑点和待办，不放规则全文。
6. `.agents/rules/` 和 `.agents/skills/` 可包含真实内容或 thin-index；Agent 读到 thin-index 后必须继续读取其指向的插件真实文件。若目标 Agent 不能可靠跳转，应使用 `copy` 模式。
7. `.agents/scripts/` 放通用工作区工具；插件专属脚本放 `.agents/plugins/<plugin>/scripts/`；不要使用 `.agents/plugins/scripts` 作为共享脚本目录。
8. `.agents/plugins/` 放可迁移能力包。
9. 插件不写死工程差异；工程差异落到 `.agents/config/` 和 `.mcp.json`。
10. 插件 bootstrap/init skill 可以直接从插件目录读取，不必先有 thin-index；thin-index 适合安装后的日常能力发现，不适合作为唯一安装入口。
11. 插件 `templates/` 用于初始化目标工程；工程级 `templates/` 不重复维护插件模板。
12. 项目根目录 `references/` 放工程外部参考资料和源码索引，是否入库按工程规则；插件内 `references/` 放随插件复用、按需查阅的查找表、源码/API 索引或长参考资料，不属于约束性 rules。
13. `AGENTS.md` 保持轻量，只放全局适用的工程大图、关键入口、禁止事项和索引；细节下沉到 `rules/`、`skills/`、`config/`、`memory/`。
14. 使用 `.gitignore`、`.git/info/exclude` 或 agent ignore 配置排除生成物、第三方源码、大文件和无关资料，减少 agent 搜索噪声。
15. 项目上下文初始化前先判断 `contextMode`：完整工程使用 `codebase-complete`；刚新建、代码零散或后续按需从服务器导出文件的工程使用 `intent-first-on-demand-export`，并在 `.agents/config/project_context_profile.md` 记录非敏感语义配置。
16. `contextMode` 使用保守默认：用户明确说按需导出时直接选 `intent-first-on-demand-export`；无法证明本地代码代表完整工程时，也选 `intent-first-on-demand-export`。
17. 对 `intent-first-on-demand-export` 工程，`AGENTS.md` 不得围绕单个或少量零散文件生成架构结论；本地已有文件最多列为“当前已导出/已存在文件”；需求处理应先确认目标页面、类、JS、CSP 或业务对象，再按需导出相关文件。
18. `.agents` 是独立 Git 仓库时，目标工程本地生成层应写入 `.agents/.git/info/exclude`，不要写入 `.agents/.gitignore`；默认忽略 `/config/`、`/memory/`、`/rules/`、`/skills/`、`/scripts/`。
19. 兼容入口不要求模型理解 symlink；`.agents/scripts/check-agent-entrypoints.ps1` 只报告状态。`missing`、`not-symlink`、`wrong-target` 是可选兼容提示，不阻塞安装或更新，不自动修复。
20. 被 `.agents/.git/info/exclude` 忽略的通用能力修正，需要贡献回能力包时使用 `git add -f <path>` 或 `scripts/stage-ignored-agent-file.ps1` 显式暂存；不要移除生成层 ignore 规则。
21. 新增能力文件采用统一命名：`skills/<skill-name>/SKILL.md` 使用 kebab-case，`rules/<rule_name>.md` 使用 snake_case，`references/<reference-name>.md` 使用 kebab-case，`scripts/<script-name>.<ext>` 使用 kebab-case。
22. 历史文件命名统一已完成；未来新增历史文件如需重命名，只有在 thin-index canonical、stale 清理或明确迁移窗口中，才同步处理路径迁移、README、AGENTS、skill 引用和兼容清理。
23. thin-index 生成逻辑以根 `scripts/generate-plugin-thin-index.ps1` 为唯一 canonical 实现；各插件同名脚本只能作为 wrapper 转发参数，不复制核心逻辑，也不依赖其它插件。

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
|-- references/
|-- skills/
|-- templates/
|-- scripts/
|-- commands/
|-- agents/
|-- hooks/
`-- config/
```

除 `.agents-plugin/plugin.json`、`AGENTS.md`、`README.md` 外，其它目录都按实际能力形态选择；不要为了形式创建空目录。

命名约定：

- 插件名和 skill 目录使用 kebab-case，例如 `coding-iris-plugin`、`iris-frontend-coding`。
- rule 文件使用 snake_case，例如 `iris_coding_frontend.md`、`i18n_extract_backend.md`。
- reference 文件偏资料名或索引名，使用 kebab-case，例如 `hisui-widget-index.md`。
- script 文件使用 kebab-case，例如 `install-agents.ps1`、`generate-plugin-thin-index.ps1`。
- 历史文件如已被 thin-index、README、AGENTS 或业务工程引用，不因命名风格单独改名；迁移时必须同步 stale 清理和所有入口引用。

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

符号链接是 `CLAUDE.md`、`CODEBUDDY.md` 等可选兼容入口的唯一允许形式，目标统一为 `AGENTS.md`。不同 Agent 不需要理解 symlink 语义；项目落地、上下文维护或提交前运行检查脚本只用于报告状态。

Windows 下创建 symlink 推荐在管理员 cmd 中使用 `mklink CLAUDE.md AGENTS.md`、`mklink CODEBUDDY.md AGENTS.md`；启用开发者模式后部分环境可免管理员。PowerShell 修复脚本只在用户明确要求时运行，会先尝试 `New-Item -ItemType SymbolicLink`，失败后回退到 `cmd /c mklink`。若环境不支持 symlink，修复脚本应明确失败并提示环境要求，不自动降级为普通转发文件，也不得复制 `AGENTS.md`。

插件 rules/skills 的浅层入口仍默认使用普通 Markdown thin-index，不使用 symlink。

## Thin-Index 自动生成

插件可内置 thin-index 生成脚本。i18n 插件脚本位置：

```text
.agents/plugins/i18n-iris-plugin/scripts/generate-plugin-thin-index.ps1
```

各插件可以保留自己的同名脚本作为稳定调用入口，但脚本必须委托到根 `scripts/generate-plugin-thin-index.ps1`。新增 stale 清理、frontmatter 传播、输出格式或冲突检测时，只修改 canonical 脚本，避免插件副本漂移和插件间运行时依赖。canonical 脚本的生成阶段只处理当前 `PluginPath`；stale 清理阶段扫描 `.agents/rules/` 中所有指向 `.agents/plugins/*/rules/*.md` 的 thin-index，因此通过任一插件 wrapper 调用都能清理其它插件的过期 rule 入口。

独立分发单个插件时，不能只复制 `.agents/plugins/<plugin>/`。若仍使用 `plugin-reference-thin-index`，必须同时携带根 `scripts/generate-plugin-thin-index.ps1`；否则改用 `copy` 模式或手工创建 thin-index。插件 wrapper 缺少根 canonical 脚本时应明确失败，不静默降级为复制旧实现。

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

- 扫描插件 `rules/*.md`，生成 `.agents/rules/<rule>.md` thin-index；不扫描 `references/`。
- 扫描插件 `skills/*/SKILL.md`，生成 `.agents/skills/<skill>/SKILL.md` thin-index。
- 可通过 `-ExcludeRule` 和 `-ExcludeSkill` 排除不需要 shallow 入口的项目，例如 bootstrap/init skill。
- 不扫描、不复制 `templates/`、`config/`、`scripts/`、`hooks/` 等目录。
- 输出 `generated`、`skipped`、`conflict`、`missing` 等结果。

thin-index 必须明确：

- 本文件只是 thin-index。
- 真实插件文件路径。
- Agent 读取本文件后必须继续读取目标插件文件。
- 可提醒读取 `.agents/config/` 和 `.mcp.json`，但不得保存连接信息。

## 被忽略文件贡献

`.agents/.git/info/exclude` 默认隐藏本地生成层，以保持 Git 列表干净。若实际使用中修正了通用脚本、通用规则或通用 skill，可在 `.agents` 仓库内显式贡献：

```powershell
git status --ignored -s scripts/<script-name>.ps1
git diff -- scripts/<script-name>.ps1
git add -f scripts/<script-name>.ps1
git commit -m "fix(scripts): 修正 xxx 脚本"
git push
```

也可以用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stage-ignored-agent-file.ps1 -Path scripts/<script-name>.ps1
```

只允许贡献通用能力。目标项目私有脚本、profile、`project-env.json`、服务器地址、账号、namespace、远程路径等不得提交到能力包仓库。

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

v0.1.3 要求插件 `.agents-plugin/plugin.json` 保留 `version` 字段，并推荐已部署业务工程使用统一更新入口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun
```

更新脚本采用半自动稳妥策略：

- `Check` 只检查，不拉取、不写入。
- `DryRun` 拉取能力包并输出更新计划。
- `Write` 只写入 thin-index、生成层 ignore 和可机械合并的缺失 config 项；兼容入口只检查，不自动写入。
- `.agents/config/` 永远不直接覆盖；模板新增字段只追加待确认项，已存在字段以目标项目当前值为准。
- 疑似废弃字段只报告，不删除；字段语义变化只报告 `config-review-required`。

以下能力留到 v0.2 设计：

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
