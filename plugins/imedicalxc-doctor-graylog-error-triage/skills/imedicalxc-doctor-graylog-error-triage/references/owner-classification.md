# 归属判定口径

> 本文是 `config/graylog-triage.json` 与 `scripts/lib/owner-index.js` 的唯一对齐口径。
> 代码改了这里必须同步；这里改了也要回头核代码。改配置前先读第 2 节和第 7 节。

## 1. 五个桶

| 桶 | 配置键 | 判定含义 | 处理 |
|---|---|---|---|
| `self` | `ownerGroups.self` | 医生站 | 出根因与修正方案 |
| `infra` | `ownerGroups.infra` | 基础设施（public 公共仓） | 仅汇总，`infra.notify=false` 默认不推送 |
| `external` | `ownerGroups.external` | 他组产品组 | 生成 `notify-<组>-*.md` 并推送 |
| `unrelated` | — | 他组自身故障，本组未参与该 trace | 仅计数，不推送 |
| `unknown` | — | 无法判定 | 进 `pending-queue.json` 人工确认 |

**守恒不变式**：`self + infra + external（含提升）+ unrelated + unknown = 总簇数`。

任何改动都必须保住这一条。`notifyUnrelated` 把 `unrelated` 提升进通知桶时会 `fromUnrelated += 1`，就是为了不重复计数。改完跑一遍 `stats` 相加校验。

## 2. 配置在哪里

唯一位置：`config/graylog-triage.json` 的 `ownerGroups`（约第 77-172 行）。严重度初判规则在同文件 `severity` 段（第 58-62 行），慢请求查询与阈值在 `query.slowSelector` / `query.slowThresholdMs`（第 51-52 行）。

| 字段 | 行 | 作用 | 改错的后果 |
|---|---|---|---|
| `self.modules` | 80 | 模块码，生成包前缀 `com.mediway.his.{module}` | 新模块漏配 → 该模块报错全掉进待定 |
| `self.repos` | 81-94 | 自校准扫描的仓库路径 | 路径写错 → 扫不到，退回模板前缀 |
| `self.appPrefixes` | 96 | **参与归属判定**的应用名前缀 | 见第 7 节，慎动 |
| `self.appKeywords` | 95 | **只用于 `isSelfApp()`**（判 trace 里本组是否参与），不参与归属判定 | 删掉会让本组在他组故障里"免责"，事故级 |
| `self.packagePrefixTemplate` | 97 | 包前缀模板 | 改错会一次性废掉 14 个模块的帧识别 |
| `self.urlPrefixTemplate` | 98 | **死字段**，代码不读 | 改了不生效 |
| `infra.modules` | 103 | 同 `self.modules`，但前缀硬编码为 `com.mediway.his.{m}` | — |
| `infra.packagePrefixes` | 113-123 | 包前缀，`owner` 取最后一段 | — |
| `infra.appPrefixes` | 124 | 应用名前缀 | — |
| `infra.loggerPrefixes` | 125-127 | `{logger 前缀: 模块名}`，详见第 8 节 | 见第 8 节三个禁区 |
| `infra.urlPrefixes` | 128 | URL 首段白名单 | — |
| `external.appGroups` | 134-156 | `{产品组: [模块码]}`，同时生成 `com.mediway.his.{code}` 与 `com.mediway.{code}` | 新服务漏配 → 长驻待定 |
| `external.packagePrefixes` | 157-167 | 他组自有包前缀（护士站 `com.mediway.hos.nurm`；药房药库 `com.mediway.his.ph.{in\|ip\|op\|herb}`；电子签名 `com.mediway.his.ca`、`com.mediway.hos.ca`；体检 `com.mediway.his.hm`） | 不配会被 infra 的 `com.mediway.hos` 吞掉；**慢请求会退回 app-only 被算成本组**，见第 4 节 ⓪ |
| `external.notifyUnrelated` | 169 | 白名单组：即使判无关也出通知 | 不进则只在 summary 里计数 |

> `external.mappingSource`（第 133 行）是给人看的文档指针，程序不读。
> 行号会随配置增删漂移，以字段名为准；改完配置顺手核对本表。

## 3. 索引是怎么建的

`buildIndex()` 把「配置声明」和「工作区真实源码扫描」合并成四类索引：

**① 包前缀 `prefixes`**（决定帧归属）

