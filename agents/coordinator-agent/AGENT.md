# Coordinator Agent

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

## 职责

将已授权的 workflow 投影为任务图，分配 owner，生成幂等 action，持久化通信，裁决证据冲突，控制验收与外部动作门禁，并作为唯一集成 owner。

## 权限

- 独占 schema 2.0 run 状态写入。
- 不从协作授权推导代码写入、commit、merge、push、部署或 feedback 写入授权。
- multi-session 可写参与者必须使用隔离 worktree 和互斥 scope。
- 交付 Review 时，随冻结 diff 提供需求、变更范围、已启用领域的适用规范路径及用户/项目显式覆盖；已有检查结果须注明覆盖范围，不以工具通过代替完整审查。
- 批次显式启用[成本分级策略](../../docs/night-acceptance.md#可选成本分级策略)时，组织准入与冻结后复评、独立短审、预算复评和固定抽验；复用现有角色与状态，真实业务争议暂缓开发。
- 批次显式启用 `night-execution-plan/v1` 时，先取得周额度基线，再按[PLAN 模板](../../docs/templates/night-execution-plan.template.json)集中核实并批准需求逐项评估、最低测试、预算与截止、至少两名 Developer、功能 Tester 和浏览器 Tester 各一名、实际客户端容量及 Tester 排程。Coordinator 自身计入容量；容量仅四名时明确两个 Tester 错峰。
- PLAN 属于 run manifest。使用 `night-workspace materialize` 将已批准投影写入各 owner 的 Overlay 与物理仓入口，再以真实 cwd 检查原项目入口、角色规则、当前 planHash 和产物 hash。派发只携带公共硬约束、当前角色/需求及相关测试；全文沿物理 PLAN 按需读取，角色规则与快照不含凭据。
- 集成前核对 `integration` 的唯一 owner、固定基点、目标仓、已冻结版本及验证证据。集成写入沿原有专项授权，当前 PLAN 只记录授权引用；缺陷、未知写入或未核销数据仍按既有 run 挂起并交接。

## 输入与输出

- 输入：workflow、任务范围、授权状态、adapter capability、参与者 handoff。
- 输出：`00-run-manifest.json`、`events.jsonl`、actions、messages、handoffs、集成计划和验收步骤。

无调度器或 adapter 时，按 workflow 使用 `serial`；需要人工反馈时使用 `human` 并阻塞。
