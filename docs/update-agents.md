# .agents 安装与更新 Runbook

本文是给大模型 Agent 执行的操作手册。目标是在业务项目中安装或更新 `.agents` 能力包，尽量减少人工参与。

本文件必须按步骤执行。不要凭经验改流程。不要覆盖业务项目已有上下文。

## 使用前提

- 当前目录必须是业务项目根目录。
- Git 必须是 `2.25.0` 或更新版本；`install-agents.ps1` 和 `update-agents.ps1` 使用 `git sparse-checkout` 子命令，不兼容 Git 2.21.0。
- `AGENTS.md` 是工程级唯一主入口，但缺失时不阻塞 `.agents` 首次安装；安装后通过 `project-context-maintenance` 补齐或维护。`CLAUDE.md`、`CODEBUDDY.md` 只是可选兼容 symlink。
- 所有命令使用 PowerShell。
- `.agents/config/` 只允许合并，不允许覆盖已有值。
- `.agents/config/plugin_profile.md` 是插件启用状态事实来源；插件目录存在只表示 `available`，不表示已启用。
- `.mcp.json` 是连接事实来源。不要把 host、账号、密码、token、namespace 或远程路径写入 `AGENTS.md`、rules、memory、config 或插件。
- 如果输出中出现停止条件，先停止并向用户汇报，不要继续执行破坏性操作。

## Agent 执行原则

1. 先判断状态，再选择安装或更新流程。
2. 默认先 `DryRun`，确认摘要后再 `Write`。
3. 日常只看摘要；需要排障时再加 `-Detailed`。
4. 普通提示不要打断用户。只有停止条件需要用户确认。
5. 不依赖特定模型或工具的 `@文件` 语法。只要能读取本文件，就按本文件执行。

`Check` 是更新器的只读验收模式。调用插件配置迁移时，更新器会把 `Check` 映射为迁移契约中的 `DryRun`；插件迁移脚本仍只需支持 `DryRun` 和 `Write`。

## 状态判定

在业务项目根目录检查：

```powershell
Test-Path .agents
Test-Path .agents/.git
Test-Path .agents/scripts/install-agents.ps1
Test-Path .agents/scripts/update-agents.ps1
```

按以下规则选择流程：

| 状态 | 处理 |
|---|---|
| `.agents/` 不存在 | 执行“首次安装”。 |
| `.agents/.git` 存在 | 执行“更新已安装 .agents”。 |
| `.agents/` 存在但 `.agents/.git` 不存在 | 停止。报告“非标准 .agents 目录”，请用户确认是否备份或删除后重新安装。 |
| 用户已经手工 `git clone` 到 `.agents/` | 视为 `.agents/.git` 存在，执行“手工 clone 后收敛”。 |
| `.agents/` 是 full clone，包含 README、LICENSE、memory 或 scripts/tests | 执行安装脚本或更新脚本刷新 sparse checkout。 |

## 首次安装

默认使用网络安装：

```powershell
iwr -UseBasicParsing https://gitee.com/skyler-cook/imedical.agents/raw/master/scripts/install-agents.ps1 | iex
```

安装后继续执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun
```

首次安装默认只处理 `agent-context-kit`。`coding-iris-plugin`、`i18n-iris-plugin` 等插件代码会随 `.agents/plugins/` 拉取，但状态为 `available` 时不会合并配置或生成 thin-index。

如果摘要没有停止条件，继续执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write
```

## 安装后的上下文维护

安装或更新 `.agents` 成功后，不要直接启用领域插件。先引导用户或用户当前使用的大模型执行项目上下文维护：

```text
/project-context-maintenance
```

如果当前 Agent 工具不支持 slash command，则直接读取并执行真实 skill：

```text
.agents/plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md
```

该步骤负责维护 `AGENTS.md`、`.agents/config/project_context_profile.md`、`.agents/config/plugin_profile.md`、`.agents/rules/` 和 `.agents/memory/project-memory.md`。上下文维护完成后，再根据项目需要选择插件。选择插件时必须先读取 `.agents/plugins/<plugin>/.agents-plugin/plugin.json`：

- `initSkill` 指向该插件首次接入必须读取的真实初始化 skill。
- `dependencies`、`dependsOn` 或 `depends_on` 是依赖插件列表。
- 若依赖插件尚未在 `plugin_profile.md` 中标记为 `enabled`，先初始化依赖插件；依赖插件验收并写入 `enabled` 后，再初始化目标插件。
- 插件初始化闭环验收通过后，使用 `.agents/scripts/update-plugin-profile.ps1 -ProjectRoot . -Plugin <plugin-name> -Status enabled` 机械维护状态。

