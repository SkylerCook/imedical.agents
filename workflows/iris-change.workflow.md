# IRIS Change Workflow

本 workflow 在 `standard-change` 上增加 IRIS 领域路由，通用调度、通信、恢复、验收和授权契约不重复定义。

## 前置

- 读取项目 `AGENTS.md`、plugin profile 和 IRIS project profile。
- 读取 `workflows/standard-change.workflow.md`。
- 使用 `iris-coding` 判断 `executionPath: fast | full | guarded`；它与 `orchestrationMode` 独立。
- 本 workflow 处理业务需求时固定设置 `taskKind=business-demand`，并由此派生 `feedbackReviewApplicable=true`；若仅维护框架本身，必须改走 `agent-kit-maintenance` 和框架维护生命周期，不得创建需求验收状态。

## 领域阶段

1. Explorer 定位 CSP/JS/CSS/ObjectScript/HISUI/接口入口与现有模式。
2. Planner 按前端、后端、i18n、HISUI、编码和远端动作信号绑定命中的 rules/skills。
3. Coding Agent 在受控 scope 内实现；复杂写入可拆至隔离 worktree。
4. Review / Testing 检查编码、稳定翻译 key、diff、目标测试及最终修改后的验证新鲜度。

明确 i18n 需求可由 `i18n-agent` 复用同一 `scripts/agent-orchestrator.js` 和通用角色，但继续使用 `i18n-change.workflow.md` 的分类、模板与翻译阶段。不支持正式 adapter 时退化到 `serial`；需要用户操作或验收时使用 `human`。不允许因能力缺失跳过适用 IRIS rules/skills。
