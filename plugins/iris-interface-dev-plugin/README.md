# iris-interface-dev-plugin

`iris-interface-dev-plugin` 是面向 IRIS 接口开发的文档优先能力包。v1 只做解析审计优先链路：接口文档转换为 Markdown、结构化字段抽取、字段匹配诊断、开发计划和离线审查。

## 能力范围

- 支持 DOCX、PDF、XLSX 的脚本优先解析；安装 `xlrd` 后支持 XLS；`.doc` 通过可选转换器降级处理。
- XLSX/XLS 多 sheet 会按 sheet 拆成独立字段视图，避免只解析首个工作表。
- 可选使用 MarkItDown 生成辅助 Markdown，不 vendor 第三方源码。
- 所有解析产物写入 `docs/output/iris-interface/<doc-name>/`。
- 生成 `source.md`、`parsed.json`、`fields.md`、`diagnostics.md`；字段匹配阶段生成 `field-match.json` 和 `field-match.md`。
- `parsed.json` 使用 `iris-interface-doc-ingest/v2` schema；字段除保留 v1/v1.2 规范字段外，还包含 `rawColumns`、`sourceLocation`、`classification`、`confidence`、`warnings`、`requiredReason` 和 `jsonPathReason`。
- 通过 skill 将 IRIS 编码实现交给 `coding-iris-plugin`。
- 审查生成物中的点号循环体，阻断 `.s`、`.f`、`..d` 等风险输出。

## 标准目录

```text
iris-interface-dev-plugin/
|-- .agents-plugin/
|-- AGENTS.md
|-- README.md
|-- rules/
|-- references/
|-- skills/
|-- templates/
`-- scripts/
```

## 输出约定

```text
docs/output/iris-interface/<doc-name>/
|-- source.md
|-- parsed.json
|-- fields.md
|-- diagnostics.md
|-- field-match.json
`-- field-match.md
```

命令示例：

```powershell
python .agents/plugins/iris-interface-dev-plugin/scripts/iris-interface-doc-ingest.py `
  --file docs/input/interface.xlsx `
  --project-root .

python .agents/plugins/iris-interface-dev-plugin/scripts/iris-interface-field-match.py `
  --parsed docs/output/iris-interface/interface/parsed.json `
  --project-root . `
  --feedback .agents/config/iris-interface-field-feedback.json
```


## 推荐解析流程

1. 先运行环境自检，按文件类型确认缺失依赖和可用降级路径。
2. 如提示缺少可选依赖，按 `requirements-optional.txt` 安装；插件不自动安装依赖。
3. 再运行 `iris-interface-doc-ingest.py`，让脚本按 PDF/DOCX/XLSX/XLS/DOC 分支落盘生成结果。
4. 运行 `iris-interface-field-match.py` 生成字段匹配摘要；如有项目本地反馈，只通过 `--feedback` 读取目标项目本地 JSON。
5. 只读取命令摘要、`diagnostics.md`、`field-match.md`、`parsed.json` 指标和必要的 `fields.md` 片段；不要把转换后的全文塞入会话上下文。
## 环境自检与可选依赖安装

先检查当前 Python 是否能解析目标文档：

```powershell
python .agents/plugins/iris-interface-dev-plugin/scripts/iris-interface-env-check.py --file docs/input/interface.pdf --strict
```

如提示缺少 Python 依赖，再安装可选解析器：

```powershell
python -m pip install -r .agents/plugins/iris-interface-dev-plugin/requirements-optional.txt
```

- 不安装依赖时，XLSX 仍可走标准库解析。
- DOCX/PDF 需要安装对应库。
- XLS 需要 `xlrd`，或用 LibreOffice 手动转为 XLSX。
- DOC 需要 MarkItDown、LibreOffice 或 Pandoc 之一，否则建议手动转 DOCX。

可选解析器自检：

```powershell
python -c "import docx, pdfplumber, openpyxl, xlrd; print('optional parsers ok')"
```
离线审查示例：

```powershell
python .agents/plugins/iris-interface-dev-plugin/scripts/iris-interface-review.py `
  --parsed docs/output/iris-interface/interface/parsed.json `
  --code output/Draft.cls
```

## 接入

首次接入时读取真实 init skill：

```text
.agents/plugins/iris-interface-dev-plugin/skills/iris-interface-init/SKILL.md
```

本插件依赖 `coding-iris-plugin`。如果目标项目未启用 coding 插件，本插件只执行文档解析和字段诊断，不进入 IRIS 编码实现。
