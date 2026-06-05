# .agents 安装与更新 Runbook

本文是给大模型 Agent 执行的操作手册。目标是在业务项目中安装或更新 `.agents` 能力包，尽量减少人工参与。

本文件必须按步骤执行。不要凭经验改流程。不要覆盖业务项目已有上下文。

## 使用前提

- 当前目录必须是业务项目根目录。
- `AGENTS.md` 是必须存在的工程级唯一主入口；`CLAUDE.md`、`CODEBUDDY.md` 只是可选兼容 symlink。
- 所有命令使用 PowerShell。
- `.agents/config/` 只允许合并，不允许覆盖已有值。
- `.mcp.json` 是连接事实来源。不要把 host、账号、密码、token、namespace 或远程路径写入 `AGENTS.md`、rules、memory、config 或插件。
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

如果摘要没有停止条件，继续执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write
```

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
| `plugin-found` | 已发现插件。 |
| `generated` | dry-run 发现将生成 thin-index，或 write 已生成。 |
| `removed` | write 已清理 stale thin-index；清理阶段扫描所有指向 `.agents/plugins/*/rules/*.md` 的 rule thin-index，不受当前 `PluginPath` 限制。 |
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
| `fetch-failed` | 停止。报告网络或远端拉取失败。 |
| `pull-failed` | 停止。报告无法 fast-forward。 |
| `sparse-refresh-failed` | 停止。报告 sparse checkout 刷新失败。 |
| `thin-index-script-missing` | 停止。报告插件缺少 thin-index 脚本。 |
| `agents-entry-missing` | 停止。先创建 `AGENTS.md`，不要用 `CLAUDE.md` 或 `CODEBUDDY.md` 代替。 |

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
- `.agents/.git/info/exclude` 包含 `/config/`、`/memory/`、`/rules/`、`/skills/`、`/scripts/`。
- 如果业务项目有 `AGENTS.md`，兼容入口可以是 `entrypoint-ok`，也可以缺失；缺失或异常只作为可选提示，不应在 write 中自动修复。
- 插件能被扫描到。
- 没有停止条件。

最后向用户汇报：

- 是否完成安装或更新。
- 是否执行了 `Write`。
- 是否存在需要人工确认的配置项。
- 是否存在未处理的阻塞项。
