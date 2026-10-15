# imedical.agents 维护日志

- 2026-10-15（近期提交回看与夜跑截止修复，framework-maintenance）：回看 e964d0e..da28585 的提交范围、维护记录和部署边界，重点核查新增夜跑派发逻辑。发现停止领新门禁将仅生成动作误判为已开始，改为复用额度门禁的工作状态/attempt 判据；补齐 night-acceptance CI 对工作区预检、共享来源指纹及会话/证据测试的路径触发。同步 README、接口说明、维护覆盖点和过时版本路由，将夜跑真实接入纳入既有 P1 排序。未修改插件目录或版本记录，无需组件递增；能力手册的入口与调用方式未变，无需改写。
  - 验证：新增截止回归在原实现失败，修复后 Windows Node 24.14.1 夜跑策略/派发/工作区/编排及 MCP schema 共 53 项通过，文档部署链接 1 项通过；暂存组件门禁与差异检查在提交前执行。沙箱目录创建/原子重命名受限后改用授权的本地隔离测试。非 Windows 矩阵和真实宿主连续夜跑仍留原队列，不以本地测试替代。
  - 同步边界：现有业务工程通过正常能力包更新取得根脚本修复，无配置迁移或旧文件清理；本轮未更新业务副本或启动业务夜跑。提交和双远端推送按本次用户明确授权执行，结果以 Git 记录为准。

- 2026-10-15（夜跑入口、工作区与额度门禁，framework-maintenance）：bos-plugin 0.8.0 增加 `bos-demand-handle --night` 技能路由，Agent 生成显式策略批次，普通需求与历史批次保持兼容。worktree 默认在业务工作区 `.worktrees/<batch>/<role>/repos/`，只读 plan/check 复用 Git/Overlay，从真实 cwd 校验项目入口、上下文、技能正文和脚本；身份错配与失效能力阻派发，正常修改和后代提交可继续。Codex 可配置真实额度快照门禁，默认20%停新领、10%仅收尾、300秒过期，其他宿主可关闭；不增加运行器/守护进程，不把额度换算成费用。
  - 验证：Windows Node 24 本轮首组35项、额度集成及真实工作区13项、BOS/既有编排74项分别通过（入口测试有重叠，不合并为独立样本数）。三平台 Node 22/24 CI 已扩展，非本机矩阵尚未运行。全仓版本审计识别 bos-plugin 0.7.0→0.8.0，仅报告既有 xc 1.0.2–1.0.4 发布记录缺 commit 的六项问题；未修改历史记录。任务夹具清理按测试归属验证。
  - 部署边界：按用户 c + p 授权提交并推送，结果以 Git 记录为准；未覆盖业务项目旧 `.agents`。发布后按既有更新入口刷新能力包及技能索引；源仓/Overlay 检查不代表已安装入口生效，真实宿主连续派发和额度刷新仍待项目验证。提交前移除维护日志中的项目私有事实，项目证据留归属工程。

- 2026-10-15（BOS 夜跑分级与投入控制，framework-maintenance）：显式采用 decisionPolicyReference 的批次在既有编排入口执行派发前评估、独立修改后复评、真实范围版本绑定、13 分钟探索/30 分钟共用准备复评、6 分钟每候选人工参考、容量预留和固定 20% 抽验。旧批次不启用时沿用原行为；静态/人工待验不产生运行通过。真实 runner 回执记录分阶段耗时与单用例范围，整需求通过仍须独立核验完整最低检查；后续失败撤销旧汇总，未知写和残留资源不能被其他用例成功掩盖。
  - 验证：Windows Node 24 的策略 11 项、调度 13 项、CLI 1 项通过；既有编排 3 项、session 9 项、证据 8 项及相关契约通过。MCP schema 修复 2 项和既有 helper 检查在 PowerShell 5.1/7 通过。三平台 Node 22/24 已纳入 CI，未取得非本机实跑。根脚本/协议/角色/文档修改无所属插件版本递增；同仓并行插件版本变化不属于本项。
  - 通用验证边界：历史回放不能作为新策略有效性的独立证明，后端范围通过不能替代 UI 或完整业务验收。项目编号、环境、部署及候选提交状态只记录在归属项目。包装器按实际 tools/list schema 注入 namespace，修复 check_config UNKNOWN_PARAMETER，保留写入门禁；未覆盖业务安装副本。框架建设与试点运行分账，实际用量未知时不反推。
  - 收尾范围：框架提交与项目交付独立；不以单需求局部验证通过宣称无人值守业务闭环完成。

- 2026-10-15（阶段可用性依赖，framework-maintenance）：bos-plugin 0.7.0、demand-delivery-plugin 0.3.0 在 manifest 声明 availableDependencies 的目标、阶段、触发条件与入口。根检查器复用 workspace-context，更新器只报告 ready/warning，阶段检查缺失或显式 disabled 时停止；不改变强依赖 enabled 门禁，不递归启用或改写依赖 profile。补录脚本延迟加载提交模块，prepare/message 支持显式项目根，取证/回填/渲染不受 Delivery 缺失影响。
  - 验证：Windows Node 24.14.1 可用性专项 8/8、标版补录 19/19；BOS 发现/更新专项在 PowerShell 7 与 Windows PowerShell 5.1 分别 11/11，通过 standard、Overlay、单共享目录、状态保留、升级迁移与警告不阻断查询。修复实测中文 JSON 经 Windows 控制台编码破坏的问题，机器输出采用 Unicode 转义。部署文档链接 1/1、PS1 UTF-8 BOM 与两个 owner 的只读版本比较通过。
  - 收尾：同步说明、技能触发指针、手册、维护入口与发布记录；既有三平台 Node 22/24 CI 纳入专项，非本机实跑和真实宿主仍列 P2。完整能力包更新后生效，无私有配置迁移或旧文件清理；任务专属临时目录已清理并复核；未同步业务工程，保留并行夜跑修改；提交与双远端推送按用户后续 c + p 授权执行，结果以 Git 记录为准。


- 2026-10-15（连续人工验收，framework-maintenance）：demand-delivery-plugin 0.2.0 新增 demand-acceptance，固化连续接收结论、精确逐号交付、授权复用、独立报告与断点恢复。人工通过、自动证据和交付阶段分别记录；BOS 多需求号输出为数量在块外、text 块内单行升序去重、半角逗号无空格。复用 demand-commit 与可选 bos-code-update-log，不增加第二套 Git/BOS 执行器；普通单需求沿用原入口，批次索引按需使用。
  - 验证：Windows Node 24.14.1 的验收专项 16/16 通过，包含官方 commit-demand 真实隔离 Git 提交结果对接、多仓完整回执、范围漂移、交付者/发布排他、未知 BOS 不重放、部分 push 恢复及精确编号格式。独立 Agent 场景演练先实际发现 BOS 自行核对仍需人工确认、commit+BOS 恢复未释放占有两处问题；修正为权威回读证据可登记成功、完成后释放，并经内存复演和新增回归确认。脚本只校验元数据/回执，不证明真实 BOS 结果或服务端幂等。
  - 发现与治理：技能 quick_validate、部署文档链接/目录覆盖通过；Windows PowerShell 5.1 在隔离项目实际生成新 thin-index，确认描述保留且 source 指向真实技能。README、目录/指南、workflow 条件入口、插件 manifest、不可变发布记录及维护摘要/队列同步；定向版本检查无问题（0.1.0→0.2.0 minor），全仓仍仅有已登记 xc 1.0.2–1.0.4 缺 commit 的六项历史问题。现有 standard-demand-entry 的三平台 Node 22/24 矩阵自动覆盖新增测试，非本机实跑和真实宿主接入仍待验证。
  - 收尾：严格 UTF-8、语法及最终差异检查通过；任务临时夹具与官方计划临时文件已清理。提交与双远端推送按本轮用户 c + p 授权执行，结果以 Git 记录为准；未操作真实 BOS 或更新业务工程副本，技能需正常能力包更新并刷新 thin-index 后在业务宿主发现。纯框架维护不创建自反馈。

- 2026-10-15（夜跑分层验收，framework-maintenance）：新增按需加载的夜跑 workflow、批次模板和项目接入说明。纯后端不加载浏览器，UI 使用延迟加载 Playwright 的薄 runner，复用 session/evidence；独占 context、API 独立采集、有限执行与关闭、失败停止后续用例。Broker 抽取纯导入客户端，stdin 非交互调用区分传输/认证/业务/未知结果，精确方法角色授权、严格 TLS、响应上限、不重放未知写。旧 CLI 移入兼容模块，--path/--url 同义。
  - 验证：Windows Node 24.14.1 新增及基础专项 30 项、既有编排结果 2 项、框架契约 1 项通过；实际复用宿主 Playwright 1.62.1 与已安装 Chrome 155.0.8059.40，无头登录、正常导航、iframe/popup、截图/API 回读、版本失效及恢复通过；合成 HTTP 空闲/有效活动/心跳/认证恢复/停止对照使用可控服务时钟，不代表真实服务器时限。Overlay 配置专项通过；首次发现旧静态测试把 compile 薄入口误判为未调用 workspace resolver，改为核验入口委托及实现解析，并复测通过。文档部署链接通过。
  - 治理：coding-iris-plugin 0.18.0 与六个依赖 patch/发布记录同步，新增 CI 三平台 Node 22/24 和源仓隔离依赖锁；未安装依赖，矩阵尚未执行。版本校验仅剩既有 xc 1.0.2–1.0.4 缺 commit 的六项历史问题，不改历史记录。正式 run 仍由 Coordinator 核验并消费既有结果，不另建台账；真实项目和宿主持续运行能力留 backlog。最终定向复测 14/14，部署文档链接及 diff check 通过；任务截图、临时配置、合成服务与浏览器均已退出/清理。未启动夜跑、同步业务副本或操作真实服务；提交与推送按用户后续 c + p 授权执行，结果以 Git 记录为准。

- 2026-10-15（BOS 验收、会话维护与编排基础修复，framework-maintenance）：补齐共享测试契约、Testing Agent/BOS workflow 路由和项目适配指南；新增无依赖 test-session/test-evidence 模块，按有效活动延后心跳、认证恢复串行化、未知结果阻断、限时收尾，实际资源响应哈希及 request-time frame 归属可复用。编排事件 payload 深拷贝消除 ACK 投影污染，新 launch-result/v1 区分启动与 result 消费；旧 run 不补造历史完成证据。
  - 验证：Windows Node 24.14.1 新增专项 19/19、既有编排/验证指纹测试、框架 contract/evolution（含 PS5.1/PS7）与 BOS 9/9 通过；BOS 测试夹具补 HEAD 初始提交以符合现有运行时预检。文档链接通过，三平台 Node 22/24 CI 已接入新增专项，未取得非本机实跑。组件版本检查保留已登记 xc 1.0.2–1.0.4 发布记录缺 commit 的六项历史问题；本轮不修改插件目录，无组件递增。
  - 边界：仅框架本地实现与模拟验证，真实保活端点/空闲时限及完整业务路径仍待授权接入。未提交、推送、同步业务副本或访问真实业务服务；通知和数据保留沿批次策略。

- 2026-10-14（BOS 查询能力补齐，framework-maintenance）：bos-plugin 0.6.0 通过既有 CLI / stdio 和同一上游工具开放全部已声明参数，新增 suser / tuser / tgroup、可覆盖 explain 和不透明 body。列表接受任一人员/组条件，显式空 cuser / cgroup 分别清除默认条件，多项明确条件保留组合；默认“我的待办”继续本人＋所在组，默认本人缺失且无其它明确口径时停止。body 不推断内部协议，字段说明返回不做本地列表处理。空 cuser 从回落本人变为显式清除，按 0.x breaking minor 提供调用迁移；继承本人应省略该字段，私有配置不迁移。
  - 验证：Windows Node 24.14.1 查询专项 29/29，通过合成传输与 stdio 覆盖六种人员/组独立及组合、默认保留和显式清除、空/空白/TODO 阻断、body 对象校验与透传、字段说明原返回和既有待办过滤；首次回归发现个人待办缺少本人时可能退化为整组，已补齐停止条件并复测通过。workflow 契约 2/2、部署文档链接/清单 1/1、skill 格式及受影响文档链接通过。版本工具 owner/直接依赖范围的只读工作区比较确认 0.5.1→0.6.0 breaking minor、Migration 和不可变记录无问题；diff check 通过。现有三平台 Node 22/24 CI 自动纳入新增测试，未取得非 Windows / Node 22 或真实 BOS 验证。
  - 收尾：同步 owner、技能/usage、README、能力手册、场景、维护摘要/决策、P2 验证队列及发布记录；安装/更新和 thin-index 机制不变，已有业务工程主动更新并刷新已启用索引，旧空 cuser 调用按 usage 调整，无文件清理。查询证据保存在 `.git/agent-validation/bos-query-role-0.6.0.json`，suite 为 bos-query-role，内容指纹匹配可复用；工具默认系统临时缓存中的本次条目已移除，其它共享记录保留，无任务临时产物。未连接真实 BOS、未改个人配置、未同步业务副本；按用户后续授权提交并推送，精确暂存 16 个文件，复用查询证据，暂存组件版本门禁通过，结果以 Git 记录为准。

- 2026-10-14（BOS 查询参数说明，framework-maintenance）：bos-plugin 0.5.1 为查询技能增加按条件读取参数契约的路由，完整字段表集中到既有 usage，区分上游 18 项必填字符串与可选 body、本地开放范围、身份要求、日期默认值和本地模式/排序。上游声明注明维护时提供的 tools/list 快照来源与日期；标题 HTTP 500 保留单样本及无标题对照的结论边界，错误不自动移除筛选。运行脚本和配置不变，不开放额外参数。
  - 验证：Windows Node 24.14.1 查询专项 22/22、部署文档链接/清单 1/1、skill-creator 格式校验通过；直接调用参数转换核对 18 个 string 字段、筛选透传、未开放字段拒绝、本地选项不透传及个人身份要求。6 份受影响正式文档的本地链接/锚点可达，包含新发布记录。复用组件版本工具进行 owner 与直接依赖范围的只读工作区比较，确认 0.5.0→0.5.1 非 breaking patch，无版本、发布记录或依赖问题；diff check 通过。合成验证不替代真实 BOS、宿主或非 Windows 验收。
  - 收尾：同步插件/仓库 README、使用指南、维护摘要及发布记录；owner AGENTS、能力目录、长期决策、安装/更新说明与测试入口仍准确，无机制变更。未确认的真实查询边界并入现有 P2 BOS 队列，不新增前置门禁。已有业务工程通过既有主动更新取得说明，无配置迁移或旧文件清理；本轮未连接真实 BOS、未改个人配置、未同步业务副本。按用户后续授权提交并推送，复用上述功能证据并补查暂存版本门禁，结果以 Git 记录为准。

- 2026-10-14（HISUI 部署字节收敛，framework-maintenance）：补齐根 sparse helper 对 tracked `-text` 且无 filter/working-tree-encoding 资产的 HEAD blob 校验。旧 Windows autocrlf checkout 在新增属性的快进后可能 Git 状态干净而字节仍为 CRLF；安装/正常升级与 standard Write -NoPull 仅在干净 checkout、完整计划都是 CRLF→LF 差异时按原 blob 收敛，复核 HEAD/实际字节并以相同 index mode/blob 重置旧 stat，不暂存新内容。自定义/二进制/链接差异保留并停止；Check、DryRun -NoPull 和 Overlay 只读验证并在生成层前阻断。共享 capability 由所属 standard 项目修复，不直接修改业务副本。
  - 验证：Windows Node 24.14.1 的 sparse/字节专项 20 项与部署文档回归 6 项全部通过，包含完整 HISUI 1262 文件摘要、Git 状态/暂存内容、幂等、隐藏自定义改动、完整计划阻断、Junction，以及 PS5.1/PS7 实际 Check 与 bootstrap。更新器全套在 Windows PowerShell 5.1 与 PowerShell 7 均通过；旧删除夹具改为模拟已提交的上游删除，不以缺失 HEAD 文件绕过门禁。既有三平台 Node 22/24 CI 自动纳入专项，非本机矩阵与真实项目升级复验仍待对应入口执行。
  - 收尾：同步 README、更新 runbook、长期决策与治理队列；仅根脚本/测试/维护说明变化，不递增插件或改写不可变发布记录。功能证据保存在 Git 本地元数据，按内容指纹复用；本轮按用户授权提交并推送，不包含并行任务改动。

- 2026-10-14（需求迁移编排契约补齐，framework-maintenance）：根迁移器输出 demand-ownership-plan/v1、实际新增启用差异及迁移前后完整启用集合；更新器 ExpectedEnabledPlugin 可在需求生成/写入前阻断外部预期不一致，并在自更新续跑时保留参数。普通 Check 对待迁移旧入口返回非零；无旧入口时仍检查已启用 successor 的薄索引、逻辑路径、canonical skill 和需求 CLI 文件，Apply 复用同一可达性校验。框架不读取或改写私有注册表，不跨工作区提供原子事务。
  - 验证：Windows Node 24 的迁移专项 5 项、standard/Overlay 更新集成 2 项在 PowerShell 7 和 Windows PowerShell 5.1 均通过，覆盖预期集合不符阻断、完整数组传入成功、迁移待办 Check、入口删除/改指/源文件缺失及幂等；部署文档链接检查 1 项、UTF-8 BOM 与 diff check 通过。未重跑无关提交/补录全套；非 Windows 矩阵与私有注册表适配/项目验证仍待对应工程执行。仅根脚本/文档/测试变化，无插件版本变化；本轮按后续用户授权提交并推送，未同步真实业务副本。

- 2026-10-14（BOS 提交后日志编排，framework-maintenance）：bos-plugin 0.5.0 将 bos-code-update-log 衔接到 bos-demand-handle 的共享 workflow；全部提交 verified 后精确复用 root/完整 hash，自动准备计划，再复用明确 BOS 预授权或请求一次授权。配置缺失、拒绝及接口失败保留本地提交，未知结果先核对，已确认成功不重复写入；通用提交脚本和配置结构不变，不另建普通需求状态库。同步 owner、路由、指南、workflow registry、场景、版本与发布记录；业务工程通过既有更新取得，无新增迁移或旧文件清理。
  - 验证：Windows Node 24 插件全套 51/51 通过，新增四项覆盖单仓/多仓 verified 结果到日志计划与模拟提交、HEAD 后续变化不扩选、配置缺失及后续仓提交失败的结果边界。PowerShell 7 与 Windows PowerShell 5.1 的标准/Overlay/单共享目录发现及 workflow 契约分别 5/5 通过；部署文档链接/清单 1/1 通过。工具检查与静态契约不替代真实 Agent 的预授权/拒绝、部分失败阶段选择及交接去重轨迹，沿既有 BOS P2 队列取证；现有三平台 Node 22/24 CI 自动纳入新增测试，未取得非 Windows/Node 22 实跑。
  - 收尾：组件 owner 定向比较确认非 breaking 的 0.4.0→0.5.0 minor 递增，无问题；diff check 通过，隔离夹具自清理后本任务临时目录已删除并复核。功能证据存于源仓 Git 本地元数据，可按内容指纹复用，不部署。本轮不修改个人配置，不同步业务副本或用户级入口，不执行真实 BOS；提交与推送按本轮后续授权执行，结果以 Git 记录为准。

