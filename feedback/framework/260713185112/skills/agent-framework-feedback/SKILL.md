---
name: agent-framework-feedback
description: Use at the end of a completed HIS task to route reusable demand experience and framework corrections to the context-aware feedback directory, or when the user explicitly requests feedback recording or promotion.
---

# Agent Framework Feedback

## 触发条件

满足以下任一条件时使用本 skill：

- HIS 需求完成后，由项目根 `AGENTS.md` 作为常驻收尾步骤调用。
- 本次产生了可跨需求复用的经验、边界、判断标准、处理顺序或检查项。
- 本次对 `.agents/` 下的框架文件（rules、skills、templates、references、scripts、agents、workflows 等）做了修正。
- 用户明确要求“生成反馈”“记录本次发现”“沉淀经验”或“提升到 plugin rule”。

调用本 skill 不等于必须写文件。没有可复用经验、没有框架修正且用户未明确要求记录时，直接结束，不生成空反馈。

## 目标

- 统一处理需求经验与框架修正，避免用户每次手工输入固定提示词。
- 将可复用需求经验先去重记录，再按成熟度提升到对应 owner plugin rule。
- 将任务中发现的框架问题和修正内容结构化记录，供维护者回归框架。
- 不干扰正常任务流程，收尾检查应快速完成。

## 路由与按需读取

### 先确定框架根目录

执行任何读取或写入前，先按当前项目的实际部署形态确定 `FRAMEWORK_ROOT`：

- **业务项目部署态**：项目根存在 `.agents/skills/agent-framework-feedback/SKILL.md` 时，`FRAMEWORK_ROOT=.agents`。
- **imedical.agents 源仓态**：仓库根存在 `skills/agent-framework-feedback/SKILL.md`、`agents/` 和 `feedback/` 时，`FRAMEWORK_ROOT=.`。

优先遵循当前项目根 `AGENTS.md` 的明确路径约定。不要把 `feedback/...` 或 `agents/...` 直接按 shell 当前工作目录解析，也不要因为源仓说明而把部署态反馈写到业务项目根级 `feedback/`。

先判断本次属于哪条分支，可同时命中：

1. **需求经验分支**：读取 `{FRAMEWORK_ROOT}/feedback/experience/demand-com-exp.md`；纯部署、上传、编译或部署排障经验改读 `{FRAMEWORK_ROOT}/feedback/experience/deploy-com-exp.md`。
2. **框架修正分支**：读取 `{FRAMEWORK_ROOT}/agents/_shared/feedback-protocol.md` 和 `{FRAMEWORK_ROOT}/feedback/framework/_template.md`。

仅在确认命中对应分支后读取其文件。不要为了收尾形式完整而加载无关反馈材料。

## 需求经验分支

### 1. 判断是否值得记录

满足以下任一项时可记录：

- 现有 rules/skills 未覆盖的通用坑、边界或判断标准。
- 已验证、可跨需求复用的工程模式、处理顺序或检查项。
- 已有经验再次命中，需要追加需求号并 `命中+1`。

一次性操作流水、项目私有业务事实、可低成本从代码重新发现的信息不记录。

### 2. 先去重再写入

- 搜索目标 experience 文件，已有同类条目时合并，不重复新增。
- 按目标文件的分类、条目格式和需求索引规则更新。
- 保留需求号、命中次数、可操作做法和适用边界。

### 3. 按成熟度提升到 owner plugin rule

同时满足以下条件时可直接提升：

- 已通过本次实际问题或验证结果确认有效。
- 规则与具体项目、服务器、患者、页面清单或私有路径无关。
- 有明确 owner，例如 IRIS 编码、i18n、部署或项目上下文插件。
- 能写成稳定约束或检查项，而不是本次排障流水。

提升后在经验条目追加“已提升”路径。尚不成熟、owner 不明确或可能只适用于单一项目时，只记录经验候选，不修改 plugin rule。

需求经验提升本身不再递归生成一份 `{FRAMEWORK_ROOT}/feedback/framework/`；只有任务独立发现并修正了框架缺陷时，才继续执行框架修正分支。

## 框架修正分支

### 1. 记录版本

```bash
git rev-parse HEAD
```

### 2. 创建反馈目录

目录名使用当前时间戳 `YYMMDDHHmmss`（精确到秒），如 `260608143022`。

```text
{FRAMEWORK_ROOT}/feedback/framework/YYMMDDHHmmss/
```

### 3. 复制修正文件

将修正后的框架文件按 owner 仓库路径结构放入反馈目录。只放修改过的文件。业务项目部署态下，源文件的 `.agents/` 前缀不写入反馈包内部；例如 `.agents/skills/x/SKILL.md` 在反馈包内保存为 `skills/x/SKILL.md`，便于与 `imedical.agents` 源仓直接 diff。

示例：
- 修正了 `plugins/i18n-iris-plugin/rules/i18n_coding_backend.md`
  → `{FRAMEWORK_ROOT}/feedback/framework/YYMMDDHHmmss/plugins/i18n-iris-plugin/rules/i18n_coding_backend.md`
- 修正了 `scripts/update-agents.ps1`
  → `{FRAMEWORK_ROOT}/feedback/framework/YYMMDDHHmmss/scripts/update-agents.ps1`

### 4. 生成 _template.md

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

### 5. 提交

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

## 禁止事项

- 不在反馈中写入业务项目私有事实（患者数据、业务页面清单、具体业务逻辑）。
- 需求经验分支只有满足提升条件时才修改 owner plugin rule；框架修正分支仍只把修正副本放入反馈目录，不直接覆盖上游框架文件。
- 不为了完整性复制未修改的文件。
- 不生成空反馈（没有实际修正时不触发本 skill）。

