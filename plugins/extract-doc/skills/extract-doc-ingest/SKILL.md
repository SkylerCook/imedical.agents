---
name: extract-doc-ingest
description: 当需要把 PDF、DOC、DOCX、XLS 或 XLSX 文档转换为 Markdown 与结构化 JSON，并且不把全文塞入会话上下文时使用。
---

# 文档解析落盘

用于把源文档解析为目标项目本地落盘产物，供后续字段诊断、人工核对或业务插件继续处理。

## 必读

1. 目标项目 `AGENTS.md`
2. 如由业务插件调用，继续读取该业务插件要求的规则或 profile

## 命令

在目标项目根目录执行：

```powershell
python .agents/plugins/extract-doc/scripts/extract-doc-env-check.py --file <document-path> --strict
python .agents/plugins/extract-doc/scripts/extract-doc-ingest.py --file <document-path> --project-root .
```

如调用方需要指定输出目录，显式传入：

```powershell
python .agents/plugins/extract-doc/scripts/extract-doc-ingest.py `
  --file <document-path> `
  --project-root . `
  --output-root docs/output/iris-interface
```

业务调用方如果需要固定 `parsed.json` schema，显式传入 `--schema-version <schema>`；通用默认 schema 为 `extract-doc/v1`。

## 输出契约

每个文档固定写入：

- `<output-root>/<doc-name>/source.md`
- `<output-root>/<doc-name>/parsed.json`
- `<output-root>/<doc-name>/fields.md`
- `<output-root>/<doc-name>/diagnostics.md`

对话里只汇报文件路径、视图数量、字段数量、转换器和错误摘要。不要粘贴转换后的全文，也不要把所有字段明细灌入会话上下文。

遇到缺依赖错误时，给出：

```powershell
python -m pip install -r .agents/plugins/extract-doc/requirements-optional.txt
```
