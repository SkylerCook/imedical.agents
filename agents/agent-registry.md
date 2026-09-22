# Agent Registry

本文件是 `imedical.agents` 顶层智能体注册表。它只记录 canonical 智能体入口，不记录工具专属适配内容。

业务项目部署后，对应路径为 `.agents/agents/agent-registry.md`。

## 发现顺序

1. 先读取业务项目 `AGENTS.md` 的智能体路由。
2. 再读取本注册表确认可用智能体。
3. 按任务读取目标 `agents/<name>-agent/AGENT.md`。
4. 按 `defaultWorkflow` 读取 `workflows/<workflow>.workflow.md`。
5. 按 `bindings.yaml` 读取需要的插件 rules、skills 或 templates。

## 已注册智能体

| 智能体 | 类型 | 职责 | 角色定义 | 默认 workflow | 依赖插件 |
|---|---|---|---|---|---|
| `coordinator-agent` | 通用 Agent | 任务图、授权、通信、恢复和集成协调 | `agents/coordinator-agent/AGENT.md` | `standard-change` | 无 |
| `explorer-agent` | 通用角色 | 只读事实探索和影响定位 | `agents/explorer-agent/AGENT.md` | `standard-change` | 无 |
| `planner-agent` | 通用角色 | 任务图、依赖和完成条件规划 | `agents/planner-agent/AGENT.md` | `standard-change` | 无 |
| `coding-agent` | 通用角色 | 在受控 owner/scope 内实现变更 | `agents/coding-agent/AGENT.md` | `standard-change` | 按 workflow 绑定 |
| `review-agent` | 通用角色 | 独立 diff 与契约审查 | `agents/review-agent/AGENT.md` | `standard-change` | 无 |
| `testing-agent` | 通用角色 | 最终修改后的验证与风险报告 | `agents/testing-agent/AGENT.md` | `standard-change` | 无 |
| `iris-change-agent` | 领域 Agent | IRIS 复杂变更的正式协作入口 | `agents/iris-change-agent/AGENT.md` | `iris-change` | `coding-iris-plugin` |
| `i18n-agent` | 领域 Agent | IRIS 国际化需求处理，按链路定位、字段分类、编码/模板/种子、验证阶段执行 | `agents/i18n-agent/AGENT.md` | `i18n-change` | `i18n-iris-plugin`, `coding-iris-plugin` |

## 扩展约定

- 通用 Agent：跨领域复用，`bindings.yaml` 中 `plugins` 为空或只依赖基础上下文插件。
- 领域 Agent：绑定一个或多个领域插件，例如 `i18n-agent`。
- 工具专属 Agent：由 adapter 生成，不在本注册表作为 canonical 源维护。

新增智能体时必须同步更新本注册表和 `workflows/workflow-registry.md`。

通用角色可由正式 workflow 分配给同会话子 Agent、多会话任务、人工参与者或单 Agent 串行执行。它们不是“必须启动子 Agent”的别名。
