# Graylog 报错与慢请求巡检（imedicalxc-doctor-graylog-error-triage）

按固定节奏增量抓取 Graylog 的 **ERROR 日志 + 耗时超阈值的慢请求日志（两路并集）**，按堆栈或接口全限定名判定「这是谁的问题」，再把每个报错簇分成**处置分类**（运行时缺陷需改码 / 日志级别待复核 / 业务异常·需人工介入 / 业务控制无需干预），推导 P0/P1 严重度，产出四类文档并按需推送 QQ 群。**P0** 必须按分类出方案（改码位置与改法、日志级别结论、被调方与容错方案、耗时归因），**P1**（业务控制）只确认语义与前端提示文案。**采集与分析都由 Qoder 自动任务驱动，不依赖 Windows 计划任务**：采集轮 cron `0,15,30,45 * * * *`（Full Access，只跑脚本流水线），分析轮 cron `7,37 * * * *`（Auto Approval，只做根因分析与耗时归因）。分工、验证口径与运维见 `skills/imedicalxc-doctor-graylog-error-triage/references/notification-and-schedule.md`。前端定位目前只到候选页面级，按钮级分支未实现；慢请求日志不含 URL，天然无前端定位。

---

## 环境

自动任务与环境一对一：`医生站 Graylog 报错采集轮（<env>）` / `医生站 Graylog 报错分析轮（<env>）`，当前只有 `wengyuan-prod` 建了这两个任务（`87` 连接可用但无自动任务，只能手动跑）。回退到 OS 调度时任务名为 `iMedicalxc-GraylogTriage-<env>`。可用环境由 `config/graylog-triage.json` 的 `environments` 决定，`-Env` 写错会 `exit 2` 并列出可选值。

| 项 | 值 |
|---|---|
| 默认环境 `defaultEnv` | `wengyuan-prod` |
| 已配置环境 | `wengyuan-prod`（翁源生产）、`87`（历史环境，报告保留） |

查本机可选值（key + 中文名 + 是否启用）：

```powershell
node -e "const c=require('./.agents/plugins/imedicalxc-doctor-graylog-error-triage/config/graylog-triage.json');Object.entries(c.environments).forEach(([k,v])=>console.log(k,'|',v.label,'|',v.enabled?'enabled':'disabled'))"
```

**参数写法有两套，不要混**：node 脚本用 `--env`，PowerShell 脚本用 `-Env`。混用不会报错，只会静默退回 `defaultEnv`——输出看着正常，跑的却是另一个环境。

| 想做的事 | 看哪里 |
|---|---|
| 环境名到底是什么、一个名字决定哪五处落地 | `references/接入手册.md` 的「关于 `<env>`」 |
| 新增一个环境（四处都要改） | `references/接入手册.md` 第 5 节 |
| 停用旧环境、启用新环境 | `references/使用指南.md` 第 5 章「换环境」 |

---

## 复用与依赖

通用能力已下沉到库插件 `.agents/plugins/graylog-toolkit/`（查询两路并集、日志解析与簇键、归属/处置/严重度规则引擎、app-only 簇日志语句定位），本插件是它的第一个消费者：`scripts/lib/*` 只做薄转发并注入工程根目录与缓存路径，`scripts/collect-errors.js` / `classify-owner.js` 直接引用 toolkit 的客户端、条目构建与分类接口。规则差异走 `config/graylog-triage.json` 注入，不在脚本里改规则。其他插件要复用同一套规范时引用 toolkit，而不是复制本插件的脚本。

---

## 产物

| 文档 | 内容 | 是否推群 |
|---|---|---|
| `巡检总览-<HHmm>.md` | 本轮窗口、两路采集计数（报错 / 慢请求达标）、归属分布、处置分类分布、P0/P1 分布、慢请求 Top、精度说明、产物清单 | 一条汇总文本 |
| `本组问题-<HHmm>.md` | P0 优先索引 + 处置分流表 + 本组簇（按处置分流分章：运行时缺陷 / 需人工介入 / 日志级别复核 / 业务控制 / 慢请求，章内先有堆栈帧、再仅应用名）+ 待定附录、严重度与依据、堆栈或耗时样例、前端定位、无堆栈簇的「日志语句定位」（按 logger + 文案反查源码，非堆栈证据）、修正/优化方案块 | 否 |
| `基础设施-<HHmm>.md` | 基础设施簇，仅落盘 | 否 |
| `他组通知-<组>-<HHmm>.md` | 他组簇（报错：异常类/堆栈/请求接口；慢请求：接口全限定名/最大·平均耗时）、traceId、调用方、`[P0]`/`[P1]` 标记、排查请求 | 文本 + 群文件 |

四条落盘路径，全部按环境隔离：

| 内容 | 位置 |
|---|---|
| 报告 | `docs/agent-reports/graylog-triage/<env>/<yyyy-MM-dd>/` |
| 运行日志 | `config/logs/triage-<yyyyMMdd>-<env>.log` |
| 水位线与去重表 | `config/graylog-triage-state-<env>.json` |
| 并发锁 | `config/.run-<env>.lock` |

