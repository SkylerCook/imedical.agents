# AGENTS.md

## 适用范围

本文件只适用于维护 `imedical.agents` 能力包仓库本身。

它不部署到业务项目 `.agents/`，也不是业务项目的 Agent 入口。业务项目仍使用业务项目根目录自己的 `AGENTS.md`、`.agents/rules/`、`.agents/memory/` 和 `.agents/config/`。

## 新会话启动

维护本仓库时先读取：

1. `memory/agent-kit-maintenance-memory.md`：入口摘要、必读路由和当前重点。
2. 按任务继续读取：
   - `.agents/skills/agent-kit-maintenance/SKILL.md`：仓库本地维护 skill，处理插件提交同步、记忆更新、README/docs 对齐和部署边界检查；它不部署到业务项目。
   - `memory/agent-kit-maintenance-decisions.md`：长期决策和边界。
   - `memory/agent-kit-maintenance-log.md`：近期维护记录和验证摘要。
   - `memory/agent-kit-maintenance-backlog.md`：后续治理队列。
   - `README.md`、`docs/`、插件 `AGENTS.md`、相关 skill/rule/script。

不要把本仓库根 `AGENTS.md` 的规则复制到业务项目。需要维护业务项目上下文时，按 `plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md` 和目标项目自己的入口执行。

## 维护记忆规则

- `agent-kit-maintenance-memory.md` 只保留摘要入口，控制在新 Agent 约 2 分钟可读完。
- 长期稳定决策写入 `agent-kit-maintenance-decisions.md`。
- 近期提交、验证结果和维护流水摘要写入 `agent-kit-maintenance-log.md`。
- 后续计划、治理队列和暂缓事项写入 `agent-kit-maintenance-backlog.md`。
- 完成一轮维护后，合并或替换过期内容，不无限追加。
- 维护路线图或计划类文档时，`下一步工作计划` 只保留未完成任务；任务完成后迁入归档阶段记录或维护日志，并从第一个未完成任务重新编号，避免在计划区保留“已完成”任务。
- 不写完整 rules 正文、长段脚本说明、大段命令输出或一次性排障日志。

## 目录边界

- `agents/` 放厂商无关的智能体 canonical 定义；不放 Codex、Claude Code、OpenCode、CodeBuddy、WorkBuddy、Hermes 等工具专属生成物。
- `workflows/` 放厂商无关的阶段化或多智能体协作流程；workflow 必须支持无子代理能力时的单 Agent 串行降级。
- `plugins/` 放可复用能力包；插件内可以包含 rules、skills、references、templates、scripts、commands、agents 或 hooks。
- `skills/` 放仓库级通用 skill，属于能力包正式内容并部署到业务项目 `.agents/skills/`。
- `.agents/skills/agent-kit-maintenance/` 是受版本控制的仓库本地维护 skill，只服务本仓库维护；源仓根 `.agents/` 不加入业务项目 sparse checkout，也不生成 thin-index。
- `rules/` 是仓库级通用规则预留入口；当前通用规则主要沉淀在插件内。
- `docs/` 放 AI Coding 工作区规范、runbook 和配套文档。
- 根 `scripts/` 放能力包部署、更新和通用维护脚本；领域脚本放到对应插件。
- 根 `vendor/` 放第三方源码资产、共享运行时资产和 vendor skill fallback，部署到业务项目 `.agents/vendor/`；只有插件 manifest 声明的 required vendor skill 才生成 `.agents/skills` thin-index。
- 根 `releases/` 放插件和根级独立 skill 的不可变发布记录，只服务源仓版本审计，不部署到业务项目。
- 根 `memory/` 是维护者记忆，不部署到业务项目 `.agents/`，不生成 thin-index。
- 根 `feedback/` 放框架反馈和经验积累，部署到业务项目 `.agents/`；`feedback/framework/` 放框架验证反馈条目，`feedback/experience/` 放领域经验文档。
- 根 `index.html`、`.github/`、`.nojekyll` 只服务 GitHub Pages 展示页。

## 部署边界