| 来源 | 生成规则 |
|---|---|
| `self.modules` | `com.mediway.his.{module}`，若仓库扫到实测前缀则优先用实测 |
| `infra.modules` | `com.mediway.his.{module}`（硬编码，不走模板） |
| `infra.packagePrefixes` | 原样，`owner` = 最后一段（`com.mediway.his.server` → `server`） |
| `external.appGroups` | 每个 code 生成两条：`com.mediway.his.{code}`、`com.mediway.{code}` |
| `external.packagePrefixes` | 原样，`owner` = 最后一段 |

匹配规则：`类名 === prefix` 或 `类名.startsWith(prefix + '.')`，按前缀长度降序（最长匹配优先）。

**② 应用名前缀 `appPrefixes`**（决定 app 名归属）

来源依次累加：`self.appPrefixes` → `self.appKeywords` → `self.modules` → `infra.appPrefixes` → `infra.modules` → `external.appGroups` 的每个 code。

匹配规则：`name === prefix` 或 `name.startsWith(prefix + '-')`。加短横线是为了避免 `ma` 误命中 `mdm`。

**③ logger 前缀 `loggerPrefixes`**（只来自 `infra.loggerPrefixes`，kind 固定为 `infra`）

**④ URL 首段 `infraUrlPrefixes`**（只来自 `infra.urlPrefixes`）

**自校准扫描**：遍历 `self.repos` 与 `infra.repos`，找 `<repo>/<模块>/src/main/java/com/mediway/his/<包>/`。找到 `com/mediway/his` 就停止，不再看 `com/mediway`。深度上限 6 层、目录上限 5000、跳过 `target|node_modules|logs|dist|build|out|bin`。

**同包冲突处理**：同一个模块名在 self 仓和 infra 仓都扫到（如 `hisbase`），从双方移除并记入 `ambiguous`，该包下的帧一律判不出来。这是 `calibrate()` 返回 `ambiguous` 的来源。

## 4. 判定顺序（慢请求前置分支 + 五步短路，命中即停）

由 `owner-index.js` 的 `classify()` 实现，**不是"帧最强"而是 app 名优先**；慢请求例外，见 ⓪：

```
⓪ 慢请求（kind=slow 且有 interfaceClass）：按接口全限定名的包前缀定组
       ├ 前缀属他组 ┬ 打印进程是本组/基础设施/认不出 → external  (slow-interface-fqcn, high)
       │            └ 打印进程就是他组自己          → unrelated (slow-interface-fqcn, high)
       ├ 前缀属本组   → self   (slow-interface-fqcn, high, evidenceLevel=interface-fqcn)
       ├ 前缀属基础设施 → infra (slow-interface-fqcn, high)
       └ 前缀未登记   → 不返回，继续走下面五步（通常落到 app-name/low = app-only）
① trace 邻域：同一 traceId 下是否有他组应用报错
       ├ 本条自身就是他组 app 且本组未参与 → unrelated (trace-peer-app-name, medium)
       ├ URL 首段能解析出他组组名        → external  (trace-peer, high)
       └ 都解析不出                      → unknown   (trace-peer-unresolved, low)
② Feign：正文命中 FEIGN_HINT_RE，或异常类属于 feignExceptionTypes
       ├ 本条自身就是他组 app 且本组未参与 → unrelated (feign-app-name, medium)
       ├ URL 首段能解析出他组组名        → external  (feign-exception, high)
       └ 都解析不出                      → unknown   (feign-unresolved, low)
③ 应用名（app_name，缺失时退回 source）
       ├ 判为 self     → 进第 5 节六道降级
       ├ 判为 infra    → infra      (app-name, medium)
       └ 判为 external → unrelated  (app-self-error, medium)
④ 堆栈帧：从最内层向外找第一个能解析归属的帧（跳过 frameworkPrefixes）
       ├ self     → self     (business-frame,  medium)
       ├ infra    → infra    (business-frame,  medium)
       └ external → external (external-frame,  medium)
⑤ 都不命中 → unknown (undecided, low)
```

**为什么慢请求必须先看接口全限定名**：慢请求日志由框架 `LogFilter` 以 WARN 打印，**没有堆栈帧**，第 ④ 步永远空转；而 `his-mediway-server` 是聚合进程，会代他组模块应答（见第 7 节）。按 app 名判等于把他组接口的慢调用全算成本组。接口全限定名回答的正是"哪段代码在跑"，比打印进程名更准，所以它是慢请求的**直接证据**（`evidenceLevel=interface-fqcn`），而不是推断。

