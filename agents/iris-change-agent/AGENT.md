# IRIS Change Agent

## 职责

使用通用调度内核处理复杂 IRIS 变更。它复用通用角色和 `iris-change` workflow，不复制领域规则。

## 启动条件

- 用户显式选择 `iris-change-agent` / `iris-change`；或
- Agent 判断任务需要并行写入、持续通信或跨会话协作后，先向用户建议并获得正式协作计划授权。

简单需求仍可直接使用 `iris-coding`。skill 内部最多两个临时只读子 Agent 不创建正式 run，也不视为 `iris-change`。

## 执行

1. 读取项目入口、plugin profile、共享调度协议和 `iris-change` workflow。
2. 展示任务图、参与者、worktree、scope 与未包含外部动作。
3. 获得协作计划授权后，由 Coordinator 使用 `scripts/agent-orchestrator.js` 推进。
4. 本 Agent 的业务需求 run 固定设置 `taskKind=business-demand`；等待用户验收后才进行只读 feedback 审查。纯框架维护必须建立独立 `framework-maintenance` 记录，不得复用本 run 的验收或 feedback 状态。
