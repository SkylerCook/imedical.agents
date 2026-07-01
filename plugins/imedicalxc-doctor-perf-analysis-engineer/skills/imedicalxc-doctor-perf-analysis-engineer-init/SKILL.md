---
name: imedicalxc-doctor-perf-analysis-engineer-init
description: Use when initializing imedicalxc-doctor-perf-analysis-engineer in a target project, including thin-index generation and plugin status update.
---

# iMedicalXC Doctor Perf Analysis Engineer Init

## 职责边界

本 Skill 是 `imedicalxc-doctor-perf-analysis-engineer` 的 bootstrap 初始化入口。首次接入目标工程时，Agent 必须直接读取插件真实路径 `.agents/plugins/imedicalxc-doctor-perf-analysis-engineer/skills/imedicalxc-doctor-perf-analysis-engineer-init/SKILL.md`，不要依赖安装后才生成的 thin-index。

## 输入

- `targetProjectRoot`：目标工程根目录，默认当前工作区。
- `installMode`：默认 `plugin-reference-thin-index`。

## 依赖检查

本插件依赖 `imedicalxc-doctor-extend-engineer`：
- 主编排器 `SKILL.md` 引用了 `[[using-superpowers]]` 和 `[[brainstorming]]`，这些由 `imedicalxc-doctor-extend-engineer` 通过 `vendor/superpowers/` 提供。
- 若 `imedicalxc-doctor-extend-engineer` 未启用，停止并提示先初始化该依赖插件。

## 必读

先读取：

1. 插件根 `AGENTS.md`。
2. 插件根 `README.md`。
3. 目标工程已有 `.agents/` 状态，确认 `imedicalxc-doctor-extend-engineer` 已启用。

## 初始化流程

1. **检查目标工程状态**：
   - 确认 `.agents/` 目录存在。
   - 确认 `AGENTS.md` 存在。
   - 确认 `.agents/config/plugin_profile.md` 中 `imedicalxc-doctor-extend-engineer` 状态为 `enabled`。
   - 若依赖未满足，停止并报告 `plugin-dependency-missing`。

2. **检查存量 thin-index**：
   - 若 `.agents/skills/imedicalxc-doctor-perf-analysis-engineer/SKILL.md` 已存在且指向正确插件路径，跳过重建（用户可用 `-Force` 强制覆盖）。

3. **生成 thin-index**：
   - 先执行 DryRun：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/imedicalxc-doctor-perf-analysis-engineer/scripts/generate-plugin-thin-index.ps1 -PluginPath .agents/plugins/imedicalxc-doctor-perf-analysis-engineer -ProjectRoot . -Mode DryRun -ExcludeSkill imedicalxc-doctor-perf-analysis-engineer-init
     ```
   - **若 DryRun 全部 skipped**：提示"thin-index 已存在且指向正确插件路径，无需更新。如需强制重建，使用 `-Force` 参数。"然后跳到步骤 4。
   - 若有需要写入的条目，用户确认后执行 Write：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/imedicalxc-doctor-perf-analysis-engineer/scripts/generate-plugin-thin-index.ps1 -PluginPath .agents/plugins/imedicalxc-doctor-perf-analysis-engineer -ProjectRoot . -Mode Write -ExcludeSkill imedicalxc-doctor-perf-analysis-engineer-init
     ```

4. **更新插件状态**：
   - 初始化闭环验收通过后，运行脚本机械维护 `.agents/config/plugin_profile.md`：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File .agents/scripts/update-plugin-profile.ps1 -ProjectRoot . -Plugin imedicalxc-doctor-perf-analysis-engineer -Status enabled
     ```

5. **更新项目记忆**：
   - 将初始化结果写入 `.agents/memory/project-memory.md` 的"最近变化"段落，记录接入了性能分析插件和 thin-index 生成结果。

## 去项目化边界

- 不在插件中硬编码服务器地址、namespace、账号、密码、token、远程路径。
- 不在 init 过程中创建项目专属 profile（本插件不需要项目级配置）。
- 报告输出目录由用户在分析时指定，默认输出到当前项目目录。

## 输出

- 依赖检查结果。
- thin-index DryRun/Write 结果。
- `plugin_profile.md` 中 `imedicalxc-doctor-perf-analysis-engineer` 的最终状态。
- 被跳过或冲突的文件。
- project-memory.md 更新结果。
