# 无人值守执行治理

本协议在既有 schema 2.1 batch/plan/run 上显式启用 `executionPlan.version:1`，与 [收敛门禁](night-policy.md) 和 [验收运行时](night-acceptance.md) 共用事件、授权、计时与回执。旧 run 不补字段、不迁移问题或清零计数。源码、合成测试通过不代表真实宿主或业务工程已接入。

## 事前形成可执行计划

先按已有授权保存本批用量与计时基线，将初筛、探针与规划全部计成本；缺授权集中申请。初筛需求并声明所需能力后，运行不依赖 run 的能力预检，之后才编制详细评级、测试、预算和 PLAN：

```text
node .agents/scripts/night-capability-probe.js --profile <项目初筛适配器> --output <项目私有目录/能力回执.json>
```

适配器沿用 `options` 与 `preflight`，增加初筛 `capabilityRequirements:[{demandId,role,capabilities}]`；探针不执行需求用例、不授予业务权限。通过它提供的 `createTestExecutor` 创建的探针执行器在批末统一关闭，浏览器能力须同时取得受管执行器的实际启停证据，项目自行声明通过不能代替。普通缺项输出受阻需求与可执行子集；退出未知不能作为可用证据。结果持久化并读回，已有输出拒绝覆盖且不重复启动探针。

新模板将回执路径与摘要绑定到 `capabilityProbe`，声明有效期；可执行需求和所需 UI/能力必须在已验证子集内。受阻需求保留原文与恢复条件，不纳入启动放行范围。正式执行仍执行原 run 的授权、配置、角色及资源门禁；早期证据不替代运行放行，也不通过删除检查放行缺能力的需求。启动前核时效，开始后继续核绑定与配置，运行能力由正式预检核验。

将 [executionPlan 模板](templates/night-execution-plan.template.json) 合入既有编排计划顶层。只保存一份结构化 PLAN；批次仍通过 `nightBatchReference` 关联。填写全部占位值后再批准。

