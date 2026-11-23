# 验收清单

## 一、分层验收顺序

| 层 | 前置 | 判据 | 无需 Graylog |
|---|---|---|---|
| L0 静态 | P1–P7 文件落盘 | `verify-install.js --strict` 全 PASS | 是 |
| L1 渲染 | L0 通过 | fixture 四簇渲染出 summary/self/notify 三类文档，校验闸门反向测试生效 | 是 |
| L2 通知 | L1 通过 + 推送配置 + 令牌 | `push-notify.js --dry-run` 文本合规、去重与拒发闸门生效 | 是 |
| L3 调度 | L2 通过 | Qoder 采集轮（Full Access）与分析轮（Auto Approval）已创建且 cron 错开；`qoder_cron run` 触发后日志 mtime + `[SUMMARY]`、产物、state cursor 三项齐备（`lastRunStatus` 不作判据）。回退 OS 时才校验 `install-schedule.ps1 -DryRun`。注意 `run-triage.ps1` **没有 `-DryRun`**，只有 `-Env` / `-Limit` / `-SkipCollect` / `-SkipNotify` / `-NoLock` | 是 |
| L4 取数 | `graylog-<env>` 注册 | `collect-errors.js --env <env>` 退出 0，raw JSON 有真实 ERROR；日志两路计数齐备（`报错命中 N 条` + `慢请求（>=15s）命中 N 条…达标 N 条`）。慢请求达标 0 条可以是正常结果，但必须能看到这一路的计数，不能整路缺失 | 否 |
| L5 归属 | L4 通过 | `classify-owner.js --calibrate` 观测证据齐备，待定桶可解释；慢请求簇按规则 `slow-interface-fqcn` 定组（**只有归本组的簇才另标证据等级 `interface-fqcn`**，他组簇不标该字段），前缀未登记的落 app-only/待定；不得因打印进程是 `his-mediway-server` 就判成本组 | 否 |
| L6 穿透 | 前端索引可选构建 | `classified-*.json` 的 `frontend.degradeReason` 与实际相符（`no-target-cluster` / `no-frontend-entry` / `index-missing` / `codegraph-index-present-but-codegraph-mode-not-enabled`），每簇 `ui.degradeReason` 有明确解释。`effectiveMode` 当前硬编码 heuristic，**不会出现 codegraph 命中**；慢请求簇无 URL，计入 `no-http-request` 并跳过属正常 | 否 |
| L7 连续 | L4–L6 通过 | 连续 3 轮真实巡检全部达标 | 否 |

## 二、L7 连续 3 轮验收（按采集轮 cron，现为 15 分钟一轮）

每轮记录到 `docs/agent-reports/graylog-triage/acceptance-<env>-<日期>.md`：

| 轮次 | runId | 窗口 from | 窗口 to | 上轮 cursor | 报错条数 | 慢请求达标 | 新增簇 | P0/P1 | 截断 | 退出码 |
|---|---|---|---|---|---|---|---|---|---|---|

必须全部满足：

