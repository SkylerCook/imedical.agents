# imedical.agents 长期维护决策

本文件记录 `imedical.agents` 能力包仓库的长期决策和稳定边界。当前状态摘要见 `agent-kit-maintenance-memory.md`，近期维护流水见 `agent-kit-maintenance-log.md`，后续计划见 `agent-kit-maintenance-backlog.md`。

## 内容分层

- `agents/` 放厂商无关的智能体 canonical 定义，包括 agent registry、`AGENT.md`、`bindings.yaml` 和共享交接协议；不放工具专属生成物或业务项目私有事实。
- `workflows/` 放厂商无关的多智能体/阶段化 workflow canonical 定义，包括 workflow registry 和 `*.workflow.md`；workflow 必须支持不具备子代理能力时的单 Agent 串行降级。
- `rules/` 只放长期约束、工作流规则和任务路由，不放大体量查找表、API 目录或源码索引。
- `references/` 放按需查阅的参考资料，例如查找表、控件/API 目录和源码索引；默认不参与 rule thin-index 生成。
- `vendor/` 放第三方源码资产（如 HISUI dist），供 rules 和 skills 按需引用；不参与 thin-index 生成。
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
- `.agents/plugins/**` 默认全量拉取用于能力发现；插件目录存在只表示 `available`，是否已启用以目标项目 `.agents/config/plugin_profile.md` 为准。
- 更新脚本按插件状态分流：`available` 不合并配置、不生成 thin-index；`enabled` 参与常规更新；`disabled` 默认跳过；领域插件依赖未启用时必须停止。
- 根目录 `index.html`、`.github/` 和 `.nojekyll` 只服务展示页和 GitHub Pages，不部署到业务项目 `.agents/`。
- `scripts/tests/` 只服务能力包仓库自测，不部署到业务项目 `.agents/`。
- `.agents/.git/info/exclude` 应继续忽略 `/config/`、`/memory/`、`/rules/`、`/skills/` 和 `/scripts/` 这些本地生成层。
- `.agents/.git/info/exclude` 不应忽略 `/agents/` 或 `/workflows/`；业务项目私有 Agent/Workflow 差异应写入 `.agents/config/agent_*_profile.md` 或业务项目自己的规则/文档。
- 对手工 full clone 到 `.agents/` 的工程，必须重新执行安装脚本启用 sparse checkout；仅靠 `.git/info/exclude` 不能隐藏已跟踪的维护者记忆文件。
- 根目录 `vendor/` 放第三方源码资产（如 HISUI），已加入 sparse checkout 路径 `/vendor/**`，部署到业务项目 `.agents/vendor/`。`vendor/` 不参与 thin-index 生成，不生成 `.agents/rules/` 或 `.agents/skills/` 入口；由 rules 和 skills 按需直接引用。

## 入口决策

- `AGENTS.md` 是工程级唯一主入口，必须存在。
- `CLAUDE.md`、`CODEBUDDY.md` 是可选兼容入口；如存在，只允许是指向 `AGENTS.md` 的 symlink。
- 安装和更新脚本只报告兼容入口状态，不自动创建、复制或修复兼容入口。
- 禁止把 `AGENTS.md` 复制成 `CLAUDE.md` 或 `CODEBUDDY.md`，也禁止在兼容入口维护第二份规则。

## 跨插件一致性

- 修改插件目录结构时，同步检查 `.agents-plugin/plugin.json`、插件 `AGENTS.md`、插件 README、仓库 README 和相关 docs。
- 任何新规则都要先判断是否应放入 `rules/`、`references/`、`skills/`、`templates/` 或 `scripts/`。
- 如需重命名历史 rule/skill/reference，必须同步 thin-index stale 清理、README、AGENTS、skills 引用和已部署工程兼容说明。
- 对已部署工程有影响的变更，必须在 README 或插件 README 中说明同步步骤和兼容清理策略。

## 安全边界

- 不写服务器地址、账号、密码、token、namespace、远程路径或任何敏感连接信息。
- 不把业务项目私有事实写入本仓库插件、规则或记忆。
- `.mcp.json` 是连接事实来源；不要把其中的 host、账号、密码、token、namespace 或远程路径复制到 rules、memory、config 或插件。