- 每条需求保留原文、备注、用户初评、核实依据、可执行性、修改复杂度和风险。支持直接处理、拆解处理、缺前置、无法处理；后两类保留交接，不能进入业务执行。用户的人工耗时仅能作为该次复盘输入。
- 明确总时间、token、治理投入、周额度、三截止、授权和停止条件。规划、开发、集成、审查、两类测试、监控、报告、排障、返工与人工补救均计成本；未知项保留 unknown。
- 至少两个 Developer 各用独立 owner/worktree；一个功能 Tester、一个浏览器 Tester、一个 Coordinator。核实真实客户端容量；四槽位必须事前声明 Tester 错峰。新模板 `maxInFlight:4`，它约束流水线占用，实际 Developer 并发另行取证。旧 run 的容量不自动改变。
- 每个需求至少一项 `minimumTests`，包含唯一 case ID、owner、level、精确 scope、预期与理由；不默认全量 UI。静态、方法、接口、目标 UI、人工交接分别选择。不同验证部分可用同一需求的多个 verification 工作项，分别声明 `night.route` 和角色。
- 写清逐仓固定基点、目标路径、写入范围、集成 owner、冻结/发布顺序和测试数据处置。按[人工复验数据规则](../agents/_shared/testing-protocol.md#人工复验数据与收尾)保留供用户快速验收的获准样本，将范围、授权引用与交接说明填入既有 `dataRetention`，采用保留策略时明确 `mode:retain`。两个 Developer 不共用实体目录；Tester 消费冻结材料或计划中声明的测试 worktree。

`agents/` 中的 canonical 角色继续有效，PLAN 只补本批约束。模型用能力档位和宿主映射，不把具体型号或订阅名称写进 canonical。

## 周额度先取基线

批准 PLAN 前读取真实客户端用量，保存脱敏快照，再执行：

```text
node .agents/scripts/night-quota-baseline.js --snapshot <snapshot.json> --policy <quota-policy.json> --budget-id <stable-id> --authorization-ref <用户预算引用> --output <本批baseline.json>
```

policy 含 `enabled:true,weeklyBudgetPercentPoints:<本批批准百分点>`。脚本拒绝覆盖，保存实际落盘时间、授权引用与 10080 分钟周窗口。将同一文件、budgetId 和预算写入 PLAN；重建 run 继续引用原基线。基线内容改变、读数过期/未来/倒退、周窗口改变或不可用时阻止新业务动作。不能用新基线偷偷重算已有开销。

本批总时间从基线落盘时计入，包含事前治理；填写时须为计划、审核及执行安排足够窗口。主会话/规划 token 缺实读时不造零：新 run 的 0 只表示尚无已启动受管端点，执行分配保守扣除 governanceTokens，报告总成本仍为未知。周额度读数继续归集整批全部会话。

本批消费为周总额度 usedPercent 相对基线的百分点增量，保留高水位。到批准预算 80% 停领新，到 100% 停业务推进并收尾；账户原有 20%/10% 剩余保护和三截止同时生效，先触发者优先。token 与额度不是等价单位。账户读数含该账户全部会话，不凭“无人值守”排除其它消费；延迟和在途请求需要提前量，不能保证零超支。

## 物理规则与派发

工作区请求显式设置 `executionPlanVersion:1`、`roleOwnerId` 和 `runReference`。先 `night-workspace.js plan` 审阅，再按计划创建 worktree。批准后的既有 run 包含当前 `planHash` 与合作授权，随后：

```text
node .agents/scripts/night-workspace.js materialize <owner-workspace-plan.json>
node .agents/scripts/night-workspace.js check <owner-workspace-plan.json>
node .agents/scripts/agent-orchestrator.js next --run-directory <run>
```

materialize 在外层工作区及物理 Git 根写实体 `.agents/rules/night_run_plan.md`，完整 PLAN 为生成视图；根 `AGENTS.md` 受管片段引用原项目入口、本批 PLAN 和角色规则。已确认的原入口链接转成本地薄入口，不向链接目标写入；普通文件局部合并。共享/未知链接、源仓身份或基点不符会停止。直接从物理仓启动却无绑定 Overlay 时，受管执行入口拒绝静默退回普通执行。

action.context 实际携带公共硬约束、当前角色、当前需求原文与备注、范围、最低测试、依赖和预算快照；完整 PLAN 留路径与摘要供回查，避免每次重复注入整批。adapter 将 text 传入真实宿主并回传 contextHash。稳定 binding、物理规则及当前计划在启动和成功 ACK 时复核；仅声明“已发送”不证明模型遵守。恢复、换角色或任务需要新上下文。安全 cleanup 仍可在预算耗尽时执行。

事前预检另含 `client-lifecycle`、`client-stop`、`client-usage`、`automation-inventory` 的实际非交互证据。检查遗留自动任务归属，结束只处理本批拥有的任务；不能清理其它任务来伪造空环境。

## 同类并行与联合版本

按 Git common directory 与类相对路径识别关联；worktree 路径不同不会产生两个独立源仓。同类不同片段可并行，同方法、字段、辅助逻辑或契约冲突由既有 Developer 集成 owner 先统一方案。没有通用文件锁服务。

集成沿现有授权与 Git/diff 工具完成；撤回失败需求只撤对应修改，不整文件恢复。通过原 `night-record` 写：

| kind | 内容 |
|---|---|
| source-integrate | demandId、integrationBinding:{ownerId,repositoryRoot}；绑定批准的集成仓、原逻辑源仓及固定基点，撤销本版本 post 评估，保留历史。 |
| source-freeze | demandId；当前独立 post 评估后，将范围内源码精确复制到 run/evidence/frozen-sources，记录内容摘要及来源。无需擅自 commit。 |
| evidence-reuse | demandId、review:{reviewerId,fromVersion,toVersion,checkIds,affectedChecks,changesHash,diffReference,evidenceRefs}；独立审查绑定真实前后差异。 |
| source-missing | demandId、searchedScopes:[{repositoryRoot,scopes}]、elapsedMinutes、handoffRef；声明范围内有界查找仍缺源码，跳过并记录恢复条件。 |

这些事件都要求 Coordinator、rationale、evidenceRefs。源码快照排除私有配置/链接；快照篡改阻断。后续开发不改变历史版本证据；部署传输取冻结 bytes，保留原来源与目标映射。编译产生新 Storage 时不得回写冻结材料，明确返回源码复审缺口。

需要复用旧检查时生成实际对照材料：

```text
node .agents/scripts/night-source-diff.js --run-directory <run> --demand <id> --from <旧冻结版本> --output <本批diff.json>
```

review 必须引用该材料及其 changesHash；旧回执不改成新版本通过。运行验证的复用还要求旧版本同 case、层级和 owner 的真实回执，静态检查不能升级为 UI/API 覆盖。不确定影响就重跑对应范围。

每个 deployment 工作项声明 `night.deploymentTargets`。受管传输提交实际 targetId 集合并与声明精确核对；共享目标按“环境别名＋目标”串行。上一版本验收在途、发布未知或回读未闭合时，阻止同目标下一发布；其他目标继续。部署对象漂移仍需运行端前后回读，框架无法约束绕过受管入口的外部写入。

后续发布还须保证先前相关需求已独立审查同一份联合源码：将这些需求绑定、复审并冻结到相同目标内容，再发布联合版本。旧发布的目标到源码映射缺失或相关需求仍绑定旧内容时停止发布；不能只凭上一条已验收就覆盖。集成换版沿现有重排机制取消旧待派发 action，将审查、部署、验证重新排队，保留历史回执；跨仓需求只重绑对应源仓，其余仓库保留。需要运行重验的部分在联合发布后执行，不能借复审伪造运行通过。

整个冻结版本、环境、部署配置、目标覆盖和依赖组合完全一致时，共用同一次实际发布回执并保留原操作来源，避免逐需求重复传输；需求各自的验证与交付状态仍独立核验。仅同文件或部分目标重叠不够，未覆盖部分继续保留自己的发布要求。

## 浏览器 Tester v1

项目 adapter 保存经过验证的初始化、登录、岗位、业务 frame、版本和业务断言；框架负责 owner 生命周期、预算、证据与退出。凭据、cookie、token 不进入规则、action 或报告。身份/配置引用使用非敏感标识或摘要，登录成功不代表 UI 行为被覆盖。

```text
node .agents/scripts/run-acceptance.js --worker --profile <project-profile.js> --run-directory <run>
```

stdin 每行一条已登记请求，例如：

```jsonl
{"id":"prepare-1","operation":"preflight","deadlineAt":"<带时区操作截止>"}
{"id":"test-1","operation":"verify","workItemId":"<verification-id>","environmentAlias":"<alias>","deadlineAt":"<带时区操作截止>"}
{"id":"stop-1","operation":"stop"}
```

worker 总 deadline 取 profile，单请求截止独立。预检通过后，多需求复用相同项目、环境、身份、角色和认证配置的 owner；每次验证重新 begin/checkpoint/consume/finish。认证检查有效时复用，确认失效才恢复；恢复后重验身份与前置条件。request context 共享当前浏览器 cookie；Broker 等页面票据仍由项目 adapter 在页面中处理，`authentication.mode:browser-session` 与 `level:external-api` 可组合。

case 只清理页面、监听器等自身运行资源；数据按已批准的处置策略保留、重置或删除，`close` 不删除保留验收样本；认证主页/context/browser 留 worker 统一退出。preflight/v2 分别证明临时资源退出、保留 owner 可控、无未结束操作，不能标全部退出。批末、取消和绝对截止执行 stop 并归档每个 owner 的实际退出回执；旧 owner 未核销不能通过替换预检丢弃。超时底层操作仍在则阻止接新需求。进程丢失后读断点并核旧 owner，不能声称登录态仍存活。

正式 UI 默认已验证无头 profile。断言包含业务页/frame 实际尺寸、可见状态、部署/加载版本、业务结果及相关 Console/Network 来源；空白探针页、仅配置视口、截图或忽略所有错误均不能证明通过。Edge/有头/内置浏览器用于计划指定验收或有界诊断，切换重新核对身份与版本。原生打印、真实设备、未知异常单独留项，不扩大成全量 UI。

## 客户端与交付

`scripts/lib/night-client.js` 定义 probe/injectContext/startOrResume/status/usage/stop；首个 Codex adapter 使用本机 app-server 官方 schema 探测与 stdio。原生 Plan 与执行分开；支持 Goal 时 set tokenBudget 后 get 回读，再启动业务 turn。派生会话分别配置预算，不假定继承。无 Goal 使用有界单 turn、持久断点和监督，不静默降级并发或停止要求。适配器需持续运行才能处理定时中断；interrupt ACK 与已停止、业务资源退出分别取证。

受管宿主消费者使用 `night-client-supervisor.createManagedNightClient`：启动前真实 gate、原 run 锁内 `client-reserve` 原子分配、实际启动回执落盘读回、结构化 ACK，失败先停止并保留未知归属。`tick()` 读取真实端点状态/用量并写回原事件；额度未知或耗尽时请求停止，drain 只停止领新。调用方须维持监督进程并保存断点；无 Goal 时还需新鲜 watcher 回执、真实 PID 和控制通道 challenge，仅 JSON 自称 active 不能通过。进程丢失后的恢复不承诺在途请求已经停止。原始 host adapter 只供受管消费者实现使用，不作为跳过门禁的夜跑入口。

实际入口为 `node .agents/scripts/night-client-worker.js --run-directory <run> --host codex`。保持 stdin 控制通道打开，每行传 `{id,operation:"startOrResume",request:<已批准 action 的启动参数>}`，也支持 `observe` 与 `stop`；它不选择工作或自行新增会话。worker 默认每 5 秒读取用量、门禁和实际状态，将断点写回 run 的受保护证据。EOF、取消和额度/截止收尾只停止本批端点；超过 30 秒仍未知则保留未退出证据，不标清理成功。单 run 的 PID 租约防止双监督，旧 PID 已消失才恢复；恢复端点重新挂原截止计时器，无法回读则禁止新启动。

新模板 `clientSupervision.required:true` 的启动 ACK 同时要求预算预留、实际回执和存活监督进程；仅构造成功 JSON 无法放行。旧计划不补字段，正常更新取得新脚本后，对新批次使用新模板及 CLI，不能将旧运行器视为已接入。宿主实际 Goal、停止效果和业务部署仍须真实项目单独取证。

```text
node .agents/scripts/night-report.js --run-directory <run> --format markdown --output <归属项目docs中的报告.md>
```

报告由 run/events 派生，含分级交付、原文与缺口、演示入口、worktree/固定基点、联合/发布/验收版本、历史复用、数据保留和下一步；另外统计全部成本、返工、人工负担及实际 Developer 重叠。未观测项不造零，初期损失与后续产出分别保留。监控只在长期无交付、失败、撤回、预算异常等有意义变化上提示模型。

最低自检是否满足、是否可交接与实际证据等级分开显示；批准静态路线且满足最低检查时交付为“自检达标可交接”，不要求补运行/UI 回执，也不计为运行测试通过。存在部署工作时仍需当前发布证据。长期无交付按最近新增有效候选或通过用例的事件时间计算；同版本同用例重复回执、额度观测和状态刷新不重置时间。已有交付但缺时间证据时保留未知；CLI 使用本次实际观察时间，避免无新事件时停滞计时冻结。

需要“长期无交付”提醒时，在 PLAN 显式设置 `monitoring.noDeliveryMinutes`；越过门槛时提示一次，无状态变化不重复调用模型。无该字段不猜测适合所有批次的阈值。

先以合成夹具验证契约，再在另行批准的真实项目以最多 5 条需求试跑，覆盖同类并行、目标 UI、浏览器认证 API、过期恢复和退出。Playwright 方法与实践回归由用户负责的 P1 待治理项继续完善。扩大批量取决于交付质量与总成本同时受控，不仅看代码产出数量。
