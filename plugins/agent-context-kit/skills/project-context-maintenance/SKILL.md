---
name: project-context-maintenance
description: Use when initializing or maintaining agent project context such as AGENTS.md, project rules, project memory, project config, plugin thin-index files, or deciding where durable project knowledge should be recorded. 用于初始化或维护项目规则、项目记忆、AGENTS 入口、项目配置和插件 thin-index。
---

# 项目上下文维护

## 用途

维护 Agent 面向项目的上下文，让后续 Agent 能快速接手，同时避免读取过期、重复或敏感信息。

当需要创建、更新、压缩或判断以下内容归属时，使用本 skill：

- `AGENTS.md`
- `.agents/rules/`
- `.agents/memory/project-memory.md`
- `.agents/config/`
- `.agents/plugins/`
- `.agents/skills/` thin-index files

## 开始前必读

编辑上下文文件前：

1. 读取当前 `AGENTS.md`。
2. 如存在项目记忆，读取当前 `.agents/memory/project-memory.md`。
3. 如存在规则索引或相关规则文件，读取对应文件。
4. 判断待写入内容是项目特定、跨项目可复用，还是临时过程。

## 内容归属

| 目标位置 | 写入条件 |
|---|---|
| `AGENTS.md` | 启动指令、必读顺序、跨 Agent 硬约束、rules/skills 顶层路由。 |
| `.agents/rules/*.md` | 稳定项目规则、架构事实、命名约定、工作流或后续任务必须遵守的约束。 |
| `.agents/memory/project-memory.md` | 当前项目状态、近期长期有效变化、长期经验、仍有效决策和后续建议。 |
| `.agents/config/*.md` | 项目差异配置、本地适配、路径、能力和不应成为插件默认值的选择。 |
| `.agents/plugins/<plugin>/` | 可跨项目复用的流程、模板、脚本或规则，不包含源项目事实。 |
| `.agents/skills/<skill>/SKILL.md` | 仅放 thin-index，用于让只发现浅层 skill 目录的 Agent 找到插件真实 skill。 |

## AGENTS.md 初始化/维护

`AGENTS.md` 是 Agent 进入项目的顶层入口，不是完整规则手册、项目记忆或 changelog。

### 应写入 AGENTS.md

- 项目一句话定位：业务域、技术栈、主要模块边界。
- 新会话启动顺序：先读哪些 memory/rules/config。
- 高频硬约束：跨任务必须遵守、遗漏会造成明显风险的规则。
- 规则路由：不同任务类型应读取哪些 rules 或 skills。
- 插件路由：项目已接入的插件、首次初始化入口、thin-index 入口。
- 外部工具边界：MCP/SFTP/编译/上传等能力的使用原则和安全边界。

### 不应写入 AGENTS.md

- 完整规则全文；应放入 `.agents/rules/`。
- 当前进度、最近变化、待办清单；应放入 `.agents/memory/project-memory.md`。
- 项目差异配置、路径映射、能力矩阵；应放入 `.agents/config/` 或对应规则。
- 长示例、大段代码、完整命令输出。
- 凭据、token、服务器私有细节，或从 `.mcp.json` 复制的敏感信息。

### 推荐结构

初始化新项目时，优先使用 `templates/AGENTS.template.md`。已有 `AGENTS.md` 则只合并缺失段落，不重写原文件。

建议结构：

1. 项目简介。
2. 架构或非显然事实。
3. 关键目录。
4. 工具和安全边界。
5. 新会话启动流程。
6. 编码前规则路由。
7. 编码后上下文维护。
8. 已接入插件入口。

### 维护原则

- 保持短：只放入口和最高频约束。
- 保持路由清晰：能链接到 rules/skills 的内容不要复制全文。
- 保持稳定：任务进度只在 memory，AGENTS 只在入口或硬约束变化时更新。
- 合并时保留目标项目已有业务规则，不覆盖用户定制。
- 多 Agent 入口差异较大时，优先在 AGENTS 中放统一入口，再由插件或配置处理差异。

## 禁止写入

- 密钥、token、密码、私有连接信息，或从 `.mcp.json` 复制的 env 值。
- 一次性命令输出、临时排查步骤、短期失败日志。
- 大段代码、完整 SQL、长示例或完整 changelog。
- 可从代码低成本重新发现的信息，除非它是已验证的反复踩坑点。
- 源项目业务模块、路径或服务器细节，不得写入可复用插件。

## 维护流程

1. 按“内容归属”表判断每条信息的目标位置。
2. 优先更新、替换、合并旧内容，不无限追加。
3. 项目记忆应保持在新 Agent 约 2 分钟可读完的长度。
4. 规则文件只保留稳定规范，不写当前进度。
5. 如果内容属于领域插件或专项规则，优先更新对应 owner；memory 只保留入口或摘要。
6. 编辑后检查重复内容、过期矛盾和敏感信息。

## 初始化流程

初始化项目上下文时：

1. 创建或更新 `AGENTS.md`，只放最小启动流程和路由；新建时参考 `templates/AGENTS.template.md`。
2. 如缺失 `.agents/rules/project.md`，基于项目规则模板创建。
3. 如缺失 `.agents/memory/project-memory.md`，基于项目记忆模板创建。
4. 使用插件内置脚本生成 plugin thin-index：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/agent-context-kit/scripts/generate-plugin-thin-index.ps1 -PluginPath .agents/plugins/agent-context-kit -ProjectRoot . -Mode DryRun
   ```
5. 检查冲突后，仅在用户要求初始化或更新索引时，用 `-Mode Write` 重新执行。
6. 项目特定值放入 `.agents/config/`，不要写成插件默认值。

不要把 `scripts/generate-plugin-thin-index.ps1` 复制到目标工程共享的 `.agents/scripts/` 目录；应直接从插件路径调用。

## Thin-Index 格式

浅层 skill 索引必须：

- 只保留 frontmatter 和简短指针。
- 明确要求 Agent 继续读取插件内真实 `SKILL.md`。
- 不复制项目配置或 MCP 连接信息。

## 审查清单

完成前检查：

- 每类事实仍只有一个清晰事实来源。
- memory 只包含当前状态和长期经验，不复制完整规则。
- rules 只包含长期约束，不记录任务进度。
- 插件内容可复用，且没有源项目硬编码。
- 没有新增密钥或私有连接信息。
