
# Agent Handoff Protocol

本文件定义多智能体或阶段化单 Agent 执行时的交接协议。

协议目标是让上一阶段只交付结构化事实和结论，避免把大量检索日志、命令输出或中间推理污染下一阶段上下文。

## 通用规则

- 交接产物必须区分“已验证事实”“推断”“待确认”。
- 文件路径应使用目标项目内可定位的相对路径或绝对路径；涉及业务项目时按目标项目规则执行。
- 不写服务器地址、账号、密码、token、namespace、远程路径或患者样本等敏感信息。
- 不复制长段日志、完整 diff 或一次性排障流水。
- 无明确工单号时，用短主题作为 `{ticket-or-topic}`。

## 推荐输出位置

```text
docs/agent-reports/{ticket-or-topic}/{stage}-{agent}.md
```

`docs/agent-reports/` 是业务项目工作产物目录，是否入库由业务项目决定；它不属于 `imedical.agents` 能力包内容。

## P1 运行目录契约

P1 串行或多智能体验证统一使用：

```text
docs/agent-reports/{ticket-or-topic}/
  00-run-manifest.json
  10-explorer.md
  11-classifier.md
  20-backend-coder.md
  21-frontend-coder.md
  22-template-seed.md
  30-verifier.md
  40-summary.md
```

不适用阶段也必须保留对应报告，并写明原因，确保 serial 与 multi-agent 使用同一逻辑完成条件。

### `00-run-manifest.json`

运行开始时从 `plugins/agent-context-kit/templates/agent-run-manifest.json` 复制结构并立即填写，不得凭记忆手写字段或在结束后重构阶段时间。

manifest 固定包含：

- `schemaVersion`、`topic`、`runMode`、`retrospective`。
- `authorization.multiAgent` 与 `authorization.remoteWrite`。
- `startedAt`、`completedAt`、`elapsedSeconds`、`timingReason`。
- `stages[]`：`name`、`actor`、`status`、起止时间、`attempts[]`、报告路径、`reusedEvidence`；阶段状态只允许 `completed`、`not-applicable`、`blocked`。
- `failures[]`：稳定错误签名、类别、同类重试次数、是否历史违规、降级方式和结果。
- `qualityGates`：handoff、脱敏、ObjectScript、XML 和并行效率结果。
- `remoteActions[]`：记录动作类型、是否写入、授权、`state`、`terminal` 和脱敏结果，不记录连接或载荷内容。

schema `1.2` 还必须包含：

- `modeHistory[]`：模式、选择时间和原因；真实 `multi-agent` 的第一条模式必须就是 `multi-agent`。
- `ownership[]`：actor、阶段和互斥路径；相同写路径不得分配给不同 actor。
- `capabilities[]`：本次任务实际需要能力的探针、状态和脱敏结果。
- `finalization`：是否已满足最终验证条件、检查时间和终态阻塞。
- `verification`：固定 scope、scope 内最后修改时间和 Verifier 实际检查的版本标识。
- 每个适用阶段至少一个 attempt；attempt 状态允许 `completed`、`blocked`、`suspended`，恢复时递增编号，不创建临时阶段名。
- 写入型 `remoteActions[]` 必须有非空 `scope` 和 `authorizationCategory`；类别区分 `translation-data-write`、`business-code-deploy` 与 `tool-internal-execution`。

validator 继续兼容 schema `1.0` / `1.1` 历史产物；新运行必须使用模板当前 schema，不把旧字段复制到 1.2。

时间使用带时区 ISO 8601。`retrospective` 无法取得阶段时间时允许 `null`，但必须填写 `timingReason`；其它模式必须填写实际时间。

### 机械门禁

- `multi-agent` 要求 `authorization.multiAgent=true`。
- 任一 `remoteActions[].write=true` 要求运行级和动作级远程写入授权均为 `true`。
- 非复盘运行的阶段时间必须实时记录，`timingReason` 为空；禁止使用 reconstructed/approximate 时间通过门禁。
- 真实 `multi-agent` 必须从运行开始即选择该模式，并提供无重叠的 `ownership[]`。
- 写入动作必须有授权类别和 scope；授权 scope 不得由 Agent 自行扩大。
- `verification.lastMutationAt` 不得晚于 Verifier 开始时间，`verification.revision` 不得为空；scope 只包含业务代码、本地 i18n 产物和授权远程读回。
- 所有远程动作必须为终态、无 suspended attempt 且 `finalization.ready=true` 后，才能启动 Verifier。
- 非复盘运行中，同一载荷编译失败签名的等价重试不得超过 1 次。
- XML 阶段触发时必须记录元数据、解析、源语言残留和 fallback 验证结果。
- 报告禁止出现服务器地址、账号、密码、token、namespace、远程路径、长 Base64 或完整 XML 载荷。
- 并行阶段至少有两个活动耗时不低于 60 秒时，attempt 活动区间并集不得高于这些活动耗时之和的 75%；暂停间隔不计入活动窗口，否则标记 `not-applicable`。

使用 `plugins/agent-context-kit/scripts/validate-agent-run.ps1 -RunDirectory <run-directory>` 执行事后只读校验。该脚本只验证产物，不负责调度 Agent 或执行远程动作。

## 事实报告

Explorer 阶段输出事实报告。

```markdown
# 事实报告 - {ticket-or-topic}

## 任务

- 来源：
- 目标：
- 范围：

## 已验证事实

| 事实 | 证据 |
|---|---|
|  |  |

## 影响范围

- 文件：
- 类/方法：
- 页面/入口：

## 待确认

- 

## 下一阶段输入

- 建议下一阶段：
- 必读规则：
```

## 分类清单

Classifier 阶段输出分类清单。

```markdown
# 分类清单 - {ticket-or-topic}

| # | 对象/文本 | 位置 | 类型 | 处理方式 | 证据 | 备注 |
|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  |

## 不处理项

| 对象/文本 | 原因 | 证据 |
|---|---|---|
|  |  |  |
```

## 变更摘要

Coder 或 Template 阶段输出变更摘要。

```markdown
# 变更摘要 - {ticket-or-topic}

## 已修改

| 文件 | 修改摘要 | 对应分类项 |
|---|---|---|
|  |  |  |

## 生成产物

- 

## 未完成/阻塞

- 
```

## 验证报告

Verifier 阶段输出验证报告。

```markdown
# 验证报告 - {ticket-or-topic}

## 验证命令或检查

| 检查项 | 结果 | 证据 |
|---|---|---|
|  |  |  |

## 问题清单

| 严重级别 | 问题 | 位置 | 建议 |
|---|---|---|---|
|  |  |  |  |

## 残余风险

- 
```