> `基础设施-*` 与 `他组通知-*` 是状态快照，只保留最新轮次；`本组问题-*`、`巡检总览-*` 是历史轨迹，不自动清理。

> QQ 推送当前受网关 403 限制，线上效果是每轮一条 `[WARN]`，`他组通知-*` 需手工转发。背景见 `references/接入手册.md` 第 8 节「已知限制」。

---

## 快速开始

```powershell
# 1) 连接预检（不取数、不落盘）
node .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\collect-errors.js --env <env> --check

# 2) 手动跑一轮（跳过推送）
powershell -NoProfile -ExecutionPolicy Bypass -File .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\run-triage.ps1 -Env <env> -SkipNotify

# 3) 定时化：在 Qoder「自动化」面板建/改采集轮与分析轮（会话内用 qoder_cron）
#    采集轮 cron 0,15,30,45 * * * * + Full Access；分析轮 cron 7,37 * * * * + Auto Approval
#    可选回退到 OS 计划任务时才用下面这条预览（需明确授权，且要先 disable Qoder 采集轮）
powershell -NoProfile -ExecutionPolicy Bypass -File .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\install-schedule.ps1 -Env <env> -DryRun
```

`<env>` 换成具体环境名，当前默认 `wengyuan-prod`。

这三条是「已有连接配置之后」的最短路径。从零接入（mcp.json、安装自检、成功判据）见 `references/接入手册.md` 第 2 节。

---

## 文档导航

| 文档 | 解决什么问题 |
|---|---|
| `references/接入手册.md` | 怎么装、怎么改配置、怎么排障。含 `<env>` 详解、5 步接入、新增环境、排障速查、运维要点 |
| `references/使用指南.md` | 它每天产出什么、报告怎么读、换环境流程。面向传播分享 |
| `references/acceptance-checklist.md` | 部署是否合格，逐项验收 |
| `references/缺陷案例-住院患者列表脱敏.md` | 一个已修缺陷的完整复盘，作为分析方法的样例 |

---

## 脚本清单

| 脚本 | 职责 | 退出码 |
|---|---|---|
| `config-env.js` | 连接解析（mcp.json / 环境变量）+ 主配置加载 | — |
| `collect-errors.js` | 水位线增量采集（ERROR + 慢请求两路并集）+ 消息 id 去重 + traceId 增强 | 0/1/2 |
| `classify-owner.js` | 慢请求接口全限定名前置分支 + 五步归属判定 + 聚簇 + 处置分类初判与 P0/P1 推导 + 待分析队列；`--calibrate` 输出观测证据 | 0/1/2 |
| `penetrate-frontend.js` | 分类结果 → 前端页面候选（启发式，流水线实际入口）；慢请求簇无 URL，计入 `no-http-request` 跳过 | 0/1/2 |
| `build-front-chains.js` | codegraph 模式下的 URL → 页面/操作/JS 行号（分支未启用，仅产出索引） | 0/1/2 |
| `render-report.js` | 四类 md + P0 优先索引 + 严重度与耗时指标 + 双层校验 + 脱敏 + 快照清理 | 0/1/2 |
| `push-notify.js` | QQ 文本 + 群文件 + errorHash 去重 + 外发安全闸门 | 0/1/2 |
| `apply-analysis.js` | **一次性遗留脚本**，硬编码两条历史分析，不可复用，下次清理时删除 | — |
| `verify-install.js` | 安装与注册静态自检（不需要连接 Graylog） | 0/1/2 |
| `run-triage.ps1` | 单轮编排 + 重叠锁 + 日志 | 0/1/2/3 |
| `install-schedule.ps1` | **仅回退到 OS 调度时用**：计划任务预览 / 注册 / 卸载（**无 1**，同名任务已存在为 3；`-Force` 不能覆盖，需先 `-Uninstall`） | 0/2/3 |

---

## 参数速查

| 脚本 | 参数 |
|---|---|
| `collect-errors.js` | `--env` / `--check` / `--limit` / `--dry-run`（取数但不落盘、不推进水位线）/ `--mcp-config` |
| `classify-owner.js` | `--env` / `--file` / `--calibrate` / `--min-count` |
| `penetrate-frontend.js` | `--env` / `--classified` |
| `render-report.js` | `--env` / `--classified` / `--max-stack` / `--check` / `--stdout` |
| `run-triage.ps1` | `-Env` / `-SkipNotify` / `-SkipCollect` / `-Limit` / `-NoLock` |
| `install-schedule.ps1` | `-Env` / `-DryRun` / `-Uninstall` / `-Force` / `-UseS4U` |

完整对照（含易错参数与真实踩坑案例）见 `references/接入手册.md` 6.4。

---

## 关键口径

