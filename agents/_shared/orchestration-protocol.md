# AGENT 协作调度协议

本协议定义正式协作 run，与 skill 内部临时只读子 Agent 提效严格分离。

## 两个正交维度

- `executionPath: fast | full | guarded` 描述开发路径和门禁深度。
- `orchestrationMode: serial | subagent | multi-session` 描述任务由何种执行形态完成。

`fast` 不表示可跳过适用 rules/skills，`multi-session` 也不表示获得写入、commit、merge、push 或部署授权。

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

首批 adapter 名称为 `serial`、`subagent`、`codex-session`、`human`。运行时 capability probe 发现 adapter 不可用时，按 workflow 声明降级到 `serial` 或 `human`；能力缺失不得伪装为执行中故障。已确认 action 的幂等键不得再次执行。
