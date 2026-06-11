# imedical.agents 后续治理队列

本文件记录 `imedical.agents` 能力包仓库的后续计划、暂缓事项和治理优先级。入口摘要见 `agent-kit-maintenance-memory.md`，长期决策见 `agent-kit-maintenance-decisions.md`，近期维护流水见 `agent-kit-maintenance-log.md`。

## 下一步工作队列

1. 多智能体架构配套落地。
   - 已完成：顶层 canonical `agents/`、`workflows/` 设计和 `i18n-agent` 样板。
   - 已完成：`scripts/install-agents.ps1` 和 `scripts/update-agents.ps1` 已将 `agents/`、`workflows/` 加入业务项目 `.agents` sparse checkout。
   - 已完成：仓库 README、workspace spec、update runbook 和相关 skill 已说明插件状态分流和 i18n-agent 依赖前置。
   - 已完成：新增最小 `scripts/generate-agent-thin-index.ps1` 并接入 `update-agents.ps1`，生成 `.agents/skills/<agent-name>/SKILL.md` 智能体入口。
   - 暂缓：暂不做 `scripts/generate-agent-adapters.ps1`；后续确需 Codex、Claude Code、OpenCode、CodeBuddy 等工具原生入口时再实现。
   - 待做：业务项目验证 i18n 样板后，再决定是否新增通用 `coordinator/explorer/planner/coding/review/testing` Agent。
   - 禁止：不要让 `.codex/agents/`、`.claude/agents/`、`.opencode/` 或 `.codebuddy/agents/` 成为规则源；它们只能由 canonical 生成或临时适配。

2. frontmatter/task-affinity 顺延为下一轮治理项。
   - 排序：当前用户已明确调整优先级到多智能体架构落地；完成 agent thin-index 和部署配套后，adapter 暂缓，frontmatter/task-affinity 后续再进入。
   - 内容：为 rule/reference 文件补充最小 frontmatter，并让 thin-index 传播任务亲和元数据。
   - 禁止：不要重新引入插件脚本副本漂移；frontmatter 解析和传播只改 canonical 脚本。

3. 继续观察 rules 体量。
   - 若 i18n 或 coding 规则再次承载查找表、API 目录或长参考资料，优先迁入对应插件 `references/`。

4. 多智能体运行时调度器暂不实现。
   - 当前阶段只落地 canonical 定义、workflow、交接协议和工具 adapter。
   - 暂不实现复杂自动并行调度器；等业务项目验证 i18n 样板后，再决定是否扩展 coordinator 运行时逻辑。
   - 后续可考虑新增 `standard-change`、`review-test-release`、`bugfix` workflow 和通用 `coordinator/explorer/planner/coding/review/testing` Agent。

5. 暂不新增 `agent-kit-maintenance` 专用 skill。
   - 根 `AGENTS.md` 先承载本仓库维护入口、记忆路由和维护规则。
   - 若后续频繁执行”查看近期提交、归纳维护记忆、同步 README/docs、检查 sparse checkout 边界、审查敏感信息”等固定流程，再抽成专用 skill。

6. 框架验证反馈机制。
   - 已完成：新增 `docs/agent-feedback/` 反馈目录和模板。
   - 已完成：新增 `agents/_shared/feedback-protocol.md` Agent 反馈行为指引。
   - 已完成：`i18n-agent` 和 `i18n-change.workflow.md` 引用反馈协议。
   - 已完成：新增 `skills/agent-framework-feedback/SKILL.md` 通用反馈 skill，支持 plugin 直接使用场景。
   - 待做：团队成员开始使用后，观察反馈质量和处理效率。
   - 待做：积累反馈后，评估是否需要自动化 diff 和应用工具。

## 队列维护规则

- 已完成事项迁入 `agent-kit-maintenance-log.md`，不要在 backlog 中长期保留已完成条目。
- 已固化为长期约束的事项迁入 `agent-kit-maintenance-decisions.md`。
- 不记录短期个人提醒；只保留会影响后续 Agent 决策的治理任务。
