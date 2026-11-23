
# imedicalxc-doctor-graylog-error-triage

HIS 医生站 Graylog 报错与慢请求巡检能力包。采集 ERROR 日志与耗时超阈值的慢请求日志两路并集，按 P0/P1 初判严重度。确定性脚本负责采集/分类/渲染/通知，LLM 只在会话内做本组根因分析、慢请求耗时归因与修正方案。

## 入口

| 场景 | 入口 |
|---|---|
| 首次接入、连接配置、创建自动任务 | `skills/imedicalxc-doctor-graylog-error-triage-init/SKILL.md` |
| 日常巡检、补修正方案、校准归属、补推通知 | `skills/imedicalxc-doctor-graylog-error-triage/SKILL.md` |
| 调度设计、采集轮与分析轮、改采集节奏 | `skills/imedicalxc-doctor-graylog-error-triage/references/notification-and-schedule.md` |

## 架构边界

- **复用层**：查询、解析、归属/处置规则、日志语句定位的通用实现位于 `.agents/plugins/graylog-toolkit/`；本插件 `scripts/lib/*` 只做薄转发并注入工程根目录与缓存路径，不得在本插件内复制或分叉这些实现。
- **采集层**：`scripts/collect-errors.js`，只读 Graylog，**两路查询取并集**：ERROR 日志 + `LogFilter` 慢请求 WARN（耗时 ≥ `slowThresholdMs`，默认 15000）。慢请求阈值按解析出的毫秒数判定，不靠日志文案：分档文案最高只到「15秒」，2101 秒的调用也写着「超过15秒」，且「超过」与 `>=` 语义不同，`tier` 只作展示。两路共用同一水位线窗口、消息 id 去重表与截断语义，失败不推进 cursor。**采集入口按 `filters.ignoreMessageIncludes` 过滤噪音**（当前含「未获取到token信息」）：不落盘、不分析、不进巡检结果，只输出过滤计数。
- **分类层**：`scripts/classify-owner.js` + `scripts/lib/owner-index.js`。分类入口再按同一 `filters.ignoreMessageIncludes` 过滤一遍（兼容历史 raw 文件），并**清洗待分析队列**：配置过滤命中的条目直接删除；本轮被改判为不再入队（他组/基础设施/无关）的旧条目中，`pending` / `blocked` 删除，`analyzed` 保留为历史结论并刷新观测字段。
- **归属判定**：慢请求先走 **⓪ 接口全限定名前置分支**（证据等级 `interface-fqcn`，优先于 app_name，因为慢请求没有堆栈帧且常由聚合进程打印），未命中再走五步短路判定。logger 归属用 raw 字段 `logger_name` 的**完整 FQCN**（`ownerGroups.external.packagePrefixes` / `external.loggerPrefixes` / `ownerGroups.infra.loggerPrefixes`），缩写的 `c.m.h.*` 只作正文兜底。优先级：**本组堆栈帧 > logger 全限定名 > URL 模块 > 应用名**——他组代码用他组 logger 打印、但异常抛在本组 frame 上时仍归本组；`com.mediway.hos.*` 按基础设施（hos 框架）计，护士站 `comnur`、药房 `ph.*/com.ph`、计费 `arinv` 等他组包显式登记，聚合进程 `his-mediway-server` 代打的日志不再记为本组。应用名只是聚合进程且最内层业务帧未登记任何归属时，按 `unknown`（`unregistered-business-frame`）处理，不按「仅应用名」算本组。**条目自身 app 名可解析为他组即归「无关/该组」**（`trace-peer-app-name` / `feign-app-name`）：trace 里有本组参与只说明本组被影响，不改归属；堆栈出现本组代码帧（`hasSelfCodeFrame`）才落下交人工。归属索引由配置声明 ∪ 工作区真实源码扫描自校准，未知一律进「待定」，不猜。
- **处置分类**：按 `disposition` 规则给每个报错簇初判（与严重度正交）：`runtime-defect` 运行时缺陷 / `log-level-review` 日志级别待复核 / `business-control` 业务控制 / `business-escalation` 业务异常·需人工介入；慢请求为 `slow-perf`。**运行时异常类（NPE、越界、类型转换等）优先于业务信号**：`HisBusinessInterceptor` 等统一日志入口不代表业务控制，NPE 必须归 `runtime-defect`（P0）；消息命中「线程池」「执行失败」等人工处理关键词或外部调用异常时归 `business-escalation`（P0）。混合簇按「最需要动作」优先并记 `dispositionCounts`。严重度随之推导：慢请求与前三类 → P0，`business-control` → P1（混合记 `severityMixed`）。
- **穿透层**：`scripts/penetrate-frontend.js`，流水线实际入口；`scripts/build-front-chains.js` 是 codegraph 模式的独立实现，索引缺失时降级启发式并强制标注。慢请求簇没有请求 URL，计入 `no-http-request` 并跳过，属正常结果而非缺陷。
- **渲染层**：`scripts/render-report.js`，双层校验闸门，校验失败不写任何文件。本组报告先出 **P0 优先索引**与**处置分流**（哪些需改码 / 需人工介入 / 需复核级别，哪些是业务控制无需干预），正文**按处置分流分章**（运行时缺陷 / 业务异常·需人工介入 / 日志级别待复核 / 业务控制 / 慢请求），每章内再按「有本组堆栈帧 → 仅应用名推断 → 慢请求」排序；每簇标注严重度与依据、处置分类与依据，慢请求出耗时最大·平均与 traceId 样例表，方案段标题按 kind 切换为「耗时归因与优化方案」；**无堆栈、无 `source_*` 的 app-only 报错簇**由 `scripts/lib/log-site-locate.js` 按 `logger_name` + 中文文案/长标识符反查源码 `log.*` 语句，渲染「日志语句定位」块（文案匹配非堆栈证据，标出 infra 仓与代码级别不一致）。`analysis.severity` / `analysis.disposition` 可覆盖脚本初判；他组通知不展示处置分类。
- **通知层**：`scripts/push-notify.js`，只推他组明细 + 一条汇总；本组/基础设施/待定只落盘。
- **采集调度层**：Qoder 自动任务「医生站 Graylog 报错采集轮（`<env>`）」，cron `0,15,30,45 * * * *`，**Full Access**（Auto Approval 会拦下 `run-triage.ps1`，实测整轮零文件系统效果）。只跑 `scripts/run-triage.ps1` 一条命令并按退出码回报；脚本自带水位线增量、重叠锁与超时保护。
- **分析调度层**：Qoder 自动任务「医生站 Graylog 报错分析轮（`<env>`）」，cron `7,37 * * * *`，Auto Approval，只驱动会话侧分析，不采集、不外发、不改任何调度任务。实际建有哪些任务以 Qoder「自动化」面板为准。
- **分析层**：会话内按主 skill 步骤 1-3 读最新一轮；分析调度层代跑时**取材范围是 `config/pending-queue.json` 全量候选**（`pending` + `lastSeen` 前进的 `blocked`，每轮上限 4 条簇），**P0 先于 P1**，按 errorHash 跨轮回捞证据。报错簇定根因并给修正方案；慢请求簇按接口全限定名定归属、按 traceId 追全链路分解各阶段耗时，必须区分「数据量正常但代码有缺陷」与「数据量本身过大」。结论回填队列后用 `render-report.js` 按受影响轮次分别重渲染；缺证据的簇标 `blocked` 暂存，他组通知整理为 `analysis-outbox-<HHmm>.md` 待人工转发。
- **OS 调度（回退，非默认）**：`scripts/install-schedule.ps1` + `iMedicalxc-GraylogTriage-<env>`，当前已注册的 OS 任务为 Disabled，不参与调度；周期由 `config.schedule.intervalMinutes` 决定。分层设计、权限取舍、验证口径与运维见 `skills/imedicalxc-doctor-graylog-error-triage/references/notification-and-schedule.md`。

