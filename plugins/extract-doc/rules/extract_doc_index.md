---
name: extract_doc_index
description: Use when converting documents into local Markdown and structured JSON artifacts without loading full source documents into conversation context.
task-affinity: [document, extract, markdown, json, pdf, docx, xlsx]
---

# 文档解析边界

`extract-doc` 只负责读取本地源文档并生成目标项目本地文件产物。

## 硬约束

- 不把完整源文档、完整转换后 Markdown 或完整字段明细默认塞进会话上下文。
- 对话里只汇报输出路径、转换器、视图数、字段数和错误摘要。
- `.doc` 文件缺少转换器时提示用户另存为 DOCX，不在会话中尝试复制全文解析。
- 不写入服务器地址、账号、密码、token、namespace、远程路径或项目私有连接事实。

## 产物

默认输出目录为 `docs/interface/<doc-name>/`，产物为：

- `source.md`
- `parsed.json`
- `fields.md`
- `diagnostics.md`
