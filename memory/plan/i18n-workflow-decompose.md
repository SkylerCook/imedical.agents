# i18n 需求处理工作流拆解与多 Agent 协作实施计划

> **状态：已实施** | 实施日期：2026-06-06 | 提交：待提交

## Context

当前 `i18n-iris-plugin` 的规则和技能设计基于"全知 Agent"模型 — 假设执行者已知要改什么文件、走什么链路、用什么 helper。但实际需求处理（如 6095804 打印 i18n 案例）表明，工作流是**阶段化**的，且前一阶段输出是后一阶段输入。

目标：从 `print-i18n-case-6095804.md` 和 `docs/demand-com-exp.md` 的实战经验中提炼通用五阶段模型，补全规则缺口，使 i18n 需求处理对不同模型（强弱模型）更友好，支持多 Agent 协作。

## 当前工程与近期提交评估

### 工程现状

- 本仓库是可复用 Agent 能力包仓库，根 `AGENTS.md` 只服务本仓库维护，不部署到业务项目 `.agents/`。
- `plugins/i18n-iris-plugin/` 当前承载 i18n rules、skills、templates、scripts 和插件入口。
- 目标工程差异仍应写入目标工程 `.agents/config/i18n_project_profile.md`，MCP 连接事实仍以目标工程 `.mcp.json` 为准。
- 当前维护记忆中，`memory/agent-kit-maintenance-backlog.md` 明确"多 Agent 协作暂不落地"；因此本计划只落地单 Agent 阶段化入口，不实现真正多 Agent 编排。
- `memory/plan/` 是本计划新建的维护者计划子目录，不应部署到业务项目。后续维护记忆中应明确 `memory/plan/` 的定位。

### 近 3 天相关提交影响

- `e5fef58` 新增 `plugins/i18n-iris-plugin/rules/i18n_coding_print_backend.md`，为打印后端 i18n 提供了初始规则。
- `6fe41e8` 新增 `plugins/i18n-iris-plugin/rules/i18n_dict_translate_facade.md`，把字典/表字段展示值翻译收敛到公共门面规则。
- `0185d6b` 新增 `plugins/i18n-iris-plugin/skills/i18n-xml-print-template-sync/SKILL.md` 和 `scripts/sync-xml-print-template.ps1`，并沉淀 6095804 打印案例复盘。
- `19dedb3` 将 6095798 对照经验合入 `docs/print-i18n-case-6095804.md`，进一步证明打印返回数据可能同时存在 JSON、字符串拼接、模板记录和公共模块协作等多种形态。
- thin-index 相关提交已将 canonical 行为收敛到根 `scripts/generate-plugin-thin-index.ps1`；本计划若新增 rule，只需依赖现有 wrapper，不应新增或复制 thin-index 生成逻辑。

### 可行性结论

本计划总体可行，但落地边界应收窄为"规则治理 + `i18n-coding` 阶段化入口"。

必须坚持：

- 先事实定位，再分类，再编码，再处理模板/种子，再验证。
- 不把 `i18n-xml-print-template-sync` 作为所有打印 i18n 的默认入口；只有 Explorer 阶段确认存在 XML 模板记录时才触发。
- 不新增 `i18n-requirement` 编排 skill，不落地真正多 Agent 调度。
- 新增规则放在 `rules/`，但不把大体量案例正文、提交 diff 或业务私有事实写入规则。

需要同步修正：

- `plugins/i18n-iris-plugin/AGENTS.md` 目前 Skill 路由未列出 `i18n-xml-print-template-sync`，本计划执行时应补齐。
- `i18n_index.md` 和 `i18n_coding_print_backend.md` 中"打印 JSON"的描述需要扩展为"实际打印返回数据"，避免继续误导为只支持 JSON。
- `i18n_verify.md` 应作为通用验证规则；各 skill 可以引用它，但不应机械删除自身特化检查。
- `docs/demand-com-exp.md` 是通用经验文档，反哺时只标记被提升条目和规则引用，不写入过多 i18n 专用细节。

## 五阶段模型与现有能力映射

```
阶段 1: 链路定位（Explorer）     → 缺口，需新建规则
阶段 2: 数据分类（Classifier）   → 缺口，需从现有规则中独立
阶段 3: 编码改造（Coder）        → 已有 i18n-coding skill，成熟
阶段 4: 模板/种子处理            → 已有 i18n-xml-print-template-sync 等，成熟
阶段 5: 验证（Verifier）         → 散落在各 skill 完成检查中，需收敛
```

