- 2026-06-24：已完成 `iris-interface-dev-plugin` v2.0 Task 0 字段匹配闭环：新增 `iris-interface-field-match.py`，从 `parsed.json` 生成 `field-match.json` 和 `field-match.md`；匹配来源区分 `builtin-rule`、`local-feedback`、`low-confidence-candidate` 和 `unmatched`，并限制控制台只输出路径与数量。`--feedback` 只读取目标项目本地 JSON，不写回插件仓库；插件专项测试已新增 synthetic fixture 覆盖四类匹配结果和控制台不泄漏字段明细。
# imedical.agents 维护日志

本文件记录近期维护流水摘要和验证结论。长期决策见 `agent-kit-maintenance-decisions.md`，后续治理队列见 `agent-kit-maintenance-backlog.md`，入口摘要见 `agent-kit-maintenance-memory.md`。

- 2026-06-24：已完成 `iris-interface-dev-plugin` v2.0 Task 0 接口文档解析经验回归提升：`feedback/experience/iris-interface-dev-com-exp.md` 新增 XLS/XLSX 多 sheet、DOCX 入参/出参、PDF 混合表、PDF 跨页续表、错误码/修订记录/JSON 示例过滤和 DOC 转 DOCX 优先级经验条目，并标记已提升到 `scripts/tests/iris-interface-plugin.tests.ps1`；解析器补强 JSON 示例行过滤 synthetic 回归。已通过插件专项测试、仓库更新回归和插件敏感词扫描；真实工程默认输出路径仍为 `docs/output/iris-interface/<doc-name>/`，本地 `tmp/iris-interface-file/` 仅作维护回归证据且不入库。

- 2026-06-24：已完成 `iris-interface-dev-plugin` v2.0 Task 0 字段契约追溯模型：`parsed.json` 升级为 `iris-interface-doc-ingest/v2`，字段新增 `rawColumns`、`sourceLocation`、`classification`、`confidence`、`warnings`、`requiredReason` 和 `jsonPathReason`；`fields.md`/`diagnostics.md` 增加追溯摘要与统计。已通过插件专项测试、仓库更新回归和真实接口文档本地回归；真实摘要保留在 `tmp/iris-interface-file/test-results/iris-interface-v2-task0-real-doc-test-summary.md`，真实文档与解析产物不入库。

## 近期已完成

- 2026-07-01：已修正 AI 落地项目安装入口闭环：README 不再要求首次安装前读取尚不存在的 `.agents/docs/update-agents.md`，而是先按 `.agents/` 状态分流并给出明确网络安装命令；`install-agents.ps1` 在业务项目缺少 `AGENTS.md` 时改为提示而非阻塞，`update-agents.ps1` 将 `agents-entry-missing` 降为后续项目上下文维护提示；`docs/update-agents.md` 和 `scripts/tests/update-agents.tests.ps1` 已同步。

- 2026-07-01：已补齐近期医生站能力插件维护记录和仓库 README 总览：新增 `imedicalxc-doctor-perf-analysis-engineer`、`imedicalxc-doctor-data-extraction`、`imedicalxc-doctor-print-template-design` 三个插件的能力摘要、入口和部署边界说明；同步记录 install/update Git 版本前置校验。上述插件仍遵循 `.agents/plugins/**` 全量拉取但以 `plugin_profile.md` 控制启用的边界。

- 2026-07-01：已新增维护者专用 `skills/agent-kit-maintenance/SKILL.md`，用于本仓库维护、插件提交同步、维护记忆更新和部署边界检查；该 skill 位于根 `skills/` 下，但安装/更新 sparse checkout 已排除 `skills/agent-kit-maintenance/`，不部署到业务项目 `.agents/`，不参与 thin-index。根 `AGENTS.md`、README、维护入口摘要和长期决策已同步说明。