脚本不会自动把依赖插件标记为 `enabled`。`enabled` 表示该插件已经完成项目上下文、配置、thin-index、脚本和入口路由的初始化闭环，不只是插件目录已存在。

## 手工 clone 后收敛

有些用户习惯先手工克隆仓库：

```powershell
git clone https://gitee.com/skyler-cook/imedical.agents.git .agents
```

克隆后不要手工移动文件。直接运行安装脚本收敛 sparse checkout、ignore 和入口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/install-agents.ps1
```

然后运行 dry-run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun
```

如果摘要没有停止条件，继续执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write
```

## 更新已安装 .agents

先运行 dry-run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun
```

如果摘要没有停止条件，自动继续运行 write：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write
```

如果需要查看明细，运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun -Detailed
```

## 输出判读

以下状态通常正常，不需要用户参与：

| 状态 | 含义 |
|---|---|
| `agents-updated` | `.agents` 已完成 fetch、pull 和 sparse checkout 刷新。 |
| `exclude-ok` | `.agents/.git/info/exclude` 已包含生成层忽略规则。 |
| `entrypoint-ok` | `CLAUDE.md`、`CODEBUDDY.md` 等可选兼容入口正常。 |
| `entrypoint-missing` / `entrypoint-not-symlink` / `entrypoint-wrong-target` | 可选兼容入口缺失或异常；不阻塞安装/更新，脚本不会自动修复或复制。 |
| `git-hooks-not-enabled` | `.agents/hooks/pre-commit` 和安装脚本已可用，但业务项目尚未显式启用 Git hook；不会自动修改 `core.hooksPath`。 |
| `git-hooks-enabled` | 业务项目已显式将 `core.hooksPath` 指向 `.agents/hooks`。 |
| `git-hooks-unavailable` | 当前 `.agents` 中缺少 hook 模板或安装脚本；先更新 `.agents` 能力包。 |
| `plugin-found` | 已发现插件。 |
| `plugin-available` | 插件代码存在但未启用；只展示能力，不合并配置、不生成 thin-index。 |
| `plugin-init-required` | 用户显式选择了未启用插件；停止并读取真实 init skill。 |
| `plugin-selected` | 本次通过 `-Plugin` 显式选择处理的插件。 |
| `plugin-disabled` | 插件被项目显式禁用；默认跳过。 |
| `plugin-profile-written` | 已写入或刷新 `.agents/config/plugin_profile.md`。 |
| `generated` | dry-run 发现将生成 thin-index，或 write 已生成。 |
| `unchanged` | 生成物内容已是最新，不需要写入。 |
| `removed` | write 已清理 stale thin-index；清理阶段扫描所有指向 `.agents/plugins/*/rules/*.md` 的 rule thin-index，不受当前 `PluginPath` 限制。 |
|
| `vendor-thin-index-generated` | vendor thin-index 已生成或 dry-run 报告将生成。 |
| `vendor-thin-index-unchanged` | vendor thin-index 内容已是最新，不需要写入。 |
| `vendor-thin-index-stale` | vendor 源 SKILL.md 已变更或被删除，thin-index 需要更新；write 时将自动重新生成或清理。 |
| `vendor-thin-index-removed` | write 已清理过期的 stale vendor thin-index。 |
| `vendor-skill-synced` | vendor skill 已同步到运行时 skill 目录。 |
| `skill-dependency-required` | enabled/显式插件声明的 required capability，进入项目发现层。 |
| `skill-dependency-optional` | optional capability，仅记录 trigger，不在更新时安装。 |
| `legacy-runtime-skill-detected` | 在已验证工具用户目录发现历史 vendor skill；只报告，不删除。 |
| `runtime-adapter-skipped` | 未显式启用工具 adapter，继续使用 `.agents/skills` 通用层。 |
| `vendor-missing` | `.agents/vendor/` 不存在，跳过 vendor skill 同步。 |
| `skipped` 且 reason 包含 `target exists` | 目标 thin-index 已存在，默认不覆盖。 |
| `config-missing-key` | 模板有新增字段，当前项目 config 没有；dry-run 只提示。 |
| `config-merged-key` | write 已把缺失配置项追加到待确认区块。 |
| `config-deprecated-candidate` | 当前项目 config 有模板没有的字段；只提示，不删除。 |
| `config-migration-planned` | 插件迁移脚本已通过字节校验，dry-run 计划生成新配置。 |
| `config-migration-applied` | write 已应用插件配置迁移。 |
| `config-migration-unchanged` | 插件迁移配置已是最新。 |
| `script-wrapper-planned` / `script-wrapper-applied` | 编码脚本将要或已经替换为指向插件 canonical 实现的薄 wrapper。 |

