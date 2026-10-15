# 夜跑决策接口

适用范围和分级语义见[分层验收](night-acceptance.md)。本接口扩展既有编排 run；不启动业务操作、不授予权限，也不替代 Coordinator 对需求、证据和独立审查真实性的核验。

## 启用与执行

计划的 `nightBatchReference` 相对计划文件解析。批次设置唯一 `batchId`、带时区的三截止和 `decisionPolicyReference`；策略引用相对批次文件，填写[策略模板](templates/night-decision-policy.template.json)。无策略引用的旧批次保持原行为。批次与策略的 maxInFlight 必须一致。

启用后每个 work item 声明 `night: {demandId, phase}`，phase 为 implementation/review/deployment/verification/cleanup。每个需求的 implementation 工作项具有唯一实际 owner。cleanup 必须使用 `kind: cleanup` 且无业务源码 writeScopes；它仍遵守数据处置授权。角色和独占源码范围沿现有计划声明。

```text
node .agents/scripts/agent-orchestrator.js night-record --run-directory <run> --record <input.json> --actor <实际coordinatorId>
node .agents/scripts/agent-orchestrator.js night-status --run-directory <run> --demand <id> --json
```

`next` 在现有锁内执行准入、预算、容量和截止检查，生成动作立即预留容量。宿主消费动作前调用既有 `transition --entity work-item --id <workId> --status running` 再检查当前门禁；动作生成不等于已经启动，截止后的旧动作不得直接执行。实际执行器仍须使用批次 deadline。无法执行的原因在 night-status 的 decisions 中读取，不反复请求相同授权。

## 显式入口与工作区

用户在已更新能力包的业务工作区输入 `$bos-demand-handle --night`，并提供需求范围和截止时间。Agent 复用既有授权，生成批次、策略及编排计划；用户无需手填 JSON。`--night` 是技能路由参数，不传给 BOS 查询 CLI，不授予新的远端写入权限。新批次显式引用决策策略，历史批次不自动迁移。

Agent 使用 `node <CapabilityRoot>/scripts/night-workspace.js plan <request.json>` 生成只读计划，再执行计划中的既有 Git worktree 与 Overlay 初始化步骤。默认落点为 `<businessWorkspace>/.worktrees/<batchId>/<role>/repos/<repository>`；显式 `worktreeRoot` 可覆盖默认值。独立角色的 cwd 使用对应 Overlay workspaceRoot，共享能力指向 CapabilityRoot，项目事实通过逐文件引用复用，凭据不复制进计划。

批次的 `workspacePreflightReferences: [{ownerId,planReference}]` 引用上述计划（路径相对批次文件）。完成初始化后执行 `night-workspace.js check <plan.json>`，从实际工作 cwd 校验 Git 身份、项目引用、技能正文及脚本可加载性；派发时重新核对。worker 根 AGENTS.md 引用原业务入口，必要规则通过 requiredRules 声明；薄索引必须能找到实际正文。已有 worktree 不执行 reset；后续正常修改和基线后代提交允许继续。孤立 worktree 参与者的 ref 必须匹配预检计划的真实仓目录。使用源仓能力的 Overlay 可用于本地验证，不能据此声称原业务项目安装副本已经升级；正式使用按既有能力包更新流程刷新技能索引。

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

timingSegments 每项为 `{phase,startedAt,endedAt?}`，phase 使用 preparation/diagnosis/execute/wait/evidence/cleanup。只有 preparation/diagnosis 消耗单需求探索预算。开放段按当前时间计费，关闭时不得倒填到已观察时点之前；已关闭段和失败历史只可追加。复评前关闭当前计时段，不能通过复评重置投入。

failures 每项包含 `category/evidenceFingerprint`。连续两次相同类别及相同证据触发复评。reassessments 每项绑定 `trigger`（demand-budget-exhausted 或 repeated-failure-no-new-evidence）、当前 `usedMinutes/failureCount/scopeFingerprint/frozenVersion`，并有 rationale/evidenceRefs；新的投入或证据变化需要新评估。

共用准备使用 `{kind:"shared",timingSegments,reassessments,rationale,evidenceRefs}`，独立累计，不重复计入每条。共用复评绑定当前 usedMinutes 并附证据，开放段须先关闭。必要回读和资源退出不因探索预算耗尽被取消。

人工估值对所有安全且可验收候选求和，红色暂缓和未完成项不入分母。超出 `候选数 × humanEstimateMinutes` 后提交 `{kind:"human-reassessment",rationale,evidenceRefs}`，绑定当前汇总；可有理由继续超额，不是硬时限。

模型用量只使用宿主实测值，缺失标 unknown。work item 的 night 可选填 modelTier（fast/balanced/strong/deep-reasoning）和 modelMappingReference；动作将其作为 modelRequest 传给宿主 adapter，并计入计划摘要。未填时沿用当前模型；该接口只传递请求，不声称宿主已经切换模型。具体映射和实际使用结果由宿主提供，本期不绑定厂商或新增模型运行器。框架建设和实际批次投入分账。

现有 runner 返回真实阶段 timingSegments。可用 `{kind:"test-result",id,resultFile,rationale,evidenceRefs}` 消费绝对路径的单项 imedical-test-result/v1 原件；该原件 version 绑定当前 frozenVersion，acceptance.level 来自真实执行器。工具在 testReceipts 追加 caseId、scope、层级与原件引用，追加阶段计时、失败与资源状态，按内容摘要去重。单个 case 通过不自动生成整条需求的 automatedResult 或 candidateReady；独立审查者核对全部 minimumChecks 的真实用例覆盖后，由 Coordinator 记录汇总证据。后续失败撤销旧自动汇总与候选资格；一次成功不清除既有未知写、缺陷或其他 case 的待退出资源，须独立核对并记录裁决。调查/等待返修等模型工作仍需另记实际时间段，不能以 runner 时间冒充完整处理成本。

## 固定抽验与完成

候选集合形成后提交 `{kind:"audit-freeze",rationale,evidenceRefs}`，冻结当前静态候选及源码版本，按策略选样。原 post.route 保留 static-review；抽中项通过 post.auditRoute 声明实际运行层级，该层级仍需满足相同变更的最低验证要求。

回执为 `{kind:"audit-result",id,status,scopeFingerprint,frozenVersion,rationale,evidenceRefs}`，status 为 passed/misclassified/unverified。输入、冻结集合、当前源码必须一致；相同结果幂等，冲突保留并调查。冻结后不能添加或替换静态候选。误分级使静态策略暂停，未通过或版本过期的样本不能满足完整完成门禁。

`validate --final` 继续要求真实用户验收，并检查抽验和全部需求的缺陷/未知写/资源状态；仅将 candidateReady 清为 false 不能隐藏未收尾问题。存在人工待验或未完成抽验时，交付实际范围及断点，不声明完整业务通过。
