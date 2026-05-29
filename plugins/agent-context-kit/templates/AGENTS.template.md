# AGENTS.md

This file provides guidance to agents when working with code in this repository.

> **约束入口**：本工程的项目指引统一以 `AGENTS.md` 为准。`CODEBUDDY.md` 和 `CLAUDE.md` 均为指向本文件的符号链接，修改时只改 `AGENTS.md`，不要直接修改后两者。

## Project

TODO: 用一句话说明项目业务域、技术栈和主要模块边界；如果是按需导出/需求处理工作区，只说明业务用途和工作方式，不推断完整模块边界。

## 上下文状态

| 项目 | 状态 |
|---|---|
| contextMode | TODO: `codebase-complete` 或 `intent-first-on-demand-export` |
| 本地代码完整性 | TODO: 本地代码是否代表全量工程事实 |
| 代码来源 | TODO: 本地完整维护 / 后续按需从服务器导出 / 其它 |
| 上下文配置 | `.agents/config/project_context_profile.md` |

若 `contextMode` 为 `intent-first-on-demand-export`，本地少量或零散文件只代表当前已导出的需求上下文，不得据此推断完整架构、主模块或调用链。

无法证明本地代码代表完整工程时，默认按 `intent-first-on-demand-export` 处理。

## Architecture

TODO: 仅记录已验证的架构事实。

- `codebase-complete`：记录从代码、构建配置和项目文档验证过的核心分层、关键基类、入口模式或调用约定。
- `intent-first-on-demand-export`：暂无可验证完整架构；不得基于零散文件推断整体工程。需求处理时先按任务导出相关文件，再阅读、分析和修改。
- 按需导出工程中，本地已有文件最多列为“当前已导出/已存在文件”，不得写成核心模块或完整调用链。

## Key Directories

| 用途 | 路径 |
|---|---|
| 规则索引 | `.agents/rules/index.md` |
| 项目记忆 | `.agents/memory/project-memory.md` |
| 项目配置 | `.agents/config/` |
| 上下文配置 | `.agents/config/project_context_profile.md` |
| 插件目录 | `.agents/plugins/` |

## Tools

TODO: 记录项目实际可用工具和安全边界。

- MCP/SFTP/编译/上传等远端写入操作，必须按项目规则和用户授权执行。
- 不把 `.mcp.json` 中的凭据复制到规则、记忆或插件。

## Workflow

### 新会话启动

1. 读取 `.agents/memory/project-memory.md`，了解当前状态。
2. 读取 `.agents/config/project_context_profile.md`，确认本地代码是否代表完整工程事实。
3. 读取 `.agents/rules/index.md`，确认本次任务需要哪些规则。
4. 读取 `.agents/rules/project.md`，确认项目专属约束。

### 编码前

根据任务类型读取对应 rules 或 skills；不要只凭记忆实施。

| 任务类型 | 必读 |
|---|---|
| 项目上下文维护 | `.agents/skills/project-context-maintenance/SKILL.md` |
| TODO | TODO |

若本工程为 `intent-first-on-demand-export`，编码前先根据用户需求确认目标页面、类、JS、CSP 或业务对象；导出相关文件后再分析和修改。

### 编码后

- 按 `.agents/skills/project-context-maintenance/SKILL.md` 判断是否更新 memory、rules、config 或插件入口。
- 只有用户明确要求时，才执行远端上传、编译或生产数据写入。

## Plugins

TODO: 记录已接入插件和入口。

- 项目上下文维护：`.agents/skills/project-context-maintenance/SKILL.md`
