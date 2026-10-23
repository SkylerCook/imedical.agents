# Coding agent 技能适配

统一入口为 `plugins/agent-context-kit/skills/coding-agent-adaptation/SKILL.md`，执行器为 `scripts/sync-runtime-skills.js`。Node.js >=22.5.0 是能力包工具链前置依赖，不是业务系统生产依赖。

## 先核对宿主与两套发现机制

宿主的项目技能目录、项目规则 MD、适用形态及来源统一维护在 [source.md](../plugins/agent-context-kit/skills/coding-agent-adaptation/references/source.md)。先按对应证据区分“已知机制”“用户提供的项目差异”和“待确认”，再选择接入方式；未知目录或 MD 由用户说明，不按宿主名称推导。

技能目录发现与项目规则 MD 加载是两套机制。对已确认支持项目通用技能目录的宿主，生成所需技能入口后可复用通用层；仍应取得当前宿主的发现证据，运行中的宿主可能需要刷新技能或开启新会话。项目规则入口另行核对，不以技能可见证明规则已加载。

已确认技能目录即可独立适配；MD 未知只列对应待确认项，不阻塞目录 DryRun/Write/Check。用户直接指定目录时不额外强求与该项工作无关的版本或 MD 信息。

source.md 是人工/Agent 查阅参考；执行器继续使用脚本内既有 runtime 映射，不自动读取该文件。登记来源不授权创建文件，也不改变 Write / Check 的范围。用户提供的项目差异留在目标项目配置或本次范围说明中，不直接写入共享来源表；保留已有自定义配置。

## 需要额外目录的宿主：写清单后执行技能

在目标项目 `.agents/config/project_context_profile.md` 中添加以下章节，按实际使用的工具保留目录即可；Overlay 使用模块自己的 ContextRoot/config/project_context_profile.md。

````markdown
## 技能适配目录

```text
.qoder/skills
.workbuddydonghua/skills
.codebuddy/skills
```
````

然后对 Agent 说：**“执行 coding-agent-adaptation，按项目配置补齐缺失的技能目录。”**

也可在本次对话直接提供同样的目录清单，明确限定本次范围。无需填写宿主名称或命令参数。技能读取清单，逐个检查并只为缺失目录建立指向 ContextRoot/skills 的链接；正确链接跳过，实体目录或错误链接保留并报告。空行忽略、重复目录去重，兼容行尾逗号。已有实体目录不会逐项填充或合并，避免混入用户自建技能。

示例不是默认启用列表。普通安装/更新不会自动执行这份配置；移除清单条目不会删除旧链接。已确认可复用通用层的宿主不必填写。已部署项目更新能力包后手动添加此可选章节，再执行技能；不覆盖既有配置。

## 目录链接适配与边界

命名宿主的接入目录及既有策略见 source.md；执行器默认路径须与已确认的项目目录一致，需要额外项目目录时再链接到同一批技能。两者不一致时，在用户已明确目标目录后使用 Node 的 `--runtime Custom --skills-dir <目录>`；未知时由用户说明后再执行。`RuntimeAdapter` 是命令行参数，使用前面的目录清单时无需填写。未列出的宿主也使用 `Custom` 和显式目录。

Windows 建立 Junction；macOS/Linux 实现相对目录 symlink。只暴露当前项目技能集合，不遍历 available/disabled 插件建立新入口；插件启用、薄索引生成和陈旧入口清理由更新器负责。Overlay 校验 manifest，链接到模块自己的 ContextRoot/skills，不链接共享 capability 的技能集合。

链接与源目录共享内容；在工具技能面板编辑、删除技能也会影响源文件。不要通过宿主删除技能来解除适配。MCP、hooks、原生 subagent 和项目规则 MD 独立管理。

需要创建项目规则兼容入口时，先按 source.md 核对该宿主实际读取的 MD、格式与 symlink 支持，以及多入口优先级和重复加载风险，再使用项目上下文维护流程，沿已有授权执行。已有普通文件、自定义内容保留；兼容入口采用指向 AGENTS.md 的 symlink，不复制正文。执行本技能只授权所选技能目录适配，未授权的规则入口创建另行确认。

## 已安装项目：一次接入，后续自动可见

在目标工程根目录执行：

```powershell
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime CodeBuddy --mode DryRun
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime CodeBuddy --mode Write
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime CodeBuddy --mode Check
```

这三个命令不联网、不更新 capability、不创建项目规则 MD 或修改 Git ignore。Check 只检查技能目录的文件系统状态。请按项目现有规范确认工具生成目录不进入业务提交。已建立链接后，新增、更新或移除通用技能自动反映到宿主目录，不需要再次复制。宿主可能需要新会话或重新加载。

