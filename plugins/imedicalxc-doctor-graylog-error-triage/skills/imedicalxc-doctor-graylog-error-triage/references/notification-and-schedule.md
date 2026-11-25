# 推送与调度

## 推送

配置：`config/graylog-triage-push.json`（由 `graylog-triage-push.template.json` 复制，**不入库**）。
令牌：`GRAYLOG_TRIAGE_QQBOT_TOKEN`，走用户级环境变量或 `.qoder/settings.local.json` 的 `graylogTriage.env`。

Qoder 自动任务同样是独立进程，**读不到会话级环境变量**（在会话里 `export` 的变量不算数），必须配成用户级永久变量，或写进 `.qoder/settings.local.json` 的 `graylogTriage.env`。

退出码：

| 码 | 含义 | run-triage.ps1 的处理 |
|---|---|---|
| 0 | 推送成功或全部被去重跳过 | 继续 |
| 1 | 接口失败 | 标记本轮失败 |
| 2 | 未配置（缺 push.json 或缺令牌） | 打一条 `[WARN]`，不算失败 |

去重：同一 errorHash 在 `dedupeHours`（默认 6 小时）内不重复推。状态存 `config/push-state.json`。

### 群消息内容

- 概览行：新簇数 / 命中条数，并给窗口内总条数的**报错 / 慢请求拆分**。
- 严重度行：`严重度初判（窗口内全部簇）：P0 n / P1 m；P0 需出方案`。群消息不展开处置分类（属本组内部判断，随 `本组问题-*` 落盘）。
- 每簇一行，带 `[P0]` / `[P1]` 徽标：报错给异常类 + 次数 + 最内层业务帧 + 模块；**慢请求给 `慢请求 <接口全限定名>` + 次数 + `最大X.Xmin` + 模块，不给堆栈帧**（它本来就没有）。
- 本组与他组分节列出，超过 `maxClustersPerMessage`（默认 8）折叠为「其余 N 簇见群文件」。

> **已知局限**：群消息不走报告那套脱敏通道，所以簇标签只用异常类或接口名，不附消息原文。无异常类的 app-only 报错在群消息里仍显示「未知异常」（报告里已改为取消息首行做标题），要看区分信息得读 `本组问题-*.md` 或 `他组通知-*.md`。这是外发暴露面与可读性之间的取舍，不要为了好看把消息原文塞进群消息。

**当前状态**：目标 OneBot 服务返回 403（根路径也 403、响应体空、无 Server 头），判定为网关层拦截，不是令牌问题。推送未接通，`他组通知-*.md` 需手工转发。

## 调度：单一主体，两个自动任务

采集与分析**全部由 Qoder 自动任务（`qoder_cron`）驱动，不依赖 Windows 计划任务**。两个任务都在 Qoder「自动化」面板里可见、可启停。

| 任务 | 职责 | cron（Asia/Shanghai） | 权限 | id |
|---|---|---|---|---|
| 医生站 Graylog 报错采集轮（`<env>`） | 只跑 `run-triage.ps1` 流水线并回报退出码 | `0,15,30,45 * * * *` | Full Access | 见面板 |
| 医生站 Graylog 报错分析轮（`<env>`） | 读报告→定根因→回填方案→整理通知草稿 | `7,37 * * * *` | Auto Approval | 见面板 |

任务名中的 `<env>` 取 `config/graylog-triage.json` 的 `environments` 键，实际建有哪些任务以 Qoder「自动化」面板为准。两者 `outputMode: merged`（历轮输出累积在同一会话，便于回看），`cwd` 均为 `D:\imedicalxc-doctor-all`。触发点故意错开：采集 :00/:15/:30/:45，分析 :07/:37，确保分析轮读到的是已落盘的完整一轮，不会读到半截产物。

分工理由：采集是确定性流水线，交给脚本，模型只负责「跑一条命令 + 按退出码回报」；根因判断要读源码、跨子仓库定位行号，脚本做不了，只能模型做。

### 为什么采集轮必须 Full Access

实测（2026-11-20）：Auto Approval 的权限分类器把 `powershell -NoProfile -ExecutionPolicy Bypass -File ...run-triage.ps1` 判为任意代码执行并拦下，采集轮按 prompt 硬约束回报「采集命令被权限模式拦截」后停止，**整轮零文件系统效果**（日志不追加、无锁文件、state 不推进、无产物）。改为 Full Access 后同一命令立即跑通。

