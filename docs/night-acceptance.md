# 夜跑与分层验收接入

入口为 [夜跑 workflow](../workflows/bos-demand-unattended.workflow.md)，基础契约见 [测试运行时](testing-runtime.md)。本方案不是后台调度服务；Coordinator 负责阶段与授权，工具负责有限执行、会话和清理。

新批次使用 [无人值守治理](night-governance.md) 落盘 executionPlan，并选择两类 Tester、持续 worker/v2 预检及认证复用；旧单次入口兼容。第一批真实治理试跑最多 5 条，授权与预算另在目标项目 PLAN 确定；下文历史 10 候选抽验用于后续扩大阶段。

## 选择最小充分的验收层级

批次显式启用成本分级策略时，先执行下节的两次评估，再选择本表中的运行层级；未启用时沿用现有流程。分级不改变授权、业务验收状态或领域硬约束。

| level | 适用 | 完成证据 |
|---|---|---|
| internal-method | 内部计算、转换、校验 | 正常/边界/异常输入与输出 |
| external-api | Broker/REST/SOAP 等对外契约 | 实际入口、认证/参数/业务响应；写入独立回读、关联保护与重复请求 |
| ui | 交互、可见结果、前后端联动 | 正常用户路径、界面证据、实际加载版本与必要业务回读 |

纯后端不加载 Playwright；仅为取得认证使用浏览器时，结果仍标真实后端入口。内部方法成功不代表 HTTP/Broker 契约正确。返回格式改变须核对消费者，影响前端行为时补 UI 用例。原生打印/组件/设备按客观困难交接，不强行包装为 Web 验收。

## 可选成本分级策略

Coordinator 复用 Planner、Review 和 Testing 职责执行两次评估，不新增常驻分发 Agent，也不建立第二份业务台账。评估引用完整需求、实际调用链和证据；颜色只是汇总展示，分别保留业务确定性、实现风险与验证成本。

1. **派发前准入**：核对业务意图、旧行为、源码范围和可观察验收条件。真实业务争议、关键事实缺失或必须由用户决定的取舍，暂缓开发并记录具体问题；跨模块、重构或高风险操作按已授权边界评估，不以需求标题或文件数定级。源码能证明现状，不能单独证明用户想要的业务方向。
2. **冻结后复评**：依据实际 diff、调用方影响与独立短审重新选择验证。每条实施结果必须经过独立于实现者的短审，重点核对需求方向、遗漏和旧行为保护；没有独立执行者时保留待独立审查，串行自审只能作为补充。短审不是强制新增长驻会话，可复用已有 Reviewer 或有明确证据的批次审查。

冻结后可选择静态证据、内部方法、真实接口、界面或人工待验；静态证据只说明审查及对应静态检查已完成，不能标记运行验证通过。是否降低运行投入由实际风险、有效证据和用户允许的人工验收范围共同决定；查询、插入或简单 UI 都不是天然低风险。数据写入、权限与公共契约仍按适用规则验证；运行困难可留下明确待验范围，已知缺陷必须返修。

探索投入与重复失败触发复评，不直接判业务通过。复评记录已获得证据、尚缺结论、下一次尝试能增加什么证据以及继续或人工交接的理由。批次预算用于控制投入，并保留人工验收预计耗时；预算不足不能将未验证改名为已通过。时间策略和抽验选择以批次的显式配置及执行结果为准。

新策略由批次的 `decisionPolicyReference` 显式启用，引用路径相对批次文件；正式计划通过 `nightBatchReference` 引用批次，路径相对计划文件。未提供新策略引用时保持旧行为。启用后 work item 用 `night.demandId` 与 `night.phase` 关联需求及 implementation/review/deployment/verification/cleanup 阶段，评估证据仍使用既有 inputRefs/outputRefs。

起始策略采用每需求 13 分钟探索投入、共用准备 30 分钟；人工验收缺少单项估值时按每候选 6 分钟预估，批次人工参考为候选数量乘以 6 分钟。可按实际情况逐项估值；人工预计总量超过批次参考时必须复评并说明理由，允许有理由超额。这些是投入与分流的复评依据，不是批次 3 小时硬停止。连续两次失败且没有新增有效证据时提前复评；有新证据的合理下一步可在记录理由后继续，时间截止仍由批次独立执行。预算按实际阶段耗时累计，复评或重试不重置已发生投入。

