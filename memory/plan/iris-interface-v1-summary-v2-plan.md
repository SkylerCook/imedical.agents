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