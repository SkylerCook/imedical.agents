# IRIS 项目按需导出开发协议

## 触发与入口

先从当前 ContextRoot 的 `config/iris-development.json` 读取 `developmentMode`，缺省沿旧 `connected` 行为。`offline` 优先进入[离线开发协议](iris-offline-development.md)，不执行本文的服务器同步、资格、冻结发布或远端验收，也不读取医院连接。只有 `connected` 才继续下表；它不产生任何远端授权。开发方式、需求类型和上下文完整性分别判断，不能由缺少连接自动降级为离线。

先按当前用户指定的需求类型，其次按项目已确认的“默认需求交付类型”选择分支。`standard`／`project` 是需求类型，`contextMode` 是源码上下文模式，`taskKind` 是业务／框架任务分类，执行路径与操作授权另行判断，彼此不能推导。

| 已确认条件 | 处理分支 |
|---|---|
| `project` ＋ `intent-first-on-demand-export` ＋ coding 插件启用 | 执行本协议的服务器基线、独立本地 Git、需求重放与发布链路。 |
| `standard` | 沿既有标版编码、需求提交与交付规则；不因按需获取代码而自动转为项目需求或自动创建 export。远端通道的公共资源保护仍适用。 |
| 类型缺失／TODO／冲突 | 可本地调查与形成范围计划；项目提交与移植前明确类型，不按目录、环境、remote 或代码量猜测。 |

公共的字节检查、Git 现场保护、连接生命周期和适用发布保护共用实现；skill、rule、agent 只在分支条件成立时加载项目协议，不另造同内容的标版／项目副本。`source-sync plan` 用 `--kind project` 接收本次明确类型，或读取当前 IRIS／迁移交付 profile 的合法默认值；`init` 只初始化本地 Git，不改变需求类型。`iris-change-agent` 与通用角色传递已确认类型及来源，并沿同一分支，不把 workflow 名称中的 standard 当成标版类型。

少量本地文件只代表已取得的上下文，不代表完整工程。项目分支下本协议优先于其它入口的默认 direct 描述；未命中项目分支的工程沿既有流程。

日常默认在测试环境开发；明确授权时也允许正式环境直接开发。两者分别使用自己的本地 Git 仓库和非敏感环境别名，不共用基线。DEV→PRD 移植是可选路径，项目需求开发不必经过移植。远端读取、本地提交、部署、数据库写入及 push 分别核对当前有效授权；协议和配置本身不产生授权。

先读取项目 `AGENTS.md`、上下文与 IRIS profile、插件启用状态，解析工作区的 `WorkspaceRoot`、`ContextRoot`、`SourceRoot`、`GitRoot`，再定位需求入口。配置、恢复状态归当前 ContextRoot，源码归声明的 SourceRoot；不得扫描父目录猜测其它环境或写共享 CapabilityRoot。

## 首次接入

已启用项目普通 Write 更新会通过既有配置迁移自动补缺文件，保留已有字节及旧模式缺省；模式/环境待确认与资格 pending 由 Agent 集中处理。自动补文件不建立基线，已有项目无需为补文件重跑全部初始化，下面继续完成真实环境与资格接入。

