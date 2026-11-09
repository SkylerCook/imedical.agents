---
name: imedicalxc-doctor-commit-report
description: |
  HIS 医生站信创产品迭代周报。采集 src/ 下 20 个子仓库在指定时间窗内 11 位医生站同事的 git 提交，输出五要素汇总（岗位工作站 / 需求类型 / 优先级 / 提交人 / 改造内容总结），评估前经 codegraph 调用图批量取证（改动方法 → 入口 / 工作区调用方 / 外部 Maven 调用方 / 下游 Feign → 前端界面 / 操作元素 / 菜单访问位置，结构化 JSON），再对【流程修改 / 业务调整】类提交做混合式评估（轻量全覆盖 + 高风险三类自动升级深度评估，1-5 星评级，1-2★ 必须给出至少一条具体问题评价，测试建议四段式且标注界面、访问位置、操作步骤并可追溯到证据），并自动检测数据库脚本执行提醒（PO 数据结构修改 / 新增系统标准配置 / 新增系统标准提醒 / 新增代码表缓存配置），归档 Markdown 报告，将 1-2★ 低星问题经 tencent_docs MCP 登记到《信创版产品迭代每周问题登记》（多个独立问题的提交按问题拆行），并按配置尝试推送。用于周度定时汇总或按需汇总提交记录。
triggers:
  - 提交汇总
  - 提交记录汇总
  - 月度提交报告
  - 提交报告
  - 汇总提交记录
  - 信创产品迭代周报
  - 迭代周报
role: workflow
scope: local
priority: high
---

# 医生站信创产品迭代周报 — 工作流

七步串行执行：① 采集 → ② 数据库变更检测 → ③ 分类 → ③.5 代码影响取证（codegraph 批量检索：后端调用图 + 前端界面 / 菜单访问位置，输出结构化证据） → ④ 评估（基于证据 + diff） → ⑤ 归档 → ⑥ 低星问题登记 → ⑦ 推送。每步完成后再进入下一步。定时模式在 ⑦ 之后追加步骤 ⑧（回写 state）。

**开始前必读**：`.agents/plugins/imedicalxc-doctor-commit-report/config/commit-report.json` —— 人员白名单（reporters）、岗位工作站清单（workstations）、时间窗（window）、输出目录（outputDir）、采集源（ref）。

## 执行模式

| 模式 | 触发 | 时间窗 | 期号 label | 结束动作 |
|---|---|---|---|---|
| 交互模式（默认） | 用户按技能名 / 关键词触发 | config `window`（默认近 1 个完整自然月），或用户显式指定的 since / until | `YYYY-MM`（until 所在月） | 不写 state |
| 定时模式 | 自动化提示词声明「定时模式」 | `since` = `commit-report-state.json` 的 `lastWindow.until`；`until` = 当前时间（精确到分钟） | `YYYY-MM-W<N>` | 执行步骤 ⑧ 回写 state |

两种模式的差异仅限时间窗、期号与 state 回写；步骤 ①~⑦ 完全相同。

定时模式补充规则：

- **期号**：`N` = `docs/agents/commit-reports/<YYYY-MM>/` 下已有 `commit-report-*.md` 数量 + 1（历史期次不追溯，11 月起从 W1 计）；产物目录按月取 `until` 所在月。
- **窗口衔接**：`since` 必须衔接上一期 `until`，不重叠、不留空。state 不存在或 `lastWindow.until` 为空时回退交互模式（该月尚无归档时自然记为 `W1`）。
- **幂等**：失败重跑前先确认上一期报告是否已完整归档；已归档则从 state 的 `until` 继续，不重复生成。
- **采集源**：取 config `ref`（默认 `origin/master`），由 `collect-commits.js` 读取，命令中不硬编码分支。
- **期号传递**：用 `collect-commits.js --label <label>` 指定期号，`raw-commits` / `db-changes` / `classification` / `evaluations` / `issue-rows` / `commit-report` / `db-change-email` 必须使用同一 label。

## 步骤 ①：采集（确定性脚本）

交互模式时间窗默认近 1 个完整自然月：

```bash
node .agents/plugins/imedicalxc-doctor-commit-report/scripts/collect-commits.js --months 1
```

自定义窗口（尽量对齐自然月）：`--since 2026-09-01 --until 2026-10-01`。

定时模式按「执行模式」的增量窗口采集，并显式指定期号：

```bash
node .agents/plugins/imedicalxc-doctor-commit-report/scripts/collect-commits.js --since <上一期 until> --until <当前时间-ISO> --label <YYYY-MM-W<N>>
```

产出 `<outputDir>/<label>/raw-commits-<label>.json`，每条提交含 repo / hash / author（映射后中文名）/ authorRaw / date / subject / files / additions / deletions。检查 `meta.errors`：非空时先向用户报告错误仓库（错误不阻断整体），再继续。

> 提交人邮箱属个人信息，不入库；需邮箱匹配时从环境变量 `COMMIT_REPORT_REPORTER_EMAILS`（JSON：`{"姓名":["邮箱",...]}`）补充。缺失时脚本打印维护位置提示，仅按姓名/别名匹配（不阻断）。

## 步骤 ②：数据库变更检测（确定性脚本）

对步骤 ① 的产出做数据库脚本执行提醒检测：

```bash
node .agents/plugins/imedicalxc-doctor-commit-report/scripts/detect-db-changes.js <outputDir>/<label>/raw-commits-<label>.json
```

产出同目录 `db-changes-<label>.json`，检测结果（章节五的数据源，评估阶段可直接引用，不必重查 git）：

| 键 | 含义 | 检测方式 |
|---|---|---|
| poChanges | 数据结构修改 | `*PO.java` 文件新增/删除 `@TableField` 字段或 `@TableName` |
| newStCodes | 新增配置大类 | 新增 `String xxxST_CODE = "..."` 常量声明 |
| configItems | 新增系统标准配置 | docconfig 模块 `*ConfigConstants.java` 新增配置读取方法，或以 ST_CODE 字面量直接构造 ConfigItemUtil |
| reminders | 新增系统标准提醒 | `HisBusinessException.build/rpcException(XxxConstants.BUSINESS_CODE + "NNN", ...)`（字典表标准提醒；硬编码错误码不计入） |
| cacheConfigs | 新增代码表缓存配置 | 新增 `DocCacheUtils.getByKey/batchByXXX(XxxPO.class, ...)` 调用**且该 PO 首次使用**（缓存按 PO 维护，同 PO 其他方法共享既有配置）；记录含 PO 的 `@TableName` 表名（缓存配置按表名维护） |
| cacheReuses | 既有缓存复用（存档） | 窗口内 DocCacheUtils 调用但 PO 已有历史用法——**不列入提醒**，仅存档备查（同样含 `@TableName` 表名） |

检查 `meta.errors`（错误不阻断整体）与控制台摘要，然后继续。

## 步骤 ③：分类（五要素，逐条）