- 2026-06-30：已完成近期提交文档同步：维护记忆、长期决策、backlog、仓库 README、`imedicalxc-doctor-extend-engineer` README/AGENTS 和主编排器 superpowers 缺失指引已同步到当前实际内容；补齐 `scripts/tests/update-agents.tests.ps1` 对 `sync-vendor-skills.ps1` 的测试夹具复制，避免 vendor skill 同步脚本缺失误触发 Action required。

- 2026-06-29：已完成 `imedicalxc-doctor-dbdata` 精简治理：`SKILL.md` 从大体量数据库查询规范收敛为核心领域知识入口，删除通用编码规范、输出模板和反模式长文，保留并强化医保对照、基础数据统一对照和合并查询（Merge Query）；医生站扩展主编排器补充合并查询快速参考，架构 skill 同步配置数据和合并查询引用。
- 2026-06-26：已完成 vendor skill 运行时同步链路与医生站扩展插件标准化：新增 `scripts/sync-vendor-skills.ps1`，`install-agents.ps1` / `update-agents.ps1` 可把 `vendor/superpowers/`、`vendor/word-reader/` 等 vendor skill 同步到运行时 skill 目录；`imedicalxc-doctor-extend-engineer` 迁入标准插件结构并补充 `AGENTS.md`、README、manifest 和 thin-index wrapper。
- 2026-06-26：已收敛 `imedicalxc-doctor-extend-engineer` thin-index 策略：wrapper 默认排除 8 个子 skill，只暴露 `imedicalxc-doctor-extend-engineer` 主编排器入口；子 skill 由主编排器通过插件内相对路径按需读取，避免浅层 skill 路由噪声。
- 2026-06-25：已新增信创版本医生站第三方接口开发智能体资料，后续重构为 `imedicalxc-doctor-extend-engineer` 插件标准目录。
- 2026-06-24：已更新内置 Windows x64 `iris-agentic-dev.exe` 到 v0.6.17，业务项目仍通过 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe` 获取可执行文件，连接事实仍只允许留在目标工程本地配置。
- 2026-06-24：已完成 `iris-interface-dev-plugin` v1.2 格式接入稳定化回归：XLS/XLSX 多 sheet、DOC 转 DOCX 降级路径、DOCX 入参/出参分段与字段契约、PDF 轻量抽查均已验证；新增长期路线图 `memory/plan/iris-interface-dev-plugin-roadmap.md`，替代旧 `iris-interface-v1-summary-v2-plan.md` 作为后续会话入口。真实样本和解析产物仍只保留在 `tmp/iris-interface-file/`，不入库。
- 2026-06-23：根据三份样本文档验证结果，补强 `iris-interface-dev-plugin` 解析前环境引导：新增 `iris-interface-env-check.py`，把缺依赖/缺转换器从“失败告知”改为可执行安装建议；`requirements-optional.txt` 新增 `xlrd`，`.xls` 安装 `xlrd` 后可直接解析，XLSX/XLS 多 sheet 按 sheet 拆成独立字段视图。
- 2026-06-22：已完成 `iris-interface-dev-plugin` v1.1 PDF 解析质量补丁：收紧表头匹配，过滤修订记录和错误码表，支持 PDF 跨页续表继承上一字段表表头。真实样本 `综合药房 HIS 处方推送接口使用说明_5000.pdf` 重新解析后为 9 个视图、79 个字段，Page 17/18/19 续表缺失字段已补回。
- 2026-06-22：已完成 `iris-interface-dev-plugin` v1 基线并入，来源工程审计基线为 `https://gitee.com/soneakeko/agent-architecture.git` commit `43e12b345c58ba11a48980828503daf29ae309ec`。插件采用解析审计优先边界，提供接口文档落盘解析、字段结构化、字段诊断、开发计划和离线审查入口；IRIS/ObjectScript 编码、上传、编译、部署和远端验证继续复用 `coding-iris-plugin`。
- 2026-06-22：`iris-interface-dev-plugin` v1 明确不迁移来源大生成器和大体量规则库；`rules/` 仅放路由、流程、审查门禁和轻量规则，来源规则/wiki 资产先进入审计清单或 `references/` 候选。新增 `requirements-optional.txt` 只声明 `python-docx`、`pdfplumber`、`openpyxl`、`markitdown` 可选依赖，不 vendor、不自动安装。
- 2026-06-17：已将 Windows x64 `iris-agentic-dev.exe` 内置到仓库根 `vendor/iris-agentic-dev/windows-x64/`，业务项目通过既有 `/vendor/**` sparse checkout 自动获得 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe`。coding-iris 插件 README、AGENTS、初始化模板、`project-env.template.json`、MCP 规则和脚本说明已同步默认路径；连接事实仍只允许留在目标工程 `.mcp.json`、`.iris-agentic-dev.toml` 或环境变量。
- 已新增 IRIS 远端部署编排入口 `plugins/coding-iris-plugin/skills/iris-deploy/SKILL.md`，将部署、上传、编译、SFTP 同步、CSP 编译和部署验证统一路由到部署 skill，并继续以 `rules/iris_deploy_checklist.md` 作为逐项执行清单。
- 已新增薄通用脚本 `plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js`，用于根据文件列表或 git diff 生成 IRIS 部署 JSON 清单；脚本只做本地分析，不执行上传、编译或远端写入。coding 插件 README、AGENTS、目标工程 snippet、manifest prompt 和 `iris_coding_workflow.md` 已同步更新。
- 已继续回归 `feedback/experience/demand-com-exp.md` 中建议提升的需求经验：`iris_coding_backend.md` 新增 `%Persistent` 字段追加、Storage 不手改和 Insert/Update/Import SQL 同步规则；`iris_coding_frontend.md` 新增 HisUI DataGrid 插列后 editor/列下标检查规则；`i18n_verify.md` 新增字典展示值验证必须覆盖主方法调用子方法的检查项。对应经验条目已追加“已回归/已提升”标记。
- 已增强 IRIS/HIS 前端编码保护：coding-iris 前端规则不再默认 UTF-8，改为按实际检测和 `iris_project_profile.md` 保持源文件编码；新增 `check-frontend-encoding.ps1` 护栏脚本并接入初始化说明、README、profile 模板和 doctor-dev 默认值；i18n 前端编码规则、`i18n-coding` 和 `i18n_verify` 明确指向 coding-iris 的编码规则和检查脚本，防止 i18n 改造把 GB2312 前端文件永久改成 UTF-8。
- 已将 HISUI 源码内置到仓库根 `vendor/hisui/dist/`，消除 `${HISUI_SRC}` 变量间接层；所有插件规则、skill 和模板统一指向 `.agents/vendor/hisui/`，删除两套 profile 模板中的 `HISUI_SRC` 字段。`install-agents.ps1` 和 `update-agents.ps1` 的 sparse checkout 新增 `/vendor/**`。coding-iris-plugin 和 i18n-iris-plugin 共约 12 个文件已同步更新。
- 已增强 plugin skill thin-index：`scripts/generate-plugin-thin-index.ps1` 生成 `.agents/skills/<skill>/SKILL.md` 时会传播真实 `SKILL.md` 的 `name` 和 `description`，并写入 `thin-index: true` 与 `source`。浅层 skill description 用于能力发现，匹配后仍必须继续读取插件真实 `SKILL.md`。
- 已完成 `SKILL.md` 渐进式披露轻量约束治理：真实 `SKILL.md` 的 frontmatter `description` 已收敛为 `Use when...` 触发条件句；正文补充基础入口优先、按条件继续读取 rules/references/config/MCP 的路由说明。本轮未给 skill 引入 `task-affinity`，仍保持 skill 发现依赖 `description` 与正文路由。
- 已完成 frontmatter/task-affinity 最小治理：为插件 `rules/` 和 `references/` Markdown 补充最小 frontmatter 与 `task-affinity`；`scripts/generate-plugin-thin-index.ps1` 可从源 rule 传播 `name`、`description`、`task-affinity`、`related`，并在 rule thin-index 中写入 `thin-index: true` 和 `source`。本轮不把 `skills` 纳入 `task-affinity` 元数据体系。
- 已新增框架验证反馈机制：`feedback/framework/` 反馈目录、反馈模板、`agents/_shared/feedback-protocol.md` Agent 反馈行为指引；`i18n-agent` 和 `i18n-change.workflow.md` 在完成条件中引用反馈协议；新增 `skills/agent-framework-feedback/SKILL.md` 通用反馈 skill，支持 plugin 直接使用场景。Agent 处理 HIS 需求时如对框架文件做了修正，自动生成反馈条目；维护者定期读取反馈、diff 后应用到 master。
- 已新增 `feedback/experience/deploy-com-exp.md` 和 `docs/deploy/dental-ta-159/` 首个部署经验/工具样例，用于沉淀全量部署流程、前后端部署脚本和专项计划；维护记忆只记录边界，不复制业务细节或连接信息。
- 已新增 `demo/presentation/` 演示页，包括 i18n 能力摘要、多智能体架构预览和演示首页，用于展示能力包思路；该目录当前不在安装/更新 sparse checkout 运行边界说明内。
- 已修复 `sync-xml-print-template.ps1` JsonLine framing 中文编码问题，并新增/保留相关语言测试，避免中文输出在跨进程传递时损坏。
- 已新增多智能体架构设计 `memory/plan/multi-agent-architecture.md`，明确厂商无关 canonical `agents/` / `workflows/`、工具 adapter 边界、模型档位、生成层、本地定制、版本演进和新增智能体 checklist。
- 已新增顶层 `agents/` 与 `workflows/` 首批 canonical 样板：`agents/agent-registry.md`、`agents/_shared/handoff-protocol.md`、`agents/i18n-agent/AGENT.md`、`agents/i18n-agent/bindings.yaml`、`workflows/workflow-registry.md`、`workflows/i18n-change.workflow.md`。
- 已新增交接报告模板：事实报告、分类清单、变更摘要、验证报告，用于阶段化或多智能体交接。
- 已将 `i18n-workflow-decompose.md` 的五阶段愿景落地为 `i18n-agent` 和 `i18n-change.workflow.md` 样板，阶段为 Explorer、Classifier、Coder、Template/Seed、Verifier。
- 已明确 `agents/` 和 `workflows/` 是能力包正式内容，不属于 `.agents/.git/info/exclude` 生成层；后续需要纳入安装/更新脚本 sparse checkout。
- 已新增 coding 插件统一编码入口 `iris-coding`，并同步更新插件入口、README、目标工程 snippet 和 manifest prompt；后端、前端和 GB2312 promote 专项 skill 保持兼容。
- 已新建 i18n 链路定位规则 `rules/i18n_link_tracing.md`、数据分类规则 `rules/i18n_field_classification.md`、验证规则 `rules/i18n_verify.md`，补全五阶段工作流的规则缺口。
- 已更新 `i18n-coding` skill 为阶段化入口，新增阶段化执行引导和必读规则引用，并在产出段落增加需求完成后的经验沉淀引导。
- 已优化 `feedback/experience/demand-com-exp.md`：新增领域标签和需求索引维护规则，在文档末尾追加需求索引章节，支持锚点跳转。
- 已修正 `i18n_coding_print_backend.md` 入口措辞，从"打印 JSON"收敛为"实际打印返回数据"，并引用链路定位规则。
- 已补充 `i18n-xml-print-template-sync` 的触发前置约束：必须先通过链路定位确认存在 XML 模板记录。
- 已补齐 `i18n-iris-plugin/AGENTS.md` 的 Skill 路由和规则入口。
- 已在 `feedback/experience/demand-com-exp.md` 中标记被提升的经验条目和反哺规则。
- 已将 coding 插件的 HISUI 控件索引从 rule 层迁移为 `references/hisui-widget-index.md`。
- 已更新 coding 插件入口、README、前端 coding skill 和规则索引，使 HISUI 控件参考只在控件选型或 API 不确定时按需读取。
- 已在 coding 插件 manifest 中声明 `references: references/`。
- 已增强 coding 和 i18n 插件 thin-index 脚本：重建时可识别并清理由本插件旧版本生成、但源文件已从 `rules/` 移走或被重命名的 stale rule thin-index。
- 已在仓库 README 和 coding 插件 README 中补充已部署 `.agents` 的同步说明。
- 已拆分 `iris_coding_workflow.md`，新增 `iris_deploy_checklist.md` 和 `iris_gb2312_workflow.md`，降低非部署任务加载成本。
- 已精简 `sftp_server.md` 的通用部署重复内容，并精简 `i18n_index.md` 的总原则。
- 已在 workspace kit 文档和 reusable packaging skill 中补充插件内 `references/` 约定。
- 已在 workspace kit 文档、reusable packaging skill、仓库 README 和维护记忆中明确 rules/skills/references/scripts 命名约定。
- 已将历史异常 rule 文件名统一为 snake_case：`iris_agentic_dev.md`、`sftp_server.md`、`i18n_hisui_widget_index.md`，并更新相关 AGENTS、README、rules、templates 引用。
- 已将 thin-index 生成逻辑收敛到根 `scripts/generate-plugin-thin-index.ps1`；各插件同名脚本只作为 wrapper 转发参数，避免插件之间运行时绑定。
- 已确认边界：插件之间不应互相依赖；独立分发单个插件时，若使用 `plugin-reference-thin-index`，必须同时携带根 canonical 脚本，否则选择 `copy` 或手工 thin-index。
- 已新增根目录 `index.html` 作为 AI Coding 外骨骼架构可视化展示页，并通过 `.github/workflows/pages.yml` 和 `.nojekyll` 发布到 GitHub Pages。
- 已明确双远端维护约定：`origin` 为 Gitee 主仓库，日常维护、业务项目 `.agents` 部署和安装脚本以此为准；`github` 为 GitHub 镜像仓库，主要用于 GitHub Pages 展示页发布。
- 根目录 `index.html`、`.github/` 和 `.nojekyll` 只服务展示页和 GitHub Pages；当前安装脚本 sparse checkout 只检出 `docs/`、`rules/`、`skills/`、`plugins/`、`scripts/`，不会把展示页文件部署到业务项目 `.agents/`。
- 已新增统一更新脚本 `scripts/update-agents.ps1` 和托管更新 runbook `docs/update-agents.md`，用于已部署业务工程更新 `.agents` 能力包、维护生成层 ignore、重建 plugin thin-index 和合并明确缺失的 config 项。
- 已更新 `project-context-maintenance`：安装或更新 `.agents` 时优先读取 `docs/update-agents.md`；更新脚本不得自动重写 `AGENTS.md`、项目 memory、项目 rules 或已有 config 值。
- 已将 `AGENTS.md` 规范调整为必须唯一主入口；`CLAUDE.md`、`CODEBUDDY.md` 只作为可选兼容入口，缺失或异常只报告，不自动修复或复制第二份规则。
- 已增强 canonical thin-index stale 清理：支持识别插件源规则重命名、移走或删除后遗留的浅层入口，避免目标工程 `.agents/rules/` 长期残留过期索引。
- 已完成多 Agent v0.2.0 最小部署闭环：安装/更新 sparse checkout 包含 `agents/` 和 `workflows/`，`i18n-agent` 明确插件初始化前置，通用 Agent 和 adapter 生成器顺延为后续阶段。
- 已实施插件状态分流：`.agents/plugins/**` 全量拉取用于能力发现，`update-agents.ps1` 按 `plugin_profile.md` 将 `available`、`enabled`、`disabled` 分流处理，默认只处理 `agent-context-kit`；旧 `initialized` 兼容读取为 `enabled`，旧 `indexed` 兼容读取为 `available`。
- 已新增 `scripts/update-plugin-profile.ps1`，供插件 init skill 在验收通过后机械反写 `plugin_profile.md`，避免不同模型手工编辑表格。
- 已在插件 manifest 中补充 `initSkill`，并为 `i18n-iris-plugin` 声明对 `coding-iris-plugin` 的依赖；`update-agents.ps1` 对未初始化依赖输出 `plugin-dependency-missing`。
- 已新增独立 `scripts/generate-agent-thin-index.ps1`，并接入 `scripts/update-agents.ps1` 的 `agent-thin-index` 阶段；已部署业务项目常规 DryRun/Write 可生成 `.agents/skills/<agent-name>/SKILL.md`，当前用于把 `i18n-agent` 暴露给只发现浅层 skill 的 Agent。
- 已明确本轮不做工具专属 adapter；Codex、Claude Code、OpenCode、CodeBuddy 原生入口仍暂缓，agent thin-index 只做 canonical 路由，不复制插件规则全文。

## 近期提交索引

- `58339ee`：新增维护者专用 `agent-kit-maintenance` skill，并排除业务项目部署。
- `364f594`：`install-agents.ps1` / `update-agents.ps1` 新增 Git 版本前置校验，并同步 runbook 与测试。
- `3e0f580`：新增 `imedicalxc-doctor-print-template-design` 插件，提供打印模板设计与 `.xlsx` 模板生成工作流。
- `b655c1a`：新增 `imedicalxc-doctor-data-extraction` 插件，提供数据抽取与第三方接口对照文档生成工作流。
- `05bfa75`：新增 `imedicalxc-doctor-perf-analysis-engineer` 插件，提供接口性能分析、Graylog 诊断、前后端优化和报告输出能力。
- `b802ac9`：同步 vendor skill 运行时链路与医生站扩展插件文档到当前状态。
- `5ea2910`：精简 `imedicalxc-doctor-dbdata` skill，并同步医生站扩展主编排器和架构引用。
- `3512d7c`：迁移 superpowers skills v6.0.3 到 `vendor/superpowers/`。
- `920e75b`：`imedicalxc-doctor-extend-engineer` thin-index 只暴露主编排器入口。
- `9647f86`：补充 `imedicalxc-doctor-extend-engineer` 插件 thin-index wrapper。
- `6bbb95e`：清理医生站扩展插件旧版目录文件。
- `cd57f56`：新增 vendor skill 运行时同步脚本，并重构医生站扩展插件标准结构。
- `045eecf`：新增信创版本医生站第三方接口开发智能体资料。
- `16bc2d6`：更新内置 `iris-agentic-dev.exe` 到 v0.6.17。
- `6dcccca`：完成 `iris-interface-dev-plugin` 字段匹配闭环文档归档与测试补强。
- `4731854`：新增 agent skill thin-index 生成脚本，并集成到 `update-agents.ps1` 流水线。
- `3cc5616`：新增首个部署经验文档和专项部署工具目录。
- `8e4cfca`：新增 `demo/presentation/` 演示展示页面。
- `ccc96bf`：新增 `agent-framework-feedback` 通用反馈 skill。
- `b796f13`：补充字典翻译检查需覆盖被调用子方法经验。
- `e1876cd`：新增 i18n 前端编码与字典翻译经验条目。
- `ee4d08f`：为 GitHub Pages 展示页添加 inline SVG favicon。
- `c6f2508`：升级展示页视觉体验与内容结构。
- `9694509`：新增框架验证反馈机制。
- `f7e14c7`：修复 XML 打印模板同步脚本 JsonLine 中文编码问题。
- `38f0aed`：实施插件状态分流与 `plugin_profile` 机制。
- `02d7e84`：新增 AI Coding 外骨骼架构可视化页面。
- `d61ea96`：将架构可视化页面重命名为根目录 `index.html`。
- `c2281ef`：新增 GitHub Pages workflow 和 `.nojekyll`。
- `4956e7b`：启用 GitHub Pages 权限。
- `95e596b`：README 补充双远端同步说明。
- `1cc1ac7`：新增统一更新脚本 `scripts/update-agents.ps1`。
- `6ae4277`：新增托管更新 runbook 和 `update-agents` 摘要视图。
- `0a932d7`：收敛唯一主入口、可选兼容入口和 stale thin-index 清理。

## 最近验证

- 2026-07-01：已检查近期提交 `05bfa75`、`b655c1a`、`3e0f580`、`364f594`、`58339ee` 的变更范围；确认三个新增医生站插件均包含 `.agents-plugin/plugin.json`、`AGENTS.md`、主 `SKILL.md` 和 thin-index wrapper，其中性能分析插件额外包含 README、init skill、脚本和 references。已通过 `rg` 检查 README 与维护记忆中的旧插件总览缺口，并完成摘要同步；本轮不复制大段插件正文或业务私有事实。

- 2026-06-30：本轮文档同步已执行一致性搜索，确认 `README.md`、`plugins/imedicalxc-doctor-extend-engineer`、`memory` 和 `docs` 下不再残留旧版 superpowers 安装方式和旧子 skill 暴露数量等过期表述；路径检查确认 `vendor/superpowers/skills/brainstorming/SKILL.md`、`vendor/word-reader/SKILL.md` 和医生站扩展插件 thin-index wrapper 均存在；`scripts/sync-vendor-skills.ps1 -AgentsRoot . -Mode DryRun` 可枚举 superpowers 与 word-reader vendor skill；`scripts/tests/update-agents.tests.ps1` 已通过。仓库根误产物 `%SystemDrive%/` 已确认位于 workspace 内并清理。

- `scripts/tests/iris-interface-plugin.tests.ps1` 与 `scripts/tests/update-agents.tests.ps1` 已验证：`iris-interface-doc-ingest.py` 支持 PDF 表内请求/响应分段、嵌入表头、空首列参数名识别、签名字段 `signature.*` 归属和 JSON 示例行过滤；真实 `移动APP接口对接文档（光华口腔）v1.1.3.pdf` 回归为 `ViewCount=16`、`TotalFields=81`、`JsonPathCount=80`、`request=18`、`response=55`、`signature=4`，Page 7-14 可按 `n_type` 标识区分请求/返回视图。
- `scripts/tests/iris-interface-plugin.tests.ps1` 已验证：环境自检脚本、可选依赖清单 `xlrd`、XLSX 多 sheet 解析、字段续表/JSON 路径回归和点号循环审查门禁正常。
- `scripts/tests/iris-interface-plugin.tests.ps1` 已验证：v1.1 解析器回归覆盖修订记录过滤、错误码表过滤和续表继承字段表头；真实 PDF 样本手动验证 Page 17/18/19 缺失字段已补回。
- `scripts/tests/iris-interface-plugin.tests.ps1` 已验证：`iris-interface-dev-plugin` manifest、skill/rule 入口、可选依赖清单、thin-index dry-run、XLSX 标准库解析落盘、`references/` 排除和点号循环审查门禁正常。
- `scripts/tests/update-agents.tests.ps1` 已验证：新增 `iris-interface-dev-plugin` 未破坏现有安装/更新、thin-index、插件状态和 agent thin-index 流程。
- `scripts/tests/iris-deploy-manifest.tests.ps1` 已验证：`prepare-deploy-manifest.js` 可从目标项目 `project-env.json` 读取 namespace/web 路径，按 `.cls`、`.csp`、`.js` 生成稳定 JSON 清单，并兼容 PowerShell UTF-8 BOM 配置文件。
- `scripts/generate-plugin-thin-index.ps1 -PluginPath plugins/coding-iris-plugin -ProjectRoot . -Mode DryRun` 已验证：新增 `iris-deploy` skill 可生成 `.agents/skills/iris-deploy/SKILL.md` thin-index 计划。
- `scripts/tests/update-agents.tests.ps1` 已验证：新增部署 skill 和脚本说明未破坏现有更新、thin-index、插件状态和 agent thin-index 流程。
- `scripts/tests/frontend-encoding.tests.ps1` 已验证：GB2312 中文前端文件在 `-ExpectedEncoding gb2312` 下通过；UTF-8 中文文件在同一策略下返回错误退出码，用于拦截编码漂移。
- `scripts/tests/update-agents.tests.ps1` 已验证：现有更新、thin-index、插件状态和 agent thin-index 流程未受前端编码护栏变更影响。
- `scripts/tests/update-agents.tests.ps1` 已验证：skill thin-index 会传播真实 skill `description`，写入 `thin-index: true` 和 `source`，且仍不传播 rule `task-affinity`。
- 已检查 16 个真实 `SKILL.md`：frontmatter `description` 均以 `Use when` 开头，正文均包含按条件读取或渐进式读取提示。
- 已搜索确认 `plugins/` 和 `skills/` 下的 `SKILL.md` 未新增 `task-affinity`。
- `scripts/tests/update-agents.tests.ps1` 已验证：rule thin-index 可传播源 frontmatter 中的 `task-affinity`、`description` 和 `source`，无 frontmatter 的 legacy rule 仍兼容生成，skill thin-index 不传播 rule 任务亲和元数据。
- `scripts/generate-plugin-thin-index.ps1 -PluginPath plugins/coding-iris-plugin -ProjectRoot . -Mode DryRun` 已验证 coding 插件 rule/skill thin-index 生成计划正常。
- `scripts/generate-plugin-thin-index.ps1 -PluginPath plugins/i18n-iris-plugin -ProjectRoot . -Mode DryRun` 已验证 i18n 插件 rule/skill thin-index 生成计划正常。
- 已检查 `i18n-agent` / `i18n-change.workflow.md` 引用的 i18n 插件 rules 和 skills 均存在。
- 已检查新增 `agents/`、`workflows/` 文件无 `TODO` / `TBD` 占位；`待确认` 仅作为交接协议和 config 合并策略术语出现。
- 已确认 `memory/plan/multi-agent-architecture.md` 与实际新增报告模板命名一致。
- coding 插件 thin-index dry-run 已确认不再生成 HISUI 控件索引的 rule 入口。
- 构造旧版 HISUI rule thin-index 后，coding 插件脚本 dry-run 可标记 `stale`，Write 模式可移除旧入口。
- 搜索旧 HISUI rule 路径已无残留引用。
- coding 插件 thin-index dry-run 已确认新增 `iris_deploy_checklist.md` 和 `iris_gb2312_workflow.md` 规则入口。
- 搜索确认 `references/` 规范已写入 workspace kit 文档和 reusable packaging skill。
- 搜索确认 rules/skills/references/scripts 命名约定已写入 workspace kit 文档、reusable packaging skill、仓库 README 和维护记忆。
- 搜索确认 thin-index canonical/wrapper 约定已写入 workspace kit 文档、reusable packaging skill、插件 README 和维护记忆。
- `scripts/tests/update-agents.tests.ps1` 已验证：默认只处理 `agent-context-kit`，未启用插件只列为 available，显式插件可处理，i18n 在 coding 未初始化时阻塞，安装/更新 sparse checkout 包含 `agents/` 和 `workflows/`。
- 已验证三个插件 manifest 均可被 PowerShell `ConvertFrom-Json` 正常解析。
- `scripts/tests/update-agents.tests.ps1` 已验证：`update-agents.ps1` 可调用 agent thin-index 阶段，Write 模式生成 `.agents/skills/i18n-agent/SKILL.md`，入口指向 canonical `AGENT.md`、`bindings.yaml` 和 `i18n-change.workflow.md`，且不生成工具 adapter 内容。
- 当前 `master` 本地 `HEAD` 为 `5ea2910`，已与 `origin/master` / `github/master` 对齐；后续提交后仍按双远端约定分别同步。

## 维护要求

- 后续完成每轮维护后，更新本文件的近期已完成、提交索引和最近验证摘要。
- 不记录一次性命令输出、短期失败日志或可从 Git 历史直接恢复的完整流水。
