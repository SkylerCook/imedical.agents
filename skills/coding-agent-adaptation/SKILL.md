---
name: coding-agent-adaptation
version: 0.1.0
description: Connect an installed project's shared skills to CodeBuddy, Claude Code or Codex using links; use for cross-agent skill discovery, synchronization and broken-link diagnosis.
---

# Coding Agent Adaptation

将项目通用技能入口接入用户指定的 coding agent。只适配技能发现，不安装宿主，不修改 MCP、hooks、原生子代理或插件启用状态。

## 执行

1. 读取目标工程 `AGENTS.md`。已有 `.agents` 才执行适配；尚未安装时按 `.agents/docs/update-agents.md` 或能力包内同名 runbook 安装。不要把源仓维护者 `.agents/skills` 当作业务技能来源。
2. 目标由用户指定；不按当前运行宿主猜测。已有明确接入授权时，预演通过即可写入，不重复询问。
3. 从目标工程根执行，runtime 取 `CodeBuddy`、`ClaudeCode` 或 `Codex`：

```powershell
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime CodeBuddy --mode DryRun
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime CodeBuddy --mode Write
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime CodeBuddy --mode Check
```

Overlay 从 manifest 解析 ContextRoot，链接到模块本地 skills；若本地脚本尚未刷新，用 CapabilityRoot 下同名脚本并显式传入模块 ProjectRoot。不得从共享 capability 推断模块的启用状态。

也可在已授权更新能力包时使用 `update-agents.ps1 -RuntimeAdapter CodeBuddy -Mode DryRun|Write`；只做本地适配时优先 Node 命令，不引入 fetch/pull。详见 `.agents/docs/coding-agent-adaptation.md`。

## 链接与冲突

- CodeBuddy 使用 `.codebuddy/skills`，Claude Code 使用 `.claude/skills`；Codex 直接复用 `.agents/skills`。Windows 使用 Junction，其它平台使用相对目录 symlink。不复制、不静默降级。
- 链接公开的是项目当前技能集合，包括通用技能及已生成的薄索引；不扫描全部插件生成额外入口。插件启用与陈旧索引清理由更新流程负责。
- 已有普通目录、自定义文件、错误或失效链接均保留并报告 conflict。不要用递归删除或 Force 覆盖。确需迁移时，先展示实际目标和自定义内容，再确定迁移范围；只在明确授权后移除准确的旧链接本身，再重跑 Write。
- 链接是同一批文件的另一个入口，在宿主界面编辑或删除技能会影响 `.agents/skills`。不要用宿主删除功能进行适配清理。
- `CODEBUDDY.md` / `CLAUDE.md` 是独立可选入口；需要时使用项目上下文维护流程创建指向 AGENTS.md 的 symlink，不复制正文。

## 完成判定

Check 验证文件系统，不能证明宿主已发现或正确执行。请使用 CodeBuddy 的项目 Skills 页面、CLI `/skills` 或对应宿主能力目录取得发现证据；缺少宿主访问时如实交付边界。实际任务调用单独验证。
