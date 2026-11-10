# 夜跑决策接口

适用范围和分级语义见[分层验收](night-acceptance.md)。本接口扩展既有编排 run；不启动业务操作、不授予权限，也不替代 Coordinator 对需求、证据和独立审查真实性的核验。

新批次的实体 PLAN、双 Developer / 双 Tester、冻结版本、周额度基线和持续浏览器 worker 见 [无人值守治理](night-governance.md)。仅显式启用 executionPlan；旧 run 保持原投影。新模板容量为 4，以下旧接口不改变存量 run 的容量。

## 启用与执行

新批次启用下述 `night-convergence/v1` 精简扩展；旧 run 不补字段、不迁移计数。扩展复用本 run 的事件、计时和源码指纹，不增加调度器、通用交付组或资源锁。

### 运行中调整容量

已有 schema 2.1 run 可在用户明确授权后，由 Coordinator 通过原 `night-record` 记录容量增长；默认 `maxInFlight:1` 保持。输入为 `{kind:'policy-update',changes:{maxInFlight:2},expectedMaxInFlight:1,userAuthorization:{actor:'user',reference:<用户事实引用>},boundary:{runtimeOperationsSettled:true,sourceWritesSettled:true,fixtureWritesSettled:true},rationale,evidenceRefs}`。用户事实引用必须列入非空 evidenceRefs，调用者核实其确来自人类；结构字段本身不是授权。仅允许这一个字段增长，旧值不符、下降、同值或其他策略/授权/期限变化均拒绝。

先核实真实写入和资源均已收尾：没有运行中的 work、operation、preflight 或待执行/阻断 action，没有未知写或待处置资源，且原 preflight 的配置、角色、源码及权限仍有效。所有会重绑的 grant 都须当前有效，包含未被 work 使用者；撤销、过期、来源引用或环境不一致均拒绝。只变更现有效授权的 scopeHash，保留原来源、授予人、时间和其他元数据，不借此授予或恢复权限。边界声明不能证明框架外操作已停止，Coordinator 必须独立核实。

事件沿既有锁、planHash、追加日志和原子投影链执行，在 `night.policyChanges` 保留旧/新值、前后摘要、用户引用和边界证据；既有候选、回执、问题与计时历史不清零，截止不延长。旧 run 不迁移，不手改投影；工具返回异常时先回读事件和策略，不重放未知结果。升级前的工具没有此事件，保持原容量；已部署项目应在安全边界更新匹配的运行时文件后再调用。

## 返修收敛与按需依赖

启动前检查 `capabilities.features` 含 `night-convergence/v1`，使用 schema 2.1。策略新增 `convergence: {version:1,maxProblemAttempts:4,totalBudgetMinutes:<明确分钟数>,demandBudgets:{}}`。模板的 null 必须启动前填写；可为整批需求设统一时限，用 demandBudgets 的需求 ID 覆盖个别值。没有统一默认分钟数，Agent 从批次约定取得，不猜测；旧工具因未知策略字段拒绝启动。运行中不提高预算；接续需用户决定并保留原问题历史与已用时间，不能创建空记录清零。

总投入按该需求 preparation/diagnosis/execute/wait/evidence 的实际活动区间取并集，父阶段与明细不重复计量；挂起后的空闲不计，共享准备单列，cleanup 不单独计入。保留 13/30 分钟探索复评及三截止。派发、转 running、受管操作开始及每个验收用例前复查；验收 deadline 和受管部署调用受剩余时间约束。超时不证明远端已停止，保留未知结果，禁止重放；资源退出和独立安全核对仍沿原授权执行。

### 问题与尝试

以下事件经原 `night-record --record ... --actor <Coordinator>` 提交，共用 `eventId`、`demandId`、`rationale`、非空 `evidenceRefs`。eventId 稳定，原样重放幂等、同 ID 不同内容拒绝。