1. 核对测试/正式各自的本地 Git。无仓库时先获得初始化授权，再使用 `source-sync.js init`；不把初始化或阶段提交权限推导为任意后续提交权限。
2. 按 [coding-iris-init 的本地配置步骤](../skills/coding-iris-init/SKILL.md#本地配置初始化与已有项目补齐)执行 `source-sync.js configure`，默认创建被忽略的 `ContextRoot/config/iris-development.json`，声明已确认的开发方式、`environmentAlias` 与 `environmentType`（`test`、`development` 或 `production`）并 Check。已有文件保留，缺字段由 Agent 按明确事实局部补齐；不能套用示例环境代替真实声明。连接事实继续由项目已有 `.mcp.json` 与 `project-env.json` 承载，冲突停止，不在新配置复制连接或凭据。
3. 同一步骤从 `templates/iris-remote-policy.template.json` 创建缺失的私有远端准入配置，保持禁用及资格 pending。先在获授权窗口以最小批次验证，再登记真实资格证据并启用。配置生成与资格就绪分别报告；未验证状态不能用于连接，新模式缺失、禁用或不合格配置停止。
4. 将 `ContextRoot/work/source-sync/`、准入协调目录、私有配置及资格证据保持 Git 忽略。`work/source-sync/` 由实际同步任务创建，初始化无此目录不代表漏配，建空目录也不能证明基线成立。它保存计划、内容快照、索引/HEAD 归属与恢复断点，不作为业务交付目录。首次 XML 批量基线须先验证持久落盘、读回与中断恢复，确认 License 增量与结束回落后才扩大批次。

Node.js 是 Agent 工具链依赖，不是 HIS 生产运行依赖。当前工具链版本及平台验证沿能力包更新说明，不以本机测试宣称所有平台或旧 Caché 版本已支持。

## 按需求确定读取范围

- 必须刷新准备修改的文件 W，即使本地已有也不能据此认定最新。无可信服务器基线时先核对服务器并保存现场，再处理差异。
- 对直接影响入参、返回、数据结构、调用方式的关键上下游，按本次改动判断是否需要服务器核实。通用依赖优先使用本地参考；不递归全链刷新，不按文件数量猜测安全批量。
- MCP 只读补齐需求链路上本地缺失且确有需要的源码或元数据。修改对象进入受控导出流程，不用 MCP/SQL 换路绕过 License 准入或覆盖源码。
- XML 是明确范围的导出清单，不是可信版本证明。首次全量可以作为受控基线窗口，日常只刷新需求相关集合；mtime、Atelier ts、HTTP 条件请求只能辅助筛选，最终基线以实际内容摘要为准。不得假设旧版本具有 changed-since 或 XML 批量接口。

## 修改前与部署前同步

使用 `scripts/iris-tools/source-sync.js --help` 获取当前命令参数。`plan` 只做本地范围与现场检查；`prepare` 在准入后读取服务器并持久保存快照；`apply`/`continue` 仅在有效本地提交授权下执行导出、合并和提交。计划绑定工程、真实 GitRoot、环境、配置指纹、文件集合及原现场；不手改计划或绕过阻断。

修改前对全部准备修改的文件执行 `before-edit`，无论本地已存在还是尚未导出：先 `plan` 保存现场和准确范围，再 `prepare` 导出服务器当前内容并比较，最后在有效本地提交授权下 `apply`。有服务器变化或首次纳入基线时，先完成独立 export 提交；无变化时确认同步完成，不建空提交。只有该同步完成后才开始本次需求修改；范围中新加入的修改对象也先完成同样的同步。缺少必要读取或提交授权时，保留计划与快照并说明缺口，等待授权后接续。

部署前必须再用 `pre-deploy` 重新核对服务器。先保存本地修改及索引现场，服务器发生变化时先同步服务器层，再恢复/合并需求层。本地已有未提交修改沿三方合并保护；没有可信基线且本地与服务器不同，先确认基线归属。冲突停止，由 Agent 比较基线、本地需求与服务器内容，保留双方语义；不整文件选择一方消除冲突。

有服务器内容变化或需要首次纳入本地基线时，创建独立 export 提交，格式为 `export(<已核对的目标标识>):从服务器同步最新文件`。示例不写真实地址；运行时目标来自项目私有配置。无变化不建 export 提交，也不创建空提交。需求提交使用项目约定的 Conventional Commits，并有 `修改说明:` 正文。

普通 `export.js` 的 probe／独立 staging 和 MCP 读取只补只读参考，不代表待修改文件已建立基线。项目按需分支下 `export.js` 直接写源码会在请求前停止并指向 source-sync；从 MCP 取得的待修改对象也进入上述 before-edit 链路。

需求已提交后发现服务器漂移，保留旧需求提交，再追加 export → 合并后的新需求提交；不重写历史、不把服务器变化归入需求提交。测试与正式各自独立记录本地 Git，回滚仅处理本计划明确归属的本地现场或追加补偿，不 rewind 其它提交；不自动回滚服务器。恢复、收尾与本地回滚命令以 CLI 帮助及计划状态为准，未知结果先核实归属再接续。

同一文件含多个已提交且未部署的需求时，按各自已确认基线之后的来源顺序逐层重放，每层保留原需求标题与 `Replay-Of`，最后才提交当前未提交增量。不能把它们聚合成当前需求号的一笔提交。无法归属需求号、合并提交或来源链异常先停止；逐层冲突在私有 `replayConflict.resolutionPath` 复核解决，源码与 index 在预检通过前保持原状。删除冲突需核实后在 `continue` 明确传 `--resolve-delete <logical-path>`；删除的远端发布需另有受支持策略，不能用文件缺失绕过发布核验。

本地恢复入口：

| 命令 | 范围与前置 |
|---|---|
| `status --plan <plan.json>` | 读当前计划及本地仓库锁 token，不连接服务器。 |
| `continue --plan <plan.json> --confirm-commit` | 核实计划归属及现场后，接续中断的本地分层提交。 |
| `rollback-plan --project-root <workspace> --demand <id> --to <commit> --files <paths...>` | 只计划指定文件恢复到明确本地提交，不读写服务器。 |
| `rollback-local --plan <plan.json> --confirm-commit` | 在有效提交授权下追加本地恢复提交；中断接续使用 `--continue`，重新发布必须新建同步计划。 |
| `recover-lock --plan <plan.json> --confirm-recovery --token <token> --evidence <file>` | 只在原 owner 已退出、token 未变且证据存在时解除该计划的本地仓库锁；不清除远端熔断。 |

上表命令均由 `source-sync.js` 执行。确认标志只是 CLI 接收已取得授权的入口，Agent 仍须核对当前任务的有效授权，不把标志本身作为用户批准。

本流程不要求每次需求全量刷新服务器。没有取得读取资格、License 状态不明或来源链不可信时，可继续本地调查与范围计划，但不能把旧快照报告为当前服务器基线；待修改对象仍须完成上述 before-edit 后才能开始需求修改。

## 可选 DEV→PRD 移植的重放复核

普通项目开发沿上述 source-sync；跨环境移植才读取 `iris-demand-promote`。可证明等价的需求补丁仍由 CLI 去重；非等价 `Replay-Of` 或同需求同文件跨 export 时，plan 在任何远端读取前停止，并在当前 ContextRoot 的 `work/source-sync/promotions/` 私有任务目录落 `source-review-candidates.json`，输出路径和 token。

移植沿现有 DEV／PRD 各单一 Git root 与 `src/` 映射；不宣称已提供跨仓编排。多个独立需求按来源顺序逐笔 plan／apply，未部署共享文件的后一笔传 `--prior-plan`；只有源提交本身声明相同联合需求集时才能合并处理。多个业务 Git root 分别建立计划并组合复核。legacy v1 仅保留原本地恢复边界，原 HEAD／现场与基线资料须核验通过，不升级 schema、不重建缺失基线、不取得新版 publication 资格。

Agent 先读候选前后源码并核对服务器合并意图，取得真实语义复核结论，再写独立 review JSON；不能按提交新旧自动保留/忽略，也不手改 plan。review 沿候选复制 `devRoot`、`prdRoot`、双 HEAD、`demandIds`、`sources` 与 `token`，schema 改为 `iris-replay-review/v1`，填写非空 `evidence`。`action: keep-all` 保留全部；`action: select` 还须 `selected` 完整 hash 列表与 `omitted`，每个忽略项写 `hash`、`evidence`，并且只选 `equivalentTo` 或 `supersededBy` 之一指向保留 hash。CLI 分别核实实际 patch/内容等价，或同需求集且后代提交的替代关系；证据文字本身不绕过机器关系检查。

`supersededBy` 还必须覆盖旧提交全部文件路径；局部重放不能冒充整个原提交已经替代。无法满足时保留来源，以 `keep-all` 逐层语义合并，不能简单丢弃旧来源。通过 `promote-demand.js plan ... --source-review <private-review.json>` 重新计划，HEAD、候选或需求集变化使 token 失效。复核不授权本地 commit 或部署；后续发布继续使用同一 source review/freeze 门禁。

## 复审与发布

部署前同步完成后进入 `review-pending`，复审合并后的实际需求、导出层、Storage 和验证证据，再由 `source-sync.js review` 记录复审依据并冻结发布身份。正式复审由当前任务的用户或项目明确指定的发布批准者确认；Agent 可以准备差异和证据，不能自行代替该主体批准。旧需求批准不覆盖漂移后产生的新版本。

`review --plan <plan.json> --confirm-review --evidence <reference>` 同时接受 source-sync 与 promotion v2 计划。部署调用 `compile.js` 或 `deploy-frontend.js` 时传入 `--source-plan <reviewed-plan.json>`；正式环境另传 `--publication-decision <publish-receipt.json>`。独立 `compile-csp.js --execute` 在新模式停止，CSP 编译由已复审部署链路承接；框架内仅允许已持有受控 client 的 reviewed deployment 调用。

冻结身份包含环境/配置指纹、本地 Git HEAD 与索引摘要、准确文件集合、本地字节摘要、上传产物摘要、服务器内容摘要及 Atelier 时间戳。`iris-deploy` 使用 source plan 发布；正式环境另需绑定该冻结摘要的 publish 决定。普通覆盖、冲突恢复、License 熔断恢复与生产发布批准彼此独立，不能相互替代。

部署前仍要重新读取并核对服务器基线。HEAD、索引、文件、配置、目标集合或服务器内容发生变化就停止；重新同步、合并、验证和复审后生成新冻结版本。前端优先复用已确认支持的 Atelier Web doc；SFTP 仅为项目明确选择的 fallback，失败不自动换通道。

后端 `localSha256` 对应本地原字节，`artifactSha256` 对应实际规范化 UTF-8 上传产物（去 BOM、CRLF 转 LF）；Atelier 文本回读摘要对应返回行重组后的 UTF-8 表示，不是服务器磁盘字节。前端按上传及回读产物精确比较；服务器发生 BOM/换行转换时不能宣称字节一致。Atelier 时间戳条件上传提供服务端支持的并发检查，本地 hash 复核不等于服务器 SHA CAS。

提交同样核实 Git clean filters：后端仅允许上述规范化等价；前端若 `core.autocrlf`／filter 会改变原字节，停止为 `git-source-filter-conflict`，不提交一个无法原字节恢复的基线。按目标项目字节约定复核，必要时获准为明确文件配置本地 `info/attributes`（如 `-text`）后重新计划；工具不自动修改全局 Git 或重编码源码。

编译后单列核对 Storage；本地回填或待回填建议按[部署保护](deployment-protection.md#编译后-storage-同步)处理。冻结源码发生变化须复审，不能继续沿用旧批准。整批所有分组完成后再最终回读全部发布文件，hash 不符、Storage 未完成或资源退出无证据均不能报告 verified。上传、编译、回读、业务验收分别报告；批次不保证远端事务性。

进入 `post-compile-review` 后，核对实际 Storage diff 与回执，再使用 `finish --plan <plan.json> --confirm-review --confirm-commit --evidence <reference>`；它重新读回已部署文件，只提交已核验的本地 Storage，不再次部署。中断接续使用 `--continue`；若还有未发布分组，按结果 `requiresNewPlan` 重新同步复审，不能沿用旧冻结身份继续发布。

## License 准入与资源收尾

准入公共实现为能力包根 `scripts/lib/iris-remote-operations.js`，Atelier 会话复用由 `scripts/lib/atelier-client.js` 负责。私有配置 `ContextRoot/config/iris-remote-policy.json` 使用同一实例或**已确认共享许可池**的 `poolKey`、同一可达的本地 `coordinationRoot`。已确认跨实例共享时才显式设置 `allowSharedPool`；不同目录、不同机器或未接入工具不会自动协调。不是全局 License 预留服务，也不能机械拦截外部 IDE 或原生 MCP。

`maxConcurrent` 固定为 1，整段操作跨进程排他。源码获取可使用 `scripts/lib/atelier-read-pool.js` 在同一个 owner 内运行已验证预算的只读会话池；写入与编译仍串行。该池先在同 Cookie 上读取一次根 serverInfo，再核对资格的实例、namespace/API 路径、版本、配置和运行时指纹。无多会话资格使用已获基础资格的单会话，缺少基础策略则在请求前停止。完整字段与试验入口见[代码基线协议](iris-code-baseline.md)。

直接 Atelier 读取的 503 重试为 0；发现 503 时先持久化熔断及在途集合、停止新派发，再收束并关闭各自会话。一次 Atelier 生命周期复用 Cookie 与 keepalive，但不承诺占用固定 LU；会话数与实际 License 单元分别取证。不能仅凭 503 断言一定是 License，也不逐文件或换通道重试。数据库写入与 Atelier 的历史打满是两类观察，不假定同根因。MCP 或终端执行的内部传输行为按对应通道资格单独判断，不能用外层零重试推导 vendor 内部也没有重试。

准入须覆盖当前需求会使用的受管读取、上传编译、Broker/数据库调用与测试入口。已接入主链是 source-sync/promote/deploy、共享 Atelier client、受控 Broker 及根 `scripts/iris-mcp.js` 的公共 `tools/call`。其它插件自己的客户端、原生 MCP、SQL 工具和外部 IDE 是明确外部边界，使用前须核实其准入与退出资格；不能把共享库存在说成全部入口已受控。新模式不使用交互 legacy debugger 旁路。

Atelier 只关闭自己取得的 Cookie 会话，并返回 logout 请求/响应证据；keepalive 连接关闭不等于服务器 License 已释放。受控 Broker 需调用者提供已有 Cookie 和 `sessionOwnerReference`，会话创建与退出归该调用者，不隐式新建无主会话。根 MCP helper 需要 `qualification.channels.mcp.processExitVerified: true` 及真实退出资格证据，结束时核对自己启动的子进程退出；进程退出也不等于数据库连接或 License 已回落。其它通道同样按实际 CSP session / DB connection 所有者收尾。

会话设计参考 [VS Code ObjectScript 的 Atelier API](https://github.com/intersystems-community/vscode-objectscript/blob/master/src/api/index.ts)（2026-10-24 核对）：取得 Cookie 后不继续发送 Basic Authorization，注销使用路径前缀下 `/api/atelier/?CacheLogout=end`，不附 v1/namespace。只参考生命周期设计，未复制代码或引入其运行时；本地 mock 精确核对请求，目标服务器的退出与 License 回落仍需真实资格证据。

`qualification.status: verified` 和存在的 `qualification.reference` 只是本地证据门禁，不自动证明真实 License 安全。证据至少区分通道、最小范围、前后占用、会话/连接归属、结束回落、异常和观察时间；验证只对该目标/版本/通道/范围有效。150–200 文件不是通用安全阈值，不能据一次客户端观察推广 VS Code Export 的 License 收益。资格未完成前保持禁用，不先批量试错。

首次资格窗口通过 `code-baseline qualify` 接收明确目标、准确名单、会话数和时限预算，沿同一个锁执行受限读取；客户端仅允许该名单及一次 serverInfo 探测。回执维持 pending，资源观测和审核完成后才登记 verified。日常批次验证各自会话退出并引用资格，不因 `licenseReleaseVerified:false` 自动变为 unknown，也不宣称每批都实测了 LU 回落。

写入超时、断连或结果不明保留 `failed-or-unknown` 与原始断点，不能自动重放。先使用根 `scripts/iris-remote.js status --project-root <workspace>` 读取本地状态/token。核实原 owner 已退出后，可以显式执行 `inspect`（别名 `read`）进行受管恢复读取：

```text
node .agents/scripts/iris-remote.js inspect --project-root <workspace> --token <status-token> --confirm-recovery --documents <1-to-5-documents...> --evidence <new-absolute-private-file>
```

证据新文件必须位于当前 `ContextRoot/work/source-sync/` 内，保持 Git 忽略。此入口仍要求有效私有准入资格，校验原 token、阻断状态及 owner 退出，取得同池排他锁后，只对声明的 1–5 个文档各执行一次 GET；不允许 POST docs、PUT、compile、额外目标或普通 client 的恢复 flag。已确认死亡的中断 owner 记录保存在恢复证据中；未核实、仍活跃或其它机器 owner 均停止。进程中断残留的原写操作继续保持待核实，不能因可读而清除。

读取期间持锁并复用本人 Cookie，退出只执行本人会话的 HEAD logout；再次 503 或读取失败立即停止，不重试其它文件。结果始终保留原 circuit/unknown 及 pending write，追加 inspection 记录并产生新状态 token，不开放写入。API/CLI 摘要 schema 为 `iris-remote-inspection/v1`，私有落盘证据为 `iris-remote-inspection-evidence/v1`，包含文档内容的 base64、hash/ts/表示和退出回执；stdout 只有摘要和证据路径，不输出源码正文。

核实结果后，以**新的**状态 token、证据文件和明确确认调用本地 `reconcile`；未知写还须明确 `verified-applied` 或 `verified-not-applied`。`status/reconcile` 本身不连接服务器、不重放写入、不自动清除活 owner。文档读取成功不证明 License 已回落，也不自动判定编译、数据库写入或业务副作用是否完成；这些仍按原操作取得对应核实证据。本地解除阻断也不是远端恢复的证明。

## 完成与验证边界

交付说明当前基线时间与范围、export/需求提交、冻结身份、复审主体/依据、上传编译及最终回读、Storage、业务验证、会话/连接退出与未知项。只读/本地 mock 通过不能替代目标环境资格、旧 Caché 兼容或跨平台实跑。普通本地修改完成仍按项目需求验收与提交 owner 收尾，不新增提交权限或重复审批。
