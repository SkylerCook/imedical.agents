# imedical.agents 后续治理队列

本文件记录 `imedical.agents` 能力包仓库的后续计划、暂缓事项和治理优先级。入口摘要见 `agent-kit-maintenance-memory.md`，长期决策见 `agent-kit-maintenance-decisions.md`，近期维护流水见 `agent-kit-maintenance-log.md`。

## 下一步工作队列

1. 多智能体架构配套落地。
   - 待做：业务项目验证 `i18n-agent` 和 `i18n-change.workflow.md` 样板后，再决定是否新增通用 `coordinator/explorer/planner/coding/review/testing` Agent。
   - 暂缓：暂不做 `scripts/generate-agent-adapters.ps1`；后续确需 Codex、Claude Code、OpenCode、CodeBuddy、WorkBuddy、Hermes 等工具原生入口时再实现。
   - 禁止：不要让 `.codex/agents/`、`.claude/agents/`、`.opencode/`、`.codebuddy/agents/` 或其它工具原生入口成为规则源；它们只能由 canonical 生成或临时适配。

2. 继续观察 rules 体量。
   - 若 i18n 或 coding 规则再次承载查找表、API 目录或长参考资料，优先迁入对应插件 `references/`。

3. 多智能体运行时调度器暂不实现。
   - 当前阶段只落地 canonical 定义、workflow、交接协议和工具 adapter。
   - 暂不实现复杂自动并行调度器；等业务项目验证 i18n 样板后，再决定是否扩展 coordinator 运行时逻辑。
   - 后续可考虑新增 `standard-change`、`review-test-release`、`bugfix` workflow 和通用 `coordinator/explorer/planner/coding/review/testing` Agent。

4. 继续评估是否新增 `agent-kit-maintenance` 专用 skill。
   - 根 `AGENTS.md` 继续承载本仓库维护入口、记忆路由和维护规则。
   - 若“查看近期提交、归纳维护记忆、同步 README/docs、检查 sparse checkout 边界、审查敏感信息”形成稳定高频流程，再抽成专用 skill；抽象前不得复制长篇维护记忆或脚本正文。

5. 框架验证反馈机制。
   - 待做：团队成员开始使用后，观察反馈质量和处理效率。
   - 待做：积累反馈后，评估是否需要自动化 diff 和应用工具。

6. 部署经验与演示材料治理。
   - 待做：观察 `feedback/experience/deploy-com-exp.md` 与 `docs/deploy/*` 的复用频率，必要时抽象命名、敏感信息检查和部署工具模板。
   - 待做：明确 `demo/presentation/` 是否长期作为仓库展示资产；如需部署到业务项目，必须先更新安装/更新 sparse checkout 边界说明。

## 队列维护规则

- 已完成事项迁入 `agent-kit-maintenance-log.md`，不要在 backlog 中长期保留已完成条目。
- 已固化为长期约束的事项迁入 `agent-kit-maintenance-decisions.md`。
- 不记录短期个人提醒；只保留会影响后续 Agent 决策的治理任务。
