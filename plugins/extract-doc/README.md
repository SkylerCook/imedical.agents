# extract-doc

本插件所有自有 skill 的帮助请求（`--help`、查看用法）先按[统一帮助协议](../../docs/guides/capability-help.md)展示帮助并结束，优先于插件启用、连接检查和业务前置。源定义随正常能力包更新分发，已有 thin-index 继续读取 source；帮助不自动启用插件。

`extract-doc` 是文档读取与结构化落盘插件，用于把 PDF、DOC、DOCX、XLS、XLSX 转换为本地文件产物，避免把完整文档塞进会话上下文。

## 能力范围

- 支持 DOCX、PDF、XLSX 的脚本优先解析；安装 `xlrd` 后支持 XLS。
- XLSX/XLS 多 sheet 会按 sheet 拆成独立字段视图。
- 可选使用 MarkItDown 生成辅助 Markdown，不 vendor 第三方源码。
- 输出目录按[输出契约](skills/extract-doc-ingest/SKILL.md#输出契约)解析，生成 `source.md`、`parsed.json`、`fields.md`、`diagnostics.md`。
- 传入 `--emit-structure` 时额外生成 `structure.json`（`extract-doc/structure-v1`），保留 DOCX 合并单元格、XLSX 单元格/公式/合并区域、PDF 页面文本层和图片事实。
- 默认生成通用文档解析产物；业务插件可通过 adapter skill 显式覆盖输出目录和后续处理语义。

## 命令示例

```powershell
python .agents/plugins/extract-doc/scripts/extract-doc-env-check.py --file docs/input/interface.pdf --strict
python .agents/plugins/extract-doc/scripts/extract-doc-ingest.py `
  --file docs/input/interface.xlsx `
  --project-root . `
  --emit-structure
```

上述命令在未接入目录治理时写入 `docs/interface/interface/`；接入后使用 owner 声明的文档目录。`interface` 来自源文档文件名，现有产物保留原位置。

如缺少可选解析器：

```powershell
python -m pip install -r .agents/plugins/extract-doc/requirements-optional.txt
```

对话里只汇报输出路径、视图数、字段数、转换器、是否需要视觉提取和错误摘要；完整 Markdown、JSON 和字段明细保留在文件中按需读取。

## 已部署项目接入

已部署项目通过常规 `.agents/scripts/update-agents.ps1` 更新即可获得本插件目录；目录存在仅表示 `available`。需要进入项目发现层时，先由 `project-context-maintenance` 执行本插件真实 skill 的验收，再用 `.agents/scripts/update-plugin-profile.ps1 -ProjectRoot . -Plugin extract-doc -Status enabled` 记录启用状态，最后重新运行更新脚本生成 thin-index。
