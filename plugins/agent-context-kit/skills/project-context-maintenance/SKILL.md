---
name: project-context-maintenance
description: Use when initializing or maintaining agent project context such as AGENTS.md, project rules, project memory, project config, plugin thin-index files, or deciding where durable project knowledge should be recorded. 用于初始化或维护项目规则、项目记忆、AGENTS 入口、项目配置和插件 thin-index。
---

# 项目上下文维护

## 用途

维护 Agent 面向项目的上下文，让后续 Agent 能快速接手，同时避免读取过期、重复或敏感信息。

当需要创建、更新、压缩或判断以下内容归属时，使用本 skill：

- `AGENTS.md`
- `.agents/rules/`
- `.agents/memory/project-memory.md`
- `.agents/config/`
- `.agents/plugins/`
- `.agents/skills/` thin-index files

## 开始前必读

如果任务是安装 `.agents`、更新 `.agents`、维护能力包或处理 `update-agents.ps1` 输出，先读取根 runbook：

- `.agents/docs/update-agents.md`

该 runbook 是安装和更新流程的事实来源。不要在本 skill 内自行发明安装、更新、clone 收敛或 dry-run/write 判读流程。

编辑上下文文件前：

1. 读取当前 `AGENTS.md`。
2. 运行 `.agents/scripts/check-agent-entrypoints.ps1` 检查兼容入口；若失败，只报告可选兼容入口状态，不自动修复。
3. 如存在项目记忆，读取当前 `.agents/memory/project-memory.md`。
4. 如存在规则索引或相关规则文件，读取对应文件。
5. 判断目标工程的 `contextMode`，再决定如何生成或维护上下文。
6. 判断待写入内容是项目特定、跨项目可复用，还是临时过程。

## 兼容入口

兼容入口清单默认包括：

| 入口 | 目标 |
|---|---|
| `CLAUDE.md` | `AGENTS.md` |
| `CODEBUDDY.md` | `AGENTS.md` |

规则：

- `AGENTS.md` 是唯一事实文件。
- `CLAUDE.md`、`CODEBUDDY.md` 是可选兼容入口；如存在，只允许是指向 `AGENTS.md` 的 symlink。
- 不要求模型理解 symlink；维护前只要求运行检查脚本并按固定结果处理。
- 检查脚本固定输出 `ok`、`missing`、`not-symlink`、`wrong-target`。
- 若入口为 `missing`、`not-symlink` 或 `wrong-target`，只报告状态，不阻塞上下文维护；只有用户明确要求兼容入口时，才运行修复脚本创建 symlink。
- Windows 手工修复可在管理员 cmd 中使用 `mklink CLAUDE.md AGENTS.md` 和 `mklink CODEBUDDY.md AGENTS.md`；启用开发者模式后部分环境可免管理员。
- 禁止把 `AGENTS.md` 复制成 `CLAUDE.md` 或 `CODEBUDDY.md`，也禁止在兼容入口维护第二份规则。
- 修改规则时只允许改 `AGENTS.md`、`.agents/rules/`、`.agents/memory/`、`.agents/config/`；禁止把规则写入 `CLAUDE.md` 或 `CODEBUDDY.md`。

## 上下文模式

初始化或大幅维护项目上下文前，必须先判断工程成熟度和上下文置信度，并记录到 `.agents/config/project_context_profile.md` 或等价位置。

### 机械判定顺序

按以下顺序判定，命中即停止，不要自由发挥：

1. 用户明确说“后续按需导出文件”“需求处理中再导出”“刚新建”“空工程”“只有零散文件”“需求处理工作区”时，直接设为 `intent-first-on-demand-export`。
2. 已存在 `.agents/config/project_context_profile.md` 且写明 `contextMode` 时，沿用该值；除非用户明确更新，否则不要改。
3. 目标工程缺少可识别构建/运行入口，且业务代码文件很少或分散时，设为 `intent-first-on-demand-export`。
4. 只有在本地同时具备较完整源码目录、构建或运行配置、项目文档或用户确认“本地就是主要工程”时，才设为 `codebase-complete`。
5. 如果无法判断，默认使用 `intent-first-on-demand-export`。保守默认比错误总结架构更安全。

| contextMode | 适用条件 | 处理原则 |
|---|---|---|
| `codebase-complete` | 目标工程已有较完整代码、目录、构建配置或用户确认本地代码代表主要工程事实。 | 可以从已验证代码、配置和文档归纳架构事实；仍需区分事实、推断和待确认项。 |
| `intent-first-on-demand-export` | 目标工程刚新建、代码很少或零散，或用户明确说明后续会按需从服务器导出文件。 | 以用户说明的项目用途和工作流为主；本地少量文件只记录为“当前本地已有文件”，不得推导完整架构、主模块或长期规则。 |

