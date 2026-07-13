# imedical.agents

`imedical.agents` 是 imedical 的 AI Coding 能力包仓库，用于沉淀可复用的 Agent 角色、协作流程、插件规则、skills、模板和辅助脚本。

目标是让 Codex、Claude Code、OpenCode、CodeBuddy、WorkBuddy、Hermes 等不同 AI 开发工具都能快速获得正确上下文，同时避免把通用能力、项目差异、连接信息和临时经验混在一起。

## 快速理解

本仓库分三层：

```text
agents/      # 厂商无关的智能体 canonical 定义
workflows/   # 厂商无关的阶段化/多智能体协作流程
plugins/     # 可复用能力实现：rules、skills、templates、scripts、references
```

核心原则：

- `agents/` 和 `workflows/` 是唯一 canonical 源。
- Codex、Claude Code、OpenCode、CodeBuddy 等工具专属入口只是 adapter，可删除重建。
- 业务项目差异写入业务项目自己的 `AGENTS.md`、`.agents/config/`、`.agents/rules/`、`.agents/memory/`。
- 服务器、账号、密码、token、namespace、远程路径只允许存在于目标工程 `.mcp.json`。

## 给 Agent 的落地入口

如果你是正在业务项目中执行安装或更新的 Agent，先判断 `.agents/` 状态，不要假设本地 runbook 已经存在：

安装和更新要求 Git `2.25.0` 或更新版本，因为脚本依赖 `git sparse-checkout`；低版本 Git for Windows 请先升级后再执行安装命令。

| 状态 | 下一步 |
|---|---|
| `.agents/docs/update-agents.md` 存在 | 读取它并执行安装或更新 runbook。 |
| `.agents/` 不存在 | 确认 Git `2.25.0+` 后，在业务项目根目录执行网络安装命令：`iwr -UseBasicParsing https://gitee.com/skyler-cook/imedical.agents/raw/master/scripts/install-agents.ps1 \| iex`。安装成功后再读取 `.agents/docs/update-agents.md`。 |
| `.agents/` 存在但 `.agents/.git` 不存在 | 停止并报告“非标准 .agents 目录”，请用户确认是否备份或删除后重新安装。 |
| `.agents/.git` 存在但缺少 `.agents/docs/update-agents.md` | 先执行 `.agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun`；若脚本也缺失，报告 `.agents` 部署不完整。 |

安装或更新完成后，再按这个顺序继续：

1. 读取业务项目根 `AGENTS.md`；若缺失，记录为项目上下文待补项，不要把本仓库根 `AGENTS.md` 复制过去。
2. 读取 `.agents/plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md`，初始化或维护项目上下文。
3. 读取 `.agents/config/plugin_profile.md`，确认插件是 `available`、`enabled` 还是 `disabled`。
4. 读取 `.agents/agents/agent-registry.md` 和 `.agents/workflows/workflow-registry.md`，确认可用智能体和 workflow。
5. 按项目需要读取插件初始化 skill：
   - `.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`
   - `.agents/plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md`
   - `.agents/plugins/iris-interface-dev-plugin/skills/iris-interface-init/SKILL.md`
   - `.agents/plugins/imedicalxc-doctor-extend-engineer/skills/imedicalxc-doctor-extend-engineer/SKILL.md`

不要把本仓库根 `AGENTS.md`、根 `memory/` 或展示页文件复制到业务项目。

## 给人的手工操作

### 首次安装到业务项目

要求本机 Git `2.25.0` 或更新版本；安装脚本会使用 `git sparse-checkout`。如果版本过低，先升级 Git for Windows。

在业务项目根目录执行：

```powershell
iwr -UseBasicParsing https://gitee.com/skyler-cook/imedical.agents/raw/master/scripts/install-agents.ps1 | iex
```

这是首次安装时给 Agent 使用的明确入口。此时 `.agents/docs/update-agents.md` 还不存在，不能要求 Agent 先读本地 runbook。

如需先审阅脚本：

```powershell
iwr -UseBasicParsing https://gitee.com/skyler-cook/imedical.agents/raw/master/scripts/install-agents.ps1 -OutFile install-agents.ps1
notepad .\install-agents.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-agents.ps1
```

