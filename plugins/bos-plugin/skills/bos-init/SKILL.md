---
name: bos-init
description: 初始化或迁移按 skill 分段的 BOS 共享私有配置，或为明确接入的项目启用 bos-plugin 并生成日常入口。
---

# BOS 接入

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

首次接入直接读取本文件，不依赖尚未生成的 thin-index。

先区分个人配置和项目接入。个人配置按 [配置说明](../../references/usage.md)执行 init-config，在同一仓外文件生成 bos-demand-query 与 bos-code-update-log 两段，只绑定 BOS_MCP_CONFIG。向用户展示或打开返回的 configPath，分别填写 TODO；凭据不互相替代。旧平铺文件只在明确迁移请求时执行 migrate-config 原地转换，不在普通初始化或项目更新时改写。写入、绑定回读、当前命令注入路径和重启客户端分别确认；填写后按技能 defaults 离线核对，真实网络验证仍沿用独立授权。这些操作不启用项目。

项目接入按以下步骤执行。

1. 读取目标 AGENTS、plugin profile 和本插件 AGENTS/README。使用 CapabilityRoot 的 scripts/lib/workspace-context.js 解析 WorkspaceRoot、ContextRoot、CapabilityRoot；不猜父目录。已有有效配置及未知同名入口保留。
2. 检查 Node.js >=22.5.0。查询与日志采用 BOS_MCP_CONFIG 指向的分段私有配置，见 [使用说明](../../references/usage.md)；不读取配置全文到对话、不在仓内生成可填写真实凭据的模板。缺配置只阻塞查询，已有充分正文的处理及本地补录仍可进行；只用文本/Excel 补录不初始化个人凭据。
3. 明确接入请求只授权本项目的 bos-plugin 启用与发现入口。按 [接入步骤](../../references/adoption.md)使用现有 update-plugin-profile 和 updater；不启用 coding-iris-plugin、不注册 MCP、不改用户级客户端目录。
4. 读取生成的 bos-demand-query / bos-demand-handle / bos-demand-entry / bos-code-update-log thin-index，确认引用可达，bos-init 未生成。配置可用时分别执行所需技能 defaults；仅在用户要求测试连接/查询或任务已授权查询时执行 check / query。
5. 报告文件生成、宿主发现及实际查询各自结果。仅生成入口不代表宿主已经加载；无法核实的宿主发现标为待验收。

用户明确要求客户端原生 MCP 工具时，读取 [客户端注册](../../references/client-mcp.md)，核对目标宿主后增量接入；普通初始化不隐含该操作。
