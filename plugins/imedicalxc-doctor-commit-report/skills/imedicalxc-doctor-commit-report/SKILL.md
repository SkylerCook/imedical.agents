---
name: imedicalxc-doctor-commit-report
description: |
  HIS 医生站信创产品迭代周报。采集 src/ 下 20 个子仓库在指定时间窗内 11 位医生站同事的 git 提交，输出五要素汇总（岗位工作站 / 需求类型 / 优先级 / 提交人 / 改造内容总结），对【流程修改 / 业务调整】类提交做混合式评估（轻量全覆盖 + 高风险三类自动升级深度评估，1-5 星评级，1-2★ 必须给出至少一条具体问题评价），并自动检测数据库脚本执行提醒（PO 数据结构修改 / 新增系统标准配置 / 新增系统标准提醒 / 新增代码表缓存配置），归档 Markdown 报告，将 1-2★ 低星问题经 tencent_docs MCP 登记到《信创版产品迭代每周问题登记》（多个独立问题的提交按问题拆行），并按配置尝试推送。用于周度定时汇总或按需汇总提交记录。
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

七步串行执行：① 采集 → ② 数据库变更检测 → ③ 分类 → ④ 评估 → ⑤ 归档 → ⑥ 低星问题登记 → ⑦ 推送。每步完成后再进入下一步。

**开始前必读**：`.agents/plugins/imedicalxc-doctor-commit-report/config/commit-report.json` —— 人员白名单（reporters）、岗位工作站清单（workstations）、时间窗（window）、输出目录（outputDir）。

## 步骤 ①：采集（确定性脚本）

时间窗默认近 1 个完整自然月：

```bash
node .agents/plugins/imedicalxc-doctor-commit-report/scripts/collect-commits.js --months 1
```

自定义窗口（尽量对齐自然月）：`--since 2026-09-01 --until 2026-10-01`。

产出 `<outputDir>/<YYYY-MM>/raw-commits-<YYYY-MM>.json`，每条提交含 repo / hash / author（映射后中文名）/ authorRaw / date / subject / files / additions / deletions。检查 `meta.errors`：非空时先向用户报告错误仓库（错误不阻断整体），再继续。

> 提交人邮箱属个人信息，不入库；需邮箱匹配时从环境变量 `COMMIT_REPORT_REPORTER_EMAILS`（JSON：`{"姓名":["邮箱",...]}`）补充。缺失时脚本打印维护位置提示，仅按姓名/别名匹配（不阻断）。

## 步骤 ②：数据库变更检测（确定性脚本）

对步骤 ① 的产出做数据库脚本执行提醒检测：

```bash
node .agents/plugins/imedicalxc-doctor-commit-report/scripts/detect-db-changes.js <outputDir>/<YYYY-MM>/raw-commits-<YYYY-MM>.json
```

产出同目录 `db-changes-<YYYY-MM>.json`，检测结果（章节五的数据源，评估阶段可直接引用，不必重查 git）：

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
| 岗位工作站 | 从 config `workstations` 清单中选一项，**以改动文件路径为主、仓库为辅**判定；匹配不到填"其他" |
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

## 步骤 ④：评估（仅【流程修改 / 业务调整】类提交，混合式）

**第一层：高风险三类判定**（先做）。命中任一类 → 调用 `imedicalxc-doctor-business-understanding` skill 做完整链路分析（前端入口 → 前端逻辑 → 后端 Controller→BLH→Service→Mapper），评估段标注命中类别，摘要写入报告附录：

| 类别 | 判定 |
|---|---|
| 一类：重点业务的流程改造 | ① 医嘱状态、执行记录状态扭转（保存、停止、撤销、执行、停止执行等）；② 预约、挂号核心流程（挂号、号源、排班等）；③ 接诊流程（门诊、住院患者扭转：接诊、诊断录入、单据打印、病人列表等） |
| 二类：通用接口的改造 | ① 跨仓库或跨工作站对接改造；② 标准接口的修改或新增是否符合当前通用接口的设计规范；③ 新增表结构（PO）是否合理、是否与现有设计冲突、是否有性能问题 |
| 三类：其他 | 提交内容过多、影响范围过大等 |

