---
name: bos-init
description: 为明确请求接入 BOS 能力的项目检查运行条件、启用 bos-plugin 并生成查询与处理技能入口。
---

# BOS 接入

首次接入直接读取本文件，不依赖尚未生成的 thin-index。

1. 读取目标 AGENTS、plugin profile 和本插件 AGENTS/README。使用 CapabilityRoot 的 scripts/lib/workspace-context.js 解析 WorkspaceRoot、ContextRoot、CapabilityRoot；不猜父目录。已有有效配置及未知同名入口保留。
2. 检查 Node.js >=22.5.0。查询采用显式私有配置或环境变量，见 [使用说明](../../references/usage.md)；不读取配置全文到对话、不生成凭据模板。缺配置只阻塞查询，已有充分正文的处理仍可进行。
3. 明确接入请求只授权本项目的 bos-plugin 启用与发现入口。按 [接入步骤](../../references/adoption.md)使用现有 update-plugin-profile 和 updater；不启用 coding-iris-plugin、不注册 MCP、不改用户级客户端目录。
4. 读取生成的 bos-demand-query / bos-demand-handle thin-index，确认引用可达，bos-init 未生成。配置可用时执行 defaults；仅在用户要求测试连接/查询或任务已授权查询时执行 check / query。
5. 报告文件生成、宿主发现及实际查询各自结果。仅生成入口不代表宿主已经加载；无法核实的宿主发现标为待验收。
