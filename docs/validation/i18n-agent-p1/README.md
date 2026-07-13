# i18n-agent P1 真实项目验证

本目录记录 `i18n-agent`、`i18n-change`、handoff 和串行/多智能体执行方式的脱敏验证结果。

## 当前状态

| 阶段 | 状态 | 说明 |
|---|---|---|
| `#6096150` 串行复盘 | 已完成 | 使用既有代码和 XML 审计材料，不重放远程写入 |
| 下一真实需求多智能体实战 | 待执行 | 必须明确采用 `multi-agent`，远程写入另行授权 |
| 通用 Workflow/Agent 决策 | 待验证 | 至少完成 2 次真实验证后再判断 |

## 验证边界

- 保留真实需求类型、代码入口和可复用失败模式。
- 不保存连接信息、患者样本、远程路径、完整 XML 或 Base64 载荷。
- 当前 `24m40s` 只作为定性基线；历史运行没有阶段计时，不推测各阶段耗时。
- 本阶段不实现复杂运行时调度器、工具 Adapter 或通用角色 Agent。

## 验证入口

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .agents/plugins/agent-context-kit/scripts/validate-agent-run.ps1 `
  -RunDirectory .agents/docs/validation/i18n-agent-p1/retrospective-6096150
```
