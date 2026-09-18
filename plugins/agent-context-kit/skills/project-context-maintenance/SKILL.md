---
name: project-context-maintenance
description: Initialize, maintain, or optimize project context including AGENTS.md, rules, memory, profiles and skill routes. Use for context setup, factual updates, duplicate or stale guidance, and reading-cost reviews; ordinary coding does not trigger routine context maintenance. 用于初始化、维护及日常优化项目上下文。
---

# 项目上下文维护

## 用途

维护有利于目标工程编程的上下文：让后续 Agent 更快定位实现、沿用正确模式、执行有效验证并保持工程边界。精简服务于编程体验，不以最短文本、固定文件数或统一模板为目标。

当需要创建、更新、压缩或判断以下内容归属时，使用本 skill：

- `AGENTS.md`
- `.agents/rules/`
- `.agents/memory/project-memory.md`
- `.agents/config/`
- `.agents/plugins/`
- `.agents/skills/` thin-index files

## 场景选择

按本次目标选择，不要求依次执行，也不增加必须落盘的模式字段：

| 场景 | 触发与处理 | 条件资料 |
|---|---|---|
| 初始化 | 新建上下文或明确接入插件；判断 contextMode，按证据填充最小入口，保留已有值，完成对应初始化闭环 | [初始化与插件接入](references/initialization.md)；仅选用相关模板 |
| 维护 | 已有事实、配置、入口或约定变化；定点更新 owner 及引用，缺什么补什么 | 下文内容归属和维护流程；仅插件接入/更新时读初始化资料 |
| 日常优化 | 用户要求精简、审查效率，或当前授权维护中已发现重复、过时、歧义；按语义去重、分层和澄清 | [上下文优化](references/context-optimization.md) |

只读审计只交付问题与建议；明确要求优化时可直接在授权范围内重组已有上下文。普通业务修改不例行触发本 skill。维护后无新问题就结束，不自动再次初始化、扫描候选插件、生成报告或创建周期任务。

## 面向项目编程

先从允许读取的源码、配置、README 和用户目标了解项目实际工作方式，按当前维护范围取证，不为补齐表格全仓扫描。识别高频开发任务需要的定位入口、可复用模式、工具命令、验证路径和边界；已在专项文档维护的内容只链接。小工程可集中在短入口，多领域工程按任务拆分，不强制相同目录层级。

初始化建立最小可用开发路线；维护随真实变化校正；日常优化围绕反复搜索、错误路由、过时命令、无效确认或漏检等具体摩擦改善。检查资料是否能支持“定位 → 修改 → 验证 → 交付”，而不只是检查长度；详细方法见 [上下文优化](references/context-optimization.md)。

## 开始前必读

### Workspace Context 路由

开始维护前，先检查 `WorkspaceRoot/.agents/capability.json`：

- 不存在 manifest：使用 `standard`；`CapabilityRoot = ContextRoot = WorkspaceRoot/.agents`，并保持传统单工程流程。
- 存在且 `mode = workspace-overlay`：先解析并验证 manifest，再读取其他上下文。`WorkspaceRoot` 是当前模块控制面，`CapabilityRoot` 是 canonical 能力 Git，`ContextRoot` 是当前模块本地 `.agents`，`SourceRoot` 是允许探索的源码入口，`GitRoot` 是对应真实 Git 仓库根。
- manifest 无效、版本不支持、CapabilityRoot 无 `.git`、SourceRoot/GitRoot 缺失、Junction 或 local 目录类型异常时停止写入，先按 `.agents/docs/workspace-overlay.md` 恢复。

`workspace-overlay` 下的硬边界：

- 只维护 ContextRoot 的 `config/`、`rules/`、`memory/`、`skills/`、`scripts/` 和 `work/`；CapabilityRoot 只读。
- 项目成熟度、上下文置信度、架构和编码事实只能从 manifest 声明的 SourceRoot 归纳；禁止扫描父目录，也禁止扫描 WorkspaceRoot 中未声明的 sibling 模块。
- 文件状态、diff、提交和 hooks 必须映射到声明的 GitRoot；不得从 Junction 或 cwd 猜测 Git 根。
- shared directory 必须是目标精确匹配 CapabilityRoot 的 NTFS Junction；local directory 必须是普通目录。
- 不要求 ContextRoot `.git/info/exclude`，ContextRoot 不得创建 `.git`；仅 `standard` 模式维护 capability Git 的 `info/exclude`。

如果任务是安装 `.agents`、更新 `.agents`、维护能力包或处理 `update-agents.ps1` 输出，先读取根 runbook：

- `.agents/docs/update-agents.md`

该 runbook 是安装和更新流程的事实来源。不要在本 skill 内自行发明安装、更新、clone 收敛或 dry-run/write 判读流程。

编辑上下文文件前：

