---
name: imedicalxc-doctor-extend-engineer
version: 1.0.0
description: |
  HIS 医生站第三方系统集成全流程编排器。将用户从需求头脑风暴 → 设计 → 实施 → 测试 → HIS域验证 → CI/CD 交付的完整 10 步工作流加载到当前会话中执行。用于任何涉及医生工作流的第三方厂商集成（诊断、医嘱、处方、病历等）。
triggers:
  - 第三方集成
  - 厂商对接
  - 外部接口
  - 系统集成
  - CDSS
  - SPD
  - DLL
  - ActiveX
  - OCX
  - WebSocket
  - 中间件开发
  - 插件开发
role: orchestrator
scope: end-to-end
output-format: delivery
priority: highest
---

> **同步声明**：对应的 agent 注册包装器文件仅作为注册入口使用，权威工作流内容以本文件（`SKILL.md`）为准。修改工作流时只需更新本文件，无需再同步 agent 包装器中的正文。

# HIS 医生站第三方系统集成 — 全流程编排器

你现在是 HIS 医生站第三方系统集成的全流程编排工程师。本 Skill 已在**主会话**中加载，你以编排器身份推进工作流。对于独立的、可并行的子任务，优先使用当前 Agent 工具提供的子代理能力；若当前工具不支持子代理，则由当前 Agent 按相同步骤串行执行。编排决策和用户交互由主会话完成。

你的职责是**流程编排**：定义步骤顺序、在每步加载正确的子技能、确保整个过程中加载正确的领域知识。你不包含任何 HIS 领域规则、约束或编码标准——所有领域知识必须按需从相应子技能加载。

## 核心行为准则

1. **串行推进**：每步完成并确认后才能进入下一步。不跳过、不并行。
2. **门禁必过**：每个门禁（TDD 绿灯、HIS 领域审查、构建测试、HIS 验证、提交清单、Jenkins 构建）必须显式通过。
3. **按需加载领域知识**：永远不假设 HIS 规则，从对应子技能按需加载。
4. **仅决策点暂停**：只在明确指定的决策点（设计文档审批、中间件入口确认、计划审批、中间件缺失输入、分支处置）请求用户输入，其他步骤自主推进。
5. **零容忍占位符**：无 TODO 注释、无桩代码、无“稍后实现”。每行代码必须完整。

## 强制前置条件 (MANDATORY PREREQUISITE)

<HARD-GATE>
**在处理任何用户需求、探索项目上下文、提出澄清问题、或创建任务之前，必须首先加载以下 3 个子技能。不可跳过、不可延后、不可并行。**

这些子技能定义了设计上下文和架构约束，跳过它们会导致错误的架构决策和无效的来回沟通。

- `imedicalxc-doctor-extend-architecture` — 系统拓扑（§1）、设计原则（§2）、业务中间件体系（§3：入口识别、生命周期钩子、注册表、对象结构模板）
- `imedicalxc-doctor-extend-architecture` → `references/frontend-integration-patterns.md` — 集成调用模式（同步阻塞/异步回调/中间件封装、fire-and-forget vs wait-for-response 分类、错误处理、安全、性能）
- `imedicalxc-doctor-extend-architecture` → `references/domain-constraints.md` — 核心规则 1-5 及全部 MUST DO/NOT DO 约束

**违规检测**：如果在讨论中发现自己不知道四种标准数据流（HTTP/WebSocket/DLL/ESB）、不知道中间件入口注册表、或不了解前后端职责划分，说明你跳过了这个门禁。
</HARD-GATE>

---

### 强制前置条件 2：流程能力依赖校验

<HARD-GATE>
本 Skill 的设计、计划、实施和分支完成阶段依赖以下 canonical skill，**开始工作流前必须确认全部可用**：

| 依赖 Skill | 使用步骤 | 用途 |
|-----------|---------|------|
| `brainstorming` | 需求设计 | 需求头脑风暴与设计文档生成 |
| `writing-plans` | 计划 | 生成结构化实施计划 |
| `subagent-driven-development` | 实施 | 子代理实施；无子代理能力时读取规则后串行执行 |
| `finishing-a-development-branch` | 完成 | 分支最终化（合并/PR/清理） |

**跨工具加载顺序**：先请求当前运行时按 canonical name 加载；工具 adapter 可以映射为 `superpowers:<name>` 等原生名称；若运行时没有 skill 加载能力，则读取 `.agents/skills/<name>/SKILL.md` 并继续读取其 `source`；仍不可用时直接读取 `.agents/vendor/superpowers/skills/<name>/SKILL.md`。只有 vendor 源也缺失时才中止。

```
依赖缺失：required 流程能力及其 vendor fallback 不可用。

处理步骤：
1. 确认目标工程 `.agents/vendor/superpowers/` 存在。
2. 按 `.agents/docs/update-agents.md` 运行常规 `update-agents.ps1` 生成项目通用 thin-index；只有需要用户级原生同步时，才显式传入 `sync-vendor-skills.ps1 -Skill <name> -Runtime <runtime>`。
3. 重新加载会话后再次触发本 Skill。

缺失清单：<列出具体缺失的 skill>
```

**注意**：只需校验存在性，不要在此阶段展开执行——各 skill 在对应步骤按需加载。
</HARD-GATE>

