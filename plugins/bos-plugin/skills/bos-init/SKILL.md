---
name: bos-init
description: 初始化 BOS 本机私有配置，或为明确接入请求的项目启用 bos-plugin 并生成查询与处理入口。
---

# BOS 接入

首次接入直接读取本文件，不依赖尚未生成的 thin-index。

先区分个人初始化与项目接入。Windows 个人初始化按 [配置说明](../../references/usage.md)执行 init-config（无参数时优先复用进程或用户环境中的 BOS_MCP_CONFIG，否则采用 LOCALAPPDATA 标准目录）；自动创建或复用私有配置并绑定用户环境，向用户展示并打开返回的 configPath，用户补全 TODO。为当前验证命令注入已绑定路径和用户级地址；持久变量供重启后的客户端继承。现有有效文件保留；用户明确迁移时使用 migrate-config。完成标准是文件生成/复用、环境变量回读一致，并按配置说明在凭据填写后离线校验、核对身份非 TODO；真实连接验证另按授权。该请求不启用项目。项目接入按以下步骤执行。

1. 读取目标 AGENTS、plugin profile 和本插件 AGENTS/README。使用 CapabilityRoot 的 scripts/lib/workspace-context.js 解析 WorkspaceRoot、ContextRoot、CapabilityRoot；不猜父目录。已有有效配置及未知同名入口保留。
2. 检查 Node.js >=22.5.0。查询采用显式私有配置或环境变量，见 [使用说明](../../references/usage.md)；不读取配置全文到对话、不在仓内生成可填写真实凭据的模板。缺配置只阻塞查询，已有充分正文的处理仍可进行。
3. 明确接入请求只授权本项目的 bos-plugin 启用与发现入口。按 [接入步骤](../../references/adoption.md)使用现有 update-plugin-profile 和 updater；不启用 coding-iris-plugin、不注册 MCP、不改用户级客户端目录。
4. 读取生成的 bos-demand-query / bos-demand-handle thin-index，确认引用可达，bos-init 未生成。配置可用时执行 defaults；仅在用户要求测试连接/查询或任务已授权查询时执行 check / query。
5. 报告文件生成、宿主发现及实际查询各自结果。仅生成入口不代表宿主已经加载；无法核实的宿主发现标为待验收。

用户明确要求客户端原生 MCP 工具时，读取 [客户端注册](../../references/client-mcp.md)，核对目标宿主后增量接入；普通初始化不隐含该操作。