| kind | 额外字段与行为 |
|---|---|
| problem | problemId、caseId、category；首次诊断失败时登记。同需求同 caseId/category 不允许换名字另开计数。受管失败自动生成稳定 problemId，先看 night-status 再复用。 |
| attempt-start | problemId、attemptId、hypothesis、change、expectedCheck、newEvidenceRefs、evidenceSummary。开始即占一次；一个问题只允许一次未结束尝试，中断后复用。 |
| attempt-result | problemId、attemptId、status 为 resolved/failed/blocked。resolved 需要本次尝试的当前版本通过回执；静态检查需 checks 中同 caseId 的通过项带 attemptId、当前源码指纹和证据。 |

一次尝试是一轮有明确假设的诊断、修复和定向验证，不是一个命令或一个回归用例。默认第 4 次可执行并消费结果，仍失败则拒绝第 5 次；换 Agent、work item、版本不清零。首次失败和正常回归不算修复尝试。问题复发沿用原历史；本版不新增问题拆合 API，相关问题沿原稳定标识记录，需求总时限始终累计。

失败签名按用例、类别和失败断言标识计算，排除日志路径、引用与时间戳。下一次须说明新假设、改变及新证据内容；仅换引用且假设/改变/证据摘要相同会拒绝。文本不同不能证明语义有进展，Coordinator 必须核实，无新证据则挂起；普通复评不能豁免硬上限。长诊断循环每次新尝试也须登记，不能绕到普通工具继续业务动作；脚本不能计数任意宿主命令。

night-status 的 decisions 返回预算、问题与依赖原因。停止后交付版本、已通过/失败/未测场景、各次改变和证据、停止原因及复现步骤。安全状态清楚且无活动操作的耗尽项释放容量，独立需求继续；未知写或未退出操作仍占用。已知缺陷写待修复，技术缺口写待补验，不计通过。

### 依赖绑定

独立需求无需额外输入。存在依赖时在下游验证前登记 `dependency-bind`，包含 `binding: {upstreamId,upstreamVersion,type,sourceScopes,requiredChecks,evidenceRefs}`；type 为 information/contract/code/environment，upstreamVersion 是上游当前冻结版本。sourceScopes 使用现有 `{repoRoot,scopes}`，必须在上游范围内，缺失路径不按空内容放行。code 另填 consumerScopes，属于下游源码范围并与源范围同路径同内容，确认代码实际可见。不同产物布局由项目先准备可对照范围。

B 可基于稳定契约提前开发；最终技术通过要求依赖范围未变、所需上游 checks 通过且无未解决问题，并有 B 当前版本和依赖组合匹配的受管测试回执。无需等待无关检查或用户验收；有依赖的静态项无法取得组合证据时保留待补验。

范围未变可复用原消费版本检查；相关变化沿直接和传递依赖撤销通过结论，重排受影响 review/verification，保留实现与历史证据。未知影响按失效处理。运行中不重派，先核对操作再重绑定；重新绑定撤销旧组合结论。必要的重新部署由 Coordinator 按影响安排，不默认全批回归。

environment 依赖要求项目验收 adapter 实现 `verifyDependencies(bindings)`，实际读取运行端版本逐项比较，通过返回 true。执行器在正常 verifyVersion 前后检查中同时调用它，缺失/不匹配不能通过，传递环境依赖也传入。不能只回显输入，实际证据留项目；源码指纹不替代运行端核验。

### 最终集成

Coordinator 按[协作协议](../agents/_shared/orchestration-protocol.md)记录输入、逐仓结果和最终验证。单人单仓复用已有记录；跨仓/多人再补交接字段。本次不提供自动合并器、交付组状态机或共享资源锁；同部署对象/共享可变数据的冲突窗口由 Coordinator 在既有计划中排序。框架不能阻止外部部署，运行端前后核验仍必需。

## 原有策略接口

计划的 `nightBatchReference` 相对计划文件解析。批次设置唯一 `batchId`、带时区的三截止和 `decisionPolicyReference`；策略引用相对批次文件，填写[策略模板](templates/night-decision-policy.template.json)。无策略引用的旧批次保持原行为。批次与策略的 maxInFlight 必须一致。

启用后每个 work item 声明 `night: {demandId, phase}`，phase 为 implementation/review/deployment/verification/cleanup。每个需求的 implementation 工作项具有唯一实际 owner。cleanup 必须使用 `kind: cleanup` 且无业务源码 writeScopes；它仍遵守数据处置授权。角色和独占源码范围沿现有计划声明。

