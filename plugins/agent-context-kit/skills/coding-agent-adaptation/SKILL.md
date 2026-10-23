---
name: coding-agent-adaptation
description: Connect installed project skills to coding agents through shared discovery or directory links; use for new hosts, custom project skill paths and broken-link diagnosis.
---

# Coding Agent Adaptation

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

将项目通用技能入口接入用户指定的 coding agent。执行器只适配技能发现目录；项目规则 MD 的加载机制独立核对，不安装宿主，不修改 MCP、hooks、原生子代理或插件启用状态。

## 执行

1. 读取目标工程 `AGENTS.md`。已有 `.agents` 才执行适配；尚未安装时按 `.agents/docs/update-agents.md` 或能力包内同名 runbook 安装。不要把源仓维护者 `.agents/skills` 当作业务技能来源。
2. 识别宿主时先读 [source.md](references/source.md)，分别核对适用形态、项目技能目录、项目规则 MD 和证据状态。已知机制不等于当前项目已加载；未知项由用户说明，不能按宿主名称猜测。已确认技能目录即可独立适配，MD 未知只留待确认，不阻塞目录 DryRun/Write/Check；用户明确目录时不额外强求无关的版本或 MD 信息。用户提供的项目差异保留在项目配置或本次范围说明中，不直接反写共享 source.md。已有自定义配置保留。
3. 本次明确指定目录时只处理该范围；否则读取目标 ContextRoot/config/project_context_profile.md 的“技能适配目录”章节。只读取该章节正文中的目录，跳过 HTML 注释内的模板示例。用户每行写一个项目相对目录，可用 Markdown 代码块包裹；忽略空行、去重，兼容行尾逗号。没有清单也没有明确宿主时，展示 runbook 中的三目录示例，请用户选择目标；不默认创建示例目录。
4. 用户要求执行本技能即授权补齐所选技能目录清单。逐个用 `--runtime Custom --skills-dir <目录>` 执行 DryRun：planned 才执行 Write，unchanged/reused 跳过，conflict/blocked 保留并报告，继续处理其它安全条目。对成功条目执行 Check，报告新增、已存在、冲突和待验项；全部冲突不能报告完成。配置只由 Agent 在本技能执行时读取，不新增解析器、不让普通更新自动执行，也不因删除配置条目删除已有链接。
5. 用户直接指定宿主而非目录时，按 source.md 对照上游机制、项目事实与执行器既有默认策略。默认路径与已确认的项目目录一致时使用命名 runtime；不一致时，在用户已明确目标目录后用 `--runtime Custom --skills-dir <目录>`，未知时由用户说明后再执行。以下为命令形态示例：

```powershell
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime CodeBuddy --mode DryRun
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime CodeBuddy --mode Write
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime CodeBuddy --mode Check
```

Overlay 从 manifest 解析 ContextRoot，链接到模块本地 skills；若本地脚本尚未刷新，用 CapabilityRoot 下同名脚本并显式传入模块 ProjectRoot。不得从共享 capability 推断模块的启用状态。

也可在已授权更新能力包时使用 `update-agents.ps1 -RuntimeAdapter CodeBuddy -Mode DryRun|Write`；只做本地适配时优先 Node 命令，不引入 fetch/pull。详见 `.agents/docs/coding-agent-adaptation.md`。

## 自定义项目目录

宿主有不同发现目录时，核对 source.md 的适用范围及用户提供的本机配置或加载证据，分清项目级与用户级；未确认的项目路径请用户说明。Node 入口可加 `--skills-dir .host/skills` 覆盖命名宿主的默认路径；未列出的宿主用 `--runtime Custom --skills-dir .host/skills`。只接受项目内以点目录开头、以 `/skills` 结尾的相对路径，不能指向 Git 元数据或项目上下文内部。具体命令见适配 runbook。

用户级技能分发交给已有全局技能管理流程；本技能不把项目插件集合链接到用户目录，不读取个人配置仓作为运行依赖。

## 链接与冲突

- 命名 runtime 的目录与既有策略集中在 source.md；它是人工/Agent 查阅参考，执行器仍使用脚本内既有映射，不读取该文件。需链接时 Windows 使用 Junction，其它平台使用相对目录 symlink。
- 链接公开的是项目当前技能集合，包括通用技能及已生成的薄索引；不扫描全部插件生成额外入口。插件启用与陈旧索引清理由更新流程负责。
- 已有普通目录、自定义文件、错误或失效链接均保留并报告 conflict。不要用递归删除或 Force 覆盖。确需迁移时，先展示实际目标和自定义内容，再确定迁移范围；只在明确授权后移除准确的旧链接本身，再重跑 Write。
- 链接是同一批文件的另一个入口，在宿主界面编辑或删除技能会影响 `.agents/skills`。不要用宿主删除功能进行适配清理。
- 项目规则 MD 按 source.md 的宿主依据独立检查；目录 Check 不检查其存在或加载。需要创建兼容入口时，先核对宿主是否支持该入口、格式与 symlink，以及多入口的优先级和重复加载影响，再沿项目上下文维护流程及已有授权执行。保留已有普通文件和自定义内容，采用指向 AGENTS.md 的 symlink，不复制正文。技能目录适配授权和 source.md 登记均不扩大为项目规则入口创建授权。

## 完成判定

Check 只验证技能目录的文件系统状态；在本次请求范围内区分目录适配、宿主发现、项目规则 MD 加载和实际调用。MD 未知或缺少宿主访问时只报告对应待验项，不否定已完成的目录适配，不以技能可见推定规则已加载。
