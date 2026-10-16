# imedical.agents 后续治理队列

- P2 MCP helper：新增 CLI 专项已加入 Windows/macOS/Linux × Node 22.5/22/24 既有矩阵，待取得 CI 结果；已部署业务副本正常更新后验证规则实际加载与调用轮次。Windows bundled schema 实测不替代业务连接验证。

- P2 需求迁移扫描边界：嵌套 Git/worktree/Agent 上下文与符号链接的非 Windows CI 及部署更新后复验沿现有跨平台/业务副本队列推进；源仓只读检查不代替完整更新验收。

## P1 可重复验收真实接入

- P1 夜跑 2.1 项目试点：按正常更新流程接入已授权业务工程，至少一条后端、一条 UI 和一条跨仓需求重复运行；启动前集中取得全部必需授权，启动后无新增人工授权，核对角色、正常入口、实际视口/选择/上传、联合版本、共享部署回读复用、回执、计时和资源退出。缺授权或能力时保留断点；合成夹具通过不能宣称真实无人值守。随后完成最多10个新候选的独立审查/用户验收对照和固定抽验校准，国产模型映射试验在流程稳定后推进。

1. **P1**：在明确授权的目标工程核实无业务写入的同会话保活端点、空闲时限及有效请求判据，完成无心跳/有效操作/心跳/停止后超时/失效恢复对照。未通过前保持心跳禁用；优先于扩并行与批量调度。
2. **P1**：按 docs/night-acceptance.md 在已授权项目分别接入纯后端和 UI 需求并重复执行；核验实际入口、消费者兼容、实际加载版本、业务回读、请求归属与资源退出。已有 Windows 合成后端/无头 UI/心跳对照不能替代真实接入；记录分阶段耗时与人工介入。
- P2 测试数据成本：同一已授权项目、用例、角色和规模，对保留复用、必要重置、删除重建各完成至少三轮完整周期；记录准备/执行/独立读回/处置/退出/人工介入和数据增长，再选择项目策略。归属/租约与共享父记录副作用先核实；不预设统一清理默认值，合成计时不作为清理收益结论。

3. P2：取得 night-acceptance CI 的固定依赖下载、Windows/macOS/Linux × Node 22/24 及最低 22.5.0 bundled Chromium 和可用 Agent 宿主的实际结果；不支持后台定时或子 Agent 的宿主验证恢复前检查与串行降级。


- P2 Overlay 部署继承：Windows 本地验证后仍需 CI 在 macOS/Linux 的矩阵验证；导出/Broker/配置生成未纳入本轮部署继承范围。

本文件记录 `imedical.agents` 能力包仓库的后续计划、暂缓事项和治理优先级。入口摘要见 `agent-kit-maintenance-memory.md`，长期决策见 `agent-kit-maintenance-decisions.md`，近期维护流水见 `agent-kit-maintenance-log.md`。

## P2 技能链接适配待验证

- P2 可用性依赖：取得 Windows/macOS/Linux × Node 22/24 CI 与真实宿主按阶段加载的证据；重点核对缺失仅停止相关阶段、Overlay 状态来自 ContextRoot。未同步真实业务工程。

- P2 连续人工验收：取得 demand-acceptance 在更新后的真实宿主发现/调用与 Windows/macOS/Linux × Node 22/24 的实跑证据；用已有授权的合成批次核对连续结论接收、未知 BOS 恢复与共享远端推进；覆盖明确调用的完整交付授权传递、自动加载/查询不写入、暂停与旧批次授权恢复，以及默认当前工作区、--worktree/-worktree 裸参数与指定路径、自然语言来源、映射冲突和合入后补验。当前本地隔离提交和回执测试不代表服务端幂等或真实项目已更新。沿既有需求交付验证队列，不新增前置审批。

- P2 需求迁移编排：外部注册表适配及逐工作区 Write/Check/项目验证器联合验收由目标项目执行；框架只提供启用差异与预期集合门禁，不跨项目写注册表。非 Windows 矩阵沿既有需求交付验证队列推进。

