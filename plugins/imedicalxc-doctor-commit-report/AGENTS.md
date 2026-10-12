# iMedicalXC Doctor Commit Report

`imedicalxc-doctor-commit-report` 是提交记录定时汇总报告插件：确定性采集 + 数据库变更检测 + LLM 语义分析，产出医生站团队的周度提交汇总、变更影响评估与数据库脚本执行提醒报告。

## 插件定位

- 只承载可复用的工作流定义与确定性采集/检测/推送脚本。
- 人员名单、工作站清单、时间窗、输出目录等项目差异写入 `config/commit-report.json`（相对于本插件目录），不硬编码在插件脚本中。

## 使用约束

- 全程只读 git 仓库（log / show），不触发远端上传、编译、数据库写入。
- 推送凭据不落盘明文；推送配置 `config/commit-report-push.json` 本地不入库。
- 评估依赖 `imedicalxc-doctor-business-understanding` 插件做高风险提交的深度链路分析。

## Skill 路由

- 汇总工作流入口：`skills/imedicalxc-doctor-commit-report/SKILL.md`

## 内置脚本

- `scripts/collect-commits.js`：遍历 src/ 下 20 个子仓库，按时间窗 + 11 人白名单过滤并排除 merge，输出 `raw-commits-<YYYY-MM>.json`（UTF-8 无 BOM）。
- `scripts/detect-db-changes.js`：扫描 Java 提交 diff，检测四类数据库脚本执行提醒——PO 数据结构修改、新增系统标准配置（ST_CODE + 配置项）、新增系统标准提醒（HisBusinessException 字典表提醒码，含跨仓库常量链解析）、新增代码表缓存配置（DocCacheUtils PO 首次使用；非首用的复用调用归入 `cacheReuses` 仅存档、不计入提醒；两类缓存记录均解析 PO 的 `@TableName` 表名，供按表名维护的代码表缓存管理使用），输出 `db-changes-<YYYY-MM>.json`。
- `scripts/push-qq-bot.js`：QQ 机器人推送适配器（NapCat/OneBot HTTP API）。读取报告 Markdown 与同目录 `db-changes-<label>.json`，发送开场、提交人分布、数据库脚本执行提醒（四类计数 + 明细 + 执行方案推荐，PO 改走腾讯文档 DDL 登记表格、其余三类经公司标准库 demo 维护）、低星问题清单（@提交人）后上传报告文件。配置见 `config/commit-report-push.json`。
- `scripts/build-db-email.js`：从 `db-changes-<label>.json` 生成数据变更通知邮件正文，双份输出——`db-change-email-<label>.html`（发送用正式排版 HTML，全部内联样式）与 `db-change-email-<label>.md`（Markdown 存档）。正文含第一章变更明细表（变更类型/变更内容/变更负责人）与第二章固定操作说明四子章节。邮件经邮箱 MCP `send_email` 发送（标题固定「信创版数据变更通知-医生站」，`body` 取 html 文件全文、`html` 为 `true`），接收人见 `config/commit-report-push.json` 的 `email` 段。