```text
node .agents/scripts/agent-orchestrator.js night-record --run-directory <run> --record <input.json> --actor <实际coordinatorId>
node .agents/scripts/agent-orchestrator.js night-status --run-directory <run> --demand <id> --json
```

`next` 在现有锁内执行准入、预算、容量和截止检查，生成动作立即预留容量。宿主消费动作前调用既有 `transition --entity work-item --id <workId> --status running` 再检查当前门禁；仅生成动作不等于已经开始需求；停止领新截止与额度门禁共用 running/completed 或实际 attempt 判据，截止后的未启动旧动作不得直接执行。实际执行器仍须使用批次 deadline。无法执行的原因在 night-status 的 decisions 中读取，不反复请求相同授权。

## 显式入口与工作区

### Schema 2.1 启动契约

新夜跑先调用 `agent-orchestrator.js capabilities`，必须包含 schema `2.1`。批次设置 `policy.interactionMode: preflight-only` 和唯一 `runReference`（相对批次文件）；全部前后端 work item 共用该 run 的容量、额度、计时和截止，不为每个仓复制整批需求。Overlay 请求的绝对 `runReference` 写入 `nightRunReference`，工作区检查会复核绑定。

每个 work item 显式填写实际 Git 根的绝对 `repositoryRoot`，必须属于该 owner 已预检的工作区；同路径在不同仓不冲突，同一物理仓的链接别名不能绕过隔离。每条需求覆盖五个 phase，后阶段依赖上一实际阶段；跳过阶段登记 `status: skipped` 及 `night.skipReason/handoffRef`。审查 owner 独立于实现者。联合 `sourceScopes` 冻结该需求实际受测的全部仓库，包含新增文件。

`night` 同时声明 `role/environmentAlias`，按实际范围填写 `requiredAuthorizations/requiredCapabilities`；verification 的 `effects` 必须为 `read-only|write`，write 另填 `dataPolicy: retain|reset|delete`。deployment 自动要求 deploy，write 自动要求 testDataWrite，reset/delete 自动要求 testDataDisposition；提交、推送、BOS 写入等按阶段显式列入 requiredAuthorizations，未列入的动作不属于执行计划。multi-session 自动要求 collaborationPlan。

开始前按需求、计划及项目 profile 汇总缺项，仅集中确认尚无有效授权的部分；摘要列环境别名、角色、操作、源码范围、数据归属引用、共享父记录/审计字段等允许副作用及有效期。`authorizationReferences` 保存授权事实引用，凭据留私有配置。不能用 Agent 自己生成的引用替代用户授权。

项目 profile 的实际预检执行认证、业务角色、正常入口与退出，并将回执写入当前 run：

```text
node .agents/scripts/run-acceptance.js --profile <项目模块> --preflight --run-directory <run>
```

回执包含 environmentAlias、cleanupVerified、authorizations 和 checks；工具自动记录 checkedAt、profile/config 摘要和配置文件摘要。authorizations 每项含 category/reference/environmentAlias/roles/scopes，scopes 为 `[{repoRoot,paths}]`；可设 expiresAt；数据授权还需 dataScopeReference、dataPolicies。部署还需由项目按受保护入口实际加载的 `{config,mcp}` 内容计算 deploymentConfigFingerprint，使用 `night-execution.fingerprint`，仅归档摘要。checks 为 `[{id,status,role,nonInteractive,evidenceRef}]`；认证/角色/入口/退出必检，UI 增加 browser/viewport 及用例所需选择、上传等能力。browser 必须声明 `executor: playwright-headless`，实际用例还验证窗口 innerWidth/innerHeight；不能把设置成功当成已生效。宿主浏览器无法证明可无交互运行时，开始前缩小范围或转人工；框架不代批宿主审批。

写入验证同时预检 fixture-authority 和 data-disposition 能力；profile 必须覆盖全部计划内验证需求并显式匹配角色、effects 和 dataPolicy。处置适配不完整的旧 profile 不自动满足 2.1。

