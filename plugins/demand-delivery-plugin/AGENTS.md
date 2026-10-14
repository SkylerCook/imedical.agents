# Demand Delivery Plugin

用户要求需求提交信息或明确提交时读取 [demand-commit](skills/demand-commit/SKILL.md)。使用项目已确认的数字需求号、standard/project 类型及精确文件范围；与项目提交规范冲突时停止并说明，不替换项目规范。

不依赖 IRIS 或 BOS。新入口通过项目 plugin profile 接入；更新器按旧能力使用证据迁移项目引用与 owner 启用状态，旧入口已移除。只按明确授权提交，push、部署和验收独立。

脚本使用共享 workspace-context，保留 Overlay 归属、计划完整性、漂移停止、pull 和 hook 门禁。实现只维护在 scripts/commit-demand.js；兼容协议见 [迁移说明](../../docs/demand-delivery-migration.md)。