对 JSON 中每条提交判定。依据：subject + files 路径为主，必要时 `git -C <repo> show <hash> --stat`。

| 字段 | 规则 |
|---|---|
| 岗位工作站 | 从 config `workstations` 清单中选一项，**以改动文件路径为主、仓库为辅**判定；匹配不到填"其他"。subject 明确含 `[信创门急诊应急系统]`（含需求 7397288 / 7506927 / 7550860）时优先归入「门急诊应急医师工作站」，不按仓库回退到门诊医生站或基础平台 |
| 需求类型 | BUG修复（修缺陷）/ 新功能提交（新增功能点）/ 流程修改（改变原有交互或操作走向）/ 业务调整（调整业务规则、数据口径） |
| 优先级 | P0 全院阻断或数据错误；P1 核心流程不可用；P2 功能缺陷但有绕行方案；P3 体验优化 / 边缘场景 |
| 提交人 | 采集结果的 author 字段（中文名） |
| 改造内容总结 | 1-3 句：做了什么 + 改了哪里 |
| 涉及功能范围 | 结合 diff 与文件路径，判定本次变更涉及的**具体功能点**（如「住院医嘱模板开立界面布局」「出院时间取值逻辑」「门诊排班停诊自动取消预约」）。应聚焦于**实际改动点**，避免笼统归入大功能模块（如仅改布局不应写「医嘱录入全流程」）。此字段供步骤 ④ 生成测试方式建议的依据 |

工作站判定对照（同步维护于 config `workstations`）：

| 工作站 | 归属仓库 | 前端目录（hisfront static/） |
|---|---|---|
| 门诊医生站 | opcare-mediway-boot | opcare |
| 住院医生站 | ipcare-mediway-boot | ipcare |
| 电子医嘱 | comoe-mediway、cfoe-mediway | comoe |
| 电子诊断 | commr-mediway、cfmr-mediway | opcare/mrdia、ipcare/mrdia |
| 治疗工作站 | curc-mediway-boot | curc |
| 门诊挂号与排班 | opreg-mediway-boot | opreg |
| 分诊与资源分配 | opalloc-mediway-boot | opalloc |
| 患者管理 | hispa-mediway-boot | hispa |
| 抗菌药物管理 | ma-mediway-boot（ma-ant） | ma |
| 临床试验药理 | ma-mediway-boot（tr-pilot） | tr-pilot |
| 模块化医生站 | —（前端为主） | doctor |
| 综合诊疗服务 | aggcare-mediway-boot | — |
| 基础平台 | his、hisbase、hiscore、hiscf/hiscfsv、hisct/hisctsv 等 public 层 | base、hiscf、cf、ct |
| 门急诊应急医师工作站 | opcare 应急初始化接口、hiscore/hisctsv 号别对照查询（需求 7397288 / 7506927 / 7550860） | 应急系统前端不在本工作区 |
| 其他 | 兜底项：无法归入以上任何一项 | — |

工作站与功能模组对照（数据来源：`config/it-shape-mapping.json` → `moduleToWorkstation`）：

| 工作站 | 所属系统 | 功能模组 |
|---|---|---|
| 门诊医生站 → 门诊诊疗医师工作站 | 门诊诊疗信息系统 | 门诊诊疗医师预约、住院预约、门诊患者列表、门诊转诊、就诊登记、患者退费、完成接诊、总览&打印、草药录入、**医嘱录入**、**病历文书**、**诊断录入**、**检验检查申请**、治疗、会诊、过敏记录、检查报告、检验报告、危急值查询、公共卫生事件、病情总览、临床路径、不良事件管理、常用维护、统计查询、门诊诊疗医师首页 |
| 住院医生站 → 住院诊疗医师工作站 | 住院诊疗信息系统 | 住院预约、草药录入、**医嘱录入**、**病历文书**、**诊断录入**、**检验检查申请**、治疗、会诊、过敏记录、检查报告、检验报告、危急值查询、公共卫生事件、病情总览、信息总览、住院患者列表、住院床位图、临床路径、住院处方打印、诊疗计划、VTE辅助评估、手术治疗、输血治疗、患者出入转、病历管理、不良事件管理、单病种管理、院感管理、常用维护、统计查询、住院诊疗医师首页 |
| 电子医嘱 | （跨门诊/住院） | 医嘱录入（门诊+住院共用模组） |
| 电子诊断 | （跨门诊/住院） | 诊断录入（门诊+住院共用模组） |
| 治疗工作站 → 康复治疗科室工作站 | 康复治疗系统 | 治疗申请、治疗分诊、治疗预约、治疗执行、治疗处理、治疗站查询统计 |
| 门诊挂号与排班 → 注册挂号工作站 | 门诊服务信息系统（注册挂号） | 注册挂号首页、门诊注册建卡、卡管理、排班维护、门诊预约、门诊挂号、预约登记查询统计 |
| 分诊与资源分配 → 门诊分诊工作站 | 门诊分诊系统 | 分诊、分诊挂号、分诊统计查询 |
| 临床试验药理 → 临床试验工作站 | 临床试验管理系统 | 药物临床试验管理、药物临床试验筛选及预警、临床受试者管理、临床药理项目管理、临床科研SAE、临床试验受试者登记 |
| 患者管理 | — | （患者主索引，无独立功能模组列表） |
| 抗菌药物管理 | — | （ma-ant 子模块，无独立功能模组列表） |
| 模块化医生站 | — | （前端集成模块，无独立功能模组列表） |
| 综合诊疗服务 | — | （聚合服务层，无独立功能模组列表） |
| 基础平台 → 诊疗配置工作站 | 门诊/住院诊疗信息系统 | 基本设置、接收科室相关设置、科室功能设置、处方设置、医嘱/药学项设置、绑定医嘱设置、用法设置、诊断设置、数据处理、代码表维护与扩展、日志管理、项目化配置、安全组功能授权、组件配置、医生交班本、接口管理、检查医嘱配置 |

> **说明**：「电子医嘱」「电子诊断」为跨门诊/住院的共用模组，前端有独立界面但后端分属 opcare/ipcare。「→」表示 SKILL 工作站名到 IT形态汇总 正式名称的映射。加粗模组名为邮件影响表中 `determineModule()` 关键词匹配的模组。

**落盘分类检查点**：逐条判定完成后写出同目录 `classification-<label>.json`，结构 `{ commits: [...] }`；数组顺序与 `raw-commits-<label>.json` 完全一致，哈希与采集结果一一对应。每条字段：

| 字段 | 说明 |
|---|---|
| `hash` / `repo` / `author` / `date` / `subject` | 原样继承采集结果，不得改写（用于与 raw-commits 对账） |
| `workstation` | 岗位工作站（上表取值） |
| `reqType` | 需求类型 |
| `priority` | 优先级 |
| `summary` | 改造内容总结 |
| `funcPoint` | 涉及功能范围（具体功能点） |