- HISUI：Windows Node 24 的 12 项资产专项及默认/pure 浏览器编辑保存已通过；部署字节收敛新增 20 项专项（含完整 1262 文件摘要）及 6 项文档回归通过，PS5.1/PS7 更新器全套通过。Windows/macOS/Linux × Node 22/24 的固定输入重建、完整性、分发补充资产、回滚及旧 autocrlf checkout 收敛 CI 实跑待完成，沿下表第 7 项 P2 推进；真实项目应通过正常更新复验，不直接补写副本。14 个 CSS 资源缺项按真实目标页面的使用范围核对；实际 HIS 主库、主题/locale、附加 helper 和 WebView/PAD 属于现有 P1 第 4 项工程验收，不将 source snapshot 或 jsdom 冒烟当成设备验证。

- 路由/预检修复：混合 CSP helper、workspace 部署前置阻断与提交重复 verify 已加入既有三平台 Node 22/24 CI；本机 Windows Node 24/PowerShell 5.1 的结果见日志，非 Windows 矩阵及真实工程样本待独立取证。此项沿下表兼容/宿主验证推进，不新增业务门禁。

- BOS（P2，沿第 7 项）：0.5.0 提交后日志编排及既有分段配置的三平台 Node 22/24 CI 实跑、真实宿主发现与合成需求的 Agent 场景轨迹待验；特别核对全部 verified 才进入日志阶段、精确选择/配置变化、预授权/拒绝、部分提交失败、接口未知结果与交接恢复去重。工具衔接与静态契约不能证明 Agent 授权判断或服务端幂等。本机标准私有目录迁移已有维护日志记录，不再列为待执行；使用者视觉验收、其它使用者新配置迁移、真实日志接口及服务端去重核对、业务试点仍须按明确授权另行安排。0.6.0 的六种人员/组口径、显式清除默认条件、body / explain 上游语义、标题异常根因、日期端点与分页/总量边界仍待授权核对；参数透传和合成验证不代表真实服务验收。纳入下表第 7 项兼容/宿主验证，无新增前置门禁。简单前端、后端、非 IRIS、混合升级及媒体主动读取/缺失/复用场景见插件 scenarios；优化前后同模型/宿主轨迹对照纳入现有 P1 第 5 项，核对无效加载、往返、补丁正确性和门禁遗漏，静态检查不作为提效证明。

- 提交校验工具：Windows/macOS/Linux × Node 22/24 的组件版本与内容证据 CI 矩阵实跑待完成；本轮 Windows Node 24 与隔离提交重放已验证，矩阵配置不等于平台通过。

- 需求交付归属迁移：demand-delivery-plugin / bos-demand-entry 的真实宿主与业务副本接入、需求入口更新迁移、standard-demand-entry 和通用提交的 Windows/macOS/Linux × Node 22/24 CI 实跑，以及新版三段式描述在用户侧 BOSS 文本/Excel 的真实录入与测试交接验证；结构与本地 Git 测试不代表业务系统已验收。

- Windows/macOS/Linux × Node 22/24 的 runtime-skills / skill-plugin-migration CI 实跑，以及 Claude Code 和非 Windows 宿主实际发现验证；CodeBuddy 的 Windows 项目 Skills 页面已有用户确认样本，实际任务调用仍独立取证。

## 治理优先级与执行顺序

优先级按当前阻塞、潜在写入风险和依赖关系确定，不以文档排列历史决定。下表是全队列的排序入口；同级按序号推进。外部条件未满足时标记等待，继续下一项可执行工作，不绕过授权或门禁。本轮框架交付已完成，下列均为独立后续治理。

- **P0：优先解除门禁阻塞、建立当前多人维护所需的准入机制。**
- **P1：下一批验证安全边界和核心能力，形成稳定性或提效结论前必须完成。**
- **P2：按可用环境安排兼容验证与质量改进，阻塞相应兼容声明，不阻塞已验证的 Windows 使用。**
- **P3：观察、候选和新增能力；出现实际需求或可复用证据后再启动。**

