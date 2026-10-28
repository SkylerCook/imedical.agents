# AGENTS.md

本插件所有自有 skill 的帮助请求（`--help`、查看用法）先按[统一帮助协议](../../docs/guides/capability-help.md)展示帮助并结束，优先于插件启用、连接检查和业务前置。源定义随正常能力包更新分发，已有 thin-index 继续读取 source；帮助不自动启用插件。

启用 `night-convergence/v1` 时受管部署调用受剩余预算限制；超时结果未知，保留回读/退出断点，不自动重放。项目验收涉及环境依赖时提供实际 `verifyDependencies`，详见[夜跑接口](../../docs/night-policy.md#返修收敛与按需依赖)。

后端验收按内部方法、实际 Broker/REST/SOAP 入口及副作用分层；纯后端不强制浏览器，影响前端行为时补 UI。夜跑使用 debugger 的非交互机器入口，见 [分层接入](../../docs/night-acceptance.md)。

2.1 夜跑 Overlay 的 compile/deploy-frontend/run-acceptance 入口必须携带 work item 和环境别名，通过同一 run 门禁并自动归档回执。预检覆盖实际认证、角色、正常入口和退出；数据保留/重置/删除与资源退出分别验证，见[夜跑契约](../../docs/night-policy.md#schema-21-启动契约)。CLS 清单和部署统一从 Class 声明解析文档名，目录只用于定位本地文件。

需求提交使用 demand-delivery-plugin 的 demand-commit，标版补录使用 bos-plugin 的 bos-demand-entry；本插件不再提供兼容技能或 CLI。已部署项目由更新器迁移引用与启用状态，见 [迁移说明](../../docs/demand-delivery-migration.md)。

Agent 编写或 Review `.cls` 时遵循 [CLS 命名与格式规范](references/cls-coding-format.md)：修改前加载、最终 diff 后复核。独立 Review 接收该规范路径与项目显式覆盖，格式规范只用于本次新增代码，已有代码的功能修改不附带格式化；共用清单包含提取后的业务规则复用、稳定标识归属及 Parameter 声明/引用核对；可选自检仅提示，不替代 IRIS 编译或作为提交门禁。

新增注册类/非表模型、表类、成员或变量时，加载同一规范的 [ObjectScript 注释约定](references/cls-coding-format.md#注释与空行)，由 Agent 核对职责、业务标签、参数/返回契约及结构引用；现有格式脚本不承担注释语义校验或表/接口文档生成。

## 插件定位

修改或 Review CSP、HTML、JavaScript、CSS 前读取[前端命名与格式规范](references/frontend-coding-format.md)，最终 diff 后复核；传递项目覆盖和兼容基线，CSP 内服务端代码按 CLS 规范处理。

`coding-iris-plugin` 提供 IRIS/ObjectScript/CSP/JavaScript/HISUI 工程的通用编码规则、初始化流程和 IRIS 开发主力脚本。

插件只承载可复用能力；目标工程差异必须写入目标工程 `.agents/config/iris_project_profile.md`，MCP 连接事实必须以目标工程 `.mcp.json` 为准。

## 使用约束

- 当前需求已明确为 `project` 且 `contextMode: intent-first-on-demand-export` 时，编码、需求上下文获取及发布先读取[项目按需导出开发协议](references/project-demand-development.md)；该分支的同步与冻结发布门禁优先于下文默认 direct。`standard` 沿既有标版分支；类型缺失先查合法默认值，不能从 contextMode 推导。公共远端准入仍按通道约束执行。
- 不在插件 rules/skills 中硬编码服务器、namespace、账号、密码、token、远程路径、业务页面清单、业务类名前缀或项目专属基类。
- `templates/profile-defaults/<type>.md` 只作为用户显式选择项目类型后的领域默认值来源；它不是通用规则，加载后仍需代码探索或用户确认校验。
- 涉及工程差异时读取目标工程 `.agents/config/iris_project_profile.md`。
- 导出、编译、Broker 调试和环境配置同步优先使用插件内 IRIS 开发主力脚本。
- MCP 作为辅助能力，用于补上下文、只读 SQL/远程读取、脚本未覆盖的能力，或用户明确要求用 MCP 的场景。
- 涉及 MCP、上传、编译、远程读取或只读 SQL 验证时读取目标工程 `.mcp.json`。
- 默认只做本地修改、只读验证和报告；上传、编译、远程写入、数据库变更必须由用户明确要求。
- 部署失败先读[失败恢复与授权](references/deployment-protection.md#失败恢复与授权)：已授权范围内先诊断和有限恢复，明确编译错误与未知结果分开；仅实际人工决策才提问，冻结发布与公共熔断门禁继续适用。
- `iris_test`、`iris_coverage`、`iris_execute_method`、容器切换和其它远端执行即使不直接改业务源码，也必须按远端状态变更取得任务级授权；上游 MCP 自带门禁不能代替本仓库授权边界。
- 历史 CSP/JS/CSS 文件可能存在编码和特殊 EOF，修改前先确认实际编码和尾部格式，避免整文件重写。
- 当前前端源码、上传内容和服务器运行编码统一使用 canonical `utf8`；`project-utf8` 仅作为兼容读取别名，`standard-gb2312` 仅服务用户明确指定的历史工程，实际文件字节检测始终是最终门禁。Overlay manifest 明确只声明 `backend` 时，profile 使用 `N/A (backend-only)`，不得伪造前端编码结论。
- 在 workspace-overlay 中统一通过 capability 包的 workspace context resolver 获取 `WorkspaceRoot`、`ContextRoot`、`CapabilityRoot`、`SourceRoot` 和 `GitRoot`；profile 只从 ContextRoot 读取，部署配置按下述显式继承契约选择，插件/模板/vendor 从 CapabilityRoot 读取。允许按当前需求只读调查已声明 GitRoot 或项目注册表明确映射的相关仓库；默认源码修改、Git 暂存/提交和部署仍限定在 SourceRoot 与任务授权内。具体边界遵循能力包根 `docs/workspace-overlay.md`，不得扫描父目录或 sibling 猜测根路径。
- `compile.js` 接受 workspace-overlay 的 `backend/src/...` WorkspaceRoot 逻辑路径时，必须在声明的 backend SourceRoot target 下解析本地文件；CLS 远端文档名从实际 Class 声明解析，不得把逻辑目录误作为类包名。

## Skill 路由

- iMedical wiki、菜单及业务实现线索：`skills/iris-imedical-knowledge/SKILL.md`。Agent 按通用规则自主判断查询收益，无需用户点名或为本地检索确认；当前项目源码优先。
- 菜单资料刷新：`skills/iris-menu-sync/SKILL.md`；已登记来源复用 refresh-menu 的固定采集入口与本地断点，沿用离线发布器，定时任务不自动部署或重新登记。指定组沿原离线协议。

- 首次初始化：`skills/coding-iris-init/SKILL.md`
- 统一编码入口：`skills/iris-coding/SKILL.md`
- 后端 ObjectScript 编码：`skills/iris-backend-coding/SKILL.md`
- 前端 CSP/JS/HISUI 编码：`skills/iris-frontend-coding/SKILL.md`；编码与 Review 的 UI 条件读取统一按[前端规则门禁](rules/iris_coding_frontend.md#ui-条件门禁)，包括只从 rule 进入的审查。
- 历史前端 GB2312 转换后替换源文件：`skills/iris-frontend-gb2312-promote/SKILL.md`
- IRIS 远端部署编排：`skills/iris-deploy/SKILL.md`
- 已确认范围的 XML 部署包导出：`skills/iris-xml-export/SKILL.md`；两条自有通道、任务文件与完整性契约归 `references/iris-xml-export.md`。
- 版本清单维护、初始当前源码采集及基线恢复：`skills/iris-code-baseline/SKILL.md`；代码与图片筛选、partial 和目标多会话资格归 `references/iris-code-baseline.md`，项目开发同步继续沿原协议。
- DEV→PRD 需求移植：`skills/iris-demand-promote/SKILL.md`
- 标版/项目需求提交：`../demand-delivery-plugin/skills/demand-commit/SKILL.md`
- 标版需求闭环：`../bos-plugin/skills/bos-demand-entry/SKILL.md`，用户模式 `--text / --bind / --plan / --commit / --help`，可选 `--excel` / `--Excel`；产品标识取项目配置，描述按缺陷或功能/改进使用简洁三段式，草稿仅支持 v2。历史来源用 `--rev`，不与提交授权混用。
- IRIS 类、方法签名与官方文档查询：`skills/iris-mcp-lookup/SKILL.md`

前后端边界不明或混合编码需求使用 `iris-coding`；明确的纯后端、纯前端任务直接使用对应专项 skill。非按需导出工程各编码入口默认 direct；仅要求 guarded 时建立基线会话，完整规则由 `references/deployment-protection.md` 维护。
当用户明确要求部署、上传、编译、SFTP 同步、CSP 编译或远端部署验证时，使用 `iris-deploy`。
当用户要求把已提交的 DEV 需求更新到独立 PRD 按需导出仓库时，使用 `iris-demand-promote`；需求来源是 DEV Git 补丁，目标基线必须从 PRD 服务器导出，默认只形成本地 PRD 提交。
只有用户要求生成提交信息、明确要求提交，或显式调用 `$demand-commit --plan|--commit` 时才使用 `demand-commit`；本地验证完成不自动加载。`--plan` 只生成提交计划和完整 commit message，不执行 pull 或 commit，也不追问是否提交；`--commit` 视为本地提交授权，直接执行 plan/apply/verify。commit 不改变 `acceptance-pending`，也不触发 feedback；push 仍需另行授权。

`iris-coding` 使用 `fast/full/guarded` 开发路径，但所有路径都必须读取项目入口、profile、通用规则和命中的专项规则。存在独立范围时做轻量 `parallelAssessment`，只在两个独立只读范围确有收益时自主使用最多两个临时子 Agent；主 Agent 是唯一写入者。并行写入、持续通信或跨会话协作应建议 `iris-change-agent` 正式 workflow。
当用户要求查询 IRIS 类、方法、函数、宏、SQL 元数据或官方文档时，使用 `iris-mcp-lookup`；该 skill 默认只读，并把当前实例元数据与官方文档版本分开报告。

前端编码在修改前和最终 diff 后执行 `rules/iris_coding_frontend.md` 的“条件 i18n 门禁”；该节统一维护启用状态、信号、缺失配置处理和 helper 静态检查，skill 只保留触发与检查时点。

`coding-iris-init` 是 bootstrap skill。首次接入目标工程时应直接读取插件真实路径 `.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`，不要依赖安装后才会生成的 thin-index。

## 规则入口

- 总索引：`rules/iris_coding_index.md`
- 通用编辑安全：`rules/iris_coding_general.md`
- 后端 ObjectScript：`rules/iris_coding_backend.md`
- 前端 CSP/JS/HISUI：`rules/iris_coding_frontend.md`
- MCP/上传/编译工作流：`rules/iris_coding_workflow.md`
- IRIS 部署执行清单：`rules/iris_deploy_checklist.md`
- Legacy GB2312 提升流程：`rules/iris_gb2312_workflow.md`
- HISUI 控件参考：`references/hisui-widget-index.md`（源码内置在 `.agents/vendor/hisui/`）
- HISUI 样式与资源参考：`references/hisui-style-index.md`（主题 CSS、locale CSS、语义 class、图标与插图）
- HISUI 上游升级：源仓读取 `vendor/hisui/AGENTS.md`；版本与行号取 vendor 的 upstream.json/source-index.json，实际工程先核对运行文件和应用 helper，不能把新快照等同真实 HIS 版本。
- iris-agentic-dev 配置：`rules/iris_agentic_dev.md`（Windows x64 可执行文件内置在 `.agents/vendor/iris-agentic-dev/`）
- IRIS 知识查询与 MCP 路由：`rules/iris_knowledge_lookup.md`
- IRIS 官方文档路由：`references/iris-official-docs-routing.md`

## 内置脚本



`scripts/iris-tools/compile-csp.js` 固化 CSP 的 Atelier 编译通道：默认本地计划，显式 `--execute` 一次批量编译虚拟路径列表。仅编译指定文件（含 show.csp），不自动扩展父页面或重新上传；无自动重试。

SFTP vendor 运行时位于 `vendor/sftp-server/`，由本插件维护。新项目保持 SFTP 默认禁用；更新时自动迁移可识别的旧 SFTP 启动路径；显式 custom 和自定义参数保持不变。依赖安装、主机密钥核对、原子上传兼容边界见 `../../vendor/sftp-server/README.md`。项目已确认 Atelier Web doc 支持时，前端通道选择和 SFTP fallback 按[部署保护](references/deployment-protection.md#前端通道选择)执行。

插件内置：

- `scripts/generate-plugin-thin-index.ps1`
- `scripts/convert-gb2312-upload.ps1`
- `scripts/check-frontend-encoding.ps1`
- `scripts/migrate-frontend-encoding-profile.ps1`
- `scripts/migrate-demand-delivery-profile.ps1`
- `scripts/promote-frontend-export.ps1`
- `scripts/iris-tools/`

`scripts/iris-tools/promote-demand.js` 提供 DEV→PRD 需求的 plan/apply/continue/verify 状态机；计划按 DEV/PRD 绝对路径身份隔离，远端基线暂存于系统临时目录，不写入 `.agents/work` 或业务源码，直到 apply 通过全部探测门禁。冲突后的 `continue` 必须重新校验 DEV/PRD HEAD，并拒绝未暂存或未跟踪状态。



`generate-plugin-thin-index.ps1` 不复制到目标工程；初始化和重建索引时直接调用插件内脚本。

初始化/迁移在目标工程 `.agents/scripts/` 生成薄 wrapper，转发到插件内编码脚本。已知历史复制版本可自动迁移；用户定制版本只报告冲突，不得静默覆盖。

`scripts/iris-tools/` 是 IRIS 开发主力脚本集合，包含部署清单生成、导出、编译、Broker 调试和环境配置同步。真实连接信息由目标工程本地私有配置承载：已有 `.mcp.json` 时反向补齐 `.agents/config/project-env.json`，没有 `.mcp.json` 时才从 `templates/project-env.template.json` 创建并用 `sync-env-config.js` 生成 `.mcp.json`。这些文件不得提交到版本库。

`scripts/iris-tools/source-sync.js` 管理项目按需导出、现场保护、服务器层与需求层的独立提交及复审冻结；操作参数以 `--help` 为准。共享远端准入与 Atelier client 位于能力包根 `scripts/lib/`，本地状态检查/显式恢复使用根 `scripts/iris-remote.js`，具体边界归上述项目协议。

`xml-export.js`／`xml-scope.js` 处理准确范围的服务器 XML 包及候选；`baseline-catalog.js` 维护版本清单，`code-baseline.js` 只采集代码并预筛排除图片。纯采集不强制 project 或 Git，项目提交状态机按原分支进入。新增能力随正常更新分发，初始化仅提示可选专用类与原生执行通道，不自动部署服务器类或开启多会话；详细使用与升级分别读取上述两个 reference。

`prepare-deploy-manifest.js --from-git` 在 workspace-overlay 中按声明的 SourceRoot/GitRoot 分组执行 Git diff，并把结果映射回 WorkspaceRoot 逻辑路径；同名仓库相对路径必须保留各自 `sourceRoot`、`gitRoot`，不得互相覆盖。前端编码迁移只扫描 `sourceRoots[name=frontend]`；manifest 明确只有 `backend` 时规范化为 `N/A (backend-only)`，其它无法判定的缺失声明继续阻断。

默认模板将 `mcp.serverPath` 指向 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe`。该路径只表示内置 MCP server 可执行文件位置，不包含 host、namespace、账号、密码或 token。

官方 `iris-agentic-dev` v1.5.0 中通用性较高的 8 个 ObjectScript skills 固定快照位于 `.agents/vendor/iris-agentic-dev-skills/`，在 manifest 中全部声明为 optional capability。任务命中后按需读取，普通更新不生成浅层入口；上游工具名必须先按 `rules/iris_knowledge_lookup.md` 映射到当前 `tools/list` schema。`objectscript-tdd` 只有在任务已授权远端编译和测试时才能使用，其原文中的直接 session fallback 不得绕过本插件门禁。

前端上传加编译固定使用 `scripts/iris-tools/deploy-frontend.js`：按显式配置选择受保护 Atelier doc 或 SFTP，哈希回读后批量编译；失败停止。受管发布读取绑定的只读快照，保留原源码身份与 Storage 复审门禁。参数及耗时口径见 `scripts/iris-tools/README.md`。

后端编译后必须按 [Storage 同步契约](references/deployment-protection.md#编译后-storage-同步) 核对并仅回填本次指定类的 Storage；本地同步失败不能报告 verified，受管夜跑保留源码冻结版本复审门禁。

## 开发部署与可选基线保护

部署、CSP 编译和 SFTP 配置入口共用 workspace 校验结果；目录缺失、错误链接及无效 manifest 在配置读取和远端连接前停止并返回非零退出码。能力包必须为有效安装（含 CapabilityRoot 的 .git）；非按需导出工程的 direct 仍不要求业务源码 Git 仓库或基线会话。

非按需导出工程日常开发部署默认 direct：明确目标、文件和授权后执行，不要求需求号、Git 基线会话或 fetch/pull；保留编码、Storage、并发变化、回读和编译检查。需要三方合并时显式使用 `--mode guarded --demand <id>` 并建立会话。旧命令仅带 `--demand` 继续使用 guarded。完整契约见 references/deployment-protection.md（从插件根解析）；无 `--execute` 只生成本地计划。

部署 Question 兼容：停止结果提供工具无关 question 协议，固定决定代码；Agent 按能力采用选项或文字确认。暂停/查看/无效决定不写入。详见 references/deployment-protection.md。

## 按需辅助与收尾

遵循 agents/_shared/execution-guidance.md（源仓根；部署态为 .agents/agents/_shared/）。guidanceMode 默认 auto，可选 concise/assisted；辅助程度不改变授权、编码及领域契约。方法允许合并或重排，IRIS 编码共用 iris_coding_general 的风险分流。业务验收后按信号加载 feedback，无信号不例行报告。现有工程按 docs/update-agents.md 定点合并项目入口，普通能力包更新不重写用户 AGENTS/profile。

- 提交与全局 upstream 检查去重：见 [协议](../demand-delivery-plugin/references/commit-upstream-check.md)，复用进程级 hooks.requireUpToDate 配置，手动提交保持原检查。

## BOS 需求入口

BOS 查询和已有需求处理归独立 bos-plugin；项目已启用时从其 bos-demand-handle 路由到本插件。直接正文开发无需 BOS 配置。事实和有效预授权复用；验收后提交及裸调用语义由 demand-commit 统一维护，不另建提交机制。

部署配置支持 Overlay 显式 `projectEnvFallback`：模块文件优先，仅缺失时读取声明的主仓文件；具体范围、冲突停止与源码隔离规则以 [部署清单](rules/iris_deploy_checklist.md#部署配置继承) 为准，不切换项目根或生成副本。
