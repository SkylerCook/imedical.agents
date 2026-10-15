# 插件可用性依赖

`dependencies` 要求依赖插件已启用，沿用现有初始化与更新门禁。`availableDependencies` 表示某阶段需要另一插件的文件和入口；允许目标处于 available 或 enabled，显式 disabled 时停止该阶段。两种声明都不授予业务写入权限。

## 声明与执行

关系只写在调用方 `.agents-plugin/plugin.json`：

```json
{
  "availableDependencies": [{
    "plugin": "demand-delivery-plugin",
    "stage": "demand-commit",
    "trigger": "BOS 需求生成提交计划或执行本地提交",
    "entries": ["skills/demand-commit/SKILL.md", "scripts/commit-demand.js"]
  }]
}
```

`stage` 是调用方内的阶段标识，`trigger` 说明何时检查，`entries` 为目标插件内的相对文件路径。每个 stage/plugin 组合唯一；同一阶段可声明多个依赖。此关系不递归启用插件，不进入强依赖拓扑或 `dependencyVersions`；允许双向引用，由具体阶段触发。新增调用须核对实际加载的入口，文件可读不替代版本兼容、目标技能前置条件或业务测试。

进入声明的阶段前，从当前能力包执行：

```text
node <CapabilityRoot>/scripts/check-plugin-availability.js --project-root <WorkspaceRoot> --plugin <调用方插件> --stage <阶段>
```

检查复用 workspace-context，Overlay 从 CapabilityRoot 读取插件，从 ContextRoot 读取项目状态。退出码 0 表示该阶段所需 manifest 和入口可读且没有显式禁用；1 表示阶段依赖缺失或禁用；2 表示参数、声明或配置无效。失败时报告具体缺口，只暂停依赖该能力的阶段。插件接入、凭据、提交及远端写入继续按目标技能要求处理。

省略 `--stage` 为清单模式，输出所有声明及可用性；缺失仅报告，退出码仍为 0，声明无效仍返回 2。更新器对 enabled 调用方复用此模式，输出 `plugin-availability-ready` / `plugin-availability-warning`，不因阶段缺口阻断独立能力，也不自动启用、修改配置或生成依赖插件的索引。未知阶段报错，避免拼写错误跳过检查。

没有 Node.js 执行能力时，按 manifest 的同一 stage 人工核对目标状态、manifest 与全部入口；明确记录人工检查，不能宣称脚本通过。

## BOS 与需求交付

BOS 的提交、连续验收，以及补录脚本的 prepare/message/plan 分别声明依赖；查询、collect、bind、render 不因 Delivery 缺失而启动失败。Delivery 在转入 BOS 补录或代码日志时检查对应声明；BOS 日志仍需既有项目接入及独立配置。可用性检查不替代这些前提。

## 已部署工程

通过既有更新流程取得完整能力包，再执行 Check 或 DryRun -NoPull 查看提示，Write -NoPull 刷新已启用插件索引。根 `scripts/*.js` 与插件文件已在 sparse 分发范围，无新增私有配置、自动启用或旧文件清理。旧框架不会检查新字段；应一起更新根脚本与插件，不能只复制 manifest。