| 顺序 | 优先级 | 治理事项 | 启动条件 / 责任边界 | 完成标准 |
|---|---|---|---|---|
| 1 | P0 | 信创历史发布记录纠错 | 信创维护人及版本治理负责人确定纠错方式 | 不篡改历史、不绕过门禁，当前清单与版本比较均通过 |
| 2 | P0 | 多人提交准入与仓库一致性 | 框架维护者；可在第 1 项等待期间独立推进 | 短检查清单、责任边界和低误伤结构检查落地，正反例通过 |
| 3 | P1 | MCP v1.4.2 工具与权限语义审计 | coding-iris owner；依据实际 schema 与调用语义 | 新工具分类及旧门禁影响有证据，授权拒绝与允许路径回归通过 |
| 4 | P1 | 治疗表单事务链、统一前端部署及真实宿主验收 | 指定目标工程、独立测试文件和明确远程授权；不为工具验收重复部署既有业务文件 | 写入、回读、引用切换及回滚恢复有真实证据；SFTP 同环境同文件集重复测量全部变化/部分变化/全部未变，记录端到端耗时、连接/读写/字节数，并验证中断、rename 响应丢失与 worker 强杀；HIS/WebView/设备结果分别记录 |
| 5 | P1 | 跨模型、跨宿主的前后真实对照 | 可用前沿/较弱模型及两种宿主 | 固定样本、真实轨迹和同模型对照齐全；包含上下文初始化/维护/优化后的编程定位与验证路径、重复搜索及澄清往返；安全通过且无新增必需步骤遗漏 |
| 6 | P1 | 通用调度框架 beta 稳定化 | 复杂 i18n、非 i18n 和 multi-session 任务样本；夜跑试点须明确目标项目及授权 | 三类样本完成；异常恢复、所有权和验证失效闭环；完成上文 P1 可重复验收真实接入与夜跑新候选对照，失败样本补测 |
| 7 | P2 | 已实现能力的非 Windows / 运行时矩阵、夜跑成本及 task-handoff 其它宿主验收 | CI runner、目标运行时、其它 Agent 宿主及授权测试项目可用 | 夜跑三策略各至少三轮实测；框架演进、sparse、文档目录迁移、纯 init 薄索引迁移、部署保护、SFTP、表单预览及 AI 插件（含 async-contract-probe）取得相应矩阵实跑结果；task-handoff 在其它 Agent 宿主核实现场并执行正确下一步 |
| 8 | P2 | Question 宿主交互兼容验证 | 对应宿主及权限模式可用 | 选项限制、降级与写入授权实际验证，不仅通过协议测试 |
| 9 | P2 | AI 工作站真实业务集成验证 | 明确工程、获授权的 HIS 联动场景 | 诊断卡、取消/重试、历史恢复和传统录入兼容通过；新增异步迁移工具的真实宿主/设备证据独立取得 |
| 10 | P2 | 代码质量 review 与反馈机制评估 | 有真实改动和团队反馈样本 | 报告模式验证误伤率和处理效果，再决定哪些规则适合门禁 |
| 11 | P2 | 电子健康卡项目侧验收 | 对应维护人与目标工程负责；本仓不代改信创插件 | 已部署入口清理和厂家协议、双向映射取得项目证据 |
| 12 | P2 | xc 能力目录与使用手册 | 后续明确安排 xc 文档治理，按各插件当前源文件核实 | 四个 imedicalxc 插件的 skill/rule 清单、接入条件、请求示例和操作边界齐全，链接与覆盖检查通过 |
| 13 | P3 | 新通道与上游协议演进 | 实际需求或上游能力变化 | 分别评估无 SFTP 上传、原生 write 参数、快照会话与 request-id；未验证前保持现有保守路径 |
| 14 | P3 | 新增跨平台能力、知识接入与资产治理 | 平台需求或领域样本证明收益 | 明确边界后小范围试点；有证据才扩大平台能力、知识接入或公共资产 |

## P2 xc 能力目录与使用手册

- 本轮非 xc 目录和使用指南已交付；按用户要求将 xc 补齐工作留在治理队列，本轮不修改 xc 插件内容。
- 范围：`imedicalxc-doctor-extend-engineer`、`imedicalxc-doctor-perf-analysis-engineer`、`imedicalxc-doctor-data-extraction`、`imedicalxc-doctor-print-template-design`。
- 后续复用 `docs/guides/capability-catalog.md`、`docs/guides/capability-guide.md` 的入口与组织方式，先核实各插件 manifest、skills 和 rules，再补充中文用途、初始化/日常/内部入口区别、请求示例、前提和预期结果；不得把子技能一律作为独立公开入口。
- 完成标准：四个插件范围内清单无遗漏、源链接有效、示例符合实际契约，并同步文档范围说明和统计。该项仅补齐使用文档，不隐含插件实现、版本历史纠错、项目接入或服务器操作。

## 治理事项与验收细节

### 已登记技术债：信创 1.0.2 发布记录