业务项目通过安装或更新脚本只检出运行需要的能力包内容：`agents/`、`workflows/`、`docs/`、`rules/`、`skills/`、`plugins/`、`vendor/`、`feedback/`，以及根 `scripts/*.ps1`、`scripts/*.js` 和 `scripts/lib/**`。

不要把以下内容加入业务项目 `.agents` sparse checkout：

- 根 `AGENTS.md`
- 根 `memory/`
- 根 `.agents/`
- 根 `releases/`
- 根 `README.md`、`LICENSE`
- 根 `index.html`
- `.github/`
- `.nojekyll`
- `scripts/tests/`

## 脚本与跨平台运行时

- Node.js 是运行、安装、更新和维护 `.agents` 工具链的前置依赖，不是 HIS 或其它业务系统的生产运行依赖。面向医院内网或纯后端工程的说明、检查和错误提示必须明确这一区别。
- 后续新增的平台无关脚本默认使用 JavaScript；文件、Git、JSON、manifest、thin-index、依赖解析、查询和编排等跨平台核心逻辑优先抽取为 JavaScript 实现。
- JavaScript 脚本默认只使用 Node.js 内置模块，避免要求业务项目为能力包执行 `npm install`。确需第三方依赖时，必须先评估离线环境、供应链、版本锁定、分发和升级成本，并形成明确决策。
- `.ps1` 仅保留 Windows bootstrap 或薄入口，Junction、Windows PowerShell 5.1、legacy GB2312 兼容等 Windows 专属能力，以及尚未迁移的存量脚本。不得为跨平台核心逻辑长期维护功能等价的成套 `.ps1` 与 `.sh` 实现。
- 不要求一次性重写现有 `.ps1`；在实际维护需求中逐步抽取 JavaScript 核心，并保留必要的平台适配层和兼容入口。
- 安装器和更新器必须在执行主要流程前检查 `node` 及其版本；不满足要求时明确停止，说明安装方式和用途，不得自动或静默安装 Node.js。
- 当前最低版本基线为 Node.js `>=22.5.0`，以满足现有 `codegraph-query` 对 `node:sqlite` 的使用。正式落地跨平台工具链前，必须在完整回归后确定并记录受支持的 Node 22 版本范围，不得把未经验证的版本范围宣称为已支持。
- 根 `scripts/*.js` 必须纳入安装和更新的 sparse checkout，并由回归测试验证，避免出现“源仓已提交、业务项目未部署”的缺口；`scripts/tests/` 仍不得部署到业务项目。
- 跨平台脚本和工具链变更必须建立并通过 Windows、macOS、Linux 测试矩阵；涉及 Windows 专属能力时，应验证明确的 capability 降级或停止行为，不能把平台不支持表现为执行中途失败。

## 维护约束

- 维护当前工程时必须考虑不同模型能力和不同 Agent 工具的普适性；canonical 内容不得绑定单一厂商、单一模型或单一运行器。
- `agents/`、`workflows/`、`plugins/` 是长期能力源；`.codex/agents/`、`.claude/agents/`、`.opencode/`、`.codebuddy/agents/`、Hermes 或 WorkBuddy 入口只能作为 adapter 生成物或临时适配层。
- canonical 中不要写死具体模型名或订阅档位；需要表达模型能力时使用 `fast`、`balanced`、`strong`、`deep-reasoning` 等抽象档位，由工具 adapter 映射到实际模型。
- 新增 workflow 时必须说明无 subagent、无 skill 或无法解析 YAML 时的降级路径，保证弱模型或能力较少的 Agent 仍可按 Markdown 串行执行。
- 修改 thin-index 生成行为时，只改根 `scripts/generate-plugin-thin-index.ps1`；各插件同名脚本只能作为 wrapper。
- Agent thin-index 或工具 adapter 生成逻辑不得混入 plugin thin-index；需要时新增独立脚本。
- 修改插件目录结构时，同步检查插件 `AGENTS.md`、README、manifest、templates、仓库 README 和相关 docs。
- 提交任何插件能力变更前，必须同步检查并按需更新：插件 `AGENTS.md`、插件 README、`.agents-plugin/plugin.json`、相关 skill/rule/reference/template、仓库 README、`memory/agent-kit-maintenance-memory.md`、`memory/agent-kit-maintenance-log.md`、`memory/agent-kit-maintenance-backlog.md`、相关 docs 和测试。禁止只提交插件实现而遗漏对应说明、记忆或验证入口。
- 实际业务需求处理中若同时修改了 `agents/`、`workflows/`、`skills/`、`feedback/`、共享协议、插件通用能力或根脚本，必须在需求提交后按 `.agents/skills/agent-kit-maintenance/SKILL.md` 回看从上次维护记录以来的提交，补齐仓库 README、维护记忆、治理队列、owner 文档和专项测试；不得因变更源于业务需求而跳过框架维护。
- 若插件变更影响业务项目安装、更新、thin-index、vendor 同步、启用状态或兼容清理，必须同步更新 `docs/update-agents.md`、`scripts/tests/update-agents.tests.ps1` 或对应专项测试，并在 README 或插件 README 说明已部署项目的处理方式。
- 新增长期通用能力时，先判断应放入 `agents/`、`workflows/`、`rules/`、`references/`、`skills/`、`templates/`、`scripts/` 还是插件目录。
- 新增文件遵循命名约定：agent 目录 kebab-case + `-agent`，workflow 文件 kebab-case + `.workflow.md`，skill 目录 kebab-case，rule 文件 snake_case，reference 文件 kebab-case，script 文件 kebab-case。
- 对已部署业务工程有影响的变更，必须说明同步步骤和兼容清理策略。

