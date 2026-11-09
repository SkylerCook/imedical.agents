---
name: coding-agent-adaptation
description: Adapt project skills and native Codex Agents to the requested host; use for host setup, discovery, generated Agent refresh and conflict diagnosis.
---

# Coding Agent Adaptation

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

将项目通用技能入口接入用户指定的 coding agent。技能执行器适配发现目录，Codex 原生 Agent 使用独立生成器；项目规则 MD 的加载机制独立核对，不安装宿主，不修改 MCP、hooks 或插件启用状态。

## 参数与路由

- 默认：适配 Skill；指定 Codex 也只检查通用技能发现，不创建原生 Agent。
- `--agent`：只适配原生 Agent，当前执行器支持 Codex、WorkBuddy、CodeBuddy；其它宿主先按 references/source.md 核对，未实现时明确报告，不降级执行 Skill 写入。
- `--help` 优先于任何写入。`--agent` 与技能目录清单、`--skills-dir` 不混用；有冲突时先明确本次范围。

示例：`coding-agent-adaptation Codex` 适配技能；`coding-agent-adaptation --agent Codex` 适配原生角色。这是 Skill 调用参数；对应 Node 入口也支持 `--agent`，PowerShell 安装/更新入口对应 `-Agent`。

## Codex 原生 Agent

仅传 `--agent` 或明确要求原生 Agent 时，先核对实际客户端形态和版本，再执行 `node <CapabilityRoot>/scripts/sync-runtime-skills.js --agent --project-root <ProjectRoot> --runtime Codex --mode DryRun`，按已有授权执行 Write 和 Check。只要求技能目录时仍走下方技能流程，不扩大为原生 Agent 写入。

生成项目 `.codex/agents/*.toml`，从 canonical AGENT.md 获取身份和完整指令，继承宿主模型、权限及 MCP。不写全局 config.toml，不把框架 permissions 当成宿主沙箱。已有自定义或手改文件保留并报告；详细迁移、客户端加载与降级见能力包 `docs/coding-agent-adaptation.md` 的“Codex 原生 Agent”。源仓维护不将维护者 .agents 作为业务 capability。

## 执行

1. 读取目标工程 `AGENTS.md`。已有 `.agents` 才执行适配；尚未安装时按 `.agents/docs/update-agents.md` 或能力包内同名 runbook 安装。不要把源仓维护者 `.agents/skills` 当作业务技能来源。
2. 先采用本次用户明确的项目目录，其次沿用目标项目已确认的配置，再读 [source.md](references/source.md) 补齐未知机制，分别核对适用形态、项目技能目录、项目规则 MD 和证据状态。文档声明支持某目录，不等于当前宿主必然使用该目录或多个产品共用目录；已有现场事实优先，未知项由用户说明。已确认技能目录即可独立适配，MD 未知只留待确认，不阻塞目录 DryRun/Write/Check；用户明确目录时不额外强求无关的版本或 MD 信息。用户提供的项目差异保留在项目配置或本次范围说明中，不直接反写共享 source.md。已有自定义配置保留。
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

## WorkBuddy / CodeBuddy 原生 Agent

使用 `coding-agent-adaptation --agent WorkBuddy` 或 `--agent CodeBuddy`。两者复用项目 `.codebuddy/agents/*.md` 薄入口，name/description 来自 canonical 定义；agentMode=agentic、enabled=true、enabledAutoRun=false。正文要求先读项目 AGENTS.md，再读取实际解析的源路径及完整 YAML/正文，不复制行为正文。共享入口避免两宿主交替更新产生不同内容。

```powershell
node .agents/scripts/sync-runtime-skills.js --agent --runtime WorkBuddy --project-root . --mode DryRun
node .agents/scripts/sync-runtime-skills.js --agent --runtime WorkBuddy --project-root . --mode Write
node .agents/scripts/sync-runtime-skills.js --agent --runtime CodeBuddy --project-root . --mode Check
```

更新器使用 `-RuntimeAdapter WorkBuddy -Agent` 或 CodeBuddy，普通更新刷新已受管入口。手改、自定义文件和链接保留；源移除只清理未手改生成物。默认 Skill 不变。CodeBuddy 字段来自官方 IDE 定义及本机内置样例；WorkBuddy 代码项目按官方兼容 CodeBuddy 机制接入，客户端实际发现/调用仍需分别验收，东华版不自动归入标准版验证结论。