实测（24h 窗口 216 条达标慢请求）：两个 ESB 接口 `com.mediway.his.aggregation.*.recEsbInterface` 由 `his-mediway-server` 与 `hisct-mediway-server` 打印，按 ⓪ 正确归到临床数据中心；`com.mediway.his.ph.in.bs.controller.PhInRecController.handleAudit` 在登记药房药库包前缀前落到本组 `app-only`，登记后归到药房药库。

`FEIGN_HINT_RE` 只认 Feign/负载均衡的专属特征（`feign.FeignException`、`RetryableException`、`HystrixRuntimeException`、`Load balancer does not have available server`、`No instances available`）。`Connection refused`、`Read timed out` 这类通用网络错误**故意不认**，否则数据库连接失败会被误判成"调用外部接口失败"。

**为什么 app 名优先于堆栈帧**：`com.mediway.hos` / `his.server` / `his.base` 这些共享基础包几乎出现在所有应用的堆栈里。若以帧优先，全环境的框架层异常都会被吸进本组或基础设施。app 名回答"谁在报错"，帧回答"哪段代码抛的"——前者才是归属。

**`ownerModule` 有三种语义，看报告时要分清**：

| 场景 | `ownerModule` 取值 | 是否模块码 |
|---|---|---|
| `app-name` + high | 真实模块码（`opcare`） | 是 |
| `app-name` + low | 应用名本身（`his-mediway-server`） | **否** |
| infra 包前缀命中 | 包前缀最后一段（`com.mediway.his.server` → `server`） | 部分是 |

## 5. self 分支的六道降级

应用名判为 `self` 后，按顺序尝试"能不能排除掉"：

| 序 | 条件 | 结果 | rule | 置信度 |
|---|---|---|---|---|
| 1 | logger 名命中 `infra.loggerPrefixes` | infra | `logger-name` | medium |
| 2 | 无归属帧 且 URL 首段在 `infra.urlPrefixes` | infra | `self-app-infra-url` | medium |
| 3 | 首个可归属帧是 infra 包 | infra | `self-app-infra-frame` | high |
| 4 | 首个可归属帧是他组包 | external | `self-app-external-frame` | high |
| 5 | 无归属帧 且 URL 首段解析出他组组名 | unrelated | `self-app-url-module` | medium |
| 6 | 以上都不成立 | self | `app-name` | high（有本组帧）/ **low（无）** |

第 6 道是唯一的兜底出口。`low` 表示"只有应用名一条证据"，**它不是责任结论**——第 6 节就是为它设计的。

## 6. 证据等级（只对本组有意义）

> 本节口径依赖 `evidenceLevel` 改动落地。改动文件见第 12 节。改动前 `evidenceLevel` 字段不存在，渲染层用 `confidence` 反推。

`classify()` 在 self 的三个出口写 `evidenceLevel`：

| 等级 | 产生条件 | 含义 | 报告位置 |
|---|---|---|---|
| `module-frame` | 报错：`app-name` + high，或 `business-frame` | 堆栈命中 `com.mediway.his.{本组模块}`，本组代码在场 | `report-self` 第一段 |
| `app-only` | `app-name` + low | 只有 `app_name`，堆栈无本组帧：**推断，不构成本组缺陷证据** | `report-self` 第二段（报错）/ 第三段（慢请求） |
| `interface-fqcn` | 慢请求：`slow-interface-fqcn` 且前缀属本组 | 接口全限定名命中本组包前缀。慢请求无堆栈，这就是"哪段代码在跑"的直接证据 | `report-self` 第三段 |

**簇级定级规则：强证据优先，不取多数。**

只要簇里有 1 条 `module-frame`，整簇升级为 `module-frame`。因为 `app-only` 的本质是**缺证据**，缺证据的多数不能覆盖有证据的少数。同时记 `evidenceLevelMixed` 与 `evidenceLevelCounts`，报告里显示成 `module-frame×3 / app-only×116`。慢请求簇同理：有 1 条 `interface-fqcn` 就整簇定为 `interface-fqcn`，混有 `app-only` 时记 `evidenceLevelMixed`。

