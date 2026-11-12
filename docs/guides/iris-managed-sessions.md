# IRIS 统一会话接入与恢复


恢复先执行 `iris-remote.js status --project-root <workspace>`，输出的 `poolId` 对应当前配置的持久记录文件名。该值由共享管理器对逻辑 pool 的 JSON 表示计算，直接使用回执，无需手工对字符串再做 SHA-256。`reconcile-session` 先核对当前 pool，再检查 evidence 路径及内容，目标不匹配返回 `session-reconciliation-pool-not-found`。host 重启后仍加载已有待核实写记录；按原核实流程提交退出与写结果证据后恢复，保留历史记录。语法/运行时错误可能发生于部分写入之后，自动放行继续依据明确未派发、拒绝或已验证结果。

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

当前用户目录 `.imedical/iris-sessions/` 存放本地 IPC 能力密钥、PID、无敏感连接字段的状态及恢复记录。Windows 使用 named pipe，Unix 使用 socket；握手校验协议、受限本地密钥和运行时摘要。IRIS 凭据及 Cookie 不写协调文件，Cookie 仅存于内存。进程异常死亡后不恢复 Cookie、不自动重放。遗留写入按原始影响范围保留；旧记录没有范围时保守保护该实例的写入，只读诊断仍可执行。确有本地活资源或无法确认旧进程已退出时，先核实资源，不并发新开会话。

普通查询、上传及编译不要求 License 资格登记、历史退出证明或证据文件；旧 qualification 缺失、pending 或引用失效均不影响普通串行操作。新迁移不再生成该登记字段；已有工程正常 Write 更新自动清理废弃字段及空模板登记，实际连接、导出证据和私有扩展保留。大量 SQL 插入、读取、写入复用同一连接并串行执行，由工具处理退出和故障收束，不能通过反复创建连接放大占用；不为普通 SQL 增加登记手续。既有大批量文件导出与多会话流程保持；已有显式 disabled、offline、熔断、写入授权、目标校验、源码同步及冻结条件继续生效。503 使当前操作失败并收束自有资源，5 秒冷却内拒绝新派发；冷却后允许新的独立请求探测，原请求不自动重放。已发出的未知写继续保留冲突保护。固定 vendor 的受管模式禁止 generator 自动重试，发布必须通过实际 HTTP 请求计数验证。

## 已有项目更新

### Cookie 生命周期修复的配置边界

HTTPS 证书校验沿用项目显式连接配置：默认关闭，项目显式 true 时开启；项目明确设置 `tlsVerify=false` 时公共准入不再额外拒绝。按需模式仍要求 HTTPS，证书校验参数仍纳入会话身份与派发重检。缺少受信证书与 License 资格是不同问题，不把 TLS 配置改写成 License 登记要求。

Cookie 修复必须整包更新，不能仅更新脚本后就宣称 vendor 通道已修复。交付版本同时包含受测 vendor、匹配摘要、会话运行时及更新检查；更新后结束旧管理进程并重启宿主 MCP，再核对实际调用回执。旧熔断和未知结果保留，更新不能自动解除。

