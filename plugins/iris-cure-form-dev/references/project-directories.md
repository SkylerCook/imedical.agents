# 表单目录与恢复契约

默认目录由 owner manifest 的 `projectDirectories` 定义，项目知识库接入和授权流程见[统一目录治理](../../../docs/guides/project-knowledge-layout.md)。

`taskRoot` 优先使用显式 `workRoot`，其次是 profile 的明确 WorkRoot，再保留已有 `docs/work/cure-form/<task>` 任务。新任务在目录治理已接入且本插件 enabled 时使用 `form-work`，否则沿用旧默认。

任务目录包含生成源码、预览和 private 恢复资料；private 继续整体忽略并从预览服务隔离。完成任务后，只把经审核的正式报告和交付材料保存到 `form-delivery`，不把整个 private 或工作目录复制到知识库。开发源码归属由实际 SourceRoot/业务任务决定，目录治理不迁移业务源码。

旧任务、私有快照与显式项目配置保持原位；首次接入、移动旧文件、修改 profile 分别出现在授权计划中。WorkRoot 为 auto 表示使用上述选择规则，不代表可以清理旧任务。
