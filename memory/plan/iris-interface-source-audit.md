# iris-interface 来源工程审计草稿

## 审计基线

- 来源仓库：`https://gitee.com/soneakeko/agent-architecture.git`
- 本地审计目录：`tmp/his-interface-agent/`
- 来源 commit：`43e12b345c58ba11a48980828503daf29ae309ec`
- 审计日期：2026-06-22
- 当前结论：先作为来源工程审计输入，不直接迁移到正式插件目录。

## 工程结构

来源工程是独立的 HIS 接口自动开发工具，不是 `imedical.agents` 插件结构。

| 路径 | 内容 | 审计结论 |
|---|---|---|
| `src/` | Python CLI、文档解析、取值引擎、代码生成器、审查器 | 候选改写。可复用设计和部分算法，但运行时边界需重建。 |
| `rules/domains/` | 21 个业务域 Markdown 规则文件 | 候选审查。体量大，含字段取值知识、历史样例和可能的业务事实，不能原样进入默认 rules。 |
| `rules/common/` | 12 个 JSON 别名库和 `global-access.md` | 候选审查。字段语义别名可保留，Global/取值表达式需逐条脱敏和分层。 |
| `references/` | 编码规范、HIS 数据流、MOC、接口索引、三类接口模板 | 分流处理。接口开发参考可候选保留；IRIS 编码规范归 `coding-iris-plugin`；接口索引/MOC 不进默认 thin-index。 |
| `scripts/` | 验收、生成检查、接口索引生成、代码分析 | 大多丢弃或改写。一次性分析脚本不进入插件；验收脚本可按离线审查边界重建。 |
| `tests/` | 单元/集成测试、接口测试子 Agent 工作流 | 候选改写。测试思路可保留；上传、编译、真实数据测试应复用 `coding-iris-plugin`。 |
| `config/` | 默认项目配置和文档到包路径映射 | 禁止原样进入仓库。包含项目环境假设和具体接口文档映射，应改为目标项目模板。 |
| `docs/input/`、`output/` | 输入和生成输出目录 | 不进入能力包。目标项目运行时目录应由插件说明或 init 模板创建。 |
| `AGENTS.md`、`CLAUDE.md` | 来源工程 Agent 行为入口 | 不原样迁移。应改写为插件 skill 和规则路由。 |

文件规模概览：52 个 `.py`、50 个 `.md`、14 个 `.json`、1 个 `.yaml`。

## 命令入口与运行链路

`setup.py` 暴露 `his-agent=src.cli:main`，依赖：

- `pdfplumber>=0.7.0`
- `python-docx>=0.8.11`
- `openpyxl>=3.0.0`
- `PyYAML>=6.0`
- 可选 `.doc` 支持：`mammoth>=1.12.0`

CLI 子命令：

| 子命令 | 功能 | 插件边界建议 |
|---|---|---|
| `parse` | 解析 DOCX/PDF/XLSX/DOC 接口文档 | 保留能力，改造成接口文档结构化抽取入口。 |
| `generate` | 文档解析、字段匹配、生成 Query/JSON/XML ObjectScript | 保留编排思想，但生成阶段必须调用或遵守 `coding-iris-plugin` 的 IRIS 规范。 |
| `rule lookup/list-domains/show-domain/quality/stats/conflicts` | 规则查询、质量检查和冲突检测 | 保留为离线审查/候选规则治理工具，不默认加载大规则库。 |
| `review` | 生成代码 P0/P1 审查 | 与 `coding-iris-plugin` 边界重叠，应拆分：接口字段覆盖审查留本插件，ObjectScript 编码审查归 coding 插件。 |
| `feedback` | 字段取值反馈写入别名库 | 候选保留，但必须写入目标项目本地反馈区，不直接改能力包规则。 |

主链路：

