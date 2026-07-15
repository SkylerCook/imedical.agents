
# i18n-agent P1 真实项目验证

本目录记录 `i18n-agent`、`i18n-change`、handoff 和串行/多智能体执行方式的脱敏验证结果。

## 当前状态

| 阶段 | 状态 | 说明 |
|---|---|---|
| `#6096150` 串行复盘 | 已完成 | 使用既有代码和 XML 审计材料，不重放远程写入 |
| `#6097879` 首次真实 multi-agent | 已完成但有偏差 | 中途切换模式、时间事后重构、所有权未入 manifest，Verifier 后仍有修改 |
| `#6097891` 标准化 multi-agent | 已完成，异常路径已回归 | 从 Step 0 建 manifest 并声明所有权；暴露 MCP 瞬时失败、阶段恢复和提前 Verifier 缺口，已用 schema 1.2 脱敏 fixture 机械复现 |
| 通用 Workflow/Agent 决策 | 待验证 | i18n 主路径和异常恢复路径已形成；通用化仍需不同任务形态样本 |

## 验证边界

- 保留真实需求类型、代码入口和可复用失败模式。
- 不保存连接信息、患者样本、远程路径、完整 XML 或 Base64 载荷。
- 当前 `24m40s` 只作为定性基线；历史运行没有阶段计时，不推测各阶段耗时。
- 本阶段不实现复杂运行时调度器、工具 Adapter 或通用角色 Agent。
- `#6097879` 是有效缺口样本，不把 reconstructed/approximate 时间或过期 Verifier 报告当作样板完成证据。
- `#6097891` 的单次 HTTP 404 不代表 `iris_query` 持续不可用；后续复测 `SELECT 1 AS Probe` 成功。`config_file=null` 在自动发现生效且真实探针成功时不构成配置失败。
- `standardized-6097891` 是脱敏异常恢复回归：暂停时间不计入活动窗口，恢复通过同一阶段的下一 attempt 表达，远程动作终态后只运行一次有效 Verifier。
- 翻译数据远程写入保持显式授权，但由 Coordinator 在开工时主动一次性询问；已授权 scope 内不重复追问。

## 验证入口

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .agents/plugins/agent-context-kit/scripts/validate-agent-run.ps1 `
  -RunDirectory .agents/docs/validation/i18n-agent-p1/retrospective-6096150

powershell -NoProfile -ExecutionPolicy Bypass -File `
  .agents/plugins/agent-context-kit/scripts/validate-agent-run.ps1 `
  -RunDirectory .agents/docs/validation/i18n-agent-p1/standardized-6097891
```
