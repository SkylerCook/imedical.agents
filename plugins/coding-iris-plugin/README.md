# coding-iris-plugin

`coding-iris-plugin` 是面向 IRIS/ObjectScript/CSP/JavaScript/HISUI 工程的通用 Agent 编码能力包。

## 能力范围

- ObjectScript 后端编码规则：BLH/DATA/SQL 分层、SQL 返回约定、ObjectScript 语法风格、Broker 接口习惯。
- CSP/JavaScript/HISUI 前端编码规则：框架页/内容页拆分、HISUI 控件优先、JS 组织方式、前端数据回显。
- 工作流规则：本地优先；导出、编译、Broker 调试和配置同步优先使用 IRIS 开发主力脚本；MCP 作为辅助能力补上下文、只读验证或覆盖脚本未覆盖场景。
- 部署编排：`skills/iris-deploy/SKILL.md` 负责远端部署入口、清单生成、确认门禁和验证编排，上传、编译、部署和远端验证按 `rules/iris_deploy_checklist.md` 逐项执行。
- 需求移植：`skills/iris-demand-promote/SKILL.md` 将已提交的 DEV 需求补丁移植到独立 PRD 按需导出仓库；先导出 PRD 服务器基线，再做三方应用，只创建本地 PRD 提交。
- 需求提交：`skills/iris-demand-commit/SKILL.md` 为已完成的标版/项目需求生成方案型提交信息；标版提交前强制安全快进，项目兼容纯本地仓库，任何 commit 均需用户明确授权且不包含 push。
- 前端统一编码：当前标版、医院项目的源码、上传内容和服务器运行编码统一使用 canonical `utf8`。
- 前端编码保护：实际文件字节检测是最终门禁；正常任务静默处理，完成时只报告一行摘要。
- 前端 i18n 条件门禁：以目标工程 `plugin_profile.md` 为事实来源，只有 i18n 已启用且任务或 diff 命中翻译 helper、翻译 key 或用户可见文案时才追加 i18n 规则和稳定 key 检查；普通前端需求不加载完整 i18n workflow。
- 兼容读取：旧 `project-utf8` 规范化为 `utf8`；旧 `standard-gb2312` 只服务用户明确指定的历史工程，不能再由目录或仓库角色推断。
- Backend-only：Overlay manifest 明确只声明 `backend`、未声明 `frontend` 时，profile 规范化为 `N/A (backend-only)`，不扫描父目录或 sibling 猜测前端源码。
- Legacy GB2312 提升：仅在明确的历史工程中，确认后删除源文件并将 `{name}.gb2312.{ext}` 更名回原文件名，可选 MCP/SFTP 上传。
- HISUI 控件参考：控件选型、API 和 JavaScript 行为按需读取 `references/hisui-widget-index.md`。
- HISUI 样式与资源参考：主题 CSS、locale CSS、语义 class、图标和插图按需读取 `references/hisui-style-index.md`；源码内置在 `.agents/vendor/hisui/`。
- iris-agentic-dev MCP server：Windows x64 可执行文件内置在 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe`，目标工程无需自行查找工具位置。
- IRIS 开发主力脚本：通过 `scripts/iris-tools/` 提供部署清单生成、导出、编译、Broker 调试和环境配置同步。
- MCP 能力说明：`rules/iris_agentic_dev.md` 记录 IRIS MCP 能力矩阵，`rules/sftp_server.md` 记录 SFTP MCP 能力矩阵和安全边界。
- IRIS 知识查询：`skills/iris-mcp-lookup/SKILL.md` 统一路由当前实例元数据、本地源码和官方文档，支持已知 `docs.intersystems.com` URL 的 Fetch/WebFetch/Open 等价能力。
- 官方 ObjectScript skills：从 `iris-agentic-dev` v1.2.6 固定快照选择 8 个通用 skill，部署在 `.agents/vendor/iris-agentic-dev-skills/`，全部按 optional capability 触发，不默认生成浅层入口。

## 标准目录

```text
coding-iris-plugin/
|-- .agents-plugin/
|   `-- plugin.json
|-- AGENTS.md
|-- README.md
|-- references/
|-- rules/
|-- skills/
|-- templates/
`-- scripts/
```

## 安装模式

默认使用 `plugin-reference-thin-index`：

1. 将本插件放到目标工程 `.agents/plugins/coding-iris-plugin/`。
2. 首次初始化时直接读取 `.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`。
3. 初始化/迁移流程在目标工程 `.agents/scripts/` 生成编码脚本薄 wrapper，实际实现由插件 canonical 脚本维护。
4. 初始化流程直接调用插件内置 `scripts/generate-plugin-thin-index.ps1`；该脚本是 wrapper，实际委托根 `scripts/generate-plugin-thin-index.ps1`。
5. 初始化流程根据 `templates/iris_project_profile.template.md` 生成或提示创建 `.agents/config/iris_project_profile.md`。
6. 在浅层 `.agents/rules/` 和 `.agents/skills/` 生成 thin-index。

规则 thin-index 会传播源 rule 的 `description` 和 `task-affinity`，用于浅层发现和任务筛选。`task-affinity` 只是路由提示；匹配后仍必须继续读取 thin-index 中 `source` 指向的插件真实 rule。`references/` 只由真实 rule/skill 按需引用，不生成浅层 `.agents/rules/` 入口。

Skill thin-index 会传播真实 `SKILL.md` 的 `description`，用于浅层能力发现；匹配后仍必须继续读取 `source` 指向的插件真实 `SKILL.md`。

默认 dry-run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/coding-iris-plugin `
  -ProjectRoot . `
  -Mode DryRun `
  -ExcludeSkill coding-iris-init
