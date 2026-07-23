# iris-interface-dev

`iris-interface-dev` 是面向 IRIS 接口开发的文档优先能力包。它覆盖接口文档解析适配、字段匹配诊断、开发计划、IRIS 接口实现和离线审查；通用文档转换委托 `extract-doc`，编码规范与部署能力复用 `coding-iris-plugin`。

## 能力范围

- 接口文档解析入口由本插件的 `iris-interface-doc-ingest` skill 承担，实际文档读取、格式转换和结构化抽取委托 `extract-doc`。
- 接口解析产物约定写入 `docs/interface/<doc-name>/`。
- 生成 `source.md`、`parsed.json`、`fields.md`、`diagnostics.md`；字段匹配阶段生成 `field-match.json` 和 `field-match.md`。
- `parsed.json` 使用 `iris-interface-doc-ingest/v2` schema；字段除保留 v1/v1.2 规范字段外，还包含 `rawColumns`、`sourceLocation`、`classification`、`confidence`、`warnings`、`requiredReason` 和 `jsonPathReason`。
- `iris-interface-build` 负责把已确认的接口契约实现为 ObjectScript、JavaScript/CSP 和配置说明，并按接入管理、统一注册调度、只读 Query 三种机制路由。
- 编译、上传、部署和远端验证交给 `coding-iris-plugin`，且仍需用户明确授权远端写入。
- 审查生成物中的点号循环体，阻断 `.s`、`.f`、`..d` 等风险输出。

## 标准目录

```text
iris-interface-dev/
|-- .agents-plugin/
|-- AGENTS.md
|-- README.md
|-- rules/
|-- references/
|-- skills/
|-- templates/
`-- scripts/
```

文档解析命令示例：

```powershell
python .agents/plugins/extract-doc/scripts/extract-doc-ingest.py `
  --file docs/input/interface.xlsx `
  --project-root . `
  --output-root docs/interface `
  --schema-version iris-interface-doc-ingest/v2

python .agents/plugins/iris-interface-dev/scripts/iris-interface-field-match.py `
  --parsed docs/interface/interface/parsed.json `
  --project-root . `
  --feedback .agents/config/iris-interface-field-feedback.json
```


## 推荐解析流程

1. 先运行 `extract-doc` 环境自检，按文件类型确认缺失依赖和可用降级路径。
2. 如提示缺少可选依赖，按 `extract-doc/requirements-optional.txt` 安装；插件不自动安装依赖。
3. 再运行 `extract-doc-ingest.py`，让脚本按 PDF/DOCX/XLSX/XLS/DOC 分支落盘生成结果。
4. 运行 `iris-interface-field-match.py` 生成字段匹配摘要；如有项目本地反馈，只通过 `--feedback` 读取目标项目本地 JSON。
5. 只读取命令摘要、`diagnostics.md`、`field-match.md`、`parsed.json` 指标和必要的 `fields.md` 片段；不要把转换后的全文塞入会话上下文。

## 环境自检与可选依赖安装

先检查当前 Python 是否能解析目标文档：

```powershell
python .agents/plugins/extract-doc/scripts/extract-doc-env-check.py --file docs/input/interface.pdf --strict
```

如提示缺少 Python 依赖，再安装可选解析器：

```powershell
python -m pip install -r .agents/plugins/extract-doc/requirements-optional.txt
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
python .agents/plugins/iris-interface-dev/scripts/iris-interface-review.py `
  --parsed docs/interface/interface/parsed.json `
  --code output/Draft.cls
```

## 接入

首次接入时读取真实 init skill：

```text
.agents/plugins/iris-interface-dev/skills/iris-interface-init/SKILL.md
```

本插件依赖 `extract-doc` 和 `coding-iris-plugin`。如果目标项目未启用 coding 插件，本插件只执行文档解析委托、解析产物读取和字段诊断，不进入 IRIS 编码实现。

常用 skill：

- `iris-interface-init`
- `iris-interface-doc-ingest`
- `iris-interface-field-match`
- `iris-interface-dev-plan`
- `iris-interface-build`

已部署项目更新插件后，需要重新运行本插件 thin-index wrapper，才能让只发现浅层 skill 的 Agent 识别 `iris-interface-build`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/plugins/iris-interface-dev/scripts/generate-plugin-thin-index.ps1 `
  -PluginPath .agents/plugins/iris-interface-dev `
  -ProjectRoot . `
  -Mode Write
```