这个混合标记比整簇总量更有价值：它说明同一异常有时能采到本组帧、有时采不到，那几条带帧的样本就是根因入口。

**其它桶不带该字段。** 老 `classified-*.json` 没有它时，渲染层用 `confidence === 'high' ? module-frame : app-only` 反推，历史文件可直接重渲染。

**`stats` 里的拆分**：`selfModuleFrame + selfAppOnly + selfSlow === self`，五桶守恒不受影响。

> 注意 `selfSlow` 按 **`kind=slow`** 计，不按证据等级计：接口前缀未登记而退回 `app-only` 的慢请求仍计入 `selfSlow`，**不计入 `selfAppOnly`**（后者只统计报错）。所以「全部仅应用名推断」的判断要用 `selfAppOnly == 报错簇数`，不是 `== self`。

## 7. 聚合进程陷阱（`his-mediway-server`）

这是本插件最容易搞错的一处，风险方向与直觉相反：

- **不是**"只看 app_name 会把基础设施误判成本组"那种偶发误判
- **而是**所有模块都部署在 `his-mediway-server` 这**一个进程**里，它的每一条日志都带这个 app_name。若让 app_name 直接决定归属，等于把所有日志的默认归属都设成本组

实测：某轮 491 条日志中，本组桶 3 簇 119 条**全部**是 `app-name/low`，其中 116 条是 Kingbase 连接被 `administrator command` 终止——与医生站代码无关。

**所以要分清两个用途**：

| 用途 | 依赖 | 结论 |
|---|---|---|
| 判定「这条日志归谁」 | `self.appPrefixes` | 不宜包含纯进程名 |
| 判定「这个 trace 本组有没有参与」 | `self.appKeywords` → `isSelfApp()` | **必须**包含，否则本组在他组故障里被免责 |

`isSelfApp()` 用的是 `name === k || startsWith(k + '-') || includes(k)`，比 `ownerFromAppName()` 的 `startsWith(prefix + '-')` 更宽松。这个差异是有意为之：判参与时宁可宽松（宁可多认一次参与），判归属时必须严格。

## 8. logger 判据的适用边界

`ownerFromLogger()` 解析 logback 单行格式：

```text
2026-11-20 14:07:06,101 - <traceId> [http-nio-8081-exec-52] ERROR <logger> - <message>
```

**生效范围极窄**：只在「应用名已判为 self」的第 1 道降级里被读。app 名认不出来时它**不生效**。

**三个必须知道的坑**：

1. **logback 的 `%logger{36}` 会缩写**，同一个类随全名长度出现多种写法：

   | 全名 | 缩写后 |
   |---|---|
   | `com.mediway.his.server.advise.HisBusinessInterceptor` | `c.m.h.s.a.HisBusinessInterceptor` |
   | `com.mediway.his.hisbasesv.bsp.icon.comp.LinkUrlRpc` | `c.m.h.h.bsp.icon.comp.LinkUrlRpc` |
   | `com.mediway.his.hisbasesv.bsp.icon.service.impl.HisIconServiceImpl` | `c.m.h.h.b.i.s.i.HisIconServiceImpl` |

   而 `ownerFromLogger()` 是**纯字符串前缀匹配**，没有缩写归一化。所以配置 `c.m.h.h.b.` 只覆盖"砍得更狠"那一档，`c.m.h.h.bsp.` 这种漏掉。要覆盖就得每种缩写写一条——**不建议这么做**，缩写组合会爆炸。

2. **三个禁区**，加进去会出事：

   | logger | 为什么不能加 |
   |---|---|
   | `c.m.h.s.a.HisBusinessInterceptor` / `com.mediway.his.server.advise.HisBusinessInterceptor` | 全局 `@Around` 兜底拦截器，**所有**本组业务异常都经它打 ERROR。加了等于一键清空 self 桶 |
   | `druid.sql.Statement` | 打的是"SQL 执行失败"，成因既可能是 DB 侧也可能是本组 SQL 写错。加进 infra 会让本组真实 SQL 缺陷隐身 |
   | `c.m.h.cache.aspect.HOSCachingAspect` | 属本组 `com.mediway.his.cache`，用 ERROR 打调试日志是本组代码缺陷，**本来就该留在 self** |

