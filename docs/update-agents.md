# .agents 安装与更新 Runbook

本文是给大模型 Agent 执行的操作手册。目标是在业务项目中安装或更新 `.agents` 能力包，尽量减少人工参与。

本文件必须按步骤执行。不要凭经验改流程。不要覆盖业务项目已有上下文。

## 使用前提

- 当前目录必须是业务项目根目录。
- Git 必须是 `2.25.0` 或更新版本；`install-agents.ps1` 和 `update-agents.ps1` 使用 `git sparse-checkout` 子命令，不兼容 Git 2.21.0。
- `AGENTS.md` 是工程级唯一主入口，但缺失时不阻塞 `.agents` 首次安装；安装后通过 `project-context-maintenance` 补齐或维护。`CLAUDE.md`、`CODEBUDDY.md` 只是可选兼容 symlink。
- 所有命令使用 PowerShell。
- `.agents/config/` 默认只允许合并，不覆盖已有值；唯一的运行时路径例外是 Windows x64 上将既有 `project-env.json` 的 `mcp.serverPath` 收敛到随能力包部署的 `iris-agentic-dev.exe`，其它字段保持不变。
- `.agents/config/plugin_profile.md` 是插件启用状态事实来源；插件目录存在只表示 `available`，不表示已启用。
- `.mcp.json` 是连接事实来源。不要把 host、账号、密码、token、namespace 或远程路径写入 `AGENTS.md`、rules、memory、config 或插件。
- 安装/更新会部署 `.agents/scripts/iris-mcp.js`。standard 项目直接使用 sparse checkout 中的 canonical helper；workspace overlay 会在 `ContextRoot/scripts/` 生成 manifest-aware JS adapter，并转发到 `CapabilityRoot/scripts/iris-mcp.js`。原生 MCP 工具优先；只有运行器未暴露原生工具时才使用该 helper，不得把 helper 当成 canonical 规则源。更新后的 helper 会消费 `check_config` 版本和 capabilities，显式分类 v1.2.6 工具，并按工具 `mode` / `action` 拦截远端状态变化；默认通过 `--no-skills` 避免与能力包 vendor skills 重复。Windows x64 安装/更新在确认 vendor exe 已存在后，只收敛 `.mcp.json` 的 IRIS MCP `command` 和既有 `project-env.json` 的 `mcp.serverPath`；不创建连接配置，不修改 `.iris-agentic-dev.toml`，也不改 host、账号、密码、namespace、args、env 或其它 MCP server。
- 如果输出中出现停止条件，先停止并向用户汇报，不要继续执行破坏性操作。
- 若 `WorkspaceRoot/.agents/capability.json` 存在，按 workspace overlay 处理；`ContextRoot` 无 `.git` 是合法状态。完整两阶段流程和恢复门禁见 `docs/workspace-overlay.md`。

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
| `.agents/` 存在、`.agents/.git` 不存在且 `capability.json` 有效 | 执行 workspace overlay 刷新；不要求 ContextRoot 是 Git 仓库。 |
| `.agents/` 存在但 `.agents/.git` 和有效 `capability.json` 都不存在 | 停止。报告“非标准 .agents 目录”，请用户确认是否备份或删除后重新安装。 |
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

首次安装默认只处理 `agent-context-kit`。`coding-iris-plugin`、`codegraph-query`、`iris-codegraph`、`extract-doc`、`i18n-iris-plugin`、`iris-interface-dev`、`iris-cure-form-dev`、`iris-external-reg` 等插件代码会随 `.agents/plugins/` 拉取，但状态为 `available` 时不会合并配置或生成 thin-index。

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

常见插件初始化入口：

```text
.agents/plugins/codegraph-query/skills/codegraph-query/SKILL.md
.agents/plugins/iris-codegraph/skills/iris-codegraph/SKILL.md
.agents/plugins/extract-doc/skills/extract-doc-ingest/SKILL.md
.agents/plugins/iris-interface-dev/skills/iris-interface-init/SKILL.md
.agents/plugins/iris-cure-form-dev/skills/cure-form-init/SKILL.md
.agents/plugins/iris-external-reg/skills/iris-external-reg/SKILL.md
```

