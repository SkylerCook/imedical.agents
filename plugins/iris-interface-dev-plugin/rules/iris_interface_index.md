---
name: iris_interface_index
description: Use as the first rule index for IRIS interface document ingestion, field matching diagnostics, and implementation planning.
task-affinity: [iris, interface, document, extract, fields, planning]
related:
  - iris_interface_workflow.md
  - iris_interface_review.md
---

# IRIS 接口开发入口

本插件按“解析审计优先”工作，不迁移来源工程的完整代码生成器。

## 路由

- 接口文档转换、Markdown 落盘、结构化 JSON：使用 `iris-interface-doc-ingest`。
- 字段匹配覆盖率、未匹配字段和人工反馈草稿：使用 `iris-interface-field-match`。
- 接口实现计划和编码交接：使用 `iris-interface-dev-plan`。
- ObjectScript 编码、审查、上传、编译、部署：转交 `coding-iris-plugin`。

## 上下文边界

Agent 只汇报输出文件路径、摘要、字段数量和错误摘要。完整 Markdown、JSON 或字段表应留在文件中，按需读取。

