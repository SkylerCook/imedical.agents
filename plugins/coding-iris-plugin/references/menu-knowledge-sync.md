# 菜单资料同步与知识接入

## 数据与部署归属

共享参考随既有 `/vendor/**` 分发，入口和工具随 `/plugins/**` 分发，不增加 npm 依赖。原始 Qoder 的生成器缓存不部署；其 wiki、技术文档和菜单参考经脱敏保存，来源及逐文件 hash 见 vendor/imedical-knowledge/sources.json。导入不代表内容已验证，也不新增原资料许可证。

standard 的 ContextRoot 通常为项目 `.agents`；workspace-overlay 使用 capability.json 和现有 resolver，资料从 CapabilityRoot 获取，快照仅写 ContextRoot/work/menu-sync。不得写 shared vendor、插件目录或能力包源仓。项目快照不进入 Git/公共 vendor，也不由能力包更新器清理。旧 `.agents/data` 保持原状，新读取入口使用 current.json，缺失时明确使用上游参考。

本地检索指定来源但没有 current.json 时，返回 `warnings` 中的 `project-menu-missing`（含 sourceId），继续检索共享参考；不触发菜单同步，也不将共享结果标为当前工程菜单。已有快照损坏、完整性校验失败或链接越界仍报错，不作为缺失快照降级。

## 服务端采集

复用项目现有 IRIS MCP，工具名称和入参以运行时 schema 为准。先读表结构/方法签名，再只读查询，不猜列名。已核对的产品线索是 `SQLUser.SS_Group` 的组 ID/描述、`websys.Menu` 菜单目录，以及 `DHCDoc.Common.Menu.getGroupData(groupId)` 的菜单树；这些标识是可核实的适配线索，不要求所有项目存在。

getGroupData 常见节点包含 id/text/code/lintUrl/children，适配时将 lintUrl 映射为 url；该类的 BDP 分支有预设范围，不能宣称覆盖所有 BDP 菜单。组设置不存在可能返回空数组，须确认后再接收。服务端无 ID 的虚拟节点可用父路径、code、url 的 SHA-256 派生稳定 ID，并在任务报告说明；不使用名称作文件名。

全量刷新必须完成菜单总表、安全组清单（记录停用筛选口径）以及每组菜单读取，遍历所有页且无截断。指定组刷新只替换这些组，保留其余组和原目录。用户只说“刷新”时优先沿用原快照的组范围；首次默认全量。来源别名对应一个环境和采集口径，环境或口径变化使用新别名，不能混入原快照。

## 最小输入接口

输入由 Agent 用当前 MCP 结果适配，或由已授权的离线导出提供。脚本不负责远端连接，不把 `complete` 自述当运行验证证据；Agent 负责核对实际读取记录。

```json
{
  "schema": "iris-menu-snapshot/v1",
  "sourceId": "local-reference",
  "scope": "all",
  "complete": true,
  "capturedAt": "2026-09-18T00:00:00Z",
  "catalog": [{"id":"1","text":"示例菜单","code":"demo","url":"demo.csp","parentId":""}],
  "groups": [{"id":"1","name":"示例安全组","menus":[{"id":"1","text":"示例菜单","code":"demo","url":"demo.csp","children":[]}]}]
}
```

ID 规范为字符串，仅字母、数字、下划线、连字符，不接受 Windows 保留名称；数字 ID 转字符串。scope=groups 不提供 catalog，groups 非空。scope=all 必须有 catalog；空全量需核实后显式 `--allow-empty`。认证失败、缺组设置、工具报错及结果截断不能归一为空菜单。URL 可包含项目链接，因此输入和输出只留目标工程，回复不打印环境地址。

```text
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/sync-menu.js plan --project-root <WorkspaceRoot> --input <input.json>
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/sync-menu.js apply --project-root <WorkspaceRoot> --input <input.json> --expect-hash <revision> --expect-input <inputHash>
node <CapabilityRoot>/plugins/coding-iris-plugin/scripts/iris-tools/query-knowledge.js --project-root <WorkspaceRoot> --source-id local-reference --query 示例菜单
```

plan 不写文件；apply 校验输入和当前快照指纹，独占锁避免并发覆盖。完整 generation 写入成功后原子替换 current.json，失败保留旧指针；不会先删除旧快照。每个 generation 保存 snapshot.json、Menu.md、Group.md、group-menu/<ID>.md。保留历史 generation 用于恢复，读取只跟随 current.json，禁止递归搜索所有历史当作当前菜单。无变化的同一输入幂等；新采集时间会生成新验证快照，即使菜单差异为空。

新增、删除、改名、链接、父子移动、顺序变化均进入差异。部分刷新保留未刷组原 capturedAt；只有全量刷新才更新时间 catalogCapturedAt。并发遗留锁需要先确认没有运行中的同步，再人工移除精确 `.lock`，不自动抢锁。跨采集的服务器变更可能导致时间窗口不一致，必要时重采；不声称具有服务端事务快照。
