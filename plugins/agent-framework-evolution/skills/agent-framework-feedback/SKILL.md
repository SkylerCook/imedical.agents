---
name: agent-framework-feedback
description: Use only when feedback review is applicable and the user has explicitly accepted the business demand; review read-only, then write or promote only separately authorized actions.
---

# Agent Framework Feedback

## 触发条件

自动调用本 skill 前必须先读取 `agents/_shared/delivery-lifecycle.md`，依次确认 `taskKind=business-demand`、由其派生的 `feedbackReviewApplicable=true`，以及需求已由用户明确进入 `accepted`。三个条件缺一不可；还需命中框架缺陷、规则冲突、可复用新经验或用户明确要求。普通 skill 无信号不加载；正式 run 的 always 策略保留例行只读审查。

适用性分类：

- 业务需求：`taskKind=business-demand`，固定派生 `feedbackReviewApplicable=true` 和 `feedbackApplicabilityReason=business-demand`。
- 纯 `imedical.agents` 框架维护、框架实现、版本升级、文档治理和 feedback 机制自身修改：`taskKind=framework-maintenance`，使用独立维护生命周期；不调用本 skill，也不主动向用户建议 feedback。
- 普通查询或无法判断的任务：`taskKind=other`，不进入需求验收或 feedback。

`locally-verified`、`acceptance-pending`、commit、部署、Verifier 完成或框架文件发生修改均不能绕过任一门禁。

适用业务需求进入 `accepted` 后，满足以下任一条件时使用本 skill：

- 项目根 `AGENTS.md` 路由到本 skill 时，仍先检查反馈信号；常驻收尾入口本身不构成信号。
- 本次发现具有新增价值、验证证据和跨场景依据的经验线索；按下文准入条件筛选，普通修复完成本身不构成信号。
- 本次在业务需求真实使用过程中发现并修正了 `.agents/` 下的框架文件（rules、skills、templates、references、scripts、agents、workflows 等）。
- 用户明确要求“生成反馈”“记录本次发现”“沉淀经验”或“提升到 plugin rule”。

调用本 skill 的默认动作仅为只读审查，不等于写文件。仅报告通过准入的经验候选、有效已有命中或独立框架问题及建议动作，不为报告完整而凑条目。任何新增条目、命中次数更新、framework feedback 或 rule 提升，必须由用户逐项授权后执行。on-signal 无候选时正常收尾，不生成空反馈、不例行报告；正式 run 可记录 skipped/no-signal，不能冒充 completed 审查。

用户显式要求在 `accepted` 前记录观察是唯一例外：只能形成 `provisional` 候选，不得更新命中次数、生成正式 framework feedback 或提升 rule。

## 目标

- 在适用业务需求获得用户验收后统一审查需求经验与框架修正，同时避免技术完成或纯框架维护被误判为反馈场景。
- 将可复用需求经验先去重记录，再按成熟度提升到对应 owner plugin rule。
- 将任务中发现的框架问题和修正内容结构化记录，供维护者回归框架。
- 不干扰正常任务流程，收尾检查应快速完成。

## 路由与按需读取

### 先确定框架根目录

执行任何读取或写入前，先按当前项目的实际部署形态确定 `FRAMEWORK_ROOT`：

- **业务项目部署态**：项目根存在 `.agents/skills/agent-framework-feedback/SKILL.md` 时，`FRAMEWORK_ROOT=.agents`。
- **imedical.agents 源仓态**：仓库根存在 `plugins/agent-framework-evolution/skills/agent-framework-feedback/SKILL.md`、`agents/` 和 `feedback/` 时，`FRAMEWORK_ROOT=.`。

优先遵循当前项目根 `AGENTS.md` 的明确路径约定。不要把 `feedback/...` 或 `agents/...` 直接按 shell 当前工作目录解析，也不要因为源仓说明而把部署态反馈写到业务项目根级 `feedback/`。

只读审查先判断本次属于哪条分支，可同时命中：