## 多 Agent 协作设计（未来愿景，本轮不实现）

> 以下设计为后续演进预留。当前 backlog 约束"多 Agent 协作暂不落地"，本轮只落地方式 1（`i18n-coding` 内嵌阶段引导）。设计内容保留在计划中，供后续业务项目出现明确协作需求时参考。

### Agent 角色定义

| 角色 | 职责 | 读取规则 | 输入 | 输出 | 模型建议 |
|---|---|---|---|---|---|
| **Explorer** | 链路定位：从入口到数据源的完整调用链 | `i18n_link_tracing.md` + `i18n_project_profile.md` | 需求描述（页面、按钮、现象） | 链路事实报告（涉及文件、数据形态、模板层、中文残留位置） | 强模型（需要代码推理） |
| **Classifier** | 数据分类：把每个用户可见文本标注处理方式 | `i18n_field_classification.md` + `i18n_dict_translate_facade.md` | Explorer 的链路事实报告 | 字段分类清单（文本 → 类型 → 处理方式） | 强模型（需要业务语义理解） |
| **Coder** | 编码改造：按分类清单改代码 | `i18n-coding` skill（前端+后端+打印规则） | Classifier 的字段分类清单 | 改造后代码 + 翻译表 | 中等模型（规则驱动，按清单执行） |
| **Template Agent** | 模板/种子处理：XML 模板翻译、翻译种子生成 | `i18n-xml-template` / `i18n-xml-print-template-sync` / `i18n-page-trans-seed` / `i18n-bdp-trans-seed` | 翻译表 + 模板文件（如有） | 翻译后模板、种子类、SQL | 中等模型（流程驱动） |
| **Verifier** | 验证：编译、残留扫描、fallback 测试 | `i18n_verify.md` | 改造后代码 + 翻译后模板/种子 | 验证报告（通过/问题清单） | 中等模型（检查清单驱动） |

### 编排模式

#### 模式 A：串行流水线（默认，单 Agent 执行）

一个 Agent 按阶段顺序执行，每个阶段结束时产出中间文件，下一阶段从文件读取。

```
需求描述
  → [读 i18n_link_tracing.md] 定位链路，输出 docs/i18n_link_report_{需求号}.md
  → [读 i18n_field_classification.md] 分类字段，输出 docs/i18n_field_class_{需求号}.md
  → [读 i18n-coding skill] 按清单改代码，输出代码 diff + 翻译表
  → [读对应 template/seed skill] 处理翻译，输出模板/种子/SQL
  → [读 i18n_verify.md] 验证，输出 docs/i18n_verify_report_{需求号}.md
```

适用场景：需求范围小（单页面、单打印单据）、Agent 上下文足够。

#### 模式 B：分阶段多 Agent（复杂需求）

主 Agent 编排，子 Agent 执行各阶段。阶段之间通过文件交接。

```
主 Agent（编排器）
  ├─ spawn Explorer Agent → 输出链路事实报告
  ├─ 读取报告，判断是否需要拆分子任务
  │   ├─ 简单需求：spawn 单个 Coder Agent
  │   └─ 复杂需求：按模块/页面拆分，spawn 多个 Coder Agent 并行
  ├─ spawn Template Agent（如有模板/种子需求）
  └─ spawn Verifier Agent → 输出验证报告
```

适用场景：需求范围大（多页面、多打印单据）、需要并行处理。

#### 模式 C：条件分支（打印特化）

Explorer 阶段的链路定位结论决定后续路径：

```
Explorer 定位链路
  ├─ 结论：XML 模板链路 → 触发 i18n-xml-print-template-sync → Template Agent
  ├─ 结论：HTML 直出 → Coder 改后端代码（无模板层）
  ├─ 结论：字符串拼接 → Coder 改后端代码 + 字典翻译
  └─ 结论：第三方接口 → 标记"外部接口返回"，不改代码，转交对应业务组
```

### 阶段间交接协议

每个阶段输出结构化文件，下一阶段读取：