以下状态是停止条件：

| 状态 | Agent 行为 |
|---|---|
| `Action required` | 查看摘要下的阻塞项。必要时运行 `-Detailed` 后向用户汇报。 |
| `conflict` | 停止。报告冲突文件和来源。 |
| `config-review-required` | 停止。说明配置语义需要人工确认。 |
| `config-migration-review-required` | 停止。真实文件样本不足、mixed 或 unknown，不能自动决定编码模式。 |
| `config-migration-conflict` | 停止。目录/仓库角色提出的候选模式与文件字节检测冲突。 |
| `config-migration-failed` | 停止。插件迁移脚本缺失、异常退出或输出无效。 |
| `submodule-init-required` | 停止。前端 submodule 未初始化，无法做字节检测。 |
| `script-conflict` | 停止。目标工程编码脚本是未知或用户定制版本，更新器不覆盖。 |
| `pull-blocked-dirty` | 停止。说明 `.agents` 仓库存在本地改动，需要用户决定提交、暂存或放弃。 |
| `agents-git-missing` | 停止。说明 `.agents` 不是标准独立 Git 仓库。 |
| `git-version-unsupported` | 停止。说明当前 Git 低于 `2.25.0`，先升级 Git for Windows 后重试。 |
| `fetch-failed` | 停止。报告网络或远端拉取失败。 |
| `pull-failed` | 停止。报告无法 fast-forward。 |
| `sparse-refresh-failed` | 停止。报告 sparse checkout 刷新失败。 |
| `thin-index-script-missing` | 停止。报告插件缺少 thin-index 脚本。 |
| `agent-thin-index-script-missing` | 停止。报告 `.agents/scripts/generate-agent-thin-index.ps1` 缺失；先更新 `.agents` 能力包。 |
| `vendor-skill-sync-script-missing` | 停止。报告 `.agents/scripts/sync-vendor-skills.ps1` 缺失；先更新 `.agents` 能力包。 |
 | `vendor-thin-index-script-missing` | 停止。报告 `.agents/scripts/generate-vendor-thin-index.ps1` 缺失；先更新 `.agents` 能力包。 |
| `sync-claudecode-skills-script-missing` | 停止。报告 `.agents/scripts/sync-claudecode-skills.ps1` 缺失；先更新 `.agents` 能力包。 |
 | `agents-entry-missing` | 提示。项目主入口缺失；安装或更新 `.agents` 后，通过 `project-context-maintenance` 补齐或维护，不要复制本仓库根 `AGENTS.md`。 |
| `plugin-init-required` | 停止。读取该插件真实 init skill，完成初始化闭环后用脚本标记为 enabled。 |
| `plugin-dependency-missing` | 停止。先初始化依赖插件，不要只因插件目录存在就继续。 |

## coding-iris 前端编码 v2 迁移

前端编码只允许两种模式：`standard-gb2312`（标版源码与上传均为 GB2312）和 `project-utf8`（医院项目源码与上传均为 UTF-8）。组合仓库名称不是编码模式；路径覆盖只映射这两种模式，实际文件字节检测始终是最终门禁。

旧版 `update-agents.ps1` 在第一次运行过程中即使拉取了新版脚本，也不会在同一 PowerShell 进程中执行新迁移钩子。已部署工程按以下两阶段流程处理：

```powershell
# 第一阶段：拉取新版能力包和更新器
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write

# 第二阶段：用新版更新器预览并应用 coding 插件迁移
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun -NoPull -Detailed -Plugin coding-iris-plugin
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write -NoPull -Detailed -Plugin coding-iris-plugin
```

迁移器发现 `src/imedical/web` 时提出 `project-utf8` 候选；标版前端仓库通过 gitlink、submodule、嵌套 Git 边界和前端内容发现，不依赖 `core-mod`、`all` 或固定组合路径。候选必须通过非 ASCII 文件字节抽检；任何 review-required/conflict 未处理前，Agent 不得继续前端写入或部署。