1. 解析 Workspace Context；Overlay 必须先读 `.agents/capability.json` 并通过验证。
2. 读取当前 `AGENTS.md`。
3. 仅初始化、入口/链接变化或排查发现问题时，运行 ContextRoot 的 `scripts/check-agent-entrypoints.ps1`；兼容入口异常不阻塞其它维护，不自动修复。
4. 如存在项目记忆，读取 ContextRoot 的 `memory/project-memory.md`。
5. 如存在规则索引或相关规则文件，读取对应文件。
6. 从既有配置确认 `contextMode`；初始化、模式缺失或用户明确变更工程定位时才重新判定。
7. 判断待写入内容是项目特定、跨项目可复用，还是临时过程。

## 渐进式读取

- 先读取 `AGENTS.md` 和项目记忆入口，确定维护范围；插件状态影响本次操作时读取 `plugin_profile.md`。已持有且未变化的资料复用，不反复打开。
- 仅当任务涉及安装或更新 `.agents` 时，读取 `.agents/docs/update-agents.md`，不要在本 skill 中重写 runbook。
- 仅当需要维护某个已启用插件时，继续读取该插件真实 init skill、README、templates 或 thin-index 脚本。
- 仅当要编辑项目规则、记忆或配置时，读取对应 `.agents/rules/`、`.agents/memory/` 或 `.agents/config/` 文件；不要为了上下文完整性一次性加载所有插件规则。

## 兼容入口

兼容入口清单默认包括：

| 入口 | 目标 |
|---|---|
| `CLAUDE.md` | `AGENTS.md` |
| `CODEBUDDY.md` | `AGENTS.md` |

规则：

- `AGENTS.md` 是唯一事实文件。
- `CLAUDE.md`、`CODEBUDDY.md` 是可选兼容入口；如存在，只允许是指向 `AGENTS.md` 的 symlink。
- 检查兼容入口时用检查脚本及实际链接目标核对；不得把历史状态当作当前结果。
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
| `codebase-complete` | 目标工程已有较完整代码、目录、构建配置或用户确认本地代码代表主要工程事实。 | 可以从已验证代码、配置和文档归纳架构事实；仍需区分事实、推断和待确认项。写入 config 前必须先探索代码，用已验证值填充，只对确实无法从代码确定的字段标 TODO。 |
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

插件启用状态以 `.agents/config/plugin_profile.md` 为事实来源。插件目录存在只表示 `available`，不表示当前业务项目已启用该插件。

## AGENTS.md 初始化/维护

`AGENTS.md` 是 Agent 进入项目的顶层入口，不是完整规则手册、项目记忆或 changelog。

### 应写入 AGENTS.md

- 项目一句话定位：业务域、技术栈、主要模块边界。
- 上下文状态：当前工程是否完整、本地代码是否代表全量事实、是否需要按需导出。
- 新会话启动顺序：先读哪些 memory/rules/config。
- 高频硬约束：跨任务必须遵守、遗漏会造成明显风险的规则。
- 规则路由：不同任务类型应读取哪些 rules 或 skills。
- 插件路由：项目已接入的插件、首次初始化入口、thin-index 入口。
- 插件状态引用 `plugin_profile.md`，不维护第二份状态清单。
- 外部工具边界：MCP/SFTP/编译/上传等能力的使用原则和安全边界。

### 不应写入 AGENTS.md

- 完整规则全文；应放入 `.agents/rules/`。
- 当前进度、最近变化、待办清单；应放入 `.agents/memory/project-memory.md`。
- 项目差异配置、路径映射、能力矩阵；应放入 `.agents/config/` 或对应规则。
- 长示例、大段代码、完整命令输出。
- 在空壳或按需导出工程中，基于单个或少量零散文件生成的架构结论、模块边界或调用链总结。
- 凭据、token、服务器私有细节，或从 `.mcp.json` 复制的敏感信息。

### 推荐结构

初始化时参考插件根 `templates/AGENTS.template.md`，只保留适用段落并替换占位内容。已有入口按本次授权定点维护；优化可合并、移动和删除重复内容，但须保留约束语义、已有配置值及可达路由，不用模板覆盖用户定制。

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
- 配置表格避免“同左”“同上”等易失效引用；共用值提升到通用配置段落，差异表只保留例外。
- 多仓库共用的非敏感配置集中维护；远端路径、namespace 等连接事实仍只保留在私有连接配置。

## 禁止写入

- 密钥、token、密码、私有连接信息，或从 `.mcp.json` 复制的 env 值。
- 一次性命令输出、临时排查步骤、短期失败日志。
- 大段代码、完整 SQL、长示例或完整 changelog。
- 可从代码低成本重新发现的信息，除非它是已验证的反复踩坑点。
- 源项目业务模块、路径或服务器细节，不得写入可复用插件。

## 维护流程

