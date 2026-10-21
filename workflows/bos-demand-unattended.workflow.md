# BOS 夜跑 Workflow

## 触发与输入

仅在用户调用 `$bos-demand-handle --night` 或自然语言明确要求夜跑、批量、无人值守处理时加载。本流程复用 [BOS 单需求流程](bos-demand.workflow.md)、[正式协作协议](../agents/_shared/orchestration-protocol.md) 和 [测试协议](../agents/_shared/testing-protocol.md)，不另建台账或调度服务。批次实例留目标工程，参照 [批次示例](../docs/templates/night-run-batch.template.json)。

Agent 从请求、已有授权和工程配置整理输入并生成批次及必要编排资料；用户无需手填 JSON。先自行核实，仍缺少的业务决定集中询问；生成文件不表示已授权执行其中的动作。

新批次先探测 `night-execution-plan/v1`，按[PLAN 模板](../docs/templates/night-execution-plan.template.json)在编排计划顶层填写 `executionPlan:{version:1,...}`，旧批次不补字段。先取得并保留周额度真实基线，再集中批准 PLAN；`budget.weekly` 使用本批预算百分点、稳定 budgetId 与该基线引用，时间、token 和治理预算分别显式评估，不套用固定时长或比例。逐项保留需求原文、备注、用户初评、可执行性、复杂度、风险及含理由的最低测试方案，按实际行为选择层级。

PLAN 绑定至少两名 Developer、功能 Tester 与浏览器 Tester 各一名及 Coordinator；明确实际客户端容量，Coordinator 计入会话数，四名容量须显式错峰两个 Tester。各 worker 的 `night-workspace` 请求设置 `executionPlanVersion:1`，以 owner 分配独占目录，绑定原项目入口、所需角色规则、源仓身份与固定 revision。已有 Git/Overlay 构建完成且 run 获授权后，显式执行 `node <capabilityRoot>/scripts/night-workspace.js materialize <workspace-plan.json>`，由当前 run 派生各 Overlay 和物理源码仓根的 `.agents/rules/night_run_plan.md` 与 `AGENTS.md` 引用，再运行只读 `check`。保留普通入口内容，只在已核实的 worker 自身链接上生成薄入口；共享 `.agents` 与原项目规则始终为只读来源。

派发携带短公共约束、当前角色、当前需求原文/备注、相关最低测试、必要依赖、当前预算观测、截止及授权 scope；无真实剩余观测标记 unknown，全文通过物理 PLAN 引用按需读取。next、启动、结果、状态切换和执行 checkpoint 沿现有 run 校验当前 planHash、规则 hash 与实际入口。集成由 `integration` 的唯一 owner 在声明的固定基点、目标仓和专项授权下执行，并核对汇总验证与数据保留安排。

经 `--night` 创建的新批次显式设置 `decisionPolicyReference`。按实际角色使用现有 `night-workspace` 只读计划和已有 Git/Overlay 构建入口；批次 `workspacePreflightReferences` 填写 `{ownerId,planReference}`，planReference 相对批次文件，owner 与工作区计划一致。构建后核实共享能力、工程上下文和真实源码边界，预检失败先修复相关前提；不另装能力副本，不宣称生成计划即工作区可用。恢复旧批次不静默添加新字段。