**第二层：轻量评估全覆盖**（每条都做）。用 `git -C <repo> show <hash>` 读 diff，对照模块现有实现，产出：

1. **影响范围**：受影响的工作站 / 页面入口 / 上下游功能
2. **业务设计流程符合性**：符合 / 部分符合 / 不符合，附理由
3. **星级（1-5★）**：

| 星级 | 标准 |
|---|---|
| 5★ | 完全符合业务设计，影响面清晰可控，无风险 |
| 4★ | 符合设计，影响面基本可控，有轻微注意点 |
| 3★ | 基本符合，存在需关注点但不阻断 |
| 2★ | 存在明显问题（破坏既有流程、边界未处理） |
| 1★ | 严重问题（与业务设计冲突、可能引发数据错误） |

4. **评价描述**（1-3 句）
5. **低星强制补充**：1-2★ 必须给出**至少一条具体问题评价**——引用文件:行号或 diff 片段，指明与业务设计冲突或遗漏之处。一条提交含**多个相互独立的问题**时，同时输出 `issueItems` 数组逐问题列出（每个元素恰对应一个问题，供步骤 ⑥ 按问题拆行登记；同一问题的对比说明保持为一个元素）
6. **与第五章不重叠（口径排除）**：凡属「需完成新增系统标准配置登记 / 系统标准提醒维护 / 代码表缓存配置维护 / PO 表结构（DDL）执行」一类的**数据维护提醒**，已由步骤 ② 检测并在报告第五章「数据库脚本执行提醒」统一承担，**不得**作为 `specificIssue` / `issueItems` 的低星问题条目输出，也不得进入步骤 ⑥ 登记与第五章后的 QQ「低星问题」消息。仅当维护动作背后的**设计选择本身**构成冲突（例如新增开关默认值取 true 使主流程在升级瞬间被禁用）时，以该冲突事实计入问题，措辞不写「需登记/需维护」
7. **测试方式建议**（`testSuggestion`）：基于 diff 实际改动内容与步骤 ③ 的「涉及功能范围」，给出具体的测试建议。要求：
   - **贴合实际改动**：仅建议与本次变更直接相关的测试场景，不得笼统归入大功能模块的全流程测试（如：仅改前端布局 → 建议「验证界面布局显示正常」，不建议「医嘱录入/修改/撤销/提交全流程」；仅改注释 → 建议「确认无功能影响，代码审阅即可」）
   - **标注最低限度**：以「【必测】」前缀标注最低限度测试项
   - **补充关联影响**：当改动涉及上下游接口、跨仓库调用时，补充联调建议
   - **低星追加**：1-2★ 提交追加「⚠️ 低风险提交，重点关注边界场景」
   - 多条建议用中文分号「；」分隔

评估结果落盘为同目录 `evaluations[-<label>].json`（同月多窗口期必须带 `-<label>` 后缀，避免覆盖其他窗口产物）（条目字段：hash / shortHash / subject / author / date / repo / highRiskCategory / impactScope / compliance / complianceReason / rating / evaluation / specificIssue / issueItems——1-2★ 且含多个独立问题时必填的逐问题明细数组 / testSuggestion——基于 diff 实际改动给出的具体测试方式建议），作为步骤 ⑥ 低星问题登记的数据源。

## 步骤 ⑤：归档

写入 `<outputDir>/<YYYY-MM>/commit-report-<YYYY-MM>.md`，结构：

```markdown
# 医生站信创产品迭代周报 — {label}

> 时间窗：{since} ~ {until} · 生成时间：{generatedAt} · 扫描仓库：{reposScanned} 个（有提交：{reposWithCommits}）· 提交总数：{totalCommits}

## 一、概览

### 按提交人分布

| 提交人 | 提交数 |
|--------|--------|
| … | … |

### 按工作站分布

| 工作站 | 提交数 |
|--------|--------|
| … | … |

（按需求类型 / 按优先级同上，各为一个 `###` 小节 + 两列表格）

> 「按提交人分布」小节标题与表格为 push-qq-bot.js 的解析锚点（`/^###\s+按提交人分布/`），改成行内列表会导致 QQ 推送跳过该段落。

## 二、提交明细

| # | 工作站 | 需求类型 | 优先级 | 提交人 | 日期 | 仓库 | 改造内容总结 | 评级 |
|---|---|---|---|---|---|---|---|---|

