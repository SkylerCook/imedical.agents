---
name: iris_interface_workflow
description: Use when running the eight-step IRIS interface development workflow from document ingest to coding handoff.
task-affinity: [iris, interface, workflow, document, planning]
related:
  - iris_interface_index.md
  - iris_interface_review.md
---

# 接口开发八步流程

1. 接入配置：确认目标项目已接入 `.agents`，接口插件只维护接口文档相关配置。
2. 文档落盘：原始文档转换为 `source.md`，同时写结构化抽取结果。
3. 结构化抽取：抽取视图、字段、类型、长度、必填、备注和表头映射。
4. 字段匹配诊断：使用轻量语义规则、项目本地反馈和按需 wiki 参考生成候选。
5. 人工确认门禁：字段歧义、低置信候选、类型冲突和目标结构不明确项必须显式确认。
6. 接口方案生成：列出接口格式、字段覆盖、待确认项、编码任务和 coding 插件交接事项。
7. IRIS 编码实现：由 `coding-iris-plugin` 的 `iris-coding`、`iris-backend-coding` 或 `iris-frontend-coding` 执行。
8. 验证与回流：接口插件审查字段覆盖和文档一致性；上传、编译、远端验证和部署交给 `coding-iris-plugin`。

## 落盘要求

解析输出固定写入：

- `docs/interface/<doc-name>/source.md`
- `docs/interface/<doc-name>/parsed.json`
- `docs/interface/<doc-name>/fields.md`
- `docs/interface/<doc-name>/diagnostics.md`

不得把完整文档内容默认写入对话。

## 门禁要求

- 文档解析失败或输出不完整时，不得生成开发计划。
- 字段匹配中必须人工确认的项目，不得由 Agent 自行猜测放行。
- 实施计划未获用户确认时，不得进入编码实现。
- 编码实现必须复用 `coding-iris-plugin`；本插件只提供接口事实、字段映射、计划和审查上下文。