该文件是步骤 ⑤ 渲染第一、二章的唯一数据源：提交总数、四类分布、提交明细均从中读取，不再依赖对话上下文。判定过程中如触发上下文压缩，以本文件为事实来源继续后续步骤；后续步骤不得再用「记忆里的分类」覆盖文件内容。

## 步骤 ③.5：代码影响取证（确定性脚本）

把步骤 ① 的提交清单交给 codegraph 批量取证，产出结构化证据。**本步骤只产出证据，不做业务判断**（谁影响谁、风险高低由步骤 ④ 基于证据分析）。分两条命令：先做后端调用图取证，再把入口落到前端界面与菜单访问位置。

先做后端取证：

```bash
python .agents/plugins/imedicalxc-doctor-codegraph/scripts/query_commit_impact.py \
  <outputDir>/<label>/raw-commits-<label>.json --label <label>
```

产出同目录 `code-impact-<label>.json`。参数默认值取自 config `codegraph`（`maxMethodsPerCommit`、`depth`），需要临时调整时再用 `--max-methods-per-commit` / `--depth` / `--no-maven` 覆盖；`enabled=false` 时整步跳过。对应 codegraph-search 的「查询 7：提交级批量取证」。

再把入口落到界面：

```bash
python .agents/plugins/imedicalxc-doctor-codegraph/scripts/query_front_back_chain.py commit-impact \
  <outputDir>/<label>/code-impact-<label>.json --label <label>
```

产出同目录 `front-chains-<label>.json`，对应 codegraph-search 的「查询 8.1：提交级入口 → 界面 → 菜单访问位置」。它消费 `entrypoints`，向前端链路库反查「页面 → 元素 → 请求 → Controller」，再用 `docs/knowledge/前端界面入口登记/界面入口登记表.md` 补充父菜单路径与授权安全组；页面本身未登记时沿 `page_links` 上溯父页面。

- 后端前置数据：`docs/agents/imedicalxc-doctor-codegraph/impact_db.json` + `penetration_db.json` + `feign_interfaces.json`
- 前端前置数据：`docs/agents/imedicalxc-doctor-front-codegraph/front_chain_db.json` + 前端入口登记表
- 后端索引缺失时先执行 `imedicalxc-doctor-codegraph-gen`；前端链路库缺失时先执行 `imedicalxc-doctor-codegraph-front-gen`
- 仍缺失 → 告警并跳过对应命令，步骤 ④ 统一写「无调用图证据（索引缺失）」或「无界面证据（链路库缺失）」，**不阻断**

**证据结构**（提交级聚合，方法级明细并列；一个提交改多个方法不会拆成多份结论）：

| 字段 | 含义 |
|---|---|
| `commits[].methods[]` | 改动方法定位：`classMethod` / `file` / `changedLines` |
| `commits[].entrypoints[]` | 入口端点：`controller` / `service` / `feign` / `http` / `depth` / `heuristic` / `via`；契约类型经 Feign 调用方上溯得到的入口另带 `indirect=true`（`via` 以 `feign:<接口>.<方法>` 开头） |
| `commits[].workspaceCallers[]` | 工作区经 Feign 的调用方：`service` / `module` / `caller` / `sameService` / `via` |
| `commits[].externalCallers[]` | Maven 外部调用方：`service` / `module` / `caller` / `controller` / `path` / `via` |
| `commits[].downstreamFeigns[]` | 本方法跨出的 Feign 调用：`feign` / `method` / `caller` / `via` |
| `commits[].contract` | `feignInterfaces`（方法级入口 + 类型签名命中的 Feign 接口）+ `typeFiles`（DTO/VO/PO 契约文件）+ `typeFeignMatches`（类型 → Feign 方法签名明细：`type` / `typeFqn` / `feign` / `method` / `http` / `usage` / `service` / `file`）+ `typeFeignCallers`（Feign 契约方法 → 工作区调用方方法：`caller` / `service` / `types` / `feigns` / `entrypoints`）+ `typeControllerMatches`（类型 → Controller 方法签名明细：`type` / `typeFqn` / `controller` / `controllerFqn` / `method` / `http` / `usage` / `file`） |
| `commits[].downstream` | `count` / `services`：入口可达工作区方法数，**仅作规模参考，不等于回归范围** |
| `commits[].skippedFiles[]` | 未入图原因：frontend / type_contract / public_layer / not_in_graph / no_method_change / resource / parse_failed / binary / repo_unavailable / commit_unavailable |
| `commits[].confidence` | `graph`（有方法级证据）/ `partial`（仅契约文件）/ `none` |
| `commits[].indexFresh` | 索引构建时间是否晚于提交时间 |

`front-chains-<label>.json` 的界面证据（与 `code-impact` 按 hash 对齐）：

| 字段 | 含义 |
|---|---|
| `commits[].uiEntries[]` | 界面证据：`page`（HTML 路径）/ `pageTitle` / `module` / `source`（inline / js_binding / config_bar / page_load 等）/ `element`（id / label / event）/ `request`（method / paths）/ `backend`（controller / method / path / file / line）/ `jsPath`（name / kind / file / line；`name` 为空表示匿名 handler 或页面顶层代码，`kind` 为 handler / top_level） |
| `commits[].uiEntries[].access` | 菜单访问位置：`confidence` = `menu` / `parent` / `none`；`via` = `html`（直接登记，且页面 HTML 真实存在）；`menus[]` = name / parentPath / mode / groups；`parents[]` = page / type（弹出 / 跳转 / 内嵌 / 包含）/ linkSource（element / page_load）/ element / elementLabel / elementEvent / elementSource / opener / via / menus。`.csp` 菜单行不参与归并 |
| `commits[].unmatchedEntrypoints[]` | 没有前端链路的入口，`reason` 互斥：`client-controller`（服务间门面）/ `feign-interface-mapping`（映射在 Feign 接口，`http` 为空）/ `cross-service-same-name`（前端同名但有效服务不同）/ `no-front-call`（页面未调用） |
| `meta.stats` | commits / commitsWithUi / entrypoints / matchedEntrypoints / pages / pagesWithMenu / pagesWithParentMenu / pagesNoMenu / unmatchedEntrypoints / unmatchedUnique / unmatchedReasons |

