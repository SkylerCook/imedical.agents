
# imedicalxc-doctor-graylog-error-triage

HIS 医生站 Graylog 报错与慢请求巡检能力包。采集 ERROR 日志与耗时超阈值的慢请求日志两路并集，按 P0/P1 初判严重度。确定性脚本负责采集/分类/渲染/通知，LLM 只在会话内做本组根因分析、慢请求耗时归因与修正方案。

## 入口

| 场景 | 入口 |
|---|---|
| 首次接入、连接配置、创建自动任务 | `skills/imedicalxc-doctor-graylog-error-triage-init/SKILL.md` |
| 日常巡检、补修正方案、校准归属、补推通知 | `skills/imedicalxc-doctor-graylog-error-triage/SKILL.md` |
| 调度设计、采集轮与分析轮、改采集节奏 | `skills/imedicalxc-doctor-graylog-error-triage/references/notification-and-schedule.md` |

## 架构边界

- **采集层**：`scripts/collect-errors.js`，只读 Graylog，**两路查询取并集**：ERROR 日志 + `LogFilter` 慢请求 WARN（耗时 ≥ `slowThresholdMs`，默认 15000）。慢请求阈值按解析出的毫秒数判定，不靠日志文案：分档文案最高只到「15秒」，2101 秒的调用也写着「超过15秒」，且「超过」与 `>=` 语义不同，`tier` 只作展示。两路共用同一水位线窗口、消息 id 去重表与截断语义，失败不推进 cursor。
- **分类层**：`scripts/classify-owner.js` + `scripts/lib/owner-index.js`。慢请求先走 **⓪ 接口全限定名前置分支**（证据等级 `interface-fqcn`，优先于 app_name，因为慢请求没有堆栈帧且常由聚合进程打印），未命中再走五步短路判定。归属索引由配置声明 ∪ 工作区真实源码扫描自校准，未知一律进「待定」，不猜。同时按 `severity` 配置初判严重度：慢请求一律 P0；报错簇全为业务异常 → P1，否则 P0（部分业务异常记 `severityMixed`）。
- **穿透层**：`scripts/penetrate-frontend.js`，流水线实际入口；`scripts/build-front-chains.js` 是 codegraph 模式的独立实现，索引缺失时降级启发式并强制标注。慢请求簇没有请求 URL，计入 `no-http-request` 并跳过，属正常结果而非缺陷。
- **渲染层**：`scripts/render-report.js`，双层校验闸门，校验失败不写任何文件。本组报告先出 **P0 优先索引**（含类型/证据等级），再按「有本组堆栈帧 / 仅应用名推断 / 慢请求」三段展开；每簇标注严重度与依据，慢请求出耗时最大·平均与 traceId 样例表，方案段标题按 kind 切换为「耗时归因与优化方案」。`analysis.severity` 可覆盖脚本初判。
- **通知层**：`scripts/push-notify.js`，只推他组明细 + 一条汇总；本组/基础设施/待定只落盘。
- **采集调度层**：Qoder 自动任务「医生站 Graylog 报错采集轮（wengyuan-prod）」，cron `0,15,30,45 * * * *`，**Full Access**（Auto Approval 会拦下 `run-triage.ps1`，实测整轮零文件系统效果）。只跑 `scripts/run-triage.ps1` 一条命令并按退出码回报；脚本自带水位线增量、重叠锁与超时保护。
- **分析调度层**：Qoder 自动任务「医生站 Graylog 报错分析轮（wengyuan-prod）」，cron `7,37 * * * *`，Auto Approval，只驱动会话侧分析，不采集、不外发、不改任何调度任务。
- **分析层**：会话内按主 skill 步骤 1-3 读最新一轮；分析调度层代跑时**取材范围是 `config/pending-queue.json` 全量候选**（`pending` + `lastSeen` 前进的 `blocked`，每轮上限 4 条簇），**P0 先于 P1**，按 errorHash 跨轮回捞证据。报错簇定根因并给修正方案；慢请求簇按接口全限定名定归属、按 traceId 追全链路分解各阶段耗时，必须区分「数据量正常但代码有缺陷」与「数据量本身过大」。结论回填队列后用 `render-report.js` 按受影响轮次分别重渲染；缺证据的簇标 `blocked` 暂存，他组通知整理为 `analysis-outbox-<HHmm>.md` 待人工转发。
- **OS 调度（回退，非默认）**：`scripts/install-schedule.ps1` + `iMedicalxc-GraylogTriage-<env>`，当前 `wengyuan-prod` 为 Disabled，不参与调度；周期由 `config.schedule.intervalMinutes` 决定。分层设计、权限取舍、验证口径与运维见 `skills/imedicalxc-doctor-graylog-error-triage/references/notification-and-schedule.md`。

