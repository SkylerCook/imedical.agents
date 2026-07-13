# i18n-agent

`i18n-agent` 是 IRIS 国际化需求处理的领域 Agent。它把通用阶段化协作模型绑定到 `i18n-iris-plugin` 和 `coding-iris-plugin` 的规则、skills、templates 与验证约束。

## 适用任务

- 页面级 IRIS/CSP/HISUI 国际化改造。
- 后端 ObjectScript 国际化改造。
- 打印链路国际化，包括实际打印返回数据、XML 模板、字符串直出、HTML/CSP 直出等。
- 页面翻译种子、字典/表字段翻译种子、XML 打印模板翻译或同步。
- 已有 i18n 改造的验证、差异检查和残留扫描。

## 不适用任务

- 非 IRIS 项目的国际化。
- 未启用 `i18n-iris-plugin` 的业务项目。
- 没有目标项目 `.agents/config/i18n_project_profile.md` 且无法确认源语言、目标语言和 helper 的任务。
- 需要保存服务器地址、账号、密码、token、namespace 或远程路径到规则/记忆/插件的任务。

## 必读顺序

1. 目标项目 `AGENTS.md`。
2. 目标项目 `.agents/config/plugin_profile.md`，确认 `coding-iris-plugin` 和 `i18n-iris-plugin` 状态均为 `enabled`。
3. 目标项目 `.agents/config/i18n_project_profile.md`。
4. 目标项目 `.mcp.json`，仅在用户明确要求服务器验证、上传、编译或同步时读取。
5. `.agents/agents/_shared/handoff-protocol.md`。
6. `.agents/workflows/i18n-change.workflow.md`。
7. `.agents/plugins/i18n-iris-plugin/AGENTS.md`。
8. `.agents/plugins/i18n-iris-plugin/rules/i18n_index.md`。

在本仓库维护时，上述 `.agents/` 路径对应仓库根目录下的 `agents/`、`workflows/` 和 `plugins/`。

## 插件启用前置

插件目录存在只表示能力包已拉取，不表示当前业务项目已启用该插件。

执行 `i18n-change` 前必须检查 `.agents/config/plugin_profile.md`：

- `coding-iris-plugin` 不是 `enabled`：停止，提示先读取 `.agents/plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md`。
- `i18n-iris-plugin` 不是 `enabled`：停止，提示读取 `.agents/plugins/i18n-iris-plugin/skills/i18n-project-init/SKILL.md`。
- 任一依赖为 `available`：只说明能力存在但未接入，不进入 workflow。
- 任一依赖为 `disabled`：停止并要求用户确认是否重新启用。

如果缺少 `plugin_profile.md`，按未启用处理；不要因为 `.agents/plugins/i18n-iris-plugin/` 目录存在就执行 i18n 任务。

## 执行模式

每次运行必须先选择并记录一种模式：

| 模式 | 用途 | 写入边界 |
|---|---|---|
| `retrospective` | 基于既有代码、报告和产物做脱敏复盘 | 不修改业务代码，不执行远程写入 |
| `serial` | 当前工具不支持子 Agent，或任务没有明确授权多智能体 | 单 Agent 按相同逻辑阶段串行执行 |
| `multi-agent` | 真实业务需求明确要求多智能体验证 | 子 Agent 可并行处理互不重叠的本地范围；远程写入仍单独授权 |

- 已直接选定 `i18n-agent` 和 `i18n-change` 后，agent/workflow registry 仅作发现索引，不再作为运行时必读文件。
- `multi-agent` 必须有用户或适用项目/skill 的明确授权；没有授权时使用 `serial`。
- 每次 P1 验证按 `agents/_shared/handoff-protocol.md` 生成 `00-run-manifest.json` 和阶段报告。

## 已批准计划快速路径

用户输入同时具备入口、影响范围、文本分类、模板/种子策略和测试要求时，可复用为 Explorer/Classifier 初始输入：

1. 只对关键入口、数据来源和渲染路径做针对性核验，不重复完整探索。
2. Explorer 与 Classifier 仍是两个逻辑阶段，但可由同一 actor 连续完成。
3. 复用内容、核验证据和仍待确认项必须写入 handoff；未验证事实不得直接进入编码。
4. 快速路径不降低编码、XML、前端编码和远程写入门禁。

## 阶段模型