**取证边界**（写进评估结论，不得越界解读）：调用图只覆盖 Java 方法级静态调用；DTO/VO/PO、前端、public 基础设施不在图内；BLH 反射断链以同名覆写与启发式补链（`heuristic=true` 必须标注）；Maven 侧只保留直调医生站 Feign 的服务，未命中不等于无交互。`contract.typeFeignMatches` 按类型**全限定名**扫描 Feign 方法签名的 `return_type` / `parameters`（Feign 接口侧解析源码 package / 显式 import / 通配 import，`typeFqn` 记录实际命中类型），跨模块同名 DTO 不会串号；嵌套在 VO 字段里的类型不出现在签名中，未命中不等于无使用方。`contract.typeFeignCallers` 再把命中的 Feign 方法沿工作区调用边上溯到入口（`indirect=true`），补出「页面 → 本地 Controller → BLH → Feign」的间接链路；这类入口只在该上溯非启发式（`depth>=0`）时才作为界面证据，`indirect+heuristic`（`depth=-1` 的兜底候选）只保留在 `entrypoints` 供复核，`commit-impact` 不会据此输出 `uiEntries`。`contract.typeControllerMatches` 按类型**全限定名**扫描工作区 Controller 方法签名（Controller 侧解析显式 import / 同包 / 通配 import，`typeFqn` 记录实际命中类型），命中时在 `entrypoints` 里合成 `heuristic=true`、`via=["type:<类型>"]` 的契约入口，供前端链路衔接页面；它代表该类型的接口影响面，不是方法级可达证据。跨模块同名 DTO（如 ipcare/opcare 各自的 `FeignOeStopMultiDTO`）不会互相命中，但嵌套在 VO 字段里的类型仍不在签名内。

界面证据的边界：只覆盖落到工作区 Controller 的链路，URL 属于工作区外产品时不会有界面证据；前端入口登记表只登记菜单入口页面（当前 507 个真实存在的 HTML 页面），`.csp` 行与不存在的 HTML 不输出，多数业务子页面通过弹窗 / 内嵌承载，`access.confidence=none` 是正常口径而非漏匹配；`page_load` 条目只证明「打开页面会触发」，不等于用户点击。

## 步骤 ④：评估（仅【流程修改 / 业务调整】类提交，混合式）

**第一层：高风险三类判定**（先做）。先读步骤 ③.5 的 `code-impact-<label>.json`，用证据触发机械升级，再按业务语义确认。命中任一类 → 调用 `imedicalxc-doctor-business-understanding` skill 做完整链路分析（前端入口 → 前端逻辑 → 后端 Controller→BLH→Service→Mapper），评估段标注命中类别，摘要写入报告附录：

| 类别 | 判定 |
|---|---|
| 一类：重点业务的流程改造 | 语义判定：① 医嘱状态、执行记录状态扭转（保存、停止、撤销、执行、停止执行等）；② 预约、挂号核心流程（挂号、号源、排班等）；③ 接诊流程（门诊、住院患者扭转：接诊、诊断录入、单据打印、病人列表等）。证据确认：`entrypoints` 中 Controller/Feign 命中上述业务（如 `saveOeOrdItem`、`stopOrd`、`register`、`appointment`、`accept`） |
| 二类：通用接口的改造 | **机械升级**：满足任一即命中——① `contract.feignInterfaces` 非空（Feign 契约变更）；② `workspaceCallers` 存在 `sameService=false`（跨服务工作区调用方）；③ `externalCallers` 非空（跨仓库/Maven 调用方）；④ `contract.typeFiles` 含 `*PO.java`（新增表结构）。随后按①跨仓库/跨工作站对接规范 ②标准接口设计规范 ③PO 设计合理性 逐项核验 |
| 三类：其他 | **机械升级**：满足任一即命中——`methods` 数 ≥ `codegraph.riskThresholds.methods`；`entrypoints` 数 ≥ `riskThresholds.entrypoints`；跨服务 `workspaceCallers` 数 ≥ `riskThresholds.crossServiceCallers`；`externalCallers` 数 ≥ `riskThresholds.externalCallers`；`truncatedMethods` 非空（证据被截断） |

> `highRiskAuto` 记录证据触发的类别；一类仍需业务语义确认，`highRiskAuto` 只作提示，避免误升级。

**第二层：轻量评估全覆盖**（每条都做）。用 `git -C <repo> show <hash>` 读 diff，对照模块现有实现与步骤 ③.5 的证据，产出（**提交级一份结论**，不按方法分别出报告）：

1. **影响范围**：先写一句中文业务功能点（保留「医嘱 / 诊断 / 检查 / 病历 / 配置 / 排班」等模组关键词——邮件影响表的 `determineModule()` 依赖这些词判定功能模组），再按证据分四项输出——
   - 入口：`entrypoints`（Controller / Feign / HTTP；`heuristic=true` 标注 `[启发式]`，`depth=-1` 标注不确定）
   - 工作区调用方：`workspaceCallers`（`sameService=false` 需点名跨服务）
   - 外部 Maven 调用方：`externalCallers`（服务 + 模块）
   - 跨出 Feign：`downstreamFeigns`（接口 + 方法）
   - `downstream.count` 只写规模，**不得当作回归范围**；`confidence=none` 或所有改动文件均未入图时写「无调用图证据（原因：…）」，此时结论只能来自 diff
2. **业务设计流程符合性**：符合 / 部分符合 / 不符合，附理由
3. **星级（1-5★）**：

| 星级 | 标准 |
|---|---|
| 5★ | 完全符合业务设计，影响面清晰可控，无风险 |
| 4★ | 符合设计，影响面基本可控，有轻微注意点 |
| 3★ | 基本符合，存在需关注点但不阻断 |
| 2★ | 存在明显问题（破坏既有流程、边界未处理） |
| 1★ | 严重问题（与业务设计冲突、可能引发数据错误） |

   **影响范围评级（`impactRating`，1-5★）**：独立于上面的质量星级，回答「假设该功能一定发生严重故障，波及面有多大」，用于邮件/影响表标题前缀与整体排序：

| 影响范围评级 | 判定 |
|---|---|
| 5★ | 核心业务阻断并形成大批量积压：患者无法完成「挂号→就诊→开方→收费→取药/检查」中的任一必经环节，且无其他系统入口或人工流程可立即替代，形成可见队列积压且短期不会自行缓解 |
| 4★ | 核心业务严重受阻：正常路径被切断或严重劣化，只能靠手工单据、备用入口或降级流程维持；积压持续累积，但尚未达到大批量阻断 |
| 3★ | 核心模块受控中断：影响收缩到单一核心模块或单一业务线，其他核心链路正常运行，或绕行方案可承载当前业务量 |
| 2★ | 非核心业务受影响：辅助系统、边缘模块或特定科室的非关键功能异常，核心链路用户仍能完成主流程 |
| 1★ | 几乎无业务感知：仅界面呈现、日志记录、非关键配置或行为等价的重构，无需培训、绕行或通知业务科室 |

   > 5★ 必须同时满足「阻断」与「大批量」；仅调用方数量多、但业务可通过其他入口或人工流程完成时，最高评为 4★。

   **非核心备用系统降级**：门急诊应急系统等仅在正常 HIS 不可用时才启用的备用系统，不属于「挂号→就诊→开方→收费→取药」核心链路，其提交的影响范围评级上限为 2★（初始化类整体不可用记 2★，单点数据或接口类记 1★），并在 `impactRatingReason` 写明「正常 HIS 不受影响、核心链路用户无感知」；此类提交即使命中高风险三类也**不触发深度评估**，按轻量评估处理，在 evaluations 中记 `impactDowngrade` 说明原因，报告附录不单列摘要。

   `impactRatingReason` 用一句话写明判定依据（受影响业务环节、是否阻断、是否存在可立即启动的绕行手段），不得只写星级。

