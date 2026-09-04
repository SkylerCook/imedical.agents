# imedical.agents 长期维护决策

本文件记录 `imedical.agents` 能力包仓库的长期决策和稳定边界。当前状态摘要见 `agent-kit-maintenance-memory.md`，近期维护流水见 `agent-kit-maintenance-log.md`，后续计划见 `agent-kit-maintenance-backlog.md`。

## 内容分层

- `agents/` 放厂商无关的智能体 canonical 定义，包括 agent registry、`AGENT.md`、`bindings.yaml` 和共享交接协议；不放工具专属生成物或业务项目私有事实。
- `workflows/` 放厂商无关的多智能体/阶段化 workflow canonical 定义，包括 workflow registry 和 `*.workflow.md`；workflow 必须支持不具备子代理能力时的单 Agent 串行降级。
- `rules/` 只放长期约束、工作流规则和任务路由，不放大体量查找表、API 目录或源码索引。
- `references/` 放按需查阅的参考资料，例如查找表、控件/API 目录和源码索引；默认不参与 rule thin-index 生成。
- `vendor/` 放第三方源码资产、共享运行时资产和 vendor skill fallback（如 HISUI dist、iris-agentic-dev Windows x64 可执行文件、superpowers、word-reader）；只为 enabled 插件声明的 required vendor skill 生成项目 thin-index。
- `skills/` 负责任务流程编排，必要时按任务类型读取对应 rules 或 references。
- `scripts/` 放可复用自动化；插件专属脚本放在对应插件目录，不复制到共享脚本目录，除非插件初始化流程明确要求。
- 维护记忆只写摘要、状态、决策和下一步，不复制完整规则、长段脚本说明或一次性命令输出。
- 工具专属入口只作为 adapter 生成物，例如 `.codex/agents/`、`.claude/agents/`、`.opencode/`、`.codebuddy/agents/` 或 Hermes/WorkBuddy 入口映射；adapter 可删除重建，不反向成为规则源。

## 命名约定

- skill 目录使用 kebab-case。
- rule 文件使用 snake_case，即单词间使用 `_`，例如 `i18n_verify.md`、`i18n_link_tracing.md`、`iris_coding_frontend.md`。
- reference 文件使用 kebab-case。
- script 文件使用 kebab-case。
- 智能体目录使用 kebab-case + `-agent` 后缀，例如 `coordinator-agent`、`i18n-agent`。
- 智能体主定义固定为 `AGENT.md`，绑定索引固定为 `bindings.yaml`。
- workflow 文件使用 kebab-case + `.workflow.md` 后缀，例如 `i18n-change.workflow.md`、`standard-change.workflow.md`。
- 交接报告模板使用 kebab-case + `.template.md` 后缀，例如 `fact-report.template.md`。
- 插件包目录和 manifest `name` 使用稳定能力包名，允许采用“能力/对象 + 技术域 + plugin/kit”的历史命名，例如 `agent-context-kit`、`coding-iris-plugin`、`i18n-iris-plugin`；已部署插件目录名不为风格统一重命名。
- 插件内部 skill 名优先面向任务触发，采用“技术域/对象 + 任务”的 kebab-case，例如 `project-context-maintenance`、`iris-coding`、`iris-backend-coding`、`iris-frontend-coding`、`i18n-coding`、`i18n-page-trans-seed`。
- bootstrap 初始化 skill 可保留历史插件名前缀，例如 `coding-iris-init`、`i18n-project-init`；如需改名，先新增兼容入口并说明迁移策略，不直接替换。
- rule 名以规则所属技术域为前缀并使用 snake_case，例如 `iris_coding_*`、`i18n_*`；规则文件常作为规则索引、thin-index 文件名和 Markdown 链接目标，继续使用 `_`，不要为了匹配插件目录名或 skill 的 kebab-case 把已稳定 rule 改成另一套前缀。
- 对外文档中应明确区分：插件包名是部署和能力包边界，skill 名是 Agent 触发入口，rule 名是规则路由入口；三者不要求字面顺序完全一致，但同一插件内新增项必须沿用既有主轴。
- 历史文件不为风格统一单独重命名；只有在明确迁移窗口中才同步 thin-index stale 清理、README、AGENTS 和 skill 引用。