脚本会把本仓库作为独立 Git 仓库克隆到业务项目 `.agents/`，并拉取 `plugins/`、`agents/`、`workflows/` 等能力包内容，让用户和 Agent 能看到可用能力。

插件目录存在只表示能力 `available`，不表示当前业务项目已启用该插件。默认只把 `agent-context-kit` 作为基础上下文能力处理；`coding-iris-plugin`、`i18n-iris-plugin`、`iris-interface-dev-plugin`、`imedicalxc-doctor-extend-engineer`、`imedicalxc-doctor-perf-analysis-engineer`、`imedicalxc-doctor-data-extraction`、`imedicalxc-doctor-print-template-design` 等领域插件必须按 `plugin_profile.md` 状态和真实 init skill 显式接入。

### 更新已部署 `.agents`

先 dry-run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 `
  -ProjectRoot . `
  -Mode DryRun
```

确认无阻塞后写入：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 `
  -ProjectRoot . `
  -Mode Write
```

常用参数：

- `-Mode Check`：只检查，不拉取、不写入。
- `-NoPull`：基于本地 `.agents` 内容检查或重建。
- `-Plugin <name[]>`：只处理指定插件。
- `-ExcludePlugin <name[]>`：跳过指定插件。
- `-RuntimeAdapter ClaudeCode|Codex`：显式启用已验证的工具发现层 adapter；默认仅维护 `.agents/skills` 通用层。
- `-ForceThinIndex`：将 `-Force` 传给 plugin thin-index 生成脚本。
- `-CleanupLegacyVendorSkills`：显式清理不再属于 enabled 插件 required 集合的受管 vendor thin-index；普通更新不清理。
- `-Detailed`：输出明细；日常不加，只看摘要。

如果由 Agent 托管更新，让它先读取 `.agents/docs/update-agents.md`，由 runbook 判断是否可从 `DryRun` 进入 `Write`。

安装和更新先根据 enabled 插件 manifest 解析 `skillDependencies`，只为 required vendor skill 生成 `.agents/skills/<name>/SKILL.md` 项目通用入口；optional skill 由任务场景触发。常规流程不再写用户级 skill 目录；Claude Code/Codex 同步必须显式指定 runtime 和 skill。OpenCode、CodeBuddy、WorkBuddy、Hermes 等未验证 adapter 的工具使用 `.agents/skills` 或直接 vendor 源降级。

## 仓库结构

