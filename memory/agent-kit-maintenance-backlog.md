# imedical.agents 后续治理队列

本文件记录 `imedical.agents` 能力包仓库的后续计划、暂缓事项和治理优先级。入口摘要见 `agent-kit-maintenance-memory.md`，长期决策见 `agent-kit-maintenance-decisions.md`，近期维护流水见 `agent-kit-maintenance-log.md`。

## 下一步工作队列

1. frontmatter/task-affinity 是下一轮治理项。
   - 排序：thin-index canonical 行为统一和 stale 清理同步已完成，下一轮直接进入 frontmatter/task-affinity，除非用户明确调整优先级。
   - 内容：为 rule/reference 文件补充最小 frontmatter，并让 thin-index 传播任务亲和元数据。
   - 禁止：不要重新引入插件脚本副本漂移；frontmatter 解析和传播只改 canonical 脚本。

2. 继续观察 rules 体量。
   - 若 i18n 或 coding 规则再次承载查找表、API 目录或长参考资料，优先迁入对应插件 `references/`。

3. 多 Agent 协作暂不落地，后续在实际业务项目出现明确协作需求时再设计。
   - 暂不落地理由：当前仓库近期重点仍是 rules/skills/references/scripts 的职责收敛、thin-index canonical 行为和 frontmatter/task-affinity 治理；直接引入多 Agent 编排会扩大维护面，容易先产生编排复杂度而不是稳定能力。
   - i18n 打印需求复盘表明更迫切的缺口是阶段化事实定位、数据分类和验证规则，而不是调度器本身；先把单 Agent 阶段化入口跑通，才能判断哪些阶段值得拆给子 Agent。
   - 真实业务项目尚未沉淀稳定的任务拆分、交接文件格式、冲突合并、专项审查和失败恢复成本；在这些约束未被实际需求验证前，不把候选协作模式固化为插件能力。
   - 初始方向：采用“主 Agent 编排 + 开发闭环子 Agent + 结构化交接”的轻量方案。
   - 优先承载位置：扩展 `plugins/agent-context-kit/`，而不是先创建独立插件。
   - 首批角色可聚焦需求澄清、实现、验证和 Review；IRIS/i18n 等领域能力继续通过现有 rules/skills/plugins 路由。
   - 暂不引入自动并行调度器；等真实项目中出现任务拆分、交接成本、冲突合并或专项审查需求后再推进。

4. 暂不新增 `agent-kit-maintenance` 专用 skill。
   - 根 `AGENTS.md` 先承载本仓库维护入口、记忆路由和维护规则。
   - 若后续频繁执行“查看近期提交、归纳维护记忆、同步 README/docs、检查 sparse checkout 边界、审查敏感信息”等固定流程，再抽成专用 skill。

## 队列维护规则

- 已完成事项迁入 `agent-kit-maintenance-log.md`，不要在 backlog 中长期保留已完成条目。
- 已固化为长期约束的事项迁入 `agent-kit-maintenance-decisions.md`。
- 不记录短期个人提醒；只保留会影响后续 Agent 决策的治理任务。