`iris-cure-form-dev` v0.3.0 起，已初始化项目需要在本地 `.agents/config/cure_form_profile.md` 补齐 `PreviewHisuiCss`、`PreviewJqueryJs`、`PreviewHisuiJs`、`PreviewHisuiLocaleJs`、`PreviewAsscomCss`、`PreviewAdaptationCss`。v0.3.2 的新 profile 模板默认将前四项指向随能力包部署的 `.agents/vendor/hisui/`；这些字段仍是目标工程本地路径，也可在执行 `preview` 时通过 `--page-html` 从目标现有完整页面解析。更新脚本不会猜测或覆盖既有项目配置。v0.3.2 可选填写 `PreviewBrowserCommand` 固定 Chromium；使用 `common-migrate` 的项目还需从插件模板创建本地 `cure-form-common-migration-config/v1`，并填写 `CommonMigrationConfig`，业务 MapCode/RowID 不再由插件内置。

已有治疗表单部署流程还需调整为：先运行 `preview` 生成完整页面和 manifest，再运行 canonical `preview-run` 自动采集九档 Chromium Network、Console 与页面探针结果，最后运行 `preview-check` 生成 `preview-verification.json`。任何 `plan --changes` 都必须传入 `--preview-verification`；v0.3.2 的 gate v2 不接受旧 preview 凭证或人工结果，旧 changes 文件可继续使用，但必须重新生成资源、CSS 依赖、HISUI 初始化和 runner 哈希证据。

`iris-cure-form-dev` v0.4.0 为 `expectedVersion=NEW` 的新建表单增加人工交互门禁。更新不会改写现有项目 profile，也不影响存量响应式改造；新建表单在 `plan` 前必须运行 `interaction-prepare --stage pre-deploy`，由用户明确确认整体通过或由 Agent 逐项记录后运行 `interaction-check`，并将生成的 `--interaction-verification` 传给 `plan`。部署后还需生成绑定 package/operation ID 的人工清单，完成保存、重开、回显、打印和 CR 运行时契约验证。v1 不接受自动交互结果；批量脚本化点击、输入或选择必须先取得用户明确确认。

`iris-cure-form-dev` v0.5.0 将服务端事务入口固定迁移为 `DHCDoc.Cure.AI.CureFormDeploy`，不再调用或回退到旧部署类，也不新增 profile 配置项。已部署项目必须先在目标 IRIS namespace 上传并编译新类，再更新 `.agents`、重建已启用插件 thin-index，并确认所有调用方都已切换到 v0.5.0；完成这些检查后才可删除旧类。

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

从只部署 `/scripts/*.ps1` 的旧版 sparse checkout 跨版本更新时，旧进程可能先拉取新版脚本、再以旧 sparse 清单遗漏 `scripts/lib/**`。新版更新器在自更新恢复、`Write`，或允许拉取的 `DryRun` 中发现 `WorkspaceContext.psm1` 缺失时，会先以当前完整运行时清单收敛 sparse checkout，并报告 `workspace-context-resolver-restored`；随后继续原更新流程。`Check` 与显式 `DryRun -NoPull` 不执行该修复，只报告 `workspace-context-resolver-missing`。若恢复失败则报告 `workspace-context-resolver-restore-failed`，此时停止并检查 `.agents` Git 状态、Git 版本和 sparse checkout。

## Workspace overlay 两阶段更新

多个模块共享 capability 时，先在 canonical 标版根执行一次标准 DryRun/Write；再从 canonical `.agents/scripts/update-agents.ps1` 对每个模块执行 `-Mode DryRun -NoPull`，无停止条件后执行 `-Mode Write -NoPull`。overlay 阶段只刷新模块 `ContextRoot`，不会 fetch/pull capability Git。

