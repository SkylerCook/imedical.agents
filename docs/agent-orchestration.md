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

`next` 只生成幂等 action。宿主根据 capability probe 执行 `serial`、`subagent`、`session`（兼容 `codex-session`） 或 `human` action，再用 `ack` 返回结果；CLI 不包含产品 API、凭据或远程连接逻辑。

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

验证与提交解耦：`scripts/validation-evidence.js` 按 suite 记录验证命令、结果、scope 和 worktree 指纹。提交阶段先 `check`；scope 指纹未变化时复用已通过证据，只有受测范围变化才补跑对应测试。证据默认保存在系统临时目录，不纳入 Git。

框架转稳定前完成并分开统计：

- 复杂 i18n 正式 AGENT run；
- 复杂非 i18n 正式 AGENT run；
- 一个 `validationSample=true` 的简单 multi-session run；
- 后续五个简单 `iris-coding` 需求作为 skill 提效样本，记录从开始定位到补丁、本地验证和 `acceptance-pending` 的时间、关键工具调用数、无效 skill 加载、临时子 Agent 启动/节省时间、返工和未验收 feedback 次数。

简单 multi-session 样本不计入 fast-path 性能结论。任一正式样本失败时修复并补跑同类。

## 演进契约：方法自由、反馈策略与验证绑定

普通 skill 与短时只读协助不建正式 run。full/guarded 不自动触发多角色；辅助选择见 agents/_shared/execution-guidance.md。session 是通用 create-session adapter，codex-session 保留兼容；未知名称不视为支持。隔离写入无法保持端点时停止降级并重新规划。

新 run 可选 feedbackReviewPolicy: always | on-signal，缺省 on-signal；已有 2.0 记录缺省 always，不重写历史事件、planHash 或 action ID。验收后有信号时审查并 transition feedback-decision completed，无信号用 --status skipped --reason no-signal；只允许 on-signal、无候选、业务已 accepted。新修改重置判断。写反馈仍独立授权。

### 写入范围的最终验证

1. 所有已授权业务写入和远程动作已终态，冻结源码、本地产物、获授权远端读回快照；将快照置于目标项目私有受测目录（Git 忽略的快照必须逐个以明确文件 scope 绑定，不能只填写被忽略目录），不把凭据或患者信息加入报告。远端快照仅证明当次读回，不构成远端持续监测。
2. 执行真实测试后使用 validation-evidence.js record --repo-root <root> --suite <suite> --scope <受测路径> --command <原命令> --evidence-file <私有证据文件> 记录结果。该工具不代替执行测试，不允许预填通过。
3. 创建私有 JSON 绑定数组，每项为 {"repoRoot":"<absolute-root>","suite":"<suite>","evidenceFile":"<absolute-file>"}。覆盖所有 work item 的 writeScopes；隔离参与者 worktree.ref 必须是实际绝对路径，每个 worktree 单独提供证据。最终集成仓库也提供相应绑定。
4. agent-orchestrator.js transition --run-directory <run> --entity verification --status passed --verification-file <bindings.json>：校验通过证据并把 scopes/head/fingerprint 保存进 verification.evidenceSnapshots。无写范围的纯只读 run 可不提供此参数。
5. transition run completed 与 validate --final 共用门禁，重新计算保存的指纹；后续重录外部证据不能覆盖 run 中的旧指纹。受测内容变动必须重验。业务尚未验收时停在 acceptance-pending，不伪造 accepted。

旧 2.0 写入 run 若缺少指纹，仍可 status/普通 validate，只在完成或 --final 时要求补证据。schema 1.0–1.2 保持只读。报告、manifest、feedback 不应混入业务 scope；不得用全仓范围使每次报告写入都失效。

### 暂停、未知结果和恢复

ACK blocked 保留 action/work item 阻塞，不自动重试；失败确认且未超 maxAttempts 才可产生下一 attempt。远程结果未知先只读核实，用户确认结果后 transition --entity action --id <id> --status cancelled --actor user --evidence-ref <核实依据>，再将原 work-item 恢复 pending。此操作不表示远程写入已成功，不扩大授权。普通临时等待不使用固定心跳时限重建会话。

完成门禁还拒绝 failed work item、pending/blocked action、缺失验证和未完成反馈决定。不要先写 completed 再运行最终校验；失败必须保留原状态。

验证仓库身份：串行写入计划必须显式声明 repositoryRoot（实际仓库绝对路径）；隔离参与者使用绝对 worktree.ref。证据必须同时匹配仓库身份和受测路径，不能用另一仓库的同名文件通过验证。旧 run 缺少身份时通过 plan patch 补充并重新验证；新增 repositoryRoot 才进入 planHash，不改变未声明该字段的历史哈希。
