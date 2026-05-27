# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project

TODO: 用一句话说明项目业务域、技术栈和主要模块边界。

## Architecture

TODO: 记录后续 Agent 不容易从目录名直接看出的架构事实。

- TODO: 核心分层、关键基类、入口模式或调用约定。

## Key Directories

| 用途 | 路径 |
|---|---|
| 规则索引 | `.agents/rules/index.md` |
| 项目记忆 | `.agents/memory/project-memory.md` |
| 项目配置 | `.agents/config/` |
| 插件目录 | `.agents/plugins/` |

## Tools

TODO: 记录项目实际可用工具和安全边界。

- MCP/SFTP/编译/上传等远端写入操作，必须按项目规则和用户授权执行。
- 不把 `.mcp.json` 中的凭据复制到规则、记忆或插件。

## Workflow

### 新会话启动

1. 读取 `.agents/memory/project-memory.md`，了解当前状态。
2. 读取 `.agents/rules/index.md`，确认本次任务需要哪些规则。
3. 读取 `.agents/rules/project.md`，确认项目专属约束。

### 编码前

根据任务类型读取对应 rules 或 skills；不要只凭记忆实施。

| 任务类型 | 必读 |
|---|---|
| 项目上下文维护 | `.agents/skills/project-context-maintenance/SKILL.md` |
| TODO | TODO |

### 编码后

- 按 `.agents/skills/project-context-maintenance/SKILL.md` 判断是否更新 memory、rules、config 或插件入口。
- 只有用户明确要求时，才执行远端上传、编译或生产数据写入。

## Plugins

TODO: 记录已接入插件和入口。

- 项目上下文维护：`.agents/skills/project-context-maintenance/SKILL.md`