- 标识：`version-debt-xc-1.0.2-commit`。`releases/plugin/imedicalxc-doctor-extend-engineer/1.0.2.md` 缺少 `commit`，对应 `release-field-missing`、`release-commit-invalid`；已确认在 `078867b` 之前存在，本次需求闭环未新增该问题。
- 2026-09-18 用户明确要求登记后普通提交不再处理：不为此重复排查、反复提醒、请求确认或阻断无关提交。提交使用暂存组件门禁，保留不可变记录；涉及该记录的新变化仍按新增问题检查。
- 仅在明确开展该项技术债治理或完整发布审计时处理，由信创维护人与版本治理负责人确定不篡改历史的纠错方案。完整审计保留问题，不将普通提交通过表述为全仓无债务。

### 框架演进后续验收

1. **P1 · 跨模型与跨宿主真实对照**：按 maintenance/validation/agent-evolution.md 的固定样本，在相同代码、需求与权限下，覆盖前沿模型、实际较弱模型及两种宿主，保留前后真实执行轨迹；核对正确性、遗漏、返工、读取量与重复流程。获得同模型对照证据后才报告提效，不能用关键词测试替代。
2. **P2 · 非 Windows 平台与运行时矩阵及交接接续**：执行 macOS/Linux、Node 22/24 的框架演进、task-handoff、文档目录迁移、纯 init 薄索引迁移和 sparse 更新矩阵，保留实际 CI 结果及不支持能力的降级证据；矩阵文件存在不等于验证通过。当前 Codex 宿主的无原聊天历史新会话已于 2026-09-19 完成现场核实并经用户验收通过；task-handoff 仍需其它 Agent 宿主真实接续，只给项目入口和交接路径，验证授权、现场、证据与第一步正确，保留无关修改。Windows 项目普通更新已经完成，不再作为待办。
3. **P0 · 信创历史发布记录纠错**：由信创插件维护人与版本治理负责人处理 imedicalxc-doctor-extend-engineer/1.0.2 缺少 commit 的既有问题，明确不可变发布记录的纠错机制，再运行当前清单及版本比较校验。不得擅自改写历史记录或绕过门禁；交接材料见 maintenance/validation/agent-evolution-maintainer-handoff.md。

- **P2 · Question 兼容**使用厂商无关协议与能力降级指引，未引入厂商 SDK；专项测试覆盖协议与写入门禁，不代表已在所有 Agent 产品交互界面实测。不同工具的权限、模式及选项上限以当前调用契约为准。


- **P2 · 部署保护矩阵**：本机专项与独立真实资源验证已通过；Windows/macOS/Linux、Node 22/24 矩阵已配置，待获取 CI 实跑结果。不同后端导出格式仍按逐环境确认，未知格式不自动归一化。本轮已完成目标工程普通能力包更新；该结果不替代实际部署链路与非 Windows 验收。无后台监控、远端锁与自动回滚，本期明确不建设。


- **P2 · SFTP 已实现能力的兼容验证**：CI 已声明 Windows/macOS/Linux 与 Python 3.10/3.13 矩阵，非本机平台需等待 CI 结果；无 SFTP 的通用前端上传通道仍未实现，按 P3 另行设计，不能将 vendor 纳入视为该能力已完成。

- **P3 · 上游 MCP 原生 write 参数支持跟踪**：固定 SQL 兼容层的授权样本已通过，不再列为本轮实写阻断。后续上游补齐参数绑定后须重新验证，不能静默切换；新增实例和正常 deploy 改内容全链路另按具体任务验收。服务器 operation 审计仍由完整事务通道提供。

- **P1 · `iris-agentic-dev` v1.5.0 工具体系审计**：v1.5.0 本地断连工具数仍为 70/81；既有 8 项 vendor skills 已同步并验证来源，SQL/事务/测试等新指导在目标 IRIS 版本的适用性仍待验证；响应兼容说明已由 coding 0.19.4 对齐；待在真实服务器核验 `iris_macro`、`iris_info`、`iris_execute_method`、HTTP `iris_execute` 行为，以及 helper 退出时 CSP 会话/临时类是否实际释放。此前 v1.4.2 exe 更新后 `--no-skills` 从 67 增至 70 个工具，新增 `iris_mirror_status`、`iris_reload_pool`、`iris_system_performance`。helper 对未分类工具保持 fail-closed，三者当前均需 `--allow-write`；后续单独审计 schema、读写语义、`web_prefix` 与 v1.4.2 之前 `iris_ws_exec` 门禁缺口的体系影响，再按组件版本治理更新 coding-iris-plugin。