若用户明确说明“后续按需导出文件”“需求处理中再导出”“当前只是需求处理工作区”等意图，即使目录中已有少量代码文件，也优先采用 `intent-first-on-demand-export`。

对 `intent-first-on-demand-export` 工程：

- `AGENTS.md` 保持轻量，只写项目定位、上下文状态、按需导出工作流、必读入口和安全边界。
- 架构段落必须明确“暂无可验证完整架构；不得基于零散文件推断整体工程”。
- 本地已有文件最多列为“当前已导出/已存在文件”，不得写“系统由这些文件组成”“核心模块是这些文件”“调用链如下”等结论。
- `.agents/rules/project.md` 记录稳定业务定位、按需导出流程和禁止推断规则。
- `.agents/memory/project-memory.md` 记录当前状态、已导出文件范围和仍有效决策，不把零散文件扩写成架构说明。
- `.agents/config/project_context_profile.md` 保存非敏感语义配置，如项目用途、上下文模式、代码来源、本地文件完整性和禁止项。

### 最小输出模板

低上下文或不确定时，按以下最小输出落地，不要扩写：

- 项目定位：使用用户给出的业务用途。
- 上下文状态：`contextMode = intent-first-on-demand-export`；本地代码不代表全量工程事实。
- 架构：暂无可验证完整架构；不得基于零散文件推断整体工程。
- 工作流：每个需求先确认目标页面、类、JS、CSP 或业务对象，再导出相关文件处理。
- 安全边界：不把服务器、账号、密码、token、namespace、远程路径写入 AGENTS、rules、memory 或插件。

## 内容归属

| 目标位置 | 写入条件 |
|---|---|
| `AGENTS.md` | 启动指令、必读顺序、跨 Agent 硬约束、rules/skills 顶层路由。 |
| `.agents/rules/*.md` | 稳定项目规则、架构事实、命名约定、工作流或后续任务必须遵守的约束。 |
| `.agents/memory/project-memory.md` | 当前项目状态、近期长期有效变化、长期经验、仍有效决策和后续建议。 |
| `.agents/config/*.md` | 项目差异配置、本地适配、路径、能力和不应成为插件默认值的选择。 |
| `.agents/plugins/<plugin>/` | 可跨项目复用的流程、模板、脚本或规则，不包含源项目事实。 |
| `.agents/skills/<skill>/SKILL.md` | 仅放 thin-index，用于让只发现浅层 skill 目录的 Agent 找到插件真实 skill。 |

## AGENTS.md 初始化/维护

`AGENTS.md` 是 Agent 进入项目的顶层入口，不是完整规则手册、项目记忆或 changelog。

### 应写入 AGENTS.md

- 项目一句话定位：业务域、技术栈、主要模块边界。
- 上下文状态：当前工程是否完整、本地代码是否代表全量事实、是否需要按需导出。
- 新会话启动顺序：先读哪些 memory/rules/config。
- 高频硬约束：跨任务必须遵守、遗漏会造成明显风险的规则。
- 规则路由：不同任务类型应读取哪些 rules 或 skills。
- 插件路由：项目已接入的插件、首次初始化入口、thin-index 入口。
- 外部工具边界：MCP/SFTP/编译/上传等能力的使用原则和安全边界。

### 不应写入 AGENTS.md

- 完整规则全文；应放入 `.agents/rules/`。
- 当前进度、最近变化、待办清单；应放入 `.agents/memory/project-memory.md`。
- 项目差异配置、路径映射、能力矩阵；应放入 `.agents/config/` 或对应规则。
- 长示例、大段代码、完整命令输出。
- 在空壳或按需导出工程中，基于单个或少量零散文件生成的架构结论、模块边界或调用链总结。
- 凭据、token、服务器私有细节，或从 `.mcp.json` 复制的敏感信息。

### 推荐结构

初始化新项目时，优先使用 `templates/AGENTS.template.md`。已有 `AGENTS.md` 则只合并缺失段落，不重写原文件。

建议结构：

1. 项目简介。
2. 上下文状态。
3. 架构或非显然事实。
4. 关键目录。
5. 工具和安全边界。
6. 新会话启动流程。
7. 编码前规则路由。
8. 编码后上下文维护。
9. 已接入插件入口。

### 维护原则

- 保持短：只放入口和最高频约束。
- 保持路由清晰：能链接到 rules/skills 的内容不要复制全文。
- 保持稳定：任务进度只在 memory，AGENTS 只在入口或硬约束变化时更新。
- 合并时保留目标项目已有业务规则，不覆盖用户定制。
- 多 Agent 入口差异较大时，优先在 AGENTS 中放统一入口，再由插件或配置处理差异。

