# Agent Framework Feedback

## 基本信息

- 日期：2026-07-13
- 提交人：Codex
- 来源需求：#6097879 门诊诊断说明书打印多语言
- canonical 基线：`7bcf8d49bb90aa0dfc710c8d9c66575a02a2e613`
- 状态：已于 2026-07-14 回归 canonical

## 现象与影响

本需求的核心编码改动较小，但实际执行耗时明显偏长，主要由以下流程开销叠加造成：

1. 先输出处理计划，实施阶段才逐步确认远程翻译和 XML 模板写入范围。
2. 前端文件为 UTF-8 BOM，需求中途要求转为 GB2312；后续修改需要经过 UTF-8 临时副本再转回源编码。
3. 需求横跨 frontend、backend、页面翻译 Global 和服务器 XML 打印模板，前半程串行分析，multi-agent 启动偏晚。
4. XML 同步脚本在 Windows PowerShell 5 下因 `ProcessStartInfo.Environment` 兼容性问题失败，随后改用 MCP 读取与写入。
5. 临时目录固定使用 `C:\tmp`，遇到写入异常后增加诊断轮次。
6. 运行 manifest 的阶段时间允许事后补录，文件所有权没有机械校验；最终一次独立验证后又发生 `%TransPage` 改为 `%Trans`、返回结构整合和页面翻译写入，导致原验证结论失效但校验器仍通过。

上述问题会让用户无法在任务开始时判断是否需要授权上传，也使首个真实 multi-agent 样板不能证明 P1 所要求的端到端流程已经跑通。

## 框架判断

这是框架流程和工具兼容性问题，不是单纯需求实现问题：

- i18n workflow 缺少明确的 Step 0 启动契约，未要求 Coordinator 在开始时主动询问一次远程写入授权。
- 远程写入没有区分 `translation-data-write` 与 `business-code-deploy`，容易出现重复询问或授权范围含混。
- manifest 缺少运行模式历史、文件所有权、最后变更时间和验证修订号，无法机械识别中途切换 multi-agent、所有权重叠或 stale verifier。
- XML 同步脚本未兼容 Windows PowerShell 5 的 `ProcessStartInfo.Environment` 行为。

不建议把远程上传改成长期、无边界的默认授权。建议在每项 i18n 需求启动时，由 Coordinator 主动发起一次按环境、页面/模板、语言和动作限定范围的授权确认；本次任务中已经明确授权的范围可直接消费，不重复询问。新增范围、切换环境、覆盖已有数据、删除或回滚必须重新确认。

## 修改内容

### i18n 启动与远程授权

- 在 `i18n-change.workflow.md` 和 `i18n-agent/AGENT.md` 增加 Step 0：任务开始即确定运行模式、建立 manifest、声明文件所有权并主动确认远程动作。
- 将远程动作拆分为 `translation-data-write` 和 `business-code-deploy`。
- 页面 Global、缺失字典翻译、新建 `{Template}-{LANG}` XML 模板可纳入一次性的 `translation-data-write` 授权范围。
- 未获授权时继续完成本地代码和种子文件，不把是否需要上传留给用户猜测。
- 覆盖、删除、回滚、环境或范围变化必须再次确认。
- 明确的打印 i18n 需求从 Step 0 开始并行拆分代码、XML 模板和独立验证；GB2312 临时处理默认使用 `$env:TEMP`。

### manifest 与机械校验

- manifest schema 升级到 `1.1`，增加 `modeHistory`、`ownership`、`lastMutationAt`、`verificationRevision` 和远程动作授权分类/范围。
- 新增 schema 1.1 manifest 模板，要求任务开始时复制并实时记录，非回溯任务不接受重建阶段时间。
- 校验器新增以下失败条件：
  - multi-agent 不是从任务开始启用；
  - 非回溯任务使用重建时间；
  - 不同 actor 的文件所有权重叠；
  - verifier 早于最后一次本地或远程变更；
  - 远程写入缺少授权分类或明确范围。
- 最终验证后的任何变更都会使验证失效，必须重新执行 Verifier 并刷新总结。

### Windows PowerShell 5 兼容

- XML 同步脚本设置子进程环境变量时，优先使用可用的 `Environment`，否则回退到 `EnvironmentVariables`。
- 增加对应兼容性测试，覆盖 Windows PowerShell 5 的回退路径。

### P1 状态

- `#6097879` 记为第一次真实 multi-agent 实战，但存在中途切换、阶段时间回填、所有权未预先声明和最终验证失效等偏差，不能作为 P1 完成依据。
- P1 保持进行中。下一项合适的真实 i18n 需求必须从 Step 0 完整执行：真实时间、预声明所有权、启动时远程授权、全部变更完成后的独立 Verifier 和机械校验。
- `standard-change`、`review-test-release`、`bugfix` workflow 以及通用 `coordinator/explorer/planner/coding/review/testing` Agent，继续等待至少一次不同类型任务样本后再决定。
- 暂不实现复杂运行时调度器和 `scripts/generate-agent-adapters.ps1`。

## 验证

已在 Windows PowerShell 下执行：

- `validate-agent-run.Tests.ps1`：通过；覆盖合法 serial/multi-agent、依赖顺序、未授权远程写入、中途切换 multi-agent、非回溯时间重建、文件所有权重叠、stale verifier 和远程范围缺失。
- `sync-xml-print-template.Tests.ps1`：通过；包含 inline apply 失败后切换 chunked fallback 的既有用例，以及 `ProcessStartInfo` 环境变量兼容用例。
- manifest 模板 JSON 解析和完整性检查：通过；schema 为 `1.1`，包含 7 个规定阶段且无重复。
- 反馈包敏感连接信息扫描：通过；未发现 IP、内嵌凭据 URL 或硬编码 IRIS 连接值。

## 处理建议

已由 owner 审计并将规则、脚本、测试、验证文档和维护记录回归 canonical。下一步选择边界明确的真实 i18n 打印需求作为 P1 标准化运行样本，不使用本次回溯结果替代实战验证。