（BUG修复 / 新功能提交不评级，评级列填 —）

## 三、评估详情（流程修改 / 业务调整）

### {hash 前 8 位} {subject} — {author} · {date} · {repo}

- **命中高风险类别**：{一类：重点业务的流程改造 / 二类：通用接口的改造 / 三类：其他 / 无}
- **影响范围**：…
- **业务设计流程符合性**：{符合 / 部分符合 / 不符合} —— 理由
- **评级**：{N}★ —— 评价：…

## 四、低星问题清单（1-2★）

> 仅列代码 / 设计层面的问题。「需完成系统标准配置登记 / 标准提醒维护 / 代码表缓存配置维护 / PO 表结构（DDL）执行」类数据维护提醒统一由第五章承载，不在本章与步骤 ⑥ 登记中出现（口径见步骤 ④ 第 6 条）。

| 提交 | 星级 | 具体问题（文件:行号 / diff 片段） |
|---|---|---|

## 五、数据库脚本执行提醒

> 由步骤 ② `db-changes-<label>.json` 渲染。开头一行汇总：`本期检测：数据结构修改 N 处 · 新增系统标准配置 N 项 · 新增系统标准提醒 N 条 · 新增代码表缓存配置 N 项`。四小节全为空时整章写「本期无数据库脚本执行提醒」。

### 5.1 数据结构修改（PO）

| 提交 | 提交人 | 表名 | 文件 | 字段变更 |
|---|---|---|---|---|

（字段变更写法：`新增 name(Type, 列)` / `删除 name(Type, 列)`，多项用 `；` 分隔；新建 PO 标注 `新建`）

### 5.2 新增系统标准配置

| 提交 | 提交人 | 配置大类（ST_CODE） | 常量名 | 配置项 | 配置说明 | 检测依据 |
|---|---|---|---|---|---|---|

（检测依据：`docconfig 新增配置读取` / `行内 ST_CODE 字面量`；新增 ST_CODE 大类单列一行，常量名/配置项/配置说明填 —；配置说明取自 JSON `description` 字段，≤80 字）

### 5.3 新增系统标准提醒

| 提交 | 提交人 | 提醒码 | 提醒内容 | 文件:行号 |
|---|---|---|---|---|

（提醒码用 resolvedCode；为空时写 `expr + codeSuffix`。提醒内容为动态取值时写 `（动态）`）

### 5.4 新增代码表缓存配置

| 提交 | 提交人 | PO 类 | 表名 | 方法 | 文件:行号 |
|---|---|---|---|---|---|

（表名为 PO 的 `@TableName` 值——代码表缓存管理按表名维护；仅列 PO 首次使用的行——需要确认代码表缓存配置。缓存按 PO 维护，同一 PO 其他方法共享既有配置；既有缓存的复用调用存于 JSON `cacheReuses`，不列入本章。本节为空写「本期无新增代码表缓存配置。」）

### 5.5 执行方案推荐

> 按上表非空小节逐项输出对应类别的执行方案；四小节全空时本节省略。

