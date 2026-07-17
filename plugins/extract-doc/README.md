# extract-doc

`extract-doc` 是文档读取与结构化落盘插件，用于把 PDF、DOC、DOCX、XLS、XLSX 转换为本地文件产物，避免把完整文档塞进会话上下文。

## 能力范围

- 支持 DOCX、PDF、XLSX 的脚本优先解析；安装 `xlrd` 后支持 XLS。
- XLSX/XLS 多 sheet 会按 sheet 拆成独立字段视图。
- 可选使用 MarkItDown 生成辅助 Markdown，不 vendor 第三方源码。
- 默认输出到 `docs/interface/<doc-name>/`，生成 `source.md`、`parsed.json`、`fields.md`、`diagnostics.md`。
- 默认生成通用文档解析产物；业务插件可通过 adapter skill 显式覆盖输出目录和后续处理语义。

## 命令示例

```powershell
python .agents/plugins/extract-doc/scripts/extract-doc-env-check.py --file docs/input/interface.pdf --strict
python .agents/plugins/extract-doc/scripts/extract-doc-ingest.py `
  --file docs/input/interface.xlsx `
  --project-root .
```

上述命令默认写入 `docs/interface/interface/`，其中 `interface` 来自源文档文件名。

如缺少可选解析器：

```powershell
python -m pip install -r .agents/plugins/extract-doc/requirements-optional.txt
```

对话里只汇报输出路径、视图数、字段数、转换器和错误摘要；完整 Markdown、JSON 和字段明细保留在文件中按需读取。

## 已部署项目接入

已部署项目通过常规 `.agents/scripts/update-agents.ps1` 更新即可获得本插件目录；目录存在仅表示 `available`。需要进入项目发现层时，先由 `project-context-maintenance` 执行本插件真实 skill 的验收，再用 `.agents/scripts/update-plugin-profile.ps1 -ProjectRoot . -Plugin extract-doc -Status enabled` 记录启用状态，最后重新运行更新脚本生成 thin-index。