缺项不能进入运行态。配置文件变化、授权到期/撤销、范围扩大或能力异常会阻止相关步骤；启动后重新预检不能获取或扩大授权。原授权、源码及能力覆盖范围内可重绑计划摘要，超出范围挂起。运行中不生成 request-authorization，已授权的其他工作继续；记录阻碍和恢复条件，恢复后重检。框架门禁覆盖自身管理的执行入口，不宣称拦截任意外部工具。

### 执行入口与证据

绑定 Overlay 的 compile.js、deploy-frontend.js 与 run-acceptance.js 执行时携带 `--work-item <id> --environment-alias <alias>`，可显式传 `--run-directory <run>`，须与 Overlay 相符。执行前 work item 必须为 running；入口在锁内复核授权、实际仓库、冻结来源、配置、额度新鲜度和三截止。缺绑定身份拒绝远端执行；普通非夜跑调用保留兼容。

绑定夜跑的独立 compile-csp CLI 执行会拒绝并指向 deploy-frontend --files，由该受管入口完成上传/编译/回读和同一回执；普通 compile-csp 不受影响。

部署操作及真实 test-result 自动存入当前 run 的 evidence/night-operations 并消费；operation-start/operation-result/preflight 复用 night-record 和同一事件源。原件按内容摘要去重，冲突拒绝。共享部署内容一致时，后续需求先回读目标，确认仍相同后引用已有 operation，跳过重复上传与编译。每个阶段只有对应 work item、当前联合版本的完整有效回执才能完成；单个 case 通过不足以完成整组验证。

返修后联合版本变化使旧复审、部署和测试不能满足新门禁，相关阶段重新排队；运行中的未知动作先核对结果。历史回执保留，不能覆写成新版本。候选清零仍保留已知缺陷、未知写入、数据处置和待退出资源的阻断。

2.1 running/完成/阻断转换自动记录 `granularity: stage` 及 workItemId；执行器的细分计时标为 detail，汇总总耗时使用 stage，细分分析使用 detail，二者不相加。准备、诊断、等待和证据整理可继续分段记录；缺失已开始的阶段计时标 incomplete 并阻止后续业务，不能补造或按零消耗。观察者优先消费 status 与增量事件，关键证据再读完整会话，观察与业务投入分账。

实施外层包络按 diagnosis 保守计入探索预算，包含实施投入，不作为诊断子步骤的精确归因；与其重叠的准备细分按时间并集计费。缺失细分仍标未知，不从阶段总时长倒推分配；2.0 无分层标记的计时沿用原累计方式。

用户在已更新能力包的业务工作区输入 `$bos-demand-handle --night`，并提供需求范围和截止时间。Agent 复用既有授权，生成批次、策略及编排计划；用户无需手填 JSON。`--night` 是技能路由参数，不传给 BOS 查询 CLI，不授予新的远端写入权限。新批次显式引用决策策略，历史批次不自动迁移。

Agent 使用 `node <CapabilityRoot>/scripts/night-workspace.js plan <request.json>` 生成只读计划，再执行计划中的既有 Git worktree 与 Overlay 初始化步骤。默认落点为 `<businessWorkspace>/.worktrees/<batchId>/<role>/repos/<repository>`；显式 `worktreeRoot` 可覆盖默认值。 `plan` 与 `check` 均通过 Git 检查落点的祖先仓库：仓内 worktreeRoot 必须被目录忽略规则覆盖，否则在创建或派发前停止。可在目标仓 `.gitignore` 或本地 Git exclude 中配置对应目录规则，也可选择仓外路径；脚本不自动修改忽略配置，仓外落点无需此规则。独立角色的 cwd 使用对应 Overlay workspaceRoot，共享能力指向 CapabilityRoot，项目事实通过逐文件引用复用，凭据不复制进计划。

批次的 `workspacePreflightReferences: [{ownerId,planReference}]` 引用上述计划（路径相对批次文件）。完成初始化后执行 `night-workspace.js check <plan.json>`，从实际工作 cwd 校验 Git 身份、项目引用、技能正文及脚本可加载性；派发时重新核对。worker 根 AGENTS.md 引用原业务入口，必要规则通过 requiredRules 声明；薄索引必须能找到实际正文。已有 worktree 不执行 reset；后续正常修改和基线后代提交允许继续。孤立 worktree 参与者的 ref 必须匹配预检计划的真实仓目录。使用源仓能力的 Overlay 可用于本地验证，不能据此声称原业务项目安装副本已经升级；正式使用按既有能力包更新流程刷新技能索引。