```

确认后写入：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/coding-iris-plugin `
  -ProjectRoot . `
  -Mode Write `
  -ExcludeSkill coding-iris-init
```

`coding-iris-init` 是 bootstrap skill，默认从 thin-index 排除，避免安装完成后再次触发安装流程。

### 更新已部署工程

已部署过 `.agents/` 的业务工程，先在业务项目根目录重新执行 imedical.agents 一键部署脚本，使 `.agents/` 独立仓库拉取最新插件内容；再重建本插件 thin-index：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/coding-iris-plugin/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/coding-iris-plugin `
  -ProjectRoot . `
  -Mode Write `
  -ExcludeSkill coding-iris-init `
  -Force
```

workspace-overlay 模式不在每个模块中重复拉取插件：先更新共享 `CapabilityRoot`，再从 capability 脚本入口用 `-NoPull` 刷新模块 `ContextRoot`。IRIS 工具统一解析 workspace context：`project-env.json` 与 profile 来自 `ContextRoot`，插件/模板/vendor 来自 `CapabilityRoot`，源码操作限制在声明的 SourceRoot，`--from-git` 在各自 GitRoot 执行并映射回 WorkspaceRoot 逻辑路径。前端编码迁移只扫描 `sourceRoots[name=frontend]`；明确只有 `backend` 时写入 `N/A (backend-only)`，无法从 manifest 判定业务类型时才要求人工复核，全程不扫描父目录或 sibling。

重建脚本委托根 canonical thin-index 脚本执行：生成阶段只处理当前 `PluginPath`，stale 清理阶段会扫描 `.agents/rules/` 中所有指向 `.agents/plugins/*/rules/*.md` 的 thin-index，并移除源文件已不存在的旧 rule 入口，例如迁移到 `references/` 的 HISUI 控件参考入口。目标工程自定义规则不会被清理。

## 接入目标工程

1. 将 `templates/AGENTS.coding-iris-snippet.md` 合入目标工程 `AGENTS.md`。
2. 基于 `templates/iris_project_profile.template.md` 创建 `.agents/config/iris_project_profile.md`。
3. 检查目标工程 `.mcp.json` 是否包含实际需要的 IRIS/SFTP 能力。
4. 运行 thin-index dry-run，确认无冲突后再 write。
5. 普通编码任务优先使用 `iris-coding` 统一入口，由它按任务范围路由到后端、前端、工作流或 promote 流程。
6. 需求完成后由 `iris-coding` 路由 `iris-demand-commit`：从 profile 读取 `standard/project` 默认值；`TODO` 必须提示用户补全，不能自动提交。
7. 明确的纯后端任务可直接使用 `iris-backend-coding`，明确的纯前端任务可直接使用 `iris-frontend-coding`。
8. 明确要求部署、上传、编译、SFTP 同步、CSP 编译或远端部署验证时，使用 `iris-deploy`。
9. 用户明确处理历史 GB2312 工程，并要求把转换文件替换源文件时，使用 `iris-frontend-gb2312-promote`。
10. 查询 IRIS 类、方法签名、宏、SQL 元数据或官方文档时，使用 `iris-mcp-lookup`。

