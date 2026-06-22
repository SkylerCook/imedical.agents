---
name: iris-interface-field-match
description: 当需要对已解析字段做语义归一化、候选匹配、未匹配诊断和人工反馈草稿时使用。
---

# IRIS 接口字段匹配

用于在 `iris-interface-doc-ingest` 产出 `parsed.json` 和 `fields.md` 后，对字段做离线诊断和人工确认准备。

## 必读

1. `../../rules/iris_interface_index.md`
2. `../../rules/iris_interface_workflow.md`
3. `../../rules/iris_interface_review.md`
4. 目标项目本地字段反馈，如果存在

只有遇到具体字段语义问题时，才按需读取 `../../references/wiki/` 中的相关条目。不要默认加载整个 wiki。

## 职责

- 归一化字段代码、中文名、类型、长度、必填标记和备注。
- 输出候选语义匹配、置信度和证据。
- 按缺少代码、中文名歧义、类型冲突、本地反馈缺失等类别列出未匹配原因。
- 生成目标项目本地人工反馈草稿。

## 边界

- 不把业务项目私有事实写入本插件仓库。
- 未经评审，不把项目本地反馈提升为插件通用规则。
- 不把大体量 wiki、接口索引、MOC 或历史规则库放进默认上下文。

## 输出

诊断和反馈草稿写入目标项目输出目录。对话里只汇报路径、数量和最高优先级人工确认项。