普通调用不要求 Cookie 格式登记。同名、同域、同路径的 Set-Cookie 更新沿 [RFC 6265](https://www.rfc-editor.org/rfc/rfc6265#section-4.1.2)替换旧值，后续请求和注销使用最新 Cookie，不重新发送 Basic 认证。Cookie 值不用于推断服务器会话身份或 License 数；保留目标/账号隔离、作用域、删除/过期检查、401/403 停止及禁止自动重放。真正会话丢失时退役当前连接，未知写继续按实际影响范围保护。

正常更新同时取得 managed-sessions-v3 vendor、匹配摘要和运行时；v2 不能与新运行时混装。原有 sessionCookieFormat/sessionCookieFormatInstance 已废弃，现有配置迁移在 Write 时自动删除，不需要逐目标登记格式。保留批量文件导出的预算、证据和退出协议；本次 Cookie 续期兼容不代表已测得医院 License 回落。

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

状态区分 `warning`（清理未核实但已确认本地退出）、`retryAfter`（短时服务冷却）和 `unresolvedWrites`（按目标隔离的未知写）。精确文档 PUT 只限制冲突文档；编译、测试、任意执行及范围不明的 SQL 写不能假定局部，保留对应 namespace 的写保护。跨项目、身份变化或重启不能绕过相同资源的风险；只读和可证明不冲突的写可继续。没有范围的历史未知写不自动消失。

受管 MCP/Atelier 的新增未知写只由 SessionManager 保存，使用 `reconcile-session` 恢复；公共准入保留排他，并读取同一份受管风险供独立入口判断冲突，不再重复登记；历史风险继续检查。独立入口仍由公共准入保存风险，使用 `reconcile`。升级前两层已有的记录保留，各自按状态返回的 id/token 核实，不自动删除或推断旧操作结果。

恢复核对死 owner、当前 token、证据和实际写结果。多个风险用可重复的 `--write-id <id>` 指定本次核实项，仅移除这些项。本地资源已关闭（`processExited:true` 或 `localResourcesClosed:true`）即可配合已核实的写入结果恢复；HTTP 注销未确认保留为警告，不要求将 `cleanupVerified` 改成 true。示例：

```powershell
node .agents/scripts/iris-remote.js reconcile-session --project-root . --token <当前token> --evidence <绝对证据路径> --confirm --write-outcome verified-not-applied --write-id <本次核实的风险id>
```

证据 JSON 中的退出字段必须来自实际核实；未知写入还须选择 `verified-applied` 或 `verified-not-applied`。工具保存证据摘要与原状态，不重新执行原请求；证据不足时只保留相关冲突保护。

普通任务收尾报告业务结果及影响继续操作的异常；连接复用、排队和清理由工具处理。License 未观测或未确认回落仅作诊断信息，不作为普通任务完成或后续操作的门禁。只有专项资源排查才分别报告进程退出、HTTP 注销、服务器会话消失和 License 观测；`cleanupVerified` 不代表后两项。借用 Browser/Broker 会话归原 owner。

coding 0.27.2 将固定 vendor 的两种执行工具在临时载体 PUT 阶段明确返回的 HTTP 405 识别为拒绝，保留原错误，不生成未知写风险。匹配工具、错误码和阶段，不将任意错误文本中的 405 视为未执行证明；超时、编译/执行中的未知结果仍保护。Cookie 异常退役会话，写风险由发送状态及响应决定，身份告警本身不另建风险。

受管恢复读取修复（coding 0.27.1）：direct SFTP 部署将当前工作区及需求类型传入 CSP 编译；显式 `inspect/read` 在 managed-single-session 且资格 pending 时只允许声明文档的 GET 和自身注销。该入口保留共享阻断、当前 token、死 owner 与写结果核实，不接受普通写入，也不自动清锁或重放。更新需同时取得 owner 及根 scripts，保留私有配置和历史恢复资料；无需迁移。

工具诊断补齐：正常测试断言失败继续返回原结果；JSON-RPC 无效参数/方法及明确 namespace 不存在的拒绝不触发未知写阻断。其它未知执行错误继续阻断，并经 IPC、原生 MCP 和 CLI --json 向原调用方保留工具响应与错误码；响应正文不写会话协调文件。共享实例仍串行执行，普通失败与仅注销未确认不再永久封锁全池；未知写按目标范围隔离，影响不明的脚本保留 namespace 写保护，只读诊断与无冲突操作继续。

### 系统 CA 与 TLS 诊断

IRIS 初始化与部署连接缺省 `tlsVerify=false`（MCP 为 `IRIS_TLS_VERIFY=false`），项目显式 `true` 仍保留。显式开启校验的 Atelier 在支持 API 的 Node 中合并默认与系统 CA；专用 CA 保持优先，不改全局信任。 Node 22.15+ 提供 `tls.getCACertificates`；较旧版本继续原有信任来源，证书错误附带 `system-ca-api-unavailable`，建议升级或使用已有专用 CA。独立 Atelier 与长驻 host 使用同一 HTTPS Agent 实现，不依赖外层 CLI 参数。系统信任变更后结束旧托管会话再使用。Rust vendor 不使用 Node CA API。

`transportCode` 经 host IPC、MCP adapter 和 CLI JSON 保留有限字符错误码，不包含原始异常、地址或凭据；HTTP 认证失败不与证书失败混同，不自动重放写入。

## Web 文档路径编码修复

Atelier 的 Web 文档 GET/PUT 保留路径分隔符，逐段编码特殊字符；批量读取、资格范围与恢复读取使用同一转换。类名仍沿单段编码。已部署工程通过正常能力包更新同步根 scripts/lib 全部关联文件，无配置迁移或旧状态清理；更新后再继续原同步计划，尚未取得服务器基线的任务须重新核实读取结果。源仓修复不代表业务副本已更新。

### 启动配置与历史警告

managed-sessions-v4 修复初始发现超出两秒时工具服务永久保留空连接的问题。服务在初次发现完成后响应初始化，连接未建立返回 session-backend-connection-unavailable，已连接但字段不符返回 session-backend-target-mismatch。失败发生在业务派发前时记录真实子进程退出回执。

warning 保留发生时间并记录 generation，回执的 historical 表示是否来自旧代；旧记录缺少 generation 时标为历史。新成功请求与关闭回执可独立判断，不把历史告警提升为普通任务准入门槛。

## 会话故障恢复更新（0.28.1）

请求发送前的会话拒绝保留 beforeSend，明确成功的工具结果在会话退出后仍保留成功状态。未知写入记录增加脱敏操作标识，MCP 错误正文保留原始工具响应，status 汇总 admission 与会话状态，reconcile-session 自动选取当前状态令牌。

远端策略 maxFrameworkSessions 默认 12，可按项目调整正整数。托管同实例请求串行复用，受管读取批次按该上限缩减 worker。服务端其他用户会话数只用于观测。

已有项目执行正常框架更新，同步共享 scripts、coding 插件和 managed-sessions-v5 vendor 后重启 MCP。缺省配置自动使用 12，已有显式配置保留。运行中的旧 MCP 需结束后加载新运行时。
