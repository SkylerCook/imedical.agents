# Workflow Registry

本文件是 `imedical.agents` 顶层 workflow 注册表。它只记录 canonical workflow，不记录工具专属适配内容。

业务项目部署后，对应路径为 `.agents/workflows/workflow-registry.md`。

## 已注册 workflow

| Workflow | 职责 | 文件 | 默认 Agent | 是否允许串行降级 |
|---|---|---|---|---|
| `standard-change` | 通用任务图、角色、通信、恢复、验证和验收流程 | `workflows/standard-change.workflow.md` | `coordinator-agent` | 是 |
| `iris-change` | 在通用调度之上增加 IRIS 领域路由 | `workflows/iris-change.workflow.md` | `iris-change-agent` | 是 |
| `i18n-change` | IRIS 国际化需求处理，从链路定位到验证的领域流程 | `workflows/i18n-change.workflow.md` | `i18n-agent` | 是 |

## 扩展约定

- workflow 文件使用 kebab-case + `.workflow.md`。
- workflow 必须定义触发条件、阶段、输入、输出、分支条件、错误处理和串行降级。
- workflow 不保存业务项目私有事实。