1. **时间窗首尾相接**：本轮 `from − overlapSeconds` == 上轮 `to`（允许 120s 重叠），无缺口、无整段重采。报告展示的是本地时间（UTC+8），`state.envs.<env>.cursor` 与原始产物是 UTC ISO，比较前先统一口径（本地 −8 = UTC）。
2. **水位线单调**：`state.envs.<env>.cursor` 严格递增；失败轮次 cursor 不变且 `lastError` 有值。
3. **去重有效**：跨轮相同 errorHash 不重复计入新增；dedupe 表按 `state.dedupeTtlHours`（当前 6 小时）清理，超 `dedupeMaxEntries`（80000）按时间淘汰最旧。慢请求 hash 只含接口名、**不含耗时**，同一接口持续慢会跨轮复现并累加计数，这是预期行为，不是去重失效。
4. **他组文档可直接转发**：报错簇含时间窗、归属组、异常类、次数、traceId、请求接口、调用方服务、截断堆栈、排查请求；慢请求簇含接口全限定名、最大/平均耗时、traceId 与「无堆栈，按 traceId 追全链路」说明。两类都带 `[P0]`/`[P1]` 标记；无 IP/凭据；不含本组或待定明细。
5. **本组文档可指导改码**：开头有 P0 优先索引与「处置分流」表，且每行序号能在正文找到对应 `## N.` 明细；每簇标注严重度与依据、处置分类与依据。报错簇有异常类（无异常类时标题落到消息首行，不得整篇「未知异常」）+ 锚点堆栈帧 + 源码定位（`source_class_name` / `source_file_name` / `source_line_number` / `source_method_name`，缺失时退回堆栈业务帧并注明口径）+ 样本消息 + 前端定位（或明确「待穿透」）+ 修正方案块；慢请求簇有接口名 + 耗时最大·平均 + 耗时样例表 + 耗时归因与优化方案块。P0 的方案块不得长期停留在占位。
6. **前端穿透可核验**：按 `frontend.degradeReason` 与每簇 `ui.degradeReason` 核验，heuristic 结果强制标注「启发式匹配，未经前端索引确认」；`no-frontend-entry` 的簇不出现候选页面表格且给出原因，`browser-request` 的簇要么给候选页面、要么说明 URL 未登记；无结果写「待穿透」，不编造。`effectiveMode` 硬编码 heuristic，**不存在 codegraph 命中**；慢请求簇计入 `no-http-request` 被跳过属正常，不算穿透失败。注意 `matched=0` 不一定是缺陷，本轮无本组簇时就是正确结果。
7. **推送合规**：只推他组 + 一条汇总；6h 内同 hash 集合不重复推；基础设施只出现在汇总计数。
8. **无凭据入库**：`git status` 与 `git check-ignore` 确认 push.json / state.json / push-state.json / pending-queue.json / lock 全部被忽略；提交内容 grep 不到令牌、Basic 串、IP。
9. **调度稳定**：3 轮内无退出码 3（锁冲突）；若出现须证明是上一轮超时而非死锁（OS 回退时检查 ExecutionTimeLimit）。每轮都要有客观产物——**任务状态 `succeeded` 但日志 mtime 不动、无新产物，判为失败**（常见于权限模式拦下命令）；验收期间 Qoder 客户端须保持在线。
10. **日志可追溯**：每轮 `config/logs/triage-<日期>-<env>.log` 存在且含各阶段退出码。
11. **严重度分级可核验**：慢请求簇一律 P0；处置分类为 `business-control` → P1，其余（`runtime-defect` / `business-escalation` / `log-level-review`）→ P0；混合簇 `severityMixed: true`；`stats.selfModuleFrame + stats.selfAppOnly + stats.selfSlow === stats.self`（注意 `selfSlow` 按 kind 计数，app-only 的慢请求簇算在 selfSlow 而非 selfAppOnly）；分析轮改判过的簇必须有 `analysis.severityReason`。
12. **处置分类可核验**：每个报错簇都有 `disposition`（旧版 classified 重放缺失属正常）；`runtime-defect` 必须在报告里给出源码位置；`log-level-review` 必须给「降级 / 保留」结论；`business-control` 与 `business-escalation` 的簇数之和应等于「命中业务异常信号」的簇数；混合簇附 `dispositionCounts`；分析轮改判过的簇必须有 `analysis.dispositionReason`；他组通知里**不出现**处置分类行。
13. **来源标注可核验**：每个簇都带 `origin`（旧版 classified 重放缺失属正常）；`stats.originSelf + stats.originSelfCallsExternal + stats.originExternal + stats.originInfra + stats.originUnknown === 总簇数`；`originMixed` 的簇在报告「来源」行附 `originCounts` 分布；队列条目中**不得出现 `ownerKind: unrelated` / `infra`**，`ownerKind: external` 的条目必须是非慢请求且 `origin: self-calls-external`，慢请求只允许以 `self` / `unknown` 归属入队；「附录：本组调用他组失败」只收 `ownerKind: external` 的簇，`unknown` 的来源一律留在待定附录、不得重复渲染；他组通知每簇有来源行、概览给出「医生站调用贵组接口失败 / 贵组应用自身报错」两类计数，且**不含**根因/修正方案段。

