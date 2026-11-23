---
name: imedicalxc-doctor-graylog-error-triage
description: |
   医生站 Graylog 报错与慢请求巡检的会话侧分析流程。用于「巡检 Graylog 报错」「分析本轮本组报错」「分析接口耗时超过 15 秒的慢请求」「补上次巡检的修正方案」「生成他组通知文档」「校准归属分类」「补推通知」。定时采集由 Qoder 采集轮自动任务完成，本 skill 只做读报告、定根因、写方案、转通知。
---

# 巡检：Graylog 报错与慢请求分析

采集与分析**全部由 Qoder 自动任务（`qoder_cron`）驱动，不依赖 Windows 计划任务**：

| 自动任务 | cron | 权限 | 职责 |
|---|---|---|---|
| 医生站 Graylog 报错采集轮（`<env>`） | `0,15,30,45 * * * *` | Full Access | 只跑 `run-triage.ps1` 流水线，落盘一轮报告 |
| 医生站 Graylog 报错分析轮（`<env>`） | `7,37 * * * *` | Auto Approval | 代跑本 skill，只分析、不采集、不外发 |

任务名里的 `<env>` 与实际建有哪些任务，以 Qoder「自动化」面板为准；可配置的环境与当前默认见 `config/graylog-triage.json` 的 `environments` / `defaultEnv`。触发点故意错开，分析轮读到的一定是已落盘的完整一轮。本 skill 负责**把报错读成根因与修正方案、把慢请求读成耗时归因与优化方案**，以及把该转发的通知整理出去。自动任务身份、验证口径与运维命令见 `references/notification-and-schedule.md`。

## 采集口径：两路日志并集

一轮采集同时取两类日志，**不是二选一**，合并后走同一套归属分组与聚簇：

| 流 | 查询 | 日志级别 | 判定 |
|---|---|---|---|
| 报错 | `level:3`（失败回退 `level_name:ERROR`） | ERROR | 全部保留 |
| 慢请求 | `full_message:"接口响应超过"` | WARN（框架 `LogFilter` 打印） | 按解析出的**耗时毫秒数** >= `query.slowThresholdMs`（当前 15000，脚本兜底同值）本地过滤 |

> **阈值不能按文案判**：框架文案分档最高只到「15秒」，一条 35 分钟的慢调用文案同样写「超过15秒」。当前阈值 15s 虽与最高档同档，但文案是「超过」语义、阈值是 `>=`，档位阶梯也不透明。所以脚本解析 `耗时：N 毫秒` 后按数值判定，`slowTier` 只作展示。
> 慢请求日志**没有堆栈**，只有接口全限定名（`接口[FQCN.method(DTO)]`）、耗时与 traceId。聚簇键是接口名（`sha1('slow|'+interfaceName)`），**耗时不进 hash**，同接口不同耗时合并为一簇并给出最大/平均耗时与最慢样例。
>
> **噪音过滤**：`filters.ignoreMessageIncludes`（当前「未获取到token信息」）命中的消息在采集阶段即丢弃，分类阶段对历史 raw 再过滤一遍，队列同步清理。这类消息不记录、不分析、不进任何巡检结果，也不得人工补回。改判为他组/基础设施的队列条目：`pending`/`blocked` 清理，`analyzed` 保留为历史结论。

## 处置分类：回答「这条报错要不要动、动哪里」

脚本给每个报错簇一个处置分类（`disposition`），与严重度正交；分析轮可改判（`analysis.disposition` + `dispositionReason`）。混合簇按「最需要动作」优先并保留计数（`dispositionMixed` / `dispositionCounts`）。

