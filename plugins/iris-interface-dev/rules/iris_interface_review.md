---
name: iris_interface_review
description: Use when reviewing IRIS interface parsed artifacts, field coverage, or generated code risk before coding handoff.
task-affinity: [iris, interface, review, fields, objectscript]
related:
  - iris_interface_index.md
  - iris_interface_workflow.md
---

# 接口离线审查规则

## 字段产物审查

- `parsed.json` 必须包含视图和字段数量。
- `fields.md` 必须能追溯每个字段的代码、名称、类型、长度、必填和备注。
- `diagnostics.md` 必须列出未匹配字段、人工确认项和下一步交接。

## 生成代码风险审查

v1 不迁移来源工程大生成器。若后续存在生成代码草稿，必须先运行离线审查。

以下点号循环体必须失败：

- 行首为 `.s`、`.f`、`.i`、`.q`、`.d`
- 行首为 `..s`、`..f`、`..i`、`..q`、`..d`
- 点号循环中混入字段赋值或 `Do` 标签调用

通过审查不代表代码可编译；ObjectScript 规范和远端验证仍由 `coding-iris-plugin` 负责。

