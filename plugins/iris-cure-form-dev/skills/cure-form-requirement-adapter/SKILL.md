---
name: cure-form-requirement-adapter
description: 将 extract-doc/structure-v1 或服务器模板快照转换为 cure-form-spec/v1，并维护来源、置信度和 unresolved 门禁。医院 Word/PDF/Excel 新开发或服务器模板规格化时使用。
---

# Cure Form Requirement Adapter

1. 文档输入先调用 `extract-doc-ingest.py --emit-structure`，不得复制 DOCX/PDF/Excel 解析逻辑。默认从业务项目 `docs/` 发现需求文件；只有一个支持的 Word/PDF/Excel 时可省略 `--source`，多个候选时必须显式选择。
2. 执行 `cure-form intake --form-type CA|CR --module-id ... --map-code ...`。
   - Excel 需要拆分多个业务模板时，增加 `--template-boundaries <cure-form-template-boundaries/v1.json> --report <intake.md>`。
3. 将标题、章节、字段、字典、计算、显隐、布局、公共模板和运行时契约写入 `cure-form-spec/v1`。
4. 每个推断项保留 `sourceRef` 和 `confidence`。无法确定的表格含义、选项值、保存语义、扫描图像内容全部进入 `unresolved[]`。
5. 扫描 PDF 先进行页面视觉提取并人工确认；不得以零字段成功结束。
6. `review` 仅在人完成确认且 `unresolved[]` 为空时写入批准哈希。
7. 多模板范围重叠、合并单元格被边界截断、模板计数口径、`rootId`、`moduleName` 或字段控件类型未确认时不得审批。
8. 默认将规格与摄取报告写入 `docs/cure-form/<moduleId>/`；服务器快照和部署临时数据仍写 `.agents/work/`。
