## 项目上下文维护

初始化或维护 Agent 面向项目的上下文时，使用 `.agents/skills/project-context-maintenance/SKILL.md`。

- 启动路由和硬约束放入 `AGENTS.md`。
- 长期项目规则放入 `.agents/rules/`。
- 当前状态和长期经验放入 `.agents/memory/project-memory.md`。
- 项目差异配置放入 `.agents/config/`。
- 可复用流程放入 `.agents/plugins/`。

新建 `AGENTS.md` 时可参考 `.agents/plugins/agent-context-kit/templates/AGENTS.template.md`；已有 `AGENTS.md` 只合并缺失入口，不重写原文件。

不要在项目上下文中保存密钥、临时命令输出或一次性调试日志。