代价要认：Full Access 下无人值守任务不再受分类器约束，prompt 里的「只允许这一条命令」是**指令而非强制边界**。所以采集轮 prompt 必须保持极窄（单命令 + 退出码协议 + 禁止清单），改宽之前先想清楚。

### 验证口径：不要信 lastRunStatus

`qoder_cron` 的 `lastRunStatus: succeeded` 只代表**会话轮次完成**，不代表流水线执行成功——被权限拦截、提前退出、脚本失败都可能显示 succeeded。判定一轮采集是否真跑了，只看三项客观证据：

1. `config/logs/triage-<yyyyMMdd>-<env>.log` 的 mtime 推进，且末尾有本轮 `[SUMMARY]`。
2. `docs/agent-reports/graylog-triage/<env>/<日期>/` 出现本轮 HHmm 的产物（raw / classified / summary / self / infra / notify）。
3. `config/graylog-triage-state-<env>.json` 的 mtime 与 cursor 推进。

三者齐备才算成功。分析轮同理：看 `pending-queue.json` 是否新增 `analyzed` 条目、报告是否被重渲染，而不是看任务状态。

### 采集轮边界

允许：运行 `run-triage.ps1 -Env <env>` 这一条命令，以及只读查看日志与目录。连接配在工作区 `.mcp.json`（而非默认用户目录 `~/.qoder-cn/shared_client/mcp.json`）时，该命令须追加 `-McpConfig .mcp.json` 并透传到采集阶段，否则 `collect-errors.js` 回退到默认路径报 `missing-config`。`run-triage.ps1` 的 `-McpConfig` 只作用于采集阶段（其余阶段不读连接配置）。

禁止：单独跑 `collect-errors.js` / `classify-owner.js` / `penetrate-frontend.js` / `render-report.js` / `push-notify.js` / `install-schedule.ps1`（流水线已包含它们）；改 config 或脚本；任何 git 操作；根因分析与读业务源码；注册、启停、卸载任何 Windows 计划任务；配置令牌或发送通知。

退出码协议：`0` 回报 `[SUMMARY]` 与产物清单；`3` 上一轮未结束属正常跳过（不加 `-NoLock`、不删锁）；`2` 环境不可用，回报 `[FAIL]`，不改配置不重试；`1` 阶段失败，回报失败阶段与 `[FAIL]` / `[TAIL]`，不重跑不改脚本。

### 分析轮边界

允许：读 `巡检总览-*` / `本组问题-*` / `classified-*` / `他组通知-*`，Grep 子仓库源码，**按 traceId 做 Graylog 只读查询**（慢请求耗时归因必需，走 graylog MCP，不是被禁的 `collect-errors.js` 取数），写 `config/pending-queue.json`（含 `analysis.severity` / `analysis.disposition` 改判），跑 `render-report.js` 重渲染，跑 `classify-owner.js --calibrate` 校准归属（可改 `ownerGroups`，含慢请求需要的 `external.packagePrefixes`），写 `analysis-outbox-<HHmm>.md`。

禁止：跑 `run-triage.ps1` / `collect-errors.js` 取数 / `push-notify.js` / `install-schedule.ps1`；改动任何 Windows 计划任务；创建、修改、暂停任何 Qoder 自动任务（含采集轮与自身）；发送任何 QQ / HTTP / webhook 通知。他组通知只整理成待人工转发清单，外发由人决定；调度变更只能由人工发起。

**取材范围是队列，不是某一轮报告。** 采集 15 分钟一轮、分析 30 分钟一轮，只看最新一轮会漏掉中间轮的簇，所以分析轮遍历 `pending-queue.json`：