新批次按[2.1 契约](../docs/night-policy.md#schema-21-启动契约)设置 preflight-only 和唯一 runReference，先探测运行时支持，前后端各工作项显式 repositoryRoot。启动前集中复用或补齐计划内全部授权并实际预检，已知缺项不得运行，可在启动前确认缩小范围。运行中权限失效、能力异常和计划外动作只挂起相关分支并记录交接，继续其他已授权工作，不新增授权问题、不代批宿主审批。Web 默认现有无头 Playwright；需要宿主临时浏览器批准的路径在开始前转人工或排除。

多编号详情逐号调用，不把逗号编号传给单号接口；首次共享连接异常先诊断连接前提，前提未变时暂停后续同类请求。观察使用状态与增量事件，完整会话只用于关键证据，观察成本单独统计。

Codex 新批次写入 `quotaPolicy:{enabled:true,provider:"codex",stopClaimingRemainingPercent:20,closeoutRemainingPercent:10,maxAgeSeconds:300}`；其它宿主显式使用 `enabled:false`。Agent 在启动和每次派发前取得真实宿主额度快照，通过 `night-record` 的 `{kind:"quota",snapshot,rationale,evidenceRefs}` 记录，snapshot.observedAt 使用实际获取时间并带时区，保留真实 rateLimitsByLimitId 或旧 rateLimits 数据；具体入口见[决策接口](../docs/night-policy.md)。未知或超过 300 秒的快照阻止业务派发，适用窗口最低剩余量不高于 20% 时停止领新需求、不高于 10% 时仅收尾；cleanup 继续遵守处置授权且不受额度门禁阻止。额度是账号共享状态，不等于本批次 token 或费用，不用推测值填充；复用阶段调用，不建立守护进程。

Coordinator 核对需求编号或可复现查询范围、Workspace/Source/GitRoot、原始授权、角色/数据策略、停止领新需求/发布截止/绝对停止时间及通知条件。所有时间带时区；若缺失则先集中确认，不能将历史夜跑时间当默认值。新模板 maxInFlight=4，实际双 Developer 并发与 Tester 错峰按 PLAN 核实；旧 run 保留原值。客户端执行通过 night-client-supervisor 的 createManagedNightClient，先原子预留预算并持久化真实启动回执，持续 tick 核用量、终态与停止；接口边界见[治理接入](../docs/night-governance.md)。

批次显式启用成本分级策略时，按[两次评估](../docs/night-acceptance.md#可选成本分级策略)执行派发前准入与冻结后复评；现有 Coordinator 组织 Planner、Review、Testing 职责，不默认增加会话。未启用的批次保持原流程。

commit、push、merge、上传/编译、测试数据写入和处置、BOS 日志/状态分别沿用明确授权。预授权不能替代宿主实际许可；被拒操作保留断点，不能换通道绕过。账号、服务器、票据不写入通用批次模板。

worktree 复用原项目启用能力，领域选择沿用[单需求流程](bos-demand.workflow.md#编码体系选择)。计划的 requiredSkills、requiredRules、requiredScripts 只声明本批次实际需要的入口，覆盖适用的编码、部署与验证动作，不枚举全部插件。复用有效上下文与预检证据，不新增启动阶段或预检轮次；既有派发检查保留。插件启用不代表所有动作支持无人值守，计划内部署、设备与验收能力仍由原真实预检核实；缺口按既有缩小范围、人工留项或运行中挂起规则处理。

## 阶段

新模板先在初筛后用 [独立能力预检](../docs/night-governance.md#事前形成可执行计划)确定可执行子集，再完成详细 PLAN；正式 run 预检放行保持原检查。客户端由 `night-client-worker.js` 持续监督并保留断点，恢复重用原预算与截止；交付同时给出最低自检状态和真实证据等级，静态达标不自动升级为 UI。

新批次在现有启动准备中检查 `night-convergence/v1` 并填写明确总时限（批次统一值、需求可覆盖），见[返修收敛与按需依赖](../docs/night-policy.md#返修收敛与按需依赖)。问题出现后复用稳定 problemId，每次新诊断/修复先登记 attempt-start，再在结果核实后登记 attempt-result；不把内部循环藏在一次派发中。独立需求无依赖绑定负担；存在依赖才登记消费版本与范围。最终集成按现有 Coordinator 协议，不启动新的集成管理服务。

1. **真实预检**：按本批次所需路径核实工具、认证、角色/数据、正常入口和退出能力。纯后端不检查浏览器；UI 检查无头浏览器启动、登录、页面、截图和关闭。协作需要启动/等待/结果能力；必要能力缺失时保留可串行完成的规划与交接，改变批准并发须重订计划，不能静默单开发执行。新批次必须建立或接续既有编排 run，通过 next 和启动前 transition 执行门禁，不能仅阅读策略后绕过运行时派发；事件与验证复用其事实源。
2. **调查与验收分层**：取得完整需求及媒体，检查实际调用链；内部计算走 internal-method，对外 Broker/REST/SOAP 走 external-api，页面行为走 ui。响应契约变化检查消费者，受影响的页面补对应用例。认证借用浏览器不计 UI 验收。详见 [分层接入](../docs/night-acceptance.md)。
3. **开发、审查与冻结**：按 BOS/领域流程实现，测试准备可提前进行；明确唯一写入 owner、版本、依赖和断言。已知修改范围先核编码与条件 i18n，最终 diff 后复核；逐项检查保留退出码，不能以最后一项成功覆盖前项失败。最终修改冻结后才执行对应验收，实际测试等待已授权部署就绪；已证实旧证据过期时按 scope 重新核验。
4. **授权部署与验收**：复用现有部署入口与专项授权。具备 Atelier 的 IRIS 项目在事前核实授权、文档路径、回读和编译条件后，显式选择 web.frontendTransport=atelier 作为受保护前端首选；SFTP 保留为明确选择的兼容通道，失败不自动换通道。纯后端直接调用真实层级的接口并按需独立回读；Web 行为优先无头 Playwright。执行器使用有限超时、会话恢复与资源归属。HTTP 200、内部方法通过均不能替代对外接口契约；后端通过不能替代受影响 UI。
5. **返修或人工留项**：业务缺陷返回原 owner；版本变化更新证据。未知写结果先回读，环境/脚本/认证/权限问题分类，前提未变不重复尝试。原生打印等困难项记录已测范围、入口/步骤/预期、风险及恢复条件。明确人工留项不自动标为 accepted。
6. **收尾交付**：停止心跳、关闭本任务页面/context/browser、释放监听器与进程，核实数据策略。按[测试协议的结果与交接](../agents/_shared/testing-protocol.md#结果与交接)分别汇总功能验证、人工补验与用户验收结论，并列明缺陷、未知结果和清理状态；分别记录准备/执行/诊断/返修等待/证据耗时和人工介入。业务仍 acceptance-pending，用户验收才 accepted。

## 容量、截止与恢复

默认同一时刻一条需求处于开发至自动验收链。当前条目完成自动范围及收尾，或形成明确人工交接后再领新条目。已知缺陷优先返修；未知写结果、资源占用、数据污染先处置，不能包装成普通人工待验继续积压。

每次阶段切换检查时间：停止领取后只处理在手事项，发布截止后不开始新部署，绝对停止后不开始业务动作并进入有界收尾。正在运行的测试工具独立实施 deadline/timeout；不能因模型等待或聊天结束而留下心跳进程。截止后未确认退出的资源明确交接，不宣称清理完成。

只在授权范围、版本、前置、资源和工具许可重新核实后恢复。复用原结果及 run，不重放已确认动作。通知沿批次约定，严重问题/预算阈值不使用历史默认值。宿主无法持续执行或唤醒时如实标记 supervised，不把手工恢复包装为无人值守成功。

计划逐条覆盖 implementation/review/deployment/verification/cleanup，跳过阶段附原因与交接。部署/验收经绑定 work item 的受管入口自动归档回执；共享部署确认目标内容仍相同后复用。数据策略采用项目 fixture authority，处置与资源退出分别报告，真实成本对照见[接入说明](../docs/night-acceptance.md#21-项目适配与数据成本)。

处理报告收尾按[编号汇总契约](../plugins/demand-delivery-plugin/skills/demand-acceptance/SKILL.md#编号汇总契约)固定给出本批全部需求号汇总，并核对基线已满足、无需新增代码项未遗漏；状态分组另列。仅引用报告契约不触发验收交付授权。

## 单 Agent 降级

无 subagent、原生 skill 或 YAML 能力时，读取本 Markdown 按阶段串行执行；项目 JSON 仅作为输入资料，不要求固定产品 API。显式 PLAN 的角色或容量条件无法满足时，启动前调整并重新批准可执行范围，不把单 Agent 串行当作已满足原批次编组。没有浏览器时仍可执行后端用例，UI 范围保留待验。没有真实环境授权时，只完成本地合成验证与待执行计划。
