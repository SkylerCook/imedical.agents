# AGENTS.md

## 适用范围

仅维护 imedical.agents 内置的 iris-agentic-dev Windows x64 受管构建；本入口不部署到业务项目。

## 事实来源

当前上游版本、固定提交、有效补丁和 exe 摘要以 [managed-build.json](managed-build.json) 为准；构建与行为契约归 [UPSTREAM.md](UPSTREAM.md)。exe 的 --version 只返回上游版本，不能代替补丁及摘要核验。

## 升级流程

1. 读取源仓维护入口、当前构建清单和上游稳定 Release。区分检查与升级授权；普通检查不下载或替换 exe。
2. 取得固定 tag/commit 源码、MIT LICENSE 及发布说明。在任务临时目录核对新行为与本地补丁的重叠，复用上游已修复的能力，只迁移仍需保留的受管差异。当前 v6 是直接应用于 v1.7.1 的单一补丁，不叠加历史 v1–v5 链。
3. 按 UPSTREAM 的 Rebuild 配方使用任务隔离工具链；不更改全局 Rust、编译器或 Cargo 配置。先校验工具摘要，再构建候选。CI 配方为仓根 .github/workflows/iris-vendor-build.yml，本地构建不能冒称 CI 来源。
4. 通过 IRIS_TEST_VENDOR_BINARY 指向候选，运行 scripts/tests/iris-session-vendor.tests.js 与 scripts/tests/iris-vendor-upgrade.tests.js。验证真实请求次数、零重试、Cookie 续期及失效、账号变化、WebSocket 复用、慢启动、退出回执和新版上传编译/拒绝行为。仅使用 localhost 夹具，不连接业务服务器。
5. 在独立原始源码上应用新补丁，按 LF 归一后与构建输入逐文件比较。通过后原子替换 exe，同步补丁摘要、二进制摘要、目标平台、工具链和真实构建来源；失败时保留原运行时。
6. 用独立断连进程捕获完整与 --no-skills 的 tools/list 快照；同步 README、owner 规则、配置兼容、维护记录和定向测试。官方 skill 更新按其独立 vendor 的选择范围及 blob SHA 校验，保留上游原文和许可证。

## 必须保留的受管契约

- 仅在 IRIS_MANAGED_NO_RETRIES=1 下启用本地补丁，保留上游非受管行为和安全门禁。
- 不自动重试 generator；禁用本地及远端持久遥测；Cookie 续期不需要格式登记。
- 失效、丢失、范围变化或身份变化停止相关发送，凭据和 Cookie 只在内存中处理；日志仅输出状态及请求计数。
- 提供 IMEDICAL_HTTP_SEND、IMEDICAL_HTTP_STOP、IMEDICAL_SESSION_STOP 与 IMEDICAL_LOGOUT 回执。HTTP 注销成功不证明服务器会话消失或 License 释放。
- 不用官方未打补丁 exe 覆盖受管构建。官方资产仅作为对照原件，必须放任务临时目录。

业务副本升级、宿主重启、真实业务验收、提交和推送分别遵守当前授权范围。源码构建成功、tools/list 或 localhost 测试不能替代真实 IRIS 验收。
