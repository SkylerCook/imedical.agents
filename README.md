# imedical.agents

`imedical.agents` 用于沉淀和管理 imedical 开发过程中的 AI Coding 能力，包括工程规则、可复用 skill、插件、模板和辅助脚本。

本仓库面向长期维护的 Code Agent 工作区：让不同 Agent 能快速获得正确上下文，同时避免把通用规则、项目差异、连接信息和临时经验混在一起。

## 项目结构

```text
imedical.agents/
|-- docs/      # AI Coding 工作区规范和配套文档
|-- rules/     # 预留仓库级通用规则；当前通用规则主要沉淀在插件内
|-- skills/    # 仓库级通用 skill
|-- plugins/   # 可复用插件能力包
`-- scripts/   # 通用部署脚本；领域脚本放入对应插件
```

主要内容：

- `docs/ai-coding-workspace-kit-v0.1.3.md`：定义可迁移的 AI Coding 工作区结构、插件模式和 thin-index 约定。
- `skills/reusable-content-packaging/`：将已验证规则、流程、模板或脚本打包为可复用插件的通用流程。
- `plugins/agent-context-kit/`：初始化和维护 Agent 项目上下文的通用插件。
- `plugins/coding-iris-plugin/`：面向 IRIS/ObjectScript/CSP/JavaScript/HISUI 工程的编码插件。
- `plugins/i18n-iris-plugin/`：面向 IRIS/ObjectScript/CSP/HISUI 工程的国际化插件。

## 插件概览

### coding-iris-plugin

`coding-iris-plugin` 提供 IRIS 工程编码相关能力：

- ObjectScript 后端编码规则。
- CSP、JavaScript、CSS、HISUI 前端编码规则。
- 本地优先、按需 MCP/SFTP 上传或编译的工作流约束。
- UTF-8 前端文件转换为 GB2312 的上传和提升流程。
- HISUI 控件参考按需读取入口。

常用 skill：

- `coding-iris-init`：初始化目标工程的 IRIS 编码支持。
- `iris-coding`：统一处理 IRIS/ObjectScript/CSP/JavaScript/HISUI 编码需求，并按范围路由到后端、前端、工作流或 GB2312 promote 流程。
- `iris-backend-coding`：处理 IRIS/ObjectScript 后端编码任务。
- `iris-frontend-coding`：处理 CSP、JavaScript、CSS、HISUI 前端编码任务。
- `iris-frontend-gb2312-promote`：将转换后的 `{name}.gb2312.{ext}` 文件确认提升回原文件名，并可选上传。

### i18n-iris-plugin

`i18n-iris-plugin` 提供 IRIS 工程国际化相关能力：

- 前后端 i18n 编码改造。
- 用户可见文本提取和翻译表生成。
- 页面级非字典翻译种子生成。
- 字典/表字段展示值翻译 SQL 生成。
- XML 打印模板翻译。
- CSP 页面翻译导出、校验和同步。
- 新工程 i18n 初始化。

常用 skill：

- `i18n-project-init`：初始化目标工程的 i18n 支持。
- `i18n-coding`：执行前后端国际化编码改造。
- `i18n-text-extract`：提取程序文件中需要翻译的用户可见文本。
- `i18n-page-trans-seed`：生成页面级非字典翻译种子。
- `i18n-bdp-trans-seed`：生成字典/表字段展示值翻译 SQL。
- `i18n-csp-trans-sync`：导出、校验和同步 CSP 页面翻译。
- `i18n-xml-template`：翻译 XML 打印模板文本。
- `i18n-xml-print-template-sync`：在已确认存在 XML 模板记录的打印链路中，导出、校验、同步目标语言 XML 打印模板。

## 推荐接入方式

插件默认采用 `plugin-reference-thin-index` 模式：

1. 将插件放入目标工程 `.agents/plugins/<plugin-name>/`。
2. 首次初始化时，直接读取插件内 bootstrap skill，例如：
   - `.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`
   - `.agents/plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md`
3. 根据插件模板生成目标工程 profile：
   - `.agents/config/iris_project_profile.md`
   - `.agents/config/i18n_project_profile.md`
4. 目标工程 `.mcp.json` 作为 MCP、SFTP、IRIS 连接事实来源。
5. 运行插件内置 thin-index 脚本，在目标工程 `.agents/rules/` 和 `.agents/skills/` 生成浅层入口。
6. 日常任务通过浅层 rule/skill 入口触发，Agent 读到 thin-index 后继续读取插件真实文件。

## 在业务项目中部署到 `.agents/`

如果只给 Agent 本地使用，不希望 `.agents/` 进入业务项目版本库，推荐在业务项目根目录执行一键部署脚本。

脚本会把本仓库作为独立 Git 仓库克隆到业务项目 `.agents/` 目录，并通过 sparse checkout 只检出 Agent 运行需要的目录：`docs/`、`rules/`、`skills/`、`plugins/` 和根 `scripts/*.ps1`。其中 `rules/` 是预留入口，只有存在已跟踪规则文件时才会实际出现在目标工程 `.agents/` 中；`scripts/tests/` 只服务能力包仓库自测，不部署到业务项目 `.agents/`；仓库根目录 `memory/` 是维护者记忆，也不部署到业务项目 `.agents/`。根目录 `README.md`、`LICENSE` 等说明性文件也不会保留在业务项目 `.agents/`。如果旧版本脚本或手工全量 clone 已经把这些根目录说明文件或维护者记忆拉到 `.agents/`，重新执行安装脚本会刷新 sparse checkout 并清理它们。

如果希望大模型托管安装或更新，让 Agent 读取 `.agents/docs/update-agents.md` 并按 runbook 执行；例如对支持文件引用的工具可以说：`@.agents/docs/update-agents.md 帮我安装/更新 .agents`。该 runbook 是 Agent 执行入口，README 只保留人工速查命令。

快速执行：

```powershell
iwr -UseBasicParsing https://gitee.com/skyler-cook/imedical.agents/raw/master/scripts/install-agents.ps1 | iex
```

如需先审阅脚本内容，再执行：

```powershell
iwr -UseBasicParsing https://gitee.com/skyler-cook/imedical.agents/raw/master/scripts/install-agents.ps1 -OutFile install-agents.ps1
notepad .\install-agents.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-agents.ps1
```

脚本逻辑等价于：

```text
首次执行：clone imedical.agents 到 .agents/，并启用 sparse checkout。
重复执行：在 .agents/ 内 fetch --prune、pull --ff-only，然后刷新 sparse checkout。
业务项目存在 .git 时：自动把 .agents/ 写入业务项目 .gitignore。
.agents 内部：自动把本地生成层写入 .agents/.git/info/exclude。
AGENTS.md 是必须存在的工程级唯一主入口；缺失时安装脚本停止。
CLAUDE.md、CODEBUDDY.md 只是可选兼容 symlink；安装脚本不会自动创建、复制或修复它们。
```

### 同步已部署 `.agents`

能力包更新后，已部署业务工程优先在业务项目根目录执行统一更新脚本。脚本默认采用半自动稳妥策略：先拉取 `.agents/` 独立仓库、扫描已安装插件、dry-run 重建 thin-index，并报告兼容入口、生成层 ignore 和配置合并风险。

如果由大模型托管更新，优先让 Agent 读取 `.agents/docs/update-agents.md`，由它判断 `DryRun` 输出是否可以自动进入 `Write`。

推荐先 dry-run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 `
  -ProjectRoot . `
  -Mode DryRun
```

确认输出后再写入：

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
- `-ForceThinIndex`：将 `-Force` 传给 thin-index 生成脚本。
- `-Detailed`：输出每一条检查明细；日常不加该参数，只看摘要即可。

`.agents/config/` 是目标项目事实和选择的承载层，更新时只允许合并，不允许直接覆盖。模板新增字段时，脚本在配置文件末尾追加待确认配置项；已存在字段以目标项目当前值为准；疑似废弃字段只报告 `config-deprecated-candidate`，不自动删除；字段语义变化只报告 `config-review-required`，由 Agent 或人工确认后再改。

如需只重建单个插件的 thin-index，仍可直接调用插件脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/coding-iris-plugin `
  -ProjectRoot . `
  -Mode Write `
  -ExcludeSkill coding-iris-init `
  -Force
```

重建时，canonical 脚本会扫描 `.agents/rules/` 中所有指向 `.agents/plugins/*/rules/*.md` 的 thin-index，并清理源文件已从 `rules/` 移走或被重命名的 stale rule thin-index，包括 `sftp-server.md`、`iris-agentic-dev.md`、`i18n-hisui-widget-index.md` 这类旧命名残留。生成新入口仍只针对当前 `-PluginPath`；项目自己的 `.agents/rules/` 自定义规则不受影响。

部署后，业务项目应忽略 `.agents/`，避免把 Agent 能力包直接提交进业务项目仓库。`.agents/` 内部仍保留自己的 Git 历史；如果需要提交 Agent 能力包变更，在 `.agents/` 目录内单独提交并推送：

```powershell
cd .agents
git status
git add <changed-files>
git commit -m "docs: update agent kit"
git push
```

### 清理 `.agents` Git 列表

`.agents/` 是独立 Git 仓库，VS Code 可能把它作为第二个仓库显示。目标工程生成的 profile、project-env、memory、thin-index 和本地辅助脚本默认不应进入 `.agents` 仓库提交列表。

一键部署脚本会维护 `.agents/.git/info/exclude`，默认忽略：

```gitignore
/config/
/memory/
/rules/
/skills/
/scripts/
```

这些 exclude 规则主要隐藏目标工程本地生成的未跟踪文件；如果已跟踪的能力包文件被修改，仍会正常出现在 `.agents` 仓库的 `git status` 中。已落地过的工程如果仍看到大量未跟踪的 `.agents` 生成文件，重新执行安装脚本即可补齐本地 exclude；也可以手工把上述规则写入 `.agents/.git/info/exclude`。不要写入 `.agents/.gitignore`，否则会污染 `imedical.agents` 能力包仓库的版本规则。

注意：`.git/info/exclude` 不能隐藏已经被 `.agents` 仓库追踪的文件。如果业务项目曾经手工 full clone 本仓库到 `.agents/`，根目录 `memory/agent-kit-maintenance-memory.md` 这类维护者记忆会作为已跟踪文件出现在工作区。处理方式不是只加 ignore，而是重新执行一键部署脚本，让 `.agents` 启用 sparse checkout；脚本会只保留运行需要的目录并移除根目录维护记忆。

### 被忽略文件贡献流程

如果 `.agents/.git/info/exclude` 隐藏的脚本或规则在实际使用中修正了，先判断它是否是可跨项目复用的通用能力。目标项目私有脚本、profile、`project-env.json`、服务器地址、账号、namespace、远程路径等不要提交到能力包仓库。

通用修正可以显式绕过 ignore 暂存，不要移除 `.agents/.git/info/exclude` 里的 `/scripts/`、`/rules/`、`/skills/`：

```powershell
cd .agents
git status --ignored -s scripts/<script-name>.ps1
git diff -- scripts/<script-name>.ps1
git add -f scripts/<script-name>.ps1
git commit -m "fix(scripts): 修正 xxx 脚本"
git push
```

也可以使用辅助脚本只执行强制暂存：

```powershell
cd .agents
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stage-ignored-agent-file.ps1 -Path scripts/<script-name>.ps1
```

该脚本只检查允许路径并执行 `git add -f`，不会自动 commit 或 push。

## Clone 后最佳落地步骤

完成 `.agents/` clone 只代表通用能力包已经进入业务项目，不代表业务项目上下文已经初始化完成。推荐继续按以下顺序落地：

1. 在业务项目根目录执行一键部署脚本，确认 `.agents/` 已存在。
2. 先读取 `.agents/plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md`。
3. 让 Agent 使用 `project-context-maintenance` 初始化或维护业务项目上下文。
4. 生成或维护业务项目自己的上下文文件：
   - 如果没有 `AGENTS.md`，参考 `.agents/plugins/agent-context-kit/templates/AGENTS.template.md` 创建。
   - 如果已有 `AGENTS.md`，不要覆盖；只合并 `.agents/plugins/agent-context-kit/templates/AGENTS.context-snippet.md` 中缺失的入口和路由。
   - 先判断上下文模式：完整工程使用 `codebase-complete`；刚新建、代码零散或后续按需从服务器导出文件的工程使用 `intent-first-on-demand-export`。
   - 按需创建或维护 `.agents/config/project_context_profile.md`，保存项目用途、上下文模式、代码来源和本地文件完整性等非敏感语义配置。
   - 保留已有业务规则、团队约定和项目专属指令，按需创建或维护 `.agents/rules/project.md`、`.agents/memory/project-memory.md`。
5. 先 dry-run 生成 `agent-context-kit` 的 thin-index，确认无冲突后再 write。
6. 如项目需要 IRIS 编码或 i18n 能力，再按需执行 `coding-iris-plugin`、`i18n-iris-plugin` 各自的初始化和 profile 流程。

兼容入口检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/check-agent-entrypoints.ps1 -ProjectRoot .
```

如输出 `missing`、`not-symlink` 或 `wrong-target`，这只是可选兼容入口提示，不阻塞安装或更新。只有用户明确需要兼容入口时，才手工执行 symlink 修复：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/repair-agent-entrypoints.ps1 -ProjectRoot .
```

Windows 也可以手工修复；默认需要管理员 cmd，启用开发者模式后部分环境可免管理员：

```cmd
mklink CLAUDE.md AGENTS.md
mklink CODEBUDDY.md AGENTS.md
```

不要把 `AGENTS.md` 复制成 `CLAUDE.md` 或 `CODEBUDDY.md`，也不要在这些兼容入口里维护第二份规则。

thin-index dry-run：

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

业务项目事实应写入业务项目自己的 `AGENTS.md`、`.agents/rules/`、`.agents/memory/` 和 `.agents/config/`。不要把服务器、账号、密码、token、namespace、远程路径写入插件或项目记忆。

### 按需导出/空壳工程

如果业务项目刚新建、没有完整代码，或用户明确说明“后续需求处理中再按需导出文件”，应按 `intent-first-on-demand-export` 落地：

- `AGENTS.md` 只记录项目定位、上下文状态、按需导出工作流、规则路由和安全边界。
- 不得围绕单个代码文件生成长篇架构说明，也不得把零散文件推断成主模块或完整调用链。
- 无法证明本地代码代表完整工程时，默认按 `intent-first-on-demand-export` 处理；本地已有文件最多列为“当前已导出/已存在文件”。
- `.agents/config/project_context_profile.md` 记录本地代码不代表全量工程事实。
- `.agents/rules/project.md` 记录需求处理前先确认目标页面、类、JS、CSP 或业务对象，再导出相关文件。
- `.agents/memory/project-memory.md` 记录当前工作区状态和已导出文件范围；已导出文件只代表相关需求上下文。

## 安全边界

- 插件只保存通用规则、流程、模板和脚本，不保存目标工程敏感信息。
- 服务器地址、账号、密码、token、namespace、远程路径等连接信息只能存在于目标工程 `.mcp.json`。
- 项目差异、业务约定和非敏感语义配置写入目标工程 `.agents/config/`。
- 不在插件中硬编码业务页面清单、项目专属类名、部署路径或环境信息。
- 涉及文件替换、上传、编译等操作时，以对应 skill 的确认流程为准。

## 维护约定

- 新增长期通用能力时，优先判断应放入 `rules/`、`skills/`、`templates/`、`scripts/` 还是插件目录。
- 已验证、可跨工程复用的能力应去工程化后再进入插件。
- 需要面向目标工程落地的差异配置，应通过 profile 模板表达，不写入插件规则正文。
- 新增命名遵循内部约定：`skills/<skill-name>/SKILL.md` 使用 kebab-case，`rules/<rule_name>.md` 使用 snake_case，`references/<reference-name>.md` 使用 kebab-case，`scripts/<script-name>.<ext>` 使用 kebab-case。
- 历史文件不为风格统一单独重命名；只有在明确迁移窗口中才同步 thin-index stale 清理、README、AGENTS 和 skill 引用。
- 根 `scripts/` 只放通用体系部署脚本；IRIS、i18n 等领域脚本放到对应插件的 `scripts/` 目录。
- thin-index 生成逻辑只维护 `scripts/generate-plugin-thin-index.ps1`；各插件同名脚本只能作为 wrapper 转发参数，避免插件之间产生运行时依赖。
- 独立分发单个插件时，若仍使用 `plugin-reference-thin-index`，必须同时带上根 `scripts/generate-plugin-thin-index.ps1`；否则选择 `copy` 或手工 thin-index。
- 更新插件入口、安装模式或长期决策时，同步更新相关 README、模板和必要的规则说明。

### 展示页与双仓库同步

当前仓库同时维护两个远端：

- `origin`：Gitee 主仓库，日常维护、业务项目 `.agents` 部署和安装脚本仍以此为准。
- `github`：GitHub 镜像仓库，主要用于 GitHub Pages 发布根目录 `index.html` 展示页。

展示页地址：[https://skylercook.github.io/imedical.agents/](https://skylercook.github.io/imedical.agents/)

根目录 `index.html`、`.github/` 和 `.nojekyll` 只服务于展示页和 GitHub Pages。现有一键部署脚本通过 sparse checkout 只检出 `docs/`、`rules/`、`skills/`、`plugins/`、`scripts/`，不会把这些展示页文件部署到业务项目 `.agents/`。

日常仍在 VS Code 本地修改并提交，不在 Gitee 或 GitHub 网页上直接改代码。提交后分别推送两个远端：

```powershell
git status
git push origin master
git push github master
```

如果只想一条命令顺序同步两个远端，可在 VS Code 终端执行：

```powershell
git push origin master; git push github master
```

若其中一个远端推送失败，先处理失败原因，不要在另一个平台手工补提交，避免两边历史分叉。
