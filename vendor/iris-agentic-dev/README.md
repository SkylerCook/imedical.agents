# iris-agentic-dev

当前版本：**1.7.1 + managed-sessions-v6**。

这是 IRIS/ObjectScript 工作流的 Windows x64 受管 MCP 后端。固定上游、许可证、补丁与构建方法见 [UPSTREAM.md](UPSTREAM.md)，exe 及补丁摘要见 [managed-build.json](managed-build.json)。维护升级先读 [AGENTS.md](AGENTS.md)。

受管模式保留零自动重试、禁用持久遥测、Cookie 连续性保护、注销回执和 HTTP 发送计数。不得用官方未打补丁 exe 覆盖；统一会话入口会核对文件摘要。

## 升级与使用

上游 v1.7.1 包含参数注入、安全策略、账户会话隔离和输出捕获修复，同时改变配置可信、编译期检查和部分调用契约。详细变化见 [v1.7.0](https://github.com/intersystems-community/iris-agentic-dev/blob/v1.7.0/docs/release-notes/v1.7.0.md) 与 [v1.7.1](https://github.com/intersystems-community/iris-agentic-dev/blob/v1.7.1/docs/release-notes/v1.7.1.md) 发布说明。

业务项目沿[更新说明](../../docs/update-agents.md#iris-mcp-171)同时取得共享 scripts、coding 插件、exe 和清单，结束旧会话后重启宿主 MCP。MCP 启动命令使用 Node 会话 adapter；mcp.serverPath 仅作为内部 vendor 来源，连接与有效策略保留在目标工程私有配置中。

接口快照为 tools-no-skills.json（默认 70 项）和 tools-full.json（81 项）。它们来自断连 tools/list，不证明真实服务器行为。独立官方 skill vendor 同步 v1.7.1 的既有 8 项，继续按 optional capability 加载；不自动覆盖用户级 skill。

## 文件位置

源仓可执行文件位于 windows-x64/iris-agentic-dev.exe；业务副本位于 .agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe。运行 --version 只核实上游版本，补丁和构建身份须同时核对 managed-build.json。

本目录不保存服务器地址、namespace、账号、密码、token、TLS 实例配置或远程路径。
