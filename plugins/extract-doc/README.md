# extract-doc

`extract-doc` 是文档读取与结构化落盘插件，用于把 PDF、DOC、DOCX、XLS、XLSX 转换为本地文件产物，避免把完整文档塞进会话上下文。

## 能力范围

- 支持 DOCX、PDF、XLSX 的脚本优先解析；安装 `xlrd` 后支持 XLS。
- XLSX/XLS 多 sheet 会按 sheet 拆成独立字段视图。
- 可选使用 MarkItDown 生成辅助 Markdown，不 vendor 第三方源码。
- 生成 `source.md`、`parsed.json`、`fields.md`、`diagnostics.md`。
- 默认生成通用文档解析产物；业务插件可通过 adapter skill 固定输出目录和后续处理语义。

## 命令示例

```powershell
python .agents/plugins/extract-doc/scripts/extract-doc-env-check.py --file docs/input/interface.pdf --strict
python .agents/plugins/extract-doc/scripts/extract-doc-ingest.py `
  --file docs/input/interface.xlsx `
  --project-root .
```

如缺少可选解析器：

```powershell
python -m pip install -r .agents/plugins/extract-doc/requirements-optional.txt
```

对话里只汇报输出路径、视图数、字段数、转换器和错误摘要；完整 Markdown、JSON 和字段明细保留在文件中按需读取。