## Thin-Index 决策

- thin-index 生成逻辑只维护根 `scripts/generate-plugin-thin-index.ps1`。
- 各插件同名脚本只能作为 wrapper 转发参数，避免插件之间产生运行时依赖和脚本副本漂移。
- stale 清理只应删除由插件生成、且源文件已失效的 thin-index；不得删除业务项目自定义 `.agents/rules/`。
- 独立分发单个插件时，若仍使用 `plugin-reference-thin-index`，必须同时带上根 canonical 脚本，否则选择 `copy` 或手工 thin-index。
- Agent thin-index 不复用 `generate-plugin-thin-index.ps1`；由独立 `scripts/generate-agent-thin-index.ps1` 从 `agents/*/AGENT.md` 和 `bindings.yaml` 生成 `.agents/skills/<agent-name>/SKILL.md`，只做浅层 skill 路由。
- 调度内核不硬编码产品 API；`serial`、`subagent`、`codex-session`、`human` 统一使用 action/result contract，由宿主 capability probe 后执行。工具原生配置生成仍不作为 canonical 来源，能力不可用时按 workflow 串行或人工降级。

## 组件版本治理

- 插件是主要发布、依赖和兼容单元；根级独立 skill 单独演进。插件内部 skill、rule、reference、template 和 script 继承 owner 插件版本，不维护独立 SemVer。
- 版本限定为严格 `MAJOR.MINOR.PATCH`。`0.x` breaking 使用下一 minor，`1.x+` breaking 使用下一 major；发布记录位于根 `releases/plugin|skill/<name>/<version>.md`，提交后不可修改或删除。
- 原 `dependencies` 名称数组继续作为当前更新器契约；版本范围旁路写入 `dependencyVersions`，`0.x` 默认约束在同一 minor，`1.x+` 默认约束在同一 major。
- 维护者专用 Node 工具只在源仓 `.agents/skills/agent-kit-maintenance/scripts/` 做 inventory、变更校验和 Git ref 兼容比较，不部署业务项目，不接入 install/update、thin-index 或 hook。
- breaking 比较只接受 `plugin|skill:<name>@<version>` 精确授权；版本倒退、依赖不兼容和发布记录缺失不可绕过。v1 不创建业务项目 `component_versions.json`，也不强制 Git tag。
- 现有部署和更新流程必须保持不变；任何 updater 集成需要新的独立决策、兼容设计和授权。

## 部署边界