4. **评价描述**（1-3 句）
5. **低星强制补充**：1-2★ 必须给出**至少一条具体问题评价**——引用文件:行号或 diff 片段，指明与业务设计冲突或遗漏之处。一条提交含**多个相互独立的问题**时，同时输出 `issueItems` 数组逐问题列出（每个元素恰对应一个问题，供步骤 ⑥ 按问题拆行登记；同一问题的对比说明保持为一个元素）
6. **与第五章不重叠（口径排除）**：凡属「需完成新增系统标准配置登记 / 系统标准提醒维护 / 代码表缓存配置维护 / PO 表结构（DDL）执行」一类的**数据维护提醒**，已由步骤 ② 检测并在报告第五章「数据库脚本执行提醒」统一承担，**不得**作为 `specificIssue` / `issueItems` 的低星问题条目输出，也不得进入步骤 ⑥ 登记与第五章后的 QQ「低星问题」消息。仅当维护动作背后的**设计选择本身**构成冲突（例如新增开关默认值取 true 使主流程在升级瞬间被禁用）时，以该冲突事实计入问题，措辞不写「需登记/需维护」
7. **测试方式建议**（`testSuggestion`）：面向交付与测试人员，按「访问位置 → 界面 → 操作 → 预期结果」描述，四段式。**正文不得出现类名、方法名、Feign 接口名、字段名等代码标识**（代码标识只保留在「调用图证据」「界面证据」与 `impactEvidence` 中，用于追溯）：
   - **【必测】** 直接改动点，必须带界面与访问位置。先从 `front-chains-<label>.json` 的 `uiEntries` 选一条元素触发链路（优先 `inline` / `js_binding` / `config_bar` / `config:*` 配置驱动按钮，`page_load` 只用于页面加载行为），按 `access.confidence` 写访问位置：
     - `menu`：在「父菜单路径」打开「界面名称」（`page`），再操作「元素」→ 预期结果
     - `parent`：在「父菜单路径」打开「父页面名」，再点击「父页面元素」打开 / 弹出「页面标题」（`page`）→ 操作「元素」→ 预期结果；`linkSource=page_load` 写成「打开父页面即自动弹出」
     - `none`：在「页面标题」（`page`，无菜单登记，内嵌 / 弹窗页）操作「元素」→ 预期结果
     - 预期结果从 diff 方法语义提炼（如「只填诊断名称未选标准 ICD 码保存，应提示并阻止」），不照抄方法名
   - **【回归】** `uiEntries` 中同一页面的其他操作元素 / 页面加载链路对应的既有功能、`workspaceCallers` 中调用方的原有业务场景（跨服务调用方逐个点名其业务场景）；无回归范围时写「无」
   - **【联调】** `externalCallers` 或 `downstreamFeigns` 非空时给出跨服务联调项，必须写**调用方的业务场景**（如「门诊挂号取号时读取号别职称」），不得只写契约名；调用方能在 `uiEntries` 找到界面时附「界面 + 访问位置」，找不到时只写服务 / 模块并注明「无页面入口证据（调用方在工作区外）」；为空时写「无」，不臆造
   - **【边界】** 用业务语言描述空值/未传/并发/状态扭转/分页等边界（如「未停止医嘱的停止时间为空」「单页过滤后条数不足需继续翻页」）
   - **可追溯**：每条建议必须能对应一条证据（`uiEntries` 的页面 / 元素 / 请求 / Controller，或入口 / 调用方 / Feign 名）；`unmatchedEntrypoints` 覆盖的入口写「无页面入口证据，按接口验证」；`front-chains` 缺失或不可用时，在【必测】末尾写「（按变更内容推断，无界面证据）」，并在 `impactScope` / `impactEvidence` 标注，**不得编造界面、菜单路径或调用方**
   - **贴合实际改动**：仅建议与本次变更直接相关的场景，不笼统归入大功能模块全流程（仅改前端布局 → 只验证布局显示；仅改注释 → 代码审阅即可）
   - **低星追加**：1-2★ 提交在【边界】末尾追加「属低风险提交，重点关注边界场景」
   - 四段以【必测】【回归】【联调】【边界】标记分段，邮件按这四个标记拆行；段内并列项用中文分号「；」连接（邮件不再按分号断行，菜单路径中的「/」与并列菜单可安全书写）。单段内不得出现第二个同类分段标记。访问路径用「→」「/」「、」连接
   - **多个要点用无序号列表**：同一段需要列出多个页面或多个动作时，用换行分行（或中文分号「；」并列），每个动作一句；出现 2 个以上要点时，邮件把分段标记单独一行、下面每个要点渲染为「·」缩进项，Markdown 存档渲染为子项；只有单句时分段标记才与正文同行。不要把 4 个以上页面塞进一句话——一句话里堆 6～9 个「」页面名，测试人员读不出先后与验收点
   - **邮件改造方案同口径**：邮件「改造方案」取 `changeSummary`（缺失时回退 `evaluation`），只写「改了什么」，用业务语言描述变更内容；**不得写「工作区内未发现活动调用方」「无方法级调用证据」等取证结论或测试安排**——这些内容属于 `testSuggestion` 的【必测】或 `impactScope`；除变更本身外没有其他有效内容时，直接写「无业务逻辑变更」
