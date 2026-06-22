# iris-interface-dev-plugin

`iris-interface-dev-plugin` 是面向 IRIS 接口开发的文档优先能力包。v1 只做解析审计优先链路：接口文档转换为 Markdown、结构化字段抽取、字段匹配诊断、开发计划和离线审查。

## 能力范围

- 支持 DOCX、PDF、XLSX 的脚本优先解析；`.doc` 通过可选转换器降级处理。
- 可选使用 MarkItDown 生成辅助 Markdown，不 vendor 第三方源码。
- 所有解析产物写入 `docs/output/iris-interface/<doc-name>/`。
- 生成 `source.md`、`parsed.json`、`fields.md`、`diagnostics.md`。
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
`-- diagnostics.md
```

命令示例：

```powershell
python .agents/plugins/iris-interface-dev-plugin/scripts/iris-interface-doc-ingest.py `
  --file docs/input/interface.xlsx `
  --project-root .
```

## 可选依赖安装

```powershell
pip install -r .agents/plugins/iris-interface-dev-plugin/requirements-optional.txt
```

- 不安装依赖时，XLSX 仍可走标准库解析。
- DOCX/PDF 需要安装对应库。
- DOC 需要 MarkItDown、LibreOffice 或 Pandoc 之一，否则建议手动转 DOCX。

可选解析器自检：

```powershell
python -c "import docx, pdfplumber, openpyxl; print('optional parsers ok')"
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


