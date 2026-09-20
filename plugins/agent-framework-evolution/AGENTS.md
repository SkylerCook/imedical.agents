# Agent Framework Evolution

本插件承接原根级 `agent-framework-feedback` 和 `reusable-content-packaging`，维护反馈审查及可复用能力沉淀。技能正文、规则和授权边界不因目录迁移而放宽。

- `skills/agent-framework-evolution-init/SKILL.md`：显式接入与状态检查。
- `skills/agent-framework-feedback/SKILL.md`：业务验收后按信号只读审查；写入逐项授权。框架维护不调用此 skill。
- `skills/reusable-content-packaging/SKILL.md`：按用户要求整理已验证的通用能力，排除私有事实。

它是承接既有默认技能的基础插件；profile 无此项时默认 enabled，显式 available/disabled 保留。无需连接配置或服务器操作。启用只生成入口，不触发反馈、不授予写入或提交权限。

插件内文件继承 manifest 版本，不声明独立 version。使用根 scripts/generate-plugin-thin-index.ps1 生成薄索引；迁移清单与旧内容哈希由 manifest 声明，不维护另一份生成器。根 scripts、agents/_shared、feedback 为共享层，不因 owner 迁移复制。
