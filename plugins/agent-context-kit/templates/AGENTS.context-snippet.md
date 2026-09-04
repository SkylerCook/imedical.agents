## 项目上下文维护

初始化或维护 Agent 面向项目的上下文时，使用 `.agents/skills/project-context-maintenance/SKILL.md`。

- 启动路由和硬约束放入 `AGENTS.md`。
- 长期项目规则放入 `.agents/rules/`。
- 当前状态和长期经验放入 `.agents/memory/project-memory.md`。
- 项目差异配置放入 `.agents/config/`。
- 可复用流程放入 `.agents/plugins/`。

新建 `AGENTS.md` 时可参考 `.agents/plugins/agent-context-kit/templates/AGENTS.template.md`；已有 `AGENTS.md` 只合并缺失入口，不重写原文件。

不要在项目上下文中保存密钥、临时命令输出或一次性调试日志。

开工时先设置互斥的 `taskKind`：业务需求为 `business-demand`，框架能力、版本和治理维护为 `framework-maintenance`，其它任务为 `other`。业务需求本地验证后进入 `acceptance-pending`，仅在用户明确验收后调用 `.agents/skills/agent-framework-feedback/SKILL.md` 做只读审查；框架维护走 `maintaining -> locally-verified -> maintenance-complete`，不创建需求验收状态，也不触发或提示 feedback。两类工作同时出现时必须分开记录。任何 feedback 写入或 rule 提升仍需用户逐项授权。