## Git 提交信息

- Git commit message 使用 Conventional Commits：首行写简洁明确的 `type(scope): subject`，描述文字使用简体中文，代码标识符保持原样。
- 提交信息不得只有标题；标题后空一行，必须增加以 `修改说明:` 开头的正文。
- `修改说明:` 应聚焦本次提交的核心改动，说明真正发生变化的能力、逻辑、契约或行为；必要时补充关键结果和边界，但不要求机械罗列全部文件或逐项套用固定字段。
- 禁止使用只有“优化代码”“修复问题”“调整逻辑”等无法识别核心改动的笼统说明，也不要用版本、文档、测试等常规同步项掩盖主要变更。
- 推荐格式：

```text
fix(i18n): 增加前端条件路由与稳定 key 门禁

修改说明: 为 iris-coding 与 iris-frontend-coding 增加基于插件启用状态和 i18n 信号的双条件门禁，并新增稳定 key 静态检查，确保普通需求不加载 i18n、命中翻译改动时阻断动态 key。
```

## 组件版本治理

- 插件是主要发布、依赖和兼容单元，版本事实来自 `.agents-plugin/plugin.json`；根级独立 skill 的版本来自其 `SKILL.md` frontmatter。
- 插件内部 skill、rule、reference、template 和 script 继承 owner 插件版本，不得声明独立 `version`。
- 版本只允许严格 `MAJOR.MINOR.PATCH`。插件目录或根级独立 skill 目录发生变化时，必须递增对应版本并新增 `releases/plugin|skill/<name>/<version>.md`。
- 发布记录提交后不可修改或删除；breaking 变化必须声明迁移说明。依赖名称继续保留在 `dependencies`，版本范围单独写入更新器忽略的 `dependencyVersions`。
- 提交相关改动前，必须按 `docs/component-version-management.md` 运行维护者专用 `validate-component-versions.js validate`。该工具位于源仓 `.agents/skills/agent-kit-maintenance/scripts/`，不接入业务项目安装、更新、thin-index 或 hook。
- 不得借版本治理修改 `scripts/install-agents.ps1`、`scripts/update-agents.ps1` 或 `docs/update-agents.md`；未来接入更新器必须单独规划和授权。

## 禁止事项

- 不写服务器地址、账号、密码、token、namespace、远程路径或任何敏感连接信息。
- 不把业务项目私有事实写入本仓库插件、规则、模板或维护记忆。
- 不把 `AGENTS.md` 复制成 `CLAUDE.md` 或 `CODEBUDDY.md`；兼容入口如存在，只允许是指向 `AGENTS.md` 的 symlink。
- 不把能力包维护者记忆当成业务项目 `.agents/memory/project-memory.md` 使用。