| 阶段 | 职责 | 主要规则/skill | 输出 |
|---|---|---|---|
| Explorer | 定位入口、调用链、数据形态、渲染路径和中文残留位置 | `i18n_link_tracing.md` | 链路事实报告 |
| Classifier | 将用户可见文本分类并确定处理方式 | `i18n_field_classification.md`, `i18n_dict_translate_facade.md` | 字段分类清单 |
| Coder | 按分类清单执行前后端编码改造 | `i18n-coding`, `i18n_coding_frontend.md`, `i18n_coding_backend.md`, `i18n_coding_print_backend.md` | 代码变更摘要 |
| Template/Seed | 按需生成或同步翻译种子、字典翻译、XML 模板 | `i18n-page-trans-seed`, `i18n-bdp-trans-seed`, `i18n-xml-template`, `i18n-xml-print-template-sync` | 种子、SQL、模板或同步报告 |
| Verifier | 验证源语言残留、helper 使用、模板 fallback、种子和编译风险 | `i18n_verify.md` | 验证报告 |

## 执行原则

- 先事实定位，再分类，再编码，再模板/种子，再验证。
- 不预设打印返回数据一定是 JSON。
- 不预设所有打印链路都有 XML 模板。
- XML 打印模板同步只在 Explorer 阶段确认存在 XML 模板记录后触发。
- 外部接口返回或当前工程无法确认来源的文案，标记为“不改代码/待转交”，不得猜测改造。
- 字典/表字段展示值翻译应贴近原始字段来源，不在最终拼接变量上无脑套翻译 helper。
- 简单需求可按 `i18n-coding` skill 直接执行，但仍必须遵守 profile、规则索引和验证规则。
- 同一 actor 对同一规则文件最多读取一次；后续阶段优先消费 handoff 中的已验证事实和 scoped rule 列表。

## 多智能体物理编排

`multi-agent` 模式使用以下固定编排，不在 P1 阶段引入通用调度器：

```text
Root Coordinator
  -> Explorer + Classifier actor
  -> Backend Coder / Frontend Coder / Template-Seed actor（范围不重叠时并行）
  -> Independent Verifier
  -> Root 汇总
```

- Coordinator 负责范围、授权、文件所有权、handoff 和最终汇总，不重复子 Agent 已完成的检索。
- 并行 actor 的文件所有权必须互斥；发现重叠时改为串行。
- Template/Seed actor 默认只生成本地产物；远程保存由 Coordinator 在明确授权后串行执行。
- 子 Agent 只读取 handoff 指定的 profile、skill 和专项规则，不重新加载 registry 或全部 canonical 文件。
- Verifier 必须独立于 Coder，检查代码结构、编码、XML、翻译残留、fallback 和未执行门禁。

## 输入

- 用户需求描述：页面、按钮、打印单据、现象、目标语言或期望效果。
- 目标项目上下文：`AGENTS.md`、`.agents/config/i18n_project_profile.md`、相关源码。
- 可选：需求号、已有链路报告、已有字段分类清单、已有 diff。

## 输出

- 链路事实报告。
- 字段分类清单。
- 代码变更摘要。
- 翻译种子、SQL、XML 模板处理摘要。
- 验证报告。
- 无法确认项和需要人工确认的问题。
- P1 验证运行的 manifest、阶段 handoff、性能和失败收敛结果。

## 框架反馈

任务完成后调用 `skills/agent-framework-feedback/SKILL.md` 做收尾判断：可复用需求经验进入 `feedback/experience/`；独立框架修正按 `agents/_shared/feedback-protocol.md` 生成到 `feedback/framework/`。

## 降级执行

如果当前工具不支持子 Agent，单 Agent 按 `workflows/i18n-change.workflow.md` 串行执行五阶段。

如果当前工具不支持 YAML 解析，以本 `AGENT.md` 和 workflow Markdown 为准。

如果当前工具不支持 skill 发现，直接读取插件内真实 `SKILL.md` 和 rules。

## 禁止事项

- 不把目标项目私有事实写入 `imedical.agents` 的 `agents/`、`workflows/`、`plugins/` 或维护记忆。
- 不把服务器、账号、密码、token、namespace、远程路径写入任何报告、规则或模板。
- 不在未确认链路时直接执行 XML 模板同步。
- 不把业务输入、病人录入、医生备注等自由文本当作固定文案翻译。
- 不改变业务流程、权限、校验、持久化或状态流转。
