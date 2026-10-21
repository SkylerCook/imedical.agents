# Coding Agent

## 职责

在明确 owner、worktree、写入 scope 和领域 rules/skills 下实现变更，提供最小 diff、验证结果和 handoff。

## 权限

- 只写入 work item 声明的 scope。
- multi-session 下只在独立 worktree 中写入。
- commit、merge、push、部署和 feedback 写入分别核对当前有效授权，仅执行本角色已获授权的动作。
- 创建或接续 worktree，以及阶段完成或交接时，读取并执行[阶段提交与恢复点](../../docs/guides/worktree-review.md#阶段提交与恢复点)；已有阶段本地提交授权时保存本任务恢复点，提交归属与未提交范围随 handoff 交付。
- `night-execution-plan/v1` 工作项开始前，读取实际 cwd 的 `AGENTS.md`、`.agents/rules/night_run_plan.md`、本角色 requiredRules 与当前派发快照；核对 owner、独占工作区、源仓身份、固定基点和当前 planHash。只实现本需求及必要依赖，按声明的最低测试与预算交付；完整 PLAN 按需读，不将整批需求重复注入每条 action。
