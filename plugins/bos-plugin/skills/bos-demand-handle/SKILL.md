---
name: bos-demand-handle
description: 处理已有 BOS 需求号或正文，按项目技术栈调查、实现、审查、验证和验收，并衔接已获授权的提交。
---

# BOS 需求处理

只查详情、待办或历史时使用 [bos-demand-query](../bos-demand-query/SKILL.md)。先有代码再补录 IRIS 标版需求时使用 coding-iris-plugin 的 iris-demand-entry，不倒转本入口。

读取目标 AGENTS、plugin profile 后执行 [bos-demand workflow](../../../../workflows/bos-demand.workflow.md)。目标插件 available/disabled 时说明接入缺口；用户明确接入后使用 bos-init，不因有目录而当作已启用。

输入是当前需求编号、正文或已确认事实，以及目标工作区和原始授权。复用对话中已确认内容，不要求重复提供。普通任务不落盘需求档案；仅用户明确要求交接时调用 task-handoff，正式 run 引用自身状态。

完成输出包括实际修改、证据类型、局限、验收步骤及已执行/待授权的动作。测试通过不表示用户已验收，用户验收不表示已提交或已回写 BOS。
