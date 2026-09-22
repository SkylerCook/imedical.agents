---
name: agent-framework-evolution-init
description: Initialize or inspect the framework feedback and reusable-content plugin's project discovery entries and enablement state, without executing feedback or external operations.
---

# Agent Framework Evolution Init

先读取项目 AGENTS.md、plugin_profile.md 和 capability.json（如存在）。本插件无项目连接配置；它只承接框架原默认反馈与打包技能。

默认基础启用仅适用于 profile 无记录的情况。已有 available/disabled 必须保留，除非用户明确要求启用；启用授权不等于执行反馈或写入经验。

用户要求启用时，确认本插件三个 SKILL.md 源文件存在，按根生成器 DryRun 检查后 Write 生成：

```powershell
.agents/scripts/generate-plugin-thin-index.ps1 -ProjectRoot . -PluginPath .agents/plugins/agent-framework-evolution -Mode DryRun
.agents/scripts/generate-plugin-thin-index.ps1 -ProjectRoot . -PluginPath .agents/plugins/agent-framework-evolution -Mode Write
```

发生 skill-owner-migration-conflict 时停止；保留用户内容，不以 Force 绕过。验证两个旧技能名的薄索引 source 指向本插件，纯 init 的旧受管索引已清理（自定义文件或链接保留并说明），真实 init SKILL.md 可读，再用 update-plugin-profile.ps1 -ProjectRoot . -Plugin agent-framework-evolution -Status enabled 记录。已 enabled 则只检查，不重复初始化。

Overlay 只写模块 ContextRoot，本地入口脚本转发到 CapabilityRoot。详细迁移见能力包 docs/skill-plugin-migration.md。不要自动调用 feedback skill 或更改用户 AGENTS。