初始化交付还须按[worktree 审阅规范](guides/worktree-review.md)提供 VS Code 工作区文件及容器目录设置，使用保存计划的实际 target 和固定 revision 作为入口与创建基点。该项由 Agent 核验，`night-workspace.js check` 不验证编辑器配置或界面，不能仅凭预检通过宣称查看入口可用。

## Codex 额度门禁

新 Codex 批次设置 `quotaPolicy: {enabled:true,provider:"codex",stopClaimingRemainingPercent:20,closeoutRemainingPercent:10,maxAgeSeconds:300}`；其他宿主可设置 `{enabled:false}`。旧批次省略此字段保持原行为。阈值和有效期均可配置。

Agent 在启动、派发前和接续时读取宿主真实账户额度，提交 `{kind:"quota",snapshot:{observedAt,rateLimitsByLimitId},rationale,evidenceRefs}` 到 `night-record`；`observedAt` 使用带时区的实际读取时间。只有宿主未提供分桶结果时才使用 `rateLimits`。记录器只保留 Codex 窗口的 usedPercent、windowDurationMins、resetsAt，不保存账号或票据。按实际窗口长度判断，不能假设 primary 总是五小时窗口。没有取得快照、快照过期或无适用窗口时停止业务派发，取得新快照后重新评估。

适用窗口中最低剩余比例 ≤20% 时不再启动新需求，已实际开始的需求可继续；仅生成待启动动作不算开始。≤10% 时停止后续业务动作，保留 cleanup。正在运行的操作不会被强行中断；未知写入结果的核对、必要回读和资源退出仍必须完成并交接。额度恢复后新快照可解除额度门禁，其他准入限制仍生效。此机制依赖宿主在既有调度边界刷新快照，不创建常驻服务，不承诺宿主退出后继续监控；账户剩余比例不等于本任务 token 或费用。

## 需求记录

night-record 输入为 `{kind: "demand", rationale, evidenceRefs, record}`。record 包含：

- `id`、实际 `implementationOwnerId`、`assessment.pre` 及可选 `assessment.post`。
- `results: {knownDefect, unknownWrite}` 和 `resources: {polluted, pending}`：四项明确布尔值。
- `timingSegments`、`failures`、`reassessments`：数组，首次可为空，后续保留历史。
- `sourceScopes: [{repoRoot, scopes}]`：真实仓及本需求全部写入范围；post 必须覆盖计划写入范围。
- `scopeFingerprint`、`frozenVersion`：从 night-status.currentSources 取得。先录 pre 和 sourceScopes，再获取当前来源；独立审查后写 post。摘要绑定范围内容，HEAD 仅作来源信息，无关提交不会使范围证据失效。

assessment 包含 `businessCertainty: confirmed|uncertain|disputed`、`risk: low|medium|high`、`changeKinds`、非空 `evidenceRefs/rationale/reviewerId/minimumChecks`、`route`。changeKinds 使用 text/style/internal-logic/query/write/state/contract/ui/device/module-refactor；route 使用 static-review/internal-method/external-api/ui/manual。post 必须包含当前 scopeFingerprint/frozenVersion，并由计划中的非实现者审查。

形成可验收候选时设置 `candidateReady:true`、`handoffRef`、`humanEstimateMinutes`（缺省来自策略），并提供 `checks:[{id,status:"passed",scopeFingerprint,frozenVersion,evidenceRefs}]`，覆盖 post.minimumChecks。方法/API/UI 候选还提供匹配的 `automatedResult:{status:"passed",level,scopeFingerprint,frozenVersion,evidenceRef}`。这些记录只绑定真实证据，不把引用字符串存在视为证据内容正确。静态/人工路由保留人工待验，不能伪造 automatedResult。