**链路事实报告**（Explorer → Classifier/Coder）：
```markdown
# 链路事实报告 - {需求号}
## 入口
- 入口 CSP: xxx.csp
- 触发事件: 按钮点击 / 页面加载 / 打印预览
## 调用链
- JS 方法: xxx.js:methodName → $cm({ ClassName, MethodName })
- 后端类: Package.Class.Method
## 数据形态
- 返回类型: JSON / string / HTML 片段
- 包含模板字段: PrintTemp=xxx / 无
## 渲染路径
- XML 模板 / HTML 直出 / 字符串直出 / 第三方
## 中文残留位置
- [位置1]: 模板 defaultvalue
- [位置2]: 后端固定文案
- [位置3]: 字典展示值
```

**字段分类清单**（Classifier → Coder）：
```markdown
# 字段分类清单 - {需求号}
| # | 文本 | 位置 | 类型 | 处理方式 | 备注 |
|---|------|------|------|----------|------|
| 1 | 床号 | 后端打印JSON | 固定文案 | 页面级翻译helper，整句占位符 | |
| 2 | 内科-内分泌科 | 后端打印JSON | 字典展示值 | GetTransLoc，分隔符保留 | |
| 3 | 备注内容 | 后端打印JSON | 业务输入 | 不翻译 | 用户手工录入 |
| 4 | 检验结果值 | 外部接口返回 | 外部接口 | 不翻译，转交xx业务组 | |
```

### 落地到业务项目的方式（本轮只落地方式 1）

#### 方式 1：在现有 `i18n-coding` skill 中内嵌阶段引导（渐进式，本轮实施）

不新建独立 skill，而是在 `i18n-coding` 的 SKILL.md 中增加阶段化引导：

```markdown
## 阶段化执行（复杂需求推荐）

当需求涉及多个文件、多种数据形态或打印链路时，按以下阶段执行：

1. 先读 i18n_link_tracing.md，输出链路事实报告
2. 再读 i18n_field_classification.md，输出字段分类清单
3. 按清单执行编码改造
4. 按需执行 template/seed 技能
5. 按 i18n_verify.md 验证
```

优点：不增加 skill 数量，对已有工作流无侵入。
缺点：单 Agent 执行，上下文压力仍在。

#### 方式 2：新建 `i18n-requirement` 编排 skill（独立式，暂不实施）

新建 `plugins/i18n-iris-plugin/skills/i18n-requirement/SKILL.md`，作为 i18n 需求处理的顶层入口。等实际业务项目中跑通几个需求后，再决定是否升级为此方式。

## 实施步骤

### 步骤 1：新建链路定位规则 `i18n_link_tracing.md` ✅

**位置**：`plugins/i18n-iris-plugin/rules/i18n_link_tracing.md`

**内容来源**：从 `print-i18n-case-6095804.md` 的"候选经验：链路定位"和 `i18n_coding_print_backend.md` 提炼。

**覆盖**：
- 从入口页/按钮事件定位后端方法的通用方法
- 抓取实际返回数据，判断数据形态（JSON / 字符串拼接 / HTML 片段 / 类 JSON）
- 查找模板字段（`PrintTemp`、`PreviewXMLName`、`templateId` 或项目特有标识）
- 判断渲染路径：XML 模板 / HTML-CSP / 字符串直出 / 第三方打印接口
- 标注中文残留位置（模板 / 后端固定文案 / 字典展示值 / 业务输入 / 外部接口返回）
- 适用边界：页面级和打印级链路定位的通用方法，不绑定具体渲染路径

**同步修改**：
- `plugins/i18n-iris-plugin/rules/i18n_index.md`：新增 `i18n_link_tracing.md` 入口
- `plugins/i18n-iris-plugin/skills/i18n-coding/SKILL.md`：必读规则中增加链路定位规则（打印场景前置）
- `plugins/i18n-iris-plugin/rules/i18n_coding_print_backend.md`：将"打印 JSON"入口措辞收敛为"实际打印返回数据"，并引用链路定位规则，避免预设 `PrintTemp`、`templateId` 或 JSON 形态

### 步骤 2：新建数据分类规则 `i18n_field_classification.md` ✅

**位置**：`plugins/i18n-iris-plugin/rules/i18n_field_classification.md`

**内容来源**：从 `i18n_coding_backend.md` 的分流逻辑、`i18n_coding_print_backend.md` 的打印数据文案分类、`print-i18n-case-6095804.md` 的"候选经验：后端打印数据分类"和 `demand-com-exp.md` 的检验清单中收敛。