```text
imedical.agents/
|-- agents/      # 顶层智能体 canonical 定义
|-- workflows/   # 顶层协作流程 canonical 定义
|-- plugins/     # 可复用能力包
|-- vendor/      # 第三方源码资产、共享运行时资产和可同步运行时 skill（如 HISUI、iris-agentic-dev、superpowers、word-reader）
|-- skills/      # 仓库级通用 skill；agent-kit-maintenance 为维护专用例外，不部署业务项目
|-- rules/       # 仓库级通用规则预留入口
|-- docs/        # AI Coding 工作区规范、runbook 和配套文档
|-- scripts/     # 通用部署、更新和维护脚本
|-- memory/      # 维护者记忆，不部署到业务项目
|-- AGENTS.md    # 本仓库维护入口，不部署到业务项目
`-- index.html   # GitHub Pages 展示页，不部署到业务项目
```

主要文档：

- `docs/ai-coding-workspace-kit-v0.2.0.md`：工程级 AI Coding 工作区规范。
- `docs/update-agents.md`：给 Agent 执行的 `.agents` 安装与更新 runbook。
- `memory/plan/multi-agent-architecture.md`：多智能体架构设计稿。

## 智能体与 workflow

当前已落地首个领域样板：

- `agents/i18n-agent/AGENT.md`：IRIS 国际化需求处理智能体。
- `agents/i18n-agent/bindings.yaml`：i18n-agent 的插件、规则、skill 和阶段绑定。
- `workflows/i18n-change.workflow.md`：IRIS i18n 五阶段流程。

i18n 流程：

```text
Explorer -> Classifier -> Coder -> Template/Seed -> Verifier
```

对应能力：

- 链路定位：`plugins/i18n-iris-plugin/rules/i18n_link_tracing.md`
- 数据分类：`plugins/i18n-iris-plugin/rules/i18n_field_classification.md`
- 编码改造：`plugins/i18n-iris-plugin/skills/i18n-coding/SKILL.md`
- 模板/种子：i18n 相关 seed、template、sync skills
- 验证：`plugins/i18n-iris-plugin/rules/i18n_verify.md`

业务项目更新后会生成通用 agent skill thin-index：

```text
.agents/skills/<agent-name>/SKILL.md
```

该入口只负责把只发现浅层 skill 的 Agent 路由到 `.agents/agents/<agent-name>/AGENT.md`、`bindings.yaml` 和默认 workflow；它不是工具专属 adapter。

后续如需工具原生入口，再从 canonical 生成：

```text
.codex/agents/<agent-name>.toml
.claude/agents/<agent-name>.md
.opencode/agents/<agent-name>.md
.codebuddy/agents/<agent-name>.md
```

这些 adapter 暂不实现；后续生成物也不是长期规则源。

## 插件概览

### agent-context-kit

负责初始化和维护业务项目上下文：

- `AGENTS.md` 主入口。
- `.agents/config/project_context_profile.md`。
- `.agents/rules/project.md`。
- `.agents/memory/project-memory.md`。
- 插件 thin-index 入口。

常用入口：

- `plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md`

### coding-iris-plugin

负责 IRIS/ObjectScript/CSP/JavaScript/HISUI 编码能力：

- ObjectScript 后端编码规则。
- CSP、JavaScript、CSS、HISUI 前端双编码规则：标版使用 `standard-gb2312`，医院项目使用 `project-utf8`，实际文件字节检测是最终门禁。
- 本地优先、按需上传/编译的工作流约束。
- 标版 UTF-8 导出 staging 严格转换为 GB2312 的 promote 流程，以及医院项目 UTF-8 原样编辑/上传流程。
- HISUI 控件参考按需读取。
- iris-agentic-dev MCP server Windows x64 可执行文件（当前 **v0.6.20**）内置在 `.agents/vendor/iris-agentic-dev/`，目标工程 `.mcp.json` 仍保存实际连接事实。

常用 skill：

- `coding-iris-init`
- `iris-coding`
- `iris-backend-coding`
- `iris-frontend-coding`
- `iris-frontend-gb2312-promote`

### i18n-iris-plugin

负责 IRIS/ObjectScript/CSP/HISUI 国际化能力：

- 前后端 i18n 编码改造。
- 链路定位、字段分类和验证规则。
- 用户可见文本提取。
- 页面级翻译种子。
- 字典/表字段展示值翻译 SQL。
- XML 打印模板翻译。
- CSP 页面翻译导出、校验和同步。

常用 skill：

- `i18n-project-init`
- `i18n-coding`
- `i18n-text-extract`
- `i18n-page-trans-seed`
- `i18n-bdp-trans-seed`
- `i18n-csp-trans-sync`
- `i18n-xml-template`
- `i18n-xml-print-template-sync`

### iris-interface-dev-plugin

负责 IRIS 接口开发的解析审计优先能力：

- 接口 DOCX、PDF、XLSX、DOC 文档转换为 Markdown 和结构化 JSON。
- 字段表头映射、字段抽取、字段诊断和开发计划。
- 解析产物固定落盘到目标项目 `docs/output/iris-interface/<doc-name>/`，不默认注入会话上下文。
- MarkItDown、python-docx、pdfplumber、openpyxl 均为可选依赖，不 vendor、不自动安装。
- IRIS/ObjectScript 编码、审查、上传、编译、部署和远端验证复用 `coding-iris-plugin`。

常用 skill：

- `iris-interface-init`
- `iris-interface-doc-ingest`
- `iris-interface-field-match`
- `iris-interface-dev-plan`

### imedicalxc-doctor-extend-engineer

负责 HIS 医生站第三方系统集成的全流程编排能力：

- 需求头脑风暴、设计、实施、测试、HIS 域验证和 CI/CD 交付的 10 步工作流。
- 医生站组与医院信息平台组的范围拆分。
- 中间件入口识别、前端契约提取和后端数据装配。
- BLH / DriverCom 分层开发、调用规范、医保/字典数据复用和 WebSysAddins 中间件开发。
- `imedicalxc-doctor-dbdata` 已精简为数据库查询核心规范，重点覆盖医保对照、基础数据统一对照和合并查询。
- thin-index wrapper 默认只暴露 `imedicalxc-doctor-extend-engineer` 主编排器入口，8 个子 skill 由主编排器按需读取。
- 四个 superpowers 流程 skill 是 required capability；`word-reader` 是 DOC/DOCX 输入触发的 optional fallback。它们通过 `.agents/vendor/` 分发，但只按 enabled 插件依赖进入项目发现层。

常用 skill：

- `imedicalxc-doctor-extend-engineer`

### imedicalxc-doctor-perf-analysis-engineer

负责 HIS 医生站接口性能分析与优化：

- Controller、BLH、Service、Mapper 全链路追踪。
- N+1 查询、重复调用、批量调用和前端加载性能分析。
- Graylog 日志分析和标准化性能分析报告输出。
- thin-index wrapper 默认只暴露 `imedicalxc-doctor-perf-analysis-engineer` 主编排器入口；init skill 和 reference 由主编排器按需读取。

常用 skill：

- `imedicalxc-doctor-perf-analysis-engineer-init`
- `imedicalxc-doctor-perf-analysis-engineer`

### imedicalxc-doctor-data-extraction

负责 HIS 数据抽取与第三方接口对照文档生成：

- 扫描和分析 `@OpenApi` Controller。
- 生成第三方接口对照文档、字段映射和差异说明。
- Feign 接口代码生成和 API 文档生成作为辅助能力。
- thin-index wrapper 暴露 `imedicalxc-doctor-data-extraction` 入口。

常用 skill：

- `imedicalxc-doctor-data-extraction`

### imedicalxc-doctor-print-template-design

负责 HIS 打印模板设计和生成：

- 从 Word/docx 参考文档生成可导入 `.xlsx` 模板文件。
- 覆盖主模板、扩展模板、UUID 重生成和 Sheet4 返回参数字段修正。
- thin-index wrapper 暴露 `imedicalxc-doctor-print-template-design` 入口。

常用 skill：

- `imedicalxc-doctor-print-template-design`

## 推荐接入流程

完成 `.agents/` clone 只代表能力包已进入业务项目，不代表项目上下文已完成。

推荐顺序：

1. 安装或更新 `.agents/`；首次安装时使用上文网络安装命令，已部署项目按 `.agents/docs/update-agents.md` 执行 runbook。
2. 读取 `project-context-maintenance`，初始化或维护项目上下文。
3. 检查业务项目根目录 `AGENTS.md`；若缺失或过期，由项目上下文维护流程补齐或更新，不作为安装 `.agents/` 的前置阻塞。
4. 根据项目成熟度设置 `contextMode`：
   - `codebase-complete`：本地代码基本完整。
   - `intent-first-on-demand-export`：代码零散、刚新建，或后续按需导出文件。
5. 生成或维护：
   - `.agents/config/project_context_profile.md`
   - `.agents/rules/project.md`
   - `.agents/memory/project-memory.md`
6. 先 dry-run，再 write 生成 `agent-context-kit` thin-index。
7. 查看 `.agents/config/plugin_profile.md`；未启用插件保持 `available`，不要自动生成它们的 thin-index。
8. 按需要初始化 `coding-iris-plugin`、`i18n-iris-plugin`、`iris-interface-dev-plugin`、`imedicalxc-doctor-extend-engineer`、`imedicalxc-doctor-perf-analysis-engineer`、`imedicalxc-doctor-data-extraction`、`imedicalxc-doctor-print-template-design`。
9. 如需启用提交前差异降噪 hook，由用户在业务项目根目录显式运行 `.agents/scripts/install-git-hooks.ps1 -ProjectRoot .`；安装/更新 `.agents` 只分发 hook 模板和脚本，不自动修改 `core.hooksPath`。
10. 按需要读取 `agents/agent-registry.md` 和 `workflows/workflow-registry.md` 使用顶层智能体。

业务项目事实写入业务项目自己的上下文层，不写入本仓库插件或维护记忆。

## 生成层与 Git 边界

`.agents/` 是独立 Git 仓库时，目标工程本地生成层应写入 `.agents/.git/info/exclude`：

```gitignore
/config/
/memory/
/rules/
/skills/
/scripts/
```

不要把 `/agents/` 或 `/workflows/` 加入 `.agents/.git/info/exclude`。它们是能力包正式内容，应随 `.agents` 更新。

如果业务项目需要私有 Agent 或 workflow 差异：

- 项目事实和选择写入 `.agents/config/agent_*_profile.md`。
- 项目长期规则写入业务项目 `AGENTS.md` 或 `.agents/rules/project.md`。
- 临时交接报告写入业务项目 `docs/agent-reports/`，是否入库由业务项目决定。
- 通用修正先去工程化，再提交回 `imedical.agents`。

## Thin-Index

已启用插件默认采用 `plugin-reference-thin-index`：

1. 插件保留在 `.agents/plugins/<plugin-name>/`。
2. 在 `.agents/rules/` 和 `.agents/skills/` 生成浅层入口。
3. Agent 读到 thin-index 后必须继续读取插件真实文件。

未启用插件即使目录存在，也只作为 `available` 能力展示，不生成浅层入口。

插件 thin-index 生成逻辑只维护根：

```text
scripts/generate-plugin-thin-index.ps1
```

插件内同名脚本只能作为 wrapper 转发参数。Agent thin-index 使用独立 `scripts/generate-agent-thin-index.ps1`，不复用 plugin thin-index 逻辑。

## 安全边界

- 不写服务器地址、账号、密码、token、namespace、远程路径或任何敏感连接信息。
- 连接事实只放目标工程 `.mcp.json`。
- 非敏感项目差异写目标工程 `.agents/config/`。
- 插件、agents、workflows 只保存通用规则、流程、模板和脚本。
- 不把业务项目私有事实写入本仓库维护记忆。

## 维护约定

- 维护本仓库自身时，优先读取根 `AGENTS.md` 和 `skills/agent-kit-maintenance/SKILL.md`；该 skill 位于根 `skills/` 下，但通过安装/更新 sparse checkout 排除，不部署到业务项目 `.agents/`。如果历史部署已经遗留 `.agents/skills/agent-kit-maintenance/`，运行 `.agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write` 会清理该目录。
- 新增长期通用能力时，先判断应放入 `agents/`、`workflows/`、`plugins/`、`rules/`、`references/`、`skills/`、`templates/` 还是 `scripts/`。
- 修改插件目录结构时，同步检查 `.agents-plugin/plugin.json`、插件 `AGENTS.md`、插件 README、仓库 README 和相关 docs。
- 提交插件能力变更时，同步检查并按需更新插件 `AGENTS.md`、插件 README、manifest、相关 skill/rule/reference/template、仓库 README、维护记忆、相关 docs 和测试；不要只提交插件实现而遗漏说明、记忆或验证入口。
- 如果插件变更影响业务项目安装、更新、thin-index、vendor 同步、启用状态或兼容清理，必须同步更新 runbook 或测试，并说明已部署项目的处理方式。
- 对已部署业务工程有影响的变更，必须说明同步步骤和兼容清理策略。
- 历史文件不为风格统一单独重命名；只有在明确迁移窗口中才同步 stale 清理、README、AGENTS 和引用。

## 展示页与双远端同步

当前仓库同时维护两个远端：

- `origin`：Gitee 主仓库，日常维护、业务项目 `.agents` 部署和安装脚本以此为准。
- `github`：GitHub 镜像仓库，主要用于 GitHub Pages 发布展示页。

展示页：[https://skylercook.github.io/imedical.agents/](https://skylercook.github.io/imedical.agents/)

提交后分别推送：

```powershell
git push origin master
git push github master
```

如果其中一个远端失败，先处理失败原因，不要在另一个平台手工补提交，避免历史分叉。
