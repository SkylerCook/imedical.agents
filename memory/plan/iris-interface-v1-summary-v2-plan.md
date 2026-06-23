# iris-interface-dev-plugin v1 Summary and v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将接口开发能力完整并入 `.agents` 体系：v1 作为解析审计基线，v2 在不搬迁来源工程结构的前提下补齐字段匹配、接口方案、可控生成和规则/wiki 治理闭环。

**Architecture:** `iris-interface-dev-plugin` 负责接口文档解析、字段语义诊断、接口方案、接口生成编排和接口语义离线审查；`coding-iris-plugin` 继续负责 IRIS/ObjectScript 编码规范、代码审查、上传、编译、部署和远端验证。来源工程只作为算法和资产审计输入，不能原样迁移目录、规则库、连接事实或大生成器。

**Tech Stack:** PowerShell 测试脚本、Python 标准库解析链、可选 `python-docx` / `pdfplumber` / `openpyxl` / `markitdown`，现有 `.agents-plugin` manifest、plugin thin-index wrapper、Markdown rules/skills/references。

---

## 下个会话启动指南

新会话接手时先按顺序读取：

1. `memory/agent-kit-maintenance-memory.md`
2. `memory/plan/iris-interface-v1-summary-v2-plan.md`
3. `memory/plan/iris-interface-source-audit.md`
4. `plugins/iris-interface-dev-plugin/AGENTS.md`
5. `plugins/iris-interface-dev-plugin/README.md`
6. `plugins/iris-interface-dev-plugin/skills/iris-interface-init/SKILL.md`
7. `scripts/tests/iris-interface-plugin.tests.ps1`

当前基线：v1 已提交为 `ab102aa feat: add iris interface dev plugin v1`。下个会话不要回滚 v1，不要直接复制 `tmp/his-interface-agent/`，不要迁移来源大生成器或大规则库。

推荐第一步：从 v2.0 Task 1 开始，先扩展 `scripts/tests/iris-interface-plugin.tests.ps1`，为 `field-match.json`、`field-match.md` 和 `implementation-plan.md` 写失败测试，再实现脚本。这样可以把“完全并入体系”的第一阶段锁在可验收闭环上。

下个会话的完成标准：至少完成一个可提交阶段；每个阶段都先跑 `scripts/tests/iris-interface-plugin.tests.ps1` 和 `scripts/tests/update-agents.tests.ps1`，再更新维护日志并提交。

---

## v1 基线总结

- 已提交基线：`ab102aa feat: add iris interface dev plugin v1`。
- 来源审计基线：`https://gitee.com/soneakeko/agent-architecture.git` commit `43e12b345c58ba11a48980828503daf29ae309ec`，审计草稿位于 `memory/plan/iris-interface-source-audit.md`。
- 已新增 `plugins/iris-interface-dev-plugin/` 标准插件结构：manifest、AGENTS、README、4 个 skill、3 条轻量 rule、references/wiki、profile 模板、thin-index wrapper、解析脚本、审查脚本和可选依赖清单。
- v1 能力边界：解析审计优先，只承诺文档转 Markdown、字段结构化、字段诊断入口、开发计划入口和离线审查门禁；不迁移来源大生成器，不承诺生成可编译 ObjectScript。
- 解析输出约定：目标项目固定写入 `docs/output/iris-interface/<doc-name>/source.md`、`parsed.json`、`fields.md`、`diagnostics.md`，默认不把全文注入会话上下文。
- 可选依赖策略：`requirements-optional.txt` 只声明 `python-docx`、`pdfplumber`、`openpyxl`、`markitdown`；不 vendor、不自动安装。无可选依赖时 XLSX 仍走标准库 OpenXML 降级解析。
- 硬门禁：`iris-interface-review.py` 已能识别 `^\s*\.+\s*[A-Za-z]` 点号循环生成物并失败，阻断 `.s`、`.f`、`..d` 等风险输出。
- 已通过验证：`scripts/tests/iris-interface-plugin.tests.ps1` 和 `scripts/tests/update-agents.tests.ps1`。

## v1 真实样本文档回归记录

样本文档：`tmp/iris-interface-file/综合药房 HIS 处方推送接口使用说明_5000.pdf`。

