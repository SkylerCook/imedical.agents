## 项目上下文维护

初始化或维护 Agent 面向项目的上下文时，使用 `.agents/skills/project-context-maintenance/SKILL.md`。

- 启动路由和硬约束放入 `AGENTS.md`。
- 长期项目规则放入 `.agents/rules/`。
- 当前状态和长期经验放入 `.agents/memory/project-memory.md`。
- 项目差异配置放入 `.agents/config/`。
- 可复用流程放入 `.agents/plugins/`。

新建 `AGENTS.md` 时可参考 `.agents/plugins/agent-context-kit/templates/AGENTS.template.md`；已有 `AGENTS.md` 只合并缺失入口，不重写原文件。

不要在项目上下文中保存密钥、临时命令输出或一次性调试日志。

每个 HIS 需求完成后，调用 `.agents/skills/agent-framework-feedback/SKILL.md` 做一次收尾判断：业务项目部署态下，可复用需求经验按现有条目去重写入 `.agents/feedback/experience/` 并按成熟度提升到 owner plugin rule；独立框架修正进入 `.agents/feedback/framework/`；没有候选内容时不写文件。