**覆盖**：
- 统一分类体系：固定文案 / 字典展示值 / 业务输入 / 外部接口返回 / 未确认来源
- 每个分类的判断标准和处理方式
- 页面级 vs 打印级分类的共性和差异
- 分类结果输出格式（供 Coder 阶段消费的结构化清单）
- 翻译位置贴近原则（字典翻译靠近原始字段来源，不在最终变量上无脑套 `GetTransXxx`）

**同步修改**：
- `plugins/i18n-iris-plugin/rules/i18n_index.md`：新增 `i18n_field_classification.md` 入口
- `plugins/i18n-iris-plugin/rules/i18n_coding_backend.md`：在"表数据与字典展示值"段落引用分类规则
- `plugins/i18n-iris-plugin/rules/i18n_coding_print_backend.md`：在"打印数据文案"段落引用分类规则
- `plugins/i18n-iris-plugin/rules/i18n_dict_translate_facade.md`：补充"字典翻译位置贴近原始字段来源"的规则，避免在最终变量上无脑套 `GetTransXxx`

### 步骤 3：收敛验证规则为独立 `i18n_verify.md` ✅

**位置**：`plugins/i18n-iris-plugin/rules/i18n_verify.md`

**内容来源**：从各 skill 的完成检查段落和 `print-i18n-case-6095804.md` 的验证经验中收敛。

**覆盖**：
- 编码改造验证：裸中文拼接扫描、helper 使用正确性
- 翻译表验证：UI 框架自动翻译文本入表、占位符语义完整性
- 模板验证：XML 解析、defaultvalue 残留、坐标保留、fallback 行为（三种场景：源语言 / 缺少目标语言模板 / 存在目标语言模板）
- 种子验证：写入/回滚数量、引号转义、方法命名
- 调试断点扫描：`b //`、`b ;`、`console.log` 临时输出
- 编译验证：后端类编译、前端文件编码（UTF-8 / GB2312）

**同步修改**：
- `plugins/i18n-iris-plugin/rules/i18n_index.md`：新增 `i18n_verify.md` 入口
- 各 skill 的完成检查段落引用 `i18n_verify.md` 的通用项，但保留自身特化检查，避免丢失 XML 模板、CSP 同步、种子写入等场景差异

### 步骤 4：更新 `i18n-coding` skill 为阶段化入口（方式 1 落地） ✅

**修改**：`plugins/i18n-iris-plugin/skills/i18n-coding/SKILL.md`

**变化**：
- 必读规则中增加 `i18n_link_tracing.md`（链路定位前置）和 `i18n_field_classification.md`（分类前置）
- 在"后端改造"段落中，打印链路的处理从内联规则改为引用独立规则
- 产出部分增加：链路事实报告、字段分类清单
- 新增"阶段化执行"段落：当需求涉及多个文件、多种数据形态或打印链路时，引导 Agent 按五个阶段顺序执行，每个阶段输出中间文件供下一阶段消费
- 阶段化执行是推荐模式，不强制；简单需求（单文件、明确链路）仍可直接执行编码改造
- 明确 XML 模板同步只在链路定位确认存在 XML 模板记录后触发，不作为所有打印 i18n 的默认步骤

### 步骤 4.1：补齐 i18n 插件入口一致性 ✅

**修改**：
- `plugins/i18n-iris-plugin/AGENTS.md`
- `plugins/i18n-iris-plugin/README.md`（如需补充用户可见能力入口）
- `plugins/i18n-iris-plugin/skills/i18n-xml-print-template-sync/SKILL.md`：触发条件中补充前置约束"必须先通过链路定位确认存在 XML 模板记录"，避免被误用为所有打印 i18n 的默认入口

**变化**：
- 在 Skill 路由中增加 `skills/i18n-xml-print-template-sync/SKILL.md`。
- 在规则入口中增加本计划新增的三个 rule。
- README 若列举技能或打印能力，应明确 XML 打印模板同步的适用边界：仅用于已确认存在 XML 模板记录的打印链路。

### 步骤 5：反哺 `demand-com-exp.md` 的经验到规则 ✅

**修改**：`docs/demand-com-exp.md`