- **窗口**：`[cursor − overlapSeconds, now]`，ASC 排序；全部成功才推进 cursor；截断时推进到**两路中更早的**已取最后一条 +1ms（只按一路推进会把另一路没取完的数据甩在水位线之后，永久丢失）。
- **两路采集**：ERROR 走 `query.errorSelector`（`level:3`，回退 `level_name:ERROR`）；慢请求走 `query.slowSelector`（`full_message:"接口响应超过"`），单轮上限 2000 条。**阈值按解析出的毫秒数判**（`query.slowThresholdMs`，当前 15000，脚本兜底同值），不靠日志文案：分档最高只到「15秒」，2101 秒的调用也写着「超过15秒」，且「超过」与 `>=` 语义不同。阈值筛选在采集阶段，改值必须重新采集才改变达标集合。
- **errorHash**：报错 `sha1(异常类|首个本组堆栈帧|消息模板)[:16]`；慢请求 `sha1('slow|'+接口全限定名)[:16]`，**不含耗时**——同一接口持续慢会跨轮复现并累加计数。两者都不含 traceId，用于聚簇与跨轮去重。
- **行级去重**：Graylog 消息 `_id`，TTL 由 `state.dedupeTtlHours` 决定（当前 6 小时），超 `dedupeMaxEntries`（80000）按时间淘汰最旧。
- **处置分类**：脚本按条初判后聚簇，回答「这条报错要不要动、动哪里」——`slow-perf`（慢请求，做耗时归因）/ `business-escalation`（业务抛出的外部调用失败或需开发处理，写被调方与原始错误，本组只做容错）/ `business-control`（业务抛出的正常控制，确认语义与提示文案，不改码）/ `runtime-defect`（NPE / 类型转换 / 越界等运行时异常，必须给位置与改法）/ `log-level-review`（无异常类的 log.error，给「降级」或「保留」结论）。运行时异常类优先于业务信号（经 `HisBusinessInterceptor` 打印的 NPE 仍是 `runtime-defect`）；「线程池」「执行失败」等关键词归 `business-escalation`。混合簇按 `runtime-defect > business-escalation > log-level-review > business-control` 取最高优先级，记 `dispositionCounts`。分析轮可用 `analysis.disposition` / `analysis.dispositionReason` 改判。
- **严重度**：由处置分类推导——`slow-perf` / `runtime-defect` / `business-escalation` / `log-level-review` → P0；`business-control` → P1；混合簇保守取 P0 并记 `severityMixed`。分析轮可用 `analysis.severity` / `analysis.severityReason` 改判，全篇以改判为准。P0 必须出方案，P1 不强行改码。
- **归属**：self（医生站 12 模块）/ infra（public 7 仓）/ external（他组按产品组）/ unknown（待定，不猜）。慢请求先按接口全限定名判（证据等级 `interface-fqcn`），未命中才走五步短路。应用名为聚合进程且无本组帧时按 logger 全限定名判（`comnur` / `ph.*` / `arinv` / `com.mediway.hos`），本组堆栈帧始终优先；最内层业务帧未登记归属记待定（`unregistered-business-frame`），不算本组。
- **噪音过滤**：`filters.ignoreMessageIncludes`（当前「未获取到token信息」）在采集、分类、队列三处统一过滤，不落盘、不分析、不进任何报告。
- **无关与待定的区别**：无关是他组应用自身故障（条目自身 app 名可解析即定组，trace 里有本组参与也不改判）且堆栈无本组代码帧，只统计；待定是判不出归属，进人工确认队列。
- **单体陷阱**：本组与基础设施共用 `his-mediway-server`，不能只靠 app_name 判归属，必须看堆栈帧。慢请求更甚——它没有堆栈帧，且药房、ESB 等他组接口也由这个聚合进程打印，只看 app_name 会把他组接口误判成本组。
- **参数名写错不报错**：只会静默走默认值，读了错的文件却照常出结果。是 `-SkipNotify` 不是 `-SkipPush`，是 `-Env` 不是 `-EnvId`，node 脚本是 `--file` 不是 `--raw`。`run-triage.ps1` 没有 `-DryRun`，`collect-errors.js` 没有 `--from`。

---

## 目录与入库规则

`config/` 下只有两份是配置模板，其余都是本机运行态，**不入库**：

| 文件 | 是否入库 | 说明 |
|---|---|---|
| `graylog-triage.json` | ✅ 入库 | 环境注册、采集策略、归属规则、`defaultEnv` |
| `graylog-triage-push.template.json` | ✅ 入库 | 推送模板，地址与群号均为占位符 |
| `graylog-triage-push.json` | ❌ 忽略 | 复制模板后填本机网关与群号 |
| `graylog-triage-state*.json` | ❌ 忽略 | 水位线 + 去重表，按环境分文件 |
| `push-state.json` / `dedupe.json` / `runtime.json` | ❌ 忽略 | 推送与运行态 |
| `pending-queue.json` | ❌ 忽略 | 待分析队列，含真实业务消息 |
| `.run*.lock` / `logs/` / `config/logs/` | ❌ 忽略 | 锁与日志 |

规则定义在 `config/.gitignore`。新增运行态文件时同步补进去，否则下次 `git add .` 会被带进仓库。

---

## 安全

凭据只从 IDE `mcp.json` 或环境变量读取；报告与群消息禁止出现主机地址、IP、令牌。

渲染阶段的脱敏校验是硬闸门：含 `authentication=`、Basic 串、IP 的内容会被拦进 `blocked`，**写完其他文件后 `exit 1`**——宁可少出一份报告，也不让内网地址和 token 进 git。