1. 文档解析：`DocumentParser` 按扩展名选择 DOCX/PDF/XLSX/DOC 解析器。
2. 表头识别：`src/parsers/config/header_mapping.yaml` 做字段列名归一化。
3. 业务域推断：`value_engine/domains.py` 从视图名/字段语义推断域。
4. 字段取值匹配：L1 规则库、L2 搜索、L3 AI prompt、L4 人工回流。
5. 代码生成：Query/JSON/XML 三类生成器输出 ObjectScript `.cls`。
6. 离线审查：`reviewers/linter.py` 做 P0/P1 检查。
7. 验证/修改：来源工程通过子 Agent 设计连接 IRIS 上传、编译和真实数据测试。

## 规则库审计

来源 README 声称约 705 条规则；实际运行 `python -m src rule list-domains` 加载 1104 条规则、20 个域，并在加载阶段报告 23 个规则问题：

- 17 个 `SYNTAX_ERROR`
- 5 个 `INVALID_EXPR`
- 1 个 `PURE_CHINESE`

这说明规则库不能作为可信稳定资产原样并入。规则应分为：

| 类型 | 示例 | 分流建议 |
|---|---|---|
| 字段语义知识 | 字段中文名、英文名、别名、标准字段名 | 可保留候选，脱敏后进入 `rules/` 或小型默认索引。 |
| 取值表达式知识 | `$p`、`$lg`、Global 片段、变量链 | 候选审查。长期可复用表达式可放 `references/` 或按需规则；涉及项目实现细节时禁止进入仓库。 |
| 业务私有事实 | 具体医院/接口文档/包路径/接口编码映射 | 禁止进入能力包。只能放目标项目本地配置或临时审计输出。 |
| 样例和历史残留 | 具体标准文档名称、历史接口映射、失败规则 | 候选审查或丢弃。不能混入默认 Agent 上下文。 |
| 脚本运行产物 | `output/`、匹配日志、生成代码、缓存 | 禁止进入仓库。 |

特别注意：

- `config/package_mapping.json` 包含具体接口文档名到包路径的映射，应作为来源经验，不得原样进入插件。
- `references/interface-index/all-interfaces.md` 是 644 方法/238 类静态索引，属于目标环境事实或历史导出，不进入默认 thin-index。
- `references/his-table-moc.md` 和 `his-data-flow.md` 体量较大，若保留也应作为按需 `references/` 候选，不进默认 rules。

## 资产分流表

| 分类 | 来源资产 | 处理方式 | 目标位置建议 |
|---|---|---|---|
| 保留 | 文档解析入口、表头映射、解析结果数据结构 | 改写为插件运行时能力 | `plugins/iris-interface-dev-plugin/src` 或后续独立包 |
| 保留 | 字段归一化、多轮匹配、域推断思路 | 改写并补测试 | 插件 src + 小型规则/参考 |
| 保留 | 接口生成编排流程 | 改写为 workflow/skill 说明，不直接绑定子 Agent | 插件 skills/references |
| 保留 | 离线字段覆盖率、TODO、匹配诊断检查 | 改写为验收脚本 | 插件 scripts |
| 改写 | Query/JSON/XML 生成器 | 先抽象生成协议，再复用 `coding-iris-plugin` 编码规范 | 插件 src + coding 插件引用 |
| 改写 | `reviewers/linter.py` | 拆分接口语义审查与 ObjectScript 编码审查 | 接口插件只保留接口语义审查 |
| 改写 | `AGENTS.md`、`CLAUDE.md`、`tests/workflow.md` | 改为 vendor-neutral skill/workflow，提供无子代理降级 | 插件 skills/references |
| 候选审查 | `rules/domains/*.md`、`rules/common/*.json` | 逐条脱敏、去项目事实、质量修复后再决定 | 轻量 `rules/` 或按需 `references/` |
| 候选审查 | `references/his-data-flow.md`、`his-table-moc.md` | 检查是否含私有事实和长期稳定性 | `references/`，不参与默认 thin-index |
| 候选审查 | `references/interface-index/*` | 只保留索引格式模板和使用说明 | `references/interface-index/_template.md` 或说明 |
| 丢弃 | `scripts/gen_and_check.py` | 写死具体输入文件，属于一次性调试脚本 | 不并入 |
| 丢弃 | `scripts/generate_interface_index.py` | 面向来源静态索引生成，需重建边界 | 不并入或后续重写 |
| 丢弃 | `docs/input/`、`output/`、`data/` | 运行时输入输出和本地状态 | 不并入 |
| 禁止进入仓库 | 具体 namespace、包路径、接口编码、生产库真实数据策略、MCP 连接事实 | 只允许目标项目本地配置 | 目标项目 `.agents/config/` 或本地忽略文件 |

