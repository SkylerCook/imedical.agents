---
name: iris-interface-doc-ingest
description: 当需要把接口 PDF、DOC、DOCX、XLS 或 XLSX 文档转换为 Markdown 与结构化 JSON，并且不把全文塞入会话上下文时使用。
---

# IRIS 接口文档解析

这是 `iris-interface-dev-plugin` 的接口文档解析适配入口。它负责接口开发语义、规则路由和输出目录约定；实际文档读取、格式转换和结构化落盘由 `extract-doc` 插件执行。

## 必读

1. `../../rules/iris_interface_index.md`
2. `../../rules/iris_interface_workflow.md`
3. 目标项目 `AGENTS.md`
4. 目标项目 `.agents/config/iris_interface_profile.md`，如果存在
5. `extract-doc` 插件的 `skills/extract-doc-ingest/SKILL.md`

## 职责

- 固定接口文档解析输出目录为 `docs/output/iris-interface/<doc-name>/`。
- 调用 `extract-doc` 的解析脚本生成 Markdown、结构化 JSON、字段摘要和诊断文件。
- 保证产物可被 `iris-interface-field-match` 和 `iris-interface-dev-plan` 继续读取。
- 对话里只汇报文件路径、视图数量、字段数量、转换器和错误摘要，不粘贴完整文档或完整字段明细。

## 命令

在目标项目根目录执行：

```powershell
python .agents/plugins/extract-doc/scripts/extract-doc-env-check.py --file <document-path> --strict
python .agents/plugins/extract-doc/scripts/extract-doc-ingest.py `
  --file <document-path> `
  --project-root . `
  --output-root docs/output/iris-interface `
  --schema-version iris-interface-doc-ingest/v2
```

## 输出契约

固定写入：

- `docs/output/iris-interface/<doc-name>/source.md`
- `docs/output/iris-interface/<doc-name>/parsed.json`
- `docs/output/iris-interface/<doc-name>/fields.md`
- `docs/output/iris-interface/<doc-name>/diagnostics.md`

`parsed.json` 当前 schema 为 `iris-interface-doc-ingest/v2`，用于兼容 `iris-interface-field-match`。

## 边界

- 不在本 skill 内保存或复制解析实现代码。
- 不做字段语义匹配、不生成开发计划、不进入 IRIS/ObjectScript 编码。
- 不写入服务器地址、账号、密码、token、namespace、远程路径或接口注册事实。