3. **logger 判据不是解决"self 桶沉积 DB 噪音"的正确工具**。那类簇的堆栈里有 `com.kingbase8.*` / `com.alibaba.druid.*` 帧，只因 `classify.maxFullMessageChars = 4000` 把更内层的 `com.mediway.his.server.filter.*` 截掉了。正解是让抽帧发生在截断之前，而不是加 logger 前缀。

## 9. 分桶与混合簇

`groupClusters()` 按 `ownerKind` 落桶：

- `external` 按 `ownerGroup` 拆成多个通知桶
- `unrelated` 且 `ownerGroup ∈ notifyUnrelated` → 提升进通知桶并 `fromUnrelated += 1`
- 同一 `errorHash` 簇内出现多种归属 → `mixed=true`，按出现次数取多数，`mixedOwners` 记录分布，控制台打 `[WARN]`

`errorHash = sha1(异常类 | 首个本组帧 | 消息模板)[:16]`，**不含 traceId**（否则每次 occurrence 各自成簇，`count` 恒为 1）。行级去重用 Graylog 消息 `_id`。

消息模板会把数字、引号串、UUID、时间戳、十六进制归一化成占位符，所以同一异常的不同参数值能聚到一簇。

**慢请求另用一套键**：`errorHash = sha1('slow|' + 接口全限定名)[:16]`（`deriveSlowKey`）。**耗时绝不进 hash**——否则同一接口每次不同耗时各自成簇，既看不出重复也统计不出最大/平均。慢请求簇带 `kind='slow'`、`interfaceName`、`interfaceClass`、`durationMaxMs`、`durationAvgMs`、`slowestTraceId`、`slowestTimestamp`，不带 `exceptionClass` 与堆栈字段；报错簇反过来不带这些慢请求字段（schema 收紧，渲染层据此分流）。

两类日志合并后走**同一套** `groupClusters()` 与五桶守恒，`stats` 另给 `errorItems` / `slowItems` / `slowClusters` / `selfSlow` 便于核对。

## 10. 待定过多的处理

待定占比超过 30% 时，先看观测证据再改配置：

```powershell
node .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\classify-owner.js --env <env> --calibrate
```

`--env` 填环境 ID（如 `wengyuan-prod`），缺省用 `defaultEnv`。**不要写死 `87`。**

重点看 `calibrate()` 返回的四个 diff：

| 字段 | 含义 | 处理 |
|---|---|---|
| `declaredSelfMissing` | 配置声明了但仓库里没扫到 | 检查 `self.repos` 路径 |
| `observedSelfUndeclared` | 仓库里扫到但配置没声明 | 补 `self.modules` |
| `declaredInfraMissing` / `observedInfraUndeclared` | 同上，infra 侧 | 同上 |
| `ambiguous` | self 与 infra 仓库同时出现该包 | **已被排除出双方**，需人工定归属 |

补完配置回放验证待定归零：

```powershell
node .agents\plugins\imedicalxc-doctor-graylog-error-triage\scripts\classify-owner.js --env <env> --file "docs\agent-reports\graylog-triage\<env>\<日期>\raw-errors-<HHMM>.json"
```

参数是 `--file`，**不是 `--raw`**；写错会被静默忽略并读取目录里最新的 raw 文件。

`verify-install.js` 的硬校验（会 FAIL）：

- `self.modules` 与 `infra.modules` 出现同名模块
- `external.appGroups` 缺失

历史案例：`mrfs-mediway-server`（病案归档）曾漏配，导致 3 个簇长驻待定；现已包含在 `"病案": ["mrdia", "mrqc", "mrfs"]`。

## 11. 无关 ≠ 没问题

判「无关」的条件是本组**未参与该 trace**。这类簇里的真实 bug 不会进 notify，需要人工在 `report-summary` 里扫一眼「无关簇按疑似归属」那行。

历史上的病案组 Kingbase `RETURNING` 语法错误就是这样被漏掉的——它当时落在无关桶里，因为报错进程是他组的，但 SQL 语法问题的性质与归属无关，仍值得回头看一眼。

## 12. 改配置前的检查清单