### 治疗表单后续验证与协议演进

- **P1 · 事务链**：`iris-cure-form-dev` v0.6.0 的 consolidation/cleanup 客户端、离线包校验和传输白名单已落地；在宣称真实服务器事务链可用前，仍需在获授权的目标工程验证 `DHCDoc.Cure.AI.CureFormDeploy` 新增 Inspect/Validate/Apply/staged/Verify/Rollback 方法，覆盖正式 RowID 内容回归、全部 Map 引用切换、灰度模板/缓存删除及 operation 回滚恢复。

- **P3 · 新协议**：旧服务端没有 request-id 幂等查询时继续采用未知写入停止、只读核实；未来服务端增加稳定只读快照会话和 request-id 查询接口后，单独版本化升级，不以客户端重试冒充幂等。
- **P1 · 真实宿主**：真正 HIS、移动 WebView、粗指针 PAD、字体缩放和软键盘验收仍由具体业务工程提供；九档或扩展 Chromium 宽度不能声明覆盖全部设备。样本细节与 operation ID 只留项目 docs/work，不写入通用框架记忆。

### P0：多人协作提交准入与仓库一致性检查

- 背景：仓库权限已放开给多位同事，需要把“改能力包必须同步维护约束”的流程前置，减少实现、README、插件文档、维护记忆和部署边界之间的偏移。
- 交付 1：新增短小的提交/PR 检查清单，覆盖目录、thin-index、vendor、敏感信息、README/AGENTS/manifest、维护记忆、测试和已部署工程兼容说明。
- 交付 2：复用已独立落地的组件版本 validator，在现有测试入口继续增加低误伤的通用结构检查，至少覆盖 manifest 可解析、插件 README/AGENTS/manifest 齐全、thin-index wrapper 未复制 canonical 实现，并逐步覆盖跨目录 reference 路径、反馈模板/skill 字段一致性和插件拆分后的专项测试 owner 路径。
- 交付 3：明确 canonical、插件、脚本、vendor、memory 的维护责任和必须配套的验证证据。

### P1：通用调度框架 beta 真实验证与稳定化

- `#6097879` 已完成第一次真实 multi-agent i18n 实战，但模式在执行中途切换、阶段时间事后重构、文件所有权未进入 manifest，且 Verifier 后仍发生代码和远程翻译修改；该样本用于暴露缺口，不作为“样板已定型”。
- `#6097891` 已从 Step 0 采用 `multi-agent`，并暴露 MCP 瞬时失败误判、阶段暂停恢复和提前 Verifier 缺口；schema 1.2 与脱敏 fixture 已将异常恢复路径机械化。
- 通用 `standard-change`、六个角色、`iris-change-agent` / `iris-change` 和 schema 2.0 调度器已进入 beta；需完成复杂 i18n、复杂非 i18n、一个 `validationSample=true` 的简单 multi-session 样本后才标记稳定。
- 失败样本必须修复并补跑同类；简单 multi-session 样本不计入 fast-path 性能结论。
- skill 提效另取后续五个简单 `iris-coding` 需求，统计补丁耗时、无效 skill 加载、子 Agent 启动收益、返工和未验收 feedback 次数。
- 工具原生配置仍不作为 canonical；当前 `codex-session` 是宿主 action adapter contract，不承诺其它工具未验证的原生 API。

### P2：代码质量 review 与框架反馈演进

- 2026-10-12 已收紧格式审查到真正新增代码；后续真实团队样本同时观察新增表类/属性/索引注释、历史中英文标签兼容、SQL 投影未知时的缺口报告，以及既有代码修改、移动/复制和新语句的范围识别，防止把 diff + 行当作格式化授权。

- 2026-10-10 已接入通用规范 Review、CLS 与前端统一格式规范；后续以真实团队需求和跨宿主样本观察漏报、误伤及项目覆盖执行情况，本轮 CLS 四类、前端六类串行样例及 JS 页面模板模拟不替代独立 Reviewer、真实容器生命周期、浏览器兼容或 IRIS 编译验收。

- 保持 `.agents/hooks/pre-commit` 和 `check-functional-diff.ps1` 为轻量、低误伤门禁。
- 评估第二层 `check-code-quality.ps1`，先由用户或 Agent 主动运行并输出报告，不直接作为 pre-commit 强阻断。
- 优先覆盖需求无关文件、敏感连接信息、明显硬编码路径、缺少必要验证入口及已启用领域插件中的高风险点；先验证误伤率，再决定是否提升少量规则为门禁。
- 团队开始使用框架反馈机制后，按四项共享准入观察基础知识误收、项目约束泛化、单次高价值遗漏和重复计数，验证真实模型执行效果；积累样本后再评估自动化 diff 和应用工具。

