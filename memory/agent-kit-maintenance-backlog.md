# imedical.agents 后续治理队列

本文件记录 `imedical.agents` 能力包仓库的后续计划、暂缓事项和治理优先级。入口摘要见 `agent-kit-maintenance-memory.md`，长期决策见 `agent-kit-maintenance-decisions.md`，近期维护流水见 `agent-kit-maintenance-log.md`。

## 下一步工作队列

### P0：多人协作提交准入与仓库一致性检查

- 背景：仓库权限已放开给多位同事，需要把“改能力包必须同步维护约束”的流程前置，减少实现、README、插件文档、维护记忆和部署边界之间的偏移。
- 交付 1：新增短小的提交/PR 检查清单，覆盖目录、thin-index、vendor、敏感信息、README/AGENTS/manifest、维护记忆、测试和已部署工程兼容说明。
- 交付 2：在现有测试入口增加低误伤的结构检查，至少覆盖 manifest 可解析、插件 README/AGENTS/manifest 齐全、thin-index wrapper 未复制 canonical 实现。
- 交付 3：明确 canonical、插件、脚本、vendor、memory 的维护责任和必须配套的验证证据。

### P1：真实多智能体实战与样板定型

- 在下一项合适的真实 i18n 需求中明确采用 `multi-agent`，走通运行 manifest、阶段 handoff、文件所有权、独立 Verifier 和事后机械校验；远程写入另行授权。
- 结合已完成的 `#6096150` 脱敏串行回溯与下一次真实多智能体实战，在至少两次验证后决定是否新增 `standard-change`、`review-test-release`、`bugfix` workflow，以及通用 `coordinator/explorer/planner/coding/review/testing` Agent。
- 暂不实现复杂运行时调度器，也暂不做 `scripts/generate-agent-adapters.ps1`；工具原生入口只能由 canonical 生成或临时适配，不能成为规则源。

### P2：代码质量 review 与框架反馈演进

- 保持 `.agents/hooks/pre-commit` 和 `check-functional-diff.ps1` 为轻量、低误伤门禁。
- 评估第二层 `check-code-quality.ps1`，先由用户或 Agent 主动运行并输出报告，不直接作为 pre-commit 强阻断。
- 优先覆盖需求无关文件、敏感连接信息、明显硬编码路径、缺少必要验证入口及已启用领域插件中的高风险点；先验证误伤率，再决定是否提升少量规则为门禁。
- 团队开始使用框架反馈机制后，观察反馈质量和处理效率；积累样本后再评估自动化 diff 和应用工具。

### P3：持续观察与资产治理

- 继续观察 rules 体量；若 i18n 或 coding 规则再次承载查找表、API 目录或长参考资料，优先迁入对应插件 `references/`。
- 观察 `feedback/experience/deploy-com-exp.md` 与 `docs/deploy/*` 的复用频率，必要时抽象命名、敏感信息检查和部署工具模板。
- 明确 `demo/presentation/` 是否长期作为仓库展示资产；如需部署到业务项目，必须先更新安装/更新 sparse checkout 边界说明。

## 队列维护规则

- 已完成事项迁入 `agent-kit-maintenance-log.md`，不要在 backlog 中长期保留已完成条目。
- 已固化为长期约束的事项迁入 `agent-kit-maintenance-decisions.md`。
- 不记录短期个人提醒；只保留会影响后续 Agent 决策的治理任务。
