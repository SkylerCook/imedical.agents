# 初始化与插件接入

仅在初始化、接入插件或更新能力包时读取。先执行主 skill 的 Workspace Context 与授权检查；以下 `.agents/` 路径相对目标工程，`templates/` 和 `scripts/` 指插件根。普通维护和日常优化不要求完成本文件所有步骤。

## 插件更新流程

已部署业务工程更新 `.agents` 能力包时，优先使用统一更新脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun
```

确认 dry-run 输出后，才使用 `-Mode Write`。更新脚本只负责拉取能力包、检查入口、维护生成层 ignore、按 `plugin_profile.md` 分流插件、重建已启用插件 thin-index 和合并明确缺失的 config 项；不得自动重写 `AGENTS.md`、`.agents/memory/`、`.agents/rules/project.md` 或项目已有 config 值。

插件状态规则：

- `available`：插件代码已拉取，只用于能力发现；不合并配置、不生成 thin-index、不写 AGENTS 路由。
- `enabled`：项目已接入，初始化闭环已完成，参与常规更新。
- `disabled`：显式禁用，默认跳过；旧入口只报告，不自动删除。

若 `.agents/config/plugin_profile.md` 不存在，默认把 `agent-context-kit` 和 `agent-framework-evolution` 视为基础 `enabled` 插件，其它插件视为 `available`。

配置合并规则：

- 目标项目已有字段值优先，插件模板不能覆盖。
- 模板新增字段只追加到待确认配置项区块。
- 疑似废弃字段只报告 `config-deprecated-candidate`，不删除。
- 字段语义变化只报告 `config-review-required`，由 Agent 或人工确认后再修改。
- host、账号、密码、token、namespace、远程路径等连接事实仍只能来自 `.mcp.json`，不得写入 config、rules、memory 或插件。

## 初始化流程

初始化项目上下文时，先按主 skill 的“面向项目编程”确认实际入口和验证方式；只生成有内容的章节，不保留无信息 TODO：

1. 先判断 `contextMode`，相关证据核对后落盘；缺少 `.agents/config/project_context_profile.md` 时，参考 `templates/project_context_profile.template.md` 创建。
2. 创建或维护 `.agents/config/plugin_profile.md`；默认 `agent-context-kit` 和 `agent-framework-evolution` 为 `enabled`，其它已拉取插件为 `available`。
3. 运行 `.agents/scripts/check-agent-entrypoints.ps1`，只检查 `CLAUDE.md`、`CODEBUDDY.md` 可选兼容入口；不自动创建、复制或修复。
4. **代码探索（仅 `codebase-complete`）**：在写入任何 config/rules 之前，先探索本地代码，提取可验证的事实填入配置文件。探索范围：
   - 目录结构：实际源码、测试、构建或部署入口。
   - 实现约定：项目现有分层、命名及可复用参考实现。
   - 公共设施：基类、共享模块、依赖与调用约定，按实际技术栈核对。
   - 构建/运行入口：package.json、build 脚本、workspace 配置。
   - 已有配置及项目文档；仅涉及连接、远端能力或配置问题时读取 `.mcp.json`。
   探索仅覆盖当前初始化需要，不为模板全仓扫描；无法确定的非敏感配置标真实待确认项，连接字段只在私有配置处理。`intent-first-on-demand-export` 跳过全工程归纳。
5. 创建或更新 `AGENTS.md`，只放最小启动流程和路由；新建时参考 `templates/AGENTS.template.md`。
   - `codebase-complete`：可写入已验证架构事实。
   - `intent-first-on-demand-export`：必须写明本地代码不代表完整工程，后续按需导出相关文件后再分析和修改。
6. 如缺失 `.agents/rules/project.md`，基于项目规则模板创建。
7. 如缺失 `.agents/memory/project-memory.md`，基于项目记忆模板创建。
8. 使用插件内置脚本生成 plugin thin-index：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/agent-context-kit/scripts/generate-plugin-thin-index.ps1 -PluginPath .agents/plugins/agent-context-kit -ProjectRoot . -Mode DryRun
   ```
9. 检查冲突后，仅在用户要求初始化或更新索引时，用 `-Mode Write` 重新执行。
10. 项目特定值放入 `.agents/config/`，不要写成插件默认值。
11. 确认 `.agents/.git/info/exclude` 包含生成层忽略规则，至少包括：
    - `/config/`
    - `/memory/`
    - `/rules/`
    - `/skills/`
    - `/scripts/`
