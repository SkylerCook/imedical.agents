# IRIS 统一会话发布与试点验证

状态（2026-10-31）：coding-iris-plugin 0.25.0 已随 `b54edea` 发布到 Gitee 主线；授权的 standard / Overlay 试点已正常升级。License 归属变化仍有观察限制，不批量推广或宣称 License 问题已普遍解决。

候选 `2b4a69d` 首轮 [CI](https://github.com/SkylerCook/imedical.agents/actions/runs/41085026686) 暴露 macOS 临时路径下 Unix socket 名称过长；修正为短名称并在创建锁前校验 UTF-8 字节长度，启动监听失败清除自有锁。矩阵关闭 fail-fast，避免取消其它平台。offline 仍禁止远端调用；旧测试将纯本地 reconcile 也视为远端的断言已按新契约修正。

全仓其它 CI 不能宣称通过：例如 [基线技能迁移](https://github.com/SkylerCook/imedical.agents/actions/runs/41084978127) 在本轮改动前的 `93d775c` 已因夹具缺失 docs/README.md、imedical-ui 初始化断言失败；候选出现相同问题，保留为独立历史缺口。其余失败继续按日志逐项区分。

`f8e252d` 的六组矩阵通过后，补齐 Overlay 映射 vendor 的真实路径识别，以及相同已校验 vendor 在不同项目副本间按摘要复用、不同凭据隔离。最终 `b54edea` 的 [Windows/macOS/Linux × Node 22/24 六组矩阵](https://github.com/SkylerCook/imedical.agents/actions/runs/41086773751) 全部通过。实际补丁 vendor 计数仅在 Windows 执行；其它平台验证管理层和模拟后端，不代表已交付其它平台 vendor 二进制。

- Windows / Node 24.14.1：`iris-session-{manager,ipc,routing,migration,vendor}.tests.js` 与既有 MCP schema/session、remote-operations、atelier-read-pool 共 58 项通过。
- Windows PowerShell 5.1：现有 `scripts/tests/update-agents.tests.ps1` 全套通过；定向迁移测试确认受管 command 保留、旧明确禁用保留、回退 drift 拦截、生成器保留其它服务、真实 Node 后端跨客户端复用及通知不串路由。
- 固定 vendor 补丁已构建并纳入候选。实际 HTTP 计数确认只读工具零 PUT；generator 503 只发一次 PUT；启动 503 不继续发 SystemMode 查询，队列取消；自有注销请求独立计数。完整摘要见 `vendor/iris-agentic-dev/managed-build.json`。
- 发现并修复上游隐式遥测写入：原版在普通工具调用后可能部署遥测临时类并写入 USER 的遥测 Global。受管模式关闭 durable telemetry；此前原版实验不能作为全程只读证据。真实目标资料只保存在目标工程私有验收目录，不进入共享框架。
- 文档部署链接检查及 `git diff --check` 通过。组件工作区校验未报告本轮新增版本问题；全仓历史问题仍独立存在，不宣称全仓门禁通过。

试点按已部署入口完成 DryRun → Write → Check，Overlay 复用共享 CapabilityRoot。定向回退只恢复 command/args，Check 随即识别直连；再次正常更新恢复受管入口。旧 vendor 被真实宿主占用导致首次拉取失败，逐文件核对候选内容后恢复本次半更新，用户从宿主停止服务后重跑成功；未终止其他进程或清除旧恢复资料。私有配置缺少忽略项时先停止，补充确切本机排除项后继续；用户原文件保留。Check 的既有环境声明待确认提示保持，不伪造环境信息。

升级后两个项目的真实 CLI 查询共用受管后端。真实 CodeBuddy 原生工具调用返回常量结果，用户截图与本机“宿主 → stdio 适配器 → 管理进程 → vendor”进程链、对应请求计数交叉核对；宿主未展示 `_meta`，不将其误报为回执为空。显式关闭后后端正常退出并有独立注销回执。真实服务器会话集合与 License 观测、调用量、时间及限制仅保存在目标工程私有验收目录。

另以自建客户端完成一条常量查询后强制退出该客户端，管理进程没有重放请求；按默认空闲策略回收后端并取得注销回执。随后管理进程自动退出，真实宿主的 stdio 适配器仍存活，确认宿主连接不延长业务会话。此段仅核验本机进程与注销，不以它替代前一段独立服务器会话集合观测。

[关联保护矩阵](https://github.com/SkylerCook/imedical.agents/actions/runs/41086773787) 的非 Windows 组通过，Windows 在既有 XML vendor `saxes/saxes.js` 摘要检查失败，其它 Windows 组被联动取消；相关 XML 资产和断言不在本次差异内。连同上述历史工作流缺口，不将专项通过表述成全仓 CI 全绿。

便携 Rust / LLVM、上游构建目录及下载资产已清理；补丁、许可证、构建命令和产物摘要在 vendor 中保留。普通 MCP 存活不会作为业务保活；管理层之外的人工/外部 IDE 任意直连仍不在本轮强制边界内。
