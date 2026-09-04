# AGENT 协作调度运行手册

## 能力边界

正式 AGENT workflow 管理任务图、角色、会话、通信、交接、调度、恢复和验证；它不等于启动 subagent。`iris-coding` 等 skill 为提效而使用的最多两个临时只读子 Agent 不创建 run，主 Agent 保持唯一写入者。

新 run 使用 schema `2.0`。历史 `1.0–1.2` 仅支持 `status` 和 `validate`，不会原地重写。

## CLI

```text
node .agents/scripts/agent-orchestrator.js init --run-directory docs/agent-reports/<run-id> --plan <plan.json>
node .agents/scripts/agent-orchestrator.js next --run-directory docs/agent-reports/<run-id> --json
node .agents/scripts/agent-orchestrator.js ack --run-directory docs/agent-reports/<run-id> --result <result.json>
node .agents/scripts/agent-orchestrator.js message --run-directory docs/agent-reports/<run-id> --from <id> --to <id> --type handoff --body-file <file>
node .agents/scripts/agent-orchestrator.js transition --run-directory docs/agent-reports/<run-id> --entity <kind> --status <state>
node .agents/scripts/agent-orchestrator.js status --run-directory docs/agent-reports/<run-id> --json
node .agents/scripts/agent-orchestrator.js validate --run-directory docs/agent-reports/<run-id> [--final]
```

`next` 只生成幂等 action。宿主根据 capability probe 执行 `serial`、`subagent`、`codex-session` 或 `human` action，再用 `ack` 返回结果；CLI 不包含产品 API、凭据或远程连接逻辑。

## multi-session 授权

运行前展示完整任务图、会话数、稳定标题 `<主题> · <角色> · <工作项>`、worktree、读写 scope 和不包含的外部动作。`collaborationPlan` 授权只覆盖当前 `planHash`；使用 `transition --entity plan --patch-file ...` 扩大计划后会自动撤销授权并使验收/验证过期。

可写参与者必须使用不同的 `worktree.ref` 和互斥 scope。所有 work item 完成后，调度器只生成 `prepare-integration` action，等待独立 `merge` 授权；不会执行 merge。

## 需求验收与框架维护

schema 2.0 先按 `taskKind` 分流，不能用 feedback 布尔开关代替任务分类：

- `business-demand`：`implementing -> locally-verified -> acceptance-pending -> accepted`。只有 `--actor user` 且提供 `--evidence-ref` 才能进入 `accepted`，随后 feedback review 才变为 `pending`；feedback 写入仍需要 `feedbackWrite` 独立授权。
- `framework-maintenance`：`maintaining -> locally-verified -> maintenance-complete`。`acceptance.status=not-applicable`，不等待业务验收，不触发或提示 feedback。
- `other`：需求验收与框架维护状态均为 `not-applicable`。

若业务需求处理同时产生框架修改，应建立两个记录并各自收尾；调度器拒绝跨生命周期 transition。

## Beta 验证

框架转稳定前完成并分开统计：

- 复杂 i18n 正式 AGENT run；
- 复杂非 i18n 正式 AGENT run；
- 一个 `validationSample=true` 的简单 multi-session run；
- 后续五个简单 `iris-coding` 需求作为 skill 提效样本，记录从开始定位到补丁、本地验证和 `acceptance-pending` 的时间、关键工具调用数、无效 skill 加载、临时子 Agent 启动/节省时间、返工和未验收 feedback 次数。

简单 multi-session 样本不计入 fast-path 性能结论。任一正式样本失败时修复并补跑同类。