8. **页面级证据定位**（写【必测】/【回归】/【联调】前执行，避免臆测页面）：
   - **以 `front-chains-<label>.json` 为准**：按提交 hash 读 `uiEntries`，优先 `match=controller`、元素触发、`access.confidence` 从高到低（menu > parent > none）。一个提交有多个界面时，按与 `funcPoint` 最接近的业务场景选 1-2 条写【必测】，其余放【回归】。
   - **访问位置只取登记表字段**：`access.menus[].parentPath` + `name` 组成访问位置；`access.parents[].menus` 是父页面的菜单，必须配合 `element` / `linkSource` 还原打开路径。`confidence=none` 时只写页面标题与元素，措辞固定为「无菜单登记（内嵌 / 弹窗页）」，**不得**用页面标题猜一个菜单路径。
   - **`page_load` 不作为点击步骤**：它只证明打开页面会触发请求；【必测】需要用户可执行的操作时，选 `inline` / `js_binding` / `config_bar` 条目。
   - **没有界面证据的处理**：先确认契约反查已执行——`contract.typeControllerMatches` 非空即说明该类型被 Controller 签名使用，必须按命中的 Controller 方法继续查 `uiEntries`（或写「页面未登记，按接口验证：<Controller>.<方法>」）；`contract.typeFeignCallers` 非空说明契约方法被工作区调用方使用，必须检查 `entrypoints[]` 中 `indirect=true` 的入口能否衔接到页面（如 opreg 排班契约经 opalloc 分诊调用方上溯到「护士分诊」页），**不得**因为 `methods[]` 为空就写「无页面入口证据」。`unmatchedEntrypoints` 非空且没有可用 `uiEntries` 时，【必测】写「无页面入口证据，按接口验证」；`reason=feign-interface-mapping` 说明映射声明在 Feign 接口、前端不直调，不作页面；`client-controller` 是服务间门面，同样不作页面；`indirect=true` 且 `heuristic=true` 的入口只是兜底候选，`commit-impact` 已不据此输出界面证据，不得手工补成页面证据；只有在 `contract.typeFeignMatches`、`contract.typeFeignCallers`、`contract.typeControllerMatches` 均为空且 `entrypoints` 为空时，纯契约提交才写「未发现活动调用方，代码审阅即可」。
   - **契约入口的写法**：`via` 以 `type:` 开头、`heuristic=true` 的入口是契约级影响面，【必测】要写「该字段 / 格式在页面上的展示或提交」（如「申请时间显示格式应与升级前一致」），不得写成该页面本身有逻辑改动；`uiEntries` 的 `match` 仍是 `controller`，回归项按页面既有功能写。
   - **手工兜底**（仅 `front-chains` 缺失 / 不可用时）：证据中出现 Controller 方法名或 HTTP 路径时，才允许到 `src/frontend/hisfront/static/` 检索；必须用完整路径或「方法名 + 服务 / 目录前缀」消歧，并在 `impactEvidence` 记录命中的前端文件与行号（如「前端证据：`static/opreg/opreg-pat/scripts/doc.reportloss.js:9` 卡挂失 / 启用」）。仅凭 `getScheduleInfo`、`getDrugList` 这类通用方法名命中即下结论视为无效证据。Feign 名不能直接搜前端，必须先追消费方 Controller。
   - **禁止推断**：任何「与 XX 页面联调」的表述都必须能回指一条 `uiEntries` 条目或 Controller/页面证据；回指不到就删除该表述，改用「无页面入口证据」。

评估结果落盘为同目录 `evaluations-<label>.json`（同月多期必须带期号后缀，避免覆盖其他窗口产物）（条目字段：hash / shortHash / subject / author / date / repo / funcPoint——面向测试/交付的业务功能点标题，不出现类名、方法名、Feign 名（邮件与影响表的章节标题） / highRiskCategory / highRiskAuto——证据机械触发的类别，供复核 / impactScope——按证据四段式撰写 / impactEvidence——该提交在 `code-impact-<label>.json` 中的计数摘要：methods / entrypoints / workspaceCallers / externalCallers / downstreamFeigns / contract（`feignContracts` / `typeFiles` / `typeFeignMatches` / `typeFeignCallers` / `typeControllerMatches`） / downstream / confidence / indexFresh / skipped 原因；并附 `ui`——该提交在 `front-chains-<label>.json` 中的界面证据摘要：uiEntries / pages / withMenu / withParentMenu / noMenu / unmatchedEntrypoints（未命中入口数，取该提交 `unmatchedEntrypoints[]` 的长度） / compliance / complianceReason / rating——质量星级 / impactRating——影响范围评级（1-5★，邮件与影响表标题前缀、排序依据） / impactRatingReason——影响范围判定依据一句话 / impactDowngrade——非核心备用系统的降级说明（含为何不深度评估），非此类提交可省略 / changeSummary——面向交付的改造方案（只写变更内容，不写调用方/取证/测试信息；无业务逻辑变更时写「无业务逻辑变更」，缺失时回退 evaluation） / evaluation——评价描述 / specificIssue / issueItems——1-2★ 且含多个独立问题时必填的逐问题明细数组 / testSuggestion——四段式测试建议），作为步骤 ⑥ 低星问题登记的数据源。

## 步骤 ⑤：归档（确定性渲染）

报告正文由脚本渲染，不手工拼装（避免计数漂移、排序不一致、字段漏写）：

```bash
node .agents/plugins/imedicalxc-doctor-commit-report/scripts/render-report.js --label <label>
```

产出 `<outputDir>/<label>/commit-report-<label>.md`。

**输入**（同目录；缺必填项直接报错退出，不写文件；`code-impact` / `front-chains` 可选）：

| 文件 | 用途 |
|---|---|
| `raw-commits-<label>.json` | 提交总数与元信息（时间窗、扫描仓库数） |
| `classification-<label>.json` | 第一章分布、第二章提交明细 |
| `evaluations-<label>.json` | 第三章评估详情、第四章低星清单、第六章附录 |
| `db-changes-<label>.json` | 第五章数据库脚本执行提醒 |
| `code-impact-<label>.json` | 可选；校验 evaluations 中的证据计数与可信度 |
| `front-chains-<label>.json` | 可选；校验 evaluations 中 `impactEvidence.ui` 的界面 / 页面计数（缺该文件时不校验） |

**参数**：`--label`（必填）、`--output-dir`（默认 `docs/agents/commit-reports`）、`--generated-at`（ISO 时间，默认当前时间）、`--config`（默认插件 `config/commit-report.json`）、`--no-preserve-registration`（不保留已有第七章）。

**校验行为**：

- 错误 → 打印全部错误后 `exit 1`，不生成文件。含：分类与采集结果的哈希缺失 / 重复 / 多余、工作站不在 config 清单、需求类型或优先级非法、总结为空、星级或影响范围评级越界、评估条目缺 `impactRatingReason` / `impactScope` / `compliance` / `evaluation` / `changeSummary` / `impactEvidence`、测试建议缺四段、低星缺具体问题、流程修改 / 业务调整漏评估、evaluations 与 classification 的需求类型不一致
- 告警 → 继续渲染并在控制台列出：门急诊应急工作站影响评级超过 2★、证据计数或可信度与 `code-impact` 不符、界面证据计数与 `front-chains` 不符、工作站与分类不一致、多出未分类的评估条目。告警须逐条核对，不得静默通过
- 修正时改上游 JSON 后重跑脚本，**不直接编辑报告 md**（除步骤 ⑥ 追加第七章外）
- 再次渲染时自动保留原文件中的 `## 七、低星问题登记`（步骤 ⑥ 写入），避免覆盖登记结果

**固定结构**（内容全部来自上述 JSON，脚本只排版与校验，不改写评价文字）：

- 一、概览：按提交人 / 工作站 / 需求类型 / 优先级四张分布表（「按提交人分布」标题为 push-qq-bot.js 解析锚点，不要改标题），附影响范围评级标准
- 二、提交明细：末列为「质量评级」（BUG修复 / 新功能提交填 —）；标题前缀 `[N★]` 才是影响范围评级
- 三、评估详情：按影响范围评级降序、同档按质量星级降序（稳定排序），每条含降级说明（如有）、影响范围评级与依据、调用图证据、界面证据（有 `impactEvidence.ui` 时）、影响范围、符合性、评级；评级行固定为 `- **评级**：N★ —— 评价：…`（push-qq-bot.js 解析锚点，`评价：` 不可省略）
- 四、低星问题清单：1-2★ 逐条列具体问题
- 五、数据库脚本执行提醒：开头汇总计数；5.1–5.4 按非空小节输出；5.5 逐类给执行方案（四节全空则整节省略）
- 六、附录：仅列命中高风险三类且未降级的提交（调用链要点 + 结论）

