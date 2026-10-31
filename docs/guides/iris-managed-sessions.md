# IRIS 统一会话接入与恢复

正常查询通过框架连接服务器。CLI、宿主 MCP 和共享 Atelier client 将操作交给同机、同一系统用户的按需管理进程；不用安装系统服务。Node.js 是 Agent 工具链依赖，不是医院业务运行依赖。最低 Node 版本沿仓库基线，实际通过的平台及版本以发布验收记录为准。

## 接入路径

- CLI：在业务工程运行 `node .agents/scripts/iris-mcp.js check|tools|call ...`。`tools` 读取固定 vendor 的本地目录，不启动医院连接。`check` 和业务调用经过管理进程。
- 原生 MCP：保留原服务名，`.mcp.json` 的 command 改为 Node，args 指向 CapabilityRoot 的 `scripts/iris-session-mcp.js --project-root <WorkspaceRoot> --server-name <原服务名>`。原 executable/args 保存在私有 ContextRoot `config/iris-session-backend.json`；连接 env 留在原位置。
- 业务脚本：复用 `createManagedMcpSession` 或 `createAtelierClient`。后者在项目已迁移时进入管理进程；显式资格试验、已有共享 owner 和借用 Broker 会话保留其原生命周期与准入约束。

Agent 先检查上述配置，再核对首次真实调用的 `_meta["imedical/session"]`；CLI 对应 `REMOTE`，含 managed、pool、generation、request、runtime。缺少回执时停止使用该入口，检查配置、重启对应宿主 MCP 并复验。不能把工具名相同、配置已写入或子进程启动成功当成接入证明。禁止另写 HTTP 脚本、直跑 vendor 或切换未受管 MCP 绕过约束。

这是受管入口的机器约束和 Agent 路由契约，不是 OS 网络沙箱。具有任意 shell 与凭据访问权的进程、外部 IDE、人工直连和其他电脑不受本管理进程控制。

## 预算与生命周期

默认每个许可池一个活动通道会话、一个在途操作，等待项 FIFO，排队最长 60 秒。WS 租约期间只有原客户端能够使用该会话；其关闭请求可以越过等待其他客户端的队列，避免死锁。命中排队超时返回 `session-queue-timeout` 和 `beforeSend:true`。请求已发出后的取消与断连不表示未执行，未知写入不重放。

CLI 退出只释放请求端；管理进程继续持有 vendor 及 Cookie。业务空闲 120 秒显式注销，空池再空闲 30 秒后管理进程退出。MCP stdio 连接存活、ping 和本地工具目录读取不续服务器会话。WS 客户端异常断开会收束自有资源并保留待恢复状态，不把租约交给别的项目。

认证身份、目标、TLS、配置文件、vendor 及通道变化会在派发前重检；旧会话结束后才建立新会话。namespace 明确校验。不同身份不会共享 Cookie；一个会话不等于一个 LU。多目标比较、服务器注册及请求级 server 覆盖未接入本轮调度，返回 `session-multi-target-not-admitted`，不得改为直连绕过。

当前用户目录 `.imedical/iris-sessions/` 存放本地 IPC 能力密钥、PID、无敏感连接字段的状态及恢复记录。Windows 使用 named pipe，Unix 使用 socket；握手校验协议、受限本地密钥和运行时摘要。IRIS 凭据及 Cookie 不写协调文件，Cookie 仅存于内存。进程异常死亡后不恢复 Cookie、不自动重放，遗留活动状态阻断下一次派发。

普通受管查询允许资格 pending。批量/多会话仍走原资格流程；已有显式 disabled、offline、熔断、写入授权、目标校验、源码同步及冻结条件继续生效。503 停止全池派发、取消未发送队列并收束自有资源。固定 vendor 的受管模式禁止 generator 自动重试，发布必须通过实际 HTTP 请求计数验证。

## 已有项目更新

### Cookie 生命周期修复候选的配置边界

