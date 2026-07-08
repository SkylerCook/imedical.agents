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
 - CC Switch 是 MCP 连接事实来源。不要把 host、账号、密码、token、namespace 或远程路径写入 `AGENTS.md`、rules、memory、config 或插件。
- 如果输出中出现停止条件，先停止并向用户汇报，不要继续执行破坏性操作。

## Agent 执行原则

1. 先判断状态，再选择安装或更新流程。
2. 默认先 `DryRun`，确认摘要后再 `Write`。
3. 日常只看摘要；需要排障时再加 `-Detailed`。
4. 普通提示不要打断用户。只有停止条件需要用户确认。
5. 不依赖特定模型或工具的 `@文件` 语法。只要能读取本文件，就按本文件执行。

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
| `vendor-missing` | `.agents/vendor/` 不存在，跳过 vendor skill 同步。 |
| `skipped` 且 reason 包含 `target exists` | 目标 thin-index 已存在，默认不覆盖。 |
| `config-missing-key` | 模板有新增字段，当前项目 config 没有；dry-run 只提示。 |
| `config-merged-key` | write 已把缺失配置项追加到待确认区块。 |
| `config-deprecated-candidate` | 当前项目 config 有模板没有的字段；只提示，不删除。 |

以下状态是停止条件：

| 状态 | Agent 行为 |
|---|---|
| `Action required` | 查看摘要下的阻塞项。必要时运行 `-Detailed` 后向用户汇报。 |
| `conflict` | 停止。报告冲突文件和来源。 |
| `config-review-required` | 停止。说明配置语义需要人工确认。 |
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

## Vendor skill 运行时同步

`install-agents.ps1` 和 `update-agents.ps1` 在完成 thin-index 生成后，会调用：

```powershell
.agents/scripts/sync-vendor-skills.ps1 -AgentsRoot .agents -Mode DryRun|Write
```

该脚本把 `.agents/vendor/` 下的 vendor skill 同步到当前运行时的 skill 发现目录（Claude Code 为 `~/.claude/skills/`），以便 Agent 在任务中直接加载 vendor 提供的能力。同步规则：

- `vendor/<vendor-name>/skills/<skill-name>/SKILL.md` → `~/.claude/skills/<skill-name>/`
- `vendor/<vendor-name>/SKILL.md` → `~/.claude/skills/<vendor-name>/`

DryRun 只输出摘要，Write 会覆盖目标目录。同步只影响运行时目录，不会修改 `.agents/vendor/` 源码。

## Vendor skill thin-index

`sync-vendor-skills.ps1` 同步完成后，`update-agents.ps1` 还会调用：

```powershell
.agents/scripts/generate-vendor-thin-index.ps1 -AgentsRoot .agents -ProjectRoot . -Mode DryRun|Write
```

该脚本为 `.agents/vendor/` 下 vendor 提供的 skill 自动生成或维护 thin-index 浅层入口。扫描规则：

- `vendor/<vendor-name>/skills/<skill-name>/SKILL.md` → `.agents/skills/<skill-name>/SKILL.md`
- `vendor/<vendor-name>/SKILL.md` → `.agents/skills/<vendor-name>/SKILL.md`

生成的 thin-index 保留原始 SKILL.md 的 `name` 和 `description`，补充 `thin-index: true` 和 `source` 指向 vendor 真实路径。Agent 匹配后必须继续读取 `source` 指向的真实 SKILL.md。

脚本自动检测 vendor 源变更并同步 thin-index：每次运行时比较已生成的 thin-index 与源 SKILL.md 的新内容，若 name/description/source 发生变更则自动重新生成 thin-index（不需要 -Force）。同时清理过期 thin-index：如果 `source` 指向的 vendor 文件已被删除，dry-run 报告 `stale`，write 执行删除。

配置生效方式：

- DryRun 只输出摘要，不写入文件、不清理过期项。
- Write 执行写入和清理。

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


## Claude Code skills 同步

`update-agents.ps1` 会将项目 `.agents/skills/` 下的 skill 同步到工作区 `.claude/skills/` 目录，使 Claude Code 能通过 `/skills` 发现和使用：

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
- vendor skill 已同步到运行时 skill 目录，或 dry-run 明确报告 `vendor-missing` / `vendor-skill-synced`。
- vendor skill thin-index 已存在或 dry-run 明确报告 vendor-thin-index 状态。
- `.claude/skills/` 中项目 skill 已同步，或 dry-run 明确报告 `skipped`（去重源提供）/ `generated`（需要同步）。
- `.agents/.git/info/exclude` 包含 `/config/`、`/memory/`、`/rules/`、`/skills/`、`/scripts/`。
- `.agents/config/plugin_profile.md` 存在或 dry-run 明确报告默认插件状态。
- 如果业务项目有 `AGENTS.md`，兼容入口可以是 `entrypoint-ok`，也可以缺失；缺失或异常只作为可选提示，不应在 write 中自动修复。
- 插件能被扫描到；未启用插件只应显示为 `available`，不应生成 thin-index。
- 没有停止条件。

最后向用户汇报：

- 是否完成安装或更新。
- 是否执行了 `Write`。
- 是否存在需要人工确认的配置项。
- 是否存在未处理的阻塞项。
