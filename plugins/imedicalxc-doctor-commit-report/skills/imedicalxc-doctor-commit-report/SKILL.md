---
name: imedicalxc-doctor-commit-report
description: |
  HIS 医生站提交记录定时汇总报告。采集 src/ 下 20 个子仓库在指定时间窗内 11 位医生站同事的 git 提交，输出五要素汇总（岗位工作站 / 需求类型 / 优先级 / 提交人 / 改造内容总结），对【流程修改 / 业务调整】类提交做混合式评估（轻量全覆盖 + 高风险三类自动升级深度评估，1-5 星评级，1-2★ 必须给出至少一条具体问题评价），并自动检测数据库脚本执行提醒（PO 数据结构修改 / 新增系统标准配置 / 新增系统标准提醒 / 新增代码表缓存配置），归档 Markdown 报告并按配置尝试推送。用于月度定时汇总或按需汇总提交记录。
triggers:
  - 提交汇总
  - 提交记录汇总
  - 月度提交报告
  - 提交报告
  - 汇总提交记录
role: workflow
scope: local
priority: high
---

# 提交记录定时汇总报告 — 工作流

六步串行执行：① 采集 → ② 数据库变更检测 → ③ 分类 → ④ 评估 → ⑤ 归档 → ⑥ 推送。每步完成后再进入下一步。

**开始前必读**：`.agents/plugins/imedicalxc-doctor-commit-report/config/commit-report.json` —— 人员白名单（reporters）、岗位工作站清单（workstations）、时间窗（window）、输出目录（outputDir）。

## 步骤 ①：采集（确定性脚本）

时间窗默认近 1 个完整自然月：

```bash
node .agents/plugins/imedicalxc-doctor-commit-report/scripts/collect-commits.js --months 1
```

自定义窗口（尽量对齐自然月）：`--since 2026-09-01 --until 2026-10-01`。

产出 `<outputDir>/<YYYY-MM>/raw-commits-<YYYY-MM>.json`，每条提交含 repo / hash / author（映射后中文名）/ authorRaw / date / subject / files / additions / deletions。检查 `meta.errors`：非空时先向用户报告错误仓库（错误不阻断整体），再继续。

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
5. **低星强制补充**：1-2★ 必须给出**至少一条具体问题评价**——引用文件:行号或 diff 片段，指明与业务设计冲突或遗漏之处

## 步骤 ⑤：归档

写入 `<outputDir>/<YYYY-MM>/commit-report-<YYYY-MM>.md`，结构：

```markdown
# 提交记录汇总报告 — {label}

> 时间窗：{since} ~ {until} · 生成时间：{generatedAt} · 扫描仓库：{reposScanned} 个（有提交：{reposWithCommits}）· 提交总数：{totalCommits}

## 一、概览

- 按提交人分布：…
- 按工作站分布：…
- 按需求类型分布：…
- 按优先级分布：…

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

| 提交 | 星级 | 具体问题（文件:行号 / diff 片段） |
|---|---|---|

## 五、数据库脚本执行提醒

> 由步骤 ② `db-changes-<label>.json` 渲染。开头一行汇总：`本期检测：数据结构修改 N 处 · 新增系统标准配置 N 项 · 新增系统标准提醒 N 条 · 新增代码表缓存配置 N 项`。四小节全为空时整章写「本期无数据库脚本执行提醒」。

### 5.1 数据结构修改（PO）

| 提交 | 提交人 | 表名 | 文件 | 字段变更 |
|---|---|---|---|---|

（字段变更写法：`新增 name(Type, 列)` / `删除 name(Type, 列)`，多项用 `；` 分隔；新建 PO 标注 `新建`）

### 5.2 新增系统标准配置

| 提交 | 提交人 | 配置大类（ST_CODE） | 常量名 | 配置项 | 检测依据 |
|---|---|---|---|---|---|

（检测依据：`docconfig 新增配置读取` / `行内 ST_CODE 字面量`；新增 ST_CODE 大类单列一行，常量名/配置项填 —）

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
- **新增系统标准配置**：建议打开公司标准库，登录 demo，打开系统标准配置菜单，筛选出指定的配置项进行导出，并导入到项目现场。
- **新增系统标准提醒**：建议打开公司标准库，登录 demo，打开系统标准提醒信息，参照代码信息进行数据维护。
- **新增代码表缓存配置**：建议打开公司标准库，登录 demo，打开代码表缓存管理，参照代码信息进行数据维护。

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
git commit -m "docs: 新增 {label} 提交记录汇总报告"
```

## 步骤 ⑥：推送

