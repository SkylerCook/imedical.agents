# Standard Change Workflow

## 触发与输入

通用代码变更需要任务图、正式角色分工、持续通信、恢复或跨会话协作时使用。输入包含任务、项目入口、范围、`taskKind`、`executionPath`、`orchestrationMode`、adapter capabilities 和独立 authorizations。简单 skill 内只读子 Agent 提效不创建正式 run。

创建 run 前必须先分类且不得混用：业务需求设置 `taskKind=business-demand`，框架能力、版本和治理维护设置 `taskKind=framework-maintenance`，不属于两者的任务设置 `taskKind=other`。`feedbackReviewApplicable` 由 `taskKind` 派生，不能作为绕过分类的独立开关。

## 阶段

1. Coordinator 建立事实范围和任务图。
2. Explorer / Planner 可并行只读；无并行收益时串行。
3. Coding Agent 在唯一 owner 或隔离 worktree 的互斥 scope 中实现。
4. Review Agent 独立审查冻结 diff。
5. Testing Agent 在最终修改后验证；后续修改使验证过期。
6. 按 `taskKind` 进入互斥收尾分支：
   - `business-demand`：进入 `acceptance-pending`，等待用户验收；进入 `accepted` 后做只读 feedback 审查，具体写入仍需独立授权。
   - `framework-maintenance`：进入 `locally-verified`，完成版本、文档、测试和必要同步后进入 `maintenance-complete`；不进入需求验收，不触发或提示 feedback。
   - `other`：只按任务自身完成条件收尾，不进入上述两个生命周期。

## 分支和错误处理

- DAG 无 ready item 且存在非终态 item：标记 deadlock/blocked。
- action 失败且未达到 `maxAttempts`：使用同一 work item 新 attempt；同一结果不得重复 ACK。
- adapter 不可用：按 `serial -> human` 降级。
- 冲突结论按源码、复现和测试证据裁决；不足时请求用户决策。
- 计划增加会话或扩大 scope：撤销旧 `collaborationPlan` 授权并重新展示计划。

## 串行降级与完成条件

无 subagent、无多会话 API、无 skill 或无法解析 YAML 时，单 Agent 直接读取本 Markdown，按相同阶段和门禁串行执行。任务图终态、最终验证新鲜、无未决 action，且业务需求已验收或框架维护已进入 `maintenance-complete` 后才可完成。commit、merge、push、部署和 feedback 写入仍需各自授权。