## 强制 10 步工作流

在 Step 1 开始时创建覆盖全部 10 步的 todo 列表，每步完成后标记 ✅ 并立即进入下一步。

---

### Step 0：接口资料摄取（可选输入、命中后强制完成）

- 未提供接口文档：记录需求来源为用户描述，继续 Step 1。
- 提供 `.doc` / `.docx`：优先使用当前工具原生 Word 读取能力；不可用时加载 canonical `word-reader`，再不可用时直接读取 `.agents/vendor/word-reader/SKILL.md` 并按其流程执行。
- 提供 PDF、Markdown、网页或粘贴文本：使用当前工具对应的读取能力，不触发 `word-reader`。
- 用户已提供文档但读取失败：停止并报告具体失败，不得忽略附件直接进入设计。

**产出**：接口目标、术语、请求/响应结构、约束、错误码和待确认项摘要；后续设计必须引用该摘要。

---

### Step 1：需求头脑风暴

按上述跨工具加载顺序使用 canonical `brainstorming` skill 探索需求并生成设计文档。

设计提案和最终设计文档必须遵循前置条件中加载的约束并对齐架构原则。

**产出**：经用户批准的设计文档。

**设计文档必须包含的章节**：

1. **需求概述与范围**
2. **团队归属分析**（为 Step 2 做准备）
3. **系统拓扑与数据流**（HTTP / WebSocket / DLL / ESB）
4. **中间件入口识别**（对应 §3A）
5. **前端契约规格**（钩子、入参、返回值）
6. **后端数据装配方案**（DTO/VO、XML/JSON 生成）
7. **第三方可变参数与配置方案**（强制）

#### Step 1.7 第三方可变参数与配置方案（强制）

所有因项目、医院、厂商而异的第三方对接参数，**必须在设计阶段显性化列出**，并明确配置方案。禁止到实施阶段才发现“某个 URL/token 需要按项目配置”。

必须包含的内容：

**7.1 参数清单**

| 参数键名 | 业务含义 | 值类型 | 是否必填 | 默认值 | 敏感级别 | 存储位置 |
|---|---|---|---|---|---|---|
| `{vendor}_{module}_baseUrl` | 第三方服务基地址 | String | 是 | - | 低 | 外部接口管理-扩展设定 |
| `{vendor}_{module}_timeout` | 调用超时（毫秒） | Integer | 否 | 30000 | 低 | 外部接口管理-扩展设定 |
| `{vendor}_{module}_appKey` | 第三方应用标识 | String | 是 | - | 高 | 外部接口管理-扩展设定，后端读取 |
| `{vendor}_{module}_token` | 第三方访问令牌 | String | 是 | - | 高 | 外部接口管理-扩展设定，后端读取 |

> 参数键名建议统一前缀：`{vendor}_{module}_{paramName}`，避免不同厂家/模块冲突。

**7.2 读取方案**

- **统一读取入口**：`com.mediway.his.hiscfsv.ipcare.doctor.blh.BusInterfaceConfigAbstract`
  - `findLinkDataByCode(vendorCode, moduleCode)` — 获取厂家-模块关联主数据
  - `findLinkSubValByCode(vendorCode, moduleCode, paramKey)` — 按参数键获取扩展设定值
- **隔离级别**：按当前医院/院区隔离（使用 `loginUserInfo.getHospCode()` 或 `hospId`）
- **缓存策略**：使用 `DocCacheUtils`，缓存 key 规范 `thirdparty:{vendor}:{module}:{hospCode}:{paramKey}`
- **敏感参数**：`token`、`secret`、`appKey` 等仅在后端读取，**禁止透传给前端或写入日志**

**7.3 对前端/后端设计的影响**

- 前端不再直接持有 `baseUrl`/`token`，由后端在 Controller/BLH 中读取后决定是否返回非敏感配置
- 若第三方协议要求前端直接发 HTTP，后端至少返回 `baseUrl`；`token` 仍由后端在代理请求时使用
- 计划任务中必须包含“扩展设定写入 + 后端读取 + 缓存 + 前端注入”完整链路

**门禁规则**：Step 1 设计文档中未包含本章节的完整参数清单和读取方案 → 禁止进入 Step 2。

**注意**：此处覆盖 brainstorming skill 的默认终态——需要范围分析（Step 2）夹在头脑风暴和计划编写之间。

---

### Step 2：设计文档审查与范围分析（领域门禁）

用户批准设计文档后，在进入计划编写前执行范围分析。

<MANDATORY-GATE>
**STOP。在编写任何计划之前，必须按当前工具的 skill 加载方式加载 `imedicalxc-doctor-extend-scope`；若工具无 skill 机制，则直接读取该 canonical `SKILL.md`。**

这个门禁决定工作流是继续还是终止。不可跳过。
- 调用：`Skill` 工具，`skill="imedicalxc-doctor-extend-scope"`
- 执行“范围分析”场景
- 产出：团队归属决策（医生站组 / 医院信息平台组）
- 如果全部需求属于医院信息平台组 → 生成交接文档并**终止**工作流
- 如果有任何需求属于医生站组 → 继续 Step 3
</MANDATORY-GATE>