- 候选集 = `status: pending` 的条目 + `status: blocked` 但 `lastSeen` 已前进的条目（有新证据才重试）；`analyzed` 一律跳过。
- 优先级：**P0 先于 P1**（P0 = `runtime-defect` / `business-escalation` / `log-level-review` / `slow-perf`；P1 = `business-control`，只需确认语义与提示文案）。P0 内部：self 且有锚点堆栈帧 / self 慢请求且证据等级 `interface-fqcn` > self 但 app-only > **本组调用他组（`origin: self-calls-external` 的跨组报错）** > unknown（待定）；同级按 `lastSeen` 倒序。跨组报错的判断成本低（写被调方 + 原始错误 + 本组容错），排在待定之前；他组慢请求不进队列，不要在队列里找。
- **每轮上限 4 条簇**。实测单簇约 4-5 分钟（18:12 那轮 3 条耗时 14.1 分钟），4 条约 20 分钟，给 30 分钟间隔留余量。没轮到的留下一轮，不为清积压而超时。
- 队列条目带 `kind`（error/slow）、`severity` 与 `disposition`（脚本初判）、`origin`（来源）、`ownerGroup`（跨组条目的被调方）、`exceptionClass` / `sampleMessage` / 计数 / 首末时间，慢请求另带 `interfaceName` / `durationMaxMs`，但**没有堆栈帧**。`origin` 是采集轮打好的来源标志，**不要重新猜**：`self` 按本组缺陷分析；`self-calls-external` 按「责任在被调方」分析；`unknown` 先补证据或判 blocked。报错簇的堆栈按 `errorHash` 跨轮 Grep `本组问题-*.md`（找不到再看同轮 `classified-*.json`）取；两处都没有就判「证据不足」，**不得凭异常类与消息猜堆栈帧、路径、行号**。
- **跨组报错簇（`origin: self-calls-external`，正文在「附录：本组调用他组失败」）**：`analysis.rootCause` 必须写明被调方（`ownerGroup` / `ownerModule`）与原始错误（异常类 + 被调接口 + 对方返回/超时语义），`analysis.fix` 只写本组侧的容错/降级/提示优化，**不要把根因写成需要本组改码的缺陷**；被调方修复建议另写进他组通知清单，由人决定是否外发。
- **时间口径**：报告正文（采集窗口、生成时间、首次/末次、慢请求样例）显示**本地时间 UTC+8**；`pending-queue.json` / `classified-*` / `raw-errors-*` 与 Graylog 查询参数仍是 **ISO UTC（带 Z）**。按报告时间回查 Graylog 或比对队列时先减 8 小时；写 `analysis-outbox-<HHmm>.md` 引用时间时用本地时间并标注「UTC+8」，避免两个口径混写。
- **慢请求簇不走堆栈路径**：报告里给的是接口全限定名、最大/平均耗时与最慢样例 traceId。按该 traceId 拉全链路日志分阶段分解耗时，判定是数据量正常的长耗时还是代码缺陷（N+1、慢 SQL、循环内远程调用、缺批量接口），结论写进 `analysis.rootCause`（耗时原因）与 `analysis.fix`（优化方案）。归属看接口包前缀，`app-only` 的慢请求不得定性为本组缺陷。
- 处置分类改判写 `analysis.disposition` + `analysis.dispositionReason`（严重度联动改判另写 `analysis.severity` + `analysis.severityReason`），渲染全篇以改判为准。配置/数据前提缺失类的 log.error 初判落 `log-level-review` + P0，复核后给「应降级」或「保留 error」结论；发现背后有真故障改判 `runtime-defect`。
- 回填的簇可能分散在多个轮次，**按受影响轮次分别重渲染**，各用自己的 `classified-<HHmm>.json`；该文件已被清理时跳过重渲染并说明「结论已入队列，报告待产物存在时再渲染」。
- **阈值下调（60s → 15s，2026-11-20）带来的证据断层**：旧轮次只落盘了 ≥60s 的慢请求，15–60s 那段从未采集，不要在旧报告里找它、也不要当成漏采。慢请求 `errorHash` 不含耗时，新纳入的调用会累加进同接口旧簇的 `count` 与平均耗时。旧报告的阈值文案来自 `payload.slow.thresholdMs`，重渲染不会改它，**不得为了口径一致而改写历史产物**。
- 15s 档会纳入更多「数据量正常的长耗时」（批量结算、跨院区聚合），慢请求簇变多时**仍按 P0 优先与 `lastSeen` 排序，不得为清慢请求积压挤掉可定性的程序异常 P0，也不得提高 4 条上限**。这类簇先拿量级与分阶段证据说话，不要一律当代码缺陷要求改码。

**三种队列状态**（脚本只读 `analysis` 字段、不读 `status`，所以新增状态对流水线无副作用）：

| status | 含义 | 写入要求 |
|---|---|---|
| `pending` | 待分析（脚本新增时的默认值） | — |
| `analyzed` | 已定性，有可执行方案（按处置分类：改码 / 级别结论 / 容错 / 耗时优化） | `analyzedAt` + `analysis.rootCause/fix/verification`，改判时另加 `disposition/dispositionReason`（必要时 `severity/severityReason`） |
| `blocked` | 证据不足，判不出 | `blockedAt` + `analysis.rootCause` 写「待查」、`analysis.fix` 写明还缺什么证据 |

`blocked` 是为了不让判不出的簇每轮重复空转，也不把它假装标成 `analyzed`。渲染后报告会显示「待查」与所缺证据。

提前退出两种情况，都不补采集、不建目录：