## IRIS 知识查询与官方 vendor skills

`iris-mcp-lookup` 默认只读，按问题选择：

- `iris_symbols` / `docs_introspect`：当前实例类、方法、签名与继承关系。
- `iris_symbols_local`：本地 `.cls/.mac/.inc`。
- `iris_doc mode=get/head`：当前实例中的类或例程文档；它不用于查询官方文档站。
- 当前运行器网页读取能力：已知 `docs.intersystems.com` URL；Claude Code 可显示为 `Fetch` / `WebFetch`。
- `iris_doc_search`：只有当前 `tools/list` 实际包含该工具时才使用；内置 v1.2.6 已复核包含该工具。

内置 v1.2.6 的完整合并 toolset 已复核为 78 个工具；helper 与新生成的 `.mcp.json` 默认使用 `--no-skills` 后为 67 个。新增多实例、跨环境比较、持久会话、namespace/database、journal/audit、HL7、Mermaid 和 Storage 解析等能力，具体边界见 `rules/iris_agentic_dev.md`。`iris_coverage` 仍属于远端测试/监控能力，不属于知识查询默认路径；使用前必须取得任务级授权并确认 IRIS `gmheap >= 256 MB`。

官方 vendor skills 来源和 commit 见 `.agents/vendor/iris-agentic-dev-skills/UPSTREAM.md`。当前选择：

- `objectscript-review`
- `objectscript-guardrails`
- `objectscript-sql-patterns`
- `objectscript-list-patterns`
- `objectscript-navigation`
- `objectscript-unit-test`
- `objectscript-debugging`
- `objectscript-tdd`

它们在 manifest 中均为 optional。任务命中后直接读取 `.agents/vendor/iris-agentic-dev-skills/skills/<name>/SKILL.md`；上游原文中的工具名可能与内置 MCP 版本不同，执行前必须读取 `rules/iris_knowledge_lookup.md` 并按当前 `tools/list` schema 映射。`objectscript-tdd` 只有在任务已授权远端编译和测试时才能触发。

已部署业务工程更新 `.agents` 后，重新为 enabled `coding-iris-plugin` 生成 plugin thin-index，即可获得 `iris-mcp-lookup`、`iris-demand-promote`、`iris-demand-commit` 与 `iris_knowledge_lookup` 浅层入口。更新器同时执行 `demand-delivery-type-v1`：从明确项目上下文填充 `standard/project`，无法确定时写入 `TODO` 并提示用户补全。optional vendor skills 不会自动生成浅层入口；需要用户级运行时副本时，按 `docs/update-agents.md` 显式选择具体 skill 和 runtime。

## IRIS 开发主力脚本

`scripts/iris-tools/` 中的 Node.js 脚本是 IRIS 工程的首选执行路径：