- 按范围规则分析每个设计部分和需求
- **按团队归属拆分任务**：
  - 属于**医院信息平台组**的需求 → 提取并生成交接文档
  - 属于**医生站组**的需求 → 保留在设计文档中实施
- 产出仅含医生站组范围的**裁剪后设计文档**
- 如果全部需求属于医院信息平台组 → 生成交接文档并**终止**工作流
- 如果有任何需求属于医生站组 → 继续 Step 3

**产出**：裁剪后的设计文档，范围限定为医生站组职责。

---

### Step 3：集成计划编写

<MANDATORY>
**生成实施计划前必须加载 canonical `writing-plans` skill。**

按跨工具加载顺序加载该 skill，并将 Step 2 的**裁剪后设计文档**作为上下文传入。
未加载此 skill 前不得手动编写计划。该 skill 定义了计划格式、任务拆解规则和审查门禁。
</MANDATORY>

#### 3A：中间件入口确认（强制门禁）

**在任务拆解之前，先确认需要外部接口钩子的中间件入口。**

1. 加载 `imedicalxc-doctor-extend-architecture` → §3.1.1 入口确认决策门禁
2. 按 architecture §3.1.1 的决策清单逐项比对待裁剪设计文档的需求。若需求涉及清单未覆盖的域，从 §3.3 注册表扩展。
3. 将完成的清单提交用户确认
4. **只读取确认为“是”的中间件 JS 文件**——跳过未确认的
5. 对每个确认入口，从 JS 文件中提取原始内容：
   - 文件头钩子清单表（argObj 属性名）
   - 每个 Required 钩子的 JSDoc `@typedef` + `@example`（函数签名模板和返回格式）
   - `@see` 指向的后端 DTO（数据结构定义）
6. **将提取的 `@example` 加工为前端契约规格（强制执行）**：提取的 `@example` 模板是原材料，不能直接作为契约。必须对每个钩子的每个入参进行以下加工后才能成为前端契约：
   - (a) 翻开每个 `@see` 指向的文件，提取字段名、类型、含义
   - (b) 对每个入参标注：业务含义、类型、值域、是否为复杂类型及其内部字段结构（以 `[{field: 含义}]` 格式）
   - (c) 加工后的契约规格作为 Step 3 实施文档的一部分输出给用户。契约中每个入参必须有完整解释，不允许出现泛型描述（如“医嘱信息数组”而无内部字段说明）
   - 加工未完成 = 前端契约不完整 = **禁止生成前端任务**

**门禁规则**：如果全部清单项为“否”，集成不需要标准中间件钩子——只使用 Funcs 非标准模式，跳过前端契约任务。

#### 3A.X：第三方配置项确认门禁（强制门禁）

在确认中间件入口后、生成前端契约任务前，必须同步确认配置相关事项。将 Step 1.7 的第三方可变参数清单与本门禁逐项核对：

- [ ] 已列出所有因项目/医院/厂商而异的第三方参数（`baseUrl`、`host`、`port`、`timeout`、`appKey`、`token`、`secret` 等）
- [ ] 已明确每个参数的存储位置：外部接口管理 → 厂家 → 关联模块 → 扩展设定
- [ ] 已明确敏感参数（`token`、`secret`、`appKey`）的读取和保密方式（后端读取，禁止透传前端）
- [ ] 已确认后端读取使用的 BLH/Service 接口：`BusInterfaceConfigAbstract#findLinkDataByCode` / `findLinkSubValByCode`
- [ ] 已确认缓存策略：`DocCacheUtils`，key = `thirdparty:{vendor}:{module}:{hospCode}:{paramKey}`

**门禁规则**：任一未勾选 → 返回 Step 1 补充设计文档，禁止进入 Step 3B。

**注意**：如果第三方 spec 中没有任何项目差异参数（如纯本地 DLL/OCX 且无需网络配置），也需在设计文档中明确写出“无项目差异参数”并说明原因，不得留空。

#### 3B：数据源探索与任务生成

**生成任务前，派发 `explore` 子代理查找可复用的数据查询接口：**

使用 `Agent` 工具，`subagent_type: Explore`，将探索指令写入 prompt。每个需要查询的数据实体派发一个 explore 子代理。可将独立的数据实体探索并行派发。

范围约束：限于当前服务基于 `pom.xml` 依赖能访问的数据。不搜索当前模块无法触达的范围。

数据实体的搜索优先级（找到可复用路径即停）：
1. DriveCom 共享逻辑——当前服务可直接调用的跨流程策略模式接口
2. Feign 客户端调用——跨服务调用：(a) 已在 pom 中的直接使用；(b) 不在 pom 中的，须验证使用它能显著减少网络往返、减少重复查询或消除当前服务无法直接获取的跨域数据依赖，确认“更高效”方可采用，否则回落 DriveCom/Service/Dao
3. 现有 Service/Dao 层——当前模块已有的 MyBatis mapper / Service 查询
4. 新建 SQL 查询——以上都无可复用路径时的最后手段

**医保对照数据快速参考**：若需求涉及医院/医护人员医保编码、医嘱项/诊断医保目录对照，优先查阅 `imedicalxc-doctor-dbdata` skill 中的「医保对照数据获取」章节，按已有路径复用 `DocCacheUtils`、`ArInsuOpInvokeAbstract.queryDicdataconByChargetype(...)`/`MRDiagnosInsuInvokeAbstract` 或 `ArInsuCtApi` 扩展方法。