### 持续观察与资产治理（按优先级索引执行）

- 继续观察 rules 体量；若 i18n 或 coding 规则再次承载查找表、API 目录或长参考资料，优先迁入对应插件 `references/`。
- 观察 `feedback/experience/deploy-com-exp.md` 的复用频率，必要时抽象命名、敏感信息检查和部署工具模板；旧 docs/deploy 具体项目样本已按用户授权删除，新业务部署材料归目标项目。
- 明确 `demo/presentation/` 是否长期作为仓库展示资产；如需部署到业务项目，必须先更新安装/更新 sparse checkout 边界说明。
- **P3 · 新增跨平台能力**：暂缓扩大 macOS/Linux 能力覆盖；已实现能力的矩阵取证按 P2 执行，两者不混为同一事项。后续按“标准模式基础能力可用”的边界评估实施：优先覆盖安装、更新、plugin profile、thin-index 和通用 skill/agent；workspace overlay、Windows x64 IRIS MCP 等平台专属能力允许明确降级，不要求首阶段与 Windows 完全等价。已确认采用“JS-first、Node.js 为 `.agents` 工具链必装环境、OS 专属脚本例外”的策略；Node.js 不是 HIS 生产运行依赖，不整体重写现有 `.ps1`。正式启动时需完成安装器 Node.js 前置检查、经过完整回归的 Node 22 支持范围、根级 `scripts/*.js` sparse checkout、平台能力降级，以及 Windows/macOS/Linux 测试矩阵。
- **P2 · 表单预览平台验证**：`iris-cure-form-dev` 的 `preview-run` 已按 Windows/macOS/Linux Chromium 路径发现和 Linux root capability 降级实现，但当前只取得 Windows Chrome 实机证据；正式宣称 macOS/Linux 支持前，仍需在对应 runner 上执行九档 Network/Console/HISUI 集成矩阵。

- **P1 · 开发部署链路**：coding-iris-plugin 0.19.1 的编译后 Storage 回填仍需目标工程独立测试类授权验证新增表、字段演进及受管夜跑复审恢复；不得以本地模拟通过替代真实编译生成证据。默认 direct 已取得 Windows 本地模拟及 CLI 证据；业务副本按授权同步后仍需验证前后端真实单命令部署及 Windows/macOS/Linux × Node22/24 CI。guarded 兼容命令及领域专项授权保持原行为；提交状态见维护日志，源仓变化不等于副本生效。
- **P2 · 电子健康卡项目验收**：电子健康卡 v1.0.1 修复在源仓验证后，已部署工程仍需按更新指南同步并确认旧受管子入口清理；真实厂家协议和双向映射验收留目标工程。

## P2：AI 工作站插件后续验证

- 在明确指定的目标工程试点诊断卡扩展、取消/重试、历史恢复与传统录入页兼容；真实 HIS 联动尚待授权场景验证。
- 跨平台 CI 已声明 Windows/macOS/Linux，非本机结果待 CI 执行；不把测试矩阵声明当成已通过。

### P2：知识资料与菜单同步真实环境验证

- 在明确的目标工程验证原生 MCP 完整采集、安全组及 BDP 覆盖、菜单变更后刷新和实际页面定位；本地模拟及离线同步不代替真实环境证据。
- 执行 Windows/macOS/Linux × Node22/24 矩阵；部署到现有业务副本后核对两个 skill 的实际发现与读取，保持项目快照不被升级覆盖。

## 队列维护规则

- 新增事项必须指定优先级、启动条件和完成标准；风险、阻塞或依赖变化时调整排序，不把所有问题都升级为 P0。
- 已完成事项迁入 `agent-kit-maintenance-log.md`，不要在 backlog 中长期保留已完成条目。
- 已固化为长期约束的事项迁入 `agent-kit-maintenance-decisions.md`。
- 不记录短期个人提醒；只保留会影响后续 Agent 决策的治理任务。

- P2：在 macOS/Linux 执行 commit-upstream-check.test.js，补齐 coding-iris-plugin 0.15.2 跨平台验证；Windows 5项定向检查已通过。
