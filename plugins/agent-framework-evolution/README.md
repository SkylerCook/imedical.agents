# Agent Framework Evolution

把需求中的已验证经验反馈、整理为可复用框架能力。原有两个根级技能迁入本插件，技能名称和项目 `.agents/skills/<name>/SKILL.md` 入口不变。

## Skills

| Skill | 职责 |
|---|---|
| agent-framework-evolution-init | 检查入口、显式启用和生成薄索引 |
| agent-framework-feedback | 验收后的按信号只读审查，任何反馈写入仍需单独授权 |
| reusable-content-packaging | 将已验证内容整理为可复用能力，保留项目私有边界 |

## 项目更新

本插件是原默认分发技能的承接者，不新增外部能力。未配置状态时默认 enabled；已有 available 或 disabled 不变。普通更新 Write 会生成原技能名的薄索引，无需更改项目 AGENTS 或 CodeBuddy/Claude Code 的目录链接。

旧原文只有命中 manifest 的历史 SHA-256 才会自动转为索引；用户修改或链接目标保留，报告 skill-owner-migration-conflict，不使用 Force 覆盖。新项目无历史文件时直接生成。

完整迁移、Check/DryRun/Write、禁用与验证范围见能力包 `docs/skill-plugin-migration.md`。框架维护不触发 feedback；Git 提交、推送和外部写入仍分别需要明确授权。
