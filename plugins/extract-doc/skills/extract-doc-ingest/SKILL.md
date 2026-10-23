---
name: extract-doc-ingest
description: 当需要把 PDF、DOC、DOCX、XLS 或 XLSX 文档转换为 Markdown 与结构化 JSON，并且不把全文塞入会话上下文时使用。
---

# 文档解析落盘

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

用于把源文档解析为目标项目本地落盘产物，供后续字段诊断、人工核对或业务插件继续处理。

## 必读

1. 目标项目 `AGENTS.md`
2. 如由业务插件调用，继续读取该业务插件要求的规则或 profile

## 命令

在目标项目根目录执行：

```powershell
python .agents/plugins/extract-doc/scripts/extract-doc-env-check.py --file <document-path> --strict
python .agents/plugins/extract-doc/scripts/extract-doc-ingest.py --file <document-path> --project-root .
```

如调用方需要指定输出目录，显式传入：

```powershell
python .agents/plugins/extract-doc/scripts/extract-doc-ingest.py `
  --file <document-path> `
  --project-root . `
  --output-root docs/interface
```

业务调用方如果需要固定 `parsed.json` schema，显式传入 `--schema-version <schema>`；通用默认 schema 为 `extract-doc/v1`。

业务调用方需要版面、单元格、公式、图片或扫描件判断时，增加 `--emit-structure`：

```powershell
python .agents/plugins/extract-doc/scripts/extract-doc-ingest.py `
  --file <document-path> `
  --project-root . `
  --emit-structure
```

## 输出契约

显式 `--output-root` 始终优先。省略时，由脚本解析 `extract-doc/document-ingest` 的 owner 目录声明：未接入治理保持 `docs/interface/` 且不要求 Node.js；接入后使用声明结果，当前为 `docs/modules/interfaces/`。治理已启用但配置、owner 或解析器无效时停止，保留现场。

每个文档在解析出的根目录下使用 `<doc-name>/`，固定文件为 `source.md`、`parsed.json`、`fields.md`、`diagnostics.md`；传入 `--emit-structure` 时增加 `structure.json`。文件名及 schema 保持兼容。脚本不会迁移历史文件，后续处理使用本次实际返回的路径。

目录接入、授权与更新行为见[项目知识库布局](../../../../docs/guides/project-knowledge-layout.md)。

`structure.json` 固定使用 `extract-doc/structure-v1`。它只描述领域无关的文档结构；字段语义、控件类型和业务规则由调用方插件继续处理。

对话里只汇报文件路径、视图数量、字段数量、转换器和错误摘要。不要粘贴转换后的全文，也不要把所有字段明细灌入会话上下文。

遇到缺依赖错误时，给出：

```powershell
python -m pip install -r .agents/plugins/extract-doc/requirements-optional.txt
```
