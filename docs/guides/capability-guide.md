# 能力使用指南（非 xc）

新夜跑先按 [治理接入](../night-governance.md) 记录用量基线，在初筛后预检能力、确定可执行子集，再规划逐条最低测试、预算、真实容量与独立 worktree，批准并 materialize executionPlan；宿主使用 client worker 持续监督，浏览器 Tester 使用验收 worker 复用认证。报告分开最低自检和实际证据。旧 run 不迁移，首次真实试跑最多 5 条另行授权。

预检失败需单人继续时，使用[退出夜跑转受监督串行](../../workflows/bos-demand-unattended.workflow.md#单-agent-降级)，默认保留独立 worktree、原预算与截止及恢复证据；不按单人夜跑派发。新项目预检通过[通用客户端探针](../night-governance.md#客户端生命周期预检)提供生命周期/停止证据，不再另写即时中断脚本；旧已批准 run 及回执保留。

需要调整已有 2.1 夜跑容量时，先取得用户明确授权，在真实安全边界使用原 `night-record` 事件增加 `maxInFlight`；默认、权限、截止及历史保留，未使用的授权也必须有效。条件和字段见[运行中调整容量](../night-policy.md#运行中调整容量)。

新夜跑启动前明确每需求总时限（可用批次统一值），问题返修默认最多 4 次；独立需求沿原流程，有依赖才补消费版本和验证绑定。耗尽项交接、独立项继续；最终集成由 Coordinator 按现有协议完成，不新增自动合并服务。配置及限制见[夜跑接口](../night-policy.md#返修收敛与按需依赖)。

找不到服务地址、凭据来源，或配置修改后未生效时，使用者和 Agent 从[连接信息查看与排查](connection-configuration.md)定位；Agent 自行核对来源与读取顺序，不要求使用者先解释配置目录。

创建或接续 worktree 时核对实际仓库的 VS Code 查看入口和固定基点；阶段完成及交接时执行已授权的本地提交并明确剩余未提交范围，见[审阅交付规范](worktree-review.md#阶段提交与恢复点)。通用编码规则和项目入口模板提供条件路由；模板不授予权限，已有项目在授权维护时合并入口。多仓容器兼顾工作区文件与直接打开目录，区分本批提交及集成归属。

新 BOS 夜跑先集中核验授权与实际能力，前后端共用 schema 2.1 run；受管部署/验收携带 work item，回执和计时自动归档。运行中异常分支挂起交接，数据保留/重置/删除与资源退出分开报告。旧 2.0 run 不迁移，接入见[启动契约](../night-policy.md#schema-21-启动契约)。

需要控制夜跑测试成本时，使用[夜跑决策策略](../night-policy.md)：派发前审业务预期，实际改动后重评最低验证；13分钟单项探索、30分钟共用准备及每候选6分钟人工参考均可配置。旧批次不自动启用，结果仍需用户验收。

夜跑/批量处理请按 [夜跑接入](../night-acceptance.md) 先选择验收层级：纯后端直接验证方法或实际接口，UI 行为优先无头 Playwright；工具就绪不代替业务授权。

IRIS 部署配置缺失时：Overlay 仅使用项目 manifest 明确声明的 projectEnvFallback；本地配置存在就不回退。仍在模块入口执行，不切换主仓。见 [部署清单](../../plugins/coding-iris-plugin/rules/iris_deploy_checklist.md#部署配置继承)。


本手册帮助使用者选择能力、提供输入和判断结果。[能力目录](capability-catalog.md)列出非 xc 插件内全部 skill、rule 及源文件；本文为每个 skill 提供请求示例。详细操作和最新参数以链接的 SKILL.md 为准。

## 第一次使用

下面是业务项目接入路线。仅查询个人 BOS 待办时，可从 [bos-init](#bos-plugin) 初始化个人配置并使用已有用户级入口，无需为此启用业务项目；配置、用户级入口与客户端 MCP 注册分别处理。

1. 在目标业务工程中工作，先让 Agent 读取该工程的 `AGENTS.md`。本仓库是能力源，业务需求不在本仓执行。
2. 尚未安装 `.agents` 时，按[安装与更新手册](../update-agents.md)接入；已有能力包也从该手册检查。Node.js 是能力包工具链依赖，不是业务系统生产依赖；文档转换、浏览器预览等专项依赖由对应技能检查。
3. 查看目标工程 `.agents/config/plugin_profile.md`：`available` 表示可发现但尚未接入，`enabled` 表示参与常规更新和使用，`disabled` 表示禁用。目录存在或手册列出该插件不代表已启用。基础插件缺省策略也不能覆盖已有显式状态。
4. 明确要求接入所需插件时，使用[目录中的接入入口](capability-catalog.md#插件一览)，由 Agent 核对依赖、项目配置和 thin-index。纯初始化 skill 不出现在日常薄索引中时，直接读取插件内的真实 `SKILL.md`；无需为每次任务重新初始化。
5. 选择下表中的场景，提供对象、目标和操作范围。既有授权继续有效；仅讨论或要求计划时，保持对应范围。

标准工程中，真实技能通常位于 `.agents/plugins/<插件>/skills/<技能>/SKILL.md`，生成的 `.agents/skills/<技能>/SKILL.md` 只是指向真实文件的薄索引。Workspace Overlay 必须先解析 `capability.json`，从实际 CapabilityRoot 读取能力、从 ContextRoot 读取模块配置；路径和操作方法见[Overlay 手册](../workspace-overlay.md)，不要按目录层级猜测。

## 按场景选择

| 我想做什么 | 推荐入口 | 应提供的信息 |
|---|---|---|
| 初始化 BOS 个人配置或接入项目 | [bos-init](#bos-plugin) | 明确个人初始化或目标项目接入；凭据只在仓外配置中填写 |
| 查询 BOS 待办、历史或详情 | [bos-demand-query](#bos-plugin) | 查询模式或需求编号，按需补充日期和筛选条件 |
| 处理已有 BOS 需求 | [bos-demand-handle](#bos-plugin) | 需求编号或充分正文、目标工程和操作范围 |
| 连续验收已实现需求、边验边交付 | [demand-acceptance](#demand-delivery-plugin) | 需求与来源映射、人工结论及已有台账；明确调用即授权完整交付 |
| 补录 BOS 代码更新日志 | [bos-code-update-log](#bos-plugin) | 已有提交的 repo/hash，预览范围与独立 BOS 写入授权 |
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
| UI 标注还原、布局或主题兼容诊断 | [iris-ui](#iris-ui) | 原型/标注或复现步骤、页面范围和目标主题 |
| 公司UI规范、截图或浏览器评审 | [imedical-ui](#imedical-ui) | 截图/页面或规范问题、目标风格与范围 |
| 整理标版需求、提交或移植 | [需求入口](#coding-iris-plugin) | Git 改动或提交、编号、仓库角色 |
| 发布 IRIS 文件或治疗表单 | [iris-deploy](#coding-iris-plugin)、[cure-form-deploy](#iris-cure-form-dev) | 明确对象、目标、交付方式和授权范围 |
| 沉淀已验证的通用经验 | [agent-framework-evolution](#agent-framework-evolution) | 已验证材料；业务反馈还须满足验收条件 |

## 如何发起请求

最通用的方式是自然语言指定任务和 skill，例如：

> 使用 iris-frontend-coding，修改我指定页面的查询交互。需求和文件路径如下；本轮完成本地实现与验证。

宿主支持技能选择器或 `$技能名` 时，也可以使用其原生入口。`$技能名` 不是 PowerShell 命令，也不是所有 Agent 工具都支持的通用语法。宿主没有技能发现能力时，让 Agent 直接读取真实 `SKILL.md` 并按其流程执行；这不改变插件启用与授权条件。宿主发现适配见[技能适配说明](../coding-agent-adaptation.md)。

全部自有 skill（含 init、xc）和 Agent 支持 `--help` 或“查看用法”，默认展示简明用途、输入、已声明参数、示例和指南链接；这是 Agent 层的请求，不进入业务流程。完整帮助、路径解析和更新方式见[统一帮助协议](capability-help.md)。除这项公共约定外，只有 skill 明确声明的参数才可使用。例如下面是给 Agent 的请求：

```text
使用 bos-demand-entry --text，从当前标版改动生成需求录入文本。
使用 demand-commit --plan，只生成已验证改动的提交方案。
```

`--plan`、`--commit` 不是所有 skill 的通用参数。对没有这些参数的能力，直接说“先给计划”“只做差异检查”或“执行已确认范围”；实际脚本命令由 Agent 按技能正文选择。需要手工执行时，使用源文档中的完整命令，并确认运行目录和前提。

一次请求尽量给齐：**目标工程、文件或对象、预期结果、允许的操作范围**。涉及翻译补充目标语言，涉及表单补充 CA/CR，涉及接口补充规范与字段确认情况。连接信息由 Agent 从工程已有配置读取，不粘贴到通用手册或能力文件中。

## demand-delivery-plugin

使用 [demand-commit](../../plugins/demand-delivery-plugin/skills/demand-commit/SKILL.md) 的 `--plan` 为已验证改动生成方案，明确 `--commit` 才执行本地提交；push 独立授权。当前用户或项目约定须明确 standard/project、数字需求号、标题与精确文件，无需 IRIS profile。

上游更新与需求无交集、内容和消息未变时，按[同步复核协议](../../plugins/demand-delivery-plugin/references/commit-upstream-check.md#head-前进后的自动接续)由 Agent 重新 plan 后沿用已有授权接续。技能自行同步，有无 hook 均适用；`--plan` 仍不联网或提交。

已有需求需要提交时使用 [demand-commit](../../plugins/demand-delivery-plugin/skills/demand-commit/SKILL.md)。用户连续验收多个需求时使用 [demand-acceptance](../../plugins/demand-delivery-plugin/skills/demand-acceptance/SKILL.md)。报告按[共享测试协议](../../agents/_shared/testing-protocol.md#结果与交接)分别统计人工补验与待用户验收结论，保留实际功能验证范围。处理报告固定包含本批全部需求号汇总（含基线已满足、无需新增代码项），状态分组另列；格式与完整性核对见 [编号汇总契约](../../plugins/demand-delivery-plugin/skills/demand-acceptance/SKILL.md#编号汇总契约)。

> 使用 demand-acceptance，我逐号报验收结论：独立需求通过后交付；主子需求共享代码时，整组通过后主需求提交一次，各需求分别补日志，全部适用日志确认后共享 push 一次。明确无代码项登记原因并跳过代码阶段。汇总时分别给人工通过和已交付编号，用能直接粘贴到 BOS 的单行逗号格式。

主子组的阻塞、共享回执和无代码阶段按[代码归属协议](../demand-code-ownership.md)处理，单个子项通过不提前提交共享代码，其它独立需求可继续；明确无代码也须人工验收，缺失或未知提交不作为无代码跳过。帮助请求只展示说明，沿[统一帮助协议](capability-help.md)结束，不进入交付。

快捷登记人工通过推荐保留“编号＋标题”，先按编号定位再用标题复核；也支持纯编号列表 `/demand-acceptance --pass 123,124`。多行粘贴示例：

```text
/demand-acceptance --pass
123 示例需求标题
124 另一条示例需求标题
```

已进入验收会话后可省略技能名，直接发送 `--pass` 加上述多行列表。裸 `--pass` 仅在上下文唯一定位一个待验收需求时使用，多候选只澄清编号；详细解析、重复结论续接和暂停边界见技能“接收结论”。以上为调用示例，帮助或讨论示例不执行交付。

新任务用 `demand-acceptance` 验收当前工作区；从其他 worktree 接收变更用 `demand-acceptance --worktree`，或 `demand-acceptance --worktree "<来源路径>"`（兼容 `-worktree`）。来源与目标核实后才合入；当前目录是 worktree 不代表要合回其他仓库。接续已有批次保留原映射；来源参数只选择来源，交付授权来自用户明确调用，清理仍需独立授权。

明确调用开展验收交付即授权该批次通过项提交、BOS 日志及推送，无需额外开关或反复选择范围；非 BOS 项目跳过日志。用户明确暂不交付时保留限制；仅查看技能、查询汇总或 Agent 自动加载不产生写入授权。默认复用台账；需要批次恢复时读 [验收索引协议](../../plugins/demand-delivery-plugin/references/acceptance-session.md)。更新能力包后刷新 thin-index 即可发现新入口，不自动部署业务改动或启动批次。

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
| 标版需求录入 | `bos-demand-entry --text`（代码补录，或自然语言指定“提需求给某组”及主题/资料；`--work` 工作记录；可叠加 `--split`、`--excel`）→ 用户录入 BOSS → `--bind` 回填编号与标题；仅代码来源再按需 `--plan` / 明确 `--commit`，完整参数见[需求录入协议](../../plugins/bos-plugin/references/standard-demand-entry.md) |
| 已有 BOS 需求处理 | `bos-demand-handle` → 获取并复用需求与相关媒体 → 按技术栈实施、自查和验证 → 用户验收 → 按授权提交并校验全部仓库 → 自动准备本次提交的日志计划 → 复用 BOS 补录预授权或请求授权 → 提交 BOS 日志；需求状态更新独立授权 |
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
| [coding-agent-adaptation](../../plugins/agent-context-kit/skills/coding-agent-adaptation/SKILL.md) | 按项目配置中逐行填写的目录清单补齐缺失技能链接；也支持指定宿主。 | 已有 .agents，明确宿主；产出链接检查结果，已有冲突内容保留。 |
| [project-context-maintenance](../../plugins/agent-context-kit/skills/project-context-maintenance/SKILL.md) | 检查当前工程上下文，更新已过时的事实并精简重复说明。 | 提供目标工程和维护范围；产出适用的 AGENTS、规则、记忆或配置变更。 |
| [task-handoff](../../plugins/agent-context-kit/skills/task-handoff/SKILL.md) | 为当前需求启用交接；下次从交接记录继续。 | 同机同工作区、串行接续；产出 docs/handoff 下正文及现场记录，明确交接时留快照。 |

## agent-framework-evolution

[查看该插件清单](capability-catalog.md#agent-framework-evolution)。下面的示例发给 Agent，不在终端执行；路径、对象和范围替换为当前工程实际值。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [agent-framework-evolution-init](../../plugins/agent-framework-evolution/skills/agent-framework-evolution-init/SKILL.md) | 在当前工程启用 agent-framework-evolution，检查技能入口。 | 保留显式插件状态；只接入入口，不执行反馈或打包。 |
| [agent-framework-feedback](../../plugins/agent-framework-evolution/skills/agent-framework-feedback/SKILL.md) | 这个业务需求已验收，请只读审查本次框架反馈候选。 | 业务需求已明确验收且反馈适用；仅给通过 skill 共享准入的候选，无合格项正常结束；局部经验留项目内，写入和提升另按授权执行；框架维护不触发。 |
| [reusable-content-packaging](../../plugins/agent-framework-evolution/skills/reusable-content-packaging/SKILL.md) | 把这份已验证的通用流程整理成能力包，去掉项目私有信息。 | 提供经验来源、验证证据与目标范围；产出通用能力文件及接入说明。 |

## coding-iris-plugin

[查看该插件清单](capability-catalog.md#coding-iris-plugin)。下面的示例发给 Agent，不在终端执行；路径、对象和范围替换为当前工程实际值。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [coding-iris-init](../../plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md) | 为当前 IRIS 工程接入 coding-iris-plugin，检查现有配置和脚本入口。 | 目标工程与实际配置可核实；产出 profile、脚本及薄索引检查结果，保留已有值。 |
| [iris-backend-coding](../../plugins/coding-iris-plugin/skills/iris-backend-coding/SKILL.md) | 修改指定类方法以满足这份需求，保留分层和返回契约，按框架规范检查新增代码。 | 提供类方法、需求及范围，有项目显式规范时一并提供；编码与 Review 共用 CLS 规范，格式化只处理本次新增代码，不附带整理已有代码。新增注册类/DTO、表类及成员按统一标签说明职责和参数/返回契约，变量使用自然注释，复杂返回引用结构；Debug 只作为文档内容，属性说明及索引注释按需，保留历史兼容及 Storage。新建类核对 profile、同职责类和公共基类，适配模板 Extends，向 Review 提供继承依据。提取公共方法后核对规则复用和稳定标识归属；Parameter 声明/引用按语言合法性检查，静态歧义交人工核对。产出本地源码，分别报告 Agent 审查、脚本覆盖项及编译/运行证据。 |
| [iris-coding](../../plugins/coding-iris-plugin/skills/iris-coding/SKILL.md) | 修改这个功能，先查明前后端调用链，再完成范围内实现。 | 提供功能入口和需求；产出任务路由、相关前后端变更及验证说明。 |
| [iris-demand-promote](../../plugins/coding-iris-plugin/skills/iris-demand-promote/SKILL.md) | 先评估将 DEV 的指定提交移植到指定 PRD 仓库的范围和基线。 | 明确两个仓库、提交及服务器基线读取范围；授权实施后形成 PRD 本地提交，不部署。 |
| [iris-deploy](../../plugins/coding-iris-plugin/skills/iris-deploy/SKILL.md) | 将这些文件部署到已指定环境并检查编译。 | 明确目标、文件和授权范围后直接执行，默认 direct，无需 Git 基线会话；需要三方合并时选 guarded，分别报告上传、编译后回读、Storage 本地回填及业务验证；回填失败不能报告部署验证通过，受管夜跑源码变化后复审冻结版本。 |
| [iris-frontend-coding](../../plugins/coding-iris-plugin/skills/iris-frontend-coding/SKILL.md) | 调整指定 HISUI 页面的交互，或排查弹窗面板留白、裁切与滚动异常，保留现有数据和调用契约。 | 提供页面、行为要求及项目显式规范/兼容基线；编码与 Review 共用前端规范，仅对本次新增代码应用格式约定，按条件加载 i18n。分别报告静态检查、自审或独立 Review、实际页面验证；布局问题仍路由到 HISUI 样式参考；新建页面或审查初始化链路时，按依赖与容器契约选择 JS 组织模板。 |
| [iris-frontend-gb2312-promote](../../plugins/coding-iris-plugin/skills/iris-frontend-gb2312-promote/SKILL.md) | 这是仍需 GB2312 的历史工程，请先检查转换文件与源文件的替换范围。 | 必须明确历史编码要求及文件替换授权；产出源名提升结果，普通 UTF-8 工程不使用。 |
| [iris-imedical-knowledge](../../plugins/coding-iris-plugin/skills/iris-imedical-knowledge/SKILL.md) | 查询这个业务概念的相关参考，再结合当前源码核实。 | 给出业务词或疑点；产出来源和适用性说明，现有信息足够时无需查询。 |
| [iris-mcp-lookup](../../plugins/coding-iris-plugin/skills/iris-mcp-lookup/SKILL.md) | 核实这个 IRIS 类方法的签名和当前可用能力，注明来源。 | 给出类方法或文档线索；依当前 MCP、本地源码或官方文档返回证据，不猜签名。无原生入口时使用 [helper 按需 schema 与 JSON 输出](../../plugins/coding-iris-plugin/rules/iris_agentic_dev.md#诊断)，正常调用已内置配置检查；使用 v1.5.0 时按同一规则中的响应契约处理列表截断、方法错误和持久会话。 |
| [iris-menu-sync](../../plugins/coding-iris-plugin/skills/iris-menu-sync/SKILL.md) | 刷新全部或指定安全组快照；已审阅并登记的全量来源可由宿主每月调用固定采集入口。 | 明确来源及读取范围；产出本地快照和差异，异常保留旧快照。定期运行动态读取启用组，不自动部署或修改 HIS 权限。 |

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

## imedical-ui

[查看插件清单](capability-catalog.md#imedical-ui)。技术栈无关，只需项目入口和既有插件配置；来源固定为IHOS海蓝与PURE天蓝，详细规范按场景读取。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [imedical-ui](../../plugins/imedical-ui/skills/imedical-ui/SKILL.md) | 按两套规范核对这个查询页，共性一次适配，差异按需补；目前只有 PURE 截图。 | 使用现有组件/技术栈，按对象语义和责任层归类；截图风格不自动限定业务共性的实现范围，规范推广仍须对应来源证据，业务行为变化另列。 |
| [imedical-ui-review](../../plugins/imedical-ui/skills/imedical-ui-review/SKILL.md) | 用这些截图评审UI，或核对指定浏览器标签里的实际页面。 | 只审查提供的证据，报告位置、事实、来源和建议；截图看不到的交互、比例未知和缺失风格保持未覆盖，AI结论不等同正式UI验收。 |
| [imedical-ui-init](../../plugins/imedical-ui/skills/imedical-ui-init/SKILL.md) | 按框架更新流程接入公司UI规范与评审能力。 | 保留现有配置，核对注册/profile，生成日常入口；不隐含业务修改、公共CSS修改或远端操作授权。 |

业务实现通过目标适配能力完成；IRIS CSP＋HISUI 使用 iris-ui。未来 Java/HTML 适配直接依赖通用层，不需要 IRIS 配置。本期规范底稿不含完整查看器或其它主题导出。

## iris-ui

[查看该插件清单](capability-catalog.md#iris-ui)。0.2.0正式依赖 imedical-ui 与 coding-iris-plugin 均已启用且兼容；首次接入直接读插件init，已有工程同步核对注册/profile后走正常完整更新。更新不会自动启用依赖，不能只看退出码判定成功。

| Skill | 请求示例 | 前提与预期结果 |
|---|---|---|
| [iris-ui](../../plugins/iris-ui/skills/iris-ui/SKILL.md) | 按这份 UI 标注改造指定 HISUI 页面，共性共用、差异有据，保留已验收主题和业务契约。 | 提供原型/标注或故障复现入口及范围；修改前归类，最终 diff 核对主题限定和直接调用者；按共享协议选取 CSS 优先级、初始化及动态阶段证据并及时停止，用户视觉/业务验收分别记录。 |
| [iris-ui-init](../../plugins/iris-ui/skills/iris-ui-init/SKILL.md) | 在当前工程按框架更新流程接入 iris-ui，复用现有 IRIS 配置并检查日常入口。 | 依赖已启用且兼容；Overlay 先更新共享能力，再按项目模块管理流程刷新 Context；保留自定义配置，不以手工同步或单独生成薄索引代替正式更新。 |

诊断请求示例：“首屏出现横向滚动，展开查询后消失，请比较实际容器尺寸与生命周期。”插件只读辅助 `collectUiMetrics({targets:[{name,selector}]})` 采集显式目标的几何与样式证据；浏览器控制仍使用宿主现有能力，无法读取的 frame/控件报告未采集。图片与标注、实际加载资源、Console/Network 和交互验证按任务补齐，数值采集成功不代表布局已通过。

相关 UI 修改的最终 diff 后，使用 [主题条件扫描器](../../plugins/iris-ui/scripts/check-theme-scope.js)辅助核对新增或受影响的主题限定：`node <iris-ui>/scripts/check-theme-scope.js --project-root <WorkspaceRoot> --file <精确文件>`，多文件重复 `--file`。工具只读 CSP、CSR、HTML、JS、CSS 显式文件，输出 JSON 候选与覆盖限制；成功返回 0（包括发现候选），输入或读取失败返回 2。Agent 判断共性或有据差异，并沿现有搜索核对未覆盖的封装；不遍历全仓，不自动修改或阻断。相关内容未变时复用已有结果，零候选不等于 UI 通过。

现有前端入口的条件加载以 [iris-frontend-coding 流程](../../plugins/coding-iris-plugin/skills/iris-frontend-coding/SKILL.md#流程)为准。部署继续使用原 owner；需要保留服务器已有修改时，先按 [部署保护](../../plugins/coding-iris-plugin/references/deployment-protection.md)核对可用基线与合并条件，不能把 UI 插件启用当成部署授权或新增保护能力。

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

## bos-plugin

主子需求按[代码归属协议](../demand-code-ownership.md)：例如“按三个入口拆子需求，共享代码挂主需求；全部通过后统一提交，主子各自日志复用这次提交”。Agent准备草稿和映射，用户逐项回填编号即可；明确无代码的条目保留原因并跳过代码交付，不需日志凭据。

BOS 与需求交付按 manifest 的阶段声明复用能力；缺失提示与调用检查见[可用性依赖](../plugin-availability.md)。

前提：Node.js >=22.5.0；项目内使用时明确启用插件，个人查询可使用已接入的用户级入口。在线查询与日志补录使用 BOS_MCP_CONFIG 指向的共享私有文件，各自读取按 skill 命名的段，已有充分需求正文的本地处理不依赖在线查询。

- [bos-init](../../plugins/bos-plugin/skills/bos-init/SKILL.md)：请求“初始化 BOS 个人配置”，Windows 创建或复用分段私有配置，仅绑定 BOS_MCP_CONFIG；旧平铺文件须明确 migrate-config 原地迁移，用户补全 TODO 后离线核对；这不启用项目。请求“为当前项目接入 BOS 查询与需求处理”才更新 profile 并生成四个日常发现入口。详见[配置说明](../../plugins/bos-plugin/references/usage.md)；非 Windows 使用显式配置，不自动注册客户端 MCP。
- [bos-demand-entry](../../plugins/bos-plugin/skills/bos-demand-entry/SKILL.md)：请求“根据当前标版改动补需求”“整理这份工作记录”或“提需求给支持组，解决演示系统登录问题”，可补资料。仅 standard；扁平Git代码用v2，主子代码用v4，`--work` 工作和自然语言主题提需用 v3；主题不要求 Git，接收组与产品标识分开核实。默认文本，`--split` 审查拆合、`--excel` 导出同源草稿、`--bind` 回填编号，仅代码按授权衔接提交。已完成条目追加备注，文本写完不代表问题已解决。本地生成无需 BOS 凭据，不自动发送或录入；产物归目标工程需求目录或任务临时目录。旧 `iris-demand-entry` / `iris-demand-commit` 已删除，改用当前 owner，数据兼容与项目引用迁移见[迁移说明](../demand-delivery-migration.md)。
- [bos-demand-query](../../plugins/bos-plugin/skills/bos-demand-query/SKILL.md)：默认开发待办，`--proj` 仅项目来源，`--dev` 产品（所有非项目来源），可独立调用或与带日期的 `--workload` 组合，完整说明见[来源口径](../../plugins/bos-plugin/references/usage.md#项目与产品非项目来源口径)。`--todo` 查全部个人开发待办，`--todo 2026-10-23` 按预计完成时间查单日；`--workload 2026-10-01 2026-10-23` 按执行时间查工作量，日期必填，范围也可写为 `2026-10-01~2026-10-23`。新入口按接受人、当前人和状态组合分类，清除默认当前组，输出实际口径及待核对项，见[个人查询口径](../../plugins/bos-plugin/references/usage.md#个人待办与工作量口径)。所有待办默认创建日期升序，个人查询支持 `--sort 预计完成时间 --order asc` 等五类日期排序，排序与筛选独立，见[日期排序口径](../../plugins/bos-plugin/references/usage.md#日期排序口径)。默认列表含创建时间、需求号/完整标题，末尾默认追加发起人/发起组，可指定其它列或“只要需求串”（单行半角逗号分隔编号），格式选择仅影响 Agent 展示，完整契约见[输出格式](../../plugins/bos-plugin/skills/bos-demand-query/SKILL.md#输出格式)。原编号详情、发起/接受/当前人员或组及历史查询继续可用，旧通用 pending 仍按默认当前人＋所在组；切换筛选明确清除不用的默认条件。结果区分正文、图片与附件链接，不改业务代码或 BOS 状态。更新能力包并刷新已启用索引取得新入口，无私有配置迁移或旧文件清理。
- [bos-demand-handle](../../plugins/bos-plugin/skills/bos-demand-handle/SKILL.md)：请求“处理 BOS 12345”，主动读取相关媒体并按项目技术栈实现与验证；“验收后提交”授权本地提交，全部校验成功后自动准备本次日志计划，再请求 BOS 补录授权。“验收后提交并将本次提交补录到 BOS 代码更新日志”可提前明确两项授权。配置缺失、拒绝或补录失败保留本地已提交结果；完整正文可在 BOS 不可用时继续本地工作。

- [bos-code-update-log](../../plugins/bos-plugin/skills/bos-code-update-log/SKILL.md)：请求“预览这些提交的 BOS 代码更新日志”只运行 plan；明确“把这些提交补录到 BOS”才执行 submit。只读已有 Git 提交，跨仓说明全部保留，不执行本地 commit/push；token 与 linkProject 使用本技能配置段，缺失不影响需求查询。

普通与夜跑复用项目已启用领域能力，按需求范围选择入口，支持不同及混合技术栈；新增体系不要求修改 BOS 分支或增加启动扫描。简单任务由当前 Agent 连续修改、自查和目标验证；IRIS 前端/后端范围明确时直达专项技能，混合或边界不明时进入 iris-coding，非 IRIS 沿用项目规范。回归按实际改动选择，正式协作按条件加载已有协议；只有明确要求交接才建交接记录。提交仍按原授权执行。新进程可读入口、真实宿主发现及简单需求提效分别验证，见 [场景](../../plugins/bos-plugin/references/scenarios.md)。

## 可重复 BOS 验收

需求实现前按 [测试协议](../../agents/_shared/testing-protocol.md) 明确角色、数据、动作、断言与恢复。需要接入已有 runner 时使用 [测试运行时](../testing-runtime.md)，例如“为本需求准备可重复的验收，沿用项目认证和数据，在部署版本就绪后执行并清理”。心跳必须先验证项目端点和空闲时限，更新能力包不会自动启用；真实服务器操作仍需对应授权。普通任务可串行执行，工具通过不等于用户验收。