- 2026-10-14（BOS 日志回归与共享配置，framework-maintenance）：bos-plugin 0.4.0 新增 bos-code-update-log，已有 Git 提交先预览、明确授权后补录，跨仓聚合保留不同菜单和说明。查询与日志共用 BOS_MCP_CONFIG，按 skill 名分段且凭据独立；移除运行时旧格式/连接变量/编辑器回退，显式 migrate-config 原地保留查询字段并增加日志 TODO。沿用更新器按启用状态分发四个日常索引，未修改安装/更新核心，未自动同步业务工程或新增用户级入口。
  - 验证：Windows Node 24 最终插件回归 47/47 通过；PowerShell 7 与 Windows PowerShell 5.1 的 standard/Overlay/单共享目录发现及 workflow 各 4/4 通过，文档部署链接/技能清单 1/1 通过。组件 owner 定向比较接受已授权 breaking 0.3.0→0.4.0，无问题；完整 worktree 审计仅保留已登记 xc 1.0.2–1.0.4 发布记录缺 commit 的 6 项历史问题。现有三平台 Node 22/24 CI 纳入新增测试，未取得非 Windows/Node 22 实跑，不声称真实 BOS 验收。
  - 本机配置：正常 Windows 宿主完成显式迁移，查询字段等值、既有入口新进程离线校验、路径绑定与重复迁移均验证；日志字段待使用者独立填写。补充临时文件落盘后物理路径检查，阻止 MSIX 将新文件写入隔离层，对应模拟回归通过。任务生成的隔离副本已按归属核实并删除，不在共享资料记录个人值或路径。功能证据记录于源仓 Git 本地元数据，不部署；提交与推送按本轮后续授权执行，结果以 Git 记录为准；真实 BOS 写入未执行。

- 2026-10-14（HISUI 资产升级，framework-maintenance）：核心固定 wanghc/hisui 的 `4c09319c2daa09a25813c6e6af349e2791d79944`（2026-10-12），按上游组件顺序与 Less 配方、锁定工具重建主/压缩 JS、五个主题及 locale；保留来源与许可证。对照 HISUI 0.1.0 打包目录（主 JS 文件时间 2026-09-22），补充 26 个 Git 未跟踪分发资源并单独固定摘要，不用较旧主库覆盖新源码。1262 个受管文件有完整摘要，62 个 jQuery 入口有源码索引；14 个生效 CSS 资源缺项如实报告，排除注释 URL。coding-iris-plugin 0.17.1 同步控件/样式行号与运行版本/helper 边界。源仓具备 check/verify、固定输入构建、并发修改保护与失败回滚；正常能力包更新分发 vendor，维护工具/依赖不部署，不改项目预览配置。用户选择的每月只读检查在当前聊天设置为每月 1 日 09:00，有变化才提醒，不自动升级、提交或同步工程。
  - 验证：Windows Node 24 最终专项 12/12 通过，无跳过，包含固定源码与分发输入逐文件复现、篡改/新增/缺失、索引、分发摘要漂移、资源缺项门禁、回滚/恢复保留、链接边界及两种真实 JS 的 DataGrid editor 取值保存；部署文档链接 1/1 通过。本机浏览器默认主库与 pure 压缩库均编辑保存成功，pure 冒烟资源请求全部 200、Console 无错误；未注入 getValue shim，当前主库与参考包均未提供 $.fn.getValue。PS7 及真实 Windows PowerShell 5.1 的新增更新文档断言、5.1 脚本 BOM/语法检查通过，安装器未变化，不机械重跑更新器全套。最终 check 与上游 master 一致，离线 verify 与自有文档差异检查通过。组件 worktree 校验识别 0.17.0→0.17.1，无本轮新增问题，全量仍被已登记 xc 历史记录缺 commit 阻塞；未改历史记录。三平台 Node 22/24 CI 已配置，实跑与真实 HIS/WebView/PAD 沿既有队列取证。
  - 收尾：本地内容证据记录在 `.git/hisui-vendor-validation.json`，指纹匹配可复用。浏览器验收页关闭、回环服务停止；本任务临时 clone、构建 tools/cache 与诊断脚本已删除并复核。使用者的原始打包目录保留；提交与推送按本轮后续授权执行，结果以 Git 记录为准；没有业务工程同步或服务器操作。
  - 差异边界：自有实现/文档的 diff check 通过；HISUI 生成 JS 保留构建器输出，单独 diff check 报告 5 处末尾空格，不将第三方生成代码的格式调整混入资产升级。

- 2026-10-14（需求交付归属迁移）：demand-delivery-plugin 0.1.0 接管通用提交，bos-plugin 0.3.0 接管标版补录；coding-iris-plugin 0.16.0 删除旧技能、CLI 和引用别名，六个直接依赖插件递增 patch 并扩大兼容范围。根更新器独立识别旧部署，先检查显式状态、自定义内容、链接、目标和过滤冲突，再生成验证新入口、迁移项目 AGENTS/本地文档与配置、启用缺失 owner、删除旧受管入口。迁移 product/default-kind 配置，保留草稿与计划数据协议；不初始化 BOS 个人凭据、不访问外部服务、不自动更新业务副本。
  - 验证：Windows Node 24 联合回归 52/52 通过（提交/hook 21、BOS 发现/更新 8、补录 19、迁移专项 4）；最终迁移规则定向复验通过。PS7 / PS5.1 均验证了 standard/Overlay 的 DryRun、接入启用、删除旧入口和幂等更新。PS5.1 更新器首轮已通过前半段，在 legacy sparse 夹具漏打包新增 helper 处停止；补齐 helper/resolver 与实际落盘断言后，从该场景续跑至末尾全部通过。技能 frontmatter、路由与部署文档链接检查、diff check 通过；版本检查无本轮新增问题，保留已登记 xc 历史记录债务。非 Windows CI、真实宿主与业务副本尚未验证。验证证据更新至 D:/tmp/Codex/demand-ownership-20261014/validation-evidence.json；测试产物收尾清理后只保留此文件。本轮按用户授权提交并推送，未同步真实业务项目；工作区并行的部署配置改动保留，不纳入本轮验证结论。

- 2026-10-14（路由、预检、混合 CSP 与提交复核）：coding-iris 0.15.9 对齐默认 direct/可选 guarded 索引，verify 支持重复执行并按 NUL 路径集合核对缺少/额外文件；部署、CSP 编译和 SFTP 配置统一消费 workspace 校验结果。更新器统一报告/停止状态，缺少独立 .agents Git 时在任何 exclude/索引生成前失败，Overlay 复用 initializer 的阻断结论。i18n 0.2.6 修正四技能 frontmatter，helper 扫描区分客户端区域、服务端表达式及模板插值，事件实体位置映射回源码。同步 owner、README、更新说明与发布记录；无配置/会话迁移，无旧文件清理，不同步业务副本。
  - 验证：Windows Node 24 下提交 15 项（全套 14 项及修正完整性夹具后的负例复测）、direct/编译 19 项、前端/SFTP/resolver 18 项、helper/预检 12 项及路由契约 4 项通过；Windows PowerShell 5.1 更新器全套通过，PowerShell 7 新增发现/停止回归通过，暂存版本门禁验证 7 个相关组件通过。更新器全套测试的旧后条件断言已对齐 canonical CLS 引用，无业务规范变更。提交钩子命中的两处历史合成密码改为运行时随机值，保留值不变断言；PowerShell 5.1 两段受影响夹具及原凭据扫描器复验通过。新增混合语法与工作区检查纳入既有三平台 Node 22/24 矩阵；非 Windows 本机无法执行，不能视为已通过。测试只用合成 Git/本机回环服务，无业务服务器操作；最终提交和推送以 Git 记录为准。

- 2026-10-14 framework-maintenance：增加 Overlay 部署配置继承与目标一致性门禁；本轮不涉及业务验收或 feedback；提交与推送按用户授权执行。部署首轮 33 项、最终解析/CSP 13 项及上下文门禁 2 项通过，文档链接检查通过；模块脚手架 PowerShell 7 与 Windows PowerShell 5.1 均通过。先前直接同步的部署态改动已全部撤销，业务工程后续只通过正常上游框架更新取得能力。版本审计受无关 xc 历史发布记录缺少 commit 字段阻塞。

- 2026-10-14（BOS 需求媒体读取）：bos-plugin 0.2.2 明确处理时主动读取影响理解、实现或验收的截图和附件；workflow 统一事实来源，handle 路由、query 区分仅查询与处理调用，覆盖纯图片正文、相关性不明、关键内容缺失及证据复用。同步 README、能力指南、摘要、场景与发布记录；owner AGENTS、能力目录、usage 的既有边界仍准确，安装更新机制不变，无配置迁移或清理。
  - 验证：BOS workflow 契约 1 项、部署文档链接/清单 1 项及 diff 检查通过；逐项核对两技能与 workflow 的读取条件，无真实 BOS 或宿主验收，场景验证沿既有 backlog 跟踪。未改运行脚本，无临时产物，未同步业务副本；提交门禁与推送结果以 Git 记录为准。

- 2026-10-13（BOS 文档语义补充核对）：纠正上一轮将“文档有更新、链接通过”视为语义同步完成的判断。README 将 BOS 三个技能纳入插件概览，删除文末重复介绍，修正“所有连接只放项目 .mcp.json”与 BOS 仓外个人配置的冲突；使用指南补齐个人查询例外、初始化/查询/处理场景和已有需求路线，docs 入口补配置说明。对照 loadConfig/main/personal.initialize 修正 defaults 的离线校验、身份 TODO 独立核对及配置路径优先级，需求技能区分 BOS 与其它领域插件初始化入口。bos-plugin 0.2.0 → 0.2.1，新增不可变发布记录草稿；不改运行脚本。owner AGENTS、能力目录、更新器及 docs/update-agents.md 的现行契约仍适用，无部署机制、配置迁移或旧文件清理变化；backlog 继续保留真实宿主与跨平台验收。
  - 验证：文档部署链接/清单 1 项、配置优先级与 TODO 边界 3 项、BOS workflow 契约 1 项及两个修改 skill 的格式校验通过；版本 worktree 校验仅识别 BOS patch，无新增版本/依赖问题，全量结果仍保留既有发布记录债务。逐项对照 README 路由、技能分支和脚本条件，未运行真实 BOS 查询或业务部署。根展示页的 9 月统计为注明日期的历史快照，本轮不改成当前计数。无临时产物；本次补充修改的提交与推送以 Git 记录为准。

- 2026-10-13（近期提交维护回看）：核对 `c459149`、`01ba99e`、`26570ac`、`d81fa6f` 的实际变更路径与既有记录；BOS 当前 0.2.0、coding-iris 当前 0.15.8，工作区开始时干净。当时仅确认 README、owner 资料、能力手册和测试入口存在更新，未充分核对语义一致性；“已同步”的结论已由下述补充核对纠正。入口摘要合并历史版本条目、保留现行边界和协议路由；BOS backlog 移除已有日志证明完成的本机配置迁移待办，保留使用者验收、其它用户迁移、业务试点及跨平台矩阵。长期决策与治理优先级不变，未启动独立治理项目。
  - 本轮验证：文档部署链接与 skill/rule 清单定向检查 1/1 通过，16 个插件 manifest 目录计数与摘要一致，`git diff --check` 通过。仅维护文档变化，未重跑 BOS/SFTP 功能全量测试，既有功能结果仍归对应日志；未取得新的真实服务、宿主或非 Windows 证据。无临时产物；未同步业务副本，提交与推送以 Git 记录为准。

- 2026-10-13（BOS 组织分发与个人配置）：合并原自建查询模式、排序与计数，增加 Windows 标准私有配置生成、用户环境绑定、公司地址管理与 TODO 门禁；完整旧连接错误不回退。框架为唯一维护源，个人配置独立于项目分发。Windows Node 24 合成查询/配置测试 31 项通过，覆盖新进程、部署副本/Junction、拒绝覆盖及仓内写入；新增 Windows 应用包重定向防护 2 项定向测试通过；本机标准目录迁移已在正常桌面宿主核实物理路径与连接等价性，未代替使用者视觉验收。跨平台 CI 沿用既有矩阵，实际非 Windows 未执行。不部署业务工程，提交与推送以 Git 记录为准。

- 2026-10-13（BOS 简单需求流程收敛）：明确前端/后端直达专项技能，混合或边界不明再进入 iris-coding；普通需求由当前 Agent 连续实施、最终 diff 自查和目标验证，正式协作资料条件加载，回归按行为变化选择。安全、领域与授权门禁保留。同步 skill、workflow、README、能力指南与四类场景；owner AGENTS 和能力目录的入口/职责仍准确，无需扩写；安装、更新及 thin-index 机制未变，无额外迁移或清理。BOS 流程契约 1 项、文档链接 1 项、skill-creator 格式校验及 diff 检查通过；未运行真实需求，提效对照沿现有 P1 队列。工作区并行的查询/初始化修改保留，本轮不计作其实现或验证；按后续提交授权将本轮独立为 0.1.1，仅暂存流程及配套文档；0.2.0 查询/初始化草稿留在工作区，previousVersion 衔接 0.1.1。未同步业务工程，提交与推送以 Git 记录为准。

- 2026-10-13（SFTP 部署治理）：coding-iris-plugin 0.15.7 → 0.15.8，整合已有 direct 批处理改动，direct/guarded 共用 deployment.py 与原子传输；每次执行一个 Python 进程/一条连接，替换前复核、逐文件立即校验最终目标、失败停止，保留 guarded 基线/合并/持久化/编译后检查及远端 UTF-8 预检。结果每文件一条，保留有效证据并区分失败/不明/未执行；增加 CLI 总耗时、阶段进度、读写计数与临时路径恢复证据。摘要检查与 rename 仍非原子条件写入，强杀不承诺 finally 清理。将未提交的部署说明从已发布 0.15.7 移至新记录，旧记录恢复原文；无业务副本同步、真实服务器操作、提交或推送。
  - Windows 本地验证：Python 完整 37 项通过；Node 部署/direct/guarded/Question/worker 43 项覆盖通过（其中既有 Git 5 秒初始化超时，隔离时清理 EPERM；调整该测试预算至运行时一致的 60 秒后，定向复测通过并增加冲突文件定位断言）；真实 CLI 内存 SFTP 场景 3 项通过，涵盖 direct 三种变化比例/首文件校验失败，以及 guarded 基线流程与单连接。最终阶段证据改动定向 Node 6 项和 Python 完整回归通过，文档链接 1 项通过。测试进程/临时 Git 耗时不用于推断服务器提速。
  - 文档与分发：README、owner 协议、工具/vendor README、维护摘要与现有 P1 验收队列同步；AGENTS、部署 skill、能力目录/指南仍正确指向相同入口，无需复制协议。普通更新同时分发插件和完整 vendor src，无配置/状态迁移或旧文件清理；安装/更新/thin-index 机制不变。版本工作区检查仅识别本 owner patch，未新增版本或依赖问题；历史债务沿既有队列。三平台 CI 已扩展 worker/真实 CLI 离线测试，非本机实跑与真实同环境重复性能对照仍待验，不以业务文件部署成功代替工具验收。

- 2026-10-13（BOS 需求框架）：新增独立 bos-plugin 0.1.0（bos-init、bos-demand-query、bos-demand-handle），默认 available、bootstrap 排除 thin-index；查询保留现有 CLI/SSE/stdio 和脱敏，改用显式仓外配置或环境变量。注册 bos-demand workflow，复用 Coordinator、领域技能与业务交付协议，明确事实复用、预授权、分层证据、按需交接及非 IRIS 路由。coding-iris-plugin 0.15.6 → 0.15.7 修复提交路径物理归属、Junction/真实路径等价、新增与删除文件和 Apply 重检；WorkspaceContext.psm1 修复单共享目录数组被展开后误拒绝 Overlay 的问题。同步插件说明、能力目录/指南、更新说明、发布记录及三平台 Node 22/24 CI。查询/配置/合成 BOS 到 IRIS 提交计划与既有钩子专项 22 项、初轮真实 Git 提交回归 11 项通过；插件发现专项在 PowerShell 7 与 Windows PowerShell 5.1 各 4 项通过，Workspace Context 在两种 PowerShell 及 Node 均通过，协作契约与文档链接通过。最终祖先链接/Overlay/越界/pull 定向复测 7 项、钩子与 Node Context 6 项、BOS 到 IRIS 计划复测 1 项通过；既有 standard-demand-entry 18 项通过（与初轮提交 11 项合跑，共 29/29）。Windows Node 24.14.1；内容指纹保存在源仓 Git 本地验证证据中，本任务临时隔离现场已清理并独立复核不存在。版本检查仅识别本次两个 owner 变更，无新增版本或依赖问题，全量审计仍有既有组件发布记录债务。真实宿主/Agent 语言场景、macOS/Linux、Node 22 和真实 BOS 查询尚未验收，沿现有 P2 兼容队列跟踪。原用户级四个来源文件哈希未变；未改个人配置/客户端、业务 .agents 或已提交需求；框架提交与推送以 Git 记录为准。另一个任务的部署相关修改保留，不计作本次实现或验证。

- 2026-10-12（格式化仅限新增代码）：coding-iris-plugin 0.15.5 → 0.15.6，前后端规范、编码入口与通用 Review 明确原有代码即使因功能需求被修改，也不附带调整风格；对照任务开始时源码判定新增，移动/复制及 diff + 行不单独作为新增依据。新代码分隔空行不扩展为历史空白/EOF 整理；功能、语法与兼容性审查继续覆盖需求 diff。既有 CLS 检查器保持只读变更区间提示，Agent 排除历史格式项，不新增解析器或门禁。同步 README、能力指南与发布记录；模板、registry、bindings、能力目录和更新器核对后保持不变。Node 24：CLS 7 项、编码入口 1 项、i18n 路由 3 项、角色契约 1 项、文档链接 1 项通过；CLI 首次因沙箱临时 Git 写入失败，在 D 盘隔离目录补跑通过并确认清理。版本 worktree 校验唯一 coding owner 变化，无新增依赖/发布问题，非零退出来自既有其它组件发布记录债务。文档/静态验证不证明真实 Agent 或业务运行效果。普通更新分发，无业务迁移，未同步真实工程；未暂存、提交或推送。

- 2026-10-10（可选 JS 页面组织模板）：以 3e7f84b 为基线，coding-iris-plugin 0.15.4 → 0.15.5；参考用户指定的 code.template.js 组织约定，整理普通 ready 与闭包显式调用两种可选模板，明确依赖、唯一初始化方、私有事件绑定及按需生命周期，不将历史命名/现代语法提升为全局要求。前端规则、格式规范和 CSP 模板按场景引用，复用既有 Review；AGENTS、skill 与能力目录核对后不扩写，入口已可达且能力归属不变。Node 24.14.1 下模板模拟 3/3、编码入口 1/1、i18n 路由 3/3、文档链接 1/1 通过；模拟覆盖初始化时点、事件绑定、状态变更及依赖缺失，不证明真实页面、目标 helper 或旧浏览器已生效。版本 worktree 校验仅识别 coding 插件变化，无新增版本/依赖问题，既有发布债务保持原范围。普通更新分发，无业务迁移或旧文件清理，未修改业务模板、未同步真实工程；无临时文件，提交推送以 Git 记录为准。

