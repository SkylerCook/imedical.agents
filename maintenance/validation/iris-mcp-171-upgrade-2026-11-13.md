# IRIS MCP v1.7.1 受管升级

## 范围与产物

源仓内置 Windows x64 后端从 v1.5.0 + managed-sessions-v5 升级至上游 v1.7.1 + managed-sessions-v6。固定提交、补丁与 exe 摘要归 [managed-build.json](../../vendor/iris-agentic-dev/managed-build.json)，构建配方及行为归 [UPSTREAM.md](../../vendor/iris-agentic-dev/UPSTREAM.md)。不包含业务副本部署、宿主连接修改或真实服务器读写；构建与专项验证在本机完成，未以远端 CI 作为发布证据。

v6 直接应用于 v1.7.1，不叠加旧补丁链。复用上游账户隔离 Cookie store、TLS 和禁止重定向实现，保留受管零重试、禁用持久遥测、Cookie 连续性、WebSocket 复用、慢启动就绪、注销回执及 HTTP 发送计数。新版入口同时识别 v5/v6，仍核对各自二进制摘要。

官方既有 8 项 ObjectScript skill 按同一固定提交逐项核对 Git blob SHA，保留原文与 MIT LICENSE；guardrails、navigation、unit-test 三项有正文变化，其余五项未变。选择范围和用户级副本边界归 [skill 来源说明](../../vendor/iris-agentic-dev-skills/UPSTREAM.md)。未新增领域 skill 或覆盖用户级副本。

coding-iris-plugin 递增至 0.31.0，并声明配置/编译契约的 breaking 变化；七个直接依赖插件只递增 patch 并扩展兼容范围。manifest 生成的 plugin catalog 已刷新。已部署项目步骤及回退归 [更新说明](../../docs/update-agents.md#iris-mcp-171)。

## 验证结果

- Rust 1.92.0 GNU 官方组件和 LLVM MinGW 20261020 MSVCRT 摘要校验后，本地隔离构建成功；不使用全局工具链。一次显式 --target 尝试使 host build scripts 缺链接库，按既有原生 GNU 配方修正后成功。上游 server_manager.rs 有未使用变量警告，未为消除警告修改源码。
- v6 在独立原始 v1.7.1 源码上应用成功；显式归一 LF 后，22 个变更文件与构建输入逐字节一致。构建来源标为本地工作区，不冒称历史 CI。提交复核将 diff 的 28 个单空格空白上下文行归为空行；固定上游两份独立源码分别应用前后补丁，22 个输出文件逐字节一致，原生 Git apply 与暂存空白检查均可通过。仓库 MSVC CI 配方已对齐，尚未执行。
- 正式 exe 的三组专项共 **30/30**：16 个真实二进制会话用例、5 个升级用例、9 个迁移/回退用例。覆盖轮换 Cookie 的连续 100 次读取、零重复认证、失败请求计数、启动失败停止发送、慢启动、过期会话发送前拒绝、WebSocket 复用、正常例程上传编译、非法 namespace、编译期执行拒绝、不可信写配置和 strict 只读；迁移包含 Overlay 与 Windows PowerShell 5.1。
- 独立凭据探针绕过旧发送计数的反例已复现并修正；它继续使用私有 Cookie，错误密码不影响主会话。本次 Windows 的 Rust Known Folders 不受 USERPROFILE 覆盖，成功编译仍写固定编辑器提示；夹具已在内存保留前值，并只在末值仍为本轮 Fixture171 时恢复或删除。专项确认原始提示存在状态恢复，本轮测试值已清除。
- 上传编译测试发现旧示例 flags 含空格被 v1.7.1 拒绝，已改用等价的 `cuk/checkuptodate=expandedonly` 并验证成功；未放宽上游门禁。
- 断连 `tools/list` 捕获并更新两个接口快照，默认 70 项、完整 81 项；工具名称集合未变。PS5.1 `iris-mcp-lookup.tests.ps1` 通过，核对 8 项 skill blob、兼容映射和 optional thin-index 行为。
- 扩展 schema、MCP 生命周期和 IPC 路由共 14 项通过。额外 CLI 用例有既有断言失败：它要求错误时 stdout 为空，而当前 helper 输出结构化 ERROR；独立 HEAD 副本复现相同失败，本轮未修改该实现或断言。
- 文档部署链接专项通过，plugin catalog 检查通过。组件版本工作区审计识别本轮八个组件变化，无本轮版本/依赖错误；全仓仍受七条既有信创问题阻断（内部 skill 独立版本及三份历史 release 缺 commit），不宣称全仓通过。

## 验收边界

上述 HTTP 服务器均仅绑定 localhost。模拟结果不证明真实 IRIS 的类/include/父类编译、账户权限、源码钩子、医院会话消失或 License 回落。业务副本、宿主加载、非 Windows/Node 版本矩阵及真实服务器验收沿既有授权和治理队列执行。未合并主分支中尚未发布的修复。

任务专属临时源码、下载件、工具链、构建缓存和夹具已在核验正式产物后删除，固定路径测试提示已复核无残留；正式补丁、清单、接口快照、来源和验证入口保留在仓库。
