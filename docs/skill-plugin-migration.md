# 根级技能迁入插件

## 归属与稳定入口

| Skill | 新 owner | 源仓 canonical 路径 |
|---|---|---|
| coding-agent-adaptation | agent-context-kit 0.3.2 | plugins/agent-context-kit/skills/coding-agent-adaptation/SKILL.md |
| agent-framework-feedback | agent-framework-evolution 0.1.0 | plugins/agent-framework-evolution/skills/agent-framework-feedback/SKILL.md |
| reusable-content-packaging | agent-framework-evolution 0.1.0 | plugins/agent-framework-evolution/skills/reusable-content-packaging/SKILL.md |

三个独立 skill 的版本单元退役，历史发布记录保留并增加 tombstone；内部 skill 继承 owner 版本。根 scripts 仍为安装、更新、适配公共执行层，agents/_shared 与 feedback 不复制到插件。

业务项目 `.agents/skills/<原技能名>/SKILL.md` 路径保持不变，Write 生成薄索引并指向新 canonical。项目 AGENTS 中既有技能路由无须修改；源仓直接引用旧 canonical 路径的工具需改用上表路径。

## 启用语义

原根级反馈和打包技能随框架默认分发。为保留现有能力，新 agent-framework-evolution 是基础插件，与 agent-context-kit 一样在 profile 缺少该项时默认 enabled。它不需要连接参数或领域初始化；默认启用仅表示技能入口可发现，不触发反馈、写入、提交或推送。

已有明确 available/disabled 状态均保留；领域插件仍默认 available。普通更新不重写用户 AGENTS，不自动迁移用户自定义内容。

## 已部署 standard 工程

发布版本已同步到远端后，在目标工程先完成一次不带 `-Plugin` / `-ExcludePlugin` 的完整迁移；之后可恢复按插件更新。过滤掉 owner 插件会使相应旧入口暂时缺失，不算迁移完成。在目标工程运行：

```powershell
.agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun
.agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Write
.agents/scripts/update-agents.ps1 -ProjectRoot . -Mode Check
```

旧更新器先 fast-forward capability，再检测自身脚本变化并续跑新版本，确保新基础插件参与本轮生成。Git 删除旧受跟踪原文，Write 重建为受忽略的项目薄索引；后续 Git 状态应保持干净。

普通 DryRun 可能先拉取 capability，从而移除旧受跟踪原文；只有 Write 才重建项目入口。不要把 DryRun 当作更新完成，进入业务任务前必须完成 Write/Check。严格不改变 capability 时使用 Check 或 DryRun -NoPull。

手工同步或 NoPull 场景的旧原文，仅在 owner manifest 中历史内容哈希匹配时安全替换；UTF-8 BOM、CRLF 与 LF 统一后比较。不匹配或目标为符号链接/目录联接时保留并报告冲突，即使传入 Force 也不覆盖。失败可能发生在其它插件已经更新之后，应按输出修复并重试，不宣称全流程回滚。

## Overlay 工程

先更新共享 capability，再对每个模块执行 `-NoPull` 的 DryRun/Write/Check；模块 profile 与技能目录保持独立，新的薄索引只写模块 ContextRoot。新源仓不再保留三个根级独立技能，不应把整个 CapabilityRoot/skills 链接给模块。

CodeBuddy/Claude Code 的运行时目录继续链接到项目（或模块）ContextRoot/skills，技能名称不变，链接无须重建。宿主可能需要刷新或新会话。

## 冲突与验收

- 检查三个旧技能名的薄索引 source，确认 owner 路径存在，且没有内部独立 version。
- 检查 plugin_profile 中已有 available/disabled 不变，领域插件未被启用。
- 自定义入口、错误链接或文件类型冲突需逐项处理，不删除整个 skills 目录，不用 Force 或递归删除绕过。
- 文件系统、更新器、宿主发现与真实任务调用分别验证。测试不会替代真实宿主验收，也不会自动调用反馈。

本轮验证结果记入维护日志；CI 增加迁移专项及 Windows PS5.1/PS7 运行矩阵，非 Windows 实跑结果未取得前不宣称跨平台兼容已验证。