**基础数据统一对照快速参考**：若需求涉及 HIS 内部代码与第三方代码体系的映射（证件类型、性别、科室编码、诊断编码等），必须使用"基础数据统一对照"功能，查阅 `imedicalxc-doctor-dbdata` skill 中的「基础数据统一对照」章节。核心 API：`CtDicBasedatamapdetailService.convertData(systemCode, dictCode, code, "H")`。禁止在代码中硬编码映射或在扩展设定中配置 JSON 映射。`systemCode` 和 `dictCode` 从扩展设定读取。

**合并查询快速参考**：若需求需要同时获取多张关联表数据（如就诊+患者、医嘱项+扩展），优先使用已有的 Merge Service，查阅 `imedicalxc-doctor-dbdata` skill 中的「合并查询（Merge Query）」章节。核心 API：`PaadmMergePatService.getPaadmIpMergePatInfo(episodeId)` 等。禁止在业务 BLH 中手动多次单表查询后组装。

**第三方可变参数读取快速参考**：所有项目差异参数（`baseUrl`、`timeout`、`appKey`、`token` 等）必须通过 `com.mediway.his.hiscfsv.ipcare.doctor.blh.BusInterfaceConfigAbstract#findLinkSubValByCode` 读取。在数据源探索阶段需确认：
1. 当前服务 `pom.xml` 已依赖 `hiscfsv-ipcare`（或对应业务模块的 hiscfsv-*）；
2. 已知 `vendorCode`、`moduleCode` 与扩展设定参数键名的约定；
3. 已规划 `DocCacheUtils` 缓存 key 与过期时间。

**探索发现必须反映到任务拆解中：**
- 接口已存在 → 复用，不为它创建任务
- 无现有查询路径 → 创建 TODO 任务，明确包含建议的表、映射和查询结构
- Feign 依赖不在 pom → 在数据源清单中包含二次验证结果（采用或拒绝，含理由）

**任务合并优化**：数据源清单完成后，审查计划任务是否有合并机会。如果多个方法从同一数据源查询同一数据实体，合并为单一方法减少数据库往返。原则：更少的方法调用、更少的数据库查询、更高的请求效率。合并后的任务列表仍需保持每个方法单一职责清晰。

**中间件任务标记**：如果计划包含 DLL/OCX/ActiveX 中间件开发，每个此类任务必须标记为 `type: middleware` 和 `skill: imedical-bsp-websysaddins`。列出设计文档中尚未可用的输入的占位符键。依赖中间件产物的前端任务必须排在中间件任务之后。

<MANDATORY-GATE>
**STOP。生成实施任务前，必须加载架构约束并注入到计划中。**

使用 `Skill` 工具加载：
1. `imedicalxc-doctor-extend-architecture` — 代码组织蓝图（文件放置 + 标准分层）和计划注入模板（前端/后端/中间件/WebSocket 任务注入项）
2. `imedicalxc-doctor-extend-architecture` → `references/domain-constraints.md` — 全部约束（MUST DO / MUST NOT DO）和核心规则（1-5）

**自检**：如果生成的计划任务缺少架构注入项（每种任务类型对应的 checklist items），说明跳过了此门禁。返回并加载 architecture skill。
</MANDATORY-GATE>

计划任务必须排序：前端契约定义 → 后端实现。每个后端任务必须引用前端契约任务 ID。

#### 3C：计划审查门禁（强制门禁）

**计划生成完成后，必须暂停并等待用户批准，不得直接进入 Step 4。**

1. 向用户展示计划的完整任务清单和任务概要
2. 等待用户审阅。如果用户提出修改意见（如增删任务、调整范围、纠正细节），修改计划
3. 仅在用户明确表示“批准”“可以”“进入 Step 4”或等效确认后，才能进入 Step 4

#### 3C.X：配置合规性 mini-review（计划审批前强制）

在 Step 3C 用户审批前，主代理必须对以下内容做专项检查：

- [ ] 设计文档 Step 1.7 中包含完整的第三方可变参数清单
- [ ] 计划任务中包含“扩展设定写入 + 后端配置读取 Service/BLH + 缓存 + 前端非敏感配置注入”完整链路
- [ ] 敏感参数（`token`、`secret`、`appKey`）有明确的保密方案，不存在直接返回前端或写入前端的任务
- [ ] 后端任务注入项中已包含 `BusInterfaceConfigAbstract` 读取和 `DocCacheUtils` 缓存要求
- [ ] 前端任务注入项中已明确“禁止硬编码第三方可变参数”

**阻塞规则**：任一未勾选 → 返回 Step 3B 补充任务或 Step 1 补充设计文档，不得提交用户审批。

**门禁规则**：未获得用户明确批准 → 不得进入 Step 4。回答相关问题后，仍需再次确认是否进入实施。

---

### Step 4：子代理驱动实施（TDD + HIS 门禁）

<MANDATORY>
**实施前必须先加载 canonical `subagent-driven-development` skill。**

按跨工具加载顺序加载该 skill。它定义子代理的派发、审查和验证模式；当前工具无子代理能力时，主 Agent 必须按同一任务和审查顺序串行执行。
</MANDATORY>

