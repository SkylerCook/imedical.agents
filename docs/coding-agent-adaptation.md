# Coding agent 技能适配

统一入口为 `plugins/agent-context-kit/skills/coding-agent-adaptation/SKILL.md`，执行器为 `scripts/sync-runtime-skills.js`。Node.js >=22.5.0 是能力包工具链前置依赖，不是业务系统生产依赖。

## 原生支持：无需适配

**Codex、OpenCode、Cursor、GeminiCLI、GitHubCopilot** 原生发现项目 `.agents/skills`。安装能力包并生成所需技能入口后即可使用，无需复制、建立额外链接或填写适配清单。运行中的宿主可能需要刷新技能或开启新会话。

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

示例不是默认启用列表。普通安装/更新不会自动执行这份配置；移除清单条目不会删除旧链接。原生发现 `.agents/skills` 的宿主不必填写。已部署项目更新能力包后手动添加此可选章节，再执行技能；不覆盖既有配置。

## 目录链接适配与边界

以下宿主通过额外的项目目录接入同一批技能；`RuntimeAdapter` 是命令行参数，使用前面的目录清单时无需填写。

| 宿主 / RuntimeAdapter | 接入目录 | 策略 |
|---|---|---|
| CodeBuddy | `.codebuddy/skills` | 链接到 ContextRoot/skills |
| ClaudeCode | `.claude/skills` | 链接到 ContextRoot/skills |
| WorkBuddy | `.workbuddy/skills` | 链接；宿主发现待验 |
| WorkBuddyDonghua | `.workbuddydonghua/skills` | 链接；宿主发现待验 |
| Qoder | `.qoder/skills` | 链接到 ContextRoot/skills（IDE / CLI） |
| Custom | 显式 `--skills-dir` | 仅 Node 入口，先核实项目发现目录 |

Windows 建立 Junction；macOS/Linux 实现相对目录 symlink。只暴露当前项目技能集合，不遍历 available/disabled 插件建立新入口；插件启用、薄索引生成和陈旧入口清理由更新器负责。Overlay 校验 manifest，链接到模块自己的 ContextRoot/skills，不链接共享 capability 的技能集合。

链接与源目录共享内容；在工具技能面板编辑、删除技能也会影响源文件。不要通过宿主删除技能来解除适配。MCP、hooks、原生 subagent、CODEBUDDY.md/CLAUDE.md 兼容入口独立管理。

## 已安装项目：一次接入，后续自动可见

在目标工程根目录执行：

```powershell
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime CodeBuddy --mode DryRun
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime CodeBuddy --mode Write
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime CodeBuddy --mode Check
```

这三个命令不联网、不更新 capability、不创建 AGENTS.md 或修改 Git ignore。请按项目现有规范确认工具生成目录不进入业务提交。已建立链接后，新增、更新或移除通用技能自动反映到宿主目录，不需要再次复制。宿主可能需要新会话或重新加载。

同时更新能力包时使用统一入口：

```powershell
.agents/scripts/update-agents.ps1 -ProjectRoot . -RuntimeAdapter CodeBuddy -Mode DryRun
.agents/scripts/update-agents.ps1 -ProjectRoot . -RuntimeAdapter CodeBuddy -Mode Write
```

PowerShell 直接调用可传 `-RuntimeAdapter CodeBuddy,ClaudeCode,Qoder`。普通 DryRun 仍遵守更新器既有 fetch/pull 语义；要求离线或不改变 capability 时加 `-NoPull`，或使用上述独立 Node 命令。未选择 runtime 时仍不写工具目录；链接存在后无需持久化额外 runtime 配置。

首次安装的脚本文件入口支持 `install-agents.ps1 -RuntimeAdapter CodeBuddy`；安装完成后以 `Write -NoPull` 初始化默认项目发现层并接入链接。不带参数的网络安装方式保持原状，领域插件仍需初始化才能启用。

## 原生与定制目录

原生支持 `.agents/skills` 的宿主无需执行本节命令。仅在明确要求额外原生目录或定制目录时，Node 入口可显式覆盖：

```powershell
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime OpenCode --skills-dir .opencode/skills --mode DryRun
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime WorkBuddyDonghua --mode Write
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime WorkBuddyDonghua --mode Check
node .agents/scripts/sync-runtime-skills.js --project-root . --runtime Custom --skills-dir .custom/skills --mode DryRun
```

原生目录参考：OpenCode `.opencode/skills`、Cursor `.cursor/skills`、Gemini CLI `.gemini/skills`、GitHub Copilot `.github/skills`。`--skills-dir` 适用于所有 runtime；Custom 必填。完成 DryRun 后，对同一组参数执行 Write、Check。路径须为 `.host/.../skills` 形式并使用 `/`，拒绝绝对路径、父目录穿越、Git 元数据、ContextRoot 内嵌目标和链接父目录；与源相同则复用。

安装/更新器的 `-RuntimeAdapter` 接受表内全部命名宿主；原生支持的五个宿主参数仍兼容，但只复用通用层，无需主动指定。自定义路径仅用 Node 命令，不添加个人路径注册表。WorkBuddy 系目录来自端点约定及用户指定，文件系统测试不证明该版本宿主会加载项目目录。定制版、JetBrains 等宿主须独立核实项目路径，不能把用户级 `intellij-skills` 等路径直接推导到项目。用户级分发由已有全局技能管理流程处理。

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
- Windows 下 CodeBuddy 项目 Skills 页面已有用户确认的链接发现样本；不能据此宣称所有宿主、所有技能实际调用通过。
- CI 已配置 Windows/macOS/Linux × Node 22/24；工作流配置不等于矩阵已实跑通过。macOS/Linux 链接及宿主发现仍需对应 runner/宿主证据。
- Check 只证明文件系统状态；CodeBuddy 项目 Skills 或 CLI `/skills`、其它宿主各自发现界面，以及真实任务执行分别取证。

目录规范参考：[CodeBuddy IDE Skills](https://www.codebuddy.ai/docs/ide/Features/Skills)、[CodeBuddy CLI Skills](https://www.codebuddy.ai/docs/cli/skills)。

目录依据（2026-10-17 核对）：[OpenCode](https://opencode.ai/docs/skills/)、[Cursor](https://cursor.com/help/customization/skills)、[Gemini CLI](https://geminicli.com/docs/cli/creating-skills/)、[GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) 均声明 `.agents/skills` 项目发现；原生目录仅按需接入。WorkBuddy 官方[设置说明](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Setting)说明代码开发配置兼容，但不足以证明定制版项目技能目录加载。

Qoder 项目路径依据：[IDE Skills](https://docs.qoder.com/extensions/skills)、[CLI Skills](https://docs.qoder.com/cli/Skills)（2026-10-17 核对）。选择 `--runtime Qoder` 或 `-RuntimeAdapter Qoder` 建立 `.qoder/skills` 链接；文件系统接入后，IDE 重启查看 `/` 技能列表，CLI 新会话或 `/skills reload` 后检查发现。实际加载与任务调用仍须宿主证据。