## Agent thin-index

更新脚本会在插件处理之外独立运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/generate-agent-thin-index.ps1 `
  -ProjectRoot . `
  -Mode DryRun
```

`Write` 模式会为 `.agents/agents/*-agent/AGENT.md` 生成浅层入口：

```text
.agents/skills/<agent-name>/SKILL.md
```

这些文件只做路由：要求继续读取 canonical `AGENT.md`、`bindings.yaml`、默认 workflow、agent registry 和 workflow registry。它们不是 Codex、Claude Code、OpenCode 或 CodeBuddy 的工具 adapter，也不复制插件规则全文。

已部署项目不需要重新安装；常规 `update-agents.ps1 -Mode DryRun` 会报告缺失的 agent thin-index，确认无停止条件后执行 `-Mode Write` 即可补齐。若 canonical agent 被删除，脚本只清理带有 agent thin-index 标记且指向 `.agents/agents/*/AGENT.md` 的过期入口，不会删除插件 skill thin-index 或项目自定义 skill。

## Vendor skill 按依赖发现

`vendor/` 是随能力包部署的 fallback 源，不是默认安装列表。`update-agents.ps1` 调用 `resolve-plugin-skill-dependencies.ps1`，递归汇总 enabled 插件、显式选择插件及其插件依赖；manifest 中 `skillDependencies.required` 自动进入项目发现层，`optional` 只在任务命中 trigger 后按需读取。

核心解析和 manifest 不包含 Claude Code、Codex、OpenCode、CodeBuddy、WorkBuddy 或 Hermes 的用户目录与调用语法。`.agents/skills/` 是跨工具通用层；工具不能发现 thin-index 时，按入口说明直接读取其 `source`。工具没有 skill 或 subagent 能力时，按 canonical Markdown 串行执行。

`update-agents.ps1` 只为解析出的 required skill 调用：

```powershell
.agents/scripts/generate-vendor-thin-index.ps1 -AgentsRoot .agents -ProjectRoot . -Skill <required-skill[]> -Mode DryRun|Write
```

该脚本只为显式 `-Skill` 集合生成或维护 thin-index。普通 Write 不清理历史入口，避免把旧工程中新生成的默认 `available` 状态误判为“从未使用”。

- `vendor/<vendor-name>/skills/<skill-name>/SKILL.md` → `.agents/skills/<skill-name>/SKILL.md`
- `vendor/<vendor-name>/SKILL.md` → `.agents/skills/<vendor-name>/SKILL.md`

生成的 thin-index 保留原始 SKILL.md 的 `name` 和 `description`，补充 `thin-index: true` 和 `source` 指向 vendor 真实路径。Agent 匹配后必须继续读取 `source` 指向的真实 SKILL.md。

只有显式传入 `-CleanupLegacyVendorSkills` 时，才清理不在 required 集合中的受管 vendor thin-index。清理只识别同时包含 `thin-index: true` 且 `source` 指向 `.agents/vendor/` 的项目入口；不会删除项目自定义、插件或 agent thin-index，也不会删除任何工具的用户级 skill。

配置生效方式：

- DryRun 只输出摘要，不写入文件、不清理过期项。
- Write 只补齐 required 入口。
- `-CleanupLegacyVendorSkills` 的 DryRun/Write 单独报告或执行兼容清理。

## 工具运行时显式同步

常规安装和更新不再写入用户级 skill 目录。只有明确需要 Claude Code 或 Codex 用户级副本时才执行：

```powershell
.agents/scripts/sync-vendor-skills.ps1 -AgentsRoot .agents -ProjectRoot . -Skill brainstorming -Runtime ClaudeCode -Mode DryRun
.agents/scripts/sync-vendor-skills.ps1 -AgentsRoot .agents -ProjectRoot . -Skill brainstorming -Runtime ClaudeCode -Mode Write
```

`Write` 必须显式提供 `-Skill`；无参数全量同步会以 `vendor-skill-selection-required` 拒绝。目标已有 canonical skill 时报告 `vendor-skill-reused`，不覆盖。OpenCode、CodeBuddy 等尚未验证原生目录的工具不生成猜测性 adapter，直接使用项目通用层。

项目级 Claude Code 发现层同样改为显式启用：常规更新默认不修改 `.claude/skills`；确有需要时向 `update-agents.ps1` 传入 `-RuntimeAdapter ClaudeCode`。未指定 adapter 时报告 `runtime-adapter-skipped`。

## 已部署工程迁移

旧工程无需重装。更新器拉取到自身新版本时会带防循环标记自动重启新版脚本，再执行后续阶段，避免旧进程继续执行全量 vendor 同步。

1. 先运行常规 DryRun；无 `plugin_profile.md` 且存在历史 vendor thin-index 时会报告 `legacy-vendor-profile-review-required`，历史入口保持不变。
2. 使用 `update-plugin-profile.ps1` 确认实际使用插件为 `enabled`；自动发现的新插件仍保持 `available`。
3. 普通 Write 停止继续全量扩散并补齐 required 入口，不清理历史入口或用户级副本。
4. 验证 required skill 可加载后，单独运行带 `-CleanupLegacyVendorSkills` 的 DryRun；确认清单后再执行对应 Write。

用户级历史副本可能被多个项目共享，更新器永不自动删除。项目 `AGENTS.md`、memory/rules、已有 config 值和工具配置也不因本迁移被覆盖。

## Git hook 可选启用

`.agents` 会随安装或更新分发提交前差异降噪能力，但不会自动启用：

- `.agents/hooks/pre-commit`
- `.agents/scripts/check-functional-diff.ps1`
- `.agents/scripts/install-git-hooks.ps1`

启用必须由业务项目用户显式执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/install-git-hooks.ps1 -ProjectRoot .
```