- **数据结构修改（PO）**：建议通过【腾讯文档】his 版本升级脚本汇总表格 https://docs.qq.com/sheet/DSnJ5V0tYRG9jT1VL?tab=BB08J2 的登记 DDL 进行执行。
- **新增系统标准配置**：建议打开[信创标准环境](http://82.156.104.202:32678/imedical/his/hos/login)，使用demo账户登录后，打开系统标准配置菜单，筛选出指定的配置项导出文件，并导入到项目现场。
  请勿直接维护，请使用导入功能，防止出现维护错误。
- **新增系统标准提醒**：建议打开[信创标准环境](http://82.156.104.202:32678/imedical/his/hos/login)，使用demo账户登录后，打开系统提示信息，参照代码信息进行数据维护。
- **新增代码表缓存配置**：建议打开[信创标准环境](http://82.156.104.202:32678/imedical/his/hos/login)，使用demo账户登录后，打开代码表缓存管理，参照代码信息进行数据维护。

## 六、附录：深度评估摘要

### {hash} {subject}（命中：{类别}）

- 调用链要点：…
- 结论：…
```

追加索引 `<outputDir>/index.md`（首次创建，之后追加一行）：

```markdown
| {label} | {since} ~ {until} | [commit-report-{label}.md](./{label}/commit-report-{label}.md) | {totalCommits} |
```

归档后在父仓库本地提交（**不推送远端**）：

```bash
git add docs/commit-reports/
git commit -m "docs: 新增 {label} 医生站信创产品迭代周报"
```

## 步骤 ⑥：低星问题登记（报告归档后、推送前）

将本期 1-2★ 低星问题经 tencent_docs MCP 登记到【腾讯文档】信创版产品迭代每周问题登记（https://docs.qq.com/sheet/DWEN5eXB5Q0diYWdI?tab=BB08J2 ，表格身份取自 config `issueRegistration`）：

1. 运行行数据生成脚本（确定性）：`node .agents/plugins/imedicalxc-doctor-commit-report/scripts/build-issue-rows.js <outputDir>/<YYYY-MM>/evaluations[-<label>].json` → 同目录 `issue-rows-<label>.json`（已按 rating ≤ 2 过滤、渲染 9 列目标行值、含 fileId/sheetId；条目含 `issueItems` 时按问题拆为多行，同一提交多行共享同一「提交」值）。期号 label 优先从输入文件名 `evaluations-<label>.json` 解析（同月多窗口场景），无后缀时回退目录名；来源列写 `医生站信创产品迭代周报-<label>`。行内容不得包含第五章类「需登记 / 需维护」提醒（口径见步骤 ④ 第 6 条）。
2. 读取 config `issueRegistration`：不存在或 `enabled=false` → 输出「登记未启用，跳过」，进入步骤 ⑦。
3. MCP 读取目标表：`sheet.get_sheet_info` 获取表容量；`sheet.get_cell_data`（列 A-D、行 0 至容量-1、return_csv=true）读取全表，解析「提交」列各行首 token 的 8 位十六进制短哈希集合（registry）。
4. 过滤：`shortHash` 已在 registry 的行跳过；其余为待写入行。写入起始行 = 表中最后一个非空数据行 + 1（表头占第 0 行，空表从第 1 行开始）。
5. MCP 批量写入：`sheet.set_range_value`（value_type=STRING、0-based 行列；空值单元格跳过不写）；若 起始行 + 行数 超出表容量，先 `sheet.insert_dimension` 扩容再写。
6. 在报告 md 末尾追加「七、低星问题登记」小节：登记表链接、新增 N 行（涉及 C 个提交，短哈希清单）、跳过 M 条（已登记提交）、异常说明。
7. 父仓库本地提交（`git add docs/commit-reports/`，含 issue-rows JSON 与报告 md；不推送远端）。

**失败语义（非阻断）**：`evaluations.json` 缺失或读表失败 → 告警并跳过写入（**禁止盲写**，防止重复登记）；写入失败 → 告警；两种情况均继续步骤 ⑦（推送不受影响）。

登记列取值（9 列）：来源=`医生站信创产品迭代周报-<label>` / 登记日期=实际写入日期 / 星级=`<rating>★` / 提交=`短哈希 [仓库名] 提交标题` / 具体问题=`issueItems` 逐项（每条目一行；无 `issueItems` 时取 specificIssue，空或「无」时兜底 evaluation，均空填 `—`）/ 负责人=提交人 / 完成状态=`未完成` / 完成日期与备注留空。

## 步骤 ⑦：推送

读取 `.agents/plugins/imedicalxc-doctor-commit-report/config/commit-report-push.json`（**本地文件，已被 config/.gitignore 忽略，不入库**；首次使用从 `commit-report-push.template.json` 复制，不存在则视为未配置）：

- `enabled` 为 `false` 或文件不存在 → 输出「推送未配置，跳过」，流程结束
- `enabled` 为 `true` 且 `channel` 为 `qqbot` → 先确认环境变量 `COMMIT_REPORT_QQBOT_TOKEN` 已配置（缺失时脚本会报错并提示维护位置），再执行推送脚本：

```bash
node .agents/plugins/imedicalxc-doctor-commit-report/scripts/push-qq-bot.js <outputDir>/<YYYY-MM>/commit-report-<YYYY-MM>.md
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

1. 生成邮件正文：`node .agents/plugins/imedicalxc-doctor-commit-report/scripts/build-db-email.js <outputDir>/<YYYY-MM>/db-changes-<label>.json [--evaluations=<outputDir>/<YYYY-MM>/evaluations-<label>.json] [--raw-commits=<outputDir>/<YYYY-MM>/raw-commits-<label>.json]`，输出同目录 `db-change-email-<label>.md`（Markdown 存档）与 `db-change-email-<label>.html`（发送用 HTML 正文：标题 + 检测时间窗/生成时间 + 试用阶段说明（「说明：当前为试用运行阶段，更新阶段出现疑问可联系变更负责人咨询。」）+ **第一章功能变更影响**（当提供 `--evaluations` 参数时生成：子章节格式，每条提交独立展示并标注岗位工作站/功能模组/需求类型/提交人/仓库/改造功能点/测试方式建议 7 项，基于 IT形态汇总.xlsx 映射；测试方式建议取自 evaluations JSON 的 `testSuggestion` 字段——由步骤 ④ LLM 基于 diff 实际改动生成，非关键词匹配）+ **第二章数据变更**（含两个子章节：2.1 数据变更明细表（变更类型/变更内容/变更负责人）+ 2.2 数据变更操作说明四子项：DDL 参考【腾讯文档】信创版HIS数据库升级脚本汇总表格、系统提示信息维护、系统标准配置导出导入、代码表缓存管理维护）+ 自动生成页脚，全部内联样式）。
2. 解析收件人/抄送人：`PYTHONIOENCODING=utf-8 python .agents/plugins/imedicalxc-doctor-commit-report/scripts/resolve-email-recipients.py`。
   - 收件人 = 腾讯文档【信创版HIS数据库升级脚本汇总表格】「脚本执行负责人」页签「负责人邮箱」列去重（`email.recipientSource`：bookId/sheetId/emailColumn）
   - 抄送人 = 通讯录分组「信创-研发-医生站」「信创-研发-监督人」成员邮箱去重（`email.ccSource.groups`）
   - 也可用环境变量直接指定（优先于实时解析）：`COMMIT_REPORT_EMAIL_RECIPIENTS` / `COMMIT_REPORT_EMAIL_CC`（逗号分隔）。
   - 脚本把结果写回**本地** `commit-report-push.json` 的 `email.recipients` / `email.cc`（含 `recipientsResolvedAt`，该文件不入库）并输出 JSON 摘要；实时获取失败（如腾讯文档凭证过期、通讯录不可达）→ 自动回退上次解析的缓存结果继续发送，输出 JSON 的 `warnings` 数组标识哪些数据源使用了缓存，cron 执行时应将 warnings 内容输出到日志供排查；无缓存且环境变量未配置时，报错并提示 `COMMIT_REPORT_EMAIL_RECIPIENTS` / `COMMIT_REPORT_EMAIL_CC` 的维护位置。
   - 地址白名单：收件人/抄送人须已在邮箱 MCP 的 `MCP_EMAIL_SERVER_ALLOWED_RECIPIENTS`（`.qoder/settings.local.json`）内；新增执行负责人或分组调整后需同步更新白名单并重载 MCP。
3. 通过邮箱 MCP 调用 `send_email` 工具发送：`account_name` = `email.accountName`（默认 `default`）、`recipients` = 上一步解析结果（`email.recipients`）、`cc` = `email.cc`、`subject` = `email.subject`（统一「信创版功能及数据变更通知」）、`body` = 生成的 html 文件全文、`html` = `true`（HTML 渲染推送，避免客户端显示 markdown 源码）。
4. 发送成功后把 `db-change-email-<label>.md` 与 `db-change-email-<label>.html` 一并提交入库（父仓库本地提交，不推送远端）。
5. 邮箱 MCP 不可用（工具列表无 `send_email`）→ 降级用 stdio 直驱脚本发送：`PYTHONIOENCODING=utf-8 python .qoder/scripts/email-send-via-stdio.py --html <html 文件>`（等价于步骤 3：读 config 收件人/抄送、html=true；凭证运行时读取，不落盘）；仍失败 → 输出告警并继续，不影响 QQ 渠道结果。

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
