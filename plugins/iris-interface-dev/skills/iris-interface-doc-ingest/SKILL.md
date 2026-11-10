---
name: iris-interface-doc-ingest
description: 当需要把接口 PDF、DOC、DOCX、XLS 或 XLSX 文档转换为 Markdown 与结构化 JSON，并且不把全文塞入会话上下文时使用。
---

# IRIS 接口文档解析

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

这是 `iris-interface-dev` 的接口文档解析适配入口。它负责接口开发语义、规则路由和输出目录约定；实际文档读取、格式转换和结构化落盘由 `extract-doc` 插件执行。

## 必读

1. `../../rules/iris_interface_index.md`
2. `../../rules/iris_interface_workflow.md`
3. 目标项目 `AGENTS.md`
4. 目标项目 `.agents/config/iris_interface_profile.md`，如果存在
5. `extract-doc` 插件的 `skills/extract-doc-ingest/SKILL.md`

## 职责

- 复用 `extract-doc` 的[输出契约](../../../extract-doc/skills/extract-doc-ingest/SKILL.md#输出契约)。profile 的 outputRoot 未配置或为 auto 时省略 `--output-root`；存在显式目录时原样传入，例如保留 `--output-root docs/interface`。
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
  --schema-version iris-interface-doc-ingest/v2
```

## 输出契约

每个文档的实际输出目录包含 `source.md`、`parsed.json`、`fields.md`、`diagnostics.md`。将脚本返回的实际路径交给后续字段诊断与计划，不拼接另一份默认目录。

`parsed.json` 当前 schema 为 `iris-interface-doc-ingest/v2`，用于兼容 `iris-interface-field-match`。

## 边界

- 不在本 skill 内保存或复制解析实现代码。
- 不做字段语义匹配、不生成开发计划、不进入 IRIS/ObjectScript 编码。
- 不写入服务器地址、账号、密码、token、namespace、远程路径或接口注册事实。
