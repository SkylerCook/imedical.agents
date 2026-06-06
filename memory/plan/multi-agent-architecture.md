# 多智能体架构设计

> 状态：设计稿 | 日期：2026-06-06 | 适用仓库：`imedical.agents`

## 背景

领导要求当前体系支持可扩展的不同方向智能体，并进一步支持多智能体协作、调度和编排。

现有 `imedical.agents` 已具备较成熟的能力包体系：

- `plugins/agent-context-kit/`：项目上下文维护。
- `plugins/coding-iris-plugin/`：IRIS/ObjectScript/CSP/JavaScript/HISUI 编码能力。
- `plugins/i18n-iris-plugin/`：IRIS 国际化能力。
- `rules/`、`skills/`、`scripts/`、`templates/`、`references/` 已有明确职责边界。
- thin-index 机制已用于把插件内 rules/skills 暴露给业务项目浅层 `.agents/rules/` 和 `.agents/skills/`。

现有缺口是：插件定义了“能力”，但没有统一定义“谁来执行这些能力、如何协作、如何交接、如何被 Codex、Claude Code 等工具发现和调度”。

## 目标

1. 在仓库顶层建立可发现的 `agents/` 智能体注册层。
2. 在仓库顶层建立 `workflows/` 多智能体编排层。
3. 保持 `plugins/` 作为能力实现层，不把领域规则复制进智能体定义。
4. 支持 Codex、Claude Code、WorkBuddy 等工具通过统一入口发现、调度或退化执行。
5. 支持不具备子代理能力的工具降级为单 Agent 串行执行。
6. 新增智能体方向时有稳定文件结构、命名约定、交接协议和验证清单。

## 非目标

- 第一阶段不实现真正的运行时调度器。
- 第一阶段不为每个工具维护多份互相漂移的 prompt。
- 第一阶段不把业务项目私有事实写入本仓库 agents、workflows、plugins 或 memory。
- 第一阶段不强制所有任务都走多智能体；小任务仍允许单 Agent 处理。

## 核心架构

采用“三层分离”：

```text
┌──────────────────────────────────────────────┐
│ 顶层智能体注册层 agents/                       │
│ 定义角色、职责、权限、输入输出、可调用能力       │
├──────────────────────────────────────────────┤
│ 顶层协作编排层 workflows/                     │
│ 定义阶段顺序、交接产物、分支条件、降级策略       │
├──────────────────────────────────────────────┤
│ 插件能力实现层 plugins/                       │
│ 提供 rules、skills、scripts、templates、refs   │
└──────────────────────────────────────────────┘
```

关键原则：

- Agent 是角色边界，不是规则仓库。
- Workflow 是协作边界，不属于某个单独 Agent。
- Plugin 是能力边界，继续承载可复用领域规则、skill、脚本和模板。
- `AGENT.md` 是人类可读 canonical 事实源。
- `bindings.yaml` 是机器可读辅助索引，不替代 `AGENT.md`。
- 工具适配入口只能引用 canonical 定义，不能维护第二份规则。

## 厂商无关原则与适配边界

本仓库维护的是 `imedical.agents` 自己的 Agent 协作协议，不绑定 Codex、Claude Code、OpenCode、CodeBuddy、WorkBuddy、Hermes 或任何单一厂商工具。

设计目标不是把某个工具的目录结构复制成仓库标准，而是维护一套稳定的 canonical 源，再按工具生成或映射适配入口：

```text
imedical.agents canonical
  |-- agents/
  |-- workflows/
  `-- plugins/
        |
        |-- Codex adapter
        |-- Claude Code adapter
        |-- OpenCode adapter
        |-- CodeBuddy adapter
        |-- WorkBuddy adapter
        `-- Hermes adapter
```

### Canonical 优先

以下文件是唯一事实源：

- `agents/<name>-agent/AGENT.md`
- `agents/<name>-agent/bindings.yaml`
- `agents/agent-registry.md`
- `workflows/*.workflow.md`
- `workflows/workflow-registry.md`
- `plugins/*`

工具专属目录或配置，例如 `.codex/agents/`、`.claude/agents/`、`.opencode/`、`.codebuddy/agents/`、Hermes skill 配置、WorkBuddy agent docs 映射，都只能是适配层。

适配层允许删除并重新生成，不允许反向成为规则源。

### 模型无关

Canonical 定义中不写死具体模型名、供应商名或订阅档位，例如不在通用 `AGENT.md` 中固定写 `gpt-*`、`claude-*`、`deepseek-*`、`gemini-*`。

Canonical 只描述能力档位：

```yaml
modelHints:
  explorer: fast
  planner: strong
  reviewer: deep-reasoning
  testing: balanced
```

