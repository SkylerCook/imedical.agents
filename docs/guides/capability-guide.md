# 能力使用指南（非 xc）

本手册帮助使用者选择能力、提供输入和判断结果。[能力目录](capability-catalog.md)列出非 xc 插件内全部 skill、rule 及源文件；本文为每个 skill 提供请求示例。详细操作和最新参数以链接的 SKILL.md 为准。

## 第一次使用

1. 在目标业务工程中工作，先让 Agent 读取该工程的 `AGENTS.md`。本仓库是能力源，业务需求不在本仓执行。
2. 尚未安装 `.agents` 时，按[安装与更新手册](../update-agents.md)接入；已有能力包也从该手册检查。Node.js 是能力包工具链依赖，不是业务系统生产依赖；文档转换、浏览器预览等专项依赖由对应技能检查。
3. 查看目标工程 `.agents/config/plugin_profile.md`：`available` 表示可发现但尚未接入，`enabled` 表示参与常规更新和使用，`disabled` 表示禁用。目录存在或手册列出该插件不代表已启用。基础插件缺省策略也不能覆盖已有显式状态。
4. 明确要求接入所需插件时，使用[目录中的接入入口](capability-catalog.md#插件一览)，由 Agent 核对依赖、项目配置和 thin-index。纯初始化 skill 不出现在日常薄索引中时，直接读取插件内的真实 `SKILL.md`；无需为每次任务重新初始化。
5. 选择下表中的场景，提供对象、目标和操作范围。既有授权继续有效；仅讨论或要求计划时，保持对应范围。

标准工程中，真实技能通常位于 `.agents/plugins/<插件>/skills/<技能>/SKILL.md`，生成的 `.agents/skills/<技能>/SKILL.md` 只是指向真实文件的薄索引。Workspace Overlay 必须先解析 `capability.json`，从实际 CapabilityRoot 读取能力、从 ContextRoot 读取模块配置；路径和操作方法见[Overlay 手册](../workspace-overlay.md)，不要按目录层级猜测。

## 按场景选择

| 我想做什么 | 推荐入口 | 应提供的信息 |
|---|---|---|
| 初始化、修正或精简项目上下文 | [project-context-maintenance](#agent-context-kit) | 目标工程、初始化或维护范围 |
| 在另一种 Agent 工具中发现已有技能 | [coding-agent-adaptation](#agent-context-kit) | 已安装的工程、目标宿主 |
| 给当前需求留交接、下次继续 | [task-handoff](#agent-context-kit) | 当前需求或明确交接路径 |
| 明确的 IRIS 前端或后端修改 | [iris-frontend-coding / iris-backend-coding](#coding-iris-plugin) | 页面或类方法、预期行为 |
| 前后端混合或不清楚改哪里 | [iris-coding](#coding-iris-plugin) | 功能入口、需求和范围 |
| 查业务资料、API 或调用关系 | [知识与元数据入口](#coding-iris-plugin)、[IRIS 图谱](#iris-codegraph)、[CodeGraph 查询](#codegraph-query) | 问题、符号、来源或源码范围 |
| 解析 Word、PDF 或 Excel | [extract-doc-ingest](#extract-doc) | 文档路径、是否需要版面结构 |
| 按接口规范开发接口 | [iris-interface-dev](#iris-interface-dev) | 规范、字段语义、已确认计划 |
| 接入第三方预约挂号平台 | [iris-external-reg](#iris-external-reg) | 平台协议、业务映射和工程入口 |
| 新建 CA/CR 或改造已有表单 | [iris-cure-form-dev](#iris-cure-form-dev) | 文档或模板、CA/CR 类型、目标设备 |
| 页面、字典或打印国际化 | [i18n-iris-plugin](#i18n-iris-plugin) | 页面或模板、语言、文案类别 |
| 开发医生站 AI 集成 | [iris-imedical-doctor-ai](#iris-imedical-doctor-ai) | 现有宿主、业务服务、交互要求 |
| 整理标版需求、提交或移植 | [需求入口](#coding-iris-plugin) | Git 改动或提交、编号、仓库角色 |
| 发布 IRIS 文件或治疗表单 | [iris-deploy](#coding-iris-plugin)、[cure-form-deploy](#iris-cure-form-dev) | 明确对象、目标、交付方式和授权范围 |
| 沉淀已验证的通用经验 | [agent-framework-evolution](#agent-framework-evolution) | 已验证材料；业务反馈还须满足验收条件 |

## 如何发起请求

最通用的方式是自然语言指定任务和 skill，例如：

> 使用 iris-frontend-coding，修改我指定页面的查询交互。需求和文件路径如下；本轮完成本地实现与验证。

宿主支持技能选择器或 `$技能名` 时，也可以使用其原生入口。`$技能名` 不是 PowerShell 命令，也不是所有 Agent 工具都支持的通用语法。宿主没有技能发现能力时，让 Agent 直接读取真实 `SKILL.md` 并按其流程执行；这不改变插件启用与授权条件。宿主发现适配见[技能适配说明](../coding-agent-adaptation.md)。

只有 skill 明确声明的参数才可使用。例如下面是给 Agent 的请求：

```text
使用 iris-demand-entry --text，从当前标版改动生成需求录入文本。
使用 iris-demand-commit --plan，只生成已验证改动的提交方案。
```

`--plan`、`--commit` 不是所有 skill 的通用参数。对没有这些参数的能力，直接说“先给计划”“只做差异检查”或“执行已确认范围”；实际脚本命令由 Agent 按技能正文选择。需要手工执行时，使用源文档中的完整命令，并确认运行目录和前提。

一次请求尽量给齐：**目标工程、文件或对象、预期结果、允许的操作范围**。涉及翻译补充目标语言，涉及表单补充 CA/CR，涉及接口补充规范与字段确认情况。连接信息由 Agent 从工程已有配置读取，不粘贴到通用手册或能力文件中。

## Rule、reference 和脚本怎么用

- **Rule**：约束如何执行。Agent 先读工程入口和 profile，再按 skill 或规则索引加载相关 rule；命中前端 i18n 等条件时追加专项约束，不默认全量加载。
- **Reference**：按问题查阅的详细协议、查找表或兼容说明。通过所用 skill/rule 的引用进入，不能因为属于同一插件就全部读入。
- **Template**：初始化或生成产物的骨架。按项目实际填写，不把占位值当作工程事实，不直接覆盖已有配置。
- **Script**：由技能编排的执行工具。先核对适用范围、运行目录及参数；本地检查通过不等同于远端部署或业务验收通过。

例如修改明确的 HISUI 页面时，使用 `iris-frontend-coding`，按其引用读取通用及前端规则；只有工程已启用 i18n 且任务或差异命中相应信号时才追加 i18n 规则。具体矩阵以 [iris_coding_frontend](../../plugins/coding-iris-plugin/rules/iris_coding_frontend.md) 为准。用户也可点名要求审查某条规则的符合情况，无需把 rule 当作独立技能安装。

## 几条完整使用路线

| 场景 | 顺序与关键交接 |
|---|---|
| 通用接口 | `iris-interface-doc-ingest` → `iris-interface-field-match` → 确认字段歧义 → `iris-interface-dev-plan` → 计划确认后 `iris-interface-build` → 需要远端操作时交给 `iris-deploy` |
| 文档新建治疗表单 | `extract-doc-ingest` 提取结构 → `cure-form-requirement-adapter` 生成规格 → 人工确认且 unresolved 清零 → CA 用 `cure-assess-form-dev`，CR 用 `cure-record-form-dev` → 预览与交互验证 → 按范围进入 `cure-form-deploy` |
| 现有表单响应式 | `cure-form-responsive` 检查模板并保留契约 → 完整预览与验证 → 需要发布时进入部署流程；新任务不必使用旧名称 |
| 页面国际化 | 定位链路和分类 → `i18n-coding` / `i18n-text-extract` → 页面非字典文案用 `i18n-page-trans-seed`，字典项用 `i18n-bdp-trans-seed` → 核验；已有服务器翻译迁移用 `i18n-csp-trans-sync` |
| 标版需求录入 | `iris-demand-entry --text`（按需加 `--excel`）→ 用户录入 BOSS → 回填编号与标题 → `--bind` / `--plan` → 明确提交时 `--commit`；完整参数见[需求录入协议](../../plugins/coding-iris-plugin/references/standard-demand-entry.md) |
| 跨会话继续需求 | 启用 `task-handoff` → 执行 Agent 在关键节点维护 → 明确交接时保存快照 → 新会话读取记录、inspect 核实现场 → 继续已授权范围；详见[交接说明](../task-handoff.md) |

这些路线允许在已有可信产物处接续，不要求重复完成前置工作。表单的规格批准、交互验证、版本哈希及部署门禁仍按[交付协议](../../plugins/iris-cure-form-dev/references/cure-form-delivery-workflow.md)执行；批量脚本化表单交互的授权要求见其[交互测试协议](../../plugins/iris-cure-form-dev/references/cure-form-interaction-test-v1.md)。

## 常见疑问

| 现象 | 应检查什么 |
|---|---|
| 目录里有插件，但技能列表没有 | 核对 enabled 状态、依赖、薄索引 source 与宿主发现适配；纯 init 被排除属于预期行为 |
| 更新能力包后旧工程仍未出现自然语言路由 | 常规更新不覆盖业务 AGENTS；需要时明确维护工程入口，见[更新手册](../update-agents.md) |
| 报依赖或配置缺失 | 依据 manifest 和目标 profile 定位缺口，使用对应初始化入口；不凭空填写服务器或项目事实 |
| 图谱查不到或查到的关系不对 | 检查覆盖范围、新鲜度，再回源码核实；图谱候选不替代编译或运行证据 |
| 文档解析成功却缺字段 | 看 diagnostics；扫描件和复杂版面需视觉核对，未确认内容不能作为已批准规格 |
| 只生成了计划，未上传或写入服务器 | 核对请求是否包含实际执行与具体对象；本地计划、提交、服务器写入和 push 是不同操作范围 |

结果应区分“产物已生成”“本地验证通过”“远端已生效”和“业务验收通过”。本手册只整理现有入口，不宣称所有平台、宿主或真实设备均已验证。文档随既有 `docs/` 分发，更新后从能力包 docs 阅读；本轮无需配置迁移或兼容清理，也不自动同步业务副本。

以下按插件列出全部 skill 的使用示例。


## agent-context-kit

[查看该插件清单](capability-catalog.md#agent-context-kit)。下面的示例发给 Agent，不在终端执行；路径、对象和范围替换为当前工程实际值。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [coding-agent-adaptation](../../plugins/agent-context-kit/skills/coding-agent-adaptation/SKILL.md) | 把当前工程已有技能接入 CodeBuddy，检查发现入口。 | 已有 .agents，明确宿主；产出链接检查结果，已有冲突内容保留。 |
| [project-context-maintenance](../../plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md) | 检查当前工程上下文，更新已过时的事实并精简重复说明。 | 提供目标工程和维护范围；产出适用的 AGENTS、规则、记忆或配置变更。 |
| [task-handoff](../../plugins/agent-context-kit/skills/task-handoff/SKILL.md) | 为当前需求启用交接；下次从交接记录继续。 | 同机同工作区、串行接续；产出 docs/handoff 下正文及现场记录，明确交接时留快照。 |

## agent-framework-evolution

[查看该插件清单](capability-catalog.md#agent-framework-evolution)。下面的示例发给 Agent，不在终端执行；路径、对象和范围替换为当前工程实际值。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [agent-framework-evolution-init](../../plugins/agent-framework-evolution/skills/agent-framework-evolution-init/SKILL.md) | 在当前工程启用 agent-framework-evolution，检查技能入口。 | 保留显式插件状态；只接入入口，不执行反馈或打包。 |
| [agent-framework-feedback](../../plugins/agent-framework-evolution/skills/agent-framework-feedback/SKILL.md) | 这个业务需求已验收，请只读审查本次框架反馈候选。 | 业务需求已明确验收且反馈适用；先给候选，写入和提升另按授权执行；框架维护不触发。 |
| [reusable-content-packaging](../../plugins/agent-framework-evolution/skills/reusable-content-packaging/SKILL.md) | 把这份已验证的通用流程整理成能力包，去掉项目私有信息。 | 提供经验来源、验证证据与目标范围；产出通用能力文件及接入说明。 |

## coding-iris-plugin

[查看该插件清单](capability-catalog.md#coding-iris-plugin)。下面的示例发给 Agent，不在终端执行；路径、对象和范围替换为当前工程实际值。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [coding-iris-init](../../plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md) | 为当前 IRIS 工程接入 coding-iris-plugin，检查现有配置和脚本入口。 | 目标工程与实际配置可核实；产出 profile、脚本及薄索引检查结果，保留已有值。 |
| [iris-backend-coding](../../plugins/coding-iris-plugin/skills/iris-backend-coding/SKILL.md) | 修改指定类方法以满足这份需求，沿用当前分层和返回约定。 | 提供类方法、需求及验证范围；产出本地源码和验证结果，编译与运行结果分开报告。 |
| [iris-coding](../../plugins/coding-iris-plugin/skills/iris-coding/SKILL.md) | 修改这个功能，先查明前后端调用链，再完成范围内实现。 | 提供功能入口和需求；产出任务路由、相关前后端变更及验证说明。 |
| [iris-demand-commit](../../plugins/coding-iris-plugin/skills/iris-demand-commit/SKILL.md) | 使用 iris-demand-commit --plan，为已验证改动生成提交方案。 | 实现已验证；--plan 不提交，明确 --commit 才执行本地提交；push 独立授权。 |
| [iris-demand-entry](../../plugins/coding-iris-plugin/skills/iris-demand-entry/SKILL.md) | 使用 iris-demand-entry --text，根据当前改动整理标版需求录入文本。 | 仅 standard；产出文本或可选 Excel，人工录 BOSS 后回填编号，再衔接提交。输出限工程临时目录或正式需求目录，不写入 `.agents/` 或能力包源码。 |
| [iris-demand-promote](../../plugins/coding-iris-plugin/skills/iris-demand-promote/SKILL.md) | 先评估将 DEV 的指定提交移植到指定 PRD 仓库的范围和基线。 | 明确两个仓库、提交及服务器基线读取范围；授权实施后形成 PRD 本地提交，不部署。 |
| [iris-deploy](../../plugins/coding-iris-plugin/skills/iris-deploy/SKILL.md) | 为这几个已确认文件生成部署计划，列明上传、编译与验证步骤。 | 明确目标、文件和授权范围；先给清单，远端执行后分别报告上传、编译、回读结果。 |
| [iris-frontend-coding](../../plugins/coding-iris-plugin/skills/iris-frontend-coding/SKILL.md) | 调整指定 HISUI 页面的交互，保留现有数据和调用契约。 | 提供页面与行为要求；产出本地前端变更及交互验证，按条件加载 i18n。 |
| [iris-frontend-gb2312-promote](../../plugins/coding-iris-plugin/skills/iris-frontend-gb2312-promote/SKILL.md) | 这是仍需 GB2312 的历史工程，请先检查转换文件与源文件的替换范围。 | 必须明确历史编码要求及文件替换授权；产出源名提升结果，普通 UTF-8 工程不使用。 |
| [iris-imedical-knowledge](../../plugins/coding-iris-plugin/skills/iris-imedical-knowledge/SKILL.md) | 查询这个业务概念的相关参考，再结合当前源码核实。 | 给出业务词或疑点；产出来源和适用性说明，现有信息足够时无需查询。 |
| [iris-mcp-lookup](../../plugins/coding-iris-plugin/skills/iris-mcp-lookup/SKILL.md) | 核实这个 IRIS 类方法的签名和当前可用能力，注明来源。 | 给出类方法或文档线索；依当前 MCP、本地源码或官方文档返回证据，不猜签名。 |
| [iris-menu-sync](../../plugins/coding-iris-plugin/skills/iris-menu-sync/SKILL.md) | 刷新指定安全组的菜单资料快照，先检查采集范围。 | 明确全部或指定组及读取范围；产出本地快照和差异，不修改 HIS 菜单或权限。 |

## extract-doc

[查看该插件清单](capability-catalog.md#extract-doc)。下面的示例发给 Agent，不在终端执行；路径、对象和范围替换为当前工程实际值。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [extract-doc-ingest](../../plugins/extract-doc/skills/extract-doc-ingest/SKILL.md) | 解析 docs 下指定接口文档，保留结构化结果并报告识别缺口。 | 提供 PDF、DOC、DOCX、XLS 或 XLSX，先检查转换依赖；产出 source.md、parsed.json、fields.md、diagnostics.md。 |

## i18n-iris-plugin

[查看该插件清单](capability-catalog.md#i18n-iris-plugin)。下面的示例发给 Agent，不在终端执行；路径、对象和范围替换为当前工程实际值。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [i18n-bdp-trans-seed](../../plugins/i18n-iris-plugin/skills/i18n-bdp-trans-seed/SKILL.md) | 把确认后的字典词条生成目标语言翻译表和 SQL。 | 明确语言、词条分类及 profile 存储；产出种子，不把字典项写到页面翻译存储。 |
| [i18n-coding](../../plugins/i18n-iris-plugin/skills/i18n-coding/SKILL.md) | 为指定页面增加英文支持，先定位链路并区分文案类型。 | i18n 已启用且语言和范围明确；产出编码改动、稳定 key 与相关验证。 |
| [i18n-csp-trans-sync](../../plugins/i18n-iris-plugin/skills/i18n-csp-trans-sync/SKILL.md) | 对比指定页面的服务器翻译与本地种子，只输出差异。 | 明确页面、语言、动作和读取范围；默认 report-only，同步需明确方向和写入授权。 |
| [i18n-page-trans-seed](../../plugins/i18n-iris-plugin/skills/i18n-page-trans-seed/SKILL.md) | 把确认后的页面提示语追加为英文翻译种子。 | 已分类的页面非字典词条、语言和 profile；产出批次加载及回滚方法，不自动部署加载。 |
| [i18n-project-init](../../plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md) | 为当前工程启用 i18n，检查语言与翻译存储配置。 | coding-iris-plugin 已启用；产出 i18n profile 和发现入口，保留项目既有配置。 |
| [i18n-text-extract](../../plugins/i18n-iris-plugin/skills/i18n-text-extract/SKILL.md) | 提取指定页面及其后端可见中文，生成英文待翻译词条表。 | 提供源码范围和目标语言；产出分类词条，避免将技术标识符当文案。 |
| [i18n-xml-print-template-sync](../../plugins/i18n-iris-plugin/skills/i18n-xml-print-template-sync/SKILL.md) | 检查指定打印功能是否使用 XML 模板，并规划英文版本。 | 先确认实际渲染链路；产出导出、翻译、写回及验证方案，服务器写入按明确授权执行。 |
| [i18n-xml-template](../../plugins/i18n-iris-plugin/skills/i18n-xml-template/SKILL.md) | 翻译这份 XML 的可见 defaultvalue 文本为英文并检查布局。 | 提供本地 XML 和目标语言；产出编码、布局检查后的模板，不替代服务器发布。 |

## iris-codegraph

[查看该插件清单](capability-catalog.md#iris-codegraph)。下面的示例发给 Agent，不在终端执行；路径、对象和范围替换为当前工程实际值。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [iris-codegraph](../../plugins/iris-codegraph/skills/iris-codegraph/SKILL.md) | 查询指定类方法的影响范围；图谱不可用时先报告缺口。 | coding-iris 已启用；构建需连接配置及源码缓存，产出 .iris-codegraph 图谱或源码核实后的查询结果。 |

## codegraph-query

[查看该插件清单](capability-catalog.md#codegraph-query)。下面的示例发给 Agent，不在终端执行；路径、对象和范围替换为当前工程实际值。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [codegraph-query](../../plugins/codegraph-query/skills/codegraph-query/SKILL.md) | 查这个函数的调用者，并回到源码核实影响范围。 | 已有完整且无待同步变更的 .codegraph/codegraph.db；产出候选和源码证据，不构建该索引。 |

## iris-cure-form-dev

[查看该插件清单](capability-catalog.md#iris-cure-form-dev)。下面的示例发给 Agent，不在终端执行；路径、对象和范围替换为当前工程实际值。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [cure-assess-form-dev](../../plugins/iris-cure-form-dev/skills/cure-assess-form-dev/SKILL.md) | 按这份已批准的 CA 规格生成评估表单并提供预览。 | formType=CA、unresolved 为空且规格已批准；产出 HTML、JS、根片段及验证材料。 |
| [cure-form-deploy](../../plugins/iris-cure-form-dev/skills/cure-form-deploy/SKILL.md) | 为已验证的表单准备手动部署交付包，列出回读检查。 | 明确对象、版本、哈希和交付方式；产出包及验证材料，实际写入或回滚须有对应授权。 |
| [cure-form-fragment](../../plugins/iris-cure-form-dev/skills/cure-form-fragment/SKILL.md) | 从这份完整 CA 表单 HTML 提取可粘贴的根片段。 | 提供完整 HTML 与根容器；产出纯根 div 片段，不携带整页资源标签。 |
| [cure-form-init](../../plugins/iris-cure-form-dev/skills/cure-form-init/SKILL.md) | 为当前工程接入治疗表单能力，先检查资源与依赖。 | 依赖 extract-doc 和 coding-iris；产出本地 profile、入口及依赖检查，连接探针需允许读取。 |
| [cure-form-lookup](../../plugins/iris-cure-form-dev/skills/cure-form-lookup/SKILL.md) | 为指定治疗表单增加这份字段定义对应的 Lookup。 | 明确 CA/CR 宿主、字段和数据来源；产出 Lookup HTML、JS 和只读查询 SQL。 |
| [cure-form-requirement-adapter](../../plugins/iris-cure-form-dev/skills/cure-form-requirement-adapter/SKILL.md) | 把指定 Word 评估单转成 CA 规格，列出待确认字段。 | 文档先做结构提取，或提供模板快照；产出 cure-form-spec/v1，未确认项清零且人工确认后才批准。 |
| [cure-form-responsive](../../plugins/iris-cure-form-dev/skills/cure-form-responsive/SKILL.md) | 把指定已有表单适配手机和 PAD，保留保存、回显与打印契约。 | 提供本地模板或允许读取的服务器对象；产出改造模板、完整预览及契约验证，真机结果单列。 |
| [cure-record-form-dev](../../plugins/iris-cure-form-dev/skills/cure-record-form-dev/SKILL.md) | 按这份已批准的 CR 规格生成记录表单并提供预览。 | formType=CR、unresolved 为空且规格已批准；产出 HTML、JS、根片段及 CR 保存回显打印验证材料。 |
| [make-assess-form-responsive](../../plugins/iris-cure-form-dev/skills/make-assess-form-responsive/SKILL.md) | 使用 make-assess-form-responsive 改造这份已有表单。 | 仅旧入口兼容，实际执行 cure-form-responsive；新任务优先使用新名称。 |

## iris-external-reg

[查看该插件清单](capability-catalog.md#iris-external-reg)。下面的示例发给 Agent，不在终端执行；路径、对象和范围替换为当前工程实际值。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [iris-external-reg](../../plugins/iris-external-reg/skills/iris-external-reg/SKILL.md) | 依据指定平台协议制定预约挂号接入计划，核对 HIS 标准能力。 | 提供规范与工程入口；产出解析与计划；计划确认后进入获授权的实现，复用 RegInterface。 |

## iris-imedical-doctor-ai

[查看该插件清单](capability-catalog.md#iris-imedical-doctor-ai)。下面的示例发给 Agent，不在终端执行；路径、对象和范围替换为当前工程实际值。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [iris-imedical-doctor-ai](../../plugins/iris-imedical-doctor-ai/skills/iris-imedical-doctor-ai/SKILL.md) | 在现有医生站 AI 中增加诊断推荐采纳，先核对宿主和业务服务。 | 已有或拟新增的医生站接入位置；产出集成代码和兼容验证，普通 HIS 开发与独立 AI 应用不触发。 |
| [iris-imedical-doctor-ai-init](../../plugins/iris-imedical-doctor-ai/skills/iris-imedical-doctor-ai-init/SKILL.md) | 启用医生站 AI 开发插件，复用现有 IRIS 配置。 | coding-iris 已启用且依赖兼容；产出插件状态和日常技能入口，不复制固定原型或连接配置。 |

迁移请求示例：将现有业务界面改为 AI Card，先对照各入口有效参数与完成/取消契约，再用插件 async-contract-probe 辅助测试真实业务适配层。工具使用与证据边界见 [验证参考](../../plugins/iris-imedical-doctor-ai/references/verification.md#异步迁移故障注入)。

## iris-interface-dev

[查看该插件清单](capability-catalog.md#iris-interface-dev)。下面的示例发给 Agent，不在终端执行；路径、对象和范围替换为当前工程实际值。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [iris-interface-build](../../plugins/iris-interface-dev/skills/iris-interface-build/SKILL.md) | 按已确认计划实现接口方法和前端调用，并做离线审查。 | 已有字段确认和实施计划；产出本地 .cls、.js、.csp 及配置项，远端动作交给 coding-iris。 |
| [iris-interface-dev-plan](../../plugins/iris-interface-dev/skills/iris-interface-dev-plan/SKILL.md) | 基于解析和字段匹配结果生成接口开发计划。 | 提供 parsed.json、fields.md、diagnostics.md 及确认结果；产出 implementation-plan.md，编码转 iris-interface-build。 |
| [iris-interface-doc-ingest](../../plugins/iris-interface-dev/skills/iris-interface-doc-ingest/SKILL.md) | 解析指定厂家接口文档，生成后续字段匹配所需产物。 | 提供文档并可用 extract-doc；产出 docs/interface 下的解析文件，使用接口专用 schema。 |
| [iris-interface-field-match](../../plugins/iris-interface-dev/skills/iris-interface-field-match/SKILL.md) | 对已解析接口字段做匹配，列出低置信候选和人工确认项。 | 提供 parsed.json、fields.md 和可选本地反馈；产出 field-match.json、field-match.md，不擅自确认歧义。 |
| [iris-interface-init](../../plugins/iris-interface-dev/skills/iris-interface-init/SKILL.md) | 为当前工程接入接口开发能力，检查解析和编码依赖。 | 依赖 extract-doc 与 coding-iris；产出 profile、输出目录和薄索引状态。 |