1. **需求经验分支**：读取 `{FRAMEWORK_ROOT}/feedback/experience/demand-com-exp.md`；纯部署、上传、编译或部署排障经验改读 `{FRAMEWORK_ROOT}/feedback/experience/deploy-com-exp.md`。
2. **框架修正分支**：读取 `{FRAMEWORK_ROOT}/agents/_shared/feedback-protocol.md` 和 `{FRAMEWORK_ROOT}/feedback/framework/_template.md`。

仅在确认 `taskKind=business-demand`、`accepted` 且命中对应分支后读取其文件。任一条件不满足时不得读取 experience 文件，也不得创建或修改 feedback。不要为了收尾形式完整而加载无关反馈材料。

## 需求经验分支

### 1. 判断是否值得记录

共享经验必须同时通过以下四项准入；先筛选价值，再去重，最后请求写入授权：

1. **新增价值**：现有 rules/skills/reference 未覆盖，且不是基础语言知识、常规开发常识或可低成本从代码重新发现的信息。已有经验的有效命中按下一节处理，不作为新增候选。
2. **复用依据**：剥离需求号、页面名和项目配置后，仍能解释相同机制在另一独立场景为何成立。区分已验证场景与推断场景；换名称或声称“以后可能用到”不算依据，不虚构第二次命中。
3. **验证与边界**：说明触发条件、问题机制、修正效果、适用范围和不适用情况；依赖组件版本或配置时明确限定。只有改完成功、机制尚不明确的观察留在项目内。
4. **沉淀收益**：能避免非显然的重复排查或明确的高代价错误，并给出可执行做法。普通缺陷修复、通用最佳实践和任务流水无需进入共享经验库。

不强制出现两次才准入：单次可稳定复现的组件陷阱或数据破坏风险，也可凭机制与边界证据通过上述四项；风险标签本身不能代替证据。

未通过时，正常结束；有项目保留价值的事实仅在已有授权范围内维护项目上下文，不自动新建候选文件。用户明确要求记录也不改变共享准入标准，可说明原因并建议项目内保存。`provisional` 观察同样留在项目内。

筛选示例：

| 发现 | 判断 |
|---|---|
| 嵌套普通回调不继承外层 `this` | 基础语言知识，不新增共享经验 |
| 日期合法性校验夹带“不能早于当天” | 后者是业务约束；只评估剥离它后的校验机制是否满足四项 |
| 删除附件后组件内部队列仍拦截重选 | 有版本/配置、复现、修正与边界证据时可准入；仅凭本次修好不足以准入 |
| 阅读到已有经验、照常完成一次操作 | 不算有效命中，不增加计数 |
| 首次发现可复现的数据错位 | 机制、修正和适用边界证实后可单次准入，无需等待再次造成损失 |

### 2. 先去重并请求动作授权

- 搜索目标 experience 文件及相关 owner 规则，确认是否已有覆盖。已被规则覆盖时直接复用，只有新增边界或反例才另行评估。
- 已有命中必须是独立需求/场景中实际遇到同一问题或经验证避免同一风险；重读条目、重复验收、同一需求多次修复均不增加计数。同一需求/场景只计一次，无法辨别独立性时不更新。
- 新增候选报告简述：新增价值、复用依据（区分验证与推断）、验证与边界、沉淀收益及建议 owner；任一项证据不足即不建议共享写入。
- 向用户列出建议动作；未获得该动作授权时不写文件、不更新命中次数。
- 获得授权后按目标文件的分类、条目格式和需求索引规则更新，保留需求号、命中次数、可操作做法和适用边界。

### 3. 按成熟度提升到 owner plugin rule

同时满足以下条件时可建议提升；仍需用户明确授权后执行：

- 已通过上述共享准入，并在两个独立场景确认有效；或单次问题已有可稳定复现的机制证据，足以支持限定范围内的稳定约束。
- 规则与具体项目、服务器、患者、页面清单或私有路径无关。
- 有明确 owner，例如 IRIS 编码、i18n、部署或项目上下文插件。
- 能写成稳定约束或检查项，而不是本次排障流水。

