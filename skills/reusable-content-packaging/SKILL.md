---
name: reusable-content-packaging
description: Package validated project or conversation knowledge into a reusable AI Coding plugin or capability kit without hard-coding source-project details.
---

# Reusable Content Packaging

## 触发条件

当用户要求把某段会话沉淀、工程能力、规则体系、脚本流程、模板集合或专项经验打包为可复用 plugin/kit 时，使用本 skill。

本 skill 是通用打包流程，不绑定 i18n。i18n 插件只作为参考范式。

## 目标

- 将已验证能力抽象为可迁移内容包。
- 保留通用能力，移除源工程强依赖。
- 按能力形态选择插件目录，不强制创建空目录。
- 给目标工程提供清晰安装模式、入口说明和校验清单。

## 输入

- `sourceScope`：待打包能力来源，例如当前会话、已有 `.agents/` 内容、某个 docs 目录、脚本集合或业务规则。
- `pluginName`：目标插件名，例如 `i18n-iris-plugin`。
- `targetAgents`：目标 Code Agent 类型；未知时按通用 Agent 处理。
- `installMode`：默认按实际发现风险选择；可选 `plugin-reference-thin-index`、`copy`、`plugin-reference`。
- `includeDirs`：用户明确指定要包含的目录或能力载体；未指定时按实际内容识别。

## 工作流

1. 盘点待复用能力：
   - 阅读用户指定来源和相关上下文。
   - 区分长期通用能力、当前工程差异、临时过程和敏感连接信息。
   - 不把流水账、一次性命令输出或未验证经验打包进插件。

2. 识别能力边界和载体：
   - 规则类能力放 `rules/`。
   - 流程类能力放 `skills/`。
   - 模板类能力放 `templates/`。
   - 脚本类能力放 `scripts/`。
   - 命令类能力放 `commands/`。
   - 子代理定义放 `agents/`。
   - 事件触发配置或脚本放 `hooks/`。
   - 插件自身示例配置放 `config/`，不得保存目标工程差异。
   - 只创建实际需要的目录。
   - 通用插件工具放 `.agents/scripts/`。
   - 插件专属脚本放 `.agents/plugins/<plugin>/scripts/`。
   - 禁止使用 `.agents/plugins/scripts` 作为共享脚本目录，避免被误识别为插件。

3. 去工程化：
   - 移除服务器编号、IP、账号、密码、token、namespace、远程路径。
   - 移除源工程特有页面清单、类名、方法名、业务批次和部署路径。
   - 将工程差异转为 profile/config 模板或目标工程填写项。
   - MCP 连接事实保留在目标工程 `.mcp.json`，不进入插件规则。

4. 设计插件结构：
   - 生成 `.agents-plugin/plugin.json`。
   - 生成插件 `AGENTS.md`，说明插件级约束和能力路由。
   - 生成插件 `README.md`，说明用途、目录、安装模式和校验方式。
   - 如果插件包含 bootstrap/init skill，在 README 和 AGENTS snippet 中声明首次初始化应直接读取插件真实路径。
   - 按能力形态放置实际内容。

5. 设计安装和发现策略：
   - 若插件依赖深层 `rules/` 或 `skills/`，且目标 Agent 可能只发现浅层 `.agents/rules/`、`.agents/skills/`，使用 `plugin-reference-thin-index`。
   - 若目标 Agent 不支持插件发现或用户要求平铺内容，使用 `copy`。
   - 若目标 Agent 明确支持插件发现，且用户接受深层插件路径，使用 `plugin-reference`。
   - symlink 不作为默认策略；仅在团队确认 Windows 权限、Git 和 Agent 解析均可接受时作为可选优化。

6. 生成 thin-index 时：
   - 若选择 `plugin-reference-thin-index`，优先复用 `.agents/scripts/generate-plugin-thin-index.ps1`。
   - 若插件包含 bootstrap/init skill，默认通过 `-ExcludeSkill` 排除该 skill，避免用安装结果触发安装过程。
   - 不建议插件作者手写大量 thin-index。
   - rule 薄索引放 `.agents/rules/<rule-file>.md`，只指向插件真实 rule 和必要项目配置。
   - skill 薄索引放 `.agents/skills/<skill-name>/SKILL.md`，保留最小 frontmatter，并指向插件真实 `SKILL.md`。
   - 薄索引不得复制规则全文、工程配置、示例长文或 MCP 连接信息。

7. 校验：
   - 搜索硬编码源工程信息。
   - 检查插件内容是否仍依赖当前工程目录或连接配置。
   - 检查 README、AGENTS、plugin.json、templates 的路径是否一致。
   - 检查目标工程差异是否只落在 `.agents/config/` 和 `.mcp.json`。

8. 更新配套资料：
   - 需要正式说明时更新 `docs/`。
   - README 或 docs 应包含端到端最小接入示例，至少说明插件放置、配置生成、thin-index dry-run/write 和验证步骤。
   - 如产生长期有效决策或入口，按项目记忆规则更新 `.agents/memory/project_memory.md`。
   - memory 只写摘要和入口，不复制规则全文。

## 输出要求

- 列出生成或更新的插件目录。
- 说明采用的安装模式及原因。
- 说明哪些能力载体被纳入插件，哪些没有纳入。
- 列出仍需目标工程填写的配置项。
- 给出硬编码检查和迁移验证结果。

## 禁止事项

- 不复制 `.mcp.json` 中的 host、端口、账号、密码、token。
- 不在插件中硬编码源工程服务器、namespace、远程路径或业务页面清单。
- 不把目标工程 profile 当成插件默认配置。
- 不为了目录树完整创建无内容目录。
- 不把未验证经验或会话流水账包装成通用规则。