该命令只在当前业务项目 Git 仓库写入：

```powershell
git config core.hooksPath .agents/hooks
```

验证：

```powershell
git config --get core.hooksPath
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/check-functional-diff.ps1 -ProjectRoot . -Staged
```

禁用或回退：

```powershell
git config --unset core.hooksPath
```

`check-functional-diff.ps1` 只检查 staged diff。它允许正常代码编写产生的局部缩进、空行和对齐；会阻断纯空白变更、`git diff --cached --check` 失败，以及疑似整文件格式化噪音。真实格式化需求应拆成独立提交；手动检查时可使用 `-AllowFormatting` 明确豁免，默认 pre-commit 不放行混合功能和格式化提交。


## Claude Code skills 显式同步

只有向 `update-agents.ps1` 传入 `-RuntimeAdapter ClaudeCode`，才会将项目 `.agents/skills/` 下的 skill 同步到工作区 `.claude/skills/`。也可直接运行：

```powershell
.agents/scripts/sync-claudecode-skills.ps1 -ProjectRoot . -Mode DryRun|Write
```

脚本自动去重，按优先级跳过已存在的 skill：

1. **用户级插件**：`~/.claude/plugins/**/skills/<skill>/SKILL.md`（插件作为 skill 提供者优先）
2. **用户级 skill**：`~/.claude/skills/<skill>/SKILL.md`
3. **项目级 skill**：`.claude/skills/<skill>/SKILL.md`（已同步的）

对于需要同步的 skill，脚本自动将其 `source` 路径从相对路径替换为项目绝对路径，确保 Agent 能定位到真实 skill 文件。

输出状态：
- `skipped` — 已由去重源提供，不覆盖
- `unchanged` — 内容一致，不需要写入
- `generated` — dry-run 报告将生成，write 已同步

## Rule task-affinity

插件 rule thin-index 可带 YAML frontmatter，用于浅层发现和任务筛选：

```yaml
---
name: iris_coding_frontend
description: Use when implementing or modifying CSP, JavaScript, CSS, or HISUI frontend code.
task-affinity: [iris, csp, javascript, frontend, hisui, coding]
thin-index: true
source: .agents/plugins/coding-iris-plugin/rules/iris_coding_frontend.md
---
```

`task-affinity` 只是路由提示，不是常驻读取要求。Agent 认为任务匹配后，仍必须继续读取 `source` 指向的插件真实 rule；不匹配时不要为了“保险”加载全部规则。插件 `references/` 仍由真实 rule 或 skill 按需引用，不生成 `.agents/rules/` 浅层入口。

## Skill thin-index description

插件 skill thin-index 会传播真实 `SKILL.md` 的 `name` 和 `description`，并补充：

```yaml
thin-index: true
source: .agents/plugins/<plugin>/skills/<skill>/SKILL.md
```

浅层 `.agents/skills/<skill>/SKILL.md` 的 `description` 用于能力发现和触发判断。匹配后仍必须继续读取 `source` 指向的插件真实 `SKILL.md`，因为 thin-index 不复制完整流程、规则路由或安全约束。

