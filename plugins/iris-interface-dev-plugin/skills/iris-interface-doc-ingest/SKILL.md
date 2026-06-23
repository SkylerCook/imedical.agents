---
name: iris-interface-doc-ingest
description: 当需要把接口 PDF、DOC、DOCX、XLS 或 XLSX 文档转换为 Markdown 与结构化 JSON，并且不把全文塞入会话上下文时使用。
---

# IRIS 接口文档解析

用于把接口文档解析为目标项目本地落盘产物，供后续字段匹配、诊断和开发计划使用。

## 必读

1. `../../rules/iris_interface_index.md`
2. `../../rules/iris_interface_workflow.md`
3. 目标项目 `AGENTS.md`
4. 目标项目 `.agents/config/iris_interface_profile.md`，如果存在

## 命令

在目标项目根目录执行：

```powershell
python .agents/plugins/iris-interface-dev-plugin/scripts/iris-interface-doc-ingest.py --file <document-path> --project-root .
```

在本能力包仓库内验证时执行：

```powershell
python plugins/iris-interface-dev-plugin/scripts/iris-interface-env-check.py --file <document-path> --strict
python plugins/iris-interface-dev-plugin/scripts/iris-interface-doc-ingest.py --file <document-path> --project-root <target-project>
```


## 按文件类型处理

解析前先运行环境自检，不按统一路径猜测格式：

```powershell
python .agents/plugins/iris-interface-dev-plugin/scripts/iris-interface-env-check.py --file <document-path> --strict
```

- PDF：确认 `pdfplumber` 可用后再解析。解析后重点检查 `diagnostics.md` 和 `fields.md` 中的章节标题、表内分段、跨页续表、`jsonPath` 数量与 `request.*` / `response.*` 归属。
- DOCX：确认 `python-docx` 可用。解析 Word 段落和表格，验收重点是表格是否生成字段 view、段落是否进入 `source.md`。
- XLSX：确认 `openpyxl` 可用；未安装时脚本可走标准库降级。多 sheet 必须按每个 sheet 独立生成 view，验收 `parsed.json` 的 view 数和各 sheet 字段数。
- XLS：确认 `xlrd` 可用。缺失时提示安装可选依赖，或让用户用 LibreOffice/Excel 另存为 XLSX 后重试。
- DOC：确认 MarkItDown、LibreOffice 或 Pandoc 至少一个可用。缺失时提示安装转换器或手动另存为 DOCX；不要把 DOC 全文复制到会话上下文中尝试解析。

## 输出契约

每个文档固定写入：

- `docs/output/iris-interface/<doc-name>/source.md`
- `docs/output/iris-interface/<doc-name>/parsed.json`
- `docs/output/iris-interface/<doc-name>/fields.md`
- `docs/output/iris-interface/<doc-name>/diagnostics.md`

对话里只汇报文件路径、视图数量、字段数量、转换器和错误摘要。不要粘贴转换后的全文，也不要把所有字段明细灌入会话上下文。
解析前优先运行 `iris-interface-env-check.py --file <document-path> --strict`。遇到缺依赖错误时，给出 `python -m pip install -r .agents/plugins/iris-interface-dev-plugin/requirements-optional.txt` 或仓库内对应命令，不要把文档内容塞进会话上下文重试。

## 转换策略

- 默认优先使用插件内可控脚本链解析 DOCX、PDF、XLSX；安装 `xlrd` 后支持 XLS。
- MarkItDown 仅作为可选辅助转换器；可用时增加 Markdown 转换能力，不改变结构化 JSON schema。
- 不 vendor MarkItDown 源码，不把 MarkItDown 作为唯一链路。
- `.doc` 只走可选降级链；缺少 MarkItDown、LibreOffice 或 Pandoc 时，明确提示用户手动转为 DOCX。