不得颠倒顺序，也不得从模块 ContextRoot 猜测父目录 capability。命令、Junction/本地目录判定、停止条件和恢复步骤见 [Workspace Overlay 部署与恢复 Runbook](workspace-overlay.md)。

## 输出判读

以下状态通常正常，不需要用户参与：

| 状态 | 含义 |
|---|---|
| `agents-updated` | `.agents` 已完成 fetch、pull 和 sparse checkout 刷新。 |
| `capability-pull-skipped-overlay` | 当前为 workspace overlay；按契约跳过 capability fetch/pull，只刷新 ContextRoot。 |
| `workspace-context-resolved` | 已解析 standard 或 workspace-overlay 的五类根。 |
| `junction-ok` / `local-path-ok` | overlay 的共享/源码 Junction 与本地物理目录符合 manifest。 |
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
| `plugin-profile-name-migration-planned` | DryRun/Check 发现 manifest 声明的旧插件名；将保留原状态并写回 canonical 名称。 |
| `plugin-profile-name-migrated` | Write 已把旧插件名的状态迁移到 canonical 名称。 |
| `generated` | dry-run 发现将生成 thin-index，或 write 已生成。 |
| `unchanged` | 生成物内容已是最新，不需要写入。 |
| `removed` | write 已清理 stale thin-index；清理阶段扫描所有指向已删除 `.agents/plugins/*/rules/*.md` 或 `.agents/plugins/*/skills/*/SKILL.md` 的受管入口，不受当前 `PluginPath` 限制。 |
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
| `config-migration-planned` | 插件迁移脚本已通过字节校验，或已从 Overlay manifest 明确判定为 backend-only；dry-run 计划生成新配置。 |
| `config-migration-applied` | write 已应用插件配置迁移。 |
| `config-migration-unchanged` | 插件迁移配置已是最新。 |
| `script-wrapper-planned` / `script-wrapper-applied` | 编码脚本将要或已经替换为指向插件 canonical 实现的薄 wrapper。 |

以下状态是停止条件：

| 状态 | Agent 行为 |
|---|---|
| `Action required` | 查看摘要下的阻塞项。必要时运行 `-Detailed` 后向用户汇报。 |
| `conflict` | 停止。报告冲突文件和来源。 |
| `config-review-required` | 停止。说明配置语义需要人工确认。 |
| `config-migration-review-required` | 停止。发现 mixed、UTF-16、unknown、无法从 SourceRoot 声明判定是否 backend-only，或存在不支持的配置值，不能安全规范化。 |
| `config-migration-conflict` | 停止。目标应为 canonical UTF-8，但实际字节仍是 GB2312 或与 UTF-8 门禁冲突。 |
| `config-migration-failed` | 停止。插件迁移脚本缺失、异常退出或输出无效。 |
| `submodule-init-required` | 停止。前端 submodule 未初始化，无法做字节检测。 |
| `script-conflict` | 停止。目标工程编码脚本是未知或用户定制版本，更新器不覆盖。 |
| `pull-blocked-dirty` | 停止。说明 `.agents` 仓库存在本地改动，需要用户决定提交、暂存或放弃。 |
| `agents-git-missing` | 停止。说明 `.agents` 不是标准独立 Git 仓库。 |
| `manifest-invalid` / `schema-version-unsupported` | 停止。修复 `capability.json` 后重新 DryRun。 |
| `capability-root-missing` / `capability-git-missing` | 停止。共享 capability 根缺失或不是 Git 部署。 |
| `junction-target-mismatch` / `shared-path-not-junction` / `source-path-not-junction` | 停止。只允许在确认 manifest 后显式安全修复 Junction；普通目录不得覆盖。 |
| `local-path-is-link` / `local-path-not-directory` | 停止。ContextRoot 本地层必须是物理目录。 |
| `source-root-missing` / `git-root-missing` | 停止。声明的业务源码或真实 Git 根不存在。 |
| `plugin-explicit-selection-disabled` | 停止。不得绕过项目显式 disabled 状态。 |
| `git-version-unsupported` | 停止。说明当前 Git 低于 `2.25.0`，先升级 Git for Windows 后重试。 |
| `fetch-failed` | 停止。报告网络或远端拉取失败。 |
| `pull-failed` | 停止。报告无法 fast-forward。 |
| `sparse-refresh-failed` | 停止。报告 sparse checkout 刷新失败。 |
| `workspace-context-resolver-missing` | 停止。只读模式发现 `scripts/lib/WorkspaceContext.psm1` 缺失；改用允许拉取的 DryRun 或经确认的 Write 触发旧 sparse checkout 恢复。 |
| `workspace-context-resolver-restore-failed` | 停止。旧 sparse checkout 自动恢复失败；检查 `.agents` 是否为干净的独立 Git checkout、Git 版本和 sparse 状态。 |
| `thin-index-script-missing` | 停止。报告插件缺少 thin-index 脚本。 |
| `agent-thin-index-script-missing` | 停止。报告 `.agents/scripts/generate-agent-thin-index.ps1` 缺失；先更新 `.agents` 能力包。 |
| `vendor-skill-sync-script-missing` | 停止。报告 `.agents/scripts/sync-vendor-skills.ps1` 缺失；先更新 `.agents` 能力包。 |
 | `vendor-thin-index-script-missing` | 停止。报告 `.agents/scripts/generate-vendor-thin-index.ps1` 缺失；先更新 `.agents` 能力包。 |