- `export.js`：从 IRIS 导出 `.cls/.mac/.inc/.int/.js/.csp/.css`；支持 `--probe --json` 只读探测和 `--staging-dir` 临时导出。
- `promote-demand.js`：按需求号执行 DEV→PRD 的 plan/apply/continue/verify；同名仓库按 DEV/PRD 绝对路径身份隔离临时计划，`continue` 重新校验双方 HEAD 并拒绝未暂存或未跟踪状态。不同需求号的独立 DEV 提交强制分别形成 PRD 提交，只有 `fix(123,456):...` 这类 DEV 联合需求提交才允许保留为一笔；独立需求共享文件时，用 `--prior-plan` 链接上一笔已验证计划。本脚本不上传、编译或部署远端。
- `commit-demand.js`：按需求文件解析 GitRoot，生成标版三行或项目两行提交信息；“修改说明”必须交代修改对象、具体方案和行为结果。`apply` 仅在用户明确授权后执行，先完成全部仓库的 `pull --ff-only` 门禁，再提交精确路径，不自动 stash/rebase/merge/reset，不执行 push。
- `compile.js`：上传并编译本地类文件；在 workspace-overlay 中同时接受 `backend/src/...` 逻辑路径，并把远端文档名规范化为不含 `backend/src` 前缀的类文档名。
- `debugger.js`：调用 Web Broker 方法做快速调试。
- `sync-env-config.js`：仅当 `.agents/config/project-env.json` 是事实来源时，从它生成 `.mcp.json`。
- `prepare-deploy-manifest.js`：根据文件列表或 git diff 生成 IRIS 部署 JSON 清单；只做本地分析，不执行上传、编译或远端写入。

目标工程 `.agents/scripts/iris-mcp.js` 是通用 MCP helper，用于在 Agent 环境未直接暴露 IRIS MCP 工具时稳定启动 `iris-agentic-dev`、执行 `check_config`、列出工具和转发 `tools/call`。该脚本不实现业务能力；`iris_doc`、`iris_query`、`iris_info` 等能力仍由 MCP server 自身处理。helper 会摘要版本、连接、`check_config.capabilities` 和 fallback 风险，显式分类 v1.2.6 的 78 个工具，并按 `mode` / `action` 精确拦截文档编辑、SQL 写入、Global 写删、namespace 创建、多实例注册变更、持久会话、容器切换、SCM 变更、测试、覆盖率等远端状态变化；尚未分类的未来工具默认也进入授权门禁，只有用户明确要求后才允许使用 `--allow-write`。

新生成配置默认 `mcp.includeBuiltInSkills=false`，对应 `--no-skills` / `IRIS_NO_SKILLS=true`，避免上游 skill registry、KB 和学习工具与本仓库 vendor skills 重复。确需这些内置工具时，只在目标工程本地把该字段设为 `true`。如需进一步减少工具噪声或从 MCP 暴露面隐藏高风险工具，可在目标工程私有 `.iris-agentic-dev.toml` 中设置 `disabled_tools`，或通过 `.mcp.json` 的本地 `env` 设置 `IRIS_DISABLED_TOOLS`。这不会自动授予其余工具写权限，也不会修改插件 profile。

首次使用前先确认配置事实来源：