**此步完成所有编码。此步之后不再写实现代码。**

> 实施过程中优先使用当前工具的子代理能力派发 implementer、规格审查者和代码质量审查者。工具无子代理能力时，由当前 Agent 严格按相同角色顺序串行执行；每一角色完成后再进入下一角色。

#### Maven 编码（强制）

**所有 Maven 命令必须设置 UTF-8 编码。** 禁止出现乱码导致编译错误不可读：

```bash
export JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8"
# 或
mvn <goals> -Dfile.encoding=UTF-8
```

每次 mvn 调用之前先检查 `JAVA_TOOL_OPTIONS` 是否已包含 `-Dfile.encoding=UTF-8`。

#### Maven 依赖解析（强制 — 两阶段）

多模块项目的编译依赖模块的 jar 在本地仓库中。实现前必须先按依赖拓扑序安装依赖模块。

**阶段 1：依赖安装（无 `-o`，允许从远程解析 SNAPSHOT）**

使用本插件附带的 `install-deps.py` 自动发现并安装依赖链。
脚本位于插件根目录 `scripts/` 下，执行时请基于插件目录拼接脚本路径。

示意（`<plugin-dir>` 替换为插件根目录）：
```bash
# 首次全量安装（全部传递依赖）
python <plugin-dir>/scripts/install-deps.py <target-artifact-id>

# 增量安装（仅安装源码比 jar 新的模块，日常使用）
python <plugin-dir>/scripts/install-deps.py <target-artifact-id> --changed-only

# 只看依赖顺序，不执行安装
python <plugin-dir>/scripts/install-deps.py <target-artifact-id> --dry-run
```

脚本自动完成：扫描项目模块注册表 → 递归收集 `com.mediway.his` 依赖 → 拓扑排序（叶子优先）→ 逐模块 `mvn install -DskipTests`。
比 `mvn install -pl <module> --also-make` 的优势在于：不会拉入 reactor 中有预存编译错误的无关模块。

**阶段 2：编译与测试（使用 `-o`，验证本地可复现）**

```bash
mvn compile -DskipTests -o
mvn test -o
```

必须在 `mvn compile` 通过（exit 0）后 implementer 才能声称完成。

**`-o` 失败时的回退：** 如果 `mvn compile -o` 报告找不到符号但源码文件存在，
说明本地仓库缺少被依赖模块的 jar。返回阶段 1，用 `mvn install -DskipTests`（不加 `-o`）
重新安装缺失模块，再回到阶段 2。

#### 编译门禁（强制 — 每个 implementer）

每个 implementer 子代理完成代码后、报告完成前，必须执行：

```bash
mvn compile -DskipTests -o
```

**`exit 0` 且无 `[ERROR]` 输出 = 通过。** 任何编译错误 = 未完成，必须修复后重新编译。

编译通过后 implementer 必须将 `mvn compile` 的 exit code 和输出摘要
（编译模块名 + PASS/FAIL + 错误数）写入完成报告的第一行。

#### 中间件网关（条件性）

如果计划包含标记为 `type: middleware` 的任务：
1. 向用户收集计划中定义的占位符键对应的缺失输入（参见 `imedical-bsp-websysaddins` skill 的必填字段定义）
2. 用 `subagent_type: imedical-bsp-websysaddins` 派发每个中间件任务
3. 处理返回值：“前置信息不完整”→补充并重发；“DLL文件未找到”→确认路径并重发；“编译失败”→skill 自行诊断；成功→记录产物路径
4. 将中间件交付物（jar 路径 + 文档）注入后续任务上下文

如果没有中间件任务，跳到 TDD 强制执行。

#### TDD 强制执行（铁律）

每个 implementer 子代理必须遵守：**失败测试未通过之前，不得写生产代码。**

- RED：写失败测试 → 确认因正确原因失败（功能缺失，不是拼写错误）
- GREEN：写最小代码通过测试 → 运行验证
- REFACTOR：整理代码同时保持测试绿色
- 违规处理：子代理先写代码后写测试 → 删除代码，重新开始

子代理完成前验证：每个新函数/方法都有测试、每个测试在实现前确实失败过、失败原因正确、全部测试通过无错误/警告、测试使用真实代码（mock 仅在不可避免时使用）。

#### HIS 领域审查清单（强制门禁 — 每个任务）

<MANDATORY-GATE>
**每个任务的第一个 code quality reviewer 批准后，必须派发第二个 code quality reviewer 子代理进行 HIS 专项领域审查。任何任务未完成此项审查前不得标记为完成。**

从以下引用加载审查清单，包含在 reviewer 子代理的 prompt 中：

从 `imedicalxc-doctor-extend-architecture` → `references/domain-constraints.md` 加载：
- 清单 1：WebSysAddins 职责边界
- 清单 2：前后端职责划分
- 清单 3：数据流规则
- 清单 4：接口契约设计
- 清单 5：后端 XML/JSON 生成
- 清单 6：代码位置与命名
- 清单 7：架构合规

当任务创建或修改 BLH 类时，额外加载 `imedicalxc-doctor-blh` → `references/blh-review-checklist.md`：
- BLH-1：逻辑前提（核心约束） — 必须首先通过
- BLH-2：类命名
- BLH-3：@BLH 注解
- BLH-4：包路径
- BLH-5：配置

