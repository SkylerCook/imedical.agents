# imedical.agents 后续治理队列

本文件记录 `imedical.agents` 能力包仓库的后续计划、暂缓事项和治理优先级。入口摘要见 `agent-kit-maintenance-memory.md`，长期决策见 `agent-kit-maintenance-decisions.md`，近期维护流水见 `agent-kit-maintenance-log.md`。

## 下一步工作队列

1. 多人协作下的仓库维护约束治理。
   - 背景：仓库权限已放开给多位同事，需要把“改能力包必须同步维护约束”的流程前置，减少实际内容、README、插件文档、维护记忆和部署边界之间的偏移。
   - 待做：梳理提交前检查清单，覆盖目录边界、thin-index 边界、vendor 边界、敏感信息、README/AGENTS/manifest 同步、维护记忆更新和已部署工程兼容说明。
   - 待做：明确多人协作分工与准入规则，例如 canonical、插件、脚本、vendor、memory 分别由谁维护，哪些变更必须配套测试或文档更新。
   - 待做：评估是否新增轻量治理文档、PR/提交检查清单或自动化脚本；先固化 Markdown 约束，再决定是否脚本化。

2. 多智能体架构配套落地。
   - 待做：业务项目验证 `i18n-agent` 和 `i18n-change.workflow.md` 样板后，再决定是否新增通用 `coordinator/explorer/planner/coding/review/testing` Agent。
   - 暂缓：暂不做 `scripts/generate-agent-adapters.ps1`；后续确需 Codex、Claude Code、OpenCode、CodeBuddy、WorkBuddy、Hermes 等工具原生入口时再实现。
   - 禁止：不要让 `.codex/agents/`、`.claude/agents/`、`.opencode/`、`.codebuddy/agents/` 或其它工具原生入口成为规则源；它们只能由 canonical 生成或临时适配。

3. 继续观察 rules 体量。
   - 若 i18n 或 coding 规则再次承载查找表、API 目录或长参考资料，优先迁入对应插件 `references/`。

4. 多智能体运行时调度器暂不实现。
   - 当前阶段只落地 canonical 定义、workflow、交接协议和工具 adapter。
   - 暂不实现复杂自动并行调度器；等业务项目验证 i18n 样板后，再决定是否扩展 coordinator 运行时逻辑。
   - 后续可考虑新增 `standard-change`、`review-test-release`、`bugfix` workflow 和通用 `coordinator/explorer/planner/coding/review/testing` Agent。

5. 框架验证反馈机制。
   - 待做：团队成员开始使用后，观察反馈质量和处理效率。
   - 待做：积累反馈后，评估是否需要自动化 diff 和应用工具。

6. 部署经验与演示材料治理。
   - 待做：观察 `feedback/experience/deploy-com-exp.md` 与 `docs/deploy/*` 的复用频率，必要时抽象命名、敏感信息检查和部署工具模板。
   - 待做：明确 `demo/presentation/` 是否长期作为仓库展示资产；如需部署到业务项目，必须先更新安装/更新 sparse checkout 边界说明。

7. 提交前检查向代码质量 review 演进。
   - 背景：当前 `.agents/hooks/pre-commit` 和 `check-functional-diff.ps1` 只做提交卫生与差异降噪，适合保持为轻量、低误伤、可机械判断的门禁。
   - 待做：评估新增第二层代码质量检查脚本，例如 `.agents/scripts/check-code-quality.ps1`，默认由 Agent 或用户在提交前主动运行，先输出报告，不直接作为 pre-commit 阻断。
   - 待做：优先沉淀低误伤规则：需求无关文件变更、敏感配置/连接信息、明显硬编码路径、缺少必要验证入口、ObjectScript/JS/CSP 项目规则高风险点。
   - 待做：与 coding/i18n/doctor 等领域插件规则联动时，只读取已启用插件和项目上下文；不得把所有领域规则塞进通用 hook 常驻检查。
   - 暂缓：不要立即把代码质量 review 接入 `pre-commit` 强阻断；先以手动脚本或 Agent 提交前 review 报告验证误伤率，成熟后再挑少量规则进入门禁。

## 队列维护规则

- 已完成事项迁入 `agent-kit-maintenance-log.md`，不要在 backlog 中长期保留已完成条目。
- 已固化为长期约束的事项迁入 `agent-kit-maintenance-decisions.md`。
- 不记录短期个人提醒；只保留会影响后续 Agent 决策的治理任务。