- 2026-10-10（前端命名与格式规范）：以 abe2a1f 为基线，coding-iris-plugin 0.15.3 → 0.15.4；新增 frontend-coding-format 唯一事实源，明确 ES5、4 空格、双引号默认值和项目覆盖，前端/混合入口与 Review 共用。整理 CSP/JS/CSS 模板，纠正 ##(expression)## 是编译期表达式而非 HTML 转义，移除固定业务路径与 Broker 假设；补充 HEAD 按目标工程 CSR 匹配规则及依赖判定、无实现时保留基础 HTML，不凭版本推断能力；不改通用 review-agent 协议，不新增 formatter、配置或门禁。Windows Node 24.14.1：CLS 7/7、角色契约 1/1、i18n 路由 3/3、编码入口 1/1、文档链接 1/1 通过；两项测试初次因首个“最终 diff”定位及标题标点归一化误报，修正定位后定向复跑通过。六类当前 Agent 串行样例见 maintenance/validation/agent-evolution.md；5 个 JS 语法检查、2 项历史保留断言、i18n 正反例通过；Windows PowerShell 5.1 下 9 个样例均 UTF-8 或 ASCII 兼容，退出 0。未做独立 Reviewer、真实浏览器或 IRIS 编译验收。版本 worktree 校验识别唯一 coding 插件变化，无新增版本/依赖问题；退出非零来自已登记的其它组件历史发布记录债务。任务专属临时样例已核对清理。普通更新分发，无业务迁移或旧文件清理，未同步真实工程；提交推送以 Git 记录为准。

- 2026-10-10（CLS 规范与 Review 接入）：以 `1f5a12c` 为基线，coding-iris-plugin 0.15.2 → 0.15.3；扩展 cls-coding-format 为命名与格式唯一事实源，编码入口改为业务/契约复用、明确规范优先，修正后条件空白断言并更新模板。参考 iris-code-formatter 3.1.0，以自有表述整理，不 vendor、不依赖全局 skill。删除 `1f5a12c` 引入的 provisional §3.4，撤回反复询问风格和内部一律无空格要求；通用 review-agent、Coordinator 与 standard-change 传递规范及覆盖范围，区分功能缺陷、规范项和可选建议，不新增门禁。Windows Node 24.14.1：CLS 专项 7/7、角色/工作流契约 1/1、编码入口契约 1/1、文档部署链接 1/1 通过；入口测试初次正则遗漏同目录链接，修正后定向复跑通过。四类当前 Agent 合成输出及串行复核见 maintenance/validation/agent-evolution.md，不声称独立 Agent 或 IRIS 编译通过。版本 worktree 校验仅识别本次 coding 插件变化，无新增版本/依赖问题；退出非零来自已登记的其它组件历史发布记录问题。普通更新分发，无业务迁移或旧文件清理，未同步真实工程；未暂存、提交或推送。

- 2026-10-09（HISUI 弹窗布局指导）：coding-iris-plugin 0.15.1 在现有前端规则及样式参考补充留白、宽度、局部盒模型、fit/resize 和滚动层排查；保留构建、主题及真实客户端验证边界，不收录业务案例清单或固定尺寸。同步 owner/仓库 README、使用指南与发布记录；AGENTS、skill、能力目录、backlog 和更新器入口核对后保持不变：归属、调用方式、部署机制未变，无新增治理项。文档链接定向检查 1/1、diff 检查通过；工作区版本校验识别 0.15.0 → 0.15.1，仅报告已登记的其它组件历史发布记录缺少 commit，未新增依赖或发布问题。未运行真实客户端布局验收；未同步业务工程，提交与推送状态以 Git 记录为准。

- 2026-10-04（默认精简开发部署）：经用户明确授权，coding-iris-plugin 0.15.0 的后端/前端入口默认 direct，无需需求号、Git 会话、fetch/pull 或三方合并；复用既有 Atelier/SFTP 适配器，保留整批预检、Storage、并发变化、回读及编译诊断，失败不自动重试。guarded 显式可选，旧 --demand 命令保留原行为。同步 skill、规则、指南、发布记录及 6 个依赖插件的兼容上限与 patch 版本；未同步业务工程副本；提交与推送状态以 Git 记录为准。Windows Node 24 的 direct 12 项测试（含真实 CLI + 本地模拟 Atelier）、Question 7 项、编码路由及文档链接检查通过；既有部署回归首次有 1 项临时 Git 目录清理 EPERM，清理该目录后定向重跑通过。版本工作区校验无新增依赖/发布问题，仍报告已登记的 xc 插件 1.0.2–1.0.4 缺失 commit 历史问题。三平台 CI 配置已纳入 direct 测试，尚未取得远端矩阵和真实环境的 direct 部署证据。

- 2026-09-28（Windows Runtime skill links 收敛）：CI 诊断确认 `check-functional-diff.ps1` 含中文但无 UTF-8 BOM，Windows PowerShell 5.1 在 Overlay 初始化读取时解析失败，因而未生成更新适配脚本；补 BOM 后保留正文不变。更新器测试的旧式稀疏检出改为直接传模式并检查更新脚本保留，Git hook 断言只看仓库本地配置，避免把用户全局 `core.hooksPath` 误判为自动启用。Windows Overlay 定向回归 1/1、PowerShell 5.1 完整 `update-agents` 回归通过；三平台 CI 结果以本次推送后运行记录为准。未修改业务工程或用户全局 Git 配置。

- 2026-09-28（Runtime skill links Windows 回归）：工作流恢复启动后，Windows job 暴露技能迁移测试用 8.3 临时路径调用 PowerShell 5.1 脚本失败，以及更新器测试断言的固定词句已与 owner 当前正文不一致。迁移样本改从真实临时目录建立，断言改为现行「不通过扫描父目录」表述；Windows Overlay 定向回归 1/1。后续 CI 显示 Overlay 初始化未生成更新适配脚本，测试在调用前增加状态断言以报告实际阻断原因；升级样本的嵌套 `.agents` 仓库补齐独立 Git 身份。三平台 CI 最终结果以推送后的运行记录为准。未改变技能、更新器和业务副本。

- 2026-09-28（跨平台路径别名回归）：coding-iris-plugin 0.14.1 修复 deploy-guard 初始化时 Windows Git 根目录长路径与系统短路径误判，保留既有会话状态位置；macOS 文档布局与菜单同步测试从物理临时目录创建隔离样本，不削弱菜单快照的链接拒绝门禁。插件 README 和发布记录同步，使用入口、依赖范围和业务部署流程不变；定向测试与三平台 Node 22/24 CI 结果以本轮实际运行记录为准。源仓更新不自动同步业务工程；历史 xc 发布记录的版本门禁问题仍独立存在。

- 2026-09-28（Windows 路径别名修复）：agent-context-kit 0.4.2 修复 task-handoff 在 Git 返回长路径、Node 使用 8.3 短路径时误算 `docs/handoff` 仓库相对位置；Git status 过滤和 Overlay GitRoot、共享 Junction 比较按各自协议统一路径表示。增加嵌套项目排除规则与状态回归，workspace-context 测试复用短路径临时目录。Windows 本地首轮交接与 workspace-context 专项 22/22，后续定向回归 4/4，语法与差异检查通过。组件版本工作区校验识别 0.4.1 → 0.4.2，仅报告其他插件既有发布记录 `commit` 字段问题；新版本三平台 Node 22/24 CI 以推送后的实际运行结果为准。使用入口、安装/更新和薄索引行为未变，现有交接不迁移；提交与推送状态以 Git 记录为准；未同步业务副本。

- 2026-09-28（标版需求简洁模板）：coding-iris-plugin 0.14.0 将 iris-demand-entry 改为 `{IRIS}` 名称和三段式描述，缺陷按操作/预期/实际、功能改进按说明/操作/预期；用户、安全组、科室可选，仅问题依赖时补齐，备注仅保留验收限制。渲染器与文本/Excel 同源，草稿使用 v2，按用户决定直接替换旧格式，不保留旧草稿兼容。六个依赖插件仅递增 patch 并扩展范围至 0.14.x，未使用需求草稿接口；其 AGENTS/README 职责与调用未变，无需复制模板规则。同步 owner、协议、能力手册、摘要、P2 验收队列与发布记录；安装/更新与 thin-index 行为未变，部署方式在 owner README 和协议说明，无需修改更新器。skill 格式、文档链接与差异检查通过，版本比较无新增问题；Windows Node 24 专项回归 18/18 通过，覆盖两种模板、文本/Excel 同源、缺失字段、取证、回填和提交计划；macOS/Linux 与 Node 22 矩阵、BOSS 真实录入及测试交接继续沿 P2 跟踪。提交与推送状态以 Git 记录为准；未同步业务副本。

- 2026-09-25（Overlay 只读调查）：agent-context-kit 0.4.1 / coding-iris-plugin 0.13.7 分离真实仓库只读参考和模块默认写入范围，同步 owner、技能、README、共同契约与发布记录。旧项目入口按授权定点迁移，manifest、工具写入门禁和 backend-only 身份不变；能力手册已引用 Overlay 契约，无需复制规则。workspace-read-scope、workspace-context Node 测试及文档链接检查通过；两项版本迁移对比 HEAD 无新增问题，全量版本校验保留既有发布记录字段问题。iris-workspace-context.tests.js 仍以 compile.js 直接包含 resolveWorkspaceContext 为断言，当前 HEAD 已改为转发 deploy-protected；这两个文件与 HEAD 一致，本轮未调整该既有测试。源仓变更经校验后原样同步授权的共享部署副本，模块通过既有共享链接读取；未提交或推送。

- 2026-09-25（共享经验准入）：agent-framework-evolution 0.1.2 将经验筛选收紧为新增价值、复用依据、验证与边界、沉淀收益四项同时满足；局部观察留项目内，单次有机制证据的高价值发现可准入，有效命中按独立场景去重，提升要求成熟证据。同步 owner、共享协议、经验维护规则、能力手册和发布记录；项目模板已有按信号只读路由，无需改动，安装/更新行为不变。框架契约、IRIS fast-path、部署文档链接检查通过；版本全量检查仅报告既有 xc 发布记录字段问题，本轮无新增报错。正反例已人工核对，真实模型执行效果沿既有 P2 反馈评估跟踪，不以静态测试代替；未改历史经验正文、未提交或同步业务副本。

- 2026-09-23（兼容入口误报修复）：根 `check-agent-entrypoints.ps1` 与 `repair-agent-entrypoints.ps1` 统一按链接解析后的目标比较，`AGENTS.md` 与 `.\AGENTS.md` 等价；正确链接不再误报或被备份重建，真正指向其他文件的链接仍报告并在显式修复时备份。新增隔离回归并接入 Windows CI；定向回归在 PowerShell 7/5.1 通过，完整 `update-agents.tests.ps1` 在 PowerShell 7/5.1 通过，文档链接定向检查 1/1，通过真实 imedical 链接核对。源仓修复不自动更新业务 `.agents`，提交、推送与部署状态以当次 Git/更新结果为准。

- 2026-09-23（标版需求产物边界）：coding-iris-plugin 0.13.6 为需求录入四个写入入口增加 `.agents/`、能力包源码和目录链接别名的硬门禁，保留旧输入只读迁出能力；同步 owner 协议、更新说明、根总览与发布记录。标准工程临时目录和 `docs/work/standard-demand/` 保持可写；最终专项回归 15/15、文档链接 1/1、暂存组件版本门禁及差异检查通过，功能证据指纹匹配。真实业务副本在源仓提交推送后按用户授权更新。

- 2026-09-22（能力手册持续同步）：本地 agent-kit-maintenance skill 明确能力目录与使用指南的同步触发条件、源事实优先级和完成标准，覆盖框架变更回看；复用现有文档清单/链接定向检查，并要求按差异核对说明与示例语义。xc 沿用 P2 待治理范围。本次仅维护 skill 与日志，不改变能力实现或业务部署内容。