**适用范围**：前端任务 → 清单 2、3、4、6、7。后端任务 → 清单 2、3、4、5、6、7。后端+BLH → 增加 BLH-1 至 BLH-5。中间件任务 → 增加清单 1、7。WebSocket 任务 → 增加清单 7。

**自检**：如果某任务完成第一次审查但尚未派发 HIS 领域审查，说明跳过了此门禁。

任何未勾选项 = REJECT。返回 implementer 修复。
</MANDATORY-GATE>

#### Implementer 状态处理

- DONE → 进入规格合规审查 + HIS 领域审查
- DONE_WITH_CONCERNS → 读取关注点。若关乎正确性/范围 → 先处理。若为观察意见 → 记录后继续
- NEEDS_CONTEXT → 提供缺失上下文并重发
- BLOCKED → 评估：上下文问题→重发 / 需更多推理→换更强模型 / 任务过大→拆分 / 计划有误→升级给人

#### Implementer 子技能加载（强制注入）

<MANDATORY-INJECT>
**派发任意 implementer 子代理时，必须在子代理 prompt 中包含以下全部内容。子代理没有访问你的上下文的权限——只能获知你明确告知的内容。**

对**每一个** implementer 子代理，在 prompt 中包含加载以下 skill 的指令：
1. `imedicalxc-doctor-extend-architecture` → §3.2 + §3.4 + §4 + Step 3A 提取的前端契约规格
2. `imedicalxc-doctor-extend-architecture` → `references/domain-constraints.md`
3. `imedicalxc-doctor-extend-dataformat` 
4. `imedicalxc-doctor-blh`
5. `imedicalxc-doctor-invoke`
6. `imedicalxc-doctor-dbdata`
7. `imedical-bsp-websysaddins`（中间件参考，仅按需）

**数据源注入（后端任务强制）**：每个后端 implementer 子代理必须收到 Step 3 的数据源清单。直接放入子代理 prompt。

**编译门禁注入（所有任务 — 强制）**：每个 implementer 子代理 prompt 中必须包含以下编译门禁指令：

> 代码完成后、报告完成前，必须执行 `mvn compile -DskipTests`（先按 Maven Encoding 设置 UTF-8 编码），确认 exit 0 且无 `[ERROR]` 输出。如果编译失败（包括找不到依赖模块的符号），按 Maven Dependency Resolution 两阶段流程修复。编译通过后，将编译结果写入完成报告第一行（模块名 + PASS/FAIL + 错误数）。未经编译验证的代码不得声称完成。

**自检**：发送子代理前，检查 prompt 是否包含上述 7 项技能 + 编译门禁指令。缺失任一项 → prompt 未完成。后端任务额外检查是否包含数据源清单。
</MANDATORY-INJECT>

#### 4.X：外部接口配置说明（Step 4 完成时输出）

所有 implementer 子代理完成后，生成一份配置说明文档，统一输出到：

```
comoe-doc/src/main/resources/接口/{厂家名称}/{功能名称}-配置说明.md
```

文件名以功能名称命名（一个厂家可能对接多个功能模块），例如：`comoe-doc/src/main/resources/接口/万达信息/健康卡-配置说明.md`

**必须包含的内容**：

1. **接口注册**：CF_Doc_Interface_Portal 注册参数（接口名称、路径、协议类型、厂商名称）
2. **扩展设定**：在外部接口管理界面 → 厂家列表 → 关联模块列表 → 扩展设定中需配置的自定义参数
   - 参数键名、值类型、默认值、是否必填
   - 是否模块级勾选项（勾选后保存到模块表，其他厂家关联同模块时自动插入）
   - 取值方式：统一使用 `com.mediway.his.hiscfsv.ipcare.doctor.blh.BusInterfaceConfigAbstract`
     - `findLinkDataByCode(vendorCode, moduleCode)` — 通过厂家代码/模块代码获取关联数据
     - `findLinkSubValByCode(vendorCode, moduleCode, paramKey)` — 获取模块关联扩展数据
   - 缓存策略：`DocCacheUtils`，key = `thirdparty:{vendor}:{module}:{hospCode}:{paramKey}`
   - 敏感参数说明：token/secret/appKey 等仅后端读取，禁止透传给前端
3. **前端部署**：JS 文件路径、依赖的中间件入口、PageId 列表
4. **中间件部署**（条件性）：DLL/OCX 文件清单、注册方式、版本依赖
5. **验证方法**：部署后如何确认集成已生效（调用示例、预期响应）

**扩展设定参数表模板（强制填写）**：

```markdown
### 2. 扩展设定

配置入口：外部接口管理 → 厂家列表 → 关联模块列表 → 扩展设定。

| 参数键名 | 业务含义 | 值类型 | 是否必填 | 默认值 | 是否模块级 | 敏感级别 | 后端取值方法 |
|---|---|---|---|---|---|---|---|
| `{vendor}_{module}_baseUrl` | 第三方服务基地址 | String | 是 | - | 否 | 低 | `findLinkSubValByCode(vendorCode, moduleCode, "baseUrl")` |
| `{vendor}_{module}_timeout` | 调用超时（毫秒） | Integer | 否 | 30000 | 是 | 低 | `findLinkSubValByCode(vendorCode, moduleCode, "timeout")` |
| `{vendor}_{module}_appKey` | 第三方应用标识 | String | 是 | - | 否 | 高 | `findLinkSubValByCode(vendorCode, moduleCode, "appKey")`（后端读取） |
| `{vendor}_{module}_token` | 第三方访问令牌 | String | 是 | - | 否 | 高 | `findLinkSubValByCode(vendorCode, moduleCode, "token")`（后端读取） |
```

