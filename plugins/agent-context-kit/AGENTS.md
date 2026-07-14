# Agent Context Kit

用于初始化和维护 Agent 项目上下文文件的通用插件。

## 能力范围

本插件用于维护项目级 Agent 上下文，包括：

- `AGENTS.md` 顶层入口和启动指引。
- `.agents/rules/` 稳定项目规则。
- `.agents/memory/project-memory.md` 当前状态和长期经验。
- `.agents/config/` 项目差异配置。
- 暴露插件 skills 的 thin-index 文件。

不要在本插件中保存密钥、服务器凭据、一次性命令输出或源项目业务细节。

## Skills

- `project-context-maintenance`：判断信息应进入哪一层上下文，并维护项目规则、项目记忆、项目配置和 Agent 入口。

## Scripts

- `scripts/generate-plugin-thin-index.ps1`
- `scripts/validate-agent-run.ps1`：只读校验 schema 1.1 阶段化/多智能体运行 manifest、handoff、模式历史、文件所有权、验证新鲜度、分类远程授权、失败收敛、脱敏和并行效率，不承担运行时调度。

插件内 `generate-plugin-thin-index.ps1` 是稳定调用入口，只 wrapper 到根 `.agents/scripts/generate-plugin-thin-index.ps1`。thin-index 生成逻辑只维护根脚本；不要把其它插件脚本实现复制到本插件。
