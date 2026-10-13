# 接入与迁移

## 项目接入

框架能力通过既有安装/更新流程分发，见 [更新说明](../../../docs/update-agents.md)。插件初始 available，不因更新而启用。首次接入读取 CapabilityRoot/plugins/bos-plugin/skills/bos-init/SKILL.md。

解析工作区后，使用 CapabilityRoot/scripts/update-plugin-profile.ps1，传入 -ProjectRoot、-ContextRoot、-CapabilityRoot、-Plugin bos-plugin、-Status enabled、-InitSkill bos-init。保留其它插件及用户配置；未知同名内容停止覆盖。

再用 CapabilityRoot/scripts/update-agents.ps1 -ProjectRoot <WorkspaceRoot> -Plugin bos-plugin -Mode DryRun -NoPull，检查无冲突后以 -Mode Write -NoPull 生成发现入口，最后 -Mode Check -NoPull。这是目标工程接入操作，不在源仓维护时自动运行。Overlay 共享能力只更新一次，项目配置和 thin-index 写 ContextRoot。无 PowerShell 的宿主可按相同契约定点维护 profile 和两份 thin-index，需逐一验证引用；不声称自动工具已运行。

## 用户级复用（独立后续迁移）

框架源仓成为唯一代码维护源后，用户级技能可引用插件内技能。遵循本机既有 skills-sync/宿主适配流程，先核对来源、链接目标和同名入口，再在获授权的客户端范围切换；不用项目 updater 写用户目录。

若宿主会将技能实体复制且不能解析外部引用，应分发整个插件并生成指向该安装位置的薄入口，不只复制 SKILL.md。目录链接依赖真实插件布局；查验脚本与 references 可访问，并通过新进程的 defaults 验证配置定位，再按授权测试真实查询。链接成功不等于运行中宿主刷新。

旧本机配置可继续保留，通过 BOS_MCP_CONFIG 显式指定，源码迁移不移动凭据。不兼容旧版“代码目录向上找 local”的隐式配置：切换前配置环境变量，再验收。保护旧有效入口直到新入口验证完成；未知定制不覆盖，不清理共享缓存。

本次框架交付不修改用户级源码、链接、个人配置或业务工程。Windows/macOS/Linux 及各宿主实际发现分别取证。