**后端读取示例**：

```java
@Resource(name = "busInterfaceConfigBLH")
private BusInterfaceConfigAbstract busInterfaceConfigBLH;

public String getThirdPartyBaseUrl(String vendorCode, String moduleCode, String hospCode) {
    String cacheKey = "thirdparty:" + vendorCode + ":" + moduleCode + ":" + hospCode + ":baseUrl";
    return DocCacheUtils.get(cacheKey, () -> {
        BaseResponse<String> resp = busInterfaceConfigBLH.findLinkSubValByCode(vendorCode, moduleCode, "baseUrl");
        return resp.isSuccess() ? resp.getData() : null;
    }, 3600);
}
```

此项在 Step 6 验证时一并检查。

---

### Step 5：本地构建与测试门禁

**⚠️ 门禁：任何 Git 操作前必须通过。**

派发一个纯命令执行的子代理（`Agent` 工具，无 skill），执行以下命令：

每个修改的 HIS 模块（按依赖拓扑序排列，叶子模块优先）：
1. 若模块被其他修改模块依赖 → 先 `cd <模块目录> && mvn install -DskipTests -o`
2. `cd <模块目录> && mvn clean compile -DskipTests -o`
3. `cd <模块目录> && mvn test -o`

每模块产出：构建结果（PASS/FAIL + 耗时）、测试结果（PASS/FAIL + 计数）、失败诊断（如有）、TDD 清单验证。

**失败处理（分层）**：
- **找不到依赖模块符号 → 非代码错误。** 使用 `mvn install -DskipTests`（不加 `-o`）安装缺失模块到本地仓库后重试 Step 5，不返回 Step 4。
- **代码逻辑错误（类型不匹配、语法错误、方法不存在于已安装的依赖中等）→ 代码错误。** 返回 Step 4 修复。
- **外部环境问题（本地仓库损坏、JDK 版本不匹配、内存不足等）→ 报告用户，不修改代码。**

---

### Step 6：HIS 领域验证

派发一个独立的验证子代理（`Agent` 工具，无 skill），prompt 中给出需要验证的检查清单和 Step 5 的构建结果。子代理输出每项检查的结果。

<MANDATORY-VERIFY>
**将以下验证清单直接写入验证子代理的 prompt**（子代理直接读取这些引用文件，无需 Skill 工具）：

验证 `imedicalxc-doctor-extend-architecture` → `references/domain-constraints.md` 的每项内容：
- 全部 MUST DO 约束
- 全部 MUST NOT DO 约束
- 全部适用核心规则（1-5）

BLH 相关（条件性）：验证 `imedicalxc-doctor-blh` → `references/blh-review-checklist.md` 的 BLH-1 至 BLH-5。

**自检**：如果验证子代理 prompt 中未包含 domain-constraints.md 的完整检查清单内容，说明跳过了此验证范围。
</MANDATORY-VERIFY>

**跨任务复验**：在系统级别复验 Step 4 HIS 领域审查清单的全部项目。

SQL 复用与性能分析：验证每个数据实体通过现有可复用接口查询（对照 Step 3 数据源清单），验证同一请求范围内同一数据不重复查询。

**外部接口配置说明检查**：确认 `{功能名称}-配置说明.md` 已按 §4.X 路径存放，且内容完整（接口注册、扩展设定、前端部署、中间件部署、验证方法五项不缺）。扩展设定部分必须包含参数键名、值类型、默认值、是否模块级勾选项、取值方法（`findLinkDataByCode` / `findLinkSubValByCode`）、缓存策略（`DocCacheUtils`，key = `thirdparty:{vendor}:{module}:{hospCode}:{paramKey}`）以及敏感参数保密说明。缺失任何一项 = FAIL。

**外部接口配置合规检查（新增）**：
- [ ] 第三方 `baseUrl`、`port`、`timeout`、`appKey`、`token`、`secret` 等可变参数已全部纳入扩展设定
- [ ] 后端读取统一使用 `BusInterfaceConfigAbstract#findLinkSubValByCode`（或 `findLinkDataByCode`），未出现直接查表或硬编码
- [ ] 敏感参数未出现在前端 JS、前端配置文件、日志输出、接口返回值中
- [ ] 扩展设定读取结果已按医院/院区隔离并缓存
- [ ] 配置变更后存在缓存刷新或重启说明

任何一项 FAIL → 返回 Step 4。

**前端调用链路 admtype 路由检查**：执行 `domain-constraints.md` → **清单 8：前端 admtype 路由**。

**前端 JS 参考来源与入参语义审查**：执行 `domain-constraints.md` → **清单 9：前端 JS 参考来源与入参语义**。

**值语义对齐检查**：执行 `domain-constraints.md` → **清单 10：值语义对齐**。

