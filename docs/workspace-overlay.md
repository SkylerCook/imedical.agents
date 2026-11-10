# Workspace Overlay 部署与恢复 Runbook

夜跑可显式填写可选 `nightRunReference` 绑定唯一 run；由 night-workspace 的绝对 runReference 生成并复核。受管部署/编译/验收入口要求 work item 身份，详见[夜跑契约](night-policy.md#schema-21-启动契约)。普通 Overlay 无此字段时保持原行为。

部署配置例外：IRIS 部署可通过 manifest 的可选 `projectEnvFallback` 显式声明回退文件；仅模块配置不存在时读取，不改变任何根边界。详见 [IRIS 部署配置继承](../plugins/coding-iris-plugin/rules/iris_deploy_checklist.md#部署配置继承)。


Workspace overlay 用于让多个模块工作区共享一份 canonical capability Git，同时各自保留独立的 `config`、`rules`、`memory` 和 `work`。它遵循 **capability-once/context-many**：先更新标版根 capability，再逐个刷新模块 Context；模块刷新不会 fetch 或 pull capability Git。

## 五类根

| 根 | 含义 | 写入边界 |
|---|---|---|
| `WorkspaceRoot` | 当前模块工作区根 | 只承载模块入口和 SourceRoot 逻辑路径 |
| `ContextRoot` | 当前模块的 `.agents` | 本地 config、rules、memory、work 和生成索引 |
| `CapabilityRoot` | 共享的 canonical `.agents` Git | plugins、vendor、skills、agents、workflows、scripts 等能力源 |
| `SourceRoot` | manifest 声明的业务源码根 | 默认修改范围；源码调查从这里开始 |
| `GitRoot` | SourceRoot 所属真实 Git 仓库根 | Git diff/status/commit 在这里执行 |

解析器只读取 `WorkspaceRoot/.agents/capability.json`。不得通过扫描父目录或 sibling 猜测 capability、源码或 Git 根。

创建 worktree Overlay 时执行[审阅交付规范](guides/worktree-review.md)：入口指向真实 GitRoot，同时覆盖 `.code-workspace` 与直接打开 WorkspaceRoot 的方式，固定创建基点并区分未提交、worktree 提交和已集成提交。

### 源码读取与修改范围

源码调查先从 SourceRoot 开始，允许按当前需求在已声明 GitRoot 中只读搜索和查看公共实现、基类、接口及调用方；目标项目注册表明确提供其他相关源码仓库时，也可按该映射只读调查。只读调查无需另行授权，不要求切换工作区。按符号和调用链缩小检索范围，不默认通读全仓，不扫描父目录猜测根路径。

默认修改、暂存、提交和部署范围仍限定为 SourceRoot 与当前任务授权；读取外部代码不扩大写入权限。修复点位于模块外时，继续完成只读取证，报告目标文件、原因和影响，停止模块外写入，待用户明确授权目标和范围后按项目约定处理。

backend-only 工作区可按项目注册表查看相关前端实现，但不新增 frontend SourceRoot、工作区入口或前端配置，不改变其 backend-only 身份。外部参考也不改变当前项目的 contextMode、配置来源及上下文归属；引用事实时注明真实仓库和路径。

已部署项目需先更新共享 CapabilityRoot，再在授权的项目上下文维护中定点合并模块入口的读写边界；普通更新保留自定义 AGENTS，不自动替换旧条款。保持 manifest、Junction、工具写入门禁和启用状态不变，无文件清理。

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

`capability.json` 必须声明 `schemaVersion: 1`、`mode: workspace-overlay`、`contextRoot`、`capabilityRoot`、`sharedDirectories`、`localDirectories` 和至少一个 `sourceRoots` 条目。`contextRoot` 和 SourceRoot `path` 必须是留在 `WorkspaceRoot` 内的相对路径；`WorkspaceRoot` 到 `ContextRoot` 的既有路径链不得经过 Junction 或其他 reparse point；shared/local 名称必须是单个安全目录名，不允许绝对路径、路径分隔符或 `..`。shared path 必须是指向 `CapabilityRoot` 对应目录的 Junction；local path 必须是物理目录。SourceRoot 按下述两种声明验证。任何 manifest 契约或边界错误都会在创建目录、Junction 或 runtime adapter 前阻断，`-Repair` 也只允许处理 `ContextRoot` 内的受管 shared Junction。

### SourceRoot：引用已有源码或持有本地源码

Windows 的 8.3 短名与长名可能指向同一目录。共享 GitRoot 映射同时核对声明目标及其物理等价路径，避免已解析的真实源码被误判越界；这不登记新的源码范围，也不放宽逃逸或链接保护。完整更新共享 CapabilityRoot 后刷新 ContextRoot 取得修正。

- 规范化后的 `path != target`：保持原有链接式声明，逻辑入口必须是精确指向 `target` 的 Junction。已有模块 manifest 不需要修改。
- 规范化后的 `path == target`：声明工作区自己的实体源码目录。例如下列声明只有一个 `code/` 目录，其中保存本地 Git；不再需要并列别名。保持 `schemaVersion: 1`，不新增工作区模式。

```json
{"name":"backend","path":"code","target":"code","gitRoot":"code"}
```

实体 SourceRoot 和 GitRoot 必须在 WorkspaceRoot 内，SourceRoot 不得与 ContextRoot、CapabilityRoot 或 Git 元数据重叠，入口和 GitRoot 的父链不得经过链接；SourceRoot 必须属于声明的实际 GitRoot。支持源码根位于该 Git 的子目录，也支持多个独立 GitRoot。文件映射继续检查真实路径，拒绝源码内越界链接、悬空链接、Git 元数据与未声明的嵌套仓库；新建和已删除文件按最近存在的父目录解析。

源码目录和 Git 必须由项目按已有授权准备；初始化、更新和 `-Repair` 均不创建、迁移或替换源码，也不自动执行 `git init`。先完整更新共享 CapabilityRoot，再刷新各 ContextRoot，最后在授权的目录迁移中采用实体声明。旧运行时仍会拒绝实体目录，不能先改 manifest。目录调整须同时核对 Git 状态、真实目标与项目入口，不直接删除旧链接或源码。此扩展只处理源码位置，不改变项目的在线／离线路由、服务器能力或操作授权。

更新器只允许：

- 在 `ContextRoot` 合并缺失配置、生成 thin-index 和本地 runtime adapter；
- 创建缺失的安全 Junction；
- 在显式 `-Repair` 时仅修复目标不符的受管 Junction。

它不得覆盖现有 config/rules/memory，不得把本地目录替换成 link，也不得修改 capability Git 或业务 Git。

## 停止条件

出现以下任一情况立即停止，不进入 Write 或业务部署：

- SourceRoot Junction 指向错误，或 shared Junction 指向错误且尚未显式选择安全 `-Repair`；
- 实体 SourceRoot／GitRoot 无效、经过链接、进入受保护目录或不匹配实际 Git 仓库；
- shared path 被普通文件或普通目录占用；
- local path 是 Junction、symlink、文件或其他非物理目录；
- `CapabilityRoot` 不存在或没有 `.git`；
- manifest 无效、SourceRoot/GitRoot 不存在、source name 重复；
- config 合并冲突或迁移需要人工确认；
- 显式选择的插件状态为 `disabled`；
- coding-iris overlay 未声明 frontend SourceRoot，且也没有明确的 backend SourceRoot 可证明 backend-only，却要求自动判断前端编码；
- 任一 DryRun 对 capability Git 或业务 Git 产生状态变化。

## 恢复策略

先保存 `WorkspaceRoot`、`CapabilityRoot` 和每个 `GitRoot` 的 `git status --short`。对错误 Junction，先核对 manifest 的精确目标；只有 Junction 本身且路径属于 manifest 受管项时才使用 `-Repair`。普通目录、文件、本地生成目录或含未知内容的路径不得自动删除或移动，应报告给用户处理。

恢复后重复 DryRun，并比较所有 Git 状态。只有状态完全一致、所有 Junction 为 `junction-ok`、实体 SourceRoot 为 `source-directory-ok`、local path 为 `local-path-ok`，且没有 config/plugin 停止条件时，才允许 Write。