v1 解析产物：`tmp/iris-interface-file/docs/output/iris-interface/综合药房-his-处方推送接口使用说明_5000/`。

当前结果：PDF 可解析落盘，`parsed.json` 记录 `8` 个视图、`47` 个字段，但 `fields.md` 存在字段缺失和误抽。

已确认的问题：

- Page 2 修订记录被误识别为字段表，应在 v2.0 增加非接口字段表过滤。
- Page 11 错误码表被误识别为字段表，应区分返回码/状态码表与字段表。
- Page 17 Table 1 是处方主表跨页续表，包含 `packageCount`、`operator`、`consignee`、`consignAddress`、`consignPhone`、`expressType`、`soakWater`、`soakTime`、`labelCount`、`remark`、`doctor`、`footnote`、`decoctMethod`、`takeWay`、`remarkA`、`remarkB`、`payment`、`yizhu`、`money`、`healthCardNO` 等字段，但 v1 因首行不是标准表头而未进入 `fields.md`。
- Page 18 Table 1 是 Page 17 续表，包含 `outpatientIndex`、`caseNO`、`outpatientNO`、`procedureJump`、`patientFile`、`fileType`、`isrepetition`、`particular`、`token`、`isUrgent`、`hospitalPNO`、`prescribeTime` 等字段，但 v1 未识别。
- Page 19 Table 1 是 `drugs` 参数续表，包含 `dosage`、`doseCount`、`dosageTotal`、`unit`、`footnote`、`description`、`retailPrice`、`batchNO` 等字段，但 v1 未识别。

v2.0 必须增加回归断言：该 PDF 样本至少应把 Page 17 Table 1、Page 18 Table 1、Page 19 Table 1 识别为字段表，且不再把 Page 2 修订记录识别为字段表。实现方向是增加“继承上一字段表表头/续表识别”和“非字段表过滤”，而不是把该文档的字段硬编码到插件规则中。
来源工程对比结论：同一 PDF 用 `tmp/his-interface-agent/src/parsers/factory.py` 的 `DocumentParser` 解析，结果为 `4` 个视图、`18` 个字段，且缺失 `packageCount`、`operator`、`consignee`、`outpatientIndex`、`caseNO`、`isUrgent`、`dosage`、`dosageTotal`、`retailPrice`、`batchNO`、`prescriptionNo` 等字段。来源 parser 还把页面文本中的 `Base64字符串` 误识别为 view code/name，说明来源工程本身也不支持该 PDF 的跨页续表和接口表过滤。v1 当前迁移版虽然更简化，但在该样本上反而抽出 `8` 个视图、`47` 个字段；问题不是单纯迁移遗漏，而是来源工程和 v1 都缺少面向此类 PDF 的续表识别、字段表分类和非字段表过滤。

v1.1 修复方向：不要直接搬来源 parser；应吸收来源的 `HeaderMapper` / `TableClassifier` 思路，但新增该样本需要的规则：`描述|字段名称|是否必填|字段说明` 表头、跨页续表继承、首行数据续表识别、修订记录/错误码/状态码过滤、view id 从章节标题而不是任意括号文本提取。
## 接口文档普适性策略计划

不同厂家接口文档差异很大，`iris-interface-dev-plugin` 不应追求“一套硬编码规则解析所有厂家”。可行目标是建立“通用解析骨架 + 可诊断置信度 + 项目本地适配 + 人工反馈复跑”的闭环：任意厂家文档都应能落盘、抽取、诊断、人工修正，并把确认可泛化的经验再沉淀为轻量规则。

### 普适性目标定义

- 不承诺首次解析 100% 正确；承诺输出可审计产物、错误诊断和下一步修正路径。
- 每个字段必须尽量保留来源信息：页码、表格、原始表头、字段代码、字段名、类型、必填、说明、推断出的 `jsonPath`、推断来源和置信度。
- 对低置信度、空字段代码、表内混合区块、跨页续表、疑似示例/错误码/目录/修订记录等情况，必须写入 `diagnostics.md` 或结构化 warning，不静默吞掉。
- 通用插件只内置稳定、可披露、跨厂家成立的规则；厂家/项目特殊规则先进入目标项目本地反馈，不直接写入插件仓库。