1. 按“内容归属”表判断每条信息的目标位置。
2. 优先更新、替换、合并旧内容，不无限追加。
3. 项目记忆入口应便于快速接手；领域细节有明显独立读取场景时再拆分，并提供触发条件与链接，不以固定行数为验收目标。
4. 规则文件只保留稳定规范，不写当前进度。
5. 内容属于领域插件或专项规则时先定位 owner；仅在授权范围内更新，memory 只保留入口或摘要。项目维护不自动授权修改 canonical 能力源。
6. 配置保留已有有效值；授权优化可清理确认无语义的模板占位与重复说明，不删除未知配置或用默认值覆盖现值。
7. 编辑后检查重复内容、过期矛盾和敏感信息。

## 初始化与插件接入

仅命中对应场景时读取 [初始化与插件接入](references/initialization.md)，完成所选插件的 profile、索引、脚本、忽略边界与启用状态闭环。能力包更新不等于项目上下文已优化。

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
4. 只有已明确授权对应动作时，才提交或推送能力包仓库。
5. 不要为了贡献单个文件而移除 `.agents/.git/info/exclude` 中的生成层忽略规则。

## Thin-Index 格式

浅层 skill 索引必须：

- 只保留 frontmatter 和简短指针。
- 明确要求 Agent 继续读取插件内真实 `SKILL.md`。
- 不复制项目配置或 MCP 连接信息。

## 审查清单

完成前检查：

- `codebase-complete` 工程：config 中可从代码确定的字段已用探索结果填充，而非全部标 TODO。
- 每类事实仍只有一个清晰事实来源。
- 已明确 `contextMode`，且空壳/按需导出工程没有基于零散文件生成架构结论。
- memory 只包含当前状态和长期经验，不复制完整规则。
- rules 只包含长期约束，不记录任务进度。
- 插件内容可复用，且没有源项目硬编码。
- 仅初始化/接入场景检查完整闭环；维护和优化检查实际改动、约束保留和引用，不重复初始化。
- `.agents/config/` 已保留项目已有值；模板新增字段只作为待确认项合并。
- 涉及 standard 安装或忽略边界变化时检查 `.agents/.git/info/exclude`；Overlay 不创建该文件。
- 兼容入口缺失或异常只作为可选提示；`CLAUDE.md`、`CODEBUDDY.md` 未维护第二份规则。
- 没有新增密钥或私有连接信息。

### Overlay 完成条件

`workspace-overlay` 只有同时满足以下条件才算完成：

- `.agents/capability.json` 可解析，WorkspaceRoot、CapabilityRoot、ContextRoot、SourceRoot、GitRoot 均与实际路径一致。
- 所有 shared Junction 目标精确匹配 CapabilityRoot，所有 local context 目录均为普通目录，ContextRoot 无 `.git`。
- ContextRoot 的 `config/plugin_profile.md` 保留已有值；只有 `enabled` 插件生成 enabled thin-index，`available`/`disabled` 不生成新入口。
- `rules/project.md`、`memory/project-memory.md` 和项目已有 config 未被 updater 覆盖。
- SourceRoot 探索没有越界，ContextRoot 中没有其他模块的规则、记忆、profile 或 thin-index。
- 所有 Git 证据来自声明的 GitRoot；CapabilityRoot Git 状态未被模块上下文刷新改变。
## 部署经验沉淀

当任务产生可复用的部署、编译、上传或排障经验时，按以下边界维护上下文：

- 跨项目通用流程、风险和验证标准写入对应领域插件；不得带入源项目的服务器、账号、namespace、远端绝对路径、业务页面清单或私有类名前缀。
- 项目特定但长期有效的规则写入 `.agents/rules/`；近期状态、已验证结论和仍有效决策写入 `.agents/memory/project-memory.md`。
- 一次性命令输出、短期失败日志和临时排障过程不写入 memory；只保留“以后会反复踩坑”的根因和验证标准。
- 对部署成功的描述必须包含可复核标准，例如内层 status、生成物名称、关键参数或文件映射；不能只记录“执行成功”。
- 若发现上下文或插件规则存在偏差，定位 owner 并在授权范围内修正；未授权的 canonical 变更只报告。项目规则/记忆保留差异摘要，不复制通用规则。

## 知识库入口维护

需要新增或修复知识库路由时，按 [初始化与插件接入](references/initialization.md) 的“知识库简短入口”执行：核对 enabled 状态与本地入口，合并一条自主查询指引，不复制完整索引。

## 条件维护与入口迁移

只在稳定项目事实变化、入口失效、配置变化或用户要求时加载；普通编码不例行维护。已部署工程定点合并 AGENTS 中旧分流和无条件收尾条款，保留全部自定义约束；缺少 guidanceMode 按 auto 读取，不自动写 profile。能力包更新不等于项目入口已迁移。按 docs/update-agents.md 的演进迁移清单处理。