1. **先有观测证据**：跑 `--calibrate` 或看待定簇的 `appNames`，不凭"看起来像医生的"就塞进 `self.modules`
2. **分清两个字段**：影响"归属"的改 `self.appPrefixes`；影响"是否参与"的改 `self.appKeywords`。两者不要互相替用
3. **不要往 `infra.packagePrefixes` 加 `com.kingbase8` / `com.alibaba.druid`**：会把本组 SQL 约束冲突、慢查询一并算成基础设施，掩盖真实缺陷。同理 **`com.mediway.his.api`（共享异常/DTO）与 `com.mediway.his.seriallock`（共享分布式锁）也不要登记**：它们出现在几乎所有应用的栈里，登记后 `firstOwnedFrame` 会停在共享工具帧，掩盖外层真实业务归属；保持未登记才会继续向外找 `com.mediway.his.<模块>`
4. **不要往 `loggerPrefixes` 加兜底拦截器**：见第 8 节三个禁区
5. **改完必须回放**：用 `--file` 指向历史 raw，确认五桶相加等于总簇数、`selfModuleFrame + selfAppOnly + selfSlow === self`、`p0 + p1 === 总簇数`（旧版 classified 无 severity 时除外）、`originSelf + originSelfCallsExternal + originExternal + originInfra + originUnknown === 总簇数`
6. **同步文档**：改动了判定口径就回来改本文对应小节

配套改动文件（`evidenceLevel` 分区 + 慢请求/严重度）：

- `scripts/lib/log-parse.js`：`parseSlow` 解析接口全限定名与耗时毫秒数，`deriveSlowKey` 生成慢请求聚簇键，`normalizeMessage` 透出 `loggerName`（业务异常判据要用）
- `scripts/lib/owner-index.js`：`makeResult` 透传 `evidenceLevel` 并按 `originOf()` 输出 `origin`；`app-name` 与 `business-frame` 两个出口打标；`classify()` 开头新增 `slow-interface-fqcn` 前置分支
- `scripts/classify-owner.js`：簇级按"强证据优先"定级（含 `interface-fqcn`），记 `evidenceLevelMixed`；簇级来源聚合（self 一票否决 + 多数）并记 `originCounts` / `originMixed`；`stats` 拆出 `selfModuleFrame` / `selfAppOnly` / `selfSlow` 与 `originSelf` / `originSelfCallsExternal` / `originExternal` / `originInfra` / `originUnknown` / `originMixed`；按 `severity` 配置做 P0/P1 初判；队列只刷新观测值，跨组报错入队
- `scripts/render-report.js`：`renderSelf` 分三段 + 开头「P0 优先处理清单」+ 文末「本组调用他组失败」附录，`renderCluster` 增加「类型 / 严重度 / 严重度依据 / 归属判定 / 来源 / 证据等级」行与慢请求耗时指标，`renderSummary` 拆本组统计行并加「严重度分布」「来源分布」「慢请求 Top」，他组通知不渲染分析结论

## 13. 严重度初判与改判

严重度与归属是**两个正交维度**：归属回答"谁的问题"，严重度回答"要多急着处理、必须产出什么"。五个桶里的簇都带 severity。

**初判规则**（`classify-owner.js`，按簇判定，不是按条）：

| 条件 | severity | severityBasis |
|---|---|---|
| `kind === 'slow'` | **P0** | 接口耗时超过阈值（附最大耗时与次数） |
| 报错簇 `businessCount === count` | **P1** | 业务正常处理抛出的异常 |
| 报错簇其余情况 | **P0** | 不可预知的程序异常；`businessCount > 0` 时标 `severityMixed` 并写明混合比例 |

**业务异常信号**（`config.severity`，三者命中任一即算该条为业务异常）：

| 配置键 | 默认值 | 判据 |
|---|---|---|
| `businessLoggers` | `com.mediway.his.server.advise.HisBusinessInterceptor` | `loggerName` 全等匹配 |
| `businessMessagePrefixes` | `业务异常(` | 消息**首行**以此开头 |
| `businessExceptionClasses` | `HisBusinessException`、`BaseBusinessException`、`BusinessException` | 异常类**简名**匹配（去包名） |

> 这里用 logger 全等匹配是安全的：第 8 节禁止的是把它加进 `infra.loggerPrefixes`（那会改变**归属**、清空 self 桶）；此处只影响**严重度**，簇仍留在 self。
> 混合簇保守取 P0：宁可多分析一簇业务提示，也不能让程序缺陷藏在多数业务异常里被降级。