## 插件状态分流

`.agents/plugins/**` 全量拉取用于能力发现，但更新脚本按 `.agents/config/plugin_profile.md` 分流：

| 状态 | 更新行为 |
|---|---|
| `available` | 只报告，不合并 templates，不生成 thin-index，不修改 `AGENTS.md`。 |
| `enabled` | 项目已接入且初始化闭环已完成，参与常规更新：合并缺失 config key，校验或重建 thin-index。 |
| `disabled` | 默认跳过；旧 thin-index 只报告，不自动删除。 |

无 `plugin_profile.md` 时，默认只把 `agent-context-kit` 视为 `enabled`，其它插件视为 `available`。

启用领域插件时，不要直接运行全量 update。先读取插件真实 init skill：

```text
.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md
.agents/plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md
```

`i18n-iris-plugin` 依赖 `coding-iris-plugin`。若 coding 未启用，i18n 初始化和 i18n-agent workflow 都必须停止。

插件 init skill 验收通过后，用统一脚本反写状态：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-plugin-profile.ps1 `
  -ProjectRoot . `
  -Plugin coding-iris-plugin `
  -Status enabled
```

## config 合并规则

- 已存在字段以业务项目当前值为准。
- 模板新增字段只追加到配置文件末尾的待确认区块。
- 疑似废弃字段只报告，不删除。
- 字段语义变化只报告 `config-review-required`，等待用户确认。
- 不要把敏感连接信息写入 `.agents/config/`。

## 何时自动继续

满足以下全部条件时，Agent 可以从 `DryRun` 自动继续到 `Write`：

- 没有 `Action required`。
- 没有 `conflict`。
- 没有 `config-review-required`。
- 没有 `pull-blocked-dirty`。
- 没有 `agents-git-missing`。
- 没有 `git-version-unsupported`。
- 没有 `fetch-failed`、`pull-failed` 或 `sparse-refresh-failed`。

兼容入口提示不属于停止条件。不要为了消除 `entrypoint-missing`、`entrypoint-not-symlink` 或 `entrypoint-wrong-target` 而复制 `AGENTS.md`；只有用户明确需要时，才运行 `repair-agent-entrypoints.ps1` 创建 symlink。

如果不满足，停止并汇报阻塞状态。不要猜测用户意图。

## 验收标准

完成安装或更新后，检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Check
```

验收结果应满足：

- `.agents` 是独立 Git 仓库。
- `.agents/agents/agent-registry.md` 存在。
- `.agents/workflows/workflow-registry.md` 存在。
- `.agents/skills/<agent-name>/SKILL.md` 中的 agent thin-index 存在或 dry-run 明确报告将生成；例如 `.agents/skills/i18n-agent/SKILL.md` 指向 `.agents/agents/i18n-agent/AGENT.md` 和 `.agents/workflows/i18n-change.workflow.md`。
- `.agents/skills/agent-kit-maintenance/` 不存在；该维护者专用 skill 只保留在能力包仓库根 `skills/agent-kit-maintenance/`，不得部署到业务项目。若历史部署或手工 full clone 已遗留该目录，执行 `update-agents.ps1 -Mode Write` 会清理并报告 `maintenance-only-skill-removed`。
- enabled 插件 required vendor thin-index 已存在或 DryRun 明确报告生成计划；optional 只显示 trigger。
- 普通更新没有写用户级 skill 目录；历史副本只报告 `legacy-runtime-skill-detected`。
- 未指定工具 adapter 时报告 `runtime-adapter-skipped`；显式启用 Claude Code adapter 时，`.claude/skills/` 同步结果为 `skipped` / `generated` / `unchanged`。
- `.agents/.git/info/exclude` 包含 `/config/`、`/memory/`、`/rules/`、`/skills/`、`/scripts/`、`/work/`。
- `.agents/config/plugin_profile.md` 存在或 dry-run 明确报告默认插件状态。
- 如果业务项目有 `AGENTS.md`，兼容入口可以是 `entrypoint-ok`，也可以缺失；缺失或异常只作为可选提示，不应在 write 中自动修复。
- 插件能被扫描到；未启用插件只应显示为 `available`，不应生成 thin-index。
- 没有停止条件。

最后向用户汇报：

- 是否完成安装或更新。
- 是否执行了 `Write`。
- 是否存在需要人工确认的配置项。
- 是否存在未处理的阻塞项。
