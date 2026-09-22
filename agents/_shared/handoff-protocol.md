
# Agent Handoff Protocol

本文件定义多智能体或阶段化单 Agent 执行时的交接协议。

普通需求的同机跨会话接续使用 `plugins/agent-context-kit/skills/task-handoff/SKILL.md`（相对能力根），材料归目标项目 `docs/handoff/`，不强制创建正式 run。已存在正式 run 时只引用其状态与证据，以下阶段报告目录和 schema 契约保持不变。

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

## schema 2.0 通用运行契约

新 run 使用 `agents/_shared/orchestration-protocol.md`：Coordinator 经 `scripts/agent-orchestrator.js` 维护 `events.jsonl` 与 `00-run-manifest.json`，参与者通过 `messages/*.md`、`handoffs/*.md` 和统一 action result 交接。报告文件名由 workflow/work item 决定，不再由通用协议硬编码。

轻量交接正文建议保持：

```text
scope: 检查或实现范围
evidence: 文件、符号、测试或运行证据
conclusion: 已确认结论
uncertainties: 尚未确认内容
recommendedNextStep: 建议下一步
filesChanged: none 或受控路径
```

## i18n 阶段报告约定

历史 fixture 与专项验证样本可使用以下命名；新运行实际报告由 workflow/work item 决定：

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

验证样本保留逐阶段报告；普通运行允许合并报告，不适用阶段只记录原因，完成条件不减少。

### `00-run-manifest.json`

新运行通过 agent-orchestrator.js init --plan 创建 schema 2.0，不手写投影。字段、授权、恢复、反馈与最终验证以 orchestration-protocol.md 和 docs/agent-orchestration.md 为准。

- participants/workItems 声明 owner、依赖、读写范围；events.jsonl 是追加事实源。
- actions 的 pending/blocked 不能成功完成；workItems[].attempts 记录真实尝试，未知结果先核实。
- verification.scopes/evidenceSnapshots 覆盖实际业务代码、本地产物和已授权远端读回；完成时复核指纹。
- 阶段报告属于交接证据，不能代替实际源码、授权、执行和验收结果。不同角色不是必须启动不同会话。
- schema 1.0–1.2 历史样本保持只读，其 stages/remoteActions/finalization 字段不复制到新 manifest；旧样本规范由对应 fixture 与 legacy validator 保存。
- 不记录凭据、患者信息或完整远程载荷；跨模型性能只能来自真实轨迹，不设机械并行耗时达标比例。

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
