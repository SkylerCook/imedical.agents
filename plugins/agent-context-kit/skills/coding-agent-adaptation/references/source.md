# 宿主技能目录与项目规则入口依据

WorkBuddy 文档复核日期：2026-11-03，项目级 skills 的用户实测纠正日期：2026-11-04；其它宿主记录沿用 2026-10-23 的核对范围。本文是 `coding-agent-adaptation` 的宿主发现参考；执行流程见 [SKILL.md](../SKILL.md)，命令及迁移见能力包 [runbook](../../../../../docs/coding-agent-adaptation.md)。它不是启用清单，当前脚本也不解析本文件。

## 如何使用

- 先采用本次用户明确的项目目录，其次沿用目标项目已确认的目录配置；缺少这些事实时，再按产品、IDE/CLI/桌面形态、版本及项目设置选对应文档记录。现场已确认目录与文档不同时，保留现场适配，不以另一形态的兼容说明覆盖。技能发现与项目规则加载分别判断；用户级目录不推导为项目级目录。
- **文档确认**表示官方当前声明；**本机历史观察**保留当时样本；**目录复核**只表示文件系统存在；**待确认**不填猜测值。这些证据均不能互相替代，宿主实际加载与任务行为独立验收。
- 未登记、定制版或与现场不符时，由用户说明宿主形态、版本、项目技能目录和项目 MD；允许只确认其中一项，另一项继续留待确认。MD 未知不阻塞已确认技能目录的独立适配，交付时保留规则加载待验项。项目差异留目标工程配置或当前任务，不自动写成通用默认值，也不要求提供个人规则正文。
- 登记不授予写入权限。优先复用已经生效的入口；确认需要新增时仍沿当前流程与用户授权执行，保留普通文件、自定义目录和错误链接。一个宿主有多个可发现目录时，不为凑齐目录而全部创建，避免同名技能冲突。

## 项目级发现机制

以下路径相对目标项目；每项 skills 目录下为 `<技能名>/SKILL.md`。除明确标待确认的项外，表内为**文档确认、当前本机宿主加载待验**，除非后文另有明确样本。未列出上游的全部搜索位置；配置、作用域与优先级以链接原文和现场为准。