Cookie 修复尚在候选验收中，不能仅更新脚本后就宣称 vendor 通道已修复。交付版本须同时包含受测 vendor、匹配摘要、会话运行时及更新检查；更新后结束旧管理进程并重启宿主 MCP，再核对实际调用回执。旧熔断和未知结果保留，更新不能自动解除。

普通查询不要求新增历史资格文件。没有 Cookie 格式配置时使用 `opaque`，仅允许完整值不变；Cookie 丢失、删除、作用域变化或身份无法确认会停止派发并进入恢复流程，不自动重新认证。相同会话的正常 Token 更新需要按目标验证其格式。

已针对目标服务器验证固定身份布局后，才可在私有 `ContextRoot/config/iris-remote-policy.json` 设置 `sessionCookieFormat: "csp50-v1"`，并将 `sessionCookieFormatInstance` 绑定为框架 `instanceIdentity(connection)` 生成的目标摘要。该摘要只防止将格式配置误用于另一目标，不代表验证证据本身；保留现场版本与会话对照记录。服务器或网关升级后需重新核验，未知格式不可根据长度猜测。更新器保留已有配置，不自动启用此兼容选项。

格式配置变化纳入会话身份，旧会话结束后才应用新值。无效配置在连接前停止，本地状态检查与恢复入口仍可用。发生 `session-identity-unverified` 时，注销 HTTP 回执不能解除身份异常；必须核实自有会话是否消失，未知写入另行核实，禁止重放。

沿[现有更新流程](../update-agents.md)执行 DryRun → Write → Check。更新只读写本地文件。coding 插件的 `iris-managed-session-v1` 在开发配置补缺前运行：可识别的框架 vendor 配置自动迁移；已有策略逐值保留，没有策略才生成受管单会话默认值。服务名、env、disabled、其他 MCP 服务保留，自定义 command/args 返回待适配原因，不强行改写。仍直连时 Check 不通过。

standard 直接正常更新；Overlay 先更新 CapabilityRoot，再刷新各 ContextRoot。不能复制源仓根 AGENTS 或维护者记忆到业务工程。更新后重启受影响宿主的 MCP，实际执行有界常量查询，检查回执及 `sessions`。共享宿主可能缓存旧 command，配置检查不能替代此步骤。

定向检查和回退（从工程根执行）：

```powershell
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/session-migration.js --project-root . --mode Check
node .agents/scripts/iris-remote.js sessions --project-root .
node .agents/scripts/iris-remote.js close-sessions --project-root .
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/session-migration.js --project-root . --mode Rollback
```

回退前先结束本任务会话。活动租约、运行项或未知状态阻止回退，不终止其他客户端。仅恢复迁移修改的 command/args，并核对迁移后用户是否改动；env、其他服务和恢复资料保留。回退后失去原生 MCP 的统一会话保障，必须明确告知，不能继续报告已受管。

## 状态与恢复

`iris-remote status` 查看公共准入状态；`sessions` 查看管理进程、活动数、队列、租约、generation、退出回执和阻断原因。二者本地执行，不因 offline 或资格 pending 禁止检查。

503、异常退出或未知写入后，先依既有 `inspect/reconcile` 核实自有资源和实际结果；不得自动清锁、清 Cookie 或重试写入。公共准入状态解除后，再用 `sessions` 的当前 reconciliationToken、本地证据文件与明确确认调用：

```powershell
node .agents/scripts/iris-remote.js reconcile-session --project-root . --token <当前token> --evidence <绝对证据路径> --confirm --write-outcome verified-not-applied
```

证据 JSON 的 `cleanupVerified:true` 必须来自实际核实；未知写入还须选择 `verified-applied` 或 `verified-not-applied`。工具保存证据摘要与原状态，不重新执行原请求。没有证据继续阻断，用户说“继续”不是清理成功证明。

收尾分别报告：请求结果、进程退出、HTTP 注销回执、服务器会话消失、License 观测。`cleanupVerified` 仅描述当前客户端可验证的资源收束，不等于服务器会话消失或许可回落；对应后两项仍分别标记。借用 Browser/Broker 会话归原 owner，框架不擅自注销。
