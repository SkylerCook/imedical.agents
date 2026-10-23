---
name: bos-demand-handle
description: 处理已有 BOS 需求号或正文，复用项目已启用领域能力，按需求范围调查、实现、审查、验证和验收；衔接已授权的提交，校验成功后准备并按授权补录 BOS 代码更新日志。支持 --night 或自然语言夜跑入口。
---

# BOS 需求处理

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

按[代码归属协议](../../../../docs/demand-code-ownership.md)处理主子需求及明确无代码条目：验收范围分别记录，共享代码只提交主需求；主子各自日志复用真实主提交，none跳过代码交付阶段并保留原因。先完成该判断，再加载日志配置或索取凭据。

进入通用提交或连续验收前，按[可用性依赖协议](../../../../docs/plugin-availability.md)检查调用方 bos-plugin 的 demand-commit 或 demand-acceptance 阶段；缺口只阻塞对应阶段。

只查详情、待办或历史时使用 [bos-demand-query](../bos-demand-query/SKILL.md)。先有代码再补录标版需求时使用 [bos-demand-entry](../bos-demand-entry/SKILL.md)，不倒转本入口。

读取目标 AGENTS、plugin profile 后执行 [bos-demand workflow](../../../../workflows/bos-demand.workflow.md)，简单需求按其中的串行路径连续处理，领域技能按范围直达，正式协作资料按条件加载。bos-plugin 为 available/disabled 时说明接入缺口，用户明确接入后使用 bos-init；其它领域插件未启用时使用其自身初始化入口，只阻塞依赖该能力的阶段。不因有目录而当作已启用。

输入是当前需求编号、正文或已确认事实，以及目标工作区和原始授权。复用对话中已确认内容，不要求重复提供。普通任务不落盘需求档案；仅用户明确要求交接时调用 task-handoff，正式 run 引用自身状态。

## 夜跑入口

新批次执行 [事前治理](../../../../docs/night-governance.md)：由 Agent 生成结构化 executionPlan、周额度基线和逐需求最低测试；批准后在独立 worktree materialize 实体 PLAN，再以角色分片上下文实际派发。核实至少两个 Developer 的并发与两个 Tester 分工，治理和人工负担计入总成本。缺必要并发、用量或停止能力时保留具体缺口，不能静默按单开发或全量 UI 执行。

需要单 Agent 降级时，读取[退出夜跑转受监督串行契约](../../../../workflows/bos-demand-unattended.workflow.md#单-agent-降级)，在确认范围、核对遗留资源并完成独立工作区检查后进入普通处理。

`$bos-demand-handle --night` 是本技能的显式夜跑选择，不是交给 BOS 查询脚本的 CLI 参数。也接受“今晚处理这些需求”“批量夜跑”等明确自然语言请求；未指定夜跑时继续普通单需求流程。

命中夜跑后执行 [BOS 夜跑 workflow](../../../../workflows/bos-demand-unattended.workflow.md)。从当前请求和既有上下文取得需求编号或查询范围、目标工程、截止、授权及人工留项策略，由 Agent 生成和维护目标工程的批次、策略及编排输入，用户无需手填 JSON。先核实已有配置与事实，仅集中询问仍缺少且影响执行的业务决定；批次文件本身不产生授权。

`--night` 只选择流程，不额外授予提交、推送、部署、测试数据写入或 BOS 写入权限，也不自动启用插件、创建多会话或启动后台服务。已有明确授权继续有效。此入口创建的新批次显式设置 `decisionPolicyReference`，并按夜跑 workflow 准备工作区预检与宿主额度策略；恢复旧批次保持原约定，不静默增添策略。

示例：`$bos-demand-handle --night 12345,12346`，再用自然语言说明本轮时间和已授权范围；也可直接复用本对话已确认的这些事实。

新夜跑先按 workflow 集中取得缺失授权并完成真实预检，统一使用一个 schema 2.1 run；运行中挂起权限/能力异常或计划外动作，不发起新授权问题。多编号查询仍逐号执行，连接前提失败后先诊断；具体契约和普通 2.0 兼容见 workflow 引用的决策接口。

实施前按 workflow 的“入口、输入与事实”核对完整标题、描述及媒体，主动读取影响需求理解的截图和附件；不等待用户单独要求看图或分析附件。已有读取证据可复用，关键资料无法读取时按该流程处理缺口。

全部本地提交校验成功后，按 workflow 的“提交后的 BOS 代码更新日志”复用本次仓库与 hash，自动调用 [bos-code-update-log](../bos-code-update-log/SKILL.md) 准备计划。展示具体计划后复用明确的 BOS 补录预授权；普通处理缺少授权时可请求一次，2.1 夜跑缺少启动前授权则保留交接。配置缺失、拒绝或接口失败只保留日志待办，恢复时核对已有结果。

完成输出包括实际修改、证据类型、局限、验收步骤及已执行/待授权的动作，分别报告本地提交与 BOS 日志结果。测试通过不表示用户已验收，用户验收不表示已提交；日志补录也不改变 BOS 需求状态。