- 已有 `.mcp.json`：从 `.mcp.json` 反向生成或补齐 `.agents/config/project-env.json`，不要运行 `sync-env-config.js` 覆盖现有 `.mcp.json`。
- 没有 `.mcp.json`：复制模板并填写真实环境；模板默认使用内置 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe` 作为 `mcp.serverPath`，再运行 `sync-env-config.js` 生成 `.mcp.json`。

```powershell
New-Item -ItemType Directory -Force .agents/config
Copy-Item .agents/plugins/coding-iris-plugin/templates/project-env.template.json .agents/config/project-env.json
notepad .agents/config/project-env.json
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js
```

常用调用：

```powershell
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <文件标识符>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js <文件名或路径> [命名空间]
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --class <ClassName> --method <MethodName>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js --files <path...>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js --from-git --base HEAD
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/promote-demand.js plan --demand <id> --dev-root <path> --prd-root <path>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/commit-demand.js plan --project-root <path> --kind <standard|project> --demand <id> --title <title> --type <type> --file <path> --modification <description>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/promote-demand.js plan --demand <next-id> --dev-root <path> --prd-root <path> --prior-plan <verified-plan.json>
node .agents/scripts/iris-mcp.js check
node .agents/scripts/iris-mcp.js call iris_doc "{...}"
```

`.agents/config/project-env.json` 和 `.mcp.json` 可能包含账号、密码、服务器地址等敏感信息，应由目标工程本地维护，不提交到业务项目版本库。

## Legacy 前端 GB2312 提升流程

只有用户明确处理尚未迁移到当前 UTF-8 标准的历史工程，并要求把 UTF-8 前端源文件永久转换为 GB2312 时：

1. 使用 `iris-frontend-gb2312-promote`。
2. 该技能调用目标工程 `.agents/scripts/convert-gb2312-upload.ps1`。
3. 转换后先展示 JSON 结果。
4. 用户确认后，删除源文件并将 `{name}.gb2312.{ext}` 重命名为原文件名。
5. 用户再次确认后，才通过 MCP/SFTP 上传替换后的原文件。

## 前端编码保护

当前前端编码以目标工程 `.agents/config/iris_project_profile.md` 的 canonical `utf8` 为准；`project-utf8` 仅作为兼容读取别名，`standard-gb2312` 仅作为用户明确指定的历史工程状态。每个文件修改前后仍必须通过实际字节检测。

前端流程同时读取 `.agents/config/plugin_profile.md`：只有 `i18n-iris-plugin` 状态为 `enabled` 且修改前或最终 diff 命中 `$g`、`$trans`、翻译 key、用户可见文案或 `placeholder` / `title` / `tooltip` / `alt` 时，才追加 i18n profile、规则与 helper 静态检查。明确 i18n 需求切换到 `i18n-coding`；普通业务需求只应用轻量门禁，不自动进入完整 workflow。未启用 i18n 时不猜测 helper 语义，也不因插件目录存在而加载能力。

明确的 backend-only Overlay 不适用前端字节门禁，profile 固定使用 `N/A (backend-only)`，前端导出入口会明确停止且不写 source/staging。若 manifest 后续新增 `frontend` SourceRoot，必须重新运行迁移并通过 UTF-8 字节检测，不能手工把 N/A 直接改成 `utf8`。

当前 `utf8` 收尾检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/check-frontend-encoding.ps1 -Files @(
  "path/to/page.csp",
  "path/to/page.js"
) -ExpectedEncoding utf8 -ErrorOnMismatch
```

通过后直接上传原始 UTF-8 源文件，不运行 GB2312 转换器。正常任务最终只报告“模式、文件数、保持编码”一行；检测到 GB2312、UTF-16、unknown、mixed 或配置冲突时停止并展开诊断。

## 去项目化边界

本插件不保存服务器地址、namespace、账号、密码、token、远程路径、业务页面清单、业务类名前缀或项目专属基类。这些内容只能存在于目标工程 `.agents/config/iris_project_profile.md` 或 `.mcp.json`。
## 部署可靠性要点

- 持久化实体类上传前去掉整个 `Storage Default { ... }` 块，由 IRIS 编译重新生成 Storage。
- 类文件部署先整组上传依赖切片，再按依赖顺序编译；不要边上传边逐个编译。
- 当前前端文件通过 UTF-8 门禁后直接上传原始源文件，不生成编码转换临时件。
- Legacy GB2312 转换只用于用户明确指定的历史工程；临时件远端文件名仍映射回原始目标文件名，不能据此推断当前标版仍使用 GB2312。
- CSP 编译使用 WebApp 虚拟路径 `$system.OBJ.Load("<web-app-virtual-root>/csp/<file>.csp","c")`，并检查内层 status、生成类、`CSPFILE`、`CSPURL`。
- 插件不保存服务器地址、账号、namespace、token、Cookie 或远端绝对路径。

## 脚本配置来源

脚本运行所需环境值统一来自目标工程本地私有文件 `.agents/config/project-env.json`：

- `iris.namespace`：类上传、编译、导出使用的 IRIS namespace；脚本不提供项目化默认值。
- `web.basePath`：IRIS Atelier doc API 下的 Web 根前缀，用于 JS/CSS/Broker 路径。
- `web.cspBasePath`：IRIS Atelier doc API 下的 CSP 前缀，通常是 `<web-root-prefix>/csp`。
- `web.brokerPath`：Broker 请求路径；未配置时仅在 `web.basePath` 已配置时使用 `csp/websys.Broker.cls`。
- `web.cookie`：可选 Broker 调试 Cookie；也可用 `debugger.js --cookie "<cookie>"` 临时传入。Cookie 属于敏感值，只能放在本地私有配置或命令行临时参数中。

缺少必要配置时脚本应直接报错，避免静默拼出错误路径。
