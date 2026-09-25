# 能力目录（非 xc）

面向使用者的插件、skill 与 rule 清单。先读[使用指南](capability-guide.md)，或按下面的插件定位具体入口。

范围：当前非 `imedicalxc-*` 插件，共 **11 个插件、46 个 skill、35 个 rule**；skill 数包含初始化和兼容入口，不包含 vendor skills、Agent 生成入口或源仓维护 skill。xc 本轮未编入，后续单独补齐。清单按当前文件快照核对；版本和依赖范围以各插件 manifest 为准。

## 插件一览

插件是能力包和启用边界，skill 是任务入口，rule 是执行约束。目录存在仅表示 available；实际使用还要检查目标工程的插件状态。

| 插件 | 用途 | 接入入口 | 直接依赖 |
|---|---|---|---|
| [agent-context-kit](#agent-context-kit) | 项目上下文、宿主技能接入、需求交接 | [project-context-maintenance](../../plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md) | 无插件依赖 |
| [agent-framework-evolution](#agent-framework-evolution) | 已验收业务需求反馈与通用能力打包 | [agent-framework-evolution-init](../../plugins/agent-framework-evolution/skills/agent-framework-evolution-init/SKILL.md) | 无插件依赖 |
| [coding-iris-plugin](#coding-iris-plugin) | IRIS 前后端开发、知识查询、需求提交与部署 | [coding-iris-init](../../plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md) | 无插件依赖 |
| [extract-doc](#extract-doc) | 文档解析和结构化落盘 | [extract-doc-ingest](../../plugins/extract-doc/skills/extract-doc-ingest/SKILL.md) | 无插件依赖 |
| [i18n-iris-plugin](#i18n-iris-plugin) | IRIS 页面、字典与打印国际化 | [i18n-project-init](../../plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md) | coding-iris-plugin |
| [iris-codegraph](#iris-codegraph) | IRIS/ObjectScript 图谱构建与查询 | [iris-codegraph](../../plugins/iris-codegraph/skills/iris-codegraph/SKILL.md) | coding-iris-plugin |
| [codegraph-query](#codegraph-query) | 现有前端或脚本 CodeGraph 索引查询 | [codegraph-query](../../plugins/codegraph-query/skills/codegraph-query/SKILL.md) | iris-codegraph |
| [iris-cure-form-dev](#iris-cure-form-dev) | CA/CR 治疗表单开发、响应式改造与部署 | [cure-form-init](../../plugins/iris-cure-form-dev/skills/cure-form-init/SKILL.md) | extract-doc、coding-iris-plugin |
| [iris-external-reg](#iris-external-reg) | 第三方预约挂号专用接口开发 | [iris-external-reg](../../plugins/iris-external-reg/skills/iris-external-reg/SKILL.md) | extract-doc、coding-iris-plugin |
| [iris-imedical-doctor-ai](#iris-imedical-doctor-ai) | 医生站 AI 集成与兼容验证 | [iris-imedical-doctor-ai-init](../../plugins/iris-imedical-doctor-ai/skills/iris-imedical-doctor-ai-init/SKILL.md) | coding-iris-plugin |
| [iris-interface-dev](#iris-interface-dev) | 通用接口文档解析、字段匹配与实现 | [iris-interface-init](../../plugins/iris-interface-dev/skills/iris-interface-init/SKILL.md) | extract-doc、coding-iris-plugin |

接入入口不一定是纯初始化 skill：例如 project-context-maintenance、extract-doc-ingest 和两个图谱入口也承担日常任务。是否生成薄索引以 manifest 的 thinIndex.excludeSkills 为准；不能仅按 initSkill 字段排除。

## agent-context-kit

项目上下文、宿主技能接入、需求交接。详见[插件说明](../../plugins/agent-context-kit/README.md)和[manifest](../../plugins/agent-context-kit/.agents-plugin/plugin.json)；[使用示例](capability-guide.md#agent-context-kit)。

### Skills

| 入口 | 中文用途 | 入口类型 |
|---|---|---|
| [coding-agent-adaptation](../../plugins/agent-context-kit/skills/coding-agent-adaptation/SKILL.md) | 将项目技能接入指定 Agent 宿主 | 日常入口 |
| [project-context-maintenance](../../plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md) | 初始化、维护或优化项目上下文 | 日常入口 |
| [task-handoff](../../plugins/agent-context-kit/skills/task-handoff/SKILL.md) | 为需求建立交接并跨会话接续 | 日常入口 |

### Rules

本插件没有独立 rules 目录；执行约束见所用 SKILL.md 及其条件引用。

辅助资料：[templates](../../plugins/agent-context-kit/templates) · [scripts](../../plugins/agent-context-kit/scripts)。按 skill 的引用选择所需资料，不需要逐个加载或执行。

## agent-framework-evolution

已验收业务需求反馈与通用能力打包。详见[插件说明](../../plugins/agent-framework-evolution/README.md)和[manifest](../../plugins/agent-framework-evolution/.agents-plugin/plugin.json)；[使用示例](capability-guide.md#agent-framework-evolution)。

### Skills

| 入口 | 中文用途 | 入口类型 |
|---|---|---|
| [agent-framework-evolution-init](../../plugins/agent-framework-evolution/skills/agent-framework-evolution-init/SKILL.md) | 接入反馈与能力打包入口 | 纯初始化，直接读取源文件 |
| [agent-framework-feedback](../../plugins/agent-framework-evolution/skills/agent-framework-feedback/SKILL.md) | 按共享准入筛选已验收业务需求的经验与框架反馈 | 日常入口 |
| [reusable-content-packaging](../../plugins/agent-framework-evolution/skills/reusable-content-packaging/SKILL.md) | 将已验证经验打包为可复用能力 | 日常入口 |

### Rules

本插件没有独立 rules 目录；执行约束见所用 SKILL.md 及其条件引用。

## coding-iris-plugin

IRIS 前后端开发、知识查询、需求提交与部署。详见[插件说明](../../plugins/coding-iris-plugin/README.md)和[manifest](../../plugins/coding-iris-plugin/.agents-plugin/plugin.json)；[使用示例](capability-guide.md#coding-iris-plugin)。

### Skills

| 入口 | 中文用途 | 入口类型 |
|---|---|---|
| [coding-iris-init](../../plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md) | 初始化 IRIS 编码能力 | 纯初始化，直接读取源文件 |
| [iris-backend-coding](../../plugins/coding-iris-plugin/skills/iris-backend-coding/SKILL.md) | 实现或修改 ObjectScript 后端 | 日常入口 |
| [iris-coding](../../plugins/coding-iris-plugin/skills/iris-coding/SKILL.md) | 路由混合或边界不明的 IRIS 开发 | 日常入口 |
| [iris-demand-commit](../../plugins/coding-iris-plugin/skills/iris-demand-commit/SKILL.md) | 生成需求提交方案或执行本地提交 | 日常入口 |
| [iris-demand-entry](../../plugins/coding-iris-plugin/skills/iris-demand-entry/SKILL.md) | 从标版 Git 改动生成需求录入材料 | 日常入口 |
| [iris-demand-promote](../../plugins/coding-iris-plugin/skills/iris-demand-promote/SKILL.md) | 将 DEV 已提交需求移植到 PRD 本地仓库 | 日常入口 |
| [iris-deploy](../../plugins/coding-iris-plugin/skills/iris-deploy/SKILL.md) | 规划和执行 IRIS 远端部署 | 日常入口 |
| [iris-frontend-coding](../../plugins/coding-iris-plugin/skills/iris-frontend-coding/SKILL.md) | 实现 CSP、JavaScript、CSS、HISUI 前端 | 日常入口 |
| [iris-frontend-gb2312-promote](../../plugins/coding-iris-plugin/skills/iris-frontend-gb2312-promote/SKILL.md) | 提升明确历史 GB2312 工程的转换文件 | 日常入口 |
| [iris-imedical-knowledge](../../plugins/coding-iris-plugin/skills/iris-imedical-knowledge/SKILL.md) | 检索 wiki、菜单与技术参考 | 日常入口 |
| [iris-mcp-lookup](../../plugins/coding-iris-plugin/skills/iris-mcp-lookup/SKILL.md) | 核实 IRIS 元数据和官方 API 文档 | 日常入口 |
| [iris-menu-sync](../../plugins/coding-iris-plugin/skills/iris-menu-sync/SKILL.md) | 刷新项目本地菜单资料快照 | 日常入口 |

### Rules

| 规则 | 何时读取、约束什么 |
|---|---|
| [iris_agentic_dev](../../plugins/coding-iris-plugin/rules/iris_agentic_dev.md) | 使用 IRIS MCP 时，核对能力边界与诊断方式 |
| [iris_coding_backend](../../plugins/coding-iris-plugin/rules/iris_coding_backend.md) | 修改 ObjectScript 时，遵循后端语法、分层和返回约定 |
| [iris_coding_frontend](../../plugins/coding-iris-plugin/rules/iris_coding_frontend.md) | 修改 CSP、JS、CSS、HISUI 时，遵循前端规范与条件 i18n 门禁 |
| [iris_coding_general](../../plugins/coding-iris-plugin/rules/iris_coding_general.md) | IRIS 编码共用的编辑安全、风险分流和最小修改要求 |
| [iris_coding_index](../../plugins/coding-iris-plugin/rules/iris_coding_index.md) | 读取项目 profile 后，选择 IRIS 编码规则入口 |
| [iris_coding_workflow](../../plugins/coding-iris-plugin/rules/iris_coding_workflow.md) | 涉及脚本、MCP、上传、编译和远端验证时使用 |
| [iris_deploy_checklist](../../plugins/coding-iris-plugin/rules/iris_deploy_checklist.md) | 明确远端上传、编译、部署或验证时，执行对应清单 |
| [iris_gb2312_workflow](../../plugins/coding-iris-plugin/rules/iris_gb2312_workflow.md) | 仅明确历史 GB2312 工程的永久替换流程 |
| [iris_knowledge_lookup](../../plugins/coding-iris-plugin/rules/iris_knowledge_lookup.md) | 查询类 API、宏、SQL 元数据或官方文档时选择证据来源 |
| [sftp_server](../../plugins/coding-iris-plugin/rules/sftp_server.md) | 实际使用 SFTP 远端读取、上传、同步或命令执行时使用 |

辅助资料：[references](../../plugins/coding-iris-plugin/references) · [templates](../../plugins/coding-iris-plugin/templates) · [scripts](../../plugins/coding-iris-plugin/scripts)。按 skill 的引用选择所需资料，不需要逐个加载或执行。

## extract-doc

文档解析和结构化落盘。详见[插件说明](../../plugins/extract-doc/README.md)和[manifest](../../plugins/extract-doc/.agents-plugin/plugin.json)；[使用示例](capability-guide.md#extract-doc)。

### Skills

| 入口 | 中文用途 | 入口类型 |
|---|---|---|
| [extract-doc-ingest](../../plugins/extract-doc/skills/extract-doc-ingest/SKILL.md) | 将文档解析为 Markdown 和结构化数据 | 日常入口 |

### Rules

| 规则 | 何时读取、约束什么 |
|---|---|
| [extract_doc_index](../../plugins/extract-doc/rules/extract_doc_index.md) | 文档本地解析、结构化落盘与上下文体量约束 |

辅助资料：[scripts](../../plugins/extract-doc/scripts)。按 skill 的引用选择所需资料，不需要逐个加载或执行。

## i18n-iris-plugin

IRIS 页面、字典与打印国际化。详见[插件说明](../../plugins/i18n-iris-plugin/README.md)和[manifest](../../plugins/i18n-iris-plugin/.agents-plugin/plugin.json)；[使用示例](capability-guide.md#i18n-iris-plugin)。

### Skills

| 入口 | 中文用途 | 入口类型 |
|---|---|---|
| [i18n-bdp-trans-seed](../../plugins/i18n-iris-plugin/skills/i18n-bdp-trans-seed/SKILL.md) | 生成字典和表字段显示值翻译种子 | 日常入口 |
| [i18n-coding](../../plugins/i18n-iris-plugin/skills/i18n-coding/SKILL.md) | 实施前后端国际化改造 | 日常入口 |
| [i18n-csp-trans-sync](../../plugins/i18n-iris-plugin/skills/i18n-csp-trans-sync/SKILL.md) | 导出、比对或同步页面翻译 | 日常入口 |
| [i18n-page-trans-seed](../../plugins/i18n-iris-plugin/skills/i18n-page-trans-seed/SKILL.md) | 生成页面非字典文案翻译种子 | 日常入口 |
| [i18n-project-init](../../plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md) | 初始化或检查项目 i18n 配置 | 纯初始化，直接读取源文件 |
| [i18n-text-extract](../../plugins/i18n-iris-plugin/skills/i18n-text-extract/SKILL.md) | 提取源码中的可翻译可见文案 | 日常入口 |
| [i18n-xml-print-template-sync](../../plugins/i18n-iris-plugin/skills/i18n-xml-print-template-sync/SKILL.md) | 编排服务器 XML 打印模板语言版本 | 日常入口 |
| [i18n-xml-template](../../plugins/i18n-iris-plugin/skills/i18n-xml-template/SKILL.md) | 翻译本地 XML 模板可见文本 | 日常入口 |

### Rules

| 规则 | 何时读取、约束什么 |
|---|---|
| [i18n_coding_backend](../../plugins/i18n-iris-plugin/rules/i18n_coding_backend.md) | 后端提示、错误和表显示值的国际化编码 |
| [i18n_coding_frontend](../../plugins/i18n-iris-plugin/rules/i18n_coding_frontend.md) | 前端可见文案的国际化编码 |
| [i18n_coding_print_backend](../../plugins/i18n-iris-plugin/rules/i18n_coding_print_backend.md) | 打印数据、模板选择和打印输出的后端国际化 |
| [i18n_dict_translate_facade](../../plugins/i18n-iris-plugin/rules/i18n_dict_translate_facade.md) | 后端字典或表字段显示值的共享翻译门面 |
| [i18n_dict_translation_seed](../../plugins/i18n-iris-plugin/rules/i18n_dict_translation_seed.md) | 生成或保存字典、表显示值翻译种子 |
| [i18n_extract_backend](../../plugins/i18n-iris-plugin/rules/i18n_extract_backend.md) | 提取 ObjectScript 或 CSP 服务端可翻译文本 |
| [i18n_extract_frontend](../../plugins/i18n-iris-plugin/rules/i18n_extract_frontend.md) | 提取 CSP、JS、CSS、HISUI 前端可翻译文本 |
| [i18n_field_classification](../../plugins/i18n-iris-plugin/rules/i18n_field_classification.md) | 链路定位后区分字典、页面文案与其它字段 |
| [i18n_hisui_widget_index](../../plugins/i18n-iris-plugin/rules/i18n_hisui_widget_index.md) | 判断 HISUI 自动翻译边界，避免重复包装 helper |
| [i18n_index](../../plugins/i18n-iris-plugin/rules/i18n_index.md) | 读取 i18n profile 后选择专项规则 |
| [i18n_language_catalog](../../plugins/i18n-iris-plugin/rules/i18n_language_catalog.md) | 解析目标语言、语言 ID 和代码 |
| [i18n_link_tracing](../../plugins/i18n-iris-plugin/rules/i18n_link_tracing.md) | 页面或打印国际化前定位实际调用链和数据形态 |
| [i18n_page_translation_seed](../../plugins/i18n-iris-plugin/rules/i18n_page_translation_seed.md) | 页面非字典翻译的生成、加载与回滚约束 |
| [i18n_translation_quality](../../plugins/i18n-iris-plugin/rules/i18n_translation_quality.md) | 生成医疗系统目标语言文案前核对翻译质量 |
| [i18n_verify](../../plugins/i18n-iris-plugin/rules/i18n_verify.md) | 核验国际化编码、提取、种子、模板和同步结果 |

辅助资料：[templates](../../plugins/i18n-iris-plugin/templates) · [scripts](../../plugins/i18n-iris-plugin/scripts)。按 skill 的引用选择所需资料，不需要逐个加载或执行。

## iris-codegraph

IRIS/ObjectScript 图谱构建与查询。详见[插件说明](../../plugins/iris-codegraph/README.md)和[manifest](../../plugins/iris-codegraph/.agents-plugin/plugin.json)；[使用示例](capability-guide.md#iris-codegraph)。

### Skills

| 入口 | 中文用途 | 入口类型 |
|---|---|---|
| [iris-codegraph](../../plugins/iris-codegraph/skills/iris-codegraph/SKILL.md) | 构建或查询 IRIS ObjectScript 图谱 | 日常入口 |

### Rules

| 规则 | 何时读取、约束什么 |
|---|---|
| [iris_codegraph_usage](../../plugins/iris-codegraph/rules/iris_codegraph_usage.md) | 构建或查询 ObjectScript 图谱，区分图谱候选和运行时证据 |

辅助资料：[scripts](../../plugins/iris-codegraph/scripts)。按 skill 的引用选择所需资料，不需要逐个加载或执行。

## codegraph-query

现有前端或脚本 CodeGraph 索引查询。详见[插件说明](../../plugins/codegraph-query/README.md)和[manifest](../../plugins/codegraph-query/.agents-plugin/plugin.json)；[使用示例](capability-guide.md#codegraph-query)。

### Skills

| 入口 | 中文用途 | 入口类型 |
|---|---|---|
| [codegraph-query](../../plugins/codegraph-query/skills/codegraph-query/SKILL.md) | 查询现有前端或脚本 CodeGraph 索引 | 日常入口 |

### Rules

| 规则 | 何时读取、约束什么 |
|---|---|
| [codegraph_query_usage](../../plugins/codegraph-query/rules/codegraph_query_usage.md) | 查询前端或脚本索引时，检查索引新鲜度并回源码核实 |

辅助资料：[scripts](../../plugins/codegraph-query/scripts)。按 skill 的引用选择所需资料，不需要逐个加载或执行。

## iris-cure-form-dev

CA/CR 治疗表单开发、响应式改造与部署。详见[插件说明](../../plugins/iris-cure-form-dev/README.md)和[manifest](../../plugins/iris-cure-form-dev/.agents-plugin/plugin.json)；[使用示例](capability-guide.md#iris-cure-form-dev)。

### Skills

| 入口 | 中文用途 | 入口类型 |
|---|---|---|
| [cure-assess-form-dev](../../plugins/iris-cure-form-dev/skills/cure-assess-form-dev/SKILL.md) | 按已批准规格开发 CA 评估表单 | 日常入口 |
| [cure-form-deploy](../../plugins/iris-cure-form-dev/skills/cure-form-deploy/SKILL.md) | 打包、发布、回读或回滚治疗表单 | 日常入口 |
| [cure-form-fragment](../../plugins/iris-cure-form-dev/skills/cure-form-fragment/SKILL.md) | 从完整表单提取唯一根 div | 日常入口 |
| [cure-form-init](../../plugins/iris-cure-form-dev/skills/cure-form-init/SKILL.md) | 初始化 CA/CR 表单开发能力 | 纯初始化，直接读取源文件 |
| [cure-form-lookup](../../plugins/iris-cure-form-dev/skills/cure-form-lookup/SKILL.md) | 开发治疗表单 Lookup | 日常入口 |
| [cure-form-requirement-adapter](../../plugins/iris-cure-form-dev/skills/cure-form-requirement-adapter/SKILL.md) | 将文档或模板快照转为表单规格 | 日常入口 |
| [cure-form-responsive](../../plugins/iris-cure-form-dev/skills/cure-form-responsive/SKILL.md) | 改造已有 CA/CR 表单响应式布局 | 日常入口 |
| [cure-record-form-dev](../../plugins/iris-cure-form-dev/skills/cure-record-form-dev/SKILL.md) | 按已批准规格开发 CR 记录表单 | 日常入口 |
| [make-assess-form-responsive](../../plugins/iris-cure-form-dev/skills/make-assess-form-responsive/SKILL.md) | 兼容旧名称并转交响应式入口 | 旧名称兼容 |

### Rules

| 规则 | 何时读取、约束什么 |
|---|---|
| [cure_form_deploy](../../plugins/iris-cure-form-dev/rules/cure_form_deploy.md) | 治疗表单部署包、并发版本、写入、回读与回滚约束 |
| [cure_form_index](../../plugins/iris-cure-form-dev/rules/cure_form_index.md) | 选择 CA/CR、文档适配、响应式、Lookup 或部署入口 |
| [cure_form_workflow](../../plugins/iris-cure-form-dev/rules/cure_form_workflow.md) | CA/CR 从规格、实现到验证交付的流程与门禁 |

辅助资料：[references](../../plugins/iris-cure-form-dev/references) · [templates](../../plugins/iris-cure-form-dev/templates) · [scripts](../../plugins/iris-cure-form-dev/scripts)。按 skill 的引用选择所需资料，不需要逐个加载或执行。

## iris-external-reg

第三方预约挂号专用接口开发。详见[插件说明](../../plugins/iris-external-reg/README.md)和[manifest](../../plugins/iris-external-reg/.agents-plugin/plugin.json)；[使用示例](capability-guide.md#iris-external-reg)。

### Skills

| 入口 | 中文用途 | 入口类型 |
|---|---|---|
| [iris-external-reg](../../plugins/iris-external-reg/skills/iris-external-reg/SKILL.md) | 开发第三方预约挂号接口 | 日常入口 |

### Rules

| 规则 | 何时读取、约束什么 |
|---|---|
| [iris_external_reg_index](../../plugins/iris-external-reg/rules/iris_external_reg_index.md) | 第三方预约挂号接口的流程与职责边界 |

辅助资料：[references](../../plugins/iris-external-reg/references) · [scripts](../../plugins/iris-external-reg/scripts)。按 skill 的引用选择所需资料，不需要逐个加载或执行。

## iris-imedical-doctor-ai

医生站 AI 集成与兼容验证。详见[插件说明](../../plugins/iris-imedical-doctor-ai/README.md)和[manifest](../../plugins/iris-imedical-doctor-ai/.agents-plugin/plugin.json)；[使用示例](capability-guide.md#iris-imedical-doctor-ai)。

### Skills

| 入口 | 中文用途 | 入口类型 |
|---|---|---|
| [iris-imedical-doctor-ai](../../plugins/iris-imedical-doctor-ai/skills/iris-imedical-doctor-ai/SKILL.md) | 开发医生站 AI 集成能力 | 日常入口 |
| [iris-imedical-doctor-ai-init](../../plugins/iris-imedical-doctor-ai/skills/iris-imedical-doctor-ai-init/SKILL.md) | 初始化医生站 AI 开发入口 | 纯初始化，直接读取源文件 |

### Rules

本插件没有独立 rules 目录；执行约束见所用 SKILL.md 及其条件引用。

辅助资料：[references](../../plugins/iris-imedical-doctor-ai/references) · [templates](../../plugins/iris-imedical-doctor-ai/templates) · [scripts](../../plugins/iris-imedical-doctor-ai/scripts)。按 skill 的引用选择所需资料，不需要逐个加载或执行。

## iris-interface-dev

通用接口文档解析、字段匹配与实现。详见[插件说明](../../plugins/iris-interface-dev/README.md)和[manifest](../../plugins/iris-interface-dev/.agents-plugin/plugin.json)；[使用示例](capability-guide.md#iris-interface-dev)。

### Skills

| 入口 | 中文用途 | 入口类型 |
|---|---|---|
| [iris-interface-build](../../plugins/iris-interface-dev/skills/iris-interface-build/SKILL.md) | 实现接口源码与配置项 | 日常入口 |
| [iris-interface-dev-plan](../../plugins/iris-interface-dev/skills/iris-interface-dev-plan/SKILL.md) | 生成接口实施计划 | 日常入口 |
| [iris-interface-doc-ingest](../../plugins/iris-interface-dev/skills/iris-interface-doc-ingest/SKILL.md) | 按接口契约解析原始文档 | 日常入口 |
| [iris-interface-field-match](../../plugins/iris-interface-dev/skills/iris-interface-field-match/SKILL.md) | 诊断字段语义匹配与缺口 | 日常入口 |
| [iris-interface-init](../../plugins/iris-interface-dev/skills/iris-interface-init/SKILL.md) | 初始化接口开发工作区 | 纯初始化，直接读取源文件 |

### Rules

| 规则 | 何时读取、约束什么 |
|---|---|
| [iris_interface_index](../../plugins/iris-interface-dev/rules/iris_interface_index.md) | 选择文档解析、字段匹配、计划、实现或部署交接 |
| [iris_interface_review](../../plugins/iris-interface-dev/rules/iris_interface_review.md) | 审查解析字段覆盖和接口源码风险 |
| [iris_interface_workflow](../../plugins/iris-interface-dev/rules/iris_interface_workflow.md) | 接口解析到实现、验证交接的八步流程 |

辅助资料：[references](../../plugins/iris-interface-dev/references) · [templates](../../plugins/iris-interface-dev/templates) · [scripts](../../plugins/iris-interface-dev/scripts)。按 skill 的引用选择所需资料，不需要逐个加载或执行。

## 其它框架内容

| 类型 | 用途与入口 |
|---|---|
| Agent | 按角色分工；见[Agent registry](../../agents/agent-registry.md)，角色定义不是额外插件 |
| Workflow | 阶段化执行；见[Workflow registry](../../workflows/workflow-registry.md)和[调度手册](../agent-orchestration.md)，无子代理时可串行降级 |
| Vendor skills | 按插件依赖与场景加载的第三方能力；见[vendor](../../vendor)，required 与 optional 不等同于默认全量启用 |
| 根级独立 skill | 当前没有；以后新增应单独列出，不混入插件内部技能 |
| 源仓维护 skill | agent-kit-maintenance 只服务本仓维护，不部署业务工程，入口见源仓 AGENTS.md |

## 清单维护

本页与使用指南是导航和摘要，实际契约仍由 manifest、SKILL.md、rule 及其引用维护。新增、删除、重命名或改变入口行为时，同步更新对应清单行、示例和 README 入口；不要复制规则全文。核对插件的 skills/*/SKILL.md、rules/*.md 与 manifest，确保每个范围内文件均有链接，并检查链接和统计。新增根级 skill 或调整 vendor 边界时重新说明统计范围。纯文档更新随既有 docs 分发，无须修改插件启用状态或迁移配置。
