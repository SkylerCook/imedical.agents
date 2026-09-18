# Coding agent 技能适配

统一入口为 `skills/coding-agent-adaptation/SKILL.md`，执行器为 `scripts/sync-runtime-skills.js`。Node.js >=22.5.0 是能力包工具链前置依赖，不是业务系统生产依赖。

## 支持与边界

| RuntimeAdapter | 项目发现目录 | 策略 |
|---|---|---|
| CodeBuddy | `.codebuddy/skills` | 链接到 ContextRoot/skills |
| ClaudeCode | `.claude/skills` | 链接到 ContextRoot/skills |
| Codex | `.agents/skills` | 直接复用，不创建另一份目录 |

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

PowerShell 直接调用可传 `-RuntimeAdapter CodeBuddy,ClaudeCode,Codex`。普通 DryRun 仍遵守更新器既有 fetch/pull 语义；要求离线或不改变 capability 时加 `-NoPull`，或使用上述独立 Node 命令。未选择 runtime 时仍不写工具目录；链接存在后无需持久化额外 runtime 配置。

首次安装的脚本文件入口支持 `install-agents.ps1 -RuntimeAdapter CodeBuddy`；安装完成后以 `Write -NoPull` 初始化默认项目发现层并接入链接。不带参数的网络安装方式保持原状，领域插件仍需初始化才能启用。

## 冲突和旧项目迁移

- `runtime-adapter-linked` / `unchanged` / `reused`：文件系统接入已确认。
- `runtime-adapter-planned`：尚未接入；Check 退出 1，DryRun 退出 0，均不写文件。
- `runtime-adapter-conflict`：目标是普通目录、文件、错误或失效链接，退出 1，保留原内容。
- `runtime-adapter-blocked`：上下文、父链、来源或平台权限异常，退出 2，不复制降级。多 runtime 或更新流程可能已完成前面的步骤，应按结果检查后重试。

旧 `.claude/skills` 复制目录不会自动删除、覆盖或归并。先查看自定义文件，确定迁移范围；经明确授权将自定义技能安置到合适的项目或用户目录后，才可移除旧目录并重跑。旧 `sync-claudecode-skills.ps1` 保留为显式 legacy 复制入口，统一更新器不再调用；它拒绝向已链接的目标复制。

工程移动后，Windows Junction 可能仍指向旧路径。脚本检查链接的实际目标，错误目标即报冲突。修复须核对绝对路径与旧目标，只移除明确授权的链接本身（禁止递归删除），再执行 Write。目标父目录若为链接，拒绝写入，避免越界。

## 验证证据

- Windows Node 11 项专项通过，覆盖只读、幂等、实时可见、自定义内容保留、失效链接、父链越界、Overlay 本地边界和 legacy 复制写穿保护；PS5.1/PS7 完整更新器与 Overlay 回归通过。
- Windows 下 CodeBuddy 项目 Skills 页面已有用户确认的链接发现样本；不能据此宣称所有宿主、所有技能实际调用通过。
- CI 已配置 Windows/macOS/Linux × Node 22/24；工作流配置不等于矩阵已实跑通过。macOS/Linux 链接及宿主发现仍需对应 runner/宿主证据。
- Check 只证明文件系统状态；CodeBuddy 项目 Skills 或 CLI `/skills`、其它宿主各自发现界面，以及真实任务执行分别取证。

目录规范参考：[CodeBuddy IDE Skills](https://www.codebuddy.ai/docs/ide/Features/Skills)、[CodeBuddy CLI Skills](https://www.codebuddy.ai/docs/cli/skills)。
