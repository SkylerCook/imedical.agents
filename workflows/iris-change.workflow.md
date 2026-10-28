# IRIS Change Workflow

本 workflow 在 `standard-change` 上增加 IRIS 领域路由，通用调度、通信、恢复、验收和授权契约不重复定义。

## 前置

- 先读取当前 ContextRoot 的 `config/iris-development.json` 的 `developmentMode`。`offline` 按 coding owner 的[离线开发协议](../plugins/coding-iris-plugin/references/iris-offline-development.md)执行人工材料、本地修改/检查/Review、交付和待现场验收，不进入服务器同步或远端阶段；向角色传递同一配置引用。缺省沿旧 `connected` 行为，非法值停止。

- 读取项目 `AGENTS.md`、plugin profile 和 IRIS project profile。
- 读取 `workflows/standard-change.workflow.md`。
- 使用 `iris-coding` 判断 `executionPath: fast | full | guarded`；它与 `orchestrationMode` 独立。
- 当前需求 `standard`／`project` 及来源随 handoff 传递，不能由 contextMode 或 workflow 名称推导；`standard-change` 表示通用协作流程。项目按需导出命中时加载 coding owner 的[项目开发协议](../plugins/coding-iris-plugin/references/project-demand-development.md)，公共角色不复制分支正文。
- 本 workflow 处理业务需求时固定设置 `taskKind=business-demand`，并由此派生 `feedbackReviewApplicable=true`；若仅维护框架本身，必须改走 `agent-kit-maintenance` 和框架维护生命周期，不得创建需求验收状态。

## 领域阶段

1. Explorer 定位 CSP/JS/CSS/ObjectScript/HISUI/接口入口与现有模式。
2. Planner 按前端、后端、i18n、HISUI、编码和远端动作信号绑定命中的 rules/skills。
3. Coding Agent 在受控 scope 内实现；复杂写入可拆至隔离 worktree。
4. Review / Testing 检查编码、稳定翻译 key、diff、目标测试及最终修改后的验证新鲜度。

明确 i18n 需求可由 `i18n-agent` 复用同一 `scripts/agent-orchestrator.js` 和通用角色，但继续使用 `i18n-change.workflow.md` 的分类、模板与翻译阶段。不支持正式 adapter 时退化到 `serial`；需要用户操作或验收时使用 `human`。不允许因能力缺失跳过适用 IRIS rules/skills。