首批按 10 个新候选、20% 固定抽验校准策略。冻结候选集合后按 `sha256(batchId + "\n" + demandId)` 升序选择样本，摘要相同时按需求号排序；不能通过重排或替换困难候选改变抽样。抽验需完成与风险匹配的运行范围；样本待验或失败如实保留，不算已通过。后续批次按实际质量和总成本重新决定策略，而不是从一次结果推出长期免测比例。

Coordinator 使用 `agent-orchestrator.js night-record --record <记录文件> --actor coordinator` 记录评估和共用准备投入，`night-status` 查看当前决策；二者沿用正式 run 的目录参数和事件事实源。具体输入以 CLI 契约为准，记录引用的真实性仍由 Coordinator 核验。该策略不授予代码写入或外部操作权限。

独立短审、静态证据、运行结果、人工待验和用户验收分别记录；合并统计时按需求号去重。对新候选保留固定抽验样本，不能仅挑容易运行的需求；抽验发现漏检后重新评估同类变更及未抽中项。准备、探索、执行、返修和人工验收时间分开统计，不能以自动产量代替总交付效率。

模型采用 fast、balanced、strong、deep-reasoning 等抽象能力档位，由宿主映射。按同类任务的实际审查漏检、工具可靠性和总成本调整映射，不按厂商或国别预设能力；模型切换不降低独立审查与证据要求。

## 批次与执行器