## 禁止写入

- 密钥、token、密码、私有连接信息，或从 `.mcp.json` 复制的 env 值。
- 一次性命令输出、临时排查步骤、短期失败日志。
- 大段代码、完整 SQL、长示例或完整 changelog。
- 可从代码低成本重新发现的信息，除非它是已验证的反复踩坑点。
- 源项目业务模块、路径或服务器细节，不得写入可复用插件。

## 维护流程

1. 按“内容归属”表判断每条信息的目标位置。
2. 优先更新、替换、合并旧内容，不无限追加。
3. 项目记忆应保持在新 Agent 约 2 分钟可读完的长度。
4. 规则文件只保留稳定规范，不写当前进度。
5. 如果内容属于领域插件或专项规则，优先更新对应 owner；memory 只保留入口或摘要。
6. `.agents/config/` 只允许合并，不允许用插件模板或默认值直接覆盖目标项目已有配置。
7. 编辑后检查重复内容、过期矛盾和敏感信息。

## 插件更新流程

已部署业务工程更新 `.agents` 能力包时，优先使用统一更新脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun
```

确认 dry-run 输出后，才使用 `-Mode Write`。更新脚本只负责拉取能力包、检查入口、维护生成层 ignore、重建 plugin thin-index 和合并明确缺失的 config 项；不得自动重写 `AGENTS.md`、`.agents/memory/`、`.agents/rules/project.md` 或项目已有 config 值。

配置合并规则：

- 目标项目已有字段值优先，插件模板不能覆盖。
- 模板新增字段只追加到待确认配置项区块。
- 疑似废弃字段只报告 `config-deprecated-candidate`，不删除。
- 字段语义变化只报告 `config-review-required`，由 Agent 或人工确认后再修改。
- host、账号、密码、token、namespace、远程路径等连接事实仍只能来自 `.mcp.json`，不得写入 config、rules、memory 或插件。

## 初始化流程

初始化项目上下文时：

1. 先判断并记录 `contextMode`；缺少 `.agents/config/project_context_profile.md` 时，参考 `templates/project_context_profile.template.md` 创建。
2. 运行 `.agents/scripts/check-agent-entrypoints.ps1`，只检查 `CLAUDE.md`、`CODEBUDDY.md` 可选兼容入口；不自动创建、复制或修复。
3. 创建或更新 `AGENTS.md`，只放最小启动流程和路由；新建时参考 `templates/AGENTS.template.md`。
   - `codebase-complete`：可写入已验证架构事实。
   - `intent-first-on-demand-export`：必须写明本地代码不代表完整工程，后续按需导出相关文件后再分析和修改。
4. 如缺失 `.agents/rules/project.md`，基于项目规则模板创建。
5. 如缺失 `.agents/memory/project-memory.md`，基于项目记忆模板创建。
6. 使用插件内置脚本生成 plugin thin-index：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/agent-context-kit/scripts/generate-plugin-thin-index.ps1 -PluginPath .agents/plugins/agent-context-kit -ProjectRoot . -Mode DryRun
   ```
7. 检查冲突后，仅在用户要求初始化或更新索引时，用 `-Mode Write` 重新执行。
8. 项目特定值放入 `.agents/config/`，不要写成插件默认值。
9. 确认 `.agents/.git/info/exclude` 包含生成层忽略规则，至少包括：
   - `/config/`
   - `/memory/`
   - `/rules/`
   - `/skills/`
   - `/scripts/`

插件内 `scripts/generate-plugin-thin-index.ps1` 是稳定调用入口，只 wrapper 到根 `.agents/scripts/generate-plugin-thin-index.ps1`。修改 thin-index 行为时只改根脚本，不复制插件脚本实现。

## 插件初始化闭环

当用户要求初始化、重新部署或接入 `.agents/plugins/<plugin>/` 能力时，不要只生成 thin-index。必须按对应插件的真实 init skill 完整执行并验收；若插件提供 bootstrap/init skill，先读取该 skill，再执行落地。

常见 init skill：

- `project-context-maintenance`：维护 `AGENTS.md`、项目 profile、rules、memory 和插件 thin-index。
- `coding-iris-init`：维护 IRIS 编码 profile、编码转换脚本、IRIS rules/skills thin-index。
- `i18n-project-init`：维护 i18n profile、i18n rules/skills thin-index。

完整闭环必须包含：