提升后在经验条目追加“已提升”路径。尚不成熟、owner 不明确时保持已合格的共享经验，不提升；可能只适用于单一项目或共享准入证据不足时留在项目内，不进入共享候选。命中次数本身不是提升依据。

需求经验提升本身不再递归生成一份 `{FRAMEWORK_ROOT}/feedback/framework/`；只有任务独立发现并修正了框架缺陷时，才继续执行框架修正分支。

## 框架修正分支

### 1. 记录版本

```bash
git rev-parse HEAD
```

### 2. 请求 framework feedback 写入授权

先报告框架问题和拟复制文件。用户明确授权后才继续创建目录；已在任务中修正框架并不构成此授权。

### 3. 创建反馈目录

目录名使用当前时间戳 `YYMMDDHHmmss`（精确到秒），如 `260608143022`。

```text
{FRAMEWORK_ROOT}/feedback/framework/YYMMDDHHmmss/
```

### 4. 复制修正文件

将修正后的框架文件按 owner 仓库路径结构放入反馈目录。只放修改过的文件。业务项目部署态下，源文件的 `.agents/` 前缀不写入反馈包内部；例如 `.agents/skills/x/SKILL.md` 在反馈包内保存为 `skills/x/SKILL.md`，便于与 `imedical.agents` 源仓直接 diff。

示例：
- 修正了 `plugins/i18n-iris-plugin/rules/i18n_coding_backend.md`
  → `{FRAMEWORK_ROOT}/feedback/framework/YYMMDDHHmmss/plugins/i18n-iris-plugin/rules/i18n_coding_backend.md`
- 修正了 `scripts/update-agents.ps1`
  → `{FRAMEWORK_ROOT}/feedback/framework/YYMMDDHHmmss/scripts/update-agents.ps1`

### 5. 生成 _template.md

按 `{FRAMEWORK_ROOT}/feedback/framework/_template.md` 格式生成，必须包含以下内容：

**基本信息**：日期、提交人、基于版本（git hash）、HIS 需求号。

**需求上下文**（脱敏）：
- HIS 需求描述（一句话概括）
- 涉及入口（页面、按钮、打印单据、API 等）
- 涉及代码（类名、方法名、CSP 页面路径，移除业务敏感信息）
- 数据特征（数据结构、字典来源、模板类型等）

**问题发现过程**：
- 读取了哪些框架文件（路径 + 读取目的）
- 框架文件的原始指引（引用关键段落，脱敏后）
- 按原始指引执行的实际结果
- 与预期不符的具体表现

**修改说明**：
- 每个修正文件：改了什么、为什么改

**验证结果**：
- 修正后是否解决了问题
- 修正后是否有副作用
- 适用范围（本次场景 / 可能适用于同类场景 / 不确定）

### 6. 提交

默认只生成和校验反馈材料。只有用户明确要求提交或推送时，才执行：

```bash
git add {FRAMEWORK_ROOT}/feedback/framework/YYMMDDHHmmss/
git commit -m "feedback: {简短标题}"
git push origin master
```

## 输出要求

- 反馈目录结构正确，文件保持原路径关系。
- `_template.md` 内容完整，维护者可仅凭此文件判断问题是否值得回归。
- 修正文件可与 master 对应文件做 diff。
- 不包含敏感信息（服务器地址、账号、密码、token、namespace、远程路径）。
- 不包含长段日志或完整 diff。
- 只读审查使用结果：`no-reusable-experience`、`existing-experience-hit`、`experience-candidate`、`framework-issue`；不要用这些结果暗示已经写入。

## 禁止事项

- 不在反馈中写入业务项目私有事实（患者数据、业务页面清单、具体业务逻辑）。
- 需求经验分支只有满足提升条件时才修改 owner plugin rule；框架修正分支仍只把修正副本放入反馈目录，不直接覆盖上游框架文件。
- 不为了完整性复制未修改的文件。
- 无合格经验或独立框架问题时不生成空反馈；on-signal 正常静默收尾，用户明确请求审查或 always 策略下可简述无合格项。
- 不为纯框架维护生成“框架修改自己的 feedback”，也不在这类任务的最终回复中建议用户触发 feedback。