读取 `.agents/plugins/imedicalxc-doctor-commit-report/config/commit-report-push.json`（不存在则视为未配置）：

- `enabled` 为 `false` 或文件不存在 → 输出「推送未配置，跳过」，流程结束
- `enabled` 为 `true` 且 `channel` 为 `qqbot` → 执行推送脚本：

```bash
node .agents/plugins/imedicalxc-doctor-commit-report/scripts/push-qq-bot.js <outputDir>/<YYYY-MM>/commit-report-<YYYY-MM>.md
```

推送内容（QQ 群消息）：
1. 【按提交人分布】—— 一条文本消息，含日期范围和各提交人占比
2. 【数据库脚本执行提醒】—— 一条文本消息（自动读取同目录 `db-changes-<label>.json`）：四类计数 + 明细摘要（新增配置的 ST_CODE/配置项、提醒码、首用 PO）+ 执行方案推荐 + 试用阶段说明（「说明：当前为试用运行阶段，更新阶段出现疑问可联系变更负责人咨询。」），@ 涉及提交人；四类全为 0 时发「本期无数据库脚本执行提醒」
3. 【低星问题清单】—— 每条低星问题单独一条文本消息，@ 对应提交人（通过群成员列表匹配群昵称）；匹配不到则提示「未找到「XXX」群成员」并 @ 群管理员
4. 低星问题 > 5 条时，补充一条「低星问题过多，详情参考报告」
5. 报告 Markdown 文件 —— 以群文件方式上传（base64 编码）

### 邮件通道（`email` 段 `enabled` 为 `true` 时）

数据变更通知邮件（正文为正式排版的 HTML，另存 Markdown 存档），流程：

1. 生成邮件正文：`node .agents/plugins/imedicalxc-doctor-commit-report/scripts/build-db-email.js <outputDir>/<YYYY-MM>/db-changes-<label>.json`，输出同目录 `db-change-email-<label>.md`（Markdown 存档）与 `db-change-email-<label>.html`（发送用 HTML 正文：标题 + 检测时间窗/生成时间 + 试用阶段说明（「说明：当前为试用运行阶段，更新阶段出现疑问可联系变更负责人咨询。」）+ 第一章变更明细表（变更类型/变更内容/变更负责人）+ 第二章固定操作说明四子章节：DDL 参考【腾讯文档】信创版HIS数据库升级脚本汇总表格、系统提醒信息维护、系统标准配置导出导入、代码表缓存管理维护 + 自动生成页脚，全部内联样式）。
2. 解析收件人/抄送人：`PYTHONIOENCODING=utf-8 python .agents/plugins/imedicalxc-doctor-commit-report/scripts/resolve-email-recipients.py`。
   - 收件人 = 腾讯文档【信创版HIS数据库升级脚本汇总表格】「脚本执行负责人」页签「负责人邮箱」列去重（`email.recipientSource`：bookId/sheetId/emailColumn）
   - 抄送人 = 通讯录分组「信创-研发-医生站」「信创-研发-监督人」成员邮箱去重（`email.ccSource.groups`）
   - 脚本把结果写回 `email.recipients` / `email.cc`（含 `recipientsResolvedAt`）并输出 JSON 摘要；解析失败（如腾讯文档凭证过期、通讯录不可达）→ 输出告警，沿用 config 中上次解析结果继续发送。
   - 地址白名单：收件人/抄送人须已在邮箱 MCP 的 `MCP_EMAIL_SERVER_ALLOWED_RECIPIENTS`（`.qoder/settings.local.json`）内；新增执行负责人或分组调整后需同步更新白名单并重载 MCP。
3. 通过邮箱 MCP 调用 `send_email` 工具发送：`account_name` = `email.accountName`（默认 `default`）、`recipients` = `email.recipients`（列表）、`cc` = `email.cc`（列表）、`subject` = `email.subject`（统一「信创版数据变更通知-医生站」）、`body` = 生成的 html 文件全文、`html` = `true`（HTML 渲染推送，避免客户端显示 markdown 源码）。
4. 发送成功后把 `db-change-email-<label>.md` 与 `db-change-email-<label>.html` 一并提交入库（父仓库本地提交，不推送远端）。
5. 邮箱 MCP 不可用（工具列表无 `send_email`）或发送失败 → 输出告警并继续，不影响 QQ 渠道结果。

## 约束

- 全程只读 git（log / show）；不推送远端、不编译、不写数据库。
- 11 人白名单过滤在采集脚本内完成，评估阶段不再扩大范围。
- 名单外作者（cuixy、Codex 等）的提交不纳入报告。