### 分层解析架构

- 文件格式层：PDF、DOCX、XLSX、XLS、DOC 只负责转换和基础表格/段落抽取，所有输出落盘，不注入会话全文。
- 表格分类层：区分字段表、请求头表、请求参数表、响应参数表、错误码表、状态码表、目录、修订记录、示例表和混合表。
- 上下文识别层：提取接口标题、接口路径、请求方式、请求/响应区块、`headers`、`request`、`response`、`data.xxx` 子对象和表内分段。
- 字段抽取层：按表头映射字段代码、中文名、类型、长度、必填、备注；支持“第一列为空、第二列是字段名”的 PDF 表格。
- 诊断与反馈层：输出未识别表、低置信度字段、疑似误归属、缺少 `jsonPath`、跨页续表继承来源和人工确认建议。

### 项目本地适配策略

- 目标项目可维护本地适配文件，例如 `.agents/config/iris_interface_profile.md`、`docs/output/iris-interface/<doc>/feedback.json` 或同目录人工确认文件。
- 本地适配只影响目标项目复跑，不直接进入插件规则；确认跨项目稳定后，再评审是否进入 `rules/iris_interface_field_semantics.md` 或 `references/wiki/`。
- 本地反馈应支持最小修正：字段别名、表头别名、字段路径覆盖、表格类型覆盖、接口标题覆盖、忽略表格列表。
- 插件必须把“本地反馈已应用”和“仍需人工确认”的项目写入报告，避免隐藏人工修正来源。

### v2 前置任务：普适性基础设施

**Files:**
- Modify: `plugins/iris-interface-dev-plugin/scripts/iris-interface-doc-ingest.py`
- Modify: `scripts/tests/iris-interface-plugin.tests.ps1`
- Modify: `plugins/iris-interface-dev-plugin/skills/iris-interface-doc-ingest/SKILL.md`
- Modify: `plugins/iris-interface-dev-plugin/README.md`

- [ ] 为 `parsed.json` 增加字段级 `sourceLocation`、`classification`、`confidence`、`warnings`、`jsonPathReason` 等轻量诊断字段；保持向后兼容，已有字段不删除。
- [ ] 为 PDF 混合表实现表内分段：同一表内出现 `接口名称`、`请求参数`、`请求参数（加密前）`、`返回结果`、`响应参数` 时，按段生成 `request.*` 与 `response.*`。
- [ ] 为 XLSX/XLS 多 sheet 明确每个 sheet 独立 view；sheet 名进入来源信息。
- [ ] 为 DOC/DOCX 输出“可结构化程度”诊断：只转 Markdown、表格已结构化、或需要手动转 DOCX。
- [ ] 增加低置信度规则：字段代码为空、字段名疑似说明文本、整表上下文继承过长、表头缺失、同页后续接口标题污染前表时，都必须给 warning。
- [ ] 在 skill 中明确不同文件类型的处理分支和验收重点，避免 Agent 临场猜测。

### v2 前置任务：多厂家样本矩阵

**Files:**
- Modify: `scripts/tests/iris-interface-plugin.tests.ps1`
- Optional output: `tmp/iris-interface-file/test-results/*.md`

- [ ] 保留最小 synthetic fixture，覆盖 DOCX、XLSX 多 sheet、PDF 混合表、跨页续表、错误码/修订记录过滤。
- [ ] 真实样本只作为手动回归输入，不把业务全文或私有事实写进插件规则。
- [ ] 对每份真实文档输出摘要：成功/失败、converter、viewCount、totalFields、jsonPathCount、warningCount、未识别表数量、前 20 个 viewName。
- [ ] 普适性验收不以“字段全对”为标准，而以“可落盘、可诊断、可人工修正、可复跑”为标准。

### v2 前置任务：反馈复跑闭环

**Files:**
- Create or Modify: `plugins/iris-interface-dev-plugin/scripts/iris-interface-field-match.py`
- Create or Modify: `plugins/iris-interface-dev-plugin/templates/iris_interface_feedback.template.json`
- Modify: `plugins/iris-interface-dev-plugin/skills/iris-interface-field-match/SKILL.md`