| 处置分类 | 判定信号 | 必须产出 |
|---|---|---|
| `runtime-defect` 运行时缺陷 | 异常类属 NPE / 类型转换 / 越界 / 算术等运行时异常；**运行时异常优先于业务信号**，即使日志经 `HisBusinessInterceptor` 打印也按本类 | 报错位置（source_* 或堆栈帧）+ 改哪个类哪个方法、加什么判空或边界校验 |
| `log-level-review` 日志级别待复核 | 没有异常类与堆栈，只有 log.error 文案 | 「降级为 warn/info」或「保留 error」的结论与理由；若背后是真故障，改判运行时缺陷 |
| `business-control` 业务控制 | 业务异常信号（业务拦截器 / 「业务异常(」前缀 / `HisBusinessException`、`DocBusinessException` 等），且未命中外部调用与人工处理关键词 | 确认业务语义与前端提示文案，不强制改码 |
| `business-escalation` 业务异常·需人工介入 | 业务异常包裹外部调用失败（Feign/HTTP/超时/熔断类名，或「调用失败 / 接口返回 / 配置缺失 / 线程池 / 执行失败」等关键词），或提示本身就是给开发排障的 | 写明被调方与原始错误 / 需处理事项，给排障、容错、降级或提示方案 |
| `slow-perf` 慢请求耗时 | 耗时超阈值 | 耗时归因与优化方案 |

业务异常信号（`config/graylog-triage.json` 的 `severity` 段）：logger 为 `HisBusinessInterceptor` / 消息首行以「业务异常(」开头 / 异常类简名属于 `HisBusinessException`、`DocBusinessException`、`BaseBusinessException`、`BusinessException`。外部调用与人工处理关键词见 `disposition` 段。

> 业务信号只用于「可预期的人工抛错」，不能压过运行时异常：NPE 等必须先判 `runtime-defect`。「线程池执行任务」「执行失败」按 `business-escalation` 处理，即需人工干预。

> 初判只是起点：配置/数据前提缺失类的 log.error（如「没有关联扩展数据，请注意！」）没有异常类，会落到 `log-level-review`，复核后给「降级」或「保留但改文案」结论；业务控制簇若分析发现实为程序缺陷，改判 `runtime-defect`。

## 严重度：脚本初判 + 分析轮改判

| 级别 | 初判条件 | 必须产出 |
|---|---|---|
| **P0** | 慢请求；或处置分类为 `runtime-defect` / `business-escalation` / `log-level-review` | 按处置分类给对应方案（见上表） |
| **P1** | 处置分类为 `business-control` | 确认业务语义与提示文案，不强制改代码 |

混合簇（部分业务控制、部分需干预）**保守取 P0** 并标 `severityMixed`。分析轮可在队列条目的 `analysis.severity` 改判（附 `severityReason`），渲染时**全篇以改判为准**——严重度分布表、P0 优先处理清单、处置分流、簇标题徽标同步生效。

## 步骤 0：定位本轮产物

> 下文所有 `{env}` 替换为实际环境 ID，取值见 `config/graylog-triage.json` 的 `environments` 键，缺省用 `defaultEnv`。脚本不绑定任何环境，路径里的 `{env}` 必须与传给 `--env` 的值一字不差。

```powershell
$d = "docs\agent-reports\graylog-triage\{env}\" + (Get-Date -Format 'yyyy-MM-dd'); Get-ChildItem $d -Filter "*-*.md" | Sort-Object LastWriteTime -Descending | Select-Object -First 8 Name, Length, LastWriteTime
```

按文件名里的 HHmm 取最新一轮。若最新轮次距现在超过 40 分钟，先确认 Qoder 采集轮是否正常：在「自动化」面板看它的启用状态与最近一次运行，或用 `qoder_cron` 的 `list`。

**不要只看 `lastRunStatus`**——它只代表会话跑完，不代表流水线成功。判定一轮是否真跑了看三项客观证据：

```powershell
Get-Item ".agents\plugins\imedicalxc-doctor-graylog-error-triage\config\logs\triage-<yyyyMMdd>-{env}.log" | Select-Object LastWriteTime
Get-Item ".agents\plugins\imedicalxc-doctor-graylog-error-triage\config\graylog-triage-state-{env}.json" | Select-Object LastWriteTime
```

日志 mtime 与 state cursor 都没推进、且没有新产物，说明这一轮实际没跑（常见原因是权限模式拦下了命令，或 Qoder 客户端当时未运行）。再查日志里的 `[FAIL]` / `[TAIL]` / `[WARN]` 行定位阶段。

## 步骤 1：读汇总，决定要不要往下走

> **取材范围分两种**：会话内手动巡检按步骤 0 定位的**最新一轮**走下面的流程；分析轮自动任务代跑时取材范围是 **`config/pending-queue.json` 的全量候选**（`pending` + `lastSeen` 前进的 `blocked`，每轮上限 4 条簇；含本组调用他组的跨组报错条目 `origin: self-calls-external`），此时本步骤的汇总只用来确认采集是否正常，**分析哪几条簇以队列为准**，候选集与优先级见 `references/notification-and-schedule.md` 的「分析轮边界」。

读 `巡检总览-<HHmm>.md`：

| 情况 | 动作 |
|---|---|
| 本组簇 0 个（报错与慢请求都为 0） | 结束，一句话回报「本轮无本组报错与慢请求」 |
| 有 P0 簇（运行时缺陷 / 需人工介入 / 日志级别复核 / 慢请求） | **优先处理**，直接看 `本组问题-<HHmm>.md` 开头的「P0 优先处理清单」与「处置分流」，按序号跳到对应明细 |
| 本组报错簇 ≥ 1，且 `selfModuleFrame ≥ 1` | 进步骤 2，可定性根因 |
| 本组报错簇 ≥ 1，但 `selfAppOnly == 报错簇数`（全部仅应用名推断） | 先读 `基础设施-<HHmm>.md`，按 traceId 横向找同轮基础设施/他组簇；这些簇只列证据，不得直接定性为本组缺陷 |
| 本组慢请求簇 ≥ 1（`selfSlow`） | 进步骤 2 的「慢请求耗时归因」，一律 P0，必须给出耗时原因 |
| 本组调用他组报错簇 ≥ 1（来源 `self-calls-external`，报告「附录：本组调用他组失败」） | 进步骤 2 的「跨组失败判断」：写明被调方与原始错误，本组只给容错方案 |
| 只有 P1 簇（业务控制） | 确认业务语义与提示文案即可，不强制改代码 |
| 待定簇 ≥ 1 | 进步骤 4 |
| 有 `他组通知-*` | 进步骤 5 |

> 归属分档数字直接从 `巡检总览-<HHmm>.md` 的「归属分布」各行读（本组分为「有本组堆栈帧」「仅应用名推断」「慢请求」三行），不要自己相加判断。严重度看「严重度分布」表，跨归属的慢请求排名看「慢请求 Top」。
> `app-only` 只说明日志由 `his-mediway-server` 这个聚合进程打印，**不能证明异常由本组代码抛出**。
> 无异常类的报错簇（多为 app-only）标题取**消息首行**并做头尾截断，行尾的 `extCode` / `path` / 失效药品名才是区分信息；同名标题会补 errorHash 前 8 位。

## 步骤 2：本组簇分析（报错根因 / 慢请求耗时归因）

读 `本组问题-<HHmm>.md`。文件按**处置分流分章**（一、运行时缺陷；二、业务异常·需人工介入；三、日志级别待复核；四、业务控制；五、慢请求），章内先有本组堆栈帧、再仅应用名推断、最后慢请求；开头的「P0 优先处理清单」给出跨章的处理顺序，**先做 P0**；文末另有「附录：本组调用他组失败」与「附录：待定归属」。

每簇先看「类型 / 严重度 / 处置分类 / 处置依据 / 归属判定 / 来源 / 证据等级」七行，再分流：

- **`business-control`（业务控制，P1）**：确认业务语义与前端提示文案是否准确、是否该拦，不强制改代码。若分析发现实为程序缺陷，用 `analysis.disposition` 改判 `runtime-defect`。
- **`runtime-defect`（运行时缺陷，P0）**：必须给出报错位置与代码修改方案，走下面的报错根因流程。
- **`log-level-review`（日志级别待复核，P0）**：判定该 log.error 是级别滥用应降级，还是确实应保留；给结论与理由，背后有真故障则改判 `runtime-defect`。这类簇多无堆栈，簇内「日志语句定位」块已按 `logger_name` + 日志文案反查出 `log.*` 源码文件/行/级别（标注为文案匹配、非堆栈证据）；块内提示「基础设施公共仓」时先核对归属，提示「工作区源码级别与采集侧不一致」时以线上部署版本为准。
- **`business-escalation`（业务异常·需人工介入，P0）**：穿透调用方包装，写明被调方与原始错误；本组方案只做排障、容错、降级或提示优化。
- **`slow-perf`（慢请求，P0）**：必须分析耗时原因，走「慢请求耗时归因」。

### 报错根因

1. 记录异常类、errorHash、次数、**处置分类**、**证据等级**、锚点堆栈帧、**源码定位**（`source_class_name` / `source_file_name` / `source_line_number` / `source_method_name`，缺失时报告用堆栈最内层业务帧兜底）、样本消息。源码定位优先于堆栈首帧：异常被包装时首帧常是框架类。结论按处置分类落：`runtime-defect` 给位置与改法，`log-level-review` 给级别结论，`business-escalation` 给被调方与原始错误，`business-control` 只确认语义与文案。
2. **证据等级为 `app-only` 的簇没有本组堆栈帧，跨不到源码**：先按 traceId 找同轮基础设施或他组簇，再判断是「本组缺陷」「本组调用失败」还是「聚合进程代答」。判不出来写「待查」。
3. **交叉源码**：按堆栈帧的类名与包名定位到模块，读该帧附近代码，判断属于哪一类：
   - 业务校验失败（`HisBusinessException` 等显式抛出）
   - 空指针 / 类型转换 / 数组越界
   - SQL 或 ORM（`BadSqlGrammarException`、约束冲突、结果集过大）
   - 序列化 / 反序列化
   - 调用外部服务失败（Feign、HTTP、MQ）
   - 配置或数据前提缺失
4. **按「来源」判断责任侧**，不要混为一谈：
   - `本组自身代码/配置/数据` → 本组缺陷或配置/数据问题，指出改哪个文件哪一行、改成什么
   - `本组调用他组失败` → 写明被调方组/模块与**原始错误码与文案**（穿透调用方包装），本组只给容错/降级/提示优化方案；报告里已并入对应 `他组通知-*`，不得按本组缺陷改码、不得臆造本组堆栈
   - `他组自身故障` → 通知他组即可，不进本组分析队列
   - `基础设施组件` → 归基础设施，汇总说明
   - `证据不足，待定` → 写「待查」并说明缺什么证据（缺锚点帧 / 缺 trace 对端 / 需校准归属）
   - 报告显示「混合：…」时按条目数判断主体；只要混有本组自身条目，先查本组那一条
5. 推理必须落到具体文件与行号。定位不到就写「待查」，不猜。

### 慢请求耗时归因

慢请求簇没有堆栈摘要，只有「接口 / 耗时 最大·平均 / 最慢样例」与「耗时样例」表（时间本地 UTC+8、耗时、traceId）。

1. **归属看接口全限定名，不看打印进程**：`his-mediway-server` 是聚合进程，会代他组模块应答。规则 `slow-interface-fqcn` + 证据等级 `interface-fqcn` 表示按接口包前缀定组（高置信）；若显示 `app-only`，说明该接口前缀未登记，**此时无代码证据，不得直接定性为本组缺陷**，先按步骤 4 校准前缀。
2. **按最慢样例的 traceId 拉全链路**（Graylog 只读查询），分阶段分解耗时：入口 → 本组业务 → 每次远程调用 → SQL → 序列化/返回。找出耗时集中在哪一段，不要只看总耗时下结论。
3. **区分两类原因**，结论必须明确是哪一类：
   - 数据量正常的长耗时（大批量结算、跨院区聚合、长轮询/等待外部回执）→ 说明业务语义与量级证据，给异步化/分批/超时与提示优化方案，不当缺陷改码
   - 代码缺陷 → N+1 逐条调用、慢 SQL / 缺索引、循环内远程调用、缺批量接口、串行可并行、无缓存重复查字典；指出改哪个文件哪一行
4. 调用他组接口导致的长耗时：写明被调方接口与耗时占比，本组只做容错与批量/并发改造，按步骤 5 转对应产品组。
5. 同接口多次出现时看最大与平均的差距：只有个别极值多为数据量或外部等待，稳定高耗时多为代码缺陷。

> 归属路由与分组口径：`references/owner-classification.md`；报告字段与段落结构：`references/report-templates.md`

## 步骤 3：回填修正方案

把结论写进 `config/pending-queue.json` 里对应 errorHash 的条目：

```json
{
  "errorHash": "xxxxxxxxxxxxxxxx",
  "status": "analyzed",
  "analyzedAt": "<ISO 时间>",
  "analysis": {
    "rootCause": "…",
    "fix": "1. …\n2. …",
    "verification": "…",
    "severity": "P1",
    "severityReason": "业务控制抛出，非程序缺陷，由 P0 改判",
    "disposition": "log-level-review",
    "dispositionReason": "纯 log.error 文案，无异常类；复核后判定应降级为 warn"
  }
}
```

- `severity` / `severityReason` / `disposition` / `dispositionReason` **可选**：只有改判脚本初判时才写。`severity` 取 `P0` / `P1`；`disposition` 取 `runtime-defect` / `log-level-review` / `business-control` / `business-escalation` / `slow-perf`。写了之后报告的严重度分布、处置分类分布、P0 清单、处置分流与簇明细全部以它为准，并显示「分析轮改判，脚本初判 X」。
- **慢请求簇同样用这三个字段**：`rootCause` 写耗时原因（哪一段耗时、数据量正常还是代码缺陷），`fix` 写优化方案，`verification` 写怎么验证耗时下降。渲染时段落标题自动变成「耗时归因与优化方案」，字段标签变成「耗时原因 / 优化方案」，不需要另建结构。
- **跨组条目（队列 `origin: self-calls-external`）**：`rootCause` 必须写明被调方（`ownerGroup` / `ownerModule`）与原始错误，`fix` 只写本组容错/降级/提示优化；不得把调用方包装异常当根因，也不得把方案写成修他组代码。
- 采集侧每轮只刷新观测值（`kind`、`severity` / `disposition` 初判、`count`、`lastSeen`、慢请求的 `interfaceName` / `durationMaxMs`），**不会覆盖 `status` 与 `analysis`**，已回填的结论跨轮保留。

写完后重渲染该轮，让方案进入报告：

```powershell
node .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\render-report.js --env {env} --classified "docs\agent-reports\graylog-triage\{env}\<日期>\classified-<HHmm>.json"
```

**判不出的簇不要标 `analyzed`，也不要留 `pending` 每轮空转**，写 `blocked`：

```json
{
  "errorHash": "xxxxxxxxxxxxxxxx",
  "status": "blocked",
  "blockedAt": "<ISO 时间>",
  "analysis": {
    "rootCause": "待查",
    "fix": "还缺什么证据才能定性：例如缺锚点堆栈帧 / 缺同轮 trace 对端 / 需人工确认归属"
  }
}
```

脚本只读 `analysis` 字段、不读 `status`（`render-report.js:207`），所以 `blocked` 对流水线无副作用，渲染后报告显示「待查」与所缺证据。`blocked` 的簇只在 `lastSeen` 前进（有新证据）时才重新纳入候选。

**回填的簇分散在多个轮次时，按受影响轮次分别重渲染**，每轮用它自己的 `classified-<HHmm>.json`；该文件已被清理就跳过重渲染，并说明「结论已入队列，报告待该轮产物存在时再渲染」。

> `apply-analysis.js` 是一次性遗留脚本，只硬编码了两条历史分析，不能做通用回填，不要依赖它。

## 步骤 4：待定簇处理

1. 拿观测证据：

```powershell
node .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\classify-owner.js --env {env} --calibrate
```

2. 从输出里找未归类的 app name 与包前缀。
3. 判断归属，补进 `config/graylog-triage.json` 的 `ownerGroups`：

```json
"external": { "appGroups": { "病案": ["mrdia", "mrqc", "mrfs"] } }
```

**慢请求还要看包前缀**：`appGroups` 的模块代码只推导出 `com.mediway.his.<code>`，真实包名可能不是这个形状。前缀未登记时慢请求会退回应用名推断（`app-only`），聚合进程代答的他组接口就会被算成本组。此时补 `external.packagePrefixes`：

```json
"external": { "packagePrefixes": { "药房药库": ["com.mediway.his.ph.in", "com.mediway.his.ph.ip", "com.mediway.his.ph.op", "com.mediway.his.ph.herb"] } }
```

> 实测例：`com.mediway.his.ph.in.bs.controller.PhInRecController.handleAudit` 由 `his-mediway-server` 打印，登记前归到了本组 `app-only`。药房药库真实包是 `com.mediway.his.ph.{in|ip|op|herb}`（药库/住院药房/门诊药房/中草药房），不是推导的 `com.mediway.his.phin`。证据取自本工作区 `comoe`/`ipcare`/`opcare` 对这些包下 Feign 客户端的导入，以及产品组映射表 `application-mapping.md`。匹配按包段边界（`prefix` 或 `prefix.`），所以 `ph.in` 不会误吞 `phin`。

4. **不得**因为「看起来像医生的」就把前缀塞进 `self.modules`。先有观测证据，再补配置。
5. 补完重跑分类验证待定归零：

```powershell
node .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\classify-owner.js --env {env} --file "docs\agent-reports\graylog-triage\{env}\<日期>\raw-errors-<HHmm>.json"
```

注意参数是 `--file`，不是 `--raw`；写错会被静默忽略并读取目录里最新的 raw 文件。

> **顺序要求**：`--file` 会重写 `classified-<HHmm>.json` 并**丢掉其中的 `frontend` 块**，已渲染报告的「前端穿透」会退化成「未执行」。所以这一步要放在回填 `pending-queue.json` 与重渲染**之前**做。若已经降级，按顺序补跑两条即可恢复（`raw-errors-*` 不受影响）：
>
> ```powershell
> node .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\penetrate-frontend.js --env {env} --classified "docs\agent-reports\graylog-triage\{env}\<日期>\classified-<HHmm>.json"
> node .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\render-report.js --env {env} --classified "docs\agent-reports\graylog-triage\{env}\<日期>\classified-<HHmm>.json"
> ```

## 步骤 5：他组通知

读 `他组通知-<组>-<HHmm>.md`，逐项确认含：时间窗、归属组、异常类、次数、traceId、请求接口、调用方服务、截断堆栈、排查请求；且无 IP、主机名、凭据。确认后转发给对应产品组。

每簇的「来源」行区分「医生站侧调用贵组接口失败」与「贵组应用自身报错」，概览按这两类给出簇数，转发前核对该计数与正文一致。通知文档**不含本组内部的分析结论**（根因/修正方案只在 `本组问题-*` 与队列里），不要把 `本组问题-*` 的方案段一并转发。

标题按桶内实际内容动态生成：`报错通知` / `慢请求通知` / `报错与慢请求通知`。**慢请求簇的核对项不同**：

- 给的是**接口全限定名 + 最大/平均耗时 + 最慢样例 traceId**，没有异常类也没有堆栈（框架 WARN 日志本就不带堆栈），不要向对方索要堆栈。
- 归属依据是接口包前缀（`slow-interface-fqcn`），文档里会写明「按接口全限定名归属，**非调用失败**」，排查请求是请对方分析耗时原因并给优化方案。
- 他组应用自己打印的慢请求归「无关」（本组未参与该 trace），默认不生成通知，除非该组在 `notify.notifyUnrelated` 里。

`他组通知-*` 是状态快照，只保留最新轮次；要留历史就另存到别处。

## 步骤 6：推送（仅已配置时）

未配置时每轮一条 `[WARN] 推送未配置`，不影响其他阶段。补推某一轮：

```powershell
node .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\push-notify.js --env {env} --classified "docs\agent-reports\graylog-triage\{env}\<日期>\classified-<HHmm>.json"
```

如需只预览不发送，加 `--dry-run`；若脚本不认该参数会直接报错，去掉即可。

## 硬约束

1. 不臆造堆栈帧、文件路径、行号。定位不到写「待查」。
2. 不把「调用方包装异常」当根因，穿透到被调方的原始返回码与文案。
3. 外发内容不得含主机名、IP、令牌、患者信息。
4. 未确认归属的前缀不进 `self` 白名单。
5. 只读取脚本产物，不改写 `raw-errors-*` / `classified-*`。
6. 修复方案必须可执行：改哪个文件、改什么、怎么验证。
7. `app-only` 簇不得作为本组缺陷的定性依据，只能作为排查线索。
8. **P0 簇必须按处置分类出方案**：`runtime-defect` 给位置与代码改法，`log-level-review` 给「降级 / 保留」的级别结论，`business-escalation` 给被调方与原始错误及本组容错，`slow-perf` 给耗时归因与优化方案。只写「待查」时必须说明还缺什么证据。
9. **`business-control` 不强制改码**，但要把业务语义与前端提示文案确认清楚；发现实为程序缺陷要改判 `runtime-defect` 并出方案。
10. 慢请求归属以**接口全限定名**为准，不以打印进程名为准；前缀未登记而退回 `app-only` 的慢请求不得定性为本组缺陷。
11. 慢请求耗时结论必须区分「数据量正常的长耗时」与「代码缺陷」，并给出分阶段耗时证据，不能只凭总耗时下结论。
12. 严重度改判必须写 `severityReason`，说明为什么推翻脚本初判。
13. **来源决定责任侧**：`self-calls-external` 的簇必须写被调方与原始错误，本组方案只做容错；来源为 `external` / `infra` 的簇不得写成需要本组改码的缺陷。
14. **处置分类必须可执行**：`runtime-defect` 必须落到具体类/方法/行；`log-level-review` 必须明确「降级为 warn/info」或「保留 error」之一，不得只写「建议关注」。
15. **业务异常必须区分 ①/②**：前端可识别处理的正常业务控制归 `business-control`；包裹外部调用失败或提示给开发排障的归 `business-escalation`，两者不得混写。
16. 处置分类改判必须写 `dispositionReason`；与来源正交——`app-only` 簇照样有处置分类，但定性仍受证据等级约束。
17. **噪音消息不得进入结果**：`filters.ignoreMessageIncludes` 命中的消息（当前「未获取到token信息」）不记录、不分析、不进本组报告/他组通知/队列，也不得人工补回。
18. **归属以 logger 全限定名为准（无本组帧时）**：`comnur`/`ph.*`/`arinv`/`com.mediway.hos` 等 logger 打出的日志不得留在本组「仅应用名推断」；本组堆栈帧在场时以本组帧为准。应用名只是聚合进程且最内层业务帧未登记归属时记「待定」，不得算本组。
19. **条目自身 app 名可解析为他组时直接归「无关」**：即使同一 trace 里有本组应用参与，只要堆栈无本组代码帧（`hasSelfCodeFrame` 为假），就按 `trace-peer-app-name` / `feign-app-name` 归该组「无关」，不得因本组参与降级为「待定」；只有本组帧在场时才继续走 URL / 待定路径。