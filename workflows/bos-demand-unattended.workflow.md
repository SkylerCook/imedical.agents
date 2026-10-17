# BOS 夜跑 Workflow

## 触发与输入

仅在用户调用 `$bos-demand-handle --night` 或自然语言明确要求夜跑、批量、无人值守处理时加载。本流程复用 [BOS 单需求流程](bos-demand.workflow.md)、[正式协作协议](../agents/_shared/orchestration-protocol.md) 和 [测试协议](../agents/_shared/testing-protocol.md)，不另建台账或调度服务。批次实例留目标工程，参照 [批次示例](../docs/templates/night-run-batch.template.json)。

Agent 从请求、已有授权和工程配置整理输入并生成批次及必要编排资料；用户无需手填 JSON。先自行核实，仍缺少的业务决定集中询问；生成文件不表示已授权执行其中的动作。

经 `--night` 创建的新批次显式设置 `decisionPolicyReference`。按实际角色使用现有 `night-workspace` 只读计划和已有 Git/Overlay 构建入口；批次 `workspacePreflightReferences` 填写 `{ownerId,planReference}`，planReference 相对批次文件，owner 与工作区计划一致。构建后核实共享能力、工程上下文和真实源码边界，预检失败先修复相关前提；不另装能力副本，不宣称生成计划即工作区可用。恢复旧批次不静默添加新字段。