- 当日产物目录不存在或没有任何 `巡检总览-*.md` → 回报「本轮无采集产物，采集轮未产出，分析跳过」。
- 候选集为空（无 `pending`，且 `blocked` 的都没有新证据）→ 回报「本轮无新增待分析报错」。

### 依赖与在线要求

- **分析轮没有独立数据源**：采集轮被暂停、失败、或当时客户端未运行，分析轮只会空转回报跳过——预期行为，不是故障。
- **两个任务都依赖 Qoder 客户端在线**，客户端退出期间不触发。这是与 OS 计划任务最大的差别（后者只要用户登录就在跑）。需要退出客户端期间也采集，只能回退到 OS 任务。
- 缺口自动补齐：水位线 cursor + `overlapSeconds` 会补回停摆期间的窗口。实测 17:38 停摆、18:10 恢复，采集窗口自动覆盖 17:36→18:10，无需手工回放。

### 改节奏

采集节奏由**采集轮的 cron 表达式**决定，用 `qoder_cron update` 或面板改。`config.schedule.intervalMinutes` / `executionTimeLimitMinutes` **只在回退到 OS 计划任务时才生效**，改它们不会影响 Qoder 自动任务。

`environments.<env>.intervalMinutes` 仍然有用：决定首轮回溯窗口（`collect-errors.js:433`，无 `initialLookbackMinutes` 时取 `interval*2`），与调度无关。

### 回退到 OS 计划任务（可选，非默认）

`scripts/install-schedule.ps1` 与 `iMedicalxc-GraylogTriage-<env>` 保留为回退路径。当前已注册的 OS 任务为 **Disabled**，不参与调度。回退时注意：

- 真实触发周期只认 `config.schedule.intervalMinutes`（`install-schedule.ps1:36`）；需 `executionTimeLimitMinutes < intervalMinutes`，且 `environments.<env>.intervalMinutes` 与之一致，否则 `verify-install.js` 告警。改完必须重新注册任务才生效。
- `-Force` **不能**覆盖同名任务：它只跳过脚本自己的存在性检查，`Register-ScheduledTask` 仍抛 `0x800700b7`（Cannot create a file when that file already exists）。覆盖走卸载再注册：

```powershell
$sch = ".agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\install-schedule.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File $sch -Env <env> -Uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File $sch -Env <env>
```

注册失败时原任务不受损（整体提交），但仍应 `Get-ScheduledTask` 确认 `State` 与 `Repetition.Interval` 再收工。

- 运行身份 `Interactive`，只在登录期间触发，不保存密码；休眠不跑，唤醒后由 `StartWhenAvailable` 补跑一次。需要未登录也运行加 `-UseS4U`（代价：无用户域凭据）。
- 回退后应把 Qoder 采集轮 `disable`，避免两个调度主体重复触发（并发锁会让后来者 exit 3，但白耗一次模型调用）。

## 并发锁

`config/.run-<env>.lock`，内容 `PID|ISO时间`。持锁进程已死立即接管；锁龄超 60 分钟视为残留。多环境独立，互不阻塞。

退出码 3 = 上一轮仍在执行，属正常跳过。持续出现说明有僵死进程或锁文件残留。

## 单轮日志

`config/logs/triage-<yyyyMMdd>-<env>.log`，追加写（无环境后缀的 `triage-<yyyyMMdd>.log` 是历史遗留）。

**有自动清理**：`run-triage.ps1` 每轮末尾按 `output.runLogKeepDays`（当前 14 天）删除 `config/logs/` 下 `LastWriteTime` 超期的 `triage-*.log`，配 0 或负数则不清理。注意 `output.runLogDir` 这个配置键脚本并不读取，日志目录硬编码为 `config/logs/`，改它不会改变落盘位置。

## 运维动作

主路径是 Qoder「自动化」面板：启停、改 cron、看历轮输出。会话内等价动作为 `qoder_cron` 的 `list` / `disable` / `enable` / `update` / `run`（`run` 立即触发一次，用于验证；验证口径见上文「不要信 lastRunStatus」）。

两个任务启停互相独立：停采集轮不会停分析轮（它只会空转回报跳过），停分析轮也不影响采集轮继续落盘。要完全静默就两边都停。

回退路径（仅当改用 OS 计划任务时才需要）：

```powershell
Start-ScheduledTask -TaskName "iMedicalxc-GraylogTriage-<env>"
```

```powershell
Disable-ScheduledTask -TaskName "iMedicalxc-GraylogTriage-<env>"
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\install-schedule.ps1 -Env <env> -Uninstall
```