已知业务缺陷继续交原 owner。实施阶段提供明确 `repairEvidenceRef` 可进入返修；未知写结果和资源干扰仍须先核对。阶段无法继续而需安全收尾时设置 `cleanupRequested:true`；仅在该需求无运行中工作或未启动业务动作占位时，调度器允许 cleanup 跳过失败/未执行依赖。先核对未知动作状态，使用现有取消/结果协议，不修改事件历史。

## 计时与复评

timingSegments 每项为 `{phase,startedAt,endedAt?}`，phase 使用 preparation/diagnosis/execute/wait/evidence/cleanup。只有 preparation/diagnosis 消耗单需求探索预算。开放段按当前时间计费，关闭时不得倒填到已观察时点之前；已关闭段和失败历史只可追加。复评前关闭 preparation/diagnosis 计费段；其余正在进行的 execute/wait/evidence/cleanup 段可保持真实开放状态，不能通过复评重置投入。完整重评仍须精确匹配当前 usedMinutes、failureCount、源码版本及证据；收敛总时限另按其原有区间规则计算，不因这项探索复评放宽。

failures 每项包含 `category/evidenceFingerprint`。连续两次相同类别及相同证据触发复评。reassessments 每项绑定 `trigger`（demand-budget-exhausted 或 repeated-failure-no-new-evidence）、当前 `usedMinutes/failureCount/scopeFingerprint/frozenVersion`，并有 rationale/evidenceRefs；新的投入或证据变化需要新评估。

共用准备使用 `{kind:"shared",timingSegments,reassessments,rationale,evidenceRefs}`，独立累计，不重复计入每条。共用复评绑定当前 usedMinutes 并附证据，开放段须先关闭。必要回读和资源退出不因探索预算耗尽被取消。

人工估值对所有安全且可验收候选求和，红色暂缓和未完成项不入分母。超出 `候选数 × humanEstimateMinutes` 后提交 `{kind:"human-reassessment",rationale,evidenceRefs}`，绑定当前汇总；可有理由继续超额，不是硬时限。

模型用量只使用宿主实测值，缺失标 unknown。work item 的 night 可选填 modelTier（fast/balanced/strong/deep-reasoning）和 modelMappingReference；动作将其作为 modelRequest 传给宿主 adapter，并计入计划摘要。未填时沿用当前模型；该接口只传递请求，不声称宿主已经切换模型。具体映射和实际使用结果由宿主提供，本期不绑定厂商或新增模型运行器。框架建设和实际批次投入分账。

现有 runner 返回真实阶段 timingSegments。可用 `{kind:"test-result",id,resultFile,rationale,evidenceRefs}` 消费绝对路径的单项 imedical-test-result/v1 原件；该原件 version 绑定当前 frozenVersion，acceptance.level 来自真实执行器。工具在 testReceipts 追加 caseId、scope、层级与原件引用，追加阶段计时、失败与资源状态，按内容摘要去重。单个 case 通过不自动生成整条需求的 automatedResult 或 candidateReady；独立审查者核对全部 minimumChecks 的真实用例覆盖后，由 Coordinator 记录汇总证据。后续失败撤销旧自动汇总与候选资格；一次成功不清除既有未知写、缺陷或其他 case 的待退出资源，须独立核对并记录裁决。调查/等待返修等模型工作仍需另记实际时间段，不能以 runner 时间冒充完整处理成本。

## 固定抽验与完成

候选集合形成后提交 `{kind:"audit-freeze",rationale,evidenceRefs}`，冻结当前静态候选及源码版本，按策略选样。原 post.route 保留 static-review；抽中项通过 post.auditRoute 声明实际运行层级，该层级仍需满足相同变更的最低验证要求。

回执为 `{kind:"audit-result",id,status,scopeFingerprint,frozenVersion,rationale,evidenceRefs}`，status 为 passed/misclassified/unverified。输入、冻结集合、当前源码必须一致；相同结果幂等，冲突保留并调查。冻结后不能添加或替换静态候选。误分级使静态策略暂停，未通过或版本过期的样本不能满足完整完成门禁。

`validate --final` 继续要求真实用户验收，并检查抽验和全部需求的缺陷/未知写/资源状态；仅将 candidateReady 清为 false 不能隐藏未收尾问题。存在人工待验或未完成抽验时，交付实际范围及断点，不声明完整业务通过。