各工具适配器再把这些抽象档位映射到实际模型：

| 抽象档位 | 含义 |
|---|---|
| `fast` | 快速检索、轻量总结、低成本并行扫描 |
| `balanced` | 普通实现、常规验证、一般分析 |
| `strong` | 复杂设计、跨模块推理、高风险改造 |
| `deep-reasoning` | 审查、安全、疑难问题、强一致性推理 |

如果某个工具没有模型选择能力，忽略 `modelHints`，按默认模型执行。

### 能力无关

Canonical 不依赖某个工具私有能力作为唯一执行路径。每个 workflow 必须同时支持：

- 有 subagent 能力：按多智能体并行或分阶段执行。
- 无 subagent 能力：由单 Agent 按阶段串行执行。
- 有 skill 能力：通过 skill 入口按需加载。
- 无 skill 能力：通过 `AGENTS.md`、registry 和 Markdown 文件直接读取。
- 有 YAML 解析能力：读取 `bindings.yaml`。
- 无 YAML 解析能力：以 `AGENT.md` 和 workflow Markdown 为准。

### 适配边界

适配器负责“翻译格式”，不负责“创造规则”。

允许适配器做：

- 生成 Codex custom agent TOML。
- 生成 Claude Code subagent Markdown。
- 生成 OpenCode agent 配置或 Markdown agent。
- 生成 CodeBuddy sub-agent Markdown。
- 生成 `.agents/skills/<agent-name>/SKILL.md` thin-index。
- 生成工具特定的模型、权限、工具 allowlist/denylist 映射。

不允许适配器做：

- 新增 canonical 中不存在的职责。
- 修改智能体禁止事项。
- 把领域规则全文复制成工具专属 prompt。
- 把业务项目私有事实写回本仓库。
- 让工具专属文件成为长期维护入口。

### 兼容策略

不同工具的能力差异按以下顺序兼容：

1. 优先读取项目 `AGENTS.md` 中的智能体路由。
2. 读取 `agents/agent-registry.md` 和 `workflows/workflow-registry.md`。
3. 如果工具支持专属 agent 目录，读取或生成对应 adapter。
4. 如果工具只支持 skills，使用 `.agents/skills/*/SKILL.md` thin-index 跳转到 canonical。
5. 如果工具只支持普通 Markdown 上下文，直接引用 `AGENT.md` 和 workflow 文件。
6. 如果工具不支持子代理，按 workflow 的串行降级路径执行。

## 仓库目录设计

```text
imedical.agents/
|-- agents/
|   |-- agent-registry.md
|   |-- _shared/
|   |   |-- handoff-protocol.md
|   |   `-- report-templates/
|   |       |-- fact-report.template.md
|   |       |-- classification-report.template.md
|   |       |-- change-summary.template.md
|   |       `-- verification-report.template.md
|   |-- coordinator-agent/
|   |   |-- AGENT.md
|   |   |-- bindings.yaml
|   |   `-- codex-task.md
|   |-- explorer-agent/
|   |-- planner-agent/
|   |-- coding-agent/
|   |-- review-agent/
|   |-- testing-agent/
|   `-- i18n-agent/
|
|-- workflows/
|   |-- workflow-registry.md
|   |-- standard-change.workflow.md
|   |-- bugfix.workflow.md
|   |-- review-test-release.workflow.md
|   `-- i18n-change.workflow.md
|
|-- plugins/
|   |-- agent-context-kit/
|   |-- coding-iris-plugin/
|   `-- i18n-iris-plugin/
|
|-- skills/
|-- rules/
|-- scripts/
|-- docs/
`-- memory/
```

部署到业务项目后，对应路径为：

```text
业务项目/
|-- AGENTS.md
`-- .agents/
    |-- agents/
    |-- workflows/
    |-- plugins/
    |-- skills/
    |-- rules/
    |-- scripts/
    `-- docs/