- 2026-09-20（文档目录与部署边界）：docs/README.md 作为项目使用入口，maintenance/README.md 作为源仓维护入口；31 项准确路径迁移，稳定 runbook/schema 保留原位。分离医生站 AI、知识接入、交接等文档中的源仓验证说明；按用户授权删除旧部署样本四个文件，不留副本。安装/更新继续复用 /docs/** 和 Git 安全快进，不新增清理脚本。新增文档专项覆盖新装、旧文件/空目录收敛、维护区排除、自定义残留及 dirty 保护；六项已分批验证，首次链接检查误含 Git 忽略的本机交接，限定分发文件后通过。导出 XML 与历史 run JSON 的 checkout 字节保持一致，原本机交接和历史 feedback 保留。PowerShell 7/Windows PowerShell 5.1 更新器完整回归均通过，覆盖实际安全快进、Check/DryRun -NoPull、旧路径/空目录清除、维护区不落盘、自定义保留及既有 Overlay 流程；PS5.1 使用原生模块环境启动。证据已记录，任务测试目录已清理。非 Windows 矩阵已接入既有 CI，未实跑。未提交、推送或更新真实业务副本。

- 2026-09-20（非 xc 能力手册）：新增 docs/guides/capability-catalog.md 与 docs/guides/capability-guide.md，README 提供统一入口；按当前 manifest 与源文件核对 11 插件、46 skill、35 rule，提供逐技能请求示例、前提、产物和主要使用路线，明确初始化/日常/兼容入口、插件状态、条件加载及操作范围。按用户要求将四个 xc 插件手册补齐登记为 P2，并同步队列排序与验收标准。仅根文档与维护记忆变更，无插件内容或版本变更；清单覆盖、源链接与章节锚点检查通过，最终差异检查见本轮验证；未提交、推送或同步业务副本。

- 2026-09-20（纯 init 空目录清理）：根生成器补齐删除受管索引后的空目录清理，并兼容上一版本仅删除文件后留下的空目录；限定排除项和 ContextRoot/skills，检查隐藏项与祖先链接，使用非递归删除防止误删新增内容。PowerShell 7/Windows PowerShell 5.1 各 8 项迁移专项和 update-agents 完整回归通过，覆盖历史空目录、删除索引后空目录、隐藏文件、空子目录、目录/祖先链接、standard/Overlay 及 Check/DryRun 只读。真实工程 DryRun 已识别截图对应两个空目录，未执行写入。验证证据已记录；非 Windows 矩阵沿用 P2 待验收，未同步业务副本；提交与推送状态以 Git 记录为准。

- 2026-09-19（IRIS 编码入口优化）：coding-iris-plugin 0.13.5 收窄统一入口触发，明确专项直达；部署基线前移，i18n 矩阵归前端规则，修正默认转换编码表述。路由/引用/前置顺序及既有框架契约 5 项通过，含坏路径、坏章节和错误顺序反例。五份主链文档静态字符减少 18.9%，不是模型提效结论；真实对照沿既有 P1 队列。基线 e92a5c6，信创内容保持，源仓改动未提交、推送或同步业务副本；验证详情见 maintenance/validation/agent-evolution.md。

- 2026-09-19（纯 init 薄索引清理）：7 个插件以 manifest excludeSkills 统一初始化与更新策略，复用根生成器精准删除历史受管入口；同步初始化验收、README 与迁移说明。PowerShell 7/Windows PowerShell 5.1 的 update-agents 全量回归、各 7 项迁移专项及性能分析专项通过，医生站 AI 10 项专项通过；覆盖 Check/DryRun 只读、Write 删除、幂等、standard/Overlay、旧更新器升级、状态保留及自定义/链接保护。7 个真实 manifest 排除与 canonical 可达检查通过，版本校验无本次新增问题；quick_validate 因缺 PyYAML 不可运行，改用 frontmatter 静态检查与真实生成器验证。非 Windows 矩阵仍列 P2。验证证据已记录；未同步真实业务副本或推送，提交状态以 Git 历史为准。

- 2026-09-19（task-handoff 新会话验收）：无原聊天历史的新会话仅依据项目规则、交接入口和仓库材料恢复目标、授权、现场、证据及下一步；先执行 inspect，确认 master/178da9f、工作区无改动、交接无漂移且 task-handoff-v1 证据指纹匹配，再维护本机交接记录。用户明确确认本次当前 Codex 宿主的新会话接续验收通过。其它 Agent 宿主以及 macOS/Linux、Node 22/24 矩阵继续保留为 P2 待验证；本次未扩大到实现修改、提交、推送、业务副本同步、远程 CI 或服务器访问。

- 2026-09-19（通用需求接续）：agent-context-kit 0.4.0 新增 task-handoff skill、Markdown 模板和 Node 内置模块工具，项目 docs/handoff 按需启用、关键节点更新、显式交接留历史；正文摘要绑定现场，检查工作区/暂存内容变化与既有证据，默认本机 exclude，不扩展授权或调度会话。自然语言路由仅在授权初始化/维护时定点合并，普通更新不覆盖项目入口，旧 run/个人 handoff 不迁移。Windows Node 24 的 21 个专项场景分批通过：首轮 16/18，通过修正测试调用到 canonical 生成器补齐 PS7/PS5.1 两项；新增 3 项和路径补测通过，覆盖 sparse 依赖、链接快照和入口条件。框架契约/演进行为两组通过，语法与差异检查通过。工作区版本校验识别 0.3.5→0.4.0，无本次新增问题；全量仍保留已登记历史债务。框架源仓生成仅本机保留的交接样本，真实无历史新会话、其它宿主及完整三平台 Node22/24 矩阵转入 P2；业务副本未同步；提交与推送状态以 Git 记录为准。

- 2026-09-18（主流程入口配置，未提交）：按用户授权补充卡片加载、主流程导航、辅助快捷按钮的职责与映射检查；快捷入口规则仅在入口存在或明确新增时适用，不硬编码补回已移除按钮，不将显示顺序当业务门槛。纳入现有待发布 AI v0.2.1，保留其它未提交修改；仅文档，未改业务公共框架、工程副本或服务器配置。

- 2026-09-18（医生站 AI 多宿主兼容，未提交）：主 skill 引用 workstation-contracts 的无 Chat 兼容约束；共享业务不依赖 Chat，刷新通知可选且失败不改变提交结果，传统回调保留，跨窗口按同源与就诊归属核对。verification 增补无 Chat、跨窗口和共享调用方隔离场景。仅指导文档变更，合入当前未提交的插件更新；未发布或同步业务副本。

- 2026-09-18（上下文偏差修复）：agent-context-kit 0.3.5 统一 contextMode 判定触发条件，已有模式的维护与优化不重复判定或落盘；coding-iris-plugin 0.13.2 在指定来源无菜单快照时返回 project-menu-missing 警告并回退共享参考，损坏/链接/完整性失败仍阻断，不触发同步。Windows Node 24 专项 16/16 通过（含新增缺失/空结果/损坏快照、standard/Overlay、sparse 和 PS7/PS5.1 thin-index），文案一致性及差异检查通过；工作区版本校验识别两项 PATCH，无新增版本问题。非 Windows/Node22 验证沿用 backlog 的 P2 矩阵事项，未宣称通过；正常更新取得修复，无配置迁移或兼容清理，未提交、推送或部署业务副本。

- 2026-09-18（待治理项优先级）：根 AGENTS 与本地维护 skill 明确每个待治理项必须标注 P0–P3，复用 backlog 既有定义，新增或调整事项时核对执行顺序、排序入口与详情一致性。本次仅补充维护规则，不调整既有事项优先级或业务部署内容。

- 2026-09-18（知识检索自主选择）：coding-iris-plugin 0.13.1 将查询选择集中到通用规则，skill 描述支持模型按信息缺口自主使用，不要求用户点名、不局限菜单定位、不固定每次必查；现有 Agent/前后端入口复用，平台 API 查询和业务知识参考分开。更新后刷新薄索引，不自动改写项目 AGENTS.md，不扩大远端授权。本轮仅修改路由文案与版本，未部署业务副本。

- 2026-09-18（知识资料并入与菜单刷新）：coding-iris-plugin 0.13.0 接收 218 份脱敏上游参考（164 份 wiki/目录、40 份菜单/安全组、14 份技术文档），记录固定来源与双 hash，排除生成器缓存。新增 iris-imedical-knowledge / iris-menu-sync，MCP 采集与离线 plan/apply 分离，项目快照原子发布、全量/部分刷新、指纹漂移阻断和历史恢复；AI 0.2.0 按需路由，五个其它依赖插件仅扩展兼容范围。资料短 ID 与 vendor .gitattributes 解决 Windows 长路径及换行校验问题。14 项专项通过，包含真实 sparse 初装/快进刷新、项目快照保留、standard/Overlay、PS7/PS5.1 thin-index；入口链接及简单 frontmatter 检查通过，通用 Python validator 缺 PyYAML。真实 IRIS 采集与非 Windows CI 待验证；未部署真实业务副本，未提交或推送。

- 2026-09-18（项目上下文编程体验优化）：agent-context-kit 0.3.3 修正 project-context-maintenance 的初始化/维护/日常优化混用，允许授权范围内语义去重与重组，初始化及优化细节改为按需 references；按工程实际开发入口、参考实现和有效验证路径选择信息，保留维护分工及配置值。同步五份上下文模板、owner 文档、更新说明与发布记录，不自动扫描插件或同步业务副本。契约检查、演进行为测试（含 Windows PowerShell 5.1 / PowerShell 7 配置合并）、薄索引 DryRun、UTF-8/引用/差异检查通过。通用 quick_validate 缺 PyYAML，使用静态 frontmatter 与实际薄索引解析检查；这不证明模型效率收益。组件版本校验识别本次 0.3.2 → 0.3.3，失败项仅为既有信创插件 1.0.2 发布记录缺少合法 commit，未改历史记录；未提交、推送或处理业务工程。

- 2026-09-17 本轮框架演进交付完成：a529e78 与 6128127 已推送；0.3.1 补丁通过真实主工程及 10 个模块普通更新复测，guidanceMode 不再追加，11 个入口迁移零变更，50 个受保护文件与 37 份配置哈希不变。用户确认本次目标完成；跨模型/宿主对照、非 Windows 矩阵及信创历史版本门禁转入独立待治理事项，不宣称这些验收已经通过。

- 2026-09-17 实测修复：profile 的 guidanceMode 改为合法可选键且不自动生成默认配置，入口迁移补齐缺失路由并保留 BOM/换行与自定义正文；agent-context-kit 0.3.1。验证结果见 maintenance/validation/agent-evolution.md。

- 治疗表单入口补充优化：按任务加载交付章节，复用范围内已有明确部署授权；服务端原子回滚与客户端 rollback 分开表达，运行时门禁不变。演进行为补充回归通过，迁移拒写保护、文档引用与 diff 检查通过；版本检查仍仅有既有 xc 发布字段阻塞。

本文件记录近期维护流水摘要和验证结论。长期决策见 `agent-kit-maintenance-decisions.md`，后续治理队列见 `agent-kit-maintenance-backlog.md`，入口摘要见 `agent-kit-maintenance-memory.md`。

## 近期已完成

- 2026-09-20（工作区待提交）：imedicalxc-doctor-extend-engineer v1.0.4 编码规约新增 AO：必填项必须有值（来源缺失立即抛 rpcException，不允许空值上送，空值常被平台以"数据签名不正确"等不直观原因拒绝）；多值逗号分隔且无对照的扩展设定取值（如备案设备码）每次调用随机取一个。源于冠新科技 getPersonInfoByQrCode 的 terminalCode 必填未赋值问题（文档 6.5，识读终端编码 Y 必填）。字母范围引用同步 A~AN→A~AO（4 处）；plugin.json 递增 1.0.3→1.0.4（patch，非 breaking），新增 releases 1.0.4.md。本轮未提交、未推送；HIS 业务工程 `.agents` 副本经 `git pull` 同步（待推送后）。

- 2026-09-20（工作区待提交）：imedicalxc-doctor-extend-engineer v1.0.3 编码规约新增 AN：响应各节点类型按第三方文档逐一确认，JSON 对象单独处理（声明 Object/专用 VO 并写专属解析），禁止未确认文档就把对象节点声明为 String（Jackson 对象→String 抛 MismatchedInputException 被上游吞后表现为"接口成功但数据未落库"）。插件 AGENTS.md、elechealthcard_index.md、子 skill SKILL.md 及规约 frontmatter 字母范围同步 A~AM→A~AN；新增 releases/plugin/imedicalxc-doctor-extend-engineer/1.0.3.md，plugin.json 递增 1.0.2→1.0.3（patch，非 breaking）。worktree 组件版本校验识别 1.0.2→1.0.3 变更；release record 的 commit 字段沿用仓内既有惯例待提交后回填（1.0.2.md 同样缺该字段，属存量缺口）。本轮未提交、未推送；5 个变更文件已按精确文件同步至 HIS 业务工程 `.agents/plugins/` 副本。

- 2026-09-18（提交检查提速）：定位 078867b 提交轮次中版本校验耗时 548.6 秒、实际 commit 含钩子 22.9 秒。维护工具新增 `validate --staged`、独立版本证据、60 秒共享预算和阶段输出；按暂存 owner 与直接依赖校验，Git 对象改为 cat-file 批量读取并缓存。功能指纹改为 scope 实际内容，不再绑定 HEAD；隔离样本覆盖无关 HEAD、文案、实现、依赖和历史问题，以及未暂存修复与超时不放行。18/18 专项及 agent-evolution 兼容测试通过（含 PS5.1/PS7 分支），语法和差异检查通过，已记录可复用功能证据。隔离 index 重放原提交的七个 owner，加直接依赖共九个组件，首次 16.2 秒、复用 17.7 秒，均为 7 个 Git 进程；完整 ref 审计降至 13.2 秒、5 个 Git 进程，仍准确报告已登记的信创历史问题。原版耗时来自原任务日志，与本轮负载不同，不作为严格性能基准。已知问题登记为 version-debt-xc-1.0.2-commit，按用户要求普通提交不重复处理；未改历史记录和提交钩子。隔离测试及性能样本已清理，证据缓存按用途保留。Windows Node 24 已验证；三平台 Node 22/24 CI 矩阵已配置但未实跑。本轮仅本地提交，未推送或部署业务副本；agent-context-kit 变更由独立提交 e464b07 承载。

- 2026-09-18（标版需求录入闭环）：coding-iris-plugin 0.12.0 新增 iris-demand-entry 与 Node 内置模块脚本，支持实际 Git 补丁取证、默认文本、可选 --excel/--Excel、BOSS 需求号/最终标题回填及复用需求提交计划。补齐用户模式 --text/--bind/--plan/--commit/--help，--rev 区分历史来源，--same-title 显式确认原题；纳入 0.12.0 发布记录。历史来源不改写历史；不同历史提交可分别提报同一文件，工作区漂移和重复范围阻断。六个依赖插件仅递增补丁版本并扩展兼容上限至 <0.13.0。Windows Node 24 完整专项 12/12 与历史归属定向补测 2/2 通过；CLI 转交原 plan 后 HEAD/index 不变。Excel 经独立 openpyxl 读取核对原模板 29 个表头、正文、指派人对齐、文字公式安全和 ZIP CRC；thin-index DryRun、仓库 frontmatter/引用检查与 diff 检查通过。隔离测试及中断测试的遗留临时目录均已核实清理。通用 skill 校验器缺 PyYAML，未安装全局依赖。版本门禁已识别本次七个组件变更，剩余问题仅为既有信创 1.0.2 发布记录缺少合法 commit。非 Windows CI 与 BOSS 实际导入待验证；提交阶段已确认测试指纹匹配并复用，不重复运行完整回归。未推送、更新业务副本或修改个人 requirement-entry。

- 2026-09-18（技能插件化，工作区未提交）：coding-agent-adaptation 迁入 agent-context-kit 0.3.2；agent-framework-feedback 与 reusable-content-packaging 迁入新基础插件 agent-framework-evolution 0.1.0。三个原技能名的项目薄索引及运行时目录链接保持稳定，历史原文按归一化哈希迁移，自定义内容、链接及显式 available/disabled 保留；首次须执行不带插件筛选的完整 Write/Check。PS5.1 迁移专项 5/5、PS7 迁移专项 5/5 及后续自定义失效索引保护补测通过，两宿主更新器完整回归通过，运行时/演进专项 12/12、框架/编码路由专项 2/2 通过。隔离 Git fixture 验证旧更新器拉取并续跑、干净工作树、CodeBuddy 链接保留和 Overlay 本地索引；非 Windows CI 与真实宿主任务尚未验收。版本门禁识别本轮 5 个组件迁移，仍受历史 imedicalxc-doctor-extend-engineer 1.0.2 缺少 commit，以及工作区其它任务的 coding-iris-plugin 新增文件未升版本阻断；未修改这些内容，未改历史发布记录。更新说明、版本记录和维护入口同步，未提交、推送或写入业务副本。

- 2026-09-18（链接优先的技能适配）：新增根级 coding-agent-adaptation 0.1.0 与 sync-runtime-skills.js；CodeBuddy/Claude Code 项目目录链接到 ContextRoot/skills，Codex 复用通用层。安装/更新显式 RuntimeAdapter 接入，Overlay 转发到 canonical 脚本；普通目录、错误链接和越界父链均保留并阻断，legacy Claude 复制入口拒绝写入已链接目标。11 项 Node 专项、PS5.1/PS7 更新器完整回归及 Overlay 回归通过，已记录可复用指纹证据；现有项目链接只读 Check 返回 unchanged。源码、runbook、版本记录与迁移边界同步；非 Windows CI 与更多真实宿主验证仍待补齐。版本差异检查已识别新增 skill，修正本轮 release 草稿后当前清单仅剩既有 imedicalxc-doctor-extend-engineer 1.0.2 缺少 commit 的门禁，不修改不可变记录。通用 skill-creator 校验器缺少 PyYAML，且不接受本仓必需 version 字段，已改用仓库 frontmatter 与版本校验。未推送或批量部署业务副本。

- 2026-09-17（按需辅助与开放方法，本地未提交）：IRIS 入口统一按风险分流，新增 guidanceMode 的共享底线/默认方法/按需辅助；反馈 on-signal 保留用户验收和独立写入授权。调度器完成与 --final 共用门禁，写入验证绑定既有 scope 指纹和计划仓库身份；补 session 别名、未知 adapter 降级和 blocked 结果恢复。i18n 新运行协议与 bindings 对齐 2.0，旧 fixture 只读。项目入口提供默认只报告的精确句子迁移，保留用户内容与 profile；未改安装/更新算法。Node 主回归 8 项及新增恢复补测通过，PS5.1/PS7 新旧 run 回归通过；PS5.1 更新器完整回归补齐 fixture 依赖后通过，显式私有快照指纹补测通过。详见 maintenance/validation/agent-evolution.md。九项组件版本/依赖变更已记录，版本校验仅被既有 1.0.2 发布记录缺失 commit 阻断，不修改不可变记录。Claude 只读路由冒烟 API unknown 重试后停止，未取得模型结果；弱模型、跨宿主性能和非 Windows 矩阵未验证。未提交、推送、部署或同步业务副本。

- 2026-09-17（提交效率约定）：根 `AGENTS.md` 补充提交阶段复用审查与有效测试证据、批量独立只读检查、避免重复加载规范及按原因处理钩子失败的规则。与维护 skill 既有证据复用要求一致；仅文档改动，差异和规则一致性检查通过，不运行完整测试；本次仅本地提交，未推送。

- 2026-09-16（`iris-agentic-dev` exe 更新）：按 vendor runbook 将内置 Windows x64 可执行文件从 v1.2.6 更新到 v1.4.2；上游稳定 tag、Release 元数据、`--version`、资产长度 `51398656` 和官方 SHA-256 `BC7F41C7D0675EB8B2F481A2D276AFD98F620CDF4C409F9CB53BA7882BC90D52` 一致。同步 vendor/root README 和更新 runbook 基线；断连 `tools/list` 复核为默认 70、开启内置 skill 81 个工具，新增的 3 个未分类工具由 helper fail-closed 门禁保护，完整体系适配留入 backlog。helper 与 update-agents 回归均通过 PowerShell 7 / Windows PowerShell 5.1，版本文档一致性和 `git diff --check` 通过；组件版本校验被 HEAD 中既有 `imedicalxc-doctor-extend-engineer` v1.0.2 release record 缺少合法 `commit` 字段阻断，本轮未修改任何组件目录或 release record。

- 2026-09-16（sparse 刷新修复）：定位 Windows PowerShell 5.1 UTF-8 BOM stdin 首项模式遗漏；PS7 与 PS5.1 无 BOM 对照正常。安装、更新、旧 runtime 恢复共用 JavaScript 参数输入与落盘校验，安装器补齐 dirty 和 Git 失败停止。9 项 sparse 专项、PS7/Windows PowerShell 5.1 更新器完整回归通过并记录复用证据；同步修正 4 条过期依赖范围断言，16 组件版本校验与差异检查通过，临时文件已清理。非 Windows CI 待运行。本次提交仅包含框架修复，未推送或同步业务副本。

- 2026-09-16（维护 skill 对齐）：优化仓库本地 `agent-kit-maintenance`，按影响面选择验证，补齐脚本运行时/跨平台矩阵、canonical 降级和目标项目集成测试产物归属检查；临时清理须证明任务归属，提交须沿用明确授权并检查提交正文。同步入口摘要与长期决策；README 和 backlog 已复核，无需变更。现有 `agent-framework-contract.tests.js` 与差异格式检查通过；skill frontmatter 未改，通用 `quick_validate.py` 因本机及 bundled Python 均缺少 PyYAML 未运行成功。此次仅维护文案，不涉及组件版本、部署副本或运行逻辑，未运行完整组件测试，未提交或推送。

- 2026-09-16（本轮维护）：经用户授权直接维护 canonical：Doctor AI v0.1.2 补充入口分层、旧页面复用边界、运行时加载与控件事件、摘要语义及十类脱敏回归场景（含配置获取、生效过滤、加载与注册分层）；Coding IRIS v0.10.2 补充旧请求迁移契约检查。仅更新指导资料，不新增固定业务接口或通用测试执行器。26 项既有专项通过（含 PS7/PS5.1 thin-index），场景清单不是目标工程运行验收证据；16 组件版本校验、15 文件 UTF-8、20 相对链接与差异检查通过。本轮仅提交 canonical，未推送或同步业务副本，发布后沿既有更新流程取得资料，无配置迁移。

- 2026-09-16（工作区待提交）：coding-iris-plugin v0.10.1 修正部署 Question 兼容。新增工具无关 question 结果，统一 pause/inspect/merge/overwrite/resume 代码，明确选项/文本/普通对话/异步/非交互降级；暂停、查看、无效及过期决定保持停止。旧 action/token 兼容，未增加厂商 SDK。32 项部署与协议测试、16 项组件版本测试、16 组件治理校验及 UTF-8/语法/差异检查通过；10 个插件运行时文件同步至现有工程副本并核对一致。未暂存、提交、推送或执行远端业务部署。不同 Agent 产品的实际提问界面不在本轮实测范围。


- 2026-09-16（7a75f9b）：coding-iris-plugin v0.10.0 增加前后端共享部署保护：需求 Git 基线、隔离三方合并、跨进程覆盖记录、绑定快照的人工决定、写前复核及写后回读；源码与索引不接收服务器差异。旧后端位置参数改为显式需求/文件/执行参数，更新六个依赖插件版本范围及 patch 版本。25 项 Node 部署测试、26 项 Python vendor 测试、16 项组件版本测试及 16 组件版本校验通过，UTF-8/差异检查通过。获授权独立前端文件条件上传与后端测试类合并/回读/编译/再次覆盖停止已验证，测试资源已清理。工程运行时副本按精确文件同步并逐字节核对；更新器与薄索引 DryRun 验证，未改既有私有配置及无关提示。已本地提交，未推送或部署业务文件；跨平台 CI 尚未执行。


- 2026-09-15（本轮修复）：修正近期内容偏移。imedicalxc-doctor-extend-engineer v1.0.1 收敛电子健康卡范围、模板选择与方向映射，经主编排器架构门禁加载；manifest 的 thinIndex.excludeSkills 统一常规更新与 wrapper 的子 skill 排除策略，canonical 生成器只清理标记/来源精确匹配的受管旧入口，保留自定义文件和链接。同步插件/仓库说明、兼容步骤、短摘要与专项检查。业务副本未更新。26 项 Node 专项通过，包含 PS5.1/PS7 wrapper 与 canonical 实际调用路径；16 组件 worktree 审计通过，v1.0.0 → v1.0.1。新增 Windows CI 入口（未在本轮运行远端 CI）；组件测试临时目录改为任务隔离并自动清理，两轮已确认归属的 60 个旧测试目录经内容/边界/Git 来源校验后清理。

- 2026-09-15 状态核对：1da1b20 已提交 coding-iris-plugin v0.8.0 的 SFTP vendor、compile-csp 与统一前端部署入口，02930f5 已提交 v0.9.0 自动迁移标准 SFTP 参数；iris-cure-form-dev 当前 v0.7.2。早期日志中的“未提交/待发布”仅表示当时状态。已提交的 releases/plugin/coding-iris-plugin/0.8.0.md 含“尚未提交发布”历史文字，本次通过日志纠正，不改写不可变记录。源仓提交不代表业务副本同步或真实 HIS 验收。

- 2026-09-11（7ce2517）：CLS 能力按用户纠正收敛为 Agent 最小改动提示、模板和可选非阻断自检，撤销未提交的编译证据、回读与提交门禁；6 项格式与 CLI 自检通过。

- 2026-09-10：清理源仓 `.agents/work` 中 28 个和 `docs/work/cure-form` 中 135 个模拟测试残留，共 163 个文件移入系统临时归档以便恢复。表单集成测试增加源仓执行拒绝门禁，改为从目标项目执行，运行目录归项目 `docs/work/cure-form/framework-tests`；apply 的手动交付显式绑定该测试目录。不改业务备份、其它工作树修改或 Git index。

- 2026-09-09—10（已于 d4aa9f5 提交）：iris-cure-form-dev v0.7.0 统一项目 docs/work 产物与运行态，分离自动/手动部署和克隆/原 ID 覆盖策略，补齐预览、字段契约、独占文件集成检查及受控传输。完整 Node、PS7/PS5.1 与版本门禁通过；业务凭证留目标工程，不代表全部 HIS/设备验收。

- 2026-09-09（已于 d4aa9f5 提交）：新增显式 lightweight-sql 单模板 content 通道及 mcp-fixed-sql-binding 固定参数兼容层。NULL 安全比较、COUNT/UPDATE 同一事务及单行回滚门禁通过；最终授权样本完成原内容 UPDATE、清空、恢复及独立哈希/元数据核对。此前清空后回读失败、回滚响应丢失和 ROWS_CHECK_FAILED 是真实异常经历，已通过独立核实与专项修复收口，不改写为一次直通成功；新增实例和正常 deploy 改内容全链路仍按具体任务验收。
- 2026-09-04：补充 Windows 可选 Agent 兼容入口说明。实测开发人员模式开启时，PowerShell 7 可通过 `New-Item -ItemType SymbolicLink` 创建链接，Windows PowerShell 5.1 `5.1.26100.9168` 仍可能报 `Administrator privilege required for this operation.`，同环境 `cmd /c mklink` 成功；更新 Runbook 现优先引导使用会备份既有文件并自动回退 `cmd.exe` 的 `repair-agent-entrypoints.ps1`，同时给出仅适用于目标路径不存在时的手工 `mklink` 和验收命令，避免用 `del` / `Remove-Item` 误删独立规则文件。Windows PowerShell 5.1 下的普通文件备份、双入口创建与链接目标验证通过；PowerShell 7 / Windows PowerShell 5.1 更新器回归、15 组件 worktree 校验、16 项组件版本专项均通过。

- 2026-09-04：修正 standard 更新器的 Git 同步状态语义。fetch 后按 `HEAD...@{upstream}` 区分无更新、仅落后、仅领先和分叉：无更新报告 `agents-up-to-date`、跳过 pull 但继续 sparse 与本地生成层检查；仅落后才 fast-forward 并以 `oldHash` / `newHash` / `upstreamHash` 报告 `agents-updated`；领先、分叉、upstream 缺失或比较失败均明确停止。普通 `DryRun` 继续保持可更新 capability、只预演项目生成层的兼容契约，`Check` 与显式 `DryRun -NoPull` 用于保持 capability 不变。同步更新 README、runbook 和 PowerShell 7 / Windows PowerShell 5.1 回归。

- 2026-09-04：`coding-iris-plugin` v0.7.1 将 `iris-demand-commit` 的既有 plan/apply 能力暴露为显式 `$iris-demand-commit --plan|--commit`，并兼容 `-plan/-commit`。`--plan` 固定只生成计划和完整 commit message，不执行 pull、暂存、提交、verify 或继续追问；`--commit` 视为本地 commit 明确授权，plan 展示后直接 apply/verify，push、部署、上传和远程编译仍需独立授权。自然语言调用保持兼容，冲突或未知模式停止。同步更新 owner skill、`iris-coding` 路由、插件/根 README、AGENTS 模板、manifest 默认提示、长期决策和发布记录；未修改业务工程 `.agents`。提交状态机专项 7 项（含 plan-only HEAD/index/worktree 零修改）、组件版本专项 16 项、15 组件 worktree 校验、fast-path 静态契约、JSON/Node 语法、coding 插件 thin-index 源仓 DryRun 和 `git diff --check` 均通过。

- 2026-09-04：完成 IRIS 提效与通用 AGENT 协作调度 beta 的实现、回归和当前 `Doctor-Iris/imedical/.agents` 本地同步。schema 2.0 以互斥 `taskKind` 将业务需求与框架维护彻底分流：业务需求使用验收及只读 feedback 分支，框架维护使用 `maintaining -> locally-verified -> maintenance-complete`，`acceptance` 和 feedback 均为不适用；运行时与静态契约测试阻断跨生命周期操作。清除 `i18n-coding`、`iris-deploy` 的验收前经验直写路径。`iris-coding` 增加 fast/full/guarded 与最多两个临时只读子 Agent 的 `parallelAssessment`，fast 仍强制适用 rules、编码、测试和 diff 门禁，本地验证后不再自动加载 `iris-demand-commit`。事件/action 调度 CLI 覆盖 DAG、幂等重试、投影恢复、中心消息、独立授权、稳定 Codex 任务标题、可写 worktree owner 和待授权集成计划；六个通用角色、`standard-change`、`iris-change-agent` / `iris-change` 落地，i18n 复用同一内核，旧 schema 1.0–1.2 只读。核心 Node 合约、临时 Git 双 worktree 集成、组件治理及 PowerShell 7 / Windows PowerShell 5.1 更新与校验回归通过；部署文件与 canonical SHA-256 一致，8 个 Agent thin-index 已生成。新增 `validation-evidence.js`，按 suite/scope 记录验证证据和 worktree 指纹，提交阶段只在受测 scope 变化时补跑测试。未执行 merge、push、远程编译或部署；真实三类 AGENT 样本与五个简单 skill 样本继续进入 backlog。

- 2026-09-03：`coding-iris-plugin` v0.6.2 优化 `iris-demand-commit` 日常提交性能与消息可读性。标版提交首行新增独立 `--subject` 菜单/功能摘要，第三行继续保留完整需求；新计划用单次 porcelain v2 状态读取获得 HEAD、branch、upstream、index blob、文件模式和状态，并结合工作区字节哈希生成防漂移指纹，避免逐文件重复调用 Git。用户已明确授权时不重复暂停，`apply --verify` 可在同一进程完成提交与验证；旧计划继续按原指纹方式兼容校验，pull、精确文件提交、无关改动保留和无 push 边界不变。同一 `project local-only` 集成场景在当前 Windows 环境由超过 60 秒降至 10 秒内。

- 2026-09-03：`coding-iris-plugin` v0.6.1 与 `i18n-iris-plugin` v0.1.6 修复普通 IRIS 前端任务的跨插件 i18n 路由缺口。`iris-coding`、`iris-frontend-coding` 和前端规则以目标工程 `plugin_profile.md` 为启用事实，在修改前与最终 diff 后识别翻译 helper/key、用户可见文案及相关 HTML 属性；只有 i18n 为 `enabled` 且命中信号时才追加 i18n profile/rules，明确 i18n 需求才进入完整流程。新增只读 Node.js helper 检查器，稳定字面量 `$g` 与占位符 `$trans` 通过，动态 key、拼接与插值模板阻断；普通任务和未启用插件不额外加载 i18n。Node.js 路由/helper/i18n/组件治理 25 项、两组既有 i18n XML 专项、15 组件 worktree 版本校验、PowerShell 7 与 Windows PowerShell 5.1 完整更新回归、双插件 thin-index DryRun、JSON/Node 语法、差异格式及临时路径污染检查均通过。

- 2026-09-03：`coding-iris-plugin` v0.6.0 新增 `iris-demand-commit` 标版/项目需求提交状态机，并接入 `iris-coding` 收尾路由。计划按需求文件解析受控 GitRoot，校验方案型修改说明、HEAD/upstream/diff 指纹和计划完整性；用户明确授权后先完成全部仓库 `pull --ff-only` 门禁，HEAD 快进则停止并要求重新确认，未变化才提交精确路径，保留无关暂存/未暂存/未跟踪修改且不执行 push。标版采用三行消息，项目采用两行消息并兼容纯本地仓库。新增 `demand-delivery-type-v1`，已部署工程从明确上下文填充 `standard/project`，无法确定时写 `TODO` 并提示补全。五个依赖插件扩展到 coding v0.6.x 并做 patch 发布。提交状态机 6 项、需求类型迁移 PowerShell 7/Windows PowerShell 5.1、组件治理 16 项、两宿主完整更新回归和 coding thin-index DryRun 均通过；Skill 结构、Node/JSON 语法与 `git diff --check` 通过。

- 2026-09-02：`i18n-iris-plugin` v0.1.4 将已在医生站业务源码验证的 `DHCDoc.I18n.PageTranslationSeed` 提升为页面翻译种子 canonical 默认类，固定 `SetPageTrans` / `KillPageTrans` 单条接口与 `Load{LANG}Translation` / `Kill{LANG}Translation` 聚合命名，批次方法继续按需求编号；随插件提供 canonical ObjectScript 源模板，目标类缺失时由明确的种子实现任务创建，初始化和更新不覆盖业务源码。本地完整路径从已声明 backend SourceRoot 解析，现有兼容项目保留 profile 覆盖；旧占位值移除，字典翻译 SQL 与 XML 模板同步保持独立，远端授权边界不变。新增 canonical 默认契约专项测试通过，组件版本治理 16 项与 worktree 15 组件校验通过，i18n 插件 thin-index DryRun、JSON/Node 语法和 `git diff --check` 通过。

- 2026-09-02：复核并加固 `ea5b246` 引入的 DEV→PRD 需求移植能力。`coding-iris-plugin` v0.5.2 以 PRD 服务器导出为目标基线、DEV Git patch 为需求来源，计划目录加入 DEV/PRD 绝对路径身份避免同名仓库覆盖，冲突 `continue` 重新校验双方 HEAD 并拒绝未暂存或未跟踪状态；专项 CLI 子进程增加超时与错误收敛。补齐 v0.5.1/v0.5.2 发布记录、根总览、owner 文档和维护记忆；`i18n-iris-plugin`、`iris-codegraph`、`iris-cure-form-dev`、`iris-external-reg`、`iris-interface-dev` patch 升级并扩展 `coding-iris-plugin` v0.5.x 兼容范围。该能力只读访问 PRD 基线并修改本地 PRD Git，上传、编译、SFTP、数据库和生产部署仍需单独授权。需求移植专项 15 项、既有 export/workspace-context 2 项、组件版本治理 16 项、current/worktree 版本校验、coding 插件 thin-index DryRun，以及 `update-agents` PowerShell 7 / Windows PowerShell 5.1 回归均通过。

- 2026-08-28：安装/更新流程新增 Windows x64 `iris-agentic-dev` vendor 运行时优先收敛。`prefer-vendor-iris-mcp.ps1` 在内置 exe 存在且项目已有配置时，只更新 `.mcp.json` 中唯一识别的 IRIS MCP `command` 与既有 `project-env.json` 的 `mcp.serverPath`，保留其它 server、args、env 和全部连接字段；DryRun/Check 只报告，Write 原子替换、写后重读两份目标、失败按原始字节回滚且支持幂等，非 Windows、无配置、vendor 缺失、JSON 无效或候选歧义均保守降级。专项通过本地 Git 远端模拟已部署项目从不含收敛逻辑的旧脚本升级到新版，证明受支持更新器一次 Write 可自更新并修改两份配置、第二次 Write 字节级幂等；standard/overlay 两种部署形态均覆盖两份配置与敏感/无关字段保护。PowerShell 7 与 Windows PowerShell 5.1 完整更新回归均通过；安装器、更新器、README、更新 runbook 和长期决策已同步。

- 2026-08-28：新增 `demo/presentation/imedical-agents-team-sharing/` 组内分享 HTML 演示文稿，按“体系框架、现有能力、部署与使用实演”组织 21 页内容，并以当前 13 个插件、47 个插件 Skill、15 个受治理组件为事实快照；页面沿用根展示页的青蓝/橙色视觉语言，支持键盘、触控、URL hash、总览、讲者备注、全屏与命令复制，附带本地静态验证器。根据分享反馈，正文中的抽象术语已统一补充简短中文职责注释，附录 C 改为八项术语表，并移除封面、行动清单的整页深色变体，统一为浅底、深青文字、橙色强调的主视觉；定义页的大字号荧光底色也收敛为细橙色下划线，避免形成遮挡文字的横向色块。已在 1920×1080 全量检查 21 页布局，并在 1366×768、1280×720 抽查关键页面；浏览器 Console 无错误/警告，Network 仅请求本地 HTML。一次性临时目录中的真实 Gitee 联网安装、Windows PowerShell 5.1 `DryRun -NoPull -Detailed` 与 `Check -NoPull` 彩排通过，临时目录已清理。该演示仍是源仓展示资产，不进入业务项目 sparse checkout。

- 2026-08-27：修复 frontend encoding v3 对 backend-only Overlay 的边界遗漏。manifest 明确至少声明一个 `backend` SourceRoot 且没有 `frontend` SourceRoot 时，迁移器不再返回“缺少 frontend”阻断，而是将旧 `TODO` 双模式提示及兼容值规范化为 `N/A (backend-only)`；无法证明 backend-only 的缺失声明仍保持停止，不扫描父目录或 sibling，前端导出入口识别 N/A 后也明确停止且不写 source/staging。新增 DryRun/Write、v2 marker 替换、幂等、后续新增 frontend 后回归 `utf8`、未知角色继续阻断及导出拒绝的专项样例；模板、init skill、README、Overlay/更新 runbook 和长期决策同步，`coding-iris-plugin` 升级为 v0.4.2。PowerShell 7 与 Windows PowerShell 5.1 的迁移、编码、更新器和 thin-index DryRun 均通过，16 项组件版本专项与 15 组件 worktree 校验通过。

- 2026-08-26：按标版前端编码正式变更，将 coding-iris 前端源码、上传内容和服务器运行编码统一为 canonical `utf8`。frontend encoding v3 迁移在实际字节为 UTF-8 或纯 ASCII 时，将旧 `project-utf8` / `standard-gb2312` profile 规范化为 `utf8`；真实 GB2312、mixed、UTF-16 或 unknown 保持阻塞，不自动转码业务源码。当前导出与部署直接使用 UTF-8 源文件，GB2312 检查、转换和 promote 仅保留为用户明确指定历史工程的兼容路径；coding/i18n rules、skills、模板、README、更新 runbook、展示页和专项测试同步更新。`coding-iris-plugin` 升级为 v0.4.1，`i18n-iris-plugin` 升级为 v0.1.2。PowerShell 7 与 Windows PowerShell 5.1 的编码、迁移、更新器和双插件 thin-index DryRun 均通过；Node 导出测试、16 项版本治理专项、15 组件 worktree 校验、manifest JSON、语法、差异格式和临时路径污染检查通过。

- 2026-08-25：完成 `iris-agentic-dev` v1.2.6 体系适配。根 helper 显式分类断连 `tools/list` 复核的完整 78 工具集，默认 `--no-skills` 暴露 67 个工具，并保留 `IRIS_NO_SKILLS=false` 显式开启路径；新增多实例、跨环境比较、持久会话、Global preview/kill、namespace/database、journal/audit、HL7、Mermaid 和 Storage 等安全边界，`check_config` 摘要补齐 server/IRIS 版本和破坏性工具状态。官方 vendor skills 刷新到上游 tag v1.2.6 固定提交 `c54ae583eddc36350e5a155246153dadf843cfc7`，8 个 `SKILL.md` 与 MIT LICENSE 逐个匹配上游 Git blob，新增 optional `objectscript-tdd` 并由本地规则约束编译、测试和 session fallback。`coding-iris-plugin` 升级为 v0.4.0；5 个依赖插件只扩展 v0.4.x 兼容范围并做 patch 发布。PowerShell 7 与 Windows PowerShell 5.1 下的 MCP helper、lookup、update-agents、治疗表单和接口专项均通过；workspace 配置双向 skill 开关、16 项组件版本测试、worktree 版本校验、vendor/插件 thin-index DryRun、Node 语法、`git diff --check` 和临时路径污染检查通过。

- 2026-08-25：按 vendor 更新 runbook 将内置 Windows x64 `iris-agentic-dev.exe` 从 v0.9.3 更新到 v1.2.6；GitHub Release 资产大小为 `50178048` 字节，仓库目标 SHA-256 为 `BACE5848F29A6AEAE585D813669FEBDF60A4EBC5ED3FC8ADE1F60BCC6C65BB09`，与官方 digest 一致。同步更新 vendor README、根 README 和 runbook 基线示例；MCP helper 在 PowerShell 7 与 Windows PowerShell 5.1 下均通过，`update-agents` 两种宿主回归通过，组件版本治理 15 项校验与 16 项专项测试通过。v1.2.6 完整 MCP 工具/参数/协议变化不在本次 exe 更新范围内，已进入治理队列。

- 2026-08-21：`iris-cure-form-dev` 升级为 v0.6.0，明确新开发表单直接创建正式模板且不进入灰度流程；只有现有模板改造使用灰度，单 Map 独占模板通过 `consolidate`、多 Map 共用模板通过 `consolidate-shared` 回归正式 RowID，完成门禁要求 `VerifyOperation`、全部 Map 回读、灰度引用数为 0 及灰度模板/缓存不存在，`cleanup` 仅处理零引用孤儿模板。客户端补齐共享合并包的一对一、RowID 集合不重叠、Map 唯一、组成精确替换和灰度来源覆盖校验。`coding-iris-plugin` 升级为 v0.3.1，将 Overlay 编译路径解析抽离为可测试模块，修复 `backend/src/...` 被错误编译为 `src.*.cls`；README、AGENTS、owner skill/rule/reference、manifest、release record、根总览和专项测试同步。治疗表单、Overlay 部署清单与 `update-agents` 回归均通过 PowerShell 7/Windows PowerShell 5.1，Node 语法、16 项组件版本专项、worktree 版本校验、两个插件 thin-index DryRun、差异格式、BOM 和临时路径污染检查通过；真实 IRIS 服务端事务与回滚验证仍需在目标工程获得单独远端授权后执行。

- 2026-08-20：`iris-cure-form-dev` 升级为 v0.5.0，将主执行链和 persistent staged transport 的固定事务类迁移到 `DHCDoc.Cure.AI.CureFormDeploy`，不新增 profile 类名配置，也不保留旧类 fallback；README、owner 文档、部署 rule/skill/reference、更新 Runbook、根总览、breaking 发布记录和类名防回归门禁同步。目标实例只读审计确认新旧类均已编译、服务器源码从方法体起完全一致，新类服务器源码与本地文件一致；`InspectInventory` 及四组无写入错误路径返回逐字相同的合法 JSON。Node 语法、插件专项和 `update-agents` 回归均通过 PowerShell 7/Windows PowerShell 5.1，组件版本治理 16 项专项与 breaking worktree validator、两种宿主 thin-index DryRun、旧类残留、差异格式和临时路径污染检查通过；删除旧类仍须等待业务项目更新到 v0.5.0 并确认无旧调用方。

- 2026-08-19：修复 standard 工作区从旧 sparse checkout 跨版本更新时的 `WorkspaceContext.psm1` 自举死锁：旧进程即使拉取了新版脚本，仍可能用内存中的 `/scripts/*.ps1` 清单遗漏 `scripts/lib/**`；新版更新器现会在自更新恢复、`Write` 或允许拉取的 `DryRun` 中，先验证干净的独立 capability Git checkout 并收敛当前完整运行时 sparse 清单，再加载 resolver。`Check` 与显式 `DryRun -NoPull` 保持只读，失败状态明确停止。新增真实 Git sparse 回归覆盖“只读不修复、恢复后模块落盘及规则持久化”，README 与更新 Runbook 同步；`update-agents` 回归通过 PowerShell 7 和 Windows PowerShell 5.1，组件版本治理 15 项检查、16 项 Node 专项、差异格式与临时路径污染检查通过。

- 2026-08-19：完成插件与根级独立 skill 的源仓版本治理基线：13 个插件保留现有严格 SemVer，2 个独立 skill 从 `0.1.0` 起步，插件内部内容统一继承 owner 版本；新增不可变 `releases/plugin|skill/<name>/<version>.md`、旁路 `dependencyVersions` 和维护者专用 Node inventory/validate/compare 工具。`iris-cure-form-dev 0.4.0` 以 `c79055e` 建立真实 breaking minor 记录，其余组件建立一次 baseline。版本工具不接入 install/update、thin-index、业务 hook 或 sparse checkout；16 项 Node 专项、真实仓库 15 组件 bootstrap 校验以及 `update-agents` PowerShell 7/Windows PowerShell 5.1 回归通过，三个现有部署/更新入口保持无差异。

- 2026-08-19：`iris-cure-form-dev` 升级为 v0.4.0，新增 `interaction-prepare` / `interaction-check` 的新表单人工交互门禁：部署前清单从 numberbox、选择控件、计算与显隐规则生成必测骨架，并固定覆盖单位/左右侧去重；`user-attested` 接受用户明确总体通过，`agent-manual` 强制逐项实际结果，`automated` v1 直接拒绝。`expectedVersion=NEW` 的 package 必须携带与 approved spec、snapshot、changes、preview verification/manifest 哈希绑定的交互凭证，存量响应式改造保持兼容；部署后清单绑定 package/operation ID 并覆盖 CA/CR 保存、重开、回显、打印及 CR 运行时契约，失败不自动回滚。专项和 `update-agents` 回归通过 PowerShell 7/Windows PowerShell 5.1，Node 语法、两种宿主 thin-index DryRun 与差异检查通过；测试只验证报告和门禁，不执行自动浏览器交互。

- 2026-08-19：`iris-cure-form-dev` 升级为 v0.3.2，将完整预览提升为 gate v2：新增 Node 内置模块实现的跨平台 `preview-run`，通过仅绑定 `127.0.0.1` 的临时服务和 Chromium CDP 自动采集九档 Network、Console、HISUI panel/radio 与溢出结果；`preview-check` 拒绝旧 gate、缺少 canonical runner 来源或 manifest 后编辑完整 HTML 的凭证。六类资源和递归 CSS `url(...)`/`@import` 依赖现均复制、记录 SHA-256 并纳入部署凭证，新 profile 默认从 `.agents/vendor/hisui/` 解析 HISUI/jQuery/locale。`common-migrate` 的优先 MapCode 与公共模板 RowID 已迁入目标工程 `cure-form-common-migration-config/v1` 并绑定配置哈希，canonical 不再保存业务种子。插件专项与 `update-agents` 回归均通过 PowerShell 7/Windows PowerShell 5.1，五个变更 skill 通过 UTF-8 validator，两种宿主 thin-index DryRun、真实 Chrome 九档 gate 与 Playwright 独立 Network/Console/探针核验通过；macOS/Linux 实机矩阵仍留在 backlog。

- 2026-08-18：`iris-cure-form-dev` 升级为 v0.3.1，将旧 WebView radio 拆行故障回归 canonical：完整配对明确为 `input.hisui-radio.radio-f + label.radio + label.i-label-box/m-label-box` 且 `for/id` 一致；缺少 `:has()` 的旧内核可在目标工程内做包含 input 的幂等原子包装，以保持 HISUI 邻接、事件和保存协议。插件仅固化兼容契约与完整配对机器门禁，不携带业务 CSS/函数实现；现代 Chromium 与旧 WebView/真实触控证据继续分开验收。插件专项和 `update-agents` 回归均通过 PowerShell 7/Windows PowerShell 5.1，skill、Node 语法及两种宿主的 thin-index DryRun 通过。

- 2026-08-18：`iris-cure-form-dev` 升级为 v0.3.0，新增 canonical `preview` 与 `preview-check`：从目标 profile 或现有页面解析并复制 HISUI CSS、jQuery、HISUI JavaScript、中文 locale、`asscom.css`、`adaptation.css` 六类资源，完整 HTML 缺资源立即停止；页面内置浏览器探针，九档结果验证资源请求、`jQuery`/`$.parser`、panel、radio、溢出和运行时错误，并形成与 snapshot、changes 和资源清单哈希绑定的凭证。任何带 changes 的 `plan` 现在必须提供通过的 `preview-verification`，最终包另校验计划 changes 哈希；README、owner 文档、profile 模板、更新 runbook 和专项测试同步。

- 2026-08-18：补记根 `scripts/iris-mcp.js` 的大体积工具参数能力：`call` 支持以 `--json-file` 读取最多 8 MiB 的 UTF-8/BOM JSON，并继续复用既有默认拒绝写入与 `--allow-write` 授权门禁；`iris-mcp-helper.tests.ps1` 已覆盖文件参数解析和帮助入口。

- 2026-08-18：`iris-cure-form-dev` 升级为 v0.2.5，新增显式 `aggregateTemplateInit=true` 宿主兼容模式：当目标 HIS 不可靠调用分模板 `Init` 时，由 Map 总入口在 DOM ready 和宿主缓存恢复之后延迟、幂等调度实际存在的业务模板模块；默认模式仍保留宿主生命周期所有权，无逻辑模板不生成也不调用空壳 JS。专项回归覆盖仅调用业务模块、跳过空模板及延迟初始化门禁。

- 2026-08-18：`iris-cure-form-dev` 升级为 v0.2.4，文档驱动的新表单默认从业务项目 `docs/` 发现医院 Word/PDF/Excel 需求，并将规格、摄取报告和生成源码写入 `docs/cure-form/<moduleId>/`，废弃插件内 `src-iris` 默认约定；多个候选文件必须显式传入 `--source`。服务器快照与部署临时数据继续隔离在 `.agents/work/`，专项测试覆盖默认目录与多候选停止门禁。

- 2026-08-18：`iris-cure-form-dev` 升级为 v0.2.3，补齐表单总入口的运行时与部署双路径契约：`scriptHref` 写入 Map“引用JS”，`scriptDeploymentPath` 仅描述静态资源落盘位置，二者 basename 必须一致；`loadMode=host` 缺少任一路径时停止。模板继续仅在确有业务逻辑时保存各自 `javascriptHref`，无逻辑模板清空旧内联引用，专项测试覆盖 Map 外部入口与模板外链分离。

- 2026-08-18：将真实手机/PDA 已验证的 HISUI radio 响应式兼容约束回归 `iris-cure-form-dev`：同时覆盖原生 `label.radio` 与业务 `i-label-box` / `m-label-box` 配对、普通布局和表格单元格、点击同步、选中态及旧 WebView 原生 fallback；插件只保存兼容契约与离线回归，不复制业务工程公共 CSS。专项测试继续验证响应式转换不改变 radio DOM/`name/value`，部署保持默认 dry-run，远端校验只走 `ValidatePackage`，写入仍需显式确认后调用 `ApplyPackage`。

- 2026-08-17：`iris-cure-form-dev` 升级为 v0.2.2，部署计划新增 `--approved-clones` 公共模板幂等复用：按来源 RowID 将已批准版本转换为 `referenceOnly`，并记录 `commonTemplateReferences[]`，防止多个 CA/CR Map 重复克隆同一公共模板；创建流程支持获批 `fragmentHtml`/`javascript` 覆盖，强制校验根容器、响应式 class、字段 ID/缓存标签、模块接口和语法，独立预览按序加载并初始化全部子模板。专项测试覆盖上述复杂多模板生成、已批准模板复用与未批准模板继续版本化克隆。

- 2026-08-17：`iris-cure-form-dev` 升级为 v0.2.1，新增 `cure-form-template-boundaries/v1` Excel 多模板摄取：保留格式化/非空范围、合并层级、公式、单位维度与规则候选，范围重叠进入 `TEMPLATE_RANGE_OVERLAP`，合并单元格被边界截断进入 `TEMPLATE_MERGE_SPLIT`；审批后按顺序生成独立 fragment、JavaScript 和 Map composition changes。同步补齐候选字段/标识符审批门禁、`common-responsive` 快照版本化克隆实现、插件文档，以及 PowerShell 7/Windows PowerShell 5.1 的插件专项、业务孵化和 `update-agents` 回归。

- 2026-08-14：新增 canonical `iris-cure-form-dev` v0.1.0，限定 CA 治疗评估与 CR 治疗记录，空 `MapType`/病理模板强制排除；复用 `extract-doc/structure-v1` 和 `coding-iris-plugin`，提供规格适配、CA/CR 生成、现有与公共模板响应式改造、人工批准门禁、dry-run 部署包、验证及回滚编排。`extract-doc` v0.2.0 增加通用 `--emit-structure`，保留原 `extract-doc/v1` 输出兼容；专项测试覆盖 CA/CR、响应式契约、扫描 PDF 门禁、病理排除和 Windows PowerShell 5.1。
- 2026-08-14：修复 workspace overlay 未生成模块本地 `.agents/scripts/iris-mcp.js` 的部署缺口。initializer 新增 manifest-aware JS runtime adapter，从 `capability.json` 解析 `CapabilityRoot`，保留调用工作目录、参数和退出码并转发到 canonical helper，不复制实现或写死绝对路径；更新 README、overlay/update Runbook、长期决策和维护摘要，并为 adapter 生成、路径独立性与 `--help` 转发补充回归测试。
- 2026-08-12：完成 workspace overlay framework：新增 schema 与 PowerShell/Node context resolver、安全 Junction initializer、standard/overlay 双模式安装更新、ContextRoot/CapabilityRoot 分离的 plugin/agent/vendor thin-index 和 runtime adapter；manifest 强制 `workspace-overlay` 模式并限制 ContextRoot、SourceRoot、shared/local 路径边界，ContextRoot 既有父链不得经过 reparse point，`-Repair` 仅处理 ContextRoot 内受管 Junction，模块 adapter 补齐 Claude Code skill 同步、Git hooks 安装和 Agent 入口修复。coding-iris 前端编码迁移限制到声明的 frontend SourceRoot，IRIS 工具统一读取 workspace context，部署清单支持多 GitRoot 并保留逻辑路径来源。README、overlay/update Runbook、agent-context-kit、coding-iris owner 文档和专项测试同步；PowerShell 7 五组、Windows PowerShell 5.1 四组、Node 两组框架门禁均通过。
- 2026-07-24：收敛 `iris-interface-dev` 唯一实现路径为 `iris-interface-dev-plan -> iris-interface-build -> coding-iris-plugin 编码规则/部署能力`；同步修正 dev-plan、init skill、接口 profile 模板并增加专项防回归断言。插件 canonical 名称仅使用 `iris-interface-dev`，不保留旧名称兼容契约。
- 2026-07-23：审计并修复 `608fe86`、`e94fe48` 引入的框架偏差。`iris-interface-dev` manifest 增加旧名称迁移，更新器保留旧 plugin profile 状态并支持旧名称显式选择，plugin thin-index 增加 stale skill 清理，接口 profile 仅迁移旧默认输出目录；README、runbook、owner 文档和专项测试同步。性能分析插件移除 Graylog 私有环境标识和 Claude Code 专属权限配置，统一为“只读 MCP 优先、HTTP 需用户明确授权、Web UI 人工兜底”。`iris-interface-plugin.tests.ps1`、`perf-analysis-plugin.tests.ps1`、`update-agents.tests.ps1` 均通过 PowerShell 7 与 Windows PowerShell 5.1；两个插件的 thin-index 在 Windows PowerShell 5.1 下 `DryRun` 通过，10 个 plugin manifest 可解析，敏感环境标识扫描和 `git diff --check` 通过。
- 2026-07-23：将维护者专用 `agent-kit-maintenance` 从根 `skills/` 迁入源仓 `.agents/skills/`，正式区分“随能力包部署的通用 skill”与“只服务源仓维护的本地 skill”；根 `.agents/` 现仅承载受版本控制的仓库本地 Agent 上下文，不加入业务项目 sparse checkout。安装/更新脚本移除已无必要的专项目录排除，继续兼容清理业务项目历史残留，并保护从源仓根脚本执行时的本地维护 skill。
- 2026-07-23：完成 `iris-agentic-dev` v0.9.3 MCP 体系跟进：根 `iris-mcp.js` 改为按工具 `mode` / `action` 精确区分读取与状态变更，补齐 `iris_doc insert/delete_lines`、`iris_query write/force`、`iris_global set/kill`、`iris_execute_method`、容器/SCM/Production/lookup/skill/KB、`iris_test` 和 `iris_coverage` 等授权门禁；`check_config` 摘要新增 connection source、workspace hint、fallback warning 和 capabilities，并取消仅凭 `USER` / `52773` 阻断工具发现。coding-iris 规则、README、更新 runbook、长期决策和专项测试同步；`iris-mcp-helper.tests.ps1`、`iris-mcp-lookup.tests.ps1`、`update-agents.tests.ps1` 均通过 PowerShell 7 与 Windows PowerShell 5.1，plugin thin-index 在两种宿主下 DryRun 通过，Node 语法、`git diff --check` 和字面 `%SystemDrive%` 路径污染检查通过。
- 2026-07-23：为 `coding-iris-plugin` 新增 `iris-mcp-lookup` skill、`iris_knowledge_lookup.md` rule 和官方文档路由 reference，统一当前实例元数据、本地源码、官方文档三类知识源；明确 MCP 只走 `iris-agentic-dev`、默认只读、工具可用性先以 `tools/list` 为准，并支持直接 `Fetch` DocBook URL。
- 2026-07-23：从 `intersystems-community/iris-agentic-dev` v0.9.4 固定提交 `568a0e03cb5bdfae6870973a73d1d4d86ae42ab9` 引入 `objectscript-review`、`objectscript-guardrails`、`objectscript-sql-patterns`、`objectscript-list-patterns`、`objectscript-navigation`、`objectscript-unit-test`、`objectscript-debugging` 七个官方 skill；保留 MIT LICENSE 和上游原文，manifest 声明为 optional vendor 依赖，避免默认 thin-index 污染。官方 `iris-docs` 因内含固定 Algolia key 且与本次 URL Fetch 路由冲突未原样引入，由本地安全适配入口承接。
- 2026-07-23：验证 `iris-mcp-lookup` canonical skill 通过 `quick_validate.py`；专项测试和 `update-agents.tests.ps1` 均通过 PowerShell 7 与 Windows PowerShell 5.1。内置 v0.9.3 本地 `tools/list` 返回 52 个工具并包含 `iris_doc_search`；给定 `GGBL_structure` DocBook URL 已实际读取到 “Formal Rules about Globals” 页面和 IRIS 2026.2 版本信息；7 个 vendor skill 逐个匹配固定上游 Git blob，敏感 key 扫描和 `git diff --check` 通过。
- 2026-07-23：已将内置 Windows x64 `iris-agentic-dev.exe` 从 v0.6.20 更新到 v0.9.3，并同步 vendor 更新 runbook 示例、`vendor/iris-agentic-dev/README.md` 的当前版本、官方 Release 下载地址和仓库 README 版本引用；业务项目仍通过 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe` 获取可执行文件，连接事实继续只保留在目标工程本地配置。
- 2026-07-18：审计并闭环 `ca310db` 及其基线中的框架上下文偏差：将 HISUI 控件/API 与样式/资源索引同步到仓库总览和维护入口，修正 reference 跨目录路径及源仓/部署态 vendor 路径；反馈 `260718022936` 已标记为“已应用”并补齐问题发现过程和处理记录，根反馈模板与共享协议保持一致。
- 2026-07-18：修复 `extract-doc` 拆分后的专项测试 owner 漂移：`iris-interface-plugin.tests.ps1` 现从 `plugins/extract-doc/` 读取 requirements、环境检查和 parser，并显式传入接口输出目录及 `iris-interface-doc-ingest/v2` schema；同时恢复 ObjectScript 复合后条件正反例，使 `update-agents.tests.ps1` 与 owner rule/skill 一致。
- 2026-07-18：补齐 `e1e5761`、`621b633` 后遗漏的能力说明。`extract-doc` 承接通用文档解析，现名 `iris-interface-dev` 保留接口语义适配；`iris-external-reg` 提供第三方预约挂号接口开发编排并显式依赖 `extract-doc`、`coding-iris-plugin`。README、更新 runbook、插件接入说明和 targeted 回归已同步。
- 2026-07-15：基于 `#6097891` 将 agent-run contract 升级到 schema 1.2：新增 stage attempts、MCP capability matrix、远程动作终态、finalization 门禁和限定 verification scope；validator 保持 1.0/1.1 兼容，并新增暂停恢复、终态冲突、非终态远程动作、attempt 重叠及验证范围回归。同步修正 MCP 判定为 `check_config` 后执行 `SELECT 1 AS Probe`，自动发现成功时不因 `config_file=null` 阻塞，单次 404 不再扩大为整个 MCP 不可用；`iris-mcp.js` 已纳入安装/更新 sparse checkout。
- 2026-07-14：审计最近两次 feedback 提交。确认 `3131d97` 的 `FRAMEWORK_ROOT` 部署态路径修复已同步 canonical；将 `fc50477` 仅保存在反馈包中的 i18n Step 0、manifest schema 1.1、文件所有权、stale verifier、分类远程授权和 Windows PowerShell 5 兼容规则回归 canonical，并同步 owner 文档、P1 验证说明和专项测试。
- 2026-07-13：完成 `#6097879` 首次真实 multi-agent i18n 实战复盘。实战覆盖前后端、页面翻译、XML 模板、独立 Verifier 和运行 manifest，但发现模式中途切换、阶段时间事后重构、所有权未入 manifest、Verifier 后继续修改、远程授权询问过晚及 Windows PowerShell 5 环境变量兼容问题；P1 保持开放，不据此新增通用 workflow/Agent。
- 2026-07-13：`12e8539` 建立 `i18n-agent` P1 多模式运行协议：统一 `retrospective` / `serial` / `multi-agent`、编号 handoff、运行 manifest、授权和失败收敛规则；新增 `validate-agent-run.ps1` 及离线测试，并完成 `#6096150` 脱敏串行回溯。该回溯只证明串行与事后校验链路，真实多智能体实战仍留在 backlog。
- 2026-07-13：`98b09e6` 为 XML 打印模板同步补充临时类 `Execute+...<SYNTAX>` 自动识别与 Base64 分块 fallback，复用既有本地产物并在成功或失败时清理临时节点；专项离线测试覆盖内联成功、单次收敛、分块计数和失败清理。
- 2026-07-13：`7478f85` 将 `agent-framework-feedback` 升级为统一收尾 skill，分流需求经验与独立框架修正，并将收尾入口写入项目 AGENTS 模板；本轮维护同时修正共享反馈协议仍默认提交/推送的旧表述，统一为仅在用户明确要求时执行 Git 写操作。
- 2026-07-13：完成全仓维护体检：8 个插件 manifest 均可解析，现有 7 组专项测试全部通过；补齐 `imedicalxc-doctor-data-extraction` 和 `imedicalxc-doctor-print-template-design` 插件 README，修正维护记忆分层，并将后续治理队列重排为 P0-P3。
- 2026-07-13：修复 `update-agents.ps1 -Mode Check` 将不受支持的 `Check` 直接传给插件配置迁移脚本的问题；顶层 `Check` 现按只读语义映射为迁移 `DryRun`，并补充 `DryRun/Write/Check` 参数传递、unchanged 状态及 Check 不写 profile/thin-index 的回归覆盖。
- 2026-07-13：已将 vendor skill 链路改为按 enabled 插件 capability 解析：新增通用依赖 resolver，`imedicalxc-doctor-extend-engineer` 声明四个 required superpowers skill 和 DOC/DOCX 触发的 optional `word-reader`；安装/更新停止全量写用户目录，项目层只生成 required thin-index。更新器支持自身更新后安全重启、legacy profile 保守识别和显式 cleanup；Claude/Codex 用户级同步改为必须指定 runtime/skill，其他 Agent 工具通过 `.agents/skills` 或直接 vendor 源串行降级。
- 2026-07-11：已实现 coding-iris 前端编码 v2：新增 `standard-gb2312` / `project-utf8` 双模式和可选路径覆盖，实际文件字节检测作为最终门禁；新增 profile 自动迁移、已部署编码脚本 wrapper 迁移、严格 GB2312 转换、医院 UTF-8 直接导出与标版 staging 流程，并将插件迁移钩子接入 `update-agents.ps1`。coding/i18n rules、profile 模板、README、更新 runbook 和专项测试同步更新。
- 2026-07-09：已同步 2026-07-07 五个提交后的 vendor/skill 发现链路维护说明：`README.md` 和入口维护记忆已将“vendor 不参与 thin-index”旧表述替换为当前真实行为，即 `sync-vendor-skills.ps1` 同步 vendor skill 到 Claude Code 运行时目录并在存在 Codex skill 目录时覆盖 Codex，`generate-vendor-thin-index.ps1` 为 vendor skill 生成 `.agents/skills/<name>/SKILL.md`，`sync-claudecode-skills.ps1` 将项目 `.agents/skills/` 同步到项目 `.claude/skills/`。本轮同时修复 `generate-vendor-thin-index.ps1` 在 Windows PowerShell 下中文字符串解析失败的问题，并将 `scripts/tests/update-agents.tests.ps1` 改为复制真实脚本、覆盖 vendor thin-index 生成与 stale 清理、vendor runtime skill 三层去重和 Claude Code skill 同步阶段。该链路属于 skill 发现层适配；完整 `.codex/agents/`、`.claude/agents/`、`.opencode/`、`.codebuddy/agents/` 等工具原生 agent adapter 仍未实现。

- 2026-07-08：已新增提交前差异降噪 Git hook 分发链路：新增 `hooks/pre-commit`、`scripts/check-functional-diff.ps1` 和 `scripts/install-git-hooks.ps1`，安装/更新 sparse checkout 纳入 `/hooks/**`，`update-agents.ps1` 仅报告 `git-hooks-not-enabled` / `git-hooks-enabled` / `git-hooks-unavailable`，不自动修改业务项目 `core.hooksPath`。`docs/update-agents.md`、README、`project-context-maintenance` 和测试已同步。

- 2026-07-08：已修正维护者专用 `skills/agent-kit-maintenance/` 实际部署残留问题：`install-agents.ps1` 和 `update-agents.ps1` 的 sparse checkout 同时排除目录和目录内容；`update-agents.ps1 -Mode Write` 会兼容清理已部署项目中的 `.agents/skills/agent-kit-maintenance/` 并报告 `maintenance-only-skill-removed`。`docs/update-agents.md` 和 `scripts/tests/update-agents.tests.ps1` 已同步，更新脚本回归测试已通过。

- 2026-07-13：已修正 `coding-iris-plugin` 对 ObjectScript 命令后条件的空格约束：明确命令、冒号和完整复合条件必须连续书写，新增 `continue:(cond1)&&(cond2)` 正例与 `continue:(cond1) && (cond2)` 的 `#1012` 反例，并将检查项同步到后端 skill、插件 README 和专项回归测试。

- 2026-07-01：已修正 AI 落地项目安装入口闭环：README 不再要求首次安装前读取尚不存在的 `.agents/docs/update-agents.md`，而是先按 `.agents/` 状态分流并给出明确网络安装命令；`install-agents.ps1` 在业务项目缺少 `AGENTS.md` 时改为提示而非阻塞，`update-agents.ps1` 将 `agents-entry-missing` 降为后续项目上下文维护提示；`docs/update-agents.md` 和 `scripts/tests/update-agents.tests.ps1` 已同步。

- 2026-07-01：已补齐近期医生站能力插件维护记录和仓库 README 总览：新增 `imedicalxc-doctor-perf-analysis-engineer`、`imedicalxc-doctor-data-extraction`、`imedicalxc-doctor-print-template-design` 三个插件的能力摘要、入口和部署边界说明；同步记录 install/update Git 版本前置校验。上述插件仍遵循 `.agents/plugins/**` 全量拉取但以 `plugin_profile.md` 控制启用的边界。

- 2026-07-01：已新增维护者专用 `skills/agent-kit-maintenance/SKILL.md`，用于本仓库维护、插件提交同步、维护记忆更新和部署边界检查；该 skill 位于根 `skills/` 下，但安装/更新 sparse checkout 已排除 `skills/agent-kit-maintenance/`，不部署到业务项目 `.agents/`，不参与 thin-index。根 `AGENTS.md`、README、维护入口摘要和长期决策已同步说明。

- 2026-06-30：已完成近期提交文档同步：维护记忆、长期决策、backlog、仓库 README、`imedicalxc-doctor-extend-engineer` README/AGENTS 和主编排器 superpowers 缺失指引已同步到当前实际内容；补齐 `scripts/tests/update-agents.tests.ps1` 对 `sync-vendor-skills.ps1` 的测试夹具复制，避免 vendor skill 同步脚本缺失误触发 Action required。

- 2026-06-29：已完成 `imedicalxc-doctor-dbdata` 精简治理：`SKILL.md` 从大体量数据库查询规范收敛为核心领域知识入口，删除通用编码规范、输出模板和反模式长文，保留并强化医保对照、基础数据统一对照和合并查询（Merge Query）；医生站扩展主编排器补充合并查询快速参考，架构 skill 同步配置数据和合并查询引用。
- 2026-06-26：已完成 vendor skill 运行时同步链路与医生站扩展插件标准化：新增 `scripts/sync-vendor-skills.ps1`，`install-agents.ps1` / `update-agents.ps1` 可把 `vendor/superpowers/`、`vendor/word-reader/` 等 vendor skill 同步到运行时 skill 目录；`imedicalxc-doctor-extend-engineer` 迁入标准插件结构并补充 `AGENTS.md`、README、manifest 和 thin-index wrapper。
- 2026-06-26：已收敛 `imedicalxc-doctor-extend-engineer` thin-index 策略：wrapper 默认排除 8 个子 skill，只暴露 `imedicalxc-doctor-extend-engineer` 主编排器入口；子 skill 由主编排器通过插件内相对路径按需读取，避免浅层 skill 路由噪声。
- 2026-06-25：已新增信创版本医生站第三方接口开发智能体资料，后续重构为 `imedicalxc-doctor-extend-engineer` 插件标准目录。
- 2026-06-24：已更新内置 Windows x64 `iris-agentic-dev.exe` 到 v0.6.17，业务项目仍通过 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe` 获取可执行文件，连接事实仍只允许留在目标工程本地配置。
- 2026-06-24：已完成当时名为 `iris-interface-dev` 的 v1.2 格式接入稳定化回归：XLS/XLSX 多 sheet、DOC 转 DOCX 降级路径、DOCX 入参/出参分段与字段契约、PDF 轻量抽查均已验证；长期路线图现为 `memory/plan/iris-interface-dev-roadmap.md`，替代旧 `iris-interface-v1-summary-v2-plan.md` 作为后续会话入口。真实样本和解析产物仍只保留在 `tmp/iris-interface-file/`，不入库。
- 2026-06-24：已完成 `iris-interface-dev` v2.0 Task 0 字段匹配闭环：新增 `iris-interface-field-match.py`，从 `parsed.json` 生成 `field-match.json` 和 `field-match.md`；匹配来源区分 `builtin-rule`、`local-feedback`、`low-confidence-candidate` 和 `unmatched`，并限制控制台只输出路径与数量。`--feedback` 只读取目标项目本地 JSON，不写回插件仓库；插件专项测试已新增 synthetic fixture 覆盖四类匹配结果和控制台不泄漏字段明细。
- 2026-06-24：已完成 `iris-interface-dev` v2.0 Task 0 接口文档解析经验回归提升：`feedback/experience/iris-interface-dev-com-exp.md` 新增 XLS/XLSX 多 sheet、DOCX 入参/出参、PDF 混合表、PDF 跨页续表、错误码/修订记录/JSON 示例过滤和 DOC 转 DOCX 优先级经验条目，并标记已提升到 `scripts/tests/iris-interface-plugin.tests.ps1`；解析器补强 JSON 示例行过滤 synthetic 回归。已通过插件专项测试、仓库更新回归和插件敏感词扫描；真实工程默认输出路径仍为 `docs/output/iris-interface/<doc-name>/`，本地 `tmp/iris-interface-file/` 仅作维护回归证据且不入库。
- 2026-06-24：已完成 `iris-interface-dev` v2.0 Task 0 字段契约追溯模型：`parsed.json` 升级为 `iris-interface-doc-ingest/v2`，字段新增 `rawColumns`、`sourceLocation`、`classification`、`confidence`、`warnings`、`requiredReason` 和 `jsonPathReason`；`fields.md`/`diagnostics.md` 增加追溯摘要与统计。已通过插件专项测试、仓库更新回归和真实接口文档本地回归；真实摘要保留在 `tmp/iris-interface-file/test-results/iris-interface-v2-task0-real-doc-test-summary.md`，真实文档与解析产物不入库。
- 2026-06-23：根据三份样本文档验证结果，补强 `iris-interface-dev` 解析前环境引导：新增 `iris-interface-env-check.py`，把缺依赖/缺转换器从“失败告知”改为可执行安装建议；`requirements-optional.txt` 新增 `xlrd`，`.xls` 安装 `xlrd` 后可直接解析，XLSX/XLS 多 sheet 按 sheet 拆成独立字段视图。
- 2026-06-22：已完成 `iris-interface-dev` v1.1 PDF 解析质量补丁：收紧表头匹配，过滤修订记录和错误码表，支持 PDF 跨页续表继承上一字段表表头。真实样本 `综合药房 HIS 处方推送接口使用说明_5000.pdf` 重新解析后为 9 个视图、79 个字段，Page 17/18/19 续表缺失字段已补回。
- 2026-06-22：已完成 `iris-interface-dev` v1 基线并入，来源工程审计基线为 `https://gitee.com/soneakeko/agent-architecture.git` commit `43e12b345c58ba11a48980828503daf29ae309ec`。插件采用解析审计优先边界，提供接口文档落盘解析、字段结构化、字段诊断、开发计划和离线审查入口；IRIS/ObjectScript 编码、上传、编译、部署和远端验证继续复用 `coding-iris-plugin`。
- 2026-06-22：`iris-interface-dev` v1 明确不迁移来源大生成器和大体量规则库；`rules/` 仅放路由、流程、审查门禁和轻量规则，来源规则/wiki 资产先进入审计清单或 `references/` 候选。新增 `requirements-optional.txt` 只声明 `python-docx`、`pdfplumber`、`openpyxl`、`markitdown` 可选依赖，不 vendor、不自动安装。
- 2026-06-17：已将 Windows x64 `iris-agentic-dev.exe` 内置到仓库根 `vendor/iris-agentic-dev/windows-x64/`，业务项目通过既有 `/vendor/**` sparse checkout 自动获得 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe`。coding-iris 插件 README、AGENTS、初始化模板、`project-env.template.json`、MCP 规则和脚本说明已同步默认路径；连接事实仍只允许留在目标工程 `.mcp.json`、`.iris-agentic-dev.toml` 或环境变量。
- 已新增 IRIS 远端部署编排入口 `plugins/coding-iris-plugin/skills/iris-deploy/SKILL.md`，将部署、上传、编译、SFTP 同步、CSP 编译和部署验证统一路由到部署 skill，并继续以 `rules/iris_deploy_checklist.md` 作为逐项执行清单。
- 已新增薄通用脚本 `plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js`，用于根据文件列表或 git diff 生成 IRIS 部署 JSON 清单；脚本只做本地分析，不执行上传、编译或远端写入。coding 插件 README、AGENTS、目标工程 snippet、manifest prompt 和 `iris_coding_workflow.md` 已同步更新。
- 已继续回归 `feedback/experience/demand-com-exp.md` 中建议提升的需求经验：`iris_coding_backend.md` 新增 `%Persistent` 字段追加、Storage 不手改和 Insert/Update/Import SQL 同步规则；`iris_coding_frontend.md` 新增 HisUI DataGrid 插列后 editor/列下标检查规则；`i18n_verify.md` 新增字典展示值验证必须覆盖主方法调用子方法的检查项。对应经验条目已追加“已回归/已提升”标记。
- IRIS/HIS 前端编码保护当前统一为 canonical `utf8`；标版与医院项目源码、上传内容和服务器运行编码均为 UTF-8。旧模式仅按迁移兼容边界读取，实际文件字节检测仍是最终门禁，i18n 规则复用同一检查脚本。
- 已将 HISUI 源码内置到仓库根 `vendor/hisui/dist/`，消除 `${HISUI_SRC}` 变量间接层；所有插件规则、skill 和模板统一指向 `.agents/vendor/hisui/`，删除两套 profile 模板中的 `HISUI_SRC` 字段。`install-agents.ps1` 和 `update-agents.ps1` 的 sparse checkout 新增 `/vendor/**`。coding-iris-plugin 和 i18n-iris-plugin 共约 12 个文件已同步更新。
- 已增强 plugin skill thin-index：`scripts/generate-plugin-thin-index.ps1` 生成 `.agents/skills/<skill>/SKILL.md` 时会传播真实 `SKILL.md` 的 `name` 和 `description`，并写入 `thin-index: true` 与 `source`。浅层 skill description 用于能力发现，匹配后仍必须继续读取插件真实 `SKILL.md`。
- 已完成 `SKILL.md` 渐进式披露轻量约束治理：真实 `SKILL.md` 的 frontmatter `description` 已收敛为 `Use when...` 触发条件句；正文补充基础入口优先、按条件继续读取 rules/references/config/MCP 的路由说明。本轮未给 skill 引入 `task-affinity`，仍保持 skill 发现依赖 `description` 与正文路由。
- 已完成 frontmatter/task-affinity 最小治理：为插件 `rules/` 和 `references/` Markdown 补充最小 frontmatter 与 `task-affinity`；`scripts/generate-plugin-thin-index.ps1` 可从源 rule 传播 `name`、`description`、`task-affinity`、`related`，并在 rule thin-index 中写入 `thin-index: true` 和 `source`。本轮不把 `skills` 纳入 `task-affinity` 元数据体系。
- 已新增框架验证反馈机制：`feedback/framework/` 反馈目录、反馈模板、`agents/_shared/feedback-protocol.md` Agent 反馈行为指引；`i18n-agent` 和 `i18n-change.workflow.md` 在完成条件中引用反馈协议；新增 `skills/agent-framework-feedback/SKILL.md` 通用反馈 skill，支持 plugin 直接使用场景。Agent 处理 HIS 需求时如对框架文件做了修正，自动生成反馈条目；维护者定期读取反馈、diff 后应用到 master。
- 已新增 `feedback/experience/deploy-com-exp.md` 和 `docs/deploy/dental-ta-159/` 首个部署经验/工具样例，用于沉淀全量部署流程、前后端部署脚本和专项计划；维护记忆只记录边界，不复制业务细节或连接信息。
- 已新增 `demo/presentation/` 演示页，包括 i18n 能力摘要、多智能体架构预览和演示首页，用于展示能力包思路；该目录当前不在安装/更新 sparse checkout 运行边界说明内。
- 已修复 `sync-xml-print-template.ps1` JsonLine framing 中文编码问题，并新增/保留相关语言测试，避免中文输出在跨进程传递时损坏。
- 已新增多智能体架构设计 `memory/plan/multi-agent-architecture.md`，明确厂商无关 canonical `agents/` / `workflows/`、工具 adapter 边界、模型档位、生成层、本地定制、版本演进和新增智能体 checklist。
- 已新增顶层 `agents/` 与 `workflows/` 首批 canonical 样板：`agents/agent-registry.md`、`agents/_shared/handoff-protocol.md`、`agents/i18n-agent/AGENT.md`、`agents/i18n-agent/bindings.yaml`、`workflows/workflow-registry.md`、`workflows/i18n-change.workflow.md`。
- 已新增交接报告模板：事实报告、分类清单、变更摘要、验证报告，用于阶段化或多智能体交接。
- 已将 `i18n-workflow-decompose.md` 的五阶段愿景落地为 `i18n-agent` 和 `i18n-change.workflow.md` 样板，阶段为 Explorer、Classifier、Coder、Template/Seed、Verifier。
- 已明确 `agents/` 和 `workflows/` 是能力包正式内容，不属于 `.agents/.git/info/exclude` 生成层；后续需要纳入安装/更新脚本 sparse checkout。
- 已新增 coding 插件统一编码入口 `iris-coding`，并同步更新插件入口、README、目标工程 snippet 和 manifest prompt；后端、前端和 GB2312 promote 专项 skill 保持兼容。
- 已新建 i18n 链路定位规则 `rules/i18n_link_tracing.md`、数据分类规则 `rules/i18n_field_classification.md`、验证规则 `rules/i18n_verify.md`，补全五阶段工作流的规则缺口。
- 已更新 `i18n-coding` skill 为阶段化入口，新增阶段化执行引导和必读规则引用，并在产出段落增加需求完成后的经验沉淀引导。
- 已优化 `feedback/experience/demand-com-exp.md`：新增领域标签和需求索引维护规则，在文档末尾追加需求索引章节，支持锚点跳转。
- 已修正 `i18n_coding_print_backend.md` 入口措辞，从"打印 JSON"收敛为"实际打印返回数据"，并引用链路定位规则。
- 已补充 `i18n-xml-print-template-sync` 的触发前置约束：必须先通过链路定位确认存在 XML 模板记录。
- 已补齐 `i18n-iris-plugin/AGENTS.md` 的 Skill 路由和规则入口。
- 已在 `feedback/experience/demand-com-exp.md` 中标记被提升的经验条目和反哺规则。
- 已将 coding 插件的 HISUI 控件索引从 rule 层迁移为 `references/hisui-widget-index.md`。
- 已更新 coding 插件入口、README、前端 coding skill 和规则索引，使 HISUI 控件参考只在控件选型或 API 不确定时按需读取。
- 已在 coding 插件 manifest 中声明 `references: references/`。
- 已增强 coding 和 i18n 插件 thin-index 脚本：重建时可识别并清理由本插件旧版本生成、但源文件已从 `rules/` 移走或被重命名的 stale rule thin-index。
- 已在仓库 README 和 coding 插件 README 中补充已部署 `.agents` 的同步说明。
- 已拆分 `iris_coding_workflow.md`，新增 `iris_deploy_checklist.md` 和 `iris_gb2312_workflow.md`，降低非部署任务加载成本。
- 已精简 `sftp_server.md` 的通用部署重复内容，并精简 `i18n_index.md` 的总原则。
- 已在 workspace kit 文档和 reusable packaging skill 中补充插件内 `references/` 约定。
- 已在 workspace kit 文档、reusable packaging skill、仓库 README 和维护记忆中明确 rules/skills/references/scripts 命名约定。
- 已将历史异常 rule 文件名统一为 snake_case：`iris_agentic_dev.md`、`sftp_server.md`、`i18n_hisui_widget_index.md`，并更新相关 AGENTS、README、rules、templates 引用。
- 已将 thin-index 生成逻辑收敛到根 `scripts/generate-plugin-thin-index.ps1`；各插件同名脚本只作为 wrapper 转发参数，避免插件之间运行时绑定。
- 已确认边界：插件之间不应互相依赖；独立分发单个插件时，若使用 `plugin-reference-thin-index`，必须同时携带根 canonical 脚本，否则选择 `copy` 或手工 thin-index。
- 已新增根目录 `index.html` 作为 AI Coding 外骨骼架构可视化展示页，并通过 `.github/workflows/pages.yml` 和 `.nojekyll` 发布到 GitHub Pages。
- 已明确双远端维护约定：`origin` 为 Gitee 主仓库，日常维护、业务项目 `.agents` 部署和安装脚本以此为准；`github` 为 GitHub 镜像仓库，主要用于 GitHub Pages 展示页发布。
- 根目录 `index.html`、`.github/` 和 `.nojekyll` 只服务展示页和 GitHub Pages；当前安装脚本 sparse checkout 只检出 `docs/`、`rules/`、`skills/`、`plugins/`、`scripts/`，不会把展示页文件部署到业务项目 `.agents/`。
- 已新增统一更新脚本 `scripts/update-agents.ps1` 和托管更新 runbook `docs/update-agents.md`，用于已部署业务工程更新 `.agents` 能力包、维护生成层 ignore、重建 plugin thin-index 和合并明确缺失的 config 项。
- 已更新 `project-context-maintenance`：安装或更新 `.agents` 时优先读取 `docs/update-agents.md`；更新脚本不得自动重写 `AGENTS.md`、项目 memory、项目 rules 或已有 config 值。
- 已将 `AGENTS.md` 规范调整为必须唯一主入口；`CLAUDE.md`、`CODEBUDDY.md` 只作为可选兼容入口，缺失或异常只报告，不自动修复或复制第二份规则。
- 已增强 canonical thin-index stale 清理：支持识别插件源规则重命名、移走或删除后遗留的浅层入口，避免目标工程 `.agents/rules/` 长期残留过期索引。
- 已完成多 Agent v0.2.0 最小部署闭环：安装/更新 sparse checkout 包含 `agents/` 和 `workflows/`，`i18n-agent` 明确插件初始化前置，通用 Agent 和 adapter 生成器顺延为后续阶段。
- 已实施插件状态分流：`.agents/plugins/**` 全量拉取用于能力发现，`update-agents.ps1` 按 `plugin_profile.md` 将 `available`、`enabled`、`disabled` 分流处理，默认只处理 `agent-context-kit`；旧 `initialized` 兼容读取为 `enabled`，旧 `indexed` 兼容读取为 `available`。
- 已新增 `scripts/update-plugin-profile.ps1`，供插件 init skill 在验收通过后机械反写 `plugin_profile.md`，避免不同模型手工编辑表格。
- 已在插件 manifest 中补充 `initSkill`，并为 `i18n-iris-plugin` 声明对 `coding-iris-plugin` 的依赖；`update-agents.ps1` 对未初始化依赖输出 `plugin-dependency-missing`。
- 已新增独立 `scripts/generate-agent-thin-index.ps1`，并接入 `scripts/update-agents.ps1` 的 `agent-thin-index` 阶段；已部署业务项目常规 DryRun/Write 可生成 `.agents/skills/<agent-name>/SKILL.md`，当前用于把 `i18n-agent` 暴露给只发现浅层 skill 的 Agent。
- 已明确本轮不做工具专属 adapter；Codex、Claude Code、OpenCode、CodeBuddy 原生入口仍暂缓，agent thin-index 只做 canonical 路由，不复制插件规则全文。

## 近期提交索引

- `ca310db`：增强 HISUI 样式优先复用规则，拆分控件/API 与 CSS 样式/资源索引。
- `621b633`：新增 `iris-external-reg` 第三方预约挂号接口开发插件，并继续完善 `extract-doc`。
- `e1e5761`：将通用文档解析拆分为 `extract-doc`，`iris-interface-dev` 改为接口语义适配层，并新增 coding-iris CSP 模板。
- `12e8539`：建立 i18n-agent P1 多模式运行协议、运行 manifest、事后校验器和脱敏回溯产物。
- `98b09e6`：XML 打印模板同步新增临时 `<SYNTAX>` 自动分块 fallback 与离线回归。
- `7478f85`：升级 `agent-framework-feedback` 为统一收尾 skill，并沉淀条件分支经验。
- `58339ee`：新增维护者专用 `agent-kit-maintenance` skill，并排除业务项目部署。
- `364f594`：`install-agents.ps1` / `update-agents.ps1` 新增 Git 版本前置校验，并同步 runbook 与测试。
- `3e0f580`：新增 `imedicalxc-doctor-print-template-design` 插件，提供打印模板设计与 `.xlsx` 模板生成工作流。
- `b655c1a`：新增 `imedicalxc-doctor-data-extraction` 插件，提供数据抽取与第三方接口对照文档生成工作流。
- `05bfa75`：新增 `imedicalxc-doctor-perf-analysis-engineer` 插件，提供接口性能分析、Graylog 诊断、前后端优化和报告输出能力。
- `b802ac9`：同步 vendor skill 运行时链路与医生站扩展插件文档到当前状态。
- `5ea2910`：精简 `imedicalxc-doctor-dbdata` skill，并同步医生站扩展主编排器和架构引用。
- `3512d7c`：迁移 superpowers skills v6.0.3 到 `vendor/superpowers/`。
- `920e75b`：`imedicalxc-doctor-extend-engineer` thin-index 只暴露主编排器入口。
- `9647f86`：补充 `imedicalxc-doctor-extend-engineer` 插件 thin-index wrapper。
- `6bbb95e`：清理医生站扩展插件旧版目录文件。
- `cd57f56`：新增 vendor skill 运行时同步脚本，并重构医生站扩展插件标准结构。
- `045eecf`：新增信创版本医生站第三方接口开发智能体资料。
- `16bc2d6`：更新内置 `iris-agentic-dev.exe` 到 v0.6.17。
- `6dcccca`：完成 `iris-interface-dev` 字段匹配闭环文档归档与测试补强。
- `4731854`：新增 agent skill thin-index 生成脚本，并集成到 `update-agents.ps1` 流水线。
- `3cc5616`：新增首个部署经验文档和专项部署工具目录。
- `8e4cfca`：新增 `demo/presentation/` 演示展示页面。
- `ccc96bf`：新增 `agent-framework-feedback` 通用反馈 skill。
- `b796f13`：补充字典翻译检查需覆盖被调用子方法经验。
- `e1876cd`：新增 i18n 前端编码与字典翻译经验条目。
- `ee4d08f`：为 GitHub Pages 展示页添加 inline SVG favicon。
- `c6f2508`：升级展示页视觉体验与内容结构。
- `9694509`：新增框架验证反馈机制。
- `f7e14c7`：修复 XML 打印模板同步脚本 JsonLine 中文编码问题。
- `38f0aed`：实施插件状态分流与 `plugin_profile` 机制。
- `02d7e84`：新增 AI Coding 外骨骼架构可视化页面。
- `d61ea96`：将架构可视化页面重命名为根目录 `index.html`。
- `c2281ef`：新增 GitHub Pages workflow 和 `.nojekyll`。
- `4956e7b`：启用 GitHub Pages 权限。
- `95e596b`：README 补充双远端同步说明。
- `1cc1ac7`：新增统一更新脚本 `scripts/update-agents.ps1`。
- `6ae4277`：新增托管更新 runbook 和 `update-agents` 摘要视图。
- `0a932d7`：收敛唯一主入口、可选兼容入口和 stale thin-index 清理。

## 最近验证

- 2026-08-04：迁入 `codegraph-query` 和 `iris-codegraph` 插件；补齐 manifest、AGENTS、README、usage rule、skill 和 thin-index wrapper，并同步仓库 README、runbook、维护记忆和 update-agents 测试。已验证 `.codegraph` 状态 complete，`cg-query.js help`、`icg-query.js help`、`node --check` 均通过；`iris-codegraph` 构建因当前项目缺少 `.mcp.json` 未执行。后续确认 `codegraph-query` 依赖 `iris-codegraph`，并把该前置关系写回 manifest、plugin_profile 和回归断言。

- 2026-07-18：`scripts/tests/update-agents.tests.ps1` 与 `scripts/tests/iris-interface-plugin.tests.ps1` 已通过；后者统一使用 `python -B`，不再在 owner 脚本目录遗留 `__pycache__`。`coding-iris-plugin`、`extract-doc`、`iris-external-reg` thin-index DryRun 均成功，反馈 `260718022936` 的 8 个 owner 副本与 canonical 逐文件一致，`git diff --check` 通过。
- 2026-07-13：`plugins/agent-context-kit/scripts/tests/validate-agent-run.Tests.ps1` 已覆盖合法串行/多智能体运行、未授权多智能体、缺失报告、同签名重试超限、未授权远程写入、阶段依赖、并行效率和敏感内容门禁；`maintenance/validation/i18n-agent-p1/retrospective-6096150` 已通过校验。
- 2026-07-13：`plugins/i18n-iris-plugin/scripts/tests/sync-xml-print-template.Tests.ps1` 已覆盖内联保存、临时 `Execute+...<SYNTAX>` 识别、分块 fallback 和成功/失败清理。
- 2026-07-01：已检查近期提交 `05bfa75`、`b655c1a`、`3e0f580`、`364f594`、`58339ee` 的变更范围；确认三个新增医生站插件均包含 `.agents-plugin/plugin.json`、`AGENTS.md`、主 `SKILL.md` 和 thin-index wrapper，其中性能分析插件额外包含 README、init skill、脚本和 references。已通过 `rg` 检查 README 与维护记忆中的旧插件总览缺口，并完成摘要同步；本轮不复制大段插件正文或业务私有事实。

- 2026-06-30：本轮文档同步已执行一致性搜索，确认 `README.md`、`plugins/imedicalxc-doctor-extend-engineer`、`memory` 和 `docs` 下不再残留旧版 superpowers 安装方式和旧子 skill 暴露数量等过期表述；路径检查确认 `vendor/superpowers/skills/brainstorming/SKILL.md`、`vendor/word-reader/SKILL.md` 和医生站扩展插件 thin-index wrapper 均存在；`scripts/sync-vendor-skills.ps1 -AgentsRoot . -Mode DryRun` 可枚举 superpowers 与 word-reader vendor skill；`scripts/tests/update-agents.tests.ps1` 已通过。仓库根误产物 `%SystemDrive%/` 已确认位于 workspace 内并清理。

- `scripts/tests/iris-interface-plugin.tests.ps1` 与 `scripts/tests/update-agents.tests.ps1` 已验证：`iris-interface-doc-ingest.py` 支持 PDF 表内请求/响应分段、嵌入表头、空首列参数名识别、签名字段 `signature.*` 归属和 JSON 示例行过滤；真实 `移动APP接口对接文档（光华口腔）v1.1.3.pdf` 回归为 `ViewCount=16`、`TotalFields=81`、`JsonPathCount=80`、`request=18`、`response=55`、`signature=4`，Page 7-14 可按 `n_type` 标识区分请求/返回视图。
- `scripts/tests/iris-interface-plugin.tests.ps1` 已验证：环境自检脚本、可选依赖清单 `xlrd`、XLSX 多 sheet 解析、字段续表/JSON 路径回归和点号循环审查门禁正常。
- `scripts/tests/iris-interface-plugin.tests.ps1` 已验证：v1.1 解析器回归覆盖修订记录过滤、错误码表过滤和续表继承字段表头；真实 PDF 样本手动验证 Page 17/18/19 缺失字段已补回。
- `scripts/tests/iris-interface-plugin.tests.ps1` 已验证：`iris-interface-dev` manifest、skill/rule 入口、可选依赖清单、thin-index dry-run、XLSX 标准库解析落盘、输出目录迁移、`references/` 排除和点号循环审查门禁正常。
- `scripts/tests/update-agents.tests.ps1` 已验证：插件 legacy name 状态迁移、stale rule/skill thin-index 清理、安装/更新、插件状态和 agent thin-index 流程正常。
- `scripts/tests/iris-deploy-manifest.tests.ps1` 已验证：`prepare-deploy-manifest.js` 可从目标项目 `project-env.json` 读取 namespace/web 路径，按 `.cls`、`.csp`、`.js` 生成稳定 JSON 清单，并兼容 PowerShell UTF-8 BOM 配置文件。
- `scripts/generate-plugin-thin-index.ps1 -PluginPath plugins/coding-iris-plugin -ProjectRoot . -Mode DryRun` 已验证：新增 `iris-deploy` skill 可生成 `.agents/skills/iris-deploy/SKILL.md` thin-index 计划。
- `scripts/tests/update-agents.tests.ps1` 已验证：新增部署 skill 和脚本说明未破坏现有更新、thin-index、插件状态和 agent thin-index 流程。
- `scripts/tests/frontend-encoding.tests.ps1` 已验证：GB2312 中文前端文件在 `-ExpectedEncoding gb2312` 下通过；UTF-8 中文文件在同一策略下返回错误退出码，用于拦截编码漂移。
- `scripts/tests/update-agents.tests.ps1` 已验证：现有更新、thin-index、插件状态和 agent thin-index 流程未受前端编码护栏变更影响。
- `scripts/tests/update-agents.tests.ps1` 已验证：skill thin-index 会传播真实 skill `description`，写入 `thin-index: true` 和 `source`，且仍不传播 rule `task-affinity`。
- 已检查 16 个真实 `SKILL.md`：frontmatter `description` 均以 `Use when` 开头，正文均包含按条件读取或渐进式读取提示。
- 已搜索确认 `plugins/` 和 `skills/` 下的 `SKILL.md` 未新增 `task-affinity`。
- `scripts/tests/update-agents.tests.ps1` 已验证：rule thin-index 可传播源 frontmatter 中的 `task-affinity`、`description` 和 `source`，无 frontmatter 的 legacy rule 仍兼容生成，skill thin-index 不传播 rule 任务亲和元数据。
- `scripts/generate-plugin-thin-index.ps1 -PluginPath plugins/coding-iris-plugin -ProjectRoot . -Mode DryRun` 已验证 coding 插件 rule/skill thin-index 生成计划正常。
- `scripts/generate-plugin-thin-index.ps1 -PluginPath plugins/i18n-iris-plugin -ProjectRoot . -Mode DryRun` 已验证 i18n 插件 rule/skill thin-index 生成计划正常。
- 已检查 `i18n-agent` / `i18n-change.workflow.md` 引用的 i18n 插件 rules 和 skills 均存在。
- 已检查新增 `agents/`、`workflows/` 文件无 `TODO` / `TBD` 占位；`待确认` 仅作为交接协议和 config 合并策略术语出现。
- 已确认 `memory/plan/multi-agent-architecture.md` 与实际新增报告模板命名一致。
- coding 插件 thin-index dry-run 已确认不再生成 HISUI 控件索引的 rule 入口。
- 构造旧版 HISUI rule thin-index 后，coding 插件脚本 dry-run 可标记 `stale`，Write 模式可移除旧入口。
- 搜索旧 HISUI rule 路径已无残留引用。
- coding 插件 thin-index dry-run 已确认新增 `iris_deploy_checklist.md` 和 `iris_gb2312_workflow.md` 规则入口。
- 搜索确认 `references/` 规范已写入 workspace kit 文档和 reusable packaging skill。
- 搜索确认 rules/skills/references/scripts 命名约定已写入 workspace kit 文档、reusable packaging skill、仓库 README 和维护记忆。
- 搜索确认 thin-index canonical/wrapper 约定已写入 workspace kit 文档、reusable packaging skill、插件 README 和维护记忆。
- `scripts/tests/update-agents.tests.ps1` 已验证：默认只处理 `agent-context-kit`，未启用插件只列为 available，显式插件可处理，i18n 在 coding 未初始化时阻塞，安装/更新 sparse checkout 包含 `agents/` 和 `workflows/`。
- 已验证三个插件 manifest 均可被 PowerShell `ConvertFrom-Json` 正常解析。
- `scripts/tests/update-agents.tests.ps1` 已验证：`update-agents.ps1` 可调用 agent thin-index 阶段，Write 模式生成 `.agents/skills/i18n-agent/SKILL.md`，入口指向 canonical `AGENT.md`、`bindings.yaml` 和 `i18n-change.workflow.md`，且不生成工具 adapter 内容。

## 维护要求

- 后续完成每轮维护后，更新本文件的近期已完成、提交索引和最近验证摘要。
- 不记录一次性命令输出、短期失败日志或可从 Git 历史直接恢复的完整流水。

## 2026-09-15 前端确定性部署入口

补齐 deploy-frontend.js、upload-batch.py 与显式指纹校验；固定上传回读后编译，失败不重试。专项 Node 21 项、Python 25 项通过；未执行本轮服务器写入，业务副本尚未同步。

2026-09-15：更新自动刷新既有标准 SFTP 启动参数为 vendor，不要求 runtime opt-in；保留解释器、env、disabled 和其它服务。显式 custom 或自定义参数不覆盖，不创建缺失服务，不安装 Python 依赖。SFTP 迁移专项 8 项、组件版本治理 16 项和完整 `update-agents.tests.ps1` 均通过，工作区版本校验覆盖 15 个组件。

## 2026-09-15 医生站 AI 集成插件

本地提交 `e88ea62` 新增 iris-imedical-doctor-ai 0.1.0，提供初始化/开发入口、现行能力发现、诊断与共享业务服务集成方法、可变原型映射、集成分析模板及可选只读元数据检查。复用 coding-iris-plugin，不固定工程路径、框架接口、持久化枚举或原型流程。

专项测试 10 项、组件版本测试 16 项通过，专项包含 PS7/PS5.1 thin-index；两份 skill 与引用检查通过。非本机平台 CI 和真实 HIS 联动验收仍待执行。未安装或部署业务副本。

### 同日维护同步复核

复核 `e88ea62`：原提交已包含插件说明、发布记录、接入文档、三份维护记录与专项测试，但 README 入口分散、维护摘要组件数量过期，更新指南缺少初始化路由。现将插件纳入 README 概览和接入列表，校正为 14 个插件及 2 个独立 skill，补齐更新指南、长期资料边界和提交索引；菜单/wiki 接入列为待样本评估，不记作已实现。仅维护文档，无插件内容、版本、安装器或业务副本变更。

本次复核：文档入口链接与差异格式检查通过，组件版本快照校验覆盖 16 个组件，组件治理 16 项测试通过并记录可复用证据；本轮生成的 30 个测试目录已核实内容并清理。
相对 HEAD 的 worktree 版本差异校验通过（16 个组件）。

- 2026-09-18 知识库发现入口补齐：agent-context-kit 0.3.4 模板与维护流程按 enabled/入口可达条件合并工程 AGENTS 简短指引；与 coding-iris-plugin 0.13.1 自主查询规则一同交付。普通更新不覆盖业务入口，本轮未部署业务副本。

- 2026-09-18：iris-imedical-doctor-ai 0.2.1 补充通用 UI 布局、图标对齐、状态按钮与组合动作语义，扩充运行态验证矩阵；项目动作码、具体布局和业务决定不进入插件。文档变更，无运行器或安装机制变化，业务副本未同步。

- 2026-09-18：coding-iris-plugin 0.13.3 将 HISUI 原生控件状态复用细化为通用前端约束，覆盖冲突排查与状态组合验证；同步 frontend skill、README 和发布说明。纯指导资料变化，业务副本未同步。

## 2026-09-23 医生站 AI 迁移验证增强（未提交）

iris-imedical-doctor-ai 0.3.0 新增迁移行为契约、入口对照模板与 async-contract-probe 测试辅助。同步主入口、使用指南、发布记录及三平台 Node 22/24 CI。Windows Node 24 源仓专项 14/14 通过（含 PS7/PS5.1 thin-index）；工具支持可控回调、事件记录和隔离旧缺陷反例，不定义业务完成策略。目标工程独立记录实际实现回归，源仓无业务数据。版本审计识别本次 0.2.2→0.3.0，无本次组件报错；完整审计仍受其它组件既有发布记录问题影响。非 Windows/Node22 CI 与真实设备验证沿用 P2 队列；未同步业务插件副本、提交或推送。

## 2026-10-09 提交 upstream 检查去重

coding-iris-plugin 0.15.2 在成功 pull 及快照校验后，仅向 commit 传入 hooks.requireUpToDate=false；其他全局检查保持，local-only 不设置。通过5项定向流程测试及2项既有消息测试。Windows 验证；macOS/Linux 待执行。未改安装器或全局钩子；插件入口与范围不变，能力手册无新增条目。

本轮工作区版本检查识别0.15.1→0.15.2，无本插件错误；完整检查仍被未改动组件的既有发布记录问题阻断，不宣称全仓通过。当前授权工程已定点同步实现及协议，未提交或发布。
