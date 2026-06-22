---
name: iris_interface_workflow
description: Use when running the seven-step IRIS interface development workflow from document ingest to coding handoff.
task-affinity: [iris, interface, workflow, document, planning]
related:
  - iris_interface_index.md
  - iris_interface_review.md
---

# 接口开发七步流程

1. 接入配置：确认目标项目已接入 `.agents`，接口插件只维护接口文档相关配置。
2. 文档落盘：原始文档转换为 `source.md`，同时写结构化抽取结果。
3. 结构化抽取：抽取视图、字段、类型、长度、必填、备注和表头映射。
4. 字段匹配诊断：使用轻量语义规则、项目本地反馈和按需 wiki 参考生成候选。
5. 接口方案生成：列出接口格式、字段覆盖、待确认项和编码交接事项。
6. IRIS 编码实现：由 `coding-iris-plugin` 的 `iris-coding` 或 `iris-backend-coding` 执行。
7. 验证与回流：接口插件审查字段覆盖和文档一致性；远端动作交给 `coding-iris-plugin`。

## 落盘要求

解析输出固定写入：

- `docs/output/iris-interface/<doc-name>/source.md`
- `docs/output/iris-interface/<doc-name>/parsed.json`
- `docs/output/iris-interface/<doc-name>/fields.md`
- `docs/output/iris-interface/<doc-name>/diagnostics.md`

不得把完整文档内容默认写入对话。