| `sync-claudecode-skills-script-missing` | 停止。报告 `.agents/scripts/sync-claudecode-skills.ps1` 缺失；先更新 `.agents` 能力包。 |
 | `agents-entry-missing` | 提示。项目主入口缺失；安装或更新 `.agents` 后，通过 `project-context-maintenance` 补齐或维护，不要复制本仓库根 `AGENTS.md`。 |
| `plugin-init-required` | 停止。读取该插件真实 init skill，完成初始化闭环后用脚本标记为 enabled。 |
| `plugin-dependency-missing` | 停止。先初始化依赖插件，不要只因插件目录存在就继续。 |

## coding-iris 前端编码 v3 迁移

当前标版与医院项目的前端源码、上传内容和服务器运行编码统一使用 canonical `utf8`。旧 `project-utf8` 是兼容读取别名；旧 `standard-gb2312` 只服务用户明确指定的历史工程，不再由组合仓库名称、目录结构或 Git 角色自动推断。实际文件字节检测始终是最终门禁。

workspace-overlay 的 manifest 若明确至少声明一个 `backend` SourceRoot 且没有 `frontend` SourceRoot，迁移器将旧 `TODO`、`utf8` 或兼容模式规范化为 `N/A (backend-only)`，并写入 v3 managed marker；它不会扫描父目录或 sibling。空 SourceRoot、只有未知角色或其它无法证明 backend-only 的声明仍返回 `config-migration-review-required`。后续新增 `frontend` SourceRoot 时，重新运行迁移并通过 UTF-8 字节门禁后，N/A 会规范化为 `utf8`。

旧版 `update-agents.ps1` 在第一次运行过程中即使拉取了新版脚本，也不会在同一 PowerShell 进程中执行新迁移钩子。已部署工程按以下两阶段流程处理：

```powershell
# 第一阶段：拉取新版能力包和更新器
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write

# 第二阶段：用新版更新器预览并应用 coding 插件迁移
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun -NoPull -Detailed -Plugin coding-iris-plugin
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write -NoPull -Detailed -Plugin coding-iris-plugin
```

迁移器只在标准工作区已发现的前端根或 workspace-overlay 明确声明的 `sourceRoots[name=frontend]` 中抽检字节：UTF-8 或纯 ASCII 根可将旧 profile 安全规范化为 `utf8`；GB2312、mixed、UTF-16 或 unknown 会阻塞，不自动批量转码业务源码。任何 review-required/conflict 未处理前，Agent 不得继续前端写入或部署。

