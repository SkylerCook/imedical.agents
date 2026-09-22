# AGENT 协作调度协议

本协议定义正式协作 run，与 skill 内部临时只读子 Agent 提效严格分离。

## 独立决策维度

- `executionPath: fast | full | guarded` 描述开发路径和门禁深度。
- `orchestrationMode: serial | subagent | multi-session` 描述任务由何种执行形态完成。

`fast` 不表示可跳过适用 rules/skills，`multi-session` 也不表示获得写入、commit、merge、push 或部署授权。

- guidanceMode: auto | concise | assisted 只控制辅助程度，见 execution-guidance.md；不影响权限与门禁。

普通 skill 和短时只读协助不创建正式 run；持久恢复、正式任务图、并行写入、跨会话协作或用户明确要求才进入本协议。full/guarded 不自动启动六角色。无原生 skill/YAML 时直接按 Markdown 执行；无协作能力时串行，不能保持隔离则停止。

## 状态与文件

- 正式 run 使用 schema `2.0`，默认位于 `docs/agent-reports/<run-id>/`。
- `taskKind` 必须先分类为 `business-demand`、`framework-maintenance` 或 `other`。业务需求和框架维护使用互斥状态机；同一对话同时包含两类工作时建立独立记录，不共享验收、feedback 或完成状态。
- `events.jsonl` 是追加事件事实源，`00-run-manifest.json` 是当前投影。
- Coordinator 是唯一运行状态写入者；参与者通过 action result、message 和 handoff 返回结果。
- 消息和交接正文保存为 `messages/*.md`、`handoffs/*.md` 小文件。
- schema `1.0–1.2` 仅允许只读 `status` / `validate`，不得原地迁移。

## 授权

协作计划、远程写入、commit、merge、push、部署和 feedback 写入相互独立。`multi-session` 开始前展示任务图、会话数、角色、worktree、读写范围及不包含的外部动作；一次授权只覆盖当前 `planHash`。新增会话或扩大范围后必须重新授权。

可写的 multi-session 参与者必须使用不同隔离 worktree，并拥有互斥文件或模块范围；Coordinator 是唯一集成 owner。冲突按源码、可复现结果和测试证据裁决，无法裁决时请求用户决策。

## Adapter contract

调度器只生成 action，不直接调用产品 API。宿主 adapter 返回：

```json
{"actionId":"act-...","status":"succeeded","endpointId":"opaque-id","artifactRefs":["handoffs/result.md"],"error":null}
```

首批 adapter 名称为 `serial`、`subagent`、`session`、兼容入口 `codex-session`、`human`。运行时 capability probe 发现 adapter 不可用时，按 workflow 声明降级到 `serial` 或 `human`；能力缺失不得伪装为执行中故障。已确认 action 的幂等键不得再次执行。

## 完成、恢复和验证证据

完成命令和 validate --final 共用门禁：无 pending/blocked action、无未完成或失败 work item、有效验证、业务 accepted 或维护 maintenance-complete。授权请求被对应授权满足后确认请求 action，不冒充业务执行成功。blocked ACK 表示结果待核实，不自动重试；明确核实后以 --entity action --id <id> --status cancelled --actor user --evidence-ref <结果依据> 关闭未决动作，再恢复同一 work item。

写入 run 验证通过时使用 --verification-file，绑定 validation-evidence.js 的实际通过证据；完成前重新计算 scope 指纹，源码、产物和远端读回快照变更使验证失效。详细 CLI 见 docs/agent-orchestration.md。旧 schema 1.0–1.2 只读，旧 2.0 可补验证证据，不重写历史事件。

feedbackReviewPolicy 新建默认 on-signal；旧记录缺省 always。业务验收不变；on-signal 无候选可显式 skipped/no-signal，重新修改后重置。辅助与反馈策略不加入 planHash，不改变历史 action ID/幂等键。

验证仓库身份：串行写入计划必须显式声明 repositoryRoot（实际仓库绝对路径）；隔离参与者使用绝对 worktree.ref。证据必须同时匹配仓库身份和受测路径，不能用另一仓库的同名文件通过验证。旧 run 缺少身份时通过 plan patch 补充并重新验证；新增 repositoryRoot 才进入 planHash，不改变未声明该字段的历史哈希。
