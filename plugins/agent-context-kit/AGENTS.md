# Agent Context Kit

用于初始化和维护 Agent 项目上下文文件的通用插件。

## 能力范围

本插件用于维护项目级 Agent 上下文，包括：

- `AGENTS.md` 顶层入口和启动指引。
- `.agents/rules/` 稳定项目规则。
- `.agents/memory/project-memory.md` 当前状态和长期经验。
- `.agents/config/` 项目差异配置。
- 暴露插件 skills 的 thin-index 文件。

同时支持传统 `standard` 工程与 `workspace-overlay` 模块工作区。Overlay 必须先解析 `.agents/capability.json`，只写本地 `ContextRoot`，只扫描声明的 `SourceRoot`，Git 操作使用声明的真实 `GitRoot`；共享 `CapabilityRoot` 在模块维护流程中只读。

不要在本插件中保存密钥、服务器凭据、一次性命令输出或源项目业务细节。

## Skills

- `project-context-maintenance`：判断信息应进入哪一层上下文，并维护项目规则、项目记忆、项目配置和 Agent 入口。

## Scripts

- `scripts/generate-plugin-thin-index.ps1`
- `templates/agent-run-plan.json` / `agent-run-manifest.json`：schema 2.0 通用任务图输入与运行投影；`taskKind` 显式区分业务需求、框架维护和其它任务，feedback 适用性由任务类型派生。
- `scripts/validate-agent-run.ps1`：schema 2.0 薄调用根 Node 调度器完成最终校验；schema 1.0–1.2 继续只读兼容，不迁移历史产物。

插件内 `generate-plugin-thin-index.ps1` 是稳定调用入口，只 wrapper 到根 `.agents/scripts/generate-plugin-thin-index.ps1`。thin-index 生成逻辑只维护根脚本；不要把其它插件脚本实现复制到本插件。

运行入口必须先设置互斥的 `taskKind`。`business-demand` 使用需求验收生命周期并在 `accepted` 后进入只读 feedback 审查；`framework-maintenance` 使用独立维护生命周期，`acceptance` 固定为 `not-applicable`，不触发或提示 feedback。两者不得共享状态。
