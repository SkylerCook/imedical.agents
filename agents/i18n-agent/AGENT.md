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

## 框架反馈

任务完成后，如果对框架文件（rules、skills、templates、references、scripts 等）做了修正，按 `agents/_shared/feedback-protocol.md` 自动生成反馈条目到 `feedback/framework/`。

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
