---
name: iris-interface-doc-ingest
description: 当需要把接口 DOCX、PDF、XLSX 或 DOC 文档转换为 Markdown 与结构化 JSON，并且不把全文塞入会话上下文时使用。
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
python plugins/iris-interface-dev-plugin/scripts/iris-interface-doc-ingest.py --file <document-path> --project-root <target-project>
```

## 输出契约

每个文档固定写入：

- `docs/output/iris-interface/<doc-name>/source.md`
- `docs/output/iris-interface/<doc-name>/parsed.json`
- `docs/output/iris-interface/<doc-name>/fields.md`
- `docs/output/iris-interface/<doc-name>/diagnostics.md`

对话里只汇报文件路径、视图数量、字段数量、转换器和错误摘要。不要粘贴转换后的全文，也不要把所有字段明细灌入会话上下文。
遇到缺依赖错误时，优先提示用户按 `requirements-optional.txt` 安装可选解析依赖，不要把文档内容塞进会话上下文重试。

## 转换策略

- 默认优先使用插件内可控脚本链解析 DOCX、PDF 和 XLSX。
- MarkItDown 仅作为可选辅助转换器；可用时增加 Markdown 转换能力，不改变结构化 JSON schema。
- 不 vendor MarkItDown 源码，不把 MarkItDown 作为唯一链路。
- `.doc` 只走可选降级链；缺少 MarkItDown、LibreOffice 或 Pandoc 时，明确提示用户手动转为 DOCX。