迁移继续生成 `check-frontend-encoding.ps1` wrapper；`convert-gb2312-upload.ps1` wrapper 仅为历史工程兼容保留。当前 UTF-8 部署直接上传通过门禁的原始源文件，不生成 `*.gb2312.*` 临时件。

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

`coding-iris-plugin` 引入的 `iris-agentic-dev-skills` 属于 optional vendor skill：更新脚本会把 v1.2.6 固定提交的 8 个 skill 快照同步到 `.agents/vendor/iris-agentic-dev-skills/`，但不会自动生成 `.agents/skills` thin-index。需要直接使用这些官方 skill 时，可从 vendor 路径读取，或由目标 runtime 的显式同步选项生成入口；`objectscript-tdd` 仍受任务级编译/测试授权约束，`iris-mcp-lookup` 本身仍由插件 canonical skill 提供。

新建目标工程从 `project-env.template.json` 生成 `.mcp.json` 时默认写入 `--no-skills` / `IRIS_NO_SKILLS=true`。已有工程更新能力包时，仅按下节规则收敛 MCP server 路径；其它 `.mcp.json` 和 `project-env.json` 字段保持不变。如需采用该默认值，应人工在本地 `mcp.includeBuiltInSkills=false` 后重新生成，或在既有 MCP 配置中显式加入 `--no-skills`。确需上游 skill registry、KB 或学习工具时可本地设置 `mcp.includeBuiltInSkills=true`，不得把连接事实一并提交。

## iris-agentic-dev vendor 运行时优先

Windows x64 安装或更新完成后，`scripts/prefer-vendor-iris-mcp.ps1` 优先使用：

```text
.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe
```

行为边界：

- `.mcp.json` 已存在且能唯一识别 IRIS MCP server 时，只把该 server 的 `command` 改为上述项目相对路径；其它 server、`args` 和 `env` 原样保留。
- `.agents/config/project-env.json` 已存在 `mcp` 配置时，同时收敛 `mcp.serverPath`，避免以后重新生成 `.mcp.json` 时回退到外部 exe。
- 没有 `.mcp.json` 和 `project-env.json` 时报告 `mcp-vendor-command-not-configured`，不猜测或创建连接配置。
- DryRun/Check 报告 `mcp-vendor-command-planned` 但不写文件；Write 成功报告 `mcp-vendor-command-applied`；已经一致报告 `mcp-vendor-command-unchanged`。
- Write 在返回 `mcp-vendor-command-applied` 前会重新读取并校验两份实际落盘文件；任一目标未写成预期路径时返回 `mcp-vendor-command-write-failed`，并尽力按原始字节回滚本轮涉及的配置文件。
- vendor exe 缺失、JSON 无法解析或存在多个候选时保留原配置，并分别报告 `mcp-vendor-executable-missing`、`mcp-vendor-config-invalid` 或 `mcp-vendor-command-ambiguous` 作为停止条件。
- 非 Windows 平台保留项目现有命令并报告 `mcp-vendor-command-skipped-platform`，因为当前内置二进制仅支持 Windows x64。

当前受支持的已部署更新器会在拉取到新版 `update-agents.ps1` 后自重启，因此一次 Write 即可继续执行 vendor 路径收敛。回归测试使用本地 Git 远端模拟“项目仍运行不含此能力的旧脚本、远端已发布新版脚本”的升级过程，并验证同一次 Write 更新 `.mcp.json` 和 `.agents/config/project-env.json`，第二次 Write 保持字节级不变。

