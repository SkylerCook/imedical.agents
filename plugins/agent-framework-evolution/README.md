# Agent Framework Evolution

本插件所有自有 skill 的帮助请求（`--help`、查看用法）先按[统一帮助协议](../../docs/guides/capability-help.md)展示帮助并结束，优先于插件启用、连接检查和业务前置。源定义随正常能力包更新分发，已有 thin-index 继续读取 source；帮助不自动启用插件。

把需求中的已验证经验反馈、整理为可复用框架能力。原有两个根级技能迁入本插件，技能名称和项目 `.agents/skills/<name>/SKILL.md` 入口不变。

## Skills

| Skill | 职责 |
|---|---|
| agent-framework-evolution-init | 检查入口、显式启用和生成薄索引 |
| agent-framework-feedback | 验收后的按信号只读审查；经验须通过新增价值、复用依据、验证与边界、沉淀收益四项准入，写入核对动作授权或明确授权的隔离待审补丁模式 |
| reusable-content-packaging | 将已验证内容整理为可复用能力，保留项目私有边界 |

## 项目更新

本插件是原默认分发技能的承接者，不新增外部能力。未配置状态时默认 enabled；已有 available 或 disabled 不变。普通更新 Write 会生成原技能名的薄索引，无需更改项目 AGENTS 或 CodeBuddy/Claude Code 的目录链接。

旧原文只有命中 manifest 的历史 SHA-256 才会自动转为索引；用户修改或链接目标保留，报告 skill-owner-migration-conflict，不使用 Force 覆盖。新项目无历史文件时直接生成。

完整迁移、Check/DryRun/Write、禁用与验证范围见能力包 `docs/skill-plugin-migration.md`。框架维护不触发 feedback；Git 提交、推送和外部写入仍分别需要明确授权。

纯初始化入口 `agent-framework-evolution-init` 直接读取插件内真实 SKILL.md，manifest 的 `thinIndex.excludeSkills` 将其排除出浅层技能列表。已启用项目常规更新时，Check/DryRun 只报告旧受管索引，Write 精准删除；自定义文件和链接保留。迁移边界见能力包 [更新说明](../../docs/update-agents.md#纯初始化-skill-薄索引迁移)。

共享准入以 [feedback skill](skills/agent-framework-feedback/SKILL.md#需求经验分支) 为唯一标准。普通修复无合格项时正常结束，局部经验留在项目内。已部署项目通过既有更新取得正文；入口和配置不变，无需兼容清理，不自动重写项目 AGENTS 或历史经验。本次源仓更新不代表业务副本已同步。

自动待审补丁的准入、源仓身份、隔离范围及停止条件由 [feedback skill](skills/agent-framework-feedback/SKILL.md#写入授权与自动待审补丁) 唯一维护。普通自动加载不授予写入权限；已有明确批次授权时在范围内直接执行。源仓补丁仍待审，提交、发布、合并、部署和业务副本更新分别授权；旧项目逐项授权约定在用户明确改为自动模式前继续有效。
