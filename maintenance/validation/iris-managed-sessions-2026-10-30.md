# IRIS 统一会话候选验证

状态：0.25.0 验证分支候选，未发布或升级业务副本。

- Windows / Node 24.14.1：`iris-session-{manager,ipc,routing,migration,vendor}.tests.js` 与既有 MCP schema/session、remote-operations、atelier-read-pool 共 58 项通过。
- Windows PowerShell 5.1：现有 `scripts/tests/update-agents.tests.ps1` 全套通过；定向迁移测试确认受管 command 保留、旧明确禁用保留、回退 drift 拦截、生成器保留其它服务、真实 Node 后端跨客户端复用及通知不串路由。
- 固定 vendor 补丁已构建并纳入候选。实际 HTTP 计数确认只读工具零 PUT；generator 503 只发一次 PUT；启动 503 不继续发 SystemMode 查询，队列取消；自有注销请求独立计数。完整摘要见 `vendor/iris-agentic-dev/managed-build.json`。
- 发现并修复上游隐式遥测写入：原版在普通工具调用后可能部署遥测临时类并写入 USER 的遥测 Global。受管模式关闭 durable telemetry；此前原版实验不能作为全程只读证据。真实目标资料只保存在目标工程私有验收目录，不进入共享框架。
- 文档部署链接检查及 `git diff --check` 通过。组件工作区校验未报告本轮新增版本问题；全仓历史问题仍独立存在，不宣称全仓门禁通过。

未完成：Windows/macOS/Linux × Node 22/24 CI、实际项目常规更新与回退试点、真实宿主重启及调用路径确认。CI 工作流已建立，配置存在不等于矩阵通过。用户已允许先提交并推送独立 `codex/` 验证分支以运行矩阵；通过后再发布并走项目常规更新。不得将当前记录作为最终发布或 License 普遍解决的证明。

构建工具及当前验证指纹暂保留在本任务临时目录，供发布验证和必要重建使用；失败下载、无用工具链以及含私有连接信息的测试副本已清理，后续收尾仍须清理剩余构建资产。
