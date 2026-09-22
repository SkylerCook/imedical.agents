---
name: iris_interface_index
description: Use as the first rule index for IRIS interface document ingestion, field matching diagnostics, implementation planning, and local interface implementation.
task-affinity: [iris, interface, document, extract, fields, planning, implementation]
related:
  - iris_interface_workflow.md
  - iris_interface_review.md
---

# IRIS 接口开发入口

本插件按“解析审计优先”工作，不迁移来源工程的完整代码生成器。

## 路由

- 接口文档转换、Markdown 落盘、结构化 JSON：使用 `iris-interface-doc-ingest`，该 skill 委托 `extract-doc` 执行实际解析。
- 字段匹配覆盖率、未匹配字段和人工反馈草稿：使用 `iris-interface-field-match`。
- 接口实现计划和编码交接：使用 `iris-interface-dev-plan`。
- 已确认计划后的 ObjectScript、JavaScript/CSP 和配置实现：使用 `iris-interface-build`，并加载 `coding-iris-plugin` 的对应编码规则。
- 编译、上传、部署和远端验证：转交 `coding-iris-plugin`，远端写入必须经用户明确授权。

## 上下文边界

Agent 只汇报输出文件路径、摘要、字段数量和错误摘要。完整 Markdown、JSON 或字段表应留在文件中，按需读取。