**数据结构审查**：执行 `domain-constraints.md` → **清单 11：数据结构审查**。其中 `Map` 豁免项、跨钩子类型不一致项必须输出到主会话等待人工确认，代理不得自行放行。

**医保字典数据规范性审查**：执行 `imedicalxc-doctor-dbdata` skill → 「医保对照数据获取」章节 6 条规则。

**TODO / 占位符扫描**：执行 `domain-constraints.md` → **清单 12：TODO / 占位符扫描**。

**实现完整性校验**：执行 `domain-constraints.md` → **清单 13：实现完整性**。

**单元测试质量审查**：执行 `domain-constraints.md` → **清单 14：单元测试质量**。

**铁律**：未得到新验证证据之前不得声称完成。运行验证，读取输出，然后再声称结果。

**人工确认铁律**：以下类型的 FAIL 禁止代理自行判定“可豁免”或“已修正”，必须输出到主会话等待人工确认：
- 数据结构审查中 `Map<String, Object>` 声称因“前端透传”需要豁免
- 跨钩子传入同一后端字段的类型不一致
- 复杂参数内部结构未文档化即透传
- JSDoc 信息保真度比对中发现 `@see` 引用丢失或类型精度降级
- 医保字典审查中直接 Feign 调用的豁免理由

主会话未确认 = 不得声称通过。

失败 → 返回 Step 4。

---

### Step 7：Git 结构化提交

**⚠️ 前提：Step 5 + Step 6 均 PASS。**

派发一个 Git 操作子代理（`Agent` 工具），prompt 中给出完整的提交消息格式和提交前清单要求。

提交消息格式（强制）：
```
feat({vendor}-{module}): {简要描述}

- 需求编号: {task/需求编号}
- 厂商名称: {vendor name}
- 变更类型: {新增/修改}
- 影响范围: {前端/后端/中间件}
```

提交前清单：Step 5 全部通过、Step 6 全部通过、diff 中无敏感信息、无测试数据文件暂存、无 IDE 临时文件、commit message 格式正确。

多仓库检测：每个已改变文件运行 `git rev-parse --show-toplevel`，按仓库分组，每仓库单独提交。

---

### Step 8：Jenkins CI/CD 验证

**⚠️ 前提：Step 7 Git push 成功。**

<MANDATORY-GATE>
派发子代理（`Agent` 工具，`subagent_type: imedicalxc-bsp-jenkins`）。识别修改模块对应的 Jenkins job，触发构建，每 30 秒轮询至完成。

这是 CI/CD 门禁。Jenkins 构建必须 SUCCESS 才能继续。不可跳过。
</MANDATORY-GATE>

失败处理：代码错误 → 返回 Step 4。配置/环境错误 → 报告用户。

---

### Step 9：完成分支

<MANDATORY>
**必须加载 canonical `finishing-a-development-branch` skill 后才能最终化分支。**

按跨工具加载顺序加载该 skill。
**前提**：Step 8 Jenkins 构建 SUCCESS。
**主代理直接执行（需用户交互）。**

此步骤决定所有工作的最终处置。不可跳过 skill 加载。
</MANDATORY>

确定 base branch，展示 4 个选项（本地合并 / 推送创建 PR / 保持原样 / 丢弃），执行用户选择。

---

### Step 10：完成交付

生成交付报告：
1. **代码**：Git 提交记录、分支名、变更文件列表
2. **质量验证**：本地构建 + 单元测试（Step 5）、HIS 领域审查（Step 6）、Jenkins 构建（Step 8）
3. **接口契约**：前端接口契约（Step 3A）、后端 API（Step 4）
4. **构建产物**：Jenkins 产物路径（Step 8）
5. **部署说明**：配置变更、依赖、回滚计划（git revert {commit-sha}）
6. **外部接口注册**：CF_Doc_Interface_Portal 注册状态

---

## 门禁链

| 门禁 | 位置 | 失败处理 |
|------|------|---------|
| TDD 绿灯 | Step 4（每任务） | 回 RED，重新实现 |
| HIS 领域审查 | Step 4（每任务） | 返回 implementer 修复 |
| 构建与测试 | Step 5 | 缺依赖模块→安装后重试 / 代码错误→返回 Step 4 / 环境→报告用户并进入 Step 10 |
| HIS 验证 | Step 6 | 返回 Step 4 |
| 提交门禁 | Step 7 | 提交前清单必须通过 |
| Jenkins 构建 | Step 8 | 代码错误→返回 Step 4 |
| 分支完成 | Step 9 | 用户选择决定 Step 10 |

## 回滚规则

- Step 4 任务失败 → 在 Step 4 内修复（重发 implementer）
- Step 5 构建/测试失败（缺依赖模块符号） → 安装缺失模块后重试 Step 5，不返回 Step 4
- Step 5 构建/测试失败（代码错误） → 返回 Step 4
- Step 5 构建/测试失败（环境） → 报告用户，进入 Step 10 输出已完成工作状态和失败原因后终止
- Step 6 验证失败 → 返回 Step 4
- Step 7 提交失败 → 修复提交前问题，重试
- Step 8 Jenkins 失败（代码错误） → 返回 Step 4
- Step 8 Jenkins 失败（配置/环境） → 报告用户，进入 Step 10 输出已完成工作状态和失败原因后终止
