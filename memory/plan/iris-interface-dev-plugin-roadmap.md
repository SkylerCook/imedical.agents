# iris-interface-dev-plugin 进度与路线图

本文是 `iris-interface-dev-plugin` 的长期进度和下一步工作入口。后续会话应先读取本文，按第一个未完成任务继续推进；每轮验证完成后同步更新本文和维护日志。

## 当前状态摘要

- v1 已提交：`ab102aa feat: add iris interface dev plugin v1`。
- v1.2 格式接入稳定化仍处于未提交工作区；进入 v2.0 前必须先复核、验证并提交。
- 当前未提交主线集中在文档解析脚本、环境自检脚本、插件专项测试和本路线图。
- 本地真实样本摘要位于 `tmp/iris-interface-file/test-results/iris-interface-v1.2-format-test-summary.md`，仅作为本地证据，不提交。
- 真实业务文档和 `tmp/iris-interface-file/docs/output/**` 解析产物不入库。

## 后续会话启动指南

新会话接手时先按顺序读取：

1. `memory/agent-kit-maintenance-memory.md`
2. `memory/plan/iris-interface-dev-plugin-roadmap.md`
3. `memory/plan/iris-interface-source-audit.md`
4. `plugins/iris-interface-dev-plugin/AGENTS.md`
5. `plugins/iris-interface-dev-plugin/README.md`
6. `plugins/iris-interface-dev-plugin/skills/iris-interface-doc-ingest/SKILL.md`
7. `scripts/tests/iris-interface-plugin.tests.ps1`

接手规则：

- 不回滚 v1。
- 不复制 `tmp/his-interface-agent/`。
- 不迁移来源大生成器或大规则库。
- 先完成本文第一个未完成任务。
- 每轮完成后运行插件专项测试和仓库回归测试，通过后更新本文和 `memory/agent-kit-maintenance-log.md`。

## 已完成能力

### v1 基线

- 已新增 `plugins/iris-interface-dev-plugin/` 标准插件结构：manifest、AGENTS、README、4 个 skill、3 条轻量 rule、references/wiki、profile 模板、thin-index wrapper、解析脚本、审查脚本和可选依赖清单。
- v1 能力边界：只承诺接口文档落盘解析、字段结构化、字段诊断入口、开发计划入口和离线审查门禁；不迁移来源大生成器，不承诺生成可编译 ObjectScript。
- IRIS/ObjectScript 编码、审查、上传、编译、部署和远端验证继续复用 `coding-iris-plugin`。
- 解析产物固定写入目标项目 `docs/output/iris-interface/<doc-name>/source.md`、`parsed.json`、`fields.md`、`diagnostics.md`，默认不把全文注入会话上下文。
- `iris-interface-review.py` 已能识别点号循环生成物并失败，阻断 `.s`、`.f`、`..d` 等风险输出。

### v1.1 / v1.2 解析增强

- PDF：已支持跨页续表、错误码/修订记录过滤、表内 request/response 分段、签名字段 `signature.*`、JSON 示例行过滤。
- XLS/XLSX：已支持多 sheet 独立 view，目录 sheet 不污染字段结果，补充 `参数代码/参数类型`、`数据项代码/数据项类型` 等表头别名。
- DOC：`env-check` 能正确报告转换器缺失；`parse_doc()` 已改为优先 DOC -> DOCX 结构化，MarkItDown 仅作为 Markdown 降级。
- DOCX：真实样本可结构化；已支持 `入参表/出参表` 分段、接口标题生成、注释/重复表头/长说明句过滤、`允许空/主键/默认值` 抽取。
- skill/README 已按 PDF、DOC、DOCX、XLS、XLSX 给出处理路由和依赖提示。

## v1.2 格式回归结果

本轮 v1.2 测试主线按 `XLS -> DOC -> DOCX -> XLSX` 完成，PDF 只做轻量抽查。

- XLS 真实样本 `今创医保智能审核数据表接口(含门诊).xls`：`converter=xls-xlrd-optional`，`viewCount=20`，`totalFields=387`，`jsonPathCount=0`，`emptyCode=0`，`chineseCode=0`。
- DOC 真实样本 `技术文档9-MK_JS_305美康合理用药系统整体解决方案数据采集接口（存储过程）说明书V202503.doc`：当前环境无 LibreOffice/Pandoc，legacy DOC 结构化解析为 `missing-converter`；提示路径清晰。
- DOCX 手动另存样本 `技术文档9-MK_JS_305美康合理用药系统整体解决方案数据采集接口（存储过程）说明书V202503_m.docx`：`converter=docx-built-in`，`viewCount=127`，`totalFields=1651`，`jsonPathCount=1651`。
- XLSX 同源转换样本 `今创医保智能审核数据表接口-含门诊-converted.xlsx`：`converter=xlsx-openpyxl-optional`，`viewCount=20`，`totalFields=387`，与同源 XLS 的 viewCount、totalFields、前 20 个 viewName 一致。
- PDF 抽查样本 `综合药房 HIS 处方推送接口使用说明_5000.pdf`：`converter=pdf-built-in`，`viewCount=9`，`totalFields=79`，`jsonPathCount=78`。

v1.2 剩余边界：

- DOC 结构化依赖 LibreOffice/Pandoc 或用户手动另存 DOCX；MarkItDown 不作为 legacy DOC 结构化能力。
- 字段语义匹配阶段补业务 `jsonPath`，不属于 v1.2 格式接入范围。
- 后续需为字段契约补 `rawColumns`、`sourceLocation`、`requiredReason` 和结构化 warning。

## 下一步工作计划

### Task 0：提交 v1.2 稳定基线

目标：把当前格式接入稳定化从 v2 工作中切开，形成可回滚基线。