12. 如果 `.agents/scripts/install-git-hooks.ps1` 存在，向用户提示可选提交前差异降噪 hook；只有用户明确要求时，才在业务项目根目录运行：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/install-git-hooks.ps1 -ProjectRoot .
   ```
   `.agents` 只分发 hook 模板和安装脚本，不自动修改业务项目 `core.hooksPath`。

插件内 `scripts/generate-plugin-thin-index.ps1` 是稳定调用入口，只 wrapper 到根 `.agents/scripts/generate-plugin-thin-index.ps1`。修改 thin-index 行为时只改根脚本，不复制插件脚本实现。

## 上下文维护完成后的插件接入引导

仅当初始化范围包含插件选择，或当前任务明确需要新增能力时，引导用户选择；普通维护和日常优化不执行本节。不要因为 `.agents/plugins/<plugin>/` 目录存在就自动启用。插件目录存在只表示 `available`。

执行顺序：

1. 读取 `.agents/config/plugin_profile.md`，确认当前插件状态。
2. 扫描候选插件的 `.agents/plugins/<plugin>/.agents-plugin/plugin.json`，读取 `name`、`displayName`、`initSkill`、`dependencies`、`dependsOn` 或 `depends_on`。
3. 根据项目上下文向用户说明可选插件能力和适用场景；只在用户明确选择或项目任务明确需要时继续。
4. 对用户选择的目标插件，先处理 manifest 中声明的依赖插件：
   - 若依赖插件状态不是 `enabled`，先读取依赖插件真实 init skill 并完成初始化闭环。
   - 依赖插件验收通过后，运行 `.agents/scripts/update-plugin-profile.ps1 -ProjectRoot . -Plugin <dependency-plugin> -Status enabled` 机械写入状态。
   - 所有依赖插件均为 `enabled` 后，再读取目标插件真实 init skill。
5. 目标插件初始化闭环验收通过后，运行 `.agents/scripts/update-plugin-profile.ps1 -ProjectRoot . -Plugin <plugin-name> -Status enabled`。
6. 最后运行 `.agents/scripts/update-agents.ps1 -ProjectRoot . -Mode DryRun`；无停止条件时再按 runbook 执行 `-Mode Write`。

不得把依赖插件“自动安装”等同于直接改 `plugin_profile.md`。这里的自动安装含义是：自动按依赖顺序引导并执行依赖插件的真实 init skill、完成验收，然后再机械写入 `enabled`。如果依赖插件 init skill 需要用户确认项目事实或配置，必须停下来让用户确认。

## 插件初始化闭环

当用户要求初始化、重新部署或接入 `.agents/plugins/<plugin>/` 能力时，不要只生成 thin-index。必须按对应插件的真实 init skill 完整执行并验收；若插件提供 bootstrap/init skill，先读取该 skill，再执行落地。

常见 init skill：

- `project-context-maintenance`：维护 `AGENTS.md`、项目 profile、rules、memory 和插件 thin-index。
- `coding-iris-init`：维护 IRIS 编码 profile、编码转换脚本、IRIS rules/skills thin-index。
- `i18n-project-init`：维护 i18n profile、i18n rules/skills thin-index。

完整闭环必须包含：

1. 读取目标工程 `AGENTS.md` 和对应插件真实 init skill。
2. 生成或更新 `.agents/config/*_profile.md`；profile 只保存非敏感项目差异，不保存 host、账号、密码、token、namespace 或远程路径；已有 profile 必须合并，不得覆盖。
3. 生成 `.agents/rules/` 和 `.agents/skills/` thin-index；thin-index 必须指向 `.agents/plugins/<plugin>/` 内真实文件。
4. 如插件需要本地脚本，复制到 `.agents/scripts/`；目标存在且内容不同时，默认报告 conflict，不覆盖。
5. 更新 `AGENTS.md` 的插件能力路由；入口只写启动顺序、profile/rules/skills 路由和硬约束，不复制完整规则。
6. 确认 `.agents/.git/info/exclude` 忽略生成层：`/config/`、`/memory/`、`/rules/`、`/skills/`、`/scripts/`、`/work/`。
7. 扫描长期上下文，确认没有具体服务器地址、账号、密码、token、namespace 或远程路径。
8. 验证 `.agents` Git 状态；生成层应被忽略，能力包源码改动必须明确区分。
9. 初始化闭环验收通过后，运行 `.agents/scripts/update-plugin-profile.ps1 -ProjectRoot . -Plugin <plugin-name> -Status enabled`，机械反写插件状态。
10. 提交前如项目已启用 `.agents/hooks`，Agent 应主动运行 `.agents/scripts/check-functional-diff.ps1 -ProjectRoot . -Staged`；未启用时只提示用户可选安装，不擅自执行 `git config core.hooksPath`。

验收时至少检查：

- `AGENTS.md`
- `.agents/config/project_context_profile.md`
- 插件要求的 `.agents/config/*_profile.md`
- `.agents/rules/<plugin-index>.md` 或等价索引
- `.agents/skills/<plugin-skill>/SKILL.md` 或等价 skill thin-index
- 插件要求的 `.agents/scripts/*`
- `.agents/.git/info/exclude`
