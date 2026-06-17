# AGENTS.md

## 适用范围

本文件只适用于维护 `imedical.agents` 能力包仓库本身。

它不部署到业务项目 `.agents/`，也不是业务项目的 Agent 入口。业务项目仍使用业务项目根目录自己的 `AGENTS.md`、`.agents/rules/`、`.agents/memory/` 和 `.agents/config/`。

## 新会话启动

维护本仓库时先读取：

1. `memory/agent-kit-maintenance-memory.md`：入口摘要、必读路由和当前重点。
2. 按任务继续读取：
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
- 不写完整 rules 正文、长段脚本说明、大段命令输出或一次性排障日志。

## 目录边界

- `agents/` 放厂商无关的智能体 canonical 定义；不放 Codex、Claude Code、OpenCode、CodeBuddy、WorkBuddy、Hermes 等工具专属生成物。
- `workflows/` 放厂商无关的阶段化或多智能体协作流程；workflow 必须支持无子代理能力时的单 Agent 串行降级。
- `plugins/` 放可复用能力包；插件内可以包含 rules、skills、references、templates、scripts、commands、agents 或 hooks。
- `skills/` 放仓库级通用 skill。
- `rules/` 是仓库级通用规则预留入口；当前通用规则主要沉淀在插件内。
- `docs/` 放 AI Coding 工作区规范、runbook 和配套文档。
- 根 `scripts/` 放能力包部署、更新和通用维护脚本；领域脚本放到对应插件。
- 根 `vendor/` 放第三方源码资产和共享运行时资产（如 HISUI dist、iris-agentic-dev Windows x64 可执行文件），部署到业务项目 `.agents/vendor/`，不参与 thin-index 生成。
- 根 `memory/` 是维护者记忆，不部署到业务项目 `.agents/`，不生成 thin-index。
- 根 `feedback/` 放框架反馈和经验积累，部署到业务项目 `.agents/`；`feedback/framework/` 放框架验证反馈条目，`feedback/experience/` 放领域经验文档。
- 根 `index.html`、`.github/`、`.nojekyll` 只服务 GitHub Pages 展示页。

## 部署边界

业务项目通过安装或更新脚本只检出运行需要的能力包内容：`agents/`、`workflows/`、`docs/`、`rules/`、`skills/`、`plugins/`、`vendor/`、`feedback/` 和根 `scripts/*.ps1`。

不要把以下内容加入业务项目 `.agents` sparse checkout：

- 根 `AGENTS.md`
- 根 `memory/`
- 根 `README.md`、`LICENSE`
- 根 `index.html`
- `.github/`
- `.nojekyll`
- `scripts/tests/`

## 维护约束

- 维护当前工程时必须考虑不同模型能力和不同 Agent 工具的普适性；canonical 内容不得绑定单一厂商、单一模型或单一运行器。
- `agents/`、`workflows/`、`plugins/` 是长期能力源；`.codex/agents/`、`.claude/agents/`、`.opencode/`、`.codebuddy/agents/`、Hermes 或 WorkBuddy 入口只能作为 adapter 生成物或临时适配层。
- canonical 中不要写死具体模型名或订阅档位；需要表达模型能力时使用 `fast`、`balanced`、`strong`、`deep-reasoning` 等抽象档位，由工具 adapter 映射到实际模型。
- 新增 workflow 时必须说明无 subagent、无 skill 或无法解析 YAML 时的降级路径，保证弱模型或能力较少的 Agent 仍可按 Markdown 串行执行。
- 修改 thin-index 生成行为时，只改根 `scripts/generate-plugin-thin-index.ps1`；各插件同名脚本只能作为 wrapper。
- Agent thin-index 或工具 adapter 生成逻辑不得混入 plugin thin-index；需要时新增独立脚本。
- 修改插件目录结构时，同步检查插件 `AGENTS.md`、README、manifest、templates、仓库 README 和相关 docs。
- 新增长期通用能力时，先判断应放入 `agents/`、`workflows/`、`rules/`、`references/`、`skills/`、`templates/`、`scripts/` 还是插件目录。
- 新增文件遵循命名约定：agent 目录 kebab-case + `-agent`，workflow 文件 kebab-case + `.workflow.md`，skill 目录 kebab-case，rule 文件 snake_case，reference 文件 kebab-case，script 文件 kebab-case。
- 对已部署业务工程有影响的变更，必须说明同步步骤和兼容清理策略。

## 禁止事项

- 不写服务器地址、账号、密码、token、namespace、远程路径或任何敏感连接信息。
- 不把业务项目私有事实写入本仓库插件、规则、模板或维护记忆。
- 不把 `AGENTS.md` 复制成 `CLAUDE.md` 或 `CODEBUDDY.md`；兼容入口如存在，只允许是指向 `AGENTS.md` 的 symlink。
- 不把能力包维护者记忆当成业务项目 `.agents/memory/project-memory.md` 使用。