- [ ] 定义本地反馈 JSON 模板，至少支持表头别名、字段路径覆盖、字段别名、忽略表格、表格类型覆盖。
- [ ] 字段匹配脚本读取本地反馈，但默认不写回插件仓库。
- [ ] 输出 `field-match.md` 时区分“通用规则命中”“本地反馈命中”“低置信度候选”“未匹配”。
- [ ] 反馈复跑后，`diagnostics.md` 应减少对应 warning，并记录应用了哪些本地反馈。

### 普适性验收标准

- 首次解析失败时，必须给出可执行原因：缺依赖、格式不支持、转换器缺失、表头未识别、表格非字段表或需要人工确认。
- 对任意厂家文档，插件至少应生成落盘产物或明确的 env-check/转换建议；不能只说“我不行”。
- 对已安装依赖且格式支持的文档，`fields.md` 必须展示接口/小节/字段归属；无法确认时显示低置信度或 warning。
- 进入代码生成前，必须已完成字段匹配和人工确认清单；低置信度字段不得直接进入生成逻辑。
## v2 分期目标

v2 不按来源工程目录整体搬迁，分三段并入：

- v2.0：补齐接口开发闭环。目标是从文档解析到字段匹配、人工确认、接口开发计划、coding 插件交接、离线审查全部可跑。
- v2.1：引入可控生成。目标是生成 Query/JSON/XML 接口实现草稿或 patch plan，但必须复用 `coding-iris-plugin` 规则，且继续用接口插件审查字段覆盖和点号循环风险。
- v2.2：治理规则和 wiki。目标是把来源规则库拆分为轻量语义规则、按需 wiki、候选资产和禁止入库资产，形成可维护的长期知识层。

## v2.0 Implementation Tasks

### Task 1: 扩展插件测试骨架

**Files:**
- Modify: `scripts/tests/iris-interface-plugin.tests.ps1`

- [ ] 在现有测试中增加 v2.0 产物断言，先写失败测试：运行字段匹配脚本后应生成 `field-match.json` 和 `field-match.md`；运行开发计划脚本后应生成 `implementation-plan.md`。
- [ ] 使用现有最小 XLSX fixture，不引入真实业务文档。
- [ ] 运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\iris-interface-plugin.tests.ps1
```

Expected：新增脚本尚不存在时失败，失败信息指向缺失的 `iris-interface-field-match.py` 或 `iris-interface-dev-plan.py`。

### Task 2: 实现字段匹配脚本

**Files:**
- Create: `plugins/iris-interface-dev-plugin/scripts/iris-interface-field-match.py`
- Modify: `plugins/iris-interface-dev-plugin/skills/iris-interface-field-match/SKILL.md`
- Modify: `plugins/iris-interface-dev-plugin/README.md`

- [ ] 新脚本输入：`--parsed <parsed.json>`、`--project-root <root>`，可选 `--feedback <path>`。
- [ ] 新脚本输出到同一文档目录：`field-match.json` 和 `field-match.md`。
- [ ] 匹配范围保持轻量：字段代码、中文名、类型、长度、必填、备注归一化；候选结果只给 `matched`、`candidate`、`confidence`、`reason`、`needsReview`。
- [ ] 本插件内置规则只能使用轻量语义规则；项目反馈只读取目标项目本地文件，不写回插件仓库。
- [ ] 控制台只输出路径和数量，不打印全部字段内容。
- [ ] 更新 skill，说明缺规则或低置信度时输出人工确认草稿，不把 wiki 全量塞入上下文。

### Task 3: 实现接口开发计划脚本

**Files:**
- Create: `plugins/iris-interface-dev-plugin/scripts/iris-interface-dev-plan.py`
- Modify: `plugins/iris-interface-dev-plugin/skills/iris-interface-dev-plan/SKILL.md`
- Modify: `plugins/iris-interface-dev-plugin/rules/iris_interface_workflow.md`

- [ ] 新脚本输入：`--parsed <parsed.json>`、`--field-match <field-match.json>`、`--project-root <root>`。
- [ ] 输出 `implementation-plan.md`，包含接口文档来源、字段覆盖率、未匹配字段、人工确认项、编码任务清单、`coding-iris-plugin` 交接步骤和验证门禁。
- [ ] 如果目标项目未启用 `coding-iris-plugin`，计划必须明确停在解析/诊断阶段，不进入 ObjectScript 实现。
- [ ] 计划中不得生成服务器、账号、密码、token、namespace、远程路径或具体包路径。

### Task 4: 增强初始化边界

**Files:**
- Modify: `plugins/iris-interface-dev-plugin/skills/iris-interface-init/SKILL.md`
- Modify: `plugins/iris-interface-dev-plugin/templates/iris_interface_profile.template.md`
- Test: `scripts/tests/iris-interface-plugin.tests.ps1`

- [ ] 明确 `plugin_profile.md` 中 `coding-iris-plugin` 未 `enabled` 时的降级行为：只允许 doc ingest、field match、dev plan，不允许 code generation。
- [ ] profile 模板只包含接口输出目录、可选依赖提示、字段反馈路径和默认审查策略，不包含连接事实。
- [ ] 测试断言模板不包含 `namespace`、`server`、`token`、盘符路径或远程路径样例。

### Task 5: v2.0 验证与提交

**Files:**
- Modify: `memory/agent-kit-maintenance-log.md`

- [ ] 运行插件测试：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\iris-interface-plugin.tests.ps1
```

