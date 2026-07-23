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
- 工具专属 agent adapter 暂不实现；后续如需 Codex、Claude Code、OpenCode、CodeBuddy 等原生入口，再由独立 `scripts/generate-agent-adapters.ps1` 生成。该脚本只翻译格式，不创造 canonical 中不存在的职责或规则。

## 部署边界

- 已部署业务工程的 `.agents/` 是独立能力包仓库；能力包更新后应先更新 `.agents`，再按启用插件重建 thin-index。
- 根目录 `memory/` 是维护者记忆，不得加入 `scripts/install-agents.ps1` 或 `scripts/update-agents.ps1` 的 sparse checkout 路径。
- `memory/plan/` 是维护者计划子目录，存放实施计划和设计文档，不部署到业务项目。
- 根目录 `AGENTS.md` 只服务本仓库维护，不部署到业务项目 `.agents/`。
- 根目录 `agents/` 和 `workflows/` 是能力包正式内容，已加入 `scripts/install-agents.ps1` 和 `scripts/update-agents.ps1` 的 sparse checkout 路径，部署到业务项目 `.agents/agents/` 和 `.agents/workflows/`。
- 根 `scripts/iris-mcp.js` 是无原生 MCP 工具运行器的可选 helper，必须随安装/更新部署；原生 MCP 工具仍优先，helper 不得成为 canonical 规则源。helper 必须按当前 MCP schema 的 `mode` / `action` 区分读取与状态变更、默认拦截写入和远端执行，并把 `check_config` 风险作为诊断信号而非仅凭默认 namespace/port 阻断工具发现。
- 根目录 `skills/` 默认是能力包正式内容，部署到业务项目 `.agents/skills/`；`skills/agent-kit-maintenance/` 是维护者专用例外，必须通过 sparse checkout 排除，不部署到业务项目，也不参与 thin-index。
- `.agents/plugins/**` 默认全量拉取用于能力发现；插件目录存在只表示 `available`，是否已启用以目标项目 `.agents/config/plugin_profile.md` 为准。
- 更新脚本按插件状态分流：`available` 不合并配置、不生成 thin-index；`enabled` 参与常规更新；`disabled` 默认跳过；领域插件依赖未启用时必须停止。
- 根目录 `index.html`、`.github/` 和 `.nojekyll` 只服务展示页和 GitHub Pages，不部署到业务项目 `.agents/`。
- `scripts/tests/` 只服务能力包仓库自测，不部署到业务项目 `.agents/`。
- `.agents/.git/info/exclude` 应继续忽略 `/config/`、`/memory/`、`/rules/`、`/skills/` 和 `/scripts/` 这些本地生成层。
- `.agents/work/` 是导出 staging 等本地临时工作层，必须由生成层 ignore 隐藏，不进入业务提交。
- `.agents/.git/info/exclude` 不应忽略 `/agents/` 或 `/workflows/`；业务项目私有 Agent/Workflow 差异应写入 `.agents/config/agent_*_profile.md` 或业务项目自己的规则/文档。
- 对手工 full clone 到 `.agents/` 的工程，必须重新执行安装脚本启用 sparse checkout；仅靠 `.git/info/exclude` 不能隐藏已跟踪的维护者记忆文件。
- 根目录 `vendor/` 放第三方源码资产、共享运行时资产和 vendor skill fallback，随 `/vendor/**` 部署，但不是默认安装列表。插件以厂商无关 `skillDependencies` 声明 capability；更新器只为 enabled 插件的 required skill 生成 `.agents/skills/` 通用入口，optional 按任务触发。用户级运行时同步必须显式指定 skill/runtime，核心 manifest 和 resolver 不写工具目录或工具专属调用名。
- 第三方 vendor skill 快照必须记录上游仓库、固定 commit/version 和许可证；vendor 内的上游 `SKILL.md` 保持原文，工具名兼容映射、路由和本仓库安全约束放在插件自己的 rule/skill/reference 中。除非插件核心流程不可缺少，否则外部 skill 默认声明为 `optional`。
- 已部署工程的 vendor 迁移默认非破坏：普通 Write 不清历史 thin-index，用户级副本永不自动删除；只有 profile 经确认后，显式 cleanup 才能删除可证明由 `.agents/vendor/` 生成且已不需要的项目 thin-index。