## 三、失败处理

| 失败项 | 动作 |
|---|---|
| 窗口有缺口 | 停止验收，检查截断语义与 retention 钳制。采集脚本**没有 `--from` 参数**，补采只能由人工把 `state.envs.<env>.cursor` 回拨到缺口起点再触发一轮；重叠段靠消息 `_id` 去重不会重复计簇，回拨操作必须记录 |
| 慢请求整路缺失 | 查 `query.slowSelector` 是否被清空、日志是否只有报错计数。选择器为空时脚本会打 `慢请求采集未启用`，属配置问题不是取数失败 |
| 慢请求达标数恒为 0 但确有慢接口 | 阈值只能按解析出的毫秒数判，日志文案分档最高「15秒」。核对 `slowThresholdMs`（当前 15000）与 `parseSlow` 是否解析失败（解析失败会整条丢弃）。**改过阈值的话看新一轮日志打印的 `>=Ns` 是否跟着变**：筛选在采集阶段，对旧 raw 重跑分类只改文案、不改达标集合 |
| 慢请求被误判成本组 | 打印进程 `his-mediway-server` 是聚合进程。按接口全限定名查归属，确认后补 `external.packagePrefixes`，**不得凭猜测塞进 self** |
| 待定桶占比 > 30% | 先跑 `--calibrate`，按观测证据补配置，**不得凭猜测把前缀塞进 self** |
| 他组误判 | 保留样本，回查判定命中原因，修正 appGroups/包前缀后重分类 |
| 来源全为 unknown / 跨组误标 | 先看该簇 `rules` 与 `evidence.selfAffected`：`trace-peer` 只在 trace 里出现 `self.appKeywords` 时才算本组发起；`feign-*` / `self-app-external-frame` 无论 `ownerGroup` 是否解析出都算 `self-calls-external`。`ownerGroup` 为空是包前缀未登记，补 `external.packagePrefixes` 后重分类，**不得手改 `origin` 字段** |
| 跨组慢请求进了本组队列 | `mergePendingQueue` 的入队条件被改宽（应为「非慢请求才收跨组」），恢复条件；跨组慢请求的优化责任在被调方，只走通知 |
| 他组通知里出现根因/修正方案 | 渲染时 `notifyCtx.showAnalysis` 被置真，改回 `false`；内部结论只留在 `本组问题-*` 与队列 |
| 穿透全为 heuristic | 这是当前设计状态（`effectiveMode` 硬编码），**重建索引不会改变**。只有摘要显示 `index-missing` 时构建才有意义；慢请求簇无 URL，建索引也不会产生命中 |
| P0 方案块长期占位 | 分析轮未轮到或证据不足。核对 `pending-queue.json` 的 `status`：`blocked` 须写明缺什么证据，不得改成 `analyzed` 蒙混 |
| 推送被安全闸门拦截 | 补 `output.redactPatterns`，重渲染后重推，不得关闭闸门 |

## 四、回滚

调度主体是 Qoder 自动任务，**先由人工在「自动化」面板或 `qoder_cron disable` 停掉采集轮与分析轮**（自动任务不得自行改动调度）。只停采集轮时分析轮会空转回报跳过，要完全静默两边都停。

仅当曾启用 OS 回退路径时，才需要卸载计划任务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\install-schedule.ps1 -Env <env> -Uninstall
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents\scripts\update-plugin-profile.ps1 -Plugin imedicalxc-doctor-graylog-error-triage -Status disabled
```

```powershell
Copy-Item .agents\config\plugin_profile.md.bak .agents\config\plugin_profile.md -Force
```