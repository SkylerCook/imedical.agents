# Agent Context Kit

v0.4.0 新增通用 `task-handoff`：按需启用后，在关键节点维护项目 `docs/handoff/<首次时间戳>-<需求ID>/handoff.md`；明确交接保存历史快照，新 Agent 核实现场后沿用范围内授权继续。无编号使用 `00000`，默认本机保存、不入 Git；跨会话直接接手，用户负责停止旧写入者。标准 Markdown 可独立阅读，暂不接入 Obsidian。

工具 `scripts/task-handoff.js` 提供 init/list/inspect/checkpoint/snapshot/validate；机器现场与正文摘要分开保存，检查源码、index 和证据变化，不产生业务通过或授权结论。入口见 [task-handoff](skills/task-handoff/SKILL.md)，命令与恢复边界见其 references。正常更新后刷新 enabled 插件薄索引即可显式调用；自然语言发现路由通过初始化/授权维护定点加入项目 AGENTS，普通更新不覆盖旧入口。既有交接、个人 handoff 和正式 run 不迁移。

项目上下文支持初始化、事实维护与日常优化，按目标选择流程。contextMode 仅在初始化、模式缺失或用户明确变更工程定位时判定；维护与优化沿用已有模式。入口去重、领域记忆分层和旧快照标记保留用户约束；普通维护不自动扫描或启用插件。主入口见 `skills/project-context-maintenance/SKILL.md`，初始化/优化细节按其中 references 条件读取。已部署项目只有在授权维护时定点调整，能力包更新不覆盖业务上下文。

技能归属迁移（0.3.2）：`coding-agent-adaptation` 由本插件承接，执行器仍在根 scripts。项目 `.agents/skills/coding-agent-adaptation/SKILL.md` 路径保持不变，由插件薄索引提供。旧版原文仅在历史内容哈希匹配时转换，自定义内容保留并报告冲突。迁移说明见 `docs/skill-plugin-migration.md`（能力包根）。

v0.3.1 修复实测迁移：辅助模式缺省不落盘，显式配置不误报废弃；迁移脚本报告并补齐缺失的执行辅助路由，保留自定义内容、BOM 与换行，重复执行无变更。

`agent-context-kit` 面向实际编程体验维护上下文：帮助定位实现、沿用项目模式、找到有效验证路径，减少无关读取与无效确认。资料长短和分层服从项目任务，不追求统一模板或最少行数。

## 内容

- `skills/project-context-maintenance/`：初始化和维护项目上下文的主流程。
- `skills/task-handoff/`：需求持久交接与同机同工作区跨会话接续。
- `scripts/generate-plugin-thin-index.ps1`：thin-index 生成 wrapper，实际委托根 `scripts/generate-plugin-thin-index.ps1`。
- `templates/agent-run-plan.json` / `agent-run-manifest.json`：通用 schema 2.0 任务图输入和运行投影模板；`taskKind` 将业务需求与框架维护分流到互斥生命周期，feedback 适用性由任务类型派生。
- `scripts/validate-agent-run.ps1`：schema 2.0 时薄调用根 `scripts/agent-orchestrator.js validate --final`；schema 1.0–1.2 继续执行历史只读校验，不迁移旧产物。
- `templates/`：`AGENTS.md` 完整模板和片段、运行 manifest、项目规则、项目记忆、项目上下文配置的初始化模板。

## 上下文模式

初始化目标工程前先判断 `contextMode`：

- `codebase-complete`：本地已有较完整代码、目录、构建配置或用户确认本地代码代表主要工程事实，可从已验证代码归纳架构。
- `intent-first-on-demand-export`：工程刚新建、代码很少或零散，或用户明确说明后续按需从服务器导出文件；AGENTS.md 只写项目定位、上下文状态和按需导出流程，不围绕少量文件推断完整架构。

判定规则采用保守默认：用户明确说按需导出时直接选 `intent-first-on-demand-export`；无法证明本地代码代表完整工程时，也选 `intent-first-on-demand-export`。

推荐用 `templates/project_context_profile.template.md` 初始化 `.agents/config/project_context_profile.md`，保存项目用途、上下文模式、代码来源和本地文件完整性等非敏感语义配置。

## 安装模式

支持两种 Workspace Context：

- `standard`：`WorkspaceRoot/.agents` 同时作为 `CapabilityRoot` 与 `ContextRoot`，保持传统独立 Git 部署。
- `workspace-overlay`：`WorkspaceRoot/.agents/capability.json` 声明唯一 `CapabilityRoot`、模块本地 `ContextRoot`、受限 `SourceRoot` 和真实 `GitRoot`。共享能力目录使用 Junction，本地 config/rules/memory/thin-index 使用普通目录。

Overlay 初始化和维护必须先验证 manifest、shared Junction 与 local directory；默认修改范围为 SourceRoot，允许按当前需求只读调查已声明 GitRoot 或项目注册表明确映射的相关仓库。读取不扩大写入权限，也不通过扫描父目录猜测路径；具体边界及旧项目入口迁移见能力包根 `docs/workspace-overlay.md`。模块刷新不 fetch/pull CapabilityRoot，也不要求 ContextRoot 存在 `.git`。

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

阶段化或多智能体运行完成后，可执行只读验收：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/agent-context-kit/scripts/validate-agent-run.ps1 `
  -RunDirectory docs/agent-reports/{ticket-or-topic}
```

schema 2.0 的运行时命令由 `.agents/scripts/agent-orchestrator.js` 提供。该脚本只生成/确认 adapter actions，不直接调用 Codex 或其它产品 API。`business-demand` 使用 `implementing -> locally-verified -> acceptance-pending -> accepted`；`framework-maintenance` 使用 `maintaining -> locally-verified -> maintenance-complete`。运行时拒绝框架维护调用需求验收或 feedback transition。

## 安全约束

- 不把 `.mcp.json` 中的密钥复制到 rules、memory、templates 或插件文件。
- 不在插件中硬编码源项目路径、服务器地址、namespace 或模块清单。
- 项目记忆应足够短，便于快速交接；长期规则应放入 rules 文件。
## 部署经验维护

- 可跨项目复用的部署流程、排障根因和验证标准，应沉淀到对应领域插件。
- 项目私有差异只写入目标项目 `.agents/rules/`、`.agents/memory/` 或 `.agents/config/`，并使用非敏感占位。
- 不记录一次性命令日志；只记录长期会影响后续任务的规则、根因和可复核验证标准。
- 若插件规则与实际结果冲突，先修正插件偏差，再更新项目侧摘要，保持单一事实来源。

## 按需辅助与收尾

遵循 agents/_shared/execution-guidance.md（源仓根；部署态为 .agents/agents/_shared/）。guidanceMode 默认 auto，可选 concise/assisted；辅助程度不改变授权、编码及领域契约。方法允许合并或重排，IRIS 编码共用 iris_coding_general 的风险分流。业务验收后按信号加载 feedback，无信号不例行报告。现有工程按 docs/update-agents.md 定点合并项目入口，普通能力包更新不重写用户 AGENTS/profile。

知识库入口：初始化或授权维护时，为已启用 coding-iris-plugin 的工程在 AGENTS.md 合并一条自主查询指引；具体条件见 project-context-maintenance 的 initialization.md。完整索引随能力包更新，普通更新不覆盖工程入口。