同时更新能力包时使用统一入口：

```powershell
.agents/scripts/update-agents.ps1 -ProjectRoot . -RuntimeAdapter CodeBuddy -Mode DryRun
.agents/scripts/update-agents.ps1 -ProjectRoot . -RuntimeAdapter CodeBuddy -Mode Write
```

PowerShell 直接调用可传 `-RuntimeAdapter CodeBuddy,ClaudeCode,Qoder`。普通 DryRun 仍遵守更新器既有 fetch/pull 语义；要求离线或不改变 capability 时加 `-NoPull`，或使用上述独立 Node 命令。未选择 runtime 时仍不写工具目录；链接存在后无需持久化额外 runtime 配置。

首次安装的脚本文件入口支持 `install-agents.ps1 -RuntimeAdapter CodeBuddy`；安装完成后以 `Write -NoPull` 初始化默认项目发现层并接入链接。不带参数的网络安装方式保持原状，领域插件仍需初始化才能启用。

## 原生与定制目录

已经确认复用通用层的宿主无需执行本节命令。仅在明确要求额外目录或定制目录时，Node 入口可显式覆盖。以下只展示参数形态，宿主与目录须先按前述步骤确认，示例不作为发现证据：

```powershell
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime OpenCode --skills-dir .opencode/skills --mode DryRun
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime Custom --skills-dir .custom/skills --mode DryRun
```

其它项目目录与证据状态见 source.md。`--skills-dir` 适用于所有 runtime；Custom 必填。完成 DryRun 后，对同一组参数执行 Write、Check。路径须为 `.host/.../skills` 形式并使用 `/`，拒绝绝对路径、父目录穿越、Git 元数据、ContextRoot 内嵌目标和链接父目录；与源相同则复用。

安装/更新器的 `-RuntimeAdapter` 保留既有命名 runtime；具体参数值查执行器 `--help`，source.md 不注册新 runtime。默认复用通用层的参数仍兼容，无需主动指定。自定义路径仅用 Node 命令，不添加个人路径注册表。目录约定、文件系统测试与宿主实际发现分别取证；定制版、JetBrains 等宿主须独立核实项目路径，不能将用户级路径直接推导到项目。用户级分发由已有全局技能管理流程处理。

已部署工程更新能力包后，显式选择新增 runtime 或执行 Node 命令即可；已有链接无需迁移，不自动清理旧目录，也不自动给全部宿主创建入口。

## 冲突和旧项目迁移

- `runtime-adapter-linked` / `unchanged` / `reused`：文件系统接入已确认。
- `runtime-adapter-planned`：尚未接入；Check 退出 1，DryRun 退出 0，均不写文件。
- `runtime-adapter-conflict`：目标是普通目录、文件、错误或失效链接，退出 1，保留原内容。
- `runtime-adapter-blocked`：上下文、父链、来源或平台权限异常，退出 2，不复制降级。多 runtime 或更新流程可能已完成前面的步骤，应按结果检查后重试。

旧 `.claude/skills` 复制目录不会自动删除、覆盖或归并。先查看自定义文件，确定迁移范围；经明确授权将自定义技能安置到合适的项目或用户目录后，才可移除旧目录并重跑。旧 `sync-claudecode-skills.ps1` 保留为显式 legacy 复制入口，统一更新器不再调用；它拒绝向已链接的目标复制。

工程移动后，Windows Junction 可能仍指向旧路径。脚本检查链接的实际目标，错误目标即报冲突。修复须核对绝对路径与旧目标，只移除明确授权的链接本身（禁止递归删除），再执行 Write。目标父目录若为链接，拒绝写入，避免越界。

## 验证证据

- 原有 Windows Node 专项通过，覆盖只读、幂等、实时可见、自定义内容保留、失效链接、父链越界、Overlay 本地边界和 legacy 复制写穿保护；PS5.1/PS7 完整更新器与 Overlay 回归通过。
- 宿主机制、用户样本的范围及来源记录见 source.md；单个发现样本不能证明其它宿主或实际任务调用通过。
- CI 已配置 Windows/macOS/Linux × Node 22/24；工作流配置不等于矩阵已实跑通过。macOS/Linux 链接及宿主发现仍需对应 runner/宿主证据。
- Check 只证明技能目录状态；宿主技能发现、项目规则 MD 加载，以及真实任务执行分别取证。缺少宿主访问或未知 MD 时报告未验证。