追加索引 `<outputDir>/index.md`（首次创建，之后追加一行）：

```markdown
| {label} | {since} ~ {until} | [commit-report-{label}.md](./{label}/commit-report-{label}.md) | {totalCommits} |
```

归档后在父仓库本地提交（**不推送远端**）：

```bash
git add docs/agents/commit-reports/
git commit -m "docs: 新增 {label} 医生站信创产品迭代周报"
```

## 步骤 ⑥：低星问题登记（报告归档后、推送前）

将本期 1-2★ 低星问题经 tencent_docs MCP 登记到【腾讯文档】信创版产品迭代每周问题登记（https://docs.qq.com/sheet/DWEN5eXB5Q0diYWdI?tab=BB08J2 ，表格身份取自 config `issueRegistration`）：

1. 运行行数据生成脚本（确定性）：`node .agents/plugins/imedicalxc-doctor-commit-report/scripts/build-issue-rows.js <outputDir>/<label>/evaluations-<label>.json` → 同目录 `issue-rows-<label>.json`（已按 rating ≤ 2 过滤、渲染 9 列目标行值、含 fileId/sheetId；条目含 `issueItems` 时按问题拆为多行，同一提交多行共享同一「提交」值）。期号 label 优先从输入文件名 `evaluations-<label>.json` 解析（同月多窗口场景），无后缀时回退目录名；来源列写 `医生站信创产品迭代周报-<label>`。行内容不得包含第五章类「需登记 / 需维护」提醒（口径见步骤 ④ 第 6 条）。
2. 读取 config `issueRegistration`：不存在或 `enabled=false` → 输出「登记未启用，跳过」，进入步骤 ⑦。
3. MCP 读取目标表：`sheet.get_sheet_info` 获取表容量；`sheet.get_cell_data`（列 A-D、行 0 至容量-1、return_csv=true）读取全表，解析「提交」列各行首 token 的 8 位十六进制短哈希集合（registry）。
4. 过滤：`shortHash` 已在 registry 的行跳过；其余为待写入行。写入起始行 = 表中最后一个非空数据行 + 1（表头占第 0 行，空表从第 1 行开始）。
5. MCP 批量写入：`sheet.set_range_value`（value_type=STRING、0-based 行列；空值单元格跳过不写）；若 起始行 + 行数 超出表容量，先 `sheet.insert_dimension` 扩容再写。
6. 在报告 md 末尾追加「七、低星问题登记」小节：登记表链接、新增 N 行（涉及 C 个提交，短哈希清单）、跳过 M 条（已登记提交）、异常说明。
7. 父仓库本地提交（`git add docs/agents/commit-reports/`，含 issue-rows JSON 与报告 md；不推送远端）。

**失败语义（非阻断）**：`evaluations.json` 缺失或读表失败 → 告警并跳过写入（**禁止盲写**，防止重复登记）；写入失败 → 告警；两种情况均继续步骤 ⑦（推送不受影响）。

登记列取值（9 列）：来源=`医生站信创产品迭代周报-<label>` / 登记日期=实际写入日期 / 星级=`<rating>★` / 提交=`短哈希 [仓库名] 提交标题` / 具体问题=`issueItems` 逐项（每条目一行；无 `issueItems` 时取 specificIssue，空或「无」时兜底 evaluation，均空填 `—`）/ 负责人=提交人 / 完成状态=`未完成` / 完成日期与备注留空。

## 步骤 ⑦：推送

读取 `.agents/plugins/imedicalxc-doctor-commit-report/config/commit-report-push.json`（**本地文件，已被 config/.gitignore 忽略，不入库**；首次使用从 `commit-report-push.template.json` 复制，不存在则视为未配置）：

- `enabled` 为 `false` 或文件不存在 → 输出「推送未配置，跳过」，流程结束
- `enabled` 为 `true` 且 `channel` 为 `qqbot` → 先确认环境变量 `COMMIT_REPORT_QQBOT_TOKEN` 已配置（缺失时脚本会报错并提示维护位置），再执行推送脚本：

```bash
node .agents/plugins/imedicalxc-doctor-commit-report/scripts/push-qq-bot.js <outputDir>/<label>/commit-report-<label>.md
```

可选参数（试运行演练/补推用，日常周报不加）：`--only=<段>` 仅发送指定段落（`opening,distribution,db,issues,pending,closing,upload`，默认全部）；`--dry-run` 仅打印消息不实际发送（发送前核验）。

推送内容（QQ 群消息）：
1. 【按提交人分布】—— 一条文本消息，含日期范围和各提交人占比
2. 【数据库脚本执行提醒】—— 一条文本消息（自动读取同目录 `db-changes-<label>.json`）：四类计数 + 明细摘要（新增配置的 ST_CODE/配置项、提醒码、首用 PO）+ 执行方案推荐 + 试用阶段说明（「说明：当前为试用运行阶段，更新阶段出现疑问可联系变更负责人咨询。」），@ 涉及提交人；四类全为 0 时发「本期无数据库脚本执行提醒」
3. 【低星问题清单】—— 每条低星问题单独一条文本消息，@ 对应提交人（通过群成员列表匹配群昵称）；匹配不到则提示「未找到「XXX」群成员」并 @ 群管理员
4. 【问题处理提醒】（低星问题之后、收尾 @全体 之前）—— 一条文本消息，附《信创版产品迭代每周问题登记》访问地址，并按负责人去重 @ 未标识处理结果的相关人员（附各自条数）：脚本经本机 tencent-docs MCP 只读该表（配置 `issueRegistration`），筛「来源」以「医生站信创产品迭代周报」开头、且完成状态仍为「未完成」/为空、完成日期与备注均为空的行（三项任一被填写即视为已标识、不再提醒）；负责人未匹配到群成员时提示「未找到「XXX」群成员」并 @ 群管理员；读表失败或未标识为 0 时输出日志并跳过本条消息（非阻断）
5. 报告 Markdown 文件 —— 以群文件方式上传（base64 编码）

### 邮件通道（`email` 段 `enabled` 为 `true` 时）

数据变更通知邮件（正文为正式排版的 HTML，另存 Markdown 存档），流程：