## 硬约束

1. 定时主体是 Qoder 自动任务（`qoder_cron`），采集与分析各一个，**不依赖 Windows 计划任务**；OS 任务仅作可选回退，启用时必须先 `disable` Qoder 采集轮，避免双调度。采集轮需 Full Access 才能跑 `run-triage.ps1`（Auto Approval 会拦），其 prompt 必须保持「单命令 + 退出码协议 + 禁止清单」的极窄形态。自动任务不得自行创建、修改、暂停任何调度任务（含自身），调度变更只能由人工发起。判定一轮是否真跑了只看日志 mtime / 产物文件 / state cursor 三项客观证据，`lastRunStatus: succeeded` 只代表会话完成，不代表流水线成功。
2. 连接信息单一事实源是 IDE 的 `mcp.json`（`mcpServers["graylog-<env>"].env`），脚本只读取，不复制、不落盘、不回显。
3. 凭据（Graylog token/cookie、QQ 令牌）一律走环境变量或 IDE mcp.json，禁止写入配置、报告、日志、记忆。
4. 外发内容必须脱敏：URL 主机名剥离为 `<host>`，禁止 IP、`Basic` 串、令牌变量名出现在群消息与文档。
5. 归属未确认的前缀不得塞进 self 白名单；先 `--calibrate` 取观测证据。
6. 远端写入、创建或改动 Qoder 自动任务、OS 计划任务注册（仅回退路径）、前端索引构建（约 6 分钟 / 300MB）均需用户明确授权。
7. 本插件不登记 canonical agent / workflow；改码阶段走既有 `standard-change`。
8. **P0 必须按处置分类产出可执行方案**：`runtime-defect` 给位置与代码改法，`log-level-review` 给「降级 / 保留 error」的结论，`business-escalation` 给被调方与原始错误及本组容错，`slow-perf` 给耗时归因与优化方案。证据不足时标 `blocked` 并写明还缺什么证据，不得以「持续观察」搪塞。
9. **`business-control` 不强行改码**：业务正常处理抛出的异常只说明触发条件与前端提示文案。分析轮改判严重度或处置分类必须分别写 `analysis.severityReason` / `analysis.dispositionReason`。
10. **慢请求归属以接口全限定名为准**，不得只看打印进程名：`his-mediway-server` 是聚合进程，药房、ESB 等他组接口也由它打印，只看 app_name 会误判成本组。
11. **噪音过滤是硬规则**：`filters.ignoreMessageIncludes` 命中的消息（当前「未获取到token信息」）不得采集、分析、写入巡检结果或队列，也不得人工补回；新增噪音类型只改配置，不改报告。
12. **NPE 等运行时异常不得判为 P1**，必须归 `runtime-defect`（P0）；「线程池执行任务」「执行失败」这类消息必须归 `business-escalation`（P0，需人工干预）。logger 名已能定位到他组（comnur / ph.* / arinv / hos）的日志不得留在本组「仅应用名推断」，本组堆栈帧与 logger 冲突时以本组帧为准。条目自身 app 名已能定到他组时不得因 trace 含本组降为「待定」，除非堆栈有本组代码帧。

## 依赖

| 依赖 | 类型 | 说明 |
|---|---|---|
| `graylog-toolkit` | 仓库内库插件（enabled） | 提供 Graylog 两路查询、日志解析与簇键、归属/处置/严重度规则引擎、app-only 簇日志语句定位；本插件通过 `scripts/lib/*` 薄转发复用，`scripts/config-env.js` 负责注入 `repoRoot` 与缓存目录 |
| `mcp-graylog/index.js` | 仓库内共用 MCP 服务 | 会话通道；需含 `graylog_search_absolute` / `graylog_trace` / offset |
| `imedicalxc-doctor-codegraph` | availableDependencies | 前端链路索引与查询脚本，阶段 `frontend-penetration` |
| Node.js 18+ | 运行时 | 脚本使用 `node:` 前缀内置模块与 `Intl` |
| Python 3.8+ | 可选 | 仅前端穿透与索引构建需要 |

## 配置

- 主配置 `config/graylog-triage.json`（入库，不含凭据）
- 推送配置 `config/graylog-triage-push.json`（由模板复制，**不入库**）
- 运行态 `config/graylog-triage-state.json`、`config/push-state.json`、`config/pending-queue.json`、`config/.run.lock`（**不入库**）