无法给任意历史版本的已加载 PowerShell 进程追加它启动时并不存在的逻辑。若项目中的更新器早于自重启机制，使用以下两次 Write 作为确定性兼容流程：第一轮只需确保拉取新版能力包，第二轮明确使用已落盘的新更新器完成配置收敛；第二轮不再联网。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write -NoPull -Detailed
```

第二轮应报告 `mcp-vendor-command-applied` 或 `mcp-vendor-command-unchanged`；其它 `mcp-vendor-*` 状态必须按上面的停止条件处理，不能宣称配置已成功更新。

`mcp-vendor-command-applied` 后应重启或重新加载当前 MCP session，让运行器按新 `command` 启动 vendor exe。回退时可手工恢复项目命令，但后续 Windows Write 更新仍会再次收敛到 vendor；若 vendor 不可用，更新器不会删除项目原有 fallback。

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
.agents/plugins/codegraph-query/skills/codegraph-query/SKILL.md
.agents/plugins/iris-codegraph/skills/iris-codegraph/SKILL.md
.agents/plugins/extract-doc/skills/extract-doc-ingest/SKILL.md
.agents/plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md
.agents/plugins/iris-interface-dev/skills/iris-interface-init/SKILL.md
.agents/plugins/iris-cure-form-dev/skills/cure-form-init/SKILL.md
.agents/plugins/iris-external-reg/skills/iris-external-reg/SKILL.md
```

按 manifest `dependencies` 顺序初始化依赖：`codegraph-query` 依赖 `iris-codegraph`，`iris-codegraph` 和 `i18n-iris-plugin` 依赖 `coding-iris-plugin`；`iris-interface-dev`、`iris-cure-form-dev` 和 `iris-external-reg` 依赖 `extract-doc`、`coding-iris-plugin`。依赖未启用时，目标插件初始化必须停止；不能只因插件目录存在就继续。

更新到 `iris-cure-form-dev` v0.3.2 后，检查本地 `cure_form_profile.md` 的六个资源字段；按需追加 `PreviewBrowserCommand` 和 `CommonMigrationConfig`，不要覆盖既有项目配置。下一次带 changes 的部署计划前必须按 `preview` → `preview-run` → `preview-check` 重新生成 gate v2 凭证；该凭证不会跨 snapshot、changes、资源、CSS 依赖、runner 或 gate 变更复用。

更新到 v0.4.0 后，存量表单流程保持兼容；只有 `expectedVersion=NEW` 的新建表单必须在 `plan` 前追加 `interaction-prepare` → 人工测试 → `interaction-check`，并传入 `--interaction-verification`。用户明确反馈测试通过可形成总体确认，Agent 自测必须逐项记录；部署后人工验证未通过时不得宣告任务完成，也不得自动回滚。

更新到 v0.5.0 前，先确认目标 IRIS namespace 已编译 `DHCDoc.Cure.AI.CureFormDeploy`。更新和 thin-index 重建完成、全部调用方均不再使用旧插件后，才删除旧部署类；canonical 不提供旧类 fallback。

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
- `.agents/scripts/lib/WorkspaceContext.psm1` 存在；跨旧版 sparse checkout 更新时可出现一次 `workspace-context-resolver-restored`，后续 Check 不应再报告缺失。
- `.agents/agents/agent-registry.md` 存在。
- `.agents/workflows/workflow-registry.md` 存在。
- `.agents/skills/<agent-name>/SKILL.md` 中的 agent thin-index 存在或 dry-run 明确报告将生成；例如 `.agents/skills/i18n-agent/SKILL.md` 指向 `.agents/agents/i18n-agent/AGENT.md` 和 `.agents/workflows/i18n-change.workflow.md`。
- 业务项目 `.agents/skills/agent-kit-maintenance/` 不存在；该维护者专用 skill 只保留在能力包源仓根 `.agents/skills/agent-kit-maintenance/`，源仓 `.agents/` 不在 sparse checkout 部署清单内。若历史部署或手工 full clone 已遗留该目录，执行 `update-agents.ps1 -Mode Write` 会继续清理并报告 `maintenance-only-skill-removed`。
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