```

因此安装和更新脚本的 sparse checkout 必须从当前：

```text
docs/
rules/
skills/
plugins/
scripts/
```

扩展为：

```text
docs/
rules/
skills/
plugins/
scripts/
agents/
workflows/
```

根 `memory/`、根 `AGENTS.md`、根 `README.md`、展示页文件和 `scripts/tests/` 仍不部署到业务项目 `.agents/`。

## 部署与本地生成层边界

`agents/` 和 `workflows/` 是能力包仓库的正式内容，部署到业务项目 `.agents/` 后也应作为 `.agents` 独立仓库的受管内容存在，不应加入 `.agents/.git/info/exclude`。

现有生成层 ignore 仍保持：

```gitignore
/config/
/memory/
/rules/
/skills/
/scripts/
```

第一阶段不把 `/agents/` 和 `/workflows/` 加入 ignore。原因：

- 顶层智能体和 workflow 是通用能力包资产，需要随 `.agents` 更新。
- 忽略它们会导致业务项目无法看到能力包更新，也会让适配器生成失去来源。
- 本地项目差异不应直接改 canonical `AGENT.md` 或 workflow。

业务项目如需本地定制，按以下分层处理：

| 定制类型 | 推荐位置 | 是否忽略 | 说明 |
|---|---|---|---|
| 项目事实、路径、偏好、能力开关 | `.agents/config/*_profile.md` | 是 | 沿用 config 合并策略 |
| 项目私有工作流补充 | `.agents/config/agent_workflow_overrides.md` | 是 | 只写项目差异，不改 canonical workflow |
| 项目私有 Agent 模型映射 | `.agents/config/agent_model_profile.md` | 是 | 抽象档位到具体模型的本地映射 |
| 临时交接报告 | 业务项目 `docs/agent-reports/` 或团队指定目录 | 由业务项目决定 | 工作产物，不属于能力包 |
| 通用 Agent/Workflow 修正 | `.agents/agents/`、`.agents/workflows/` 后贡献回能力包 | 否 | 需去工程化并提交能力包仓库 |

如果业务项目确实需要长期维护私有 Agent 或 workflow，优先放在业务项目自己的非 `.agents` 文档或配置中，再由业务项目 `AGENTS.md` 路由；不要直接改 `.agents/agents/` 里的 canonical 文件，避免更新冲突。

## agents 层设计

### 注册表

`agents/agent-registry.md` 是智能体发现入口，记录：

- 智能体名称。
- 适用任务。
- 角色定义路径。
- 默认 workflow。
- 依赖插件。
- 支持的工具适配入口。
- 降级执行方式。

示例：

```markdown
| 智能体 | 职责 | 角色定义 | 默认 workflow | 依赖插件 |
|---|---|---|---|---|
| coordinator-agent | 总控调度和冲突裁决 | agents/coordinator-agent/AGENT.md | standard-change | agent-context-kit |
| review-agent | 代码审查和风险发现 | agents/review-agent/AGENT.md | review-test-release | coding-iris-plugin |
| i18n-agent | IRIS 国际化需求处理 | agents/i18n-agent/AGENT.md | i18n-change | i18n-iris-plugin, coding-iris-plugin |
```

### 单个智能体目录

每个智能体使用目录形式，而不是单个散落文件：

```text
agents/<name>-agent/
|-- AGENT.md
|-- bindings.yaml
`-- codex-task.md
```

`AGENT.md` 必须包含：

- 角色定位。
- 适用任务。
- 明确职责。
- 明确禁止事项。
- 输入。
- 输出。
- 可读取的 workflow。
- 可调用的插件能力。
- 交接协议。
- 单 Agent 降级执行方式。

`bindings.yaml` 用于工具或脚本做索引，建议包含：

```yaml
name: review-agent
description: 代码审查和风险发现
defaultWorkflow: review-test-release
plugins:
  - coding-iris-plugin
inputs:
  - task brief
  - change summary
  - git diff
outputs:
  - review report
modelHints:
  review: strong
```

`codex-task.md` 是可选的人类可读 Codex 说明，只引用 `AGENT.md`、`bindings.yaml` 和 workflow，不复制规则全文。第一阶段如已生成 `.codex/agents/<agent-name>.toml`，可以不创建 `codex-task.md`；后续如保留，应标记为说明文档而不是发现入口。

### 命名约定

| 载体 | 命名 | 示例 |
|---|---|---|
| 智能体目录 | kebab-case + `-agent` | `coordinator-agent`、`i18n-agent` |
| 智能体主定义 | 固定 `AGENT.md` | `agents/review-agent/AGENT.md` |
| 智能体绑定索引 | 固定 `bindings.yaml` | `agents/review-agent/bindings.yaml` |
| workflow 文件 | kebab-case + `.workflow.md` | `standard-change.workflow.md` |
| 注册表 | 固定 registry 名 | `agent-registry.md`、`workflow-registry.md` |
| 交接协议 | kebab-case | `handoff-protocol.md` |
| 交接报告模板 | kebab-case + `.template.md` | `fact-report.template.md` |
| 适配器生成脚本 | kebab-case | `generate-agent-adapters.ps1` |
| agent thin-index 脚本 | kebab-case | `generate-agent-thin-index.ps1` |

### 通用 Agent 与领域 Agent 边界

通用 Agent 描述跨领域复用的职责，例如探索、规划、编码、审查、测试和协调。它不绑定具体业务领域规则，`bindings.yaml` 中 `plugins` 为空，或只引用 `agent-context-kit` 这类基础上下文能力。

领域 Agent 绑定特定插件和规则集，例如 `i18n-agent` 绑定 `i18n-iris-plugin` 和 `coding-iris-plugin`。领域 Agent 可以组合通用角色的阶段，但必须明确其领域约束、输入输出和需要读取的插件能力。

判断标准：

| 类型 | 判断标准 | 示例 |
|---|---|---|
| 通用 Agent | `plugins` 为空或只依赖基础上下文插件 | `explorer-agent`、`review-agent`、`testing-agent` |
| 领域 Agent | `plugins` 绑定领域插件或领域规则集 | `i18n-agent`、后续 `api-dev-agent` |
| 工具适配 Agent | 由 adapter 生成，只服务某工具发现 | `.codex/agents/review-agent.toml` |

新增 Agent 时，如果职责可以服务多个领域，优先建通用 Agent；如果需要领域插件、领域术语、领域验证规则，建领域 Agent。

### 通用角色

第一阶段建议建立以下通用智能体：

| 智能体 | 职责 | 禁止事项 | 主要输出 |
|---|---|---|---|
| `coordinator-agent` | 总控调度、拆分协作、整合结论、冲突裁决 | 不跳过确认，不替子 Agent 隐式改结论 | 任务简报、最终汇总 |
| `explorer-agent` | 读取上下文、定位事实、确认入口和影响面 | 不改代码，不做无证据结论 | 事实报告 |
| `planner-agent` | 拆解实施步骤、识别依赖和风险 | 不直接实现 | 实施计划 |
| `coding-agent` | 按计划执行代码修改 | 不扩大范围，不改无关模块 | 变更摘要 |
| `review-agent` | 审查缺陷、风险、规范偏差、缺测 | 不直接重写实现 | 审查报告 |
| `testing-agent` | 设计和执行验证，记录结果 | 不未验证即声明通过 | 验证报告 |

领域智能体在通用角色之上扩展。例如 `i18n-agent` 可以组合 Explorer、Classifier、Coder、Template、Verifier 五阶段，并引用 `i18n-iris-plugin` 和 `coding-iris-plugin`。

## workflows 层设计

`workflows/` 是顶层编排资产，不能藏在某个 Agent 或插件内。

### 注册表

`workflows/workflow-registry.md` 记录：

- workflow 名称。
- 适用场景。
- 默认参与智能体。
- 阶段顺序。
- 分支条件。
- 降级模式。

### workflow 文件

文件命名使用 kebab-case + `.workflow.md`：

```text
workflows/standard-change.workflow.md
workflows/bugfix.workflow.md
workflows/review-test-release.workflow.md
workflows/i18n-change.workflow.md
```

每个 workflow 至少包含：

- 触发条件。
- 阶段列表。
- 每阶段负责智能体。
- 每阶段输入。
- 每阶段输出。
- 人工确认点。
- 错误处理。
- 子代理不可用时的串行降级步骤。

标准变更流程：

```text
Coordinator
  -> Explorer: 输出 fact report
  -> Planner: 输出 implementation plan
  -> Coding Agent: 输出 change summary
  -> Review Agent: 输出 review report
  -> Testing Agent: 输出 verification report
  -> Coordinator: 汇总结论、风险和后续动作
```

### workflow 职责边界

`standard-change.workflow.md` 是默认完整变更流程，适用于从需求理解到实现、审查、验证的常规任务。它包含编码前探索和计划，也包含编码后的 review 和 testing。

`review-test-release.workflow.md` 不是 `standard-change` 的重复版本，而是已完成变更后的质量闸口流程，适用于以下场景：

- 用户明确要求“只审查这次改动”。
- 分支已有实现，需要补 review、验证、发布说明。
- PR 合并前需要二次检查。
- 不允许继续编码，只允许报告风险和建议。

建议边界：

| workflow | 默认用途 | 是否编码 | 主要阶段 |
|---|---|---|---|
| `standard-change` | 默认完整变更 | 是 | Explore → Plan → Code → Review → Test → Summarize |
| `bugfix` | 缺陷定位和修复 | 是 | Reproduce → Diagnose → Patch → Regression Test |
| `review-test-release` | 已完成变更的质量闸口 | 默认否 | Review → Test → Release Notes/Risk Summary |
| `i18n-change` | IRIS 国际化领域流程 | 条件是 | Explore → Classify → Code/Seed/Template → Verify |

如果后续发现 `review-test-release` 与 `standard-change` 高度重复，应优先把它降级为 `standard-change` 的条件分支，而不是维护两套相同阶段。

### Coordinator 最小调度规则

第一阶段不实现复杂调度器，但 `coordinator-agent` 必须有最小调度规则：

1. 任务分级：
   - `single-agent`：单文件、小修、低风险、用户未要求协作。
   - `review-assisted`：已有代码修改，需要审查或验证。
   - `multi-agent`：跨模块、跨技术域、高风险、信息不完整、用户明确要求多智能体。
2. 拆分策略：
   - 读多写少的任务优先拆给 `explorer-agent`、`review-agent`、`testing-agent`。
   - 写操作默认只给一个 `coding-agent`，避免并行写冲突。
   - 同一文件不同时分配给多个可写 Agent。
3. 子 Agent 选择：
   - 需要事实定位：`explorer-agent`。
   - 需要计划拆解：`planner-agent`。
   - 需要实现：`coding-agent`。
   - 需要风险审查：`review-agent`。
   - 需要验证：`testing-agent`。
   - 命中领域插件：选择对应领域 Agent，例如 `i18n-agent`。
4. 冲突裁决：
   - 区分“已验证事实”“推断”“建议”。
   - 多个子 Agent 结论冲突时，以可复现证据、测试结果、源码引用优先。
   - 无法裁决时，Coordinator 输出冲突点和需要人工确认的问题，不静默选择。
5. 失败和超时：
   - 子 Agent 失败时，记录失败阶段、已完成产物和可继续部分。
   - 可降级时由 Coordinator 接手串行执行；不可降级时停止并报告阻塞条件。
   - 不因某个非关键子 Agent 失败而丢弃其它 Agent 的有效结果。

## 交接协议

多智能体协作必须通过结构化产物交接，避免多个 Agent 共享一大段自由上下文后相互污染。

统一协议放在：

```text
agents/_shared/handoff-protocol.md
```

模板放在：

```text
agents/_shared/report-templates/
```

建议第一阶段定义四类交接产物：

| 产物 | 用途 | 模板 |
|---|---|---|
| 事实报告 | Explorer 输出事实、证据、未知项 | `fact-report.template.md` |
| 分类清单 | Classifier 输出对象分类、处理方式和不处理项 | `classification-report.template.md` |
| 变更摘要 | Coder 或 Template 阶段输出修改和生成产物 | `change-summary.template.md` |
| 验证报告 | Testing Agent 输出命令、结果、残余风险 | `verification-report.template.md` |

报告命名建议：

```text
docs/agent-reports/{ticket-or-topic}/{stage}-{agent}.md
```

业务项目中如果没有明确工单号，用短主题代替。报告属于目标项目工作产物，不写回 `imedical.agents` 插件或维护记忆。

`docs/agent-reports/` 的入库策略由业务项目自行决定：

- 能力包仓库的 `docs/` 继续只放规范、runbook 和架构文档。
- 业务项目的 `docs/agent-reports/` 可以入库，也可以加入业务项目 `.gitignore`。
- `.agents/.git/info/exclude` 不管理业务项目 `docs/agent-reports/`。
- 如果报告包含临时分析、日志或敏感摘要，默认不入库，交由业务项目规则决定。

## 工具适配

### Canonical 定义

唯一 canonical 定义来源：

- `agents/<name>-agent/AGENT.md`
- `agents/<name>-agent/bindings.yaml`
- `workflows/*.workflow.md`
- `agents/_shared/handoff-protocol.md`

其它工具入口只能引用这些文件。

### 适配器生成层

后续建议新增独立脚本：

```text
scripts/generate-agent-adapters.ps1
```

该脚本从 canonical 定义读取：

```text
agents/*/AGENT.md
agents/*/bindings.yaml
agents/agent-registry.md
workflows/*.workflow.md
workflows/workflow-registry.md
```

按目标工具生成适配入口：

```text
.agents/skills/<agent-name>/SKILL.md
.codex/agents/<agent-name>.toml
.claude/agents/<agent-name>.md
.opencode/agents/<agent-name>.md 或 opencode.json
.codebuddy/agents/<agent-name>.md
```

WorkBuddy 和 Hermes 若没有稳定的项目级 agent 文件规范，先生成说明型 adapter 文档或 skill 入口，由其运行时通过 agent docs、skills 或上下文文件读取 canonical 定义。

生成物必须在文件头声明：

```text
本文件由 imedical.agents canonical 定义生成。
请勿手工长期维护；修改源文件 agents/ 或 workflows/ 后重新生成。
```

### Codex

Codex 的最佳适配方式分两层：

- 目标工程 `AGENTS.md` 的智能体路由。
- `.agents/agents/agent-registry.md`。
- `.agents/workflows/workflow-registry.md`。
- `.agents/skills/<agent-name>/SKILL.md` 作为通用 skill 入口。
- `.codex/agents/<agent-name>.toml` 作为 Codex custom agent 入口。

Codex custom agent 适配应从 `AGENT.md` 和 `bindings.yaml` 生成 `name`、`description`、`developer_instructions`、`model_reasoning_effort`、`sandbox_mode` 和可选 skill 配置。

`codex-task.md` 可以保留为人类可读说明，但不作为 Codex 的唯一发现机制。

### Claude Code

Claude Code 的最佳适配方式分两层：

- `.claude/agents/<agent-name>.md` 作为 Claude Code subagent 入口。
- `.claude/skills/<agent-name>/SKILL.md` 或 `.agents/skills/<agent-name>/SKILL.md` 作为 skill 入口。

Claude Code subagent 适配应从 canonical 生成 YAML frontmatter，例如 `name`、`description`、`tools`、`model`、`skills`、`permissionMode`，正文只引用 `AGENT.md` 和 workflow，不复制插件规则全文。

通用 `.agents/skills/<agent-name>/SKILL.md` thin-index 仍可用于 Claude Code 以外的工具，或作为 Claude Code 的兼容入口。

thin-index 内容只做路由：

```text
本 skill 是智能体入口 thin-index。
真实角色定义：.agents/agents/<name>-agent/AGENT.md
绑定索引：.agents/agents/<name>-agent/bindings.yaml
协作流程：.agents/workflows/<workflow>.workflow.md
读取本文件后必须继续读取上述文件。
```

后续可新增脚本从 `agents/agent-registry.md` 或 `bindings.yaml` 生成这些 skill thin-index，避免手工漂移。

### agent thin-index 生成

不要复用或扩展 `scripts/generate-plugin-thin-index.ps1` 来处理 agents。该脚本继续只负责插件 `rules/` 和 `skills/` 的 thin-index，避免插件生成逻辑和智能体适配逻辑耦合。

如果需要为 Agent 生成 `.agents/skills/<agent-name>/SKILL.md`，新增独立脚本：

```text
scripts/generate-agent-thin-index.ps1
```

该脚本只处理：

- `agents/*/AGENT.md`
- `agents/*/bindings.yaml`
- `workflows/*.workflow.md`
- `.agents/skills/<agent-name>/SKILL.md`

`scripts/generate-agent-adapters.ps1` 可以调用 `generate-agent-thin-index.ps1`，但二者职责不同：

| 脚本 | 职责 |
|---|---|
| `generate-agent-thin-index.ps1` | 生成通用 `.agents/skills/*/SKILL.md` 智能体入口 |
| `generate-agent-adapters.ps1` | 生成 Codex、Claude Code、OpenCode、CodeBuddy 等工具专属适配入口 |

### OpenCode

OpenCode 可读取 `.agents/skills/*/SKILL.md`，因此通用 skill thin-index 对 OpenCode 友好。

如果需要让 OpenCode 原生识别 subagent，应生成：

```text
.opencode/agents/<agent-name>.md
```

或更新 `opencode.json` 中的 `agent` 配置。权限配置应从 canonical 的职责和禁止事项映射，例如 review 类 Agent 默认禁止 edit/write，explorer 类 Agent 默认只允许 read/grep/glob 和安全只读命令。

### CodeBuddy

CodeBuddy sub-agent 可通过项目级：

```text
.codebuddy/agents/<agent-name>.md
```

适配文件应使用 Markdown + YAML frontmatter，映射 `name`、`description`、`tools`、`model` 等字段。CodeBuddy 与 Claude Code 的子代理形态相近，但适配文件仍应独立生成，避免假设两者完全兼容。

### WorkBuddy

WorkBuddy 更偏运行时 agent docs、capability、workflow 检索。适配策略优先是生成可被其 agent docs 或上下文索引摄取的文档：

```text
workflows/
agents/
```

如果后续确认 WorkBuddy 有稳定项目级 agent manifest，再新增对应生成目标。未确认前，不把 WorkBuddy 私有格式写入 canonical。

### Hermes

Hermes 强调 skills、MCP、context files 和自学习能力。适配策略优先生成 Hermes skill 或 context 入口，让 Hermes 读取：

- `agents/agent-registry.md`
- `workflows/workflow-registry.md`
- 目标 `AGENT.md`
- 目标 workflow

Hermes 的自学习或自生成 skill 不应直接写回本仓库 canonical；只有经过人工确认并去工程化后，才能沉淀为 `agents/`、`workflows/` 或 `plugins/` 的正式变更。

### 未知工具和其它 Agent Runtime

未知工具默认通过：

- 业务项目 `AGENTS.md`。
- `.agents/agents/agent-registry.md`。
- `.agents/workflows/workflow-registry.md`。

若工具不支持子代理、skills 或 YAML 解析，退化为读取 `AGENT.md` 和 workflow Markdown，由单 Agent 串行执行。

## 与插件体系的关系

Agent 不复制插件规则，只声明可调用能力。

示例：

```yaml
plugins:
  - i18n-iris-plugin
  - coding-iris-plugin
rules:
  - plugins/i18n-iris-plugin/rules/i18n_verify.md
  - plugins/coding-iris-plugin/rules/iris_coding_workflow.md
skills:
  - plugins/i18n-iris-plugin/skills/i18n-coding/SKILL.md
```

领域规则仍归插件维护：

- i18n 规则继续放 `plugins/i18n-iris-plugin/rules/`。
- IRIS 编码规则继续放 `plugins/coding-iris-plugin/rules/`。
- Agent 只定义何时读取、由谁读取、产出什么。

## 版本演进与更新策略

`agents/` 和 `workflows/` 是能力包受管内容，能力包更新时应随 `.agents` 独立仓库正常更新。`scripts/update-agents.ps1` 需要覆盖以下行为：

1. 拉取和刷新 sparse checkout 时包含 `agents/`、`workflows/`。
2. 检查业务项目是否存在 `.agents/agents/agent-registry.md` 和 `.agents/workflows/workflow-registry.md`。
3. dry-run 阶段报告 agent/workflow 新增、删除、重命名和适配入口变化。
4. write 阶段可重建生成物，例如 `.agents/skills/<agent-name>/SKILL.md` 和工具 adapter。
5. 不直接覆盖 `.agents/config/` 中的项目本地 profile。

本地定制策略沿用 config 合并原则：

- 目标项目已有 config 值优先。
- 模板新增字段只追加为待确认项。
- 字段语义变化只报告 `config-review-required`。
- 疑似废弃字段只报告，不自动删除。

如果业务项目修改了 `.agents/agents/` 或 `.agents/workflows/` 里的受管文件，更新脚本应视为能力包源码改动或冲突：

- 通用修正：去工程化后提交回 `imedical.agents`。
- 项目私有改动：迁移到 `.agents/config/agent_*_profile.md` 或业务项目自己的规则/文档。
- 无法自动合并：停止并报告冲突，不静默覆盖。

工具专属 adapter 是生成物，更新时允许删除重建。adapter 文件头必须声明来源，便于脚本识别哪些文件可安全重建。

## 新增智能体 checklist

新增一个智能体方向时，按以下步骤执行：

1. 判断类型：
   - 跨领域职责：创建通用 Agent。
   - 绑定领域插件或领域规则：创建领域 Agent。
2. 创建 `agents/<name>-agent/AGENT.md`。
3. 创建 `agents/<name>-agent/bindings.yaml`。
4. 更新 `agents/agent-registry.md`。
5. 选择已有 workflow，或创建 `workflows/<name>.workflow.md`。
6. 更新 `workflows/workflow-registry.md`。
7. 如需工具原生发现，运行或补充 `scripts/generate-agent-adapters.ps1` 目标工具输出。
8. 如需 skill 发现，运行或补充 `scripts/generate-agent-thin-index.ps1`。
9. 更新业务项目 `AGENTS.md` 路由片段或能力包 README 中的接入说明。
10. 验证：
    - `AGENT.md` 可独立阅读。
    - `bindings.yaml` 引用的插件、rules、skills 路径存在。
    - workflow 有串行降级路径。
    - 适配入口只引用 canonical，不复制规则全文。
    - 不包含业务项目敏感信息或私有事实。

## 第一阶段落地范围

第一阶段建议控制范围，先建立顶层架构和一个领域样板。

### 新增目录

```text
agents/
workflows/
```

### 新增通用智能体

```text
agents/coordinator-agent/
agents/explorer-agent/
agents/planner-agent/
agents/coding-agent/
agents/review-agent/
agents/testing-agent/
```

### 新增领域样板

优先新增：

```text
agents/i18n-agent/
```

原因：

- 当前已有 `i18n-iris-plugin`，规则和 skill 比较完整。
- `memory/plan/i18n-workflow-decompose.md` 已有五阶段协作构想，可迁移为领域 workflow。
- i18n 任务天然包含探索、分类、编码、模板、验证，适合验证多智能体架构。

i18n 五阶段映射：

| i18n 阶段 | 对应通用角色/领域角色 | 说明 |
|---|---|---|
| Explorer | `explorer-agent` + `i18n-agent` 领域约束 | 定位入口、调用链、页面、类、模板和数据来源 |
| Classifier | `i18n-agent` 内部阶段 | 分类用户可见文本、字典字段、页面翻译种子、XML 模板 |
| Coder | `coding-agent` + `i18n-agent` 领域约束 | 执行前后端 i18n 改造 |
| Template/Seed | `i18n-agent` 内部阶段 | 生成翻译种子、XML 模板翻译或同步产物 |
| Verifier | `testing-agent` + `i18n-agent` 领域约束 | 校验源语言残留、fallback、模板命中和翻译表差异 |

`i18n-agent` 不替代通用 Agent，而是把通用 Agent 阶段和 `i18n-iris-plugin` 规则绑定起来。

### 新增 workflow

```text
workflows/standard-change.workflow.md
workflows/review-test-release.workflow.md
workflows/i18n-change.workflow.md
```

### 暂缓内容

- 暂缓新增 `test-doc-agent` 和 `api-dev-agent`，等 i18n 样板验证后再扩展。
- 暂缓实现自动调度脚本，只保留结构、路由和降级协议。
- 不暂缓适配入口生成器。第一阶段应至少提供 `scripts/generate-agent-thin-index.ps1` 和 `scripts/generate-agent-adapters.ps1` 的最小 dry-run/write 能力，避免手工维护多个工具入口导致漂移。

## 后续实施影响面

落地顶层 `agents/` 和 `workflows/` 时，需要同步修改：

- `README.md`：说明顶层智能体和 workflow。
- `docs/ai-coding-workspace-kit-v0.2.0.md`：补充顶层 `agents/`、`workflows/` 规范。
- `scripts/install-agents.ps1`：sparse checkout 增加 `agents/`、`workflows/`。
- `scripts/update-agents.ps1`：刷新和检查逻辑覆盖 `agents/`、`workflows/`。
- `memory/agent-kit-maintenance-decisions.md`：记录长期架构决策。
- `memory/agent-kit-maintenance-log.md`：记录本轮维护摘要。

如果新增 Claude Code skill thin-index 生成逻辑，优先新增独立脚本，不改 `scripts/generate-plugin-thin-index.ps1` 的插件规则语义。`generate-plugin-thin-index.ps1` 继续只负责插件 rules/skills thin-index。

## 风险和降级

| 风险 | 处理策略 |
|---|---|
| 不同工具识别 Agent 的方式不一致 | 统一维护 `AGENT.md` 和 workflow，工具入口只引用 canonical 定义 |
| 子代理能力不可用 | workflow 必须提供单 Agent 串行降级步骤 |
| `bindings.yaml` 无法被工具解析 | `AGENT.md` 必须独立可读，YAML 只是辅助索引 |
| agents 与 plugins 职责混淆 | Agent 只写职责和调度契约，领域规则仍写入插件 |
| 业务项目未部署顶层目录 | 安装和更新脚本必须纳入 `agents/`、`workflows/` sparse checkout |
| 交接报告污染能力包仓库 | 报告输出到业务项目 `docs/agent-reports/`，不写入插件或维护记忆 |

## 验证清单

实施后至少验证：

1. 仓库根存在 `agents/` 和 `workflows/`，命名符合约定。
2. `agents/agent-registry.md` 能路由到每个 `AGENT.md`。
3. 每个 `AGENT.md` 包含职责、禁止事项、输入、输出、降级说明。
4. 每个 `bindings.yaml` 引用的插件、规则、skill 路径存在。
5. `workflows/workflow-registry.md` 能路由到每个 workflow。
6. workflow 阶段输出符合 `handoff-protocol.md`。
7. 业务项目安装或更新后 `.agents/agents/` 和 `.agents/workflows/` 存在。
8. Claude Code skill thin-index 能指向真实 `AGENT.md`。
9. Codex 能按 `AGENTS.md`、agent registry 和 workflow 串行执行。
10. 不支持子代理时，单 Agent 仍能按 workflow 完成任务。

## 推荐实施顺序

1. 重写并确认本设计。
2. 使用本设计生成正式实施计划。
3. 新增顶层 `agents/` 和 `workflows/` 骨架。
4. 新增通用角色和交接协议。
5. 新增 `i18n-agent` 领域样板和 `i18n-change.workflow.md`。
6. 新增 `generate-agent-thin-index.ps1` 和 `generate-agent-adapters.ps1` 的最小实现。
7. 修改 README、workspace spec、安装/更新脚本和维护记忆。
8. 执行路径、引用和脚本 dry-run 验证。
