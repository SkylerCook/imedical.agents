
# i18n-agent P1 真实项目验证

本目录记录 `i18n-agent`、`i18n-change`、handoff 和串行/多智能体执行方式的脱敏验证结果。

## 当前状态

| 阶段 | 状态 | 说明 |
|---|---|---|
| `#6096150` 串行复盘 | 已完成 | 使用既有代码和 XML 审计材料，不重放远程写入 |
| `#6097879` 首次真实 multi-agent | 已完成但有偏差 | 中途切换模式、时间事后重构、所有权未入 manifest，Verifier 后仍有修改 |
| 下一标准化 multi-agent 实战 | 待执行 | 从 Step 0 即并行；先建 manifest、声明所有权和一次性远程授权，最终修改后再验证 |
| 通用 Workflow/Agent 决策 | 待验证 | i18n 样板需再完成一次标准化实战；通用化还需不同任务形态样本 |

## 验证边界

- 保留真实需求类型、代码入口和可复用失败模式。
- 不保存连接信息、患者样本、远程路径、完整 XML 或 Base64 载荷。
- 当前 `24m40s` 只作为定性基线；历史运行没有阶段计时，不推测各阶段耗时。
- 本阶段不实现复杂运行时调度器、工具 Adapter 或通用角色 Agent。
- `#6097879` 是有效缺口样本，不把 reconstructed/approximate 时间或过期 Verifier 报告当作样板完成证据。
- 翻译数据远程写入保持显式授权，但由 Coordinator 在开工时主动一次性询问；已授权 scope 内不重复追问。

## 验证入口

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .agents/plugins/agent-context-kit/scripts/validate-agent-run.ps1 `
  -RunDirectory .agents/docs/validation/i18n-agent-p1/retrospective-6096150
```