## 硬约束

1. 定时主体是 Qoder 自动任务（`qoder_cron`），采集与分析各一个，**不依赖 Windows 计划任务**；OS 任务仅作可选回退，启用时必须先 `disable` Qoder 采集轮，避免双调度。采集轮需 Full Access 才能跑 `run-triage.ps1`（Auto Approval 会拦），其 prompt 必须保持「单命令 + 退出码协议 + 禁止清单」的极窄形态。自动任务不得自行创建、修改、暂停任何调度任务（含自身），调度变更只能由人工发起。判定一轮是否真跑了只看日志 mtime / 产物文件 / state cursor 三项客观证据，`lastRunStatus: succeeded` 只代表会话完成，不代表流水线成功。
2. 连接信息单一事实源是 IDE 的 `mcp.json`（`mcpServers["graylog-<env>"].env`），脚本只读取，不复制、不落盘、不回显。
3. 凭据（Graylog token/cookie、QQ 令牌）一律走环境变量或 IDE mcp.json，禁止写入配置、报告、日志、记忆。
4. 外发内容必须脱敏：URL 主机名剥离为 `<host>`，禁止 IP、`Basic` 串、令牌变量名出现在群消息与文档。
5. 归属未确认的前缀不得塞进 self 白名单；先 `--calibrate` 取观测证据。
6. 远端写入、创建或改动 Qoder 自动任务、OS 计划任务注册（仅回退路径）、前端索引构建（约 6 分钟 / 300MB）均需用户明确授权。
7. 本插件不登记 canonical agent / workflow；改码阶段走既有 `standard-change`。
8. **P0 必须产出可执行方案**：不可预知程序异常给代码修改或异常处理方案，慢请求给耗时归因与优化方案。证据不足时标 `blocked` 并写明还缺什么证据，不得以「持续观察」搪塞。
9. **P1 不强行改码**：业务正常处理抛出的异常只说明触发条件与是否需要降噪。分析轮改判严重度必须写 `analysis.severityReason`，否则报告无法解释与脚本初判的差异。
10. **慢请求归属以接口全限定名为准**，不得只看打印进程名：`his-mediway-server` 是聚合进程，药房、ESB 等他组接口也由它打印，只看 app_name 会误判成本组。

## 依赖

| 依赖 | 类型 | 说明 |
|---|---|---|
| `mcp-graylog/index.js` | 仓库内共用 MCP 服务 | 会话通道；需含 `graylog_search_absolute` / `graylog_trace` / offset |
| `imedicalxc-doctor-codegraph` | availableDependencies | 前端链路索引与查询脚本，阶段 `frontend-penetration` |
| Node.js 18+ | 运行时 | 脚本使用 `node:` 前缀内置模块与 `Intl` |
| Python 3.8+ | 可选 | 仅前端穿透与索引构建需要 |

## 配置

- 主配置 `config/graylog-triage.json`（入库，不含凭据）
- 推送配置 `config/graylog-triage-push.json`（由模板复制，**不入库**）
- 运行态 `config/graylog-triage-state.json`、`config/push-state.json`、`config/pending-queue.json`、`config/.run.lock`（**不入库**）