执行内容：

- 复核当前未提交改动，只包含 v1.2 文档解析、env-check、测试和路线图整理。
- 确认真实业务文档、解析产物和 `tmp/iris-interface-file/test-results/*.md` 不入库。
- 更新 `memory/agent-kit-maintenance-log.md`，记录 v1.2 完成和验证结果。
- 运行验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\iris-interface-plugin.tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\update-agents.tests.ps1
rg -n "password|token|secret|namespace|server|http://|https://|[A-Z]:\\" plugins/iris-interface-dev-plugin
```

- 提交建议：

```powershell
git add memory/plan/iris-interface-dev-plugin-roadmap.md memory/agent-kit-maintenance-log.md plugins/iris-interface-dev-plugin scripts/tests/iris-interface-plugin.tests.ps1
git commit -m "feat: stabilize iris interface document ingestion"
```

### Task 1：字段契约追溯模型

目标：让 `parsed.json` 不只保存规范字段，还能保留来源、推导和诊断信息，为 field-match 和人工确认提供可信输入。

实现要求：

- 为每个字段增加 `rawColumns`，完整保留原始表头和值。
- 增加字段级 `sourceLocation`、`classification`、`confidence`、`warnings`、`requiredReason`、`jsonPathReason`。
- 保持向后兼容：现有 `code`、`name`、`fieldType`、`length`、`required`、`nullable`、`primaryKey`、`defaultValue`、`description`、`jsonPath` 不删除。
- `允许空=否` 可推导 `required=Y`，但必须记录 `requiredReason`。
- 未映射表头、冲突表头、低置信字段说明列和默认值列必须进入 warnings 或 diagnostics。
- 补充 synthetic fixture，不把真实字段全文写入测试。

### Task 2：多厂家样本矩阵固化

目标：把真实样本经验转成可维护回归体系。

安排：

- synthetic fixture 进入 `scripts/tests/iris-interface-plugin.tests.ps1`，覆盖 DOCX、XLSX 多 sheet、PDF 混合表、跨页续表、错误码/修订记录过滤、DOC 转换优先级。
- 真实样本只作为手动回归输入，摘要输出到 `tmp/iris-interface-file/test-results/*.md`。
- 每份真实样本摘要必须记录：成功/失败、converter、viewCount、totalFields、jsonPathCount、diagnostics 数量、emptyCode、chineseCode、前 20 个 viewName。
- 真实样本发现的问题只有归纳为通用解析规则后，才进入插件测试。

### Task 3：字段匹配闭环

目标：新增 `iris-interface-field-match.py`，生成可人工确认的字段匹配结果。

实现要求：

- 输入：`--parsed <parsed.json>`、`--project-root <root>`，可选 `--feedback <path>`。
- 输出到同一文档目录：`field-match.json` 和 `field-match.md`。
- 匹配结果区分：通用规则命中、本地反馈命中、低置信度候选、未匹配。
- 输出字段至少包含 `matched`、`candidate`、`confidence`、`reason`、`needsReview`。
- 控制台只输出路径和数量，不打印全部字段内容。
- 项目反馈只读取目标项目本地文件，不写回插件仓库。

### Task 4：接口开发计划闭环

目标：新增 `iris-interface-dev-plan.py`，把解析与字段匹配结果转成开发实施计划，并明确交给 `coding-iris-plugin` 的边界。

实现要求：

- 输入：`--parsed <parsed.json>`、`--field-match <field-match.json>`、`--project-root <root>`。
- 输出：`implementation-plan.md`。
- 内容包含接口文档来源、字段覆盖率、未匹配字段、人工确认项、编码任务清单、`coding-iris-plugin` 交接步骤和验证门禁。
- 未启用 `coding-iris-plugin` 时，计划必须停在解析/诊断阶段，不进入 ObjectScript 实现。
- 不生成服务器、账号、密码、token、namespace、远程路径或具体包路径。

### Task 5：v2.0 收口

- 更新 doc-ingest、field-match、dev-plan 三个 skill 和 README。
- 更新 `memory/agent-kit-maintenance-log.md` 和本文。
- 运行插件测试、仓库回归和敏感词扫描。
- 提交建议：

```powershell
git add plugins/iris-interface-dev-plugin scripts/tests/iris-interface-plugin.tests.ps1 memory/agent-kit-maintenance-log.md memory/plan/iris-interface-dev-plugin-roadmap.md
git commit -m "feat: complete iris interface v2 workflow"
```

## v2.1 / v2.2 后续方向

### v2.1：受控生成

- 先写 `references/interface-generation-contract.md`，定义生成输入、输出和边界。
- 生成输出只能是草稿或 patch plan，必须经过 `coding-iris-plugin` 的编码规范审查。
- 禁止点号循环体，循环结构统一使用花括号块。
- 上传、编译、部署、远端验证不属于接口插件。

### v2.2：规则和 wiki 治理

- 来源规则库不进入默认上下文。
- 只把长期稳定、可披露、非项目私有的小型字段语义规则放入 `rules/`。
- 大体量 HIS 数据流、MOC、接口索引和历史经验进入 `references/wiki/` 或候选资产清单。
- 资产审计工具默认输出 generated 文件，不覆盖人工维护的 `candidate-assets.md`。

## 每轮验证与更新要求

每轮完成后必须执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\iris-interface-plugin.tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\update-agents.tests.ps1
```

涉及插件内容时必须执行敏感词扫描：

```powershell
rg -n "password|token|secret|namespace|server|http://|https://|[A-Z]:\\" plugins/iris-interface-dev-plugin
```

通过后更新：

- `memory/plan/iris-interface-dev-plugin-roadmap.md`
- `memory/agent-kit-maintenance-log.md`

然后再提交对应阶段。