## 新插件边界建议

`iris-interface-dev-plugin` 只承载接口开发领域能力：

- 文档转换与结构化抽取。
- 字段语义归一化和字段匹配诊断。
- 接口字段取值候选生成和人工反馈整理。
- Query/JSON/XML 接口生成编排。
- 离线审查入口：字段覆盖率、未匹配字段、模板完整性、生成物风险提示。

必须复用 `coding-iris-plugin` 的能力：

- IRIS/ObjectScript 编码规范。
- ObjectScript 代码审查。
- 上传、编译、部署、远程验证。
- SFTP、MCP、IRIS namespace 等环境边界。

插件不应承载：

- 目标项目真实连接信息。
- 生产库真实数据测试策略的具体 SQL 或环境事实。
- 静态接口全量索引和 MOC 默认上下文。
- 工具专属入口如 `CLAUDE.md` 的原文。

## MarkItDown 边界

来源工程当前未使用 MarkItDown，`.doc` 处理依赖 LibreOffice/Pandoc 转 DOCX。新插件设计时：

- MarkItDown 仅作为按需安装依赖，不 vendor 源码。
- 转换结果写入目标项目 `docs/output/MarkItDown/`。
- 转换输出默认不注入 Agent 上下文，只作为后续解析输入。
- 大文档需要摘要、分段索引或按视图抽取，避免把全量 Markdown 放入默认上下文。
- 若 MarkItDown 不可用，保留 DOCX/PDF/XLSX 解析路径和明确降级提示。

## 风险与待确认

- 规则质量风险：来源规则加载已有 23 个问题，必须先治理再谈并入。
- 敏感信息风险：本轮关键词扫描未发现账号、密码、token、URL 等明显敏感命中；但配置、包路径、接口编码和业务文档映射仍属于环境事实，不能原样沉淀为公共能力。
- 边界重叠风险：来源工程把生成、编码规范、编译验证、部署测试放在一起；新插件必须拆开，与 `coding-iris-plugin` 分工。
- 体量风险：规则、MOC、接口索引体量大，不适合默认 thin-index。
- 工具绑定风险：来源 `CLAUDE.md` 是工具专属入口，不能作为 canonical 规则源。

## 建议下一步

1. 建立候选资产清单，只针对字段语义别名、表头映射、文档解析、匹配诊断做第一轮保留。
2. 对 `rules/` 做逐文件分级：字段语义、取值表达式、私有事实、样例残留、错误规则。
3. 先设计插件 README/AGENTS/skills 的边界，不创建正式实现代码。
4. 明确接口插件调用 `coding-iris-plugin` 的协议：生成前读取编码规范，生成后交给 coding 插件审查/编译/部署。
5. 设计 MarkItDown 按需安装和缓存策略，再决定是否替换来源 `.doc` 转换链路。

## 已执行验证

- `git reset --hard HEAD` 后定点清理接口插件实验目录，回滚后工作区一度干净。
- `git clone https://gitee.com/soneakeko/agent-architecture.git tmp/his-interface-agent` 成功。
- `git -C tmp/his-interface-agent rev-parse HEAD` 返回 `43e12b345c58ba11a48980828503daf29ae309ec`。
- `python -m src --help` 成功，确认 CLI 子命令存在。
- `python -m src rule list-domains` 成功加载规则，但报告 23 个规则问题。
- `python -m pytest tests/unit -q` 未运行成功：当前 Python 环境未安装 `pytest`。