- 已部署业务工程的 `.agents/` 是独立能力包仓库；能力包更新后应先更新 `.agents`，再按启用插件重建 thin-index。
- standard 模式保持业务根内独立 `.agents` Git；workspace-overlay 模式允许模块 `ContextRoot` 无 `.git`，但必须由 `WorkspaceRoot/.agents/capability.json` 明确声明共享 `CapabilityRoot`、local/shared 目录和 SourceRoot/GitRoot。解析器不得扫描父目录或 sibling 推断这些根。
- workspace-overlay 采用 capability-once/context-many：先在 canonical 标版根更新 capability，再对各模块以 `-NoPull` 刷新 ContextRoot。模块刷新不得 fetch/pull 或改写 CapabilityRoot Git，只能维护 ContextRoot 本地生成层和 manifest 受管 Junction。
- overlay 的 shared path 与 SourceRoot 逻辑 path 必须是指向 manifest 精确目标的 Junction；local path 必须是物理目录。自动修复只允许作用于可证明受管且目标错误的 Junction，普通目录、文件或本地目录不得覆盖。
- 根目录 `memory/` 是维护者记忆，不得加入 `scripts/install-agents.ps1` 或 `scripts/update-agents.ps1` 的 sparse checkout 路径。
- 根目录 `releases/` 是维护者发布审计记录，不加入业务项目 sparse checkout。
- `memory/plan/` 是维护者计划子目录，存放实施计划和设计文档，不部署到业务项目。
- 根目录 `AGENTS.md` 只服务本仓库维护，不部署到业务项目 `.agents/`。
- 根目录 `agents/` 和 `workflows/` 是能力包正式内容，已加入 `scripts/install-agents.ps1` 和 `scripts/update-agents.ps1` 的 sparse checkout 路径，部署到业务项目 `.agents/agents/` 和 `.agents/workflows/`。
- 更新器新增运行时依赖时必须兼容旧 sparse checkout 自举：新版脚本在加载新增运行时模块前，可在自更新恢复、`Write` 或允许拉取的 `DryRun` 中以当前完整运行时清单收敛干净的独立 capability Git checkout；`Check` 和显式 `DryRun -NoPull` 保持只读。恢复失败必须停止，不得覆盖 dirty checkout。
- 根 `scripts/iris-mcp.js` 是无原生 MCP 工具运行器的可选 helper，必须随安装/更新部署；standard 项目直接使用 canonical 文件，workspace overlay 必须在本地 `ContextRoot/scripts/` 生成读取 manifest 并转发到 `CapabilityRoot` 的 JS adapter，不复制规则实现或嵌入 capability 绝对路径。原生 MCP 工具仍优先，helper 不得成为 canonical 规则源。helper 必须按当前 MCP schema 的 `mode` / `action` 区分读取与状态变更、默认拦截写入和远端执行，并把 `check_config` 风险作为诊断信号而非仅凭默认 namespace/port 阻断工具发现。
- 根目录 `skills/` 是能力包正式内容，部署到业务项目 `.agents/skills/`，不再承载维护者专用例外。
- 源仓根 `.agents/skills/agent-kit-maintenance/` 是受版本控制的仓库本地维护上下文，不在安装/更新 sparse checkout 部署清单内，也不参与 thin-index。业务项目中的 `.agents/` 仍是独立能力包仓库，不得把源仓 `.agents/` 部署成嵌套 `.agents/.agents/`。
- `.agents/plugins/**` 默认全量拉取用于能力发现；插件目录存在只表示 `available`，是否已启用以目标项目 `.agents/config/plugin_profile.md` 为准。
- 更新脚本按插件状态分流：`available` 不合并配置、不生成 thin-index；`enabled` 参与常规更新；`disabled` 默认跳过；领域插件依赖未启用时必须停止。
- 插件 canonical 名称变更时，manifest 必须声明 `legacyNames`；更新器按旧名称继承 `plugin_profile.md` 状态并在 Write 时收敛为当前名称，同时清理指向已删除插件 rule/skill 源文件的受管 thin-index。不得让已启用插件因重命名静默退回 `available`。
- 根目录 `index.html`、`.github/` 和 `.nojekyll` 只服务展示页和 GitHub Pages，不部署到业务项目 `.agents/`。
- `scripts/tests/` 只服务能力包仓库自测，不部署到业务项目 `.agents/`。
- standard 模式的 `.agents/.git/info/exclude` 应继续忽略 `/config/`、`/memory/`、`/rules/`、`/skills/` 和 `/scripts/` 这些本地生成层；workspace-overlay 的 ContextRoot 不要求存在 `.git/info/exclude`，由 WorkspaceRoot 所属仓库忽略本地生成层。
- `.agents/work/` 是导出 staging 等本地临时工作层，必须由生成层 ignore 隐藏，不进入业务提交。
- `.agents/.git/info/exclude` 不应忽略 `/agents/` 或 `/workflows/`；业务项目私有 Agent/Workflow 差异应写入 `.agents/config/agent_*_profile.md` 或业务项目自己的规则/文档。
- 对手工 full clone 到 `.agents/` 的工程，必须重新执行安装脚本启用 sparse checkout；仅靠 `.git/info/exclude` 不能隐藏已跟踪的维护者记忆文件。
- 根目录 `vendor/` 放第三方源码资产、共享运行时资产和 vendor skill fallback，随 `/vendor/**` 部署，但不是默认安装列表。插件以厂商无关 `skillDependencies` 声明 capability；更新器只为 enabled 插件的 required skill 生成 `.agents/skills/` 通用入口，optional 按任务触发。用户级运行时同步必须显式指定 skill/runtime，核心 manifest 和 resolver 不写工具目录或工具专属调用名。
- Windows x64 安装/更新在已存在 IRIS MCP 配置且 vendor exe 可用时，默认把 `.mcp.json` 对应 server 的 `command` 和既有 `project-env.json` 的 `mcp.serverPath` 收敛到 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe`。该迁移只允许修改可执行文件路径，不创建连接配置、不改其它 MCP server、args、env 或连接字段；Write 必须写后重读两份目标并在失败时按原始字节回滚，DryRun/Check 只报告，缺失、无效或歧义状态必须保留原配置并停止 Write 收敛。当前受支持更新器用自重启完成同轮升级；无法假定任意历史进程具备新逻辑，因此 runbook 保留两次 Write 的确定性兼容流程。
- 第三方 vendor skill 快照必须记录上游仓库、固定 commit/version 和许可证；vendor 内的上游 `SKILL.md` 保持原文，工具名兼容映射、路由和本仓库安全约束放在插件自己的 rule/skill/reference 中。除非插件核心流程不可缺少，否则外部 skill 默认声明为 `optional`。
- 当底层 MCP 同时提供内置 skill/KB/学习工具，而本仓库已通过 vendor 和 manifest 治理同类能力时，新生成配置和 fallback helper 默认关闭底层 skill toolset；目标工程确有需要时只能通过本地配置显式开启，不能绕过本仓库远程动作和敏感信息门禁。
- 已部署工程的 vendor 迁移默认非破坏：普通 Write 不清历史 thin-index，用户级副本永不自动删除；只有 profile 经确认后，显式 cleanup 才能删除可证明由 `.agents/vendor/` 生成且已不需要的项目 thin-index。

## 入口决策

- Agent run schema 1.2 使用阶段 `attempts[]`、capability matrix、远程动作终态、`finalization` 和限定 verification scope 表达暂停恢复及最终验证门禁；validator 继续兼容 schema 1.0/1.1。
- `check_config` 只核对配置定位，真实连通以当次无副作用网络探针为准。自动发现生效且探针成功时，`config_file=null` 不构成配置失败；单一工具的瞬时失败只降级对应 capability。
- Independent Verifier 只能在所有远程动作终态、无 suspended attempt 且验证范围冻结后启动。报告、summary、manifest 和 feedback 不属于业务验证版本。
- i18n 页面翻译种子默认使用 `DHCDoc.I18n.PageTranslationSeed`，backend SourceRoot 内 canonical 相对路径为 `DHCDoc/I18n/PageTranslationSeed.cls`；`SetPageTrans` / `KillPageTrans` 是稳定单条接口，语言聚合使用 `Load{LANG}Translation` / `Kill{LANG}Translation`，带批次号的方法继续按需求生成。目标工程已验证存在兼容实现时允许 profile 覆盖，字典翻译 SQL 与 XML 模板同步不并入该类。

- IRIS 当前前端源码、上传内容和服务器运行编码统一使用 canonical `utf8`；组合仓库名称、目录结构和 Git 仓库角色不得改变当前编码默认。`project-utf8` 仅作为 `utf8` 的兼容读取别名，`standard-gb2312` 仅用于用户明确指定的历史工程。
- Overlay manifest 明确至少声明一个 `backend` SourceRoot 且没有 `frontend` SourceRoot 时，profile 使用 canonical `N/A (backend-only)`；无法从声明证明 backend-only 时继续阻断，不扫描父目录或 sibling 猜测源码。后续新增 frontend 时必须重新通过字节门禁再规范化为 `utf8`。
- 实际文件字节检测始终是修改与上传的最终门禁。UTF-8 或纯 ASCII 可安全规范化 profile；真实 GB2312、mixed、UTF-16 或 unknown 必须停止并报告，不自动批量转码业务源码。
- 已部署插件配置迁移由 manifest 声明、根更新器通用调用；领域推导逻辑留在插件迁移脚本，不硬编码到根更新器。
- 普通 IRIS 需求提交由 `iris-demand-commit` 统一收尾，支持自然语言及显式 `$iris-demand-commit --plan|--commit`。`--plan` 只生成计划和完整 commit message，不执行 pull/commit，也不追问是否提交；`--commit` 视为本地提交明确授权并直接执行 plan/apply/verify。`standard/project` 默认值来自项目 profile 或当前用户明确指定，不得从目录、`contextMode`、remote 或代码量猜测。标版 commit 前必须对全部仓库执行 `pull --ff-only`，项目仓有 upstream 时同样执行、无 upstream 时允许 `local-only`；pull 改变 HEAD 后必须重新计划并再次确认，push 始终独立授权。
- 需求提交的“修改说明”属于方案审计信息，必须同时表达修改对象、具体实现/交互方案和行为结果；仓库之间按实际职责分别归纳，不能用“优化功能”“修复问题”等泛化文本代替。

- `AGENTS.md` 是工程级唯一主入口，必须存在。
- 本仓库维护者专用 `.agents/skills/agent-kit-maintenance/SKILL.md` 只服务 `imedical.agents` 源仓维护，不部署到业务项目，也不参与 thin-index。根 `AGENTS.md` 仍是维护入口和最高优先级规则源；该 skill 只承载插件提交同步、记忆更新、README/docs 对齐和部署边界检查流程，不复制维护记忆全文或长规则。
- `CLAUDE.md`、`CODEBUDDY.md` 是可选兼容入口；如存在，只允许是指向 `AGENTS.md` 的 symlink。
- 安装和更新脚本只报告兼容入口状态，不自动创建、复制或修复兼容入口。
- 禁止把 `AGENTS.md` 复制成 `CLAUDE.md` 或 `CODEBUDDY.md`，也禁止在兼容入口维护第二份规则。

## 跨插件一致性

- 治疗表单生命周期必须区分新开发与现有模板改造：`expectedVersion=NEW` 的新开发表单直接创建正式模板，不使用灰度；只有现有模板改造才使用响应式灰度 RowID，并在验收后按引用拓扑通过 `consolidate` / `consolidate-shared` 回归正式 RowID。`cleanup` 只处理已完成引用切换的零引用孤儿模板，不替代正式合并。

- 修改插件目录结构时，同步检查 `.agents-plugin/plugin.json`、插件 `AGENTS.md`、插件 README、仓库 README 和相关 docs。
- 任何新规则都要先判断是否应放入 `rules/`、`references/`、`skills/`、`templates/` 或 `scripts/`。
- 如需重命名历史 rule/skill/reference，必须同步 thin-index stale 清理、README、AGENTS、skills 引用和已部署工程兼容说明。
- 对已部署工程有影响的变更，必须在 README 或插件 README 中说明同步步骤和兼容清理策略。

## Agent 运行与反馈边界

- 新运行使用 schema 2.0；`executionPath: fast|full|guarded` 与 `orchestrationMode: serial|subagent|multi-session` 正交。历史 schema 1.0–1.2 只读，不原地迁移。
- `events.jsonl` 是事件事实源，`00-run-manifest.json` 是当前投影；Coordinator 是唯一状态和集成 owner，参与者通过 action result、message 和 handoff 返回。
- multi-session 协作计划授权只覆盖当前 planHash；远程写入、commit、merge、push、部署和 feedback 写入分别授权。可写会话必须使用隔离 worktree 和互斥 scope。
- schema 2.0 先以互斥 `taskKind` 分流：`business-demand` 使用 `implementing -> locally-verified -> acceptance-pending -> accepted`；`framework-maintenance` 使用 `maintaining -> locally-verified -> maintenance-complete`；`other` 不进入任一生命周期。业务需求与框架维护同时出现时建立独立记录，不共享验收、feedback 或完成状态。
- feedback 适用性由 `taskKind=business-demand` 固定派生，不能作为独立布尔开关绕过分类。框架维护的 `acceptance.status=not-applicable` 且 feedback 始终 `not-eligible`。任何经验新增、命中更新、framework feedback 或 rule 提升均需用户逐项授权。

## 提交阶段验证复用

- 完整维护回归与 Git 提交门禁分离。完整测试通过后，以 `scripts/validation-evidence.js` 记录 suite、命令、受测 scope 和 worktree 指纹；scope 指纹未变化时，提交阶段复用该结果，不机械重跑完整套件。
- 提交阶段只补齐已失效或尚未执行的快速门禁：worktree 组件版本校验、`git diff --check`、暂存复核和 `git commit`。受测范围变化、缺少有效结果或已有失败时才重跑对应完整测试。

## 安全边界

- 不写服务器地址、账号、密码、token、namespace、远程路径或任何敏感连接信息。
- 不把业务项目私有事实写入本仓库插件、规则或记忆。
- `.mcp.json` 是连接事实来源；不要把其中的 host、账号、密码、token、namespace 或远程路径复制到 rules、memory、config 或插件。
