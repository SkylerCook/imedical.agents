# Workspace Overlay 部署与恢复 Runbook

Workspace overlay 用于让多个模块工作区共享一份 canonical capability Git，同时各自保留独立的 `config`、`rules`、`memory` 和 `work`。它遵循 **capability-once/context-many**：先更新标版根 capability，再逐个刷新模块 Context；模块刷新不会 fetch 或 pull capability Git。

## 五类根

| 根 | 含义 | 写入边界 |
|---|---|---|
| `WorkspaceRoot` | 当前模块工作区根 | 只承载模块入口和 SourceRoot 逻辑路径 |
| `ContextRoot` | 当前模块的 `.agents` | 本地 config、rules、memory、work 和生成索引 |
| `CapabilityRoot` | 共享的 canonical `.agents` Git | plugins、vendor、skills、agents、workflows、scripts 等能力源 |
| `SourceRoot` | manifest 声明的业务源码根 | 业务文件读取和写入必须限制在声明范围内 |
| `GitRoot` | SourceRoot 所属真实 Git 仓库根 | Git diff/status/commit 在这里执行 |

解析器只读取 `WorkspaceRoot/.agents/capability.json`。不得通过扫描父目录或 sibling 猜测 capability、源码或 Git 根。

## 阶段一：更新 canonical capability 与标版 Context

在标版根运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .agents\scripts\update-agents.ps1 -ProjectRoot . -Mode DryRun
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .agents\scripts\update-agents.ps1 -ProjectRoot . -Mode Write
```

这一步可以 fetch/pull canonical capability Git，并刷新标版 Context。出现停止条件时不得进入模块更新。

## 阶段二：逐个刷新模块 Context

从 canonical capability 脚本入口对每个模块先 DryRun：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\CodeSpace\GIT\Gitlab\Imedical\Doctor-Iris\imedical\.agents\scripts\update-agents.ps1 `
  -ProjectRoot D:\CodeSpace\GIT\Gitlab\Imedical\Doctor-Iris\imedical-module-workspaces\dental `
  -Mode DryRun `
  -NoPull `
  -Detailed
```

确认无停止条件后，仅将 `-Mode DryRun` 改为 `-Mode Write`。随后执行模块工作区自己的验证器。overlay 输出应包含 `capability-pull-skipped-overlay`；不要求 `ContextRoot` 存在 `.git` 或 `.git/info/exclude`。Write 还会在 `ContextRoot/scripts/` 生成 manifest-aware runtime adapter，其中 `.agents/scripts/iris-mcp.js` 在运行时读取 `capability.json` 并转发到 `CapabilityRoot/scripts/iris-mcp.js`，不会复制 helper 实现或写死 capability 绝对路径。

固定顺序是：更新一次 capability → 对每个模块 DryRun → 无停止条件后 Write → 执行模块验证器。不要在每个模块中重复更新 capability。

## Manifest 与目录边界

`capability.json` 必须声明 `schemaVersion: 1`、`mode: workspace-overlay`、`contextRoot`、`capabilityRoot`、`sharedDirectories`、`localDirectories` 和至少一个 `sourceRoots` 条目。`contextRoot` 和 SourceRoot `path` 必须是留在 `WorkspaceRoot` 内的相对路径；`WorkspaceRoot` 到 `ContextRoot` 的既有路径链不得经过 Junction 或其他 reparse point；shared/local 名称必须是单个安全目录名，不允许绝对路径、路径分隔符或 `..`。shared path 必须是指向 `CapabilityRoot` 对应目录的 Junction；local path 必须是物理目录；SourceRoot 逻辑路径必须是指向声明 `target` 的 Junction。任何 manifest 契约或边界错误都会在创建目录、Junction 或 runtime adapter 前阻断，`-Repair` 也只允许处理 `ContextRoot` 内的受管 Junction。

更新器只允许：

- 在 `ContextRoot` 合并缺失配置、生成 thin-index 和本地 runtime adapter；
- 创建缺失的安全 Junction；
- 在显式 `-Repair` 时仅修复目标不符的受管 Junction。

它不得覆盖现有 config/rules/memory，不得把本地目录替换成 link，也不得修改 capability Git 或业务 Git。

## 停止条件

出现以下任一情况立即停止，不进入 Write 或业务部署：

- shared/SourceRoot Junction 指向错误，且尚未显式选择安全 `-Repair`；
- shared path 被普通文件或普通目录占用；
- local path 是 Junction、symlink、文件或其他非物理目录；
- `CapabilityRoot` 不存在或没有 `.git`；
- manifest 无效、SourceRoot/GitRoot 不存在、source name 重复；
- config 合并冲突或迁移需要人工确认；
- 显式选择的插件状态为 `disabled`；
- coding-iris overlay 未声明 frontend SourceRoot，却要求自动判断前端编码；
- 任一 DryRun 对 capability Git 或业务 Git 产生状态变化。

## 恢复策略

先保存 `WorkspaceRoot`、`CapabilityRoot` 和每个 `GitRoot` 的 `git status --short`。对错误 Junction，先核对 manifest 的精确目标；只有 Junction 本身且路径属于 manifest 受管项时才使用 `-Repair`。普通目录、文件、本地生成目录或含未知内容的路径不得自动删除或移动，应报告给用户处理。

恢复后重复 DryRun，并比较所有 Git 状态。只有状态完全一致、所有 Junction 为 `junction-ok`、local path 为 `local-path-ok`，且没有 config/plugin 停止条件时，才允许 Write。
