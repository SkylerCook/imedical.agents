# Demand Delivery Plugin

跨插件阶段依赖以 manifest 的 availableDependencies 为事实源；触发时按[可用性依赖协议](../../docs/plugin-availability.md)检查，缺口仅阻塞对应阶段，显式 disabled 保留。

用户要求需求提交信息或明确提交时读取 [demand-commit](skills/demand-commit/SKILL.md)。使用项目已确认的数字需求号、standard/project 类型及精确文件范围；与项目提交规范冲突时停止并说明，不替换项目规范。

连续人工验收、逐号交付或查询验收/交付编号汇总时，读取 [demand-acceptance](skills/demand-acceptance/SKILL.md)，复用已有台账和授权；默认当前工作区，`--worktree [路径]` 指定跨 worktree 来源，完整参数与接续契约见技能。提交与 BOS 日志继续由各自技能执行。

通用提交与验收索引不依赖 IRIS 或 BOS；选用 BOS 日志阶段时需已接入 bos-plugin。新入口通过项目 plugin profile 接入；更新器按旧能力使用证据迁移项目引用与 owner 启用状态，旧入口已移除。只按明确授权提交，push、部署和验收独立。

脚本使用共享 workspace-context，保留 Overlay 归属、计划完整性、漂移停止、pull 和 hook 门禁。提交实现只维护在 scripts/commit-demand.js；兼容协议见 [迁移说明](../../docs/demand-delivery-migration.md)。