1. 生成邮件正文：`node .agents/plugins/imedicalxc-doctor-commit-report/scripts/build-db-email.js <outputDir>/<label>/db-changes-<label>.json [--evaluations=<outputDir>/<label>/evaluations-<label>.json] [--raw-commits=<outputDir>/<label>/raw-commits-<label>.json]`，输出同目录 `db-change-email-<label>.md`（Markdown 存档）与 `db-change-email-<label>.html`（发送用 HTML 正文：标题 + 检测时间窗/生成时间 + **背景与目标**（背景/目标/阅读说明）+ **第一章功能变更影响**（含本期数量与评级分布；当提供 `--evaluations` 参数时生成：子章节格式，每条提交独立展示并标注岗位工作站/功能模组/需求类型/提交人/仓库/改造功能点/测试方式建议 7 项，其中前 6 项为两列表格：左列岗位工作站、功能模组、需求类型，右列提交人、仓库（仓库路径不得在词中断行），基于 IT形态汇总.xlsx 映射；测试方式建议取自 evaluations JSON 的 `testSuggestion` 字段——由步骤 ④ LLM 基于 diff 实际改动生成，非关键词匹配）+ **第二章数据变更**（含两个子章节：2.1 数据变更明细表（变更类型/变更内容/变更负责人）+ 2.2 数据变更操作说明四子项：DDL 参考【腾讯文档】信创版HIS数据库升级脚本汇总表格、系统提示信息维护、系统标准配置导出导入、代码表缓存管理维护）+ 自动生成页脚，全部内联样式）。
2. 解析收件人/抄送人：`PYTHONIOENCODING=utf-8 python .agents/plugins/imedicalxc-doctor-commit-report/scripts/resolve-email-recipients.py`。
   - 收件人 = 腾讯文档【信创版HIS数据库升级脚本汇总表格】「脚本执行负责人」页签「负责人邮箱」列去重（`email.recipientSource`：bookId/sheetId/emailColumn）
   - 抄送人 = 通讯录分组「信创-研发-医生站」「信创-研发-监督人」成员邮箱去重（`email.ccSource.groups`）
   - 也可用环境变量直接指定（优先于实时解析）：`COMMIT_REPORT_EMAIL_RECIPIENTS` / `COMMIT_REPORT_EMAIL_CC`（逗号分隔）。
   - 脚本把结果写回**本地** `commit-report-push.json` 的 `email.recipients` / `email.cc`（含 `recipientsResolvedAt`，该文件不入库）并输出 JSON 摘要；实时获取失败（如腾讯文档凭证过期、通讯录不可达）→ 自动回退上次解析的缓存结果继续发送，输出 JSON 的 `warnings` 数组标识哪些数据源使用了缓存，cron 执行时应将 warnings 内容输出到日志供排查；无缓存且环境变量未配置时，报错并提示 `COMMIT_REPORT_EMAIL_RECIPIENTS` / `COMMIT_REPORT_EMAIL_CC` 的维护位置。
   - 地址白名单：收件人/抄送人须已在邮箱 MCP 的 `MCP_EMAIL_SERVER_ALLOWED_RECIPIENTS`（`.qoder/settings.local.json`）内；新增执行负责人或分组调整后需同步更新白名单并重载 MCP。
3. 通过邮箱 MCP 调用 `send_email` 工具发送：`account_name` = `email.accountName`（默认 `default`）、`recipients` = 上一步解析结果（`email.recipients`）、`cc` = `email.cc`、`subject` = `email.subject`（统一「信创版功能及数据变更通知」）、`body` = 生成的 html 文件全文、`html` = `true`（HTML 渲染推送，避免客户端显示 markdown 源码）。
4. 发送成功后把 `db-change-email-<label>.md` 与 `db-change-email-<label>.html` 一并提交入库（父仓库本地提交，不推送远端）。
5. 邮箱 MCP 不可用（工具列表无 `send_email`）→ 降级用 stdio 直驱脚本发送：`PYTHONIOENCODING=utf-8 python .qoder/scripts/email-send-via-stdio.py --html <html 文件>`（等价于步骤 3：读 config 收件人/抄送、html=true；凭证运行时读取，不落盘）；仍失败 → 输出告警并继续，不影响 QQ 渠道结果。

## 步骤 ⑧：回写状态（仅定时模式）

七步完成后更新 `.agents/plugins/imedicalxc-doctor-commit-report/config/commit-report-state.json`（本地文件，已 gitignore，不入库），时间精确到分钟：

```json
{
  "lastWindow": { "since": "<本期 since>", "until": "<本期 until>", "label": "<本期 label>" },
  "lastRunAt": "<当前 ISO 时间含时区>",
  "note": "<本期摘要：提交数、低星条数、登记与推送结果、异常降级说明>"
}
```

交互模式不改写该文件。

## 环境变量（敏感配置，不入库）

令牌与个人邮箱一律不写入入库配置，运行时从环境变量读取。**维护位置**（二者任一即可，脚本优先读进程环境变量）：

1. shell 环境变量（cron / CI 场景推荐）
2. `<仓库根>/.qoder/settings.local.json` 的 `commitReport.env` 段，例如：

```json
{
  "commitReport": {
    "env": {
      "COMMIT_REPORT_QQBOT_TOKEN": "<QQ 机器人访问令牌>",
      "COMMIT_REPORT_REPORTER_EMAILS": "{\"姓名\":[\"邮箱\"]}"
    }
  }
}
```

| 变量 | 必需性 | 用途 | 缺失时行为 |
|---|---|---|---|
| `COMMIT_REPORT_QQBOT_TOKEN` | QQ 推送必需 | QQ 机器人 API 访问令牌 | `push-qq-bot.js` 报错退出并打印维护位置 |
| `COMMIT_REPORT_REPORTER_EMAILS` | 可选 | 提交人姓名→邮箱映射（JSON），用于 git 作者邮箱匹配 | 打印提示，仅按姓名/别名匹配 |
| `COMMIT_REPORT_EMAIL_RECIPIENTS` | 可选 | 逗号分隔收件人，覆盖实时解析 | 自动回退腾讯文档解析 |
| `COMMIT_REPORT_EMAIL_CC` | 可选 | 逗号分隔抄送人，覆盖实时解析 | 自动回退 CardDAV 解析 |

> 配置模板：`config/commit-report-push.template.json`（不含令牌与邮箱）；实际使用的 `commit-report-push.json`、`commit-report-state.json` 已被 `config/.gitignore` 忽略，仅存本机。

## 约束

- 全程只读 git（log / show）；不推送远端、不编译、不写数据库。
- 唯一例外：步骤 ⑥ 经 tencent_docs MCP 将低星问题写入【信创版产品迭代每周问题登记】表。
- 11 人白名单过滤在采集脚本内完成，评估阶段不再扩大范围。
- 名单外作者（cuixy、Codex 等）的提交不纳入报告。
- 职责边界：步骤 ③.5 只取证（JSON），步骤 ④ 才做业务判断；评估中每条入口 / 调用方 / 联调 / 界面建议都必须能追溯到证据，无证据时明说「无调用图证据」或「无页面入口证据」，不得编造菜单、页面或调用方。