Expected：`iris-interface-plugin tests passed`。

- [ ] 运行仓库回归：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\update-agents.tests.ps1
```

Expected：`update-agents tests passed`。

- [ ] 运行敏感词扫描：

```powershell
rg -n "password|token|secret|namespace|server|http://|https://|[A-Z]:\\" plugins\iris-interface-dev-plugin
```

Expected：只允许 OpenXML schema URI 或“禁止写入敏感信息”的约束说明；不得出现真实连接事实。

- [ ] 提交：

```powershell
git add plugins/iris-interface-dev-plugin scripts/tests/iris-interface-plugin.tests.ps1 memory/agent-kit-maintenance-log.md
git commit -m "feat: complete iris interface v2 workflow"
```

## v2.1 Implementation Tasks

### Task 6: 定义生成协议，不迁移来源大生成器

**Files:**
- Create: `plugins/iris-interface-dev-plugin/references/interface-generation-contract.md`
- Modify: `plugins/iris-interface-dev-plugin/README.md`
- Modify: `plugins/iris-interface-dev-plugin/rules/iris_interface_review.md`

- [ ] 写明生成输入只来自 `parsed.json`、`field-match.json`、人工确认项和目标项目 profile。
- [ ] 写明生成输出是草稿或 patch plan，必须经过 `coding-iris-plugin` 的 `iris-coding` 或 `iris-backend-coding` 审查。
- [ ] 写明禁止点号循环体，循环结构统一使用花括号块。
- [ ] 写明上传、编译、部署、远端验证不属于接口插件。

### Task 7: 实现 Query/JSON/XML 草稿生成入口

**Files:**
- Create: `plugins/iris-interface-dev-plugin/scripts/iris-interface-generate-draft.py`
- Modify: `plugins/iris-interface-dev-plugin/scripts/iris-interface-review.py`
- Test: `scripts/tests/iris-interface-plugin.tests.ps1`

- [ ] 新脚本输入：`--plan <implementation-plan.md>`、`--parsed <parsed.json>`、`--field-match <field-match.json>`、`--format query|json|xml`。
- [ ] 输出到文档目录 `draft/`：`Draft.cls` 或 `draft-plan.md`，默认生成可审查草稿，不执行上传或编译。
- [ ] 生成草稿必须包含 `coding-iris-plugin` 交接提示。
- [ ] 审查脚本继续拦截 `.s`、`.f`、`..d`，并增加字段覆盖检查：生成草稿中缺少必填字段映射时失败。
- [ ] 测试构造最小 JSON 草稿，确认无点号循环时通过；构造 `.s` 草稿时失败。

### Task 8: v2.1 验证与提交

**Files:**
- Modify: `memory/agent-kit-maintenance-log.md`

- [ ] 运行 v2.1 插件测试和 `update-agents` 回归。
- [ ] 使用 `rg -n "\.s|\.f|\.d|\.q" plugins/iris-interface-dev-plugin` 检查测试样例以外没有鼓励点号循环的生成模板。
- [ ] 提交：

```powershell
git add plugins/iris-interface-dev-plugin scripts/tests/iris-interface-plugin.tests.ps1 memory/agent-kit-maintenance-log.md
git commit -m "feat: add iris interface draft generation contract"
```

## v2.2 Implementation Tasks

### Task 9: 来源规则资产分流工具

**Files:**
- Create: `plugins/iris-interface-dev-plugin/scripts/iris-interface-audit-assets.py`
- Modify: `plugins/iris-interface-dev-plugin/references/candidate-assets.md`
- Test: `scripts/tests/iris-interface-plugin.tests.ps1`

- [ ] 工具输入：`--source-root tmp/his-interface-agent`。
- [ ] 工具输出：`references/candidate-assets.generated.md` 或目标项目本地审计输出；默认不要覆盖人工维护的 `candidate-assets.md`。
- [ ] 分类必须包含：保留、改写、候选审查、丢弃、禁止进入仓库。
- [ ] 扫描规则问题类型：疑似连接事实、具体包路径、接口编码映射、Global/取值表达式、样例残留、脚本运行产物。
- [ ] 测试只用临时 fixture，不依赖真实来源工程存在。

### Task 10: 小型字段语义规则入库

**Files:**
- Create or Modify: `plugins/iris-interface-dev-plugin/rules/iris_interface_field_semantics.md`
- Modify: `plugins/iris-interface-dev-plugin/rules/iris_interface_index.md`
- Test: `scripts/tests/iris-interface-plugin.tests.ps1`

- [ ] 只沉淀长期稳定、可披露、非项目私有的字段语义别名和表头识别规则。
- [ ] 不写具体医院、接口文档、包路径、接口编码、MOC、全量接口索引或生产数据策略。
- [ ] 测试断言 `rules/` 下单文件不超过 20000 bytes，且 thin-index dry-run 包含该轻量 rule。

### Task 11: wiki 分层和按需读取说明

**Files:**
- Modify: `plugins/iris-interface-dev-plugin/references/wiki/README.md`
- Create: `plugins/iris-interface-dev-plugin/references/wiki/interface-index-format.md`
- Create: `plugins/iris-interface-dev-plugin/references/wiki/rule-quality-notes.md`

- [ ] wiki 只放格式说明、质量治理和按需参考，不进入默认 thin-index。
- [ ] 明确大体量 HIS 数据流、MOC、接口索引全文只能作为目标项目本地资料或候选审查输入。
- [ ] README 指导 Agent 只在具体字段或生成策略不确定时读取对应 wiki 文件。

### Task 12: v2.2 验证与提交

**Files:**
- Modify: `memory/agent-kit-maintenance-log.md`
- Modify: `memory/agent-kit-maintenance-backlog.md`, if v3 items remain

- [ ] 运行插件测试和 `update-agents` 回归。
- [ ] 运行敏感词扫描，确认无真实连接事实。
- [ ] 确认 `references/` 不进入 thin-index dry-run 输出。
- [ ] 提交：

```powershell
git add plugins/iris-interface-dev-plugin scripts/tests/iris-interface-plugin.tests.ps1 memory/agent-kit-maintenance-log.md memory/agent-kit-maintenance-backlog.md
git commit -m "feat: govern iris interface rules and wiki assets"
```

## Acceptance Criteria

- v2.0 完成后，接口开发从文档解析、字段匹配、开发计划到 coding 插件交接有完整落盘产物和 skill 路由。
- v2.1 完成后，可生成受控接口草稿或 patch plan，但所有 ObjectScript 编码质量、上传、编译、部署仍由 `coding-iris-plugin` 负责。
- v2.2 完成后，来源规则库不会污染默认上下文，轻量规则、wiki、候选资产和禁止入库资产边界清楚。
- 全阶段不得写入服务器地址、账号、密码、token、namespace、远程路径或业务项目私有事实。
- 每个阶段都必须通过 `iris-interface-plugin.tests.ps1` 和 `update-agents.tests.ps1` 后再提交。