## 入口决策

- Agent run schema 1.2 使用阶段 `attempts[]`、capability matrix、远程动作终态、`finalization` 和限定 verification scope 表达暂停恢复及最终验证门禁；validator 继续兼容 schema 1.0/1.1。
- `check_config` 只核对配置定位，真实连通以当次无副作用网络探针为准。自动发现生效且探针成功时，`config_file=null` 不构成配置失败；单一工具的瞬时失败只降级对应 capability。
- Independent Verifier 只能在所有远程动作终态、无 suspended attempt 且验证范围冻结后启动。报告、summary、manifest 和 feedback 不属于业务验证版本。

- IRIS 前端编码模式只允许 `standard-gb2312` 和 `project-utf8`；组合仓库名称不进入通用模式值，路径覆盖只映射这两种模式。
- 目录结构、Git 仓库角色和 profile 只用于提出候选编码模式，实际文件字节检测始终是修改与上传的最终门禁。
- 已部署插件配置迁移由 manifest 声明、根更新器通用调用；领域推导逻辑留在插件迁移脚本，不硬编码到根更新器。

- `AGENTS.md` 是工程级唯一主入口，必须存在。
- 本仓库已新增维护者专用 `skills/agent-kit-maintenance/SKILL.md`；它只服务 `imedical.agents` 仓库维护，虽位于根 `skills/`，但必须从业务项目 sparse checkout 中排除，不部署到业务项目 `.agents/`，不参与 thin-index。根 `AGENTS.md` 仍是维护入口和最高优先级规则源；该 skill 只承载插件提交同步、记忆更新、README/docs 对齐和部署边界检查流程，不复制维护记忆全文或长规则。
- `CLAUDE.md`、`CODEBUDDY.md` 是可选兼容入口；如存在，只允许是指向 `AGENTS.md` 的 symlink。
- 安装和更新脚本只报告兼容入口状态，不自动创建、复制或修复兼容入口。
- 禁止把 `AGENTS.md` 复制成 `CLAUDE.md` 或 `CODEBUDDY.md`，也禁止在兼容入口维护第二份规则。

## 跨插件一致性

- 修改插件目录结构时，同步检查 `.agents-plugin/plugin.json`、插件 `AGENTS.md`、插件 README、仓库 README 和相关 docs。
- 任何新规则都要先判断是否应放入 `rules/`、`references/`、`skills/`、`templates/` 或 `scripts/`。
- 如需重命名历史 rule/skill/reference，必须同步 thin-index stale 清理、README、AGENTS、skills 引用和已部署工程兼容说明。
- 对已部署工程有影响的变更，必须在 README 或插件 README 中说明同步步骤和兼容清理策略。

## Agent 运行与反馈边界

- canonical workflow 的运行模式统一表达为 `retrospective`、`serial` 或 `multi-agent`；`multi-agent` 必须有用户明确授权，任何远程写入仍需单独授权，不能由多智能体授权隐含获得。
- 阶段化运行以 `00-run-manifest.json` 和编号 handoff 报告保存可审计证据；`agent-context-kit/scripts/validate-agent-run.ps1` 只做事后只读机械验收，不承担运行时调度。
- `agent-framework-feedback` 是 HIS 任务统一收尾入口：可复用需求经验进入 `feedback/experience/` 并按成熟度提升到 owner rule，独立框架修正进入 `feedback/framework/`；没有候选内容时不生成空反馈。
- 反馈材料默认只生成和校验。提交或推送必须由用户在当前任务中明确要求，不能把“自动收尾”解释为 Git 写入授权。

## 安全边界

- 不写服务器地址、账号、密码、token、namespace、远程路径或任何敏感连接信息。
- 不把业务项目私有事实写入本仓库插件、规则或记忆。
- `.mcp.json` 是连接事实来源；不要把其中的 host、账号、密码、token、namespace 或远程路径复制到 rules、memory、config 或插件。
