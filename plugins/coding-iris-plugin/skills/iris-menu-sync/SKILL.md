---
name: iris-menu-sync
description: 同步或刷新 imedical 菜单资料、安全组菜单树与本地菜单索引；菜单新增、删除、改名或链接调整后更新项目快照，支持全部或指定安全组。用于开发资料同步，不用于修改 HIS 菜单或权限。
---

# IRIS 菜单资料同步

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

## 已登记来源与定期刷新

目标工程 `ContextRoot/config/menu-sync/<sourceId>.json` 已登记时，优先复用 `scripts/iris-tools/refresh-menu.js run --project-root <WorkspaceRoot> --source-id <sourceId> --execute`。它负责现有 MCP 采集、分页、JSON 分段适配、虚拟节点 ID、完整性和异常差异检查，再调用原离线发布器；不再临时编写采集脚本。未加 `--execute` 时仍采集并保存计划，但不切换 current。

首次登记需用户明确授权当前环境持续只读采集与本地快照更新，并审阅服务端 `DHCDoc.Common.Menu` 的读取实现，再执行 `refresh-menu.js enroll --project-root <WorkspaceRoot> --source-id <sourceId> --allow-menu-read`。配置只记录摘要与采集策略，连接和凭据继续复用项目私有配置。环境或菜单类摘要变化时停止，人工核对后按[同步契约](../../references/menu-knowledge-sync.md#无人值守刷新)处理。

定期任务动态读取当时全部启用安全组；失败保留旧 current 和本地恢复断点。只恢复一小时内且环境、策略、安全组设置、基线与校验和一致的断点（`--resume <run UUID>`）；异常大量删除、原非空组变空或缺设置时通知用户。完成条件为 JSON 结果 `refreshed` / `no-menu-changes`、发布文件回读通过。只有有菜单差异或失败/需处理时通知，无变化安静结束。调度由用户选择的宿主管理；任务只读服务器，不自动部署、修复、提交或推送。

需要月初工作日补跑时，由宿主周一至周五检查，run 加 `--once-per-month --time-zone <IANA时区>`；当月已有完整快照返回 `already-current-month`，同样安静结束。该策略按平日和可用电脑执行，不声称覆盖法定调休或开机即刻触发。

## 未登记来源或指定安全组

1. 读取目标项目入口和 [菜单同步契约](../../references/menu-knowledge-sync.md)。从现有 workspace resolver 取得 ContextRoot/CapabilityRoot，不另建连接配置。
2. 明确同步来源别名与范围：全部或用户指定安全组。已有项目约定直接复用；同名组通过实际 ID 区分。未指定范围时默认刷新已登记的安全组，首次同步默认完整采集。来源别名不得包含连接信息。
3. 使用现有原生 IRIS MCP 获取数据；先核对可用工具 schema 和目标类源码/签名。没有原生工具时复用 CapabilityRoot/scripts/iris-mcp.js。不要猜测参数名、SQL 字段或返回封装。
4. 目标存在 `DHCDoc.Common.Menu.getGroupData(groupId)` 时可复用；先确认当前部署源码只读取菜单。此方法调用仍遵循项目远端执行授权，不把 helper 的 `--allow-write` 当授权。用户已明确要求当前环境菜单同步且范围覆盖读取时，不重复确认。缺少方法时报告，不自动部署服务或改用任意代码执行。
5. 全量采集分别读取安全组、菜单总表及每个安全组的菜单树。检查 SQL 分页、截断、所有组完成情况；接口示例见参考。方法返回空数组也可能表示组设置缺失，需核对组设置后才能认定为合法空菜单。任何失败都停止，不产出 `complete: true`。
6. 将完整结果规范化为参考中的输入 JSON，写入任务临时目录。执行 sync-menu.js plan；核对删除和空结果，再用返回的 revision/inputHash 执行 apply。更新的是本地资料，无服务端写入。沿用用户本轮同步授权，不机械追加确认。
7. 从 current.json 指向的快照回读，查询一个实际菜单，报告范围、增删改数量、读取时间及未覆盖部分；清理本轮输入临时文件。历史 generation 是有意保留的项目恢复资料，不自动删除。

没有 MCP 或连接不可用时，可接受用户已有导出结果执行同一 plan/apply，但必须保留实际采集时间，不能宣称已从服务器刷新。通用菜单目录与按组权限树分开，不能用单组树冒充全量目录。