新夜跑按 [2.1 启动契约](night-policy.md#schema-21-启动契约) 先集中授权和实际预检，再进入 running。已有 2.0 run 和普通 profile 保持兼容，旧 profile 不自动取得新夜跑资格。

启用决策策略后的输入、计时、源码绑定、抽验和恢复步骤见[夜跑决策接口](night-policy.md)。

目标工程填写 [批次模板](templates/night-run-batch.template.json)，null/空项为待确认，模板不是授权。时间须明确时区且满足停止领取 ≤ 停止发布 ≤ 绝对停止。默认 maxInFlight=1，通知/数据处置引用当前批次策略；旧夜跑时点和业务资料不复制。

项目编写 JS profile，执行：

```text
node .agents/scripts/run-acceptance.js --profile <目标工程的profile模块>
```

模块导出 `{options,cases}` 或返回该对象的异步工厂。这是可信项目代码入口，需先按目标项目规则审查。CLI 只返回 `imedical-acceptance-batch/v1` JSON；一项非 passed 就停止后续用例，退出前清理。scope-passed 仅代表指定范围，不写入用户验收或业务台账，Coordinator 仍核验证据并消费既有 run。

options 必填 projectRoot 和未来的 deadlineAt（毫秒时间戳）；timeoutMs 默认 30000，closeTimeoutMs 默认 10000。UI 可提供 runtimeModule、executablePath、viewport 和 resourceKey。依赖解析优先显式模块，否则从项目解析 playwright；不会扫描其它工程、安装 npm 包或下载浏览器。CI 固定独立测试依赖，项目不要求 npm install。

每个 case 延续 `runTestCase` 的 demandId/caseId/scope/version，并明确 level、entry（脱敏入口名称）、role、coverage。createAdapter 接收 `{context,collector,apiRequest,signal,session}`，返回 prepare/verifyVersion/execute/assert/sideEffects/close；后端 case 的 context/collector/apiRequest 为 undefined。所有阶段有界；结果未知不自动重试，残留操作阻止下一用例。

runner 不强制创建会话：项目可传现有 test-session 实例，并在自己的认证适配中复用持有的 context。项目在确认有效业务活动后调用 session.noteActivity({verifiedExtendsSession:true})；心跳入口必须真实验证；没有后台能力时恢复前检查。单个执行者/角色复用 context，换角色先关闭旧 context。不同执行者账号、数据及共享设置未隔离时保持串行。

### 项目 profile 示例

以下展示契约衔接，project 模块由目标工程实现并从私有配置或内存获取认证；任何服务调用均需对应授权。

```js
const project = require('./project-acceptance-adapter');

module.exports = async () => ({
    options: {
        projectRoot: project.root,
        deadlineAt: project.batch.stopAt,
        runtimeModule: project.runtimeModule, // optional; backend never loads it
        session: project.session,
        resourceKey: request => project.resourceKey(request)
    },
    cases: [{
        demandId: project.demandId,
        caseId: 'service-contract',
        scope: project.backendScope,
        version: project.frozenVersion,
        level: 'external-api',
        entry: 'project-service-entry',
        role: project.role,
        coverage: ['normal', 'boundary', 'independent-readback'],
        createAdapter: ({ signal }) => project.backendCase({ signal })
    }, {
        demandId: project.demandId,
        caseId: 'visible-behavior',
        scope: project.frontendScope,
        version: project.frozenVersion,
        level: 'ui',
        entry: 'normal-menu',
        role: project.role,
        coverage: ['menu', 'visible-state', 'business-readback'],
        createAdapter: ({ context, collector, apiRequest, signal }) =>
            project.uiCase({ context, collector, apiRequest, signal })
    }]
});
```

纯后端 profile 只保留第一项，无需 runtimeModule。接口不是 Broker 时沿用实际 REST/SOAP 客户端。assert 必须引用已取得的证据，不使用示例路径作为正式材料。

## 2.1 项目适配与数据成本

### 逐需求预检与补齐

框架负责宿主生命周期、受管执行器、预算、回执及停止恢复；项目维护方提供可访问环境、业务权限、私有配置来源与数据限制；执行 Agent 负责发现已有资产、在授权内补项目适配和逐需求用例。使用现有 profile/case 契约，不另建测试运行器。

`capabilityRequirements` 兼容原 `{demandId,role,capabilities}`。新逐用例条目可增加 `caseId,level,effects,authentication,rationale`；使用这些字段必须说明 rationale。level 沿最低测试层级，effects 为 read-only/write，authentication 为 none/api/browser-session。运行时为 ui 或 browser-session 加 browser，为非 none 认证加 authentication，为 write 加 fixture-authority/data-disposition，再为 browser 加实际启停检查。只读项不会自动要求造数和处置；明确声明的能力仍保留。effects 未知时先调查，不填 read-only 规避要求。

checks 可按 `demandId`、`caseId`、role 限定证据范围；缺少限定表示该项检查真实覆盖全部对应需求/用例，须由项目证明。相同范围的失败或受阻记录优先于通过；一个用例通过不能放行另一个用例。无 caseId 的需求级声明不能消费限定 caseId 的证据。该需求所有声明都通过才进入 eligibleDemandIds；共享资源退出未知仍阻止整份回执放行。

状态仍为 passed/blocked/failed；可选 reason 为 implementation-missing、not-attempted、execution-failed、exit-unknown、not-applicable，另附 owner 和 recheckRef（脱敏引用，不填命令或凭据）。evidenceRef 指向真实探测或已检查的源码缺口。reason 是未通过原因，不能与 passed 共同授予通过；未分类缺口在 gaps 中记 unverified，不推断为实际失败。无写入时在 rationale 说明为何不声明数据能力；将必需能力标成 not-applicable 仍阻断。CLI 同时给出受阻需求的 gaps 与全局 blockers，原始详细证据留项目私有位置。

例如，两个独立需求分别声明：

```js
capabilityRequirements: [
    { demandId: 'layout', caseId: 'layout-read', role: 'browser-tester',
      level: 'ui', effects: 'read-only', authentication: 'browser-session',
      capabilities: ['business-entry'], rationale: '展开查询区即可断言，无持久写入' },
    { demandId: 'save', caseId: 'save-readback', role: 'functional-tester',
      level: 'external-api', effects: 'write', authentication: 'api',
      capabilities: ['business-entry'], rationale: '保存专用样本并独立回读，按授权保留' }
]
// 项目实际检查后的缺口，不是预填结论：
// { id:'fixture-authority', demandId:'save', caseId:'save-readback',
//   role:'functional-tester', status:'blocked', reason:'implementation-missing',
//   nonInteractive:true, evidenceRef:'source:project-fixture-adapter-review',
//   owner:'project-adapter', recheckRef:'profile:save-readback' }
```

接入包沿现有项目测试目录保存：配置引用说明、真实认证和身份/正常入口 adapter、一个只读 case、一个写入及处置 case、同一 profile 的 preflight 和调用说明。将影响执行的 adapter 文件列入 configurationFiles，认证不能使用无条件 true 的 ensureReady。模板和样例不构成真实接入证明。

真实试点先选两条独立小需求，分别覆盖上述只读和写入链路；先取得认证、版本、断言、独立回读、数据处置及资源退出证据，再验证正式 PLAN 下双 Developer 实际执行、Tester 消费冻结版本、持续监督和一次停止/恢复。全部使用原 run、预算及三截止，未知写入先回读。准备/执行/恢复耗时、人工介入及受阻原因从持久记录统计；不能以串行完成或局部探针通过宣称受管夜跑成功。未取得真实证据的接入包标为待验。

profile 可导出 `preflight({signal,createTestExecutor})`，使用同一实际认证、业务角色和正常入口验证能力，并在 finally 有界退出。返回结构见[预检回执](night-policy.md#schema-21-启动契约)。options.configurationFiles 显式列入适配器、环境配置及影响执行的项目文件；自动摘要不保存文件内容。preflight 受 timeoutMs/deadlineAt 限制；超时或退出不明不得启动，先核对探针资源。取消信号必须由适配器响应。

UI case 在启动前的工作项中声明 `night.route: ui`（已有冻结后 UI 评估时可复用），使无头与视口能力进入预检；不能延后到运行时才发现 profile 需要浏览器。实际验收的 options.projectRoot 须为该 work owner 的 Overlay workspaceRoot，异步 profile 工厂可使用传入的 workItem/night 选择项目配置。

新 case 显式 effects；写用例提供 inspectFixtures 与 finalizeData，复用项目原有 fixture authority，不另建通用数据库台账。inspectFixtures 在批量准备前核实业务 RowID、关联记录、精确归属/租约/当前状态和一条完整真实入口，返回 identityVerified/relationsVerified/ownershipVerified/entryVerified/reuseVerified 五项 true 及 evidenceRefs。任何缺口阻止执行，也不调用写处置适配器猜测删除对象。正常操作触及的共享父记录和审计字段纳入预授权，sideEffects 独立前后回读。

检查清单逐项记录结果；在 Windows PowerShell 5.1 中每条原生命令后立即保留并检查退出码，例如以下片段（变量由当前项目填写）：

```powershell
& node --check $profilePath
$syntaxExit = $LASTEXITCODE
if ($syntaxExit -ne 0) { throw "Profile syntax check failed: $syntaxExit" }
& node $projectCheckScript
$projectExit = $LASTEXITCODE
if ($projectExit -ne 0) { throw "Project check failed: $projectExit" }
```

已知源码范围的编码及条件 i18n 检查在编辑前执行，最终 diff 后复核，继续使用原有领域规则和检查入口，不新增通用检查运行器。

finalizeData 接收 `{policy,status}`，项目返回 `{status: retained|reset|deleted,verified,evidenceRefs}`；无本轮数据时可明确 not-applicable 并附依据。未知写结果先独立回读，不自动重放。处置使用关闭预算，仍须在原授权范围内；随后独立调用 close 退出资源。结果 `dataDisposition` 与 `cleanup.verified` 分开：保留且已核验可以通过，关闭成功不证明数据删除，处置失败也不能隐藏退出失败。

开发测试库按[人工复验数据与收尾](../agents/_shared/testing-protocol.md#人工复验数据与收尾)保留获准样本，供用户后续快速验收；沿用授权，通过现有 evidenceRefs 引用需求号、批次、记录 ID、场景、页面入口及复验步骤。删除用例单独核验指定对象；成本对照试验不作为获准保留数据交付的前置门禁，无需新增 schema 或同义台账。

授权测试项目采用同一用例集、角色和数据规模，对 retain、reset、delete 各完成至少三轮全周期，共至少九轮；以项目既有 profile/fixture 适配执行，不建立新调度器。逐轮保留准备、执行、独立读回、处置、资源退出、人工介入次数/耗时，以及运行前后记录数/字节增长。prepare/fixtureReadiness、execute、assert/sideEffects、dataDisposition、close 取实际 durations；人工介入和数据量由项目独立采样，缺项为 unknown。比较各策略总耗时中位数、范围及增长，再由项目选择策略；不同规模、首次造数和重复复用分别统计，不把合成测试当作清理收益。本轮框架测试不执行真实造数或这九轮项目成本试验。

## UI 与证据

Playwright 默认无头 Chromium；指定已安装 Chrome 等执行文件时记录其实际版本，不宣称与 bundled Chromium 相同。headed 仅按项目明确诊断需要开启。page 操作保留正常角色/菜单，不改页面内部变量制造通过。

collector 在首导航前挂载，项目 prepare 设置目标 frame，verifyVersion 对其实际资源响应检查。runner 自动记录 pageerror/console-error 的脱敏事件；具体原文按需由项目在受保护位置保存。上下文内所有页面（含 popup）纳入监听，但无法确认归属的请求保留待复核。

context.request 与页面请求分别采集；`apiRequest(url,options)` 返回原 Playwright response，项目核验业务正文并 dispose。API 摘要不包含 URL、参数或票据。页面/API 异常及未知 frame 归属会阻止自动通过；项目可提供 reviewObservations(observations)，仅在逐事件证据支持时返回 true。该复核结果及依据由项目保留，不用统一取消白名单。

项目 close 只退出该 case 持有的页面等运行资源，数据按 finalizeData 的已授权策略处置，close 不重复删除保留数据；runner stop 负责 collector、context、browser 和 session。仅 cleanupVerified=true 才声明执行器退出；卡住的回调或关闭失败交接为未清理，不杀用户其它浏览器进程。

## IRIS Broker 机器调用

使用 [debugger.js](../plugins/coding-iris-plugin/scripts/iris-tools/debugger.js) 导出的 callBroker，或 `debugger.js --json --stdin`。该模式不读本地配置、不提示交互，目标配置由调用者从工程既有机制解析。JSON 输入口上限 1 MiB、30 秒；输出不含原响应或认证。旧交互 CLI 仅保留人工调试兼容，不能用于无人值守验收。

输入必含 url（完整 Broker URL，无 query/嵌入认证）、className、methodName、role、effects（read-only/write）及 effectEvidence（同 className/methodName/role/effects 和核实 reference）。write 另需 authorization，明确 write=true、同一方法/角色及授权 reference。框架只核对契约一致性，引用真实性仍由 Coordinator 验证，Get 命名不授予只读性质。

params 是标量对象，不得覆盖 ClassName/MethodName。token、cookie、ca、requestPage 在内存或 stdin 提供；夜跑调用 TLS 始终验证证书，内网 CA 通过 ca 传入。timeoutMs 默认 30000、maxResponseBytes 默认 8 MiB，断连/超限/取消不重试，写结果先回读。

可导入 API 接收 assertBusiness(body)、classifyAuthentication(body)（已确认认证拒绝返回 rejected）和 inspectResponse(body)（项目受保护证据回调）。CLI 使用 assertions 数组，每项 `{path:["字段"],equals:预期值}`，只有实际 JSON 字段匹配才通过。没有断言时状态是 transport-ok；它不代表业务通过。HTTP 200 内的认证失败按项目 classifyAuthentication 识别，不按统一业务字段猜测。

结果分别包含 transport、httpStatus、authentication、business、outcome；超时/断连等为 review-pending/unknown。返回结构通过不代表写副作用合格，项目 sideEffects 仍需独立回读。CLI 退出码：0 为业务断言通过，2 为仅传输结果，1 为失败/拒绝/未知或输入问题。

## 验证与发布

源仓合成测试只访问 127.0.0.1。已配置三平台 Node 22/24 的工具与无头浏览器 CI，实际运行结果另记。测试锁定 playwright-core，使用上游 Apache-2.0 包，详情见源仓 maintenance/testing/playwright；该目录不部署。

通过现有更新流程取得 workflows、根 scripts/*.js/scripts/lib 和 owner 插件。不自动修改项目 profile、安装浏览器、迁移私有配置或启动夜跑；旧 debugger 参数兼容，--path 为 --url 别名。真实后端/UI 需求分别在授权项目验证并重复执行，再评估准备耗时和人工介入改善。