**变化**：
- 已被提炼为规则的经验条目，追加引用指向对应规则文件
- 候选经验中已落地的部分标记为"已提升"
- 维护规则中增加"当候选经验被提升为 plugin rule 时，在本条目中标记引用"
- 保持 `demand-com-exp.md` 的通用经验定位，不把 6095804/6095798 的长案例细节复制进去

### 步骤 6：更新维护记忆 ✅

**修改**：
- `memory/agent-kit-maintenance-log.md`：记录本轮变更
- `memory/agent-kit-maintenance-backlog.md`：原则上保持 frontmatter/task-affinity 队列不变；仅在日志中说明本轮是用户明确要求优先处理 i18n workflow 计划
- `memory/agent-kit-maintenance-decisions.md`：补充 `memory/plan/` 目录定位（维护者计划子目录，不部署到业务项目）

## 关键文件清单

| 操作 | 文件 |
|---|---|
| 新建 | `plugins/i18n-iris-plugin/rules/i18n_link_tracing.md` |
| 新建 | `plugins/i18n-iris-plugin/rules/i18n_field_classification.md` |
| 新建 | `plugins/i18n-iris-plugin/rules/i18n_verify.md` |
| 修改 | `plugins/i18n-iris-plugin/rules/i18n_index.md` |
| 修改 | `plugins/i18n-iris-plugin/skills/i18n-coding/SKILL.md` |
| 修改 | `plugins/i18n-iris-plugin/rules/i18n_coding_backend.md` |
| 修改 | `plugins/i18n-iris-plugin/rules/i18n_coding_print_backend.md` |
| 修改 | `plugins/i18n-iris-plugin/rules/i18n_dict_translate_facade.md` |
| 修改 | `plugins/i18n-iris-plugin/AGENTS.md` |
| 修改 | `plugins/i18n-iris-plugin/skills/i18n-xml-print-template-sync/SKILL.md` |
| 视情况修改 | `plugins/i18n-iris-plugin/README.md` |
| 修改 | `docs/demand-com-exp.md` |
| 修改 | `memory/agent-kit-maintenance-log.md` |
| 修改 | `memory/agent-kit-maintenance-decisions.md` |
| 视情况修改 | `memory/agent-kit-maintenance-backlog.md` |

## 命名约定

- 新 rule 文件使用 snake_case：`i18n_link_tracing.md`、`i18n_field_classification.md`、`i18n_verify.md`
- 遵循 `i18n_` 前缀约定

## 验证方式

1. **规则完整性**：读取 `i18n_index.md`，确认新增的三个规则入口可正常路由
2. **引用一致性**：grep 确认 `i18n_link_tracing`、`i18n_field_classification`、`i18n_verify` 在相关 skill 和规则中被正确引用
3. **thin-index**：运行 `generate-plugin-thin-index.ps1` dry-run，确认新规则自动生成 thin-index 入口
4. **经验反哺闭环**：检查 `demand-com-exp.md` 中被提升的经验条目是否有对应规则引用
5. **入口一致性**：确认 `plugins/i18n-iris-plugin/AGENTS.md`、README、`i18n-xml-print-template-sync` SKILL.md 对 XML 打印模板同步能力的描述一致且边界明确
6. **旧措辞清理**：搜索"打印 JSON"，确认仅在明确 JSON 场景保留；通用入口应改为"实际打印返回数据"或等价表述
7. **维护记忆边界**：确认本轮日志只记录摘要，不复制完整规则正文、长命令输出或案例长段落

## 实施验证结果

| 验证项 | 结果 |
|---|---|
| 规则完整性 | ✅ `i18n_index.md` 已包含 4 个新入口（3 个新规则 + 打印规则措辞修正） |
| 引用一致性 | ✅ `i18n_link_tracing` 在 6 处被引用，`i18n_field_classification` 在 8 处被引用，`i18n_verify` 在 4 处被引用 |
| thin-index | ✅ dry-run 确认 3 个新规则均被正确识别 |
| 经验反哺 | ✅ `demand-com-exp.md` 中 3.3 和第四节已标记"已提升" |
| 入口一致性 | ✅ `AGENTS.md` 已补齐 Skill 路由和规则入口 |
| 旧措辞清理 | ✅ 规则和 skill 中无"打印 JSON"残留 |
| 维护记忆 | ✅ log、decisions 已更新，无敏感信息或长段落 |