**已知的保守偏差**：配置/数据前提缺失类 ERROR（如「没有关联扩展数据，请注意！」「没有关联的厂家模块代码」）没有异常类、也不经业务拦截器，初判会落到 P0。分析轮确认属业务提示后用 `analysis.severity` 改判 P1。

**改判口径**：分析轮在队列条目写 `analysis.severity`（`P0`/`P1`）+ `analysis.severityReason`。渲染层 `severityOf()` 以 `analysis.severity` 优先，其次簇的初判，旧版 classified 两者都无时显示「未初判」而**不是默认 P0**。改判后严重度分布表、P0 优先处理清单、簇标题徽标、方案段占位提示全部同步。

**队列字段边界**：采集侧每轮刷新 `kind`、`severity`（初判）、`origin`、`ownerGroup`、`count`、`firstSeen/lastSeen`，慢请求另刷 `interfaceName`、`durationMaxMs`；**`status` 与 `analysis` 属分析轮结论，采集侧绝不覆盖**。入队范围见第 14 节：`self` 与 `unknown` 全部入队，另加非慢请求的 `self-calls-external` 跨组报错；他组自身（`external`）/基础设施/无关簇不入队。

## 14. 来源 origin：本组自身 vs 本组调用他组

`ownerKind` 回答"谁该处理"，`origin` 回答"异常源自哪一侧"，两者正交。每条分类结果与每个簇都带 `origin`，采集轮写进 `classified-*.json` 与 `pending-queue.json`，分析轮据此决定方案落点。

| origin | 含义 | 分析要求 |
|---|---|---|
| `self` | 本组代码/配置/数据自身产生 | 正常出根因 + 修正方案 |
| `self-calls-external` | 本组进程发起调用的他组接口/方法失败 | 写明被调方与原始错误，本组只给容错/降级/提示优化 |
| `external` | 他组自身故障，本组未参与 | 只通知，不进本组队列 |
| `infra` | 基础设施组件 | 只落 infra 报告，不推送 |
| `unknown` | 证据不足 | 进队列待定，写明缺什么证据 |

**逐条判定**（`owner-index.js` `originOf()`，只看规则与 `evidence.selfAffected`，不看 `ownerKind` 单一字段）：

| ownerKind | rule | origin |
|---|---|---|
| self | 任意 | `self` |
| infra | 任意 | `infra` |
| unrelated | 任意 | `external` |
| external | `self-app-external-frame` / `feign-exception` / `feign-unresolved` | `self-calls-external` |
| external | `slow-interface-fqcn` / `trace-peer` / `external-frame` 且 `selfAffected` | `self-calls-external` |
| external | 其余 | `external` |
| unknown | `selfAffected` 为真 | `self-calls-external` |
| unknown | 其余 | `unknown` |

这张表解释了几个反直觉的出口：`ownerKind=external` 但 `rule=self-app-external-frame` 的簇责任在被调方、来源是本组调用链；`trace-peer` 只有 `selfAffected`（trace 里存在本组应用）才算本组发起，否则与他组自身故障同性质。

**簇级聚合**（`classify-owner.js`）：`self` 一票否决（本组缺陷不能被多数掩盖），其余按出现次数取多数；票数相同按 `ORIGIN_PRIORITY = ['self-calls-external','infra','unknown','external']` 取舍。混合簇记 `originCounts` 并置 `originMixed=true`，渲染层在「来源」行后附分布，**不得把少数跨组条目当成整簇性质**。

**入队范围**（`mergePendingQueue`）：`ownerKind` 为 `self` / `unknown` 的全部入队；另外**非慢请求**、`origin ∈ {self-calls-external, self}` 的跨组报错入队。跨组慢请求不进本组队列——优化责任在被调方，只走通知。

**已知盲区**：

- `selfAffected` 只认 `self.appKeywords`（默认 `his-mediway-server`），`opcare-mediway-server` 这类**不**算本组参与。若某环境本组应用名不在 `appKeywords` 里，`trace-peer` 的跨组判定会退化成 `external`。
- 跨组条目的 `ownerGroup` 来自接口包前缀/URL 模块名解析，解析不出时为空，此时该条只能落 `unknown` 而非 `self-calls-external`。
- 旧版 `classified-*.json` 没有 `origin` 字段，渲染层显示「未标注（旧版分类结果，重跑 classify-owner.js 可得）」，不要当成 `self`。