新批次按[2.1 契约](../docs/night-policy.md#schema-21-启动契约)设置 preflight-only 和唯一 runReference，先探测运行时支持，前后端各工作项显式 repositoryRoot。启动前集中复用或补齐计划内全部授权并实际预检，已知缺项不得运行，可在启动前确认缩小范围。运行中权限失效、能力异常和计划外动作只挂起相关分支并记录交接，继续其他已授权工作，不新增授权问题、不代批宿主审批。Web 默认现有无头 Playwright；需要宿主临时浏览器批准的路径在开始前转人工或排除。

多编号详情逐号调用，不把逗号编号传给单号接口；首次共享连接异常先诊断连接前提，前提未变时暂停后续同类请求。观察使用状态与增量事件，完整会话只用于关键证据，观察成本单独统计。

Codex 新批次写入 `quotaPolicy:{enabled:true,provider:"codex",stopClaimingRemainingPercent:20,closeoutRemainingPercent:10,maxAgeSeconds:300}`；其它宿主显式使用 `enabled:false`。Agent 在启动和每次派发前取得真实宿主额度快照，通过 `night-record` 的 `{kind:"quota",snapshot,rationale,evidenceRefs}` 记录，snapshot.observedAt 使用实际获取时间并带时区，保留真实 rateLimitsByLimitId 或旧 rateLimits 数据；具体入口见[决策接口](../docs/night-policy.md)。未知或超过 300 秒的快照阻止业务派发，适用窗口最低剩余量不高于 20% 时停止领新需求、不高于 10% 时仅收尾；cleanup 继续遵守处置授权且不受额度门禁阻止。额度是账号共享状态，不等于本批次 token 或费用，不用推测值填充；复用阶段调用，不建立守护进程。

Coordinator 核对需求编号或可复现查询范围、Workspace/Source/GitRoot、原始授权、角色/数据策略、停止领新需求/发布截止/绝对停止时间及通知条件。所有时间带时区；若缺失则先集中确认，不能将历史夜跑时间当默认值。容量默认 maxInFlight=1，协作角色是职责，不要求多个聊天。

批次显式启用成本分级策略时，按[两次评估](../docs/night-acceptance.md#可选成本分级策略)执行派发前准入与冻结后复评；现有 Coordinator 组织 Planner、Review、Testing 职责，不默认增加会话。未启用的批次保持原流程。

commit、push、merge、上传/编译、测试数据写入和处置、BOS 日志/状态分别沿用明确授权。预授权不能替代宿主实际许可；被拒操作保留断点，不能换通道绕过。账号、服务器、票据不写入通用批次模板。

worktree 复用原项目启用能力，领域选择沿用[单需求流程](bos-demand.workflow.md#编码体系选择)。计划的 requiredSkills、requiredRules、requiredScripts 只声明本批次实际需要的入口，覆盖适用的编码、部署与验证动作，不枚举全部插件。复用有效上下文与预检证据，不新增启动阶段或预检轮次；既有派发检查保留。插件启用不代表所有动作支持无人值守，计划内部署、设备与验收能力仍由原真实预检核实；缺口按既有缩小范围、人工留项或运行中挂起规则处理。

## 阶段

1. **真实预检**：按本批次所需路径核实工具、认证、角色/数据、正常入口和退出能力。纯后端不检查浏览器；UI 检查无头浏览器启动、登录、页面、截图和关闭。协作需要启动/等待/结果能力；必要能力缺失时串行或交接，不能宣称无人值守。启用决策策略的新批次必须建立或接续既有编排 run，通过 next 和启动前 transition 执行门禁，不能仅阅读策略后绕过运行时派发；事件与验证复用其事实源。
2. **调查与验收分层**：取得完整需求及媒体，检查实际调用链；内部计算走 internal-method，对外 Broker/REST/SOAP 走 external-api，页面行为走 ui。响应契约变化检查消费者，受影响的页面补对应用例。认证借用浏览器不计 UI 验收。详见 [分层接入](../docs/night-acceptance.md)。
3. **开发、审查与冻结**：按 BOS/领域流程实现，测试准备可提前进行；明确唯一写入 owner、版本、依赖和断言。已知修改范围先核编码与条件 i18n，最终 diff 后复核；逐项检查保留退出码，不能以最后一项成功覆盖前项失败。最终修改冻结后才执行对应验收，实际测试等待已授权部署就绪；已证实旧证据过期时按 scope 重新核验。
4. **授权部署与验收**：复用现有部署入口与专项授权。纯后端直接调用真实层级的接口并按需独立回读；Web 行为优先无头 Playwright。执行器使用有限超时、会话恢复与资源归属。HTTP 200、内部方法通过均不能替代对外接口契约；后端通过不能替代受影响 UI。
5. **返修或人工留项**：业务缺陷返回原 owner；版本变化更新证据。未知写结果先回读，环境/脚本/认证/权限问题分类，前提未变不重复尝试。原生打印等困难项记录已测范围、入口/步骤/预期、风险及恢复条件。明确人工留项不自动标为 accepted。
6. **收尾交付**：停止心跳、关闭本任务页面/context/browser、释放监听器与进程，核实数据策略。按[测试协议的结果与交接](../agents/_shared/testing-protocol.md#结果与交接)分别汇总功能验证、人工补验与用户验收结论，并列明缺陷、未知结果和清理状态；分别记录准备/执行/诊断/返修等待/证据耗时和人工介入。业务仍 acceptance-pending，用户验收才 accepted。

## 容量、截止与恢复

默认同一时刻一条需求处于开发至自动验收链。当前条目完成自动范围及收尾，或形成明确人工交接后再领新条目。已知缺陷优先返修；未知写结果、资源占用、数据污染先处置，不能包装成普通人工待验继续积压。

每次阶段切换检查时间：停止领取后只处理在手事项，发布截止后不开始新部署，绝对停止后不开始业务动作并进入有界收尾。正在运行的测试工具独立实施 deadline/timeout；不能因模型等待或聊天结束而留下心跳进程。截止后未确认退出的资源明确交接，不宣称清理完成。

只在授权范围、版本、前置、资源和工具许可重新核实后恢复。复用原结果及 run，不重放已确认动作。通知沿批次约定，严重问题/预算阈值不使用历史默认值。宿主无法持续执行或唤醒时如实标记 supervised，不把手工恢复包装为无人值守成功。

计划逐条覆盖 implementation/review/deployment/verification/cleanup，跳过阶段附原因与交接。部署/验收经绑定 work item 的受管入口自动归档回执；共享部署确认目标内容仍相同后复用。数据策略采用项目 fixture authority，处置与资源退出分别报告，真实成本对照见[接入说明](../docs/night-acceptance.md#21-项目适配与数据成本)。

处理报告收尾按[编号汇总契约](../plugins/demand-delivery-plugin/skills/demand-acceptance/SKILL.md#编号汇总契约)固定给出本批全部需求号汇总，并核对基线已满足、无需新增代码项未遗漏；状态分组另列。仅引用报告契约不触发验收交付授权。

## 单 Agent 降级

无 subagent、原生 skill 或 YAML 能力时，读取本 Markdown 按阶段串行执行；项目 JSON 仅作为输入资料，不要求固定产品 API。没有浏览器时仍可执行后端用例，UI 范围保留待验。没有真实环境授权时，只完成本地合成验证与待执行计划。