| 宿主 / 适用形态 | 已知项目 skills 目录 | 项目规则 MD / 其它规则 | 条件与依据 |
|---|---|---|---|
| Codex | `.agents/skills` | `AGENTS.md`；同层 `AGENTS.override.md` 优先，fallback 名称可配置 | 逐层发现，每层选一个规则文件，不需要创建品牌 MD。[Skills](https://learn.chatgpt.com/docs/build-skills)、[项目指令](https://learn.chatgpt.com/docs/agent-configuration/agents-md) |
| CodeBuddy IDE | `.codebuddy/skills` | 根 `CODEBUDDY.md`；没有该文件时回退根 `AGENTS.md`；另有 `.codebuddy/rules` | 缺少 `CODEBUDDY.md` 本身不证明规则未加载；规则变更后需新会话。[Skills](https://www.codebuddy.ai/docs/ide/Features/Skills)、[Rules](https://www.codebuddy.ai/docs/ide/User-guide/Rules) |
| CodeBuddy Code CLI | `.codebuddy/skills` | `CODEBUDDY.md` / `.codebuddy/CODEBUDDY.md`，兼容 `AGENTS.md` | 官方说明 `CODEBUDDY.md` 优先；不可把 IDE 的 `.mdc` 结构套到 CLI。[Skills](https://www.codebuddy.ai/docs/cli/skills)、[Memory](https://www.codebuddy.ai/docs/cli/memory) |
| Claude Code | `.claude/skills` | `CLAUDE.md` / `.claude/CLAUDE.md`；有条件原生读取 `AGENTS.md` | 原生 AGENTS 支持从 v2.1.277 起，详见下节；不能一律认定必须补 CLAUDE。[Skills](https://code.claude.com/docs/en/skills)、[Memory](https://code.claude.com/docs/en/memory#agentsmd) |
| Qoder IDE | `.qoder/skills` | `AGENTS.md`，另有 `.qoder/rules` | Rules 与 AGENTS 冲突时前者优先；没有创建 `QODER.md` 的依据。[Skills](https://docs.qoder.com/extensions/skills)、[Rules](https://docs.qoder.com/user-guide/rules) |
| Qoder CLI | `.qoder/skills` | 默认 `AGENTS.md`；`context.fileName` 可更改 | 尊重现有文件名配置，不能只按品牌推断。[Skills](https://docs.qoder.com/cli/Skills)、[设置](https://docs.qoder.com/cli/settings-reference) |
| OpenCode | `.agents/skills`、`.opencode/skills`，兼容 `.claude/skills` | `AGENTS.md`；未找到时回退 `CLAUDE.md` | 多处发现要求技能名唯一；AGENTS 与 CLAUDE 不是两个必须同时建立的入口。[Skills](https://opencode.ai/docs/skills/)、[Rules](https://opencode.ai/docs/rules/) |
| Cursor Agent | `.agents/skills`、`.cursor/skills`，兼容 `.claude/skills` / `.codex/skills` | `AGENTS.md`，另有 `.cursor/rules/*.mdc` | 规则不适用于 Cursor Tab；CLI、远程与云端按具体形态核对，不把纯 MD 当 `.mdc`。[Skills](https://cursor.com/help/customization/skills)、[Rules](https://cursor.com/docs/rules) |
| Gemini CLI | `.agents/skills`、`.gemini/skills` | 默认 `GEMINI.md` | `AGENTS.md` 须通过 `context.fileName` 配置；skills 原生通用目录不代表 MD 同样原生。[Skills](https://geminicli.com/docs/cli/creating-skills/)、[上下文文件](https://geminicli.com/docs/cli/gemini-md/) |
| GitHub Copilot CLI / VS Code Chat 等 | `.agents/skills`、`.github/skills`，兼容 `.claude/skills`，须核对所用产品支持情况 | `.github/copilot-instructions.md`；部分功能支持 `AGENTS.md` | 不能推广到全部 IDE/全部功能；CLI 的多 MD 合并见下节。[Skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)、[支持矩阵](https://docs.github.com/en/copilot/reference/custom-instructions-support) |
| WorkBuddy 文档中的代码开发项目机制 | `.codebuddy/skills`（文档声明支持） | `.codebuddy/CODEBUDDY.md`；兼容根 `CODEBUDDY.md`、`AGENTS.md` | 仅作为该机制的接入依据；支持读取不等于所有桌面版、定制版均共用 CodeBuddy 目录，也不证明现有独立目录失效。目标项目已确认的目录优先；多入口去重仍待验。[项目配置](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project) |
| ZGSM / CoStrict VS Code 插件 | `.roo/skills` | 根 `AGENTS.md`，另有 `.roo/rules` 与模式规则 | `zgsm.useAgentRules` 默认开启但可被用户关闭；未新增命名 runtime，需接入时复用显式 Custom 目录。[Skills](https://docs.costrict.ai/en/plugin/product-features/skills)、[Rules](https://docs.costrict.ai/plugin/product-features/rules/) |
| WorkBuddy / WorkBuddyDonghua 桌面项目 skills | `.workbuddy/skills`（两端共用） | 项目规则 MD、记忆目录分别核对 | 2026-11-04 用户实测报告，仅项目级 skills、未提供宿主版本；命名 adapter 沿此映射。此样本不推广到用户级目录、其它配置或所有版本 |
| 未登记定制端 | 沿用用户明确或项目已确认的目录，缺失时待说明 | 待核对项目 MD 与加载条件 | 按目标项目确认，不从产品名或用户级历史目录推导项目路径 |

## MD 的优先、合并与兼容入口

- **Claude Code**：v2.1.277+ 且内建 AGENTS 插件可用时，默认在 cwd/祖先没有 `CLAUDE.md`、`.claude/CLAUDE.md`、`CLAUDE.local.md` 才回退 AGENTS；设置可改变选择。升级后的首次会话、禁用插件及 v2.1.281 以前部分环境有例外。官方说明现有 symlink/import 不会把 AGENTS 重读，但启动 hook 打印会重复。按 [Memory](https://code.claude.com/docs/en/memory#agentsmd) 核对版本和实际加载，不自动改用户设置或清理旧入口。
- **多宿主共用工程**：MD 文件名不隔离宿主。[Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions) 可读取并合并 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`；其完全相同内容去重说明不能推广到其它宿主。Gemini CLI 配置多个上下文文件名也会合并。新增兼容文件前先查已有入口、格式及各宿主读取方式；未确认去重时留待验证，不宣称必然重复或必然安全。
- **本能力包边界**：`CLAUDE.md`、`CODEBUDDY.md` 仍是独立可选入口；需要创建时仅允许指向项目 `AGENTS.md` 的文件 symlink，不复制正文。官方存在的 import 方案不改变本仓约束。本轮不新增创建开关，不因检查器返回 `missing` 就宣称宿主规则缺失，也不自动调用会搬移已有内容的 repair 脚本。具体检查/创建边界见 [更新说明](../../../../../docs/update-agents.md#windows-可选兼容入口)。
- **Git 与 Windows**：symlink 的文件系统状态、Git 索引类型和宿主读取分别验证。[Git 的 `core.symlinks`](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresymlinks) 会影响检出表示；反馈中“新建链接暂存为 100644 正文副本”为用户报告的单次本机样本，不作为所有平台必然行为。已有暂存项可用 `git ls-files -s -- <入口>` 检查，文件 symlink 的索引模式应为 `120000`；不为检测而自动暂存，也不修改 Git 配置。

## 现有执行器与宿主依据的区别

实际行为查 [执行器](../../../../../scripts/sync-runtime-skills.js) 的 `adapters` 与参数校验，不把文档表格当成机器配置。2026-11-04 将 `WorkBuddyDonghua` 的项目 skills 默认入口修正为 `.workbuddy/skills`，CLI 参数和显式目录覆盖能力保持。

- 原生已能发现通用目录时直接复用，不补额外目录。需要链接时先比对目标版本的项目发现路径与脚本实际目标；`Check` 只证明目录状态，不证明 skills 调用或项目 MD 加载。
- **WorkBuddy 分形态选目录**：`WorkBuddy` 与 `WorkBuddyDonghua` 命名 adapter 均使用 `.workbuddy/skills`，后执行者复用已有链接。该共用关系仅适用于项目 skills；CodeBuddy 的 `.codebuddy/skills` 独立处理。确认使用上表官方代码项目机制且目标目录不同的工程，沿已有 `--skills-dir` 显式覆盖能力接入。
- 旧 `.workbuddydonghua/skills` 不自动移动或删除；已部署工程按[更新说明](../../../../../docs/update-agents.md#workbuddydonghua-项目-skills-目录纠正)核对配置和自定义内容。未知宿主继续确认；用户级同名目录或成功建链不证明项目加载。目录 Check、宿主发现、规则加载和实际调用分别验收。

## 本机既有探索的脱敏摘要

来源为用户提供的 `agent-config` 中 `skills/README.md`、`skills/skills-sync/scripts/check-alignment.ps1`，以及 `skills/agent-rules-sync/references/` 下的 `endpoint-layouts.md`、`endpoint-best-practices.md`、`local/agent-rules-map.md`；观察主要在 2026-09-23～26。这些名称只供来源追溯，不要求使用者具备个人配置仓。只提取通用目录、格式及证据边界，不收录个人规则正文、身份、业务事实、绝对机器路径或分发内容。本节是**单台 Windows 机器的历史观察**，不是新机默认清单或运行依赖。

以下 `~/` 表示当时用户目录，**不是目标工程根**。2026-10-23 只读复核表中技能目录、Codex/Claude 用户规则文件与 CodeBuddy rules 目录仍存在；未重新启动各宿主或验证完整注入。

| 宿主 / 历史样本形态 | 已探索的用户级 skills | 已探索的用户级规则 | 可复用结论与限制 |
|---|---|---|---|
| Codex 桌面端 | `~/.codex/skills` | `~/.codex/AGENTS.md` | 原记录有加载样本；这与项目 `.agents/skills`、项目 AGENTS 分层处理，尊重实际 CODEX_HOME |
| Claude Code CLI | `~/.claude/skills` | `~/.claude/CLAUDE.md` | 技能目录曾为空，目录存在不等于发现过技能；用户规则与项目规则分开 |
| CodeBuddy 桌面 / IDE 插件 | `~/.codebuddy/skills` | `~/.codebuddy/rules/*.mdc` | 历史记录中桌面、VS Code、JetBrains 的 rules 共用物理目录；skills 跨客户端共用有未实证项，不能从 rules 推导 |
| WorkBuddy 桌面（历史 5.5.6 样本） | `~/.workbuddy/skills` | 用户级 `MEMORY.md` 及 `SOUL.md` / `USER.md` / `IDENTITY.md` 四文件体系 | 有历史实测；不是代码项目 MD 映射，也不据用户记忆目录创建项目 `.workbuddy` |
| WorkBuddyDonghua 桌面（历史 5.2.6 样本） | `~/.workbuddydonghua/skills` | 同属用户级四文件体系 | 仅对应当时用户级样本；项目 skills 按上表后续实测报告，项目 MD 仍单独核对 |
| Copilot JetBrains / Android Studio | `~/.copilot/intellij-skills` | `~/.copilot/instructions/*.instructions.md` | 历史目录与 SKILL.md 样本；不能套为 VS Code 或项目路径 |
| Copilot VS Code | 历史未确认独立 skills 目录 | 用户 profile 的 `prompts/*.instructions.md` | 旧“无 skills”盘点不代表当前功能；当前能力按上表官方支持矩阵核对 |
| ZGSM / CoStrict 插件 | `~/.roo/skills`（历史后续有部署记录） | `~/.roo/rules/*.md` | 后续记录与旧“未确认 skills”盘点分开；本轮只复核技能目录存在，当前项目机制见上表，不新增命名 runtime 或项目入口 |

另有能力包既有维护记录：Windows CodeBuddy 项目 Skills 页面曾获用户确认一个链接发现样本。原记录未给出精确宿主版本和所有技能调用证据；保留该层级，不扩为所有宿主、本轮升级或项目规则加载通过。

维护本文件时更新受影响行的依据、条件与日期；来源冲突保留产品/版本与观察范围。没有可靠新证据时继续标待确认，由用户补充，不把历史猜测提升成默认映射。
