# AGENTS.md

## 插件定位

`extract-doc` 提供可复用的文档读取与落盘能力：把 PDF、DOC、DOCX、XLS、XLSX 文档转换为 Markdown、结构化 JSON、字段摘要和诊断文件。

本插件只负责本地文档解析与产物落盘，不负责字段语义匹配、IRIS 编码、上传、编译、部署或远端验证。

## 使用约束

- 解析结果默认写入目标项目 `docs/interface/<doc-name>/`，不得把完整文档内容默认塞进会话上下文。
- MarkItDown 只是可选转换器；不可用时使用脚本内置 DOCX、PDF、XLSX 解析链路。
- `.doc` 文件只做可选转换；缺少可用转换器时提示用户另存为 DOCX。
- 不在插件内保存连接、账号、密钥、远端路径、项目专属包路径或真实业务环境事实。

## Skill 路由

- 通用文档落盘和结构化抽取：`skills/extract-doc-ingest/SKILL.md`

## 规则入口

- 文档解析边界：`rules/extract_doc_index.md`

## 内置脚本

- `scripts/extract-doc-env-check.py`：检查文档解析所需的可选依赖和转换器。
- `scripts/extract-doc-ingest.py`：文档转换、结构化抽取和落盘。
- `scripts/generate-plugin-thin-index.ps1`：thin-index wrapper，只委托根 canonical 脚本。
