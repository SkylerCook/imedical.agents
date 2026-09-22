# AGENTS.md

This file is the project entrypoint. Optional CLAUDE.md / CODEBUDDY.md links, if present, point here; do not maintain duplicate rules.

## Project

TODO: 用一句话说明业务用途和技术栈；只写已验证边界。初始化完成前替换占位，删除不适用章节。

上下文模式及本地代码范围见 `.agents/config/project_context_profile.md`。若为 `intent-first-on-demand-export`，少量已导出文件只代表需求上下文；不得推断完整架构，按任务获取必要源码后再处理。

## 开发路线

TODO: 按项目实际情况填写高频任务的源码入口/参考实现，以及已有构建、运行或验证文档的链接；缺少文档且命令已验证时写最小命令与前置条件。不要复制专项文档，不虚构未验证的工具链。

## 必要保护

TODO: 只保留项目实际需要的高频保护，如所属 Git 仓库、用户修改、编码、维护分工和数据边界；专项规则链接到 owner。

- 远端写入按项目规则及用户授权执行；已有授权覆盖当前动作时不重复确认。
- 私有连接配置中的凭据不复制到 rules、memory、插件或交付物。
- 本地检查、远端执行与真实环境验收分别取证，不混称完成。

## 按任务读取

- 需求交接：确认 `agent-context-kit` 为 enabled（无 profile 时沿用基础 enabled）且入口可用后，启用交接、生成交接或接续已有需求时读取 `.agents/skills/task-handoff/SKILL.md`；从项目 `docs/handoff/` 定位任务，启用后关键节点持续维护，普通需求不自动建档。

- 工程任务读取 `.agents/memory/project-memory.md` 的简短入口，仅跟进相关领域链接；自包含的措辞/翻译等问题不额外加载工程资料。
- 任务路由统一放 `.agents/rules/index.md`，按场景读取专项 rules、skills 和 profile；此处不复制完整路由表。
- 上下文模式不明或维护配置时读 `project_context_profile.md`；使用项目插件前查 `plugin_profile.md`，目录存在不代表 enabled。私有连接配置仅在连接、远端能力或实际配置问题时读取。
- 按 `.agents/agents/_shared/execution-guidance.md` 执行，guidanceMode 缺省 auto；复用仍持有且未变化的资料，动态状态按当前操作核对。

- 知识资料：按 `.agents/config/plugin_profile.md` 确认 `coding-iris-plugin` 已启用且入口可用后，可通过 `.agents/skills/iris-imedical-knowledge/SKILL.md` 查询业务、菜单与实现参考；由模型根据当前任务自主决定是否查询，已有证据足够时可跳过。资料索引随能力包维护，结论以当前工程代码与配置为准。

## 收尾

- 仅稳定事实变化、入口失效、配置变化或用户要求初始化/维护/优化时加载 `.agents/skills/project-context-maintenance/SKILL.md`，普通修改不例行维护或推荐插件。
- 开工时先设置互斥的 `taskKind`：业务需求为 `business-demand`，框架能力、版本和治理维护为 `framework-maintenance`，其它任务为 `other`。业务需求本地验证后进入 `acceptance-pending`，仅在用户明确验收且发现框架缺陷、规则冲突、可复用新经验或用户要求时调用 `.agents/skills/agent-framework-feedback/SKILL.md` 做只读审查；框架维护走 `maintaining -> locally-verified -> maintenance-complete`，不创建需求验收状态，也不触发或提示 feedback。两类工作同时出现时必须分开记录。任何 feedback 写入或 rule 提升仍需用户逐项授权。