1. 读取目标工程 `AGENTS.md` 和对应插件真实 init skill。
2. 生成或更新 `.agents/config/*_profile.md`；profile 只保存非敏感项目差异，不保存 host、账号、密码、token、namespace 或远程路径；已有 profile 必须合并，不得覆盖。
3. 生成 `.agents/rules/` 和 `.agents/skills/` thin-index；thin-index 必须指向 `.agents/plugins/<plugin>/` 内真实文件。
4. 如插件需要本地脚本，复制到 `.agents/scripts/`；目标存在且内容不同时，默认报告 conflict，不覆盖。
5. 更新 `AGENTS.md` 的插件能力路由；入口只写启动顺序、profile/rules/skills 路由和硬约束，不复制完整规则。
6. 确认 `.agents/.git/info/exclude` 忽略生成层：`/config/`、`/memory/`、`/rules/`、`/skills/`、`/scripts/`。
7. 扫描长期上下文，确认没有具体服务器地址、账号、密码、token、namespace 或远程路径。
8. 验证 `.agents` Git 状态；生成层应被忽略，能力包源码改动必须明确区分。

验收时至少检查：

- `AGENTS.md`
- `.agents/config/project_context_profile.md`
- 插件要求的 `.agents/config/*_profile.md`
- `.agents/rules/<plugin-index>.md` 或等价索引
- `.agents/skills/<plugin-skill>/SKILL.md` 或等价 skill thin-index
- 插件要求的 `.agents/scripts/*`
- `.agents/.git/info/exclude`

## Git 忽略边界

目标工程应采用双层忽略：

- 业务工程 `.gitignore` 忽略 `.agents/`，避免把能力包提交进业务仓库。
- `.agents/.git/info/exclude` 忽略本地生成层，避免 VS Code 的 `.agents` Git 仓库显示 profile、memory、thin-index 和本地辅助脚本。

生成层忽略规则只写入 `.agents/.git/info/exclude`，不要写入 `.agents/.gitignore`。`info/exclude` 是本机 Git 私有文件，不会进入 `imedical.agents` 能力包仓库；已被 `.agents` 仓库追踪的文件仍会正常更新和显示修改。

### 被忽略文件贡献流程

如果被忽略的 `scripts/`、`rules/` 或 `skills/` 文件在实际使用中修正了：

1. 先判断是否是通用能力。目标项目私有脚本、profile、`project-env.json`、服务器地址、账号、namespace、远程路径等禁止提交。
2. 在 `.agents/` 仓库内查看改动：`git status --ignored -s <path>` 和 `git diff -- <path>`。
3. 通用修正使用 `git add -f <path>` 或 `scripts/stage-ignored-agent-file.ps1 -Path <path>` 暂存。
4. 正常 `git commit` 和 `git push` 能力包仓库。
5. 不要为了贡献单个文件而移除 `.agents/.git/info/exclude` 中的生成层忽略规则。

## Thin-Index 格式

浅层 skill 索引必须：

- 只保留 frontmatter 和简短指针。
- 明确要求 Agent 继续读取插件内真实 `SKILL.md`。
- 不复制项目配置或 MCP 连接信息。

## 审查清单

完成前检查：

- 每类事实仍只有一个清晰事实来源。
- 已明确 `contextMode`，且空壳/按需导出工程没有基于零散文件生成架构结论。
- memory 只包含当前状态和长期经验，不复制完整规则。
- rules 只包含长期约束，不记录任务进度。
- 插件内容可复用，且没有源项目硬编码。
- 插件初始化不是只生成 thin-index；已完成 profile、rules/skills、scripts、AGENTS 路由、忽略规则、敏感信息扫描和 Git 状态验证。
- `.agents/config/` 已保留项目已有值；模板新增字段只作为待确认项合并。
- `.agents/.git/info/exclude` 已包含生成层忽略规则。
- 兼容入口缺失或异常只作为可选提示；`CLAUDE.md`、`CODEBUDDY.md` 未维护第二份规则。
- 没有新增密钥或私有连接信息。
## 部署经验沉淀

当任务产生可复用的部署、编译、上传或排障经验时，按以下边界维护上下文：

- 跨项目通用流程、风险和验证标准写入对应领域插件；不得带入源项目的服务器、账号、namespace、远端绝对路径、业务页面清单或私有类名前缀。
- 项目特定但长期有效的规则写入 `.agents/rules/`；近期状态、已验证结论和仍有效决策写入 `.agents/memory/project-memory.md`。
- 一次性命令输出、短期失败日志和临时排障过程不写入 memory；只保留“以后会反复踩坑”的根因和验证标准。
- 对部署成功的描述必须包含可复核标准，例如内层 status、生成物名称、关键参数或文件映射；不能只记录“执行成功”。
- 若发现上下文或插件规则存在偏差，先修正 owner 插件，再在项目规则/记忆中保留项目差异摘要，避免同一事实分散成多份冲突来源。
